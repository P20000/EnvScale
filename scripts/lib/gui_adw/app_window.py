import sys
import signal
import gi
gi.require_version('Gtk', '4.0')
gi.require_version('Adw', '1')
from gi.repository import Gtk, Adw, Gio, GLib

from ..process_manager import ProcessManager
from ..env_sync import ensure_env_files
from .view_services import ServicesView
from .view_logs import LogsView
from .view_k8s import K8sView
from .view_chaos import ChaosView

class MainWindow(Adw.ApplicationWindow):
    def __init__(self, app, process_manager):
        super().__init__(application=app, title="EnvScale Local Manager")
        self.set_default_size(1080, 750)
        self.pm = process_manager

        ensure_env_files()

        # Main Box
        main_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
        self.set_content(main_box)

        # Header Bar
        header = Adw.HeaderBar()
        title = Adw.WindowTitle(title="EnvScale Local Manager", subtitle="Kubernetes Observability &amp; Governance")
        header.set_title_widget(title)

        # Theme Toggle
        style_mgr = Adw.StyleManager.get_default()
        style_mgr.set_color_scheme(Adw.ColorScheme.PREFER_DARK)

        btn_theme = Gtk.Button(icon_name="weather-clear-night-symbolic")
        btn_theme.set_tooltip_text("Toggle Dark / Light Theme")
        btn_theme.connect("clicked", self._on_toggle_theme)
        header.pack_end(btn_theme)

        main_box.append(header)

        # View Stack & Switcher
        self.view_stack = Adw.ViewStack()
        self.view_stack.set_vexpand(True)

        self.services_view = ServicesView(self.pm)
        self.logs_view = LogsView(self.pm)
        self.k8s_view = K8sView(self.pm)
        self.chaos_view = ChaosView(self.pm)

        self.view_stack.add_titled_with_icon(self.services_view, "services", "Services", "network-server-symbolic")
        self.view_stack.add_titled_with_icon(self.logs_view, "logs", "Live Logs", "utilities-terminal-symbolic")
        self.view_stack.add_titled_with_icon(self.k8s_view, "k8s", "Kubernetes", "emblem-default-symbolic")
        self.view_stack.add_titled_with_icon(self.chaos_view, "chaos", "Chaos Lab", "dialog-warning-symbolic")

        # Top Switcher Bar
        switcher_bar = Adw.ViewSwitcher()
        switcher_bar.set_stack(self.view_stack)
        switcher_bar.set_policy(Adw.ViewSwitcherPolicy.WIDE)
        switcher_box = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL)
        switcher_box.set_halign(Gtk.Align.CENTER)
        switcher_box.set_margin_top(8)
        switcher_box.set_margin_bottom(8)
        switcher_box.append(switcher_bar)

        main_box.append(switcher_box)
        main_box.append(self.view_stack)

        self.connect("close-request", self._on_close_request)

    def _on_toggle_theme(self, _):
        mgr = Adw.StyleManager.get_default()
        if mgr.get_dark():
            mgr.set_color_scheme(Adw.ColorScheme.FORCE_LIGHT)
        else:
            mgr.set_color_scheme(Adw.ColorScheme.FORCE_DARK)

    def _on_close_request(self, _):
        self.pm.stop_all()
        return False

class LocalRunAdwApp(Adw.Application):
    def __init__(self, process_manager):
        super().__init__(application_id="io.envscale.localrun", flags=Gio.ApplicationFlags.FLAGS_NONE)
        self.pm = process_manager

    def do_activate(self):
        win = self.props.active_window
        if not win:
            win = MainWindow(self, self.pm)
        win.present()

class StdoutStderrRedirector:
    def __init__(self, service: str, pm: ProcessManager, fallback=None):
        self.service = service
        self.pm = pm
        self.fallback = fallback
        self._buf = ""

    def write(self, s: str):
        if not s:
            return
        self._buf += s
        while "\n" in self._buf:
            line, self._buf = self._buf.split("\n", 1)
            clean = line.strip()
            if clean:
                self.pm.emit_log(self.service, clean)

    def flush(self):
        clean = self._buf.strip()
        if clean:
            self.pm.emit_log(self.service, clean)
            self._buf = ""

    def isatty(self):
        return False

def launch_adw_gui(process_manager=None):
    signal.signal(signal.SIGINT, signal.SIG_DFL)
    pm = process_manager or ProcessManager()

    orig_stdout = sys.stdout
    orig_stderr = sys.stderr
    sys.stdout = StdoutStderrRedirector("system", pm, orig_stdout)
    sys.stderr = StdoutStderrRedirector("system", pm, orig_stderr)

    try:
        app = LocalRunAdwApp(pm)
        app.run(sys.argv[:1])
    finally:
        sys.stdout = orig_stdout
        sys.stderr = orig_stderr

