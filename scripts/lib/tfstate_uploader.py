"""Conditional S3 Terraform state upload, post-upload verification, and atomic remote adoption."""

from __future__ import annotations

import json
import os
import pathlib
import subprocess
import tempfile
from typing import Any, Callable, Dict, Optional, Tuple

from .cloud_config_utils import redact_sensitive_text
from .tfstate_journal import TfStateJournal, _fsync_dir
from .tfstate_sync import (
    _head_remote_tfstate_meta,
    parse_and_validate_tfstate,
    tfstate_bucket_and_key,
)

_RunFn = Callable[..., subprocess.CompletedProcess]
_EmitFn = Optional[Callable[[str, str, str, str], None]]
_CONFLICT_MARKERS = ("preconditionfailed", "412", "conditionalrequestconflict")


class StateSyncPendingError(RuntimeError):
    """Raised when Terraform completed a state mutation but S3 state synchronization has not finished."""


class StateDivergenceError(RuntimeError):
    """Raised when local and remote Terraform state disagree safely without an automatic resolution."""


def emit_state_log(emit_fn: _EmitFn, step_id: Optional[str], step_title: Optional[str], msg: str) -> None:
    if emit_fn and step_id and step_title:
        emit_fn(step_id, step_title, "log", msg)


def validate_workspace(workspace: str) -> str:
    ws = (workspace or "").strip() or "default"
    if ws != "default":
        raise StateDivergenceError(
            f"Unsupported Terraform workspace '{ws}'; EnvScale requires the 'default' workspace."
        )
    return ws


def validate_state_backend_and_workspace(
    local_path: str | pathlib.Path,
    state_key: str,
    workspace: str,
) -> str:
    """Validate workspace (including .terraform/environment) and forbid foundation backend overlap."""
    ws = validate_workspace(workspace)
    norm_key = (state_key or "").strip().lstrip("/")
    if norm_key == "foundation/terraform.tfstate" or norm_key.startswith("foundation/"):
        raise StateDivergenceError(
            f"Backend key '{norm_key}' belongs to Persistent Foundation native S3 locking and cannot be managed here."
        )
    env_file = pathlib.Path(local_path).parent / ".terraform" / "environment"
    if env_file.is_file():
        disk_ws = env_file.read_text(encoding="utf-8", errors="replace").strip()
        if disk_ws and disk_ws != "default":
            raise StateDivergenceError(
                f"Active Terraform workspace in {env_file} is '{disk_ws}'; EnvScale requires 'default'."
            )
    return ws


def _aws_kw(aws_env: Optional[Dict[str, str]]) -> Dict[str, Any]:
    kw: Dict[str, Any] = {"capture_output": True, "text": True}
    if aws_env is not None:
        kw["env"] = aws_env
    return kw


def _download_remote_object_with_meta(
    bucket: str,
    key: str,
    region: str,
    dest_dir: pathlib.Path,
    aws_env: Optional[Dict[str, str]],
    run_fn: _RunFn,
) -> Tuple[pathlib.Path, Dict[str, Any], Dict[str, Any]]:
    """Download S3 object via get-object (no --version-id) and return (tmp_path, parsed_state, obj_meta)."""
    fd, raw_tmp = tempfile.mkstemp(prefix=".terraform.tfstate.dl.", dir=str(dest_dir))
    os.close(fd)
    tmp_path = pathlib.Path(raw_tmp)
    tmp_path.chmod(0o600)
    uri = f"s3://{bucket}/{key}"
    try:
        res = run_fn(
            ["aws", "s3api", "get-object", "--bucket", bucket, "--key", key, "--region", region, str(tmp_path), "--output", "json"],
            **_aws_kw(aws_env),
        )
        if res.returncode != 0:
            err = redact_sensitive_text((res.stderr or res.stdout or f"exit {res.returncode}").strip())
            raise RuntimeError(f"Failed downloading remote Terraform state from {uri}: {err}")
        try:
            doc = json.loads(res.stdout or "{}")
        except json.JSONDecodeError:
            doc = {}
        obj_meta = {
            "version_id": str(doc.get("VersionId") or ""),
            "etag": str(doc.get("ETag") or ""),
            "content_length": int(doc.get("ContentLength") or 0),
            "metadata": dict(doc.get("Metadata") or {}),
        }
        parsed = parse_and_validate_tfstate(tmp_path)
        return tmp_path, parsed, obj_meta
    except Exception:
        tmp_path.unlink(missing_ok=True)
        raise


def _check_metadata_consistency(uri: str, metadata: Dict[str, Any], expected_state: Dict[str, Any]) -> Optional[str]:
    if not metadata:
        return None
    meta_sha = str(metadata.get("sha256") or "")
    meta_lin = str(metadata.get("lineage") or "")
    meta_ser = str(metadata.get("serial") or "")
    if meta_sha and meta_sha != expected_state["sha256"]:
        return f"S3 metadata sha256 mismatch at {uri}: {meta_sha[:12]} != {expected_state['sha256'][:12]}."
    if meta_lin and meta_lin != expected_state["lineage"]:
        return f"S3 metadata lineage mismatch at {uri}: {meta_lin} != {expected_state['lineage']}."
    if meta_ser and meta_ser != str(expected_state["serial"]):
        return f"S3 metadata serial mismatch at {uri}: {meta_ser} != {expected_state['serial']}."
    return None


def sync_local_state_to_s3_verified(
    *,
    local_path: str | pathlib.Path,
    account_id: str,
    region: str,
    state_key: str = "runtime/terraform.tfstate",
    workspace: str = "default",
    expected_remote_etag: Optional[str] = None,
    expected_remote_version_id: Optional[str] = None,
    expect_remote_missing: Optional[bool] = None,
    aws_env: Optional[Dict[str, str]] = None,
    run_fn: _RunFn = subprocess.run,
    journal: Optional[TfStateJournal] = None,
    operation_id: Optional[str] = None,
    emit_fn: _EmitFn = None,
    step_id: Optional[str] = None,
    step_title: Optional[str] = None,
) -> Dict[str, Any]:
    """Conditionally upload local state to S3 and verify remote metadata, VersionId, and SHA-256 readback."""
    ws = validate_state_backend_and_workspace(local_path, state_key, workspace)
    bucket, key = tfstate_bucket_and_key(account_id, region, state_key=state_key)
    uri = f"s3://{bucket}/{key}"

    def _fail_pending(msg: str) -> None:
        if journal and operation_id:
            journal.mark_sync_pending(operation_id, msg)
        raise StateSyncPendingError(msg)

    try:
        local = parse_and_validate_tfstate(local_path)
    except Exception as exc:
        _fail_pending(f"Cannot synchronize invalid local Terraform state {local_path}: {exc}")
        raise

    cur_meta = _head_remote_tfstate_meta(bucket, key, region, aws_env, run_fn)
    if expect_remote_missing is True and cur_meta["exists"]:
        _fail_pending(f"S3 state {uri} appeared unexpectedly before conditional upload (etag={cur_meta['etag']}).")
    if expected_remote_etag and (not cur_meta["exists"] or (cur_meta["etag"] and cur_meta["etag"] != expected_remote_etag)):
        _fail_pending(
            f"S3 state {uri} changed between inspection and upload "
            f"(expected_etag={expected_remote_etag}, actual_etag={cur_meta.get('etag') or 'missing'})."
        )
    if expected_remote_version_id and cur_meta["version_id"] and cur_meta["version_id"] != expected_remote_version_id:
        _fail_pending(
            f"S3 state {uri} VersionId changed between inspection and upload "
            f"(expected={expected_remote_version_id}, actual={cur_meta['version_id']})."
        )

    meta_kv = f"lineage={local['lineage']},serial={local['serial']},sha256={local['sha256']},workspace={ws}"
    put_cmd = [
        "aws", "s3api", "put-object",
        "--bucket", bucket, "--key", key, "--body", str(local_path),
        "--server-side-encryption", "AES256", "--metadata", meta_kv,
        "--region", region, "--output", "json",
    ]
    if expect_remote_missing is True or not cur_meta["exists"]:
        put_cmd.extend(["--if-none-match", "*"])
    elif expected_remote_etag:
        put_cmd.extend(["--if-match", expected_remote_etag])

    put_res = run_fn(put_cmd, **_aws_kw(aws_env))
    if put_res.returncode != 0:
        err = redact_sensitive_text((put_res.stderr or put_res.stdout or f"exit {put_res.returncode}").strip())
        if not any(m in err.lower() for m in _CONFLICT_MARKERS):
            # Inspect remote before failing: client may have lost response after S3 committed exact upload.
            try:
                head_chk = _head_remote_tfstate_meta(bucket, key, region, aws_env, run_fn)
                if head_chk["exists"]:
                    with tempfile.TemporaryDirectory(prefix="envscale-tfstate-lost-") as tmp_dir:
                        _, rem_chk, get_meta = _download_remote_object_with_meta(
                            bucket, key, region, pathlib.Path(tmp_dir), aws_env, run_fn
                        )
                    exact_match = (
                        rem_chk["lineage"] == local["lineage"]
                        and rem_chk["serial"] == local["serial"]
                        and rem_chk["sha256"] == local["sha256"]
                        and rem_chk["resource_inventory"] == local["resource_inventory"]
                    )
                    vid = head_chk["version_id"] or get_meta["version_id"]
                    etag = head_chk["etag"] or get_meta["etag"]
                    changed_from_prev = (
                        expect_remote_missing is True
                        or (expected_remote_version_id and vid and vid != expected_remote_version_id)
                        or (expected_remote_etag and etag and etag != expected_remote_etag)
                        or (not expected_remote_version_id and not expected_remote_etag)
                    )
                    if exact_match and changed_from_prev:
                        if journal and operation_id:
                            journal.mark_synchronized(operation_id, s3_version_id=vid, s3_etag=etag, result_local=local)
                        emit_state_log(emit_fn, step_id, step_title, f"Verified S3 state already committed at {uri} (version={vid or '-'}) after lost put response")
                        return {
                            "status": "synchronized_after_lost_response",
                            "uri": uri, "lineage": local["lineage"], "serial": local["serial"],
                            "sha256": local["sha256"], "resource_count": local["resource_count"],
                            "resource_inventory": local["resource_inventory"], "version_id": vid, "etag": etag,
                        }
            except Exception:
                pass
        _fail_pending(f"Failed uploading Terraform state to {uri} (STATE_SYNC_PENDING): {err}")

    try:
        put_doc = json.loads(put_res.stdout or "{}")
    except json.JSONDecodeError:
        put_doc = {}
    put_vid = str(put_doc.get("VersionId") or "")
    put_etag = str(put_doc.get("ETag") or "")

    head_after = _head_remote_tfstate_meta(bucket, key, region, aws_env, run_fn)
    if not head_after["exists"]:
        _fail_pending(f"Post-upload head-object failed: {uri} not found after upload.")
    if head_after["content_length"] and head_after["content_length"] != local["size"]:
        _fail_pending(f"Post-upload size mismatch for {uri}: S3={head_after['content_length']} != local={local['size']}.")
    if put_vid and head_after["version_id"] and head_after["version_id"] != put_vid:
        _fail_pending(f"Post-upload VersionId drift at {uri}: uploaded={put_vid}, head={head_after['version_id']}.")
    meta_err = _check_metadata_consistency(uri, head_after.get("metadata") or {}, local)
    if meta_err:
        _fail_pending(meta_err)

    with tempfile.TemporaryDirectory(prefix="envscale-tfstate-vrf-") as tmp_dir:
        try:
            _, remote_vrf, get_meta = _download_remote_object_with_meta(
                bucket, key, region, pathlib.Path(tmp_dir), aws_env, run_fn
            )
        except Exception as exc:
            _fail_pending(f"Post-upload readback verification failed for {uri}: {exc}")
            raise

    if put_vid and get_meta["version_id"] and get_meta["version_id"] != put_vid:
        _fail_pending(f"Post-upload readback VersionId drift at {uri}: uploaded={put_vid}, get={get_meta['version_id']}.")
    if head_after["version_id"] and get_meta["version_id"] and get_meta["version_id"] != head_after["version_id"]:
        _fail_pending(f"Post-upload VersionId mismatch between head ({head_after['version_id']}) and readback ({get_meta['version_id']}).")
    if (
        remote_vrf["lineage"] != local["lineage"]
        or remote_vrf["serial"] != local["serial"]
        or remote_vrf["sha256"] != local["sha256"]
        or remote_vrf["resource_inventory"] != local["resource_inventory"]
    ):
        _fail_pending(
            f"Post-upload checksum/content mismatch at {uri}: "
            f"local=({local['lineage']},{local['serial']},{local['sha256'][:12]}), "
            f"remote=({remote_vrf['lineage']},{remote_vrf['serial']},{remote_vrf['sha256'][:12]})."
        )

    ver_id = put_vid or head_after["version_id"] or get_meta["version_id"]
    etag = head_after["etag"] or put_etag or get_meta["etag"]
    if journal and operation_id:
        journal.mark_synchronized(operation_id, s3_version_id=ver_id, s3_etag=etag, result_local=local)

    emit_state_log(
        emit_fn, step_id, step_title,
        f"Verified S3 state sync at {uri} (serial={local['serial']}, version={ver_id or '-'}, sha256={local['sha256'][:12]})",
    )
    return {
        "status": "synchronized",
        "uri": uri,
        "lineage": local["lineage"],
        "serial": local["serial"],
        "sha256": local["sha256"],
        "resource_count": local["resource_count"],
        "resource_inventory": local["resource_inventory"],
        "version_id": ver_id,
        "etag": etag,
    }


def adopt_remote_state_atomic(
    *,
    local_path: str | pathlib.Path,
    bucket: str,
    key: str,
    region: str,
    aws_env: Optional[Dict[str, str]],
    run_fn: _RunFn,
) -> Dict[str, Any]:
    target = pathlib.Path(local_path)
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp_path, remote, obj_meta = _download_remote_object_with_meta(bucket, key, region, target.parent, aws_env, run_fn)
    try:
        meta_err = _check_metadata_consistency(f"s3://{bucket}/{key}", obj_meta.get("metadata") or {}, remote)
        if meta_err:
            raise StateDivergenceError(meta_err)
        tmp_path.chmod(0o600)
        with open(tmp_path, "rb") as fh:
            os.fsync(fh.fileno())
        tmp_path.replace(target)
        _fsync_dir(target.parent)
        tmp_path = None
    finally:
        if tmp_path is not None:
            tmp_path.unlink(missing_ok=True)
    remote["version_id"] = obj_meta.get("version_id", "")
    remote["etag"] = obj_meta.get("etag", "")
    return remote
