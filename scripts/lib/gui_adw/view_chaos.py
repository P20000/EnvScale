import threading
import gi
gi.require_version('Gtk', '4.0')
gi.require_version('Adw', '1')
from gi.repository import Gtk, Adw, GLib
from ..chaos_runner import ChaosRunner, CHAOS_SCENARIOS

class ChaosView(Gtk.Box):
    def __init__(self, process_manager):
        super().__init__(orientation=Gtk.Orientation.VERTICAL, spacing=16)
        self.pm = process_manager
        self.cr = ChaosRunner(log_fn=lambda m: self.pm.emit_log("k8s", m))
        self.set_margin_top(16)
        self.set_margin_bottom(16)
        self.set_margin_start(24)
        self.set_margin_end(24)

        pref_group = Adw.PreferencesGroup()
        pref_group.set_title("Chaos Engineering &amp; Anomaly Testing")
        pref_group.set_description("Inject live Kubernetes faults into testing workloads to verify EnvScale's real-time detection.")
        self.append(pref_group)

        for cid, s in CHAOS_SCENARIOS.items():
            row = Adw.ActionRow()
            row.set_title(s["name"])
            row.set_subtitle(s["description"])

            ctrl_box = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
            btn_inject = Gtk.Button(label="Inject Fault")
            btn_inject.add_css_class("destructive-action")
            btn_inject.connect("clicked", lambda _, sc=cid: threading.Thread(target=self.cr.inject_scenario, args=(sc,), daemon=True).start())

            btn_recover = Gtk.Button(label="Recover")
            btn_recover.add_css_class("suggested-action")
            btn_recover.connect("clicked", lambda _, sc=cid: threading.Thread(target=self.cr.recover_scenario, args=(sc,), daemon=True).start())

            ctrl_box.append(btn_inject)
            ctrl_box.append(btn_recover)
            row.add_suffix(ctrl_box)

            pref_group.add(row)

        info_label = Gtk.Label(
            label="💡 Tip: Keep EnvScale UI open at http://localhost:5173 while injecting faults\n"
                  "to observe real-time incident alerts, topology color shifts, and pod logs."
        )
        info_label.set_xalign(0)
        info_label.add_css_class("dim-label")
        self.append(info_label)
