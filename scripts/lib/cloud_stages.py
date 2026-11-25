"""Stages 2-4 orchestration: GitHub OIDC Foundation, MFA SSM Secrets, and CD Release Manifest."""

from __future__ import annotations

import json
import os
import pathlib
import shutil
import tempfile
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from .cloud_host_runner import load_deployment_env
from .cloud_identity import (
    ADMIN_ROLE_NAME,
    DEFAULT_ACCOUNT_ID,
    DEFAULT_REGION,
    RUNTIME_PROVISIONER_ROLE_NAME,
    AwsSessionContext,
    inspect_aws_identity,
    resolve_recovery_bucket,
)
from .cloud_preflight import (
    AdminSessionCallback,
    ApprovalCallback,
    LogCallback,
    SecretsInputCallback,
    StepCallback,
    _check_gh_env_config,
    _check_recovery_bucket,
    _emit,
    _inspect_ssm_parameters,
    _run_cmd,
)
from .config import PROJECT_ROOT
from .proc_utils import safe_stream


def _find_new_workflow_run(
    workflow: str,
    branch: str,
    started_after: datetime,
    step_fn: StepCallback,
    log_fn: LogCallback,
    sid: str,
    title: str,
) -> Dict[str, Any]:
    for _ in range(24):
        res = _run_cmd([
            "gh", "run", "list", "--workflow", workflow, "--branch", branch, "--limit", "5",
            "--json", "databaseId,status,conclusion,createdAt,url,headSha",
        ])
        if res.returncode == 0 and res.stdout.strip():
            for r in json.loads(res.stdout):
                created_raw = (r.get("createdAt") or "").replace("Z", "+00:00")
                try:
                    created_dt = datetime.fromisoformat(created_raw)
                except ValueError:
                    continue
                if created_dt >= started_after:
                    return r
        _emit(step_fn, log_fn, sid, title, "log", f"Waiting for GitHub Actions '{workflow}' run to register...")
        time.sleep(3)
    raise RuntimeError(f"Timed out waiting for '{workflow}' workflow run to appear on branch '{branch}'.")


def _poll_workflow_run(
    run_id: int,
    step_fn: StepCallback,
    log_fn: LogCallback,
    sid: str,
    title: str,
    timeout_s: int = 900,
) -> Dict[str, Any]:
    deadline = time.time() + timeout_s
    notified_waiting = False
    last_status = ""
    while time.time() < deadline:
        res = _run_cmd(["gh", "run", "view", str(run_id), "--json", "databaseId,status,conclusion,url,jobs"])
        if res.returncode != 0:
            raise RuntimeError(f"Failed querying GitHub run {run_id}: {res.stderr.strip()}")
        data = json.loads(res.stdout or "{}")
        status = data.get("status", "")
        if status != last_status:
            _emit(step_fn, log_fn, sid, title, "log", f"Run #{run_id} status={status} ({data.get('url', '')})")
            last_status = status
        if status == "waiting" and not notified_waiting:
            notified_waiting = True
            _emit(step_fn, log_fn, sid, title, "log", f"[ACTION REQUIRED] Approve GitHub Environment protection gate at: {data.get('url', '')}")
        if status == "completed":
            return data
        time.sleep(6)
    raise RuntimeError(f"Timed out waiting for GitHub run #{run_id} to complete.")


def _summarize_tfplan_artifact(run_id: int) -> Dict[str, Any]:
    with tempfile.TemporaryDirectory(prefix="envscale-tfplan-") as tmp:
        dl = _run_cmd(["gh", "run", "download", str(run_id), "--pattern", "foundation-plan-*", "-D", tmp])
        if dl.returncode != 0:
            return {"has_changes": True, "counts": {}, "changes": [], "note": f"Plan artifact unavailable: {dl.stderr.strip()}"}
        plan_files = list(pathlib.Path(tmp).rglob("tfplan.json"))
        if not plan_files:
            return {"has_changes": True, "counts": {}, "changes": [], "note": "tfplan.json missing from artifact"}
        plan_doc = json.loads(plan_files[0].read_text(encoding="utf-8"))
        counts: Dict[str, int] = {"create": 0, "update": 0, "delete": 0, "replace": 0, "no-op": 0}
        changes: List[Dict[str, Any]] = []
        for rc in plan_doc.get("resource_changes", []):
            actions = rc.get("change", {}).get("actions", [])
            if actions == ["no-op"] or actions == ["read"]:
                counts["no-op"] += 1
                continue
            if set(actions) == {"create", "delete"}:
                counts["replace"] += 1
            elif "create" in actions:
                counts["create"] += 1
            elif "delete" in actions:
                counts["delete"] += 1
            elif "update" in actions:
                counts["update"] += 1
            changes.append({"address": rc.get("address", ""), "actions": actions})
        return {"has_changes": bool(changes), "counts": counts, "changes": changes}


def run_foundation_stage(
    ref: str = "develop",
    plan_mode: str = "auto",
    plan_only: bool = False,
    account_id: str = DEFAULT_ACCOUNT_ID,
    aws_env: Optional[Dict[str, str]] = None,
    approval_cb: ApprovalCallback = None,
    step_fn: StepCallback = None,
    log_fn: LogCallback = None,
) -> Dict[str, Any]:
    """Stage 2: Configure missing GitHub Foundation role vars (existing ARNs), run OIDC plan, get approval, and apply."""
    sid, title = "stage_foundation", "Stage 2: Persistent Foundation (OIDC Plan & Apply)"
    _emit(step_fn, log_fn, sid, title, "start", f"foundation.yml on ref={ref}")

    aws_info = inspect_aws_identity(aws_env=aws_env)
    roles = aws_info.get("roles", {})
    inst_ok = bool(aws_info.get("instance_profile", {}).get("exists"))
    region = aws_info.get("region") or DEFAULT_REGION
    rec_bucket = resolve_recovery_bucket(
        account_id=account_id,
        region=region,
        configured_bucket=load_deployment_env().get("RECOVERY_BUCKET"),
    )
    bucket_ok = _check_recovery_bucket(rec_bucket, region, aws_env).get("exists", False)
    if (
        inst_ok
        and bucket_ok
        and roles.get("envscale-github-deploy-role", {}).get("exists")
        and roles.get("envscale-github-release-role", {}).get("exists")
        and roles.get("envscale-github-recovery-role", {}).get("exists")
        and roles.get(RUNTIME_PROVISIONER_ROLE_NAME, {}).get("exists")
    ):
        _emit(step_fn, log_fn, sid, title, "success", "Persistent Foundation resources already provisioned")
        return {"status": "completed", "already_provisioned": True, "summary": "Foundation already exists"}

    gh_repo_res = _run_cmd(["gh", "repo", "view", "--json", "nameWithOwner"])
    repo_slug = json.loads(gh_repo_res.stdout).get("nameWithOwner", "") if gh_repo_res.returncode == 0 else "P20000/EnvScale"

    plan_env_cfg = _check_gh_env_config(repo_slug, "foundation-plan", "AWS_FOUNDATION_PLAN_ROLE_ARN")
    apply_env_cfg = _check_gh_env_config(repo_slug, "foundation", "AWS_FOUNDATION_ROLE_ARN")
    missing_vars: Dict[str, tuple[str, str]] = {}
    if not plan_env_cfg["configured"]:
        arn = roles.get("envscale-github-foundation-plan-role", {}).get("arn") or f"arn:aws:iam::{account_id}:role/envscale-github-foundation-plan-role"
        missing_vars["AWS_FOUNDATION_PLAN_ROLE_ARN"] = ("foundation-plan", arn)
    if not apply_env_cfg["configured"]:
        arn = roles.get("envscale-github-foundation-role", {}).get("arn") or f"arn:aws:iam::{account_id}:role/envscale-github-foundation-role"
        missing_vars["AWS_FOUNDATION_ROLE_ARN"] = ("foundation", arn)

    if missing_vars:
        if not approval_cb:
            _emit(step_fn, log_fn, sid, title, "error", "GitHub Foundation OIDC variables are not set; operator approval required")
            return {"status": "needs_approval", "kind": "configure_github_foundation_vars", "missing_vars": missing_vars}
        if not approval_cb({"kind": "configure_github_foundation_vars", "vars": missing_vars, "repo": repo_slug}):
            _emit(step_fn, log_fn, sid, title, "error", "Operator declined setting GitHub Foundation variables")
            return {"status": "needs_approval", "kind": "configure_github_foundation_vars", "missing_vars": missing_vars}
        for var_name, (env_name, role_arn) in missing_vars.items():
            set_res = _run_cmd(["gh", "variable", "set", var_name, "--env", env_name, "--body", role_arn])
            if set_res.returncode != 0:
                raise RuntimeError(f"Failed setting {var_name} in GitHub env '{env_name}': {set_res.stderr.strip()}")
            _emit(step_fn, log_fn, sid, title, "log", f"Configured GitHub variable {var_name} in env '{env_name}' -> {role_arn}")

    dispatch_time = datetime.now(timezone.utc) - timedelta(seconds=10)
    disp = _run_cmd(["gh", "workflow", "run", "foundation.yml", "--ref", ref, "-f", "action=plan-only", "-f", f"plan_mode={plan_mode}"])
    if disp.returncode != 0:
        raise RuntimeError(f"Failed dispatching foundation.yml plan-only: {disp.stderr.strip()}")

    plan_run = _find_new_workflow_run("foundation.yml", ref, dispatch_time, step_fn, log_fn, sid, title)
    plan_run_id = int(plan_run["databaseId"])
    plan_result = _poll_workflow_run(plan_run_id, step_fn, log_fn, sid, title)
    if plan_result.get("conclusion") != "success":
        fail_logs = _run_cmd(["gh", "run", "view", str(plan_run_id), "--log-failed"])
        _emit(step_fn, log_fn, sid, title, "log", fail_logs.stdout[-3000:] if fail_logs.stdout else fail_logs.stderr)
        raise RuntimeError(f"Foundation plan run #{plan_run_id} ended with conclusion={plan_result.get('conclusion')}")

    plan_summary = _summarize_tfplan_artifact(plan_run_id)
    _emit(step_fn, log_fn, sid, title, "log", f"Plan #{plan_run_id} summary: {json.dumps(plan_summary.get('counts', {}))}")
    if plan_only or not plan_summary.get("has_changes", True):
        _emit(step_fn, log_fn, sid, title, "success", f"Foundation plan #{plan_run_id} completed (plan_only={plan_only})")
        return {"status": "completed", "plan_run_id": plan_run_id, "plan_summary": plan_summary, "run_url": plan_result.get("url", "")}

    if not approval_cb or not approval_cb({"kind": "foundation_apply", "plan_run_id": plan_run_id, "plan_summary": plan_summary, "run_url": plan_result.get("url", "")}):
        _emit(step_fn, log_fn, sid, title, "error", "Foundation apply awaiting operator approval")
        return {"status": "needs_approval", "kind": "foundation_apply", "plan_run_id": plan_run_id, "plan_summary": plan_summary, "run_url": plan_result.get("url", "")}

    apply_dispatch_time = datetime.now(timezone.utc) - timedelta(seconds=10)
    app_res = _run_cmd([
        "gh", "workflow", "run", "foundation.yml", "--ref", ref,
        "-f", "action=plan-and-apply", "-f", f"plan_mode={plan_mode}", "-f", "apply_confirmation=APPLY-FOUNDATION",
    ])
    if app_res.returncode != 0:
        raise RuntimeError(f"Failed dispatching foundation.yml plan-and-apply: {app_res.stderr.strip()}")

    apply_run = _find_new_workflow_run("foundation.yml", ref, apply_dispatch_time, step_fn, log_fn, sid, title)
    apply_run_id = int(apply_run["databaseId"])
    apply_result = _poll_workflow_run(apply_run_id, step_fn, log_fn, sid, title)
    if apply_result.get("conclusion") != "success":
        fail_logs = _run_cmd(["gh", "run", "view", str(apply_run_id), "--log-failed"])
        _emit(step_fn, log_fn, sid, title, "log", fail_logs.stdout[-3000:] if fail_logs.stdout else fail_logs.stderr)
        raise RuntimeError(f"Foundation apply run #{apply_run_id} ended with conclusion={apply_result.get('conclusion')}")

    post_info = inspect_aws_identity(aws_env=aws_env)
    if not post_info.get("instance_profile", {}).get("exists"):
        raise RuntimeError("Foundation apply finished, but envscale-ec2-runtime-profile is still not visible.")

    _emit(step_fn, log_fn, sid, title, "success", f"Foundation apply #{apply_run_id} succeeded and verified")
    return {"status": "completed", "plan_run_id": plan_run_id, "apply_run_id": apply_run_id, "plan_summary": plan_summary}


def run_secrets_stage(
    admin_session: Optional[AwsSessionContext],
    ensure_admin_session_cb: AdminSessionCallback = None,
    secrets_input_cb: SecretsInputCallback = None,
    dry_run: bool = False,
    force_prompt: bool = False,
    kubeconfig_key_disposition: str = "generate-fresh-no-historical-ciphertext",
    account_id: str = DEFAULT_ACCOUNT_ID,
    region: str = DEFAULT_REGION,
    step_fn: StepCallback = None,
    log_fn: LogCallback = None,
) -> Dict[str, Any]:
    """Stage 3: Inspect /envscale/prod/* via MFA admin session and seed missing SecureStrings."""
    sid, title = "stage_secrets", "Stage 3: SSM Secrets Seeding (MFA Admin Session)"
    _emit(step_fn, log_fn, sid, title, "start", "seed-parameters.sh under MFA envscale-foundation-admin-role")

    if admin_session is not None and not admin_session.role_arn.endswith(f":role/{ADMIN_ROLE_NAME}"):
        raise RuntimeError(
            f"Role separation violation: Stage 3 secrets seeding requires '{ADMIN_ROLE_NAME}', "
            f"got '{admin_session.role_arn or admin_session.caller_arn}'."
        )
    if admin_session is None or admin_session.is_expired():
        if ensure_admin_session_cb is None:
            _emit(step_fn, log_fn, sid, title, "error", "MFA-backed envscale-foundation-admin-role session required")
            return {"status": "needs_mfa", "summary": "MFA-backed admin session required before seeding SSM secrets"}
        admin_session = ensure_admin_session_cb()
        if not admin_session.role_arn.endswith(f":role/{ADMIN_ROLE_NAME}"):
            raise RuntimeError(
                f"Role separation violation: Stage 3 secrets seeding requires '{ADMIN_ROLE_NAME}', "
                f"got '{admin_session.role_arn or admin_session.caller_arn}'."
            )

    admin_env = admin_session.build_env()
    ssm_info = _inspect_ssm_parameters("/envscale/prod", region, admin_env)
    if not ssm_info["accessible"]:
        raise RuntimeError(f"Admin session could not inspect SSM /envscale/prod/: {ssm_info.get('error')}")

    missing = ssm_info["missing_securestrings"]
    if not missing and not dry_run and not force_prompt:
        _emit(step_fn, log_fn, sid, title, "success", "All 9 /envscale/prod/* SecureStrings already verified in SSM")
        return {"status": "completed", "admin_session": admin_session, "seeded_count": 9, "missing": []}

    local_env = load_deployment_env()
    defaults = {
        "DUCKDNS_TOKEN": local_env.get("DUCKDNS_TOKEN", "").strip(),
        "kubeconfig_key_disposition": kubeconfig_key_disposition,
    }
    if secrets_input_cb is None:
        if not dry_run:
            _emit(step_fn, log_fn, sid, title, "error", f"Interactive secret entry required ({len(missing)} missing SecureStrings)")
            return {"status": "needs_approval", "admin_session": admin_session, "missing": missing}
        secret_values: Dict[str, str] = {}
    else:
        secret_values = secrets_input_cb(ssm_info["names"], missing, defaults)
        if not secret_values and not dry_run:
            return {"status": "needs_approval", "admin_session": admin_session, "missing": missing}

    disp = secret_values.get("kubeconfig_key_disposition") or kubeconfig_key_disposition
    seed_script = str(pathlib.Path(PROJECT_ROOT) / "deployment/bootstrap/seed-parameters.sh")
    tmp_dir = tempfile.mkdtemp(prefix="envscale-ssm-seed-")
    os.chmod(tmp_dir, 0o700)
    secrets_path = pathlib.Path(tmp_dir) / "secrets.env"
    try:
        lines = [
            f"{k}={str(v).strip()}\n"
            for k, v in secret_values.items()
            if k != "kubeconfig_key_disposition" and str(v).strip()
        ]
        fd = os.open(str(secrets_path), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.writelines(lines)

        cmd = ["bash", seed_script]
        if dry_run:
            cmd.append("--dry-run")
        else:
            cmd.extend([
                "--apply",
                "--confirm-seed", f"SEED-SSM-{account_id}",
                "--secrets-file", str(secrets_path),
                "--kubeconfig-key-disposition", disp,
            ])
        rc = safe_stream(cmd, cwd=PROJECT_ROOT, env=admin_env, on_line=lambda ln: _emit(step_fn, log_fn, sid, title, "log", ln))
        if rc != 0:
            raise RuntimeError(f"seed-parameters.sh failed with exit code {rc}")
    finally:
        if secrets_path.exists():
            secrets_path.unlink()
        shutil.rmtree(tmp_dir, ignore_errors=True)

    post_ssm = _inspect_ssm_parameters("/envscale/prod", region, admin_env)
    _emit(step_fn, log_fn, sid, title, "success", f"SSM /envscale/prod/* verified ({post_ssm.get('seeded_count', 0)}/9 SecureStrings)")
    return {
        "status": "completed",
        "admin_session": admin_session,
        "dry_run": dry_run,
        "seeded_count": post_ssm.get("seeded_count", 0),
        "missing": post_ssm.get("missing_securestrings", []),
    }


def list_cd_releases(branch: str = "develop", limit: int = 5) -> List[Dict[str, Any]]:
    """Return recent successful cd.yml workflow runs from GitHub Actions."""
    res = _run_cmd([
        "gh", "run", "list", "--workflow", "cd.yml", "--branch", branch, "--status", "success",
        "--limit", str(limit), "--json", "databaseId,headSha,headBranch,createdAt,event,url",
    ])
    if res.returncode != 0 or not res.stdout.strip():
        return []
    return json.loads(res.stdout)


def run_release_stage(
    run_id: Optional[int] = None,
    target_sha: Optional[str] = None,
    branch: str = "develop",
    step_fn: StepCallback = None,
    log_fn: LogCallback = None,
) -> Dict[str, Any]:
    """Stage 4: Download the CD release-manifest artifact from GitHub Actions and validate digests."""
    sid, title = "stage_release", "Stage 4: Release Manifest & Digest Validation"
    _emit(step_fn, log_fn, sid, title, "start", f"Fetching release-manifest from GitHub Actions ({branch})")

    runs = list_cd_releases(branch=branch, limit=10)
    selected: Optional[Dict[str, Any]] = None
    if run_id is not None:
        selected = next((r for r in runs if int(r.get("databaseId", 0)) == int(run_id)), {"databaseId": int(run_id), "headSha": target_sha or ""})
    elif target_sha:
        selected = next((r for r in runs if r.get("headSha", "").startswith(target_sha)), None)
    elif runs:
        selected = runs[0]

    if not selected:
        raise RuntimeError(f"No successful cd.yml runs found on branch '{branch}' (or matching sha={target_sha}).")

    chosen_run_id = int(selected["databaseId"])
    dest_manifest = pathlib.Path(PROJECT_ROOT) / "release-manifest.json"
    with tempfile.TemporaryDirectory(prefix="envscale-rel-") as tmp:
        dl = _run_cmd(["gh", "run", "download", str(chosen_run_id), "-n", "release-manifest", "-D", tmp])
        if dl.returncode != 0:
            raise RuntimeError(f"Failed downloading release-manifest from run #{chosen_run_id}: {dl.stderr.strip()}")
        src_manifest = pathlib.Path(tmp) / "release-manifest.json"
        if not src_manifest.is_file():
            found = list(pathlib.Path(tmp).rglob("release-manifest.json"))
            if not found:
                raise RuntimeError(f"release-manifest.json not found inside artifact of run #{chosen_run_id}")
            src_manifest = found[0]
        dest_manifest.write_bytes(src_manifest.read_bytes())

    validator = pathlib.Path(PROJECT_ROOT) / "deployment/scripts/validate-release-manifest.py"
    val_res = _run_cmd(["python3", str(validator), "--manifest", str(dest_manifest), "--verify-repo-migrations"])
    if val_res.returncode != 0:
        raise RuntimeError(f"Release manifest validation failed: {(val_res.stderr or val_res.stdout).strip()}")

    data = json.loads(dest_manifest.read_text(encoding="utf-8"))
    commit_sha = data["git"]["commit_sha"]
    images = {
        svc: {"pinned_ref": info["pinned_ref"], "digest": info["digest"]}
        for svc, info in data["images"].items()
    }
    _emit(step_fn, log_fn, sid, title, "log", f"Validated {data['release_id']} (commit={commit_sha[:12]}, run=#{chosen_run_id})")
    for svc, info in images.items():
        _emit(step_fn, log_fn, sid, title, "log", f"  {svc}: {info['pinned_ref']}")
    _emit(step_fn, log_fn, sid, title, "success", f"Release {data['release_id']} ({commit_sha[:7]}) validated")

    return {
        "status": "completed",
        "release_id": data["release_id"],
        "commit_sha": commit_sha,
        "branch": data["git"].get("branch", branch),
        "cd_run_id": chosen_run_id,
        "manifest_path": str(dest_manifest),
        "latest_migration_tag": data["compatibility"]["latest_migration_tag"],
        "images": images,
    }

