"""GTK4/Libadwaita Cloud Ops tab integrating the 7-stage pipeline, operations dashboard, host controls, and EKS."""

from __future__ import annotations

import threading
import traceback

import gi
gi.require_version("Gtk", "4.0")
gi.require_version("Adw", "1")
from gi.repository import Adw, GLib, Gtk

from ..cloud_deployer import CloudDeployer
from ..cloud_identity import redact_sensitive_text
from ..eks_deployer import EKSDeployer
from .cloud_ops_panel import CloudOpsPanel
from .cloud_pipeline_panel import CloudPipelinePanel
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
            on_complete=lambda: self.ops_panel.refresh_async(include_http=True),
        )
        self.append(self.pipeline_panel)

        self.ops_panel = CloudOpsPanel(
            self.pm,
            self._on_step_event,
            get_aws_env=self.pipeline_panel.get_runtime_aws_env,
        )
        self.append(self.ops_panel)

        # Host power / teardown controls
        host_bar = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
        self.btn_pause = Gtk.Button(label="Pause Host")
        self.btn_pause.connect("clicked", lambda _: self._run_infra_op("infra_stop", "Pause Host", "infra_stop"))

        self.btn_resume = Gtk.Button(label="Resume Host")
        self.btn_resume.connect("clicked", lambda _: self._run_infra_op("infra_start", "Resume Host", "infra_start"))

        self.btn_destroy = Gtk.Button(label="Destroy Host")
        self.btn_destroy.add_css_class("destructive-action")
        self.btn_destroy.connect("clicked", lambda _: self._run_infra_op("infra_destroy", "Destroy Host", "infra_destroy"))

        for w in (self.btn_pause, self.btn_resume, self.btn_destroy):
            host_bar.append(w)
        self.append(host_bar)

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
        self.append(eks_actions_card)

        self.eks_pref_group = Adw.PreferencesGroup()
        self.eks_pref_group.set_title("AWS EKS Managed Kubernetes Cluster")
        self.eks_pref_group.set_description("1-Click provisioning of AWS EKS control plane (1.32) and Spot worker nodes (ap-south-1).")
        self.row_eks = Adw.ActionRow(title="Cluster: envscale-todo-eks", subtitle="Checking AWS EKS state...")
        self.badge_eks_status = Gtk.Label(label="CHECKING")
        self.badge_eks_status.add_css_class("accent")
        self.row_eks.add_suffix(self.badge_eks_status)
        self.eks_pref_group.add(self.row_eks)
        self.append(self.eks_pref_group)

        self.append(self.log_panel)
        self._refresh_status()

    def _on_step_event(self, step_id: str, title: str, status: str, detail: str) -> None:
        safe_title = redact_sensitive_text(title)
        safe_detail = redact_sensitive_text(detail)
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

    def _run_infra_op(self, op_id: str, title: str, method_name: str) -> None:
        def _task():
            try:
                deployer = CloudDeployer(
                    step_fn=self._on_step_event,
                    aws_env=self.pipeline_panel.get_runtime_aws_env(),
                )
                getattr(deployer, method_name)()
            except Exception as exc:
                err_id = f"{op_id}_error"
                msg = redact_sensitive_text(f"{type(exc).__name__}: {exc}")
                self._on_step_event(err_id, f"{title} failed", "start", msg)
                self._on_step_event(err_id, f"{title} failed", "log", traceback.format_exc().rstrip())
                self._on_step_event(err_id, f"{title} failed", "error", msg)
                self.pm.emit_log("system", f"[cloud] {title} failed: {msg}")
            finally:
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
