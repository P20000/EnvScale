import time
import threading
import gi
gi.require_version('Gtk', '4.0')
gi.require_version('Adw', '1')
from gi.repository import Gtk, Adw, GLib
from datetime import datetime
from pathlib import Path

from ..k8s_manager import K8sManager
from .log_storage import LogStorage
from .step_row import HeadingLogPanel
from ..browser_utils import open_browser_url

class K8sView(Gtk.Box):
    def __init__(self, process_manager):
        super().__init__(orientation=Gtk.Orientation.VERTICAL, spacing=10)
        self.pm = process_manager
        self.active_step_row = None
        self.km = K8sManager(log_fn=self._on_k8s_log)

        self.set_margin_top(12)
        self.set_margin_bottom(12)
        self.set_margin_start(16)
        self.set_margin_end(16)

        # Context Selection Card
        ctx_group = Adw.PreferencesGroup()
        ctx_group.set_title("Kubernetes Cluster Environment")
        ctx_group.set_description("Select active cluster context and manage testing workloads.")

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
        workload_row.set_subtitle("Canary, Backend, Frontend, Ingress, CronJobs, HPA, and NetworkPolicies")

        ctrl_box = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=6)
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
        self.progress_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=4)
        self.lbl_status = Gtk.Label(label="Status: Ready")
        self.lbl_status.set_xalign(0)
        self.progress_bar = Gtk.ProgressBar()
        self.progress_bar.set_fraction(0.0)
        self.progress_box.append(self.lbl_status)
        self.progress_box.append(self.progress_bar)
        self.append(self.progress_box)

        # Dedicated Heading-Based Terminal Log Panel with persistent JSON storage
        self.log_storage = LogStorage()
        self.log_panel = HeadingLogPanel("k8s", self.log_storage)
        self.append(self.log_panel)

    def _on_k8s_log(self, msg: str):
        self.pm.emit_log("k8s", msg)
        row = self.active_step_row
        if row:
            GLib.idle_add(lambda: row.append_log(msg))

    def _on_context_changed(self, *_):
        item = self.ctx_dropdown.get_selected_item()
        if not item:
            return
        ctx_name = item.get_string()
        current = self.km.get_current_context()
        if ctx_name == current:
            return

        step_id = f"ctx_{int(time.time() * 1000)}"
        row = self.log_panel.create_step(step_id, f"Switch Context: {ctx_name}", f"kubectl config use-context {ctx_name}")
        self.active_step_row = row

        def _switch():
            try:
                ok = self.km.switch_context(ctx_name)
                GLib.idle_add(lambda: self.log_panel.complete_step(step_id, ok, f"Switched to {ctx_name}" if ok else "Failed"))
            except Exception as e:
                GLib.idle_add(lambda: self.log_panel.complete_step(step_id, False, str(e)))
            finally:
                self.active_step_row = None

        threading.Thread(target=_switch, daemon=True).start()

    def _set_progress(self, text, fraction):
        def _u():
            self.lbl_status.set_text(f"Status: {text}")
            self.progress_bar.set_fraction(fraction)
            return False
        GLib.idle_add(_u)

    def _on_deploy_clicked(self, _):
        step_id = f"k8s_deploy_{int(time.time() * 1000)}"
        row = self.log_panel.create_step(step_id, "Deploy Workloads (15 Manifests)", "kubectl apply -f testing/k8s/")
        self.active_step_row = row

        def _run():
            self._set_progress("Deploying workloads...", 0.05)
            GLib.idle_add(lambda: self.btn_deploy.set_sensitive(False))
            try:
                ok = self.km.deploy_test_suite(progress_cb=self._set_progress)
                detail = "Testing workload suite deployed successfully" if ok else "Deploy encountered errors"
                GLib.idle_add(lambda: self.log_panel.complete_step(step_id, ok, detail))
            except Exception as e:
                err_msg = str(e)
                GLib.idle_add(lambda: row.append_log(f"[ERROR] {err_msg}"))
                GLib.idle_add(lambda: self.log_panel.complete_step(step_id, False, err_msg))
            finally:
                self.active_step_row = None
                GLib.idle_add(lambda: self.btn_deploy.set_sensitive(True))

        threading.Thread(target=_run, daemon=True).start()

    def _on_teardown_clicked(self, _):
        step_id = f"k8s_teardown_{int(time.time() * 1000)}"
        row = self.log_panel.create_step(step_id, "Teardown Workloads", "kubectl delete -f testing/k8s/")
        self.active_step_row = row

        def _run():
            self._set_progress("Tearing down workloads...", 0.1)
            GLib.idle_add(lambda: self.btn_teardown.set_sensitive(False))
            try:
                ok = self.km.teardown_test_suite(progress_cb=self._set_progress)
                detail = "Test suite resources removed" if ok else "Teardown encountered errors"
                GLib.idle_add(lambda: self.log_panel.complete_step(step_id, ok, detail))
            except Exception as e:
                err_msg = str(e)
                GLib.idle_add(lambda: row.append_log(f"[ERROR] {err_msg}"))
                GLib.idle_add(lambda: self.log_panel.complete_step(step_id, False, err_msg))
            finally:
                self.active_step_row = None
                GLib.idle_add(lambda: self.btn_teardown.set_sensitive(True))

        threading.Thread(target=_run, daemon=True).start()

    def _on_open_ingress_clicked(self, _):
        url = self.km.get_ingress_url()
        if not url:
            return
        step_id = f"k8s_ingress_{int(time.time() * 1000)}"
        row = self.log_panel.create_step(step_id, "Open Ingress URL", f"xdg-open {url}")
        try:
            open_browser_url(url, log_fn=lambda m: GLib.idle_add(lambda: row.append_log(m)))
            self.log_panel.complete_step(step_id, True, f"Opened {url} in default browser")
        except Exception as e:
            self.log_panel.complete_step(step_id, False, str(e))
