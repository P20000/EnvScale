import gi
gi.require_version('Gtk', '4.0')
gi.require_version('Adw', '1')
from gi.repository import Gtk, Adw, GLib
from datetime import datetime
from typing import Optional, List, Dict, Any, Callable

class StepRow(Adw.ExpanderRow):
    """An expandable heading-based terminal row matching the Cloud Ops styling.

    Displays title, exact start timestamp, active command, status badge/spinner,
    and a nested monospace TextView sub-terminal that auto-scrolls with live output.
    """

    def __init__(
        self,
        step_id: str,
        title: str,
        command: str = "",
        started_at: str = "",
        status: str = "running",
        detail: str = "",
        initial_logs: Optional[List[str]] = None,
    ):
        super().__init__()
        self.step_id = step_id
        self.title = title
        self.command = command
        self.started_at = started_at or datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        self.ended_at = ""
        self.status = status
        self.detail = detail
        self.logs: List[str] = list(initial_logs or [])

        self.set_title(title)
        self._update_subtitle()

        # Status spinner and badge in suffix
        self.suffix_box = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
        self.spinner = Gtk.Spinner()
        self.suffix_box.append(self.spinner)

        self.badge = Gtk.Label(label="RUNNING")
        self.suffix_box.append(self.badge)
        self.add_suffix(self.suffix_box)

        # Terminal sub-viewer
        log_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=4)
        log_box.set_margin_top(6)
        log_box.set_margin_bottom(6)
        log_box.set_margin_start(12)
        log_box.set_margin_end(12)

        scroller = Gtk.ScrolledWindow()
        scroller.set_min_content_height(120)
        scroller.set_max_content_height(260)
        scroller.set_propagate_natural_height(False)

        self.text_view = Gtk.TextView()
        self.text_view.set_editable(False)
        self.text_view.set_cursor_visible(False)
        self.text_view.set_monospace(True)
        self.text_view.set_wrap_mode(Gtk.WrapMode.WORD_CHAR)
        self.buffer = self.text_view.get_buffer()

        scroller.set_child(self.text_view)
        log_box.append(scroller)
        self.add_row(log_box)

        # Prepopulate existing logs
        if self.logs:
            full_text = "\n".join(self.logs) + "\n"
            self.buffer.set_text(full_text)

        # Apply initial status
        if self.status == "completed":
            self.spinner.stop()
            self.suffix_box.remove(self.spinner)
            self.badge.set_text("✔ Completed")
            self.badge.add_css_class("success")
            self.set_expanded(False)
        elif self.status == "failed":
            self.spinner.stop()
            self.suffix_box.remove(self.spinner)
            self.badge.set_text("✘ Failed")
            self.badge.add_css_class("error")
            self.set_expanded(True)
        else:
            self.spinner.start()
            self.badge.set_text("RUNNING")
            self.badge.add_css_class("accent")
            self.set_expanded(True)

    def _update_subtitle(self):
        parts = [f"[{self.started_at}]"]
        if self.detail:
            parts.append(self.detail)
        elif self.command:
            parts.append(self.command)
        else:
            parts.append("Executing...")
        raw_text = " • ".join(parts)
        self.set_subtitle(GLib.markup_escape_text(raw_text, -1))

    def append_log(self, line: str):
        self.logs.append(line)
        end = self.buffer.get_end_iter()
        self.buffer.insert(end, line + "\n")
        if not hasattr(self, "_end_mark"):
            self._end_mark = self.buffer.create_mark("end", self.buffer.get_end_iter(), False)
        else:
            self.buffer.move_mark(self._end_mark, self.buffer.get_end_iter())
        GLib.idle_add(self._scroll_to_end)

    def _scroll_to_end(self):
        if hasattr(self, "_end_mark"):
            self.text_view.scroll_to_mark(self._end_mark, 0.0, True, 0.0, 1.0)
        return False

    def mark_success(self, detail: str = ""):
        self.status = "completed"
        self.ended_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        if self.spinner.get_parent():
            self.spinner.stop()
            self.suffix_box.remove(self.spinner)
        self.badge.set_text("✔ Completed")
        self.badge.remove_css_class("accent")
        self.badge.add_css_class("success")
        if detail:
            self.detail = detail
        self._update_subtitle()
        self.set_expanded(False)

    def mark_error(self, err_msg: str):
        self.status = "failed"
        self.ended_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        if self.spinner.get_parent():
            self.spinner.stop()
            self.suffix_box.remove(self.spinner)
        self.badge.set_text("✘ Failed")
        self.badge.remove_css_class("accent")
        self.badge.add_css_class("error")
        if err_msg:
            self.detail = err_msg
        self._update_subtitle()
        self.set_expanded(True)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.step_id,
            "title": self.title,
            "command": self.command,
            "started_at": self.started_at,
            "ended_at": self.ended_at,
            "status": self.status,
            "detail": self.detail,
            "logs": self.logs,
        }


class HeadingLogPanel(Gtk.Box):
    """Dedicated scrollable panel housing expandable heading-based terminals with history.

    Features:
      - Compact, self-contained height with internal auto-scrolling
      - History load/save via LogStorage
      - Preservation of exact start time and logs across runs
      - Controls to clear or collapse/expand history
    """

    def __init__(self, tab_name: str, log_storage):
        super().__init__(orientation=Gtk.Orientation.VERTICAL, spacing=8)
        self.tab_name = tab_name
        self.log_storage = log_storage
        self.step_rows: Dict[str, StepRow] = {}

        # Top Bar of the Log Panel
        top_bar = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
        top_bar.set_margin_start(4)
        top_bar.set_margin_end(4)

        lbl_title = Gtk.Label(label="<b>Execution Log &amp; Terminal History</b>", use_markup=True)
        lbl_title.set_halign(Gtk.Align.START)
        lbl_title.set_hexpand(True)
        top_bar.append(lbl_title)

        btn_toggle = Gtk.Button(label="Toggle All")
        btn_toggle.add_css_class("flat")
        btn_toggle.connect("clicked", self._on_toggle_all)
        top_bar.append(btn_toggle)

        btn_clear = Gtk.Button(label="Clear History")
        btn_clear.add_css_class("flat")
        btn_clear.connect("clicked", self._on_clear_clicked)
        top_bar.append(btn_clear)

        self.append(top_bar)

        # Scrolled Window containing the step rows
        self.scroller = Gtk.ScrolledWindow()
        self.scroller.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC)
        self.scroller.set_min_content_height(200)
        self.scroller.set_max_content_height(380)
        self.scroller.set_vexpand(True)

        self.step_group = Adw.PreferencesGroup()
        self.scroller.set_child(self.step_group)
        self.append(self.scroller)

        self._all_expanded = False
        self._load_persisted_history()

    def _load_persisted_history(self):
        records = self.log_storage.load_steps(self.tab_name)
        for rec in records:
            step_id = rec.get("id") or f"hist_{len(self.step_rows)}"
            row = StepRow(
                step_id=step_id,
                title=rec.get("title", "Command Execution"),
                command=rec.get("command", ""),
                started_at=rec.get("started_at", ""),
                status=rec.get("status", "completed"),
                detail=rec.get("detail", ""),
                initial_logs=rec.get("logs", []),
            )
            row.ended_at = rec.get("ended_at", "")
            self.step_rows[step_id] = row
            self.step_group.add(row)

    def create_step(self, step_id: str, title: str, command: str = "") -> StepRow:
        """Create and register a new heading-based StepRow, saving initial state."""
        row = StepRow(
            step_id=step_id,
            title=title,
            command=command,
            started_at=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            status="running",
        )
        self.step_rows[step_id] = row
        self.step_group.add(row)

        # Persist step start
        self._persist_step(row)
        self.scroll_to_bottom()
        return row

    def append_log(self, step_id: str, line: str):
        row = self.step_rows.get(step_id)
        if row:
            row.append_log(line)

    def complete_step(self, step_id: str, success: bool, detail: str = ""):
        row = self.step_rows.get(step_id)
        if row:
            if success:
                row.mark_success(detail)
            else:
                row.mark_error(detail)
            self._persist_step(row)

    def _persist_step(self, row: StepRow):
        try:
            self.log_storage.upsert_step(self.tab_name, row.to_dict())
        except Exception as e:
            print(f"[HeadingLogPanel] Error persisting step {row.step_id}: {e}")

    def sync_storage(self, step_id: str):
        """Force write row's current state to JSON storage."""
        row = self.step_rows.get(step_id)
        if row:
            self._persist_step(row)

    def scroll_to_bottom(self):
        def _scroll():
            vadj = self.scroller.get_vadjustment()
            if vadj:
                vadj.set_value(vadj.get_upper() - vadj.get_page_size())
            return False
        GLib.idle_add(_scroll)

    def _on_toggle_all(self, _):
        self._all_expanded = not self._all_expanded
        for row in self.step_rows.values():
            row.set_expanded(self._all_expanded)

    def _on_clear_clicked(self, _):
        for row in list(self.step_rows.values()):
            self.step_group.remove(row)
        self.step_rows.clear()
        self.log_storage.clear_history(self.tab_name)
