"""GTK4/Libadwaita Live AWS Operations Dashboard panel."""

from __future__ import annotations

import threading
import traceback
from typing import Any, Callable, Dict, Optional

import gi
gi.require_version("Gtk", "4.0")
gi.require_version("Adw", "1")
from gi.repository import Adw, GLib, Gtk

from ..browser_utils import open_browser_url
from ..cloud_identity import redact_sensitive_text
from ..cloud_ops_dashboard import (
    ALLOWED_REMOTE_SERVICES,
    fetch_ops_snapshot,
    fetch_remote_logs,
    trigger_remote_backup,
    trigger_remote_restore,
    trigger_remote_rollback,
    trigger_remote_verify,
)

StepFn = Callable[[str, str, str, str], None]


class CloudOpsPanel(Gtk.Box):
    """Displays live EC2, SSM, container, release ledger, HTTPS, and backup status."""

    def __init__(
        self,
        pm,
        step_fn: StepFn,
        get_aws_env: Callable[[], Optional[Dict[str, str]]],
        ensure_aws_env: Optional[Callable[[], Dict[str, str]]] = None,
        restore_fn: Optional[Callable[[], Dict[str, Any]]] = None,
        reconstruct_fn: Optional[Callable[[], Dict[str, Any]]] = None,
        on_state_changed: Optional[Callable[[], None]] = None,
        record_backup_key: Optional[Callable[[str], None]] = None,
    ):
        super().__init__(orientation=Gtk.Orientation.VERTICAL, spacing=10)
        self.pm = pm
        self.step_fn = step_fn
        self.get_aws_env = get_aws_env
        self.ensure_aws_env = ensure_aws_env
        self.restore_fn = restore_fn
        self.reconstruct_fn = reconstruct_fn
        self.on_state_changed = on_state_changed
        self.record_backup_key = record_backup_key
        self._cloud_url = "https://envscale.duckdns.org"
        self._build_ui()

    def _active_aws_env(self) -> Optional[Dict[str, str]]:
        return self.ensure_aws_env() if self.ensure_aws_env else self.get_aws_env()

    def _safe_step(self, step_id: str, title: str, status: str, detail: str = "") -> None:
        self.step_fn(step_id, title, status, redact_sensitive_text(detail))

    def _build_ui(self) -> None:
        bar = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
        self.btn_refresh = Gtk.Button(label="Refresh Dashboard")
        self.btn_refresh.connect("clicked", lambda _: self.refresh_async(include_http=True))

        self.svc_dropdown = Gtk.DropDown.new(Gtk.StringList.new(list(ALLOWED_REMOTE_SERVICES)), None)
        self.btn_logs = Gtk.Button(label="Fetch Remote Logs")
        self.btn_logs.connect("clicked", lambda _: self._fetch_logs_async())

        self.btn_verify = Gtk.Button(label="Verify Host")
        self.btn_verify.connect("clicked", lambda _: self._run_action_async("ops_verify", "Remote Verify", trigger_remote_verify))

        self.btn_backup = Gtk.Button(label="Backup DB")
        self.btn_backup.connect("clicked", lambda _: self._run_backup_async())

        self.btn_restore = Gtk.Button(label="Restore DB")
        self.btn_restore.connect("clicked", lambda _: self._run_restore_async())

        self.btn_reconstruct = Gtk.Button(label="Reconstruct Host")
        self.btn_reconstruct.connect("clicked", lambda _: self._run_reconstruct_async())

        self.btn_rollback = Gtk.Button(label="Rollback")
        self.btn_rollback.add_css_class("destructive-action")
        self.btn_rollback.connect("clicked", lambda _: self._run_action_async("ops_rollback", "Remote Rollback", trigger_remote_rollback))

        self.btn_open_url = Gtk.Button(label="Open Cloud URL")
        self.btn_open_url.connect("clicked", lambda _: open_browser_url(self._cloud_url, log_fn=lambda m: self._safe_step("open_url", "Open Cloud URL", "log", m)))

        for w in (self.btn_refresh, self.svc_dropdown, self.btn_logs, self.btn_verify, self.btn_backup, self.btn_restore, self.btn_reconstruct, self.btn_rollback, self.btn_open_url):
            bar.append(w)
        self.append(bar)

        group = Adw.PreferencesGroup()
        group.set_title("Live Operations Dashboard")
        group.set_description("Runtime EC2 host, AWS SSM agent, Compose containers, active release, HTTPS, and S3 backups.")

        self.row_ec2, self.badge_ec2 = self._make_row("EC2 Host & IP", "Not checked yet", "UNKNOWN")
        self.row_ssm, self.badge_ssm = self._make_row("SSM Connectivity", "Not checked yet", "UNKNOWN")
        self.row_containers, self.badge_containers = self._make_row("Containers Health", "Awaiting SSM probe", "-")
        self.row_release, self.badge_release = self._make_row("Active Release & History", "No active release loaded", "-")
        self.row_health, self.badge_health = self._make_row("HTTPS / TLS Health", self._cloud_url, "-")
        self.row_backups, self.badge_backups = self._make_row("S3 Backups", "Not checked yet", "-")

        for r in (self.row_ec2, self.row_ssm, self.row_containers, self.row_release, self.row_health, self.row_backups):
            group.add(r)
        self.append(group)

    def _make_row(self, title: str, subtitle: str, badge_text: str) -> tuple[Adw.ActionRow, Gtk.Label]:
        row = Adw.ActionRow(title=title, subtitle=subtitle)
        badge = Gtk.Label(label=badge_text)
        badge.add_css_class("dim-label")
        row.add_suffix(badge)
        return row, badge

    def _set_badge(self, badge: Gtk.Label, text: str, style: str) -> None:
        for cls in ("success", "error", "warning", "accent", "dim-label"):
            badge.remove_css_class(cls)
        badge.set_text(text)
        badge.add_css_class(style)

    def refresh_async(self, include_http: bool = False) -> None:
        def _task():
            try:
                snap = fetch_ops_snapshot(aws_env=self.get_aws_env(), include_http_health=include_http)
                GLib.idle_add(lambda: self._apply_snapshot(snap))
            except Exception as exc:
                err = redact_sensitive_text(str(exc))
                GLib.idle_add(lambda: self.row_ec2.set_subtitle(GLib.markup_escape_text(err, -1)))
        threading.Thread(target=_task, daemon=True).start()

    def _apply_snapshot(self, snap: Dict[str, Any]) -> None:
        ec2 = snap.get("ec2", {})
        ssm = snap.get("ssm", {})
        containers = snap.get("containers", [])
        rel = snap.get("active_release", {})
        history = snap.get("history", [])
        health = snap.get("health", {})
        backups = snap.get("backups", {})

        ec2_state = ec2.get("state", "unknown")
        ec2_err = ec2.get("error") or snap.get("aws_error") or ""
        ec2_sub = f"{ec2.get('instance_id') or 'none'} | IP: {ec2.get('public_ip') or '-'}" + (f" | {ec2_err}" if ec2_err else "")
        self.row_ec2.set_subtitle(GLib.markup_escape_text(ec2_sub[:180], -1))
        self._set_badge(self.badge_ec2, ec2_state.upper(), "success" if ec2_state == "running" else ("error" if ec2_err or ec2_state == "error" else "dim-label"))

        ping = ssm.get("ping_status", "Unknown")
        ssm_err = ssm.get("error", "")
        ssm_sub = f"Agent: {ssm.get('agent_version') or '-'}" + (f" | {ssm_err}" if ssm_err else "")
        self.row_ssm.set_subtitle(GLib.markup_escape_text(ssm_sub[:180], -1))
        self._set_badge(self.badge_ssm, ping.upper(), "success" if ping == "Online" else ("error" if ssm_err else "dim-label"))

        if containers:
            healthy = sum(1 for c in containers if "healthy" in c.get("status", "").lower() or c.get("state") == "running")
            summary = ", ".join(f"{c['name']}:{c['state']}" for c in containers[:5])
            self.row_containers.set_subtitle(GLib.markup_escape_text(summary[:180], -1))
            self._set_badge(self.badge_containers, f"{healthy}/{len(containers)} UP", "success" if healthy == len(containers) else "warning")
        else:
            self.row_containers.set_subtitle(GLib.markup_escape_text(snap.get("probe_error") or "No container data (SSM offline or not deployed)", -1))
            self._set_badge(self.badge_containers, "0", "dim-label")

        if rel:
            self.row_release.set_subtitle(GLib.markup_escape_text(f"{rel.get('release_id', '')} ({rel.get('commit_sha', '')[:7]}) | {len(history)} ledger entries", -1))
            self._set_badge(self.badge_release, "ACTIVE", "success")
        else:
            self.row_release.set_subtitle("No active release recorded on host yet")
            self._set_badge(self.badge_release, "-", "dim-label")

        if health.get("target_url"):
            self._cloud_url = health["target_url"]
        if health.get("checked"):
            ok = bool(health.get("ok"))
            errs = "; ".join(health.get("errors") or [])
            self.row_health.set_subtitle(GLib.markup_escape_text(self._cloud_url if ok else f"{self._cloud_url} ({errs[:120]})", -1))
            self._set_badge(self.badge_health, "HEALTHY" if ok else "UNHEALTHY", "success" if ok else "error")
        else:
            self.row_health.set_subtitle(GLib.markup_escape_text(self._cloud_url or "No host URL", -1))
            self._set_badge(self.badge_health, "UNCHECKED", "dim-label")

        b_items = backups.get("items", [])
        b_err = backups.get("error", "")
        if b_items:
            self.row_backups.set_subtitle(GLib.markup_escape_text(f"s3://{backups.get('bucket')}/{b_items[0]['key']}", -1))
            self._set_badge(self.badge_backups, f"{len(b_items)} FILES", "success")
        else:
            self.row_backups.set_subtitle(GLib.markup_escape_text(b_err or f"No backups found in {backups.get('bucket', 'S3')}", -1))
            self._set_badge(self.badge_backups, "ERR" if b_err else "0", "warning" if b_err else "dim-label")

    def _fetch_logs_async(self) -> None:
        item = self.svc_dropdown.get_selected_item()
        svc = item.get_string() if item else "all"
        def _task():
            sid, title = f"remote_logs_{svc}", f"Fetch Remote Logs ({svc})"
            self._safe_step(sid, title, "start", f"docker compose logs --tail 80 {svc}")
            try:
                out = fetch_remote_logs(service=svc, tail=80, aws_env=self._active_aws_env(), step_fn=self._safe_step)
                lines = len(out.splitlines()) if out else 0
                self._safe_step(sid, title, "success", f"Retrieved {lines} lines")
            except Exception as exc:
                self._safe_step(sid, title, "error", str(exc))
        threading.Thread(target=_task, daemon=True).start()

    def _run_action_async(self, sid: str, title: str, fn: Callable[..., Any]) -> None:
        def _task():
            self._safe_step(sid, title, "start", title)
            try:
                fn(aws_env=self._active_aws_env(), step_fn=self._safe_step)
                self._safe_step(sid, title, "success", f"{title} completed")
            except Exception as exc:
                self._safe_step(sid, title, "log", traceback.format_exc().rstrip())
                self._safe_step(sid, title, "error", str(exc))
            finally:
                self.refresh_async(include_http=True)
        threading.Thread(target=_task, daemon=True).start()

    def _run_backup_async(self) -> None:
        def _task():
            sid, title = "ops_backup", "Manual PostgreSQL Backup to S3"
            self._safe_step(sid, title, "start", "pg_dump -> aws s3 cp")
            try:
                res = trigger_remote_backup(aws_env=self._active_aws_env(), step_fn=self._safe_step)
                if self.record_backup_key and res.get("key"):
                    self.record_backup_key(res["key"])
                self._safe_step(sid, title, "success", res["s3_uri"])
            except Exception as exc:
                self._safe_step(sid, title, "error", str(exc))
            finally:
                if self.on_state_changed:
                    self.on_state_changed()
                self.refresh_async(include_http=False)
        threading.Thread(target=_task, daemon=True).start()

    def _run_restore_async(self) -> None:
        GLib.idle_add(lambda: self.btn_restore.set_sensitive(False))

        def _task():
            sid, title = "ops_restore", "Restore Latest PostgreSQL Backup from S3"
            self._safe_step(sid, title, "start", "envscale.sh restore -> verify.sh")
            try:
                res = self.restore_fn() if self.restore_fn else trigger_remote_restore(aws_env=self._active_aws_env(), step_fn=self._safe_step)
                self._safe_step(sid, title, "success", f"{res['key']} (tables={res.get('canonical_tables', 0)}/12)")
            except Exception as exc:
                self._safe_step(sid, title, "error", str(exc))
            finally:
                GLib.idle_add(lambda: self.btn_restore.set_sensitive(True))
                if self.on_state_changed:
                    self.on_state_changed()
                self.refresh_async(include_http=True)
        threading.Thread(target=_task, daemon=True).start()

    def _run_reconstruct_async(self) -> None:
        if not self.reconstruct_fn:
            return
        GLib.idle_add(lambda: self.btn_reconstruct.set_sensitive(False))

        def _task():
            sid, title = "ops_reconstruct", "Reconstruct Runtime Host & Restore Database"
            self._safe_step(sid, title, "start", "provision -> deploy -> restore -> verify")
            try:
                res = self.reconstruct_fn()
                self._safe_step(sid, title, "success", f"Live at {res.get('app_url') or 'verified'}")
            except Exception as exc:
                self._safe_step(sid, title, "error", str(exc))
            finally:
                GLib.idle_add(lambda: self.btn_reconstruct.set_sensitive(True))
                if self.on_state_changed:
                    self.on_state_changed()
                self.refresh_async(include_http=True)
        threading.Thread(target=_task, daemon=True).start()

