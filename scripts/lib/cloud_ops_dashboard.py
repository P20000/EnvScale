"""Live AWS EC2/SSM Operations Dashboard queries and remote operational actions."""

from __future__ import annotations

import json
import shlex
import subprocess
import time
from typing import Any, Callable, Dict, List, Optional

from .cloud_deployer import CloudDeployer
from .cloud_host_runner import load_deployment_env, verify_deployment_health
from .cloud_identity import DEFAULT_ACCOUNT_ID, DEFAULT_REGION, redact_sensitive_text, resolve_recovery_bucket
from .ssm_deployer import run_ssm_command

StepCallback = Optional[Callable[[str, str, str, str], None]]
ALLOWED_REMOTE_SERVICES = ("all", "api-server", "k8s-streamer", "web", "postgres", "redis")
RESTORE_RESULT_PREFIX = "ENVSCALE_RESTORE_RESULT="
POSTGRES_BACKUP_PREFIX = "backups/postgres/"


def resolve_app_url(
    deployer: CloudDeployer,
    env_cfg: Optional[Dict[str, str]] = None,
    live_ip: str = "",
) -> str:
    """Resolve canonical HTTPS application URL using Terraform output, configured DuckDNS domain, or sslip.io fallback."""
    try:
        tf_url = str((deployer._get_tf_outputs().get("app_url") or {}).get("value") or "").strip()
    except Exception:
        tf_url = ""
    if tf_url.startswith("https://"):
        return tf_url.rstrip("/")

    cfg = env_cfg if env_cfg is not None else load_deployment_env()
    duck_dom = (cfg.get("DUCKDNS_DOMAIN") or "").strip()
    if duck_dom:
        host = duck_dom if duck_dom.endswith(".duckdns.org") else f"{duck_dom}.duckdns.org"
        return f"https://{host}"

    ip = (live_ip or "").strip()
    if ip:
        return f"https://{ip}.sslip.io"
    return ""


def _aws_cmd(args: List[str], aws_env: Optional[Dict[str, str]] = None) -> subprocess.CompletedProcess:
    kw: Dict[str, Any] = {"capture_output": True, "text": True}
    if aws_env is not None:
        kw["env"] = aws_env
    return subprocess.run(["aws", *args], **kw)


def _parse_host_probe_output(stdout: str) -> Dict[str, Any]:
    """Parse container, release pointer, and deployment ledger sections from SSM stdout."""
    sections: Dict[str, List[str]] = {"CONTAINERS": [], "LAST_GOOD": [], "HISTORY": []}
    current: Optional[str] = None
    for raw in stdout.splitlines():
        line = raw.strip()
        if line in ("===CONTAINERS===", "===LAST_GOOD===", "===HISTORY==="):
            current = line.strip("=")
            continue
        if current and line:
            sections[current].append(line)

    containers: List[Dict[str, str]] = []
    for row in sections["CONTAINERS"]:
        parts = row.split("|", 3)
        if len(parts) == 4:
            containers.append({"name": parts[0], "state": parts[1], "status": parts[2], "image": parts[3]})

    active_release: Dict[str, Any] = {}
    if sections["LAST_GOOD"]:
        try:
            manifest = json.loads("\n".join(sections["LAST_GOOD"]))
            active_release = {
                "release_id": manifest.get("release_id", ""),
                "commit_sha": manifest.get("git", {}).get("commit_sha", ""),
                "latest_migration_tag": manifest.get("compatibility", {}).get("latest_migration_tag", ""),
            }
        except json.JSONDecodeError:
            pass

    history: List[Dict[str, Any]] = []
    for entry in sections["HISTORY"]:
        try:
            history.append(json.loads(entry))
        except json.JSONDecodeError:
            pass

    return {"containers": containers, "active_release": active_release, "history": history}


def _list_s3_backups(bucket: str, prefix: str, region: str, aws_env: Optional[Dict[str, str]]) -> Dict[str, Any]:
    res = _aws_cmd(["s3api", "list-objects-v2", "--bucket", bucket, "--prefix", prefix, "--region", region, "--output", "json"], aws_env=aws_env)
    if res.returncode != 0:
        return {"bucket": bucket, "items": [], "error": redact_sensitive_text((res.stderr or res.stdout).strip())}
    payload = json.loads(res.stdout or "{}")
    objs = sorted(payload.get("Contents", []), key=lambda x: x.get("LastModified", ""), reverse=True)[:10]
    items = [
        {"key": o.get("Key", ""), "size": o.get("Size", 0), "last_modified": o.get("LastModified", "")}
        for o in objs
        if o.get("Key")
    ]
    return {"bucket": bucket, "items": items, "error": ""}


def fetch_ops_snapshot(
    aws_env: Optional[Dict[str, str]] = None,
    step_fn: StepCallback = None,
    include_http_health: bool = True,
) -> Dict[str, Any]:
    """Collect live EC2, SSM, container, deployment ledger, HTTPS health, and S3 backup status."""
    deployer = CloudDeployer(aws_env=aws_env, step_fn=step_fn)
    instance_id = deployer.get_instance_id()
    tf_ip = deployer.get_public_ip()
    env_cfg = load_deployment_env()
    domain = env_cfg.get("DUCKDNS_DOMAIN", "envscale")

    account_id = DEFAULT_ACCOUNT_ID
    region = DEFAULT_REGION
    aws_error = ""
    try:
        ctx = deployer.get_aws_context()
        account_id = ctx.get("account_id") or DEFAULT_ACCOUNT_ID
        region = ctx.get("region") or DEFAULT_REGION
    except Exception as exc:
        aws_error = redact_sensitive_text(str(exc))

    ec2_info: Dict[str, Any] = {"instance_id": instance_id, "state": "not_provisioned", "public_ip": tf_ip, "instance_type": "", "error": ""}
    ssm_info: Dict[str, Any] = {"ping_status": "Unknown", "agent_version": "", "last_ping": "", "error": ""}
    probe_data: Dict[str, Any] = {"containers": [], "active_release": {}, "history": [], "error": ""}

    if instance_id and not aws_error:
        ec2_res = _aws_cmd(
            ["ec2", "describe-instances", "--region", region, "--instance-ids", instance_id, "--output", "json"],
            aws_env=aws_env,
        )
        if ec2_res.returncode == 0:
            reservations = json.loads(ec2_res.stdout or "{}").get("Reservations", [])
            if reservations and reservations[0].get("Instances"):
                inst = reservations[0]["Instances"][0]
                ec2_info.update({
                    "state": inst.get("State", {}).get("Name", "unknown"),
                    "public_ip": inst.get("PublicIpAddress") or tf_ip,
                    "instance_type": inst.get("InstanceType", ""),
                    "launch_time": inst.get("LaunchTime", ""),
                })
        else:
            ec2_info["state"] = "error"
            ec2_info["error"] = redact_sensitive_text((ec2_res.stderr or ec2_res.stdout).strip())

        ssm_res = _aws_cmd(
            ["ssm", "describe-instance-information", "--region", region, "--filters", f"Key=InstanceIds,Values={instance_id}", "--output", "json"],
            aws_env=aws_env,
        )
        if ssm_res.returncode == 0:
            infos = json.loads(ssm_res.stdout or "{}").get("InstanceInformationList", [])
            if infos:
                ssm_info.update({
                    "ping_status": infos[0].get("PingStatus", "Unknown"),
                    "agent_version": infos[0].get("AgentVersion", ""),
                    "last_ping": str(infos[0].get("LastPingDateTime", "")),
                })
        else:
            ssm_info["error"] = redact_sensitive_text((ssm_res.stderr or ssm_res.stdout).strip())

        if ssm_info["ping_status"] == "Online":
            try:
                cmd_res = run_ssm_command(
                    instance_id,
                    [
                        "echo '===CONTAINERS==='",
                        "docker ps -a --filter label=com.envscale.tier --format '{{.Names}}|{{.State}}|{{.Status}}|{{.Image}}' 2>/dev/null || docker ps -a --format '{{.Names}}|{{.State}}|{{.Status}}|{{.Image}}' || true",
                        "echo '===LAST_GOOD==='",
                        "cat /var/lib/envscale/releases/last-known-good.manifest.json 2>/dev/null || true",
                        "echo '===HISTORY==='",
                        "tail -n 10 /var/lib/envscale/releases/history.jsonl 2>/dev/null || true",
                    ],
                    region=region,
                    comment="EnvScale ops snapshot probe",
                    check=False,
                    aws_env=aws_env,
                )
                probe_data = _parse_host_probe_output(cmd_res.stdout or "")
                probe_data["error"] = "" if cmd_res.returncode == 0 else redact_sensitive_text(cmd_res.stderr or "")
            except Exception as exc:
                probe_data["error"] = redact_sensitive_text(str(exc))

    live_ip = ec2_info.get("public_ip") or tf_ip
    app_url = resolve_app_url(deployer, env_cfg, live_ip=live_ip)
    target_host = app_url[len("https://"):].split("/", 1)[0] if app_url.startswith("https://") else ""

    health: Dict[str, Any] = {"checked": False, "ok": False, "target_url": app_url, "errors": []}
    if include_http_health and target_host and ec2_info.get("state") in ("running", "not_provisioned", "error"):
        if ec2_info.get("state") == "running":
            ok, errs = verify_deployment_health(target_host, emit=step_fn, step_id="ops_health", step_title="Live Health Check")
            health.update({"checked": True, "ok": ok, "errors": errs})

    rec_bucket = resolve_recovery_bucket(
        account_id=account_id,
        region=region,
        configured_bucket=env_cfg.get("RECOVERY_BUCKET"),
    )
    backups = _list_s3_backups(rec_bucket, POSTGRES_BACKUP_PREFIX, region, aws_env)

    return {
        "aws_error": aws_error,
        "account_id": account_id,
        "region": region,
        "ec2": ec2_info,
        "ssm": ssm_info,
        "containers": probe_data["containers"],
        "active_release": probe_data["active_release"],
        "history": probe_data["history"],
        "probe_error": probe_data["error"],
        "health": health,
        "backups": backups,
    }


def _require_online_instance(aws_env: Optional[Dict[str, str]]) -> tuple[str, str]:
    deployer = CloudDeployer(aws_env=aws_env)
    instance_id = deployer.get_instance_id()
    if not instance_id:
        raise RuntimeError("No active EC2 instance ID in Terraform state. Provision the host first.")
    region = deployer.get_aws_context()["region"]
    return instance_id, region


def fetch_remote_logs(
    service: str = "all",
    tail: int = 80,
    aws_env: Optional[Dict[str, str]] = None,
    step_fn: StepCallback = None,
) -> str:
    """Fetch bounded remote container logs over AWS SSM."""
    if service not in ALLOWED_REMOTE_SERVICES:
        raise ValueError(f"Unsupported service '{service}'. Allowed: {', '.join(ALLOWED_REMOTE_SERVICES)}")
    line_count = max(1, min(int(tail), 500))
    instance_id, region = _require_online_instance(aws_env)
    svc_arg = "" if service == "all" else f" {shlex.quote(service)}"
    cmd = (
        "docker compose --env-file /etc/envscale/rendered.compose.env "
        f"-f /opt/envscale/deployment/docker-compose.prod.yml logs --no-color --tail {line_count}{svc_arg}"
    )
    res = run_ssm_command(
        instance_id,
        ["set -euo pipefail", cmd],
        region=region,
        comment=f"EnvScale fetch logs ({service})",
        emit_fn=step_fn,
        step_id="ops_logs",
        step_title=f"Remote Logs ({service})",
        aws_env=aws_env,
    )
    return redact_sensitive_text(res.stdout or "")


def trigger_remote_verify(aws_env: Optional[Dict[str, str]] = None, step_fn: StepCallback = None) -> str:
    """Run /opt/envscale/envscale.sh verify on the active EC2 host via AWS SSM."""
    instance_id, region = _require_online_instance(aws_env)
    res = run_ssm_command(
        instance_id,
        [
            "set -euo pipefail",
            "test -f /var/lib/envscale/releases/last-known-good.manifest.json || { echo 'No last-known-good manifest on host.' >&2; exit 1; }",
            "test -f /etc/envscale/rendered.compose.env || { echo 'Missing /etc/envscale/rendered.compose.env on host.' >&2; exit 1; }",
            "cd /opt/envscale && ENVSCALE_SECRETS_FILE=/etc/envscale/secrets.env ./envscale.sh verify "
            "--manifest /var/lib/envscale/releases/last-known-good.manifest.json "
            "--env-file /etc/envscale/rendered.compose.env",
        ],
        region=region,
        comment="EnvScale host verify.sh",
        emit_fn=step_fn,
        step_id="ops_verify",
        step_title="Remote Host Readiness Verify",
        aws_env=aws_env,
    )
    return redact_sensitive_text(res.stdout or "")


def trigger_remote_backup(aws_env: Optional[Dict[str, str]] = None, step_fn: StepCallback = None) -> Dict[str, str]:
    """Dump production PostgreSQL on EC2 and upload directly to the canonical recovery bucket via SSM."""
    deployer = CloudDeployer(aws_env=aws_env)
    instance_id = deployer.get_instance_id()
    if not instance_id:
        raise RuntimeError("No active EC2 instance ID in Terraform state.")
    ctx = deployer.get_aws_context()
    region = ctx["region"]
    account_id = ctx["account_id"] or DEFAULT_ACCOUNT_ID
    env_cfg = load_deployment_env()
    rec_bucket = resolve_recovery_bucket(
        account_id=account_id,
        region=region,
        configured_bucket=env_cfg.get("RECOVERY_BUCKET"),
    )
    head = _aws_cmd(["s3api", "get-bucket-location", "--bucket", rec_bucket, "--region", region], aws_env=aws_env)
    if head.returncode != 0:
        err = redact_sensitive_text((head.stderr or head.stdout or "Bucket unreachable").strip())
        raise RuntimeError(f"Canonical recovery bucket 's3://{rec_bucket}' is not accessible ({err}).")
    stamp = time.strftime("%Y%m%d_%H%M%S")
    s3_uri = f"s3://{rec_bucket}/backups/postgres/backup_{stamp}.dump"
    dump_cmd = f"docker exec envscale-postgres pg_dump --format=custom -U envscale envscale | aws s3 cp - {shlex.quote(s3_uri)}"

    run_ssm_command(
        instance_id,
        ["set -euo pipefail", dump_cmd],
        region=region,
        comment="EnvScale manual PostgreSQL backup",
        emit_fn=step_fn,
        step_id="ops_backup",
        step_title="Remote PostgreSQL Backup to S3",
        aws_env=aws_env,
    )
    return {"s3_uri": s3_uri, "instance_id": instance_id}


def parse_restore_ssm_output(stdout: str) -> Dict[str, Any]:
    """Parse structured ENVSCALE_RESTORE_RESULT payload from db-restore.sh SSM stdout."""
    marker = ""
    for line in (stdout or "").splitlines():
        s = line.strip()
        if s.startswith(RESTORE_RESULT_PREFIX):
            marker = s[len(RESTORE_RESULT_PREFIX):].strip()
    if not marker:
        return {}
    try:
        data = json.loads(marker)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Malformed PostgreSQL restore result from SSM: {exc}") from exc
    if not isinstance(data, dict):
        raise RuntimeError("Invalid PostgreSQL restore result structure from SSM.")
    return data


def _select_latest_dump_key(bucket: str, region: str, aws_env: Optional[Dict[str, str]]) -> str:
    listing = _list_s3_backups(bucket, POSTGRES_BACKUP_PREFIX, region, aws_env)
    if listing.get("error"):
        raise RuntimeError(f"Failed listing PostgreSQL backups in s3://{bucket}/{POSTGRES_BACKUP_PREFIX}: {listing['error']}")
    for item in listing.get("items") or []:
        key = str(item.get("key") or "").strip()
        size = item.get("size") or 0
        if key.startswith(POSTGRES_BACKUP_PREFIX) and key.endswith(".dump") and int(size) > 0:
            return key
    raise RuntimeError(f"No non-empty PostgreSQL backup (.dump) found under s3://{bucket}/{POSTGRES_BACKUP_PREFIX}.")


def trigger_remote_restore(
    backup_key: Optional[str] = None,
    aws_env: Optional[Dict[str, str]] = None,
    step_fn: StepCallback = None,
    skip_verify: bool = False,
) -> Dict[str, Any]:
    """Restore a PostgreSQL .dump backup from S3 onto the active EC2 host via envscale.sh restore."""
    deployer = CloudDeployer(aws_env=aws_env)
    instance_id = deployer.get_instance_id()
    if not instance_id:
        raise RuntimeError("No active EC2 instance ID in Terraform state.")
    ctx = deployer.get_aws_context()
    region = ctx["region"]
    account_id = ctx["account_id"] or DEFAULT_ACCOUNT_ID
    env_cfg = load_deployment_env()
    rec_bucket = resolve_recovery_bucket(
        account_id=account_id,
        region=region,
        configured_bucket=env_cfg.get("RECOVERY_BUCKET"),
    )
    head = _aws_cmd(["s3api", "get-bucket-location", "--bucket", rec_bucket, "--region", region], aws_env=aws_env)
    if head.returncode != 0:
        err = redact_sensitive_text((head.stderr or head.stdout or "Bucket unreachable").strip())
        raise RuntimeError(f"Canonical recovery bucket 's3://{rec_bucket}' is not accessible ({err}).")

    chosen_key = (backup_key or "").strip() or _select_latest_dump_key(rec_bucket, region, aws_env)
    if not chosen_key.startswith(POSTGRES_BACKUP_PREFIX) or not chosen_key.endswith(".dump"):
        raise ValueError(f"Invalid PostgreSQL backup key '{chosen_key}' (must match {POSTGRES_BACKUP_PREFIX}*.dump).")

    expected_sha = ""
    head_obj = _aws_cmd(
        ["s3api", "head-object", "--bucket", rec_bucket, "--key", chosen_key, "--region", region, "--checksum-mode", "ENABLED", "--output", "json"],
        aws_env=aws_env,
    )
    if head_obj.returncode != 0:
        err = redact_sensitive_text((head_obj.stderr or head_obj.stdout or "head-object failed").strip())
        raise RuntimeError(f"S3 backup s3://{rec_bucket}/{chosen_key} is not accessible: {err}")
    obj_doc = json.loads(head_obj.stdout or "{}")
    if int(obj_doc.get("ContentLength") or 0) <= 0:
        raise RuntimeError(f"S3 backup s3://{rec_bucket}/{chosen_key} is empty (ContentLength <= 0).")
    meta_sha = str((obj_doc.get("Metadata") or {}).get("sha256") or "").strip().lower()
    if len(meta_sha) == 64 and all(c in "0123456789abcdef" for c in meta_sha):
        expected_sha = meta_sha

    restore_cmd = (
        f"ENVSCALE_SECRETS_FILE=/etc/envscale/secrets.env /opt/envscale/envscale.sh restore "
        f"--bucket {shlex.quote(rec_bucket)} --key {shlex.quote(chosen_key)} --region {shlex.quote(region)}"
    )
    if expected_sha:
        restore_cmd += f" --expected-sha256 {shlex.quote(expected_sha)}"
    if skip_verify:
        restore_cmd += " --skip-verify"

    ssm_res = run_ssm_command(
        instance_id,
        ["set -euo pipefail", restore_cmd],
        region=region,
        comment="EnvScale PostgreSQL restore from S3",
        emit_fn=step_fn,
        step_id="ops_restore",
        step_title="Remote PostgreSQL Restore from S3",
        aws_env=aws_env,
    )
    parsed = parse_restore_ssm_output(ssm_res.stdout or "")
    return {
        "bucket": rec_bucket,
        "key": chosen_key,
        "s3_uri": f"s3://{rec_bucket}/{chosen_key}",
        "instance_id": instance_id,
        "content_length": int(obj_doc.get("ContentLength") or parsed.get("size") or 0),
        "sha256": str(parsed.get("sha256") or expected_sha),
        "canonical_tables": parsed.get("canonical_tables", 0),
        "migrations": parsed.get("migrations", 0),
        "row_counts": parsed.get("row_counts", {}),
        "verify_passed": bool(parsed.get("verify_passed", False)),
    }


def trigger_remote_rollback(aws_env: Optional[Dict[str, str]] = None, step_fn: StepCallback = None) -> None:
    """Delegate host rollback to CloudDeployer.rollback()."""
    CloudDeployer(aws_env=aws_env, step_fn=step_fn).rollback(step_id="ops_rollback", step_title="Remote Host Rollback")

