"""DuckDNS, GitHub target secret synchronization, and TLS propagation classification helpers."""

from __future__ import annotations

import shutil
import subprocess
import urllib.request
from typing import Callable, Dict, List, Optional

STATE_SYNC_UI_LABELS: Dict[str, str] = {
    "STATE_SYNCHRONIZED": "Synchronized",
    "STATE_SYNC_PENDING": "Synchronization pending",
    "RECONCILIATION_REQUIRED": "Reconciliation required",
    "LOCAL_MISSING": "Reconciliation required",
    "REMOTE_MISSING": "Reconciliation required",
    "REMOTE_AHEAD": "Remote state ahead",
    "LOCAL_AHEAD": "Local state ahead",
    "STATE_CONFLICT": "State conflict",
    "SAME_SERIAL_DIFFERENT_CONTENT": "State conflict",
    "LINEAGE_MISMATCH": "State conflict",
    "JOURNAL_CORRUPTED": "State conflict",
    "RECOVERING": "Recovery in progress",
}


def state_sync_ui_label(status_code: str) -> str:
    """Map an internal state sync classification to an operator-facing UI status label."""
    code = (status_code or "").strip().upper() or "STATE_SYNCHRONIZED"
    return STATE_SYNC_UI_LABELS.get(code, "Reconciliation required")


def infer_state_sync_status_from_error(exc: Exception) -> str:
    """Classify a state exception into a persisted UI state_sync_status code."""
    cname = type(exc).__name__
    msg = str(exc).lower()
    if "CorruptedStateJournal" in cname or "corrupt" in msg:
        return "JOURNAL_CORRUPTED"
    if "StateSyncPending" in cname or "state_sync_pending" in msg:
        return "STATE_SYNC_PENDING"
    if "ConcurrentStateOperation" in cname:
        return "RECONCILIATION_REQUIRED"
    if "lineage" in msg or "same_serial" in msg or "diverged" in msg or "checksum" in msg or "workspace" in msg:
        return "STATE_CONFLICT"
    if "remote" in msg and "ahead" in msg:
        return "REMOTE_AHEAD"
    if "local" in msg and "ahead" in msg:
        return "LOCAL_AHEAD"
    return "RECONCILIATION_REQUIRED"


def is_tls_propagation_error(errors: List[str]) -> bool:
    """Return True only for transient initial TLS propagation/handshake errors, never permanent cert/app errors."""
    if not errors:
        return False
    hard = (
        "returned unexpected status", "returned error status", "returned unexpected code",
        "health payload invalid", "has expired", "expired", "hostname mismatch",
        "doesn't match", "self-signed", "self signed", "unknown ca", "revoked",
    )
    lower_errs = [err.lower() for err in errors]
    if any(any(m in e for m in hard) for e in lower_errs):
        return False
    tls = (
        "ssl/tls", "certificate_verify_failed", "tlsv1_alert_internal_error",
        "tlsv1 alert internal error", "handshake", "eof occurred in violation of protocol", "certificate",
    )
    return any(any(m in e for m in tls) for e in lower_errs)


def sync_duckdns_record(
    target_ip: str,
    domain: str,
    token: str,
    *,
    emit_step: Callable[[str, str, str, str], None],
    log_fn: Callable[[str], None],
    step_id: Optional[str] = None,
    step_title: Optional[str] = None,
) -> bool:
    """Update DuckDNS A record for target_ip; returns False if token unset or update fails."""
    if not token:
        msg = f"Notice: DUCKDNS_TOKEN not set; skipping DuckDNS DNS record synchronization. Zero-config HTTPS will use https://{target_ip}.sslip.io."
        if step_id and step_title:
            emit_step(step_id, step_title, "log", msg)
        else:
            log_fn(msg)
        return False
    url = f"https://www.duckdns.org/update?domains={domain}&token={token}&ip={target_ip}"
    if step_id and step_title:
        emit_step(step_id, step_title, "log", f"Updating DuckDNS record: {domain}.duckdns.org -> {target_ip}...")
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "EnvScale-TestCenter/1.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            content = resp.read().decode("utf-8").strip()
            if content == "OK":
                if step_id and step_title:
                    emit_step(step_id, step_title, "log", f"DuckDNS record updated to {target_ip} (OK).")
                return True
            if step_id and step_title:
                emit_step(step_id, step_title, "log", f"DuckDNS response: {content}")
            return False
    except Exception as exc:
        if step_id and step_title:
            emit_step(step_id, step_title, "log", f"DuckDNS update request failed: {exc}")
        return False


def sync_github_target_secrets(
    ip: str,
    instance_id: Optional[str],
    *,
    run_cmd: Callable[..., subprocess.CompletedProcess],
    emit_step: Callable[[str, str, str, str], None],
    step_id: Optional[str] = None,
    step_title: Optional[str] = None,
) -> None:
    """Sync non-SSH host target secrets (EC2_HOST, EC2_INSTANCE_ID) to GitHub."""
    if shutil.which("gh"):
        auth_check = subprocess.run(["gh", "auth", "status"], capture_output=True)
        if auth_check.returncode == 0:
            if step_id and step_title:
                emit_step(step_id, step_title, "log", f"Synchronizing EC2_HOST ({ip}) to GitHub Secrets...")
            run_cmd(["gh", "secret", "set", "EC2_HOST", "--body", ip], step_id=step_id, step_title=step_title)
            if instance_id:
                run_cmd(["gh", "secret", "set", "EC2_INSTANCE_ID", "--body", instance_id], step_id=step_id, step_title=step_title)
            if step_id and step_title:
                emit_step(step_id, step_title, "log", "GitHub Actions secrets updated successfully.")
            return
    if step_id and step_title:
        emit_step(step_id, step_title, "log", "GitHub CLI not authenticated; remember to update EC2_HOST/EC2_INSTANCE_ID secrets manually.")

