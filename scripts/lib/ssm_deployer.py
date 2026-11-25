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


def run_ssm_command(
    instance_id: str, commands: List[str], region: str = "ap-south-1",
    comment: str = "EnvScale SSM command", emit_fn: StepCallback = None,
    step_id: Optional[str] = None, step_title: Optional[str] = None,
    check: bool = True, aws_env: Optional[Dict[str, str]] = None,
) -> subprocess.CompletedProcess:
    """Execute shell commands on an EC2 instance via AWS SSM RunCommand."""
    params_json = json.dumps({"commands": commands})
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


def generate_postgres_backup_key(instance_id: str = "") -> str:
    """Generate a collision-free S3 object key under backups/postgres/ for pre-destroy dumps."""
    stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    uid = uuid.uuid4().hex[:12]
    inst_part = "".join(c for c in (instance_id or "host") if c.isalnum() or c in ("-", "_")) or "host"
    return f"backups/postgres/backup_{stamp}_{inst_part}_{uid}.dump"


def build_postgres_backup_ssm_commands(
    bucket: str,
    backup_key: str,
    region: str = DEFAULT_AWS_REGION,
    instance_id: str = "",
) -> List[str]:
    """Build fail-closed SSM commands to verify postgres state, dump, pg_restore --list, and upload to S3."""
    if not bucket or not backup_key.startswith("backups/postgres/") or not backup_key.endswith(".dump"):
        raise ValueError(f"Invalid PostgreSQL backup S3 target: s3://{bucket}/{backup_key}")
    q_bucket, q_key = shlex.quote(bucket), shlex.quote(backup_key)
    q_s3_uri = shlex.quote(f"s3://{bucket}/{backup_key}")
    q_region = shlex.quote((region or DEFAULT_AWS_REGION).strip() or DEFAULT_AWS_REGION)
    inst_clean = "".join(c for c in (instance_id or "unknown") if c.isalnum() or c in ("-", "_")) or "unknown"
    return [
        "set -euo pipefail",
        "umask 077",
        "docker inspect envscale-postgres >/dev/null 2>&1 || { echo \"[FATAL] PostgreSQL container 'envscale-postgres' is missing on host.\" >&2; exit 1; }",
        "[ \"$(docker inspect -f '{{.State.Running}}' envscale-postgres 2>/dev/null || echo false)\" = \"true\" ] || { echo \"[FATAL] PostgreSQL container 'envscale-postgres' is not running.\" >&2; exit 1; }",
        "PG_USER=\"envscale\"; PG_DB=\"envscale\"",
        "docker exec envscale-postgres pg_isready -U \"$PG_USER\" -d \"$PG_DB\" >/dev/null 2>&1 || { echo \"[FATAL] PostgreSQL database '$PG_DB' is unavailable (pg_isready failed).\" >&2; exit 1; }",
        "[ \"$(docker exec envscale-postgres psql -U \"$PG_USER\" -d \"$PG_DB\" -tAc 'SELECT 1' 2>/dev/null | tr -d '[:space:]')\" = \"1\" ] || { echo \"[FATAL] PostgreSQL database '$PG_DB' failed live connectivity query.\" >&2; exit 1; }",
        "TMP_DUMP=\"$(mktemp /tmp/envscale_pg_destroy_XXXXXX.dump)\"; TMP_TOC=\"${TMP_DUMP}.toc\"",
        "trap 'rm -f \"$TMP_DUMP\" \"$TMP_TOC\"' EXIT INT TERM",
        "docker exec envscale-postgres pg_dump --format=custom -U \"$PG_USER\" \"$PG_DB\" > \"$TMP_DUMP\" || { echo \"[FATAL] pg_dump execution failed.\" >&2; exit 1; }",
        "[ -s \"$TMP_DUMP\" ] || { echo \"[FATAL] PostgreSQL dump file is missing or empty (0 bytes).\" >&2; exit 1; }",
        "DUMP_SIZE=\"$(stat -c '%s' \"$TMP_DUMP\")\"",
        "[ -n \"$DUMP_SIZE\" ] && [ \"$DUMP_SIZE\" -gt 0 ] || { echo \"[FATAL] PostgreSQL dump size is invalid (${DUMP_SIZE:-0} bytes).\" >&2; exit 1; }",
        "docker exec -i envscale-postgres pg_restore --list < \"$TMP_DUMP\" > \"$TMP_TOC\" || { echo \"[FATAL] pg_restore --list failed; dump archive is corrupt or invalid.\" >&2; exit 1; }",
        "TOC_ENTRIES=\"$((grep -Ev '^[[:space:]]*(;|$)' \"$TMP_TOC\" || true) | wc -l | tr -d '[:space:]')\"",
        "[ -n \"$TOC_ENTRIES\" ] && [ \"$TOC_ENTRIES\" -gt 0 ] || { echo \"[FATAL] pg_restore --list found zero archive entries in dump.\" >&2; exit 1; }",
        "DUMP_SHA256=\"$(sha256sum \"$TMP_DUMP\" | awk '{print $1}')\"",
        "printf '%s' \"$DUMP_SHA256\" | grep -Eq '^[0-9a-f]{64}$' || { echo \"[FATAL] Failed computing valid SHA-256 checksum for dump archive.\" >&2; exit 1; }",
        f"aws s3 cp \"$TMP_DUMP\" {q_s3_uri} --region {q_region} --sse AES256 --metadata \"sha256=${{DUMP_SHA256}},byte_size=${{DUMP_SIZE}},instance_id={inst_clean}\" --checksum-algorithm SHA256",
        f"printf '{BACKUP_RESULT_PREFIX}{{\"bucket\":\"%s\",\"key\":\"%s\",\"size\":%s,\"sha256\":\"%s\",\"toc_entries\":%s}}\\n' {q_bucket} {q_key} \"$DUMP_SIZE\" \"$DUMP_SHA256\" \"$TOC_ENTRIES\"",
    ]


def parse_postgres_backup_ssm_output(stdout: str, *, expected_bucket: str, expected_key: str) -> Dict[str, Any]:
    """Parse and validate the structured ENVSCALE_BACKUP_RESULT payload from SSM stdout."""
    marker = ""
    for line in (stdout or "").splitlines():
        s = line.strip()
        if s.startswith(BACKUP_RESULT_PREFIX):
            marker = s[len(BACKUP_RESULT_PREFIX):].strip()
    if not marker:
        raise RuntimeError("PostgreSQL backup SSM command did not return verified backup metadata (interrupted or incomplete).")
    try:
        data = json.loads(marker)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Malformed PostgreSQL backup metadata from SSM: {exc}") from exc
    if not isinstance(data, dict) or data.get("bucket") != expected_bucket or data.get("key") != expected_key:
        raise RuntimeError(f"PostgreSQL backup target mismatch in SSM metadata for s3://{expected_bucket}/{expected_key}.")
    size, toc = data.get("size"), data.get("toc_entries")
    if not isinstance(size, int) or isinstance(size, bool) or size <= 0:
        raise RuntimeError(f"PostgreSQL dump validation failed: invalid dump size ({size!r}).")
    if not isinstance(toc, int) or isinstance(toc, bool) or toc <= 0:
        raise RuntimeError(f"PostgreSQL pg_restore --list validation failed: toc_entries={toc!r}.")
    sha = str(data.get("sha256") or "").strip().lower()
    if len(sha) != 64 or any(c not in "0123456789abcdef" for c in sha):
        raise RuntimeError(f"PostgreSQL backup reported invalid SHA-256 digest: {sha!r}.")
    return {"bucket": expected_bucket, "key": expected_key, "size": size, "sha256": sha, "toc_entries": toc}


def verify_s3_postgres_backup_object(
    *,
    bucket: str,
    backup_key: str,
    region: str = DEFAULT_AWS_REGION,
    expected_size: Optional[int] = None,
    expected_sha256: Optional[str] = None,
    aws_env: Optional[Dict[str, str]] = None,
    run_fn: Callable[..., subprocess.CompletedProcess] = subprocess.run,
) -> Dict[str, Any]:
    """Independently verify uploaded S3 backup object via s3api head-object (size + explicit SHA-256)."""
    if not bucket or not backup_key.startswith("backups/postgres/") or not backup_key.endswith(".dump"):
        raise ValueError(f"Invalid PostgreSQL backup S3 target: s3://{bucket}/{backup_key}")
    kw: Dict[str, Any] = {"capture_output": True, "text": True}
    if aws_env is not None:
        kw["env"] = aws_env
    res = run_fn(
        ["aws", "s3api", "head-object", "--bucket", bucket, "--key", backup_key, "--region", region, "--checksum-mode", "ENABLED", "--output", "json"],
        **kw,
    )
    if res.returncode != 0:
        err = redact_sensitive_text((res.stderr or res.stdout or f"exit code {res.returncode}").strip())
        raise RuntimeError(f"S3 head-object verification failed for s3://{bucket}/{backup_key}: {err}")
    try:
        doc = json.loads(res.stdout or "{}")
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Invalid JSON from s3api head-object for s3://{bucket}/{backup_key}: {exc}") from exc
    content_length = doc.get("ContentLength") if isinstance(doc, dict) else None
    if not isinstance(content_length, int) or isinstance(content_length, bool) or content_length <= 0:
        raise RuntimeError(f"Uploaded S3 backup s3://{bucket}/{backup_key} has zero or invalid ContentLength ({content_length!r}).")
    if expected_size is not None and content_length != expected_size:
        raise RuntimeError(f"S3 backup ContentLength mismatch for s3://{bucket}/{backup_key}: remote={content_length} != local={expected_size}.")
    meta = doc.get("Metadata") if isinstance(doc.get("Metadata"), dict) else {}
    meta_sha = str(meta.get("sha256") or meta.get("SHA256") or "").strip().lower()
    chk_b64 = str(doc.get("ChecksumSHA256") or "").strip()
    if expected_sha256 is not None:
        exp_hex = expected_sha256.strip().lower()
        exp_b64 = base64.b64encode(bytes.fromhex(exp_hex)).decode("ascii")
        if not meta_sha and not chk_b64:
            raise RuntimeError(f"S3 backup s3://{bucket}/{backup_key} lacks explicit SHA-256 checksum metadata (ETag is not accepted as SHA-256).")
        if meta_sha and meta_sha != exp_hex:
            raise RuntimeError(f"S3 backup Metadata.sha256 mismatch for s3://{bucket}/{backup_key}: remote={meta_sha} != local={exp_hex}.")
        if chk_b64 and chk_b64 != exp_b64:
            raise RuntimeError(f"S3 backup ChecksumSHA256 mismatch for s3://{bucket}/{backup_key}: remote={chk_b64} != expected={exp_b64}.")
    return {"bucket": bucket, "key": backup_key, "content_length": content_length, "sha256": meta_sha or (expected_sha256 or ""), "checksum_sha256": chk_b64}


def verify_no_host_destroy_safety(
    *,
    tf_state_path: str,
    bucket: str,
    region: str = DEFAULT_AWS_REGION,
    aws_env: Optional[Dict[str, str]] = None,
    run_fn: Callable[..., subprocess.CompletedProcess] = subprocess.run,
) -> Dict[str, Any]:
    """Fail-closed check when no EC2 instance ID is present: verify Terraform state has no aws_instance and S3 has a verified backup."""
    if not os.path.isfile(tf_state_path):
        raise RuntimeError("Destruction blocked: no active EC2 instance ID resolved and Terraform state file is missing.")
    try:
        st_doc = json.loads(pathlib.Path(tf_state_path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"Destruction blocked: failed reading Terraform state file: {exc}") from exc
    resources = st_doc.get("resources") if isinstance(st_doc, dict) else None
    if not isinstance(resources, list):
        raise RuntimeError("Destruction blocked: Terraform state is missing a valid 'resources' list.")
    if any(isinstance(r, dict) and r.get("type") == "aws_instance" and r.get("instances") for r in resources):
        raise RuntimeError("Destruction blocked: Terraform state still records an aws_instance resource, but instance_id could not be resolved.")
    kw: Dict[str, Any] = {"capture_output": True, "text": True}
    if aws_env is not None:
        kw["env"] = aws_env
    ls_res = run_fn(["aws", "s3api", "list-objects-v2", "--bucket", bucket, "--prefix", "backups/postgres/", "--region", region, "--output", "json"], **kw)
    if ls_res.returncode != 0:
        err = redact_sensitive_text((ls_res.stderr or ls_res.stdout or f"exit code {ls_res.returncode}").strip())
        raise RuntimeError(f"Destruction blocked: no EC2 instance present and failed listing s3://{bucket}/backups/postgres/: {err}")
    contents = (json.loads(ls_res.stdout or "{}") or {}).get("Contents") or []
    dumps = [o for o in contents if isinstance(o, dict) and str(o.get("Key", "")).startswith("backups/postgres/") and str(o.get("Key", "")).endswith(".dump") and int(o.get("Size") or 0) > 0]
    if not dumps:
        raise RuntimeError(f"Destruction blocked: no EC2 instance found and no existing PostgreSQL backup (.dump) exists in s3://{bucket}/backups/postgres/.")
    latest = sorted(dumps, key=lambda o: (str(o.get("LastModified", "")), str(o.get("Key", ""))), reverse=True)[0]
    return verify_s3_postgres_backup_object(bucket=bucket, backup_key=str(latest["Key"]), region=region, expected_size=int(latest["Size"]), aws_env=aws_env, run_fn=run_fn)


