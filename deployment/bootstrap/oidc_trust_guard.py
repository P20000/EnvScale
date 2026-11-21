#!/usr/bin/env python3
"""
EnvScale GitHub OIDC Trust Policy Guard & Live Role Verifier.

Enforces exact GitHub immutable subject claims (`repo:<owner>@<owner_id>/<repo>@<repo_id>:...`),
`token.actions.githubusercontent.com:aud == sts.amazonaws.com`, and strict `StringEquals`
conditions across all five GitHub OIDC roles without wildcards or `StringLike`.
"""

from __future__ import annotations

import pathlib
from typing import Any

IMMUTABLE_ACCOUNT_ID = "982534376726"
IMMUTABLE_OIDC_SUBJECT_PREFIX = "P20000@61460949/EnvScale@1323134407"
GITHUB_OIDC_PROVIDER_ARN = f"arn:aws:iam::{IMMUTABLE_ACCOUNT_ID}:oidc-provider/token.actions.githubusercontent.com"

EXPECTED_GITHUB_OIDC_ROLE_SUBS: dict[str, str] = {
    "aws_iam_role.github_foundation_plan": f"repo:{IMMUTABLE_OIDC_SUBJECT_PREFIX}:environment:foundation-plan",
    "aws_iam_role.github_foundation": f"repo:{IMMUTABLE_OIDC_SUBJECT_PREFIX}:environment:foundation",
    "aws_iam_role.github_release": f"repo:{IMMUTABLE_OIDC_SUBJECT_PREFIX}:ref:refs/heads/develop",
    "aws_iam_role.github_deploy": f"repo:{IMMUTABLE_OIDC_SUBJECT_PREFIX}:environment:production",
    "aws_iam_role.github_recovery": f"repo:{IMMUTABLE_OIDC_SUBJECT_PREFIX}:environment:recovery",
}

WORKLOAD_OIDC_ROLE_SPECS: tuple[tuple[str, str, str, str, str], ...] = (
    ("envscale-github-release-role", "envscale-github-release-policy", "role_github_release", "trust_github_release", "ref:refs/heads/develop"),
    ("envscale-github-deploy-role", "envscale-github-deploy-policy", "role_github_deploy", "trust_github_deploy", "environment:production"),
    ("envscale-github-recovery-role", "envscale-github-recovery-policy", "role_github_recovery", "trust_github_recovery", "environment:recovery"),
)


def _as_str_list(val: object) -> list[str]:
    if isinstance(val, list):
        return [str(v) for v in val]
    return [str(val)] if val is not None else []


def check_oidc_trust_statement(addr: str, trust_doc: dict[str, Any]) -> list[str]:
    """Validate that a Terraform GitHub OIDC role trust policy matches its exact immutable subject."""
    expected_sub = EXPECTED_GITHUB_OIDC_ROLE_SUBS.get(addr)
    if not expected_sub:
        return []
    stmts = trust_doc.get("Statement")
    if not isinstance(stmts, list) or len(stmts) != 1 or not isinstance(stmts[0], dict):
        return [f"OIDC role '{addr}' trust policy must contain exactly 1 statement."]
    st = stmts[0]
    if st.get("Effect") != "Allow":
        return [f"OIDC role '{addr}' trust statement must have Effect 'Allow'."]
    if _as_str_list(st.get("Action")) != ["sts:AssumeRoleWithWebIdentity"]:
        return [f"OIDC role '{addr}' must allow only ['sts:AssumeRoleWithWebIdentity'], got {st.get('Action')!r}."]
    princ = st.get("Principal")
    if not isinstance(princ, dict) or set(princ.keys()) != {"Federated"} or _as_str_list(princ.get("Federated")) != [GITHUB_OIDC_PROVIDER_ARN]:
        return [f"OIDC role '{addr}' trust Principal must equal exact GitHub OIDC provider ARN."]
    cond = st.get("Condition")
    if not isinstance(cond, dict) or set(cond.keys()) != {"StringEquals"} or not isinstance(cond.get("StringEquals"), dict):
        return [f"OIDC role '{addr}' trust Condition must contain only 'StringEquals', got {cond!r}."]
    se = cond["StringEquals"]
    req_keys = {"token.actions.githubusercontent.com:aud", "token.actions.githubusercontent.com:sub"}
    if set(se.keys()) != req_keys:
        return [f"OIDC role '{addr}' StringEquals keys must equal {sorted(req_keys)}, got {sorted(se.keys())}."]
    aud_vals = _as_str_list(se.get("token.actions.githubusercontent.com:aud"))
    sub_vals = _as_str_list(se.get("token.actions.githubusercontent.com:sub"))
    if aud_vals != ["sts.amazonaws.com"]:
        return [f"OIDC role '{addr}' trust aud must equal ['sts.amazonaws.com'], got {aud_vals!r}."]
    if sub_vals != [expected_sub] or any("*" in s or "?" in s for s in sub_vals):
        return [f"OIDC role '{addr}' trust sub {sub_vals!r} must equal immutable subject [{expected_sub!r}]."]
    return []


def verify_workload_oidc_roles_live(
    foundation_dir: Any,
    *,
    account_id: str = IMMUTABLE_ACCOUNT_ID,
    oidc_subject_prefix: str = IMMUTABLE_OIDC_SUBJECT_PREFIX,
    iam_caller: Any = None,
) -> dict[str, str]:
    """Verify live AWS workload OIDC roles (release, deploy, recovery) trust, inline policy, and boundary."""
    import day0_identity_guard as guard
    import iam_policy_simulator as sim

    call = iam_caller or guard._aws_iam_cli
    rendered = sim.build_rendered_foundation_policies(pathlib.Path(foundation_dir))
    expected_boundary = f"arn:aws:iam::{account_id}:policy/envscale-workload-permissions-boundary"
    verified: dict[str, str] = {}
    for role_name, inline_name, role_key, trust_key, sub_tail in WORKLOAD_OIDC_ROLE_SPECS:
        role_obj = (call("get-role", ["--role-name", role_name]) or {}).get("Role") or {}
        pb = role_obj.get("PermissionsBoundary") or {}
        if pb.get("PermissionsBoundaryArn") != expected_boundary or pb.get("PermissionsBoundaryUsageType") != "PermissionsBoundaryPolicy":
            raise SystemExit(f"[FATAL] Live workload OIDC role '{role_name}' missing mandatory permissions boundary '{expected_boundary}'.")
        expected_trust = rendered[trust_key] if oidc_subject_prefix == IMMUTABLE_OIDC_SUBJECT_PREFIX else None
        guard.validate_live_role_trust_policy(
            role_obj,
            role_label=role_name,
            expected_account=account_id,
            allowed_operator_principals=(),
            allowed_oidc_subs=(f"repo:{oidc_subject_prefix}:{sub_tail}",),
            expected_trust_doc=expected_trust,
        )
        pol_resp = call("get-role-policy", ["--role-name", role_name, "--policy-name", inline_name]) or {}
        live_inline = guard._decode_policy_doc(pol_resp.get("PolicyDocument"))
        if guard._canonical_policy(live_inline) != guard._canonical_policy(rendered[role_key]):
            raise SystemExit(f"[FATAL] Live inline policy '{inline_name}' on '{role_name}' drifted from Foundation HCL.")
        verified[role_key] = role_name
    return verified

