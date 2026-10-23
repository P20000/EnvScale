import time
import threading
import gi
gi.require_version('Gtk', '4.0')
gi.require_version('Adw', '1')
from gi.repository import Gtk, Adw, GLib
from datetime import datetime
from pathlib import Path

from ..config import SERVICES, SERVICE_ORDER, PROJECT_ROOT
from .log_storage import LogStorage
from .step_row import HeadingLogPanel
from ..health_checker import check_service_health
from ..browser_utils import open_browser_url

class ServicesView(Gtk.Box):
    def __init__(self, process_manager):
        super().__init__(orientation=Gtk.Orientation.VERTICAL, spacing=10)
        self.pm = process_manager
        self.set_margin_top(12)
        self.set_margin_bottom(12)
        self.set_margin_start(16)
        self.set_margin_end(16)

        # Quick Actions Bar
        actions_card = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)

        self.btn_launch_all = Gtk.Button(label="Launch Full Stack")
        self.btn_launch_all.add_css_class("suggested-action")
        self.btn_launch_all.connect("clicked", self._on_launch_all_clicked)

        self.btn_stop_all = Gtk.Button(label="Stop All")
        self.btn_stop_all.add_css_class("destructive-action")
        self.btn_stop_all.connect("clicked", self._on_stop_all_clicked)

        self.btn_open_web = Gtk.Button(label="Open Web UI")
        self.btn_open_web.connect("clicked", lambda _: self._open_web())

        self.btn_db_seed = Gtk.Button(label="Seed Database")
        self.btn_db_seed.connect("clicked", self._on_db_seed_clicked)

        actions_card.append(self.btn_launch_all)
        actions_card.append(self.btn_stop_all)
        actions_card.append(self.btn_open_web)
        actions_card.append(self.btn_db_seed)
        self.append(actions_card)

        # Services Preferences Group
        self.pref_group = Adw.PreferencesGroup()
        self.pref_group.set_title("Managed Microservices &amp; Data Stores")
        self.pref_group.set_description("Lifecycle controls, health inspection, and latency monitoring.")
        self.append(self.pref_group)

        self.service_rows = {}
        for sid in SERVICE_ORDER:
            svc = SERVICES[sid]
            row = Adw.ActionRow()
            row.set_title(svc["name"])
            row.set_subtitle(f"{svc['category'].capitalize()} • Port: {svc['port']}")

            # Health badge
            badge = Gtk.Label(label="OFFLINE")
            badge.add_css_class("error")
            row.add_suffix(badge)

            # Controls Box
            ctrl_box = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=4)

            btn_start = Gtk.Button(label="Start")
            btn_start.connect("clicked", lambda _, s=sid: self._on_service_action(s, "start"))

            btn_restart = Gtk.Button(label="Restart")
            btn_restart.connect("clicked", lambda _, s=sid: self._on_service_action(s, "restart"))

            btn_stop = Gtk.Button(label="Stop")
            btn_stop.add_css_class("flat")
            btn_stop.connect("clicked", lambda _, s=sid: self._on_service_action(s, "stop"))

            ctrl_box.append(btn_start)
            ctrl_box.append(btn_restart)
            ctrl_box.append(btn_stop)
            row.add_suffix(ctrl_box)

            self.pref_group.add(row)
            self.service_rows[sid] = {"row": row, "badge": badge}

        # Dedicated Heading-Based Terminal Log Panel with persistent JSON storage
        self.log_storage = LogStorage()
        self.log_panel = HeadingLogPanel("services", self.log_storage)
        self.append(self.log_panel)

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

    def _run_with_step(self, title: str, command: str, target_fn, *args):
        """Execute a task in a background thread while streaming emitted logs into a new StepRow."""
        step_id = f"srv_{int(time.time() * 1000)}"
        row = self.log_panel.create_step(step_id, title, command)

        def _log_listener(service, ts, msg):
            GLib.idle_add(lambda: row.append_log(f"[{ts}] [{service}] {msg}"))

        def _worker():
            self.pm.subscribe(_log_listener)
            try:
                success, detail = target_fn(*args)
                GLib.idle_add(lambda: self.log_panel.complete_step(step_id, success, detail))
            except Exception as e:
                err_msg = str(e) or type(e).__name__
                GLib.idle_add(lambda: row.append_log(f"[ERROR] {err_msg}"))
                GLib.idle_add(lambda: self.log_panel.complete_step(step_id, False, err_msg))
            finally:
                self.pm.unsubscribe(_log_listener)

        threading.Thread(target=_worker, daemon=True).start()

    def _on_launch_all_clicked(self, _):
        def _task():
            self.pm.emit_log("system", "Starting database infrastructure containers...")
            self.pm.start_docker_infra()
            self.pm.emit_log("system", "Spawning core microservices (api, streamer, web)...")
            for sid in ["api", "streamer", "web"]:
                self.pm.start_service(sid)
            return True, "Full stack launched & containers active"

        self._run_with_step(
            title="Launch Full Stack",
            command="docker compose up & start all microservices",
            target_fn=_task,
        )

    def _on_stop_all_clicked(self, _):
        def _task():
            self.pm.stop_all()
            return True, "All microservices and database containers stopped"

        self._run_with_step(
            title="Stop All Services",
            command="Graceful SIGTERM & docker down",
            target_fn=_task,
        )

    def _on_db_seed_clicked(self, _):
        def _task():
            self.pm.emit_log("api", "Executing database seed (npx tsx src/db/seed.ts)...")
            code = self.pm.exec_command("api", "npx tsx src/db/seed.ts", cwd=f"{PROJECT_ROOT}/apps/api-server")
            if code == 0:
                return True, "Database seeded successfully"
            return False, f"Database seed exited with error code {code}"

        self._run_with_step(
            title="Seed Database",
            command="npx tsx src/db/seed.ts",
            target_fn=_task,
        )

    def _open_web(self):
        url = "http://localhost:5173"
        step_id = f"web_{int(time.time() * 1000)}"
        row = self.log_panel.create_step(step_id, "Open Web UI", f"xdg-open {url}")
        try:
            open_browser_url(url, log_fn=lambda m: GLib.idle_add(lambda: row.append_log(m)))
            self.log_panel.complete_step(step_id, True, f"Opened {url} in default browser")
        except Exception as e:
            self.log_panel.complete_step(step_id, False, str(e))

    def _on_service_action(self, sid: str, action: str):
        svc = SERVICES.get(sid, {})
        name = svc.get("name", sid)

        def _task():
            if action == "start":
                ok = self.pm.start_service(sid)
                return ok, f"{name} started" if ok else f"Failed to start {name}"
            elif action == "restart":
                self.pm.restart_service(sid)
                return True, f"{name} restarted"
            elif action == "stop":
                self.pm.stop_service(sid)
                return True, f"{name} stopped"
            return False, "Unknown action"

        self._run_with_step(
            title=f"{action.capitalize()} {name}",
            command=f"pm.{action}_service('{sid}')",
            target_fn=_task,
        )
