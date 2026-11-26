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

import iam_policy_simulator as sim  # noqa: E402
import plan_iam_safety  # noqa: E402

ACCOUNT = "982534376726"
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


if __name__ == "__main__":
    unittest.main()
