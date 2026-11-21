import os
import signal
import subprocess
from typing import List, Optional, Union, Callable

def kill_process_group(proc: subprocess.Popen, timeout: float = 2.0) -> None:
    """Safely terminate an entire process group created with start_new_session=True.
    
    Prevents orphaned background processes (e.g. child CLI tools like aws/kubectl)
    from persisting when the parent process or shell times out.
    """
    if proc.poll() is not None:
        return

    try:
        pgid = os.getpgid(proc.pid)
        # Send SIGTERM to the entire process group
        os.killpg(pgid, signal.SIGTERM)
        try:
            proc.wait(timeout=timeout)
            return
        except subprocess.TimeoutExpired:
            # Force kill if still unresponsive
            os.killpg(pgid, signal.SIGKILL)
            proc.wait(timeout=1.0)
    except (ProcessLookupError, PermissionError, OSError):
        pass

def safe_run(
    cmd: Union[List[str], str],
    cwd: Optional[str] = None,
    env: Optional[dict] = None,
    timeout: Optional[float] = None,
    check: bool = False,
    text: bool = True,
    capture_output: bool = True,
    shell: bool = False,
) -> subprocess.CompletedProcess:
    """Execute a command in its own process group with leak-proof timeout cleanup.
    
    If the timeout expires, the whole process group (including all children) is killed.
    """
    proc = subprocess.Popen(
        cmd,
        cwd=cwd,
        env=env,
        shell=shell,
        stdout=subprocess.PIPE if capture_output else None,
        stderr=subprocess.PIPE if capture_output else None,
        text=text,
        start_new_session=True,
    )

    try:
        stdout, stderr = proc.communicate(timeout=timeout)
        retcode = proc.poll() or 0
        if check and retcode != 0:
            raise subprocess.CalledProcessError(retcode, cmd, output=stdout, stderr=stderr)
        return subprocess.CompletedProcess(cmd, retcode, stdout, stderr)
    except subprocess.TimeoutExpired:
        kill_process_group(proc, timeout=1.5)
        # Drain remaining output
        try:
            stdout, stderr = proc.communicate(timeout=0.5)
        except Exception:
            stdout, stderr = "", ""
        if check:
            raise subprocess.TimeoutExpired(cmd, timeout or 0, output=stdout, stderr=stderr)
        return subprocess.CompletedProcess(cmd, 124, stdout, stderr)
    except Exception:
        kill_process_group(proc, timeout=1.0)
        raise

def safe_stream(
    cmd: Union[List[str], str],
    cwd: Optional[str] = None,
    env: Optional[dict] = None,
    on_line: Optional[Callable[[str], None]] = None,
    timeout: Optional[float] = None,
    shell: bool = False,
) -> int:
    """Stream stdout/stderr line-by-line in real time, isolating the process group."""
    on_line = on_line or (lambda line: None)
    proc = subprocess.Popen(
        cmd,
        cwd=cwd,
        env=env,
        shell=shell,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        start_new_session=True,
    )

    try:
        if proc.stdout:
            for line in iter(proc.stdout.readline, ""):
                clean = line.rstrip("\r\n")
                if clean:
                    on_line(clean)
        return proc.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        on_line(f"[ERROR] Process exceeded timeout limit of {timeout}s. Terminating process tree...")
        kill_process_group(proc, timeout=1.5)
        return 124
    except Exception as e:
        on_line(f"[ERROR] Process execution failed: {e}")
        kill_process_group(proc, timeout=1.0)
        return 1
