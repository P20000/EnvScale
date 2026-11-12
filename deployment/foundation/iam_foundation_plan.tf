# ==============================================================================
# EnvScale Persistent Foundation — Read-Only GitHub OIDC Foundation Plan Role
# ==============================================================================
# Principal 7: `envscale-github-foundation-plan-role` (`foundation-plan` env)
# Enables strict separation of duties between Terraform plan generation and
# protected environment apply:
#   - Plan job generates & validates the saved plan using strictly READ-ONLY OIDC
#     credentials (`-lock=false`), incapable of modifying IAM, S3, SSM, or EC2.
#   - Protected `foundation` environment reviewer approval gates `github_foundation`
#     apply execution on the exact attested saved plan artifact.
# ==============================================================================

resource "aws_iam_role" "github_foundation_plan" {
  name                 = "envscale-github-foundation-plan-role"
  max_session_duration = 3600

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AllowGitHubFoundationPlanEnvironmentOIDC"
      Effect    = "Allow"
      Principal = { Federated = local.github_oidc_provider_arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          "token.actions.githubusercontent.com:sub" = "repo:${var.github_repository}:environment:${var.foundation_plan_environment_name}"
        }
      }
    }]
  })

  tags = {
    Name    = "envscale-github-foundation-plan-role"
    Purpose = "ReadOnlyGitHubOIDCFoundationPlanning"
  }
}

resource "aws_iam_role_policy" "github_foundation_plan" {
  name = "envscale-github-foundation-plan-policy"
  role = aws_iam_role.github_foundation_plan.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "AllowFoundationTfstateListReadOnly"
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
        Sid      = "AllowFoundationTfstateReadOnly"
        Effect   = "Allow"
        Action   = ["s3:GetBucketLocation"]
        Resource = local.tfstate_bucket_arn
      },
      {
        Sid      = "AllowFoundationTfstateObjectReadOnly"
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = "${local.tfstate_bucket_arn}/foundation/terraform.tfstate"
      },
      {
        Sid    = "AllowRecoveryBucketConfigReadOnly"
        Effect = "Allow"
        Action = [
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
        ]
        Resource = local.recovery_bucket_arn
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
        Sid      = "AllowNonSecretSSMParametersReadOnly"
        Effect   = "Allow"
        Action   = ["ssm:GetParameter", "ssm:GetParameters", "ssm:ListTagsForResource"]
        Resource = local.ssm_non_secret_param_arns
      },
      {
        Sid      = "AllowSSMAndEipDescribeReadOnly"
        Effect   = "Allow"
        Action   = ["ssm:DescribeParameters", "ec2:DescribeAddresses", "ec2:DescribeAddressesAttribute"]
        Resource = "*"
        Condition = {
          StringEquals = { "aws:RequestedRegion" = var.aws_region }
        }
      },
      {
        Sid    = "DenyAllMutationsDeletesSecretsAndKms"
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
          "iam:Tag*",
          "iam:Untag*",
          "s3:Put*",
          "s3:Delete*",
          "ssm:Put*",
          "ssm:Delete*",
          "ssm:Label*",
          "kms:Encrypt",
          "kms:Decrypt",
          "ec2:AllocateAddress",
          "ec2:ReleaseAddress",
          "ec2:RunInstances",
          "ec2:TerminateInstances",
        ]
        Resource = "*"
      },
      {
        Sid      = "DenySecureStringSecretsRead"
        Effect   = "Deny"
        Action   = ["ssm:Get*"]
        Resource = local.ssm_securestring_param_arns
      },
      {
        Sid      = "DenyRecoveryDataAndLegacyVault"
        Effect   = "Deny"
        Action   = ["s3:*"]
        Resource = ["${local.recovery_bucket_arn}/*", local.legacy_vault_bucket_arn, "${local.legacy_vault_bucket_arn}/*"]
      },
      {
        Sid    = "DenyNonFoundationStateReads"
        Effect = "Deny"
        Action = ["s3:GetObject"]
        Resource = [
          "${local.tfstate_bucket_arn}/runtime/*",
          "${local.tfstate_bucket_arn}/eks/*",
        ]
      },
    ]
  })
}
