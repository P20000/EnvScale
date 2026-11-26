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

import iam_boundary_policies as ibp  # noqa: E402
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

        unscoped_sgr = json.dumps({"Version": "2012-10-17", "Statement": [{"Sid": "SgRules", "Effect": "Allow", "Action": ["ec2:AuthorizeSecurityGroupIngress"], "Resource": f"{EP}:security-group-rule/*", "Condition": {"StringEquals": {"aws:RequestedRegion": REGION}}}]})
        rc_sgr = {"address": "aws_iam_role_policy.runtime_provisioner", "type": "aws_iam_role_policy", "change": {"actions": ["update"], "after": {"policy": unscoped_sgr}}}
        self.assertTrue(any("security-group-rule/*" in e for e in plan_iam_safety.check_iam_resource_change_safety(rc_sgr)))

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
            ("ec2:RunInstances", sim.LIVE_UBUNTU_AMI_ARN, {"ec2:Owner": "amazon", **reg}, None, "allowed"),
            ("ec2:RunInstances", sim.LIVE_UBUNTU_SNAP_ARN, {"ec2:Owner": "099720109477", **reg}, None, "allowed"),
            ("ec2:AuthorizeSecurityGroupIngress", f"{EP}:security-group/sg-1", res, None, "allowed"),
            ("ec2:RevokeSecurityGroupEgress", f"{EP}:security-group/sg-1", res, None, "allowed"),
            ("ec2:UpdateSecurityGroupRuleDescriptionsIngress", f"{EP}:security-group/sg-1", res, None, "allowed"),
            ("ec2:AuthorizeSecurityGroupIngress", f"{EP}:security-group-rule/sgr-1", req, None, "allowed"),
            ("ec2:AuthorizeSecurityGroupEgress", f"{EP}:security-group-rule/sgr-1", req, None, "allowed"),
            ("ec2:AssociateAddress", f"{EP}:elastic-ip/eipalloc-1", {"aws:ResourceTag/Project": "EnvScale", **reg}, None, "allowed"),
            ("ec2:StopInstances", f"{EP}:instance/i-1", res, None, "allowed"),
            ("ssm:SendCommand", f"arn:aws:ssm:{REGION}::document/AWS-RunShellScript", {}, None, "allowed"),
            ("ssm:SendCommand", f"{EP}:instance/i-1", res, None, "allowed"),
            ("iam:PassRole", EC2_ROLE, {"iam:PassedToService": "ec2.amazonaws.com"}, None, "allowed"),
            # Negative / Explicit Deny precedence
            ("ec2:AuthorizeSecurityGroupIngress", f"{EP}:security-group/sg-untagged", reg, None, "implicitDeny"),
            ("ec2:RevokeSecurityGroupEgress", f"{EP}:security-group/sg-other", other, None, "implicitDeny"),
            ("ec2:UpdateSecurityGroupRuleDescriptionsIngress", f"{EP}:security-group/sg-other", other, None, "implicitDeny"),
            ("ec2:AuthorizeSecurityGroupIngress", f"{EP}:security-group-rule/sgr-untagged", reg, None, "implicitDeny"),
            ("ec2:RevokeSecurityGroupEgress", f"{EP}:security-group-rule/sgr-1", req, None, "implicitDeny"),
            ("ec2:UpdateSecurityGroupRuleDescriptionsIngress", f"{EP}:security-group-rule/sgr-1", req, None, "implicitDeny"),
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
            ("ec2:RevokeSecurityGroupIngress", f"{EP}:security-group/sg-1", res, None, "allowed"),
            ("ec2:AuthorizeSecurityGroupEgress", f"{EP}:security-group-rule/sgr-1", req, None, "allowed"),
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
            ("ec2:AuthorizeSecurityGroupIngress", f"{EP}:security-group/sg-untagged", reg, None, "implicitDeny"),
            ("ec2:RevokeSecurityGroupIngress", f"{EP}:security-group/sg-other", other, None, "implicitDeny"),
            ("ec2:UpdateSecurityGroupRuleDescriptionsEgress", f"{EP}:security-group/sg-other", other, None, "implicitDeny"),
            ("ec2:AuthorizeSecurityGroupIngress", f"{EP}:security-group-rule/sgr-untagged", reg, None, "implicitDeny"),
            ("ec2:RevokeSecurityGroupEgress", f"{EP}:security-group-rule/sgr-1", req, None, "implicitDeny"),
            ("ec2:UpdateSecurityGroupRuleDescriptionsIngress", f"{EP}:security-group-rule/sgr-1", req, None, "implicitDeny"),
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

    def test_combined_parent_sg_and_rule_authorization_matrix(self):
        role_pairs = (
            ("role_runtime_provisioner", self.pols["role_runtime_provisioner"], self.pols["boundary_runtime_provisioner"]),
            ("role_github_deploy", self.pols["role_github_deploy"], self.wb),
            ("role_github_recovery", self.pols["role_github_recovery"], self.wb),
        )
        for role_name, pol_doc, bnd_doc in role_pairs:
            for act in ("ec2:AuthorizeSecurityGroupIngress", "ec2:AuthorizeSecurityGroupEgress"):
                for label, ctx, exp_sg, exp_sgr, exp_comb in ibp.build_combined_sg_rule_scenarios(REGION):
                    with self.subTest(role=role_name, action=act, scenario=label):
                        res = ibp.eval_combined_sg_rule_operation(
                            sim, pol_doc, bnd_doc, act, f"{EP}:security-group/sg-eval", f"{EP}:security-group-rule/*", ctx
                        )
                        self.assertEqual((res["sg"], res["sgr"], res["combined"]), (exp_sg, exp_sgr, exp_comb))

    def test_runtime_provisioner_postgres_backup_verification_permissions_least_privilege(self):
        prov = self.pols["role_runtime_provisioner"]
        bnd = self.pols["boundary_runtime_provisioner"]
        tls = {"aws:SecureTransport": True, "aws:PrincipalAccount": ACCOUNT}
        cases = [
            # Narrowly scoped read/list on backups/postgres/* for pre-destroy head-object and history check
            ("s3:GetObject", f"{RC_ARN}/backups/postgres/backup_20261126T000000Z_i-1_abcdef123456.dump", tls, self.rc_rp, "allowed"),
            ("s3:GetObjectVersion", f"{RC_ARN}/backups/postgres/backup_20261126T000000Z_i-1_abcdef123456.dump", tls, self.rc_rp, "allowed"),
            ("s3:ListBucket", RC_ARN, {**tls, "s3:prefix": "backups/postgres/"}, self.rc_rp, "allowed"),
            # Least-privilege isolation: zero write/delete on backups/postgres/*, zero read/list on other recovery prefixes
            ("s3:PutObject", f"{RC_ARN}/backups/postgres/backup_20261126T000000Z_i-1_abcdef123456.dump", tls, self.rc_rp, "explicitDeny"),
            ("s3:DeleteObject", f"{RC_ARN}/backups/postgres/backup_20261126T000000Z_i-1_abcdef123456.dump", tls, self.rc_rp, "explicitDeny"),
            ("s3:GetObject", f"{RC_ARN}/backups/historical/legacy.sql", tls, self.rc_rp, "implicitDeny"),
            ("s3:GetObject", f"{RC_ARN}/lifecycle/alerts/alert.json", tls, self.rc_rp, "implicitDeny"),
            ("s3:ListBucket", RC_ARN, {**tls, "s3:prefix": "backups/historical/"}, self.rc_rp, "implicitDeny"),
            ("s3:ListBucket", RC_ARN, {**tls, "s3:prefix": "backups/"}, self.rc_rp, "implicitDeny"),
            ("s3:ListBucket", RC_ARN, {**tls, "s3:prefix": "lifecycle/"}, self.rc_rp, "implicitDeny"),
        ]
        for act, rsc, ctx, rp, exp in cases:
            with self.subTest(action=act, resource=rsc, ctx=ctx):
                self.assertEqual(sim.eval_iam_policy_local_harness(prov, act, rsc, ctx, rp, bnd), exp)

    def test_plan_safety_validator_fails_closed_on_sgr_wildcards_createtags_and_malformed_statements(self):
        # Verify all 5 actual Terraform-generated workload policies pass check_iam_resource_change_safety
        workload_map = {
            "aws_iam_role_policy.ec2_runtime": self.pols["role_ec2_runtime"],
            "aws_iam_role_policy.github_release": self.pols["role_github_release"],
            "aws_iam_role_policy.github_deploy": self.pols["role_github_deploy"],
            "aws_iam_role_policy.github_recovery": self.pols["role_github_recovery"],
            "aws_iam_role_policy.runtime_provisioner": self.pols["role_runtime_provisioner"],
        }
        checked_allow_count = 0
        for addr, doc in workload_map.items():
            rc = {"address": addr, "type": "aws_iam_role_policy", "change": {"actions": ["update"], "after": {"policy": json.dumps(doc)}}}
            self.assertEqual(plan_iam_safety.check_iam_resource_change_safety(rc), [], f"Valid rendered policy {addr} failed safety check")
            for st in doc["Statement"]:
                if st.get("Effect") == "Allow":
                    checked_allow_count += 1
                    self.assertEqual(ibp.validate_workload_allow_statement_safety(addr, st, ACCOUNT, REGION), [])
        self.assertGreaterEqual(checked_allow_count, 40)

        # Verify complete 10-ARN CreateTags allowlist succeeds
        req_cond = {"StringEquals": {"aws:RequestTag/Project": "EnvScale", "aws:RequestTag/Layer": "DisposableRuntime"}}
        all_allowed_create_arns = sorted(ibp.allowed_createtags_resource_arns(ACCOUNT, REGION))
        self.assertEqual(len(all_allowed_create_arns), 10)
        valid_stmts = [
            {"Sid": "SgRules", "Effect": "Allow", "Action": ["ec2:AuthorizeSecurityGroupIngress", "ec2:AuthorizeSecurityGroupEgress"], "Resource": f"{EP}:security-group-rule/*", "Condition": req_cond},
            {"Sid": "TagCreateAll10", "Effect": "Allow", "Action": "ec2:CreateTags", "Resource": all_allowed_create_arns, "Condition": {"StringEquals": {"ec2:CreateAction": sorted(ibp.ALLOWED_TAG_CREATE_ACTIONS), **req_cond["StringEquals"]}}},
        ]
        for valid_st in valid_stmts:
            rc_ok = {"address": "aws_iam_role_policy.runtime_provisioner", "type": "aws_iam_role_policy", "change": {"actions": ["update"], "after": {"policy": json.dumps({"Version": "2012-10-17", "Statement": [valid_st]})}}}
            self.assertEqual(plan_iam_safety.check_iam_resource_change_safety(rc_ok), [])

        tag_cond = {"StringEquals": {"ec2:CreateAction": ["CreateVpc", "RunInstances"], **req_cond["StringEquals"]}}
        bad_stmts = [
            ("unscoped_sgr", {"Effect": "Allow", "Action": ["ec2:AuthorizeSecurityGroupIngress"], "Resource": f"{EP}:security-group-rule/*", "Condition": {"StringEquals": {"aws:RequestedRegion": REGION}}}),
            ("createtags_without_createaction", {"Effect": "Allow", "Action": ["ec2:CreateTags"], "Resource": f"{EP}:security-group-rule/*", "Condition": req_cond}),
            ("createtags_mixed_with_sgr_action", {"Effect": "Allow", "Action": ["ec2:AuthorizeSecurityGroupIngress", "ec2:CreateTags"], "Resource": f"{EP}:security-group-rule/*", "Condition": {"StringEquals": {"ec2:CreateAction": ["AuthorizeSecurityGroupIngress"], **req_cond["StringEquals"]}}}),
            ("createtags_disallowed_createaction", {"Effect": "Allow", "Action": "ec2:CreateTags", "Resource": f"{EP}:security-group-rule/*", "Condition": {"StringEquals": {"ec2:CreateAction": ["ModifyVpcAttribute"], **req_cond["StringEquals"]}}}),
            ("createtags_unrecognized_resource_type", {"Effect": "Allow", "Action": "ec2:CreateTags", "Resource": f"{EP}:customer-gateway/*", "Condition": tag_cond}),
            ("createtags_foreign_account_arn", {"Effect": "Allow", "Action": "ec2:CreateTags", "Resource": f"arn:aws:ec2:{REGION}:111122223333:instance/*", "Condition": tag_cond}),
            ("createtags_wildcard_region_arn", {"Effect": "Allow", "Action": "ec2:CreateTags", "Resource": f"arn:aws:ec2:*:{ACCOUNT}:instance/*", "Condition": tag_cond}),
            ("createtags_wildcard_account_arn", {"Effect": "Allow", "Action": "ec2:CreateTags", "Resource": f"arn:aws:ec2:{REGION}:*:instance/*", "Condition": tag_cond}),
            ("createtags_wrong_region_arn", {"Effect": "Allow", "Action": "ec2:CreateTags", "Resource": f"arn:aws:ec2:us-east-1:{ACCOUNT}:instance/*", "Condition": tag_cond}),
            ("createtags_broad_star_arn", {"Effect": "Allow", "Action": "ec2:CreateTags", "Resource": "*", "Condition": tag_cond}),
            ("createtags_malformed_arn", {"Effect": "Allow", "Action": "ec2:CreateTags", "Resource": "not-an-arn", "Condition": tag_cond}),
            ("createtags_wildcard_action", {"Effect": "Allow", "Action": "ec2:Create*", "Resource": f"{EP}:instance/*", "Condition": tag_cond}),
            ("lifecycle_createtags_with_sgr", {"Effect": "Allow", "Action": ["ec2:CreateTags", "ec2:DeleteTags"], "Resource": f"{EP}:security-group-rule/*", "Condition": {"StringEquals": {"aws:ResourceTag/Project": "EnvScale", "aws:ResourceTag/Layer": "DisposableRuntime"}}}),
            ("lifecycle_createtags_foreign_arn", {"Effect": "Allow", "Action": ["ec2:CreateTags", "ec2:DeleteTags"], "Resource": f"arn:aws:ec2:{REGION}:111122223333:instance/*", "Condition": {"StringEquals": {"aws:ResourceTag/Project": "EnvScale", "aws:ResourceTag/Layer": "DisposableRuntime"}}}),
            ("wildcard_action_on_sgr", {"Effect": "Allow", "Action": ["ec2:AuthorizeSecurityGroup*"], "Resource": f"{EP}:security-group-rule/*", "Condition": req_cond}),
            ("broad_star_resource_sg_rule", {"Effect": "Allow", "Action": ["ec2:AuthorizeSecurityGroupIngress"], "Resource": "*", "Condition": req_cond}),
            ("mixed_resources_on_sgr", {"Effect": "Allow", "Action": ["ec2:AuthorizeSecurityGroupIngress"], "Resource": [f"{EP}:security-group-rule/*", f"{EP}:security-group/*"], "Condition": req_cond}),
            ("malformed_action_empty_list", {"Effect": "Allow", "Action": [], "Resource": f"{EP}:security-group-rule/*", "Condition": req_cond}),
            ("malformed_action_non_str", {"Effect": "Allow", "Action": [123], "Resource": f"{EP}:security-group-rule/*", "Condition": req_cond}),
            ("malformed_resource_none", {"Effect": "Allow", "Action": ["ec2:AuthorizeSecurityGroupIngress"], "Resource": None, "Condition": req_cond}),
            ("disallowed_not_action", {"Effect": "Allow", "NotAction": ["ec2:Describe*"], "Resource": f"{EP}:security-group-rule/*", "Condition": req_cond}),
            ("disallowed_not_resource", {"Effect": "Allow", "Action": ["ec2:AuthorizeSecurityGroupIngress"], "NotResource": f"{EP}:security-group/sg-1", "Condition": req_cond}),
            ("malformed_condition_string", {"Effect": "Allow", "Action": ["ec2:AuthorizeSecurityGroupIngress"], "Resource": f"{EP}:security-group-rule/*", "Condition": "not-a-dict"}),
            ("malformed_condition_list", {"Effect": "Allow", "Action": ["ec2:AuthorizeSecurityGroupIngress"], "Resource": f"{EP}:security-group-rule/*", "Condition": ["StringEquals"]}),
            ("malformed_condition_none", {"Effect": "Allow", "Action": ["ec2:AuthorizeSecurityGroupIngress"], "Resource": f"{EP}:security-group-rule/*", "Condition": None}),
            ("malformed_operator_non_dict", {"Effect": "Allow", "Action": ["ec2:AuthorizeSecurityGroupIngress"], "Resource": f"{EP}:security-group-rule/*", "Condition": {"StringEquals": "not-a-dict"}}),
            ("malformed_operator_empty_dict", {"Effect": "Allow", "Action": ["ec2:AuthorizeSecurityGroupIngress"], "Resource": f"{EP}:security-group-rule/*", "Condition": {"StringEquals": {}}}),
            ("malformed_condition_value_dict", {"Effect": "Allow", "Action": ["ec2:AuthorizeSecurityGroupIngress"], "Resource": f"{EP}:security-group-rule/*", "Condition": {"StringEquals": {"aws:RequestTag/Project": {"nested": "bad"}}}}),
            ("malformed_condition_value_none", {"Effect": "Allow", "Action": ["ec2:AuthorizeSecurityGroupIngress"], "Resource": f"{EP}:security-group-rule/*", "Condition": {"StringEquals": {"aws:RequestTag/Project": None}}}),
            ("malformed_condition_value_empty_list", {"Effect": "Allow", "Action": ["ec2:AuthorizeSecurityGroupIngress"], "Resource": f"{EP}:security-group-rule/*", "Condition": {"StringEquals": {"aws:RequestTag/Project": []}}}),
        ]
        for label, bad_st in bad_stmts:
            with self.subTest(case=label):
                rc_bad = {"address": "aws_iam_role_policy.runtime_provisioner", "type": "aws_iam_role_policy", "change": {"actions": ["update"], "after": {"policy": json.dumps({"Version": "2012-10-17", "Statement": [bad_st]})}}}
                self.assertTrue(plan_iam_safety.check_iam_resource_change_safety(rc_bad), f"Validator failed to reject {label}")

        # Document-level malformed Statement structures must return controlled errors, never raise
        for bad_doc_label, bad_doc in (
            ("root_list", [{"Effect": "Allow"}]),
            ("stmt_missing", {"Version": "2012-10-17"}),
            ("stmt_empty", {"Version": "2012-10-17", "Statement": []}),
            ("stmt_non_list", {"Version": "2012-10-17", "Statement": "bad"}),
            ("stmt_entry_non_dict", {"Version": "2012-10-17", "Statement": ["not-a-dict"]}),
            ("stmt_bad_effect", {"Version": "2012-10-17", "Statement": [{"Effect": "Maybe", "Action": "s3:GetObject", "Resource": "*"}]}),
        ):
            with self.subTest(doc_case=bad_doc_label):
                rc_doc = {"address": "aws_iam_role_policy.runtime_provisioner", "type": "aws_iam_role_policy", "change": {"actions": ["update"], "after": {"policy": json.dumps(bad_doc)}}}
                self.assertTrue(plan_iam_safety.check_iam_resource_change_safety(rc_doc), f"Validator failed to reject {bad_doc_label}")


if __name__ == "__main__":
    unittest.main()

