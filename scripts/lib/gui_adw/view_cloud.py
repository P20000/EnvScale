import threading
import traceback
import gi
gi.require_version('Gtk', '4.0')
gi.require_version('Adw', '1')
from gi.repository import Gtk, Adw, GLib
from ..cloud_deployer import CloudDeployer
from ..browser_utils import open_browser_url

class StepRow(Adw.ExpanderRow):
    def __init__(self, step_id: str, title: str, command: str = ""):
        super().__init__()
        self.step_id = step_id
        self.set_title(title)
        self.set_subtitle(command if command else "Executing...")
        self.set_expanded(True)

        # Status spinner or badge
        self.suffix_box = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
        self.spinner = Gtk.Spinner()
        self.spinner.start()
        self.suffix_box.append(self.spinner)

        self.badge = Gtk.Label(label="RUNNING")
        self.badge.add_css_class("accent")
        self.suffix_box.append(self.badge)
        self.add_suffix(self.suffix_box)

        # Dropdown sub-log viewer
        log_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=4)
        log_box.set_margin_top(8)
        log_box.set_margin_bottom(8)
        log_box.set_margin_start(16)
        log_box.set_margin_end(16)

        scroller = Gtk.ScrolledWindow()
        scroller.set_min_content_height(140)
        scroller.set_max_content_height(300)

        self.text_view = Gtk.TextView()
        self.text_view.set_editable(False)
        self.text_view.set_cursor_visible(False)
        self.text_view.set_monospace(True)
        self.text_view.set_wrap_mode(Gtk.WrapMode.WORD_CHAR)
        self.buffer = self.text_view.get_buffer()

        scroller.set_child(self.text_view)
        log_box.append(scroller)
        self.add_row(log_box)

    def append_log(self, line: str):
        end = self.buffer.get_end_iter()
        self.buffer.insert(end, line + "\n")
        # Adjustment bounds update only after relayout, so scroll via a
        # right-gravity end mark on the next idle cycle.
        if not hasattr(self, "_end_mark"):
            self._end_mark = self.buffer.create_mark("end", self.buffer.get_end_iter(), False)
        else:
            self.buffer.move_mark(self._end_mark, self.buffer.get_end_iter())
        GLib.idle_add(self._scroll_to_end)

    def _scroll_to_end(self):
        self.text_view.scroll_to_mark(self._end_mark, 0.0, True, 0.0, 1.0)
        return False

    def mark_success(self, detail: str = ""):
        self.spinner.stop()
        self.suffix_box.remove(self.spinner)
        self.badge.set_text("✔ Completed")
        self.badge.remove_css_class("accent")
        self.badge.add_css_class("success")
        if detail:
            self.set_subtitle(detail)
        self.set_expanded(False)

    def mark_error(self, err_msg: str):
        self.spinner.stop()
        self.suffix_box.remove(self.spinner)
        self.badge.set_text("✘ Failed")
        self.badge.remove_css_class("accent")
        self.badge.add_css_class("error")
        if err_msg:
            self.set_subtitle(err_msg)
        self.set_expanded(True)


class CloudView(Gtk.Box):
    def __init__(self, process_manager):
        super().__init__(orientation=Gtk.Orientation.VERTICAL, spacing=16)
        self.pm = process_manager
        self.set_margin_top(16)
        self.set_margin_bottom(16)
        self.set_margin_start(24)
        self.set_margin_end(24)

        # Quick Actions Bar
        actions_card = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=12)

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

        self.btn_destroy = Gtk.Button(label="Destroy Infrastructure")
        self.btn_destroy.add_css_class("destructive-action")
        self.btn_destroy.connect("clicked", self._on_destroy_clicked)

        actions_card.append(self.btn_up)
        actions_card.append(self.btn_pause)
        actions_card.append(self.btn_resume)
        actions_card.append(self.btn_deploy)
        actions_card.append(self.btn_open_cloud)
        actions_card.append(self.btn_destroy)
        self.append(actions_card)

        # Status Group with properly escaped XML entity (&amp;)
        self.pref_group = Adw.PreferencesGroup()
        self.pref_group.set_title("AWS Cloud Infrastructure &amp; Dynamic DNS")
        self.pref_group.set_description("Lifecycle management of the AWS EC2 integration host, DuckDNS routing, and TLS security.")
        self.append(self.pref_group)

        # Public IP Row
        self.row_ip = Adw.ActionRow()
        self.row_ip.set_title("EC2 Elastic IP")
        self.row_ip.set_subtitle("Checking AWS state...")
        self.badge_status = Gtk.Label(label="CHECKING")
        self.badge_status.add_css_class("accent")
        self.row_ip.add_suffix(self.badge_status)
        self.pref_group.add(self.row_ip)

        # DuckDNS Row
        self.row_dns = Adw.ActionRow()
        self.row_dns.set_title("Domain Routing")
        self.row_dns.set_subtitle("https://envscale.duckdns.org")
        self.badge_dns = Gtk.Label(label="DUCKDNS")
        self.row_dns.add_suffix(self.badge_dns)
        self.pref_group.add(self.row_dns)

        # Step Showcase Section
        self.step_group = Adw.PreferencesGroup()
        self.step_group.set_title("Cloud Operations Step Showcase")
        self.step_group.set_description("Live tracking of real-time cloud commands, dynamic dot-loader execution, and expandable logs.")
        self.append(self.step_group)

        self.step_rows = {}
        self._refresh_status()

    def _on_step_event(self, step_id: str, title: str, status: str, detail: str):
        def _apply():
            if status == "start":
                row = StepRow(step_id, title, command=detail)
                self.step_rows[step_id] = row
                self.step_group.add(row)
            elif step_id in self.step_rows:
                row = self.step_rows[step_id]
                if status == "log":
                    row.append_log(detail)
                elif status == "success":
                    row.mark_success(detail)
                elif status == "error":
                    row.mark_error(detail)
        GLib.idle_add(_apply)

    def _log(self, text: str):
        pass

    def _refresh_status(self):
        def _task():
            deployer = CloudDeployer()
            ip = deployer.get_public_ip()
            instance_id = deployer.get_instance_id()
            def _update():
                if ip:
                    self.row_ip.set_subtitle(f"Instance: {instance_id} | Public IP: {ip}")
                    self.badge_status.set_text("ONLINE")
                    self.badge_status.remove_css_class("error")
                    self.badge_status.remove_css_class("accent")
                    self.badge_status.add_css_class("success")
                else:
                    self.row_ip.set_subtitle("No active instance found in Terraform state")
                    self.badge_status.set_text("OFFLINE")
                    self.badge_status.remove_css_class("success")
                    self.badge_status.add_css_class("error")
            GLib.idle_add(_update)
        threading.Thread(target=_task, daemon=True).start()

    def _clear_steps(self):
        def _do():
            for row in self.step_rows.values():
                self.step_group.remove(row)
            self.step_rows.clear()
        GLib.idle_add(_do)

    def _run_infra_op(self, op_id: str, title: str, method_name: str):
        """Run a CloudDeployer lifecycle method off the UI thread, surfacing failures."""
        self._clear_steps()
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
        self._clear_steps()
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
