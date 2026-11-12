import os
import shutil
import time
import subprocess
import urllib.request
import urllib.error
from typing import Optional, Callable, Dict, List, Tuple

from .config import PROJECT_ROOT, PROD_COMPOSE_FILE
from .env_sync import parse_dotenv

StepCallback = Callable[[str, str, str, str], None]

REQUIRED_PRODUCTION_KEYS = [
    "DATABASE_URL",
    "REDIS_URL",
    "JWT_ACCESS_SECRET",
    "JWT_REFRESH_SECRET",
    "KUBECONFIG_ENCRYPTION_KEY",
    "BETTER_AUTH_SECRET",
    "DUCKDNS_DOMAIN",
    "DUCKDNS_TOKEN",
]

def validate_deployment_secrets(env: Dict[str, str], require_duckdns: bool = True) -> List[str]:
    """Validate that required secrets are present and non-empty. Returns list of missing keys."""
    keys_to_check = list(REQUIRED_PRODUCTION_KEYS)
    if not require_duckdns:
        keys_to_check = [k for k in keys_to_check if not k.startswith("DUCKDNS")]

    missing = []
    for k in keys_to_check:
        val = env.get(k, "").strip()
        if not val or val.lower().startswith("replace-with") or val.lower().startswith("demo-college"):
            missing.append(k)
    return missing

def load_deployment_env(strict: bool = False, require_duckdns: bool = False) -> Dict[str, str]:
    """Load, consolidate, and optionally strictly validate deployment environment secrets."""
    env: Dict[str, str] = {}
    api_env_path = os.path.join(PROJECT_ROOT, "apps/api-server/.env")
    env.update(parse_dotenv(api_env_path))
    root_env_path = os.path.join(PROJECT_ROOT, ".env")
    env.update(parse_dotenv(root_env_path))
    for k, v in os.environ.items():
        if v:
            env[k] = v

    env.setdefault("DUCKDNS_DOMAIN", "envscale")
    env.setdefault("DUCKDNS_TOKEN", "")

    if strict:
        missing = validate_deployment_secrets(env, require_duckdns=require_duckdns)
        if missing:
            raise RuntimeError(
                f"[Fatal Secrets Error] Missing or unpopulated secrets: {', '.join(missing)}. "
                "Deployment halted per system rules. Please populate these values in your .env file."
            )

    return env

def detect_current_ip() -> str:
    """Detect current public IP of the EC2 instance."""
    for url in ["http://checkip.amazonaws.com", "http://169.254.169.254/latest/meta-data/public-ipv4"]:
        try:
            with urllib.request.urlopen(url, timeout=5) as r:
                ip = r.read().decode("utf-8").strip()
                if ip:
                    return ip
        except Exception:
            pass
    return "127.0.0.1"

def generate_caddyfile(current_ip: str, full_domain: str) -> str:
    """Generate Caddy reverse proxy routing for direct IP, sslip.io HTTPS, and DuckDNS."""
    return f"""http://{current_ip} {{
    rewrite /api/health /health
    rewrite /api/v1/health /health
    reverse_proxy /health localhost:3001
    reverse_proxy /healthz localhost:8080
    reverse_proxy /ws* localhost:8080
    reverse_proxy /api/v1/stream/* localhost:8080
    reverse_proxy /api/v1/clusters/snapshot* localhost:8080
    reverse_proxy /api/v1/clusters/register* localhost:8080
    reverse_proxy /api/v1/clusters/unregister-all* localhost:8080
    reverse_proxy /api/v1/logs/stream* localhost:8080
    reverse_proxy /api/v1/chaos/* localhost:8080
    reverse_proxy /api/v1/resource/* localhost:8080
    reverse_proxy /api/v1/evaluator/* localhost:8080
    reverse_proxy /api/v1/rollout/* localhost:8080
    reverse_proxy /api* localhost:3001
    reverse_proxy localhost:3000
}}

{current_ip}.sslip.io {{
    rewrite /api/health /health
    rewrite /api/v1/health /health
    reverse_proxy /health localhost:3001
    reverse_proxy /healthz localhost:8080
    reverse_proxy /ws* localhost:8080
    reverse_proxy /api/v1/stream/* localhost:8080
    reverse_proxy /api/v1/clusters/snapshot* localhost:8080
    reverse_proxy /api/v1/clusters/register* localhost:8080
    reverse_proxy /api/v1/clusters/unregister-all* localhost:8080
    reverse_proxy /api/v1/logs/stream* localhost:8080
    reverse_proxy /api/v1/chaos/* localhost:8080
    reverse_proxy /api/v1/resource/* localhost:8080
    reverse_proxy /api/v1/evaluator/* localhost:8080
    reverse_proxy /api/v1/rollout/* localhost:8080
    reverse_proxy /api* localhost:3001
    reverse_proxy localhost:3000
}}

{full_domain} {{
    rewrite /api/health /health
    rewrite /api/v1/health /health
    reverse_proxy /health localhost:3001
    reverse_proxy /healthz localhost:8080
    reverse_proxy /ws* localhost:8080
    reverse_proxy /api/v1/stream/* localhost:8080
    reverse_proxy /api/v1/clusters/snapshot* localhost:8080
    reverse_proxy /api/v1/clusters/register* localhost:8080
    reverse_proxy /api/v1/clusters/unregister-all* localhost:8080
    reverse_proxy /api/v1/logs/stream* localhost:8080
    reverse_proxy /api/v1/chaos/* localhost:8080
    reverse_proxy /api/v1/resource/* localhost:8080
    reverse_proxy /api/v1/evaluator/* localhost:8080
    reverse_proxy /api/v1/rollout/* localhost:8080
    reverse_proxy /api* localhost:3001
    reverse_proxy localhost:3000
}}
"""

def verify_deployment_health(target_host: str, emit: Optional[StepCallback] = None, step_id: str = "verify", step_title: str = "Health Verification") -> Tuple[bool, List[str]]:
    """Runs rigorous verification on Frontend, API, Streamer, and SSL certificates."""
    log = emit or (lambda sid, title, status, detail: None)
    log(step_id, step_title, "log", f"Starting deep verification suite on https://{target_host}...")
    errors = []

    # 1. SSL/TLS Handshake and Certificate Validity Check
    try:
        import socket
        import ssl
        from datetime import datetime, timezone
        ctx = ssl.create_default_context()
        with socket.create_connection((target_host, 443), timeout=5) as sock:
            with ctx.wrap_socket(sock, server_hostname=target_host) as ssock:
                cert = ssock.getpeercert()
                exp_str = cert.get("notAfter", "")
                if exp_str:
                    exp_dt = datetime.strptime(exp_str, "%b %d %H:%M:%S %Y %Z")
                    days_left = (exp_dt - datetime.now(timezone.utc).replace(tzinfo=None)).days
                    if days_left < 1:
                        errors.append(f"SSL certificate for {target_host} has expired ({exp_str})")
                    else:
                        log(step_id, step_title, "log", f"[PASS] Valid SSL certificate verified for {target_host} (Expires in {days_left} days)")
                else:
                    log(step_id, step_title, "log", f"[PASS] SSL/TLS handshake verified for {target_host}")
    except Exception as e:
        errors.append(f"SSL/TLS certificate verification failed on {target_host}:443: {e}")

    # 2. Frontend Web Check
    web_url = f"https://{target_host}/"
    try:
        req = urllib.request.Request(web_url, headers={"User-Agent": "EnvScale-HealthChecker/1.0"})
        with urllib.request.urlopen(req, timeout=10) as r:
            if r.status == 200:
                log(step_id, step_title, "log", f"[PASS] Frontend UI responding (HTTP 200) at {web_url}")
            else:
                errors.append(f"Frontend returned unexpected status code: {r.status}")
    except Exception as e:
        errors.append(f"Frontend connection failed ({web_url}): {e}")

    # 2. K8s Streamer Health Check
    streamer_url = f"https://{target_host}/healthz"
    try:
        req = urllib.request.Request(streamer_url, headers={"User-Agent": "EnvScale-HealthChecker/1.0"})
        with urllib.request.urlopen(req, timeout=10) as r:
            body = r.read().decode("utf-8")
            if r.status == 200 and "k8s-streamer" in body:
                log(step_id, step_title, "log", f"[PASS] K8s Streamer service healthy (HTTP 200) at {streamer_url}")
            else:
                errors.append(f"Streamer health payload invalid: {body[:100]}")
    except Exception as e:
        errors.append(f"Streamer health check failed ({streamer_url}): {e}")

    # 3. Backend REST API Check
    api_url = f"https://{target_host}/api/v1/workspaces"
    try:
        req = urllib.request.Request(api_url, headers={"User-Agent": "EnvScale-HealthChecker/1.0"})
        with urllib.request.urlopen(req, timeout=10) as r:
            if r.status in (200, 401):
                log(step_id, step_title, "log", f"[PASS] API Server online & enforcing RBAC guard at {api_url}")
    except urllib.error.HTTPError as he:
        if he.code in (200, 401):
            log(step_id, step_title, "log", f"[PASS] API Server online & enforcing RBAC guard (HTTP {he.code}) at {api_url}")
        else:
            errors.append(f"API Server returned error status: {he.code}")
    except Exception as e:
        errors.append(f"API Server connection failed ({api_url}): {e}")

    # 4. WebSocket Routing Check
    ws_url = f"https://{target_host}/ws/k8s"
    try:
        req = urllib.request.Request(ws_url, headers={
            "User-Agent": "EnvScale-HealthChecker/1.0",
            "Upgrade": "websocket",
            "Connection": "Upgrade",
            "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
            "Sec-WebSocket-Version": "13",
        })
        with urllib.request.urlopen(req, timeout=10) as r:
            pass
    except urllib.error.HTTPError as he:
        if he.code in (400, 101):
            log(step_id, step_title, "log", f"[PASS] WebSocket gateway active and routing on {ws_url}")
        else:
            errors.append(f"WebSocket gateway returned unexpected code: {he.code}")
    except Exception as e:
        errors.append(f"WebSocket endpoint unreachable ({ws_url}): {e}")

    success = len(errors) == 0
    return success, errors

