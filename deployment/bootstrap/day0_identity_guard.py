#!/usr/bin/env python3
"""
EnvScale Day-0 Bootstrap Identity & Policy Boundary Guard.

Enforces:
  1. Caller identity MUST be the dedicated `envscale-day0-bootstrap*` principal
     in account `982534376726` (never root, human break-glass admin, CI/runtime
     roles, or broad admin users).
  2. Day-0 identity policy and true IAM permissions boundary JSONs remain
     distinct, narrowly scoped to `envscale-tfstate-982534376726-ap-south-1`
     plus read-only Day-0 self-boundary inspection, MFA-independent, and
     explicitly deny destructive/escalation actions & recovery/legacy buckets.
  3. Live AWS `--apply` assurance verifies the caller actually carries the
     expected Day-0 permissions boundary & identity policy with zero drift
     and zero inline/extra managed policies (`check-iam-boundary`).
"""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import re
import subprocess
import urllib.parse
from typing import Any, Callable

IMMUTABLE_ACCOUNT_ID = "982534376726"
TFSTATE_ARN = f"arn:aws:s3:::envscale-tfstate-{IMMUTABLE_ACCOUNT_ID}-ap-south-1"
RECOVERY_ARN = f"arn:aws:s3:::envscale-recovery-{IMMUTABLE_ACCOUNT_ID}-ap-south-1"
LEGACY_ARN = f"arn:aws:s3:::envscale-cloud-vault-{IMMUTABLE_ACCOUNT_ID}-ap-south-1"

DAY0_IDENTITY_POLICY_ARN = f"arn:aws:iam::{IMMUTABLE_ACCOUNT_ID}:policy/envscale-day0-bootstrap-policy"
DAY0_BOUNDARY_POLICY_ARN = f"arn:aws:iam::{IMMUTABLE_ACCOUNT_ID}:policy/envscale-day0-bootstrap-permissions-boundary"
DEFAULT_OPERATOR_PRINCIPAL_ARN = f"arn:aws:iam::{IMMUTABLE_ACCOUNT_ID}:user/DEV-user-alpha"
DEFAULT_DAY0_OIDC_SUBS = frozenset({"repo:P20000/EnvScale:environment:day0-bootstrap"})
DEFAULT_INITIAL_SEAL_OIDC_SUBS = frozenset({"repo:P20000/EnvScale:environment:day0-initial-seal"})

ALLOWED_DAY0_IAM_READ_ACTIONS = frozenset({
    "iam:GetUser", "iam:ListAttachedUserPolicies", "iam:ListUserPolicies",
    "iam:GetRole", "iam:ListAttachedRolePolicies", "iam:ListRolePolicies", "iam:GetPolicy", "iam:GetPolicyVersion",
})
ALLOWED_DAY0_IAM_RESOURCE_PREFIXES = (
    f"arn:aws:iam::{IMMUTABLE_ACCOUNT_ID}:user/envscale-day0-bootstrap",
    f"arn:aws:iam::{IMMUTABLE_ACCOUNT_ID}:role/envscale-day0-bootstrap",
    f"arn:aws:iam::{IMMUTABLE_ACCOUNT_ID}:policy/envscale-day0-bootstrap",
)
DAY0_IDENTITY_PATTERNS = (
    re.compile(rf"^arn:aws:iam::{IMMUTABLE_ACCOUNT_ID}:user/(?P<name>envscale-day0-bootstrap[A-Za-z0-9+=,.@_-]*)$"),
    re.compile(rf"^arn:aws:sts::{IMMUTABLE_ACCOUNT_ID}:assumed-role/(?P<name>envscale-day0-bootstrap[A-Za-z0-9+=,.@_-]*)/[A-Za-z0-9+=,.@_-]+$"),
)
INITIAL_SEAL_IAM_RESOURCE_PREFIXES = (
    f"arn:aws:iam::{IMMUTABLE_ACCOUNT_ID}:user/envscale-day0-initial-seal",
    f"arn:aws:iam::{IMMUTABLE_ACCOUNT_ID}:role/envscale-day0-initial-seal",
    f"arn:aws:iam::{IMMUTABLE_ACCOUNT_ID}:policy/envscale-day0-initial-seal",
)
INITIAL_SEAL_IDENTITY_PATTERNS = (
    re.compile(rf"^arn:aws:iam::{IMMUTABLE_ACCOUNT_ID}:user/envscale-day0-initial-seal$"),
    re.compile(rf"^arn:aws:sts::{IMMUTABLE_ACCOUNT_ID}:assumed-role/envscale-day0-initial-seal/[A-Za-z0-9+=,.@_-]+$"),
)
INITIAL_SEAL_S3_ALLOW = frozenset({"s3:CreateBucket", "s3:ListBucket", "s3:GetBucketLocation", "s3:GetBucketPolicy", "s3:PutBucketPolicy"})
REQUIRED_DENY_ACTIONS = ("s3:DeleteBucket", "s3:DeleteBucketPolicy", "s3:PutBucketPolicy", "iam:Create*", "iam:Put*", "iam:Delete*", "iam:Attach*", "iam:PassRole")
REQUIRED_INITIAL_SEAL_DENY_ACTIONS = (
    "s3:DeleteBucket", "s3:DeleteBucketPolicy", "s3:DeleteObject", "s3:DeleteObjectVersion", "s3:GetObject", "s3:PutObject",
    "iam:Create*", "iam:Put*", "iam:Update*", "iam:Delete*", "iam:Attach*", "iam:PassRole", "ec2:*", "ssm:*", "kms:*", "eks:*", "sts:AssumeRole",
)
ADMIN_ROLE_STS_RE = re.compile(rf"^arn:aws:sts::{IMMUTABLE_ACCOUNT_ID}:assumed-role/envscale-foundation-admin-role/[A-Za-z0-9+=,.@_-]+$")


def _validate_sts_identity(
    sts_doc: dict[str, Any], patterns: tuple[re.Pattern[str], ...], label: str, expected_desc: str, expected_account: str = IMMUTABLE_ACCOUNT_ID
) -> str:
    if not isinstance(sts_doc, dict):
        raise SystemExit(f"[FATAL] {label} STS identity payload must be a JSON object.")
    acct, arn = str(sts_doc.get("Account", "")).strip(), str(sts_doc.get("Arn", "")).strip()
    if acct != expected_account:
        raise SystemExit(f"[FATAL] AWS caller Account '{acct}' != expected '{expected_account}'.")
    if arn.endswith(":root"):
        raise SystemExit(f"[FATAL] {label} must not run as AWS account root user.")
    if not any(pat.fullmatch(arn) for pat in patterns):
        raise SystemExit(f"[FATAL] {label} requires dedicated identity {expected_desc}; got '{arn}'.")
    return arn


def validate_day0_caller_identity(sts_doc: dict, expected_account: str = IMMUTABLE_ACCOUNT_ID) -> str:
    """Validate AWS STS GetCallerIdentity response against the dedicated Day-0 identity."""
    return _validate_sts_identity(
        sts_doc, DAY0_IDENTITY_PATTERNS, "Day-0 bootstrap",
        "'user/envscale-day0-bootstrap*' or 'assumed-role/envscale-day0-bootstrap*/<session>'", expected_account=expected_account,
    )


def validate_initial_seal_caller_identity(sts_doc: dict[str, Any], expected_account: str = IMMUTABLE_ACCOUNT_ID) -> str:
    """Validate AWS STS GetCallerIdentity response against the dedicated initial-seal identity."""
    return _validate_sts_identity(
        sts_doc, INITIAL_SEAL_IDENTITY_PATTERNS, "Initial bucket-policy seal",
        "'user/envscale-day0-initial-seal' or 'assumed-role/envscale-day0-initial-seal/<session>'", expected_account=expected_account,
    )


def _as_list(val: object) -> list[str]:
    if isinstance(val, list):
        return [str(v) for v in val]
    return [str(val)] if val is not None else []


def is_allowed_day0_action_set(actions: list[str], resources: list[str]) -> bool:
    if any(a in ("*", "s3:*", "s3:PutBucketPolicy") or a.startswith(("ec2:", "ssm:", "kms:", "eks:", "organizations:", "account:")) or "Delete" in a for a in actions):
        return False
    if actions == ["sts:GetCallerIdentity"]:
        return resources == ["*"]
    if all(a in ALLOWED_DAY0_IAM_READ_ACTIONS for a in actions):
        return bool(resources) and all(r.startswith(ALLOWED_DAY0_IAM_RESOURCE_PREFIXES) for r in resources)
    if any(a.startswith("iam:") for a in actions):
        return False
    return bool(resources) and all(r == TFSTATE_ARN for r in resources)


def is_allowed_initial_seal_action_set(actions: list[str], resources: list[str]) -> bool:
    if actions == ["sts:GetCallerIdentity"]:
        return resources == ["*"]
    if all(a in ALLOWED_DAY0_IAM_READ_ACTIONS for a in actions):
        return bool(resources) and all(r.startswith(INITIAL_SEAL_IAM_RESOURCE_PREFIXES) for r in resources)
    return bool(actions) and set(actions).issubset(INITIAL_SEAL_S3_ALLOW) and resources == [TFSTATE_ARN]


def _validate_policy_doc_common(
    label: str,
    path: pathlib.Path,
    allow_fn: Callable[[list[str], list[str]], bool],
    req_deny_actions: tuple[str, ...],
    req_deny_resources: tuple[str, ...],
) -> None:
    if not path.is_file():
        raise SystemExit(f"[FATAL] Missing {label}: {path}")
    raw = path.read_text(encoding="utf-8")
    if "MultiFactorAuthPresent" in raw:
        raise SystemExit(f"[FATAL] {label} ({path.name}) must remain MFA-independent.")
    doc = json.loads(raw)
    stmts = doc.get("Statement") or []
    allows = [s for s in stmts if s.get("Effect") == "Allow"]
    denies = [s for s in stmts if s.get("Effect") == "Deny"]
    if not allows or not denies:
        raise SystemExit(f"[FATAL] {label} ({path.name}) must define both Allow and explicit Deny statements.")
    for st in allows:
        acts = _as_list(st.get("Action"))
        res = _as_list(st.get("Resource"))
        if not allow_fn(acts, res):
            raise SystemExit(f"[FATAL] {label} ({path.name}) violates least-privilege Allow rules: actions={acts} resource={res}")
    denied_resources = {r for st in denies for r in _as_list(st.get("Resource"))}
    for req_deny in req_deny_resources:
        if req_deny not in denied_resources:
            raise SystemExit(f"[FATAL] {label} ({path.name}) must explicitly deny '{req_deny}'.")
    denied_actions = {a for st in denies for a in _as_list(st.get("Action"))}
    for req_act in req_deny_actions:
        if req_act not in denied_actions:
            raise SystemExit(f"[FATAL] {label} ({path.name}) must explicitly deny '{req_act}'.")


def validate_day0_initial_seal_policy(seal_path: pathlib.Path) -> None:
    """Verify the one-time greenfield bucket-policy seal document cannot read/write state objects, touch recovery, or mutate IAM."""
    _validate_policy_doc_common(
        "Initial-seal identity policy",
        seal_path,
        is_allowed_initial_seal_action_set,
        REQUIRED_INITIAL_SEAL_DENY_ACTIONS,
        (TFSTATE_ARN, f"{TFSTATE_ARN}/*", RECOVERY_ARN, f"{RECOVERY_ARN}/*", LEGACY_ARN, f"{LEGACY_ARN}/*"),
    )


def validate_initial_seal_policy_pair(seal_identity_path: pathlib.Path, seal_boundary_path: pathlib.Path) -> None:
    """Verify dedicated initial-seal identity policy and permissions boundary JSON invariants."""
    for label, path in (("Initial-seal identity policy", seal_identity_path), ("Initial-seal permissions boundary", seal_boundary_path)):
        _validate_policy_doc_common(
            label,
            path,
            is_allowed_initial_seal_action_set,
            REQUIRED_INITIAL_SEAL_DENY_ACTIONS,
            (TFSTATE_ARN, f"{TFSTATE_ARN}/*", RECOVERY_ARN, f"{RECOVERY_ARN}/*", LEGACY_ARN, f"{LEGACY_ARN}/*"),
        )


def validate_tfstate_bucket_policy_doc(pol_doc: dict[str, Any], expected_pol_doc: dict[str, Any] | None = None) -> None:
    """Ensure the state bucket policy rejects Day-0 / unauthorized bucket-policy mutations."""
    if expected_pol_doc is not None and _canonical_policy(pol_doc) != _canonical_policy(expected_pol_doc):
        raise SystemExit("[FATAL] Bucket policy read-back mismatch against hardened tfstate policy!")
    stmts = {str(s.get("Sid", "")): s for s in (pol_doc.get("Statement") or []) if isinstance(s, dict)}
    mut_deny = stmts.get("DenyUnauthorizedBucketPolicyMutation")
    if not mut_deny or mut_deny.get("Effect") != "Deny":
        raise SystemExit("[FATAL] tfstate bucket policy missing DenyUnauthorizedBucketPolicyMutation.")
    anl = ((mut_deny.get("Condition") or {}).get("ArnNotLike") or {}).get("aws:PrincipalArn")
    exempt = _as_list(anl)
    if not exempt or any("day0" in p.lower() or "bootstrap" in p.lower() for p in exempt):
        raise SystemExit(f"[FATAL] tfstate bucket policy must NOT exempt Day-0 principals: {exempt}")
    if not any("envscale-foundation-admin-role" in p for p in exempt):
        raise SystemExit(f"[FATAL] tfstate bucket policy must exempt break-glass foundation-admin only: {exempt}")


def validate_breakglass_admin_caller(sts_doc: dict[str, Any], expected_account: str = IMMUTABLE_ACCOUNT_ID) -> str:
    acct = str(sts_doc.get("Account", "")).strip()
    arn = str(sts_doc.get("Arn", "")).strip()
    if acct != expected_account or not ADMIN_ROLE_STS_RE.fullmatch(arn):
        raise SystemExit(f"[FATAL] Reconciling existing state bucket policy requires break-glass MFA 'assumed-role/envscale-foundation-admin-role/<session>' in account {expected_account}; got '{arn}'.")
    return arn


def validate_day0_policy_pair(identity_path: pathlib.Path, boundary_path: pathlib.Path) -> None:
    """Verify Day-0 identity policy and separate IAM permissions boundary JSON invariants."""
    for label, path in (("Day-0 identity policy", identity_path), ("Day-0 permissions boundary", boundary_path)):
        _validate_policy_doc_common(
            label,
            path,
            is_allowed_day0_action_set,
            REQUIRED_DENY_ACTIONS,
            (RECOVERY_ARN, f"{RECOVERY_ARN}/*", LEGACY_ARN, f"{LEGACY_ARN}/*"),
        )


def _aws_iam_cli(op: str, params: list[str]) -> dict[str, Any]:
    proc = subprocess.run(["aws", "iam", op, *params, "--output", "json"], capture_output=True, text=True, check=False)
    if proc.returncode != 0:
        raise SystemExit(f"[FATAL] aws iam {op} {' '.join(params)} failed: {proc.stderr.strip()}")
    return json.loads(proc.stdout)


def _decode_policy_doc(raw_doc: Any) -> dict[str, Any]:
    if isinstance(raw_doc, str):
        return json.loads(urllib.parse.unquote(raw_doc))
    if isinstance(raw_doc, dict):
        return raw_doc
    raise SystemExit(f"[FATAL] Invalid IAM policy version Document type: {type(raw_doc).__name__}")


def _canonical_policy(doc: dict[str, Any]) -> str:
    if not isinstance(doc, dict) or not isinstance(doc.get("Statement"), list):
        return json.dumps(doc, sort_keys=True)
    norm_stmts = []
    for s in sorted(doc["Statement"], key=lambda x: str(x.get("Sid", "")) if isinstance(x, dict) else ""):
        if not isinstance(s, dict):
            norm_stmts.append(s)
            continue
        norm_s = {}
        for k, v in sorted(s.items()):
            if k in ("Action", "Resource"):
                norm_s[k] = sorted([str(x) for x in ([v] if isinstance(v, str) else v)])
            elif k == "Principal" and isinstance(v, dict):
                norm_s[k] = {pk: sorted([str(x) for x in ([pv] if isinstance(pv, str) else pv)]) if isinstance(pv, (list, str)) else pv for pk, pv in sorted(v.items())}
            else:
                norm_s[k] = v
        norm_stmts.append(norm_s)
    return json.dumps({**doc, "Statement": norm_stmts}, sort_keys=True)


def validate_live_role_trust_policy(
    role_obj: dict[str, Any],
    *,
    role_label: str,
    expected_account: str = IMMUTABLE_ACCOUNT_ID,
    allowed_operator_principals: set[str] | frozenset[str] | None = None,
    allowed_oidc_subs: set[str] | frozenset[str] | None = None,
    require_mfa: bool = False,
    expected_trust_doc: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Fail closed unless live IAM role AssumeRolePolicyDocument matches explicit trust invariants."""
    if not isinstance(role_obj, dict) or "AssumeRolePolicyDocument" not in role_obj:
        raise SystemExit(f"[FATAL] {role_label} live IAM role metadata missing AssumeRolePolicyDocument.")
    if require_mfa and int(role_obj.get("MaxSessionDuration", 999999)) > 3600:
        raise SystemExit(f"[FATAL] {role_label} MaxSessionDuration exceeds 3600s ceiling.")
    trust_doc = _decode_policy_doc(role_obj["AssumeRolePolicyDocument"])
    if expected_trust_doc is not None and _canonical_policy(trust_doc) != _canonical_policy(expected_trust_doc):
        raise SystemExit(f"[FATAL] {role_label} live trust policy drifted from expected trust configuration.")
    if trust_doc.get("Version") != "2012-10-17" or not set(trust_doc.keys()).issubset({"Version", "Statement"}):
        raise SystemExit(f"[FATAL] {role_label} trust policy has invalid Version or top-level keys: {list(trust_doc.keys())}")
    stmts = trust_doc.get("Statement")
    if not isinstance(stmts, list) or len(stmts) != 1 or not isinstance(stmts[0], dict):
        raise SystemExit(f"[FATAL] {role_label} trust policy must contain exactly 1 explicit Statement (got {stmts!r}).")
    st = stmts[0]
    if st.get("Effect") != "Allow" or not set(st.keys()).issubset({"Sid", "Effect", "Principal", "Action", "Condition"}):
        raise SystemExit(f"[FATAL] {role_label} trust statement has unrecognized keys or Effect != Allow: {st!r}")
    principal = st.get("Principal")
    if not isinstance(principal, dict) or len(principal) != 1:
        raise SystemExit(f"[FATAL] {role_label} trust policy rejects wildcard or multi-type Principal: {principal!r}")
    acts = _as_list(st.get("Action"))
    cond = st.get("Condition") or {}
    if not isinstance(cond, dict) or "StringLike" in cond or "ArnLike" in cond:
        raise SystemExit(f"[FATAL] {role_label} trust policy contains disallowed Condition operator: {cond!r}")
    ops = set(allowed_operator_principals) if allowed_operator_principals is not None else {
        os.environ.get("ENVSCALE_OPERATOR_PRINCIPAL_ARN", f"arn:aws:iam::{expected_account}:user/DEV-user-alpha")
    }
    user_re = re.compile(rf"^arn:aws:iam::{expected_account}:user/[A-Za-z0-9+=,.@_-]+$")
    if "AWS" in principal:
        if acts != ["sts:AssumeRole"]:
            raise SystemExit(f"[FATAL] {role_label} AWS principal trust must allow only ['sts:AssumeRole'], got {acts}")
        aws_list = _as_list(principal["AWS"])
        if not aws_list or any("*" in p or "?" in p or p.endswith(":root") or not user_re.fullmatch(p) or p not in ops for p in aws_list):
            raise SystemExit(f"[FATAL] {role_label} trust policy contains unauthorized AWS principal {aws_list} (allowed={sorted(ops)}).")
        if require_mfa:
            mfa_bool = (cond.get("Bool") or {}).get("aws:MultiFactorAuthPresent")
            mfa_age_raw = (cond.get("NumericLessThan") or {}).get("aws:MultiFactorAuthAge")
            try:
                mfa_age = int(mfa_age_raw)
            except (TypeError, ValueError):
                mfa_age = -1
            if set(cond.keys()) != {"Bool", "NumericLessThan"} or cond.get("Bool") != {"aws:MultiFactorAuthPresent": "true"} or set((cond.get("NumericLessThan") or {}).keys()) != {"aws:MultiFactorAuthAge"} or not (1 <= mfa_age <= 3600):
                raise SystemExit(f"[FATAL] {role_label} trust policy lacks strict MFA Bool + NumericLessThan<=3600: {cond!r}")
        elif cond:
            if not set(cond.keys()).issubset({"Bool", "NumericLessThan"}) or (
                "Bool" in cond and cond.get("Bool") != {"aws:MultiFactorAuthPresent": "true"}
            ):
                raise SystemExit(f"[FATAL] {role_label} trust policy contains unrecognized Condition: {cond!r}")
    elif "Federated" in principal:
        oidc_subs = set(allowed_oidc_subs or ())
        if require_mfa or not oidc_subs:
            raise SystemExit(f"[FATAL] {role_label} forbids Federated/OIDC trust principal: {principal!r}")
        if acts != ["sts:AssumeRoleWithWebIdentity"]:
            raise SystemExit(f"[FATAL] {role_label} OIDC trust must allow only ['sts:AssumeRoleWithWebIdentity'], got {acts}")
        expected_oidc = f"arn:aws:iam::{expected_account}:oidc-provider/token.actions.githubusercontent.com"
        if _as_list(principal["Federated"]) != [expected_oidc]:
            raise SystemExit(f"[FATAL] {role_label} OIDC trust provider mismatch: {principal['Federated']!r} != {[expected_oidc]!r}")
        se = cond.get("StringEquals") if set(cond.keys()) == {"StringEquals"} else None
        if not isinstance(se, dict) or set(se.keys()) != {"token.actions.githubusercontent.com:aud", "token.actions.githubusercontent.com:sub"}:
            raise SystemExit(f"[FATAL] {role_label} OIDC trust requires exact StringEquals aud + sub conditions: {cond!r}")
        subs = _as_list(se["token.actions.githubusercontent.com:sub"])
        if _as_list(se["token.actions.githubusercontent.com:aud"]) != ["sts.amazonaws.com"] or not subs or any("*" in s or "?" in s or s not in oidc_subs for s in subs):
            raise SystemExit(f"[FATAL] {role_label} OIDC trust audience/subject rejected: aud={se.get('token.actions.githubusercontent.com:aud')!r}, sub={subs!r}")
    else:
        raise SystemExit(f"[FATAL] {role_label} trust policy contains unsupported Principal type: {principal!r}")
    return trust_doc


def verify_breakglass_admin_caller_and_trust(
    sts_doc: dict[str, Any],
    iam_caller: Callable[[str, list[str]], dict[str, Any]] | None = None,
    expected_account: str = IMMUTABLE_ACCOUNT_ID,
    allowed_operator_principals: set[str] | frozenset[str] | None = None,
) -> str:
    arn = validate_breakglass_admin_caller(sts_doc, expected_account=expected_account)
    call = iam_caller or _aws_iam_cli
    ent = call("get-role", ["--role-name", "envscale-foundation-admin-role"]).get("Role") or {}
    validate_live_role_trust_policy(
        ent, role_label="Break-glass foundation-admin", expected_account=expected_account,
        allowed_operator_principals=allowed_operator_principals, allowed_oidc_subs=frozenset(), require_mfa=True,
    )
    return arn


def _verify_attached_boundary_and_policy_pair(
    role_label: str,
    arn: str,
    expected_pb_arn: str,
    expected_id_arn: str,
    identity_path: pathlib.Path,
    boundary_path: pathlib.Path,
    iam_caller: Callable[[str, list[str]], dict[str, Any]] | None = None,
    expected_account: str = IMMUTABLE_ACCOUNT_ID,
    allowed_operator_principals: set[str] | frozenset[str] | None = None,
    allowed_oidc_subs: set[str] | frozenset[str] | None = None,
) -> dict[str, str]:
    call = iam_caller or _aws_iam_cli
    is_user = ":user/" in arn
    entity_name = arn.split("/")[-2] if not is_user else arn.split(":user/")[-1]
    if is_user:
        ent = call("get-user", ["--user-name", entity_name]).get("User") or {}
        inline_names = call("list-user-policies", ["--user-name", entity_name]).get("PolicyNames") or []
        attached = call("list-attached-user-policies", ["--user-name", entity_name]).get("AttachedPolicies") or []
    else:
        ent = call("get-role", ["--role-name", entity_name]).get("Role") or {}
        validate_live_role_trust_policy(
            ent, role_label=role_label, expected_account=expected_account,
            allowed_operator_principals=allowed_operator_principals, allowed_oidc_subs=allowed_oidc_subs, require_mfa=False,
        )
        inline_names = call("list-role-policies", ["--role-name", entity_name]).get("PolicyNames") or []
        attached = call("list-attached-role-policies", ["--role-name", entity_name]).get("AttachedPolicies") or []

    pb = ent.get("PermissionsBoundary") or {}
    if pb.get("PermissionsBoundaryUsageType") != "PermissionsBoundaryPolicy":
        raise SystemExit(f"[FATAL] {role_label} identity '{arn}' lacks an attached PermissionsBoundary ({pb!r}).")
    if pb.get("PermissionsBoundaryArn") != expected_pb_arn:
        raise SystemExit(
            f"[FATAL] {role_label} PermissionsBoundary ARN '{pb.get('PermissionsBoundaryArn')}' != expected '{expected_pb_arn}'."
        )
    if inline_names:
        raise SystemExit(f"[FATAL] {role_label} identity '{arn}' must not have inline policies: {inline_names}")

    attached_arns = [str(p.get("PolicyArn", "")) for p in attached]
    if attached_arns != [expected_id_arn]:
        raise SystemExit(f"[FATAL] {role_label} attached policies {attached_arns} != expected [{expected_id_arn!r}].")

    for doc_label, policy_arn, local_path in (
        (f"{role_label} permissions boundary", expected_pb_arn, boundary_path),
        (f"{role_label} identity policy", expected_id_arn, identity_path),
    ):
        p_meta = call("get-policy", ["--policy-arn", policy_arn]).get("Policy") or {}
        ver_id = p_meta.get("DefaultVersionId")
        if not ver_id:
            raise SystemExit(f"[FATAL] Missing DefaultVersionId for {doc_label} ({policy_arn}).")
        ver_doc = (
            call("get-policy-version", ["--policy-arn", policy_arn, "--version-id", str(ver_id)])
            .get("PolicyVersion", {})
            .get("Document")
        )
        live_doc = _decode_policy_doc(ver_doc)
        expected_doc = json.loads(local_path.read_text(encoding="utf-8"))
        if _canonical_policy(live_doc) != _canonical_policy(expected_doc):
            raise SystemExit(f"[FATAL] Live AWS {doc_label} ({policy_arn} {ver_id}) drifted from {local_path.name}.")

    return {"caller_arn": arn, "boundary_arn": expected_pb_arn, "identity_policy_arn": expected_id_arn}


def verify_day0_attached_boundary_and_policies(
    sts_doc: dict[str, Any],
    identity_path: pathlib.Path,
    boundary_path: pathlib.Path,
    iam_caller: Callable[[str, list[str]], dict[str, Any]] | None = None,
    expected_account: str = IMMUTABLE_ACCOUNT_ID,
    allowed_operator_principals: set[str] | frozenset[str] | None = None,
    allowed_oidc_subs: set[str] | frozenset[str] | None = DEFAULT_DAY0_OIDC_SUBS,
) -> dict[str, str]:
    """Fail closed unless the AWS Day-0 principal carries exact attached boundary, policy, and role trust."""
    arn = validate_day0_caller_identity(sts_doc, expected_account=expected_account)
    validate_day0_policy_pair(identity_path, boundary_path)
    return _verify_attached_boundary_and_policy_pair(
        "Day-0", arn,
        f"arn:aws:iam::{expected_account}:policy/envscale-day0-bootstrap-permissions-boundary",
        f"arn:aws:iam::{expected_account}:policy/envscale-day0-bootstrap-policy",
        identity_path, boundary_path, iam_caller=iam_caller, expected_account=expected_account,
        allowed_operator_principals=allowed_operator_principals, allowed_oidc_subs=allowed_oidc_subs,
    )


def verify_initial_seal_attached_boundary_and_policies(
    sts_doc: dict[str, Any],
    seal_identity_path: pathlib.Path,
    seal_boundary_path: pathlib.Path,
    iam_caller: Callable[[str, list[str]], dict[str, Any]] | None = None,
    expected_account: str = IMMUTABLE_ACCOUNT_ID,
    allowed_operator_principals: set[str] | frozenset[str] | None = None,
    allowed_oidc_subs: set[str] | frozenset[str] | None = DEFAULT_INITIAL_SEAL_OIDC_SUBS,
) -> dict[str, str]:
    """Fail closed unless the AWS caller is envscale-day0-initial-seal with exact seal policy, boundary, & role trust."""
    arn = validate_initial_seal_caller_identity(sts_doc, expected_account=expected_account)
    validate_initial_seal_policy_pair(seal_identity_path, seal_boundary_path)
    return _verify_attached_boundary_and_policy_pair(
        "Initial-seal", arn,
        f"arn:aws:iam::{expected_account}:policy/envscale-day0-initial-seal-permissions-boundary",
        f"arn:aws:iam::{expected_account}:policy/envscale-day0-initial-seal-policy",
        seal_identity_path, seal_boundary_path, iam_caller=iam_caller, expected_account=expected_account,
        allowed_operator_principals=allowed_operator_principals, allowed_oidc_subs=allowed_oidc_subs,
    )


def main() -> None:
    p = argparse.ArgumentParser(description="Validate EnvScale Day-0 and Initial-Seal identities, boundaries, and role trust.")
    sub = p.add_subparsers(dest="cmd", required=True)
    p_pol = sub.add_parser("check-policies")
    for flag, req in (("--identity-policy", True), ("--boundary-policy", True), ("--seal-policy", False), ("--seal-boundary", False)):
        p_pol.add_argument(flag, required=req)
    for sn in ("check-sts", "check-initial-seal-sts", "check-admin-sts", "check-iam-boundary", "check-initial-seal-boundary"):
        sp = sub.add_parser(sn)
        sp.add_argument("--sts-json", required=True)
        sp.add_argument("--expected-account", default=IMMUTABLE_ACCOUNT_ID)
        sp.add_argument("--operator-principal", default="")
        if sn == "check-admin-sts":
            sp.add_argument("--verify-live-trust", action="store_true")
        elif sn in ("check-iam-boundary", "check-initial-seal-boundary"):
            f1, f2 = ("--identity-policy", "--boundary-policy") if sn == "check-iam-boundary" else ("--seal-policy", "--seal-boundary")
            sp.add_argument(f1, required=True)
            sp.add_argument(f2, required=True)
    args = p.parse_args()
    if args.cmd == "check-policies":
        validate_day0_policy_pair(pathlib.Path(args.identity_policy), pathlib.Path(args.boundary_policy))
        if args.seal_policy and args.seal_boundary:
            validate_initial_seal_policy_pair(pathlib.Path(args.seal_policy), pathlib.Path(args.seal_boundary))
        elif args.seal_policy:
            validate_day0_initial_seal_policy(pathlib.Path(args.seal_policy))
        return
    sts_doc = json.loads(pathlib.Path(args.sts_json).read_text(encoding="utf-8"))
    ops = {args.operator_principal} if getattr(args, "operator_principal", "") else None
    if args.cmd == "check-sts":
        print(f"      Verified Day-0 Caller : {validate_day0_caller_identity(sts_doc, args.expected_account)} (account {args.expected_account})")
    elif args.cmd == "check-initial-seal-sts":
        print(f"      Verified Seal Caller  : {validate_initial_seal_caller_identity(sts_doc, args.expected_account)} (account {args.expected_account})")
    elif args.cmd == "check-admin-sts":
        fn = verify_breakglass_admin_caller_and_trust if args.verify_live_trust else validate_breakglass_admin_caller
        kw = {"expected_account": args.expected_account, **({"allowed_operator_principals": ops} if args.verify_live_trust else {})}
        print(f"      Verified Admin Caller : {fn(sts_doc, **kw)} (account {args.expected_account})")
    elif args.cmd == "check-iam-boundary":
        res = verify_day0_attached_boundary_and_policies(sts_doc, pathlib.Path(args.identity_policy), pathlib.Path(args.boundary_policy), expected_account=args.expected_account, allowed_operator_principals=ops)
        print(f"      Verified Day-0 Boundary, Policy & Role Trust: {res['boundary_arn']} + {res['identity_policy_arn']}")
    elif args.cmd == "check-initial-seal-boundary":
        res = verify_initial_seal_attached_boundary_and_policies(sts_doc, pathlib.Path(args.seal_policy), pathlib.Path(args.seal_boundary), expected_account=args.expected_account, allowed_operator_principals=ops)
        print(f"      Verified Initial-Seal Boundary, Policy & Role Trust: {res['boundary_arn']} + {res['identity_policy_arn']}")


if __name__ == "__main__":
    main()
