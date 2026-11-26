"""Offline unit tests and Terraform Foundation integration tests for EnvScale two-role Runtime IAM."""

from __future__ import annotations

import importlib.util
import json
import os
import pathlib
import sys
import unittest
from unittest import mock

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
BOOTSTRAP_DIR = REPO_ROOT / "deployment" / "bootstrap"
FOUNDATION_DIR = REPO_ROOT / "deployment" / "foundation"
if str(BOOTSTRAP_DIR) not in sys.path:
    sys.path.insert(0, str(BOOTSTRAP_DIR))

import iam_policy_simulator as sim  # noqa: E402
import plan_iam_safety  # noqa: E402
import runtime_provisioner_iam as b2  # noqa: E402


def _load_plan_validator():
    spec = importlib.util.spec_from_file_location("validate_foundation_plan_rt", BOOTSTRAP_DIR / "validate-foundation-plan.py")
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class TestRuntimeProvisionerTwoRoleIam(unittest.TestCase):
    def test_policy_hygiene_sizes_and_two_role_separation(self):
        policies = b2.build_all_runtime_iam_policies(FOUNDATION_DIR)
        rendered_foundation = sim.build_rendered_foundation_policies(FOUNDATION_DIR)
        self.assertEqual(policies["trust_ec2_runtime"], rendered_foundation["trust_ec2_runtime"])
        self.assertEqual(policies["role_ec2_runtime"], rendered_foundation["role_ec2_runtime"])
        self.assertEqual(policies["trust_runtime_provisioner"], rendered_foundation["trust_runtime_provisioner"])
        self.assertEqual(policies["role_runtime_provisioner"], rendered_foundation["role_runtime_provisioner"])
        self.assertEqual(policies["boundary_runtime_provisioner"], rendered_foundation["boundary_runtime_provisioner"])

        for key in (
            "trust_runtime_provisioner",
            "role_runtime_provisioner",
            "boundary_runtime_provisioner",
            "trust_ec2_runtime",
            "role_ec2_runtime",
        ):
            doc = policies[key]
            self.assertEqual(doc["Version"], "2012-10-17")
            sids = [stmt["Sid"] for stmt in doc["Statement"]]
            self.assertEqual(len(sids), len(set(sids)), f"Duplicate Sid in {key}")

        seps = (",", ":")
        # AWS IAM limits: 10,240 chars for inline role policies, 6,144 chars for managed policies.
        self.assertLessEqual(len(json.dumps(policies["role_runtime_provisioner"], separators=seps)), 10240)
        disassoc_stmt = next((s for s in policies["role_runtime_provisioner"]["Statement"] if s["Sid"] == "DisassocEni"), None)
        self.assertIsNotNone(disassoc_stmt)
        self.assertEqual(disassoc_stmt["Action"], ["ec2:DisassociateAddress"])
        self.assertEqual(disassoc_stmt["Resource"], f"arn:aws:ec2:{b2.REGION}:{b2.ACCOUNT}:network-interface/*")
        self.assertEqual(
            disassoc_stmt["Condition"],
            {"StringEquals": {"aws:RequestedRegion": b2.REGION}, "Null": {"aws:ResourceTag/Project": "true", "aws:ResourceTag/Layer": "true"}},
        )
        self.assertLessEqual(len(json.dumps(policies["boundary_runtime_provisioner"], separators=seps)), 6144)
        self.assertLessEqual(len(json.dumps(policies["role_ec2_runtime"], separators=seps)), 10240)
        self.assertLessEqual(len(json.dumps(rendered_foundation["role_workload_permissions_boundary"], separators=seps)), 6144)
        self.assertLessEqual(len(json.dumps(rendered_foundation["role_github_foundation"], separators=seps)), 10240)
        self.assertLessEqual(len(json.dumps(rendered_foundation["role_github_foundation_plan"], separators=seps)), 10240)
        self.assertLessEqual(len(json.dumps(rendered_foundation["role_foundation_admin"], separators=seps)), 10240)

        prov_trust = policies["trust_runtime_provisioner"]["Statement"][0]
        self.assertNotIn("StringLike", str(prov_trust))
        self.assertEqual(prov_trust["Condition"]["Bool"]["aws:MultiFactorAuthPresent"], "true")
        self.assertEqual(prov_trust["Condition"]["NumericLessThan"]["aws:MultiFactorAuthAge"], "3600")

        ec2_trust = policies["trust_ec2_runtime"]["Statement"][0]
        self.assertEqual(ec2_trust["Condition"]["StringEquals"]["aws:SourceAccount"], b2.ACCOUNT)

        prov_allow_actions = {
            act
            for stmt in policies["role_runtime_provisioner"]["Statement"]
            if stmt["Effect"] == "Allow"
            for act in (stmt["Action"] if isinstance(stmt["Action"], list) else [stmt["Action"]])
        }
        for forbidden in ("ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath", "kms:Decrypt", "kms:Encrypt", "iam:CreateRole"):
            self.assertNotIn(forbidden, prov_allow_actions)

        ec2_allow_actions = {
            act
            for stmt in policies["role_ec2_runtime"]["Statement"]
            if stmt["Effect"] == "Allow"
            for act in (stmt["Action"] if isinstance(stmt["Action"], list) else [stmt["Action"]])
        }
        for required_secret_act in ("ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath", "kms:Decrypt"):
            self.assertIn(required_secret_act, ec2_allow_actions)
        self.assertNotIn("ec2:RunInstances", ec2_allow_actions)

    def test_foundation_hcl_contains_runtime_iam_resources_and_outputs(self):
        rt_tf = (FOUNDATION_DIR / "iam_runtime_provisioner.tf").read_text(encoding="utf-8")
        pb_tf = (FOUNDATION_DIR / "iam_boundary.tf").read_text(encoding="utf-8")
        ec2_tf = (FOUNDATION_DIR / "iam.tf").read_text(encoding="utf-8")
        vars_tf = (FOUNDATION_DIR / "variables.tf").read_text(encoding="utf-8")
        out_tf = (FOUNDATION_DIR / "outputs.tf").read_text(encoding="utf-8")

        for req in (
            'resource "aws_iam_policy" "runtime_provisioner_permissions_boundary"',
            'name        = "envscale-runtime-provisioner-permissions-boundary"',
        ):
            self.assertIn(req, pb_tf)

        for req in (
            'resource "aws_iam_role" "runtime_provisioner"',
            'name                 = "envscale-runtime-provisioner-role"',
            "max_session_duration = 3600",
            "permissions_boundary = aws_iam_policy.runtime_provisioner_permissions_boundary.arn",
            'resource "aws_iam_role_policy" "runtime_provisioner"',
            'name = "envscale-runtime-provisioner-policy"',
            'Sid      = "DisassocEni"',
            "Principal = { AWS = var.runtime_provisioner_trusted_principal_arns }",
        ):
            self.assertIn(req, rt_tf)

        for req in (
            'resource "aws_iam_role" "ec2_runtime"',
            'resource "aws_iam_role_policy" "ec2_runtime"',
            'resource "aws_iam_instance_profile" "ec2_runtime"',
            "permissions_boundary = aws_iam_policy.workload_permissions_boundary.arn",
        ):
            self.assertIn(req, ec2_tf)

        self.assertIn('variable "runtime_provisioner_trusted_principal_arns"', vars_tf)
        self.assertIn("arn:aws:iam::982534376726:user/DEV-user-alpha", vars_tf)
        for out_name in (
            'output "runtime_provisioner_role_name"',
            'output "runtime_provisioner_role_arn"',
            'output "runtime_provisioner_permissions_boundary_arn"',
        ):
            self.assertIn(out_name, out_tf)

    def test_plan_allowlist_counts_and_runtime_iam_safety_guards(self):
        vfp = _load_plan_validator()
        self.assertEqual(len(vfp.APPROVED_MANAGED_RESOURCES), 36)
        self.assertEqual(len(plan_iam_safety.PROTECTED_FOUNDATION_IAM_ADDRESSES), 8)
        self.assertIn("aws_iam_policy.runtime_provisioner_permissions_boundary", plan_iam_safety.PROTECTED_FOUNDATION_IAM_ADDRESSES)
        self.assertIn("aws_iam_role.runtime_provisioner", plan_iam_safety.BOUNDARY_ENFORCED_ROLE_ADDRESSES)
        self.assertIn("aws_iam_role_policy.runtime_provisioner", plan_iam_safety.WORKLOAD_POLICY_ADDRESSES)

        with mock.patch.dict(os.environ, {"GITHUB_ACTIONS": "", "CI": ""}, clear=False):
            self.assertEqual(vfp.validate_plan_doc(vfp.make_valid_plan_doc("bootstrap"), mode="bootstrap", allow_protected_iam_updates=True), [])
            self.assertEqual(vfp.validate_plan_doc(vfp.make_valid_plan_doc("initial"), mode="auto"), [])
            self.assertEqual(vfp.validate_plan_doc(vfp.make_valid_plan_doc("update"), mode="auto"), [])

        rt_pb_arn = f"arn:aws:iam::{b2.ACCOUNT}:policy/{b2.RUNTIME_PROVISIONER_BOUNDARY_NAME}"
        wb_arn = f"arn:aws:iam::{b2.ACCOUNT}:policy/{b2.WORKLOAD_BOUNDARY_NAME}"
        valid_trust = json.dumps(b2.build_runtime_provisioner_trust_policy())
        valid_policy = json.dumps(b2.build_runtime_provisioner_policy())
        valid_boundary = json.dumps(b2.build_runtime_provisioner_permissions_boundary())

        # Positive checks on valid rendered resources
        for addr, rtype, after in (
            ("aws_iam_role.runtime_provisioner", "aws_iam_role", {"name": b2.RUNTIME_PROVISIONER_ROLE_NAME, "max_session_duration": 3600, "permissions_boundary": rt_pb_arn, "assume_role_policy": valid_trust}),
            ("aws_iam_role_policy.runtime_provisioner", "aws_iam_role_policy", {"policy": valid_policy}),
            ("aws_iam_policy.runtime_provisioner_permissions_boundary", "aws_iam_policy", {"policy": valid_boundary}),
        ):
            rc = {"address": addr, "type": rtype, "change": {"actions": ["create"], "after": after, "after_unknown": {}}}
            self.assertEqual(plan_iam_safety.check_iam_resource_change_safety(rc), [], f"Valid {addr} unexpectedly rejected")

        # Negative checks: every security invariant violation must be rejected
        bad_cases = [
            ("missing boundary", "aws_iam_role.runtime_provisioner", "aws_iam_role", {"name": b2.RUNTIME_PROVISIONER_ROLE_NAME, "permissions_boundary": None}),
            ("wrong workload boundary", "aws_iam_role.runtime_provisioner", "aws_iam_role", {"permissions_boundary": wb_arn, "assume_role_policy": valid_trust}),
            ("session > 3600s", "aws_iam_role.runtime_provisioner", "aws_iam_role", {"permissions_boundary": rt_pb_arn, "max_session_duration": 7200, "assume_role_policy": valid_trust}),
            ("missing MFA Bool", "aws_iam_role.runtime_provisioner", "aws_iam_role", {"permissions_boundary": rt_pb_arn, "assume_role_policy": json.dumps({"Version": "2012-10-17", "Statement": [{"Effect": "Allow", "Principal": {"AWS": [f"arn:aws:iam::{b2.ACCOUNT}:user/DEV-user-alpha"]}, "Action": "sts:AssumeRole", "Condition": {"NumericLessThan": {"aws:MultiFactorAuthAge": "3600"}}}]})}),
            ("wrong MFA age", "aws_iam_role.runtime_provisioner", "aws_iam_role", {"permissions_boundary": rt_pb_arn, "assume_role_policy": json.dumps({"Version": "2012-10-17", "Statement": [{"Effect": "Allow", "Principal": {"AWS": [f"arn:aws:iam::{b2.ACCOUNT}:user/DEV-user-alpha"]}, "Action": "sts:AssumeRole", "Condition": {"Bool": {"aws:MultiFactorAuthPresent": "true"}, "NumericLessThan": {"aws:MultiFactorAuthAge": "7200"}}}]})}),
            ("root principal", "aws_iam_role.runtime_provisioner", "aws_iam_role", {"permissions_boundary": rt_pb_arn, "assume_role_policy": json.dumps({"Version": "2012-10-17", "Statement": [{"Effect": "Allow", "Principal": {"AWS": [f"arn:aws:iam::{b2.ACCOUNT}:root"]}, "Action": "sts:AssumeRole", "Condition": {"Bool": {"aws:MultiFactorAuthPresent": "true"}, "NumericLessThan": {"aws:MultiFactorAuthAge": "3600"}}}]})}),
            ("inline IAM escalation", "aws_iam_role_policy.runtime_provisioner", "aws_iam_role_policy", {"policy": json.dumps({"Version": "2012-10-17", "Statement": [{"Effect": "Allow", "Action": ["iam:PutRolePolicy"], "Resource": "*"}]})}),
            ("boundary missing ssm:GetParameter deny", "aws_iam_policy.runtime_provisioner_permissions_boundary", "aws_iam_policy", {"policy": json.dumps({"Version": "2012-10-17", "Statement": [{"Effect": "Deny", "Action": ["iam:Create*"], "Resource": "*"}]})}),
        ]
        for label, addr, rtype, after in bad_cases:
            with self.subTest(case=label):
                rc = {"address": addr, "type": rtype, "change": {"actions": ["update"], "after": after, "after_unknown": {}}}
                self.assertTrue(plan_iam_safety.check_iam_resource_change_safety(rc), f"Expected rejection for {label}")

    def test_foundation_roles_enforce_runtime_provisioner_boundary_and_immutability(self):
        pols = sim.build_rendered_foundation_policies(FOUNDATION_DIR)
        rt_role = f"arn:aws:iam::{b2.ACCOUNT}:role/{b2.RUNTIME_PROVISIONER_ROLE_NAME}"
        rt_pb = f"arn:aws:iam::{b2.ACCOUNT}:policy/{b2.RUNTIME_PROVISIONER_BOUNDARY_NAME}"
        wb_pb = f"arn:aws:iam::{b2.ACCOUNT}:policy/{b2.WORKLOAD_BOUNDARY_NAME}"

        self.assertEqual(sim.eval_iam_policy_local_harness(pols["role_github_foundation"], "iam:CreateRole", rt_role, {"iam:PermissionsBoundary": rt_pb}), "allowed")
        self.assertEqual(sim.eval_iam_policy_local_harness(pols["role_github_foundation"], "iam:PutRolePolicy", rt_role, {}), "allowed")
        self.assertEqual(sim.eval_iam_policy_local_harness(pols["role_github_foundation"], "iam:CreateRole", rt_role, {"iam:PermissionsBoundary": wb_pb}), "implicitDeny")
        self.assertEqual(sim.eval_iam_policy_local_harness(pols["role_github_foundation"], "iam:CreateRole", rt_role, {}), "implicitDeny")
        self.assertEqual(sim.eval_iam_policy_local_harness(pols["role_github_foundation"], "iam:DeleteRolePermissionsBoundary", rt_role, {}), "explicitDeny")
        self.assertEqual(sim.eval_iam_policy_local_harness(pols["role_github_foundation"], "iam:CreatePolicy", rt_pb, {}), "explicitDeny")
        self.assertEqual(sim.eval_iam_policy_local_harness(pols["role_github_foundation"], "iam:CreatePolicyVersion", rt_pb, {}), "explicitDeny")
        self.assertEqual(sim.eval_iam_policy_local_harness(pols["role_github_foundation_plan"], "iam:GetRole", rt_role, {}), "allowed")
        self.assertEqual(sim.eval_iam_policy_local_harness(pols["role_github_foundation_plan"], "iam:GetPolicy", rt_pb, {}), "allowed")
        self.assertEqual(sim.eval_iam_policy_local_harness(pols["role_foundation_admin"], "iam:CreatePolicy", rt_pb, {}), "allowed")

    def test_disassociate_address_dual_resource_scope(self):
        pols = b2.build_all_runtime_iam_policies(FOUNDATION_DIR)
        prov = pols["role_runtime_provisioner"]
        pb = pols["boundary_runtime_provisioner"]
        ep = f"arn:aws:ec2:{b2.REGION}:{b2.ACCOUNT}"
        cases = [
            (f"{ep}:elastic-ip/eipalloc-disposable", {"aws:ResourceTag/Project": "EnvScale", "aws:ResourceTag/Layer": "DisposableRuntime", "aws:RequestedRegion": b2.REGION}, "ec2:DisassociateAddress", "allowed"),
            (f"{ep}:network-interface/eni-primary", {"aws:RequestedRegion": b2.REGION}, "ec2:DisassociateAddress", "allowed"),
            (f"{ep}:network-interface/eni-other", {"aws:ResourceTag/Project": "Relmonition", "aws:ResourceTag/Layer": "Production", "aws:RequestedRegion": b2.REGION}, "ec2:DisassociateAddress", "implicitDeny"),
            (f"arn:aws:ec2:us-east-1:{b2.ACCOUNT}:network-interface/eni-primary", {"aws:RequestedRegion": "us-east-1"}, "ec2:DisassociateAddress", "implicitDeny"),
            (f"{ep}:elastic-ip/eipalloc-persistent", {"aws:ResourceTag/Project": "EnvScale", "aws:ResourceTag/Layer": "PersistentFoundation", "aws:RequestedRegion": b2.REGION}, "ec2:DisassociateAddress", "implicitDeny"),
            (f"{ep}:elastic-ip/eipalloc-untagged", {"aws:RequestedRegion": b2.REGION}, "ec2:DisassociateAddress", "implicitDeny"),
            (f"{ep}:network-interface/eni-primary", {"aws:RequestedRegion": b2.REGION}, "ec2:DeleteNetworkInterface", "implicitDeny"),
        ]
        for res, ctx, act, exp in cases:
            with self.subTest(action=act, resource=res, ctx=ctx):
                self.assertEqual(sim.eval_iam_policy_local_harness(prov, act, res, ctx, None, pb), exp)

    def test_runtime_provisioner_and_ec2_matrices_offline(self):
        counts = b2.verify_runtime_iam_matrix(live_aws=False)
        self.assertGreaterEqual(counts["trust"], 5)
        self.assertGreaterEqual(counts["provisioner"], 45)
        self.assertGreaterEqual(counts["ec2_runtime"], 16)
        self.assertGreaterEqual(counts["boundary"], 8)
        self.assertEqual(counts["combined_sg_sgr"], 10)

    def test_live_aws_simulation_contract_mocked(self):
        from iam_boundary_policies import build_combined_sg_rule_scenarios

        vectors = b2.build_runtime_iam_simulation_vectors()
        expected_outcomes = [row[-1] for g in ("provisioner", "ec2_runtime", "boundary") for row in vectors[g]]
        for _act in ("ec2:AuthorizeSecurityGroupIngress", "ec2:AuthorizeSecurityGroupEgress"):
            for _lbl, _ctx, exp_sg, exp_sgr, _exp_c in build_combined_sg_rule_scenarios(b2.REGION):
                expected_outcomes.extend([exp_sg, exp_sgr])
        with (
            mock.patch.object(sim, "run_access_analyzer_validation") as m_analyzer,
            mock.patch.object(sim, "simulate_via_aws_iam", side_effect=expected_outcomes) as m_sim,
        ):
            counts = b2.verify_runtime_iam_matrix(live_aws=True, tfstate_bucket_policy=b2.load_tfstate_bucket_policy())

        m_analyzer.assert_called_once()
        analyzed_keys = set(m_analyzer.call_args.args[0].keys())
        self.assertEqual(
            analyzed_keys,
            {"trust_runtime_provisioner", "role_runtime_provisioner", "boundary_runtime_provisioner", "trust_ec2_runtime", "role_ec2_runtime"},
        )
        self.assertEqual(m_sim.call_count, counts["provisioner"] + counts["ec2_runtime"] + counts["boundary"] + 2 * counts["combined_sg_sgr"])


if __name__ == "__main__":
    unittest.main()
