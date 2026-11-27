"""Centralized Terraform state classification, preflight reconciliation, and managed mutation runner."""

from __future__ import annotations

import os
import pathlib
import subprocess
import tempfile
from typing import Any, Callable, Dict, List, Optional, Sequence

from .cloud_config_utils import redact_sensitive_text
from .tfstate_journal import (
    ConcurrentStateOperationError,
    CorruptedStateJournalError,
    TfStateJournal,
    TfStateOperationLock,
    force_release_stale_lock,
    inspect_remote_lock,
    make_operation_id,
    resolve_journal_path,
)
from .tfstate_sync import _head_remote_tfstate_meta, parse_and_validate_tfstate, tfstate_bucket_and_key
from .tfstate_uploader import (
    StateDivergenceError,
    StateSyncPendingError,
    _check_metadata_consistency,
    _download_remote_object_with_meta,
    adopt_remote_state_atomic,
    emit_state_log,
    sync_local_state_to_s3_verified,
    validate_state_backend_and_workspace,
)

STATE_SYNCHRONIZED = "STATE_SYNCHRONIZED"
LOCAL_AHEAD = "LOCAL_AHEAD"
REMOTE_AHEAD = "REMOTE_AHEAD"
SAME_SERIAL_DIFFERENT_CONTENT = "SAME_SERIAL_DIFFERENT_CONTENT"
LINEAGE_MISMATCH = "LINEAGE_MISMATCH"
REMOTE_MISSING = "REMOTE_MISSING"
LOCAL_MISSING = "LOCAL_MISSING"
STATE_SYNC_PENDING = "STATE_SYNC_PENDING"

_RunFn = Callable[..., subprocess.CompletedProcess]
_EmitFn = Optional[Callable[[str, str, str, str], None]]

__all__ = [
    "ConcurrentStateOperationError", "CorruptedStateJournalError", "LINEAGE_MISMATCH",
    "LOCAL_AHEAD", "LOCAL_MISSING", "REMOTE_AHEAD", "REMOTE_MISSING",
    "SAME_SERIAL_DIFFERENT_CONTENT", "STATE_SYNCHRONIZED", "STATE_SYNC_PENDING",
    "StateDivergenceError", "StateSyncPendingError", "force_release_stale_lock",
    "inspect_remote_lock", "inspect_state_status", "reconcile_terraform_state",
    "run_managed_terraform_mutation", "sync_local_state_to_s3_verified",
]


def _is_proven_local_mutation(
    active_op: Optional[Dict[str, Any]],
    local_state: Optional[Dict[str, Any]],
    remote_state: Optional[Dict[str, Any]],
    remote_meta: Dict[str, Any],
    *,
    bucket: str,
    key: str,
    workspace: str,
) -> bool:
    if not isinstance(active_op, dict) or local_state is None:
        return False
    if (
        active_op.get("backend_bucket") != bucket
        or active_op.get("backend_key") != key
        or active_op.get("workspace", "default") != workspace
        or active_op.get("sync_status") not in ("STATE_SYNC_PENDING", "IN_PROGRESS")
    ):
        return False
    prev_serial, res_serial = active_op.get("prev_serial"), active_op.get("result_serial")
    progressed = prev_serial is not None and res_serial is not None and int(res_serial) > int(prev_serial)
    if active_op.get("terraform_exit_code") != 0 and not progressed:
        return False
    if (
        active_op.get("result_lineage") != local_state["lineage"]
        or res_serial is None
        or int(res_serial) != int(local_state["serial"])
        or active_op.get("result_sha256") != local_state["sha256"]
    ):
        return False
    res_inv = active_op.get("result_resource_inventory")
    if isinstance(res_inv, list) and list(res_inv) != list(local_state["resource_inventory"]):
        if active_op.get("result_resource_count") != local_state["resource_count"] or res_inv:
            return False
    if remote_state is None:
        return not active_op.get("prev_s3_etag") and active_op.get("prev_lineage", "") in ("", local_state["lineage"])
    if (
        active_op.get("prev_lineage") != remote_state["lineage"]
        or prev_serial is None
        or int(prev_serial) != int(remote_state["serial"])
    ):
        return False
    prev_etag, cur_etag = str(active_op.get("prev_s3_etag") or ""), str(remote_meta.get("etag") or "")
    if prev_etag and cur_etag and prev_etag != cur_etag:
        return False
    prev_vid, cur_vid = str(active_op.get("prev_s3_version_id") or ""), str(remote_meta.get("version_id") or "")
    return not (prev_vid and cur_vid and prev_vid != cur_vid)


def inspect_state_status(
    *,
    local_path: str | pathlib.Path,
    account_id: str,
    region: str,
    state_key: str = "runtime/terraform.tfstate",
    workspace: str = "default",
    aws_env: Optional[Dict[str, str]] = None,
    run_fn: _RunFn = subprocess.run,
    journal_path: Optional[str | pathlib.Path] = None,
    include_lock_status: bool = False,
) -> Dict[str, Any]:
    """Read local state, S3 state metadata/content, and journal to classify consistency."""
    ws = validate_state_backend_and_workspace(local_path, state_key, workspace)
    bucket, key = tfstate_bucket_and_key(account_id, region, state_key=state_key)
    uri = f"s3://{bucket}/{key}"
    jpath = resolve_journal_path(local_path, journal_path)
    journal = TfStateJournal(jpath)
    active_op = journal.get_active_operation()
    pending_info = journal.inspect_local_pending_sync(local_path)

    local_state = parse_and_validate_tfstate(local_path) if os.path.exists(local_path) else None
    remote_meta = _head_remote_tfstate_meta(bucket, key, region, aws_env, run_fn)
    remote_state: Optional[Dict[str, Any]] = None
    if remote_meta["exists"]:
        with tempfile.TemporaryDirectory(prefix="envscale-tfstate-insp-") as tmp_dir:
            _, remote_state, get_meta = _download_remote_object_with_meta(
                bucket, key, region, pathlib.Path(tmp_dir), aws_env, run_fn
            )
            for mk in ("version_id", "etag", "content_length", "metadata"):
                if not remote_meta.get(mk) and get_meta.get(mk):
                    remote_meta[mk] = get_meta[mk]

    proven = _is_proven_local_mutation(
        active_op, local_state, remote_state, remote_meta, bucket=bucket, key=key, workspace=ws
    )
    classification = STATE_SYNCHRONIZED
    message = f"Local and remote state at {uri} are synchronized."
    recommended_action = "None"

    if local_state is None and remote_state is None:
        if pending_info.get("pending") and (active_op or {}).get("result_sha256"):
            classification = LOCAL_MISSING
            message = f"Pending operation '{active_op['operation_id']}' recorded local state that is now missing."
            recommended_action = "Inspect backups before provisioning."
    elif local_state is None and remote_state is not None:
        classification = LOCAL_MISSING
        message = f"Local Terraform state missing while remote state {uri} (serial={remote_state['serial']}) exists."
        recommended_action = "Reconcile/adopt remote state before running Terraform."
    elif local_state is not None and remote_state is None:
        if proven:
            classification = STATE_SYNC_PENDING
            message = f"Pending S3 initial state sync for op '{active_op['operation_id']}' (serial={local_state['serial']})."
            recommended_action = "Resume verified S3 state upload via 'ops tfstate sync'."
        elif pending_info.get("pending"):
            classification = STATE_SYNC_PENDING
            message = f"Unfinished operation '{active_op['operation_id']}' conflicts with missing remote {uri}."
            recommended_action = "Inspect state and journal before retrying."
        else:
            classification = REMOTE_MISSING
            message = f"Local state exists (serial={local_state['serial']}, resources={local_state['resource_count']}) while {uri} is missing."
            recommended_action = "Verify local state or run 'ops tfstate reconcile --promote-local' if authoritative."
    else:
        assert local_state is not None and remote_state is not None
        if local_state["lineage"] != remote_state["lineage"]:
            classification = LINEAGE_MISMATCH
            message = f"Lineage mismatch: local={local_state['lineage']} != remote={remote_state['lineage']} at {uri}."
            recommended_action = "Explicitly verify authoritative state before manual recovery."
        elif local_state["serial"] == remote_state["serial"]:
            if local_state["sha256"] == remote_state["sha256"] and local_state["resource_inventory"] == remote_state["resource_inventory"]:
                classification = STATE_SYNCHRONIZED
                message = f"State synchronized at serial={local_state['serial']} (lineage={local_state['lineage']})."
            else:
                classification = SAME_SERIAL_DIFFERENT_CONTENT
                message = f"State diverged at identical serial={local_state['serial']} (checksum mismatch) against {uri}."
                recommended_action = "Inspect both state versions before explicit recovery."
        elif local_state["serial"] < remote_state["serial"]:
            classification = REMOTE_AHEAD
            message = f"Remote state {uri} (serial={remote_state['serial']}) is ahead of local (serial={local_state['serial']})."
            recommended_action = "Adopt authoritative remote state via reconciliation."
        elif proven:
            classification = STATE_SYNC_PENDING
            message = (
                f"Verified local mutation '{active_op['operation_id']}' (serial={local_state['serial']}) "
                f"is pending S3 upload to {uri} (remote serial={remote_state['serial']})."
            )
            recommended_action = "Resume verified S3 state upload via 'ops tfstate sync'."
        elif pending_info.get("pending"):
            classification = STATE_SYNC_PENDING
            message = (
                f"Pending operation '{active_op['operation_id']}' cannot prove continuity with current remote {uri} "
                f"(etag={remote_meta.get('etag') or '-'}, remote_serial={remote_state['serial']})."
            )
            recommended_action = "Inspect S3 versions and resolve conflict explicitly."
        else:
            classification = LOCAL_AHEAD
            message = (
                f"Local state (serial={local_state['serial']}) is ahead of remote {uri} "
                f"(serial={remote_state['serial']}) without operation journal proof."
            )
            recommended_action = "Run 'ops tfstate reconcile --promote-local' only after verifying local state."

    remote_lock = (
        inspect_remote_lock(bucket=bucket, state_key=key, region=region, aws_env=aws_env, run_fn=run_fn)
        if include_lock_status else None
    )
    return {
        "classification": classification,
        "local": local_state,
        "remote": remote_state,
        "remote_meta": remote_meta,
        "remote_lock": remote_lock,
        "journal_op": active_op,
        "pending_sync": bool(pending_info.get("pending")),
        "abandoned_op": bool(pending_info.get("abandoned")),
        "proven_local_mutation": proven,
        "backend": {"bucket": bucket, "key": key, "uri": uri, "region": region, "account_id": account_id},
        "workspace": ws,
        "journal_path": str(jpath),
        "message": message,
        "recommended_action": recommended_action,
    }


def reconcile_terraform_state(
    *,
    local_path: str | pathlib.Path,
    account_id: str,
    region: str,
    operation_type: str = "reconcile",
    state_key: str = "runtime/terraform.tfstate",
    workspace: str = "default",
    auto_resume_pending: bool = True,
    allow_adopt_remote: bool = False,
    allow_promote_local: bool = False,
    aws_env: Optional[Dict[str, str]] = None,
    run_fn: _RunFn = subprocess.run,
    journal_path: Optional[str | pathlib.Path] = None,
    use_remote_lock: bool = False,
    lock_held: bool = False,
    emit_fn: _EmitFn = None,
    step_id: Optional[str] = None,
    step_title: Optional[str] = None,
) -> Dict[str, Any]:
    """Inspect local/remote Terraform state and fail closed or safely reconcile divergence."""
    ws = validate_state_backend_and_workspace(local_path, state_key, workspace)
    bucket, key = tfstate_bucket_and_key(account_id, region, state_key=state_key)
    jpath = resolve_journal_path(local_path, journal_path)
    journal = TfStateJournal(jpath)

    def _run_locked() -> Dict[str, Any]:
        status = inspect_state_status(
            local_path=local_path, account_id=account_id, region=region, state_key=key,
            workspace=ws, aws_env=aws_env, run_fn=run_fn, journal_path=jpath,
        )
        cls, op, remote_meta = status["classification"], status["journal_op"], status["remote_meta"]

        if cls == STATE_SYNCHRONIZED:
            if op and op.get("sync_status") in ("STATE_SYNC_PENDING", "IN_PROGRESS"):
                journal.mark_synchronized(
                    op["operation_id"],
                    s3_version_id=remote_meta.get("version_id", ""),
                    s3_etag=remote_meta.get("etag", ""),
                    result_local=status["local"],
                )
            return {"status": "unchanged", "classification": cls, **status}

        if cls in (SAME_SERIAL_DIFFERENT_CONTENT, LINEAGE_MISMATCH):
            raise StateDivergenceError(status["message"], classification=cls)

        if cls == STATE_SYNC_PENDING:
            if not status["proven_local_mutation"]:
                raise StateSyncPendingError(status["message"], classification=STATE_SYNC_PENDING)
            if not auto_resume_pending:
                raise StateSyncPendingError(
                    f"{status['message']} Complete pending S3 synchronization before starting '{operation_type}'.",
                    classification=STATE_SYNC_PENDING,
                )
            journal.record_recovery_attempt(op["operation_id"], note=f"Resuming via {operation_type}")
            emit_state_log(emit_fn, step_id, step_title, f"Resuming verified pending S3 sync for {op['operation_id']}...")
            sync_res = sync_local_state_to_s3_verified(
                local_path=local_path, account_id=account_id, region=region, state_key=key, workspace=ws,
                expected_remote_etag=str(op.get("prev_s3_etag") or "") or None,
                expected_remote_version_id=str(op.get("prev_s3_version_id") or "") or None,
                expect_remote_missing=(status["remote"] is None),
                aws_env=aws_env, run_fn=run_fn, journal=journal, operation_id=op["operation_id"],
                emit_fn=emit_fn, step_id=step_id, step_title=step_title,
            )
            return {"status": "resumed_sync", "classification": STATE_SYNCHRONIZED, "sync": sync_res}

        if cls in (LOCAL_AHEAD, REMOTE_MISSING):
            local_st = status["local"]
            if cls == REMOTE_MISSING and local_st and local_st["serial"] == 0 and local_st["resource_count"] == 0:
                return {"status": "unchanged", "classification": cls, **status}
            if not allow_promote_local:
                raise StateDivergenceError(status["message"], classification=cls)
            prom_op = journal.start_operation(
                operation_type="reconcile_promote_local", workspace=ws,
                backend_bucket=bucket, backend_key=key, account_id=account_id, region=region,
                prev_local=local_st, prev_remote_meta=remote_meta if status["remote"] else None,
                prev_remote_state=status["remote"],
            )
            journal.record_terraform_result(prom_op["operation_id"], exit_code=0, result_local=local_st, sync_status="STATE_SYNC_PENDING")
            sync_res = sync_local_state_to_s3_verified(
                local_path=local_path, account_id=account_id, region=region, state_key=key, workspace=ws,
                expected_remote_etag=str(remote_meta.get("etag") or "") or None,
                expected_remote_version_id=str(remote_meta.get("version_id") or "") or None,
                expect_remote_missing=(status["remote"] is None), aws_env=aws_env, run_fn=run_fn,
                journal=journal, operation_id=prom_op["operation_id"], emit_fn=emit_fn, step_id=step_id, step_title=step_title,
            )
            return {"status": "promoted_local", "classification": STATE_SYNCHRONIZED, "sync": sync_res}

        if not allow_adopt_remote or status["remote"] is None:
            raise StateDivergenceError(status["message"], classification=cls)
        meta_err = _check_metadata_consistency(status["backend"]["uri"], remote_meta.get("metadata") or {}, status["remote"])
        if meta_err:
            raise StateDivergenceError(meta_err)
        adopted = adopt_remote_state_atomic(
            local_path=local_path, bucket=bucket, key=key, region=region, aws_env=aws_env, run_fn=run_fn
        )
        journal.record_reconcile_adoption(
            operation_id=make_operation_id("reconcile_adopt_remote"), workspace=ws,
            backend_bucket=bucket, backend_key=key, account_id=account_id, region=region,
            prev_local=status["local"], adopted_remote=adopted,
            s3_version_id=str(adopted.get("version_id") or remote_meta.get("version_id") or ""),
            s3_etag=str(adopted.get("etag") or remote_meta.get("etag") or ""),
        )
        emit_state_log(emit_fn, step_id, step_title, f"Adopted authoritative remote Terraform state (serial={adopted['serial']}).")
        return {"status": "adopted_remote", "classification": STATE_SYNCHRONIZED, "local": adopted}

    if lock_held:
        return _run_locked()
    lock_op_id = make_operation_id(operation_type)
    with TfStateOperationLock(
        local_path=local_path, bucket=bucket, state_key=key, region=region,
        aws_env=aws_env, run_fn=run_fn, use_remote_lock=use_remote_lock,
        operation_id=lock_op_id, operation_type=operation_type,
    ):
        return _run_locked()


def run_managed_terraform_mutation(
    *,
    operation_type: str,
    tf_commands: Sequence[Sequence[str]],
    cwd: str | pathlib.Path,
    local_path: str | pathlib.Path,
    account_id: str,
    region: str,
    state_key: str = "runtime/terraform.tfstate",
    workspace: str = "default",
    aws_env: Optional[Dict[str, str]] = None,
    exec_tf_fn: Optional[Callable[[List[str]], subprocess.CompletedProcess]] = None,
    run_fn: _RunFn = subprocess.run,
    journal_path: Optional[str | pathlib.Path] = None,
    use_remote_lock: bool = True,
    allow_adopt_remote: bool = False,
    auto_resume_pending: bool = False,
    emit_fn: _EmitFn = None,
    step_id: Optional[str] = None,
    step_title: Optional[str] = None,
) -> Dict[str, Any]:
    """Execute Terraform mutation inside an ownership-verified lock with preflight reconciliation & S3 sync."""
    ws = validate_state_backend_and_workspace(local_path, state_key, workspace)
    bucket, key = tfstate_bucket_and_key(account_id, region, state_key=state_key)
    jpath = resolve_journal_path(local_path, journal_path)
    journal = TfStateJournal(jpath)
    op_id = make_operation_id(operation_type)
    tf_exec = exec_tf_fn or (lambda cmd: subprocess.run(
        cmd, cwd=str(cwd), capture_output=True, text=True, **({"env": aws_env} if aws_env is not None else {})
    ))

    with TfStateOperationLock(
        local_path=local_path, bucket=bucket, state_key=key, region=region,
        aws_env=aws_env, run_fn=run_fn, use_remote_lock=use_remote_lock,
        operation_id=op_id, operation_type=operation_type,
    ):
        preflight = reconcile_terraform_state(
            local_path=local_path, account_id=account_id, region=region, operation_type=operation_type,
            state_key=key, workspace=ws, auto_resume_pending=auto_resume_pending,
            allow_adopt_remote=allow_adopt_remote, allow_promote_local=False,
            aws_env=aws_env, run_fn=run_fn, journal_path=jpath, lock_held=True,
            emit_fn=emit_fn, step_id=step_id, step_title=step_title,
        )
        snap = inspect_state_status(
            local_path=local_path, account_id=account_id, region=region, state_key=key,
            workspace=ws, aws_env=aws_env, run_fn=run_fn, journal_path=jpath,
        )
        prev_local, prev_remote = snap["local"], snap["remote"]
        prev_meta = snap["remote_meta"] if prev_remote is not None else None
        op = journal.start_operation(
            operation_id=op_id, operation_type=operation_type, workspace=ws, backend_bucket=bucket, backend_key=key,
            account_id=account_id, region=region, prev_local=prev_local,
            prev_remote_meta=prev_meta, prev_remote_state=prev_remote,
        )

        last_rc, tf_err = 0, ""
        try:
            for raw_cmd in tf_commands:
                res = tf_exec(list(raw_cmd))
                last_rc = int(res.returncode)
                if last_rc != 0:
                    tf_err = redact_sensitive_text((res.stderr or res.stdout or f"Command exited {last_rc}").strip())
                    raise RuntimeError(tf_err)
        except Exception as exc:
            tf_err = tf_err or redact_sensitive_text(str(exc))
            after_local = parse_and_validate_tfstate(local_path) if os.path.exists(local_path) else None
            prev_serial = prev_local["serial"] if prev_local else -1
            if after_local is not None and after_local["serial"] > prev_serial:
                journal.record_terraform_result(op_id, exit_code=last_rc or 1, result_local=after_local, sync_status="STATE_SYNC_PENDING", error=tf_err)
                try:
                    sync_local_state_to_s3_verified(
                        local_path=local_path, account_id=account_id, region=region, state_key=key,
                        workspace=ws, expected_remote_etag=(prev_meta or {}).get("etag") or None,
                        expected_remote_version_id=(prev_meta or {}).get("version_id") or None,
                        expect_remote_missing=(prev_remote is None), aws_env=aws_env, run_fn=run_fn,
                        journal=journal, operation_id=op_id, emit_fn=emit_fn, step_id=step_id, step_title=step_title,
                    )
                except Exception as sync_exc:
                    journal.mark_sync_pending(op_id, f"{tf_err} | sync error: {sync_exc}")
            else:
                journal.mark_aborted(op_id, tf_err)
            raise

        result_local = parse_and_validate_tfstate(local_path)
        journal.record_terraform_result(op_id, exit_code=0, result_local=result_local, sync_status="STATE_SYNC_PENDING")
        sync_res = sync_local_state_to_s3_verified(
            local_path=local_path, account_id=account_id, region=region, state_key=key,
            workspace=ws, expected_remote_etag=(prev_meta or {}).get("etag") or None,
            expected_remote_version_id=(prev_meta or {}).get("version_id") or None,
            expect_remote_missing=(prev_remote is None), aws_env=aws_env, run_fn=run_fn,
            journal=journal, operation_id=op_id, emit_fn=emit_fn, step_id=step_id, step_title=step_title,
        )
        return {"status": "completed", "operation_id": op_id, "preflight": preflight, "result_local": result_local, "sync": sync_res}
