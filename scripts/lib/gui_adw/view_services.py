import threading
import subprocess
import gi
gi.require_version('Gtk', '4.0')
gi.require_version('Adw', '1')
from gi.repository import Gtk, Adw, GLib
from ..config import SERVICES, SERVICE_ORDER, PROJECT_ROOT
from ..health_checker import check_service_health
from ..browser_utils import open_browser_url

class ServicesView(Gtk.Box):
    def __init__(self, process_manager):
        super().__init__(orientation=Gtk.Orientation.VERTICAL, spacing=16)
        self.pm = process_manager
        self.set_margin_top(16)
        self.set_margin_bottom(16)
        self.set_margin_start(24)
        self.set_margin_end(24)

        # Quick Actions Bar
        actions_card = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=12)
        
        self.btn_launch_all = Gtk.Button(label="🚀 Launch Full Stack")
        self.btn_launch_all.add_css_class("suggested-action")
        self.btn_launch_all.connect("clicked", self._on_launch_all_clicked)

        self.btn_stop_all = Gtk.Button(label="🛑 Stop All")
        self.btn_stop_all.add_css_class("destructive-action")
        self.btn_stop_all.connect("clicked", self._on_stop_all_clicked)

        self.btn_open_web = Gtk.Button(label="🌐 Open Web UI")
        self.btn_open_web.connect("clicked", lambda _: open_browser_url("http://localhost:5173", log_fn=lambda m: self.pm.emit_log("web", m)))

        self.btn_db_seed = Gtk.Button(label="🌱 Seed Database")
        self.btn_db_seed.connect("clicked", self._on_db_seed_clicked)

        actions_card.append(self.btn_launch_all)
        actions_card.append(self.btn_stop_all)
        actions_card.append(self.btn_open_web)
        actions_card.append(self.btn_db_seed)
        self.append(actions_card)

        # Services Preferences Group
        self.pref_group = Adw.PreferencesGroup()
        self.pref_group.set_title("Managed Microservices &amp; Data Stores")
        self.pref_group.set_description("Granular lifecycle management, health inspection, and live latency monitoring.")
        self.append(self.pref_group)

        self.service_rows = {}
        for sid in SERVICE_ORDER:
            svc = SERVICES[sid]
            row = Adw.ActionRow()
            row.set_title(svc["name"])
            row.set_subtitle(f"Category: {svc['category']} | Port: {svc['port']}")

            # Health badge
            badge = Gtk.Label(label="OFFLINE")
            badge.add_css_class("error")
            row.add_suffix(badge)

            # Controls Box
            ctrl_box = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=6)

            btn_start = Gtk.Button(label="Start")
            btn_start.connect("clicked", lambda _, s=sid: threading.Thread(target=self.pm.start_service, args=(s,), daemon=True).start())

            btn_restart = Gtk.Button(label="Restart")
            btn_restart.connect("clicked", lambda _, s=sid: threading.Thread(target=self.pm.restart_service, args=(s,), daemon=True).start())

            btn_stop = Gtk.Button(label="Stop")
            btn_stop.add_css_class("flat")
            btn_stop.connect("clicked", lambda _, s=sid: threading.Thread(target=self.pm.stop_service, args=(s,), daemon=True).start())

            ctrl_box.append(btn_start)
            ctrl_box.append(btn_restart)
            ctrl_box.append(btn_stop)
            row.add_suffix(ctrl_box)

            self.pref_group.add(row)
            self.service_rows[sid] = {"row": row, "badge": badge}

        GLib.timeout_add(2500, self.update_health)
        self.update_health()

    def update_health(self):
        def _bg_check():
            statuses = {}
            for sid in SERVICE_ORDER:
                statuses[sid] = check_service_health(sid)

            def _apply():
                for sid, h in statuses.items():
                    data = self.service_rows.get(sid)
                    if not data:
                        continue
                    badge = data["badge"]
                    online = h.get("online", False)
                    if online:
                        badge.set_text(f"ONLINE ({h.get('latency_ms', 0)}ms)")
                        badge.remove_css_class("error")
                        badge.add_css_class("success")
                    else:
                        badge.set_text("OFFLINE")
                        badge.remove_css_class("success")
                        badge.add_css_class("error")
                return False

            GLib.idle_add(_apply)

        threading.Thread(target=_bg_check, daemon=True).start()
        return True

    def _on_launch_all_clicked(self, _):
        def _run():
            self.pm.start_docker_infra()
            for sid in ["api", "streamer", "web"]:
                self.pm.start_service(sid)
        threading.Thread(target=_run, daemon=True).start()

    def _on_stop_all_clicked(self, _):
        threading.Thread(target=self.pm.stop_all, daemon=True).start()

    def _on_db_seed_clicked(self, _):
        def _seed():
            self.pm.emit_log("api", "Executing database seed (npx tsx src/db/seed.ts)...")
            cmd = "npx tsx src/db/seed.ts"
            self.pm.exec_command("api", cmd, cwd=f"{PROJECT_ROOT}/apps/api-server")
            self.pm.emit_log("api", "Database seed completed.")
        threading.Thread(target=_seed, daemon=True).start()
