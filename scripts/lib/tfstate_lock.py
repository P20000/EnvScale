"""Exclusive local flock and ownership-verified S3 .tflock guard for Terraform state operations."""

from __future__ import annotations

import fcntl
import json
import os
import pathlib
import socket
import subprocess
import tempfile
import uuid
from datetime import datetime, timezone
from typing import Any, Callable, Dict, Optional

from .cloud_config_utils import redact_sensitive_text

_RunFn = Callable[..., subprocess.CompletedProcess]
_MISSING_OBJECT_MARKERS = ("404", "not found", "nosuchkey")
_CONFLICT_MARKERS = ("preconditionfailed", "412", "already exists", "conditionalrequestconflict")


class ConcurrentStateOperationError(RuntimeError):
    """Raised when another Terraform lifecycle or state synchronization operation holds the lock."""


def _utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _aws_kw(aws_env: Optional[Dict[str, str]]) -> Dict[str, Any]:
    kw: Dict[str, Any] = {"capture_output": True, "text": True}
    if aws_env is not None:
        kw["env"] = aws_env
    return kw


def inspect_remote_lock(
    *,
    bucket: str,
    state_key: str,
    region: str,
    aws_env: Optional[Dict[str, str]] = None,
    run_fn: _RunFn = subprocess.run,
) -> Dict[str, Any]:
    """Read s3://<bucket>/<state_key>.tflock without modifying or clearing any lock."""
    lock_key = f"{state_key}.tflock"
    fd, tmp_name = tempfile.mkstemp(prefix=".tflock.insp.")
    os.close(fd)
    tmp_path = pathlib.Path(tmp_name)
    try:
        tmp_path.chmod(0o600)
        res = run_fn(
            [
                "aws", "s3api", "get-object",
                "--bucket", bucket,
                "--key", lock_key,
                "--region", region,
                str(tmp_path),
                "--output", "json",
            ],
            **_aws_kw(aws_env),
        )
        if res.returncode != 0:
            err = redact_sensitive_text((res.stderr or res.stdout or f"exit {res.returncode}").strip())
            if any(m in err.lower() for m in _MISSING_OBJECT_MARKERS):
                return {"locked": False, "lock_key": lock_key, "holder": None, "version_id": "", "etag": "", "raw": ""}
            raise RuntimeError(f"Failed inspecting remote state lock s3://{bucket}/{lock_key}: {err}")
        try:
            obj_doc = json.loads(res.stdout or "{}")
        except json.JSONDecodeError:
            obj_doc = {}
        raw_text = tmp_path.read_text(encoding="utf-8", errors="replace") if tmp_path.is_file() else ""
        try:
            parsed = json.loads(raw_text) if raw_text.strip() else None
        except json.JSONDecodeError:
            parsed = None
        holder = parsed if isinstance(parsed, dict) else None
        return {
            "locked": True,
            "lock_key": lock_key,
            "holder": holder,
            "version_id": str(obj_doc.get("VersionId") or ""),
            "etag": str(obj_doc.get("ETag") or ""),
            "raw": raw_text,
        }
    finally:
        tmp_path.unlink(missing_ok=True)


def force_release_stale_lock(
    *,
    bucket: str,
    state_key: str,
    region: str,
    expected_lock_id: str,
    reason: str,
    aws_env: Optional[Dict[str, str]] = None,
    run_fn: _RunFn = subprocess.run,
) -> Dict[str, Any]:
    """Explicit operator recovery to delete a stale .tflock only when lock_id matches."""
    lock_id = (expected_lock_id or "").strip()
    clean_reason = (reason or "").strip()
    if not lock_id:
        raise ValueError("expected_lock_id is required to release a stale remote state lock.")
    if not clean_reason:
        raise ValueError("A non-empty reason is required to release a stale remote state lock.")

    info = inspect_remote_lock(bucket=bucket, state_key=state_key, region=region, aws_env=aws_env, run_fn=run_fn)
    lock_key = info["lock_key"]
    if not info["locked"]:
        return {"status": "not_locked", "lock_key": lock_key}

    holder = info.get("holder")
    actual_id = str(holder.get("lock_id") or "") if isinstance(holder, dict) else ""
    if actual_id != lock_id:
        raise ConcurrentStateOperationError(
            f"Refusing to release s3://{bucket}/{lock_key}: active lock_id={actual_id or 'unknown'!r} "
            f"does not match expected {lock_id!r}."
        )

    del_res = run_fn(
        ["aws", "s3api", "delete-object", "--bucket", bucket, "--key", lock_key, "--region", region],
        **_aws_kw(aws_env),
    )
    if del_res.returncode != 0:
        err = redact_sensitive_text((del_res.stderr or del_res.stdout or f"exit {del_res.returncode}").strip())
        raise RuntimeError(f"Failed deleting stale remote lock s3://{bucket}/{lock_key}: {err}")
    return {
        "status": "unlocked",
        "lock_key": lock_key,
        "released_lock_id": lock_id,
        "holder": holder,
        "reason": clean_reason,
    }


class TfStateOperationLock:
    """Exclusive non-blocking local flock + ownership-verified conditional S3 .tflock guard."""

    def __init__(
        self,
        *,
        local_path: str | pathlib.Path,
        bucket: str,
        state_key: str,
        region: str,
        aws_env: Optional[Dict[str, str]] = None,
        run_fn: _RunFn = subprocess.run,
        use_remote_lock: bool = True,
        owner: str = "",
        operation_id: str = "",
        operation_type: str = "",
        lock_id: str = "",
    ):
        self.local_lock_path = pathlib.Path(local_path).with_name(".envscale_tfstate.lock")
        self.bucket = bucket
        self.state_key = state_key
        self.lock_key = f"{state_key}.tflock"
        self.region = region
        self.aws_env = aws_env
        self.run_fn = run_fn
        self.use_remote_lock = use_remote_lock
        self.lock_id = (lock_id or "").strip() or uuid.uuid4().hex
        self.operation_id = (operation_id or "").strip()
        self.operation_type = (operation_type or "").strip()
        self.hostname = socket.gethostname()
        self.pid = os.getpid()
        self.owner = owner or f"pid={self.pid}@{self.hostname}"
        self.release_warning = ""
        self._fd: Optional[int] = None
        self._remote_acquired = False

    def _payload(self) -> Dict[str, Any]:
        return {
            "lock_id": self.lock_id,
            "operation_id": self.operation_id,
            "operation_type": self.operation_type,
            "owner": self.owner,
            "pid": self.pid,
            "hostname": self.hostname,
            "state_key": self.state_key,
            "created_at_utc": _utc_now(),
        }

    def __enter__(self) -> "TfStateOperationLock":
        self.local_lock_path.parent.mkdir(parents=True, exist_ok=True)
        payload = self._payload()
        fd = os.open(str(self.local_lock_path), os.O_CREAT | os.O_RDWR, 0o600)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as exc:
            os.close(fd)
            raise ConcurrentStateOperationError(
                f"Concurrent Terraform/state operation in progress (local lock held at {self.local_lock_path})."
            ) from exc
        os.ftruncate(fd, 0)
        os.write(fd, (json.dumps(payload) + "\n").encode("utf-8"))
        os.fsync(fd)
        self._fd = fd

        if self.use_remote_lock:
            tmp_body: Optional[str] = None
            try:
                lfd, tmp_body = tempfile.mkstemp(prefix=".tflock.", dir=str(self.local_lock_path.parent))
                with os.fdopen(lfd, "w", encoding="utf-8") as fh:
                    json.dump(payload, fh)
                res = self.run_fn(
                    [
                        "aws", "s3api", "put-object",
                        "--bucket", self.bucket,
                        "--key", self.lock_key,
                        "--body", tmp_body,
                        "--server-side-encryption", "AES256",
                        "--if-none-match", "*",
                        "--region", self.region,
                        "--output", "json",
                    ],
                    **_aws_kw(self.aws_env),
                )
                if res.returncode != 0:
                    err = redact_sensitive_text((res.stderr or res.stdout or "").strip())
                    if any(m in err.lower() for m in _CONFLICT_MARKERS):
                        holder_txt = ""
                        try:
                            cur = inspect_remote_lock(
                                bucket=self.bucket, state_key=self.state_key, region=self.region,
                                aws_env=self.aws_env, run_fn=self.run_fn,
                            )
                            h = cur.get("holder") or {}
                            if isinstance(h, dict) and h:
                                holder_txt = (
                                    f" (lock_id={h.get('lock_id', '?')}, op={h.get('operation_id', '?')}, "
                                    f"pid={h.get('pid', '?')}@{h.get('hostname', '?')}, since={h.get('created_at_utc', '?')})"
                                )
                        except Exception:
                            holder_txt = ""
                        raise ConcurrentStateOperationError(
                            f"Concurrent remote operation holds S3 lock s3://{self.bucket}/{self.lock_key}{holder_txt}."
                        )
                    raise RuntimeError(f"Failed acquiring remote state lock s3://{self.bucket}/{self.lock_key}: {err}")
                self._remote_acquired = True
            except Exception:
                self._release_local()
                raise
            finally:
                if tmp_body and os.path.exists(tmp_body):
                    os.unlink(tmp_body)
        return self

    def _release_local(self) -> None:
        if self._fd is not None:
            try:
                fcntl.flock(self._fd, fcntl.LOCK_UN)
            finally:
                os.close(self._fd)
                self._fd = None

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        try:
            if self._remote_acquired:
                try:
                    cur = inspect_remote_lock(
                        bucket=self.bucket, state_key=self.state_key, region=self.region,
                        aws_env=self.aws_env, run_fn=self.run_fn,
                    )
                    holder = cur.get("holder")
                    if cur.get("locked") and isinstance(holder, dict) and holder.get("lock_id") == self.lock_id:
                        self.run_fn(
                            [
                                "aws", "s3api", "delete-object",
                                "--bucket", self.bucket,
                                "--key", self.lock_key,
                                "--region", self.region,
                            ],
                            **_aws_kw(self.aws_env),
                        )
                    elif cur.get("locked"):
                        actual_id = holder.get("lock_id") if isinstance(holder, dict) else "unreadable"
                        self.release_warning = (
                            f"Refused deleting remote lock s3://{self.bucket}/{self.lock_key}: "
                            f"owned by {actual_id!r}, expected {self.lock_id!r}."
                        )
                finally:
                    self._remote_acquired = False
        finally:
            self._release_local()

