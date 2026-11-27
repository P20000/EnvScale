"""Primary EnvScale Deployment Center GTK4/Libadwaita panel."""

from __future__ import annotations

from typing import Any, Callable, Dict, Optional

import os

import gi
gi.require_version("Gtk", "4.0")
gi.require_version("Adw", "1")
from gi.repository import Adw, GLib, Gtk

from ..browser_utils import open_browser_url
from ..cloud_identity import DEFAULT_ACCOUNT_ID, DEFAULT_REGION, redact_sensitive_text
from ..cloud_pipeline_state import DEPLOY_UI_STAGES
from ..cloud_target_sync import state_sync_ui_label
from ..config import TERRAFORM_DIR
from ..tfstate_journal import CorruptedStateJournalError, TfStateJournal, resolve_journal_path


_SYNC_BADGE_MAP = {
    "STATE_SYNC_PENDING": ("STATE SYNC PENDING", "warning"),
    "LOCAL_AHEAD": ("LOCAL STATE AHEAD", "warning"),
    "REMOTE_AHEAD": ("REMOTE STATE AHEAD", "warning"),
    "RECOVERING": ("RECOVERING", "warning"),
    "STATE_CONFLICT": ("STATE CONFLICT", "error"),
    "SAME_SERIAL_DIFFERENT_CONTENT": ("STATE CONFLICT", "error"),
    "LINEAGE_MISMATCH": ("STATE CONFLICT", "error"),
    "JOURNAL_CORRUPTED": ("STATE CONFLICT", "error"),
    "RECONCILIATION_REQUIRED": ("RECONCILIATION REQUIRED", "warning"),
    "LOCAL_MISSING": ("RECONCILIATION REQUIRED", "warning"),
    "REMOTE_MISSING": ("RECONCILIATION REQUIRED", "warning"),
}
class DemoCloudPanel(Gtk.Box):
    """Primary operator experience: Environment status, Deploy/Destroy actions, 5-stage progress, and URL."""

    def __init__(
        self,
        *,
        on_sign_in: Callable[[], None],
        on_deploy: Callable[[], None],
        on_destroy: Callable[[], None],
        on_resolve_state: Optional[Callable[[], None]] = None,
        log_fn: Optional[Callable[[str], None]] = None,
    ):
        super().__init__(orientation=Gtk.Orientation.VERTICAL, spacing=12)
        self._on_sign_in = on_sign_in
        self._on_deploy = on_deploy
        self._on_destroy = on_destroy
        self._on_resolve_state = on_resolve_state
        self._log_fn = log_fn
        self._app_url = ""
        self._busy = False
        self._stage_badges: Dict[str, Gtk.Label] = {}
        self._build_ui()

    def _build_ui(self) -> None:
        self.group = Adw.PreferencesGroup()
        self.group.set_title("EnvScale Deployment Center")
        self.group.set_description(
            "Unified deployment and teardown of the disposable EnvScale AWS environment."
        )

        self.row_env = Adw.ActionRow(
            title="Environment",
            subtitle=f"AWS {DEFAULT_ACCOUNT_ID} · {DEFAULT_REGION} · Runtime: Offline · Release: -",
        )
        self.badge_status = Gtk.Label(label="OFFLINE")
        self.badge_status.add_css_class("dim-label")
        self.row_env.add_suffix(self.badge_status)
        self.group.add(self.row_env)

        self.row_session = Adw.ActionRow(
            title="Runtime Authentication",
            subtitle="Not authenticated (prompts TOTP MFA automatically when needed)",
        )
        self.badge_session = Gtk.Label(label="SIGN-IN REQUIRED")
        self.badge_session.add_css_class("dim-label")
        self.row_session.add_suffix(self.badge_session)

        self.btn_sign_in = Gtk.Button(label="Authenticate MFA")
        self.btn_sign_in.connect("clicked", lambda _: self._on_sign_in())
        self.row_session.add_suffix(self.btn_sign_in)
        self.group.add(self.row_session)

        self.row_endpoint = Adw.ActionRow(
            title="Application Endpoint",
            subtitle="Available after health verification",
        )
        self.btn_open_url = Gtk.Button(label="Open Application")
        self.btn_open_url.set_sensitive(False)
        self.btn_open_url.connect(
            "clicked",
            lambda _: open_browser_url(self._app_url, log_fn=self._log_fn) if self._app_url else None,
        )
        self.row_endpoint.add_suffix(self.btn_open_url)
        self.group.add(self.row_endpoint)
        self.append(self.group)

        action_bar = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=10)
        self.btn_deploy = Gtk.Button(label="Deploy Environment")
        self.btn_deploy.add_css_class("suggested-action")
        self.btn_deploy.connect("clicked", lambda _: self._on_deploy())

        self.btn_destroy = Gtk.Button(label="Destroy Environment")
        self.btn_destroy.add_css_class("destructive-action")
        self.btn_destroy.connect("clicked", lambda _: self._on_destroy())

        action_bar.append(self.btn_deploy)
        action_bar.append(self.btn_destroy)
        self.append(action_bar)

        self.exec_group = Adw.PreferencesGroup()
        self.exec_group.set_title("Deployment Execution")
        self.exec_group.set_description("Internal orchestration stages (automated; no manual operator controls).")
        for idx, (sid, title) in enumerate(DEPLOY_UI_STAGES, start=1):
            row = Adw.ActionRow(title=f"{idx}. {title}")
            badge = Gtk.Label(label="PENDING")
            badge.add_css_class("dim-label")
            row.add_suffix(badge)
            self._stage_badges[sid] = badge
            self.exec_group.add(row)

        self.row_result = Adw.ActionRow(
            title="Pipeline Result",
            subtitle="Idle — click Deploy Environment to provision and verify",
        )
        self.btn_resolve_state = Gtk.Button(label="Inspect & Resolve State")
        self.btn_resolve_state.add_css_class("suggested-action")
        self.btn_resolve_state.set_visible(False)
        self.btn_resolve_state.connect("clicked", lambda _: self._on_resolve_state() if self._on_resolve_state else None)
        self.row_result.add_suffix(self.btn_resolve_state)
        self.exec_group.add(self.row_result)
        self.row_status = self.row_result
        self.append(self.exec_group)

    def _set_badge(self, badge: Gtk.Label, text: str, style: str) -> None:
        for cls in ("success", "error", "warning", "accent", "dim-label"):
            badge.remove_css_class(cls)
        badge.set_text(text)
        badge.add_css_class(style)

    def _apply_ui_stages(self, ui_stages: Dict[str, str]) -> None:
        style_map = {
            "completed": ("DONE", "success"),
            "running": ("RUNNING", "accent"),
            "blocked": ("BLOCKED", "warning"),
            "failed": ("FAILED", "error"),
            "pending": ("PENDING", "dim-label"),
        }
        for sid, badge in self._stage_badges.items():
            st = ui_stages.get(sid, "pending")
            text, css = style_map.get(st, (st.upper(), "dim-label"))
            self._set_badge(badge, text, css)

    def set_busy(self, busy: bool, status_text: Optional[str] = None) -> None:
        self._busy = busy

        def _apply():
            for w in (self.btn_sign_in, self.btn_deploy, self.btn_destroy):
                w.set_sensitive(not busy)
            if status_text:
                self.row_result.set_subtitle(GLib.markup_escape_text(redact_sensitive_text(status_text)[:200], -1))
                self._set_badge(self.badge_status, "RUNNING" if busy else "OFFLINE", "accent" if busy else "dim-label")

        GLib.idle_add(_apply)

    def update_progress(self, status_text: str) -> None:
        safe = redact_sensitive_text(status_text)[:200]

        def _apply():
            if self._busy:
                self.row_result.set_subtitle(GLib.markup_escape_text(safe, -1))

        GLib.idle_add(_apply)

    def apply_progress_event(self, event: Dict[str, Any]) -> None:
        phase = str(event.get("phase") or "IDLE")
        msg = redact_sensitive_text(str(event.get("message") or ""))[:220]
        ui_stages = dict(event.get("ui_stages") or {})
        badge_map = {
            "PREFLIGHT": ("PREFLIGHT", "accent"),
            "PROVISIONING": ("PROVISIONING", "accent"),
            "DEPLOYING": ("DEPLOYING", "accent"),
            "VERIFYING": ("VERIFYING", "accent"),
            "RECOVERING": ("RECOVERING", "warning"),
            "DESTROYING": ("DESTROYING", "warning"),
            "SUCCEEDED": ("READY" if event.get("workflow") != "destroy" else "DESTROYED", "success"),
            "FOUNDATION_NOT_INITIALIZED": ("FOUNDATION NOT INITIALIZED", "warning"),
            "STATE_SYNC_PENDING": ("STATE SYNC PENDING", "warning"),
            "FAILED": ("FAILED", "error"),
            "IDLE": ("OFFLINE", "dim-label"),
        }
        b_text, b_style = badge_map.get(phase, (phase, "accent"))

        def _apply():
            self._set_badge(self.badge_status, b_text, b_style)
            if msg:
                self.row_result.set_subtitle(GLib.markup_escape_text(msg, -1))
            if ui_stages and event.get("workflow") == "deploy":
                self._apply_ui_stages(ui_stages)

        GLib.idle_add(_apply)

    def set_result(
        self,
        ok: bool,
        headline: str,
        detail: str,
        app_url: str = "",
        *,
        badge_text: Optional[str] = None,
        badge_style: Optional[str] = None,
    ) -> None:
        safe_head = redact_sensitive_text(headline)[:180]
        safe_det = redact_sensitive_text(detail)[:240]
        clean_url = (app_url or "").strip()
        b_text = badge_text or ("READY" if ok else "FAILED")
        b_style = badge_style or ("success" if ok else "error")

        def _apply():
            self._app_url = clean_url
            self.btn_open_url.set_sensitive(bool(clean_url))
            self.row_endpoint.set_subtitle(GLib.markup_escape_text(clean_url or "Available after health verification", -1))
            self._set_badge(self.badge_status, b_text, b_style)
            self.row_result.set_subtitle(GLib.markup_escape_text(f"{safe_head}: {safe_det}" if safe_det else safe_head, -1))

        GLib.idle_add(_apply)

    def apply_final_result(self, res: Dict[str, Any], *, workflow: str = "deploy") -> None:
        status = str(res.get("status") or "FAILED")
        if status == "SUCCEEDED" and workflow == "deploy":
            app_url = str(res.get("app_url") or "")
            inst = str(res.get("instance_id") or "-")
            rel = str(res.get("release_id") or "-")
            self.set_result(True, "READY", f"Instance {inst} | Release {rel}", app_url=app_url, badge_text="READY", badge_style="success")
            return
        if status == "SUCCEEDED" and workflow == "destroy":
            bkp = res.get("backup") or {}
            cln = res.get("cleanup") or {}
            sha = str(bkp.get("sha256") or "")[:12]
            self.set_result(
                True,
                "DESTROYED",
                f"Backup {bkp.get('key', '-')} (sha256={sha}...) | Remaining resources: {cln.get('remaining_resources', 0)}",
                app_url="",
                badge_text="DESTROYED",
                badge_style="success",
            )
            return

        failure = res.get("failure") or {}
        err = str(failure.get("error") or res.get("error") or "Operation failed")
        rec = str(failure.get("recovery_action") or "")
        if status == "FOUNDATION_NOT_INITIALIZED":
            self.set_result(
                False,
                "Blocked — Foundation not initialized",
                f"{err} {rec}".strip(),
                badge_text="FOUNDATION NOT INITIALIZED",
                badge_style="warning",
            )
            return
        if status == "STATE_SYNC_PENDING":
            GLib.idle_add(lambda: self.btn_resolve_state.set_visible(True))
            self.set_result(
                False,
                "Blocked — S3 state synchronization pending",
                f"{err} {rec}".strip(),
                badge_text="STATE SYNC PENDING",
                badge_style="warning",
            )
            return
        sync_code = str(((res.get("state") or {}).get("context") or {}).get("state_sync_status") or "")
        if res.get("outcome") == "BLOCKED" and sync_code and sync_code != "STATE_SYNCHRONIZED":
            b_txt, b_css = _SYNC_BADGE_MAP.get(sync_code, ("RECONCILIATION REQUIRED", "warning"))
            GLib.idle_add(lambda: self.btn_resolve_state.set_visible(True))
            self.set_result(
                False,
                f"Blocked — {state_sync_ui_label(sync_code)}",
                f"{err} {rec}".strip(),
                badge_text=b_txt,
                badge_style=b_css,
            )
            return
        f_stage = str(failure.get("failed_stage") or "unknown")
        rb = "yes" if failure.get("rollback_attempted") else "no"
        inf = "active" if failure.get("infrastructure_active") else "inactive"
        self.set_result(
            False,
            f"Failed at stage '{f_stage}' (rollback={rb}, infra={inf})",
            f"{err} | Next: {rec}".strip(),
            badge_text="FAILED",
            badge_style="error",
        )

    def refresh_from_orchestrator(self, orchestrator) -> None:
        sess = orchestrator.runtime_session
        sess_ok = bool(sess and not sess.is_expired())
        state = orchestrator.state_store.load()
        ctx = state.get("context", {})
        app_url = str(ctx.get("app_url") or "").strip()
        instance_id = str(ctx.get("instance_id") or "").strip()
        release_id = str(ctx.get("release_id") or "").strip() or "-"
        last_backup = str(ctx.get("last_backup_key") or "").strip()
        runtime_lbl = f"Online ({instance_id})" if instance_id else "Offline"
        tf_p = os.path.join(TERRAFORM_DIR, "terraform.tfstate")
        sync_reason = ""
        try:
            pending_sync = TfStateJournal(resolve_journal_path(tf_p)).inspect_local_pending_sync(tf_p)
            if pending_sync.get("pending"):
                sync_code = "STATE_SYNC_PENDING"
                sync_reason = str(pending_sync.get("reason") or "")
            else:
                sync_code = str(ctx.get("state_sync_status") or "STATE_SYNCHRONIZED")
        except CorruptedStateJournalError as exc:
            sync_code = "JOURNAL_CORRUPTED"
            sync_reason = str(exc)
        sync_label = state_sync_ui_label(sync_code)

        def _apply():
            self.row_env.set_subtitle(
                GLib.markup_escape_text(
                    f"AWS {DEFAULT_ACCOUNT_ID} · {DEFAULT_REGION} · Runtime: {runtime_lbl} · State: {sync_label} · Release: {release_id}", -1
                )
            )
            if sess_ok and sess:
                self.row_session.set_subtitle(
                    GLib.markup_escape_text(f"Signed in as Runtime Provisioner until {sess.expires_at_utc[:19]} UTC", -1)
                )
                self._set_badge(self.badge_session, "SIGNED IN", "success")
                self.btn_sign_in.set_label("Refresh MFA")
            else:
                self.row_session.set_subtitle("Not authenticated (prompts TOTP MFA automatically when needed)")
                self._set_badge(self.badge_session, "SIGN-IN REQUIRED", "dim-label")
                self.btn_sign_in.set_label("Authenticate MFA")

            self._app_url = app_url
            self.btn_open_url.set_sensitive(bool(app_url))
            self.row_endpoint.set_subtitle(GLib.markup_escape_text(app_url or "Available after health verification", -1))
            self.btn_resolve_state.set_visible(sync_code != "STATE_SYNCHRONIZED")
            if not self._busy:
                if sync_code != "STATE_SYNCHRONIZED":
                    b_txt, b_css = _SYNC_BADGE_MAP.get(sync_code, ("RECONCILIATION REQUIRED", "warning"))
                    self._set_badge(self.badge_status, b_txt, b_css)
                    det = sync_reason or f"State status: {sync_label}. Click Inspect & Resolve State for recovery steps."
                    self.row_result.set_subtitle(GLib.markup_escape_text(det, -1))
                elif self.badge_status.get_text() in ("OFFLINE", "READY", "DESTROYED", "STATE SYNC PENDING", "STATE CONFLICT", "RECONCILIATION REQUIRED", "LOCAL STATE AHEAD", "REMOTE STATE AHEAD"):
                    if app_url and instance_id:
                        self._set_badge(self.badge_status, "READY", "success")
                    elif last_backup and not instance_id and self.badge_status.get_text() == "OFFLINE":
                        self.row_result.set_subtitle(GLib.markup_escape_text(f"Environment offline | Last verified backup: {last_backup}", -1))

        GLib.idle_add(_apply)
