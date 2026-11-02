import json
import os
import threading
from pathlib import Path
from datetime import datetime
from typing import List, Dict, Any, Optional

class LogStorage:
    """Thread-safe persistent JSON storage for heading-based terminal history per tab.

    Logs are saved in a git-ignored directory (`.envscale_test_center_logs/`).
    Each tab (e.g. 'services', 'k8s') has its own JSON file containing an array of step records.
    Each record contains:
      - id: str
      - title: str
      - command: str
      - started_at: str (ISO timestamp or formatted)
      - ended_at: Optional[str]
      - status: 'running' | 'completed' | 'failed'
      - detail: str
      - logs: List[str]
    """

    def __init__(self, base_dir: Optional[Path] = None):
        if base_dir is None:
            # Default to repo root .envscale_test_center_logs
            base_dir = Path(__file__).resolve().parents[3] / ".envscale_test_center_logs"
        self.base_dir = Path(base_dir)
        self.base_dir.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()

    def _file_path(self, tab_name: str) -> Path:
        safe_name = tab_name.strip().lower().replace(" ", "_")
        return self.base_dir / f"{safe_name}.json"

    def load_steps(self, tab_name: str) -> List[Dict[str, Any]]:
        """Load all step history for a tab. Returns an empty list on failure or missing file."""
        fp = self._file_path(tab_name)
        with self._lock:
            if not fp.is_file():
                return []
            try:
                with fp.open("r", encoding="utf-8") as f:
                    data = json.load(f)
                    if isinstance(data, list):
                        return data
                    return []
            except Exception as e:
                print(f"[LogStorage] Error loading logs for {tab_name}: {e}")
                return []

    def save_steps(self, tab_name: str, steps: List[Dict[str, Any]], max_steps: int = 50):
        """Persist the steps array for a tab, keeping at most `max_steps` recent entries."""
        fp = self._file_path(tab_name)
        trimmed = steps[-max_steps:] if len(steps) > max_steps else steps
        with self._lock:
            try:
                # Write atomically via temp file
                tmp_fp = fp.with_suffix(".tmp")
                with tmp_fp.open("w", encoding="utf-8") as f:
                    json.dump(trimmed, f, ensure_ascii=False, indent=2)
                tmp_fp.replace(fp)
            except Exception as e:
                print(f"[LogStorage] Error saving logs for {tab_name}: {e}")

    def upsert_step(self, tab_name: str, step_data: Dict[str, Any]):
        """Insert or update a step entry by its `id`."""
        steps = self.load_steps(tab_name)
        step_id = step_data.get("id")
        found = False
        for i, s in enumerate(steps):
            if s.get("id") == step_id:
                steps[i] = step_data
                found = True
                break
        if not found:
            steps.append(step_data)
        self.save_steps(tab_name, steps)

    def clear_history(self, tab_name: str):
        """Clear all stored history for a given tab."""
        fp = self._file_path(tab_name)
        with self._lock:
            try:
                if fp.is_file():
                    fp.unlink()
            except Exception as e:
                print(f"[LogStorage] Error clearing logs for {tab_name}: {e}")
