"""SSM orchestration, manifest resolution, and teardown cleanup helpers."""

from __future__ import annotations

import base64
import json
import os
import pathlib
import shlex
import shutil
import subprocess
import time
import urllib.request
import uuid
from typing import Any, Callable, Dict, List, Optional

from .cloud_config_utils import redact_sensitive_text
from .config import PROJECT_ROOT

StepCallback = Optional[Callable[[str, str, str, str], None]]
BACKUP_RESULT_PREFIX = "ENVSCALE_BACKUP_RESULT="

DEFAULT_SECRETS_FILE = "/etc/envscale/secrets.env"
DEFAULT_REMOTE_MANIFEST = "/var/lib/envscale/pending-release-manifest.json"
DEFAULT_SSM_PREFIX = "/envscale/prod"
DEFAULT_INSTANCE_PROFILE = "envscale-ec2-runtime-profile"
DEFAULT_AWS_REGION = "ap-south-1"

REQUIRED_RUNTIME_SSM_PARAMS = (
    "postgres_password",
    "redis_password",
    "jwt_access_secret",
    "jwt_refresh_secret",
    "better_auth_secret",
    "better_auth_url",
    "cors_origin",
    "kubeconfig_encryption_key",
    "duckdns_domain",
    "duckdns_token",
)


def verify_runtime_instance_profile(
    profile_name: str = DEFAULT_INSTANCE_PROFILE, emit_fn: StepCallback = None,
    step_id: Optional[str] = None, step_title: Optional[str] = None, aws_env: Optional[Dict[str, str]] = None,
) -> Dict[str, str]:
    """Fail closed before runtime apply if the foundation IAM instance profile or role is missing."""
    run_kwargs: Dict[str, object] = {"capture_output": True, "text": True}
    if aws_env is not None:
        run_kwargs["env"] = aws_env
    res = subprocess.run(
        ["aws", "iam", "get-instance-profile", "--instance-profile-name", profile_name, "--output", "json"],
        **run_kwargs,  # type: ignore[arg-type]
    )
    if res.returncode != 0:
        err = res.stderr.strip() or f"aws iam get-instance-profile exited {res.returncode}"
        raise RuntimeError(
            f"Foundation preflight failed: IAM instance profile '{profile_name}' not found ({err}). "
            "Provision deployment/foundation/ first before running runtime Terraform apply."
        )

    profile = json.loads(res.stdout or "{}").get("InstanceProfile", {})
    roles = profile.get("Roles") or []
    if not roles:
        raise RuntimeError(f"Foundation preflight failed: IAM instance profile '{profile_name}' has no associated IAM role.")
    role_name = roles[0].get("RoleName", "")
    _emit(emit_fn, step_id, step_title, "log", f"Verified foundation IAM profile '{profile_name}' (role={role_name}).")
    return {"profile_name": profile_name, "role_name": role_name}


def _emit(emit_fn: StepCallback, step_id: Optional[str], step_title: Optional[str], status: str, detail: str) -> None:
    if emit_fn and step_id and step_title:
        emit_fn(step_id, step_title, status, detail)


def verify_ssm_parameters_present(
    ssm_prefix: str = DEFAULT_SSM_PREFIX, region: str = DEFAULT_AWS_REGION,
    aws_env: Optional[Dict[str, str]] = None, emit_fn: StepCallback = None,
    step_id: Optional[str] = None, step_title: Optional[str] = None,
) -> List[str]:
    """Verify via metadata-only describe-parameters (zero decryption) that required SSM params exist."""
    prefix = "/" + ssm_prefix.strip("/")
    effective_region = (region or DEFAULT_AWS_REGION).strip() or DEFAULT_AWS_REGION
    run_kwargs: Dict[str, object] = {"capture_output": True, "text": True}
    if aws_env is not None:
        run_kwargs["env"] = aws_env

    found: set[str] = set()
    next_token: Optional[str] = None
    while True:
        cmd = [
            "aws", "ssm", "describe-parameters", "--region", effective_region,
            "--parameter-filters", f"Key=Name,Option=BeginsWith,Values={prefix}/", "--output", "json",
        ]
        if next_token:
            cmd.extend(["--next-token", next_token])
        res = subprocess.run(cmd, **run_kwargs)  # type: ignore[arg-type]
        if res.returncode != 0:
            err = res.stderr.strip() or f"aws ssm describe-parameters exited {res.returncode}"
            raise RuntimeError(f"SSM parameter preflight failed for {prefix}/* in {effective_region}: {err}")
        payload = json.loads(res.stdout or "{}")
        for param in payload.get("Parameters", []):
            name = param.get("Name", "")
            if name:
                found.add(name.rsplit("/", 1)[-1])
        next_token = payload.get("NextToken")
        if not next_token:
            break

    missing = [k for k in REQUIRED_RUNTIME_SSM_PARAMS if k not in found]
    if missing:
        raise RuntimeError(
            f"Deployment halted: Required SSM parameter(s) missing under {prefix}/ in {effective_region}: "
            f"{', '.join(missing)}. Seed /envscale/prod/* via deployment/bootstrap/seed-parameters.sh first."
        )
    _emit(emit_fn, step_id, step_title, "log", f"Verified {len(REQUIRED_RUNTIME_SSM_PARAMS)} required SSM parameters exist under {prefix}/ in {effective_region}.")
    return sorted(found)


def wait_for_ssm_online(
    instance_id: str, region: str = "ap-south-1", emit_fn: StepCallback = None,
    step_id: Optional[str] = None, step_title: Optional[str] = None,
    max_attempts: int = 36, interval_s: int = 5, aws_env: Optional[Dict[str, str]] = None,
) -> bool:
    """Poll AWS SSM until the target EC2 instance reports PingStatus == 'Online'."""
    run_kwargs: Dict[str, object] = {"capture_output": True, "text": True}
    if aws_env is not None:
        run_kwargs["env"] = aws_env
    for _ in range(max_attempts):
        res = subprocess.run(
            [
                "aws", "ssm", "describe-instance-information", "--region", region,
                "--filters", f"Key=InstanceIds,Values={instance_id}",
                "--query", "InstanceInformationList[0].PingStatus", "--output", "text",
            ],
            **run_kwargs,  # type: ignore[arg-type]
        )
        if res.returncode == 0 and res.stdout.strip() == "Online":
            _emit(emit_fn, step_id, step_title, "log", f"SSM agent online for {instance_id}.")
            return True
        time.sleep(interval_s)
    raise RuntimeError(f"Timed out waiting for SSM agent on instance {instance_id} to become Online.")


def _wrap_commands_for_bash(commands: List[str]) -> List[str]:
    """Run SSM RunShellScript commands via /bin/bash because Ubuntu's /bin/sh (dash) rejects pipefail."""
    if not commands:
        return []
    return [f"/bin/bash -c {shlex.quote(chr(10).join(commands))}"]


def run_ssm_command(
    instance_id: str, commands: List[str], region: str = "ap-south-1",
    comment: str = "EnvScale SSM command", emit_fn: StepCallback = None,
    step_id: Optional[str] = None, step_title: Optional[str] = None,
    check: bool = True, aws_env: Optional[Dict[str, str]] = None,
) -> subprocess.CompletedProcess:
    """Execute shell commands on an EC2 instance via AWS SSM RunCommand."""
    params_json = json.dumps({"commands": _wrap_commands_for_bash(commands)})
    run_kwargs: Dict[str, object] = {"capture_output": True, "text": True}
    if aws_env is not None:
        run_kwargs["env"] = aws_env
    send_res = subprocess.run(
        [
            "aws", "ssm", "send-command", "--region", region, "--instance-ids", instance_id,
            "--document-name", "AWS-RunShellScript", "--comment", comment,
            "--parameters", params_json, "--query", "Command.CommandId", "--output", "text",
        ],
        **run_kwargs,  # type: ignore[arg-type]
    )
    if send_res.returncode != 0:
        err = send_res.stderr.strip() or f"aws ssm send-command exited with code {send_res.returncode}"
        raise RuntimeError(err)

    command_id = send_res.stdout.strip()
    if not command_id or command_id == "None":
        raise RuntimeError("aws ssm send-command did not return a valid CommandId.")
    _emit(emit_fn, step_id, step_title, "log", f"Dispatched SSM Command {command_id} on {instance_id}...")

    subprocess.run(
        ["aws", "ssm", "wait", "command-executed", "--region", region, "--command-id", command_id, "--instance-id", instance_id],
        **run_kwargs,  # type: ignore[arg-type]
    )

    inv_res = subprocess.run(
        ["aws", "ssm", "get-command-invocation", "--region", region, "--command-id", command_id, "--instance-id", instance_id, "--output", "json"],
        **run_kwargs,  # type: ignore[arg-type]
    )
    if inv_res.returncode != 0:
        err = inv_res.stderr.strip() or f"Failed retrieving SSM invocation {command_id}"
        if check:
            raise RuntimeError(err)
        return inv_res

    payload = json.loads(inv_res.stdout or "{}")
    stdout = (payload.get("StandardOutputContent") or "").strip()
    stderr = (payload.get("StandardErrorContent") or "").strip()
    status = payload.get("Status", "Unknown")
    resp_code = payload.get("ResponseCode")
    ok = status == "Success" and (resp_code is None or int(resp_code) == 0)

    for line in stdout.splitlines():
        if line:
            _emit(emit_fn, step_id, step_title, "log", redact_sensitive_text(line))

    if not ok and check:
        err_msg = redact_sensitive_text(stderr or f"SSM command {command_id} ended with status {status}")
        _emit(emit_fn, step_id, step_title, "log", f"ERROR: {err_msg}")
        raise RuntimeError(err_msg)

    return subprocess.CompletedProcess(
        args=["aws", "ssm", "send-command", command_id],
        returncode=0 if ok else 1,
        stdout=stdout,
        stderr=stderr,
    )


def resolve_and_validate_manifest(
    commit_sha: str,
    manifest_path: Optional[str] = None,
    recovery_bucket: Optional[str] = None,
    region: str = "ap-south-1",
    aws_env: Optional[Dict[str, str]] = None,
) -> pathlib.Path:
    """Locate and schema-validate the immutable release manifest for commit_sha."""
    candidate = manifest_path or os.environ.get("ENVSCALE_RELEASE_MANIFEST", "").strip()
    if not candidate:
        default_local = os.path.join(PROJECT_ROOT, "release-manifest.json")
        if os.path.isfile(default_local):
            candidate = default_local
        elif recovery_bucket:
            downloaded = os.path.join(PROJECT_ROOT, ".envscale_test_center_logs", f"release-manifest-{commit_sha[:8]}.json")
            os.makedirs(os.path.dirname(downloaded), exist_ok=True)
            s3_uri = f"s3://{recovery_bucket}/releases/{commit_sha}/release-manifest.json"
            s3_kwargs: Dict[str, object] = {"capture_output": True, "text": True}
            if aws_env is not None:
                s3_kwargs["env"] = aws_env
            dl = subprocess.run(["aws", "s3", "cp", s3_uri, downloaded, "--region", region], **s3_kwargs)  # type: ignore[arg-type]
            if dl.returncode != 0:
                raise RuntimeError(
                    f"Release manifest not found locally or at {s3_uri}: {dl.stderr.strip()}"
                )
            candidate = downloaded
        else:
            raise RuntimeError(
                "Deployment halted: no release manifest supplied (--manifest / ENVSCALE_RELEASE_MANIFEST) "
                "and no RECOVERY_BUCKET configured to fetch the CI-generated manifest."
            )

    manifest_file = pathlib.Path(candidate)
    if not manifest_file.is_file():
        raise RuntimeError(f"Release manifest file not found: {manifest_file}")

    validator = pathlib.Path(PROJECT_ROOT) / "deployment" / "scripts" / "validate-release-manifest.py"
    val_res = subprocess.run(
        [sys_executable(), str(validator), "--manifest", str(manifest_file), "--verify-repo-migrations"],
        capture_output=True,
        text=True,
    )
    if val_res.returncode != 0:
        raise RuntimeError(f"Release manifest failed validation: {val_res.stderr.strip() or val_res.stdout.strip()}")

    data = json.loads(manifest_file.read_text(encoding="utf-8"))
    manifest_sha = data.get("git", {}).get("commit_sha", "")
    if manifest_sha != commit_sha:
        raise RuntimeError(
            f"Release manifest commit_sha ({manifest_sha}) does not match target release SHA ({commit_sha})."
        )
    return manifest_file


def sys_executable() -> str:
    import sys
    return sys.executable or "python3"


def build_remote_deploy_commands(
    commit_sha: str,
    manifest_b64: str,
    ssm_prefix: str = DEFAULT_SSM_PREFIX,
    secrets_file: str = DEFAULT_SECRETS_FILE,
    remote_manifest_path: str = DEFAULT_REMOTE_MANIFEST,
    region: str = DEFAULT_AWS_REGION,
) -> List[str]:
    """Build exact-SHA checkout, SSM secret sync, and host-runtime.sh dispatch commands."""
    q_sha = shlex.quote(commit_sha)
    q_prefix = shlex.quote(ssm_prefix)
    q_region = shlex.quote((region or DEFAULT_AWS_REGION).strip() or DEFAULT_AWS_REGION)
    q_secrets = shlex.quote(secrets_file)
    q_manifest = shlex.quote(remote_manifest_path)
    q_b64 = shlex.quote(manifest_b64)
    return [
        "set -euo pipefail",
        "test -d /opt/envscale/.git || { echo '[FATAL] EC2 repository checkout is missing.'; exit 1; }",
        "cd /opt/envscale",
        f"git fetch --no-tags origin {q_sha}",
        f"git checkout --detach {q_sha}",
        f"test \"$(git rev-parse HEAD)\" = {q_sha}",
        "test -x /opt/envscale/deployment/scripts/host-runtime.sh || chmod +x /opt/envscale/deployment/scripts/*.sh /opt/envscale/deployment/scripts/*.py /opt/envscale/envscale.sh",
        "mkdir -p /etc/envscale /var/lib/envscale",
        "chmod 700 /etc/envscale /var/lib/envscale",
        f"python3 /opt/envscale/deployment/scripts/sync-ssm-secrets.py --ssm-prefix {q_prefix} --region {q_region} --output {q_secrets}",
        f"printf '%s' {q_b64} | base64 -d > {q_manifest}",
        f"chmod 600 {q_manifest}",
        f"ENVSCALE_SECRETS_FILE={q_secrets} /opt/envscale/envscale.sh deploy --manifest {q_manifest}",
    ]


def cleanup_external_references(
    domain: Optional[str],
    token: Optional[str],
    emit_fn: StepCallback = None,
    step_id: Optional[str] = None,
    step_title: Optional[str] = None,
) -> Dict[str, str]:
    """Clear DuckDNS record and remove stale GitHub EC2_HOST / SSH_PRIVATE_KEY secrets."""
    outcomes: Dict[str, str] = {}

    if domain and token:
        clear_url = f"https://www.duckdns.org/update?domains={domain}&token={token}&clear=true"
        try:
            req = urllib.request.Request(clear_url, headers={"User-Agent": "EnvScale-TestCenter/1.0"})
            with urllib.request.urlopen(req, timeout=10) as resp:
                body = resp.read().decode("utf-8").strip()
                outcomes["duckdns"] = body
                _emit(emit_fn, step_id, step_title, "log", f"Cleared DuckDNS record for {domain}.duckdns.org ({body}).")
        except Exception as exc:
            outcomes["duckdns"] = f"error: {exc}"
            _emit(emit_fn, step_id, step_title, "log", f"DuckDNS cleanup failed: {exc}")
    else:
        outcomes["duckdns"] = "skipped"

    if shutil.which("gh"):
        auth = subprocess.run(["gh", "auth", "status"], capture_output=True)
        if auth.returncode == 0:
            for secret_name in ("EC2_HOST", "EC2_INSTANCE_ID", "SSH_PRIVATE_KEY"):
                del_res = subprocess.run(["gh", "secret", "delete", secret_name], capture_output=True, text=True)
                outcomes[secret_name] = "deleted" if del_res.returncode == 0 else "absent"
            _emit(emit_fn, step_id, step_title, "log", "Removed stale EC2_HOST / SSH_PRIVATE_KEY GitHub secrets.")
        else:
            outcomes["github"] = "unauthenticated"
    else:
        outcomes["github"] = "gh_missing"

    return outcomes


from .postgres_backup_verifier import (  # noqa: E402,F401
    BACKUP_RESULT_PREFIX,
    DEFAULT_MAX_BACKUP_AGE_SECONDS,
    build_postgres_backup_ssm_commands,
    extract_tfstate_deployment_identity,
    generate_postgres_backup_key,
    parse_postgres_backup_ssm_output,
    verify_no_host_destroy_safety,
    verify_s3_postgres_backup_object,
)


