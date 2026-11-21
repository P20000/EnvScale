import time
import socket
import json
import urllib.request
import urllib.error
from typing import Dict, Any, Tuple
from .config import SERVICES

def check_port(port: int, host: str = "127.0.0.1", timeout: float = 0.5) -> bool:
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        res = sock.connect_ex((host, port))
        sock.close()
        return res == 0
    except Exception:
        return False

def check_redis(port: int = 6379, host: str = "127.0.0.1", timeout: float = 1.0) -> bool:
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        if sock.connect_ex((host, port)) != 0:
            sock.close()
            return False
        sock.sendall(b"*1\r\n$4\r\nPING\r\n")
        data = sock.recv(1024)
        sock.close()
        return b"PONG" in data
    except Exception:
        return False

def check_http_endpoint(url: str, timeout: float = 1.5) -> Tuple[bool, Dict[str, Any], float]:
    start_time = time.time()
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "EnvScale-TestCenter/1.0"})
        with urllib.request.urlopen(req, timeout=timeout) as response:
            latency = (time.time() - start_time) * 1000.0
            if response.status == 200:
                body = response.read().decode("utf-8", errors="replace")
                try:
                    data = json.loads(body)
                except Exception:
                    data = {"raw": body}
                return (True, data, round(latency, 1))
    except Exception:
        pass
    latency = (time.time() - start_time) * 1000.0
    return (False, {}, round(latency, 1))

def check_service_health(service_id: str) -> Dict[str, Any]:
    svc = SERVICES.get(service_id)
    if not svc:
        return {"status": "unknown", "online": False, "latency_ms": 0.0, "details": {}}

    h_type = svc.get("health_type", "tcp")
    port = svc.get("port", 0)

    if h_type == "redis":
        online = check_redis(port)
        return {
            "status": "online" if online else "offline",
            "online": online,
            "port": port,
            "latency_ms": 1.0 if online else 0.0,
            "details": {"type": "redis_ping"},
        }
    elif h_type in ("http", "http_json"):
        url = svc.get("health_url")
        if not url:
            online = check_port(port)
            return {"status": "online" if online else "offline", "online": online, "port": port, "latency_ms": 0.0, "details": {}}
        online, data, latency = check_http_endpoint(url)
        return {
            "status": "online" if online else "offline",
            "online": online,
            "port": port,
            "latency_ms": latency,
            "details": data,
        }
    else:  # default tcp
        online = check_port(port)
        return {
            "status": "online" if online else "offline",
            "online": online,
            "port": port,
            "latency_ms": 1.0 if online else 0.0,
            "details": {"type": "tcp_socket"},
        }

def check_all_services() -> Dict[str, Dict[str, Any]]:
    results = {}
    for sid in SERVICES.keys():
        results[sid] = check_service_health(sid)
    return results
