import os
import time
import signal
import shlex
import subprocess
import threading
from collections import deque
from datetime import datetime
from typing import Dict, List, Optional, Callable, Tuple
from .config import SERVICES, PROJECT_ROOT, DOCKER_COMPOSE_FILE
from .env_sync import parse_dotenv

LogCallback = Callable[[str, str, str], None]  # (service, timestamp, message)

class ProcessManager:
    def __init__(self, max_log_history: int = 1000):
        self.running_processes: Dict[str, subprocess.Popen] = {}
        self.log_buffers: Dict[str, deque] = {
            "all": deque(maxlen=max_log_history),
            "docker": deque(maxlen=max_log_history),
            "k8s": deque(maxlen=max_log_history),
        }
        for sid in SERVICES.keys():
            self.log_buffers[sid] = deque(maxlen=max_log_history)

        self.subscribers: List[LogCallback] = []
        self._lock = threading.Lock()

    def subscribe(self, callback: LogCallback):
        with self._lock:
            self.subscribers.append(callback)

    def unsubscribe(self, callback: LogCallback):
        with self._lock:
            if callback in self.subscribers:
                self.subscribers.remove(callback)

    def emit_log(self, service: str, message: str):
        ts = datetime.now().strftime("%H:%M:%S")
        entry = (service, ts, message)
        with self._lock:
            self.log_buffers["all"].append(entry)
            if service in self.log_buffers:
                self.log_buffers[service].append(entry)
            callbacks = list(self.subscribers)

        for cb in callbacks:
            try:
                cb(service, ts, message)
            except Exception:
                pass

    def get_logs(self, service: str = "all") -> List[Tuple[str, str, str]]:
        with self._lock:
            buf = self.log_buffers.get(service, self.log_buffers["all"])
            return list(buf)

    def clear_logs(self, service: Optional[str] = None):
        with self._lock:
            if service and service in self.log_buffers:
                self.log_buffers[service].clear()
            else:
                for b in self.log_buffers.values():
                    b.clear()

    def exec_command(self, service: str, cmd: str, cwd: str = PROJECT_ROOT) -> int:
        try:
            proc = subprocess.Popen(
                cmd,
                shell=True,
                cwd=cwd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
            )
            if proc.stdout:
                for line in iter(proc.stdout.readline, ""):
                    clean = line.rstrip("\r\n")
                    if clean:
                        self.emit_log(service, clean)
            return proc.wait()
        except Exception as e:
            self.emit_log(service, f"Execution failed for '{cmd}': {e}")
            return 1

    def start_docker_infra(self) -> bool:
        from .health_checker import check_port, check_redis
        self.emit_log("docker", "Verifying and launching database infrastructure...")

        # 1. Redis
        if check_redis(6379):
            self.emit_log("docker", "Redis is already online and responding on port 6379.")
        else:
            self.emit_log("docker", "Starting Redis container via Docker Compose...")
            self.exec_command("docker", f"docker compose -f {shlex.quote(DOCKER_COMPOSE_FILE)} up -d redis")

        # 2. PostgreSQL
        if check_port(5432):
            self.emit_log("docker", "PostgreSQL is already active on port 5432.")
        else:
            self.emit_log("docker", "Starting PostgreSQL container via Docker Compose...")
            self.exec_command("docker", f"docker compose -f {shlex.quote(DOCKER_COMPOSE_FILE)} up -d postgres")

        # 3. Wait for PostgreSQL readiness
        attempts = 0
        while attempts < 15:
            if check_port(5432):
                self.emit_log("docker", "PostgreSQL database is ready!")
                return True
            time.sleep(1)
            attempts += 1

        self.emit_log("docker", "Warning: PostgreSQL port 5432 did not become ready in 15 seconds.")
        return False

    def stop_docker_infra(self):
        self.emit_log("docker", "Stopping Docker infrastructure containers...")
        cmd = f"docker compose -f {shlex.quote(DOCKER_COMPOSE_FILE)} down --remove-orphans"
        self.exec_command("docker", cmd)
        self.emit_log("docker", "Docker containers stopped.")

    def start_service(self, service_id: str) -> bool:
        if service_id in self.running_processes:
            self.emit_log(service_id, f"Service '{service_id}' is already running.")
            return True

        svc = SERVICES.get(service_id)
        if not svc:
            self.emit_log("system", f"Unknown service: {service_id}")
            return False

        if svc.get("category") == "database":
            d_name = svc.get("docker_service")
            cmd = f"docker compose -f {shlex.quote(DOCKER_COMPOSE_FILE)} up -d {d_name}"
            code = self.exec_command("docker", cmd)
            if code == 0:
                self.emit_log("docker", f"Started container for {svc['name']}")
                return True
            else:
                self.emit_log("docker", f"Failed to start container for {svc['name']}")
                return False

        cmd_args = svc.get("cmd")
        cwd = svc.get("cwd", PROJECT_ROOT)
        if not cmd_args:
            return False

        proc_env = os.environ.copy()
        dotenv_path = os.path.join(cwd, ".env")
        if os.path.exists(dotenv_path):
            proc_env.update(parse_dotenv(dotenv_path))

        self.emit_log(service_id, f"Spawning {svc['name']} (command: {' '.join(cmd_args)})...")
        try:
            proc = subprocess.Popen(
                cmd_args,
                cwd=cwd,
                env=proc_env,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
                preexec_fn=os.setsid,
            )
            self.running_processes[service_id] = proc

            def _reader():
                try:
                    for line in iter(proc.stdout.readline, ""):
                        clean = line.rstrip("\r\n")
                        if clean:
                            self.emit_log(service_id, clean)
                except Exception:
                    pass

            threading.Thread(target=_reader, daemon=True).start()
            return True
        except Exception as e:
            self.emit_log(service_id, f"Failed to spawn {service_id}: {e}")
            return False

    def stop_service(self, service_id: str):
        svc = SERVICES.get(service_id)
        if svc and svc.get("category") == "database":
            d_name = svc.get("docker_service")
            self.emit_log("docker", f"Stopping {svc['name']} container...")
            self.exec_command("docker", f"docker compose -f {shlex.quote(DOCKER_COMPOSE_FILE)} stop {d_name}")
            return

        proc = self.running_processes.pop(service_id, None)
        if not proc:
            return

        self.emit_log(service_id, f"Initiating graceful SIGTERM shutdown...")
        try:
            pgid = os.getpgid(proc.pid)
            os.killpg(pgid, signal.SIGTERM)
            try:
                proc.wait(timeout=2.5)
                self.emit_log(service_id, f"Service stopped gracefully.")
            except subprocess.TimeoutExpired:
                self.emit_log(service_id, f"SIGTERM timed out; sending SIGKILL...")
                os.killpg(pgid, signal.SIGKILL)
                proc.wait(timeout=1.0)
        except ProcessLookupError:
            pass
        except Exception as e:
            self.emit_log(service_id, f"Error stopping service: {e}")

    def restart_service(self, service_id: str):
        self.stop_service(service_id)
        time.sleep(0.5)
        self.start_service(service_id)

    def stop_all(self):
        self.emit_log("system", "Stopping all running microservices...")
        for sid in list(self.running_processes.keys()):
            self.stop_service(sid)
        self.stop_docker_infra()
        self.emit_log("system", "All services and infrastructure stopped.")

    def is_service_running(self, service_id: str) -> bool:
        proc = self.running_processes.get(service_id)
        if proc:
            return proc.poll() is None
        return False
