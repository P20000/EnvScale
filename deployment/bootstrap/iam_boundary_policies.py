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

ACCOUNT = "982534376726"
REGION = "ap-south-1"
OIDC_ARN = f"arn:aws:iam::{ACCOUNT}:oidc-provider/token.actions.githubusercontent.com"
BOUNDARY_POLICY_ARN = f"arn:aws:iam::{ACCOUNT}:policy/envscale-workload-permissions-boundary"
SSM_CORE_POLICY_ARN = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
EC2_RUNTIME_ROLE_ARN = f"arn:aws:iam::{ACCOUNT}:role/envscale-ec2-runtime-role"
EC2_RUNTIME_PROFILE_ARN = f"arn:aws:iam::{ACCOUNT}:instance-profile/envscale-ec2-runtime-profile"

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
    EC2_RUNTIME_PROFILE_ARN,
    OIDC_ARN,
    BOUNDARY_POLICY_ARN,
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

    trust_plan = {"Version": "2012-10-17", "Statement": [{"Sid": "AllowGitHubFoundationPlanEnvironmentOIDC", "Effect": "Allow", "Principal": {"Federated": OIDC_ARN}, "Action": "sts:AssumeRoleWithWebIdentity", "Condition": {"StringEquals": {"token.actions.githubusercontent.com:aud": "sts.amazonaws.com", "token.actions.githubusercontent.com:sub": "repo:P20000/EnvScale:environment:foundation-plan"}}}]}

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
            {"Sid": "AllowEnumeratedWorkloadRoleNonBoundaryUpdates", "Effect": "Allow", "Action": ["iam:UpdateRole", "iam:UpdateRoleDescription", "iam:DeleteRole", "iam:UpdateAssumeRolePolicy", "iam:PutRolePolicy", "iam:DeleteRolePolicy", "iam:TagRole", "iam:UntagRole"], "Resource": WORKLOAD_MANAGED_ROLE_ARNS},
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
            {"Sid": "AllowWorkloadBoundaryPolicyAdministration", "Effect": "Allow", "Action": ["iam:GetPolicy", "iam:GetPolicyVersion", "iam:ListPolicyVersions", "iam:ListPolicyTags", "iam:ListEntitiesForPolicy", "iam:CreatePolicy", "iam:CreatePolicyVersion", "iam:DeletePolicy", "iam:DeletePolicyVersion", "iam:SetDefaultPolicyVersion", "iam:TagPolicy", "iam:UntagPolicy"], "Resource": BOUNDARY_POLICY_ARN},
            {"Sid": "AllowOutOfBandSSMParameterSeeding", "Effect": "Allow", "Action": ["ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath", "ssm:PutParameter", "ssm:AddTagsToResource", "ssm:ListTagsForResource"], "Resource": ssm_prod},
            {"Sid": "AllowSSMDescribeAndFoundationEipDescribe", "Effect": "Allow", "Action": ["ssm:DescribeParameters", "ec2:DescribeAddresses", "ec2:DescribeAddressesAttribute"], "Resource": "*", "Condition": {"StringEquals": {"aws:RequestedRegion": REGION}}},
            {"Sid": "AllowSSMKmsViaServiceOnly", "Effect": "Allow", "Action": ["kms:Encrypt", "kms:Decrypt"], "Resource": f"arn:aws:kms:{REGION}:{ACCOUNT}:key/*", "Condition": {"StringEquals": {"kms:ViaService": f"ssm.{REGION}.amazonaws.com"}}},
            {"Sid": "AllowSSMKmsKeyDescribe", "Effect": "Allow", "Action": ["kms:DescribeKey"], "Resource": f"arn:aws:kms:{REGION}:{ACCOUNT}:key/*"},
            {"Sid": "AllowOptionalStaticFoundationEipProvisioning", "Effect": "Allow", "Action": ["ec2:AllocateAddress", "ec2:CreateTags"], "Resource": f"arn:aws:ec2:{REGION}:{ACCOUNT}:elastic-ip/*", "Condition": {"StringEquals": {"aws:RequestTag/Project": "EnvScale"}}},
            {"Sid": "DenyLegacyVaultMutations", "Effect": "Deny", "Action": ["s3:PutObject", "s3:DeleteObject", "s3:DeleteObjectVersion", "s3:DeleteBucket", "s3:PutBucketPolicy", "s3:DeleteBucketPolicy"], "Resource": [leg_arn, f"{leg_arn}/*"]},
            {"Sid": "DenyStateAndRecoveryBucketOrVersionDeletion", "Effect": "Deny", "Action": ["s3:DeleteBucket", "s3:DeleteObjectVersion"], "Resource": [tfstate_arn, f"{tfstate_arn}/*", rec_arn, f"{rec_arn}/*"]},
        ],
    }

    return {
        "day0_bootstrap_boundary": day0_boundary,
        "day0_initial_seal": day0_seal,
        "day0_initial_seal_boundary": day0_seal_boundary,
        "foundation_iam_bootstrap": foundation_iam_bootstrap,
        "role_workload_permissions_boundary": workload_boundary,
        "trust_github_foundation_plan": trust_plan,
        "role_github_foundation_plan": role_plan,
        "role_github_foundation": role_foundation,
        "role_foundation_admin": role_foundation_admin,
    }

