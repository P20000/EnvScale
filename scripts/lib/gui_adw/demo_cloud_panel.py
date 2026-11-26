"""Demo-first GTK4/Libadwaita panel for one-click Deploy Demo and Destroy Demo."""

from __future__ import annotations

from typing import Callable, Optional

import gi
gi.require_version("Gtk", "4.0")
gi.require_version("Adw", "1")
from gi.repository import Adw, GLib, Gtk

from ..browser_utils import open_browser_url
from ..cloud_identity import redact_sensitive_text


class DemoCloudPanel(Gtk.Box):
    """Primary live-demonstration controls: single STS session, Deploy Demo, Destroy Demo, and result card."""

    def __init__(
        self,
        *,
        on_sign_in: Callable[[], None],
        on_deploy: Callable[[], None],
        on_destroy: Callable[[], None],
        log_fn: Optional[Callable[[str], None]] = None,
    ):
        super().__init__(orientation=Gtk.Orientation.VERTICAL, spacing=10)
        self._on_sign_in = on_sign_in
        self._on_deploy = on_deploy
        self._on_destroy = on_destroy
        self._log_fn = log_fn
        self._app_url = ""
        self._busy = False
        self._build_ui()

    def _build_ui(self) -> None:
        self.group = Adw.PreferencesGroup()
        self.group.set_title("Live Demo Control")
        self.group.set_description(
            "One-click Deploy and Destroy for the disposable EnvScale AWS demo environment."
        )

        self.row_session = Adw.ActionRow(
            title="AWS Demo Session",
            subtitle="Runtime Provisioner STS session not active (1 TOTP MFA prompt when starting)",
        )
        self.badge_session = Gtk.Label(label="SIGN-IN REQUIRED")
        self.badge_session.add_css_class("dim-label")
        self.row_session.add_suffix(self.badge_session)

        self.btn_sign_in = Gtk.Button(label="Sign In (MFA)")
        self.btn_sign_in.connect("clicked", lambda _: self._on_sign_in())
        self.row_session.add_suffix(self.btn_sign_in)
        self.group.add(self.row_session)

        self.row_status = Adw.ActionRow(title="Demo Status", subtitle="Ready to deploy")
        self.badge_status = Gtk.Label(label="IDLE")
        self.badge_status.add_css_class("dim-label")
        self.row_status.add_suffix(self.badge_status)
        self.group.add(self.row_status)

        self.row_result = Adw.ActionRow(
            title="Environment and Verification Result",
            subtitle="No active demo environment recorded yet",
        )
        self.btn_open_url = Gtk.Button(label="Open Application")
        self.btn_open_url.set_sensitive(False)
        self.btn_open_url.connect(
            "clicked",
            lambda _: open_browser_url(self._app_url, log_fn=self._log_fn) if self._app_url else None,
        )
        self.row_result.add_suffix(self.btn_open_url)
        self.group.add(self.row_result)
        self.append(self.group)

        action_bar = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=10)
        self.btn_deploy = Gtk.Button(label="Deploy Demo")
        self.btn_deploy.add_css_class("suggested-action")
        self.btn_deploy.connect("clicked", lambda _: self._on_deploy())

        self.btn_destroy = Gtk.Button(label="Destroy Demo")
        self.btn_destroy.add_css_class("destructive-action")
        self.btn_destroy.connect("clicked", lambda _: self._on_destroy())

        action_bar.append(self.btn_deploy)
        action_bar.append(self.btn_destroy)
        self.append(action_bar)

    def _set_badge(self, badge: Gtk.Label, text: str, style: str) -> None:
        for cls in ("success", "error", "warning", "accent", "dim-label"):
            badge.remove_css_class(cls)
        badge.set_text(text)
        badge.add_css_class(style)

    def set_busy(self, busy: bool, status_text: Optional[str] = None) -> None:
        self._busy = busy

        def _apply():
            for w in (self.btn_sign_in, self.btn_deploy, self.btn_destroy):
                w.set_sensitive(not busy)
            if status_text:
                self.row_status.set_subtitle(GLib.markup_escape_text(redact_sensitive_text(status_text)[:180], -1))
                self._set_badge(self.badge_status, "RUNNING" if busy else "IDLE", "accent" if busy else "dim-label")

        GLib.idle_add(_apply)

    def update_progress(self, status_text: str) -> None:
        safe = redact_sensitive_text(status_text)[:180]

        def _apply():
            if self._busy:
                self.row_status.set_subtitle(GLib.markup_escape_text(safe, -1))
                self._set_badge(self.badge_status, "RUNNING", "accent")

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
        safe_det = redact_sensitive_text(detail)[:220]
        clean_url = (app_url or "").strip()
        b_text = badge_text or ("PASS" if ok else "FAILED")
        b_style = badge_style or ("success" if ok else "error")

        def _apply():
            self._app_url = clean_url
            self.btn_open_url.set_sensitive(bool(clean_url))
            self.row_status.set_subtitle(GLib.markup_escape_text(safe_head, -1))
            self._set_badge(self.badge_status, b_text, b_style)
            self.row_result.set_subtitle(GLib.markup_escape_text(safe_det, -1))

        GLib.idle_add(_apply)

    def refresh_from_orchestrator(self, orchestrator) -> None:
        sess = orchestrator.runtime_session
        sess_ok = bool(sess and not sess.is_expired())
        state = orchestrator.state_store.load()
        ctx = state.get("context", {})
        app_url = str(ctx.get("app_url") or "").strip()
        instance_id = str(ctx.get("instance_id") or "").strip()
        last_backup = str(ctx.get("last_backup_key") or "").strip()

        def _apply():
            if sess_ok and sess:
                self.row_session.set_subtitle(
                    GLib.markup_escape_text(f"Signed in as Runtime Provisioner until {sess.expires_at_utc[:19]} UTC", -1)
                )
                self._set_badge(self.badge_session, "SIGNED IN", "success")
                self.btn_sign_in.set_label("Refresh MFA")
            else:
                self.row_session.set_subtitle(
                    "Runtime Provisioner STS session not active (1 TOTP MFA prompt when starting)"
                )
                self._set_badge(self.badge_session, "SIGN-IN REQUIRED", "dim-label")
                self.btn_sign_in.set_label("Sign In (MFA)")

            self._app_url = app_url
            self.btn_open_url.set_sensitive(bool(app_url))
            if not self._busy and self.badge_status.get_text() in ("IDLE", "PASS"):
                if app_url and instance_id:
                    self.row_result.set_subtitle(GLib.markup_escape_text(f"{instance_id} | {app_url}", -1))
                elif last_backup:
                    self.row_result.set_subtitle(
                        GLib.markup_escape_text(f"Environment clean | Last verified backup: {last_backup}", -1)
                    )

        GLib.idle_add(_apply)

