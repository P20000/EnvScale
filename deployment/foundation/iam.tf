# ==============================================================================
# EnvScale Persistent Foundation — Principals 1–2 (EC2 Runtime & Release Role)
# ==============================================================================
# Shared IAM locals reside in `iam_locals.tf`.
#   - Principal 1 : `envscale-ec2-runtime-role` (EC2 Instance Profile, zero SSH)
#   - Principal 2 : `envscale-github-release-role` (`develop` branch OIDC)
# ==============================================================================

# ------------------------------------------------------------------------------
# Principal 1: envscale-ec2-runtime-role (EC2 Instance Profile — Zero SSH)
# ------------------------------------------------------------------------------
resource "aws_iam_role" "ec2_runtime" {
  name = "envscale-ec2-runtime-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AllowEC2ServiceAssumeRoleInAccount"
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
      Condition = {
        StringEquals = { "aws:SourceAccount" = var.aws_account_id }
      }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ec2_runtime_ssm_core" {
  role       = aws_iam_role.ec2_runtime.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "ec2_runtime" {
  name = "envscale-ec2-runtime-profile"
  role = aws_iam_role.ec2_runtime.name
}

resource "aws_iam_role_policy" "ec2_runtime" {
  name = "envscale-ec2-runtime-policy"
  role = aws_iam_role.ec2_runtime.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "AllowSSMProdParameterRead"
        Effect   = "Allow"
        Action   = ["ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath"]
        Resource = local.ssm_prod_param_arn
      },
      {
        Sid      = "AllowSSMKmsDecryptViaSSMOnly"
        Effect   = "Allow"
        Action   = ["kms:Decrypt"]
        Resource = "arn:aws:kms:${var.aws_region}:${var.aws_account_id}:key/*"
        Condition = {
          StringEquals = { "kms:ViaService" = "ssm.${var.aws_region}.amazonaws.com" }
        }
      },
      {
        Sid    = "AllowRecoveryReleasesAndHistoricalReadOnly"
        Effect = "Allow"
        Action = ["s3:GetObject", "s3:GetObjectVersion"]
        Resource = [
          "${local.recovery_bucket_arn}/releases/*",
          "${local.recovery_bucket_arn}/backups/historical/*",
        ]
      },
      {
        Sid    = "AllowRecoveryPostgresBackupsAndAlertsRW"
        Effect = "Allow"
        Action = ["s3:GetObject", "s3:GetObjectVersion", "s3:PutObject"]
        Resource = [
          "${local.recovery_bucket_arn}/backups/postgres/*",
          "${local.recovery_bucket_arn}/lifecycle/alerts/*",
        ]
      },
      {
        Sid      = "AllowRecoveryBucketLocation"
        Effect   = "Allow"
        Action   = ["s3:GetBucketLocation"]
        Resource = local.recovery_bucket_arn
      },
      {
        Sid      = "AllowRecoveryBucketListScoped"
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = local.recovery_bucket_arn
        Condition = {
          StringLike = {
            "s3:prefix" = [
              "backups/postgres/*",
              "backups/historical/*",
              "lifecycle/alerts/*",
              "releases/*",
            ]
          }
        }
      },
      {
        Sid      = "DenyAllSSMMutations"
        Effect   = "Deny"
        Action   = ["ssm:PutParameter", "ssm:DeleteParameter", "ssm:DeleteParameters", "ssm:LabelParameterVersion"]
        Resource = local.ssm_all_param_arn
      },
      {
        Sid    = "DenyReleaseAndHistoricalWrites"
        Effect = "Deny"
        Action = ["s3:PutObject"]
        Resource = [
          "${local.recovery_bucket_arn}/releases/*",
          "${local.recovery_bucket_arn}/backups/historical/*",
        ]
      },
      {
        Sid      = "DenyAllRecoveryDeletions"
        Effect   = "Deny"
        Action   = ["s3:DeleteObject", "s3:DeleteObjectVersion", "s3:DeleteBucket", "s3:DeleteBucketPolicy", "s3:PutBucketPolicy"]
        Resource = [local.recovery_bucket_arn, "${local.recovery_bucket_arn}/*"]
      },
      {
        Sid    = "DenyTfstateAndLegacyVaultAccess"
        Effect = "Deny"
        Action = ["s3:*"]
        Resource = [
          local.tfstate_bucket_arn,
          "${local.tfstate_bucket_arn}/*",
          local.legacy_vault_bucket_arn,
          "${local.legacy_vault_bucket_arn}/*",
        ]
      },
    ]
  })
}

# ------------------------------------------------------------------------------
# Principal 2: envscale-github-release-role (Branch-Scoped Manifest Publisher)
# ------------------------------------------------------------------------------
resource "aws_iam_role" "github_release" {
  name                 = "envscale-github-release-role"
  max_session_duration = 3600

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AllowGitHubDevelopBranchOIDC"
      Effect    = "Allow"
      Principal = { Federated = local.github_oidc_provider_arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          "token.actions.githubusercontent.com:sub" = "repo:${var.github_repository}:ref:refs/heads/${var.release_branch}"
        }
      }
    }]
  })
}

resource "aws_iam_role_policy" "github_release" {
  name = "envscale-github-release-policy"
  role = aws_iam_role.github_release.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "AllowImmutableReleaseArtifactUploadAndVerify"
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:GetObject", "s3:GetObjectVersion"]
        Resource = "${local.recovery_bucket_arn}/releases/*"
      },
      {
        Sid      = "AllowRecoveryBucketLocation"
        Effect   = "Allow"
        Action   = ["s3:GetBucketLocation"]
        Resource = local.recovery_bucket_arn
      },
      {
        Sid    = "DenyKnownGoodPointerWrites"
        Effect = "Deny"
        Action = ["s3:PutObject", "s3:DeleteObject", "s3:DeleteObjectVersion"]
        Resource = [
          "${local.recovery_bucket_arn}/releases/latest-known-good.json",
          "${local.recovery_bucket_arn}/releases/previous-known-good.json",
        ]
      },
      {
        Sid      = "DenyAllS3Deletions"
        Effect   = "Deny"
        Action   = ["s3:DeleteObject", "s3:DeleteObjectVersion", "s3:DeleteBucket", "s3:DeleteBucketPolicy", "s3:PutBucketPolicy"]
        Resource = [local.recovery_bucket_arn, "${local.recovery_bucket_arn}/*"]
      },
      {
        Sid    = "DenyNonReleasePrefixesTfstateAndLegacyVault"
        Effect = "Deny"
        Action = ["s3:*"]
        Resource = [
          "${local.recovery_bucket_arn}/backups/*",
          "${local.recovery_bucket_arn}/lifecycle/*",
          local.tfstate_bucket_arn,
          "${local.tfstate_bucket_arn}/*",
          local.legacy_vault_bucket_arn,
          "${local.legacy_vault_bucket_arn}/*",
        ]
      },
    ]
  })
}
