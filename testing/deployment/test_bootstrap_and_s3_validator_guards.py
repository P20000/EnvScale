#!/usr/bin/env python3
"""Regression tests for Runtime Provisioner boundary bootstrap permissions and Day-1+ S3 bucket policy SID checks."""

from __future__ import annotations

import importlib.util
import json
import os
import pathlib
import sys
import tempfile
import unittest
from unittest import mock

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
BOOTSTRAP_DIR = REPO_ROOT / "deployment" / "bootstrap"
FOUNDATION_DIR = REPO_ROOT / "deployment" / "foundation"
if str(BOOTSTRAP_DIR) not in sys.path:
    sys.path.insert(0, str(BOOTSTRAP_DIR))

import day0_bucket_bootstrap  # noqa: E402
import iam_policy_simulator as sim  # noqa: E402
import plan_iam_safety  # noqa: E402

ACCOUNT = "982534376726"
TFSTATE_BUCKET = f"envscale-tfstate-{ACCOUNT}-ap-south-1"
TFSTATE_ARN = f"arn:aws:s3:::{TFSTATE_BUCKET}"
RECOVERY_BUCKET = f"envscale-recovery-{ACCOUNT}-ap-south-1"
LEGACY_BUCKET = f"envscale-cloud-vault-{ACCOUNT}-ap-south-1"
BOOTSTRAP_POL_PATH = BOOTSTRAP_DIR / "foundation-iam-bootstrap-policy.json"
VALIDATOR_PATH = BOOTSTRAP_DIR / "validate-foundation-plan.py"
WORKLOAD_BOUNDARY_ARN = f"arn:aws:iam::{ACCOUNT}:policy/envscale-workload-permissions-boundary"
RUNTIME_PROVISIONER_BOUNDARY_ARN = f"arn:aws:iam::{ACCOUNT}:policy/envscale-runtime-provisioner-permissions-boundary"

BOUNDARY_LIFECYCLE_ACTIONS = (
    "iam:GetPolicy",
    "iam:GetPolicyVersion",
    "iam:ListPolicyVersions",
    "iam:ListPolicyTags",
    "iam:ListEntitiesForPolicy",
    "iam:CreatePolicy",
    "iam:CreatePolicyVersion",
    "iam:DeletePolicyVersion",
    "iam:SetDefaultPolicyVersion",
    "iam:TagPolicy",
)


def _load_validator():
    spec = importlib.util.spec_from_file_location("validate_foundation_plan_mod", VALIDATOR_PATH)
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class TestBootstrapAndS3ValidatorGuards(unittest.TestCase):
    """Verify bootstrap boundary lifecycle scoping and recovery bucket policy SID validation."""

    def test_bootstrap_policy_permits_runtime_provisioner_boundary_lifecycle_and_preserves_guardrails(self):
        bootstrap_doc = plan_iam_safety.validate_foundation_iam_bootstrap_policy(BOOTSTRAP_POL_PATH)

        for target_arn in (WORKLOAD_BOUNDARY_ARN, RUNTIME_PROVISIONER_BOUNDARY_ARN):
            for action in BOUNDARY_LIFECYCLE_ACTIONS:
                with self.subTest(target=target_arn, action=action):
                    self.assertEqual(
                        sim.eval_iam_policy_local_harness(bootstrap_doc, action, target_arn, {}),
                        "allowed",
                    )

        self.assertEqual(
            sim.eval_iam_policy_local_harness(bootstrap_doc, "iam:DeletePolicy", RUNTIME_PROVISIONER_BOUNDARY_ARN, {}),
            "explicitDeny",
        )
        unrelated_policy = f"arn:aws:iam::{ACCOUNT}:policy/unrelated-policy"
        for action in ("iam:CreatePolicy", "iam:GetPolicy", "iam:CreatePolicyVersion"):
            self.assertEqual(
                sim.eval_iam_policy_local_harness(bootstrap_doc, action, unrelated_policy, {}),
                "implicitDeny",
            )
        self.assertEqual(
            sim.eval_iam_policy_local_harness(
                bootstrap_doc,
                "iam:PassRole",
                f"arn:aws:iam::{ACCOUNT}:role/envscale-ec2-runtime-role",
                {},
            ),
            "explicitDeny",
        )

        tampered = json.loads(json.dumps(bootstrap_doc))
        for st in tampered["Statement"]:
            if st.get("Sid") == "AllowBootstrapWorkloadBoundaryPolicyLifecycle":
                st["Resource"].append(f"arn:aws:iam::{ACCOUNT}:policy/rogue-boundary")
        with tempfile.TemporaryDirectory() as td:
            bad_path = pathlib.Path(td) / "tampered-bootstrap-policy.json"
            bad_path.write_text(json.dumps(tampered), encoding="utf-8")
            with self.assertRaises(SystemExit):
                plan_iam_safety.validate_foundation_iam_bootstrap_policy(bad_path)

    def test_s3_recovery_bucket_policy_sid_validator_day1_and_update_plans(self):
        vfp = _load_validator()
        rendered = sim.build_rendered_foundation_policies(FOUNDATION_DIR)
        recovery_policy = rendered["recovery_bucket_policy"]
        recovery_policy_json = json.dumps(recovery_policy)

        for base_mode in ("initial", "update"):
            doc = vfp.make_valid_plan_doc(base_mode)
            rc = next(r for r in doc["resource_changes"] if r["address"] == "aws_s3_bucket_policy.recovery")
            rc["change"]["after"] = {"policy": recovery_policy_json}
            self.assertEqual(vfp.validate_plan_doc(doc, mode="auto"), [])
            if base_mode == "update":
                rc["change"]["actions"] = ["update"]
                self.assertEqual(vfp.validate_plan_doc(doc, mode="auto"), [])

        # Baseline Day-1 initial plan (unknown after) and bootstrap plan must still pass.
        self.assertEqual(vfp.validate_plan_doc(vfp.make_valid_plan_doc("initial"), mode="auto"), [])
        with mock.patch.dict(os.environ, {"GITHUB_ACTIONS": "", "CI": ""}, clear=False):
            self.assertEqual(
                vfp.validate_plan_doc(vfp.make_valid_plan_doc("bootstrap"), mode="bootstrap", allow_protected_iam_updates=True),
                [],
            )

        typo_policy = json.loads(recovery_policy_json)
        for st in typo_policy["Statement"]:
            if st.get("Sid") == "DenyBucketAndObjectVersionDestruction":
                st["Sid"] = "DenyBucketAndVersionDestruction"

        missing_destr_policy = json.loads(recovery_policy_json)
        missing_destr_policy["Statement"] = [
            st for st in missing_destr_policy["Statement"] if st.get("Sid") != "DenyBucketAndObjectVersionDestruction"
        ]

        missing_tls_policy = json.loads(recovery_policy_json)
        missing_tls_policy["Statement"] = [
            st for st in missing_tls_policy["Statement"] if st.get("Sid") != "DenyInsecureTransport"
        ]

        for label, bad_pol in (
            ("old typo SID", typo_policy),
            ("missing DenyBucketAndObjectVersionDestruction", missing_destr_policy),
            ("missing DenyInsecureTransport", missing_tls_policy),
        ):
            for base_mode in ("initial", "update"):
                with self.subTest(label=label, mode=base_mode):
                    doc = vfp.make_valid_plan_doc(base_mode)
                    rc = next(r for r in doc["resource_changes"] if r["address"] == "aws_s3_bucket_policy.recovery")
                    rc["change"]["after"] = {"policy": json.dumps(bad_pol)}
                    errs = vfp.validate_plan_doc(doc, mode="auto")
                    self.assertTrue(
                        any("missing mandatory transport/destruction Deny statements" in e for e in errs),
                        msg=f"{label} ({base_mode}) unexpected errors: {errs}",
                    )

    def test_check_bucket_preflight_authorized_under_restricted_bootstrap_policy(self):
        bootstrap_doc = plan_iam_safety.validate_foundation_iam_bootstrap_policy(BOOTSTRAP_POL_PATH)
        s3api_to_iam = {
            "get-bucket-location": "s3:GetBucketLocation",
            "get-public-access-block": "s3:GetBucketPublicAccessBlock",
            "get-bucket-versioning": "s3:GetBucketVersioning",
            "get-bucket-encryption": "s3:GetEncryptionConfiguration",
            "get-bucket-policy": "s3:GetBucketPolicy",
            "list-objects-v2": "s3:ListBucket",
        }

        with tempfile.TemporaryDirectory() as td:
            td_p = pathlib.Path(td)
            pol_f, lic_f, enc_f = td_p / "pol.json", td_p / "lic.json", td_p / "enc.json"
            arts = day0_bucket_bootstrap.generate_bucket_artifacts(ACCOUNT, TFSTATE_BUCKET, pol_f, lic_f, enc_f)
            canned = {
                "get-bucket-location": {"LocationConstraint": "ap-south-1"},
                "get-public-access-block": {
                    "PublicAccessBlockConfiguration": {
                        "BlockPublicAcls": True,
                        "IgnorePublicAcls": True,
                        "BlockPublicPolicy": True,
                        "RestrictPublicBuckets": True,
                    }
                },
                "get-bucket-versioning": {"Status": "Enabled"},
                "get-bucket-encryption": {
                    "ServerSideEncryptionConfiguration": {
                        "Rules": [{"ApplyServerSideEncryptionByDefault": {"SSEAlgorithm": "AES256"}}]
                    }
                },
                "get-bucket-policy": {"Policy": json.dumps(arts["policy"])},
                "list-objects-v2": {"KeyCount": 0, "Contents": []},
            }
            seen_ops: list[str] = []

            def enforced_s3_caller(op: str, params: list[str]):
                bucket = params[params.index("--bucket") + 1]
                iam_action = s3api_to_iam[op]
                ctx: dict[str, object] = {}
                if "--prefix" in params:
                    ctx["s3:prefix"] = params[params.index("--prefix") + 1]
                decision = sim.eval_iam_policy_local_harness(bootstrap_doc, iam_action, f"arn:aws:s3:::{bucket}", ctx)
                if decision != "allowed":
                    raise SystemExit(f"AccessDenied: {iam_action} on {bucket} ({decision})")
                seen_ops.append(op)
                return canned[op]

            cfg = day0_bucket_bootstrap.validate_state_bucket_configuration(
                bucket_name=TFSTATE_BUCKET,
                account_id=ACCOUNT,
                region="ap-south-1",
                expected_policy_path=pol_f,
                s3_caller=enforced_s3_caller,
            )
            self.assertTrue(cfg["policy_matches"])
            self.assertTrue(cfg["public_access_block"])
            self.assertEqual(cfg["versioning"], "Enabled")
            self.assertEqual(cfg["encryption"], "AES256")
            self.assertEqual(
                set(seen_ops),
                {
                    "get-bucket-location",
                    "get-public-access-block",
                    "get-bucket-versioning",
                    "get-bucket-encryption",
                    "get-bucket-policy",
                },
            )

            pref = day0_bucket_bootstrap.verify_state_prefix_readiness(
                bucket_name=TFSTATE_BUCKET,
                state_prefix="foundation/",
                account_id=ACCOUNT,
                s3_caller=enforced_s3_caller,
            )
            self.assertTrue(pref["accessible"])
            self.assertIn("list-objects-v2", seen_ops)

            for other_bucket in (RECOVERY_BUCKET, LEGACY_BUCKET, "unrelated-bucket"):
                with self.subTest(other_bucket=other_bucket), self.assertRaises(SystemExit) as ctx_err:
                    day0_bucket_bootstrap.validate_state_bucket_configuration(
                        bucket_name=other_bucket,
                        account_id=ACCOUNT,
                        region="ap-south-1",
                        expected_policy_path=pol_f,
                        s3_caller=enforced_s3_caller,
                    )
                self.assertIn("AccessDenied", str(ctx_err.exception))
                for action in (
                    "s3:GetBucketLocation",
                    "s3:GetBucketPublicAccessBlock",
                    "s3:GetBucketVersioning",
                    "s3:GetEncryptionConfiguration",
                    "s3:GetBucketPolicy",
                ):
                    self.assertIn(
                        sim.eval_iam_policy_local_harness(bootstrap_doc, action, f"arn:aws:s3:::{other_bucket}", {}),
                        ("implicitDeny", "explicitDeny"),
                    )

        for action, res in (
            ("s3:PutBucketPolicy", TFSTATE_ARN),
            ("s3:DeleteBucket", TFSTATE_ARN),
            ("s3:DeleteBucketPolicy", TFSTATE_ARN),
            ("s3:DeleteObjectVersion", f"{TFSTATE_ARN}/foundation/terraform.tfstate"),
            ("s3:DeleteObject", f"{TFSTATE_ARN}/foundation/terraform.tfstate"),
            ("s3:GetObject", f"{TFSTATE_ARN}/runtime/terraform.tfstate"),
            ("s3:PutObject", f"{TFSTATE_ARN}/runtime/terraform.tfstate"),
            ("s3:GetObject", f"arn:aws:s3:::{RECOVERY_BUCKET}/backups/postgres/x.dump"),
            ("s3:PutObject", f"arn:aws:s3:::{RECOVERY_BUCKET}/backups/postgres/x.dump"),
            ("s3:GetObject", f"arn:aws:s3:::{LEGACY_BUCKET}/x"),
            ("iam:CreateUser", f"arn:aws:iam::{ACCOUNT}:user/rogue"),
            ("iam:PutUserPolicy", f"arn:aws:iam::{ACCOUNT}:user/DEV-user-alpha"),
            ("iam:AttachUserPolicy", f"arn:aws:iam::{ACCOUNT}:user/DEV-user-alpha"),
            ("iam:DeleteRole", f"arn:aws:iam::{ACCOUNT}:role/envscale-foundation-admin-role"),
            ("iam:DeletePolicy", WORKLOAD_BOUNDARY_ARN),
            ("iam:PassRole", f"arn:aws:iam::{ACCOUNT}:role/envscale-ec2-runtime-role"),
            ("ec2:DescribeInstances", "*"),
            ("ssm:GetParameter", f"arn:aws:ssm:ap-south-1:{ACCOUNT}:parameter/envscale/prod/postgres_password"),
            ("kms:Decrypt", "*"),
        ):
            with self.subTest(deny_action=action, res=res):
                self.assertEqual(sim.eval_iam_policy_local_harness(bootstrap_doc, action, res, {}), "explicitDeny")

    def test_all_four_bootstrap_stages_required_apis_permitted_and_unneeded_denied(self):
        bootstrap_doc = json.loads(BOOTSTRAP_POL_PATH.read_text(encoding="utf-8"))
        dev_user = f"arn:aws:iam::{ACCOUNT}:user/DEV-user-alpha"
        bootstrap_pol = f"arn:aws:iam::{ACCOUNT}:policy/envscale-foundation-iam-bootstrap-policy"
        admin_role = f"arn:aws:iam::{ACCOUNT}:role/envscale-foundation-admin-role"
        plan_role = f"arn:aws:iam::{ACCOUNT}:role/envscale-github-foundation-plan-role"
        apply_role = f"arn:aws:iam::{ACCOUNT}:role/envscale-github-foundation-role"
        oidc = f"arn:aws:iam::{ACCOUNT}:oidc-provider/token.actions.githubusercontent.com"

        required_calls = [
            ("sts:GetCallerIdentity", "*", {}),
            ("s3:GetBucketLocation", TFSTATE_ARN, {}),
            ("s3:GetBucketPolicy", TFSTATE_ARN, {}),
            ("s3:GetBucketPublicAccessBlock", TFSTATE_ARN, {}),
            ("s3:GetBucketVersioning", TFSTATE_ARN, {}),
            ("s3:GetEncryptionConfiguration", TFSTATE_ARN, {}),
            ("s3:ListBucket", TFSTATE_ARN, {"s3:prefix": "foundation/"}),
            ("iam:ListUserPolicies", dev_user, {}),
            ("iam:ListAttachedUserPolicies", dev_user, {}),
            ("iam:GetPolicy", bootstrap_pol, {}),
            ("iam:GetPolicyVersion", bootstrap_pol, {}),
            ("iam:GetRole", admin_role, {}),
            ("s3:GetObject", f"{TFSTATE_ARN}/foundation/terraform.tfstate", {}),
            ("s3:PutObject", f"{TFSTATE_ARN}/foundation/terraform.tfstate", {}),
            ("s3:GetObject", f"{TFSTATE_ARN}/foundation/terraform.tfstate.tflock", {}),
            ("s3:PutObject", f"{TFSTATE_ARN}/foundation/terraform.tfstate.tflock", {}),
            ("s3:DeleteObject", f"{TFSTATE_ARN}/foundation/terraform.tfstate.tflock", {}),
            ("iam:ListOpenIDConnectProviders", "*", {}),
            ("iam:GetOpenIDConnectProvider", oidc, {}),
            ("iam:ListOpenIDConnectProviderTags", oidc, {}),
        ]
        for role_arn in (admin_role, plan_role, apply_role):
            for act in ("iam:GetRole", "iam:GetRolePolicy", "iam:ListRolePolicies", "iam:PutRolePolicy", "iam:UpdateAssumeRolePolicy", "iam:TagRole"):
                required_calls.append((act, role_arn, {}))
        for b_arn in (WORKLOAD_BOUNDARY_ARN, RUNTIME_PROVISIONER_BOUNDARY_ARN):
            for act in BOUNDARY_LIFECYCLE_ACTIONS:
                required_calls.append((act, b_arn, {}))

        for action, resource, ctx in required_calls:
            with self.subTest(action=action, resource=resource):
                self.assertEqual(sim.eval_iam_policy_local_harness(bootstrap_doc, action, resource, ctx), "allowed")

        self.assertNotEqual(sim.eval_iam_policy_local_harness(bootstrap_doc, "sts:AssumeRole", admin_role, {}), "explicitDeny")
        for non_boot_role in (f"arn:aws:iam::{ACCOUNT}:role/envscale-github-deploy-role", f"arn:aws:iam::{ACCOUNT}:role/envscale-runtime-provisioner-role"):
            self.assertNotEqual(sim.eval_iam_policy_local_harness(bootstrap_doc, "iam:PutRolePolicy", non_boot_role, {}), "allowed")
        self.assertNotEqual(sim.eval_iam_policy_local_harness(bootstrap_doc, "s3:ListBucket", TFSTATE_ARN, {"s3:prefix": "runtime/"}), "allowed")


if __name__ == "__main__":
    unittest.main()

