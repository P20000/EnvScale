# ==============================================================================
# EnvScale Persistent Foundation — Automated GitHub OIDC Foundation Apply Role
# ==============================================================================
# Principal 6: `envscale-github-foundation-role` (`foundation` GitHub Environment)
# Hardened Least-Privilege & Anti-Escalation Guarantees:
#   1. Machine-to-machine OIDC federation ONLY (`environment:foundation`), ZERO MFA.
#   2. Enumerated IAM management ONLY for the 4 workload/CI/CD roles, single
#      `envscale-ec2-runtime-profile`, and GitHub OIDC provider (NO `role/envscale-*`).
#   3. Permissions boundary enforcement: `CreateRole` / `PutRolePermissionsBoundary`
#      require `iam:PermissionsBoundary == envscale-workload-permissions-boundary`;
#      `AttachRolePolicy` / `DetachRolePolicy` are scoped strictly to `ec2-runtime` +
#      `AmazonSSMManagedInstanceCore`.
#   4. Self-escalation & break-glass protection: explicitly DENIED all IAM mutations
#      on `github_foundation`, `github_foundation_plan`, and `foundation_admin`,
#      plus DENIED boundary removal or policy-version tampering.
# ==============================================================================

resource "aws_iam_role" "github_foundation" {
  name                 = "envscale-github-foundation-role"
  max_session_duration = 3600

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AllowGitHubFoundationEnvironmentOIDC"
      Effect    = "Allow"
      Principal = { Federated = local.github_oidc_provider_arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          "token.actions.githubusercontent.com:sub" = "repo:${var.github_repository}:environment:${var.foundation_environment_name}"
        }
      }
    }]
  })

  tags = {
    Name    = "envscale-github-foundation-role"
    Purpose = "AutomatedGitHubOIDCFoundationApply"
  }
}

resource "aws_iam_role_policy" "github_foundation" {
  name = "envscale-github-foundation-policy"
  role = aws_iam_role.github_foundation.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "AllowFoundationTfstateListScoped"
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = local.tfstate_bucket_arn
        Condition = {
          StringLike = {
            "s3:prefix" = ["foundation/*"]
          }
        }
      },
      {
        Sid      = "AllowFoundationTfstateBucketLocation"
        Effect   = "Allow"
        Action   = ["s3:GetBucketLocation"]
        Resource = local.tfstate_bucket_arn
      },
      {
        Sid    = "AllowFoundationStateReadWrite"
        Effect = "Allow"
        Action = ["s3:GetObject", "s3:PutObject"]
        Resource = [
          "${local.tfstate_bucket_arn}/foundation/terraform.tfstate",
        ]
      },
      {
        Sid    = "AllowFoundationNativeLockFile"
        Effect = "Allow"
        Action = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = [
          "${local.tfstate_bucket_arn}/foundation/terraform.tfstate.tflock",
        ]
      },
      {
        Sid    = "AllowRecoveryBucketFoundationAdministration"
        Effect = "Allow"
        Action = [
          "s3:CreateBucket",
          "s3:ListBucket",
          "s3:GetBucket*",
          "s3:GetEncryptionConfiguration",
          "s3:GetLifecycleConfiguration",
          "s3:GetAccelerateConfiguration",
          "s3:GetReplicationConfiguration",
          "s3:GetMetricsConfiguration",
          "s3:GetAnalyticsConfiguration",
          "s3:GetInventoryConfiguration",
          "s3:GetIntelligentTieringConfiguration",
          "s3:PutBucketPublicAccessBlock",
          "s3:PutBucketOwnershipControls",
          "s3:PutBucketVersioning",
          "s3:PutEncryptionConfiguration",
          "s3:PutLifecycleConfiguration",
          "s3:PutBucketTagging",
          "s3:PutBucketPolicy",
        ]
        Resource = [
          local.recovery_bucket_arn,
          "${local.recovery_bucket_arn}/*",
        ]
      },
      {
        Sid    = "AllowEnumeratedFoundationIamReadOnly"
        Effect = "Allow"
        Action = [
          "iam:GetRole",
          "iam:GetRolePolicy",
          "iam:ListRolePolicies",
          "iam:ListAttachedRolePolicies",
          "iam:ListInstanceProfilesForRole",
          "iam:ListRoleTags",
          "iam:GetInstanceProfile",
          "iam:ListInstanceProfileTags",
          "iam:GetOpenIDConnectProvider",
          "iam:ListOpenIDConnectProviderTags",
          "iam:GetPolicy",
          "iam:GetPolicyVersion",
          "iam:ListPolicyVersions",
          "iam:ListPolicyTags",
          "iam:ListEntitiesForPolicy",
        ]
        Resource = local.foundation_enumerated_iam_read_arns
      },
      {
        Sid      = "AllowOidcProviderDiscovery"
        Effect   = "Allow"
        Action   = ["iam:ListOpenIDConnectProviders"]
        Resource = "*"
      },
      {
        Sid    = "AllowBoundedWorkloadRoleCreationAndBoundary"
        Effect = "Allow"
        Action = [
          "iam:CreateRole",
          "iam:PutRolePermissionsBoundary",
        ]
        Resource = local.workload_managed_role_arns
        Condition = {
          StringEquals = {
            "iam:PermissionsBoundary" = local.workload_boundary_policy_arn
          }
        }
      },
      {
        Sid    = "AllowEnumeratedWorkloadRoleNonBoundaryUpdates"
        Effect = "Allow"
        Action = [
          "iam:UpdateRole",
          "iam:UpdateRoleDescription",
          "iam:DeleteRole",
          "iam:UpdateAssumeRolePolicy",
          "iam:PutRolePolicy",
          "iam:DeleteRolePolicy",
          "iam:TagRole",
          "iam:UntagRole",
        ]
        Resource = local.workload_managed_role_arns
      },
      {
        Sid    = "AllowBoundedEc2RuntimeCorePolicyAttachment"
        Effect = "Allow"
        Action = [
          "iam:AttachRolePolicy",
          "iam:DetachRolePolicy",
        ]
        Resource = local.ec2_runtime_role_arn
        Condition = {
          ArnEquals = {
            "iam:PolicyARN" = local.ssm_managed_core_policy_arn
          }
        }
      },
      {
        Sid    = "AllowEnumeratedInstanceProfileAndOidcWrites"
        Effect = "Allow"
        Action = [
          "iam:CreateInstanceProfile",
          "iam:DeleteInstanceProfile",
          "iam:AddRoleToInstanceProfile",
          "iam:RemoveRoleFromInstanceProfile",
          "iam:TagInstanceProfile",
          "iam:UntagInstanceProfile",
          "iam:CreateOpenIDConnectProvider",
          "iam:UpdateOpenIDConnectProviderThumbprint",
          "iam:AddClientIDToOpenIDConnectProvider",
          "iam:RemoveClientIDFromOpenIDConnectProvider",
          "iam:TagOpenIDConnectProvider",
          "iam:UntagOpenIDConnectProvider",
        ]
        Resource = [
          local.ec2_runtime_profile_arn,
          local.github_oidc_provider_arn,
        ]
      },
      {
        Sid    = "AllowNonSecretSSMParametersOnly"
        Effect = "Allow"
        Action = [
          "ssm:GetParameter",
          "ssm:GetParameters",
          "ssm:PutParameter",
          "ssm:DeleteParameter",
          "ssm:AddTagsToResource",
          "ssm:RemoveTagsFromResource",
          "ssm:ListTagsForResource",
        ]
        Resource = local.ssm_non_secret_param_arns
      },
      {
        Sid      = "AllowSSMDescribeAndFoundationEipDescribe"
        Effect   = "Allow"
        Action   = ["ssm:DescribeParameters", "ec2:DescribeAddresses", "ec2:DescribeAddressesAttribute"]
        Resource = "*"
        Condition = {
          StringEquals = { "aws:RequestedRegion" = var.aws_region }
        }
      },
      {
        Sid      = "AllowOptionalStaticFoundationEipProvisioning"
        Effect   = "Allow"
        Action   = ["ec2:AllocateAddress", "ec2:CreateTags"]
        Resource = "arn:aws:ec2:${var.aws_region}:${var.aws_account_id}:elastic-ip/*"
        Condition = {
          StringEquals = { "aws:RequestTag/Project" = "EnvScale" }
        }
      },
      {
        Sid    = "DenySelfAndBreakGlassAdminMutation"
        Effect = "Deny"
        Action = [
          "iam:Create*",
          "iam:Delete*",
          "iam:Update*",
          "iam:Put*",
          "iam:Attach*",
          "iam:Detach*",
          "iam:Add*",
          "iam:Remove*",
          "iam:TagRole",
          "iam:UntagRole",
        ]
        Resource = local.foundation_protected_role_arns
      },
      {
        Sid    = "DenyBoundaryRemovalAndPolicyWeakening"
        Effect = "Deny"
        Action = [
          "iam:DeleteRolePermissionsBoundary",
          "iam:CreatePolicy",
          "iam:CreatePolicyVersion",
          "iam:DeletePolicy",
          "iam:DeletePolicyVersion",
          "iam:SetDefaultPolicyVersion",
          "iam:TagPolicy",
          "iam:UntagPolicy",
        ]
        Resource = "*"
      },
      {
        Sid    = "DenySecureStringSecretsAndKmsAccess"
        Effect = "Deny"
        Action = [
          "ssm:GetParameter",
          "ssm:GetParameters",
          "ssm:GetParametersByPath",
          "ssm:PutParameter",
          "ssm:DeleteParameter",
          "ssm:DeleteParameters",
          "ssm:LabelParameterVersion",
        ]
        Resource = local.ssm_securestring_param_arns
      },
      {
        Sid      = "DenyKmsEncryptDecrypt"
        Effect   = "Deny"
        Action   = ["kms:Encrypt", "kms:Decrypt"]
        Resource = "*"
      },
      {
        Sid    = "DenyRuntimeStateAndRecoveryDataMutation"
        Effect = "Deny"
        Action = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:DeleteObjectVersion"]
        Resource = [
          "${local.tfstate_bucket_arn}/runtime/*",
          "${local.tfstate_bucket_arn}/eks/*",
          "${local.recovery_bucket_arn}/backups/*",
          "${local.recovery_bucket_arn}/releases/*",
          "${local.recovery_bucket_arn}/lifecycle/*",
        ]
      },
      {
        Sid    = "DenyStateAndRecoveryBucketOrVersionDeletion"
        Effect = "Deny"
        Action = [
          "s3:DeleteBucket",
          "s3:DeleteObjectVersion",
        ]
        Resource = [
          local.tfstate_bucket_arn,
          "${local.tfstate_bucket_arn}/*",
          local.recovery_bucket_arn,
          "${local.recovery_bucket_arn}/*",
        ]
      },
      {
        Sid      = "DenyTfstateObjectDeletion"
        Effect   = "Deny"
        Action   = ["s3:DeleteObject"]
        Resource = "${local.tfstate_bucket_arn}/*.tfstate"
      },
      {
        Sid      = "DenyLegacyVaultAccess"
        Effect   = "Deny"
        Action   = ["s3:*"]
        Resource = [local.legacy_vault_bucket_arn, "${local.legacy_vault_bucket_arn}/*"]
      },
      {
        Sid    = "DenyRuntimeComputeProvisioningAndEipRelease"
        Effect = "Deny"
        Action = [
          "ec2:RunInstances",
          "ec2:TerminateInstances",
          "ec2:CreateVpc",
          "ec2:DeleteVpc",
          "ec2:ReleaseAddress",
        ]
        Resource = "*"
      },
    ]
  })
}
