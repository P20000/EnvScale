"""GTK4/Libadwaita 7-stage Provision & Deploy pipeline panel and secure modal dialogs."""

from __future__ import annotations

import threading
import traceback
from typing import Any, Callable, Dict, List, Optional

import gi
gi.require_version("Gtk", "4.0")
gi.require_version("Adw", "1")
from gi.repository import Adw, GLib, Gtk

from ..cloud_identity import (
    ADMIN_ROLE_NAME,
    RUNTIME_PROVISIONER_ROLE_NAME,
    AwsSessionContext,
    assume_foundation_admin_role,
    assume_runtime_provisioner_role,
    build_profile_env,
    complete_virtual_mfa_enrollment,
    inspect_aws_identity,
    list_aws_profiles,
    redact_sensitive_text,
    start_virtual_mfa_enrollment,
)
from ..cloud_orchestrator import STAGE_DEFINITIONS, CloudOrchestrator, OrchestratorCallbacks

StepFn = Callable[[str, str, str, str], None]


class CloudPipelinePanel(Gtk.Box):
    """Unified 7-stage resumable workflow controls and interactive approval/MFA/secrets dialogs."""

    def __init__(
        self,
        pm,
        step_fn: StepFn,
        on_complete: Optional[Callable[[], None]] = None,
        on_session_changed: Optional[Callable[[], None]] = None,
    ):
        super().__init__(orientation=Gtk.Orientation.VERTICAL, spacing=10)
        self.pm = pm
        self.step_fn = step_fn
        self.on_complete = on_complete
        self.on_session_changed = on_session_changed
        self.orchestrator = CloudOrchestrator(
            admin_session=None,
            runtime_session=None,
            allow_ram_handoff=False,
            step_fn=self._safe_step,
        )
        self._busy = False
        self._stage_rows: Dict[str, Adw.ActionRow] = {}
        self._stage_badges: Dict[str, Gtk.Label] = {}
        self._stage_buttons: Dict[str, Gtk.Button] = {}
        self._profiles: List[str] = ["(default)"] + list_aws_profiles()

        self._build_ui()
        self.refresh_stage_rows()

    def _safe_step(self, step_id: str, title: str, status: str, detail: str = "") -> None:
        self.step_fn(step_id, title, status, redact_sensitive_text(detail))

    def _notify_session_changed(self) -> None:
        if self.on_session_changed:
            self.on_session_changed()

    def get_runtime_aws_env(self) -> Optional[Dict[str, str]]:
        return self.orchestrator.get_runtime_aws_env()

    def ensure_runtime_aws_env(self) -> Dict[str, str]:
        env = self.orchestrator._require_verified_runtime_env(self._callbacks())
        self._notify_session_changed()
        self.refresh_stage_rows()
        return env

    def _build_ui(self) -> None:
        top_bar = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
        self.btn_run_all = Gtk.Button(label="Provision & Deploy")
        self.btn_run_all.add_css_class("suggested-action")
        self.btn_run_all.connect("clicked", lambda _: self._run_pipeline_async())

        self.btn_preflight = Gtk.Button(label="Run Preflight")
        self.btn_preflight.connect("clicked", lambda _: self._run_single_stage_async("preflight"))

        self.btn_mfa = Gtk.Button(label="Admin MFA")
        self.btn_mfa.connect("clicked", lambda _: self._on_mfa_clicked(ADMIN_ROLE_NAME))

        self.btn_runtime_mfa = Gtk.Button(label="Runtime MFA")
        self.btn_runtime_mfa.connect("clicked", lambda _: self._on_mfa_clicked(RUNTIME_PROVISIONER_ROLE_NAME))

        self.btn_reset = Gtk.Button(label="Reset Stages")
        self.btn_reset.connect("clicked", self._on_reset_clicked)

        profile_lbl = Gtk.Label(label="AWS Profile:")
        profile_lbl.add_css_class("dim-label")
        self.profile_dropdown = Gtk.DropDown.new(Gtk.StringList.new(self._profiles), None)
        saved_prof = self.orchestrator.runtime_profile
        if saved_prof and saved_prof in self._profiles:
            self.profile_dropdown.set_selected(self._profiles.index(saved_prof))
        self.profile_dropdown.connect("notify::selected-item", self._on_profile_changed)

        self.badge_admin = Gtk.Label(label="ADMIN: NONE")
        self.badge_admin.add_css_class("dim-label")
        self.badge_runtime = Gtk.Label(label="RUNTIME: NONE")
        self.badge_runtime.add_css_class("dim-label")

        for w in (self.btn_run_all, self.btn_preflight, self.btn_mfa, self.btn_runtime_mfa, self.btn_reset, profile_lbl, self.profile_dropdown, self.badge_admin, self.badge_runtime):
            top_bar.append(w)
        self.append(top_bar)

        self.stage_group = Adw.PreferencesGroup()
        self.stage_group.set_title("Control Plane Pipeline (Resumable 7-Stage Deployment)")
        self.stage_group.set_description("Run 'Provision & Deploy' end-to-end or execute/resume any individual stage.")
        for idx, (sid, title) in enumerate(STAGE_DEFINITIONS, start=1):
            row = Adw.ActionRow()
            row.set_title(f"{idx}. {title}")
            row.set_subtitle("Pending")

            badge = Gtk.Label(label="PENDING")
            badge.add_css_class("dim-label")
            row.add_suffix(badge)

            btn = Gtk.Button(label="Run")
            btn.connect("clicked", lambda _, s=sid: self._run_single_stage_async(s))
            row.add_suffix(btn)

            self._stage_rows[sid] = row
            self._stage_badges[sid] = badge
            self._stage_buttons[sid] = btn
            self.stage_group.add(row)
        self.append(self.stage_group)

    def _on_profile_changed(self, *_) -> None:
        item = self.profile_dropdown.get_selected_item()
        if not item:
            return
        val = item.get_string()
        self.orchestrator.set_runtime_profile(None if val == "(default)" else val)

    def _on_reset_clicked(self, _) -> None:
        if self._busy:
            return
        self.orchestrator.state_store.reset()
        self.refresh_stage_rows()

    def _set_busy(self, busy: bool) -> None:
        self._busy = busy
        def _apply():
            for w in (self.btn_run_all, self.btn_preflight, self.btn_mfa, self.btn_runtime_mfa, self.btn_reset, *self._stage_buttons.values()):
                w.set_sensitive(not busy)
        GLib.idle_add(_apply)

    def refresh_stage_rows(self) -> None:
        state = self.orchestrator.state_store.load()
        admin = self.orchestrator.admin_session
        admin_ok = bool(admin and not admin.is_expired())
        runtime = self.orchestrator.runtime_session
        runtime_ok = bool(runtime and not runtime.is_expired())
        def _apply():
            for sid, _ in STAGE_DEFINITIONS:
                st = state["stages"].get(sid, {})
                status = st.get("status", "pending")
                detail = st.get("error") or st.get("summary") or "Pending"
                row = self._stage_rows[sid]
                badge = self._stage_badges[sid]
                row.set_subtitle(GLib.markup_escape_text(detail[:160], -1))
                for cls in ("success", "error", "accent", "warning", "dim-label"):
                    badge.remove_css_class(cls)
                lbl_map = {
                    "completed": ("DONE", "success"),
                    "running": ("RUNNING", "accent"),
                    "failed": ("FAILED", "error"),
                    "needs_approval": ("APPROVAL", "warning"),
                    "needs_mfa": ("MFA REQ", "warning"),
                    "pending": ("PENDING", "dim-label"),
                }
                text, css = lbl_map.get(status, (status.upper(), "dim-label"))
                badge.set_text(text)
                badge.add_css_class(css)

            for badge, sess, ok, prefix in (
                (self.badge_admin, admin, admin_ok, "ADMIN"),
                (self.badge_runtime, runtime, runtime_ok, "RUNTIME"),
            ):
                for cls in ("success", "dim-label"):
                    badge.remove_css_class(cls)
                if ok and sess:
                    badge.set_text(f"{prefix}: {sess.expires_at_utc[:19]}")
                    badge.add_css_class("success")
                else:
                    badge.set_text(f"{prefix}: NONE")
                    badge.add_css_class("dim-label")
        GLib.idle_add(_apply)

    def _callbacks(self) -> OrchestratorCallbacks:
        return OrchestratorCallbacks(
            on_approval=self._prompt_approval,
            on_mfa_session=lambda: self._ensure_role_session_interactive(ADMIN_ROLE_NAME),
            on_runtime_mfa_session=lambda: self._ensure_role_session_interactive(RUNTIME_PROVISIONER_ROLE_NAME),
            on_secrets_input=self._prompt_secrets_input,
        )

    def _run_pipeline_async(self) -> None:
        if self._busy:
            return
        self._set_busy(True)
        def _task():
            try:
                out = self.orchestrator.run_pipeline(resume=True, callbacks=self._callbacks())
                if out.get("status") == "completed" and self.on_complete:
                    self.on_complete()
            except Exception as exc:
                msg = redact_sensitive_text(f"{type(exc).__name__}: {exc}")
                self._safe_step("pipeline_err", "Provision & Deploy Failed", "start", msg)
                self._safe_step("pipeline_err", "Provision & Deploy Failed", "log", traceback.format_exc().rstrip())
                self._safe_step("pipeline_err", "Provision & Deploy Failed", "error", msg)
            finally:
                self._notify_session_changed()
                self.refresh_stage_rows()
                self._set_busy(False)
        threading.Thread(target=_task, daemon=True).start()

    def _run_single_stage_async(self, stage_id: str) -> None:
        if self._busy:
            return
        self._set_busy(True)
        def _task():
            try:
                self.orchestrator.run_stage(stage_id, callbacks=self._callbacks())
                if stage_id in ("provision", "deploy", "verify") and self.on_complete:
                    self.on_complete()
            except Exception as exc:
                msg = redact_sensitive_text(f"{type(exc).__name__}: {exc}")
                self._safe_step(f"stage_{stage_id}_err", f"Stage '{stage_id}' Failed", "start", msg)
                self._safe_step(f"stage_{stage_id}_err", f"Stage '{stage_id}' Failed", "log", traceback.format_exc().rstrip())
                self._safe_step(f"stage_{stage_id}_err", f"Stage '{stage_id}' Failed", "error", msg)
            finally:
                self._notify_session_changed()
                self.refresh_stage_rows()
                self._set_busy(False)
        threading.Thread(target=_task, daemon=True).start()

    def _on_mfa_clicked(self, role_name: str = ADMIN_ROLE_NAME) -> None:
        if self._busy:
            return
        self._set_busy(True)
        is_runtime = role_name == RUNTIME_PROVISIONER_ROLE_NAME
        step_id = "mfa_runtime" if is_runtime else "mfa_admin"
        title = "MFA Runtime Provisioner Session" if is_runtime else "MFA Admin Session"
        def _task():
            try:
                sess = self._ensure_role_session_interactive(role_name, reuse_active=False)
                self._safe_step(step_id, title, "start", f"Assume {role_name}")
                self._safe_step(step_id, title, "success", f"Assumed until {sess.expires_at_utc}")
            except Exception as exc:
                msg = redact_sensitive_text(str(exc))
                self._safe_step(step_id, title, "start", f"Assume {role_name}")
                self._safe_step(step_id, title, "error", msg)
            finally:
                self._notify_session_changed()
                self.refresh_stage_rows()
                self._set_busy(False)
        threading.Thread(target=_task, daemon=True).start()

    def _run_ui_modal(self, builder_fn: Callable[[Callable[[Any], None]], Adw.Window]) -> Any:
        done = threading.Event()
        holder: Dict[str, Any] = {"value": None}

        def _finish(val: Any) -> None:
            if not done.is_set():
                holder["value"] = val
                done.set()

        def _open():
            win = builder_fn(_finish)
            root = self.get_root()
            if isinstance(root, Gtk.Window):
                win.set_transient_for(root)
            win.set_modal(True)
            win.connect("close-request", lambda _: (_finish(None), False)[1])
            win.present()
            return False

        GLib.idle_add(_open)
        done.wait()
        return holder["value"]

    def _build_modal_shell(self, title: str, width: int = 520) -> tuple[Adw.Window, Gtk.Box]:
        win = Adw.Window(title=title, default_width=width)
        outer = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
        outer.append(Adw.HeaderBar())
        body = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=12)
        body.set_margin_top(16)
        body.set_margin_bottom(16)
        body.set_margin_start(16)
        body.set_margin_end(16)
        outer.append(body)
        win.set_content(outer)
        return win, body

    def _prompt_approval(self, payload: Dict[str, Any]) -> bool:
        kind = payload.get("kind", "")
        def _build(finish):
            win, body = self._build_modal_shell("Operator Approval Required", 560)
            lbl = Gtk.Label(wrap=True, xalign=0)
            entry: Optional[Adw.EntryRow] = None
            if kind == "configure_github_foundation_vars":
                lines = ["Configure missing GitHub Environment variables with existing IAM role ARNs:"]
                for k, (env_n, arn) in payload.get("vars", {}).items():
                    lines.append(f"• {k} ({env_n}) -> {arn}")
                lbl.set_text("\n".join(lines))
                body.append(lbl)
            elif kind == "foundation_apply":
                counts = payload.get("plan_summary", {}).get("counts", {})
                changes = payload.get("plan_summary", {}).get("changes", [])
                lines = [
                    f"Foundation Plan Run #{payload.get('plan_run_id')}",
                    f"Changes: create={counts.get('create', 0)}, update={counts.get('update', 0)}, delete={counts.get('delete', 0)}, replace={counts.get('replace', 0)}",
                ]
                lines.extend(f"  {','.join(c.get('actions', []))} {c.get('address', '')}" for c in changes[:15])
                lbl.set_text("\n".join(lines))
                body.append(lbl)
                grp = Adw.PreferencesGroup()
                entry = Adw.EntryRow(title="Type APPLY-FOUNDATION to approve")
                grp.add(entry)
                body.append(grp)
            else:
                lbl.set_text(f"Approve operation: {kind}?")
                body.append(lbl)

            btns = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8, halign=Gtk.Align.END)
            btn_no = Gtk.Button(label="Cancel")
            btn_no.connect("clicked", lambda _: (finish(False), win.close()))
            btn_yes = Gtk.Button(label="Approve")
            btn_yes.add_css_class("suggested-action")
            def _ok(_):
                ok = True if entry is None else entry.get_text().strip() == "APPLY-FOUNDATION"
                finish(ok)
                win.close()
            btn_yes.connect("clicked", _ok)
            btns.append(btn_no)
            btns.append(btn_yes)
            body.append(btns)
            return win
        return bool(self._run_ui_modal(_build))

    def _ensure_role_session_interactive(
        self, role_name: str = ADMIN_ROLE_NAME, *, reuse_active: bool = True
    ) -> AwsSessionContext:
        if role_name == ADMIN_ROLE_NAME:
            existing, assume_fn, modal_title, btn_label = (
                self.orchestrator.admin_session, assume_foundation_admin_role, "Assume Foundation Admin Role (MFA)", "Assume Admin Role"
            )
        elif role_name == RUNTIME_PROVISIONER_ROLE_NAME:
            existing, assume_fn, modal_title, btn_label = (
                self.orchestrator.runtime_session, assume_runtime_provisioner_role, "Assume Runtime Provisioner Role (MFA)", "Assume Runtime Role"
            )
        else:
            raise ValueError(f"Unsupported MFA role '{role_name}'.")

        if reuse_active and isinstance(existing, AwsSessionContext) and not existing.is_expired():
            return existing

        base_env = build_profile_env(self.orchestrator.runtime_profile) if self.orchestrator.runtime_profile else None
        info = inspect_aws_identity(aws_env=base_env, profile=self.orchestrator.runtime_profile)
        if not info.get("authenticated"):
            raise RuntimeError(info.get("error", "AWS CLI is not authenticated."))

        serials = info.get("mfa_serials", [])
        if not serials:
            user_name = info.get("user_name")
            if not user_name:
                raise RuntimeError("No TOTP MFA device enrolled and active caller is not an IAM user.")
            enroll = start_virtual_mfa_enrollment(user_name=user_name, account_id=info["account_id"], aws_env=base_env)
            def _build_enroll(finish):
                win, body = self._build_modal_shell("One-Time Virtual MFA Enrollment", 560)
                info_lbl = Gtk.Label(wrap=True, xalign=0, selectable=True)
                info_lbl.set_text(
                    f"User: {user_name}\nSerial: {enroll['serial_number']}\n"
                    f"Base32 Seed (authenticator app): {enroll['base32_seed']}\n"
                    f"URI: {enroll['otpauth_uri']}\n"
                    "Enter two consecutive 6-digit TOTP codes below (ephemeral, never logged)."
                )
                body.append(info_lbl)
                grp = Adw.PreferencesGroup()
                r1 = Adw.PasswordEntryRow(title="1st 6-digit TOTP Code")
                r2 = Adw.PasswordEntryRow(title="2nd Consecutive 6-digit TOTP Code")
                grp.add(r1)
                grp.add(r2)
                body.append(grp)
                btns = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8, halign=Gtk.Align.END)
                b_cancel = Gtk.Button(label="Cancel")
                b_cancel.connect("clicked", lambda _: (finish(None), win.close()))
                b_ok = Gtk.Button(label="Enable MFA")
                b_ok.add_css_class("suggested-action")
                b_ok.connect("clicked", lambda _: (finish((r1.get_text().strip(), r2.get_text().strip())), win.close()))
                btns.append(b_cancel)
                btns.append(b_ok)
                body.append(btns)
                return win

            codes = self._run_ui_modal(_build_enroll)
            if not codes:
                raise RuntimeError("Virtual MFA enrollment cancelled.")
            complete_virtual_mfa_enrollment(user_name, enroll["serial_number"], codes[0], codes[1], aws_env=base_env)
            serials = [enroll["serial_number"]]

        serial = serials[0]
        def _build_totp(finish):
            win, body = self._build_modal_shell(modal_title, 460)
            body.append(Gtk.Label(label=f"Role: {role_name}\nTOTP MFA Device: {serial}", wrap=True, xalign=0))
            grp = Adw.PreferencesGroup()
            code_row = Adw.PasswordEntryRow(title="Current 6-digit TOTP Code")
            grp.add(code_row)
            body.append(grp)
            btns = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8, halign=Gtk.Align.END)
            b_cancel = Gtk.Button(label="Cancel")
            b_cancel.connect("clicked", lambda _: (finish(None), win.close()))
            b_ok = Gtk.Button(label=btn_label)
            b_ok.add_css_class("suggested-action")
            b_ok.connect("clicked", lambda _: (finish(code_row.get_text().strip()), win.close()))
            btns.append(b_cancel)
            btns.append(b_ok)
            body.append(btns)
            return win

        token_code = self._run_ui_modal(_build_totp)
        if not token_code:
            raise RuntimeError(f"MFA role assumption cancelled for '{role_name}'.")
        sess = assume_fn(
            mfa_serial=serial,
            token_code=token_code,
            account_id=info["account_id"],
            region=info["region"],
            aws_env=base_env,
        )
        if role_name == RUNTIME_PROVISIONER_ROLE_NAME:
            self.orchestrator.runtime_session = sess
        else:
            self.orchestrator.admin_session = sess
        self._notify_session_changed()
        return sess

    def _prompt_secrets_input(self, existing: List[str], missing: List[str], defaults: Dict[str, str]) -> Dict[str, str]:
        def _build(finish):
            win, body = self._build_modal_shell("Seed /envscale/prod/* SSM SecureStrings", 540)
            body.append(Gtk.Label(
                label=f"Existing params: {len(existing)} | Missing SecureStrings ({len(missing)}): {', '.join(missing) or 'none'}",
                wrap=True, xalign=0,
            ))
            grp = Adw.PreferencesGroup()
            r_duck = Adw.PasswordEntryRow(title="DUCKDNS_TOKEN (required)")
            if defaults.get("DUCKDNS_TOKEN"):
                r_duck.set_text(defaults["DUCKDNS_TOKEN"])
            disp_choices = ["generate-fresh-no-historical-ciphertext", "preserve-from-secrets-file"]
            r_disp = Adw.ComboRow(title="KUBECONFIG_ENCRYPTION_KEY Mode", model=Gtk.StringList.new(disp_choices))
            r_kube = Adw.PasswordEntryRow(title="KUBECONFIG_ENCRYPTION_KEY (only if preserve)")
            r_goog = Adw.PasswordEntryRow(title="GOOGLE_CLIENT_SECRET (optional)")
            r_gh = Adw.PasswordEntryRow(title="GITHUB_CLIENT_SECRET (optional)")
            for r in (r_duck, r_disp, r_kube, r_goog, r_gh):
                grp.add(r)
            body.append(grp)
            btns = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8, halign=Gtk.Align.END)
            b_cancel = Gtk.Button(label="Cancel")
            b_cancel.connect("clicked", lambda _: (finish({}), win.close()))
            b_ok = Gtk.Button(label="Seed SSM Secrets")
            b_ok.add_css_class("suggested-action")
            def _ok(_):
                out = {
                    "DUCKDNS_TOKEN": r_duck.get_text().strip(),
                    "kubeconfig_key_disposition": disp_choices[r_disp.get_selected()],
                }
                if r_kube.get_text().strip():
                    out["KUBECONFIG_ENCRYPTION_KEY"] = r_kube.get_text().strip()
                if r_goog.get_text().strip():
                    out["GOOGLE_CLIENT_SECRET"] = r_goog.get_text().strip()
                if r_gh.get_text().strip():
                    out["GITHUB_CLIENT_SECRET"] = r_gh.get_text().strip()
                finish(out)
                win.close()
            b_ok.connect("clicked", _ok)
            btns.append(b_cancel)
            btns.append(b_ok)
            body.append(btns)
            return win
        return self._run_ui_modal(_build) or {}

