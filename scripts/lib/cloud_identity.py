"""AWS operator identity diagnostics, MFA enrollment, role-separated STS sessions, and caller verification."""

from __future__ import annotations

import json
import os
import pathlib
import re
import shutil
import subprocess
import tempfile
import urllib.parse
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from .cloud_config_utils import (
    CANONICAL_RECOVERY_BUCKET,
    DEFAULT_ACCOUNT_ID,
    DEFAULT_REGION,
    SENSITIVE_KEYS,
    AwsSessionContext,
    build_profile_env,
    is_totp_mfa_serial,
    list_aws_profiles,
    parse_caller_arn,
    read_ram_session_payload,
    redact_sensitive_text,
    resolve_recovery_bucket,
    select_totp_mfa_serials,
    unauthenticated_identity,
)

BOOTSTRAP_POLICY_NAME = "envscale-foundation-iam-bootstrap-policy"
ADMIN_ROLE_NAME = "envscale-foundation-admin-role"
RUNTIME_PROVISIONER_ROLE_NAME = "envscale-runtime-provisioner-role"
MAX_STS_DURATION_SECONDS = 3600
MIN_STS_DURATION_SECONDS = 900
DEFAULT_RAM_ADMIN_SESSION_PATH = pathlib.Path("/dev/shm/envscale-admin-sts.json")
DEFAULT_RAM_RUNTIME_SESSION_PATH = pathlib.Path("/dev/shm/envscale-runtime-provisioner-sts.json")

FOUNDATION_CHECK_ROLES = (
    "envscale-foundation-admin-role",
    "envscale-github-foundation-plan-role",
    "envscale-github-foundation-role",
    "envscale-github-deploy-role",
    "envscale-github-release-role",
    "envscale-github-recovery-role",
    "envscale-runtime-provisioner-role",
)

__all__ = [
    "ADMIN_ROLE_NAME", "BOOTSTRAP_POLICY_NAME", "CANONICAL_RECOVERY_BUCKET",
    "DEFAULT_ACCOUNT_ID", "DEFAULT_RAM_ADMIN_SESSION_PATH", "DEFAULT_RAM_RUNTIME_SESSION_PATH",
    "DEFAULT_REGION", "FOUNDATION_CHECK_ROLES", "MAX_STS_DURATION_SECONDS",
    "MIN_STS_DURATION_SECONDS", "RUNTIME_PROVISIONER_ROLE_NAME", "SENSITIVE_KEYS",
    "AwsSessionContext", "assume_foundation_admin_role", "assume_runtime_provisioner_role",
    "build_profile_env", "complete_virtual_mfa_enrollment", "inspect_aws_identity",
    "is_totp_mfa_serial", "list_aws_profiles", "load_ram_admin_session",
    "load_ram_runtime_session", "redact_sensitive_text", "resolve_recovery_bucket",
    "select_totp_mfa_serials", "start_virtual_mfa_enrollment", "verify_session_caller_identity",
]


def _run_aws_cmd(args: List[str], aws_env: Optional[Dict[str, str]] = None) -> subprocess.CompletedProcess:
    run_kw: Dict[str, Any] = {"capture_output": True, "text": True}
    if aws_env is not None:
        run_kw["env"] = aws_env
    return subprocess.run(["aws", *args], **run_kw)


def _run_aws_json(args: List[str], aws_env: Optional[Dict[str, str]] = None) -> Tuple[int, Any, str]:
    res = _run_aws_cmd([*args, "--output", "json"], aws_env=aws_env)
    if res.returncode != 0:
        return res.returncode, None, redact_sensitive_text((res.stderr or res.stdout or "").strip())
    try:
        return 0, json.loads(res.stdout or "{}"), ""
    except json.JSONDecodeError as exc:
        return 1, None, f"Invalid JSON from AWS CLI: {exc}"


def inspect_aws_identity(
    aws_env: Optional[Dict[str, str]] = None,
    profile: Optional[str] = None,
) -> Dict[str, Any]:
    """Inspect active AWS identity, bootstrap explicit denies, MFA devices, and foundation IAM state."""
    effective_env = aws_env if aws_env is not None else build_profile_env(profile)
    if not shutil.which("aws"):
        return unauthenticated_identity("AWS CLI ('aws') not found on PATH.")

    rc, ident, err = _run_aws_json(["sts", "get-caller-identity"], aws_env=effective_env)
    if rc != 0 or not isinstance(ident, dict):
        return unauthenticated_identity(err or "AWS STS caller identity check failed.")

    reg_res = _run_aws_cmd(["configure", "get", "region"], aws_env=effective_env)
    region = (effective_env or {}).get("AWS_REGION") or reg_res.stdout.strip() or DEFAULT_REGION
    arn = ident.get("Arn", "")
    account_id = ident.get("Account", "")
    principal_type, user_name = parse_caller_arn(arn)

    attached_policies: List[str] = []
    all_mfa_serials: List[str] = []
    iam_inspect_errors: List[str] = []

    if user_name:
        prc, pol_doc, perr = _run_aws_json(
            ["iam", "list-attached-user-policies", "--user-name", user_name],
            aws_env=effective_env,
        )
        if prc == 0 and isinstance(pol_doc, dict):
            attached_policies = [p.get("PolicyName", "") for p in pol_doc.get("AttachedPolicies", []) if p.get("PolicyName")]
        elif perr:
            iam_inspect_errors.append(perr)

        mrc, mfa_doc, merr = _run_aws_json(
            ["iam", "list-mfa-devices", "--user-name", user_name],
            aws_env=effective_env,
        )
        if mrc == 0 and isinstance(mfa_doc, dict):
            all_mfa_serials = [d.get("SerialNumber", "") for d in mfa_doc.get("MFADevices", []) if d.get("SerialNumber")]
        elif merr:
            iam_inspect_errors.append(merr)

    mfa_serials = select_totp_mfa_serials(all_mfa_serials)
    unsupported_mfa_serials = [s for s in all_mfa_serials if not is_totp_mfa_serial(s)]
    bootstrap_deny = BOOTSTRAP_POLICY_NAME in attached_policies
    deny_explanation = ""
    if bootstrap_deny:
        deny_explanation = (
            f"Identity '{user_name}' has '{BOOTSTRAP_POLICY_NAME}' attached, whose explicit Deny rules "
            "(ec2:*, ssm:*, kms:*, iam:PassRole, recovery/vault S3 objects) override AdministratorAccess. "
            f"Use GitHub OIDC for Foundation, MFA-assumed '{ADMIN_ROLE_NAME}' for SSM seeding, "
            f"and MFA-assumed '{RUNTIME_PROVISIONER_ROLE_NAME}' for EC2/SSM runtime provisioning."
        )

    roles: Dict[str, Dict[str, Any]] = {}
    for role_name in FOUNDATION_CHECK_ROLES:
        rrc, rdoc, rerr = _run_aws_json(["iam", "get-role", "--role-name", role_name], aws_env=effective_env)
        if rrc == 0 and isinstance(rdoc, dict):
            roles[role_name] = {"exists": True, "arn": rdoc.get("Role", {}).get("Arn", "")}
        else:
            roles[role_name] = {"exists": False, "arn": "", "error": rerr}

    ip_rc, ip_doc, ip_err = _run_aws_json(
        ["iam", "get-instance-profile", "--instance-profile-name", "envscale-ec2-runtime-profile"],
        aws_env=effective_env,
    )
    if ip_rc == 0 and isinstance(ip_doc, dict):
        prof = ip_doc.get("InstanceProfile", {})
        inst_profile: Dict[str, Any] = {
            "exists": True,
            "name": "envscale-ec2-runtime-profile",
            "arn": prof.get("Arn", ""),
            "roles": [r.get("RoleName", "") for r in (prof.get("Roles") or [])],
        }
    else:
        inst_profile = {"exists": False, "name": "envscale-ec2-runtime-profile", "arn": "", "error": ip_err}

    return {
        "authenticated": True,
        "account_id": account_id,
        "region": region,
        "arn": arn,
        "user_id": ident.get("UserId", ""),
        "principal_type": principal_type,
        "user_name": user_name,
        "profile": profile,
        "attached_policies": attached_policies,
        "bootstrap_deny_active": bootstrap_deny,
        "deny_explanation": deny_explanation,
        "mfa_enrolled": len(mfa_serials) > 0,
        "mfa_serials": mfa_serials,
        "all_mfa_serials": all_mfa_serials,
        "unsupported_mfa_serials": unsupported_mfa_serials,
        "roles": roles,
        "instance_profile": inst_profile,
        "iam_inspect_errors": iam_inspect_errors,
    }


def start_virtual_mfa_enrollment(
    user_name: str,
    account_id: str = DEFAULT_ACCOUNT_ID,
    device_name: Optional[str] = None,
    aws_env: Optional[Dict[str, str]] = None,
) -> Dict[str, str]:
    """Create a virtual MFA device, read the Base32 seed ephemerally, and wipe the temp file."""
    if not user_name:
        raise RuntimeError("IAM user name is required to create a virtual MFA device.")
    dev_name = device_name or f"{user_name}-envscale-totp"
    tmp_dir = tempfile.mkdtemp(prefix="envscale-mfa-")
    os.chmod(tmp_dir, 0o700)
    seed_file = pathlib.Path(tmp_dir) / "seed.b32"
    try:
        rc, payload, err = _run_aws_json(
            [
                "iam", "create-virtual-mfa-device",
                "--virtual-mfa-device-name", dev_name,
                "--bootstrap-method", "Base32StringSeed",
                "--outfile", str(seed_file),
            ],
            aws_env=aws_env,
        )
        if rc != 0 or not isinstance(payload, dict):
            raise RuntimeError(f"Failed creating virtual MFA device '{dev_name}': {err}")
        serial = payload.get("VirtualMFADevice", {}).get("SerialNumber", "")
        if not serial or not seed_file.is_file():
            raise RuntimeError("AWS IAM did not return virtual MFA serial number or seed file.")
        base32_seed = seed_file.read_text(encoding="utf-8").strip()
        label = urllib.parse.quote(f"AWS:{account_id}:{user_name}", safe=":")
        otpauth_uri = (
            f"otpauth://totp/{label}?secret={urllib.parse.quote(base32_seed, safe='')}"
            f"&issuer=Amazon%20Web%20Services"
        )
        return {"serial_number": serial, "base32_seed": base32_seed, "otpauth_uri": otpauth_uri}
    finally:
        if seed_file.exists():
            seed_file.unlink()
        shutil.rmtree(tmp_dir, ignore_errors=True)


def complete_virtual_mfa_enrollment(
    user_name: str,
    serial_number: str,
    code1: str,
    code2: str,
    aws_env: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    """Bind the virtual MFA device to the IAM user using two consecutive 6-digit TOTP codes."""
    c1, c2 = code1.strip(), code2.strip()
    if not re.fullmatch(r"[0-9]{6}", c1) or not re.fullmatch(r"[0-9]{6}", c2):
        raise ValueError("Both TOTP authentication codes must be 6-digit numbers.")
    if c1 == c2:
        raise ValueError("Code 1 and Code 2 must be two consecutive, distinct TOTP codes.")
    res = _run_aws_cmd(
        [
            "iam", "enable-mfa-device",
            "--user-name", user_name,
            "--serial-number", serial_number,
            "--authentication-code1", c1,
            "--authentication-code2", c2,
        ],
        aws_env=aws_env,
    )
    if res.returncode != 0:
        raise RuntimeError(f"Failed enabling MFA device: {redact_sensitive_text((res.stderr or res.stdout).strip())}")
    return {"enabled": True, "user_name": user_name, "serial_number": serial_number}


def verify_session_caller_identity(
    session: Optional[AwsSessionContext],
    *,
    expected_role_name: str,
    expected_account_id: str = DEFAULT_ACCOUNT_ID,
    expected_region: str = DEFAULT_REGION,
) -> Dict[str, Any]:
    """Fail-closed live verification of STS session role separation, expiry, account, and region."""
    if not isinstance(session, AwsSessionContext):
        raise RuntimeError(f"Missing required MFA-assumed session for '{expected_role_name}'.")
    if session.is_expired():
        raise RuntimeError(f"STS session for '{expected_role_name}' is expired (expires_at_utc={session.expires_at_utc}).")
    if session.account_id != expected_account_id:
        raise RuntimeError(f"STS session account '{session.account_id}' != expected '{expected_account_id}'.")
    if session.region != expected_region:
        raise RuntimeError(f"STS session region '{session.region}' != expected '{expected_region}'.")

    expected_role_arn = f"arn:aws:iam::{expected_account_id}:role/{expected_role_name}"
    expected_assumed_marker = f":{expected_account_id}:assumed-role/{expected_role_name}/"
    if session.role_arn != expected_role_arn or expected_assumed_marker not in session.caller_arn:
        raise RuntimeError(
            f"Role separation violation: expected '{expected_role_name}', "
            f"got role_arn='{session.role_arn}' caller_arn='{session.caller_arn}'."
        )

    sess_env = session.build_env()
    if sess_env.get("AWS_REGION") != expected_region:
        raise RuntimeError(f"STS session env AWS_REGION '{sess_env.get('AWS_REGION')}' != expected '{expected_region}'.")

    rc, ident, err = _run_aws_json(["sts", "get-caller-identity"], aws_env=sess_env)
    if rc != 0 or not isinstance(ident, dict):
        raise RuntimeError(f"Live STS caller verification failed for '{expected_role_name}': {err}")
    live_acct = str(ident.get("Account") or "")
    live_arn = str(ident.get("Arn") or "")
    if live_acct != expected_account_id:
        raise RuntimeError(f"Live STS account '{live_acct}' != expected '{expected_account_id}'.")
    if expected_assumed_marker not in live_arn:
        raise RuntimeError(
            f"Live STS caller '{live_arn}' does not match required assumed role '{expected_role_name}'."
        )
    return {"account_id": live_acct, "region": expected_region, "arn": live_arn, "role_name": expected_role_name}


def _assume_mfa_role(
    *,
    role_name: str,
    mfa_serial: str,
    token_code: str,
    account_id: str = DEFAULT_ACCOUNT_ID,
    region: str = DEFAULT_REGION,
    session_name: str,
    duration_seconds: int = MAX_STS_DURATION_SECONDS,
    aws_env: Optional[Dict[str, str]] = None,
    verify_caller: bool = False,
) -> AwsSessionContext:
    """Assume a dedicated MFA-enforced EnvScale IAM role into an in-memory AwsSessionContext."""
    serial = mfa_serial.strip()
    code = token_code.strip()
    if account_id != DEFAULT_ACCOUNT_ID:
        raise ValueError(f"Unauthorized target AWS account '{account_id}'; expected '{DEFAULT_ACCOUNT_ID}'.")
    if region != DEFAULT_REGION:
        raise ValueError(f"Unauthorized target AWS region '{region}'; expected '{DEFAULT_REGION}'.")
    if not serial:
        raise ValueError(f"MFA device serial ARN is required to assume '{role_name}'.")
    if not is_totp_mfa_serial(serial):
        raise ValueError(
            f"MFA device '{serial}' does not support 6-digit TOTP codes for STS AssumeRole; "
            "select a ':mfa/' virtual or hardware TOTP serial instead of FIDO2/U2F passkeys."
        )
    if not re.fullmatch(r"[0-9]{6}", code):
        raise ValueError("MFA token code must be a 6-digit TOTP code.")
    dur = int(duration_seconds)
    if dur < MIN_STS_DURATION_SECONDS or dur > MAX_STS_DURATION_SECONDS:
        raise ValueError(f"STS session duration ({dur}s) must be between {MIN_STS_DURATION_SECONDS}s and {MAX_STS_DURATION_SECONDS}s.")

    role_arn = f"arn:aws:iam::{account_id}:role/{role_name}"
    rc, payload, err = _run_aws_json(
        [
            "sts", "assume-role",
            "--role-arn", role_arn,
            "--role-session-name", session_name,
            "--serial-number", serial,
            "--token-code", code,
            "--duration-seconds", str(dur),
        ],
        aws_env=aws_env,
    )
    if rc != 0 or not isinstance(payload, dict):
        raise RuntimeError(f"Failed assuming {role_name} with MFA: {err}")

    creds = payload.get("Credentials") or {}
    if not all(creds.get(k) for k in ("AccessKeyId", "SecretAccessKey", "SessionToken", "Expiration")):
        raise RuntimeError("AWS STS assume-role response lacked required temporary credentials or expiration.")

    assumed_arn = str((payload.get("AssumedRoleUser") or {}).get("Arn") or "")
    if f":{account_id}:assumed-role/{role_name}/" not in assumed_arn:
        raise RuntimeError(f"STS returned unexpected assumed-role ARN '{assumed_arn}' (expected '{role_name}').")

    ctx = AwsSessionContext(
        account_id=account_id,
        region=region,
        caller_arn=assumed_arn,
        role_arn=role_arn,
        expires_at_utc=str(creds["Expiration"]),
        _creds={k: str(creds[k]) for k in ("AccessKeyId", "SecretAccessKey", "SessionToken")},
    )
    if ctx.is_expired():
        raise RuntimeError(f"Newly assumed STS session for '{role_name}' is already expired ({ctx.expires_at_utc}).")
    if verify_caller:
        verify_session_caller_identity(ctx, expected_role_name=role_name, expected_account_id=account_id, expected_region=region)
    return ctx


def assume_foundation_admin_role(
    mfa_serial: str,
    token_code: str,
    account_id: str = DEFAULT_ACCOUNT_ID,
    region: str = DEFAULT_REGION,
    session_name: str = "envscale-test-center-admin",
    aws_env: Optional[Dict[str, str]] = None,
    duration_seconds: int = MAX_STS_DURATION_SECONDS,
    verify_caller: bool = False,
) -> AwsSessionContext:
    """Assume envscale-foundation-admin-role with MFA into an in-memory AwsSessionContext."""
    return _assume_mfa_role(
        role_name=ADMIN_ROLE_NAME,
        mfa_serial=mfa_serial,
        token_code=token_code,
        account_id=account_id,
        region=region,
        session_name=session_name,
        duration_seconds=duration_seconds,
        aws_env=aws_env,
        verify_caller=verify_caller,
    )


def assume_runtime_provisioner_role(
    mfa_serial: str,
    token_code: str,
    account_id: str = DEFAULT_ACCOUNT_ID,
    region: str = DEFAULT_REGION,
    session_name: str = "envscale-test-center-runtime",
    aws_env: Optional[Dict[str, str]] = None,
    duration_seconds: int = MAX_STS_DURATION_SECONDS,
    verify_caller: bool = True,
) -> AwsSessionContext:
    """Assume envscale-runtime-provisioner-role with TOTP MFA (<= 3600s) and live caller verification."""
    return _assume_mfa_role(
        role_name=RUNTIME_PROVISIONER_ROLE_NAME,
        mfa_serial=mfa_serial,
        token_code=token_code,
        account_id=account_id,
        region=region,
        session_name=session_name,
        duration_seconds=duration_seconds,
        aws_env=aws_env,
        verify_caller=verify_caller,
    )


def _load_ram_role_session(
    session_path: pathlib.Path,
    *,
    expected_role_name: str,
    account_id: str = DEFAULT_ACCOUNT_ID,
    region: str = DEFAULT_REGION,
    verify_caller: bool = True,
    require_ram_dir: bool = True,
) -> Optional[AwsSessionContext]:
    """Validate and load a RAM-only STS session pinned to an exact role, account, and region."""
    if account_id != DEFAULT_ACCOUNT_ID or region != DEFAULT_REGION:
        return None
    raw = read_ram_session_payload(session_path, require_ram_dir=require_ram_dir)
    if raw is None:
        return None
    creds = raw.get("Credentials")
    if not isinstance(creds, dict) or not all(
        isinstance(creds.get(k), str) and creds[k].strip()
        for k in ("AccessKeyId", "SecretAccessKey", "SessionToken", "Expiration")
    ):
        return None
    exp_str = creds["Expiration"].strip()
    try:
        datetime.fromisoformat(exp_str.replace("Z", "+00:00"))
    except ValueError:
        return None
    assumed_arn = (raw.get("AssumedRoleUser") or {}).get("Arn", "")
    if not isinstance(assumed_arn, str) or f":{account_id}:assumed-role/{expected_role_name}/" not in assumed_arn:
        return None
    ctx = AwsSessionContext(
        account_id=account_id,
        region=region,
        caller_arn=assumed_arn,
        role_arn=f"arn:aws:iam::{account_id}:role/{expected_role_name}",
        expires_at_utc=exp_str,
        _creds={k: creds[k] for k in ("AccessKeyId", "SecretAccessKey", "SessionToken")},
    )
    if ctx.is_expired():
        return None
    if verify_caller:
        try:
            verify_session_caller_identity(ctx, expected_role_name=expected_role_name, expected_account_id=account_id, expected_region=region)
        except RuntimeError:
            return None
    return ctx


def load_ram_admin_session(
    session_path: pathlib.Path = DEFAULT_RAM_ADMIN_SESSION_PATH,
    *,
    account_id: str = DEFAULT_ACCOUNT_ID,
    region: str = DEFAULT_REGION,
    verify_caller: bool = True,
    require_ram_dir: bool = True,
) -> Optional[AwsSessionContext]:
    """Validate and load a RAM-only Foundation admin STS session without persisting secrets."""
    return _load_ram_role_session(
        session_path,
        expected_role_name=ADMIN_ROLE_NAME,
        account_id=account_id,
        region=region,
        verify_caller=verify_caller,
        require_ram_dir=require_ram_dir,
    )


def load_ram_runtime_session(
    session_path: pathlib.Path = DEFAULT_RAM_RUNTIME_SESSION_PATH,
    *,
    account_id: str = DEFAULT_ACCOUNT_ID,
    region: str = DEFAULT_REGION,
    verify_caller: bool = True,
    require_ram_dir: bool = True,
) -> Optional[AwsSessionContext]:
    """Validate and load a RAM-only Runtime Provisioner STS session without persisting secrets."""
    return _load_ram_role_session(
        session_path,
        expected_role_name=RUNTIME_PROVISIONER_ROLE_NAME,
        account_id=account_id,
        region=region,
        verify_caller=verify_caller,
        require_ram_dir=require_ram_dir,
    )
