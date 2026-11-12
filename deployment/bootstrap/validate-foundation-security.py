#!/usr/bin/env python3
"""
EnvScale Phase 3 — Static HCL, Live AWS IAM Simulation & Bootstrap Regression Suite.

Performs 100% read-only / offline verification (ZERO AWS or GitHub writes):
  1. Historical archive UTC timestamp, human break-glass MFA role gates, and
     non-circular MFA-free Day-0 bootstrap policy verification.
  2. Pure SSE-S3 (zero BucketKeyEnabled), zero noncurrent state-version expiration,
     native S3 locking (`use_lockfile = true`, zero DynamoDB), and out-of-band SSM
     SecureString seeder tests.
  3. Live read-only `aws iam simulate-custom-policy` + local condition harness +
     `aws accessanalyzer validate-policy` across Day-0, `github_foundation`,
     `github_release`, `github_deploy`, `github_recovery`, `ec2_runtime`, and
     `foundation_admin`.
  4. Read-only audit of external GitHub `foundation`, `production`, and `recovery` Environments.
  5. Legacy `deployment/terraform/` preservation check.
"""

from __future__ import annotations

import base64
import json
import os
import pathlib
import subprocess
import sys
import tempfile

SCRIPT_DIR = pathlib.Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent.parent
FOUNDATION_DIR = REPO_ROOT / "deployment" / "foundation"

sys.dont_write_bytecode = True
sys.path.insert(0, str(SCRIPT_DIR))
import iam_policy_simulator as sim  # noqa: E402
import legacy_vault_inspector as lvi  # noqa: E402

ACCOUNT, REGION = sim.ACCOUNT, sim.REGION
TFSTATE_BUCKET, RECOVERY_BUCKET, LEGACY_BUCKET = sim.TFSTATE_BUCKET, sim.RECOVERY_BUCKET, sim.LEGACY_BUCKET


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        raise SystemExit(f"[FAIL] {msg}")


def expect_system_exit(fn, label: str) -> str:
    try:
        fn()
    except SystemExit as exc:
        print(f"  [PASS] {label} -> {exc}")
        return str(exc)
    raise SystemExit(f"[FAIL] Expected SystemExit for: {label}")


def test_timestamp_and_identity_gates() -> None:
    print("=== [1/6] Historical UTC Timestamp, Break-Glass MFA Role & MFA-Free Day-0 Gates ===")
    ist_iso, conv_utc, _ = lvi._convert_legacy_ist_key_to_utc("database/backup_20261023_005151.sql")
    assert_true(ist_iso == "2026-10-23T00:51:51+05:30" and conv_utc == "2026-10-22T19:21:51Z", "Bad IST->UTC")
    arch_ts, src, _, _ = lvi._derive_timestamp("database/backup_20261023_005151.sql", "2026-10-22T19:21:53+00:00")
    assert_true(arch_ts == "20261022T192153Z" and src == "s3_last_modified_utc", f"Bad archive_ts: {arch_ts}")
    expect_system_exit(lambda: lvi._derive_timestamp("database/backup_20261023_005151.sql", "2026-10-23T00:51:51Z"), "5.5h IST/UTC skew rejected")

    valid_role_doc = {
        "Role": {
            "RoleName": "envscale-foundation-admin-role",
            "MaxSessionDuration": 3600,
            "AssumeRolePolicyDocument": {
                "Version": "2012-10-17",
                "Statement": [{
                    "Effect": "Allow",
                    "Principal": {"AWS": [f"arn:aws:iam::{ACCOUNT}:user/DEV-user-alpha"]},
                    "Action": "sts:AssumeRole",
                    "Condition": {"Bool": {"aws:MultiFactorAuthPresent": "true"}, "NumericLessThan": {"aws:MultiFactorAuthAge": "3600"}},
                }],
            },
        }
    }
    with tempfile.TemporaryDirectory(prefix="envscale-mfa-test-") as td:
        td_p = pathlib.Path(td)
        role_ok = td_p / "role_ok.json"
        role_ok.write_text(json.dumps(valid_role_doc), encoding="utf-8")
        sts_ok = td_p / "sts_ok.json"
        sts_ok.write_text(json.dumps({"Account": ACCOUNT, "Arn": f"arn:aws:sts::{ACCOUNT}:assumed-role/envscale-foundation-admin-role/op-mfa"}), encoding="utf-8")
        lvi.cmd_verify_foundation_admin_mfa(str(sts_ok), str(role_ok))

        for lbl, mut_fn in [
            ("Break-glass Admin trusting root rejected", lambda d: d["Role"]["AssumeRolePolicyDocument"]["Statement"][0]["Principal"].update({"AWS": [f"arn:aws:iam::{ACCOUNT}:root"]})),
            ("Break-glass Admin lacking MFA trust condition rejected", lambda d: d["Role"]["AssumeRolePolicyDocument"]["Statement"][0]["Condition"].clear()),
        ]:
            bad_p = td_p / f"{lbl[:10].replace(' ', '_')}.json"
            bad_doc = json.loads(json.dumps(valid_role_doc))
            mut_fn(bad_doc)
            bad_p.write_text(json.dumps(bad_doc), encoding="utf-8")
            expect_system_exit(lambda bp=bad_p: lvi.cmd_verify_foundation_admin_mfa(str(sts_ok), str(bp)), lbl)

        for lbl, arn in [
            ("Raw IAM user rejected for break-glass admin role check", f"arn:aws:iam::{ACCOUNT}:user/DEV-user-alpha"),
            ("Non-Foundation-Admin assumed role rejected", f"arn:aws:sts::{ACCOUNT}:assumed-role/SomeOtherAdminRole/sess"),
        ]:
            sp = td_p / "sts_bad.json"
            sp.write_text(json.dumps({"Account": ACCOUNT, "Arn": arn}), encoding="utf-8")
            expect_system_exit(lambda s=sp: lvi.cmd_verify_foundation_admin_mfa(str(s), str(role_ok)), lbl)

    bs_text = (SCRIPT_DIR / "bootstrap-state.sh").read_text(encoding="utf-8")
    bs_code = "\n".join(ln for ln in bs_text.splitlines() if not ln.lstrip().startswith("#"))
    for forbidden in ("--day0-initial-bootstrap", "GetSessionToken", "verify-foundation-admin-mfa", "MultiFactorAuthPresent"):
        assert_true(forbidden not in bs_code, f"bootstrap-state.sh still contains forbidden circular/MFA gate '{forbidden}'")
    import day0_identity_guard  # noqa: E402
    day0_identity_guard.validate_day0_policy_pair(
        SCRIPT_DIR / "day0-bootstrap-policy.json",
        SCRIPT_DIR / "day0-bootstrap-permissions-boundary.json",
    )
    day0_identity_guard.validate_initial_seal_policy_pair(
        SCRIPT_DIR / "day0-initial-policy-seal.json",
        SCRIPT_DIR / "day0-initial-seal-permissions-boundary.json",
    )
    day0_identity_guard.verify_breakglass_admin_caller_and_trust(
        {"Account": ACCOUNT, "Arn": f"arn:aws:sts::{ACCOUNT}:assumed-role/envscale-foundation-admin-role/op-mfa"},
        iam_caller=lambda op, params: valid_role_doc,
    )
    for role_lbl, sub in (("Day-0", "repo:P20000/EnvScale:environment:day0-bootstrap"), ("Initial-seal", "repo:P20000/EnvScale:environment:day0-initial-seal")):
        day0_identity_guard.validate_live_role_trust_policy(
            {"AssumeRolePolicyDocument": {"Version": "2012-10-17", "Statement": [{"Effect": "Allow", "Principal": {"AWS": [f"arn:aws:iam::{ACCOUNT}:user/DEV-user-alpha"]}, "Action": "sts:AssumeRole"}]}},
            role_label=role_lbl, allowed_oidc_subs=frozenset({sub}),
        )
        day0_identity_guard.validate_live_role_trust_policy(
            {"AssumeRolePolicyDocument": {"Version": "2012-10-17", "Statement": [{"Effect": "Allow", "Principal": {"Federated": f"arn:aws:iam::{ACCOUNT}:oidc-provider/token.actions.githubusercontent.com"}, "Action": "sts:AssumeRoleWithWebIdentity", "Condition": {"StringEquals": {"token.actions.githubusercontent.com:aud": "sts.amazonaws.com", "token.actions.githubusercontent.com:sub": sub}}}]}},
            role_label=role_lbl, allowed_oidc_subs=frozenset({sub}),
        )
    print("  [PASS] Day-0 bootstrap, initial-seal, & break-glass live trust policies verified")


def test_bootstrap_and_seed_scripts() -> dict:
    print("=== [2/6] Pure SSE-S3, State History Retention, Native Locking & Secret Seeder Tests ===")
    for tf_file in sorted(FOUNDATION_DIR.glob("*.tf")):
        txt = tf_file.read_text(encoding="utf-8")
        assert_true("aws_dynamodb_table" not in txt and "dynamodb:" not in txt.lower(), f"Forbidden DynamoDB in {tf_file.name}")
        assert_true("bucket_key_enabled" not in txt, f"Forbidden bucket_key_enabled on SSE-S3 in {tf_file.name}")
        code_only = "\n".join(ln for ln in txt.splitlines() if not ln.lstrip().startswith("#"))
        if tf_file.name != "outputs.tf":
            assert_true('"SecureString"' not in code_only, f"Forbidden SecureString resource in {tf_file.name}")

    bs_dry = subprocess.run([str(SCRIPT_DIR / "bootstrap-state.sh"), "--dry-run"], capture_output=True, text=True, check=True)
    enc_str = bs_dry.stdout.split("--- Rendered Encryption JSON ---\n", 1)[1].split("--- Rendered Lifecycle JSON ---", 1)[0].strip()
    lc_str = bs_dry.stdout.split("--- Rendered Lifecycle JSON ---\n", 1)[1].split("--- Rendered Bucket Policy JSON ---", 1)[0].strip()
    pol_str = bs_dry.stdout.split("--- Rendered Bucket Policy JSON ---\n", 1)[1].split("[DRY-RUN SUCCESS]", 1)[0].strip()
    assert_true(json.loads(enc_str) == {"Rules": [{"ApplyServerSideEncryptionByDefault": {"SSEAlgorithm": "AES256"}}]}, "Invalid SSE-S3 config")
    assert_true("BucketKeyEnabled" not in enc_str and "NoncurrentVersionExpiration" not in lc_str, "Forbidden SSE-KMS or version expiration")
    lc_doc = json.loads(lc_str)
    assert_true(len(lc_doc["Rules"]) == 1 and lc_doc["Rules"][0]["ID"] == "abort-incomplete-multipart-uploads", f"Unexpected lifecycle: {lc_doc}")
    import day0_identity_guard  # noqa: E402
    day0_identity_guard.validate_tfstate_bucket_policy_doc(json.loads(pol_str))
    print("  [PASS] bootstrap-state.sh --dry-run verified pure SSE-S3, zero version expiration & Day-0 policy lock")

    seed_script = str(SCRIPT_DIR / "seed-parameters.sh")
    seed_dry = subprocess.run([seed_script, "--dry-run"], capture_output=True, text=True, check=True)
    assert_true("REDACTED (Base64 -> exact 32 decoded bytes, fresh-CSPRNG)" in seed_dry.stdout, "Missing 32-byte key check")

    demo_key = ""
    for ln in (REPO_ROOT / "apps/api-server/.env.example").read_text(encoding="utf-8").splitlines():
        if ln.startswith("KUBECONFIG_ENCRYPTION_KEY="):
            demo_key = ln.split("=", 1)[1].strip().strip("'\"")

    with tempfile.TemporaryDirectory(prefix="envscale-seed-neg-") as td:
        td_p = pathlib.Path(td)
        valid_sec = td_p / "valid.env"
        valid_sec.write_text("DUCKDNS_TOKEN=valid-duckdns-12345\n", encoding="utf-8")
        os.chmod(valid_sec, 0o600)
        for lbl, cmd, needle in [
            ("--apply without --kubeconfig-key-disposition rejected", [seed_script, "--apply", "--confirm-seed", "SEED-SSM-982534376726", "--secrets-file", str(valid_sec)], "--kubeconfig-key-disposition"),
            ("preserve-from-secrets-file without key rejected", [seed_script, "--dry-run", "--secrets-file", str(valid_sec), "--kubeconfig-key-disposition", "preserve-from-secrets-file"], "requires KUBECONFIG_ENCRYPTION_KEY"),
        ]:
            r = subprocess.run(cmd, capture_output=True, text=True)
            assert_true(r.returncode != 0 and needle in r.stderr, f"{lbl}: {r.stderr}")
            print(f"  [PASS] {lbl}")

        demo_sec = td_p / "demo.env"
        demo_sec.write_text(f"DUCKDNS_TOKEN=valid-duckdns-12345\nKUBECONFIG_ENCRYPTION_KEY={demo_key}\n", encoding="utf-8")
        os.chmod(demo_sec, 0o600)
        r_demo = subprocess.run([seed_script, "--dry-run", "--secrets-file", str(demo_sec), "--kubeconfig-key-disposition", "preserve-from-secrets-file"], capture_output=True, text=True)
        assert_true(r_demo.returncode != 0 and ".env.example is forbidden" in r_demo.stderr, "Demo key must be rejected")

        short_sec = td_p / "short.env"
        short_sec.write_text(f"DUCKDNS_TOKEN=valid-duckdns-12345\nKUBECONFIG_ENCRYPTION_KEY={base64.b64encode(b'x'*16).decode()}\n", encoding="utf-8")
        os.chmod(short_sec, 0o600)
        r_short = subprocess.run([seed_script, "--dry-run", "--secrets-file", str(short_sec)], capture_output=True, text=True)
        assert_true(r_short.returncode != 0 and "decoded to 16 bytes" in r_short.stderr, "16-byte key must fail")
        print("  [PASS] seed-parameters.sh negative key checks passed")

    kms_proc = subprocess.run(["aws", "kms", "describe-key", "--key-id", "alias/aws/ssm", "--region", REGION, "--output", "json"], capture_output=True, text=True, check=False)
    if kms_proc.returncode == 0:
        km = json.loads(kms_proc.stdout).get("KeyMetadata", {})
        canonical_arn = km.get("Arn")
        valid_keys = {"alias/aws/ssm", km.get("KeyId"), canonical_arn} - {"", None}
    else:
        canonical_arn = f"arn:aws:kms:{REGION}:{ACCOUNT}:key/14a2af96-fc5c-40f9-9c29-d3ef25ab99aa"
        valid_keys = {"alias/aws/ssm", "14a2af96-fc5c-40f9-9c29-d3ef25ab99aa", canonical_arn}

    for lbl, fn in [
        ("SSM Type=String rejected", lambda: sim.verify_existing_ssm_parameter_record("/envscale/prod/test", {"Type": "String", "KeyId": canonical_arn}, valid_keys, {"Project": "EnvScale"})),
        ("SSM missing KeyId rejected", lambda: sim.verify_existing_ssm_parameter_record("/envscale/prod/test", {"Type": "SecureString", "KeyId": ""}, valid_keys, {"Project": "EnvScale"})),
        ("SSM unexpected KMS key rejected", lambda: sim.verify_existing_ssm_parameter_record("/envscale/prod/test", {"Type": "SecureString", "KeyId": f"arn:aws:kms:{REGION}:{ACCOUNT}:key/unrelated"}, valid_keys, {"Project": "EnvScale"})),
        ("SSM failed tag lookup rejected", lambda: sim.verify_existing_ssm_parameter_record("/envscale/prod/test", {"Type": "SecureString", "KeyId": canonical_arn}, valid_keys, None, tag_lookup_error="AccessDenied")),
        ("SSM missing Project tag rejected", lambda: sim.verify_existing_ssm_parameter_record("/envscale/prod/test", {"Type": "SecureString", "KeyId": canonical_arn}, valid_keys, {})),
        ("SSM conflicting Project tag rejected", lambda: sim.verify_existing_ssm_parameter_record("/envscale/prod/test", {"Type": "SecureString", "KeyId": canonical_arn}, valid_keys, {"Project": "Relmonition"})),
    ]:
        expect_system_exit(fn, lbl)
    sim.verify_existing_ssm_parameter_record("/envscale/prod/test", {"Type": "SecureString", "KeyId": canonical_arn}, valid_keys, {"Project": "EnvScale"})

    pv_proc = subprocess.run([sys.executable, str(SCRIPT_DIR / "validate-foundation-plan.py"), "--self-test"], capture_output=True, text=True, check=False)
    assert_true(pv_proc.returncode == 0, f"Plan validator self-tests failed: {pv_proc.stderr}")
    print("  [PASS] Plan allowlist validator (initial + update modes & security primitives) passed")
    return json.loads(pol_str)


def test_live_aws_iam_simulation_and_analyzer(tfstate_bucket_policy: dict) -> None:
    print("=== [3/6] Live Read-Only `aws iam simulate-custom-policy` & Negative Blast-Radius Suite ===")
    policies = sim.build_rendered_foundation_policies(FOUNDATION_DIR)
    policies["tfstate_bucket_policy"] = tfstate_bucket_policy

    tf_b, rc_b, lg_b = f"arn:aws:s3:::{TFSTATE_BUCKET}", f"arn:aws:s3:::{RECOVERY_BUCKET}", f"arn:aws:s3:::{LEGACY_BUCKET}"
    wb_arn = f"arn:aws:iam::{ACCOUNT}:policy/envscale-workload-permissions-boundary"
    ssm_core = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
    tag_res_ok = {"aws:ResourceTag/Project": "EnvScale", "aws:ResourceTag/Layer": "DisposableRuntime"}
    tag_res_other = {"aws:ResourceTag/Project": "Relmonition", "aws:ResourceTag/Layer": "Production"}
    tag_req_ok = {"aws:RequestTag/Project": "EnvScale", "aws:RequestTag/Layer": "DisposableRuntime"}
    allow_all = {"Version": "2012-10-17", "Statement": [{"Effect": "Allow", "Action": "*", "Resource": "*"}]}
    sim_policies = dict(policies)
    sim_policies["allow_all"] = allow_all
    boundary_for_key = {
        "day0_bootstrap": "day0_bootstrap_boundary",
        "day0_initial_seal": "day0_initial_seal_boundary",
        "role_ec2_runtime": "role_workload_permissions_boundary",
        "role_github_release": "role_workload_permissions_boundary",
        "role_github_deploy": "role_workload_permissions_boundary",
        "role_github_recovery": "role_workload_permissions_boundary",
    }

    vectors = [
        # Day-0 bootstrap least-privilege, self-boundary inspection & bucket-policy checks
        ("day0 CreateBucket on tfstate", "day0_bootstrap", "s3:CreateBucket", tf_b, {}, None, "allowed"),
        ("NEG: day0 PutBucketPolicy w/o rp", "day0_bootstrap", "s3:PutBucketPolicy", tf_b, {}, None, "explicitDeny"),
        ("NEG: day0 PutBucketPolicy after seal", "day0_bootstrap", "s3:PutBucketPolicy", tf_b, {"aws:SecureTransport": True, "aws:PrincipalAccount": ACCOUNT, "aws:PrincipalArn": f"arn:aws:iam::{ACCOUNT}:user/envscale-day0-bootstrap"}, "tfstate_bucket_policy", "explicitDeny"),
        ("day0_seal CreateBucket on tfstate", "day0_initial_seal", "s3:CreateBucket", tf_b, {}, None, "allowed"),
        ("day0_seal PutBucketPolicy unsealed", "day0_initial_seal", "s3:PutBucketPolicy", tf_b, {}, None, "allowed"),
        ("NEG: day0_seal PutBucketPolicy after seal", "day0_initial_seal", "s3:PutBucketPolicy", tf_b, {"aws:SecureTransport": True, "aws:PrincipalAccount": ACCOUNT, "aws:PrincipalArn": f"arn:aws:iam::{ACCOUNT}:user/envscale-day0-initial-seal"}, "tfstate_bucket_policy", "explicitDeny"),
        ("day0_seal GetUser self inspection", "day0_initial_seal", "iam:GetUser", f"arn:aws:iam::{ACCOUNT}:user/envscale-day0-initial-seal", {}, None, "allowed"),
        ("NEG: day0_seal GetUser day0-bootstrap", "day0_initial_seal", "iam:GetUser", f"arn:aws:iam::{ACCOUNT}:user/envscale-day0-bootstrap", {}, None, "implicitDeny"),
        ("NEG: day0_seal GetObject state", "day0_initial_seal", "s3:GetObject", f"{tf_b}/foundation/terraform.tfstate", {}, None, "explicitDeny"),
        ("NEG: day0_seal PutObject state", "day0_initial_seal", "s3:PutObject", f"{tf_b}/foundation/terraform.tfstate", {}, None, "explicitDeny"),
        ("NEG: day0_seal GetObject recovery", "day0_initial_seal", "s3:GetObject", f"{rc_b}/backups/postgres/latest-valid.json", {}, None, "explicitDeny"),
        ("NEG: day0_seal CreateRole IAM", "day0_initial_seal", "iam:CreateRole", f"arn:aws:iam::{ACCOUNT}:role/envscale-x", {}, None, "explicitDeny"),
        ("day0 GetUser self-boundary inspection", "day0_bootstrap", "iam:GetUser", f"arn:aws:iam::{ACCOUNT}:user/envscale-day0-bootstrap", {}, None, "allowed"),
        ("NEG: day0 GetRole non-day0 admin", "day0_bootstrap", "iam:GetRole", f"arn:aws:iam::{ACCOUNT}:role/envscale-foundation-admin-role", {}, None, "implicitDeny"),
        ("NEG: day0 PutUserPolicy self-escalation", "day0_bootstrap", "iam:PutUserPolicy", f"arn:aws:iam::{ACCOUNT}:user/envscale-day0-bootstrap", {}, None, "explicitDeny"),
        ("NEG: day0 DeleteBucket on tfstate", "day0_bootstrap", "s3:DeleteBucket", tf_b, {}, None, "explicitDeny"),
        ("NEG: day0 DeleteBucketPolicy on tfstate", "day0_bootstrap", "s3:DeleteBucketPolicy", tf_b, {"aws:SecureTransport": True, "aws:PrincipalAccount": ACCOUNT}, "tfstate_bucket_policy", "explicitDeny"),
        ("NEG: day0 GetObject on tfstate", "day0_bootstrap", "s3:GetObject", f"{tf_b}/foundation/terraform.tfstate", {}, None, "explicitDeny"),
        ("NEG: day0 iam:CreateRole", "day0_bootstrap", "iam:CreateRole", f"arn:aws:iam::{ACCOUNT}:role/envscale-x", {}, None, "explicitDeny"),
        ("NEG: day0 ec2:RunInstances", "day0_bootstrap", "ec2:RunInstances", f"arn:aws:ec2:{REGION}:{ACCOUNT}:instance/*", {}, None, "explicitDeny"),
        ("NEG: day0 ssm:GetParameter", "day0_bootstrap", "ssm:GetParameter", f"arn:aws:ssm:{REGION}:{ACCOUNT}:parameter/envscale/prod/x", {}, None, "explicitDeny"),
        ("NEG: day0 read recovery bucket", "day0_bootstrap", "s3:GetObject", f"{rc_b}/backups/postgres/latest-valid.json", {}, None, "explicitDeny"),
        ("NEG: day0 read legacy vault", "day0_bootstrap", "s3:GetObject", f"{lg_b}/database/x.sql", {}, None, "explicitDeny"),

        # Hardened OIDC github_foundation checks (no MFA, self/admin mutation blocked, boundary enforced)
        ("foundation PutObject foundation.tfstate", "role_github_foundation", "s3:PutObject", f"{tf_b}/foundation/terraform.tfstate", {}, None, "allowed"),
        ("foundation DeleteObject foundation.tflock", "role_github_foundation", "s3:DeleteObject", f"{tf_b}/foundation/terraform.tfstate.tflock", {"aws:SecureTransport": True, "aws:PrincipalAccount": ACCOUNT}, "tfstate_bucket_policy", "allowed"),
        ("foundation CreateRole deploy w/ boundary", "role_github_foundation", "iam:CreateRole", f"arn:aws:iam::{ACCOUNT}:role/envscale-github-deploy-role", {"iam:PermissionsBoundary": wb_arn}, None, "allowed"),
        ("NEG: foundation CreateRole deploy w/o boundary", "role_github_foundation", "iam:CreateRole", f"arn:aws:iam::{ACCOUNT}:role/envscale-github-deploy-role", {}, None, "implicitDeny"),
        ("NEG: foundation CreateRole rogue role w/ boundary", "role_github_foundation", "iam:CreateRole", f"arn:aws:iam::{ACCOUNT}:role/rogue-admin-role", {"iam:PermissionsBoundary": wb_arn}, None, "implicitDeny"),
        ("foundation AttachRolePolicy ec2 SSMCore", "role_github_foundation", "iam:AttachRolePolicy", f"arn:aws:iam::{ACCOUNT}:role/envscale-ec2-runtime-role", {"iam:PolicyARN": ssm_core}, None, "allowed"),
        ("NEG: foundation AttachRolePolicy AdminAccess", "role_github_foundation", "iam:AttachRolePolicy", f"arn:aws:iam::{ACCOUNT}:role/envscale-ec2-runtime-role", {"iam:PolicyARN": "arn:aws:iam::aws:policy/AdministratorAccess"}, None, "implicitDeny"),
        ("NEG: foundation UpdateAssumeRolePolicy self", "role_github_foundation", "iam:UpdateAssumeRolePolicy", f"arn:aws:iam::{ACCOUNT}:role/envscale-github-foundation-role", {}, None, "explicitDeny"),
        ("NEG: foundation PutRolePolicy self", "role_github_foundation", "iam:PutRolePolicy", f"arn:aws:iam::{ACCOUNT}:role/envscale-github-foundation-role", {}, None, "explicitDeny"),
        ("NEG: foundation PutRolePolicy plan-role", "role_github_foundation", "iam:PutRolePolicy", f"arn:aws:iam::{ACCOUNT}:role/envscale-github-foundation-plan-role", {}, None, "explicitDeny"),
        ("NEG: foundation UpdateAssumeRolePolicy admin", "role_github_foundation", "iam:UpdateAssumeRolePolicy", f"arn:aws:iam::{ACCOUNT}:role/envscale-foundation-admin-role", {}, None, "explicitDeny"),
        ("NEG: foundation PutRolePolicy foundation_admin", "role_github_foundation", "iam:PutRolePolicy", f"arn:aws:iam::{ACCOUNT}:role/envscale-foundation-admin-role", {}, None, "explicitDeny"),
        ("NEG: foundation DeleteRolePermissionsBoundary", "role_github_foundation", "iam:DeleteRolePermissionsBoundary", f"arn:aws:iam::{ACCOUNT}:role/envscale-github-deploy-role", {}, None, "explicitDeny"),
        ("NEG: foundation CreatePolicyVersion boundary", "role_github_foundation", "iam:CreatePolicyVersion", wb_arn, {}, None, "explicitDeny"),
        ("foundation ListOpenIDConnectProviders on *", "role_github_foundation", "iam:ListOpenIDConnectProviders", "*", {}, None, "allowed"),
        ("NEG: foundation iam:ListRoles on *", "role_github_foundation", "iam:ListRoles", "*", {}, None, "implicitDeny"),

        # Read-only OIDC github_foundation_plan checks
        ("foundation_plan GetObject foundation.tfstate", "role_github_foundation_plan", "s3:GetObject", f"{tf_b}/foundation/terraform.tfstate", {}, None, "allowed"),
        ("foundation_plan GetRole ec2-runtime", "role_github_foundation_plan", "iam:GetRole", f"arn:aws:iam::{ACCOUNT}:role/envscale-ec2-runtime-role", {}, None, "allowed"),
        ("NEG: foundation_plan PutObject tfstate", "role_github_foundation_plan", "s3:PutObject", f"{tf_b}/foundation/terraform.tfstate", {}, None, "explicitDeny"),
        ("NEG: foundation_plan GetParameter SecureString", "role_github_foundation_plan", "ssm:GetParameter", f"arn:aws:ssm:{REGION}:{ACCOUNT}:parameter/envscale/prod/postgres_password", {}, None, "explicitDeny"),
        ("NEG: foundation_plan iam:CreateRole", "role_github_foundation_plan", "iam:CreateRole", f"arn:aws:iam::{ACCOUNT}:role/envscale-github-deploy-role", {}, None, "explicitDeny"),
        ("foundation PutParameter non-secret duckdns_domain", "role_github_foundation", "ssm:PutParameter", f"arn:aws:ssm:{REGION}:{ACCOUNT}:parameter/envscale/prod/duckdns_domain", {}, None, "allowed"),
        ("NEG: foundation PutParameter postgres_password", "role_github_foundation", "ssm:PutParameter", f"arn:aws:ssm:{REGION}:{ACCOUNT}:parameter/envscale/prod/postgres_password", {}, None, "explicitDeny"),
        ("NEG: foundation GetParameter postgres_password", "role_github_foundation", "ssm:GetParameter", f"arn:aws:ssm:{REGION}:{ACCOUNT}:parameter/envscale/prod/postgres_password", {}, None, "explicitDeny"),
        ("NEG: foundation kms:Decrypt", "role_github_foundation", "kms:Decrypt", f"arn:aws:kms:{REGION}:{ACCOUNT}:key/11112222-3333-4444-5555-666677778888", {"kms:ViaService": f"ssm.{REGION}.amazonaws.com"}, None, "explicitDeny"),
        ("NEG: foundation ec2:RunInstances", "role_github_foundation", "ec2:RunInstances", f"arn:aws:ec2:{REGION}:{ACCOUNT}:instance/i-01", tag_req_ok, None, "explicitDeny"),
        ("NEG: foundation DeleteBucket recovery", "role_github_foundation", "s3:DeleteBucket", rc_b, {}, None, "explicitDeny"),
        ("NEG: foundation DeleteObject foundation.tfstate", "role_github_foundation", "s3:DeleteObject", f"{tf_b}/foundation/terraform.tfstate", {}, None, "explicitDeny"),
        ("NEG: foundation PutObject runtime.tfstate", "role_github_foundation", "s3:PutObject", f"{tf_b}/runtime/terraform.tfstate", {}, None, "explicitDeny"),
        ("NEG: foundation GetObject backups/*", "role_github_foundation", "s3:GetObject", f"{rc_b}/backups/postgres/latest-valid.json", {}, None, "explicitDeny"),
        ("NEG: foundation read legacy vault", "role_github_foundation", "s3:GetObject", f"{lg_b}/database/x.sql", {}, None, "explicitDeny"),

        # EC2 RunInstances AMI/snapshot & tag scoping (with boundary region lock = ap-south-1)
        ("deploy RunInstances Ubuntu AMI", "role_github_deploy", "ec2:RunInstances", sim.LIVE_UBUNTU_AMI_ARN, {"ec2:Owner": "099720109477", "aws:RequestedRegion": REGION}, None, "allowed"),
        ("NEG: deploy RunInstances wrong region", "role_github_deploy", "ec2:RunInstances", sim.LIVE_UBUNTU_AMI_ARN, {"ec2:Owner": "099720109477", "aws:RequestedRegion": "us-east-1"}, None, "implicitDeny"),
        ("deploy RunInstances Ubuntu EBS snapshot", "role_github_deploy", "ec2:RunInstances", sim.LIVE_UBUNTU_SNAP_ARN, {"ec2:Owner": "099720109477", "aws:RequestedRegion": REGION}, None, "allowed"),
        ("recovery RunInstances Ubuntu EBS snapshot", "role_github_recovery", "ec2:RunInstances", sim.LIVE_UBUNTU_SNAP_ARN, {"ec2:Owner": "099720109477", "aws:RequestedRegion": REGION}, None, "allowed"),
        ("deploy RunInstances tagged new instance", "role_github_deploy", "ec2:RunInstances", f"arn:aws:ec2:{REGION}:{ACCOUNT}:instance/i-0envscale01", {**tag_req_ok, "aws:RequestedRegion": REGION}, None, "allowed"),
        ("deploy RunInstances tagged new ENI", "role_github_deploy", "ec2:RunInstances", f"arn:aws:ec2:{REGION}:{ACCOUNT}:network-interface/eni-0envscale01", {**tag_req_ok, "aws:RequestedRegion": REGION}, None, "allowed"),
        ("NEG: deploy RunInstances unrelated ENI", "role_github_deploy", "ec2:RunInstances", f"arn:aws:ec2:{REGION}:{ACCOUNT}:network-interface/eni-0other01", {**tag_res_other, "aws:RequestedRegion": REGION}, None, "implicitDeny"),
        ("NEG: deploy RunInstances unapproved AMI", "role_github_deploy", "ec2:RunInstances", f"arn:aws:ec2:{REGION}::image/ami-0bad1111222233334", {"ec2:Owner": "111122223333", "aws:RequestedRegion": REGION}, None, "implicitDeny"),
        ("NEG: deploy RunInstances untagged instance", "role_github_deploy", "ec2:RunInstances", f"arn:aws:ec2:{REGION}:{ACCOUNT}:instance/i-0untagged", {"aws:RequestedRegion": REGION}, None, "implicitDeny"),

        # Tag-scoped runtime lifecycle & coexisting EKS isolation
        ("deploy StopInstances EnvScale instance", "role_github_deploy", "ec2:StopInstances", f"arn:aws:ec2:{REGION}:{ACCOUNT}:instance/i-0envscale01", {**tag_res_ok, "aws:RequestedRegion": REGION}, None, "allowed"),
        ("NEG: deploy StopInstances unrelated instance", "role_github_deploy", "ec2:StopInstances", f"arn:aws:ec2:{REGION}:{ACCOUNT}:instance/i-0other01", {**tag_res_other, "aws:RequestedRegion": REGION}, None, "implicitDeny"),
        ("NEG: deploy TerminateInstances EnvScale instance", "role_github_deploy", "ec2:TerminateInstances", f"arn:aws:ec2:{REGION}:{ACCOUNT}:instance/i-0envscale01", {**tag_res_ok, "aws:RequestedRegion": REGION}, None, "explicitDeny"),
        ("recovery TerminateInstances EnvScale instance", "role_github_recovery", "ec2:TerminateInstances", f"arn:aws:ec2:{REGION}:{ACCOUNT}:instance/i-0envscale01", {**tag_res_ok, "aws:RequestedRegion": REGION}, None, "allowed"),
        ("NEG: recovery TerminateInstances unrelated", "role_github_recovery", "ec2:TerminateInstances", f"arn:aws:ec2:{REGION}:{ACCOUNT}:instance/i-0other01", {**tag_res_other, "aws:RequestedRegion": REGION}, None, "implicitDeny"),
        ("recovery DeleteVpc EnvScale VPC", "role_github_recovery", "ec2:DeleteVpc", f"arn:aws:ec2:{REGION}:{ACCOUNT}:vpc/vpc-0envscale01", {**tag_res_ok, "aws:RequestedRegion": REGION}, None, "allowed"),
        ("NEG: recovery DeleteVpc unrelated VPC", "role_github_recovery", "ec2:DeleteVpc", f"arn:aws:ec2:{REGION}:{ACCOUNT}:vpc/vpc-0other01", {**tag_res_other, "aws:RequestedRegion": REGION}, None, "implicitDeny"),
        ("NEG: recovery DeleteCluster coexisting EKS", "role_github_recovery", "eks:DeleteCluster", sim.LIVE_COEXISTING_EKS_ARN, {**tag_res_other, "aws:RequestedRegion": REGION}, None, "implicitDeny"),
        ("NEG: recovery DeleteTags Project governance", "role_github_recovery", "ec2:DeleteTags", f"arn:aws:ec2:{REGION}:{ACCOUNT}:instance/i-0envscale01", {**tag_res_ok, "aws:TagKeys": ["Project"], "aws:RequestedRegion": REGION}, None, "explicitDeny"),
        ("NEG: recovery ReleaseAddress static EIP", "role_github_recovery", "ec2:ReleaseAddress", f"arn:aws:ec2:{REGION}:{ACCOUNT}:elastic-ip/eipalloc-123", {"aws:ResourceTag/Project": "EnvScale", "aws:RequestedRegion": REGION}, None, "explicitDeny"),
        ("deploy PassRole ec2_runtime to ec2", "role_github_deploy", "iam:PassRole", f"arn:aws:iam::{ACCOUNT}:role/envscale-ec2-runtime-role", {"iam:PassedToService": "ec2.amazonaws.com"}, None, "allowed"),
        ("NEG: deploy PassRole ec2_runtime to lambda", "role_github_deploy", "iam:PassRole", f"arn:aws:iam::{ACCOUNT}:role/envscale-ec2-runtime-role", {"iam:PassedToService": "lambda.amazonaws.com"}, None, "implicitDeny"),

        # S3 locking, bucket policies, backup pointer promotion & break-glass admin
        ("deploy native .tflock release", "role_github_deploy", "s3:DeleteObject", f"{tf_b}/runtime/terraform.tfstate.tflock", {"aws:SecureTransport": True, "aws:PrincipalAccount": ACCOUNT}, "tfstate_bucket_policy", "allowed"),
        ("NEG: deploy delete runtime.tfstate", "role_github_deploy", "s3:DeleteObject", f"{tf_b}/runtime/terraform.tfstate", {"aws:SecureTransport": True, "aws:PrincipalAccount": ACCOUNT}, "tfstate_bucket_policy", "explicitDeny"),
        ("NEG: tfstate HTTP SecureTransport=false", "role_github_deploy", "s3:GetObject", f"{tf_b}/foundation/terraform.tfstate", {"aws:SecureTransport": False, "aws:PrincipalAccount": ACCOUNT}, "tfstate_bucket_policy", "explicitDeny"),
        ("NEG: tfstate foreign PrincipalAccount", "role_github_deploy", "s3:GetObject", f"{tf_b}/foundation/terraform.tfstate", {"aws:SecureTransport": True, "aws:PrincipalAccount": "111122223333"}, "tfstate_bucket_policy", "explicitDeny"),
        ("recovery promote latest-valid.json pointer", "role_github_recovery", "s3:PutObject", f"{rc_b}/backups/postgres/latest-valid.json", {"aws:SecureTransport": True, "aws:PrincipalAccount": ACCOUNT}, "recovery_bucket_policy", "allowed"),
        ("NEG: recovery overwrite postgres archive dump", "role_github_recovery", "s3:PutObject", f"{rc_b}/backups/postgres/archive/x/database.dump", {"aws:SecureTransport": True, "aws:PrincipalAccount": ACCOUNT}, "recovery_bucket_policy", "explicitDeny"),
        ("NEG: recovery delete backup object", "role_github_recovery", "s3:DeleteObject", f"{rc_b}/backups/postgres/archive/x/database.dump", {"aws:SecureTransport": True, "aws:PrincipalAccount": ACCOUNT}, "recovery_bucket_policy", "explicitDeny"),
        ("NEG: release role write latest-known-good", "role_github_release", "s3:PutObject", f"{rc_b}/releases/latest-known-good.json", {}, None, "explicitDeny"),
        ("foundation_admin SSM seed (break-glass)", "role_foundation_admin", "ssm:PutParameter", f"arn:aws:ssm:{REGION}:{ACCOUNT}:parameter/envscale/prod/postgres_password", {}, None, "allowed"),
        ("foundation_admin kms:Encrypt via SSM", "role_foundation_admin", "kms:Encrypt", f"arn:aws:kms:{REGION}:{ACCOUNT}:key/11112222-3333-4444-5555-666677778888", {"kms:ViaService": f"ssm.{REGION}.amazonaws.com"}, None, "allowed"),
        ("NEG: foundation_admin kms:Decrypt w/o ViaService", "role_foundation_admin", "kms:Decrypt", f"arn:aws:kms:{REGION}:{ACCOUNT}:key/11112222-3333-4444-5555-666677778888", {}, None, "implicitDeny"),
        ("NEG: foundation_admin legacy vault overwrite", "role_foundation_admin", "s3:PutObject", f"{lg_b}/database/backup_20261023_005151.sql", {}, None, "explicitDeny"),
        ("foundation_admin CreatePolicyVersion boundary", "role_foundation_admin", "iam:CreatePolicyVersion", wb_arn, {}, None, "allowed"),
        ("foundation_admin PutBucketPolicy on tfstate", "role_foundation_admin", "s3:PutBucketPolicy", tf_b, {"aws:SecureTransport": True, "aws:PrincipalAccount": ACCOUNT, "aws:PrincipalArn": f"arn:aws:sts::{ACCOUNT}:assumed-role/envscale-foundation-admin-role/op"}, "tfstate_bucket_policy", "allowed"),
        ("NEG: tfstate DeleteBucketPolicy admin", "role_foundation_admin", "s3:DeleteBucketPolicy", tf_b, {"aws:SecureTransport": True, "aws:PrincipalAccount": ACCOUNT, "aws:PrincipalArn": f"arn:aws:sts::{ACCOUNT}:assumed-role/envscale-foundation-admin-role/op"}, "tfstate_bucket_policy", "explicitDeny"),
        ("NEG: deploy PutBucketPolicy on tfstate", "role_github_deploy", "s3:PutBucketPolicy", tf_b, {"aws:SecureTransport": True, "aws:PrincipalAccount": ACCOUNT, "aws:PrincipalArn": f"arn:aws:sts::{ACCOUNT}:assumed-role/envscale-github-deploy-role/gha"}, "tfstate_bucket_policy", "explicitDeny"),
        ("NEG: deploy PutBucketPolicy on recovery", "role_github_deploy", "s3:PutBucketPolicy", rc_b, {"aws:SecureTransport": True, "aws:PrincipalAccount": ACCOUNT, "aws:PrincipalArn": f"arn:aws:sts::{ACCOUNT}:assumed-role/envscale-github-deploy-role/gha"}, "recovery_bucket_policy", "explicitDeny"),
        ("NEG: recovery DeleteBucketPolicy recovery", "role_github_recovery", "s3:DeleteBucketPolicy", rc_b, {"aws:SecureTransport": True, "aws:PrincipalAccount": ACCOUNT, "aws:PrincipalArn": f"arn:aws:sts::{ACCOUNT}:assumed-role/envscale-github-recovery-role/gha"}, "recovery_bucket_policy", "explicitDeny"),
        ("foundation PutBucketPolicy on recovery", "role_github_foundation", "s3:PutBucketPolicy", rc_b, {"aws:SecureTransport": True, "aws:PrincipalAccount": ACCOUNT, "aws:PrincipalArn": f"arn:aws:sts::{ACCOUNT}:assumed-role/envscale-github-foundation-role/gha"}, "recovery_bucket_policy", "allowed"),
        ("bootstrap CreateRole foundation_admin (no MFA)", "foundation_iam_bootstrap", "iam:CreateRole", f"arn:aws:iam::{ACCOUNT}:role/envscale-foundation-admin-role", {}, None, "allowed"),
        ("bootstrap PutObject foundation.tfstate (no MFA)", "foundation_iam_bootstrap", "s3:PutObject", f"{tf_b}/foundation/terraform.tfstate", {}, None, "allowed"),
        ("NEG: bootstrap CreateRole rogue role", "foundation_iam_bootstrap", "iam:CreateRole", f"arn:aws:iam::{ACCOUNT}:role/envscale-github-deploy-role", {}, None, "implicitDeny"),
        ("NEG: bootstrap PutObject runtime.tfstate", "foundation_iam_bootstrap", "s3:PutObject", f"{tf_b}/runtime/terraform.tfstate", {}, None, "explicitDeny"),
        ("NEG: bootstrap s3:PutBucketPolicy tfstate", "foundation_iam_bootstrap", "s3:PutBucketPolicy", tf_b, {}, None, "explicitDeny"),
        ("NEG: bootstrap DeleteRole foundation_admin", "foundation_iam_bootstrap", "iam:DeleteRole", f"arn:aws:iam::{ACCOUNT}:role/envscale-foundation-admin-role", {}, None, "explicitDeny"),
    ]

    boundary_vectors = [
        # (label, pkey, pb_key, act, res, ctx, expected)
        ("NEG: boundary allow_all+day0 -> iam:CreateRole", "allow_all", "day0_bootstrap_boundary", "iam:CreateRole", f"arn:aws:iam::{ACCOUNT}:role/envscale-x", {}, "explicitDeny"),
        ("NEG: boundary allow_all+day0 -> s3:PutBucketPolicy", "allow_all", "day0_bootstrap_boundary", "s3:PutBucketPolicy", tf_b, {}, "explicitDeny"),
        ("NEG: boundary allow_all+day0 -> s3:DeleteBucket", "allow_all", "day0_bootstrap_boundary", "s3:DeleteBucket", tf_b, {}, "explicitDeny"),
        ("NEG: boundary allow_all+day0 -> s3:GetObject recovery", "allow_all", "day0_bootstrap_boundary", "s3:GetObject", f"{rc_b}/backups/postgres/latest-valid.json", {}, "explicitDeny"),
        ("boundary allow_all+init_seal -> s3:PutBucketPolicy", "allow_all", "day0_initial_seal_boundary", "s3:PutBucketPolicy", tf_b, {}, "allowed"),
        ("NEG: boundary allow_all+init_seal -> GetObject state", "allow_all", "day0_initial_seal_boundary", "s3:GetObject", f"{tf_b}/foundation/terraform.tfstate", {}, "explicitDeny"),
        ("NEG: boundary allow_all+init_seal -> PutObject state", "allow_all", "day0_initial_seal_boundary", "s3:PutObject", f"{tf_b}/foundation/terraform.tfstate", {}, "explicitDeny"),
        ("NEG: boundary allow_all+init_seal -> GetObject recovery", "allow_all", "day0_initial_seal_boundary", "s3:GetObject", f"{rc_b}/backups/postgres/latest-valid.json", {}, "explicitDeny"),
        ("NEG: boundary allow_all+init_seal -> iam:CreateRole", "allow_all", "day0_initial_seal_boundary", "iam:CreateRole", f"arn:aws:iam::{ACCOUNT}:role/envscale-x", {}, "explicitDeny"),
        ("NEG: boundary allow_all+init_seal -> s3:DeleteBucket", "allow_all", "day0_initial_seal_boundary", "s3:DeleteBucket", tf_b, {}, "explicitDeny"),
        ("NEG: boundary allow_all+workload -> iam:PutRolePolicy", "allow_all", "role_workload_permissions_boundary", "iam:PutRolePolicy", f"arn:aws:iam::{ACCOUNT}:role/envscale-github-deploy-role", {}, "explicitDeny"),
        ("NEG: boundary allow_all+workload -> s3:DeleteBucket", "allow_all", "role_workload_permissions_boundary", "s3:DeleteBucket", rc_b, {}, "explicitDeny"),
        ("NEG: boundary allow_all+workload -> s3:PutObject foundation", "allow_all", "role_workload_permissions_boundary", "s3:PutObject", f"{tf_b}/foundation/terraform.tfstate", {}, "explicitDeny"),
        ("boundary allow_all+workload -> PassRole ec2 to ec2", "allow_all", "role_workload_permissions_boundary", "iam:PassRole", f"arn:aws:iam::{ACCOUNT}:role/envscale-ec2-runtime-role", {"iam:PassedToService": "ec2.amazonaws.com"}, "allowed"),
        ("boundary allow_all+workload -> PassRole eks-cluster to eks", "allow_all", "role_workload_permissions_boundary", "iam:PassRole", f"arn:aws:iam::{ACCOUNT}:role/envscale-eks-cluster-main", {"iam:PassedToService": "eks.amazonaws.com"}, "allowed"),
        ("NEG: boundary allow_all+workload -> PassRole ec2 to lambda", "allow_all", "role_workload_permissions_boundary", "iam:PassRole", f"arn:aws:iam::{ACCOUNT}:role/envscale-ec2-runtime-role", {"iam:PassedToService": "lambda.amazonaws.com"}, "implicitDeny"),
        ("NEG: boundary allow_all+workload -> PassRole ec2 to eks", "allow_all", "role_workload_permissions_boundary", "iam:PassRole", f"arn:aws:iam::{ACCOUNT}:role/envscale-ec2-runtime-role", {"iam:PassedToService": "eks.amazonaws.com"}, "implicitDeny"),
        ("NEG: boundary allow_all+workload -> PassRole eks-cls to ec2", "allow_all", "role_workload_permissions_boundary", "iam:PassRole", f"arn:aws:iam::{ACCOUNT}:role/envscale-eks-cluster-main", {"iam:PassedToService": "ec2.amazonaws.com"}, "implicitDeny"),
        ("NEG: boundary allow_all+workload -> PassRole eks-node to eks", "allow_all", "role_workload_permissions_boundary", "iam:PassRole", f"arn:aws:iam::{ACCOUNT}:role/envscale-eks-node-group1", {"iam:PassedToService": "eks.amazonaws.com"}, "implicitDeny"),
        ("NEG: boundary allow_all+workload -> ec2 in us-east-1", "allow_all", "role_workload_permissions_boundary", "ec2:RunInstances", f"arn:aws:ec2:us-east-1:{ACCOUNT}:instance/*", {"aws:RequestedRegion": "us-east-1"}, "implicitDeny"),
        ("boundary allow_all+workload -> kms:Decrypt via SSM", "allow_all", "role_workload_permissions_boundary", "kms:Decrypt", f"arn:aws:kms:{REGION}:{ACCOUNT}:key/11112222-3333-4444-5555-666677778888", {"kms:ViaService": f"ssm.{REGION}.amazonaws.com"}, "allowed"),
        ("NEG: boundary allow_all+workload -> kms:Decrypt direct", "allow_all", "role_workload_permissions_boundary", "kms:Decrypt", f"arn:aws:kms:{REGION}:{ACCOUNT}:key/11112222-3333-4444-5555-666677778888", {}, "implicitDeny"),
    ]

    for lbl, tkey, ctx, exp in [
        ("trust_github_foundation OIDC exact env (no MFA)", "trust_github_foundation", {"token.actions.githubusercontent.com:aud": "sts.amazonaws.com", "token.actions.githubusercontent.com:sub": "repo:P20000/EnvScale:environment:foundation"}, "allowed"),
        ("NEG: trust_github_foundation wrong env", "trust_github_foundation", {"token.actions.githubusercontent.com:aud": "sts.amazonaws.com", "token.actions.githubusercontent.com:sub": "repo:P20000/EnvScale:environment:production"}, "implicitDeny"),
        ("trust_github_foundation_plan OIDC exact env", "trust_github_foundation_plan", {"token.actions.githubusercontent.com:aud": "sts.amazonaws.com", "token.actions.githubusercontent.com:sub": "repo:P20000/EnvScale:environment:foundation-plan"}, "allowed"),
        ("NEG: trust_github_foundation_plan wrong env", "trust_github_foundation_plan", {"token.actions.githubusercontent.com:aud": "sts.amazonaws.com", "token.actions.githubusercontent.com:sub": "repo:P20000/EnvScale:environment:foundation"}, "implicitDeny"),
        ("trust_foundation_admin AssumeRole WITH fresh MFA", "trust_foundation_admin", {"aws:MultiFactorAuthPresent": True, "aws:MultiFactorAuthAge": 60}, "allowed"),
        ("NEG: trust_foundation_admin AssumeRole WITHOUT MFA", "trust_foundation_admin", {}, "implicitDeny"),
        ("NEG: trust_foundation_admin STALE MFA (3601s)", "trust_foundation_admin", {"aws:MultiFactorAuthPresent": True, "aws:MultiFactorAuthAge": 3601}, "implicitDeny"),
    ]:
        act = "sts:AssumeRoleWithWebIdentity" if tkey.startswith("trust_github_") else "sts:AssumeRole"
        dec = sim.eval_iam_policy_local_harness(policies[tkey], act, f"arn:aws:iam::{ACCOUNT}:role/target", ctx)
        assert_true(dec == exp, f"{lbl}: got {dec}, expected {exp}")
        print(f"  [PASS] {lbl:<56} -> LocalHarness={dec}")

    for label, pkey, act, res, ctx, rp_key, expected in vectors:
        rp_doc = policies[rp_key] if rp_key else None
        pb_key = boundary_for_key.get(pkey)
        pb_doc = policies[pb_key] if pb_key else None
        aws_dec = sim.simulate_via_aws_iam(sim_policies[pkey], act, res, ctx, rp_doc, pb_doc)
        local_dec = sim.eval_iam_policy_local_harness(sim_policies[pkey], act, res, ctx, rp_doc, pb_doc)
        assert_true(aws_dec == expected, f"[AWS simulate-custom-policy] {label}: got {aws_dec}, expected {expected}")
        assert_true(local_dec == expected, f"[Local Harness] {label}: got {local_dec}, expected {expected}")
        print(f"  [PASS] {label:<56} -> AWS={aws_dec} | LocalHarness={local_dec}")

    for label, pkey, pb_key, act, res, ctx, expected in boundary_vectors:
        pb_doc = policies[pb_key]
        aws_dec = sim.simulate_via_aws_iam(sim_policies[pkey], act, res, ctx, None, pb_doc)
        local_dec = sim.eval_iam_policy_local_harness(sim_policies[pkey], act, res, ctx, None, pb_doc)
        assert_true(aws_dec == expected, f"[AWS simulate-custom-policy] {label}: got {aws_dec}, expected {expected}")
        assert_true(local_dec == expected, f"[Local Harness] {label}: got {local_dec}, expected {expected}")
        print(f"  [PASS] {label:<56} -> AWS={aws_dec} | LocalHarness={local_dec}")

    print("=== [4/6] Stateless AWS IAM Access Analyzer Policy Grammar Check ===")
    sim.run_access_analyzer_validation(policies)


def audit_github_environments_readonly(strict: bool = False) -> None:
    print("=== [5/6] Read-Only Audit of External GitHub Environments (`P20000/EnvScale`) ===")
    gaps: list[str] = []
    for req_env in ("foundation-plan", "foundation", "production", "recovery"):
        proc = subprocess.run(["gh", "api", f"repos/P20000/EnvScale/environments/{req_env}"], capture_output=True, text=True, check=False)
        if proc.returncode != 0:
            gaps.append(f"GitHub Environment '{req_env}' not yet created or unreachable ({proc.stderr.strip()})")
            continue
        try:
            env_obj = json.loads(proc.stdout)
        except json.JSONDecodeError as exc:
            gaps.append(f"GitHub Environment '{req_env}' returned invalid JSON: {exc}")
            continue
        branch_pol = env_obj.get("deployment_branch_policy")
        if not branch_pol or not branch_pol.get("custom_branch_policies"):
            gaps.append(f"GitHub Environment '{req_env}' should restrict deployments using custom_branch_policies")
            continue
        bp_proc = subprocess.run(["gh", "api", f"repos/P20000/EnvScale/environments/{req_env}/deployment-branch-policies"], capture_output=True, text=True, check=False)
        if bp_proc.returncode == 0:
            branch_list = [p.get("name") for p in json.loads(bp_proc.stdout).get("branch_policies", []) if isinstance(p, dict)]
            if branch_list != ["develop"]:
                gaps.append(f"GitHub Environment '{req_env}' branch policy should allow ['develop']; found {branch_list}")
    if gaps:
        for g in gaps:
            print(f"  [EXTERNAL-ENV-NOTICE] {g}")
        if strict:
            raise SystemExit("[FATAL] Strict GitHub Environment branch policy audit failed.")
    else:
        print("  [PASS] GitHub 'foundation-plan', 'foundation', 'production', and 'recovery' Environments configured with develop branch policies (no human reviewer deadlock)")


def test_legacy_preservation() -> None:
    print("=== [6/6] Legacy Terraform Directory Preservation Check ===")
    git_diff = subprocess.check_output(["git", "status", "--porcelain", "deployment/terraform"], cwd=REPO_ROOT, text=True).strip()
    assert_true(git_diff == "", f"Legacy deployment/terraform was modified: {git_diff}")
    assert_true((REPO_ROOT / "deployment/terraform/terraform.tfstate").is_file(), "Legacy local tfstate missing")
    print("  [PASS] Legacy deployment/terraform/ completely untouched")


def main() -> None:
    if "--audit-github-environments-strict" in sys.argv[1:]:
        audit_github_environments_readonly(strict=True)
        return
    test_timestamp_and_identity_gates()
    tfstate_pol = test_bootstrap_and_seed_scripts()
    test_live_aws_iam_simulation_and_analyzer(tfstate_pol)
    audit_github_environments_readonly(strict=False)
    test_legacy_preservation()
    print("=== ALL PHASE 3 STATIC, LIVE IAM SIMULATION, & BOOTSTRAP CHECKS PASSED ===")


if __name__ == "__main__":
    main()
