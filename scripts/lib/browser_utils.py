import subprocess
from typing import Optional, Callable

def open_browser_url(url: str, log_fn: Optional[Callable[[str], None]] = None) -> bool:
    """
    Opens a URL in the user's default browser using desktop portals (Gio)
    or detached xdg-open without polluting the terminal stdout/stderr.
    """
    if log_fn:
        log_fn(f"Opening browser for URL: {url}")

    # 1. Try desktop-native Gio launch (Wayland / X11 portals)
    try:
        from gi.repository import Gio
        app = Gio.AppInfo.get_default_for_uri_scheme("http")
        if app:
            app.launch_uris([url], None)
            return True
        Gio.AppInfo.launch_default_for_uri(url, None)
        return True
    except Exception:
        pass

    # 2. Fallback to detached xdg-open with suppressed stdout/stderr
    try:
        subprocess.Popen(
            ["xdg-open", url],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
        return True
    except Exception as e:
        if log_fn:
            log_fn(f"Failed to open browser URL '{url}': {e}")
        return False
