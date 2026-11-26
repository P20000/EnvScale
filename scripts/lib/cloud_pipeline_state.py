"""Non-sensitive pipeline state persistence and unified execution state machine."""

from __future__ import annotations

import json
import os
import pathlib
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional, Tuple

from .cloud_identity import redact_sensitive_text
from .config import PROJECT_ROOT

STAGE_DEFINITIONS: Tuple[Tuple[str, str], ...] = (
    ("preflight", "Preflight & Identity"),
    ("foundation", "Foundation Setup (OIDC)"),
    ("secrets", "Secrets & SSM Seeding"),
    ("release", "Release Manifest & Digests"),
    ("provision", "EC2 Provision & Cloud-Init"),
    ("deploy", "App Deploy, Migrations & TLS"),
    ("verify", "Operations Health Verify"),
)
STAGE_IDS = tuple(sid for sid, _ in STAGE_DEFINITIONS)

ALLOWED_CONTEXT_KEYS = frozenset({
    "target_sha",
    "release_id",
    "manifest_path",
    "cd_run_id",
    "foundation_run_id",
    "instance_id",
    "public_ip",
    "domain",
    "app_url",
    "runtime_profile",
    "last_backup_key",
    "last_restore_key",
})

EXECUTION_PHASES: Tuple[str, ...] = (
    "IDLE",
    "PREFLIGHT",
    "PROVISIONING",
    "DEPLOYING",
    "VERIFYING",
    "RECOVERING",
    "DESTROYING",
    "SUCCEEDED",
    "FOUNDATION_NOT_INITIALIZED",
    "FAILED",
)

DEPLOY_UI_STAGES: Tuple[Tuple[str, str], ...] = (
    ("preflight", "Preflight and Prerequisites"),
    ("readiness", "Foundation and Runtime Readiness"),
    ("provision", "Infrastructure Provisioning"),
    ("deploy", "Application Deployment"),
    ("verify", "Health and HTTPS Verification"),
)


class PipelineStateStore:
    """Atomic JSON persistence for non-sensitive 7-stage pipeline progress."""

    def __init__(self, state_path: Optional[pathlib.Path] = None):
        default_path = pathlib.Path(PROJECT_ROOT) / ".envscale_test_center_logs" / "cloud_pipeline_state.json"
        self.path = pathlib.Path(state_path) if state_path else default_path

    def _default_state(self) -> Dict[str, Any]:
        return {
            "updated_at_utc": "",
            "context": {},
            "stages": {
                sid: {"title": title, "status": "pending", "updated_at_utc": "", "summary": "", "error": ""}
                for sid, title in STAGE_DEFINITIONS
            },
        }

    def load(self) -> Dict[str, Any]:
        if not self.path.is_file():
            return self._default_state()
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return self._default_state()
        base = self._default_state()
        ctx = {k: v for k, v in (raw.get("context") or {}).items() if k in ALLOWED_CONTEXT_KEYS}
        base["context"] = ctx
        base["updated_at_utc"] = raw.get("updated_at_utc", "")
        saved_stages = raw.get("stages") or {}
        for sid, title in STAGE_DEFINITIONS:
            if isinstance(saved_stages.get(sid), dict):
                entry = saved_stages[sid]
                base["stages"][sid] = {
                    "title": title,
                    "status": entry.get("status", "pending"),
                    "updated_at_utc": entry.get("updated_at_utc", ""),
                    "summary": redact_sensitive_text(str(entry.get("summary", ""))),
                    "error": redact_sensitive_text(str(entry.get("error", ""))),
                }
        return base

    def save(self, state: Dict[str, Any]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        sanitized = {
            "updated_at_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "context": {k: v for k, v in (state.get("context") or {}).items() if k in ALLOWED_CONTEXT_KEYS},
            "stages": state.get("stages") or {},
        }
        tmp = self.path.with_suffix(".tmp")
        fd = os.open(str(tmp), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(sanitized, fh, indent=2)
        tmp.replace(self.path)

    def update_stage(self, stage_id: str, status: str, summary: str = "", error: str = "") -> Dict[str, Any]:
        state = self.load()
        if stage_id in state["stages"]:
            state["stages"][stage_id]["status"] = status
            state["stages"][stage_id]["updated_at_utc"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            state["stages"][stage_id]["summary"] = redact_sensitive_text(summary)
            state["stages"][stage_id]["error"] = redact_sensitive_text(error)
        self.save(state)
        return state

    def update_context(self, **kwargs: Any) -> Dict[str, Any]:
        state = self.load()
        for k, v in kwargs.items():
            if k in ALLOWED_CONTEXT_KEYS and v is not None:
                state["context"][k] = v
        self.save(state)
        return state

    def next_incomplete_stage(self) -> Optional[str]:
        state = self.load()
        for sid in STAGE_IDS:
            if state["stages"].get(sid, {}).get("status") != "completed":
                return sid
        return None

    def reset(self) -> Dict[str, Any]:
        fresh = self._default_state()
        self.save(fresh)
        return fresh


def build_failure_info(
    *,
    failed_stage: str,
    error: str,
    rollback_attempted: bool = False,
    infrastructure_active: bool = False,
    recovery_action: str = "",
) -> Dict[str, Any]:
    """Build a sanitized, structured failure payload for unified orchestration outcomes."""
    return {
        "failed_stage": failed_stage,
        "error": redact_sensitive_text(str(error)),
        "rollback_attempted": bool(rollback_attempted),
        "infrastructure_active": bool(infrastructure_active),
        "recovery_action": redact_sensitive_text(str(recovery_action)),
    }


class ExecutionTracker:
    """Tracks execution phases, 5 high-level UI stage indicators, and structured outcomes."""

    def __init__(
        self,
        workflow: str = "deploy",
        progress_fn: Optional[Callable[[Dict[str, Any]], None]] = None,
    ):
        self.workflow = workflow
        self.phase = "IDLE"
        self.outcome = "IDLE"
        self.active_stage = ""
        self.message = ""
        self.ui_stages: Dict[str, str] = {sid: "pending" for sid, _ in DEPLOY_UI_STAGES}
        self.failure: Optional[Dict[str, Any]] = None
        self.missing_prerequisites: List[str] = []
        self.updated_at_utc = ""
        self._progress_fn = progress_fn

    def snapshot(self) -> Dict[str, Any]:
        return {
            "workflow": self.workflow,
            "phase": self.phase,
            "outcome": self.outcome,
            "stage": self.active_stage,
            "message": self.message,
            "ui_stages": dict(self.ui_stages),
            "failure": dict(self.failure) if self.failure else None,
            "missing_prerequisites": list(self.missing_prerequisites),
            "updated_at_utc": self.updated_at_utc,
        }

    def _emit(self) -> Dict[str, Any]:
        self.updated_at_utc = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        snap = self.snapshot()
        if self._progress_fn:
            self._progress_fn(snap)
        return snap

    def mark_ui_stage(self, ui_stage: Optional[str], status: str) -> Dict[str, Any]:
        if ui_stage and ui_stage in self.ui_stages:
            self.ui_stages[ui_stage] = status
        return self._emit()

    def transition(
        self,
        phase: str,
        *,
        stage: str = "",
        ui_stage: Optional[str] = None,
        ui_status: str = "running",
        message: str = "",
        outcome: Optional[str] = None,
    ) -> Dict[str, Any]:
        if phase not in EXECUTION_PHASES:
            raise ValueError(f"Unsupported execution phase '{phase}'")
        self.phase = phase
        self.outcome = outcome or phase
        if stage:
            self.active_stage = stage
        if message:
            self.message = redact_sensitive_text(message)
        if ui_stage and ui_stage in self.ui_stages:
            self.ui_stages[ui_stage] = ui_status
        return self._emit()

    def fail(
        self,
        *,
        phase: str = "FAILED",
        outcome: str = "FAILED",
        failed_stage: str,
        ui_stage: Optional[str] = None,
        error: str,
        rollback_attempted: bool = False,
        infrastructure_active: bool = False,
        recovery_action: str = "",
        missing_prerequisites: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        self.phase = phase
        self.outcome = outcome
        self.active_stage = failed_stage
        self.message = redact_sensitive_text(str(error))
        self.missing_prerequisites = list(missing_prerequisites or [])
        self.failure = build_failure_info(
            failed_stage=failed_stage,
            error=error,
            rollback_attempted=rollback_attempted,
            infrastructure_active=infrastructure_active,
            recovery_action=recovery_action,
        )
        if ui_stage and ui_stage in self.ui_stages:
            self.ui_stages[ui_stage] = "blocked" if phase == "FOUNDATION_NOT_INITIALIZED" else "failed"
        return self._emit()

    def succeed(self, *, outcome: str = "READY", message: str = "") -> Dict[str, Any]:
        self.phase = "SUCCEEDED"
        self.outcome = outcome
        self.failure = None
        self.missing_prerequisites = []
        if message:
            self.message = redact_sensitive_text(message)
        for sid in self.ui_stages:
            if self.ui_stages[sid] != "completed":
                self.ui_stages[sid] = "completed"
        return self._emit()

