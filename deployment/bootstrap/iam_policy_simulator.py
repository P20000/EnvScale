#!/usr/bin/env python3
"""
EnvScale Phase 3 — IAM Policy Builder, Local Condition Harness & Live AWS Simulator.

Provides three distinct, non-conflated verification layers (100% read-only):
  1. `eval_iam_policy_local_harness()`: Explicitly labeled local offline condition
     evaluator supporting StringEquals, StringNotEquals, StringLike, Bool,
     BoolIfExists, Null, NumericLessThan, and ForAnyValue:StringEquals.
  2. `run_live_aws_iam_simulation()`: Invokes AWS's authoritative read-only
     `aws iam simulate-custom-policy` engine to verify real AWS IAM condition
     handling, tag scoping, foreign-account/TLS bucket policies, Day-0 & OIDC
     least-privilege boundaries, human break-glass MFA enforcement, and real
     Ubuntu 22.04 LTS AMI/snapshot RunInstances evaluation.
  3. `run_access_analyzer_validation()`: Invokes stateless `aws accessanalyzer validate-policy`
     across all identity, trust, Day-0, and S3 bucket policies.
"""

from __future__ import annotations

import fnmatch
import json
import pathlib
import re
import subprocess
import sys

_SCRIPT_DIR = str(pathlib.Path(__file__).resolve().parent)
if _SCRIPT_DIR not in sys.path:
    sys.path.insert(0, _SCRIPT_DIR)

from iam_boundary_policies import build_hardened_foundation_and_boundary_policies  # noqa: E402

ACCOUNT = "982534376726"
REGION = "ap-south-1"
TFSTATE_BUCKET = f"envscale-tfstate-{ACCOUNT}-{REGION}"
RECOVERY_BUCKET = f"envscale-recovery-{ACCOUNT}-{REGION}"
LEGACY_BUCKET = f"envscale-cloud-vault-{ACCOUNT}-{REGION}"
OIDC_ARN = f"arn:aws:iam::{ACCOUNT}:oidc-provider/token.actions.githubusercontent.com"
APPROVED_AMI_OWNERS = ["099720109477"]
LIVE_UBUNTU_AMI_ARN = f"arn:aws:ec2:{REGION}::image/ami-082a1ff88c78c6290"
LIVE_UBUNTU_SNAP_ARN = f"arn:aws:ec2:{REGION}::snapshot/snap-09eeb6885e00b8443"
LIVE_COEXISTING_EKS_ARN = f"arn:aws:eks:{REGION}:{ACCOUNT}:cluster/relmonition-cluster-cluster-20260611160523037300000001"


def _fail(msg: str) -> None:
    raise SystemExit(f"[FAIL] {msg}")


def build_rendered_foundation_policies(foundation_dir: pathlib.Path) -> dict[str, dict]:
    """Build exact JSON policies and verify key guard snippets against HCL files."""
    tfstate_arn = f"arn:aws:s3:::{TFSTATE_BUCKET}"
    rec_arn = f"arn:aws:s3:::{RECOVERY_BUCKET}"
    leg_arn = f"arn:aws:s3:::{LEGACY_BUCKET}"
    ssm_prod = f"arn:aws:ssm:{REGION}:{ACCOUNT}:parameter/envscale/prod/*"
    ssm_all = f"arn:aws:ssm:{REGION}:{ACCOUNT}:parameter/*"
    ssm_non_secret = [
        f"arn:aws:ssm:{REGION}:{ACCOUNT}:parameter/envscale/prod/{k}"
        for k in ("aws_region", "better_auth_url", "cors_origin", "duckdns_domain", "github_client_id", "google_client_id", "postgres_db", "postgres_user", "recovery_bucket")
    ]
    ssm_securestrings = [
        f"arn:aws:ssm:{REGION}:{ACCOUNT}:parameter/envscale/prod/{k}"
        for k in ("postgres_password", "redis_password", "jwt_access_secret", "jwt_refresh_secret", "better_auth_secret", "kubeconfig_encryption_key", "duckdns_token", "google_client_secret", "github_client_secret")
    ]
    ec2_role_arn = f"arn:aws:iam::{ACCOUNT}:role/envscale-ec2-runtime-role"
    ec2_prof_arn = f"arn:aws:iam::{ACCOUNT}:instance-profile/envscale-ec2-runtime-profile"

    hcl_parts = [
        (foundation_dir / name).read_text(encoding="utf-8")
        for name in ("iam_locals.tf", "iam_boundary.tf", "iam.tf", "iam_cicd.tf", "iam_admin.tf", "iam_foundation.tf", "iam_foundation_plan.tf", "storage.tf")
    ]
    combined_hcl = "\n".join(hcl_parts)

    required_snippets = [
        '"repo:${var.github_repository}:ref:refs/heads/${var.release_branch}"',
        '"repo:${var.github_repository}:environment:${var.production_environment_name}"',
        '"repo:${var.github_repository}:environment:${var.recovery_environment_name}"',
        '"repo:${var.github_repository}:environment:${var.foundation_environment_name}"',
        '"repo:${var.github_repository}:environment:${var.foundation_plan_environment_name}"',
        '"iam:PermissionsBoundary" = local.workload_boundary_policy_arn',
        '"iam:PolicyARN" = local.ssm_managed_core_policy_arn',
        "permissions_boundary = aws_iam_policy.workload_permissions_boundary.arn",
        '"aws:MultiFactorAuthPresent" = "true"',
        '"aws:MultiFactorAuthAge" = "3600"',
        '"arn:aws:ec2:${var.aws_region}::snapshot/*"',
        '"ec2:Owner" = var.approved_ami_owner_ids',
        '"arn:aws:eks:${var.aws_region}:${var.aws_account_id}:cluster/envscale-*"',
        '"arn:aws:eks:${var.aws_region}:${var.aws_account_id}:nodegroup/envscale-*/*/*"',
        '"aws:RequestTag/Project" = "EnvScale"',
        '"aws:ResourceTag/Project" = "EnvScale"',
        '"iam:PassedToService" = "ec2.amazonaws.com"',
        '"iam:PassedToService" = "eks.amazonaws.com"',
        "AllowBoundedPassEc2AndNodeRolesToEc2Only",
        "AllowBoundedPassEksClusterRoleToEksOnly",
        "DenyUnauthorizedBucketPolicyMutation",
        "prevent_destroy = true",
    ]
    for snip in required_snippets:
        if snip not in combined_hcl:
            _fail(f"Missing required HCL guard snippet: {snip}")

    if "bucket_key_enabled" in (foundation_dir / "storage.tf").read_text(encoding="utf-8"):
        _fail("Regression: bucket_key_enabled found in storage.tf SSE-S3 configuration!")
    admin_hcl = (foundation_dir / "iam_admin.tf").read_text(encoding="utf-8")
    if "DenyAllActionsWithoutMFA" in admin_hcl:
        _fail("Regression: DenyAllActionsWithoutMFA must not exist on AssumeRole permissions policy in iam_admin.tf!")
    if "AllowSSMKmsKeyDescribe" not in admin_hcl:
        _fail("Missing direct scoped AllowSSMKmsKeyDescribe statement in iam_admin.tf!")
    found_hcl = (foundation_dir / "iam_foundation.tf").read_text(encoding="utf-8")
    found_code = "\n".join(ln for ln in found_hcl.splitlines() if not ln.lstrip().startswith("#"))
    if "MultiFactorAuthPresent" in found_code:
        _fail("Automated OIDC role iam_foundation.tf must NOT require aws:MultiFactorAuthPresent!")
    if "role/envscale-*" in found_code or "instance-profile/envscale-*" in found_code:
        _fail("iam_foundation.tf must enumerate explicit IAM resources instead of role/envscale-* wildcards!")

    for m in re.finditer(r"assume_role_policy\s*=\s*jsonencode\(\{(.*?)\n  \}\)", combined_hcl, flags=re.S):
        if "StringLike" in m.group(1):
            _fail("assume_role_policy must never use StringLike!")

    day0_policy_path = foundation_dir.parent / "bootstrap" / "day0-bootstrap-policy.json"
    day0_policy = json.loads(day0_policy_path.read_text(encoding="utf-8"))

    ec2_tagged_arns = [
        f"arn:aws:ec2:{REGION}:{ACCOUNT}:{rt}/*"
        for rt in ("vpc", "subnet", "internet-gateway", "route-table", "security-group", "instance", "volume", "network-interface")
    ]
    eks_scoped_arns = [
        f"arn:aws:eks:{REGION}:{ACCOUNT}:cluster/envscale-*",
        f"arn:aws:eks:{REGION}:{ACCOUNT}:nodegroup/envscale-*/*/*",
    ]
    req_envscale = {"StringEquals": {"aws:RequestTag/Project": "EnvScale", "aws:RequestTag/Layer": "DisposableRuntime"}}
    res_envscale = {"StringEquals": {"aws:ResourceTag/Project": "EnvScale", "aws:ResourceTag/Layer": "DisposableRuntime"}}

    shared_tfstate = [
        {"Sid": "AllowTfstateListScoped", "Effect": "Allow", "Action": ["s3:ListBucket"], "Resource": tfstate_arn, "Condition": {"StringLike": {"s3:prefix": ["runtime/*", "eks/*", "foundation/terraform.tfstate"]}}},
        {"Sid": "AllowTfstateBucketLocation", "Effect": "Allow", "Action": ["s3:GetBucketLocation"], "Resource": tfstate_arn},
        {"Sid": "AllowFoundationStateReadOnly", "Effect": "Allow", "Action": ["s3:GetObject"], "Resource": f"{tfstate_arn}/foundation/terraform.tfstate"},
        {"Sid": "AllowRuntimeAndEksStateReadWrite", "Effect": "Allow", "Action": ["s3:GetObject", "s3:PutObject"], "Resource": [f"{tfstate_arn}/runtime/terraform.tfstate", f"{tfstate_arn}/eks/terraform.tfstate"]},
        {"Sid": "AllowRuntimeAndEksNativeLockFiles", "Effect": "Allow", "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"], "Resource": [f"{tfstate_arn}/runtime/terraform.tfstate.tflock", f"{tfstate_arn}/eks/terraform.tfstate.tflock"]},
    ]
    shared_ec2_prov = [
        {"Sid": "AllowCreateTaggedTopLevelRuntimeResources", "Effect": "Allow", "Action": ["ec2:CreateVpc", "ec2:CreateInternetGateway", "ec2:CreateVolume"], "Resource": [f"arn:aws:ec2:{REGION}:{ACCOUNT}:vpc/*", f"arn:aws:ec2:{REGION}:{ACCOUNT}:internet-gateway/*", f"arn:aws:ec2:{REGION}:{ACCOUNT}:volume/*"], "Condition": req_envscale},
        {"Sid": "AllowCreateTaggedVpcChildResources", "Effect": "Allow", "Action": ["ec2:CreateSubnet", "ec2:CreateRouteTable", "ec2:CreateSecurityGroup"], "Resource": [f"arn:aws:ec2:{REGION}:{ACCOUNT}:subnet/*", f"arn:aws:ec2:{REGION}:{ACCOUNT}:route-table/*", f"arn:aws:ec2:{REGION}:{ACCOUNT}:security-group/*"], "Condition": req_envscale},
        {"Sid": "AllowVpcParentForChildResourceCreation", "Effect": "Allow", "Action": ["ec2:CreateSubnet", "ec2:CreateRouteTable", "ec2:CreateSecurityGroup"], "Resource": f"arn:aws:ec2:{REGION}:{ACCOUNT}:vpc/*", "Condition": res_envscale},
        {"Sid": "AllowRunInstancesTaggedInstanceAndVolume", "Effect": "Allow", "Action": ["ec2:RunInstances"], "Resource": [f"arn:aws:ec2:{REGION}:{ACCOUNT}:instance/*", f"arn:aws:ec2:{REGION}:{ACCOUNT}:volume/*"], "Condition": req_envscale},
        {"Sid": "AllowRunInstancesInEnvScaleSubnetAndSg", "Effect": "Allow", "Action": ["ec2:RunInstances"], "Resource": [f"arn:aws:ec2:{REGION}:{ACCOUNT}:subnet/*", f"arn:aws:ec2:{REGION}:{ACCOUNT}:security-group/*"], "Condition": res_envscale},
        {"Sid": "AllowRunInstancesTaggedNewEni", "Effect": "Allow", "Action": ["ec2:RunInstances"], "Resource": f"arn:aws:ec2:{REGION}:{ACCOUNT}:network-interface/*", "Condition": req_envscale},
        {"Sid": "AllowRunInstancesTaggedExistingEni", "Effect": "Allow", "Action": ["ec2:RunInstances"], "Resource": f"arn:aws:ec2:{REGION}:{ACCOUNT}:network-interface/*", "Condition": res_envscale},
        {"Sid": "AllowRunInstancesApprovedAmiAndSnapshot", "Effect": "Allow", "Action": ["ec2:RunInstances"], "Resource": [f"arn:aws:ec2:{REGION}::image/*", f"arn:aws:ec2:{REGION}::snapshot/*"], "Condition": {"StringEquals": {"ec2:Owner": APPROVED_AMI_OWNERS}}},
        {"Sid": "AllowTagOnCreateForRuntimeResources", "Effect": "Allow", "Action": ["ec2:CreateTags"], "Resource": ec2_tagged_arns + [f"arn:aws:ec2:{REGION}:{ACCOUNT}:security-group-rule/*"], "Condition": {"StringEquals": {"ec2:CreateAction": ["CreateVpc", "CreateSubnet", "CreateInternetGateway", "CreateRouteTable", "CreateSecurityGroup", "AuthorizeSecurityGroupIngress", "AuthorizeSecurityGroupEgress", "CreateVolume", "RunInstances"], "aws:RequestTag/Project": "EnvScale", "aws:RequestTag/Layer": "DisposableRuntime"}}},
        {"Sid": "AllowNonDestructiveTaggedRuntimeOperations", "Effect": "Allow", "Action": ["ec2:ModifyVpcAttribute", "ec2:ModifySubnetAttribute", "ec2:AttachInternetGateway", "ec2:CreateRoute", "ec2:ReplaceRoute", "ec2:AssociateRouteTable", "ec2:AuthorizeSecurityGroupIngress", "ec2:AuthorizeSecurityGroupEgress", "ec2:RevokeSecurityGroupIngress", "ec2:RevokeSecurityGroupEgress", "ec2:UpdateSecurityGroupRuleDescriptionsIngress", "ec2:UpdateSecurityGroupRuleDescriptionsEgress", "ec2:StartInstances", "ec2:StopInstances", "ec2:RebootInstances", "ec2:ModifyInstanceAttribute", "ec2:ModifyInstanceMetadataOptions", "ec2:ModifyVolume", "ec2:AttachVolume", "ec2:AssociateAddress", "ec2:DisassociateAddress", "ec2:CreateTags", "ec2:DeleteTags"], "Resource": ec2_tagged_arns, "Condition": res_envscale},
        {"Sid": "AllowSecurityGroupRuleSubresourceManagement", "Effect": "Allow", "Action": ["ec2:AuthorizeSecurityGroupIngress", "ec2:AuthorizeSecurityGroupEgress", "ec2:RevokeSecurityGroupIngress", "ec2:RevokeSecurityGroupEgress", "ec2:UpdateSecurityGroupRuleDescriptionsIngress", "ec2:UpdateSecurityGroupRuleDescriptionsEgress"], "Resource": f"arn:aws:ec2:{REGION}:{ACCOUNT}:security-group-rule/*", "Condition": {"StringEquals": {"aws:RequestedRegion": REGION}}},
        {"Sid": "AllowFoundationStaticEipAssociation", "Effect": "Allow", "Action": ["ec2:AssociateAddress", "ec2:DisassociateAddress"], "Resource": f"arn:aws:ec2:{REGION}:{ACCOUNT}:elastic-ip/*", "Condition": {"StringEquals": {"aws:ResourceTag/Project": "EnvScale"}}},
    ]
    shared_ssm_cmd = [
        {"Sid": "AllowSSMSendCommandRunShellDocument", "Effect": "Allow", "Action": ["ssm:SendCommand"], "Resource": f"arn:aws:ssm:{REGION}::document/AWS-RunShellScript"},
        {"Sid": "AllowSSMSendCommandDisposableRuntimeInstances", "Effect": "Allow", "Action": ["ssm:SendCommand"], "Resource": f"arn:aws:ec2:{REGION}:{ACCOUNT}:instance/*", "Condition": res_envscale},
    ]
    shared_tag_denies = [
        {"Sid": "DenyDeletingGovernanceOwnershipTags", "Effect": "Deny", "Action": ["ec2:DeleteTags", "eks:UntagResource"], "Resource": "*", "Condition": {"ForAnyValue:StringEquals": {"aws:TagKeys": ["Project", "Layer"]}}},
        {"Sid": "DenyMutatingProjectTagValue", "Effect": "Deny", "Action": ["ec2:CreateTags", "eks:TagResource"], "Resource": "*", "Condition": {"Null": {"aws:RequestTag/Project": "false"}, "StringNotEquals": {"aws:RequestTag/Project": "EnvScale"}}},
        {"Sid": "DenyMutatingLayerTagValue", "Effect": "Deny", "Action": ["ec2:CreateTags", "eks:TagResource"], "Resource": "*", "Condition": {"Null": {"aws:RequestTag/Layer": "false"}, "StringNotEquals": {"aws:RequestTag/Layer": "DisposableRuntime"}}},
    ]

    policies = {
        "day0_bootstrap": day0_policy,
        "recovery_bucket_policy": {
            "Version": "2012-10-17",
            "Statement": [
                {"Sid": "DenyInsecureTransport", "Effect": "Deny", "Principal": "*", "Action": ["s3:*"], "Resource": [rec_arn, f"{rec_arn}/*"], "Condition": {"Bool": {"aws:SecureTransport": "false"}}},
                {"Sid": "DenyForeignAccountPrincipals", "Effect": "Deny", "Principal": "*", "Action": ["s3:*"], "Resource": [rec_arn, f"{rec_arn}/*"], "Condition": {"Null": {"aws:PrincipalAccount": "false"}, "StringNotEquals": {"aws:PrincipalAccount": ACCOUNT}}},
                {"Sid": "DenyBucketAndObjectVersionDestruction", "Effect": "Deny", "Principal": "*", "Action": ["s3:DeleteBucket", "s3:DeleteObjectVersion", "s3:DeleteBucketPolicy"], "Resource": [rec_arn, f"{rec_arn}/*"]},
                {"Sid": "DenyUnauthorizedBucketPolicyMutation", "Effect": "Deny", "Principal": "*", "Action": ["s3:PutBucketPolicy"], "Resource": [rec_arn, f"{rec_arn}/*"], "Condition": {"ArnNotLike": {"aws:PrincipalArn": [f"arn:aws:sts::{ACCOUNT}:assumed-role/envscale-github-foundation-role/*", f"arn:aws:iam::{ACCOUNT}:role/envscale-github-foundation-role", f"arn:aws:sts::{ACCOUNT}:assumed-role/envscale-foundation-admin-role/*", f"arn:aws:iam::{ACCOUNT}:role/envscale-foundation-admin-role"]}}},
                {"Sid": "DenyBackupAndReleaseObjectDeletion", "Effect": "Deny", "Principal": "*", "Action": ["s3:DeleteObject"], "Resource": [f"{rec_arn}/backups/*", f"{rec_arn}/releases/*"]},
            ],
        },
        "trust_ec2_runtime": {"Version": "2012-10-17", "Statement": [{"Sid": "AllowEC2ServiceAssumeRoleInAccount", "Effect": "Allow", "Principal": {"Service": "ec2.amazonaws.com"}, "Action": "sts:AssumeRole", "Condition": {"StringEquals": {"aws:SourceAccount": ACCOUNT}}}]},
        "trust_github_release": {"Version": "2012-10-17", "Statement": [{"Sid": "AllowGitHubDevelopBranchOIDC", "Effect": "Allow", "Principal": {"Federated": OIDC_ARN}, "Action": "sts:AssumeRoleWithWebIdentity", "Condition": {"StringEquals": {"token.actions.githubusercontent.com:aud": "sts.amazonaws.com", "token.actions.githubusercontent.com:sub": "repo:P20000/EnvScale:ref:refs/heads/develop"}}}]},
        "trust_github_deploy": {"Version": "2012-10-17", "Statement": [{"Sid": "AllowGitHubProductionEnvironmentOIDC", "Effect": "Allow", "Principal": {"Federated": OIDC_ARN}, "Action": "sts:AssumeRoleWithWebIdentity", "Condition": {"StringEquals": {"token.actions.githubusercontent.com:aud": "sts.amazonaws.com", "token.actions.githubusercontent.com:sub": "repo:P20000/EnvScale:environment:production"}}}]},
        "trust_github_recovery": {"Version": "2012-10-17", "Statement": [{"Sid": "AllowGitHubRecoveryEnvironmentOIDC", "Effect": "Allow", "Principal": {"Federated": OIDC_ARN}, "Action": "sts:AssumeRoleWithWebIdentity", "Condition": {"StringEquals": {"token.actions.githubusercontent.com:aud": "sts.amazonaws.com", "token.actions.githubusercontent.com:sub": "repo:P20000/EnvScale:environment:recovery"}}}]},
        "trust_github_foundation": {"Version": "2012-10-17", "Statement": [{"Sid": "AllowGitHubFoundationEnvironmentOIDC", "Effect": "Allow", "Principal": {"Federated": OIDC_ARN}, "Action": "sts:AssumeRoleWithWebIdentity", "Condition": {"StringEquals": {"token.actions.githubusercontent.com:aud": "sts.amazonaws.com", "token.actions.githubusercontent.com:sub": "repo:P20000/EnvScale:environment:foundation"}}}]},
        "trust_foundation_admin": {"Version": "2012-10-17", "Statement": [{"Sid": "AllowSameAccountHumanOperatorsWithRecentMFAOnly", "Effect": "Allow", "Principal": {"AWS": [f"arn:aws:iam::{ACCOUNT}:user/DEV-user-alpha"]}, "Action": "sts:AssumeRole", "Condition": {"Bool": {"aws:MultiFactorAuthPresent": "true"}, "NumericLessThan": {"aws:MultiFactorAuthAge": "3600"}}}]},
        "role_ec2_runtime": {
            "Version": "2012-10-17",
            "Statement": [
                {"Sid": "AllowSSMProdParameterRead", "Effect": "Allow", "Action": ["ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath"], "Resource": ssm_prod},
                {"Sid": "AllowSSMKmsDecryptViaSSMOnly", "Effect": "Allow", "Action": ["kms:Decrypt"], "Resource": f"arn:aws:kms:{REGION}:{ACCOUNT}:key/*", "Condition": {"StringEquals": {"kms:ViaService": f"ssm.{REGION}.amazonaws.com"}}},
                {"Sid": "AllowRecoveryReleasesAndHistoricalReadOnly", "Effect": "Allow", "Action": ["s3:GetObject", "s3:GetObjectVersion"], "Resource": [f"{rec_arn}/releases/*", f"{rec_arn}/backups/historical/*"]},
                {"Sid": "AllowRecoveryPostgresBackupsAndAlertsRW", "Effect": "Allow", "Action": ["s3:GetObject", "s3:GetObjectVersion", "s3:PutObject"], "Resource": [f"{rec_arn}/backups/postgres/*", f"{rec_arn}/lifecycle/alerts/*"]},
                {"Sid": "AllowRecoveryBucketLocation", "Effect": "Allow", "Action": ["s3:GetBucketLocation"], "Resource": rec_arn},
                {"Sid": "AllowRecoveryBucketListScoped", "Effect": "Allow", "Action": ["s3:ListBucket"], "Resource": rec_arn, "Condition": {"StringLike": {"s3:prefix": ["backups/postgres/*", "backups/historical/*", "lifecycle/alerts/*", "releases/*"]}}},
                {"Sid": "DenyAllSSMMutations", "Effect": "Deny", "Action": ["ssm:PutParameter", "ssm:DeleteParameter", "ssm:DeleteParameters", "ssm:LabelParameterVersion"], "Resource": ssm_all},
                {"Sid": "DenyReleaseAndHistoricalWrites", "Effect": "Deny", "Action": ["s3:PutObject"], "Resource": [f"{rec_arn}/releases/*", f"{rec_arn}/backups/historical/*"]},
                {"Sid": "DenyAllRecoveryDeletions", "Effect": "Deny", "Action": ["s3:DeleteObject", "s3:DeleteObjectVersion", "s3:DeleteBucket", "s3:DeleteBucketPolicy", "s3:PutBucketPolicy"], "Resource": [rec_arn, f"{rec_arn}/*"]},
                {"Sid": "DenyTfstateAndLegacyVaultAccess", "Effect": "Deny", "Action": ["s3:*"], "Resource": [tfstate_arn, f"{tfstate_arn}/*", leg_arn, f"{leg_arn}/*"]},
            ],
        },
        "role_github_release": {
            "Version": "2012-10-17",
            "Statement": [
                {"Sid": "AllowImmutableReleaseArtifactUploadAndVerify", "Effect": "Allow", "Action": ["s3:PutObject", "s3:GetObject", "s3:GetObjectVersion"], "Resource": f"{rec_arn}/releases/*"},
                {"Sid": "AllowRecoveryBucketLocation", "Effect": "Allow", "Action": ["s3:GetBucketLocation"], "Resource": rec_arn},
                {"Sid": "DenyKnownGoodPointerWrites", "Effect": "Deny", "Action": ["s3:PutObject", "s3:DeleteObject", "s3:DeleteObjectVersion"], "Resource": [f"{rec_arn}/releases/latest-known-good.json", f"{rec_arn}/releases/previous-known-good.json"]},
                {"Sid": "DenyAllS3Deletions", "Effect": "Deny", "Action": ["s3:DeleteObject", "s3:DeleteObjectVersion", "s3:DeleteBucket", "s3:DeleteBucketPolicy", "s3:PutBucketPolicy"], "Resource": [rec_arn, f"{rec_arn}/*"]},
                {"Sid": "DenyNonReleasePrefixesTfstateAndLegacyVault", "Effect": "Deny", "Action": ["s3:*"], "Resource": [f"{rec_arn}/backups/*", f"{rec_arn}/lifecycle/*", tfstate_arn, f"{tfstate_arn}/*", leg_arn, f"{leg_arn}/*"]},
            ],
        },
        "role_github_deploy": {
            "Version": "2012-10-17",
            "Statement": shared_tfstate + [
                {"Sid": "AllowRecoveryListScoped", "Effect": "Allow", "Action": ["s3:ListBucket"], "Resource": rec_arn, "Condition": {"StringLike": {"s3:prefix": ["releases/*", "lifecycle/*", "backups/*"]}}},
                {"Sid": "AllowRecoveryBucketLocation", "Effect": "Allow", "Action": ["s3:GetBucketLocation"], "Resource": rec_arn},
                {"Sid": "AllowRecoveryReleasesAndLifecycleRW", "Effect": "Allow", "Action": ["s3:GetObject", "s3:GetObjectVersion", "s3:PutObject"], "Resource": [f"{rec_arn}/releases/*", f"{rec_arn}/lifecycle/*"]},
                {"Sid": "AllowRecoveryLifecycleLockRelease", "Effect": "Allow", "Action": ["s3:DeleteObject"], "Resource": f"{rec_arn}/lifecycle/active-op.lock"},
                {"Sid": "AllowRecoveryBackupsReadOnly", "Effect": "Allow", "Action": ["s3:GetObject", "s3:GetObjectVersion"], "Resource": f"{rec_arn}/backups/*"},
                {"Sid": "AllowRegionalMetadataDescribeOnly", "Effect": "Allow", "Action": ["ec2:Describe*", "ssm:DescribeParameters", "ssm:DescribeInstanceInformation", "ssm:ListCommandInvocations", "ssm:GetCommandInvocation"], "Resource": "*", "Condition": {"StringEquals": {"aws:RequestedRegion": REGION}}},
                {"Sid": "AllowGetEc2RuntimeRoleAndProfile", "Effect": "Allow", "Action": ["iam:GetRole", "iam:GetInstanceProfile"], "Resource": [ec2_role_arn, ec2_prof_arn]},
                {"Sid": "AllowPassEc2RuntimeRoleToEc2Only", "Effect": "Allow", "Action": ["iam:PassRole"], "Resource": ec2_role_arn, "Condition": {"StringEquals": {"iam:PassedToService": "ec2.amazonaws.com"}}},
            ] + shared_ec2_prov + shared_ssm_cmd + shared_tag_denies + [
                {"Sid": "DenyFoundationStateMutation", "Effect": "Deny", "Action": ["s3:PutObject", "s3:DeleteObject", "s3:DeleteObjectVersion"], "Resource": f"{tfstate_arn}/foundation/*"},
                {"Sid": "DenyTfstateObjectDeletion", "Effect": "Deny", "Action": ["s3:DeleteObject", "s3:DeleteObjectVersion"], "Resource": f"{tfstate_arn}/*.tfstate"},
                {"Sid": "DenyBucketAndVersionDeletion", "Effect": "Deny", "Action": ["s3:DeleteBucket", "s3:DeleteBucketPolicy", "s3:PutBucketPolicy", "s3:DeleteObjectVersion"], "Resource": [tfstate_arn, f"{tfstate_arn}/*", rec_arn, f"{rec_arn}/*"]},
                {"Sid": "DenyBackupMutationsAndDeletions", "Effect": "Deny", "Action": ["s3:PutObject", "s3:DeleteObject"], "Resource": f"{rec_arn}/backups/*"},
                {"Sid": "DenyReleaseArtifactDeletion", "Effect": "Deny", "Action": ["s3:DeleteObject"], "Resource": f"{rec_arn}/releases/*"},
                {"Sid": "DenyLegacyVaultAccess", "Effect": "Deny", "Action": ["s3:*"], "Resource": [leg_arn, f"{leg_arn}/*"]},
                {"Sid": "DenyDestructiveComputeAndEipRelease", "Effect": "Deny", "Action": ["ec2:TerminateInstances", "ec2:DeleteVolume", "ec2:DeleteVpc", "ec2:DeleteSubnet", "ec2:DeleteSecurityGroup", "ec2:DeleteRouteTable", "ec2:DeleteInternetGateway", "ec2:ReleaseAddress"], "Resource": "*"},
                {"Sid": "DenySSMParameterValuesAndMutations", "Effect": "Deny", "Action": ["ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath", "ssm:PutParameter", "ssm:DeleteParameter", "ssm:DeleteParameters"], "Resource": ssm_all},
            ],
        },
        "role_github_recovery": {
            "Version": "2012-10-17",
            "Statement": shared_tfstate + [
                {"Sid": "AllowRecoveryListScoped", "Effect": "Allow", "Action": ["s3:ListBucket"], "Resource": rec_arn, "Condition": {"StringLike": {"s3:prefix": ["backups/*", "releases/*", "lifecycle/*"]}}},
                {"Sid": "AllowRecoveryBucketLocation", "Effect": "Allow", "Action": ["s3:GetBucketLocation"], "Resource": rec_arn},
                {"Sid": "AllowRecoveryBackupsAndReleasesReadOnly", "Effect": "Allow", "Action": ["s3:GetObject", "s3:GetObjectVersion"], "Resource": [f"{rec_arn}/backups/*", f"{rec_arn}/releases/*"]},
                {"Sid": "AllowRecoveryLifecycleAndPointerWrite", "Effect": "Allow", "Action": ["s3:PutObject"], "Resource": [f"{rec_arn}/lifecycle/*", f"{rec_arn}/releases/latest-known-good.json", f"{rec_arn}/releases/previous-known-good.json", f"{rec_arn}/backups/postgres/latest-valid.json"]},
                {"Sid": "AllowRecoveryLifecycleLockRelease", "Effect": "Allow", "Action": ["s3:DeleteObject"], "Resource": f"{rec_arn}/lifecycle/active-op.lock"},
                {"Sid": "AllowRegionalMetadataDescribeOnly", "Effect": "Allow", "Action": ["ec2:Describe*", "eks:DescribeCluster", "eks:DescribeNodegroup", "eks:ListClusters", "eks:ListNodegroups", "ssm:DescribeParameters", "ssm:DescribeInstanceInformation", "ssm:ListCommandInvocations", "ssm:GetCommandInvocation"], "Resource": "*", "Condition": {"StringEquals": {"aws:RequestedRegion": REGION}}},
                {"Sid": "AllowTaggedRuntimeDestruction", "Effect": "Allow", "Action": ["ec2:TerminateInstances", "ec2:DetachVolume", "ec2:DeleteVolume", "ec2:DeleteSecurityGroup", "ec2:DisassociateRouteTable", "ec2:DeleteRoute", "ec2:DeleteRouteTable", "ec2:DetachInternetGateway", "ec2:DeleteInternetGateway", "ec2:DeleteSubnet", "ec2:DeleteVpc"], "Resource": ec2_tagged_arns, "Condition": res_envscale},
                {"Sid": "AllowEnvScaleEksClusterCreation", "Effect": "Allow", "Action": ["eks:CreateCluster"], "Resource": f"arn:aws:eks:{REGION}:{ACCOUNT}:cluster/envscale-*", "Condition": req_envscale},
                {"Sid": "AllowEnvScaleEksNodegroupCreation", "Effect": "Allow", "Action": ["eks:CreateNodegroup"], "Resource": eks_scoped_arns, "Condition": {"StringEquals": {"aws:ResourceTag/Project": "EnvScale", "aws:ResourceTag/Layer": "DisposableRuntime", "aws:RequestTag/Project": "EnvScale", "aws:RequestTag/Layer": "DisposableRuntime"}}},
                {"Sid": "AllowEnvScaleEksTaggedLifecycleAndDelete", "Effect": "Allow", "Action": ["eks:DeleteCluster", "eks:DeleteNodegroup", "eks:UpdateClusterConfig", "eks:UpdateNodegroupConfig", "eks:UntagResource"], "Resource": eks_scoped_arns, "Condition": res_envscale},
                {"Sid": "AllowEnvScaleEksTaggedResourceTagging", "Effect": "Allow", "Action": ["eks:TagResource"], "Resource": eks_scoped_arns, "Condition": {"StringEquals": {"aws:ResourceTag/Project": "EnvScale", "aws:ResourceTag/Layer": "DisposableRuntime", "aws:RequestTag/Project": "EnvScale", "aws:RequestTag/Layer": "DisposableRuntime"}}},
                {"Sid": "AllowGetRuntimeAndEksRoles", "Effect": "Allow", "Action": ["iam:GetRole", "iam:GetInstanceProfile"], "Resource": [ec2_role_arn, ec2_prof_arn, f"arn:aws:iam::{ACCOUNT}:role/envscale-eks-*"]},
                {"Sid": "AllowPassEc2AndNodeRolesToEc2Only", "Effect": "Allow", "Action": ["iam:PassRole"], "Resource": [ec2_role_arn, f"arn:aws:iam::{ACCOUNT}:role/envscale-eks-node-*"], "Condition": {"StringEquals": {"iam:PassedToService": "ec2.amazonaws.com"}}},
                {"Sid": "AllowPassEksClusterRoleToEksOnly", "Effect": "Allow", "Action": ["iam:PassRole"], "Resource": f"arn:aws:iam::{ACCOUNT}:role/envscale-eks-cluster-*", "Condition": {"StringEquals": {"iam:PassedToService": "eks.amazonaws.com"}}},
            ] + shared_ec2_prov + shared_ssm_cmd + shared_tag_denies + [
                {"Sid": "DenyFoundationStaticEipRelease", "Effect": "Deny", "Action": ["ec2:ReleaseAddress"], "Resource": "*"},
                {"Sid": "DenyFoundationStateMutation", "Effect": "Deny", "Action": ["s3:PutObject", "s3:DeleteObject", "s3:DeleteObjectVersion"], "Resource": f"{tfstate_arn}/foundation/*"},
                {"Sid": "DenyTfstateObjectDeletion", "Effect": "Deny", "Action": ["s3:DeleteObject", "s3:DeleteObjectVersion"], "Resource": f"{tfstate_arn}/*.tfstate"},
                {"Sid": "DenyBucketAndVersionDestruction", "Effect": "Deny", "Action": ["s3:DeleteBucket", "s3:DeleteBucketPolicy", "s3:PutBucketPolicy", "s3:DeleteObjectVersion"], "Resource": [tfstate_arn, f"{tfstate_arn}/*", rec_arn, f"{rec_arn}/*"]},
                {"Sid": "DenyBackupArchiveWritesAndAllBackupDeletions", "Effect": "Deny", "Action": ["s3:PutObject"], "Resource": [f"{rec_arn}/backups/historical/*", f"{rec_arn}/backups/postgres/archive/*"]},
                {"Sid": "DenyBackupDeletions", "Effect": "Deny", "Action": ["s3:DeleteObject"], "Resource": f"{rec_arn}/backups/*"},
                {"Sid": "DenyReleaseArtifactDeletion", "Effect": "Deny", "Action": ["s3:DeleteObject"], "Resource": f"{rec_arn}/releases/*"},
                {"Sid": "DenyLegacyVaultAccess", "Effect": "Deny", "Action": ["s3:*"], "Resource": [leg_arn, f"{leg_arn}/*"]},
                {"Sid": "DenySSMParameterValuesAndMutations", "Effect": "Deny", "Action": ["ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath", "ssm:PutParameter", "ssm:DeleteParameter", "ssm:DeleteParameters"], "Resource": ssm_all},
                {"Sid": "DenyFoundationIAMMutations", "Effect": "Deny", "Action": ["iam:Delete*", "iam:PutRolePolicy", "iam:AttachRolePolicy", "iam:DetachRolePolicy", "iam:UpdateAssumeRolePolicy"], "Resource": [f"arn:aws:iam::{ACCOUNT}:role/envscale-ec2-runtime-role", f"arn:aws:iam::{ACCOUNT}:role/envscale-foundation-admin-role", f"arn:aws:iam::{ACCOUNT}:role/envscale-github-*", f"arn:aws:iam::{ACCOUNT}:instance-profile/envscale-*", f"arn:aws:iam::{ACCOUNT}:oidc-provider/*"]},
            ],
        },
    }
    policies.update(
        build_hardened_foundation_and_boundary_policies(
            foundation_dir, tfstate_arn, rec_arn, leg_arn, ssm_prod, ssm_non_secret, ssm_securestrings
        )
    )
    return policies


def _eval_condition_block(cond_block: dict, ctx: dict[str, object]) -> bool:
    for op, kv in cond_block.items():
        for k, expected in kv.items():
            vals = expected if isinstance(expected, list) else [expected]
            present = k in ctx and ctx[k] is not None
            actual = ctx.get(k)
            if op == "Null":
                want_null = str(vals[0]).lower() == "true"
                if want_null != (not present):
                    return False
            elif op == "Bool":
                if not present or str(actual).lower() not in [str(v).lower() for v in vals]:
                    return False
            elif op == "BoolIfExists":
                if present and str(actual).lower() not in [str(v).lower() for v in vals]:
                    return False
            elif op in ("StringEquals", "StringEqualsIfExists", "ArnEquals", "ArnEqualsIfExists"):
                if op in ("StringEquals", "ArnEquals") and not present:
                    return False
                if present and str(actual) not in [str(v) for v in vals]:
                    return False
            elif op in ("StringNotEquals", "StringNotEqualsIfExists"):
                if present and any(str(actual) == str(v) for v in vals):
                    return False
            elif op in ("ArnNotEquals", "ArnNotLike", "StringNotLike"):
                if present and any(fnmatch.fnmatchcase(str(actual), str(p)) for p in vals):
                    return False
            elif op == "StringLike":
                if not present or not any(fnmatch.fnmatchcase(str(actual), str(p)) for p in vals):
                    return False
            elif op == "NumericLessThan":
                if not present or float(str(actual)) >= float(str(vals[0])):
                    return False
            elif op == "ForAnyValue:StringEquals":
                actual_list = actual if isinstance(actual, list) else ([actual] if present else [])
                if not any(str(item) in [str(v) for v in vals] for item in actual_list):
                    return False
            else:
                _fail(f"Local condition harness encountered unhandled operator: {op}")
    return True


def _eval_identity_doc(policy_doc: dict, action: str, resource: str, ctx: dict[str, object]) -> str:
    matched_allow = False
    for stmt in policy_doc["Statement"]:
        acts = stmt["Action"] if isinstance(stmt["Action"], list) else [stmt["Action"]]
        raw_res = stmt.get("Resource", "*")
        ress = raw_res if isinstance(raw_res, list) else [raw_res]
        if not any(fnmatch.fnmatchcase(action.lower(), a.lower()) for a in acts):
            continue
        if not any(fnmatch.fnmatchcase(resource, r) for r in ress):
            continue
        if not _eval_condition_block(stmt.get("Condition", {}), ctx):
            continue
        if stmt["Effect"] == "Deny":
            return "explicitDeny"
        if stmt["Effect"] == "Allow":
            matched_allow = True
    return "allowed" if matched_allow else "implicitDeny"


def eval_iam_policy_local_harness(
    identity_policy: dict,
    action: str,
    resource: str,
    ctx: dict[str, object] | None = None,
    resource_policy: dict | None = None,
    permissions_boundary: dict | None = None,
) -> str:
    """Explicitly labeled LOCAL test harness (offline companion to live `aws iam simulate-custom-policy`)."""
    ctx = ctx or {}
    if resource_policy:
        for stmt in resource_policy["Statement"]:
            acts = stmt["Action"] if isinstance(stmt["Action"], list) else [stmt["Action"]]
            ress = stmt["Resource"] if isinstance(stmt["Resource"], list) else [stmt["Resource"]]
            if any(fnmatch.fnmatchcase(action.lower(), a.lower()) for a in acts) and any(fnmatch.fnmatchcase(resource, r) for r in ress):
                if stmt["Effect"] == "Deny" and _eval_condition_block(stmt.get("Condition", {}), ctx):
                    return "explicitDeny"

    id_dec = _eval_identity_doc(identity_policy, action, resource, ctx)
    if id_dec == "explicitDeny":
        return "explicitDeny"
    if permissions_boundary is not None:
        pb_dec = _eval_identity_doc(permissions_boundary, action, resource, ctx)
        if pb_dec == "explicitDeny":
            return "explicitDeny"
        if pb_dec != "allowed":
            return "implicitDeny"
    return id_dec


def _ctx_to_aws_entries(ctx: dict[str, object]) -> list[dict]:
    entries = []
    for k, v in ctx.items():
        if isinstance(v, bool) or k in ("aws:SecureTransport", "aws:MultiFactorAuthPresent"):
            entries.append({"ContextKeyName": k, "ContextKeyValues": [str(v).lower()], "ContextKeyType": "boolean"})
        elif k == "aws:MultiFactorAuthAge":
            entries.append({"ContextKeyName": k, "ContextKeyValues": [str(v)], "ContextKeyType": "numeric"})
        elif isinstance(v, list):
            entries.append({"ContextKeyName": k, "ContextKeyValues": [str(x) for x in v], "ContextKeyType": "stringList"})
        else:
            entries.append({"ContextKeyName": k, "ContextKeyValues": [str(v)], "ContextKeyType": "string"})
    return entries


def simulate_via_aws_iam(
    identity_policy: dict,
    action: str,
    resource: str,
    ctx: dict[str, object] | None = None,
    resource_policy: dict | None = None,
    permissions_boundary: dict | None = None,
) -> str:
    """Authoritative read-only AWS IAM evaluation via `aws iam simulate-custom-policy`."""
    cmd = ["aws", "iam", "simulate-custom-policy", "--policy-input-list", json.dumps(identity_policy), "--action-names", action, "--resource-arns", resource, "--caller-arn", f"arn:aws:iam::{ACCOUNT}:user/DEV-user-alpha", "--output", "json"]
    if permissions_boundary is not None:
        cmd.extend(["--permissions-boundary-policy-input-list", json.dumps(permissions_boundary)])
    if resource_policy is not None:
        cmd.extend(["--resource-policy", json.dumps(resource_policy)])
    entries = _ctx_to_aws_entries(ctx or {})
    if entries:
        cmd.extend(["--context-entries", json.dumps(entries)])
    proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if proc.returncode != 0:
        _fail(f"aws iam simulate-custom-policy failed ({action} on {resource}): {proc.stderr.strip()}")
    results = json.loads(proc.stdout).get("EvaluationResults", [])
    if len(results) != 1:
        _fail(f"Unexpected EvaluationResults count for {action} on {resource}: {results}")
    return str(results[0]["EvalDecision"])


def run_access_analyzer_validation(policies: dict[str, dict]) -> None:
    for name, doc in policies.items():
        ptype = "RESOURCE_POLICY" if name.endswith("_bucket_policy") or name.startswith("trust_") else "IDENTITY_POLICY"
        cmd = ["aws", "accessanalyzer", "validate-policy", "--region", REGION, "--policy-type", ptype, "--policy-document", json.dumps(doc), "--output", "json"]
        if name.endswith("_bucket_policy"):
            cmd.extend(["--validate-policy-resource-type", "AWS::S3::Bucket"])
        elif name.startswith("trust_"):
            cmd.extend(["--validate-policy-resource-type", "AWS::IAM::AssumeRolePolicyDocument"])
        proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
        if proc.returncode != 0:
            _fail(f"aws accessanalyzer validate-policy failed on {name}: {proc.stderr.strip()}")
        findings = json.loads(proc.stdout).get("findings", [])
        blocking = [f for f in findings if f.get("findingType") in ("ERROR", "SECURITY_WARNING")]
        if blocking:
            _fail(f"Access Analyzer ERROR/SECURITY_WARNING in {name}: {json.dumps(blocking)}")
        print(f"  [PASS] aws accessanalyzer validate-policy ({ptype}): {name} -> 0 ERROR / 0 SECURITY_WARNING (total={len(findings)})")


def verify_existing_ssm_parameter_record(name: str, p_meta: dict, valid_kms_keys: set[str], tag_map: dict[str, str] | None = None, tag_lookup_error: str | None = None) -> None:
    """Verifies that an existing SSM parameter strictly belongs to EnvScale and uses approved KMS encryption."""
    p_type, p_key = p_meta.get("Type"), p_meta.get("KeyId") or ""
    if p_type != "SecureString":
        _fail(f"Existing parameter '{name}' has Type='{p_type}' (expected SecureString).")
    if not p_key or p_key not in valid_kms_keys:
        _fail(f"Existing parameter '{name}' has invalid KeyId='{p_key}' (expected {sorted(valid_kms_keys)}).")
    if tag_lookup_error:
        _fail(f"Failed retrieving tags for existing parameter '{name}' ({tag_lookup_error}).")
    if not tag_map or tag_map.get("Project") != "EnvScale":
        _fail(f"Existing parameter '{name}' has Project tag '{tag_map.get('Project') if tag_map else None}' (requires 'EnvScale').")
