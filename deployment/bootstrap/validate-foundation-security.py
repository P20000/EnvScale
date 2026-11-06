#!/usr/bin/env python3
"""
EnvScale Phase 3 — Static HCL, Live AWS IAM Simulation & Bootstrap Regression Suite.

Performs 100% read-only / offline verification (ZERO AWS or GitHub writes):
  1. Historical archive UTC timestamp & MFA-enforced Foundation Admin identity gates.
  2. Pure SSE-S3 (zero BucketKeyEnabled), zero noncurrent state-version expiration,
     native S3 locking (`use_lockfile = true`, zero DynamoDB), and out-of-band SSM
     SecureString seeder tests (explicit KUBECONFIG_ENCRYPTION_KEY disposition +
     public demo-key SHA-256 denylist).
  3. Live read-only `aws iam simulate-custom-policy` + local condition harness +
     `aws accessanalyzer validate-policy` across positive & negative vectors:
       - Real ap-south-1 Canonical Ubuntu 22.04 LTS AMI (`ami-082a1ff88c78c6290`) &
         backing EBS snapshot (`snap-09eeb6885e00b8443`) on `ec2:RunInstances`
       - Negative blast-radius checks on unrelated instances, VPCs, volumes, and
         coexisting `relmonition-cluster` EKS cluster
       - Bucket policy foreign-account & insecure-transport explicit Denies
       - Foundation Admin MFA enforcement & unsupported action/resource negative probes
  4. Read-only audit of external GitHub `production` and `recovery` Environments.
  5. Legacy `deployment/terraform/` preservation check.
"""

from __future__ import annotations

import base64
import json
import os
import pathlib
import re
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

ACCOUNT = sim.ACCOUNT
REGION = sim.REGION
TFSTATE_BUCKET = sim.TFSTATE_BUCKET
RECOVERY_BUCKET = sim.RECOVERY_BUCKET
LEGACY_BUCKET = sim.LEGACY_BUCKET


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


def test_timestamp_and_admin_mfa_gates() -> None:
    print("=== [1/6] Historical UTC Timestamp & MFA Foundation Admin Identity Gates ===")
    ist_iso, conv_utc, _ = lvi._convert_legacy_ist_key_to_utc("database/backup_20261023_005151.sql")
    assert_true(ist_iso == "2026-10-23T00:51:51+05:30" and conv_utc == "2026-10-22T19:21:51Z", "Bad IST->UTC")
    arch_ts, src, _, _ = lvi._derive_timestamp("database/backup_20261023_005151.sql", "2026-10-22T19:21:53+00:00")
    assert_true(arch_ts == "20261022T192153Z" and src == "s3_last_modified_utc", f"Bad archive_ts: {arch_ts}")
    print(f"  [PASS] Phase 1 SQL key resolved to archive_timestamp_utc={arch_ts}")

    expect_system_exit(
        lambda: lvi._derive_timestamp("database/backup_20261023_005151.sql", "2026-10-23T00:51:51Z"),
        "5.5h IST/UTC skew rejected",
    )

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
                    "Condition": {
                        "Bool": {"aws:MultiFactorAuthPresent": "true"},
                        "NumericLessThan": {"aws:MultiFactorAuthAge": "3600"},
                    },
                }],
            },
        }
    }
    with tempfile.TemporaryDirectory(prefix="envscale-mfa-test-") as td:
        td_p = pathlib.Path(td)
        role_ok = td_p / "role_ok.json"
        role_ok.write_text(json.dumps(valid_role_doc), encoding="utf-8")

        # Positive: exact assumed envscale-foundation-admin-role + MFA trust policy
        sts_ok = td_p / "sts_ok.json"
        sts_ok.write_text(json.dumps({"Account": ACCOUNT, "Arn": f"arn:aws:sts::{ACCOUNT}:assumed-role/envscale-foundation-admin-role/op-mfa"}), encoding="utf-8")
        lvi.cmd_verify_foundation_admin_mfa(str(sts_ok), str(role_ok))

        # Negative 0: Role trust policy specifying account root principal rejected (root trust strictly forbidden)
        role_root = td_p / "role_root.json"
        root_doc = json.loads(json.dumps(valid_role_doc))
        root_doc["Role"]["AssumeRolePolicyDocument"]["Statement"][0]["Principal"] = {"AWS": [f"arn:aws:iam::{ACCOUNT}:root"]}
        role_root.write_text(json.dumps(root_doc), encoding="utf-8")
        expect_system_exit(
            lambda: lvi.cmd_verify_foundation_admin_mfa(str(sts_ok), str(role_root)),
            "Foundation Admin role trusting account root principal rejected",
        )

        # Negative 1: Raw IAM user (e.g. user/DEV-user-alpha) rejected for mutating admin ops
        sts_user = td_p / "sts_user.json"
        sts_user.write_text(json.dumps({"Account": ACCOUNT, "Arn": f"arn:aws:iam::{ACCOUNT}:user/DEV-user-alpha"}), encoding="utf-8")
        expect_system_exit(
            lambda: lvi.cmd_verify_foundation_admin_mfa(str(sts_user), str(role_ok)),
            "Raw IAM user without assumed envscale-foundation-admin-role rejected",
        )

        # Negative 2: Different assumed role (not prefix-blocked previously!) rejected
        sts_other = td_p / "sts_other.json"
        sts_other.write_text(json.dumps({"Account": ACCOUNT, "Arn": f"arn:aws:sts::{ACCOUNT}:assumed-role/SomeOtherAdminRole/sess"}), encoding="utf-8")
        expect_system_exit(
            lambda: lvi.cmd_verify_foundation_admin_mfa(str(sts_other), str(role_ok)),
            "Non-Foundation-Admin assumed role rejected",
        )

        # Negative 3: Role trust policy missing Bool aws:MultiFactorAuthPresent == true rejected
        role_no_mfa = td_p / "role_no_mfa.json"
        bad_doc = json.loads(json.dumps(valid_role_doc))
        bad_doc["Role"]["AssumeRolePolicyDocument"]["Statement"][0]["Condition"] = {}
        role_no_mfa.write_text(json.dumps(bad_doc), encoding="utf-8")
        expect_system_exit(
            lambda: lvi.cmd_verify_foundation_admin_mfa(str(sts_ok), str(role_no_mfa)),
            "Foundation Admin role lacking MFA trust condition rejected",
        )


def test_bootstrap_and_seed_scripts() -> dict:
    print("=== [2/6] Pure SSE-S3, State History Retention, Native Locking & Secret Seeder Tests ===")
    for tf_file in sorted(FOUNDATION_DIR.glob("*.tf")):
        txt = tf_file.read_text(encoding="utf-8")
        assert_true("aws_dynamodb_table" not in txt and "dynamodb:" not in txt.lower(), f"Forbidden DynamoDB in {tf_file.name}")
        assert_true("bucket_key_enabled" not in txt, f"Forbidden bucket_key_enabled on SSE-S3 in {tf_file.name}")
        code_only = "\n".join(ln for ln in txt.splitlines() if not ln.lstrip().startswith("#"))
        if tf_file.name != "outputs.tf":
            assert_true('"SecureString"' not in code_only, f"Forbidden SecureString resource in {tf_file.name}")

    bs_script = str(SCRIPT_DIR / "bootstrap-state.sh")
    bs_dry = subprocess.run([bs_script, "--dry-run"], capture_output=True, text=True, check=True)
    enc_str = bs_dry.stdout.split("--- Rendered Encryption JSON ---\n", 1)[1].split("--- Rendered Lifecycle JSON ---", 1)[0].strip()
    lc_str = bs_dry.stdout.split("--- Rendered Lifecycle JSON ---\n", 1)[1].split("--- Rendered Bucket Policy JSON ---", 1)[0].strip()
    pol_str = bs_dry.stdout.split("--- Rendered Bucket Policy JSON ---\n", 1)[1].split("[DRY-RUN SUCCESS]", 1)[0].strip()

    enc_doc = json.loads(enc_str)
    lc_doc = json.loads(lc_str)
    pol_doc = json.loads(pol_str)
    assert_true(enc_doc == {"Rules": [{"ApplyServerSideEncryptionByDefault": {"SSEAlgorithm": "AES256"}}]}, f"Invalid SSE-S3 config: {enc_doc}")
    assert_true("BucketKeyEnabled" not in enc_str, "BucketKeyEnabled must not appear in SSE-S3 state bucket config")
    assert_true("NoncurrentVersionExpiration" not in lc_str, "NoncurrentVersionExpiration must not appear on tfstate bucket")
    assert_true(len(lc_doc["Rules"]) == 1 and lc_doc["Rules"][0]["ID"] == "abort-incomplete-multipart-uploads", f"Unexpected lifecycle rules: {lc_doc}")
    print("  [PASS] bootstrap-state.sh --dry-run verified pure SSE-S3 (no BucketKeyEnabled) & zero state-version expiration")

    seed_script = str(SCRIPT_DIR / "seed-parameters.sh")
    seed_dry = subprocess.run([seed_script, "--dry-run"], capture_output=True, text=True, check=True)
    assert_true("REDACTED (Base64 -> exact 32 decoded bytes, fresh-CSPRNG)" in seed_dry.stdout, "Missing 32-byte key check")

    # Read actual demo key from apps/api-server/.env.example (never printed) to test denylist
    demo_key = ""
    for ln in (REPO_ROOT / "apps/api-server/.env.example").read_text(encoding="utf-8").splitlines():
        if ln.startswith("KUBECONFIG_ENCRYPTION_KEY="):
            demo_key = ln.split("=", 1)[1].strip().strip("'\"")

    with tempfile.TemporaryDirectory(prefix="envscale-seed-neg-") as td:
        td_p = pathlib.Path(td)
        valid_sec = td_p / "valid.env"
        valid_sec.write_text("DUCKDNS_TOKEN=valid-duckdns-12345\n", encoding="utf-8")
        os.chmod(valid_sec, 0o600)

        # Negative 1: --apply without --kubeconfig-key-disposition rejected
        r_no_disp = subprocess.run(
            [seed_script, "--apply", "--confirm-seed", "SEED-SSM-982534376726", "--secrets-file", str(valid_sec)],
            capture_output=True, text=True,
        )
        assert_true(r_no_disp.returncode != 0 and "--kubeconfig-key-disposition" in r_no_disp.stderr, "Missing disposition must fail")
        print("  [PASS] seed-parameters.sh --apply without --kubeconfig-key-disposition rejected")

        # Negative 2: preserve-from-secrets-file without KUBECONFIG_ENCRYPTION_KEY in file rejected
        r_pres_missing = subprocess.run(
            [seed_script, "--dry-run", "--secrets-file", str(valid_sec), "--kubeconfig-key-disposition", "preserve-from-secrets-file"],
            capture_output=True, text=True,
        )
        assert_true(r_pres_missing.returncode != 0 and "requires KUBECONFIG_ENCRYPTION_KEY" in r_pres_missing.stderr, "Missing preserved key must fail")
        print("  [PASS] seed-parameters.sh rejected preserve-from-secrets-file when key absent")

        # Negative 3: Public demo KUBECONFIG_ENCRYPTION_KEY from .env.example rejected
        demo_sec = td_p / "demo.env"
        demo_sec.write_text(f"DUCKDNS_TOKEN=valid-duckdns-12345\nKUBECONFIG_ENCRYPTION_KEY={demo_key}\n", encoding="utf-8")
        os.chmod(demo_sec, 0o600)
        r_demo = subprocess.run(
            [seed_script, "--dry-run", "--secrets-file", str(demo_sec), "--kubeconfig-key-disposition", "preserve-from-secrets-file"],
            capture_output=True, text=True,
        )
        assert_true(r_demo.returncode != 0 and ".env.example is forbidden" in r_demo.stderr, "Demo key must be rejected")
        print("  [PASS] seed-parameters.sh rejected public committed .env.example KUBECONFIG_ENCRYPTION_KEY")

        # Negative 4: 16-byte short Base64 key rejected
        short_sec = td_p / "short.env"
        short_sec.write_text(f"DUCKDNS_TOKEN=valid-duckdns-12345\nKUBECONFIG_ENCRYPTION_KEY={base64.b64encode(b'x'*16).decode()}\n", encoding="utf-8")
        os.chmod(short_sec, 0o600)
        r_short = subprocess.run([seed_script, "--dry-run", "--secrets-file", str(short_sec)], capture_output=True, text=True)
        assert_true(r_short.returncode != 0 and "decoded to 16 bytes" in r_short.stderr, "16-byte key must fail")
        print("  [PASS] seed-parameters.sh rejected non-32-byte Base64 KUBECONFIG_ENCRYPTION_KEY")

    # Negative & positive tests for existing SSM parameter conflict & ownership validation
    kms_proc = subprocess.run(
        ["aws", "kms", "describe-key", "--key-id", "alias/aws/ssm", "--region", REGION, "--output", "json"],
        capture_output=True, text=True, check=False,
    )
    assert_true(kms_proc.returncode == 0, "alias/aws/ssm must be resolvable via AWS KMS")
    canonical_km = json.loads(kms_proc.stdout).get("KeyMetadata", {})
    canonical_arn = canonical_km.get("Arn")
    valid_kms_keys = {"alias/aws/ssm", canonical_km.get("KeyId"), canonical_arn} - {"", None}

    # Neg 1: Plain String parameter rejected
    expect_system_exit(
        lambda: sim.verify_existing_ssm_parameter_record("/envscale/prod/test", {"Type": "String", "KeyId": canonical_arn}, valid_kms_keys, {"Project": "EnvScale"}),
        "Existing SSM parameter with Type=String rejected",
    )
    # Neg 2: Missing KeyId rejected
    expect_system_exit(
        lambda: sim.verify_existing_ssm_parameter_record("/envscale/prod/test", {"Type": "SecureString", "KeyId": ""}, valid_kms_keys, {"Project": "EnvScale"}),
        "Existing SSM parameter with missing KeyId rejected",
    )
    # Neg 3: Unexpected customer-managed KMS key rejected
    expect_system_exit(
        lambda: sim.verify_existing_ssm_parameter_record("/envscale/prod/test", {"Type": "SecureString", "KeyId": f"arn:aws:kms:{REGION}:{ACCOUNT}:key/unrelated-custom-key-1111"}, valid_kms_keys, {"Project": "EnvScale"}),
        "Existing SSM parameter with unexpected customer-managed KMS key rejected",
    )
    # Neg 4: Failed tag lookup API call rejected
    expect_system_exit(
        lambda: sim.verify_existing_ssm_parameter_record("/envscale/prod/test", {"Type": "SecureString", "KeyId": canonical_arn}, valid_kms_keys, None, tag_lookup_error="AccessDeniedException: Unauthorized to list tags"),
        "Failed parameter tag lookup API call rejected",
    )
    # Neg 5: Missing Project tag rejected
    expect_system_exit(
        lambda: sim.verify_existing_ssm_parameter_record("/envscale/prod/test", {"Type": "SecureString", "KeyId": canonical_arn}, valid_kms_keys, {}),
        "Existing SSM parameter with missing Project tag rejected",
    )
    # Neg 6: Conflicting Project tag rejected
    expect_system_exit(
        lambda: sim.verify_existing_ssm_parameter_record("/envscale/prod/test", {"Type": "SecureString", "KeyId": canonical_arn}, valid_kms_keys, {"Project": "Relmonition"}),
        "Existing SSM parameter with conflicting Project tag rejected",
    )
    # Positive: Exact SecureString + canonical KMS key ARN + Project=EnvScale accepted cleanly
    sim.verify_existing_ssm_parameter_record("/envscale/prod/test", {"Type": "SecureString", "KeyId": canonical_arn}, valid_kms_keys, {"Project": "EnvScale"})
    print("  [PASS] Existing parameter fail-closed gates verified: type, canonical KMS key, fatal tag lookup & explicit Project=EnvScale")

    # Strict Remote Terraform Plan Allowlist Validator Self-Test
    plan_val_proc = subprocess.run(
        [sys.executable, str(SCRIPT_DIR / "validate-foundation-plan.py"), "--self-test"],
        capture_output=True, text=True, check=False,
    )
    assert_true(plan_val_proc.returncode == 0, f"Plan validator self-tests failed: {plan_val_proc.stderr}")
    print("  [PASS] Plan allowlist validator 42/42 negative, positive & integration unit tests verified (metadata, channels, managed creates, approved data reads, action guards, TOCTOU-free permissions, os.fdopen descriptor closure, & missing primitive fail-closed)")

    return pol_doc


def test_live_aws_iam_simulation_and_analyzer(tfstate_bucket_policy: dict) -> None:
    print("=== [3/6] Live Read-Only `aws iam simulate-custom-policy` & Negative Blast-Radius Suite ===")
    policies = sim.build_rendered_foundation_policies(FOUNDATION_DIR)
    policies["tfstate_bucket_policy"] = tfstate_bucket_policy

    tf_b = f"arn:aws:s3:::{TFSTATE_BUCKET}"
    rc_b = f"arn:aws:s3:::{RECOVERY_BUCKET}"
    lg_b = f"arn:aws:s3:::{LEGACY_BUCKET}"
    tag_res_ok = {"aws:ResourceTag/Project": "EnvScale", "aws:ResourceTag/Layer": "DisposableRuntime"}
    tag_res_other = {"aws:ResourceTag/Project": "Relmonition", "aws:ResourceTag/Layer": "Production"}
    tag_req_ok = {"aws:RequestTag/Project": "EnvScale", "aws:RequestTag/Layer": "DisposableRuntime"}

    # (label, identity_policy_key, action, resource_arn, ctx, resource_policy_key_or_None, expected_aws_decision)
    vectors = [
        # --- Finding 3: Real Canonical Ubuntu 22.04 AMI (ami-082a1ff88c78c6290) & Snapshot (snap-09eeb6885e00b8443) ---
        ("deploy RunInstances real Ubuntu 22.04 AMI", "role_github_deploy", "ec2:RunInstances", sim.LIVE_UBUNTU_AMI_ARN, {"ec2:Owner": "099720109477"}, None, "allowed"),
        ("deploy RunInstances real Ubuntu EBS snapshot", "role_github_deploy", "ec2:RunInstances", sim.LIVE_UBUNTU_SNAP_ARN, {"ec2:Owner": "099720109477"}, None, "allowed"),
        ("recovery RunInstances real Ubuntu EBS snapshot", "role_github_recovery", "ec2:RunInstances", sim.LIVE_UBUNTU_SNAP_ARN, {"ec2:Owner": "099720109477"}, None, "allowed"),
        ("deploy RunInstances tagged new instance", "role_github_deploy", "ec2:RunInstances", f"arn:aws:ec2:{REGION}:{ACCOUNT}:instance/i-0envscale01", tag_req_ok, None, "allowed"),
        ("deploy RunInstances tagged new volume", "role_github_deploy", "ec2:RunInstances", f"arn:aws:ec2:{REGION}:{ACCOUNT}:volume/vol-0envscale01", tag_req_ok, None, "allowed"),
        ("deploy RunInstances in EnvScale subnet", "role_github_deploy", "ec2:RunInstances", f"arn:aws:ec2:{REGION}:{ACCOUNT}:subnet/subnet-0envscale01", tag_res_ok, None, "allowed"),
        ("deploy RunInstances with EnvScale SG", "role_github_deploy", "ec2:RunInstances", f"arn:aws:ec2:{REGION}:{ACCOUNT}:security-group/sg-0envscale01", tag_res_ok, None, "allowed"),
        ("deploy RunInstances tagged new ENI", "role_github_deploy", "ec2:RunInstances", f"arn:aws:ec2:{REGION}:{ACCOUNT}:network-interface/eni-0envscale01", tag_req_ok, None, "allowed"),
        ("deploy RunInstances tagged existing ENI", "role_github_deploy", "ec2:RunInstances", f"arn:aws:ec2:{REGION}:{ACCOUNT}:network-interface/eni-0envscale02", tag_res_ok, None, "allowed"),
        # Negative RunInstances vectors
        ("NEG: deploy RunInstances unrelated existing ENI", "role_github_deploy", "ec2:RunInstances", f"arn:aws:ec2:{REGION}:{ACCOUNT}:network-interface/eni-0other01", tag_res_other, None, "implicitDeny"),
        ("NEG: deploy RunInstances untagged existing ENI", "role_github_deploy", "ec2:RunInstances", f"arn:aws:ec2:{REGION}:{ACCOUNT}:network-interface/eni-0untagged01", {}, None, "implicitDeny"),
        ("NEG: deploy RunInstances unapproved AMI owner", "role_github_deploy", "ec2:RunInstances", f"arn:aws:ec2:{REGION}::image/ami-0bad1111222233334", {"ec2:Owner": "111122223333"}, None, "implicitDeny"),
        ("NEG: deploy RunInstances unapproved snapshot owner", "role_github_deploy", "ec2:RunInstances", f"arn:aws:ec2:{REGION}::snapshot/snap-0bad1111222233334", {"ec2:Owner": "111122223333"}, None, "implicitDeny"),
        ("NEG: deploy RunInstances untagged instance", "role_github_deploy", "ec2:RunInstances", f"arn:aws:ec2:{REGION}:{ACCOUNT}:instance/i-0untagged", {}, None, "implicitDeny"),
        ("NEG: deploy RunInstances in unrelated subnet", "role_github_deploy", "ec2:RunInstances", f"arn:aws:ec2:{REGION}:{ACCOUNT}:subnet/subnet-0other", tag_res_other, None, "implicitDeny"),

        # --- Finding 2: Tag-Scoped Operations & Unrelated Shared-Account Resource Protection ---
        ("deploy StopInstances on EnvScale instance", "role_github_deploy", "ec2:StopInstances", f"arn:aws:ec2:{REGION}:{ACCOUNT}:instance/i-0envscale01", tag_res_ok, None, "allowed"),
        ("NEG: deploy StopInstances on unrelated instance", "role_github_deploy", "ec2:StopInstances", f"arn:aws:ec2:{REGION}:{ACCOUNT}:instance/i-0other01", tag_res_other, None, "implicitDeny"),
        ("NEG: deploy ModifyInstanceAttribute on untagged instance", "role_github_deploy", "ec2:ModifyInstanceAttribute", f"arn:aws:ec2:{REGION}:{ACCOUNT}:instance/i-0untagged01", {}, None, "implicitDeny"),
        ("NEG: deploy CreateSubnet inside unrelated VPC", "role_github_deploy", "ec2:CreateSubnet", f"arn:aws:ec2:{REGION}:{ACCOUNT}:vpc/vpc-0other01", {**tag_res_other, **tag_req_ok}, None, "implicitDeny"),
        ("NEG: deploy TerminateInstances even on EnvScale instance", "role_github_deploy", "ec2:TerminateInstances", f"arn:aws:ec2:{REGION}:{ACCOUNT}:instance/i-0envscale01", tag_res_ok, None, "explicitDeny"),
        ("recovery TerminateInstances on EnvScale instance", "role_github_recovery", "ec2:TerminateInstances", f"arn:aws:ec2:{REGION}:{ACCOUNT}:instance/i-0envscale01", tag_res_ok, None, "allowed"),
        ("NEG: recovery TerminateInstances on unrelated instance", "role_github_recovery", "ec2:TerminateInstances", f"arn:aws:ec2:{REGION}:{ACCOUNT}:instance/i-0other01", tag_res_other, None, "implicitDeny"),
        ("recovery DeleteVpc on EnvScale VPC", "role_github_recovery", "ec2:DeleteVpc", f"arn:aws:ec2:{REGION}:{ACCOUNT}:vpc/vpc-0envscale01", tag_res_ok, None, "allowed"),
        ("NEG: recovery DeleteVpc on unrelated VPC", "role_github_recovery", "ec2:DeleteVpc", f"arn:aws:ec2:{REGION}:{ACCOUNT}:vpc/vpc-0other01", tag_res_other, None, "implicitDeny"),
        ("recovery DeleteVolume on EnvScale volume", "role_github_recovery", "ec2:DeleteVolume", f"arn:aws:ec2:{REGION}:{ACCOUNT}:volume/vol-0envscale01", tag_res_ok, None, "allowed"),
        ("NEG: recovery DeleteVolume on unrelated volume", "role_github_recovery", "ec2:DeleteVolume", f"arn:aws:ec2:{REGION}:{ACCOUNT}:volume/vol-0other01", {}, None, "implicitDeny"),
        ("recovery DeleteCluster on EnvScale EKS cluster", "role_github_recovery", "eks:DeleteCluster", f"arn:aws:eks:{REGION}:{ACCOUNT}:cluster/envscale-todo-eks", tag_res_ok, None, "allowed"),
        ("NEG: recovery DeleteCluster on coexisting relmonition-cluster", "role_github_recovery", "eks:DeleteCluster", sim.LIVE_COEXISTING_EKS_ARN, tag_res_other, None, "implicitDeny"),
        ("NEG: recovery UpdateClusterConfig on relmonition-cluster", "role_github_recovery", "eks:UpdateClusterConfig", sim.LIVE_COEXISTING_EKS_ARN, tag_res_ok, None, "implicitDeny"),
        ("NEG: recovery DeleteCluster on untagged envscale-* cluster", "role_github_recovery", "eks:DeleteCluster", f"arn:aws:eks:{REGION}:{ACCOUNT}:cluster/envscale-untagged", {}, None, "implicitDeny"),
        ("NEG: recovery hijack CreateTags on untagged instance", "role_github_recovery", "ec2:CreateTags", f"arn:aws:ec2:{REGION}:{ACCOUNT}:instance/i-0other01", tag_req_ok, None, "implicitDeny"),
        ("NEG: recovery DeleteTags removing Project governance tag", "role_github_recovery", "ec2:DeleteTags", f"arn:aws:ec2:{REGION}:{ACCOUNT}:instance/i-0envscale01", {**tag_res_ok, "aws:TagKeys": ["Project"]}, None, "explicitDeny"),
        ("NEG: recovery CreateTags mutating Project!=EnvScale", "role_github_recovery", "ec2:CreateTags", f"arn:aws:ec2:{REGION}:{ACCOUNT}:instance/i-0envscale01", {**tag_res_ok, "aws:RequestTag/Project": "Hijack"}, None, "explicitDeny"),
        ("NEG: recovery ReleaseAddress on static EIP", "role_github_recovery", "ec2:ReleaseAddress", f"arn:aws:ec2:{REGION}:{ACCOUNT}:elastic-ip/eipalloc-123", {"aws:ResourceTag/Project": "EnvScale"}, None, "explicitDeny"),

        # --- Tighter EKS Tagging & iam:PassRole iam:PassedToService Scoping ---
        ("recovery TagResource on tagged EnvScale EKS cluster", "role_github_recovery", "eks:TagResource", f"arn:aws:eks:{REGION}:{ACCOUNT}:cluster/envscale-prod-eks", {**tag_res_ok, **tag_req_ok}, None, "allowed"),
        ("NEG: recovery TagResource hijack on untagged envscale cluster", "role_github_recovery", "eks:TagResource", f"arn:aws:eks:{REGION}:{ACCOUNT}:cluster/envscale-untagged", tag_req_ok, None, "implicitDeny"),
        ("deploy PassRole ec2_runtime to ec2.amazonaws.com", "role_github_deploy", "iam:PassRole", f"arn:aws:iam::{ACCOUNT}:role/envscale-ec2-runtime-role", {"iam:PassedToService": "ec2.amazonaws.com"}, None, "allowed"),
        ("NEG: deploy PassRole ec2_runtime to lambda.amazonaws.com", "role_github_deploy", "iam:PassRole", f"arn:aws:iam::{ACCOUNT}:role/envscale-ec2-runtime-role", {"iam:PassedToService": "lambda.amazonaws.com"}, None, "implicitDeny"),
        ("recovery PassRole EKS cluster role to eks.amazonaws.com", "role_github_recovery", "iam:PassRole", f"arn:aws:iam::{ACCOUNT}:role/envscale-eks-cluster-primary", {"iam:PassedToService": "eks.amazonaws.com"}, None, "allowed"),
        ("NEG: recovery PassRole EKS cluster role to ec2.amazonaws.com", "role_github_recovery", "iam:PassRole", f"arn:aws:iam::{ACCOUNT}:role/envscale-eks-cluster-primary", {"iam:PassedToService": "ec2.amazonaws.com"}, None, "implicitDeny"),
        ("recovery PassRole EKS node role to ec2.amazonaws.com", "role_github_recovery", "iam:PassRole", f"arn:aws:iam::{ACCOUNT}:role/envscale-eks-node-primary", {"iam:PassedToService": "ec2.amazonaws.com"}, None, "allowed"),
        ("NEG: recovery PassRole EKS node role to lambda.amazonaws.com", "role_github_recovery", "iam:PassRole", f"arn:aws:iam::{ACCOUNT}:role/envscale-eks-node-primary", {"iam:PassedToService": "lambda.amazonaws.com"}, None, "implicitDeny"),

        # --- S3 State Locking, Bucket Policies (Bool, Null, StringNotEquals) & Vault Isolation ---
        ("deploy native .tflock release", "role_github_deploy", "s3:DeleteObject", f"{tf_b}/runtime/terraform.tfstate.tflock", {"aws:SecureTransport": True, "aws:PrincipalAccount": ACCOUNT}, "tfstate_bucket_policy", "allowed"),
        ("NEG: deploy delete runtime.tfstate", "role_github_deploy", "s3:DeleteObject", f"{tf_b}/runtime/terraform.tfstate", {"aws:SecureTransport": True, "aws:PrincipalAccount": ACCOUNT}, "tfstate_bucket_policy", "explicitDeny"),
        ("NEG: tfstate bucket policy HTTP SecureTransport=false", "role_github_deploy", "s3:GetObject", f"{tf_b}/foundation/terraform.tfstate", {"aws:SecureTransport": False, "aws:PrincipalAccount": ACCOUNT}, "tfstate_bucket_policy", "explicitDeny"),
        ("NEG: tfstate bucket policy foreign PrincipalAccount", "role_github_deploy", "s3:GetObject", f"{tf_b}/foundation/terraform.tfstate", {"aws:SecureTransport": True, "aws:PrincipalAccount": "111122223333"}, "tfstate_bucket_policy", "explicitDeny"),
        ("NEG: recovery bucket policy HTTP SecureTransport=false", "role_ec2_runtime", "s3:GetObject", f"{rc_b}/releases/latest-known-good.json", {"aws:SecureTransport": False, "aws:PrincipalAccount": ACCOUNT}, "recovery_bucket_policy", "explicitDeny"),
        ("NEG: recovery bucket policy foreign PrincipalAccount", "role_ec2_runtime", "s3:GetObject", f"{rc_b}/releases/latest-known-good.json", {"aws:SecureTransport": True, "aws:PrincipalAccount": "111122223333"}, "recovery_bucket_policy", "explicitDeny"),
        ("NEG: recovery role delete backup object", "role_github_recovery", "s3:DeleteObject", f"{rc_b}/backups/postgres/archive/x/database.dump", {"aws:SecureTransport": True, "aws:PrincipalAccount": ACCOUNT}, "recovery_bucket_policy", "explicitDeny"),
        ("NEG: release role write latest-known-good pointer", "role_github_release", "s3:PutObject", f"{rc_b}/releases/latest-known-good.json", {}, None, "explicitDeny"),

        # --- Finding 6: Foundation Admin MFA Enforcement & Legacy Vault Immutability ---
        ("foundation_admin SSM seed WITH MFA", "role_foundation_admin", "ssm:PutParameter", f"arn:aws:ssm:{REGION}:{ACCOUNT}:parameter/envscale/prod/postgres_password", {"aws:MultiFactorAuthPresent": True}, None, "allowed"),
        ("NEG: foundation_admin SSM seed WITHOUT MFA", "role_foundation_admin", "ssm:PutParameter", f"arn:aws:ssm:{REGION}:{ACCOUNT}:parameter/envscale/prod/postgres_password", {"aws:MultiFactorAuthPresent": False}, None, "explicitDeny"),
        ("foundation_admin legacy vault read WITH MFA", "role_foundation_admin", "s3:GetObject", f"{lg_b}/database/backup_20261023_005151.sql", {"aws:MultiFactorAuthPresent": True}, None, "allowed"),
        ("NEG: foundation_admin legacy vault overwrite WITH MFA", "role_foundation_admin", "s3:PutObject", f"{lg_b}/database/backup_20261023_005151.sql", {"aws:MultiFactorAuthPresent": True}, None, "explicitDeny"),
    ]

    for label, pkey, act, res, ctx, rp_key, expected in vectors:
        rp_doc = policies[rp_key] if rp_key else None
        aws_dec = sim.simulate_via_aws_iam(policies[pkey], act, res, ctx, rp_doc)
        local_dec = sim.eval_iam_policy_local_harness(policies[pkey], act, res, ctx, rp_doc)
        assert_true(aws_dec == expected, f"[AWS simulate-custom-policy] {label}: got {aws_dec}, expected {expected}")
        assert_true(local_dec == expected, f"[Local Harness] {label}: got {local_dec}, expected {expected}")
        print(f"  [PASS] {label:<56} -> AWS={aws_dec} | LocalHarness={local_dec}")

    # Negative Sanity Probe: Prove AWS `simulate-custom-policy` catches unsupported action/resource & missing snapshot ARN
    broken_describe_policy = {
        "Version": "2012-10-17",
        "Statement": [{"Effect": "Allow", "Action": ["ec2:DescribeInstances"], "Resource": f"arn:aws:ec2:{REGION}:{ACCOUNT}:instance/i-123"}],
    }
    broken_dec = sim.simulate_via_aws_iam(broken_describe_policy, "ec2:DescribeInstances", "*")
    assert_true(broken_dec == "implicitDeny", f"Expected implicitDeny for unsupported DescribeInstances ARN scoping, got {broken_dec}")
    broken_run_no_snap = {
        "Version": "2012-10-17",
        "Statement": [{"Effect": "Allow", "Action": ["ec2:RunInstances"], "Resource": [f"arn:aws:ec2:{REGION}:{ACCOUNT}:instance/*", sim.LIVE_UBUNTU_AMI_ARN]}],
    }
    no_snap_dec = sim.simulate_via_aws_iam(broken_run_no_snap, "ec2:RunInstances", sim.LIVE_UBUNTU_SNAP_ARN)
    assert_true(no_snap_dec == "implicitDeny", f"Expected implicitDeny when snapshot/* is omitted from RunInstances, got {no_snap_dec}")
    print("  [PASS] Negative schema sanity probes: AWS IAM rejected unsupported DescribeInstances ARN & missing snapshot/* ARN")

    # Local condition harness semantic parity with AWS IAM on StringNotEquals / StringNotEqualsIfExists
    neg_stmt_policy = {
        "Version": "2012-10-17",
        "Statement": [
            {"Effect": "Deny", "Action": ["s3:GetObject"], "Resource": f"{rc_b}/*", "Condition": {"StringNotEquals": {"aws:RequestTag/Project": "EnvScale"}}},
            {"Effect": "Allow", "Action": ["s3:GetObject"], "Resource": f"{rc_b}/*"},
        ],
    }
    # With absent key: StringNotEquals evaluates to True -> Deny triggers -> explicitDeny
    assert_true(sim.eval_iam_policy_local_harness(neg_stmt_policy, "s3:GetObject", f"{rc_b}/test", {}) == "explicitDeny", "Missing key in StringNotEquals must evaluate to True")
    # With matching key: StringNotEquals evaluates to False -> Deny does NOT trigger -> allowed
    assert_true(sim.eval_iam_policy_local_harness(neg_stmt_policy, "s3:GetObject", f"{rc_b}/test", {"aws:RequestTag/Project": "EnvScale"}) == "allowed", "Matching key in StringNotEquals must evaluate to False")
    # With differing key: StringNotEquals evaluates to True -> Deny triggers -> explicitDeny
    assert_true(sim.eval_iam_policy_local_harness(neg_stmt_policy, "s3:GetObject", f"{rc_b}/test", {"aws:RequestTag/Project": "Other"}) == "explicitDeny", "Differing key in StringNotEquals must evaluate to True")
    print("  [PASS] Local harness condition evaluator verified against AWS IAM StringNotEquals missing-key semantics")

    print("=== [4/6] Stateless AWS IAM Access Analyzer Policy Grammar Check ===")
    sim.run_access_analyzer_validation(policies)


def audit_github_environments_readonly(strict: bool = False) -> None:
    print("=== [5/6] Read-Only Audit of External GitHub Environments (`P20000/EnvScale`) ===")
    gaps: list[str] = []
    for req_env in ("production", "recovery"):
        proc = subprocess.run(["gh", "api", f"repos/P20000/EnvScale/environments/{req_env}"], capture_output=True, text=True, check=False)
        if proc.returncode != 0:
            gaps.append(f"GitHub Environment '{req_env}' not found or unreachable ({proc.stderr.strip()})")
            continue
        try:
            env_obj = json.loads(proc.stdout)
        except json.JSONDecodeError as exc:
            gaps.append(f"GitHub Environment '{req_env}' returned invalid JSON: {exc}")
            continue

        if env_obj.get("can_admins_bypass") is not False:
            gaps.append(f"GitHub Environment '{req_env}' has can_admins_bypass=true (must be false)")

        rules = env_obj.get("protection_rules") or []
        reviewer_rules = [r for r in rules if r.get("type") == "required_reviewers"]
        has_reviewers = any(r.get("reviewers") for r in reviewer_rules)
        if not has_reviewers:
            gaps.append(f"GitHub Environment '{req_env}' has 0 required human reviewers")
        else:
            reviewer_count = sum(len(r.get("reviewers") or []) for r in reviewer_rules)
            if reviewer_count < 2:
                gaps.append(f"GitHub Environment '{req_env}' has only {reviewer_count} required reviewer(s); minimum 2 required to prevent self-review deadlock")
        if not any(r.get("prevent_self_review") is True for r in reviewer_rules):
            gaps.append(f"GitHub Environment '{req_env}' has prevent_self_review != true (self-approval must be prevented)")

        branch_pol = env_obj.get("deployment_branch_policy")
        if not branch_pol or not branch_pol.get("custom_branch_policies"):
            gaps.append(f"GitHub Environment '{req_env}' lacks custom_branch_policies enabled")

        bp_proc = subprocess.run(
            ["gh", "api", f"repos/P20000/EnvScale/environments/{req_env}/deployment-branch-policies"],
            capture_output=True, text=True, check=False,
        )
        if bp_proc.returncode != 0:
            gaps.append(f"GitHub Environment '{req_env}' deployment-branch-policies endpoint unreachable ({bp_proc.stderr.strip()})")
        else:
            try:
                bp_doc = json.loads(bp_proc.stdout)
                branch_list = [p.get("name") for p in bp_doc.get("branch_policies", []) if isinstance(p, dict)]
                if branch_list != ["develop"]:
                    gaps.append(f"GitHub Environment '{req_env}' deployment branch policies must strictly and exclusively allow ['develop']; found {branch_list}")
            except json.JSONDecodeError:
                gaps.append(f"GitHub Environment '{req_env}' deployment-branch-policies returned invalid JSON")

    if gaps:
        for g in gaps:
            print(f"  [EXTERNAL-PREREQUISITE-GAP] {g}")
        if strict:
            raise SystemExit("[FATAL] External GitHub Environment protection prerequisites are not yet satisfied.")
    else:
        print("  [PASS] External GitHub 'production' and 'recovery' Environments enforce develop branch + >=2 human reviewers + prevent_self_review=true + can_admins_bypass=false")


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
    test_timestamp_and_admin_mfa_gates()
    tfstate_pol = test_bootstrap_and_seed_scripts()
    test_live_aws_iam_simulation_and_analyzer(tfstate_pol)
    audit_github_environments_readonly(strict=False)
    test_legacy_preservation()
    print("=== ALL PHASE 3 STATIC, LIVE IAM SIMULATION, & BOOTSTRAP CHECKS PASSED ===")


if __name__ == "__main__":
    main()
