"""Stage 1 preflight diagnostics and shared AWS/GitHub/SSM check helpers."""

from __future__ import annotations

import json
import pathlib
import shutil
import subprocess
from typing import Any, Callable, Dict, List, Optional

from .cloud_host_runner import load_deployment_env
from .cloud_identity import (
    DEFAULT_ACCOUNT_ID,
    DEFAULT_REGION,
    RUNTIME_PROVISIONER_ROLE_NAME,
    AwsSessionContext,
    build_profile_env,
    inspect_aws_identity,
    redact_sensitive_text,
    resolve_recovery_bucket,
)
from .config import PROJECT_ROOT

StepCallback = Optional[Callable[[str, str, str, str], None]]
LogCallback = Optional[Callable[[str], None]]
ApprovalCallback = Optional[Callable[[Dict[str, Any]], Any]]
AdminSessionCallback = Optional[Callable[[], AwsSessionContext]]
SecretsInputCallback = Optional[Callable[[List[str], List[str], Dict[str, str]], Dict[str, str]]]

REQUIRED_SSM_SECURESTRINGS = (
    "postgres_password",
    "redis_password",
    "jwt_access_secret",
    "jwt_refresh_secret",
    "better_auth_secret",
    "kubeconfig_encryption_key",
    "duckdns_token",
    "google_client_secret",
    "github_client_secret",
)


def _emit(step_fn: StepCallback, log_fn: LogCallback, step_id: str, title: str, status: str, detail: str = "") -> None:
    safe_detail = redact_sensitive_text(detail)
    if step_fn:
        step_fn(step_id, title, status, safe_detail)
    if log_fn and safe_detail:
        log_fn(f"[{title}] {safe_detail}" if status == "log" else f"{title}: {safe_detail}")


def _run_cmd(cmd: List[str], env: Optional[Dict[str, str]] = None, cwd: Optional[str] = None) -> subprocess.CompletedProcess:
    kw: Dict[str, Any] = {"capture_output": True, "text": True, "cwd": cwd or PROJECT_ROOT}
    if env is not None:
        kw["env"] = env
    return subprocess.run(cmd, **kw)


def _check_gh_env_config(repo: str, env_name: str, key: str) -> Dict[str, Any]:
    vars_res = _run_cmd(["gh", "variable", "list", "--env", env_name, "--json", "name"])
    secs_res = _run_cmd(["gh", "secret", "list", "--env", env_name, "--json", "name"])
    names: set[str] = set()
    for res in (vars_res, secs_res):
        if res.returncode == 0 and res.stdout.strip():
            try:
                names.update(item.get("name", "") for item in json.loads(res.stdout))
            except json.JSONDecodeError:
                pass
    return {"env": env_name, "key": key, "configured": key in names, "names": sorted(names)}


def _check_recovery_bucket(bucket_name: str, region: str, aws_env: Optional[Dict[str, str]]) -> Dict[str, Any]:
    res = _run_cmd(["aws", "s3api", "head-bucket", "--bucket", bucket_name, "--region", region], env=aws_env)
    if res.returncode == 0:
        return {"exists": True, "accessible": True, "bucket": bucket_name}
    err = redact_sensitive_text((res.stderr or res.stdout or "").strip())
    if "403" in err or "Forbidden" in err or "AccessDenied" in err:
        return {"exists": True, "accessible": False, "bucket": bucket_name, "error": err}
    return {"exists": False, "accessible": False, "bucket": bucket_name, "error": err}


def _inspect_ssm_parameters(
    prefix: str,
    region: str,
    aws_env: Optional[Dict[str, str]],
) -> Dict[str, Any]:
    res = _run_cmd(
        [
            "aws", "ssm", "describe-parameters",
            "--region", region,
            "--parameter-filters", f"Key=Name,Option=BeginsWith,Values={prefix}/",
            "--output", "json",
        ],
        env=aws_env,
    )
    if res.returncode != 0:
        return {"accessible": False, "names": [], "error": redact_sensitive_text((res.stderr or res.stdout).strip())}
    payload = json.loads(res.stdout or "{}")
    names = sorted(p.get("Name", "") for p in payload.get("Parameters", []) if p.get("Name"))
    expected = [f"{prefix}/{k}" for k in REQUIRED_SSM_SECURESTRINGS]
    missing = [n for n in expected if n not in names]
    return {"accessible": True, "names": names, "missing_securestrings": missing, "seeded_count": len(expected) - len(missing)}


def run_preflight(
    runtime_profile: Optional[str] = None,
    admin_session: Optional[AwsSessionContext] = None,
    runtime_session: Optional[AwsSessionContext] = None,
    step_fn: StepCallback = None,
    log_fn: LogCallback = None,
) -> Dict[str, Any]:
    """Stage 1: Check local tooling, AWS identity/denies/MFA, GitHub auth/envs, Foundation, SSM, and Git."""
    sid, title = "stage_preflight", "Stage 1: Preflight & Identity Diagnostics"
    _emit(step_fn, log_fn, sid, title, "start", "Inspecting tools, AWS identity, GitHub, Foundation, and Git state")

    checks: List[Dict[str, str]] = []
    for tool in ("aws", "gh", "terraform", "git", "python3"):
        ok = shutil.which(tool) is not None
        checks.append({
            "id": f"tool_{tool}",
            "name": f"CLI tool: {tool}",
            "status": "pass" if ok else "fail",
            "detail": shutil.which(tool) or f"'{tool}' not found on PATH",
            "remediation": "" if ok else f"Install '{tool}' and ensure it is on PATH.",
        })

    tf_ver_file = pathlib.Path(PROJECT_ROOT) / ".terraform-version"
    expected_tf = tf_ver_file.read_text(encoding="utf-8").strip() if tf_ver_file.is_file() else "1.14.9"
    tf_res = _run_cmd(["terraform", "version", "-json"])
    actual_tf = json.loads(tf_res.stdout).get("terraform_version", "") if tf_res.returncode == 0 and tf_res.stdout.strip() else ""
    checks.append({
        "id": "terraform_version",
        "name": "Terraform Version",
        "status": "pass" if actual_tf == expected_tf else "warn",
        "detail": f"installed={actual_tf or 'unknown'} (expected {expected_tf})",
        "remediation": "" if actual_tf == expected_tf else f"Use Terraform {expected_tf} matching .terraform-version.",
    })

    runtime_env = build_profile_env(runtime_profile) if runtime_profile else None
    aws_info = inspect_aws_identity(aws_env=runtime_env, profile=runtime_profile)
    account_id = aws_info.get("account_id") or DEFAULT_ACCOUNT_ID
    region = aws_info.get("region") or DEFAULT_REGION
    bootstrap_deny = bool(aws_info.get("bootstrap_deny_active"))

    if not aws_info.get("authenticated"):
        checks.append({
            "id": "aws_identity",
            "name": "AWS Identity",
            "status": "fail",
            "detail": aws_info.get("error", "Not authenticated"),
            "remediation": "Run 'aws configure' or select an authenticated AWS profile.",
        })
    elif bootstrap_deny:
        checks.append({
            "id": "aws_identity",
            "name": "AWS Identity & Runtime Permissions",
            "status": "warn",
            "detail": f"{aws_info.get('arn')} (explicit Deny via envscale-foundation-iam-bootstrap-policy)",
            "remediation": aws_info.get("deny_explanation", ""),
        })
    else:
        checks.append({
            "id": "aws_identity",
            "name": "AWS Identity & Runtime Permissions",
            "status": "pass",
            "detail": f"{aws_info.get('arn')} (account={account_id}, region={region})",
            "remediation": "",
        })

    mfa_enrolled = bool(aws_info.get("mfa_enrolled"))
    unsupported_mfa = aws_info.get("unsupported_mfa_serials") or []
    admin_active = bool(admin_session and not admin_session.is_expired())
    if mfa_enrolled and admin_active and admin_session:
        mfa_detail = (
            f"MFA enrolled ({len(aws_info.get('mfa_serials', []))} TOTP device), "
            f"Admin session active until {admin_session.expires_at_utc}"
        )
        mfa_rem = ""
    elif mfa_enrolled:
        mfa_detail = "TOTP MFA enrolled; Admin role session not yet assumed"
        mfa_rem = "Assume envscale-foundation-admin-role with TOTP before seeding secrets."
    elif unsupported_mfa:
        mfa_detail = f"Only non-TOTP MFA device(s) found ({len(unsupported_mfa)}); STS AssumeRole requires TOTP"
        mfa_rem = "Enroll a virtual TOTP MFA device (:mfa/) via Test Center before assuming envscale-foundation-admin-role."
    else:
        mfa_detail = "MFA not enrolled on IAM user"
        mfa_rem = "Enroll virtual MFA via Test Center before assuming envscale-foundation-admin-role."
    checks.append({
        "id": "mfa_status",
        "name": "Operator MFA & Admin Session",
        "status": "pass" if (mfa_enrolled and admin_active) else "warn",
        "detail": mfa_detail,
        "remediation": mfa_rem,
    })

    gh_auth = _run_cmd(["gh", "auth", "status"])
    gh_repo_res = _run_cmd(["gh", "repo", "view", "--json", "nameWithOwner"])
    repo_slug = json.loads(gh_repo_res.stdout).get("nameWithOwner", "") if gh_repo_res.returncode == 0 else ""
    gh_ok = gh_auth.returncode == 0 and bool(repo_slug)
    checks.append({
        "id": "github_auth",
        "name": "GitHub CLI Authentication",
        "status": "pass" if gh_ok else "fail",
        "detail": f"Authenticated for {repo_slug}" if gh_ok else redact_sensitive_text((gh_auth.stderr or gh_auth.stdout).strip()),
        "remediation": "" if gh_ok else "Run 'gh auth login' with repo + workflow scopes.",
    })

    gh_envs: Dict[str, Any] = {}
    if gh_ok:
        for env_name, key in (
            ("foundation-plan", "AWS_FOUNDATION_PLAN_ROLE_ARN"),
            ("foundation", "AWS_FOUNDATION_ROLE_ARN"),
            ("production", "AWS_DEPLOY_ROLE_ARN"),
        ):
            info = _check_gh_env_config(repo_slug, env_name, key)
            gh_envs[env_name] = info
            checks.append({
                "id": f"gh_env_{env_name}",
                "name": f"GitHub Env '{env_name}' ({key})",
                "status": "pass" if info["configured"] else "warn",
                "detail": "Configured" if info["configured"] else f"{key} is not set",
                "remediation": "" if info["configured"] else f"Stage 2 (Foundation) can set {key} from existing foundation IAM roles.",
            })

    env_cfg = load_deployment_env()
    recovery_bucket = resolve_recovery_bucket(
        account_id=account_id,
        region=region,
        configured_bucket=env_cfg.get("RECOVERY_BUCKET"),
    )
    rt_active = bool(
        runtime_session
        and not runtime_session.is_expired()
        and runtime_session.role_arn.endswith(f":role/{RUNTIME_PROVISIONER_ROLE_NAME}")
    )
    checks.append({
        "id": "runtime_provisioner_session",
        "name": "Runtime Provisioner MFA Session",
        "status": "pass" if rt_active else "warn",
        "detail": (
            f"Assumed {RUNTIME_PROVISIONER_ROLE_NAME} until {runtime_session.expires_at_utc}"
            if (rt_active and runtime_session)
            else f"{RUNTIME_PROVISIONER_ROLE_NAME} not yet assumed (required for Stages 5-7)"
        ),
        "remediation": "" if rt_active else f"Assume {RUNTIME_PROVISIONER_ROLE_NAME} with TOTP MFA before runtime stages.",
    })

    inspect_env = admin_session.build_env() if admin_active and admin_session else runtime_env
    rec_info = _check_recovery_bucket(recovery_bucket, region, inspect_env)
    inst_profile_ok = bool(aws_info.get("instance_profile", {}).get("exists"))
    roles = aws_info.get("roles", {})
    deploy_role_ok = bool(roles.get("envscale-github-deploy-role", {}).get("exists"))
    release_role_ok = bool(roles.get("envscale-github-release-role", {}).get("exists"))
    recovery_role_ok = bool(roles.get("envscale-github-recovery-role", {}).get("exists"))
    runtime_prov_role_ok = bool(roles.get(RUNTIME_PROVISIONER_ROLE_NAME, {}).get("exists"))
    foundation_ready = (
        inst_profile_ok
        and rec_info.get("exists", False)
        and deploy_role_ok
        and release_role_ok
        and recovery_role_ok
        and runtime_prov_role_ok
    )

    checks.append({
        "id": "foundation_state",
        "name": "Persistent Foundation Resources",
        "status": "pass" if foundation_ready else "warn",
        "detail": (
            f"profile={'OK' if inst_profile_ok else 'MISSING'}, "
            f"recovery_bucket={'OK' if rec_info.get('exists') else 'MISSING'}, "
            f"deploy_role={'OK' if deploy_role_ok else 'MISSING'}, "
            f"release_role={'OK' if release_role_ok else 'MISSING'}, "
            f"recovery_role={'OK' if recovery_role_ok else 'MISSING'}, "
            f"runtime_provisioner={'OK' if runtime_prov_role_ok else 'MISSING'}"
        ),
        "remediation": "" if foundation_ready else "Run Stage 2 (Foundation Setup) via foundation.yml OIDC workflow.",
    })

    ssm_info = _inspect_ssm_parameters("/envscale/prod", region, inspect_env)
    if ssm_info["accessible"]:
        missing_n = len(ssm_info["missing_securestrings"])
        checks.append({
            "id": "ssm_secrets",
            "name": "SSM /envscale/prod/* Parameters",
            "status": "pass" if missing_n == 0 else "warn",
            "detail": f"{ssm_info['seeded_count']}/9 SecureStrings present ({len(ssm_info['names'])} total params)",
            "remediation": "" if missing_n == 0 else "Run Stage 3 (Secrets Seeding) with MFA admin session.",
        })
    else:
        checks.append({
            "id": "ssm_secrets",
            "name": "SSM /envscale/prod/* Parameters",
            "status": "warn",
            "detail": "Pending MFA admin session to inspect /envscale/prod/*",
            "remediation": "Assume envscale-foundation-admin-role with MFA in Stage 3.",
        })

    branch_res = _run_cmd(["git", "rev-parse", "--abbrev-ref", "HEAD"])
    head_res = _run_cmd(["git", "rev-parse", "HEAD"])
    dev_res = _run_cmd(["git", "rev-parse", "origin/develop"])
    local_manifest = pathlib.Path(PROJECT_ROOT) / "release-manifest.json"
    git_info = {
        "branch": branch_res.stdout.strip() if branch_res.returncode == 0 else "",
        "head_sha": head_res.stdout.strip() if head_res.returncode == 0 else "",
        "origin_develop_sha": dev_res.stdout.strip() if dev_res.returncode == 0 else "",
        "local_manifest_exists": local_manifest.is_file(),
        "duckdns_token_in_env": bool(env_cfg.get("DUCKDNS_TOKEN", "").strip()),
        "duckdns_domain": env_cfg.get("DUCKDNS_DOMAIN", "envscale"),
    }
    checks.append({
        "id": "git_and_release",
        "name": "Git Checkout & Local Manifest",
        "status": "pass" if git_info["local_manifest_exists"] else "warn",
        "detail": f"branch={git_info['branch']} HEAD={git_info['head_sha'][:7]} | manifest={'present' if git_info['local_manifest_exists'] else 'fetch in Stage 4'}",
        "remediation": "" if git_info["local_manifest_exists"] else "Run Stage 4 (Release Management) to fetch & validate the CD manifest.",
    })

    for c in checks:
        _emit(step_fn, log_fn, sid, title, "log", f"[{c['status'].upper()}] {c['name']}: {c['detail']}")
    _emit(step_fn, log_fn, sid, title, "success", f"Completed {len(checks)} preflight checks")

    return {
        "status": "completed",
        "checks": checks,
        "aws_identity": aws_info,
        "github": {"authenticated": gh_ok, "repo": repo_slug, "environments": gh_envs},
        "foundation_ready": foundation_ready,
        "runtime_blocked_by_bootstrap_deny": bootstrap_deny,
        "ssm_status": ssm_info,
        "git": git_info,
    }
