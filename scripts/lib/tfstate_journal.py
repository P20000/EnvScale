"""Durable atomic Terraform operation journal (fails closed on corruption)."""

from __future__ import annotations

import errno
import json
import os
import pathlib
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from .cloud_config_utils import redact_sensitive_text
from .config import PROJECT_ROOT, TERRAFORM_DIR, TERRAFORM_EKS_DIR
from .tfstate_lock import (
    ConcurrentStateOperationError,
    TfStateOperationLock,
    force_release_stale_lock,
    inspect_remote_lock,
)

DEFAULT_JOURNAL_PATH = pathlib.Path(PROJECT_ROOT) / ".envscale_test_center_logs" / "tfstate_operations.json"
DEFAULT_EKS_JOURNAL_PATH = pathlib.Path(PROJECT_ROOT) / ".envscale_test_center_logs" / "tfstate_eks_operations.json"
_MAX_HISTORY = 25

__all__ = [
    "ConcurrentStateOperationError",
    "CorruptedStateJournalError",
    "DEFAULT_EKS_JOURNAL_PATH",
    "DEFAULT_JOURNAL_PATH",
    "TfStateJournal",
    "TfStateOperationLock",
    "force_release_stale_lock",
    "inspect_remote_lock",
    "make_operation_id",
    "resolve_journal_path",
]


class CorruptedStateJournalError(RuntimeError):
    """Raised when an existing Terraform operation journal is unreadable, malformed, or schema-invalid."""


def _utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def make_operation_id(operation_type: str) -> str:
    return f"{operation_type}-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}-{uuid.uuid4().hex[:8]}"


def resolve_journal_path(
    local_path: str | pathlib.Path,
    journal_path: Optional[str | pathlib.Path] = None,
) -> pathlib.Path:
    """Resolve isolated journal path: canonical log file for repo dirs, sidecar for sandboxes."""
    if journal_path is not None:
        return pathlib.Path(journal_path)
    abs_local = os.path.abspath(str(local_path))
    if abs_local == os.path.abspath(os.path.join(TERRAFORM_DIR, "terraform.tfstate")):
        return DEFAULT_JOURNAL_PATH
    if abs_local == os.path.abspath(os.path.join(TERRAFORM_EKS_DIR, "terraform.tfstate")):
        return DEFAULT_EKS_JOURNAL_PATH
    return pathlib.Path(local_path).with_name(".envscale_tfstate_operations.json")


def _fsync_dir(dir_path: pathlib.Path) -> None:
    try:
        dir_fd = os.open(str(dir_path), os.O_RDONLY)
    except OSError:
        return
    try:
        os.fsync(dir_fd)
    except OSError as exc:
        if exc.errno not in (errno.EINVAL, errno.EBADF):
            raise
    finally:
        os.close(dir_fd)


class TfStateJournal:
    """Atomic 0600 JSON journal tracking active and completed Terraform state mutations."""

    def __init__(self, journal_path: str | pathlib.Path = DEFAULT_JOURNAL_PATH):
        self.path = pathlib.Path(journal_path)

    def _empty(self) -> Dict[str, Any]:
        return {"active_operation": None, "history": []}

    def load(self) -> Dict[str, Any]:
        if not self.path.exists():
            return self._empty()
        if not self.path.is_file():
            raise CorruptedStateJournalError(f"Terraform state journal path is not a regular file: {self.path}")
        try:
            raw_text = self.path.read_text(encoding="utf-8")
            raw = json.loads(raw_text)
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise CorruptedStateJournalError(
                f"Terraform state journal is corrupted or unreadable at {self.path}: {exc}. "
                "Resolve or reconcile explicitly before proceeding."
            ) from exc
        if not isinstance(raw, dict):
            raise CorruptedStateJournalError(
                f"Terraform state journal at {self.path} has invalid root type (expected JSON object)."
            )
        active = raw.get("active_operation")
        if active is not None and (not isinstance(active, dict) or not str(active.get("operation_id") or "").strip()):
            raise CorruptedStateJournalError(
                f"Terraform state journal at {self.path} contains an invalid active_operation record."
            )
        hist = raw.get("history")
        if hist is not None and (not isinstance(hist, list) or any(not isinstance(h, dict) for h in hist)):
            raise CorruptedStateJournalError(
                f"Terraform state journal at {self.path} contains a malformed history list."
            )
        return {"active_operation": active, "history": list(hist or [])[-_MAX_HISTORY:]}

    def save(self, data: Dict[str, Any]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        try:
            os.chmod(self.path.parent, 0o700)
        except OSError:
            pass
        payload = {
            "active_operation": data.get("active_operation"),
            "history": list(data.get("history") or [])[-_MAX_HISTORY:],
        }
        tmp = self.path.with_name(f".{self.path.name}.{os.getpid()}.{uuid.uuid4().hex[:6]}.tmp")
        fd = os.open(str(tmp), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                json.dump(payload, fh, indent=2)
                fh.flush()
                os.fsync(fh.fileno())
            tmp.replace(self.path)
            _fsync_dir(self.path.parent)
        except Exception:
            tmp.unlink(missing_ok=True)
            raise

    def get_active_operation(self) -> Optional[Dict[str, Any]]:
        return self.load().get("active_operation")

    def start_operation(
        self,
        *,
        operation_type: str,
        workspace: str,
        backend_bucket: str,
        backend_key: str,
        account_id: str,
        region: str,
        prev_local: Optional[Dict[str, Any]],
        prev_remote_meta: Optional[Dict[str, Any]],
        prev_remote_state: Optional[Dict[str, Any]] = None,
        operation_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        op_id = (operation_id or "").strip() or make_operation_id(operation_type)
        prev_src = prev_local or prev_remote_state or {}
        op: Dict[str, Any] = {
            "operation_id": op_id,
            "operation_type": operation_type,
            "workspace": workspace,
            "backend_bucket": backend_bucket,
            "backend_key": backend_key,
            "account_id": account_id,
            "region": region,
            "started_at_utc": _utc_now(),
            "completed_at_utc": "",
            "prev_lineage": prev_src.get("lineage", ""),
            "prev_serial": prev_src.get("serial"),
            "prev_sha256": prev_src.get("sha256", ""),
            "prev_resource_count": prev_src.get("resource_count"),
            "prev_resource_inventory": list(prev_src.get("resource_inventory") or []),
            "prev_s3_version_id": (prev_remote_meta or {}).get("version_id", ""),
            "prev_s3_etag": (prev_remote_meta or {}).get("etag", ""),
            "result_lineage": "",
            "result_serial": None,
            "result_sha256": "",
            "result_resource_count": None,
            "result_resource_inventory": [],
            "terraform_exit_code": None,
            "sync_status": "IN_PROGRESS",
            "s3_version_id": "",
            "s3_etag": "",
            "recovery_attempts": 0,
            "last_recovery_at_utc": "",
            "error": "",
        }
        doc = self.load()
        doc["active_operation"] = op
        self.save(doc)
        return op

    def record_terraform_result(
        self,
        operation_id: str,
        *,
        exit_code: int,
        result_local: Optional[Dict[str, Any]],
        sync_status: str,
        error: str = "",
    ) -> Dict[str, Any]:
        doc = self.load()
        op = doc.get("active_operation")
        if not op or op.get("operation_id") != operation_id:
            raise RuntimeError(f"Journal active operation mismatch for '{operation_id}'.")
        op["terraform_exit_code"] = int(exit_code)
        if result_local:
            op["result_lineage"] = result_local.get("lineage", "")
            op["result_serial"] = result_local.get("serial")
            op["result_sha256"] = result_local.get("sha256", "")
            op["result_resource_count"] = result_local.get("resource_count")
            op["result_resource_inventory"] = list(result_local.get("resource_inventory") or [])
        op["sync_status"] = sync_status
        op["error"] = redact_sensitive_text(error)
        doc["active_operation"] = op
        self.save(doc)
        return op

    def record_recovery_attempt(self, operation_id: str, note: str = "") -> Optional[Dict[str, Any]]:
        doc = self.load()
        op = doc.get("active_operation")
        if not op or op.get("operation_id") != operation_id:
            return None
        op["recovery_attempts"] = int(op.get("recovery_attempts") or 0) + 1
        op["last_recovery_at_utc"] = _utc_now()
        if note:
            op["error"] = redact_sensitive_text(note)
        doc["active_operation"] = op
        self.save(doc)
        return op

    def mark_sync_pending(self, operation_id: str, error: str) -> Optional[Dict[str, Any]]:
        doc = self.load()
        op = doc.get("active_operation")
        if not op or op.get("operation_id") != operation_id:
            return None
        op["sync_status"] = "STATE_SYNC_PENDING"
        op["error"] = redact_sensitive_text(error)
        doc["active_operation"] = op
        self.save(doc)
        return op

    def mark_synchronized(
        self,
        operation_id: str,
        *,
        s3_version_id: str = "",
        s3_etag: str = "",
        result_local: Optional[Dict[str, Any]] = None,
    ) -> Optional[Dict[str, Any]]:
        doc = self.load()
        op = doc.get("active_operation")
        if not op or op.get("operation_id") != operation_id:
            return None
        if result_local:
            op["result_lineage"] = result_local.get("lineage", op.get("result_lineage", ""))
            op["result_serial"] = result_local.get("serial", op.get("result_serial"))
            op["result_sha256"] = result_local.get("sha256", op.get("result_sha256", ""))
            op["result_resource_count"] = result_local.get("resource_count", op.get("result_resource_count"))
            op["result_resource_inventory"] = list(
                result_local.get("resource_inventory")
                if result_local.get("resource_inventory") is not None
                else (op.get("result_resource_inventory") or [])
            )
        op["sync_status"] = "SYNCHRONIZED"
        op["s3_version_id"] = s3_version_id
        op["s3_etag"] = s3_etag
        op["error"] = ""
        op["completed_at_utc"] = _utc_now()
        doc["history"] = (doc.get("history") or []) + [op]
        doc["active_operation"] = None
        self.save(doc)
        return op

    def mark_aborted(self, operation_id: str, error: str) -> Optional[Dict[str, Any]]:
        doc = self.load()
        op = doc.get("active_operation")
        if not op or op.get("operation_id") != operation_id:
            return None
        op["sync_status"] = "FAILED"
        op["error"] = redact_sensitive_text(error)
        op["completed_at_utc"] = _utc_now()
        doc["history"] = (doc.get("history") or []) + [op]
        doc["active_operation"] = None
        self.save(doc)
        return op

    def record_reconcile_adoption(
        self,
        *,
        operation_id: str,
        workspace: str,
        backend_bucket: str,
        backend_key: str,
        account_id: str,
        region: str,
        prev_local: Optional[Dict[str, Any]],
        adopted_remote: Dict[str, Any],
        s3_version_id: str = "",
        s3_etag: str = "",
    ) -> Dict[str, Any]:
        doc = self.load()
        prev_src = prev_local or {}
        entry = {
            "operation_id": operation_id,
            "operation_type": "reconcile_adopt_remote",
            "workspace": workspace,
            "backend_bucket": backend_bucket,
            "backend_key": backend_key,
            "account_id": account_id,
            "region": region,
            "started_at_utc": _utc_now(),
            "completed_at_utc": _utc_now(),
            "prev_lineage": prev_src.get("lineage", ""),
            "prev_serial": prev_src.get("serial"),
            "prev_sha256": prev_src.get("sha256", ""),
            "prev_resource_count": prev_src.get("resource_count"),
            "prev_resource_inventory": list(prev_src.get("resource_inventory") or []),
            "prev_s3_version_id": s3_version_id,
            "prev_s3_etag": s3_etag,
            "result_lineage": adopted_remote.get("lineage", ""),
            "result_serial": adopted_remote.get("serial"),
            "result_sha256": adopted_remote.get("sha256", ""),
            "result_resource_count": adopted_remote.get("resource_count"),
            "result_resource_inventory": list(adopted_remote.get("resource_inventory") or []),
            "terraform_exit_code": None,
            "sync_status": "SYNCHRONIZED",
            "s3_version_id": s3_version_id,
            "s3_etag": s3_etag,
            "recovery_attempts": 1,
            "last_recovery_at_utc": _utc_now(),
            "error": "",
        }
        doc["history"] = (doc.get("history") or []) + [entry]
        self.save(doc)
        return entry

    def inspect_local_pending_sync(self, local_path: str | pathlib.Path) -> Dict[str, Any]:
        """Offline check for unfinished/abandoned state sync; propagates CorruptedStateJournalError."""
        op = self.get_active_operation()
        if not op:
            return {"pending": False, "abandoned": False, "operation": None, "status": "NONE", "reason": ""}
        sync_st = str(op.get("sync_status") or "")
        tf_rc = op.get("terraform_exit_code")
        abandoned = sync_st == "IN_PROGRESS" and tf_rc is None
        is_pending = sync_st in ("STATE_SYNC_PENDING", "IN_PROGRESS")
        if not is_pending:
            return {"pending": False, "abandoned": False, "operation": op, "status": sync_st or "IN_PROGRESS", "reason": op.get("error", "")}
        default_msg = (
            f"Abandoned in-progress operation {op.get('operation_type')} ({op.get('operation_id')})."
            if abandoned
            else f"Unfinished S3 state sync from {op.get('operation_type')} ({op.get('operation_id')})."
        )
        return {
            "pending": True,
            "abandoned": abandoned,
            "operation": op,
            "status": "STATE_SYNC_PENDING",
            "local_path": str(local_path),
            "reason": op.get("error") or default_msg,
        }
