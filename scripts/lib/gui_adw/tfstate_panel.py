"""GTK4/Libadwaita Terraform State Sync, Divergence Inspection, and Safe Recovery panel."""

from __future__ import annotations

import os
import threading
import traceback
from typing import Any, Callable, Dict, Optional, Tuple

import gi
gi.require_version("Gtk", "4.0")
gi.require_version("Adw", "1")
from gi.repository import Adw, GLib, Gtk

from ..cloud_identity import redact_sensitive_text
from ..cloud_target_sync import state_sync_ui_label
from ..config import TERRAFORM_DIR
from ..tfstate_reconciler import (
    CorruptedStateJournalError,
    LOCAL_AHEAD,
    LOCAL_MISSING,
    REMOTE_AHEAD,
    REMOTE_MISSING,
    STATE_SYNC_PENDING,
    STATE_SYNCHRONIZED,
    force_release_stale_lock,
    inspect_state_status,
    reconcile_terraform_state,
)

StepFn = Callable[[str, str, str, str], None]


class TfStateSyncPanel(Gtk.Box):
    """Operator controls in Test Center for inspecting, resuming, adopting, promoting, and unlocking runtime state."""

    def __init__(
        self,
        *,
        step_fn: StepFn,
        ensure_aws_env: Callable[[], Dict[str, str]],
        get_scope: Callable[[], Tuple[str, str]],
        on_sync_status_changed: Callable[[str], None],
    ):
        super().__init__(orientation=Gtk.Orientation.VERTICAL, spacing=10)
        self.step_fn = step_fn
        self.ensure_aws_env = ensure_aws_env
        self.get_scope = get_scope
        self.on_sync_status_changed = on_sync_status_changed
        self._busy = False
        self._last_status: Optional[Dict[str, Any]] = None
        self._build_ui()

    def _safe_step(self, sid: str, title: str, status: str, detail: str = "") -> None:
        self.step_fn(sid, title, status, redact_sensitive_text(detail))

    def _local_state_path(self) -> str:
        return os.path.join(TERRAFORM_DIR, "terraform.tfstate")

    def _build_ui(self) -> None:
        bar = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
        self.btn_inspect = Gtk.Button(label="Inspect State")
        self.btn_inspect.connect("clicked", lambda _: self.inspect_async())

        self.btn_resume = Gtk.Button(label="Resume Pending Sync")
        self.btn_resume.add_css_class("suggested-action")
        self.btn_resume.connect("clicked", lambda _: self._on_resume_clicked())

        self.btn_adopt = Gtk.Button(label="Adopt Remote State")
        self.btn_adopt.connect("clicked", lambda _: self._confirm_adopt())

        self.btn_promote = Gtk.Button(label="Promote Local State")
        self.btn_promote.add_css_class("destructive-action")
        self.btn_promote.connect("clicked", lambda _: self._confirm_promote())

        self.btn_unlock = Gtk.Button(label="Unlock Stale Lock")
        self.btn_unlock.connect("clicked", lambda _: self._prompt_unlock())

        for w in (self.btn_inspect, self.btn_resume, self.btn_adopt, self.btn_promote, self.btn_unlock):
            if w is not self.btn_inspect:
                w.set_sensitive(False)
            bar.append(w)
        self.append(bar)

        self.group = Adw.PreferencesGroup()
        self.group.set_title("Terraform State Sync & Recovery")
        self.group.set_description(
            "Compare local and S3 runtime state with explicit confirmation gates (never auto-promotes unproven state)."
        )
        self.row_classification, self.badge_classification = self._make_row("Classification", "Click Inspect State to compare local & S3", "UNKNOWN")
        self.row_local = Adw.ActionRow(title="Local Runtime State", subtitle="Not inspected yet")
        self.row_remote = Adw.ActionRow(title="Remote S3 State", subtitle="Not inspected yet")
        self.row_lock, self.badge_lock = self._make_row("Remote Lock (.tflock)", "Not inspected yet", "-")
        for r in (self.row_classification, self.row_local, self.row_remote, self.row_lock):
            self.group.add(r)
        self.append(self.group)

    def _make_row(self, title: str, subtitle: str, badge_text: str) -> Tuple[Adw.ActionRow, Gtk.Label]:
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

    def _set_busy(self, busy: bool) -> None:
        self._busy = busy
        def _apply():
            self.btn_inspect.set_sensitive(not busy)
            if busy:
                for b in (self.btn_resume, self.btn_adopt, self.btn_promote, self.btn_unlock):
                    b.set_sensitive(False)
            elif self._last_status is not None:
                self._apply_action_gates(self._last_status)
        GLib.idle_add(_apply)

    def _apply_action_gates(self, info: Dict[str, Any]) -> None:
        cls = str(info.get("classification") or "")
        proven = bool(info.get("proven_local_mutation"))
        rlock = info.get("remote_lock") or {}
        self.btn_resume.set_sensitive(cls == STATE_SYNC_PENDING and proven)
        self.btn_adopt.set_sensitive(cls in (REMOTE_AHEAD, LOCAL_MISSING))
        self.btn_promote.set_sensitive(cls in (LOCAL_AHEAD, REMOTE_MISSING))
        self.btn_unlock.set_sensitive(bool(rlock.get("locked")))

    def _apply_status(self, info: Dict[str, Any]) -> None:
        self._last_status = info
        cls = str(info.get("classification") or "")
        lbl = state_sync_ui_label(cls)
        proven = bool(info.get("proven_local_mutation"))
        loc = info.get("local") or {}
        rem = info.get("remote") or {}
        rmeta = info.get("remote_meta") or {}
        op = info.get("journal_op") or {}
        rlock = info.get("remote_lock") or {}

        sub_cls = f"{lbl} | Journal proof: {'yes' if proven else 'no'} | Next: {info.get('recommended_action', '-')}"
        style = "success" if cls == STATE_SYNCHRONIZED else ("error" if lbl == "State conflict" else "warning")
        self.row_classification.set_subtitle(GLib.markup_escape_text(sub_cls[:220], -1))
        self._set_badge(self.badge_classification, cls, style)

        loc_sub = (
            f"lineage={loc.get('lineage', '-')[:18]} | serial={loc.get('serial')} | "
            f"resources={loc.get('resource_count')} | sha256={str(loc.get('sha256') or '-')[:12]} | op={op.get('operation_id') or '-'}"
            if loc else f"Missing | Pending op={op.get('operation_id') or '-'}"
        )
        self.row_local.set_subtitle(GLib.markup_escape_text(loc_sub[:220], -1))

        rem_sub = (
            f"lineage={rem.get('lineage', '-')[:18]} | serial={rem.get('serial')} | "
            f"resources={rem.get('resource_count')} | sha256={str(rem.get('sha256') or '-')[:12]} | ver={rmeta.get('version_id') or '-'}"
            if rem else f"Missing at {(info.get('backend') or {}).get('uri', '-')}"
        )
        self.row_remote.set_subtitle(GLib.markup_escape_text(rem_sub[:220], -1))

        if rlock.get("locked"):
            h = rlock.get("holder") or {}
            l_sub = f"lock_id={h.get('lock_id', '?')} | op={h.get('operation_id', '?')} | {h.get('pid', '?')}@{h.get('hostname', '?')} | {h.get('created_at_utc', '?')}"
            self.row_lock.set_subtitle(GLib.markup_escape_text(l_sub[:220], -1))
            self._set_badge(self.badge_lock, "LOCKED", "warning")
        else:
            self.row_lock.set_subtitle("Unlocked")
            self._set_badge(self.badge_lock, "UNLOCKED", "success")

        self._apply_action_gates(info)
        self.on_sync_status_changed(cls)

    def inspect_async(self) -> None:
        if self._busy:
            return
        self._set_busy(True)

        def _task():
            sid, title = "tfstate_inspect", "Inspect Runtime Terraform State"
            self._safe_step(sid, title, "start", "Comparing local state, journal, lock, and S3 backend")
            try:
                aws_env = self.ensure_aws_env()
                acct, reg = self.get_scope()
                info = inspect_state_status(
                    local_path=self._local_state_path(), account_id=acct, region=reg,
                    aws_env=aws_env, include_lock_status=True,
                )
                GLib.idle_add(lambda: self._apply_status(info))
                self._safe_step(sid, title, "success", f"{info['classification']}: {info['message']}")
            except CorruptedStateJournalError as exc:
                self._safe_step(sid, title, "error", str(exc))
                GLib.idle_add(lambda: self._surface_error("JOURNAL_CORRUPTED", str(exc)))
            except Exception as exc:
                self._safe_step(sid, title, "log", traceback.format_exc().rstrip())
                self._safe_step(sid, title, "error", str(exc))
                GLib.idle_add(lambda: self._surface_error("INSPECT_FAILED", str(exc)))
            finally:
                self._set_busy(False)

        threading.Thread(target=_task, daemon=True).start()

    def _surface_error(self, code: str, msg: str) -> None:
        self.row_classification.set_subtitle(GLib.markup_escape_text(redact_sensitive_text(msg)[:220], -1))
        self._set_badge(self.badge_classification, code, "error")
        if code == "JOURNAL_CORRUPTED":
            self.on_sync_status_changed("JOURNAL_CORRUPTED")

    def _run_reconcile_op(self, sid: str, title: str, *, op_type: str, adopt: bool, promote: bool) -> None:
        if self._busy:
            return
        self._set_busy(True)

        def _task():
            self._safe_step(sid, title, "start", f"operation={op_type}")
            try:
                aws_env = self.ensure_aws_env()
                acct, reg = self.get_scope()
                res = reconcile_terraform_state(
                    local_path=self._local_state_path(), account_id=acct, region=reg,
                    operation_type=op_type, auto_resume_pending=True, allow_adopt_remote=adopt,
                    allow_promote_local=promote, aws_env=aws_env, use_remote_lock=True,
                    emit_fn=self._safe_step, step_id=sid, step_title=title,
                )
                info = inspect_state_status(
                    local_path=self._local_state_path(), account_id=acct, region=reg,
                    aws_env=aws_env, include_lock_status=True,
                )
                GLib.idle_add(lambda: self._apply_status(info))
                self._safe_step(sid, title, "success", f"{res['status']} ({info['classification']})")
            except Exception as exc:
                self._safe_step(sid, title, "log", traceback.format_exc().rstrip())
                self._safe_step(sid, title, "error", str(exc))
                GLib.idle_add(lambda: self._surface_error("SYNC_ERROR", str(exc)))
            finally:
                self._set_busy(False)

        threading.Thread(target=_task, daemon=True).start()

    def _on_resume_clicked(self) -> None:
        self._run_reconcile_op("tfstate_resume", "Resume Pending S3 State Sync", op_type="gui_sync", adopt=False, promote=False)

    def _evidence_summary(self) -> str:
        info = self._last_status or {}
        loc, rem, rmeta = info.get("local") or {}, info.get("remote") or {}, info.get("remote_meta") or {}
        return (
            f"Classification: {info.get('classification', '-')}\n"
            f"Local:  serial={loc.get('serial', '-')} | resources={loc.get('resource_count', '-')} | "
            f"sha256={str(loc.get('sha256') or '-')[:16]} | lineage={loc.get('lineage', '-')}\n"
            f"Remote: serial={rem.get('serial', '-')} | resources={rem.get('resource_count', '-')} | "
            f"sha256={str(rem.get('sha256') or '-')[:16]} | version={rmeta.get('version_id') or '-'}\n"
        )

    def _confirm_adopt(self) -> None:
        dlg = Adw.MessageDialog(
            transient_for=self.get_root(),
            heading="Adopt Authoritative S3 Terraform State?",
            body=f"{self._evidence_summary()}\nLocal state will be atomically replaced with the verified remote S3 state.",
        )
        dlg.add_response("cancel", "Cancel")
        dlg.add_response("adopt", "Adopt Remote State")
        dlg.set_response_appearance("adopt", Adw.ResponseAppearance.SUGGESTED)
        dlg.connect("response", lambda _d, r: self._run_reconcile_op("tfstate_adopt", "Adopt Remote S3 State", op_type="gui_adopt_remote", adopt=True, promote=False) if r == "adopt" else None)
        dlg.present()

    def _confirm_promote(self) -> None:
        dlg = Adw.MessageDialog(
            transient_for=self.get_root(),
            heading="Promote Local Terraform State to S3?",
            body=(
                f"{self._evidence_summary()}\nConfirm you verified against CloudTrail/AWS console that local state reflects actual "
                "AWS reality. S3 versioning preserves the prior remote copy; promoting uploads local state with readback SHA-256 verification."
            ),
        )
        dlg.add_response("cancel", "Cancel")
        dlg.add_response("promote", "Confirm Promote Local State")
        dlg.set_response_appearance("promote", Adw.ResponseAppearance.DESTRUCTIVE)
        dlg.set_default_response("cancel")
        dlg.connect("response", lambda _d, r: self._run_reconcile_op("tfstate_promote", "Promote Local State to S3", op_type="gui_promote_local", adopt=False, promote=True) if r == "promote" else None)
        dlg.present()

    def _prompt_unlock(self) -> None:
        info = self._last_status or {}
        rlock = info.get("remote_lock") or {}
        holder = rlock.get("holder") or {}
        lock_id = str(holder.get("lock_id") or "")
        if not lock_id:
            self._surface_error("LOCK_ERROR", "Active remote lock lacks a readable lock_id; use CLI 'ops tfstate unlock'.")
            return
        win = Adw.Window(title="Unlock Stale S3 State Lock", default_width=500, modal=True)
        if isinstance(self.get_root(), Gtk.Window):
            win.set_transient_for(self.get_root())
        outer = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
        outer.append(Adw.HeaderBar())
        body = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=12, margin_top=16, margin_bottom=16, margin_start=16, margin_end=16)
        body.append(Gtk.Label(
            label=f"Lock ID: {lock_id}\nOp: {holder.get('operation_id', '?')} ({holder.get('pid', '?')}@{holder.get('hostname', '?')})\nSince: {holder.get('created_at_utc', '?')}",
            wrap=True, xalign=0,
        ))
        grp = Adw.PreferencesGroup()
        reason_row = Adw.EntryRow(title="Reason for releasing stale lock")
        grp.add(reason_row)
        body.append(grp)
        btns = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8, halign=Gtk.Align.END)
        b_no, b_yes = Gtk.Button(label="Cancel"), Gtk.Button(label="Unlock Stale Lock")
        b_yes.add_css_class("destructive-action")
        b_no.connect("clicked", lambda _: win.close())
        def _go(_):
            reason = reason_row.get_text().strip()
            if not reason:
                return
            win.close()
            self._run_unlock_async(lock_id, reason)
        b_yes.connect("clicked", _go)
        btns.append(b_no)
        btns.append(b_yes)
        body.append(btns)
        outer.append(body)
        win.set_content(outer)
        win.present()

    def _run_unlock_async(self, lock_id: str, reason: str) -> None:
        if self._busy:
            return
        self._set_busy(True)

        def _task():
            sid, title = "tfstate_unlock", "Release Stale S3 State Lock"
            self._safe_step(sid, title, "start", f"lock_id={lock_id}")
            try:
                aws_env = self.ensure_aws_env()
                acct, reg = self.get_scope()
                bkt = ((self._last_status or {}).get("backend") or {}).get("bucket") or f"envscale-tfstate-{acct}-{reg}"
                res = force_release_stale_lock(
                    bucket=bkt, state_key="runtime/terraform.tfstate", region=reg,
                    expected_lock_id=lock_id, reason=reason, aws_env=aws_env,
                )
                info = inspect_state_status(
                    local_path=self._local_state_path(), account_id=acct, region=reg,
                    aws_env=aws_env, include_lock_status=True,
                )
                GLib.idle_add(lambda: self._apply_status(info))
                self._safe_step(sid, title, "success", f"{res['status']} ({res['lock_key']})")
            except Exception as exc:
                self._safe_step(sid, title, "error", str(exc))
                GLib.idle_add(lambda: self._surface_error("UNLOCK_FAILED", str(exc)))
            finally:
                self._set_busy(False)

        threading.Thread(target=_task, daemon=True).start()

