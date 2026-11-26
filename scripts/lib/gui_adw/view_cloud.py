"""GTK4/Libadwaita Cloud Ops tab: demo-first primary controls + collapsed Advanced Operations & Administration."""

from __future__ import annotations

import threading
import traceback

import gi
gi.require_version("Gtk", "4.0")
gi.require_version("Adw", "1")
from gi.repository import Adw, GLib, Gtk

from ..cloud_demo_flow import FoundationNotInitializedError, inspect_destroy_target
from ..cloud_deployer import CloudDeployer
from ..cloud_identity import RUNTIME_PROVISIONER_ROLE_NAME, redact_sensitive_text
from ..eks_deployer import EKSDeployer
from .cloud_ops_panel import CloudOpsPanel
from .cloud_pipeline_panel import CloudPipelinePanel
from .demo_cloud_panel import DemoCloudPanel
from .log_storage import LogStorage
from .step_row import HeadingLogPanel


class CloudView(Gtk.Box):
    def __init__(self, process_manager):
        super().__init__(orientation=Gtk.Orientation.VERTICAL, spacing=12)
        self.pm = process_manager
        self.set_margin_top(12)
        self.set_margin_bottom(12)
        self.set_margin_start(16)
        self.set_margin_end(16)

        self.log_storage = LogStorage()
        self.log_panel = HeadingLogPanel("cloud", self.log_storage)

        self.pipeline_panel = CloudPipelinePanel(
            self.pm,
            self._on_step_event,
            on_complete=self._on_pipeline_complete,
            on_session_changed=self._sync_demo_panel,
            on_mfa_error=self._on_mfa_error,
        )
        self.demo_panel = DemoCloudPanel(
            on_sign_in=self._run_demo_sign_in,
            on_deploy=self._run_demo_deploy,
            on_destroy=self._confirm_destroy,
            log_fn=lambda m: self._on_step_event("demo_url", "Open Application", "log", m),
        )
        self.append(self.demo_panel)

        self.ops_panel = CloudOpsPanel(
            self.pm,
            self._on_step_event,
            get_aws_env=self.pipeline_panel.get_runtime_aws_env,
            ensure_aws_env=self.pipeline_panel.ensure_runtime_aws_env,
            restore_fn=lambda: self.pipeline_panel.orchestrator.restore_database(callbacks=self.pipeline_panel._callbacks()),
            reconstruct_fn=lambda: self.pipeline_panel.orchestrator.reconstruct_runtime(callbacks=self.pipeline_panel._callbacks()),
            on_state_changed=self._on_advanced_state_changed,
            record_backup_key=lambda k: self.pipeline_panel.orchestrator.state_store.update_context(last_backup_key=k),
        )

        # Host power controls (collapsed under Advanced Operations)
        host_bar = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
        self.btn_pause = Gtk.Button(label="Pause Host")
        self.btn_pause.connect("clicked", lambda _: self._run_infra_op("infra_stop", "Pause Host", "infra_stop"))

        self.btn_resume = Gtk.Button(label="Resume Host")
        self.btn_resume.connect("clicked", lambda _: self._run_infra_op("infra_start", "Resume Host", "infra_start"))

        self.btn_destroy = Gtk.Button(label="Destroy Host")
        self.btn_destroy.add_css_class("destructive-action")
        self.btn_destroy.connect("clicked", lambda _: self._confirm_destroy())

        for w in (self.btn_pause, self.btn_resume, self.btn_destroy):
            host_bar.append(w)

        # AWS EKS Managed Kubernetes Cluster Section
        eks_actions_card = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
        eks_actions_card.set_margin_top(4)

        self.btn_eks_up = Gtk.Button(label="Provision EKS Cluster")
        self.btn_eks_up.add_css_class("suggested-action")
        self.btn_eks_up.connect("clicked", lambda _: self._run_eks_op("eks_up", "Provision EKS Cluster", "eks_up"))

        self.btn_eks_workloads = Gtk.Button(label="Deploy Todo Workloads")
        self.btn_eks_workloads.connect("clicked", lambda _: self._run_eks_op("eks_deploy", "Deploy EKS Workloads", "deploy_workloads"))

        self.btn_eks_destroy = Gtk.Button(label="Destroy EKS Cluster")
        self.btn_eks_destroy.add_css_class("destructive-action")
        self.btn_eks_destroy.connect("clicked", lambda _: self._run_eks_op("eks_destroy", "Destroy EKS Cluster", "eks_destroy"))

        for w in (self.btn_eks_up, self.btn_eks_workloads, self.btn_eks_destroy):
            eks_actions_card.append(w)

        self.eks_pref_group = Adw.PreferencesGroup()
        self.eks_pref_group.set_title("AWS EKS Managed Kubernetes Cluster")
        self.eks_pref_group.set_description("1-Click provisioning of AWS EKS control plane (1.32) and Spot worker nodes (ap-south-1).")
        self.row_eks = Adw.ActionRow(title="Cluster: envscale-todo-eks", subtitle="Checking AWS EKS state...")
        self.badge_eks_status = Gtk.Label(label="CHECKING")
        self.badge_eks_status.add_css_class("accent")
        self.row_eks.add_suffix(self.badge_eks_status)
        self.eks_pref_group.add(self.row_eks)

        advanced_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=12)
        advanced_box.set_margin_top(8)
        advanced_box.append(self.ops_panel)
        advanced_box.append(host_bar)
        advanced_box.append(self.pipeline_panel)
        advanced_box.append(eks_actions_card)
        advanced_box.append(self.eks_pref_group)

        self.advanced_expander = Gtk.Expander(label="Advanced Operations & Administration")
        self.advanced_expander.set_expanded(False)
        self.advanced_expander.set_child(advanced_box)
        self.append(self.advanced_expander)

        self.append(self.log_panel)
        self._refresh_status()

    def _on_pipeline_complete(self) -> None:
        self._sync_demo_panel()
        self.ops_panel.refresh_async(include_http=True)

    def _on_advanced_state_changed(self) -> None:
        self.pipeline_panel.refresh_stage_rows()
        self._sync_demo_panel()

    def _sync_demo_panel(self) -> None:
        self.demo_panel.refresh_from_orchestrator(self.pipeline_panel.orchestrator)

    def _on_step_event(self, step_id: str, title: str, status: str, detail: str) -> None:
        safe_title = redact_sensitive_text(title)
        safe_detail = redact_sensitive_text(detail)
        if status == "start" and not step_id.endswith(("_err", "_error")):
            self.demo_panel.update_progress(f"{safe_title}...")

        def _apply():
            if status == "start":
                self.log_panel.create_step(step_id, safe_title, command=safe_detail)
            elif status == "log":
                self.log_panel.append_log(step_id, safe_detail)
            elif status == "success":
                self.log_panel.complete_step(step_id, True, safe_detail)
            elif status == "error":
                self.log_panel.complete_step(step_id, False, safe_detail)
        GLib.idle_add(_apply)

    def _refresh_status(self) -> None:
        self.pipeline_panel.refresh_stage_rows()
        self._sync_demo_panel()
        self.ops_panel.refresh_async(include_http=False)
        def _task():
            eks_st = EKSDeployer().get_cluster_status()
            def _update():
                st_val = eks_st.get("status", "NOT PROVISIONED")
                if eks_st.get("provisioned", False):
                    endpoint = eks_st.get("endpoint", "")
                    self.row_eks.set_subtitle(f"Status: {st_val} | Endpoint: {endpoint[:45]}...")
                    self.badge_eks_status.set_text("ONLINE (ACTIVE)")
                    self.badge_eks_status.remove_css_class("error")
                    self.badge_eks_status.remove_css_class("accent")
                    self.badge_eks_status.add_css_class("success")
                else:
                    self.row_eks.set_subtitle(f"EKS Cluster: {st_val} on AWS")
                    self.badge_eks_status.set_text("OFFLINE")
                    self.badge_eks_status.remove_css_class("success")
                    self.badge_eks_status.remove_css_class("accent")
                    self.badge_eks_status.add_css_class("error")
            GLib.idle_add(_update)
        threading.Thread(target=_task, daemon=True).start()

    def _surface_demo_error(self, title: str, exc: Exception) -> None:
        if isinstance(exc, FoundationNotInitializedError):
            self.demo_panel.set_result(
                False,
                "Foundation not initialized",
                redact_sensitive_text(str(exc)),
                badge_text="FOUNDATION NOT INITIALIZED",
                badge_style="warning",
            )
        else:
            self.demo_panel.set_result(False, f"{title} failed", redact_sensitive_text(f"{type(exc).__name__}: {exc}"))

    def _on_mfa_error(self, role_name: str, exc: Exception) -> None:
        if role_name == RUNTIME_PROVISIONER_ROLE_NAME:
            self._surface_demo_error("AWS Demo Sign-In", exc)

    def _run_demo_sign_in(self) -> None:
        self.pipeline_panel._on_mfa_clicked(RUNTIME_PROVISIONER_ROLE_NAME)

    def _run_demo_deploy(self) -> None:
        if self.pipeline_panel._busy:
            return
        self.pipeline_panel._set_busy(True)
        self.demo_panel.set_busy(True, "Running preflight, provision/start, deploy, and health check...")

        def _task():
            try:
                res = self.pipeline_panel.orchestrator.deploy_demo(callbacks=self.pipeline_panel._callbacks())
                app_url = res.get("app_url") or ""
                inst_id = res.get("instance_id") or "-"
                rel_id = res.get("release_id") or "-"
                self.demo_panel.set_result(
                    True,
                    f"Live at {app_url}" if app_url else "Demo deployment verified",
                    f"Instance: {inst_id} | Release: {rel_id} | URL: {app_url}",
                    app_url=app_url,
                )
                self.ops_panel.refresh_async(include_http=True)
            except Exception as exc:
                msg = redact_sensitive_text(f"{type(exc).__name__}: {exc}")
                self._on_step_event("demo_deploy_err", "Deploy Demo failed", "start", msg)
                self._on_step_event("demo_deploy_err", "Deploy Demo failed", "log", traceback.format_exc().rstrip())
                self._on_step_event("demo_deploy_err", "Deploy Demo failed", "error", msg)
                self._surface_demo_error("Deploy Demo", exc)
            finally:
                self.pipeline_panel.refresh_stage_rows()
                self.pipeline_panel._set_busy(False)
                self.demo_panel.set_busy(False)
                self._sync_demo_panel()

        threading.Thread(target=_task, daemon=True).start()

    def _confirm_destroy(self) -> None:
        target = inspect_destroy_target(self.pipeline_panel.orchestrator.state_store)
        inst_lbl = target["instance_id"] or "no active EC2 instance (state-only safety check)"
        body = (
            f"Target AWS Account: {target['account_id']} ({target['region']})\n"
            f"Target EC2 Instance: {inst_lbl}\n"
            f"Target VPC / Lineage: {target['vpc_id'] or '-'} / {target['tf_lineage'][:12] or '-'}\n"
            f"Application URL: {target['app_url'] or '-'}\n"
            f"Recovery S3 Bucket: s3://{target['recovery_bucket']}\n\n"
            "EnvScale will verify target tags/VPC, archive and checksum-verify PostgreSQL to S3, "
            "run terraform destroy, and confirm cleanup."
        )
        dialog = Adw.MessageDialog(
            transient_for=self.get_root(),
            heading="Destroy Disposable Demo Environment?",
            body=body,
        )
        dialog.add_response("cancel", "Cancel")
        dialog.add_response("destroy", "Backup & Destroy")
        dialog.set_response_appearance("destroy", Adw.ResponseAppearance.DESTRUCTIVE)
        dialog.set_default_response("cancel")
        dialog.connect("response", lambda _d, resp: self._run_infra_op("infra_destroy", "Destroy Demo", "infra_destroy") if resp == "destroy" else None)
        dialog.present()

    def _run_infra_op(self, op_id: str, title: str, method_name: str) -> None:
        self.demo_panel.set_busy(True, f"{title} in progress...")
        def _task():
            for b in (self.btn_pause, self.btn_resume, self.btn_destroy):
                GLib.idle_add(lambda btn=b: btn.set_sensitive(False))
            try:
                if method_name == "infra_destroy":
                    res = self.pipeline_panel.orchestrator.destroy_runtime(callbacks=self.pipeline_panel._callbacks())
                    bkp = res.get("backup") or {}
                    cln = res.get("cleanup") or {}
                    sha_short = str(bkp.get("sha256") or "")[:12]
                    self.demo_panel.set_result(
                        True,
                        "Demo destroyed and cleanup verified",
                        f"Backup: {bkp.get('key', '-')} (sha256={sha_short}...) | Remaining resources: {cln.get('remaining_resources', 0)}",
                    )
                else:
                    aws_env = self.pipeline_panel.ensure_runtime_aws_env()
                    deployer = CloudDeployer(
                        step_fn=self._on_step_event,
                        aws_env=aws_env,
                    )
                    getattr(deployer, method_name)()
            except Exception as exc:
                err_id = f"{op_id}_error"
                msg = redact_sensitive_text(f"{type(exc).__name__}: {exc}")
                self._on_step_event(err_id, f"{title} failed", "start", msg)
                self._on_step_event(err_id, f"{title} failed", "log", traceback.format_exc().rstrip())
                self._on_step_event(err_id, f"{title} failed", "error", msg)
                self._surface_demo_error(title, exc)
                self.pm.emit_log("system", f"[cloud] {title} failed: {msg}")
            finally:
                for b in (self.btn_pause, self.btn_resume, self.btn_destroy):
                    GLib.idle_add(lambda btn=b: btn.set_sensitive(True))
                self.demo_panel.set_busy(False)
                self._refresh_status()
        threading.Thread(target=_task, daemon=True).start()

    def _run_eks_op(self, op_id: str, title: str, method_name: str) -> None:
        def _task():
            for b in (self.btn_eks_up, self.btn_eks_destroy, self.btn_eks_workloads):
                GLib.idle_add(lambda btn=b: btn.set_sensitive(False))
            try:
                deployer = EKSDeployer(step_fn=self._on_step_event)
                getattr(deployer, method_name)()
            except Exception as exc:
                err_id = f"{op_id}_error"
                msg = redact_sensitive_text(f"{type(exc).__name__}: {exc}")
                self._on_step_event(err_id, f"{title} failed", "start", msg)
                self._on_step_event(err_id, f"{title} failed", "log", traceback.format_exc().rstrip())
                self._on_step_event(err_id, f"{title} failed", "error", msg)
                self.pm.emit_log("system", f"[eks] {title} failed: {msg}")
            finally:
                for b in (self.btn_eks_up, self.btn_eks_destroy, self.btn_eks_workloads):
                    GLib.idle_add(lambda btn=b: btn.set_sensitive(True))
                self._refresh_status()
        threading.Thread(target=_task, daemon=True).start()
