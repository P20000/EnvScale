"""Regression tests for AWS IAM policy size limits and deploy/recovery policy equivalence."""

from __future__ import annotations

import json
import pathlib
import sys
import unittest

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
BOOTSTRAP_DIR = REPO_ROOT / "deployment" / "bootstrap"
FOUNDATION_DIR = REPO_ROOT / "deployment" / "foundation"
if str(BOOTSTRAP_DIR) not in sys.path:
    sys.path.insert(0, str(BOOTSTRAP_DIR))

import iam_policy_simulator as sim  # noqa: E402
import plan_iam_safety  # noqa: E402

ACCOUNT = sim.ACCOUNT
REGION = sim.REGION
TF_ARN = f"arn:aws:s3:::{sim.TFSTATE_BUCKET}"
RC_ARN = f"arn:aws:s3:::{sim.RECOVERY_BUCKET}"
LG_ARN = f"arn:aws:s3:::{sim.LEGACY_BUCKET}"
EP = f"arn:aws:ec2:{REGION}:{ACCOUNT}"
EC2_ROLE = f"arn:aws:iam::{ACCOUNT}:role/envscale-ec2-runtime-role"
EC2_PROF = f"arn:aws:iam::{ACCOUNT}:instance-profile/envscale-ec2-runtime-profile"


def _compact_size(doc: dict) -> int:
    return len(json.dumps(doc, separators=(",", ":")))


class TestIamPolicySizesAndEquivalence(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.pols = sim.build_rendered_foundation_policies(FOUNDATION_DIR)
        cls.wb = cls.pols["role_workload_permissions_boundary"]
        cls.rc_rp = cls.pols["recovery_bucket_policy"]

    def test_all_foundation_policies_strictly_within_aws_iam_size_limits(self):
        inline_role_keys = (
            "role_ec2_runtime",
            "role_github_release",
            "role_github_deploy",
            "role_github_recovery",
            "role_github_foundation",
            "role_github_foundation_plan",
            "role_foundation_admin",
            "role_runtime_provisioner",
        )
        managed_policy_keys = (
            "role_workload_permissions_boundary",
            "boundary_runtime_provisioner",
            "day0_bootstrap",
            "day0_bootstrap_boundary",
            "day0_initial_seal",
            "day0_initial_seal_boundary",
            "foundation_iam_bootstrap",
        )
        trust_policy_keys = (
            "trust_ec2_runtime",
            "trust_github_release",
            "trust_github_deploy",
            "trust_github_recovery",
            "trust_github_foundation",
            "trust_github_foundation_plan",
            "trust_foundation_admin",
            "trust_runtime_provisioner",
        )

        for key in inline_role_keys:
            sz = _compact_size(self.pols[key])
            self.assertLessEqual(sz, 10240, f"{key} exceeds AWS 10,240-char inline role policy limit ({sz} chars)")
        for key in managed_policy_keys:
            sz = _compact_size(self.pols[key])
            self.assertLessEqual(sz, 6144, f"{key} exceeds AWS 6,144-char managed policy limit ({sz} chars)")
        for key in trust_policy_keys:
            sz = _compact_size(self.pols[key])
            self.assertLessEqual(sz, 2048, f"{key} exceeds AWS 2,048-char trust policy limit ({sz} chars)")

    def test_plan_safety_validator_rejects_oversized_policies(self):
        oversized_inline = json.dumps({"Version": "2012-10-17", "Statement": [{"Sid": "Big", "Effect": "Allow", "Action": ["ec2:DescribeInstances"], "Resource": "*", "Condition": {"StringEquals": {"aws:RequestedRegion": ["a" * 10300]}}}]})
        oversized_managed = json.dumps({"Version": "2012-10-17", "Statement": [{"Sid": "Big", "Effect": "Deny", "Action": ["iam:Create*"], "Resource": "*", "Condition": {"StringEquals": {"aws:RequestedRegion": ["a" * 6200]}}}]})
        oversized_trust = json.dumps({"Version": "2012-10-17", "Statement": [{"Sid": "Big", "Effect": "Allow", "Principal": {"Service": "ec2.amazonaws.com"}, "Action": "sts:AssumeRole", "Condition": {"StringEquals": {"aws:SourceAccount": ["9" * 2100]}}}]})

        rc_inline = {"address": "aws_iam_role_policy.github_deploy", "type": "aws_iam_role_policy", "change": {"actions": ["update"], "after": {"policy": oversized_inline}}}
        rc_managed = {"address": "aws_iam_policy.workload_permissions_boundary", "type": "aws_iam_policy", "change": {"actions": ["update"], "after": {"policy": oversized_managed}}}
        rc_trust = {"address": "aws_iam_role.ec2_runtime", "type": "aws_iam_role", "change": {"actions": ["update"], "after": {"permissions_boundary": f"arn:aws:iam::{ACCOUNT}:policy/envscale-workload-permissions-boundary", "assume_role_policy": oversized_trust}}}

        self.assertTrue(any("10240-char limit" in e for e in plan_iam_safety.check_iam_resource_change_safety(rc_inline)))
        self.assertTrue(any("6144-char limit" in e for e in plan_iam_safety.check_iam_resource_change_safety(rc_managed)))
        self.assertTrue(any("2048-char limit" in e for e in plan_iam_safety.check_iam_resource_change_safety(rc_trust)))

    def test_github_deploy_effective_permissions_and_deny_precedence(self):
        dep = self.pols["role_github_deploy"]
        reg = {"aws:RequestedRegion": REGION}
        req = {"aws:RequestTag/Project": "EnvScale", "aws:RequestTag/Layer": "DisposableRuntime", **reg}
        res = {"aws:ResourceTag/Project": "EnvScale", "aws:ResourceTag/Layer": "DisposableRuntime", **reg}
        other = {"aws:ResourceTag/Project": "Relmonition", "aws:ResourceTag/Layer": "Production", **reg}
        tls = {"aws:SecureTransport": True, "aws:PrincipalAccount": ACCOUNT}

        cases = [
            # Positive allow parity
            ("s3:ListBucket", TF_ARN, {"s3:prefix": "runtime/terraform.tfstate"}, None, "allowed"),
            ("s3:GetBucketLocation", TF_ARN, {}, None, "allowed"),
            ("s3:GetBucketLocation", RC_ARN, {}, None, "allowed"),
            ("s3:GetObject", f"{TF_ARN}/foundation/terraform.tfstate", {}, None, "allowed"),
            ("s3:PutObject", f"{TF_ARN}/runtime/terraform.tfstate", {}, None, "allowed"),
            ("s3:DeleteObject", f"{TF_ARN}/runtime/terraform.tfstate.tflock", {}, None, "allowed"),
            ("s3:DeleteObject", f"{RC_ARN}/lifecycle/active-op.lock", tls, self.rc_rp, "allowed"),
            ("s3:PutObject", f"{RC_ARN}/releases/abc/manifest.json", tls, self.rc_rp, "allowed"),
            ("s3:GetObject", f"{RC_ARN}/backups/postgres/latest-valid.json", tls, self.rc_rp, "allowed"),
            ("ec2:CreateVpc", f"{EP}:vpc/*", req, None, "allowed"),
            ("ec2:CreateSubnet", f"{EP}:subnet/*", req, None, "allowed"),
            ("ec2:CreateSubnet", f"{EP}:vpc/vpc-1", res, None, "allowed"),
            ("ec2:RunInstances", f"{EP}:instance/*", req, None, "allowed"),
            ("ec2:RunInstances", f"{EP}:network-interface/*", req, None, "allowed"),
            ("ec2:RunInstances", f"{EP}:subnet/sub-1", res, None, "allowed"),
            ("ec2:RunInstances", f"{EP}:network-interface/eni-1", res, None, "allowed"),
            ("ec2:RunInstances", sim.LIVE_UBUNTU_AMI_ARN, {"ec2:Owner": "099720109477", **reg}, None, "allowed"),
            ("ec2:RunInstances", sim.LIVE_UBUNTU_SNAP_ARN, {"ec2:Owner": "099720109477", **reg}, None, "allowed"),
            ("ec2:AuthorizeSecurityGroupIngress", f"{EP}:security-group/sg-1", res, None, "allowed"),
            ("ec2:RevokeSecurityGroupEgress", f"{EP}:security-group-rule/sgr-1", reg, None, "allowed"),
            ("ec2:UpdateSecurityGroupRuleDescriptionsIngress", f"{EP}:security-group-rule/sgr-1", reg, None, "allowed"),
            ("ec2:AssociateAddress", f"{EP}:elastic-ip/eipalloc-1", {"aws:ResourceTag/Project": "EnvScale", **reg}, None, "allowed"),
            ("ec2:StopInstances", f"{EP}:instance/i-1", res, None, "allowed"),
            ("ssm:SendCommand", f"arn:aws:ssm:{REGION}::document/AWS-RunShellScript", {}, None, "allowed"),
            ("ssm:SendCommand", f"{EP}:instance/i-1", res, None, "allowed"),
            ("iam:PassRole", EC2_ROLE, {"iam:PassedToService": "ec2.amazonaws.com"}, None, "allowed"),
            # Negative / Explicit Deny precedence
            ("ec2:CreateSubnet", f"{EP}:vpc/vpc-other", {**other, "aws:RequestTag/Project": "EnvScale", "aws:RequestTag/Layer": "DisposableRuntime"}, None, "implicitDeny"),
            ("ec2:TerminateInstances", f"{EP}:instance/i-1", res, None, "explicitDeny"),
            ("ec2:DeleteVpc", f"{EP}:vpc/vpc-1", res, None, "explicitDeny"),
            ("ec2:ReleaseAddress", f"{EP}:elastic-ip/eipalloc-1", res, None, "explicitDeny"),
            ("ec2:DeleteTags", f"{EP}:instance/i-1", {**res, "aws:TagKeys": ["Project"]}, None, "explicitDeny"),
            ("ec2:CreateTags", f"{EP}:instance/i-1", {**res, "aws:RequestTag/Layer": "PersistentFoundation"}, None, "explicitDeny"),
            ("s3:PutObject", f"{TF_ARN}/foundation/terraform.tfstate", {}, None, "explicitDeny"),
            ("s3:DeleteObject", f"{TF_ARN}/runtime/terraform.tfstate", {}, None, "explicitDeny"),
            ("s3:PutObject", f"{RC_ARN}/backups/postgres/x.dump", tls, self.rc_rp, "explicitDeny"),
            ("s3:DeleteObject", f"{RC_ARN}/releases/x.json", tls, self.rc_rp, "explicitDeny"),
            ("s3:DeleteBucket", RC_ARN, tls, self.rc_rp, "explicitDeny"),
            ("s3:GetObject", f"{LG_ARN}/database/x.sql", {}, None, "explicitDeny"),
            ("ssm:GetParameter", f"arn:aws:ssm:{REGION}:{ACCOUNT}:parameter/envscale/prod/postgres_password", {}, None, "explicitDeny"),
            ("ssm:PutParameter", f"arn:aws:ssm:{REGION}:{ACCOUNT}:parameter/envscale/prod/duckdns_domain", {}, None, "explicitDeny"),
            ("iam:PutRolePolicy", EC2_ROLE, {}, None, "explicitDeny"),
        ]
        for act, rsc, ctx, rp, exp in cases:
            with self.subTest(action=act, resource=rsc):
                self.assertEqual(sim.eval_iam_policy_local_harness(dep, act, rsc, ctx, rp, self.wb), exp)

    def test_github_recovery_effective_permissions_and_deny_precedence(self):
        rec = self.pols["role_github_recovery"]
        reg = {"aws:RequestedRegion": REGION}
        req = {"aws:RequestTag/Project": "EnvScale", "aws:RequestTag/Layer": "DisposableRuntime", **reg}
        res = {"aws:ResourceTag/Project": "EnvScale", "aws:ResourceTag/Layer": "DisposableRuntime", **reg}
        res_req = {**res, "aws:RequestTag/Project": "EnvScale", "aws:RequestTag/Layer": "DisposableRuntime"}
        other = {"aws:ResourceTag/Project": "Relmonition", "aws:ResourceTag/Layer": "Production", **reg}
        tls = {"aws:SecureTransport": True, "aws:PrincipalAccount": ACCOUNT}
        eks_cls = f"arn:aws:eks:{REGION}:{ACCOUNT}:cluster/envscale-demo"
        eks_ng = f"arn:aws:eks:{REGION}:{ACCOUNT}:nodegroup/envscale-demo/ng1/id1"

        cases = [
            # Positive allow parity
            ("ec2:TerminateInstances", f"{EP}:instance/i-1", res, None, "allowed"),
            ("ec2:DeleteVpc", f"{EP}:vpc/vpc-1", res, None, "allowed"),
            ("ec2:AuthorizeSecurityGroupEgress", f"{EP}:security-group/sg-1", res, None, "allowed"),
            ("ssm:SendCommand", f"{EP}:instance/i-1", res, None, "allowed"),
            ("eks:CreateCluster", eks_cls, req, None, "allowed"),
            ("eks:CreateNodegroup", eks_ng, res_req, None, "allowed"),
            ("eks:TagResource", eks_cls, res_req, None, "allowed"),
            ("eks:DeleteCluster", eks_cls, res, None, "allowed"),
            ("eks:DeleteNodegroup", eks_ng, res, None, "allowed"),
            ("iam:PassRole", f"arn:aws:iam::{ACCOUNT}:role/envscale-eks-cluster-main", {"iam:PassedToService": "eks.amazonaws.com"}, None, "allowed"),
            ("iam:PassRole", f"arn:aws:iam::{ACCOUNT}:role/envscale-eks-node-group", {"iam:PassedToService": "ec2.amazonaws.com"}, None, "allowed"),
            ("s3:PutObject", f"{RC_ARN}/backups/postgres/latest-valid.json", tls, self.rc_rp, "allowed"),
            ("s3:PutObject", f"{RC_ARN}/releases/latest-known-good.json", tls, self.rc_rp, "allowed"),
            ("s3:DeleteObject", f"{RC_ARN}/lifecycle/active-op.lock", tls, self.rc_rp, "allowed"),
            ("s3:DeleteObject", f"{TF_ARN}/eks/terraform.tfstate.tflock", {}, None, "allowed"),
            # Negative / Explicit Deny precedence
            ("ec2:TerminateInstances", f"{EP}:instance/i-other", other, None, "implicitDeny"),
            ("eks:DeleteCluster", sim.LIVE_COEXISTING_EKS_ARN, other, None, "implicitDeny"),
            ("ec2:ReleaseAddress", f"{EP}:elastic-ip/eipalloc-1", res, None, "explicitDeny"),
            ("s3:PutObject", f"{RC_ARN}/backups/postgres/archive/x/db.dump", tls, self.rc_rp, "explicitDeny"),
            ("s3:PutObject", f"{RC_ARN}/backups/historical/x.sql", tls, self.rc_rp, "explicitDeny"),
            ("s3:DeleteObject", f"{RC_ARN}/backups/postgres/latest-valid.json", tls, self.rc_rp, "explicitDeny"),
            ("s3:DeleteObject", f"{TF_ARN}/foundation/terraform.tfstate", {}, None, "explicitDeny"),
            ("s3:DeleteObject", f"{TF_ARN}/eks/terraform.tfstate", {}, None, "explicitDeny"),
            ("s3:GetObject", f"{LG_ARN}/database/x.sql", {}, None, "explicitDeny"),
            ("ssm:GetParameter", f"arn:aws:ssm:{REGION}:{ACCOUNT}:parameter/envscale/prod/postgres_password", {}, None, "explicitDeny"),
            ("iam:PutRolePolicy", EC2_ROLE, {}, None, "explicitDeny"),
            ("iam:UpdateAssumeRolePolicy", f"arn:aws:iam::{ACCOUNT}:role/envscale-foundation-admin-role", {}, None, "explicitDeny"),
            ("iam:DeleteRole", f"arn:aws:iam::{ACCOUNT}:role/envscale-github-foundation-role", {}, None, "explicitDeny"),
        ]
        for act, rsc, ctx, rp, exp in cases:
            with self.subTest(action=act, resource=rsc):
                self.assertEqual(sim.eval_iam_policy_local_harness(rec, act, rsc, ctx, rp, self.wb), exp)


if __name__ == "__main__":
    unittest.main()

