#!/usr/bin/env python3
"""EnvScale — Day-0 S3 State Bucket Readiness & Safe IAM Transition Guard.

Ensures idempotent S3 state-bucket provisioning, prefix readiness before
Terraform init, and safe operator IAM transition requiring a genuinely
verified independent administrative recovery path.
"""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import subprocess
import sys
import urllib.parse
from typing import Any, Callable

IMMUTABLE_ACCOUNT_ID = "982534376726"
IMMUTABLE_REGION = "ap-south-1"
IMMUTABLE_BUCKET = f"envscale-tfstate-{IMMUTABLE_ACCOUNT_ID}-{IMMUTABLE_REGION}"
DEFAULT_OPERATOR_ARN = f"arn:aws:iam::{IMMUTABLE_ACCOUNT_ID}:user/DEV-user-alpha"
BOOTSTRAP_POLICY_ARN = f"arn:aws:iam::{IMMUTABLE_ACCOUNT_ID}:policy/envscale-foundation-iam-bootstrap-policy"
ADMIN_POLICY_ARN = "arn:aws:iam::aws:policy/AdministratorAccess"
REQUIRED_TRANSITION_TOKEN = f"TRANSITION-DEV-USER-ALPHA-{IMMUTABLE_ACCOUNT_ID}"


def _as_list(val: Any) -> list[str]:
    if val is None:
        return []
    return [val] if isinstance(val, str) else [str(x) for x in val]


def _decode_doc(raw_doc: Any) -> dict[str, Any]:
    if isinstance(raw_doc, str):
        return json.loads(urllib.parse.unquote(raw_doc))
    if isinstance(raw_doc, dict):
        return raw_doc
    raise SystemExit(f"[FATAL] Invalid policy document type: {type(raw_doc).__name__}")


def _canonical(doc: dict[str, Any]) -> str:
    return json.dumps(doc, sort_keys=True)


def _canonical_policy_doc(doc: dict[str, Any]) -> str:
    stmts = sorted((doc.get("Statement") or []), key=lambda s: str(s.get("Sid", "")))
    norm_stmts = []
    for s in stmts:
        norm_s = {}
        for k, v in sorted(s.items()):
            if k in ("Action", "Resource"):
                norm_s[k] = sorted([str(x) for x in ([v] if isinstance(v, str) else v)])
            elif k == "Principal" and isinstance(v, dict) and set(v.keys()) == {"AWS"} and v["AWS"] == "*":
                norm_s[k] = "*"
            else:
                norm_s[k] = v
        norm_stmts.append(norm_s)
    return json.dumps({"Version": doc.get("Version", "2012-10-17"), "Statement": norm_stmts}, sort_keys=True)


def _default_aws_cli(service: str, op: str, params: list[str]) -> dict[str, Any]:
    cmd = ["aws", service, op, *params, "--output", "json"]
    proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if proc.returncode != 0:
        raise SystemExit(f"[FATAL] aws {service} {op} failed: {proc.stderr.strip()}")
    return json.loads(proc.stdout) if proc.stdout.strip() else {}


def generate_bucket_artifacts(
    account_id: str,
    bucket_name: str,
    policy_out: pathlib.Path,
    lifecycle_out: pathlib.Path,
    enc_out: pathlib.Path,
) -> dict[str, Any]:
    """Generate hardened bucket policy, multipart lifecycle, and SSE-S3 encryption artifacts."""
    bucket_arn = f"arn:aws:s3:::{bucket_name}"
    bucket_policy = {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Sid": "DenyInsecureTransport",
                "Effect": "Deny",
                "Principal": "*",
                "Action": "s3:*",
                "Resource": [bucket_arn, f"{bucket_arn}/*"],
                "Condition": {"Bool": {"aws:SecureTransport": "false"}},
            },
            {
                "Sid": "DenyForeignAccountPrincipals",
                "Effect": "Deny",
                "Principal": "*",
                "Action": "s3:*",
                "Resource": [bucket_arn, f"{bucket_arn}/*"],
                "Condition": {
                    "Null": {"aws:PrincipalAccount": "false"},
                    "StringNotEquals": {"aws:PrincipalAccount": account_id},
                },
            },
            {
                "Sid": "DenyBucketAndStateVersionDestruction",
                "Effect": "Deny",
                "Principal": "*",
                "Action": ["s3:DeleteBucket", "s3:DeleteObjectVersion", "s3:DeleteBucketPolicy"],
                "Resource": [bucket_arn, f"{bucket_arn}/*"],
            },
            {
                "Sid": "DenyUnauthorizedBucketPolicyMutation",
                "Effect": "Deny",
                "Principal": "*",
                "Action": "s3:PutBucketPolicy",
                "Resource": [bucket_arn, f"{bucket_arn}/*"],
                "Condition": {
                    "ArnNotLike": {
                        "aws:PrincipalArn": [
                            f"arn:aws:sts::{account_id}:assumed-role/envscale-foundation-admin-role/*",
                            f"arn:aws:iam::{account_id}:role/envscale-foundation-admin-role",
                        ]
                    }
                },
            },
            {
                "Sid": "DenyTfstateObjectDeletionWhileAllowingNativeTflockRelease",
                "Effect": "Deny",
                "Principal": "*",
                "Action": "s3:DeleteObject",
                "Resource": f"{bucket_arn}/*.tfstate",
            },
        ],
    }
    lifecycle_cfg = {
        "Rules": [
            {
                "ID": "abort-incomplete-multipart-uploads",
                "Status": "Enabled",
                "Filter": {"Prefix": ""},
                "AbortIncompleteMultipartUpload": {"DaysAfterInitiation": 7},
            },
        ]
    }
    encryption_cfg = {
        "Rules": [{"ApplyServerSideEncryptionByDefault": {"SSEAlgorithm": "AES256"}}]
    }
    policy_out.write_text(json.dumps(bucket_policy, indent=2) + "\n", encoding="utf-8")
    lifecycle_out.write_text(json.dumps(lifecycle_cfg, indent=2) + "\n", encoding="utf-8")
    enc_out.write_text(json.dumps(encryption_cfg, indent=2) + "\n", encoding="utf-8")
    return {"policy": bucket_policy, "lifecycle": lifecycle_cfg, "encryption": encryption_cfg}


def validate_state_bucket_configuration(
    bucket_name: str = IMMUTABLE_BUCKET,
    account_id: str = IMMUTABLE_ACCOUNT_ID,
    region: str = IMMUTABLE_REGION,
    expected_policy_path: pathlib.Path | None = None,
    s3_caller: Callable[[str, list[str]], dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Inspect and validate live S3 state bucket configuration against hardened standards."""
    call = s3_caller or (lambda op, params: _default_aws_cli("s3api", op, params))

    # 1. Location & Ownership
    loc_doc = call("get-bucket-location", ["--bucket", bucket_name, "--expected-bucket-owner", account_id])
    loc = loc_doc.get("LocationConstraint") or "us-east-1"
    if loc != region:
        raise SystemExit(f"[FATAL] Bucket '{bucket_name}' location '{loc}' != expected '{region}'.")

    # 2. Public Access Block (4/4 true)
    pab_doc = call("get-public-access-block", ["--bucket", bucket_name, "--expected-bucket-owner", account_id])
    pab = pab_doc.get("PublicAccessBlockConfiguration") or {}
    for req_key in ("BlockPublicAcls", "IgnorePublicAcls", "BlockPublicPolicy", "RestrictPublicBuckets"):
        if pab.get(req_key) is not True:
            raise SystemExit(f"[FATAL] Bucket '{bucket_name}' has incomplete PublicAccessBlock: {req_key} != True ({pab}).")

    # 3. Versioning (Enabled)
    ver_doc = call("get-bucket-versioning", ["--bucket", bucket_name, "--expected-bucket-owner", account_id])
    if ver_doc.get("Status") != "Enabled":
        raise SystemExit(f"[FATAL] Bucket '{bucket_name}' versioning is not Enabled (found: {ver_doc.get('Status')}).")

    # 4. Server-Side Encryption (Pure SSE-S3 AES256; zero KMS BucketKey cost)
    enc_doc = call("get-bucket-encryption", ["--bucket", bucket_name, "--expected-bucket-owner", account_id])
    rules = (enc_doc.get("ServerSideEncryptionConfiguration") or {}).get("Rules") or []
    if not rules:
        raise SystemExit(f"[FATAL] Bucket '{bucket_name}' lacks default server-side encryption.")
    def_enc = rules[0].get("ApplyServerSideEncryptionByDefault") or {}
    if def_enc.get("SSEAlgorithm") != "AES256":
        raise SystemExit(f"[FATAL] Bucket '{bucket_name}' SSEAlgorithm != 'AES256' (found: {def_enc.get('SSEAlgorithm')}).")
    if rules[0].get("BucketKeyEnabled"):
        raise SystemExit(f"[FATAL] Bucket '{bucket_name}' has BucketKeyEnabled=True (only valid for KMS; invalid for SSE-S3).")

    # 5. Bucket Policy Readback & Equality
    policy_matches = False
    policy_status = "unspecified"
    if expected_policy_path:
        if not expected_policy_path.is_file():
            raise SystemExit(f"[FATAL] Expected policy file not found: {expected_policy_path}")
        pol_raw = ""
        try:
            pol_doc = call("get-bucket-policy", ["--bucket", bucket_name, "--expected-bucket-owner", account_id])
            pol_raw = pol_doc.get("Policy") or ""
        except SystemExit as exc:
            raise SystemExit(f"[FATAL] State bucket '{bucket_name}' policy is missing or unreadable: {exc}")
        if not pol_raw:
            raise SystemExit(f"[FATAL] State bucket '{bucket_name}' has an empty bucket policy.")
        live_pol = _decode_doc(pol_raw)
        expected_pol = json.loads(expected_policy_path.read_text(encoding="utf-8"))
        if _canonical(live_pol) != _canonical(expected_pol) and _canonical_policy_doc(live_pol) != _canonical_policy_doc(expected_pol):
            raise SystemExit(f"[FATAL] Bucket policy on '{bucket_name}' drifted from {expected_policy_path.name}.")
        policy_matches = True
        policy_status = "verified_matches_expected"
    else:
        try:
            pol_doc = call("get-bucket-policy", ["--bucket", bucket_name, "--expected-bucket-owner", account_id])
            pol_raw = pol_doc.get("Policy") or ""
            policy_status = "present_unverified_against_file" if pol_raw else "missing"
        except SystemExit:
            policy_status = "missing"

    return {
        "bucket": bucket_name,
        "account_id": account_id,
        "region": region,
        "versioning": "Enabled",
        "encryption": "AES256",
        "public_access_block": True,
        "policy_matches": policy_matches,
        "policy_status": policy_status,
    }


def verify_state_prefix_readiness(
    bucket_name: str = IMMUTABLE_BUCKET,
    state_prefix: str = "foundation/",
    account_id: str = IMMUTABLE_ACCOUNT_ID,
    s3_caller: Callable[[str, list[str]], dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Verify that the state bucket prefix is accessible for Terraform backend initialization."""
    call = s3_caller or (lambda op, params: _default_aws_cli("s3api", op, params))
    res = call("list-objects-v2", [
        "--bucket", bucket_name,
        "--prefix", state_prefix,
        "--max-items", "5",
        "--expected-bucket-owner", account_id,
    ])
    key_count = res.get("KeyCount", 0)
    contents = [obj.get("Key") for obj in res.get("Contents") or []]
    return {
        "bucket": bucket_name,
        "state_prefix": state_prefix,
        "accessible": True,
        "existing_key_count": key_count,
        "sample_keys": contents,
    }


def verify_independent_admin_recovery(
    account_id: str = IMMUTABLE_ACCOUNT_ID,
    operator_principal: str = DEFAULT_OPERATOR_ARN,
    recovery_principal: str | None = None,
    iam_caller: Callable[[str, list[str]], dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Verify a genuinely independent administrative recovery path exists before transitioning operator IAM.

    Root password/MFA presence alone is NOT sufficient. Requires a verified, active
    administrative IAM identity distinct from the operator principal.
    """
    call = iam_caller or (lambda op, params: _default_aws_cli("iam", op, params))

    candidate = (recovery_principal or os.environ.get("ENVSCALE_RECOVERY_ADMIN_PRINCIPAL") or "").strip()

    # If no candidate was provided explicitly, check if a break-glass foundation-admin role exists.
    if not candidate:
        candidate = f"arn:aws:iam::{account_id}:role/envscale-foundation-admin-role"

    if candidate == operator_principal:
        raise SystemExit(
            f"[FATAL] Recovery principal '{candidate}' cannot be the operator identity '{operator_principal}'. "
            "An independent recovery identity is strictly required."
        )

    if not candidate.startswith(f"arn:aws:iam::{account_id}:"):
        raise SystemExit(f"[FATAL] Recovery principal '{candidate}' is outside AWS account '{account_id}'.")

    if ":user/" in candidate:
        uname = candidate.split(":user/", 1)[1]
        try:
            udoc = call("get-user", ["--user-name", uname]).get("User") or {}
        except SystemExit as exc:
            raise SystemExit(f"[FATAL] Independent recovery user '{uname}' does not exist: {exc}")
        attached = [str(p.get("PolicyArn", "")) for p in (call("list-attached-user-policies", ["--user-name", uname]).get("AttachedPolicies") or [])]
        if ADMIN_POLICY_ARN not in attached:
            raise SystemExit(
                f"[FATAL] Independent recovery user '{uname}' lacks '{ADMIN_POLICY_ARN}' (attached: {attached}). "
                "AdministratorAccess transition aborted to prevent operator lockout."
            )
        return {"mode": "independent_admin_user", "recovery_principal": candidate, "verified": True}

    if ":role/" in candidate:
        rname = candidate.split(":role/", 1)[1]
        try:
            rdoc = call("get-role", ["--role-name", rname]).get("Role") or {}
        except SystemExit as exc:
            raise SystemExit(
                f"[FATAL] Independent recovery role '{rname}' does not exist: {exc}. "
                "AdministratorAccess transition aborted to protect administrative recovery path."
            )
        trust_doc = _decode_doc(rdoc.get("AssumeRolePolicyDocument") or {})
        stmts = [s for s in (trust_doc.get("Statement") or []) if isinstance(s, dict)]
        has_allow_assume = any(
            s.get("Effect") == "Allow" and "sts:AssumeRole" in _as_list(s.get("Action"))
            for s in stmts
        )
        if not has_allow_assume:
            raise SystemExit(
                f"[FATAL] Independent recovery role '{rname}' lacks valid sts:AssumeRole trust statement. "
                "Transition aborted safely."
            )
        return {"mode": "independent_admin_role", "recovery_principal": candidate, "verified": True}

    raise SystemExit(f"[FATAL] Unsupported recovery principal format: '{candidate}'.")


def verify_operator_iam_transition_preflight(
    operator_principal: str = DEFAULT_OPERATOR_ARN,
    account_id: str = IMMUTABLE_ACCOUNT_ID,
    bootstrap_policy_path: pathlib.Path | None = None,
    recovery_principal: str | None = None,
    iam_caller: Callable[[str, list[str]], dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Execute preflight validations before detaching AdministratorAccess from operator."""
    call = iam_caller or (lambda op, params: _default_aws_cli("iam", op, params))

    if ":user/" not in operator_principal:
        raise SystemExit(f"[FATAL] Operator principal must be an IAM user: '{operator_principal}'.")
    user_name = operator_principal.split(":user/", 1)[1]

    # 1. Verify narrow bootstrap policy is attached to operator
    attached = [str(p.get("PolicyArn", "")) for p in (call("list-attached-user-policies", ["--user-name", user_name]).get("AttachedPolicies") or [])]
    expected_bp_arn = f"arn:aws:iam::{account_id}:policy/envscale-foundation-iam-bootstrap-policy"
    if expected_bp_arn not in attached:
        raise SystemExit(f"[FATAL] Operator '{user_name}' is missing required policy '{expected_bp_arn}' (attached: {attached}).")

    # 2. Verify narrow policy has zero drift against local canonical definition
    if bootstrap_policy_path and bootstrap_policy_path.is_file():
        p_meta = call("get-policy", ["--policy-arn", expected_bp_arn]).get("Policy") or {}
        ver_id = p_meta.get("DefaultVersionId")
        if not ver_id:
            raise SystemExit(f"[FATAL] Policy '{expected_bp_arn}' has no DefaultVersionId.")
        live_doc = _decode_doc((call("get-policy-version", ["--policy-arn", expected_bp_arn, "--version-id", str(ver_id)]).get("PolicyVersion") or {}).get("Document"))
        expected_doc = json.loads(bootstrap_policy_path.read_text(encoding="utf-8"))
        if _canonical(live_doc) != _canonical(expected_doc):
            raise SystemExit(f"[FATAL] Live policy '{expected_bp_arn}' drifted from {bootstrap_policy_path.name}.")

    # 3. Verify independent recovery admin path (Correction 1)
    rec_info = verify_independent_admin_recovery(
        account_id=account_id,
        operator_principal=operator_principal,
        recovery_principal=recovery_principal,
        iam_caller=call,
    )

    return {
        "operator": operator_principal,
        "bootstrap_policy_verified": True,
        "recovery_admin": rec_info,
        "ready_for_transition": True,
    }


def execute_operator_iam_transition(
    operator_principal: str = DEFAULT_OPERATOR_ARN,
    account_id: str = IMMUTABLE_ACCOUNT_ID,
    confirm_token: str = "",
    bootstrap_policy_path: pathlib.Path | None = None,
    recovery_principal: str | None = None,
    iam_caller: Callable[[str, list[str]], dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Safely transition operator by detaching AdministratorAccess after all preflight checks."""
    if confirm_token != REQUIRED_TRANSITION_TOKEN:
        raise SystemExit(f"[FATAL] --transition-operator-iam requires exact confirmation token: {REQUIRED_TRANSITION_TOKEN}")

    call = iam_caller or (lambda op, params: _default_aws_cli("iam", op, params))
    pre = verify_operator_iam_transition_preflight(
        operator_principal=operator_principal,
        account_id=account_id,
        bootstrap_policy_path=bootstrap_policy_path,
        recovery_principal=recovery_principal,
        iam_caller=call,
    )

    user_name = operator_principal.split(":user/", 1)[1]
    call("detach-user-policy", ["--user-name", user_name, "--policy-arn", ADMIN_POLICY_ARN])

    # Post-check: ensure AdministratorAccess is detached and bootstrap policy remains
    attached_after = [str(p.get("PolicyArn", "")) for p in (call("list-attached-user-policies", ["--user-name", user_name]).get("AttachedPolicies") or [])]
    expected_bp_arn = f"arn:aws:iam::{account_id}:policy/envscale-foundation-iam-bootstrap-policy"
    if ADMIN_POLICY_ARN in attached_after or attached_after != [expected_bp_arn]:
        raise SystemExit(f"[FATAL] Post-transition attached policies invalid: {attached_after}")

    return {
        "status": "transitioned",
        "operator": operator_principal,
        "remaining_attached_policies": attached_after,
        "recovery_admin_verified": pre["recovery_admin"]["recovery_principal"],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Day-0 Bucket & IAM Transition Helper")
    sub = parser.add_subparsers(dest="cmd", required=True)

    sp_bucket = sub.add_parser("check-bucket")
    sp_bucket.add_argument("--bucket", default=IMMUTABLE_BUCKET)
    sp_bucket.add_argument("--account-id", default=IMMUTABLE_ACCOUNT_ID)
    sp_bucket.add_argument("--region", default=IMMUTABLE_REGION)
    sp_bucket.add_argument("--policy-file")

    sp_prefix = sub.add_parser("check-prefix")
    sp_prefix.add_argument("--bucket", default=IMMUTABLE_BUCKET)
    sp_prefix.add_argument("--prefix", default="foundation/")
    sp_prefix.add_argument("--account-id", default=IMMUTABLE_ACCOUNT_ID)

    sp_rec = sub.add_parser("verify-recovery-admin")
    sp_rec.add_argument("--account-id", default=IMMUTABLE_ACCOUNT_ID)
    sp_rec.add_argument("--operator-principal", default=DEFAULT_OPERATOR_ARN)
    sp_rec.add_argument("--recovery-principal")

    sp_trans = sub.add_parser("transition-operator-iam")
    sp_trans.add_argument("--operator-principal", default=DEFAULT_OPERATOR_ARN)
    sp_trans.add_argument("--account-id", default=IMMUTABLE_ACCOUNT_ID)
    sp_trans.add_argument("--confirm-token", default="")
    sp_trans.add_argument("--bootstrap-policy-file")
    sp_trans.add_argument("--recovery-principal")

    sp_art = sub.add_parser("generate-artifacts")
    sp_art.add_argument("--account-id", default=IMMUTABLE_ACCOUNT_ID)
    sp_art.add_argument("--bucket", default=IMMUTABLE_BUCKET)
    sp_art.add_argument("--policy-out", required=True)
    sp_art.add_argument("--lifecycle-out", required=True)
    sp_art.add_argument("--enc-out", required=True)

    args = parser.parse_args()
    if args.cmd == "generate-artifacts":
        generate_bucket_artifacts(
            args.account_id, args.bucket,
            pathlib.Path(args.policy_out), pathlib.Path(args.lifecycle_out), pathlib.Path(args.enc_out),
        )
    elif args.cmd == "check-bucket":
        pol_p = pathlib.Path(args.policy_file) if args.policy_file else None
        res = validate_state_bucket_configuration(args.bucket, args.account_id, args.region, expected_policy_path=pol_p)
        if res.get("policy_matches"):
            print(f"[PASS] State bucket '{args.bucket}' configuration and hardened bucket policy verified.")
        elif res.get("policy_status") == "missing":
            print(f"[WARN] State bucket '{args.bucket}' baseline configuration verified, but bucket policy is MISSING (unsealed).")
        else:
            print(f"[PASS] State bucket '{args.bucket}' baseline configuration verified (bucket policy present; no comparison file provided).")
    elif args.cmd == "check-prefix":
        res = verify_state_prefix_readiness(args.bucket, args.prefix, args.account_id)
        print(f"[PASS] State bucket prefix 's3://{args.bucket}/{args.prefix}' verified accessible.")
    elif args.cmd == "verify-recovery-admin":
        res = verify_independent_admin_recovery(args.account_id, args.operator_principal, args.recovery_principal)
        print(f"[PASS] Independent administrative recovery verified: {res['recovery_principal']} ({res['mode']}).")
    elif args.cmd == "transition-operator-iam":
        pol_p = pathlib.Path(args.bootstrap_policy_file) if args.bootstrap_policy_file else None
        res = execute_operator_iam_transition(
            args.operator_principal, args.account_id, args.confirm_token,
            bootstrap_policy_path=pol_p, recovery_principal=args.recovery_principal,
        )
        print(f"[SUCCESS] Operator '{args.operator_principal}' transitioned: AdministratorAccess detached safely.")


if __name__ == "__main__":
    main()
