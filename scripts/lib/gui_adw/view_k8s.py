import threading
import subprocess
import gi
gi.require_version('Gtk', '4.0')
gi.require_version('Adw', '1')
from gi.repository import Gtk, Adw, GLib
from ..k8s_manager import K8sManager
from ..browser_utils import open_browser_url

class K8sView(Gtk.Box):
    def __init__(self, process_manager):
        super().__init__(orientation=Gtk.Orientation.VERTICAL, spacing=16)
        self.pm = process_manager
        self.km = K8sManager(log_fn=lambda m: self.pm.emit_log("k8s", m))
        self.set_margin_top(16)
        self.set_margin_bottom(16)
        self.set_margin_start(24)
        self.set_margin_end(24)

        # Context Selection Card
        ctx_group = Adw.PreferencesGroup()
        ctx_group.set_title("Kubernetes Cluster Environment")
        ctx_group.set_description("Select active cluster context and manage testing workloads (Canary, CronJobs, Ingress).")

        self.ctx_row = Adw.ActionRow()
        self.ctx_row.set_title("Active Kubernetes Context")

        contexts = self.km.get_available_contexts() or ["none"]
        current = self.km.get_current_context() or contexts[0]

        string_list = Gtk.StringList.new(contexts)
        self.ctx_dropdown = Gtk.DropDown.new(string_list, None)
        if current in contexts:
            self.ctx_dropdown.set_selected(contexts.index(current))
        self.ctx_dropdown.connect("notify::selected-item", self._on_context_changed)
        self.ctx_row.add_suffix(self.ctx_dropdown)
        ctx_group.add(self.ctx_row)
        self.append(ctx_group)

        # Workload Actions Group
        workload_group = Adw.PreferencesGroup()
        workload_group.set_title("Testing Workloads (15 Manifests)")
        workload_group.set_description("Deploy or remove the EnvScale multi-tier benchmark workloads from testing/k8s/.")

        workload_row = Adw.ActionRow()
        workload_row.set_title("Workload Lifecycle")
        workload_row.set_subtitle("Includes: Canary, Backend, Frontend, Ingress, CronJobs, HPA, and NetworkPolicies")

        ctrl_box = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
        self.btn_deploy = Gtk.Button(label="Deploy Workloads")
        self.btn_deploy.add_css_class("suggested-action")
        self.btn_deploy.connect("clicked", self._on_deploy_clicked)

        self.btn_teardown = Gtk.Button(label="Teardown Workloads")
        self.btn_teardown.add_css_class("destructive-action")
        self.btn_teardown.connect("clicked", self._on_teardown_clicked)

        self.btn_open_ingress = Gtk.Button(label="Open Ingress")
        self.btn_open_ingress.connect("clicked", self._on_open_ingress_clicked)

        ctrl_box.append(self.btn_deploy)
        ctrl_box.append(self.btn_teardown)
        ctrl_box.append(self.btn_open_ingress)
        workload_row.add_suffix(ctrl_box)
        workload_group.add(workload_row)
        self.append(workload_group)

        # Progress Indicator
        self.progress_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=6)
        self.lbl_status = Gtk.Label(label="Status: Ready")
        self.lbl_status.set_xalign(0)
        self.progress_bar = Gtk.ProgressBar()
        self.progress_bar.set_fraction(0.0)
        self.progress_box.append(self.lbl_status)
        self.progress_box.append(self.progress_bar)
        self.append(self.progress_box)

    def _on_context_changed(self, *_):
        item = self.ctx_dropdown.get_selected_item()
        if item:
            ctx_name = item.get_string()
            self.km.switch_context(ctx_name)

    def _set_progress(self, text, fraction):
        def _u():
            self.lbl_status.set_text(f"Status: {text}")
            self.progress_bar.set_fraction(fraction)
            return False
        GLib.idle_add(_u)

    def _on_deploy_clicked(self, _):
        def _run():
            self.btn_deploy.set_sensitive(False)
            self.km.deploy_test_suite(progress_cb=self._set_progress)
            self.btn_deploy.set_sensitive(True)
        threading.Thread(target=_run, daemon=True).start()

    def _on_teardown_clicked(self, _):
        def _run():
            self.btn_teardown.set_sensitive(False)
            self.km.teardown_test_suite(progress_cb=self._set_progress)
            self.btn_teardown.set_sensitive(True)
        threading.Thread(target=_run, daemon=True).start()

    def _on_open_ingress_clicked(self, _):
        url = self.km.get_ingress_url()
        if url:
            open_browser_url(url, log_fn=lambda m: self.pm.emit_log("k8s", m))
