#!/usr/bin/env python3
"""
EnvScale Foundation IAM Boundary, Read-Only Plan & Hardened Foundation Policy Builders.

Kept separate from `iam_policy_simulator.py` to honor the strict 500-line file limit
while preserving exact parity with `iam_boundary.tf`, `iam_foundation.tf`,
`iam_foundation_plan.tf`, `iam_admin.tf`, and Day-0 boundary JSONs.
"""

from __future__ import annotations

import json
import pathlib
import re
from typing import Any

ACCOUNT = "982534376726"
REGION = "ap-south-1"
OIDC_ARN = f"arn:aws:iam::{ACCOUNT}:oidc-provider/token.actions.githubusercontent.com"
BOUNDARY_POLICY_ARN = f"arn:aws:iam::{ACCOUNT}:policy/envscale-workload-permissions-boundary"
RUNTIME_PROVISIONER_BOUNDARY_ARN = f"arn:aws:iam::{ACCOUNT}:policy/envscale-runtime-provisioner-permissions-boundary"
SSM_CORE_POLICY_ARN = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
EC2_RUNTIME_ROLE_ARN = f"arn:aws:iam::{ACCOUNT}:role/envscale-ec2-runtime-role"
EC2_RUNTIME_PROFILE_ARN = f"arn:aws:iam::{ACCOUNT}:instance-profile/envscale-ec2-runtime-profile"
RUNTIME_PROVISIONER_ROLE_ARN = f"arn:aws:iam::{ACCOUNT}:role/envscale-runtime-provisioner-role"

WORKLOAD_MANAGED_ROLE_ARNS = [
    EC2_RUNTIME_ROLE_ARN,
    f"arn:aws:iam::{ACCOUNT}:role/envscale-github-release-role",
    f"arn:aws:iam::{ACCOUNT}:role/envscale-github-deploy-role",
    f"arn:aws:iam::{ACCOUNT}:role/envscale-github-recovery-role",
]

FOUNDATION_PROTECTED_ROLE_ARNS = [
    f"arn:aws:iam::{ACCOUNT}:role/envscale-github-foundation-role",
    f"arn:aws:iam::{ACCOUNT}:role/envscale-github-foundation-plan-role",
    f"arn:aws:iam::{ACCOUNT}:role/envscale-foundation-admin-role",
]

ENUMERATED_IAM_READ_ARNS = WORKLOAD_MANAGED_ROLE_ARNS + FOUNDATION_PROTECTED_ROLE_ARNS + [
    RUNTIME_PROVISIONER_ROLE_ARN,
    EC2_RUNTIME_PROFILE_ARN,
    OIDC_ARN,
    BOUNDARY_POLICY_ARN,
    RUNTIME_PROVISIONER_BOUNDARY_ARN,
]


def build_hardened_foundation_and_boundary_policies(
    foundation_dir: pathlib.Path,
    tfstate_arn: str,
    rec_arn: str,
    leg_arn: str,
    ssm_prod: str,
    ssm_non_secret: list[str],
    ssm_securestrings: list[str],
) -> dict[str, dict]:
    day0_boundary_path = foundation_dir.parent / "bootstrap" / "day0-bootstrap-permissions-boundary.json"
    day0_boundary = json.loads(day0_boundary_path.read_text(encoding="utf-8"))
    day0_seal_path = foundation_dir.parent / "bootstrap" / "day0-initial-policy-seal.json"
    day0_seal = json.loads(day0_seal_path.read_text(encoding="utf-8"))
    day0_seal_boundary_path = foundation_dir.parent / "bootstrap" / "day0-initial-seal-permissions-boundary.json"
    day0_seal_boundary = json.loads(day0_seal_boundary_path.read_text(encoding="utf-8"))
    foundation_bootstrap_path = foundation_dir.parent / "bootstrap" / "foundation-iam-bootstrap-policy.json"
    foundation_iam_bootstrap = json.loads(foundation_bootstrap_path.read_text(encoding="utf-8"))

    workload_boundary = {
        "Version": "2012-10-17",
        "Statement": [
            {"Sid": "AllowBoundedStateAndRecoveryS3Operations", "Effect": "Allow", "Action": ["s3:ListBucket", "s3:GetBucketLocation", "s3:GetObject", "s3:GetObjectVersion", "s3:PutObject", "s3:DeleteObject"], "Resource": [tfstate_arn, f"{tfstate_arn}/*", rec_arn, f"{rec_arn}/*"]},
            {"Sid": "AllowBoundedSSMAndKmsViaSSMOperations", "Effect": "Allow", "Action": ["ssm:DescribeAssociation", "ssm:GetDeployablePatchSnapshotForInstance", "ssm:GetDocument", "ssm:DescribeDocument", "ssm:GetManifest", "ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath", "ssm:ListAssociations", "ssm:ListInstanceAssociations", "ssm:PutInventory", "ssm:PutComplianceItems", "ssm:PutConfigurePackageResult", "ssm:UpdateAssociationStatus", "ssm:UpdateInstanceAssociationStatus", "ssm:UpdateInstanceInformation", "ssm:DescribeParameters", "ssm:DescribeInstanceInformation", "ssm:ListCommandInvocations", "ssm:GetCommandInvocation", "ssm:SendCommand", "ssmmessages:CreateControlChannel", "ssmmessages:CreateDataChannel", "ssmmessages:OpenControlChannel", "ssmmessages:OpenDataChannel", "ec2messages:AcknowledgeMessage", "ec2messages:DeleteMessage", "ec2messages:FailMessage", "ec2messages:GetEndpoint", "ec2messages:GetMessages", "ec2messages:SendReply"], "Resource": "*"},
            {"Sid": "AllowBoundedSSMKmsDecryptViaServiceOnly", "Effect": "Allow", "Action": ["kms:Decrypt"], "Resource": f"arn:aws:kms:{REGION}:{ACCOUNT}:key/*", "Condition": {"StringEquals": {"kms:ViaService": f"ssm.{REGION}.amazonaws.com"}}},
            {"Sid": "AllowBoundedRuntimeEc2AndEksLifecycle", "Effect": "Allow", "Action": ["ec2:Describe*", "ec2:CreateVpc", "ec2:CreateInternetGateway", "ec2:CreateVolume", "ec2:CreateSubnet", "ec2:CreateRouteTable", "ec2:CreateSecurityGroup", "ec2:RunInstances", "ec2:CreateTags", "ec2:DeleteTags", "ec2:ModifyVpcAttribute", "ec2:ModifySubnetAttribute", "ec2:AttachInternetGateway", "ec2:CreateRoute", "ec2:ReplaceRoute", "ec2:AssociateRouteTable", "ec2:AuthorizeSecurityGroupIngress", "ec2:AuthorizeSecurityGroupEgress", "ec2:RevokeSecurityGroupIngress", "ec2:RevokeSecurityGroupEgress", "ec2:UpdateSecurityGroupRuleDescriptionsIngress", "ec2:UpdateSecurityGroupRuleDescriptionsEgress", "ec2:StartInstances", "ec2:StopInstances", "ec2:RebootInstances", "ec2:ModifyInstanceAttribute", "ec2:ModifyInstanceMetadataOptions", "ec2:ModifyVolume", "ec2:AttachVolume", "ec2:AssociateAddress", "ec2:DisassociateAddress", "ec2:TerminateInstances", "ec2:DetachVolume", "ec2:DeleteVolume", "ec2:DeleteSecurityGroup", "ec2:DisassociateRouteTable", "ec2:DeleteRoute", "ec2:DeleteRouteTable", "ec2:DetachInternetGateway", "ec2:DeleteInternetGateway", "ec2:DeleteSubnet", "ec2:DeleteVpc", "eks:DescribeCluster", "eks:DescribeNodegroup", "eks:ListClusters", "eks:ListNodegroups", "eks:CreateCluster", "eks:CreateNodegroup", "eks:DeleteCluster", "eks:DeleteNodegroup", "eks:UpdateClusterConfig", "eks:UpdateNodegroupConfig", "eks:TagResource", "eks:UntagResource"], "Resource": "*", "Condition": {"StringEquals": {"aws:RequestedRegion": REGION}}},
            {"Sid": "AllowBoundedRuntimeRoleLookup", "Effect": "Allow", "Action": ["iam:GetRole", "iam:GetInstanceProfile"], "Resource": [EC2_RUNTIME_ROLE_ARN, f"arn:aws:iam::{ACCOUNT}:role/envscale-eks-*", EC2_RUNTIME_PROFILE_ARN]},
            {"Sid": "AllowBoundedPassEc2AndNodeRolesToEc2Only", "Effect": "Allow", "Action": ["iam:PassRole"], "Resource": [EC2_RUNTIME_ROLE_ARN, f"arn:aws:iam::{ACCOUNT}:role/envscale-eks-node-*"], "Condition": {"StringEquals": {"iam:PassedToService": "ec2.amazonaws.com"}}},
            {"Sid": "AllowBoundedPassEksClusterRoleToEksOnly", "Effect": "Allow", "Action": ["iam:PassRole"], "Resource": f"arn:aws:iam::{ACCOUNT}:role/envscale-eks-cluster-*", "Condition": {"StringEquals": {"iam:PassedToService": "eks.amazonaws.com"}}},
            {"Sid": "DenyIamPrivilegeEscalationWithinBoundary", "Effect": "Deny", "Action": ["iam:Create*", "iam:Delete*", "iam:Put*", "iam:Update*", "iam:Attach*", "iam:Detach*", "iam:Add*", "iam:Remove*", "iam:Tag*", "iam:Untag*"], "Resource": "*"},
            {"Sid": "DenyProtectedFoundationAndVaultDestruction", "Effect": "Deny", "Action": ["s3:DeleteBucket", "s3:DeleteObjectVersion", "s3:DeleteBucketPolicy", "s3:PutBucketPolicy"], "Resource": [tfstate_arn, f"{tfstate_arn}/*", rec_arn, f"{rec_arn}/*"]},
            {"Sid": "DenyCriticalStateAndBackupDeletionAndLegacyVault", "Effect": "Deny", "Action": ["s3:DeleteObject"], "Resource": [f"{tfstate_arn}/*.tfstate", f"{rec_arn}/backups/*", f"{rec_arn}/releases/*"]},
            {"Sid": "DenyLegacyVaultAccess", "Effect": "Deny", "Action": ["s3:*"], "Resource": [leg_arn, f"{leg_arn}/*"]},
            {"Sid": "DenyFoundationStateWriteAndEipRelease", "Effect": "Deny", "Action": ["s3:PutObject"], "Resource": f"{tfstate_arn}/foundation/*"},
            {"Sid": "DenyStaticEipReleaseAndOrgBilling", "Effect": "Deny", "Action": ["ec2:ReleaseAddress", "organizations:*", "account:*"], "Resource": "*"},
        ],
    }

    trust_plan = {"Version": "2012-10-17", "Statement": [{"Sid": "AllowGitHubFoundationPlanEnvironmentOIDC", "Effect": "Allow", "Principal": {"Federated": OIDC_ARN}, "Action": "sts:AssumeRoleWithWebIdentity", "Condition": {"StringEquals": {"token.actions.githubusercontent.com:aud": "sts.amazonaws.com", "token.actions.githubusercontent.com:sub": "repo:P20000@61460949/EnvScale@1323134407:environment:foundation-plan"}}}]}

    role_plan = {
        "Version": "2012-10-17",
        "Statement": [
            {"Sid": "AllowFoundationTfstateListReadOnly", "Effect": "Allow", "Action": ["s3:ListBucket"], "Resource": tfstate_arn, "Condition": {"StringLike": {"s3:prefix": ["foundation/*"]}}},
            {"Sid": "AllowFoundationTfstateReadOnly", "Effect": "Allow", "Action": ["s3:GetBucketLocation"], "Resource": tfstate_arn},
            {"Sid": "AllowFoundationTfstateObjectReadOnly", "Effect": "Allow", "Action": ["s3:GetObject"], "Resource": f"{tfstate_arn}/foundation/terraform.tfstate"},
            {"Sid": "AllowRecoveryBucketConfigReadOnly", "Effect": "Allow", "Action": ["s3:ListBucket", "s3:GetBucket*", "s3:GetEncryptionConfiguration", "s3:GetLifecycleConfiguration", "s3:GetAccelerateConfiguration", "s3:GetReplicationConfiguration", "s3:GetMetricsConfiguration", "s3:GetAnalyticsConfiguration", "s3:GetInventoryConfiguration", "s3:GetIntelligentTieringConfiguration"], "Resource": rec_arn},
            {"Sid": "AllowEnumeratedFoundationIamReadOnly", "Effect": "Allow", "Action": ["iam:GetRole", "iam:GetRolePolicy", "iam:ListRolePolicies", "iam:ListAttachedRolePolicies", "iam:ListInstanceProfilesForRole", "iam:ListRoleTags", "iam:GetInstanceProfile", "iam:ListInstanceProfileTags", "iam:GetOpenIDConnectProvider", "iam:ListOpenIDConnectProviderTags", "iam:GetPolicy", "iam:GetPolicyVersion", "iam:ListPolicyVersions", "iam:ListPolicyTags", "iam:ListEntitiesForPolicy"], "Resource": ENUMERATED_IAM_READ_ARNS},
            {"Sid": "AllowOidcProviderDiscovery", "Effect": "Allow", "Action": ["iam:ListOpenIDConnectProviders"], "Resource": "*"},
            {"Sid": "AllowNonSecretSSMParametersReadOnly", "Effect": "Allow", "Action": ["ssm:GetParameter", "ssm:GetParameters", "ssm:ListTagsForResource"], "Resource": ssm_non_secret},
            {"Sid": "AllowSSMAndEipDescribeReadOnly", "Effect": "Allow", "Action": ["ssm:DescribeParameters", "ec2:DescribeAddresses", "ec2:DescribeAddressesAttribute"], "Resource": "*", "Condition": {"StringEquals": {"aws:RequestedRegion": REGION}}},
            {"Sid": "DenyAllMutationsDeletesSecretsAndKms", "Effect": "Deny", "Action": ["iam:Create*", "iam:Delete*", "iam:Update*", "iam:Put*", "iam:Attach*", "iam:Detach*", "iam:Add*", "iam:Remove*", "iam:Tag*", "iam:Untag*", "s3:Put*", "s3:Delete*", "ssm:Put*", "ssm:Delete*", "ssm:Label*", "kms:Encrypt", "kms:Decrypt", "ec2:AllocateAddress", "ec2:ReleaseAddress", "ec2:RunInstances", "ec2:TerminateInstances"], "Resource": "*"},
            {"Sid": "DenySecureStringSecretsRead", "Effect": "Deny", "Action": ["ssm:Get*"], "Resource": ssm_securestrings},
            {"Sid": "DenyRecoveryDataAndLegacyVault", "Effect": "Deny", "Action": ["s3:*"], "Resource": [f"{rec_arn}/*", leg_arn, f"{leg_arn}/*"]},
            {"Sid": "DenyNonFoundationStateReads", "Effect": "Deny", "Action": ["s3:GetObject"], "Resource": [f"{tfstate_arn}/runtime/*", f"{tfstate_arn}/eks/*"]},
        ],
    }

    role_foundation = {
        "Version": "2012-10-17",
        "Statement": [
            {"Sid": "AllowFoundationTfstateListScoped", "Effect": "Allow", "Action": ["s3:ListBucket"], "Resource": tfstate_arn, "Condition": {"StringLike": {"s3:prefix": ["foundation/*"]}}},
            {"Sid": "AllowFoundationTfstateBucketLocation", "Effect": "Allow", "Action": ["s3:GetBucketLocation"], "Resource": tfstate_arn},
            {"Sid": "AllowFoundationStateReadWrite", "Effect": "Allow", "Action": ["s3:GetObject", "s3:PutObject"], "Resource": [f"{tfstate_arn}/foundation/terraform.tfstate"]},
            {"Sid": "AllowFoundationNativeLockFile", "Effect": "Allow", "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"], "Resource": [f"{tfstate_arn}/foundation/terraform.tfstate.tflock"]},
            {"Sid": "AllowRecoveryBucketFoundationAdministration", "Effect": "Allow", "Action": ["s3:CreateBucket", "s3:ListBucket", "s3:GetBucket*", "s3:GetEncryptionConfiguration", "s3:GetLifecycleConfiguration", "s3:GetAccelerateConfiguration", "s3:GetReplicationConfiguration", "s3:GetMetricsConfiguration", "s3:GetAnalyticsConfiguration", "s3:GetInventoryConfiguration", "s3:GetIntelligentTieringConfiguration", "s3:PutBucketPublicAccessBlock", "s3:PutBucketOwnershipControls", "s3:PutBucketVersioning", "s3:PutEncryptionConfiguration", "s3:PutLifecycleConfiguration", "s3:PutBucketTagging", "s3:PutBucketPolicy"], "Resource": [rec_arn, f"{rec_arn}/*"]},
            {"Sid": "AllowEnumeratedFoundationIamReadOnly", "Effect": "Allow", "Action": ["iam:GetRole", "iam:GetRolePolicy", "iam:ListRolePolicies", "iam:ListAttachedRolePolicies", "iam:ListInstanceProfilesForRole", "iam:ListRoleTags", "iam:GetInstanceProfile", "iam:ListInstanceProfileTags", "iam:GetOpenIDConnectProvider", "iam:ListOpenIDConnectProviderTags", "iam:GetPolicy", "iam:GetPolicyVersion", "iam:ListPolicyVersions", "iam:ListPolicyTags", "iam:ListEntitiesForPolicy"], "Resource": ENUMERATED_IAM_READ_ARNS},
            {"Sid": "AllowOidcProviderDiscovery", "Effect": "Allow", "Action": ["iam:ListOpenIDConnectProviders"], "Resource": "*"},
            {"Sid": "AllowBoundedWorkloadRoleCreationAndBoundary", "Effect": "Allow", "Action": ["iam:CreateRole", "iam:PutRolePermissionsBoundary"], "Resource": WORKLOAD_MANAGED_ROLE_ARNS, "Condition": {"StringEquals": {"iam:PermissionsBoundary": BOUNDARY_POLICY_ARN}}},
            {"Sid": "AllowBoundedRuntimeProvisionerRoleCreationAndBoundary", "Effect": "Allow", "Action": ["iam:CreateRole", "iam:PutRolePermissionsBoundary"], "Resource": RUNTIME_PROVISIONER_ROLE_ARN, "Condition": {"StringEquals": {"iam:PermissionsBoundary": RUNTIME_PROVISIONER_BOUNDARY_ARN}}},
            {"Sid": "AllowEnumeratedWorkloadRoleNonBoundaryUpdates", "Effect": "Allow", "Action": ["iam:UpdateRole", "iam:UpdateRoleDescription", "iam:DeleteRole", "iam:UpdateAssumeRolePolicy", "iam:PutRolePolicy", "iam:DeleteRolePolicy", "iam:TagRole", "iam:UntagRole"], "Resource": WORKLOAD_MANAGED_ROLE_ARNS + [RUNTIME_PROVISIONER_ROLE_ARN]},
            {"Sid": "AllowBoundedEc2RuntimeCorePolicyAttachment", "Effect": "Allow", "Action": ["iam:AttachRolePolicy", "iam:DetachRolePolicy"], "Resource": EC2_RUNTIME_ROLE_ARN, "Condition": {"ArnEquals": {"iam:PolicyARN": SSM_CORE_POLICY_ARN}}},
            {"Sid": "AllowEnumeratedInstanceProfileAndOidcWrites", "Effect": "Allow", "Action": ["iam:CreateInstanceProfile", "iam:DeleteInstanceProfile", "iam:AddRoleToInstanceProfile", "iam:RemoveRoleFromInstanceProfile", "iam:TagInstanceProfile", "iam:UntagInstanceProfile", "iam:CreateOpenIDConnectProvider", "iam:UpdateOpenIDConnectProviderThumbprint", "iam:AddClientIDToOpenIDConnectProvider", "iam:RemoveClientIDFromOpenIDConnectProvider", "iam:TagOpenIDConnectProvider", "iam:UntagOpenIDConnectProvider"], "Resource": [EC2_RUNTIME_PROFILE_ARN, OIDC_ARN]},
            {"Sid": "AllowNonSecretSSMParametersOnly", "Effect": "Allow", "Action": ["ssm:GetParameter", "ssm:GetParameters", "ssm:PutParameter", "ssm:DeleteParameter", "ssm:AddTagsToResource", "ssm:RemoveTagsFromResource", "ssm:ListTagsForResource"], "Resource": ssm_non_secret},
            {"Sid": "AllowSSMDescribeAndFoundationEipDescribe", "Effect": "Allow", "Action": ["ssm:DescribeParameters", "ec2:DescribeAddresses", "ec2:DescribeAddressesAttribute"], "Resource": "*", "Condition": {"StringEquals": {"aws:RequestedRegion": REGION}}},
            {"Sid": "AllowOptionalStaticFoundationEipProvisioning", "Effect": "Allow", "Action": ["ec2:AllocateAddress", "ec2:CreateTags"], "Resource": f"arn:aws:ec2:{REGION}:{ACCOUNT}:elastic-ip/*", "Condition": {"StringEquals": {"aws:RequestTag/Project": "EnvScale"}}},
            {"Sid": "DenySelfAndBreakGlassAdminMutation", "Effect": "Deny", "Action": ["iam:Create*", "iam:Delete*", "iam:Update*", "iam:Put*", "iam:Attach*", "iam:Detach*", "iam:Add*", "iam:Remove*", "iam:TagRole", "iam:UntagRole"], "Resource": FOUNDATION_PROTECTED_ROLE_ARNS},
            {"Sid": "DenyBoundaryRemovalAndPolicyWeakening", "Effect": "Deny", "Action": ["iam:DeleteRolePermissionsBoundary", "iam:CreatePolicy", "iam:CreatePolicyVersion", "iam:DeletePolicy", "iam:DeletePolicyVersion", "iam:SetDefaultPolicyVersion", "iam:TagPolicy", "iam:UntagPolicy"], "Resource": "*"},
            {"Sid": "DenySecureStringSecretsAndKmsAccess", "Effect": "Deny", "Action": ["ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath", "ssm:PutParameter", "ssm:DeleteParameter", "ssm:DeleteParameters", "ssm:LabelParameterVersion"], "Resource": ssm_securestrings},
            {"Sid": "DenyKmsEncryptDecrypt", "Effect": "Deny", "Action": ["kms:Encrypt", "kms:Decrypt"], "Resource": "*"},
            {"Sid": "DenyRuntimeStateAndRecoveryDataMutation", "Effect": "Deny", "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:DeleteObjectVersion"], "Resource": [f"{tfstate_arn}/runtime/*", f"{tfstate_arn}/eks/*", f"{rec_arn}/backups/*", f"{rec_arn}/releases/*", f"{rec_arn}/lifecycle/*"]},
            {"Sid": "DenyStateAndRecoveryBucketOrVersionDeletion", "Effect": "Deny", "Action": ["s3:DeleteBucket", "s3:DeleteObjectVersion"], "Resource": [tfstate_arn, f"{tfstate_arn}/*", rec_arn, f"{rec_arn}/*"]},
            {"Sid": "DenyTfstateObjectDeletion", "Effect": "Deny", "Action": ["s3:DeleteObject"], "Resource": f"{tfstate_arn}/*.tfstate"},
            {"Sid": "DenyLegacyVaultAccess", "Effect": "Deny", "Action": ["s3:*"], "Resource": [leg_arn, f"{leg_arn}/*"]},
            {"Sid": "DenyRuntimeComputeProvisioningAndEipRelease", "Effect": "Deny", "Action": ["ec2:RunInstances", "ec2:TerminateInstances", "ec2:CreateVpc", "ec2:DeleteVpc", "ec2:ReleaseAddress"], "Resource": "*"},
        ],
    }

    role_foundation_admin = {
        "Version": "2012-10-17",
        "Statement": [
            {"Sid": "AllowFoundationBucketsAndStateAdministration", "Effect": "Allow", "Action": ["s3:CreateBucket", "s3:ListBucket", "s3:ListBucketVersions", "s3:GetBucket*", "s3:PutBucketPublicAccessBlock", "s3:GetBucketPublicAccessBlock", "s3:PutBucketOwnershipControls", "s3:PutBucketVersioning", "s3:PutEncryptionConfiguration", "s3:GetEncryptionConfiguration", "s3:PutLifecycleConfiguration", "s3:GetLifecycleConfiguration", "s3:PutBucketTagging", "s3:PutBucketPolicy", "s3:GetObject", "s3:GetObjectVersion", "s3:PutObject"], "Resource": [tfstate_arn, f"{tfstate_arn}/*", rec_arn, f"{rec_arn}/*"]},
            {"Sid": "AllowFoundationNativeStateLockRelease", "Effect": "Allow", "Action": ["s3:DeleteObject"], "Resource": f"{tfstate_arn}/foundation/terraform.tfstate.tflock"},
            {"Sid": "AllowLegacyVaultReadOnlyForHistoricalMigration", "Effect": "Allow", "Action": ["s3:ListBucket", "s3:ListBucketVersions", "s3:GetBucketLocation", "s3:GetObject", "s3:GetObjectVersion"], "Resource": [leg_arn, f"{leg_arn}/*"]},
            {"Sid": "AllowFoundationIAMAndOidcAdministration", "Effect": "Allow", "Action": ["iam:Get*", "iam:List*", "iam:CreateRole", "iam:UpdateRole", "iam:UpdateAssumeRolePolicy", "iam:PutRolePermissionsBoundary", "iam:TagRole", "iam:UntagRole", "iam:PutRolePolicy", "iam:DeleteRolePolicy", "iam:AttachRolePolicy", "iam:DetachRolePolicy", "iam:CreateInstanceProfile", "iam:AddRoleToInstanceProfile", "iam:RemoveRoleFromInstanceProfile", "iam:TagInstanceProfile", "iam:CreateOpenIDConnectProvider", "iam:UpdateOpenIDConnectProviderThumbprint", "iam:TagOpenIDConnectProvider"], "Resource": [f"arn:aws:iam::{ACCOUNT}:role/envscale-*", f"arn:aws:iam::{ACCOUNT}:instance-profile/envscale-*", OIDC_ARN]},
            {"Sid": "AllowOidcProviderDiscovery", "Effect": "Allow", "Action": ["iam:ListOpenIDConnectProviders"], "Resource": "*"},
            {"Sid": "AllowWorkloadBoundaryPolicyAdministration", "Effect": "Allow", "Action": ["iam:GetPolicy", "iam:GetPolicyVersion", "iam:ListPolicyVersions", "iam:ListPolicyTags", "iam:ListEntitiesForPolicy", "iam:CreatePolicy", "iam:CreatePolicyVersion", "iam:DeletePolicy", "iam:DeletePolicyVersion", "iam:SetDefaultPolicyVersion", "iam:TagPolicy", "iam:UntagPolicy"], "Resource": [BOUNDARY_POLICY_ARN, RUNTIME_PROVISIONER_BOUNDARY_ARN]},
            {"Sid": "AllowOutOfBandSSMParameterSeeding", "Effect": "Allow", "Action": ["ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath", "ssm:PutParameter", "ssm:AddTagsToResource", "ssm:ListTagsForResource"], "Resource": ssm_prod},
            {"Sid": "AllowSSMDescribeAndFoundationEipDescribe", "Effect": "Allow", "Action": ["ssm:DescribeParameters", "ec2:DescribeAddresses", "ec2:DescribeAddressesAttribute"], "Resource": "*", "Condition": {"StringEquals": {"aws:RequestedRegion": REGION}}},
            {"Sid": "AllowSSMKmsViaServiceOnly", "Effect": "Allow", "Action": ["kms:Encrypt", "kms:Decrypt"], "Resource": f"arn:aws:kms:{REGION}:{ACCOUNT}:key/*", "Condition": {"StringEquals": {"kms:ViaService": f"ssm.{REGION}.amazonaws.com"}}},
            {"Sid": "AllowSSMKmsKeyDescribe", "Effect": "Allow", "Action": ["kms:DescribeKey"], "Resource": f"arn:aws:kms:{REGION}:{ACCOUNT}:key/*"},
            {"Sid": "AllowOptionalStaticFoundationEipProvisioning", "Effect": "Allow", "Action": ["ec2:AllocateAddress", "ec2:CreateTags"], "Resource": f"arn:aws:ec2:{REGION}:{ACCOUNT}:elastic-ip/*", "Condition": {"StringEquals": {"aws:RequestTag/Project": "EnvScale"}}},
            {"Sid": "DenyLegacyVaultMutations", "Effect": "Deny", "Action": ["s3:PutObject", "s3:DeleteObject", "s3:DeleteObjectVersion", "s3:DeleteBucket", "s3:PutBucketPolicy", "s3:DeleteBucketPolicy"], "Resource": [leg_arn, f"{leg_arn}/*"]},
            {"Sid": "DenyStateAndRecoveryBucketOrVersionDeletion", "Effect": "Deny", "Action": ["s3:DeleteBucket", "s3:DeleteObjectVersion"], "Resource": [tfstate_arn, f"{tfstate_arn}/*", rec_arn, f"{rec_arn}/*"]},
        ],
    }

    import runtime_provisioner_iam as rt_iam  # local import avoids circular dependency

    return {
        "day0_bootstrap_boundary": day0_boundary,
        "day0_initial_seal": day0_seal,
        "day0_initial_seal_boundary": day0_seal_boundary,
        "foundation_iam_bootstrap": foundation_iam_bootstrap,
        "role_workload_permissions_boundary": workload_boundary,
        "boundary_runtime_provisioner": rt_iam.build_runtime_provisioner_permissions_boundary(ACCOUNT, REGION),
        "trust_runtime_provisioner": rt_iam.build_runtime_provisioner_trust_policy(ACCOUNT),
        "role_runtime_provisioner": rt_iam.build_runtime_provisioner_policy(ACCOUNT, REGION),
        "trust_github_foundation_plan": trust_plan,
        "role_github_foundation_plan": role_plan,
        "role_github_foundation": role_foundation,
        "role_foundation_admin": role_foundation_admin,
    }


ALLOWED_SGR_RULE_ACTIONS = frozenset({
    "ec2:AuthorizeSecurityGroupIngress",
    "ec2:AuthorizeSecurityGroupEgress",
})
ALLOWED_TAG_CREATE_ACTIONS = frozenset({
    "CreateVpc", "CreateSubnet", "CreateInternetGateway", "CreateRouteTable",
    "CreateSecurityGroup", "AuthorizeSecurityGroupIngress", "AuthorizeSecurityGroupEgress",
    "CreateVolume", "RunInstances", "AllocateAddress",
})
ALLOWED_EC2_TAGGABLE_RESOURCE_TYPES = (
    "vpc", "subnet", "internet-gateway", "route-table",
    "security-group", "instance", "volume", "network-interface", "elastic-ip",
)
ALLOWED_CREATETAGS_RESOURCE_TYPES = ALLOWED_EC2_TAGGABLE_RESOURCE_TYPES + ("security-group-rule",)
_SG_RULE_WILD_ACTIONS = ("ec2:AuthorizeSecurityGroup", "ec2:RevokeSecurityGroup", "ec2:UpdateSecurityGroupRuleDescriptions")


def allowed_createtags_resource_arns(account_id: str = ACCOUNT, region: str = REGION) -> frozenset[str]:
    """Return the exact pinned EC2 resource ARN patterns permitted in standalone ec2:CreateTags statements."""
    return frozenset(f"arn:aws:ec2:{region}:{account_id}:{rt}/*" for rt in ALLOWED_CREATETAGS_RESOURCE_TYPES)


def allowed_lifecycle_tag_resource_arns(account_id: str = ACCOUNT, region: str = REGION) -> frozenset[str]:
    """Return the exact pinned EC2/EKS resource ARN patterns permitted in lifecycle tag statements (no security-group-rule)."""
    ec2_arns = {f"arn:aws:ec2:{region}:{account_id}:{rt}/*" for rt in ALLOWED_EC2_TAGGABLE_RESOURCE_TYPES}
    eks_arns = {
        f"arn:aws:eks:{region}:{account_id}:cluster/envscale-*",
        f"arn:aws:eks:{region}:{account_id}:nodegroup/envscale-*/*/*",
    }
    return frozenset(ec2_arns | eks_arns)


def _parse_nonempty_str_or_list(val: Any) -> list[str] | None:
    if isinstance(val, str):
        s = val.strip()
        return [s] if s else None
    if isinstance(val, list) and val:
        out: list[str] = []
        for item in val:
            if not isinstance(item, str) or not item.strip():
                return None
            out.append(item.strip())
        return out
    return None


def validate_condition_structure(addr: str, cond: Any) -> list[str]:
    """Validate IAM Condition block structure and operator/value types without raising AttributeError."""
    if not isinstance(cond, dict) or not cond:
        return [f"Policy '{addr}' has malformed or empty Condition block: {cond!r}."]
    errors: list[str] = []
    for op_name, op_val in cond.items():
        if not isinstance(op_name, str) or not op_name.strip():
            errors.append(f"Policy '{addr}' Condition contains invalid operator key: {op_name!r}.")
            continue
        if not isinstance(op_val, dict) or not op_val:
            errors.append(f"Policy '{addr}' Condition operator '{op_name}' must map to a non-empty dict; got {op_val!r}.")
            continue
        for ckey, cval in op_val.items():
            if not isinstance(ckey, str) or not ckey.strip():
                errors.append(f"Policy '{addr}' Condition operator '{op_name}' contains invalid condition key: {ckey!r}.")
                continue
            if isinstance(cval, (bool, int)):
                continue
            if _parse_nonempty_str_or_list(cval) is None:
                errors.append(
                    f"Policy '{addr}' Condition '{op_name}.{ckey}' has malformed value: {cval!r}."
                )
    return errors


def validate_policy_document_structure(addr: str, pol_doc: Any) -> tuple[list[dict[str, Any]], list[str]]:
    """Fail-closed structural validation of an IAM policy document and its Statement list."""
    if not isinstance(pol_doc, dict):
        return [], [f"Policy '{addr}' root must be a JSON object (dict); got {type(pol_doc).__name__}."]
    raw_stmts = pol_doc.get("Statement")
    if not isinstance(raw_stmts, list) or not raw_stmts:
        return [], [f"Policy '{addr}' must contain a non-empty 'Statement' list; got {raw_stmts!r}."]
    valid_stmts: list[dict[str, Any]] = []
    errors: list[str] = []
    for idx, st in enumerate(raw_stmts):
        if not isinstance(st, dict):
            errors.append(f"Policy '{addr}' Statement[{idx}] must be a dict; got {type(st).__name__}.")
            continue
        eff = st.get("Effect")
        if eff not in ("Allow", "Deny"):
            errors.append(f"Policy '{addr}' Statement[{idx}] has invalid Effect: {eff!r}.")
            continue
        if "Condition" in st:
            errors.extend(validate_condition_structure(addr, st.get("Condition")))
        valid_stmts.append(st)
    return valid_stmts, errors


def validate_workload_allow_statement_safety(
    addr: str, st: Any, account_id: str = ACCOUNT, region: str = REGION
) -> list[str]:
    """Fail-closed validation for every workload Allow statement (structure, CreateTags ARN allowlist, and SGR scoping)."""
    if not isinstance(st, dict):
        return [f"Workload policy '{addr}' Allow statement must be a dict; got {type(st).__name__}."]
    if "NotAction" in st or "NotResource" in st:
        return [f"Workload policy '{addr}' uses disallowed NotAction/NotResource in Allow statement."]
    acts = _parse_nonempty_str_or_list(st.get("Action"))
    if acts is None:
        return [f"Workload policy '{addr}' has malformed or empty Action in Allow statement: {st.get('Action')!r}."]
    res_list = _parse_nonempty_str_or_list(st.get("Resource"))
    if res_list is None:
        return [f"Workload policy '{addr}' has malformed or empty Resource in Allow statement: {st.get('Resource')!r}."]

    errors: list[str] = []
    cond = st.get("Condition")
    if "Condition" in st:
        errors.extend(validate_condition_structure(addr, cond))
        if errors:
            return errors
    se = cond.get("StringEquals") if isinstance(cond, dict) and isinstance(cond.get("StringEquals"), dict) else None

    if any(a.startswith(_SG_RULE_WILD_ACTIONS) for a in acts) and any(r == "*" or r.endswith(":*") for r in res_list):
        errors.append(f"Workload policy '{addr}' grants SG rule action(s) {acts} against overly broad Resource {res_list}.")

    targets_sgr = any(":security-group-rule" in r for r in res_list)
    has_createtags_wild = any("*" in a and (a.startswith("ec2:Create") or "Tag" in a or a in ("*", "ec2:*")) for a in acts)
    has_createtags = "ec2:CreateTags" in acts or has_createtags_wild
    if not targets_sgr and not has_createtags:
        return errors

    if (targets_sgr and any("*" in a for a in acts)) or has_createtags_wild:
        errors.append(f"Workload policy '{addr}' must not use wildcard actions on tagging or security-group-rule statements: {acts}")

    expected_sgr_arn = f"arn:aws:ec2:{region}:{account_id}:security-group-rule/*"
    allowed_create_arns = allowed_createtags_resource_arns(account_id, region)
    allowed_lifecycle_arns = allowed_lifecycle_tag_resource_arns(account_id, region)

    if acts == ["ec2:CreateTags"]:
        if not isinstance(se, dict) or se.get("aws:RequestTag/Project") != "EnvScale" or se.get("aws:RequestTag/Layer") != "DisposableRuntime":
            errors.append(f"Workload policy '{addr}' ec2:CreateTags statement lacks RequestTag Project/Layer scoping.")
        invalid_arns = [r for r in res_list if r not in allowed_create_arns]
        if invalid_arns:
            errors.append(
                f"Workload policy '{addr}' ec2:CreateTags contains resource ARN(s) outside pinned allowlist: {invalid_arns}"
            )
        ca = _parse_nonempty_str_or_list(se.get("ec2:CreateAction") if isinstance(se, dict) else None)
        if ca is None or not set(ca).issubset(ALLOWED_TAG_CREATE_ACTIONS):
            errors.append(
                f"Workload policy '{addr}' ec2:CreateTags requires bounded ec2:CreateAction list; got {se.get('ec2:CreateAction') if isinstance(se, dict) else None!r}."
            )
        return errors

    if has_createtags:
        if targets_sgr:
            errors.append(f"Workload policy '{addr}' must not mix ec2:CreateTags with other actions on security-group-rule/*: {acts}")
        if not isinstance(se, dict) or se.get("aws:ResourceTag/Project") != "EnvScale" or se.get("aws:ResourceTag/Layer") != "DisposableRuntime":
            errors.append(f"Workload policy '{addr}' multi-action ec2:CreateTags statement lacks ResourceTag Project/Layer scoping.")
        invalid_lc_arns = [r for r in res_list if r not in allowed_lifecycle_arns]
        if invalid_lc_arns:
            errors.append(
                f"Workload policy '{addr}' lifecycle ec2:CreateTags contains resource ARN(s) outside pinned allowlist: {invalid_lc_arns}"
            )
        return errors

    # targets_sgr without ec2:CreateTags -> strictly security-group-rule authorization (SgRules / SgRl)
    if not isinstance(se, dict) or se.get("aws:RequestTag/Project") != "EnvScale" or se.get("aws:RequestTag/Layer") != "DisposableRuntime":
        errors.append(f"Workload policy '{addr}' grants security-group-rule/* Allow without RequestTag Project/Layer scoping.")
    if not set(acts).issubset(ALLOWED_SGR_RULE_ACTIONS):
        errors.append(f"Workload policy '{addr}' grants disallowed action(s) on security-group-rule/*: {acts}")
    if any(r != expected_sgr_arn for r in res_list):
        errors.append(f"Workload policy '{addr}' mixes or broadens Resource(s) on security-group-rule/* rule statement: {res_list}")
    return errors


def build_combined_sg_rule_scenarios(region: str = REGION) -> list[tuple[str, dict[str, Any], str, str, str]]:
    """Return the 5-scenario combined parent-SG + security-group-rule authorization matrix."""
    reg = {"aws:RequestedRegion": region}
    env_res = {"aws:ResourceTag/Project": "EnvScale", "aws:ResourceTag/Layer": "DisposableRuntime"}
    env_req = {"aws:RequestTag/Project": "EnvScale", "aws:RequestTag/Layer": "DisposableRuntime"}
    other_res = {"aws:ResourceTag/Project": "Relmonition", "aws:ResourceTag/Layer": "Production"}
    other_req = {"aws:RequestTag/Project": "Relmonition", "aws:RequestTag/Layer": "Production"}
    return [
        ("EnvScale SG + EnvScale rule tags", {**env_res, **env_req, **reg}, "allowed", "allowed", "allowed"),
        ("Untagged SG + EnvScale rule tags", {**env_req, **reg}, "implicitDeny", "allowed", "implicitDeny"),
        ("Foreign SG + EnvScale rule tags", {**other_res, **env_req, **reg}, "implicitDeny", "allowed", "implicitDeny"),
        ("EnvScale SG + missing rule tags", {**env_res, **reg}, "allowed", "implicitDeny", "implicitDeny"),
        ("EnvScale SG + foreign rule tags", {**env_res, **other_req, **reg}, "allowed", "implicitDeny", "implicitDeny"),
    ]


def eval_combined_sg_rule_operation(
    sim_mod: Any,
    policy_doc: dict[str, Any],
    boundary_doc: dict[str, Any] | None,
    action: str,
    sg_arn: str,
    sgr_arn: str,
    ctx: dict[str, Any],
    *,
    live_aws: bool = False,
) -> dict[str, str]:
    """Compose two per-resource IAM decisions (parent security-group ARN and security-group-rule ARN) under a shared context.

    Models EC2's dual-resource authorization requirement (both resource checks must evaluate to 'allowed');
    note that AWS IAM's simulator evaluates each resource ARN separately rather than as one atomic EC2 API call.
    """
    sg_dec = sim_mod.eval_iam_policy_local_harness(policy_doc, action, sg_arn, ctx, None, boundary_doc)
    sgr_dec = sim_mod.eval_iam_policy_local_harness(policy_doc, action, sgr_arn, ctx, None, boundary_doc)
    if live_aws:
        aws_sg = sim_mod.simulate_via_aws_iam(policy_doc, action, sg_arn, ctx, None, boundary_doc)
        if aws_sg != sg_dec:
            sim_mod._fail(f"Combined check {action} on {sg_arn}: AWS={aws_sg} != LocalHarness={sg_dec}")
        aws_sgr = sim_mod.simulate_via_aws_iam(policy_doc, action, sgr_arn, ctx, None, boundary_doc)
        if aws_sgr != sgr_dec:
            sim_mod._fail(f"Combined check {action} on {sgr_arn}: AWS={aws_sgr} != LocalHarness={sgr_dec}")
    if sg_dec == "allowed" and sgr_dec == "allowed":
        combined = "allowed"
    elif "explicitDeny" in (sg_dec, sgr_dec):
        combined = "explicitDeny"
    else:
        combined = "implicitDeny"
    return {"sg": sg_dec, "sgr": sgr_dec, "combined": combined}

