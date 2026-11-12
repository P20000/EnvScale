#!/usr/bin/env python3
"""
EnvScale Foundation Plan — IAM & Privilege-Escalation Safety Checks.

Inspects Terraform plan `resource_changes` for:
  1. Unauthorized mutations to protected foundation IAM roles & boundary policy
     (`github_foundation`, `github_foundation_plan`, `foundation_admin[0]`,
     `workload_permissions_boundary`) during automated `update` plans.
  2. Unsafe IAM role/policy changes in `change.after` / `change.after_unknown`:
     - missing `permissions_boundary` on workload/CI/CD roles
     - `StringLike` or wildcard `*` principal in `assume_role_policy`
     - wildcard `*` / `iam:*` / `s3:*` in `Allow` statements
     - IAM write/escalation actions in workload role inline policies
"""

from __future__ import annotations

import json
import os
import re
from typing import Any

IMMUTABLE_ACCOUNT_ID = "982534376726"
SSM_MANAGED_CORE_ARN = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
ALLOWED_PASSROLE_SERVICES = frozenset({"ec2.amazonaws.com", "eks.amazonaws.com"})
WILDCARD_ALLOW_ACTIONS = frozenset({"*", "*:*", "iam:*", "s3:*", "ec2:*", "ssm:*", "kms:*", "sts:*"})
FORBIDDEN_ALLOW_ACTIONS = frozenset({"s3:DeleteBucket", "s3:DeleteBucketPolicy", "s3:DeleteObjectVersion", "iam:DeleteRolePermissionsBoundary"})

PROTECTED_FOUNDATION_IAM_ADDRESSES = frozenset({
    "aws_iam_role.github_foundation",
    "aws_iam_role_policy.github_foundation",
    "aws_iam_role.github_foundation_plan",
    "aws_iam_role_policy.github_foundation_plan",
    "aws_iam_role.foundation_admin[0]",
    "aws_iam_role_policy.foundation_admin[0]",
    "aws_iam_policy.workload_permissions_boundary",
})

BOUNDARY_ENFORCED_ROLE_ADDRESSES = frozenset({
    "aws_iam_role.ec2_runtime",
    "aws_iam_role.github_release",
    "aws_iam_role.github_deploy",
    "aws_iam_role.github_recovery",
})

WORKLOAD_POLICY_ADDRESSES = frozenset({
    "aws_iam_role_policy.ec2_runtime",
    "aws_iam_role_policy.github_release",
    "aws_iam_role_policy.github_deploy",
    "aws_iam_role_policy.github_recovery",
})


def _as_list(val: object) -> list[str]:
    if isinstance(val, list):
        return [str(v) for v in val]
    return [str(val)] if val is not None else []


def check_protected_iam_immutability(
    addr: str, actions: list[str], effective_mode: str, allow_protected_iam_updates: bool
) -> list[str]:
    """Reject automated creates/updates/deletes on bootstrap-owned foundation IAM roles & boundary."""
    if allow_protected_iam_updates and (
        os.environ.get("GITHUB_ACTIONS", "").lower() == "true" or os.environ.get("CI", "").lower() == "true"
    ):
        return [
            "--allow-protected-iam-updates is forbidden inside automated CI / GitHub Actions workflows; "
            "break-glass local MFA administration only."
        ]
    if allow_protected_iam_updates:
        return []
    if addr in PROTECTED_FOUNDATION_IAM_ADDRESSES and actions != ["no-op"]:
        return [
            f"Protected foundation IAM resource '{addr}' cannot be modified or created ({actions}) "
            f"in automated '{effective_mode}' plans; run one-time break-glass bootstrap "
            "(bootstrap-state.sh --bootstrap-foundation-iam) first."
        ]
    return []


def check_iam_resource_change_safety(rc: dict[str, Any]) -> list[str]:
    """Inspect populated `change.after` IAM & S3 attributes for unsafe policy/trust/storage updates."""
    errors: list[str] = []
    addr = str(rc.get("address", ""))
    rtype = str(rc.get("type", ""))
    change = rc.get("change")
    if not isinstance(change, dict):
        return errors
    after = change.get("after")
    after_unknown = change.get("after_unknown") if isinstance(change.get("after_unknown"), dict) else {}
    if not isinstance(after, dict):
        return errors

    if rtype == "aws_iam_role" and addr in BOUNDARY_ENFORCED_ROLE_ADDRESSES:
        pb = after.get("permissions_boundary")
        pb_unknown = after_unknown.get("permissions_boundary") is True
        if isinstance(pb, str) and pb:
            if not pb.endswith(":policy/envscale-workload-permissions-boundary"):
                errors.append(f"Role '{addr}' uses unexpected permissions_boundary '{pb}'.")
        elif not pb_unknown and ("assume_role_policy" in after or "name" in after or "permissions_boundary" in after):
            errors.append(f"Role '{addr}' is missing mandatory permissions_boundary attachment.")

    if rtype == "aws_iam_role_policy_attachment":
        pol_arn = after.get("policy_arn")
        role_name = after.get("role")
        if isinstance(pol_arn, str) and pol_arn != SSM_MANAGED_CORE_ARN:
            errors.append(f"Attachment '{addr}' uses unauthorized managed policy '{pol_arn}'.")
        if isinstance(role_name, str) and role_name != "envscale-ec2-runtime-role":
            errors.append(f"Attachment '{addr}' targets unauthorized role '{role_name}'.")

    if rtype == "aws_iam_role" and isinstance(after.get("assume_role_policy"), str) and after["assume_role_policy"]:
        trust_raw = after["assume_role_policy"]
        if "StringLike" in trust_raw or "ArnLike" in trust_raw:
            errors.append(f"Trust policy for '{addr}' must not contain StringLike/ArnLike conditions.")
        for acct in re.findall(r"arn:aws:(?:iam|sts)::(\d{12}):", trust_raw):
            if acct != IMMUTABLE_ACCOUNT_ID:
                errors.append(f"Trust policy for '{addr}' references unauthorized AWS account '{acct}'.")
        try:
            trust_doc = json.loads(trust_raw)
        except json.JSONDecodeError as exc:
            errors.append(f"Invalid JSON in assume_role_policy for '{addr}': {exc}")
        else:
            for st in trust_doc.get("Statement") or []:
                if not isinstance(st, dict) or st.get("Effect") != "Allow":
                    continue
                princ = st.get("Principal")
                if princ == "*" or (isinstance(princ, dict) and any("*" in _as_list(v) for v in princ.values())):
                    errors.append(f"Trust policy for '{addr}' must not allow wildcard Principal '*'.")
                if addr == "aws_iam_role.foundation_admin[0]":
                    mfa = ((st.get("Condition") or {}).get("Bool") or {}).get("aws:MultiFactorAuthPresent")
                    if str(mfa).lower() != "true":
                        errors.append("Break-glass role 'aws_iam_role.foundation_admin[0]' trust policy lacks MFA Bool condition.")

    if rtype in ("aws_iam_role_policy", "aws_iam_policy") and isinstance(after.get("policy"), str) and after["policy"]:
        try:
            pol_doc = json.loads(after["policy"])
        except json.JSONDecodeError as exc:
            errors.append(f"Invalid JSON in policy for '{addr}': {exc}")
        else:
            stmts = [s for s in (pol_doc.get("Statement") or []) if isinstance(s, dict)]
            if addr == "aws_iam_policy.workload_permissions_boundary":
                deny_acts = {a for s in stmts if s.get("Effect") == "Deny" for a in _as_list(s.get("Action"))}
                for req in ("iam:Create*", "iam:Put*", "iam:Delete*", "iam:Attach*", "s3:DeleteBucket", "s3:PutBucketPolicy"):
                    if req not in deny_acts:
                        errors.append(f"Workload permissions boundary '{addr}' missing mandatory explicit Deny '{req}'.")
            if addr == "aws_iam_role_policy.github_foundation":
                deny_sids = {str(s.get("Sid", "")) for s in stmts if s.get("Effect") == "Deny"}
                if "DenySelfAndBreakGlassAdminMutation" not in deny_sids or "DenyBoundaryRemovalAndPolicyWeakening" not in deny_sids:
                    errors.append(f"Foundation policy '{addr}' missing self/break-glass/boundary explicit Deny guard statements.")
            for st in stmts:
                if st.get("Effect") != "Allow":
                    continue
                acts = _as_list(st.get("Action"))
                res_list = _as_list(st.get("Resource"))
                if any(a in WILDCARD_ALLOW_ACTIONS for a in acts):
                    errors.append(f"Policy '{addr}' contains overly broad wildcard Allow action: {acts}")
                if any(a in FORBIDDEN_ALLOW_ACTIONS for a in acts):
                    errors.append(f"Policy '{addr}' allows forbidden destructive/escalation action: {acts}")
                if "iam:PassRole" in acts:
                    se = (st.get("Condition") or {}).get("StringEquals") or {}
                    pts = _as_list(se.get("iam:PassedToService")) if isinstance(se, dict) else []
                    if not pts or not set(pts).issubset(ALLOWED_PASSROLE_SERVICES) or "*" in res_list:
                        errors.append(f"Policy '{addr}' allows iam:PassRole without strict iam:PassedToService/resource restriction.")
                if addr == "aws_iam_role_policy.github_foundation" and any(
                    a.startswith(("iam:Create", "iam:Put", "iam:Update", "iam:Attach", "iam:Delete")) for a in acts
                ):
                    if any("github-foundation-role" in r or "foundation-admin-role" in r or r == "*" for r in res_list):
                        errors.append(f"Foundation policy '{addr}' attempts self-escalation or break-glass mutation on {res_list}.")
                if addr in WORKLOAD_POLICY_ADDRESSES and any(
                    a.startswith(("iam:Create", "iam:Put", "iam:Update", "iam:Attach", "iam:Delete"))
                    or a == "sts:AssumeRole"
                    for a in acts
                ):
                    errors.append(f"Workload policy '{addr}' contains disallowed IAM escalation Allow action: {acts}")

    if rtype == "aws_s3_bucket_public_access_block" and any(
        after.get(k) is False for k in ("block_public_acls", "ignore_public_acls", "block_public_policy", "restrict_public_buckets")
    ):
        errors.append(f"S3 public access block '{addr}' weakens public access blocking: {after}")
    if rtype == "aws_s3_bucket_policy" and isinstance(after.get("policy"), str) and after["policy"]:
        if "DenyInsecureTransport" not in after["policy"] or "DenyBucketAndVersionDestruction" not in after["policy"]:
            errors.append(f"S3 bucket policy '{addr}' missing mandatory transport/destruction Deny statements.")
    return errors


def verify_bootstrap_iam_and_boundary_live(
    foundation_dir: Any,
    *,
    account_id: str = IMMUTABLE_ACCOUNT_ID,
    repository: str = "P20000/EnvScale",
    operator_principal: str = f"arn:aws:iam::{IMMUTABLE_ACCOUNT_ID}:user/DEV-user-alpha",
    iam_caller: Any = None,
) -> dict[str, str]:
    """Verify live AWS trust policies, inline policies, and workload boundary after one-time bootstrap."""
    import pathlib
    import day0_identity_guard as guard
    import iam_policy_simulator as sim

    call = iam_caller or guard._aws_iam_cli
    fdir = pathlib.Path(foundation_dir)
    rendered = sim.build_rendered_foundation_policies(fdir)
    role_checks = (
        (
            "envscale-github-foundation-plan-role",
            "envscale-github-foundation-plan-policy",
            rendered["role_github_foundation_plan"],
            {
                "allowed_operator_principals": (),
                "allowed_oidc_subs": (f"repo:{repository}:environment:foundation-plan",),
                "expected_trust_doc": rendered["trust_github_foundation_plan"],
            },
        ),
        (
            "envscale-github-foundation-role",
            "envscale-github-foundation-policy",
            rendered["role_github_foundation"],
            {
                "allowed_operator_principals": (),
                "allowed_oidc_subs": (f"repo:{repository}:environment:foundation",),
                "expected_trust_doc": rendered["trust_github_foundation"],
            },
        ),
        (
            "envscale-foundation-admin-role",
            "envscale-foundation-admin-policy",
            rendered["role_foundation_admin"],
            {
                "allowed_operator_principals": (operator_principal,),
                "allowed_oidc_subs": (),
                "require_mfa": True,
                "expected_trust_doc": rendered["trust_foundation_admin"],
            },
        ),
    )
    for role_name, inline_name, expected_inline_doc, trust_kw in role_checks:
        role_obj = (call("get-role", ["--role-name", role_name]) or {}).get("Role") or {}
        guard.validate_live_role_trust_policy(
            role_obj,
            role_label=role_name,
            expected_account=account_id,
            **trust_kw,
        )
        pol_resp = call("get-role-policy", ["--role-name", role_name, "--policy-name", inline_name]) or {}
        live_inline = guard._decode_policy_doc(pol_resp.get("PolicyDocument"))
        if guard._canonical_policy(live_inline) != guard._canonical_policy(expected_inline_doc):
            raise SystemExit(f"[FATAL] Live inline policy '{inline_name}' on '{role_name}' drifted from Foundation HCL.")

    boundary_arn = f"arn:aws:iam::{account_id}:policy/envscale-workload-permissions-boundary"
    pol_meta = (call("get-policy", ["--policy-arn", boundary_arn]) or {}).get("Policy") or {}
    ver_id = str(pol_meta.get("DefaultVersionId", ""))
    if not ver_id:
        raise SystemExit(f"[FATAL] Missing DefaultVersionId on live boundary policy '{boundary_arn}'.")
    ver_obj = (call("get-policy-version", ["--policy-arn", boundary_arn, "--version-id", ver_id]) or {}).get("PolicyVersion") or {}
    live_boundary = guard._decode_policy_doc(ver_obj.get("Document"))
    if guard._canonical_policy(live_boundary) != guard._canonical_policy(rendered["role_workload_permissions_boundary"]):
        raise SystemExit(f"[FATAL] Live workload boundary policy '{boundary_arn}' drifted from Foundation HCL.")

    return {
        "workload_boundary_arn": boundary_arn,
        "foundation_plan_role": "envscale-github-foundation-plan-role",
        "foundation_apply_role": "envscale-github-foundation-role",
        "foundation_admin_role": "envscale-foundation-admin-role",
    }


def _probe_iam_resource(call: Any, op: str, params: list[str]) -> dict[str, Any] | None:
    """Invoke a read-only IAM probe, returning None on NoSuchEntity while failing closed on other errors."""
    try:
        return call(op, params) or {}
    except SystemExit as exc:
        if "NoSuchEntity" in str(exc):
            return None
        raise


def validate_foundation_iam_bootstrap_policy(policy_path: Any, account_id: str = IMMUTABLE_ACCOUNT_ID) -> dict[str, Any]:
    """Verify the one-time operator bootstrap policy is narrowly scoped and does not require operator MFA."""
    import pathlib

    doc = json.loads(pathlib.Path(policy_path).read_text(encoding="utf-8"))
    stmts = [s for s in (doc.get("Statement") or []) if isinstance(s, dict)]
    allows = [s for s in stmts if s.get("Effect") == "Allow"]
    denies = [s for s in stmts if s.get("Effect") == "Deny"]
    if not allows or not denies:
        raise SystemExit("[FATAL] Foundation bootstrap policy must define explicit Allow and Deny statements.")
    allowed_prefixes = (
        f"arn:aws:iam::{account_id}:role/envscale-",
        f"arn:aws:iam::{account_id}:policy/envscale-workload-permissions-boundary",
        f"arn:aws:iam::{account_id}:policy/envscale-foundation-iam-bootstrap-policy",
        f"arn:aws:iam::{account_id}:user/",
        f"arn:aws:iam::{account_id}:oidc-provider/token.actions.githubusercontent.com",
        f"arn:aws:s3:::envscale-tfstate-{account_id}-ap-south-1",
    )
    for st in allows:
        acts, res = _as_list(st.get("Action")), _as_list(st.get("Resource"))
        if any(a in WILDCARD_ALLOW_ACTIONS or a in ("iam:CreateUser", "iam:PutUserPolicy", "iam:AttachUserPolicy", "iam:PassRole", "s3:PutBucketPolicy", "s3:DeleteBucket") for a in acts):
            raise SystemExit(f"[FATAL] Bootstrap policy contains forbidden broad/escalation action: {acts}")
        cond_txt = json.dumps(st.get("Condition") or {})
        if "MultiFactorAuthPresent" in cond_txt or "MultiFactorAuthAge" in cond_txt:
            raise SystemExit(f"[FATAL] Bootstrap Allow statement '{st.get('Sid')}' must not require operator MFA conditions.")
        if acts == ["s3:ListBucket"] and _as_list(((st.get("Condition") or {}).get("StringLike") or {}).get("s3:prefix")) != ["foundation/*"]:
            raise SystemExit(f"[FATAL] Bootstrap s3:ListBucket statement '{st.get('Sid')}' must restrict s3:prefix to ['foundation/*'].")
        if acts not in (["sts:GetCallerIdentity"], ["iam:ListOpenIDConnectProviders"]) and (not res or any(r == "*" or not r.startswith(allowed_prefixes) for r in res)):
            raise SystemExit(f"[FATAL] Bootstrap Allow statement '{st.get('Sid')}' has out-of-scope Resource: {res}")
    deny_acts = {a for st in denies for a in _as_list(st.get("Action"))}
    for req_deny in ("s3:DeleteBucket", "s3:PutBucketPolicy", "s3:DeleteBucketPolicy", "iam:PassRole", "iam:PutUserPolicy", "iam:AttachUserPolicy"):
        if req_deny not in deny_acts:
            raise SystemExit(f"[FATAL] Bootstrap policy missing explicit Deny '{req_deny}'.")
    return doc


def verify_foundation_iam_bootstrap_caller(
    sts_doc: dict[str, Any],
    bootstrap_policy_path: Any,
    *,
    account_id: str = IMMUTABLE_ACCOUNT_ID,
    operator_principal: str = f"arn:aws:iam::{IMMUTABLE_ACCOUNT_ID}:user/DEV-user-alpha",
    iam_caller: Any = None,
    rendered_policies: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Verify designated operator (no MFA prerequisite) OR existing break-glass MFA admin caller."""
    import pathlib
    import day0_identity_guard as guard
    import iam_policy_simulator as sim

    if os.environ.get("GITHUB_ACTIONS", "").lower() == "true" or os.environ.get("CI", "").lower() == "true":
        raise SystemExit("[FATAL] bootstrap-foundation-iam is a one-time human operation and is forbidden in GitHub Actions / CI.")
    if not isinstance(sts_doc, dict):
        raise SystemExit("[FATAL] STS identity payload must be a JSON object.")
    acct, arn = str(sts_doc.get("Account", "")).strip(), str(sts_doc.get("Arn", "")).strip()
    if acct != account_id or arn.endswith(":root"):
        raise SystemExit(f"[FATAL] Bootstrap caller rejected (account={acct!r}, arn={arn!r}).")

    call = iam_caller or guard._aws_iam_cli
    expected_doc = validate_foundation_iam_bootstrap_policy(pathlib.Path(bootstrap_policy_path), account_id=account_id)
    rendered = rendered_policies or sim.build_rendered_foundation_policies(pathlib.Path(bootstrap_policy_path).resolve().parent.parent / "foundation")

    if arn == operator_principal and ":user/" in arn:
        user_name = arn.split(":user/", 1)[1]
        if (call("list-user-policies", ["--user-name", user_name]) or {}).get("PolicyNames"):
            raise SystemExit(f"[FATAL] Operator '{user_name}' must not rely on inline IAM policies during Foundation bootstrap.")
        attached = [str(p.get("PolicyArn", "")) for p in ((call("list-attached-user-policies", ["--user-name", user_name]) or {}).get("AttachedPolicies") or [])]
        expected_bp_arn = f"arn:aws:iam::{account_id}:policy/envscale-foundation-iam-bootstrap-policy"
        ver_id = str(((call("get-policy", ["--policy-arn", expected_bp_arn]) or {}).get("Policy") or {}).get("DefaultVersionId", ""))
        live_doc = guard._decode_policy_doc(((call("get-policy-version", ["--policy-arn", expected_bp_arn, "--version-id", ver_id]) or {}).get("PolicyVersion") or {}).get("Document"))
        if guard._canonical_policy(live_doc) != guard._canonical_policy(expected_doc):
            raise SystemExit(f"[FATAL] Live '{expected_bp_arn}' drifted from {bootstrap_policy_path}.")
        admin_probe = _probe_iam_resource(call, "get-role", ["--role-name", "envscale-foundation-admin-role"])
        if admin_probe is not None:
            guard.validate_live_role_trust_policy(
                admin_probe.get("Role") or {}, role_label="envscale-foundation-admin-role", expected_account=account_id,
                allowed_operator_principals=(operator_principal,), allowed_oidc_subs=(), require_mfa=True, expected_trust_doc=rendered["trust_foundation_admin"],
            )
            if "arn:aws:iam::aws:policy/AdministratorAccess" in attached or attached != [expected_bp_arn]:
                raise SystemExit(f"[FATAL] Operator '{user_name}' must carry ONLY narrow '{expected_bp_arn}' once recovery admin role exists (AdministratorAccess must be transitioned); found {attached}.")
        else:
            allowed_initial = ([expected_bp_arn], [expected_bp_arn, "arn:aws:iam::aws:policy/AdministratorAccess"], ["arn:aws:iam::aws:policy/AdministratorAccess", expected_bp_arn])
            if attached not in allowed_initial:
                raise SystemExit(f"[FATAL] Operator '{user_name}' must carry narrow '{expected_bp_arn}' (with optional temporary AdministratorAccess during initial bootstrap); found {attached}.")
        return {"mode": "operator_direct", "caller_arn": arn, "admin_role_preexisted": admin_probe is not None}

    if guard.ADMIN_ROLE_STS_RE.fullmatch(arn):
        guard.verify_breakglass_admin_caller_and_trust(sts_doc, iam_caller=call, expected_account=account_id, allowed_operator_principals=(operator_principal,))
        attached_role_pols = (call("list-attached-role-policies", ["--role-name", "envscale-foundation-admin-role"]) or {}).get("AttachedPolicies") or []
        if attached_role_pols:
            raise SystemExit(f"[FATAL] envscale-foundation-admin-role must not carry managed policies (e.g. AdministratorAccess): {attached_role_pols}")
        return {"mode": "breakglass_admin_mfa", "caller_arn": arn, "admin_role_preexisted": True}

    raise SystemExit(
        f"[FATAL] Foundation IAM bootstrap requires exact operator '{operator_principal}' or assumed MFA 'envscale-foundation-admin-role'; got '{arn}'."
    )


def run_bootstrap_foundation_iam(
    foundation_dir: Any,
    sts_json_path: Any,
    backend_hcl_path: Any,
    *,
    account_id: str = IMMUTABLE_ACCOUNT_ID,
    operator_principal: str = f"arn:aws:iam::{IMMUTABLE_ACCOUNT_ID}:user/DEV-user-alpha",
    reconcile_existing: bool = False,
    iam_caller: Any = None,
    runner: Any = None,
    plan_bin_path: Any = None,
    expected_plan_sha256: str | None = None,
) -> dict[str, Any]:
    """One-time operator (or repeat break-glass MFA admin) bootstrap of admin role, boundary, & OIDC roles."""
    import pathlib
    import subprocess
    import sys
    import day0_identity_guard as guard
    import iam_policy_simulator as sim

    fdir = pathlib.Path(foundation_dir).resolve()
    plan_bin = pathlib.Path(plan_bin_path).resolve() if plan_bin_path else fdir / "tfplan.bootstrap.bin"
    if plan_bin_path and not plan_bin.exists():
        raise SystemExit(f"[FATAL] Reviewed binary plan not found: {plan_bin}")
    if plan_bin_path and expected_plan_sha256:
        import hashlib
        actual_hash = hashlib.sha256(plan_bin.read_bytes()).hexdigest().lower()
        if actual_hash != expected_plan_sha256.lower().strip():
            raise SystemExit(f"[FATAL] Plan checksum mismatch!\n  Expected: {expected_plan_sha256}\n  Actual:   {actual_hash}")
    bdir = fdir.parent / "bootstrap"
    hcl_file = pathlib.Path(backend_hcl_path).resolve()
    validator = bdir / "validate-foundation-plan.py"
    call = iam_caller or guard._aws_iam_cli
    run_fn = runner or subprocess.run
    sts_doc = json.loads(pathlib.Path(sts_json_path).read_text(encoding="utf-8"))
    rendered = sim.build_rendered_foundation_policies(fdir)

    caller_info = verify_foundation_iam_bootstrap_caller(
        sts_doc, bdir / "foundation-iam-bootstrap-policy.json", account_id=account_id,
        operator_principal=operator_principal, iam_caller=call, rendered_policies=rendered,
    )
    run_fn(["terraform", "init", "-input=false", f"-backend-config={hcl_file}"], cwd=str(fdir), check=True)
    state_proc = run_fn(["terraform", "state", "list"], cwd=str(fdir), capture_output=True, text=True, check=False)
    existing_state = set((state_proc.stdout or "").splitlines()) if state_proc.returncode == 0 else set()

    import_specs = (
        ("aws_iam_policy.workload_permissions_boundary", f"arn:aws:iam::{account_id}:policy/envscale-workload-permissions-boundary", "get-policy", ["--policy-arn", f"arn:aws:iam::{account_id}:policy/envscale-workload-permissions-boundary"]),
        ("aws_iam_role.foundation_admin[0]", "envscale-foundation-admin-role", "get-role", ["--role-name", "envscale-foundation-admin-role"]),
        ("aws_iam_role_policy.foundation_admin[0]", "envscale-foundation-admin-role:envscale-foundation-admin-policy", "get-role-policy", ["--role-name", "envscale-foundation-admin-role", "--policy-name", "envscale-foundation-admin-policy"]),
        ("aws_iam_role.github_foundation_plan", "envscale-github-foundation-plan-role", "get-role", ["--role-name", "envscale-github-foundation-plan-role"]),
        ("aws_iam_role_policy.github_foundation_plan", "envscale-github-foundation-plan-role:envscale-github-foundation-plan-policy", "get-role-policy", ["--role-name", "envscale-github-foundation-plan-role", "--policy-name", "envscale-github-foundation-plan-policy"]),
        ("aws_iam_role.github_foundation", "envscale-github-foundation-role", "get-role", ["--role-name", "envscale-github-foundation-role"]),
        ("aws_iam_role_policy.github_foundation", "envscale-github-foundation-role:envscale-github-foundation-policy", "get-role-policy", ["--role-name", "envscale-github-foundation-role", "--policy-name", "envscale-github-foundation-policy"]),
    )
    aws_preexists: dict[str, bool] = {}
    for addr, import_id, probe_op, probe_args in import_specs:
        exists_in_aws = _probe_iam_resource(call, probe_op, probe_args) is not None
        aws_preexists[addr] = exists_in_aws
        if exists_in_aws and addr not in existing_state:
            run_fn(["terraform", "import", "-input=false", addr, import_id], cwd=str(fdir), check=True)

    targets = [f"-target={a}" for a in sorted(PROTECTED_FOUNDATION_IAM_ADDRESSES)]
    plan_json = fdir / "tfplan.bootstrap.json"
    apply_executed = False
    try:
        if not plan_bin_path:
            run_fn(["terraform", "plan", "-input=false", f"-out={plan_bin}", *targets], cwd=str(fdir), check=True)
        with plan_json.open("w", encoding="utf-8") as fh:
            run_fn(["terraform", "show", "-json", str(plan_bin)], cwd=str(fdir), stdout=fh, check=True)
        os.chmod(plan_json, 0o600)
        run_fn([sys.executable, str(validator), "--mode", "bootstrap", "--allow-protected-iam-updates", str(plan_json)], cwd=str(fdir), check=True)
        plan_doc = json.loads(plan_json.read_text(encoding="utf-8"))
        managed_changes = {str(rc["address"]): list((rc.get("change") or {}).get("actions") or []) for rc in (plan_doc.get("resource_changes") or []) if rc.get("mode") == "managed"}
        if any("delete" in acts for acts in managed_changes.values()):
            raise SystemExit(f"[FATAL] Bootstrap plan contains destructive/replace actions: {managed_changes}")
        drifted_existing = [a for a, acts in managed_changes.items() if aws_preexists.get(a) and acts != ["no-op"]]
        if drifted_existing and not reconcile_existing:
            raise SystemExit(f"[FATAL] Pre-existing AWS IAM resources {drifted_existing} differ from Foundation HCL; refusing blind overwrite without --reconcile-existing.")
        if any(acts != ["no-op"] for acts in managed_changes.values()):
            if plan_bin_path and expected_plan_sha256:
                import hashlib
                pre_apply_sha = hashlib.sha256(plan_bin.read_bytes()).hexdigest().lower()
                if pre_apply_sha != expected_plan_sha256.lower().strip():
                    raise SystemExit(f"[FATAL] Plan checksum mutated immediately before apply! Expected {expected_plan_sha256}, got {pre_apply_sha}")
            run_fn(["terraform", "apply", "-input=false", "-auto-approve", str(plan_bin)], cwd=str(fdir), check=True)
            apply_executed = True
    finally:
        for tmp_f in ((plan_json,) if plan_bin_path else (plan_bin, plan_json)):
            if tmp_f.exists():
                tmp_f.unlink()

    res = verify_bootstrap_iam_and_boundary_live(fdir, account_id=account_id, operator_principal=operator_principal, iam_caller=call)
    return {**res, "caller_mode": caller_info["mode"], "admin_role_preexisted": caller_info["admin_role_preexisted"], "apply_executed": apply_executed}


if __name__ == "__main__":
    import argparse
    p = argparse.ArgumentParser(description="EnvScale Foundation IAM Plan & Bootstrap Guard")
    sub = p.add_subparsers(dest="cmd", required=True)
    for cname in ("verify-bootstrap-caller", "bootstrap-foundation-iam"):
        sp = sub.add_parser(cname)
        sp.add_argument("--foundation-dir", required=True)
        sp.add_argument("--sts-json", required=True)
        sp.add_argument("--expected-account", default=IMMUTABLE_ACCOUNT_ID)
        sp.add_argument("--operator-principal", default=f"arn:aws:iam::{IMMUTABLE_ACCOUNT_ID}:user/DEV-user-alpha")
        if cname == "bootstrap-foundation-iam":
            sp.add_argument("--backend-hcl", required=True)
            sp.add_argument("--reconcile-existing", action="store_true")
            sp.add_argument("--plan-bin", default=None)
            sp.add_argument("--plan-sha256", default=None)
    args = p.parse_args()
    if args.cmd == "verify-bootstrap-caller":
        import pathlib
        sts_obj = json.loads(pathlib.Path(args.sts_json).read_text(encoding="utf-8"))
        info = verify_foundation_iam_bootstrap_caller(sts_obj, pathlib.Path(args.foundation_dir).resolve().parent / "bootstrap" / "foundation-iam-bootstrap-policy.json", account_id=args.expected_account, operator_principal=args.operator_principal)
        print(f"      Verified Bootstrap Caller: {info['caller_arn']} (mode={info['mode']}, admin_preexisted={info['admin_role_preexisted']})")
    elif args.cmd == "bootstrap-foundation-iam":
        res = run_bootstrap_foundation_iam(args.foundation_dir, args.sts_json, args.backend_hcl, account_id=args.expected_account, operator_principal=args.operator_principal, reconcile_existing=args.reconcile_existing, plan_bin_path=args.plan_bin, expected_plan_sha256=args.plan_sha256)
        print(f"[SUCCESS] One-time Foundation IAM & boundary bootstrap verified: {json.dumps(res)}")

