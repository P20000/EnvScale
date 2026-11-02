import threading
import traceback
import gi
gi.require_version('Gtk', '4.0')
gi.require_version('Adw', '1')
from gi.repository import Gtk, Adw, GLib

from ..cloud_deployer import CloudDeployer
from ..eks_deployer import EKSDeployer
from ..browser_utils import open_browser_url
from .log_storage import LogStorage
from .step_row import HeadingLogPanel

class CloudView(Gtk.Box):
    def __init__(self, process_manager):
        super().__init__(orientation=Gtk.Orientation.VERTICAL, spacing=10)
        self.pm = process_manager
        self.set_margin_top(12)
        self.set_margin_bottom(12)
        self.set_margin_start(16)
        self.set_margin_end(16)

        # -------------------------------------------------------------
        # 1. AWS EC2 Host Quick Actions Bar
        # -------------------------------------------------------------
        actions_card = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)

        self.btn_up = Gtk.Button(label="Provision Host")
        self.btn_up.add_css_class("suggested-action")
        self.btn_up.connect("clicked", self._on_infra_up_clicked)

        self.btn_pause = Gtk.Button(label="Pause Host")
        self.btn_pause.connect("clicked", self._on_infra_stop_clicked)

        self.btn_resume = Gtk.Button(label="Resume Host")
        self.btn_resume.connect("clicked", self._on_infra_start_clicked)

        self.btn_deploy = Gtk.Button(label="Deploy Stack")
        self.btn_deploy.connect("clicked", self._on_deploy_clicked)

        self.btn_open_cloud = Gtk.Button(label="Open Cloud URL")
        self.btn_open_cloud.connect("clicked", lambda _: open_browser_url("https://envscale.duckdns.org", log_fn=lambda m: self._log(m)))

        self.btn_destroy = Gtk.Button(label="Destroy Host")
        self.btn_destroy.add_css_class("destructive-action")
        self.btn_destroy.connect("clicked", self._on_destroy_clicked)

        actions_card.append(self.btn_up)
        actions_card.append(self.btn_pause)
        actions_card.append(self.btn_resume)
        actions_card.append(self.btn_deploy)
        actions_card.append(self.btn_open_cloud)
        actions_card.append(self.btn_destroy)
        self.append(actions_card)

        # -------------------------------------------------------------
        # 2. AWS EC2 & DNS Status Group
        # -------------------------------------------------------------
        self.pref_group = Adw.PreferencesGroup()
        self.pref_group.set_title("AWS EC2 Integration Host &amp; Dynamic DNS")
        self.pref_group.set_description("Lifecycle management of the AWS EC2 production host, DuckDNS routing, and TLS reverse proxy.")
        self.append(self.pref_group)

        self.row_ip = Adw.ActionRow()
        self.row_ip.set_title("EC2 Elastic IP")
        self.row_ip.set_subtitle("Checking AWS state...")
        self.badge_status = Gtk.Label(label="CHECKING")
        self.badge_status.add_css_class("accent")
        self.row_ip.add_suffix(self.badge_status)
        self.pref_group.add(self.row_ip)

        self.row_dns = Adw.ActionRow()
        self.row_dns.set_title("Domain Routing")
        self.row_dns.set_subtitle("https://envscale.duckdns.org")
        self.badge_dns = Gtk.Label(label="DUCKDNS")
        self.row_dns.add_suffix(self.badge_dns)
        self.pref_group.add(self.row_dns)

        # -------------------------------------------------------------
        # 3. AWS EKS Managed Kubernetes Cluster Section
        # -------------------------------------------------------------
        eks_actions_card = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
        eks_actions_card.set_margin_top(4)

        self.btn_eks_up = Gtk.Button(label="Provision EKS Cluster")
        self.btn_eks_up.add_css_class("suggested-action")
        self.btn_eks_up.connect("clicked", self._on_eks_up_clicked)

        self.btn_eks_workloads = Gtk.Button(label="Deploy Todo Workloads")
        self.btn_eks_workloads.connect("clicked", self._on_eks_workloads_clicked)

        self.btn_eks_destroy = Gtk.Button(label="Destroy EKS Cluster")
        self.btn_eks_destroy.add_css_class("destructive-action")
        self.btn_eks_destroy.connect("clicked", self._on_eks_destroy_clicked)

        eks_actions_card.append(self.btn_eks_up)
        eks_actions_card.append(self.btn_eks_workloads)
        eks_actions_card.append(self.btn_eks_destroy)
        self.append(eks_actions_card)

        self.eks_pref_group = Adw.PreferencesGroup()
        self.eks_pref_group.set_title("AWS EKS Managed Kubernetes Cluster")
        self.eks_pref_group.set_description("1-Click provisioning of AWS EKS control plane (1.32) and Spot worker nodes (ap-south-1).")
        self.append(self.eks_pref_group)

        self.row_eks = Adw.ActionRow()
        self.row_eks.set_title("Cluster: envscale-todo-eks")
        self.row_eks.set_subtitle("Checking AWS EKS state...")
        self.badge_eks_status = Gtk.Label(label="CHECKING")
        self.badge_eks_status.add_css_class("accent")
        self.row_eks.add_suffix(self.badge_eks_status)
        self.eks_pref_group.add(self.row_eks)

        self.row_eks_nodes = Adw.ActionRow()
        self.row_eks_nodes.set_title("Worker Nodegroup")
        self.row_eks_nodes.set_subtitle("1x t3.medium SPOT node (auto-scaling 1-2) | VPC 10.100.0.0/16")
        self.badge_eks_region = Gtk.Label(label="AP-SOUTH-1")
        self.row_eks_nodes.add_suffix(self.badge_eks_region)
        self.eks_pref_group.add(self.row_eks_nodes)

        # -------------------------------------------------------------
        # 4. Terminal Log Panel
        # -------------------------------------------------------------
        self.log_storage = LogStorage()
        self.log_panel = HeadingLogPanel("cloud", self.log_storage)
        self.append(self.log_panel)

        self._refresh_status()

    def _on_step_event(self, step_id: str, title: str, status: str, detail: str):
        def _apply():
            if status == "start":
                self.log_panel.create_step(step_id, title, command=detail)
            elif status == "log":
                self.log_panel.append_log(step_id, detail)
            elif status == "success":
                self.log_panel.complete_step(step_id, True, detail)
            elif status == "error":
                self.log_panel.complete_step(step_id, False, detail)
        GLib.idle_add(_apply)

    def _log(self, text: str):
        pass

    def _refresh_status(self):
        def _task():
            # Refresh EC2 State
            deployer = CloudDeployer()
            ip = deployer.get_public_ip()
            instance_id = deployer.get_instance_id()

            # Refresh EKS State
            eks = EKSDeployer()
            eks_st = eks.get_cluster_status()

            def _update():
                if ip:
                    self.row_ip.set_subtitle(f"Instance: {instance_id} | Public IP: {ip}")
                    self.badge_status.set_text("ONLINE")
                    self.badge_status.remove_css_class("error")
                    self.badge_status.remove_css_class("accent")
                    self.badge_status.add_css_class("success")
                else:
                    self.row_ip.set_subtitle("No active EC2 instance found in Terraform state")
                    self.badge_status.set_text("OFFLINE")
                    self.badge_status.remove_css_class("success")
                    self.badge_status.remove_css_class("accent")
                    self.badge_status.add_css_class("error")

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

    def _run_infra_op(self, op_id: str, title: str, method_name: str):
        def _task():
            try:
                deployer = CloudDeployer(step_fn=self._on_step_event)
                getattr(deployer, method_name)()
            except Exception as e:
                err_id = f"{op_id}_error"
                msg = f"{type(e).__name__}: {e}"
                self._on_step_event(err_id, f"{title} failed", "start", msg)
                self._on_step_event(err_id, f"{title} failed", "log", traceback.format_exc().rstrip())
                self._on_step_event(err_id, f"{title} failed", "error", msg)
                self.pm.emit_log("system", f"[cloud] {title} failed: {msg}")
            finally:
                self._refresh_status()
        threading.Thread(target=_task, daemon=True).start()

    def _on_infra_up_clicked(self, _):
        self._run_infra_op("infra_up", "Provision Host", "infra_up")

    def _on_infra_stop_clicked(self, _):
        self._run_infra_op("infra_stop", "Pause Host", "infra_stop")

    def _on_infra_start_clicked(self, _):
        self._run_infra_op("infra_start", "Resume Host", "infra_start")

    def _on_deploy_clicked(self, _):
        def _task():
            try:
                s1, t1 = "deploy_dispatch", "Dispatching Deployment to Cloud Host"
                self._on_step_event(s1, t1, "start", "./envscale.sh deploy")
                deployer = CloudDeployer(step_fn=self._on_step_event)
                deployer.deploy(step_id=s1, step_title=t1)
                self._on_step_event(s1, t1, "success", "All containers up & healthy")
            except Exception as e:
                self._on_step_event("deploy_dispatch", "Dispatching Deployment", "error", str(e))
            finally:
                self._refresh_status()
        threading.Thread(target=_task, daemon=True).start()

    def _on_destroy_clicked(self, _):
        self._run_infra_op("infra_destroy", "Destroy Infrastructure", "infra_destroy")

    # -------------------------------------------------------------
    # EKS Event Handlers
    # -------------------------------------------------------------
    def _run_eks_op(self, op_id: str, title: str, method_name: str):
        def _task():
            GLib.idle_add(lambda: self.btn_eks_up.set_sensitive(False))
            GLib.idle_add(lambda: self.btn_eks_destroy.set_sensitive(False))
            GLib.idle_add(lambda: self.btn_eks_workloads.set_sensitive(False))
            try:
                deployer = EKSDeployer(step_fn=self._on_step_event)
                getattr(deployer, method_name)()
            except Exception as e:
                err_id = f"{op_id}_error"
                msg = f"{type(e).__name__}: {e}"
                self._on_step_event(err_id, f"{title} failed", "start", msg)
                self._on_step_event(err_id, f"{title} failed", "log", traceback.format_exc().rstrip())
                self._on_step_event(err_id, f"{title} failed", "error", msg)
                self.pm.emit_log("system", f"[eks] {title} failed: {msg}")
            finally:
                GLib.idle_add(lambda: self.btn_eks_up.set_sensitive(True))
                GLib.idle_add(lambda: self.btn_eks_destroy.set_sensitive(True))
                GLib.idle_add(lambda: self.btn_eks_workloads.set_sensitive(True))
                self._refresh_status()
        threading.Thread(target=_task, daemon=True).start()

    def _on_eks_up_clicked(self, _):
        self._run_eks_op("eks_up", "Provision EKS Cluster", "eks_up")

    def _on_eks_destroy_clicked(self, _):
        self._run_eks_op("eks_destroy", "Destroy EKS Cluster", "eks_destroy")

    def _on_eks_workloads_clicked(self, _):
        self._run_eks_op("eks_deploy", "Deploy EKS Workloads", "deploy_workloads")
