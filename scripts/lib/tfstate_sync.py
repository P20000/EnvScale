"""Safe manual S3 backup and restore helpers for local runtime Terraform state.

Note: deployment/terraform/versions.tf uses Terraform's local backend, NOT an
S3 backend. Objects at s3://envscale-tfstate-<account>-<region>/runtime/terraform.tfstate
are manual state backup/sync copies and are NOT protected by Terraform native
.tflock state locking. All operations here therefore fail closed on empty,
malformed, or potentially newer state rather than blindly overwriting state.
"""

from __future__ import annotations

import hashlib
import json
import os
import pathlib
import re
import subprocess
import tempfile
from typing import Any, Callable, Dict, Optional, Tuple

from .cloud_config_utils import redact_sensitive_text

_SCOPE_TOKEN_RE = re.compile(r"^[A-Za-z0-9-]+$")
_STATE_KEY_RE = re.compile(r"^[A-Za-z0-9._/-]+$")
_MISSING_OBJECT_MARKERS = ("404", "not found", "nosuchkey")
_RunFn = Callable[..., subprocess.CompletedProcess]


def tfstate_bucket_and_key(
    account_id: str,
    region: str,
    state_key: str = "runtime/terraform.tfstate",
) -> Tuple[str, str]:
    """Return validated (tfstate_bucket, state_key) without fallback defaults."""
    acct = (account_id or "").strip()
    reg = (region or "").strip()
    skey = (state_key or "").strip().lstrip("/")
    if not acct or not _SCOPE_TOKEN_RE.fullmatch(acct):
        raise ValueError(f"Invalid AWS account_id for tfstate bucket: {account_id!r}")
    if not reg or not _SCOPE_TOKEN_RE.fullmatch(reg):
        raise ValueError(f"Invalid AWS region for tfstate bucket: {region!r}")
    if not skey or ".." in skey or not _STATE_KEY_RE.fullmatch(skey):
        raise ValueError(f"Invalid tfstate S3 key: {state_key!r}")
    return f"envscale-tfstate-{acct}-{reg}", skey


def _build_resource_inventory(resources: List[Any]) -> List[str]:
    items: List[str] = []
    for res in resources:
        if not isinstance(res, dict):
            continue
        mode = str(res.get("mode") or "managed")
        rtype = str(res.get("type") or "")
        rname = str(res.get("name") or "")
        insts = res.get("instances") if isinstance(res.get("instances"), list) else []
        ids = sorted(
            str((inst.get("attributes") or {}).get("id") or "")
            for inst in insts
            if isinstance(inst, dict) and (inst.get("attributes") or {}).get("id")
        )
        items.append(f"{mode}:{rtype}.{rname}:{len(insts)}:{','.join(ids)}")
    return sorted(items)


def parse_and_validate_tfstate(path: str | pathlib.Path) -> Dict[str, Any]:
    """Read and validate a Terraform state file, rejecting missing, empty, or malformed files."""
    p = pathlib.Path(path)
    if not p.is_file():
        raise RuntimeError(f"Terraform state file does not exist: {p}")
    raw_bytes = p.read_bytes()
    if not raw_bytes:
        raise RuntimeError(f"Terraform state file is empty (0 bytes): {p}")
    try:
        doc = json.loads(raw_bytes.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"Malformed Terraform state JSON at {p}: {exc}") from exc
    if not isinstance(doc, dict):
        raise RuntimeError(f"Invalid Terraform state root type at {p}: expected object")

    version = doc.get("version")
    serial = doc.get("serial")
    lineage = doc.get("lineage")
    resources = doc.get("resources")
    if not isinstance(version, int) or isinstance(version, bool) or version < 1:
        raise RuntimeError(f"Invalid Terraform state version at {p}: {version!r}")
    if not isinstance(serial, int) or isinstance(serial, bool) or serial < 0:
        raise RuntimeError(f"Invalid Terraform state serial at {p}: {serial!r}")
    if not isinstance(lineage, str) or not lineage.strip():
        raise RuntimeError(f"Terraform state missing valid lineage at {p}")
    if not isinstance(resources, list):
        raise RuntimeError(f"Terraform state missing valid resources list at {p}")

    return {
        "version": version,
        "serial": serial,
        "lineage": lineage.strip(),
        "resource_count": len(resources),
        "resource_inventory": _build_resource_inventory(resources),
        "workspace": "default",
        "sha256": hashlib.sha256(raw_bytes).hexdigest(),
        "size": len(raw_bytes),
    }


def _head_remote_tfstate_meta(
    bucket: str,
    key: str,
    region: str,
    aws_env: Optional[Dict[str, str]],
    run_fn: _RunFn,
) -> Dict[str, Any]:
    kw: Dict[str, Any] = {"capture_output": True, "text": True}
    if aws_env is not None:
        kw["env"] = aws_env
    res = run_fn(
        ["aws", "s3api", "head-object", "--bucket", bucket, "--key", key, "--region", region, "--output", "json"],
        **kw,
    )
    if res.returncode == 0:
        try:
            doc = json.loads(res.stdout or "{}")
        except json.JSONDecodeError:
            doc = {}
        return {
            "exists": True,
            "version_id": str(doc.get("VersionId") or ""),
            "etag": str(doc.get("ETag") or ""),
            "content_length": int(doc.get("ContentLength") or 0),
            "metadata": dict(doc.get("Metadata") or {}),
        }
    err = redact_sensitive_text((res.stderr or res.stdout or f"exit {res.returncode}").strip())
    low = err.lower()
    if any(marker in low for marker in _MISSING_OBJECT_MARKERS):
        return {"exists": False, "version_id": "", "etag": "", "content_length": 0, "metadata": {}}
    raise RuntimeError(f"Unable to inspect remote Terraform state s3://{bucket}/{key}: {err}")


def _head_remote_tfstate(
    bucket: str,
    key: str,
    region: str,
    aws_env: Optional[Dict[str, str]],
    run_fn: _RunFn,
) -> bool:
    return bool(_head_remote_tfstate_meta(bucket, key, region, aws_env, run_fn)["exists"])


def _download_remote_tfstate_temp(
    bucket: str,
    key: str,
    region: str,
    dest_dir: pathlib.Path,
    aws_env: Optional[Dict[str, str]],
    run_fn: _RunFn,
) -> Tuple[pathlib.Path, Dict[str, Any]]:
    fd, raw_tmp = tempfile.mkstemp(prefix=".terraform.tfstate.dl.", dir=str(dest_dir))
    os.close(fd)
    tmp_path = pathlib.Path(raw_tmp)
    tmp_path.chmod(0o600)
    uri = f"s3://{bucket}/{key}"
    kw: Dict[str, Any] = {"capture_output": True, "text": True}
    if aws_env is not None:
        kw["env"] = aws_env
    try:
        res = run_fn(["aws", "s3", "cp", uri, str(tmp_path), "--region", region], **kw)
        if res.returncode != 0:
            err = redact_sensitive_text((res.stderr or res.stdout or f"exit {res.returncode}").strip())
            raise RuntimeError(f"Failed downloading remote Terraform state from {uri}: {err}")
        meta = parse_and_validate_tfstate(tmp_path)
        return tmp_path, meta
    except Exception:
        tmp_path.unlink(missing_ok=True)
        raise


def safe_backup_tfstate_to_s3(
    *,
    local_path: str | pathlib.Path,
    account_id: str,
    region: str,
    aws_env: Optional[Dict[str, str]] = None,
    run_cmd_fn: Optional[Callable[..., Any]] = None,
    run_fn: _RunFn = subprocess.run,
    emit_fn: Optional[Callable[[str, str, str, str], None]] = None,
    step_id: Optional[str] = None,
    step_title: Optional[str] = None,
) -> Dict[str, Any]:
    """Validate local state and safely upload manual S3 copy without overwriting newer remote state."""
    if not os.path.exists(local_path):
        return {"status": "skipped", "reason": "local_missing"}

    local = parse_and_validate_tfstate(local_path)
    bucket, key = tfstate_bucket_and_key(account_id, region)
    uri = f"s3://{bucket}/{key}"

    if _head_remote_tfstate(bucket, key, region, aws_env, run_fn):
        with tempfile.TemporaryDirectory(prefix="envscale-tfstate-chk-") as tmp_dir:
            _, remote = _download_remote_tfstate_temp(bucket, key, region, pathlib.Path(tmp_dir), aws_env, run_fn)
        if local["lineage"] == remote["lineage"]:
            if local["serial"] < remote["serial"]:
                raise RuntimeError(
                    f"Refusing to overwrite newer remote Terraform state {uri}: "
                    f"local serial {local['serial']} < remote serial {remote['serial']}."
                )
            if local["serial"] == remote["serial"]:
                if local["sha256"] == remote["sha256"]:
                    return {"status": "unchanged", "uri": uri, "serial": local["serial"], "lineage": local["lineage"]}
                raise RuntimeError(
                    f"Refusing to overwrite diverged remote Terraform state {uri} at serial {local['serial']}."
                )
        elif remote["resource_count"] > 0:
            raise RuntimeError(
                f"Refusing to overwrite active remote Terraform state {uri} from different lineage "
                f"(local={local['lineage']}, remote={remote['lineage']})."
            )

    cmd = ["aws", "s3", "cp", str(local_path), uri, "--region", region, "--sse", "AES256"]
    if run_cmd_fn is not None:
        run_cmd_fn(cmd, step_id=step_id, step_title=step_title)
    else:
        kw: Dict[str, Any] = {"capture_output": True, "text": True}
        if aws_env is not None:
            kw["env"] = aws_env
        res = run_fn(cmd, **kw)
        if res.returncode != 0:
            err = redact_sensitive_text((res.stderr or res.stdout or f"exit {res.returncode}").strip())
            raise RuntimeError(f"Failed uploading Terraform state to {uri}: {err}")
    if emit_fn and step_id and step_title:
        emit_fn(step_id, step_title, "log", f"Backed up local Terraform state (serial={local['serial']}) to {uri}")
    return {"status": "uploaded", "uri": uri, "serial": local["serial"], "lineage": local["lineage"]}


def safe_restore_tfstate_from_s3(
    *,
    local_path: str | pathlib.Path,
    account_id: str,
    region: str,
    aws_env: Optional[Dict[str, str]] = None,
    run_fn: _RunFn = subprocess.run,
    emit_fn: Optional[Callable[[str, str, str, str], None]] = None,
    step_id: Optional[str] = None,
    step_title: Optional[str] = None,
) -> Dict[str, Any]:
    """Validate and atomically restore manual S3 state copy without overwriting newer local state."""
    bucket, key = tfstate_bucket_and_key(account_id, region)
    uri = f"s3://{bucket}/{key}"
    if not _head_remote_tfstate(bucket, key, region, aws_env, run_fn):
        return {"status": "skipped", "reason": "remote_missing", "uri": uri}

    target = pathlib.Path(local_path)
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp_path: Optional[pathlib.Path] = None
    try:
        tmp_path, remote = _download_remote_tfstate_temp(bucket, key, region, target.parent, aws_env, run_fn)
        if target.exists():
            local = parse_and_validate_tfstate(target)
            if remote["lineage"] == local["lineage"]:
                if remote["serial"] < local["serial"]:
                    raise RuntimeError(
                        f"Refusing to overwrite newer local Terraform state {target}: "
                        f"remote serial {remote['serial']} < local serial {local['serial']}."
                    )
                if remote["serial"] == local["serial"]:
                    if remote["sha256"] == local["sha256"]:
                        return {"status": "unchanged", "uri": uri, "serial": remote["serial"], "lineage": remote["lineage"]}
                    raise RuntimeError(
                        f"Refusing to overwrite diverged local Terraform state {target} at serial {local['serial']}."
                    )
            elif local["resource_count"] > 0:
                raise RuntimeError(
                    f"Refusing to overwrite active local Terraform state {target} with different remote lineage "
                    f"(local={local['lineage']}, remote={remote['lineage']})."
                )
            elif remote["resource_count"] == 0:
                return {"status": "unchanged", "uri": uri, "serial": local["serial"], "lineage": local["lineage"]}

        tmp_path.chmod(0o600)
        tmp_path.replace(target)
        tmp_path = None
    finally:
        if tmp_path is not None:
            tmp_path.unlink(missing_ok=True)

    if emit_fn and step_id and step_title:
        emit_fn(step_id, step_title, "log", f"Restored manual Terraform state copy (serial={remote['serial']}) from {uri}")
    return {"status": "restored", "uri": uri, "serial": remote["serial"], "lineage": remote["lineage"]}


def verify_tfstate_consistency_with_s3(
    *,
    local_path: str | pathlib.Path,
    account_id: str,
    region: str,
    aws_env: Optional[Dict[str, str]] = None,
    run_fn: _RunFn = subprocess.run,
) -> Dict[str, Any]:
    """Strictly read-only consistency check against S3 state copy (never modifies local_path)."""
    bucket, key = tfstate_bucket_and_key(account_id, region)
    uri = f"s3://{bucket}/{key}"
    from .tfstate_journal import TfStateJournal, resolve_journal_path

    pending = TfStateJournal(resolve_journal_path(local_path)).inspect_local_pending_sync(local_path)
    if pending.get("pending"):
        op = pending.get("operation") or {}
        raise RuntimeError(
            f"STATE_SYNC_PENDING: unresolved state synchronization from '{op.get('operation_type')}' "
            f"(op={op.get('operation_id')}). Reconcile S3 state before destroying."
        )
    remote_exists = _head_remote_tfstate(bucket, key, region, aws_env, run_fn)
    local_exists = os.path.isfile(local_path)

    if not remote_exists:
        if local_exists:
            local = parse_and_validate_tfstate(local_path)
            return {"status": "remote_missing", "uri": uri, "serial": local["serial"], "lineage": local["lineage"]}
        return {"status": "both_missing", "uri": uri}

    if not local_exists:
        raise RuntimeError(
            f"Destruction blocked: local Terraform state {local_path} is missing while remote state {uri} exists. "
            "Reconcile state explicitly before destroying."
        )

    local = parse_and_validate_tfstate(local_path)
    with tempfile.TemporaryDirectory(prefix="envscale-tfstate-verify-") as tmp_dir:
        _, remote = _download_remote_tfstate_temp(bucket, key, region, pathlib.Path(tmp_dir), aws_env, run_fn)

    if local["lineage"] == remote["lineage"]:
        if local["serial"] < remote["serial"]:
            raise RuntimeError(
                f"Destruction blocked: local Terraform state (serial={local['serial']}) is older than "
                f"remote state {uri} (serial={remote['serial']}). Reconcile state before destroying."
            )
        if local["serial"] == remote["serial"]:
            if local["sha256"] == remote["sha256"]:
                return {"status": "consistent", "uri": uri, "serial": local["serial"], "lineage": local["lineage"]}
            raise RuntimeError(
                f"Destruction blocked: local Terraform state diverged from remote state {uri} at serial {local['serial']}."
            )
        return {"status": "local_newer", "uri": uri, "serial": local["serial"], "lineage": local["lineage"]}

    if local["resource_count"] == 0 and remote["resource_count"] == 0:
        return {"status": "both_empty", "uri": uri, "serial": local["serial"], "lineage": local["lineage"]}
    raise RuntimeError(
        f"Destruction blocked: local Terraform state lineage ({local['lineage']}) conflicts with "
        f"remote state {uri} lineage ({remote['lineage']}). Refusing to overwrite or destroy mismatched state."
    )
