import gi
gi.require_version('Gtk', '4.0')
gi.require_version('Adw', '1')
from gi.repository import Gtk, GLib

class LogsView(Gtk.Box):
    def __init__(self, process_manager):
        super().__init__(orientation=Gtk.Orientation.VERTICAL, spacing=10)
        self.pm = process_manager
        self.set_margin_top(12)
        self.set_margin_bottom(12)
        self.set_margin_start(16)
        self.set_margin_end(16)

        # Toolbar
        toolbar = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=10)

        # Filter Dropdown
        self.service_filter = "all"
        filter_model = Gtk.StringList.new(["All Services", "api", "streamer", "web", "docker", "k8s", "system"])
        self.dropdown = Gtk.DropDown.new(filter_model, None)
        self.dropdown.connect("notify::selected-item", self._on_filter_changed)
        toolbar.append(self.dropdown)

        # Search Entry
        self.search_entry = Gtk.SearchEntry()
        self.search_entry.set_placeholder_text("Filter log lines...")
        self.search_entry.set_hexpand(True)
        self.search_entry.connect("search-changed", self._on_search_changed)
        toolbar.append(self.search_entry)

        # Autoscroll switch
        scroll_box = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=6)
        scroll_label = Gtk.Label(label="Auto-scroll")
        self.auto_scroll_switch = Gtk.Switch()
        self.auto_scroll_switch.set_active(True)
        scroll_box.append(scroll_label)
        scroll_box.append(self.auto_scroll_switch)
        toolbar.append(scroll_box)

        # Clear button
        btn_clear = Gtk.Button(label="Clear")
        btn_clear.connect("clicked", self._on_clear_clicked)
        toolbar.append(btn_clear)

        self.append(toolbar)

        # Console Text View
        scrolled = Gtk.ScrolledWindow()
        scrolled.set_hexpand(True)
        scrolled.set_vexpand(True)
        scrolled.add_css_class("card")

        self.text_view = Gtk.TextView()
        self.text_view.set_editable(False)
        self.text_view.set_monospace(True)
        self.text_view.set_cursor_visible(False)
        self.text_buffer = self.text_view.get_buffer()

        scrolled.set_child(self.text_view)
        self.append(scrolled)

        self.pm.subscribe(self._on_log_emitted)
        self._refresh_buffer()

    def _on_log_emitted(self, service, timestamp, message):
        def _append():
            current_filter = self._get_selected_filter()
            query = self.search_entry.get_text().lower()

            if current_filter != "all" and service != current_filter:
                return False
            if query and query not in message.lower() and query not in service.lower():
                return False

            end_iter = self.text_buffer.get_end_iter()
            self.text_buffer.insert(end_iter, f"[{timestamp}] [{service}] {message}\n")

            if self.auto_scroll_switch.get_active():
                mark = self.text_buffer.create_mark(None, self.text_buffer.get_end_iter(), False)
                self.text_view.scroll_to_mark(mark, 0.0, True, 0.0, 1.0)
            return False

        GLib.idle_add(_append)

    def _get_selected_filter(self):
        item = self.dropdown.get_selected_item()
        val = item.get_string() if item else "All Services"
        if val == "All Services":
            return "all"
        return val

    def _on_filter_changed(self, *_):
        self._refresh_buffer()

    def _on_search_changed(self, *_):
        self._refresh_buffer()

    def _on_clear_clicked(self, _):
        self.pm.clear_logs(self._get_selected_filter())
        self.text_buffer.set_text("")

    def _refresh_buffer(self):
        self.text_buffer.set_text("")
        filt = self._get_selected_filter()
        query = self.search_entry.get_text().lower()
        logs = self.pm.get_logs(filt)

        lines = []
        for svc, ts, msg in logs:
            if filt != "all" and svc != filt:
                continue
            if query and query not in msg.lower() and query not in svc.lower():
                continue
            lines.append(f"[{ts}] [{svc}] {msg}\n")

        self.text_buffer.set_text("".join(lines))
        if self.auto_scroll_switch.get_active():
            mark = self.text_buffer.create_mark(None, self.text_buffer.get_end_iter(), False)
            self.text_view.scroll_to_mark(mark, 0.0, True, 0.0, 1.0)
