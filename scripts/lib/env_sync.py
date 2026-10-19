import os
import shutil
from typing import Dict, Tuple, List
from .config import (
    API_SERVER_DIR,
    K8S_STREAMER_DIR,
    SHARED_JWT_SECRET,
    SHARED_ENCRYPTION_KEY,
)

def parse_dotenv(filepath: str) -> Dict[str, str]:
    env_dict = {}
    if os.path.exists(filepath):
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        k, v = line.split("=", 1)
                        env_dict[k.strip()] = v.strip().strip("'\"")
        except Exception:
            pass
    return env_dict

def write_dotenv(filepath: str, values: Dict[str, str]):
    lines = []
    for k, v in values.items():
        lines.append(f"{k}={v}\n")
    with open(filepath, "w", encoding="utf-8") as f:
        f.writelines(lines)

def ensure_env_files() -> List[str]:
    logs = []
    api_env_path = os.path.join(API_SERVER_DIR, ".env")
    streamer_env_path = os.path.join(K8S_STREAMER_DIR, ".env")

    # API Server .env
    if not os.path.exists(api_env_path):
        api_example = os.path.join(API_SERVER_DIR, ".env.example")
        if os.path.exists(api_example):
            shutil.copyfile(api_example, api_env_path)
            logs.append("[ENV] Created apps/api-server/.env from .env.example")
        else:
            api_defaults = {
                "DATABASE_URL": "postgresql://envscale:envscale_password@localhost:5432/envscale",
                "JWT_ACCESS_SECRET": SHARED_JWT_SECRET,
                "JWT_REFRESH_SECRET": "replace-with-a-different-long-random-refresh-secret",
                "KUBECONFIG_ENCRYPTION_KEY": SHARED_ENCRYPTION_KEY,
                "CORS_ORIGIN": "http://localhost:5173",
                "PORT": "3000",
                "NODE_ENV": "development",
            }
            write_dotenv(api_env_path, api_defaults)
            logs.append("[ENV] Generated default apps/api-server/.env with secure secrets")

    # K8s Streamer .env
    if not os.path.exists(streamer_env_path):
        streamer_example = os.path.join(K8S_STREAMER_DIR, ".env.example")
        if os.path.exists(streamer_example):
            shutil.copyfile(streamer_example, streamer_env_path)
            logs.append("[ENV] Created apps/k8s-streamer/.env from .env.example")
        else:
            streamer_defaults = {
                "PORT": "8080",
                "NODE_ENV": "development",
                "JWT_ACCESS_SECRET": SHARED_JWT_SECRET,
                "ALLOW_ANONYMOUS_WS": "true",
                "REDIS_URL": "redis://localhost:6379",
            }
            write_dotenv(streamer_env_path, streamer_defaults)
            logs.append("[ENV] Generated default apps/k8s-streamer/.env with secure secrets")

    # Ensure JWT secret parity between API Server and K8s Streamer
    api_env = parse_dotenv(api_env_path)
    streamer_env = parse_dotenv(streamer_env_path)

    api_jwt = api_env.get("JWT_ACCESS_SECRET")
    streamer_jwt = streamer_env.get("JWT_ACCESS_SECRET")

    if not api_jwt or api_jwt.startswith("replace-with"):
        api_env["JWT_ACCESS_SECRET"] = SHARED_JWT_SECRET
        write_dotenv(api_env_path, api_env)
        logs.append("[ENV] Synchronized API Server JWT_ACCESS_SECRET with shared gateway secret")
        api_jwt = SHARED_JWT_SECRET

    if streamer_jwt != api_jwt:
        streamer_env["JWT_ACCESS_SECRET"] = api_jwt
        write_dotenv(streamer_env_path, streamer_env)
        logs.append("[ENV] Synchronized K8s Streamer JWT_ACCESS_SECRET with API Server")

    return logs

def verify_env_parity() -> Tuple[bool, List[str]]:
    api_env_path = os.path.join(API_SERVER_DIR, ".env")
    streamer_env_path = os.path.join(K8S_STREAMER_DIR, ".env")
    api_env = parse_dotenv(api_env_path)
    streamer_env = parse_dotenv(streamer_env_path)

    issues = []
    if not api_env:
        issues.append("apps/api-server/.env is missing")
    if not streamer_env:
        issues.append("apps/k8s-streamer/.env is missing")

    if api_env and streamer_env:
        if api_env.get("JWT_ACCESS_SECRET") != streamer_env.get("JWT_ACCESS_SECRET"):
            issues.append("JWT_ACCESS_SECRET mismatch between API Server and K8s Streamer")

    return (len(issues) == 0, issues)
