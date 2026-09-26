import os
import sys
import threading
import subprocess

def open_browser_detached(url: str):
    """
    Opens a URL in the default desktop browser completely detached
    from the terminal's stdout/stderr streams.
    """
    try:
        subprocess.Popen(
            ["xdg-open", url],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            stdin=subprocess.DEVNULL,
            start_new_session=True,
            close_fds=True,
        )
    except Exception:
        try:
            import webbrowser
            webbrowser.open(url)
        except Exception:
            pass

class StreamRedirector:
    """
    Captures all standard output and standard error at the OS file descriptor level
    (fd 1 and fd 2) and routes them in real time into the GTK live log callback.
    """
    def __init__(self, log_callback):
        self.log_callback = log_callback
        self.pipe_r, self.pipe_w = os.pipe()

        self.orig_stdout_fd = os.dup(1)
        self.orig_stderr_fd = os.dup(2)

        # Redirect low-level file descriptors 1 and 2 to write end of the pipe
        os.dup2(self.pipe_w, 1)
        os.dup2(self.pipe_w, 2)

        # Flush and wrap Python sys.stdout / sys.stderr
        sys.stdout.flush()
        sys.stderr.flush()
        sys.stdout = os.fdopen(self.pipe_w, "w", buffering=1, encoding="utf-8", errors="replace")
        sys.stderr = sys.stdout

        self.running = True
        self.thread = threading.Thread(target=self._reader_loop, daemon=True)
        self.thread.start()

    def _reader_loop(self):
        try:
            reader = os.fdopen(self.pipe_r, "r", encoding="utf-8", errors="replace")
            for line in reader:
                if not self.running:
                    break
                clean = line.rstrip("\r\n")
                if clean:
                    # Filter out browser extension noise if any leaked
                    if "brave_web-discovery" in clean or "CWelsH264SVCEncoder" in clean:
                        continue
                    self.log_callback(clean)
        except Exception:
            pass

    def restore(self):
        self.running = False
        try:
            os.dup2(self.orig_stdout_fd, 1)
            os.dup2(self.orig_stderr_fd, 2)
            os.close(self.orig_stdout_fd)
            os.close(self.orig_stderr_fd)
            os.close(self.pipe_w)
        except Exception:
            pass
