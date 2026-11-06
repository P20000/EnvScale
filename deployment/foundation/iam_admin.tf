# ==============================================================================
# EnvScale Persistent Foundation — Dedicated MFA-Enforced Foundation Admin Role
# ==============================================================================
# Principal 5: `envscale-foundation-admin-role`
# Security Guarantees:
#   1. NEVER assumable via GitHub Actions OIDC or EC2 instance profiles; trusts
#      ONLY validated account 982534376726 IAM principals (`var.foundation_admin_trusted_principal_arns`).
#   2. Enforces hardware/virtual MFA at BOTH layers:
#      - Trust Policy: `Bool aws:MultiFactorAuthPresent = "true"` AND
#        `NumericLessThan aws:MultiFactorAuthAge = "3600"` (<= 1 hour).
#      - Permission Policy: Explicit `Deny` (`BoolIfExists aws:MultiFactorAuthPresent = "false"`)
#        plus `max_session_duration = 3600`.
#   3. Required by `bootstrap-state.sh --apply`, `seed-parameters.sh --apply`,
#      and `migrate-legacy-vault.sh --upload` (`arn:aws:sts::982534376726:assumed-role/envscale-foundation-admin-role/*`).
# ==============================================================================

resource "aws_iam_role" "foundation_admin" {
  count                = var.create_foundation_admin_role ? 1 : 0
  name                 = "envscale-foundation-admin-role"
  max_session_duration = 3600

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AllowSameAccountHumanOperatorsWithRecentMFAOnly"
      Effect    = "Allow"
      Principal = { AWS = var.foundation_admin_trusted_principal_arns }
      Action    = "sts:AssumeRole"
      Condition = {
        Bool = {
          "aws:MultiFactorAuthPresent" = "true"
        }
        NumericLessThan = {
          "aws:MultiFactorAuthAge" = "3600"
        }
      }
    }]
  })

  tags = {
    Name    = "envscale-foundation-admin-role"
    Purpose = "MFAEnforcedHumanFoundationAdministration"
  }
}

resource "aws_iam_role_policy" "foundation_admin" {
  count = var.create_foundation_admin_role ? 1 : 0
  name  = "envscale-foundation-admin-policy"
  role  = aws_iam_role.foundation_admin[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowFoundationBucketsAndStateAdministration"
        Effect = "Allow"
        Action = [
          "s3:CreateBucket",
          "s3:ListBucket",
          "s3:ListBucketVersions",
          "s3:GetBucket*",
          "s3:PutBucketPublicAccessBlock",
          "s3:GetBucketPublicAccessBlock",
          "s3:PutBucketOwnershipControls",
          "s3:PutBucketVersioning",
          "s3:PutEncryptionConfiguration",
          "s3:GetEncryptionConfiguration",
          "s3:PutLifecycleConfiguration",
          "s3:GetLifecycleConfiguration",
          "s3:PutBucketTagging",
          "s3:PutBucketPolicy",
          "s3:GetObject",
          "s3:GetObjectVersion",
          "s3:PutObject",
        ]
        Resource = [
          local.tfstate_bucket_arn,
          "${local.tfstate_bucket_arn}/*",
          local.recovery_bucket_arn,
          "${local.recovery_bucket_arn}/*",
        ]
      },
      {
        Sid      = "AllowFoundationNativeStateLockRelease"
        Effect   = "Allow"
        Action   = ["s3:DeleteObject"]
        Resource = "${local.tfstate_bucket_arn}/foundation/terraform.tfstate.tflock"
      },
      {
        Sid    = "AllowLegacyVaultReadOnlyForHistoricalMigration"
        Effect = "Allow"
        Action = [
          "s3:ListBucket",
          "s3:ListBucketVersions",
          "s3:GetBucketLocation",
          "s3:GetObject",
          "s3:GetObjectVersion",
        ]
        Resource = [
          local.legacy_vault_bucket_arn,
          "${local.legacy_vault_bucket_arn}/*",
        ]
      },
      {
        Sid    = "AllowFoundationIAMAndOidcAdministration"
        Effect = "Allow"
        Action = [
          "iam:Get*",
          "iam:List*",
          "iam:CreateRole",
          "iam:UpdateRole",
          "iam:UpdateAssumeRolePolicy",
          "iam:TagRole",
          "iam:UntagRole",
          "iam:PutRolePolicy",
          "iam:DeleteRolePolicy",
          "iam:AttachRolePolicy",
          "iam:DetachRolePolicy",
          "iam:CreateInstanceProfile",
          "iam:AddRoleToInstanceProfile",
          "iam:RemoveRoleFromInstanceProfile",
          "iam:TagInstanceProfile",
          "iam:CreateOpenIDConnectProvider",
          "iam:UpdateOpenIDConnectProviderThumbprint",
          "iam:TagOpenIDConnectProvider",
        ]
        Resource = [
          "arn:aws:iam::${var.aws_account_id}:role/envscale-*",
          "arn:aws:iam::${var.aws_account_id}:instance-profile/envscale-*",
          "arn:aws:iam::${var.aws_account_id}:oidc-provider/token.actions.githubusercontent.com",
        ]
      },
      {
        Sid    = "AllowOutOfBandSSMParameterSeeding"
        Effect = "Allow"
        Action = [
          "ssm:GetParameter",
          "ssm:GetParameters",
          "ssm:GetParametersByPath",
          "ssm:PutParameter",
          "ssm:AddTagsToResource",
          "ssm:ListTagsForResource",
        ]
        Resource = local.ssm_prod_param_arn
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
        Sid      = "AllowSSMKmsViaServiceOnly"
        Effect   = "Allow"
        Action   = ["kms:Encrypt", "kms:Decrypt", "kms:DescribeKey"]
        Resource = "arn:aws:kms:${var.aws_region}:${var.aws_account_id}:key/*"
        Condition = {
          StringEquals = { "kms:ViaService" = "ssm.${var.aws_region}.amazonaws.com" }
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
        Sid      = "DenyAllActionsWithoutMFA"
        Effect   = "Deny"
        Action   = "*"
        Resource = "*"
        Condition = {
          BoolIfExists = {
            "aws:MultiFactorAuthPresent" = "false"
          }
        }
      },
      {
        Sid    = "DenyLegacyVaultMutations"
        Effect = "Deny"
        Action = [
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:DeleteObjectVersion",
          "s3:DeleteBucket",
          "s3:PutBucketPolicy",
          "s3:DeleteBucketPolicy",
        ]
        Resource = [
          local.legacy_vault_bucket_arn,
          "${local.legacy_vault_bucket_arn}/*",
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
    ]
  })
}

