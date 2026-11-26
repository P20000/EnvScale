#!/usr/bin/env python3
"""EnvScale B2 — Two-Role Runtime IAM Policies, Trust Policies, Boundaries & Simulator Matrix."""

from __future__ import annotations

import argparse
import json
import pathlib
import subprocess
import sys

_SCRIPT_DIR = str(pathlib.Path(__file__).resolve().parent)
if _SCRIPT_DIR not in sys.path:
    sys.path.insert(0, _SCRIPT_DIR)

import iam_policy_simulator as sim  # noqa: E402

ACCOUNT = sim.ACCOUNT
REGION = sim.REGION
TFSTATE_BUCKET = sim.TFSTATE_BUCKET
RECOVERY_BUCKET = sim.RECOVERY_BUCKET
LEGACY_BUCKET = sim.LEGACY_BUCKET
APPROVED_AMI_OWNERS = list(sim.APPROVED_AMI_OWNERS)
LIVE_SSM_KMS_KEY_ARN = f"arn:aws:kms:{REGION}:{ACCOUNT}:key/14a2af96-fc5c-40f9-9c29-d3ef25ab99aa"
LIVE_UBUNTU_AMI_ARN = sim.LIVE_UBUNTU_AMI_ARN
LIVE_UBUNTU_SNAP_ARN = sim.LIVE_UBUNTU_SNAP_ARN
LIVE_COEXISTING_EKS_ARN = sim.LIVE_COEXISTING_EKS_ARN

RUNTIME_PROVISIONER_ROLE_NAME = "envscale-runtime-provisioner-role"
RUNTIME_PROVISIONER_BOUNDARY_NAME = "envscale-runtime-provisioner-permissions-boundary"
EC2_RUNTIME_ROLE_NAME = "envscale-ec2-runtime-role"
EC2_RUNTIME_PROFILE_NAME = "envscale-ec2-runtime-profile"
WORKLOAD_BOUNDARY_NAME = "envscale-workload-permissions-boundary"


def _ec2_tagged_arns(account_id: str, region: str) -> list[str]:
    rts = ("vpc", "subnet", "internet-gateway", "route-table", "security-group", "instance", "volume", "network-interface")
    return [f"arn:aws:ec2:{region}:{account_id}:{rt}/*" for rt in rts]


def build_runtime_provisioner_trust_policy(
    account_id: str = ACCOUNT,
    trusted_principal_arns: list[str] | None = None,
) -> dict:
    """MFA-enforced same-account human operator trust policy for runtime provisioning (max_session=3600)."""
    principals = trusted_principal_arns or [f"arn:aws:iam::{account_id}:user/DEV-user-alpha"]
    return {
        "Version": "2012-10-17",
        "Statement": [{
            "Sid": "AllowSameAccountHumanProvisionersWithRecentMFA",
            "Effect": "Allow",
            "Principal": {"AWS": principals},
            "Action": "sts:AssumeRole",
            "Condition": {
                "Bool": {"aws:MultiFactorAuthPresent": "true"},
                "NumericLessThan": {"aws:MultiFactorAuthAge": "3600"},
            },
        }],
    }


def build_ec2_runtime_trust_policy(account_id: str = ACCOUNT) -> dict:
    """EC2 service trust policy scoped strictly to SourceAccount (matches deployment/foundation/iam.tf)."""
    return {
        "Version": "2012-10-17",
        "Statement": [{
            "Sid": "AllowEC2ServiceAssumeRoleInAccount",
            "Effect": "Allow",
            "Principal": {"Service": "ec2.amazonaws.com"},
            "Action": "sts:AssumeRole",
            "Condition": {"StringEquals": {"aws:SourceAccount": account_id}},
        }],
    }


def build_runtime_provisioner_policy(account_id: str = ACCOUNT, region: str = REGION) -> dict:
    """Least-privilege inline policy (<10,240 non-ws chars) for envscale-runtime-provisioner-role."""
    tfstate_arn = f"arn:aws:s3:::envscale-tfstate-{account_id}-{region}"
    rec_arn = f"arn:aws:s3:::envscale-recovery-{account_id}-{region}"
    leg_arn = f"arn:aws:s3:::envscale-cloud-vault-{account_id}-{region}"
    ec2_role_arn = f"arn:aws:iam::{account_id}:role/{EC2_RUNTIME_ROLE_NAME}"
    ec2_prof_arn = f"arn:aws:iam::{account_id}:instance-profile/{EC2_RUNTIME_PROFILE_NAME}"
    ec2_arns = _ec2_tagged_arns(account_id, region)
    req_tags = {"aws:RequestTag/Project": "EnvScale", "aws:RequestTag/Layer": "DisposableRuntime"}
    res_tags = {"aws:ResourceTag/Project": "EnvScale", "aws:ResourceTag/Layer": "DisposableRuntime"}
    ec2_prefix = f"arn:aws:ec2:{region}:{account_id}"
    create_actions = [
        "CreateVpc", "CreateSubnet", "CreateInternetGateway", "CreateRouteTable",
        "CreateSecurityGroup", "AuthorizeSecurityGroupIngress", "AuthorizeSecurityGroupEgress",
        "CreateVolume", "RunInstances", "AllocateAddress",
    ]
    return {
        "Version": "2012-10-17",
        "Statement": [
            {"Sid": "Ec2SsmRead", "Effect": "Allow", "Action": ["ec2:Describe*", "ssm:DescribeParameters", "ssm:DescribeInstanceInformation", "ssm:ListCommandInvocations", "ssm:GetCommandInvocation"], "Resource": "*", "Condition": {"StringEquals": {"aws:RequestedRegion": region}}},
            {"Sid": "CreateRt", "Effect": "Allow", "Action": ["ec2:CreateVpc", "ec2:CreateInternetGateway", "ec2:CreateVolume", "ec2:AllocateAddress", "ec2:RunInstances"], "Resource": [f"{ec2_prefix}:vpc/*", f"{ec2_prefix}:internet-gateway/*", f"{ec2_prefix}:volume/*", f"{ec2_prefix}:elastic-ip/*", f"{ec2_prefix}:instance/*"], "Condition": {"StringEquals": req_tags}},
            {"Sid": "CreateChild", "Effect": "Allow", "Action": ["ec2:CreateSubnet", "ec2:CreateRouteTable", "ec2:CreateSecurityGroup"], "Resource": [f"{ec2_prefix}:subnet/*", f"{ec2_prefix}:route-table/*", f"{ec2_prefix}:security-group/*"], "Condition": {"StringEquals": req_tags}},
            {"Sid": "VpcParent", "Effect": "Allow", "Action": ["ec2:CreateSubnet", "ec2:CreateRouteTable", "ec2:CreateSecurityGroup"], "Resource": f"{ec2_prefix}:vpc/*", "Condition": {"StringEquals": res_tags}},
            {"Sid": "RunInstDeps", "Effect": "Allow", "Action": ["ec2:RunInstances"], "Resource": [f"{ec2_prefix}:subnet/*", f"{ec2_prefix}:security-group/*", f"{ec2_prefix}:network-interface/*"], "Condition": {"StringEquals": res_tags}},
            {"Sid": "RunInstEni", "Effect": "Allow", "Action": ["ec2:RunInstances"], "Resource": f"{ec2_prefix}:network-interface/*", "Condition": {"StringEquals": {"aws:RequestedRegion": region}, "Null": {"aws:ResourceTag/Project": "true", "aws:ResourceTag/Layer": "true"}, "StringEqualsIfExists": req_tags}},
            {"Sid": "RunInstAmi", "Effect": "Allow", "Action": ["ec2:RunInstances"], "Resource": [f"arn:aws:ec2:{region}::image/*", f"arn:aws:ec2:{region}::snapshot/*"], "Condition": {"StringEquals": {"ec2:Owner": APPROVED_AMI_OWNERS}}},
            {"Sid": "TagCreate", "Effect": "Allow", "Action": ["ec2:CreateTags"], "Resource": ec2_arns + [f"{ec2_prefix}:security-group-rule/*", f"{ec2_prefix}:elastic-ip/*"], "Condition": {"StringEquals": {"ec2:CreateAction": create_actions, **req_tags}}},
            {"Sid": "Lifecycle", "Effect": "Allow", "Action": ["ec2:ModifyVpcAttribute", "ec2:ModifySubnetAttribute", "ec2:AttachInternetGateway", "ec2:DetachInternetGateway", "ec2:CreateRoute", "ec2:ReplaceRoute", "ec2:DeleteRoute", "ec2:AssociateRouteTable", "ec2:DisassociateRouteTable", "ec2:AuthorizeSecurityGroupIngress", "ec2:AuthorizeSecurityGroupEgress", "ec2:RevokeSecurityGroupIngress", "ec2:RevokeSecurityGroupEgress", "ec2:UpdateSecurityGroupRuleDescriptionsIngress", "ec2:UpdateSecurityGroupRuleDescriptionsEgress", "ec2:StartInstances", "ec2:StopInstances", "ec2:RebootInstances", "ec2:ModifyInstanceAttribute", "ec2:ModifyInstanceMetadataOptions", "ec2:ModifyVolume", "ec2:AttachVolume", "ec2:DetachVolume", "ec2:TerminateInstances", "ec2:DeleteVolume", "ec2:DeleteSecurityGroup", "ec2:DeleteRouteTable", "ec2:DeleteInternetGateway", "ec2:DeleteSubnet", "ec2:DeleteVpc", "ec2:AssociateAddress", "ec2:DisassociateAddress", "ec2:CreateTags", "ec2:DeleteTags"], "Resource": ec2_arns + [f"{ec2_prefix}:elastic-ip/*"], "Condition": {"StringEquals": res_tags}},
            {"Sid": "SgRules", "Effect": "Allow", "Action": ["ec2:AuthorizeSecurityGroupIngress", "ec2:AuthorizeSecurityGroupEgress"], "Resource": f"{ec2_prefix}:security-group-rule/*", "Condition": {"StringEquals": req_tags}},
            {"Sid": "RelDispEip", "Effect": "Allow", "Action": ["ec2:ReleaseAddress"], "Resource": f"{ec2_prefix}:elastic-ip/*", "Condition": {"StringEquals": res_tags}},
            {"Sid": "IamRead", "Effect": "Allow", "Action": ["iam:GetRole", "iam:GetInstanceProfile"], "Resource": [ec2_role_arn, ec2_prof_arn]},
            {"Sid": "PassRole", "Effect": "Allow", "Action": ["iam:PassRole"], "Resource": ec2_role_arn, "Condition": {"StringEquals": {"iam:PassedToService": "ec2.amazonaws.com"}}},
            {"Sid": "SsmDoc", "Effect": "Allow", "Action": ["ssm:SendCommand"], "Resource": f"arn:aws:ssm:{region}::document/AWS-RunShellScript"},
            {"Sid": "SsmInst", "Effect": "Allow", "Action": ["ssm:SendCommand"], "Resource": f"{ec2_prefix}:instance/*", "Condition": {"StringEquals": res_tags}},
            {"Sid": "TfList", "Effect": "Allow", "Action": ["s3:ListBucket"], "Resource": tfstate_arn, "Condition": {"StringLike": {"s3:prefix": ["runtime/*", "foundation/terraform.tfstate"]}}},
            {"Sid": "S3Read", "Effect": "Allow", "Action": ["s3:GetBucketLocation", "s3:GetObject", "s3:GetObjectVersion"], "Resource": [tfstate_arn, f"{tfstate_arn}/foundation/terraform.tfstate", rec_arn, f"{rec_arn}/releases/*", f"{rec_arn}/backups/postgres/*"]},
            {"Sid": "RtState", "Effect": "Allow", "Action": ["s3:GetObject", "s3:PutObject"], "Resource": [f"{tfstate_arn}/runtime/terraform.tfstate", f"{tfstate_arn}/runtime/terraform.tfstate.tflock"]},
            {"Sid": "RtLockDel", "Effect": "Allow", "Action": ["s3:DeleteObject"], "Resource": f"{tfstate_arn}/runtime/terraform.tfstate.tflock"},
            {"Sid": "RecList", "Effect": "Allow", "Action": ["s3:ListBucket"], "Resource": rec_arn, "Condition": {"StringLike": {"s3:prefix": ["releases/*", "backups/postgres/*"]}}},
            {"Sid": "DenySsmKms", "Effect": "Deny", "Action": ["ssm:GetParameter*", "ssm:PutParameter", "ssm:DeleteParameter*", "ssm:LabelParameterVersion", "kms:*"], "Resource": "*"},
            {"Sid": "DenyIam", "Effect": "Deny", "Action": ["iam:Create*", "iam:Delete*", "iam:Put*", "iam:Update*", "iam:Attach*", "iam:Detach*", "iam:Add*", "iam:Remove*", "iam:Tag*", "iam:Untag*"], "Resource": "*"},
            {"Sid": "DenyDelTags", "Effect": "Deny", "Action": ["ec2:DeleteTags"], "Resource": "*", "Condition": {"ForAnyValue:StringEquals": {"aws:TagKeys": ["Project", "Layer"]}}},
            {"Sid": "DenyMutProj", "Effect": "Deny", "Action": ["ec2:CreateTags"], "Resource": "*", "Condition": {"Null": {"aws:RequestTag/Project": "false"}, "StringNotEquals": {"aws:RequestTag/Project": "EnvScale"}}},
            {"Sid": "DenyMutLayer", "Effect": "Deny", "Action": ["ec2:CreateTags"], "Resource": "*", "Condition": {"Null": {"aws:RequestTag/Layer": "false"}, "StringNotEquals": {"aws:RequestTag/Layer": "DisposableRuntime"}}},
            {"Sid": "DenyEipProj", "Effect": "Deny", "Action": ["ec2:ReleaseAddress"], "Resource": "*", "Condition": {"StringNotEqualsIfExists": {"aws:ResourceTag/Project": "EnvScale"}}},
            {"Sid": "DenyEipLayer", "Effect": "Deny", "Action": ["ec2:ReleaseAddress"], "Resource": "*", "Condition": {"StringNotEqualsIfExists": {"aws:ResourceTag/Layer": "DisposableRuntime"}}},
            {"Sid": "DenyS3Wr", "Effect": "Deny", "Action": ["s3:PutObject", "s3:DeleteObject"], "Resource": [f"{tfstate_arn}/foundation/*", f"{rec_arn}/backups/*", f"{rec_arn}/releases/*"]},
            {"Sid": "DenyStateDel", "Effect": "Deny", "Action": ["s3:DeleteObject"], "Resource": f"{tfstate_arn}/*.tfstate"},
            {"Sid": "DenyBucketDestroy", "Effect": "Deny", "Action": ["s3:DeleteBucket", "s3:DeleteBucketPolicy", "s3:PutBucketPolicy", "s3:DeleteObjectVersion"], "Resource": [tfstate_arn, f"{tfstate_arn}/*", rec_arn, f"{rec_arn}/*"]},
            {"Sid": "DenyLegacyVault", "Effect": "Deny", "Action": ["s3:*"], "Resource": [leg_arn, f"{leg_arn}/*"]},
            {"Sid": "DenyOrgAcct", "Effect": "Deny", "Action": ["organizations:*", "account:*"], "Resource": "*"},
        ],
    }


def build_runtime_provisioner_permissions_boundary(account_id: str = ACCOUNT, region: str = REGION) -> dict:
    """Dedicated upper-bound permissions boundary for envscale-runtime-provisioner-role."""
    tfstate_arn = f"arn:aws:s3:::envscale-tfstate-{account_id}-{region}"
    rec_arn = f"arn:aws:s3:::envscale-recovery-{account_id}-{region}"
    leg_arn = f"arn:aws:s3:::envscale-cloud-vault-{account_id}-{region}"
    ec2_role_arn = f"arn:aws:iam::{account_id}:role/{EC2_RUNTIME_ROLE_NAME}"
    ec2_prof_arn = f"arn:aws:iam::{account_id}:instance-profile/{EC2_RUNTIME_PROFILE_NAME}"
    return {
        "Version": "2012-10-17",
        "Statement": [
            {"Sid": "AllowBoundedRuntimeStateAndReleaseReads", "Effect": "Allow", "Action": ["s3:ListBucket", "s3:GetBucketLocation", "s3:GetObject", "s3:GetObjectVersion", "s3:PutObject", "s3:DeleteObject"], "Resource": [tfstate_arn, f"{tfstate_arn}/*", rec_arn, f"{rec_arn}/*"]},
            {"Sid": "AllowBoundedSSMControlPlaneDispatchOnly", "Effect": "Allow", "Action": ["ssm:DescribeParameters", "ssm:DescribeInstanceInformation", "ssm:ListCommandInvocations", "ssm:GetCommandInvocation", "ssm:SendCommand"], "Resource": "*"},
            {"Sid": "AllowBoundedRegionalRuntimeEc2Lifecycle", "Effect": "Allow", "Action": ["ec2:Describe*", "ec2:CreateVpc", "ec2:CreateInternetGateway", "ec2:CreateVolume", "ec2:AllocateAddress", "ec2:CreateSubnet", "ec2:CreateRouteTable", "ec2:CreateSecurityGroup", "ec2:RunInstances", "ec2:CreateTags", "ec2:DeleteTags", "ec2:ModifyVpcAttribute", "ec2:ModifySubnetAttribute", "ec2:AttachInternetGateway", "ec2:DetachInternetGateway", "ec2:CreateRoute", "ec2:ReplaceRoute", "ec2:DeleteRoute", "ec2:AssociateRouteTable", "ec2:DisassociateRouteTable", "ec2:AuthorizeSecurityGroupIngress", "ec2:AuthorizeSecurityGroupEgress", "ec2:RevokeSecurityGroupIngress", "ec2:RevokeSecurityGroupEgress", "ec2:UpdateSecurityGroupRuleDescriptionsIngress", "ec2:UpdateSecurityGroupRuleDescriptionsEgress", "ec2:StartInstances", "ec2:StopInstances", "ec2:RebootInstances", "ec2:ModifyInstanceAttribute", "ec2:ModifyInstanceMetadataOptions", "ec2:ModifyVolume", "ec2:AttachVolume", "ec2:DetachVolume", "ec2:AssociateAddress", "ec2:DisassociateAddress", "ec2:ReleaseAddress", "ec2:TerminateInstances", "ec2:DeleteVolume", "ec2:DeleteSecurityGroup", "ec2:DeleteRouteTable", "ec2:DeleteInternetGateway", "ec2:DeleteSubnet", "ec2:DeleteVpc"], "Resource": "*", "Condition": {"StringEquals": {"aws:RequestedRegion": region}}},
            {"Sid": "AllowBoundedRuntimeProfileLookup", "Effect": "Allow", "Action": ["iam:GetRole", "iam:GetInstanceProfile"], "Resource": [ec2_role_arn, ec2_prof_arn]},
            {"Sid": "AllowBoundedPassEc2RuntimeRoleOnly", "Effect": "Allow", "Action": ["iam:PassRole"], "Resource": ec2_role_arn, "Condition": {"StringEquals": {"iam:PassedToService": "ec2.amazonaws.com"}}},
            {"Sid": "DenyBoundedSecretReadsKmsAndSsmMutations", "Effect": "Deny", "Action": ["ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath", "ssm:PutParameter", "ssm:DeleteParameter", "ssm:DeleteParameters", "ssm:LabelParameterVersion", "kms:*"], "Resource": "*"},
            {"Sid": "DenyBoundedIamMutationsAndGovernanceAdmin", "Effect": "Deny", "Action": ["iam:Create*", "iam:Delete*", "iam:Put*", "iam:Update*", "iam:Attach*", "iam:Detach*", "iam:Add*", "iam:Remove*", "iam:Tag*", "iam:Untag*", "organizations:*", "account:*"], "Resource": "*"},
            {"Sid": "DenyBoundedProtectedS3AndFoundationState", "Effect": "Deny", "Action": ["s3:DeleteBucket", "s3:DeleteBucketPolicy", "s3:PutBucketPolicy", "s3:DeleteObjectVersion"], "Resource": [tfstate_arn, f"{tfstate_arn}/*", rec_arn, f"{rec_arn}/*"]},
            {"Sid": "DenyBoundedFoundationWriteAndTfstateDelete", "Effect": "Deny", "Action": ["s3:PutObject"], "Resource": [f"{tfstate_arn}/foundation/*", f"{rec_arn}/*"]},
            {"Sid": "DenyBoundedStateAndRecoveryDeletions", "Effect": "Deny", "Action": ["s3:DeleteObject"], "Resource": [f"{tfstate_arn}/*.tfstate", f"{tfstate_arn}/foundation/*", f"{rec_arn}/backups/*", f"{rec_arn}/releases/*"]},
            {"Sid": "DenyBoundedLegacyVaultAccess", "Effect": "Deny", "Action": ["s3:*"], "Resource": [leg_arn, f"{leg_arn}/*"]},
            {"Sid": "DenyBoundedNonDisposableEipRelease", "Effect": "Deny", "Action": ["ec2:ReleaseAddress"], "Resource": "*", "Condition": {"StringNotEqualsIfExists": {"aws:ResourceTag/Layer": "DisposableRuntime"}}},
        ],
    }


def build_ec2_runtime_policy(account_id: str = ACCOUNT, region: str = REGION) -> dict:
    """Identity policy for envscale-ec2-runtime-role (matches deployment/foundation/iam.tf)."""
    tfstate_arn = f"arn:aws:s3:::envscale-tfstate-{account_id}-{region}"
    rec_arn = f"arn:aws:s3:::envscale-recovery-{account_id}-{region}"
    leg_arn = f"arn:aws:s3:::envscale-cloud-vault-{account_id}-{region}"
    return {
        "Version": "2012-10-17",
        "Statement": [
            {"Sid": "AllowSSMProdParameterRead", "Effect": "Allow", "Action": ["ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath"], "Resource": [f"arn:aws:ssm:{region}:{account_id}:parameter/envscale/prod", f"arn:aws:ssm:{region}:{account_id}:parameter/envscale/prod/*"]},
            {"Sid": "AllowSSMKmsDecryptViaSSMOnly", "Effect": "Allow", "Action": ["kms:Decrypt"], "Resource": f"arn:aws:kms:{region}:{account_id}:key/*", "Condition": {"StringEquals": {"kms:ViaService": f"ssm.{region}.amazonaws.com"}}},
            {"Sid": "AllowRecoveryReleasesAndHistoricalReadOnly", "Effect": "Allow", "Action": ["s3:GetObject", "s3:GetObjectVersion"], "Resource": [f"{rec_arn}/releases/*", f"{rec_arn}/backups/historical/*"]},
            {"Sid": "AllowRecoveryPostgresBackupsAndAlertsRW", "Effect": "Allow", "Action": ["s3:GetObject", "s3:GetObjectVersion", "s3:PutObject"], "Resource": [f"{rec_arn}/backups/postgres/*", f"{rec_arn}/lifecycle/alerts/*"]},
            {"Sid": "AllowRecoveryBucketLocation", "Effect": "Allow", "Action": ["s3:GetBucketLocation"], "Resource": rec_arn},
            {"Sid": "AllowRecoveryBucketListScoped", "Effect": "Allow", "Action": ["s3:ListBucket"], "Resource": rec_arn, "Condition": {"StringLike": {"s3:prefix": ["backups/postgres/*", "backups/historical/*", "lifecycle/alerts/*", "releases/*"]}}},
            {"Sid": "DenyAllSSMMutations", "Effect": "Deny", "Action": ["ssm:PutParameter", "ssm:DeleteParameter", "ssm:DeleteParameters", "ssm:LabelParameterVersion"], "Resource": f"arn:aws:ssm:{region}:{account_id}:parameter/*"},
            {"Sid": "DenyReleaseAndHistoricalWrites", "Effect": "Deny", "Action": ["s3:PutObject"], "Resource": [f"{rec_arn}/releases/*", f"{rec_arn}/backups/historical/*"]},
            {"Sid": "DenyAllRecoveryDeletions", "Effect": "Deny", "Action": ["s3:DeleteObject", "s3:DeleteObjectVersion", "s3:DeleteBucket", "s3:DeleteBucketPolicy", "s3:PutBucketPolicy"], "Resource": [rec_arn, f"{rec_arn}/*"]},
            {"Sid": "DenyTfstateAndLegacyVaultAccess", "Effect": "Deny", "Action": ["s3:*"], "Resource": [tfstate_arn, f"{tfstate_arn}/*", leg_arn, f"{leg_arn}/*"]},
        ],
    }


def build_all_runtime_iam_policies(foundation_dir: pathlib.Path | None = None) -> dict[str, dict]:
    fdir = foundation_dir or pathlib.Path(__file__).resolve().parents[1] / "foundation"
    rendered = sim.build_rendered_foundation_policies(fdir)
    return {
        "trust_runtime_provisioner": build_runtime_provisioner_trust_policy(),
        "role_runtime_provisioner": build_runtime_provisioner_policy(),
        "boundary_runtime_provisioner": build_runtime_provisioner_permissions_boundary(),
        "trust_ec2_runtime": build_ec2_runtime_trust_policy(),
        "role_ec2_runtime": build_ec2_runtime_policy(),
        "role_workload_permissions_boundary": rendered["role_workload_permissions_boundary"],
    }


def load_tfstate_bucket_policy() -> dict:
    bs_script = pathlib.Path(__file__).resolve().parent / "bootstrap-state.sh"
    bs_dry = subprocess.run([str(bs_script), "--dry-run"], capture_output=True, text=True, check=True)
    pol_str = bs_dry.stdout.split("--- Rendered Bucket Policy JSON ---\n", 1)[1].split("[DRY-RUN SUCCESS]", 1)[0].strip()
    return json.loads(pol_str)


def build_runtime_iam_simulation_vectors(account_id: str = ACCOUNT, region: str = REGION) -> dict[str, list[tuple]]:
    tf_b = f"arn:aws:s3:::envscale-tfstate-{account_id}-{region}"
    rc_b = f"arn:aws:s3:::envscale-recovery-{account_id}-{region}"
    lg_b = f"arn:aws:s3:::envscale-cloud-vault-{account_id}-{region}"
    ep = f"arn:aws:ec2:{region}:{account_id}"
    req = {"aws:RequestTag/Project": "EnvScale", "aws:RequestTag/Layer": "DisposableRuntime"}
    res = {"aws:ResourceTag/Project": "EnvScale", "aws:ResourceTag/Layer": "DisposableRuntime"}
    res_reg = {**res, "aws:RequestedRegion": region}
    other = {"aws:ResourceTag/Project": "Relmonition", "aws:ResourceTag/Layer": "Production", "aws:RequestedRegion": region}
    reg = {"aws:RequestedRegion": region}
    eip_persist = {"aws:ResourceTag/Project": "EnvScale", "aws:ResourceTag/Layer": "PersistentFoundation", "aws:RequestedRegion": region}

    trust_vectors = [
        ("trust_runtime_provisioner AssumeRole fresh MFA", "trust_runtime_provisioner", "sts:AssumeRole", f"arn:aws:iam::{account_id}:role/{RUNTIME_PROVISIONER_ROLE_NAME}", {"aws:MultiFactorAuthPresent": True, "aws:MultiFactorAuthAge": 60}, "allowed"),
        ("NEG: trust_runtime_provisioner w/o MFA", "trust_runtime_provisioner", "sts:AssumeRole", f"arn:aws:iam::{account_id}:role/{RUNTIME_PROVISIONER_ROLE_NAME}", {}, "implicitDeny"),
        ("NEG: trust_runtime_provisioner stale MFA (3601s)", "trust_runtime_provisioner", "sts:AssumeRole", f"arn:aws:iam::{account_id}:role/{RUNTIME_PROVISIONER_ROLE_NAME}", {"aws:MultiFactorAuthPresent": True, "aws:MultiFactorAuthAge": 3601}, "implicitDeny"),
        ("trust_ec2_runtime same SourceAccount", "trust_ec2_runtime", "sts:AssumeRole", f"arn:aws:iam::{account_id}:role/{EC2_RUNTIME_ROLE_NAME}", {"aws:SourceAccount": account_id}, "allowed"),
        ("NEG: trust_ec2_runtime foreign SourceAccount", "trust_ec2_runtime", "sts:AssumeRole", f"arn:aws:iam::{account_id}:role/{EC2_RUNTIME_ROLE_NAME}", {"aws:SourceAccount": "111122223333"}, "implicitDeny"),
    ]
    prov_vectors = [
        ("prov DescribeVpcs in ap-south-1", "role_runtime_provisioner", "ec2:DescribeVpcs", "*", reg, None, "boundary_runtime_provisioner", "allowed"),
        ("prov DescribeParameters in ap-south-1", "role_runtime_provisioner", "ssm:DescribeParameters", "*", reg, None, "boundary_runtime_provisioner", "allowed"),
        ("prov CreateVpc tagged EnvScale", "role_runtime_provisioner", "ec2:CreateVpc", f"{ep}:vpc/*", {**req, **reg}, None, "boundary_runtime_provisioner", "allowed"),
        ("prov CreateInternetGateway tagged", "role_runtime_provisioner", "ec2:CreateInternetGateway", f"{ep}:internet-gateway/*", {**req, **reg}, None, "boundary_runtime_provisioner", "allowed"),
        ("prov CreateVolume tagged", "role_runtime_provisioner", "ec2:CreateVolume", f"{ep}:volume/*", {**req, **reg}, None, "boundary_runtime_provisioner", "allowed"),
        ("prov AllocateAddress tagged DisposableRuntime", "role_runtime_provisioner", "ec2:AllocateAddress", f"{ep}:elastic-ip/*", {**req, **reg}, None, "boundary_runtime_provisioner", "allowed"),
        ("prov CreateSubnet child+parent VPC", "role_runtime_provisioner", "ec2:CreateSubnet", f"{ep}:subnet/*", {**req, **reg}, None, "boundary_runtime_provisioner", "allowed"),
        ("prov CreateSubnet parent VPC tag check", "role_runtime_provisioner", "ec2:CreateSubnet", f"{ep}:vpc/vpc-1", res_reg, None, "boundary_runtime_provisioner", "allowed"),
        ("prov CreateRouteTable child", "role_runtime_provisioner", "ec2:CreateRouteTable", f"{ep}:route-table/*", {**req, **reg}, None, "boundary_runtime_provisioner", "allowed"),
        ("prov CreateSecurityGroup child", "role_runtime_provisioner", "ec2:CreateSecurityGroup", f"{ep}:security-group/*", {**req, **reg}, None, "boundary_runtime_provisioner", "allowed"),
        ("prov RunInstances instance tagged", "role_runtime_provisioner", "ec2:RunInstances", f"{ep}:instance/*", {**req, **reg}, None, "boundary_runtime_provisioner", "allowed"),
        ("prov RunInstances root volume tagged", "role_runtime_provisioner", "ec2:RunInstances", f"{ep}:volume/*", {**req, **reg}, None, "boundary_runtime_provisioner", "allowed"),
        ("prov RunInstances implicit primary ENI (no ResTag)", "role_runtime_provisioner", "ec2:RunInstances", f"{ep}:network-interface/*", reg, None, "boundary_runtime_provisioner", "allowed"),
        ("prov RunInstances tagged existing ENI", "role_runtime_provisioner", "ec2:RunInstances", f"{ep}:network-interface/eni-1", res_reg, None, "boundary_runtime_provisioner", "allowed"),
        ("prov RunInstances tagged subnet", "role_runtime_provisioner", "ec2:RunInstances", f"{ep}:subnet/subnet-1", res_reg, None, "boundary_runtime_provisioner", "allowed"),
        ("prov RunInstances tagged SG", "role_runtime_provisioner", "ec2:RunInstances", f"{ep}:security-group/sg-1", res_reg, None, "boundary_runtime_provisioner", "allowed"),
        ("prov RunInstances Ubuntu AMI", "role_runtime_provisioner", "ec2:RunInstances", LIVE_UBUNTU_AMI_ARN, {"ec2:Owner": "099720109477", **reg}, None, "boundary_runtime_provisioner", "allowed"),
        ("prov RunInstances Ubuntu AMI (amazon alias)", "role_runtime_provisioner", "ec2:RunInstances", LIVE_UBUNTU_AMI_ARN, {"ec2:Owner": "amazon", **reg}, None, "boundary_runtime_provisioner", "allowed"),
        ("prov RunInstances Ubuntu snapshot", "role_runtime_provisioner", "ec2:RunInstances", LIVE_UBUNTU_SNAP_ARN, {"ec2:Owner": "099720109477", **reg}, None, "boundary_runtime_provisioner", "allowed"),
        ("prov CreateTags on RunInstances", "role_runtime_provisioner", "ec2:CreateTags", f"{ep}:instance/*", {"ec2:CreateAction": "RunInstances", **req, **reg}, None, "boundary_runtime_provisioner", "allowed"),
        ("prov CreateTags on AllocateAddress", "role_runtime_provisioner", "ec2:CreateTags", f"{ep}:elastic-ip/*", {"ec2:CreateAction": "AllocateAddress", **req, **reg}, None, "boundary_runtime_provisioner", "allowed"),
        ("prov AuthorizeSecurityGroupIngress on SG", "role_runtime_provisioner", "ec2:AuthorizeSecurityGroupIngress", f"{ep}:security-group/sg-1", res_reg, None, "boundary_runtime_provisioner", "allowed"),
        ("prov RevokeSecurityGroupEgress on tagged SG", "role_runtime_provisioner", "ec2:RevokeSecurityGroupEgress", f"{ep}:security-group/sg-1", res_reg, None, "boundary_runtime_provisioner", "allowed"),
        ("prov UpdateSecurityGroupRuleDescriptionsIngress on tagged SG", "role_runtime_provisioner", "ec2:UpdateSecurityGroupRuleDescriptionsIngress", f"{ep}:security-group/sg-1", res_reg, None, "boundary_runtime_provisioner", "allowed"),
        ("prov AuthorizeSecurityGroupIngress on tagged rule", "role_runtime_provisioner", "ec2:AuthorizeSecurityGroupIngress", f"{ep}:security-group-rule/sgr-1", {**req, **reg}, None, "boundary_runtime_provisioner", "allowed"),
        ("NEG: prov AuthorizeSecurityGroupIngress on untagged SG", "role_runtime_provisioner", "ec2:AuthorizeSecurityGroupIngress", f"{ep}:security-group/sg-untagged", reg, None, "boundary_runtime_provisioner", "implicitDeny"),
        ("NEG: prov RevokeSecurityGroupEgress on untagged SG", "role_runtime_provisioner", "ec2:RevokeSecurityGroupEgress", f"{ep}:security-group/sg-untagged", reg, None, "boundary_runtime_provisioner", "implicitDeny"),
        ("NEG: prov UpdateSecurityGroupRuleDescriptionsIngress on untagged SG", "role_runtime_provisioner", "ec2:UpdateSecurityGroupRuleDescriptionsIngress", f"{ep}:security-group/sg-untagged", reg, None, "boundary_runtime_provisioner", "implicitDeny"),
        ("NEG: prov AuthorizeSecurityGroupIngress on foreign SG", "role_runtime_provisioner", "ec2:AuthorizeSecurityGroupIngress", f"{ep}:security-group/sg-relmon", other, None, "boundary_runtime_provisioner", "implicitDeny"),
        ("NEG: prov AuthorizeSecurityGroupIngress on untagged rule", "role_runtime_provisioner", "ec2:AuthorizeSecurityGroupIngress", f"{ep}:security-group-rule/sgr-untagged", reg, None, "boundary_runtime_provisioner", "implicitDeny"),
        ("NEG: prov AuthorizeSecurityGroupEgress on foreign-tagged rule", "role_runtime_provisioner", "ec2:AuthorizeSecurityGroupEgress", f"{ep}:security-group-rule/sgr-foreign", {"aws:RequestTag/Project": "Relmonition", "aws:RequestTag/Layer": "Production", **reg}, None, "boundary_runtime_provisioner", "implicitDeny"),
        ("NEG: prov RevokeSecurityGroupEgress on rule ARN", "role_runtime_provisioner", "ec2:RevokeSecurityGroupEgress", f"{ep}:security-group-rule/sgr-1", {**req, **reg}, None, "boundary_runtime_provisioner", "implicitDeny"),
        ("NEG: prov UpdateSecurityGroupRuleDescriptionsIngress on rule ARN", "role_runtime_provisioner", "ec2:UpdateSecurityGroupRuleDescriptionsIngress", f"{ep}:security-group-rule/sgr-1", {**req, **reg}, None, "boundary_runtime_provisioner", "implicitDeny"),
        ("prov CreateRoute & DisassociateRouteTable", "role_runtime_provisioner", "ec2:DisassociateRouteTable", f"{ep}:route-table/rtb-1", res_reg, None, "boundary_runtime_provisioner", "allowed"),
        ("prov AssociateAddress on tagged EIP", "role_runtime_provisioner", "ec2:AssociateAddress", f"{ep}:elastic-ip/eipalloc-1", res_reg, None, "boundary_runtime_provisioner", "allowed"),
        ("prov ReleaseAddress on DisposableRuntime EIP", "role_runtime_provisioner", "ec2:ReleaseAddress", f"{ep}:elastic-ip/eipalloc-1", res_reg, None, "boundary_runtime_provisioner", "allowed"),
        ("prov TerminateInstances & DeleteVpc tagged", "role_runtime_provisioner", "ec2:DeleteVpc", f"{ep}:vpc/vpc-1", res_reg, None, "boundary_runtime_provisioner", "allowed"),
        ("prov GetInstanceProfile ec2-runtime", "role_runtime_provisioner", "iam:GetInstanceProfile", f"arn:aws:iam::{account_id}:instance-profile/{EC2_RUNTIME_PROFILE_NAME}", {}, None, "boundary_runtime_provisioner", "allowed"),
        ("prov PassRole ec2-runtime to ec2", "role_runtime_provisioner", "iam:PassRole", f"arn:aws:iam::{account_id}:role/{EC2_RUNTIME_ROLE_NAME}", {"iam:PassedToService": "ec2.amazonaws.com"}, None, "boundary_runtime_provisioner", "allowed"),
        ("prov ssm:SendCommand RunShell doc", "role_runtime_provisioner", "ssm:SendCommand", f"arn:aws:ssm:{region}::document/AWS-RunShellScript", {}, None, "boundary_runtime_provisioner", "allowed"),
        ("prov ssm:SendCommand tagged EC2 instance", "role_runtime_provisioner", "ssm:SendCommand", f"{ep}:instance/i-1", res, None, "boundary_runtime_provisioner", "allowed"),
        ("prov PutObject runtime.tfstate", "role_runtime_provisioner", "s3:PutObject", f"{tf_b}/runtime/terraform.tfstate", {"aws:SecureTransport": True, "aws:PrincipalAccount": account_id}, "tfstate_bucket_policy", "boundary_runtime_provisioner", "allowed"),
        ("prov DeleteObject runtime.tflock", "role_runtime_provisioner", "s3:DeleteObject", f"{tf_b}/runtime/terraform.tfstate.tflock", {"aws:SecureTransport": True, "aws:PrincipalAccount": account_id}, "tfstate_bucket_policy", "boundary_runtime_provisioner", "allowed"),
        ("prov GetObject recovery/releases/*", "role_runtime_provisioner", "s3:GetObject", f"{rc_b}/releases/sha/release-manifest.json", {}, None, "boundary_runtime_provisioner", "allowed"),
        ("prov GetObject recovery/backups/postgres/* (head-object)", "role_runtime_provisioner", "s3:GetObject", f"{rc_b}/backups/postgres/backup_1.dump", {}, None, "boundary_runtime_provisioner", "allowed"),
        ("prov ListBucket recovery backups/postgres/*", "role_runtime_provisioner", "s3:ListBucket", rc_b, {"s3:prefix": "backups/postgres/backup_1.dump"}, None, "boundary_runtime_provisioner", "allowed"),
        ("NEG: prov GetObject recovery/backups/historical/*", "role_runtime_provisioner", "s3:GetObject", f"{rc_b}/backups/historical/legacy.sql", {}, None, "boundary_runtime_provisioner", "implicitDeny"),
        ("NEG: prov ListBucket recovery broad backups/*", "role_runtime_provisioner", "s3:ListBucket", rc_b, {"s3:prefix": "backups/"}, None, "boundary_runtime_provisioner", "implicitDeny"),
        ("NEG: prov DeleteObject recovery backups/postgres/*", "role_runtime_provisioner", "s3:DeleteObject", f"{rc_b}/backups/postgres/backup_1.dump", {}, None, "boundary_runtime_provisioner", "explicitDeny"),
        ("NEG: prov ssm:GetParameter prod secret", "role_runtime_provisioner", "ssm:GetParameter", f"arn:aws:ssm:{region}:{account_id}:parameter/envscale/prod/postgres_password", {}, None, "boundary_runtime_provisioner", "explicitDeny"),
        ("NEG: prov ssm:GetParametersByPath prod", "role_runtime_provisioner", "ssm:GetParametersByPath", f"arn:aws:ssm:{region}:{account_id}:parameter/envscale/prod/", {}, None, "boundary_runtime_provisioner", "explicitDeny"),
        ("NEG: prov kms:Decrypt via SSM", "role_runtime_provisioner", "kms:Decrypt", LIVE_SSM_KMS_KEY_ARN, {"kms:ViaService": f"ssm.{region}.amazonaws.com"}, None, "boundary_runtime_provisioner", "explicitDeny"),
        ("NEG: prov iam:CreateRole privilege escalation", "role_runtime_provisioner", "iam:CreateRole", f"arn:aws:iam::{account_id}:role/rogue", {}, None, "boundary_runtime_provisioner", "explicitDeny"),
        ("NEG: prov iam:PassRole foundation_admin", "role_runtime_provisioner", "iam:PassRole", f"arn:aws:iam::{account_id}:role/envscale-foundation-admin-role", {"iam:PassedToService": "ec2.amazonaws.com"}, None, "boundary_runtime_provisioner", "implicitDeny"),
        ("NEG: prov iam:PassRole ec2_runtime to lambda", "role_runtime_provisioner", "iam:PassRole", f"arn:aws:iam::{account_id}:role/{EC2_RUNTIME_ROLE_NAME}", {"iam:PassedToService": "lambda.amazonaws.com"}, None, "boundary_runtime_provisioner", "implicitDeny"),
        ("NEG: prov RunInstances foreign Relmonition ENI", "role_runtime_provisioner", "ec2:RunInstances", f"{ep}:network-interface/eni-relmon", other, None, "boundary_runtime_provisioner", "implicitDeny"),
        ("NEG: prov RunInstances wrong region us-east-1", "role_runtime_provisioner", "ec2:RunInstances", f"arn:aws:ec2:us-east-1:{account_id}:instance/*", {**req, "aws:RequestedRegion": "us-east-1"}, None, "boundary_runtime_provisioner", "implicitDeny"),
        ("NEG: prov TerminateInstances Relmonition", "role_runtime_provisioner", "ec2:TerminateInstances", f"{ep}:instance/i-relmon", other, None, "boundary_runtime_provisioner", "implicitDeny"),
        ("NEG: prov DeleteVpc Relmonition", "role_runtime_provisioner", "ec2:DeleteVpc", f"{ep}:vpc/vpc-relmon", other, None, "boundary_runtime_provisioner", "implicitDeny"),
        ("NEG: prov SendCommand Relmonition instance", "role_runtime_provisioner", "ssm:SendCommand", f"{ep}:instance/i-relmon", other, None, "boundary_runtime_provisioner", "implicitDeny"),
        ("NEG: prov ReleaseAddress PersistentFoundation EIP", "role_runtime_provisioner", "ec2:ReleaseAddress", f"{ep}:elastic-ip/eipalloc-static", eip_persist, None, "boundary_runtime_provisioner", "explicitDeny"),
        ("NEG: prov ReleaseAddress untagged EIP", "role_runtime_provisioner", "ec2:ReleaseAddress", f"{ep}:elastic-ip/eipalloc-untagged", reg, None, "boundary_runtime_provisioner", "explicitDeny"),
        ("NEG: prov DeleteTags Project governance", "role_runtime_provisioner", "ec2:DeleteTags", f"{ep}:instance/i-1", {**res_reg, "aws:TagKeys": ["Project"]}, None, "boundary_runtime_provisioner", "explicitDeny"),
        ("NEG: prov CreateTags mutating Layer tag", "role_runtime_provisioner", "ec2:CreateTags", f"{ep}:instance/i-1", {**res_reg, "aws:RequestTag/Layer": "PersistentFoundation"}, None, "boundary_runtime_provisioner", "explicitDeny"),
        ("NEG: prov PutObject foundation.tfstate", "role_runtime_provisioner", "s3:PutObject", f"{tf_b}/foundation/terraform.tfstate", {"aws:SecureTransport": True, "aws:PrincipalAccount": account_id}, "tfstate_bucket_policy", "boundary_runtime_provisioner", "explicitDeny"),
        ("NEG: prov DeleteObject runtime.tfstate", "role_runtime_provisioner", "s3:DeleteObject", f"{tf_b}/runtime/terraform.tfstate", {"aws:SecureTransport": True, "aws:PrincipalAccount": account_id}, "tfstate_bucket_policy", "boundary_runtime_provisioner", "explicitDeny"),
        ("NEG: prov PutObject recovery backups/*", "role_runtime_provisioner", "s3:PutObject", f"{rc_b}/backups/postgres/x.dump", {}, None, "boundary_runtime_provisioner", "explicitDeny"),
        ("NEG: prov GetObject legacy vault", "role_runtime_provisioner", "s3:GetObject", f"{lg_b}/database/backup.sql", {}, None, "boundary_runtime_provisioner", "explicitDeny"),
    ]
    ec2_vectors = [
        ("ec2_runtime GetParameter /envscale/prod/*", "role_ec2_runtime", "ssm:GetParameter", f"arn:aws:ssm:{region}:{account_id}:parameter/envscale/prod/postgres_password", {}, None, "role_workload_permissions_boundary", "allowed"),
        ("ec2_runtime GetParametersByPath /envscale/prod", "role_ec2_runtime", "ssm:GetParametersByPath", f"arn:aws:ssm:{region}:{account_id}:parameter/envscale/prod", {}, None, "role_workload_permissions_boundary", "allowed"),
        ("ec2_runtime GetParametersByPath /envscale/prod/*", "role_ec2_runtime", "ssm:GetParametersByPath", f"arn:aws:ssm:{region}:{account_id}:parameter/envscale/prod/", {}, None, "role_workload_permissions_boundary", "allowed"),
        ("ec2_runtime kms:Decrypt live SSM KMS via ssm", "role_ec2_runtime", "kms:Decrypt", LIVE_SSM_KMS_KEY_ARN, {"kms:ViaService": f"ssm.{region}.amazonaws.com"}, None, "role_workload_permissions_boundary", "allowed"),
        ("ec2_runtime GetObject recovery/releases/*", "role_ec2_runtime", "s3:GetObject", f"{rc_b}/releases/sha/release-manifest.json", {}, None, "role_workload_permissions_boundary", "allowed"),
        ("ec2_runtime PutObject recovery/backups/postgres/*", "role_ec2_runtime", "s3:PutObject", f"{rc_b}/backups/postgres/b.dump", {}, None, "role_workload_permissions_boundary", "allowed"),
        ("NEG: ec2_runtime GetParametersByPath non-prod /other", "role_ec2_runtime", "ssm:GetParametersByPath", f"arn:aws:ssm:{region}:{account_id}:parameter/other", {}, None, "role_workload_permissions_boundary", "implicitDeny"),
        ("NEG: ec2_runtime GetParameter non-prod /other/*", "role_ec2_runtime", "ssm:GetParameter", f"arn:aws:ssm:{region}:{account_id}:parameter/other/app/secret", {}, None, "role_workload_permissions_boundary", "implicitDeny"),
        ("NEG: ec2_runtime PutParameter prod secret", "role_ec2_runtime", "ssm:PutParameter", f"arn:aws:ssm:{region}:{account_id}:parameter/envscale/prod/postgres_password", {}, None, "role_workload_permissions_boundary", "explicitDeny"),
        ("NEG: ec2_runtime kms:Decrypt w/o kms:ViaService", "role_ec2_runtime", "kms:Decrypt", LIVE_SSM_KMS_KEY_ARN, {}, None, "role_workload_permissions_boundary", "implicitDeny"),
        ("NEG: ec2_runtime ec2:RunInstances blocked", "role_ec2_runtime", "ec2:RunInstances", f"{ep}:instance/*", {**req, **reg}, None, "role_workload_permissions_boundary", "implicitDeny"),
        ("NEG: ec2_runtime ec2:TerminateInstances blocked", "role_ec2_runtime", "ec2:TerminateInstances", f"{ep}:instance/i-1", res_reg, None, "role_workload_permissions_boundary", "implicitDeny"),
        ("NEG: ec2_runtime iam:PassRole blocked", "role_ec2_runtime", "iam:PassRole", f"arn:aws:iam::{account_id}:role/{EC2_RUNTIME_ROLE_NAME}", {"iam:PassedToService": "ec2.amazonaws.com"}, None, "role_workload_permissions_boundary", "implicitDeny"),
        ("NEG: ec2_runtime ssm:SendCommand blocked", "role_ec2_runtime", "ssm:SendCommand", f"{ep}:instance/i-1", res, None, "role_workload_permissions_boundary", "implicitDeny"),
        ("NEG: ec2_runtime GetObject runtime.tfstate", "role_ec2_runtime", "s3:GetObject", f"{tf_b}/runtime/terraform.tfstate", {}, None, "role_workload_permissions_boundary", "explicitDeny"),
        ("NEG: ec2_runtime PutObject recovery/releases/*", "role_ec2_runtime", "s3:PutObject", f"{rc_b}/releases/latest.json", {}, None, "role_workload_permissions_boundary", "explicitDeny"),
        ("NEG: ec2_runtime DeleteObject recovery/backups/*", "role_ec2_runtime", "s3:DeleteObject", f"{rc_b}/backups/postgres/b.dump", {}, None, "role_workload_permissions_boundary", "explicitDeny"),
        ("NEG: ec2_runtime GetObject legacy vault", "role_ec2_runtime", "s3:GetObject", f"{lg_b}/database/x.sql", {}, None, "role_workload_permissions_boundary", "explicitDeny"),
    ]
    boundary_vectors = [
        ("NEG: prov-boundary allow_all -> ssm:GetParameter", "allow_all", "ssm:GetParameter", f"arn:aws:ssm:{region}:{account_id}:parameter/envscale/prod/x", {}, None, "boundary_runtime_provisioner", "explicitDeny"),
        ("NEG: prov-boundary allow_all -> kms:Decrypt", "allow_all", "kms:Decrypt", LIVE_SSM_KMS_KEY_ARN, {"kms:ViaService": f"ssm.{region}.amazonaws.com"}, None, "boundary_runtime_provisioner", "explicitDeny"),
        ("NEG: prov-boundary allow_all -> iam:CreateRole", "allow_all", "iam:CreateRole", f"arn:aws:iam::{account_id}:role/rogue", {}, None, "boundary_runtime_provisioner", "explicitDeny"),
        ("NEG: prov-boundary allow_all -> PutObject foundation.tfstate", "allow_all", "s3:PutObject", f"{tf_b}/foundation/terraform.tfstate", {}, None, "boundary_runtime_provisioner", "explicitDeny"),
        ("NEG: prov-boundary allow_all -> DeleteObject runtime.tfstate", "allow_all", "s3:DeleteObject", f"{tf_b}/runtime/terraform.tfstate", {}, None, "boundary_runtime_provisioner", "explicitDeny"),
        ("NEG: prov-boundary allow_all -> ReleaseAddress Persistent", "allow_all", "ec2:ReleaseAddress", f"{ep}:elastic-ip/eipalloc-1", eip_persist, None, "boundary_runtime_provisioner", "explicitDeny"),
        ("NEG: prov-boundary allow_all -> RunInstances us-east-1", "allow_all", "ec2:RunInstances", f"arn:aws:ec2:us-east-1:{account_id}:instance/*", {"aws:RequestedRegion": "us-east-1"}, None, "boundary_runtime_provisioner", "implicitDeny"),
        ("NEG: prov-boundary allow_all -> PassRole lambda", "allow_all", "iam:PassRole", f"arn:aws:iam::{account_id}:role/{EC2_RUNTIME_ROLE_NAME}", {"iam:PassedToService": "lambda.amazonaws.com"}, None, "boundary_runtime_provisioner", "implicitDeny"),
    ]
    return {"trust": trust_vectors, "provisioner": prov_vectors, "ec2_runtime": ec2_vectors, "boundary": boundary_vectors}


def check_runtime_provisioner_plan_safety(addr: str, rtype: str, after: dict) -> list[str]:
    """Enforce MFA trust, session duration, and boundary Deny invariants for Runtime Provisioner resources."""
    errors: list[str] = []
    if rtype == "aws_iam_role" and addr == "aws_iam_role.runtime_provisioner":
        max_dur = after.get("max_session_duration")
        if max_dur is not None and int(max_dur) > 3600:
            errors.append(f"Role '{addr}' max_session_duration ({max_dur}) exceeds 3600s limit.")
        trust_raw = after.get("assume_role_policy")
        if isinstance(trust_raw, str) and trust_raw:
            try:
                trust_doc = json.loads(trust_raw)
            except json.JSONDecodeError:
                return errors
            if not isinstance(trust_doc, dict) or not isinstance(trust_doc.get("Statement"), list):
                errors.append(f"Role '{addr}' trust policy must be a dict with a 'Statement' list.")
                return errors
            stmts = [s for s in trust_doc["Statement"] if isinstance(s, dict) and s.get("Effect") == "Allow"]
            if len(stmts) != 1:
                errors.append(f"Role '{addr}' trust policy must have exactly 1 Allow statement.")
            for st in stmts:
                princ = st.get("Principal")
                aws_p = princ.get("AWS") if isinstance(princ, dict) else None
                plist = aws_p if isinstance(aws_p, list) else ([aws_p] if aws_p else [])
                if not isinstance(princ, dict) or set(princ.keys()) != {"AWS"} or not plist or any(
                    not str(p).startswith(f"arn:aws:iam::{ACCOUNT}:user/") or str(p).endswith(":root") for p in plist
                ):
                    errors.append(f"Role '{addr}' trust Principal must allow only account {ACCOUNT} IAM user ARN(s).")
                cond = st.get("Condition")
                bool_op = cond.get("Bool") if isinstance(cond, dict) else None
                num_op = cond.get("NumericLessThan") if isinstance(cond, dict) else None
                mfa = bool_op.get("aws:MultiFactorAuthPresent") if isinstance(bool_op, dict) else None
                age = num_op.get("aws:MultiFactorAuthAge") if isinstance(num_op, dict) else None
                if str(mfa).lower() != "true":
                    errors.append(f"Role '{addr}' trust policy lacks MFA Bool condition aws:MultiFactorAuthPresent=true.")
                if str(age) != "3600":
                    errors.append(f"Role '{addr}' trust policy lacks NumericLessThan aws:MultiFactorAuthAge=3600.")
    if rtype == "aws_iam_policy" and addr == "aws_iam_policy.runtime_provisioner_permissions_boundary":
        pol_raw = after.get("policy")
        if isinstance(pol_raw, str) and pol_raw:
            try:
                pol_doc = json.loads(pol_raw)
            except json.JSONDecodeError:
                return errors
            if not isinstance(pol_doc, dict) or not isinstance(pol_doc.get("Statement"), list):
                errors.append(f"Runtime provisioner permissions boundary '{addr}' must be a dict with a 'Statement' list.")
                return errors
            stmts = [s for s in pol_doc["Statement"] if isinstance(s, dict)]
            deny_acts = {
                str(a) for s in stmts if s.get("Effect") == "Deny"
                for a in (s.get("Action") if isinstance(s.get("Action"), list) else [s.get("Action")])
            }
            for req in ("iam:Create*", "iam:Put*", "iam:Delete*", "iam:Attach*", "s3:DeleteBucket", "s3:PutBucketPolicy", "ssm:GetParameter", "kms:*"):
                if req not in deny_acts:
                    errors.append(f"Runtime provisioner permissions boundary '{addr}' missing mandatory explicit Deny '{req}'.")
    return errors


def verify_runtime_iam_matrix(*, live_aws: bool = False, tfstate_bucket_policy: dict | None = None) -> dict[str, int]:
    """Validate two-role runtime IAM policies offline and optionally via read-only AWS IAM/AccessAnalyzer."""
    policies = build_all_runtime_iam_policies()
    policies["tfstate_bucket_policy"] = tfstate_bucket_policy or load_tfstate_bucket_policy()
    policies["allow_all"] = {"Version": "2012-10-17", "Statement": [{"Effect": "Allow", "Action": "*", "Resource": "*"}]}
    vectors = build_runtime_iam_simulation_vectors()

    if live_aws:
        analyzer_docs = {
            k: policies[k]
            for k in ("trust_runtime_provisioner", "role_runtime_provisioner", "boundary_runtime_provisioner", "trust_ec2_runtime", "role_ec2_runtime")
        }
        sim.run_access_analyzer_validation(analyzer_docs)

    counts = {"trust": 0, "provisioner": 0, "ec2_runtime": 0, "boundary": 0}
    for label, pkey, act, res, ctx, expected in vectors["trust"]:
        dec = sim.eval_iam_policy_local_harness(policies[pkey], act, res, ctx)
        if dec != expected:
            sim._fail(f"{label}: LocalHarness got {dec}, expected {expected}")
        counts["trust"] += 1

    for group in ("provisioner", "ec2_runtime", "boundary"):
        for label, pkey, act, res, ctx, rp_key, pb_key, expected in vectors[group]:
            rp_doc = policies[rp_key] if rp_key else None
            pb_doc = policies[pb_key] if pb_key else None
            local_dec = sim.eval_iam_policy_local_harness(policies[pkey], act, res, ctx, rp_doc, pb_doc)
            if local_dec != expected:
                sim._fail(f"{label}: LocalHarness got {local_dec}, expected {expected}")
            if live_aws:
                aws_dec = sim.simulate_via_aws_iam(policies[pkey], act, res, ctx, rp_doc, pb_doc)
                if aws_dec != expected:
                    sim._fail(f"{label}: AWS simulate-custom-policy got {aws_dec}, expected {expected}")
            counts[group] += 1

    from iam_boundary_policies import build_combined_sg_rule_scenarios, eval_combined_sg_rule_operation
    ep = f"arn:aws:ec2:{REGION}:{ACCOUNT}"
    counts["combined_sg_sgr"] = 0
    for act in ("ec2:AuthorizeSecurityGroupIngress", "ec2:AuthorizeSecurityGroupEgress"):
        for label, ctx, exp_sg, exp_sgr, exp_comb in build_combined_sg_rule_scenarios(REGION):
            res = eval_combined_sg_rule_operation(
                sim,
                policies["role_runtime_provisioner"],
                policies["boundary_runtime_provisioner"],
                act,
                f"{ep}:security-group/sg-eval",
                f"{ep}:security-group-rule/*",
                ctx,
                live_aws=live_aws,
            )
            if (res["sg"], res["sgr"], res["combined"]) != (exp_sg, exp_sgr, exp_comb):
                sim._fail(f"Combined {act} ({label}): got {res}, expected {(exp_sg, exp_sgr, exp_comb)}")
            counts["combined_sg_sgr"] += 1
    return counts


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate EnvScale B2 two-role runtime IAM architecture.")
    parser.add_argument("--offline", action="store_true", help="Run local condition harness checks only")
    parser.add_argument("--live-aws", action="store_true", help="Run read-only Access Analyzer + AWS IAM simulator")
    parser.add_argument("--dump-json", action="store_true", help="Print rendered two-role JSON policy bundle")
    args = parser.parse_args()

    if args.dump_json:
        policies = build_all_runtime_iam_policies()
        bundle = {k: v for k, v in policies.items() if k != "role_workload_permissions_boundary"}
        print(json.dumps(bundle, indent=2))
        return 0

    counts = verify_runtime_iam_matrix(live_aws=bool(args.live_aws))
    mode = "LIVE AWS + LOCAL HARNESS" if args.live_aws else "OFFLINE LOCAL HARNESS"
    print(f"[PASS] B2 Two-Role Runtime IAM Verification ({mode}): {sum(counts.values())} vectors passed ({counts})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

