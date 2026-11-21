#!/usr/bin/env python3
"""
EnvScale — Sync Runtime Secrets from AWS SSM Parameter Store.

Fetches non-secret String and out-of-band SecureString parameters under
/envscale/prod/* using the EC2 instance's IAM role and writes an atomic 0600
env file at /etc/envscale/secrets.env without echoing secret values.
"""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import subprocess
import sys
import tempfile

SSM_PARAM_MAP: dict[str, str] = {
    "postgres_user": "POSTGRES_USER",
    "postgres_db": "POSTGRES_DB",
    "postgres_password": "POSTGRES_PASSWORD",
    "redis_password": "REDIS_PASSWORD",
    "jwt_access_secret": "JWT_ACCESS_SECRET",
    "jwt_refresh_secret": "JWT_REFRESH_SECRET",
    "better_auth_secret": "BETTER_AUTH_SECRET",
    "better_auth_url": "BETTER_AUTH_URL",
    "cors_origin": "CORS_ORIGIN",
    "kubeconfig_encryption_key": "KUBECONFIG_ENCRYPTION_KEY",
    "duckdns_domain": "DUCKDNS_DOMAIN",
    "duckdns_token": "DUCKDNS_TOKEN",
    "google_client_id": "GOOGLE_CLIENT_ID",
    "google_client_secret": "GOOGLE_CLIENT_SECRET",
    "github_client_id": "GITHUB_CLIENT_ID",
    "github_client_secret": "GITHUB_CLIENT_SECRET",
    "recovery_bucket": "RECOVERY_BUCKET",
    "aws_region": "AWS_REGION",
}

REQUIRED_KEYS = (
    "POSTGRES_PASSWORD",
    "REDIS_PASSWORD",
    "JWT_ACCESS_SECRET",
    "JWT_REFRESH_SECRET",
    "BETTER_AUTH_SECRET",
    "BETTER_AUTH_URL",
    "CORS_ORIGIN",
    "KUBECONFIG_ENCRYPTION_KEY",
    "DUCKDNS_DOMAIN",
    "DUCKDNS_TOKEN",
)


def fetch_ssm_parameters(prefix: str, region: str | None = None) -> dict[str, str]:
    """Fetch all parameters under prefix from AWS SSM Parameter Store."""
    normalized_prefix = "/" + prefix.strip("/")
    results: dict[str, str] = {}
    next_token: str | None = None

    while True:
        cmd = [
            "aws",
            "ssm",
            "get-parameters-by-path",
            "--path",
            normalized_prefix,
            "--with-decryption",
            "--recursive",
            "--output",
            "json",
        ]
        if region:
            cmd.extend(["--region", region])
        if next_token:
            cmd.extend(["--next-token", next_token])

        proc = subprocess.run(cmd, capture_output=True, text=True)
        if proc.returncode != 0:
            err = proc.stderr.strip() or f"aws ssm get-parameters-by-path exited {proc.returncode}"
            raise RuntimeError(err)

        payload = json.loads(proc.stdout or "{}")
        for param in payload.get("Parameters", []):
            name = param.get("Name", "")
            short_key = name.rsplit("/", 1)[-1]
            env_key = SSM_PARAM_MAP.get(short_key)
            if env_key:
                results[env_key] = param.get("Value", "")
        next_token = payload.get("NextToken")
        if not next_token:
            break

    return results


def render_secrets_env(env_map: dict[str, str], output_path: pathlib.Path) -> None:
    """Validate required keys and write secrets.env atomically with mode 0600."""
    if output_path.is_symlink():
        raise RuntimeError(f"Refusing symlink target for secrets file: {output_path}")

    missing = [k for k in REQUIRED_KEYS if not env_map.get(k, "").strip()]
    if missing:
        raise RuntimeError(
            f"Missing required SSM parameters for secrets rendering: {', '.join(missing)}"
        )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    os.chmod(output_path.parent, 0o700)
    fd, tmp_name = tempfile.mkstemp(prefix=f".{output_path.name}.", dir=str(output_path.parent))
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            for k in sorted(env_map.keys()):
                v = env_map[k]
                if "\n" in v or "\r" in v:
                    raise RuntimeError(f"Illegal newline in parameter {k}")
                escaped = v.replace("\\", "\\\\").replace('"', '\\"').replace("$", "\\$")
                handle.write(f'{k}="{escaped}"\n')
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_name, output_path)
    except BaseException:
        if os.path.exists(tmp_name):
            os.unlink(tmp_name)
        raise


def main() -> int:
    parser = argparse.ArgumentParser(description="Sync EnvScale secrets from AWS SSM Parameter Store.")
    parser.add_argument("--ssm-prefix", default="/envscale/prod", help="SSM Parameter Store hierarchy prefix")
    parser.add_argument("--region", default=os.environ.get("AWS_REGION") or None, help="AWS region override")
    parser.add_argument(
        "--output",
        type=pathlib.Path,
        default=pathlib.Path(os.environ.get("ENVSCALE_SECRETS_FILE", "/etc/envscale/secrets.env")),
        help="Destination secrets file path (mode 0600)",
    )
    args = parser.parse_args()

    env_map = fetch_ssm_parameters(args.ssm_prefix, region=args.region)
    render_secrets_env(env_map, args.output)
    print(f"[SSM SECRETS SYNCED] keys={len(env_map)} target={args.output} mode=0600")
    return 0


if __name__ == "__main__":
    sys.exit(main())

