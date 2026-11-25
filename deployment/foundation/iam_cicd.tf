# ==============================================================================
# EnvScale Persistent Foundation — Environment-Scoped CI/CD & DR IAM Roles
# ==============================================================================
# Principals 3 & 4 enforce exact GitHub Environment OIDC `sub` claims
# (`environment:production` vs `environment:recovery`), native S3 `.tflock`
# permissions without `.tfstate` delete access, mandatory EnvScale resource/
# request tag boundaries (`Project = EnvScale`, `Layer = DisposableRuntime`),
# owner-verified AMI/snapshot `RunInstances` scoping, and explicit Denies.
# Both inline role policies stay strictly <= 10,240 non-whitespace chars (AWS
# aggregate inline role policy quota) while preserving exact effective scope.
# ==============================================================================

# ------------------------------------------------------------------------------
# Principal 3: envscale-github-deploy-role (`production` GitHub Environment)
# ------------------------------------------------------------------------------
resource "aws_iam_role" "github_deploy" {
  name                 = "envscale-github-deploy-role"
  max_session_duration = 3600
  permissions_boundary = aws_iam_policy.workload_permissions_boundary.arn

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AllowGitHubProductionEnvironmentOIDC"
      Effect    = "Allow"
      Principal = { Federated = local.github_oidc_provider_arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          "token.actions.githubusercontent.com:sub" = "repo:${var.github_oidc_subject_prefix}:environment:${var.production_environment_name}"
        }
      }
    }]
  })
}

resource "aws_iam_role_policy" "github_deploy" {
  name = "envscale-github-deploy-policy"
  role = aws_iam_role.github_deploy.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat(
      local.shared_cicd_tfstate_statements,
      [
        {
          Sid      = "RcLs"
          Effect   = "Allow"
          Action   = "s3:ListBucket"
          Resource = local.recovery_bucket_arn
          Condition = {
            StringLike = { "s3:prefix" = ["releases/*", "lifecycle/*", "backups/*"] }
          }
        },
        {
          Sid    = "S3Rd"
          Effect = "Allow"
          Action = ["s3:GetBucketLocation", "s3:GetObject", "s3:GetObjectVersion"]
          Resource = [
            local.tfstate_bucket_arn,
            "${local.tfstate_bucket_arn}/foundation/terraform.tfstate",
            local.recovery_bucket_arn,
            "${local.recovery_bucket_arn}/releases/*",
            "${local.recovery_bucket_arn}/lifecycle/*",
            "${local.recovery_bucket_arn}/backups/*",
          ]
        },
        {
          Sid    = "RcWr"
          Effect = "Allow"
          Action = "s3:PutObject"
          Resource = [
            "${local.recovery_bucket_arn}/releases/*",
            "${local.recovery_bucket_arn}/lifecycle/*",
          ]
        },
        {
          Sid    = "Meta"
          Effect = "Allow"
          Action = [
            "ec2:Describe*",
            "ssm:DescribeParameters",
            "ssm:DescribeInstanceInformation",
            "ssm:ListCommandInvocations",
            "ssm:GetCommandInvocation",
          ]
          Resource = "*"
          Condition = {
            StringEquals = { "aws:RequestedRegion" = var.aws_region }
          }
        },
        {
          Sid      = "IamR"
          Effect   = "Allow"
          Action   = ["iam:GetRole", "iam:GetInstanceProfile"]
          Resource = [local.ec2_runtime_role_arn, local.ec2_runtime_profile_arn]
        },
        {
          Sid      = "PsE2"
          Effect   = "Allow"
          Action   = "iam:PassRole"
          Resource = local.ec2_runtime_role_arn
          Condition = {
            StringEquals = { "iam:PassedToService" = "ec2.amazonaws.com" }
          }
        },
        {
          Sid    = "CrRt"
          Effect = "Allow"
          Action = ["ec2:CreateVpc", "ec2:CreateInternetGateway", "ec2:CreateVolume", "ec2:RunInstances"]
          Resource = [
            "arn:aws:ec2:${var.aws_region}:${var.aws_account_id}:vpc/*",
            "arn:aws:ec2:${var.aws_region}:${var.aws_account_id}:internet-gateway/*",
            "arn:aws:ec2:${var.aws_region}:${var.aws_account_id}:volume/*",
            "arn:aws:ec2:${var.aws_region}:${var.aws_account_id}:instance/*",
            "arn:aws:ec2:${var.aws_region}:${var.aws_account_id}:network-interface/*",
          ]
          Condition = {
            StringEquals = {
              "aws:RequestTag/Project" = "EnvScale"
              "aws:RequestTag/Layer"   = "DisposableRuntime"
            }
          }
        },
        {
          Sid      = "Ec2L"
          Effect   = "Allow"
          Action   = local.ec2_nondestructive_runtime_actions
          Resource = local.ec2_runtime_tagged_arns
          Condition = {
            StringEquals = {
              "aws:ResourceTag/Project" = "EnvScale"
              "aws:ResourceTag/Layer"   = "DisposableRuntime"
            }
          }
        },
      ],
      local.shared_ec2_runtime_provisioning_statements,
      local.shared_governance_tag_deny_statements,
      [
        {
          Sid    = "DnSp"
          Effect = "Deny"
          Action = "s3:PutObject"
          Resource = [
            "${local.tfstate_bucket_arn}/foundation/*",
            "${local.recovery_bucket_arn}/backups/*",
          ]
        },
        {
          Sid    = "DnSd"
          Effect = "Deny"
          Action = "s3:DeleteObject"
          Resource = [
            "${local.tfstate_bucket_arn}/foundation/*",
            "${local.tfstate_bucket_arn}/*.tfstate",
            "${local.recovery_bucket_arn}/backups/*",
            "${local.recovery_bucket_arn}/releases/*",
          ]
        },
        {
          Sid      = "DnLg"
          Effect   = "Deny"
          Action   = "s3:*"
          Resource = [local.legacy_vault_bucket_arn, "${local.legacy_vault_bucket_arn}/*"]
        },
        {
          Sid    = "DnGl"
          Effect = "Deny"
          Action = [
            "s3:DeleteBucket",
            "s3:DeleteBucketPolicy",
            "s3:PutBucketPolicy",
            "s3:DeleteObjectVersion",
            "ec2:TerminateInstances",
            "ec2:DeleteVolume",
            "ec2:DeleteVpc",
            "ec2:DeleteSubnet",
            "ec2:DeleteSecurityGroup",
            "ec2:DeleteRouteTable",
            "ec2:DeleteInternetGateway",
            "ec2:ReleaseAddress",
            "ssm:GetParameter*",
            "ssm:PutParameter",
            "ssm:DeleteParameter*",
          ]
          Resource = "*"
        },
      ]
    )
  })
}

# ------------------------------------------------------------------------------
# Principal 4: envscale-github-recovery-role (`recovery` GitHub Environment)
# ------------------------------------------------------------------------------
resource "aws_iam_role" "github_recovery" {
  name                 = "envscale-github-recovery-role"
  max_session_duration = 3600
  permissions_boundary = aws_iam_policy.workload_permissions_boundary.arn

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AllowGitHubRecoveryEnvironmentOIDC"
      Effect    = "Allow"
      Principal = { Federated = local.github_oidc_provider_arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          "token.actions.githubusercontent.com:sub" = "repo:${var.github_oidc_subject_prefix}:environment:${var.recovery_environment_name}"
        }
      }
    }]
  })
}

resource "aws_iam_role_policy" "github_recovery" {
  name = "envscale-github-recovery-policy"
  role = aws_iam_role.github_recovery.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat(
      local.shared_cicd_tfstate_statements,
      [
        {
          Sid      = "RcLs"
          Effect   = "Allow"
          Action   = "s3:ListBucket"
          Resource = local.recovery_bucket_arn
          Condition = {
            StringLike = { "s3:prefix" = ["backups/*", "releases/*", "lifecycle/*"] }
          }
        },
        {
          Sid    = "S3Rd"
          Effect = "Allow"
          Action = ["s3:GetBucketLocation", "s3:GetObject", "s3:GetObjectVersion"]
          Resource = [
            local.tfstate_bucket_arn,
            "${local.tfstate_bucket_arn}/foundation/terraform.tfstate",
            local.recovery_bucket_arn,
            "${local.recovery_bucket_arn}/backups/*",
            "${local.recovery_bucket_arn}/releases/*",
          ]
        },
        {
          Sid    = "RcWr"
          Effect = "Allow"
          Action = "s3:PutObject"
          Resource = [
            "${local.recovery_bucket_arn}/lifecycle/*",
            "${local.recovery_bucket_arn}/releases/latest-known-good.json",
            "${local.recovery_bucket_arn}/releases/previous-known-good.json",
            "${local.recovery_bucket_arn}/backups/postgres/latest-valid.json",
          ]
        },
        {
          Sid    = "Meta"
          Effect = "Allow"
          Action = [
            "ec2:Describe*",
            "eks:DescribeCluster",
            "eks:DescribeNodegroup",
            "eks:ListClusters",
            "eks:ListNodegroups",
            "ssm:DescribeParameters",
            "ssm:DescribeInstanceInformation",
            "ssm:ListCommandInvocations",
            "ssm:GetCommandInvocation",
          ]
          Resource = "*"
          Condition = {
            StringEquals = { "aws:RequestedRegion" = var.aws_region }
          }
        },
        {
          Sid    = "CrRt"
          Effect = "Allow"
          Action = ["ec2:CreateVpc", "ec2:CreateInternetGateway", "ec2:CreateVolume", "ec2:RunInstances", "eks:CreateCluster"]
          Resource = [
            "arn:aws:ec2:${var.aws_region}:${var.aws_account_id}:vpc/*",
            "arn:aws:ec2:${var.aws_region}:${var.aws_account_id}:internet-gateway/*",
            "arn:aws:ec2:${var.aws_region}:${var.aws_account_id}:volume/*",
            "arn:aws:ec2:${var.aws_region}:${var.aws_account_id}:instance/*",
            "arn:aws:ec2:${var.aws_region}:${var.aws_account_id}:network-interface/*",
            "arn:aws:eks:${var.aws_region}:${var.aws_account_id}:cluster/envscale-*",
          ]
          Condition = {
            StringEquals = {
              "aws:RequestTag/Project" = "EnvScale"
              "aws:RequestTag/Layer"   = "DisposableRuntime"
            }
          }
        },
        {
          Sid    = "RtOp"
          Effect = "Allow"
          Action = concat(
            local.ec2_nondestructive_runtime_actions,
            local.ec2_destructive_runtime_actions,
            [
              "eks:DeleteCluster",
              "eks:DeleteNodegroup",
              "eks:UpdateClusterConfig",
              "eks:UpdateNodegroupConfig",
              "eks:UntagResource",
            ]
          )
          Resource = concat(local.ec2_runtime_tagged_arns, local.eks_envscale_scoped_arns)
          Condition = {
            StringEquals = {
              "aws:ResourceTag/Project" = "EnvScale"
              "aws:ResourceTag/Layer"   = "DisposableRuntime"
            }
          }
        },
        {
          Sid      = "EksN"
          Effect   = "Allow"
          Action   = ["eks:CreateNodegroup", "eks:TagResource"]
          Resource = local.eks_envscale_scoped_arns
          Condition = {
            StringEquals = {
              "aws:ResourceTag/Project" = "EnvScale"
              "aws:ResourceTag/Layer"   = "DisposableRuntime"
              "aws:RequestTag/Project"  = "EnvScale"
              "aws:RequestTag/Layer"    = "DisposableRuntime"
            }
          }
        },
        {
          Sid    = "IamR"
          Effect = "Allow"
          Action = ["iam:GetRole", "iam:GetInstanceProfile"]
          Resource = [
            local.ec2_runtime_role_arn,
            local.ec2_runtime_profile_arn,
            "arn:aws:iam::${var.aws_account_id}:role/envscale-eks-*",
          ]
        },
        {
          Sid    = "PsE2"
          Effect = "Allow"
          Action = "iam:PassRole"
          Resource = [
            local.ec2_runtime_role_arn,
            "arn:aws:iam::${var.aws_account_id}:role/envscale-eks-node-*",
          ]
          Condition = {
            StringEquals = { "iam:PassedToService" = "ec2.amazonaws.com" }
          }
        },
        {
          Sid      = "PsEk"
          Effect   = "Allow"
          Action   = "iam:PassRole"
          Resource = "arn:aws:iam::${var.aws_account_id}:role/envscale-eks-cluster-*"
          Condition = {
            StringEquals = { "iam:PassedToService" = "eks.amazonaws.com" }
          }
        },
      ],
      local.shared_ec2_runtime_provisioning_statements,
      local.shared_governance_tag_deny_statements,
      [
        {
          Sid    = "DnSp"
          Effect = "Deny"
          Action = "s3:PutObject"
          Resource = [
            "${local.tfstate_bucket_arn}/foundation/*",
            "${local.recovery_bucket_arn}/backups/historical/*",
            "${local.recovery_bucket_arn}/backups/postgres/archive/*",
          ]
        },
        {
          Sid    = "DnSd"
          Effect = "Deny"
          Action = "s3:DeleteObject"
          Resource = [
            "${local.tfstate_bucket_arn}/foundation/*",
            "${local.tfstate_bucket_arn}/*.tfstate",
            "${local.recovery_bucket_arn}/backups/*",
            "${local.recovery_bucket_arn}/releases/*",
          ]
        },
        {
          Sid      = "DnLg"
          Effect   = "Deny"
          Action   = "s3:*"
          Resource = [local.legacy_vault_bucket_arn, "${local.legacy_vault_bucket_arn}/*"]
        },
        {
          Sid    = "DnGl"
          Effect = "Deny"
          Action = [
            "s3:DeleteBucket",
            "s3:DeleteBucketPolicy",
            "s3:PutBucketPolicy",
            "s3:DeleteObjectVersion",
            "ec2:ReleaseAddress",
            "ssm:GetParameter*",
            "ssm:PutParameter",
            "ssm:DeleteParameter*",
            "iam:Delete*",
            "iam:PutRolePolicy",
            "iam:AttachRolePolicy",
            "iam:DetachRolePolicy",
            "iam:UpdateAssumeRolePolicy",
          ]
          Resource = "*"
        },
      ]
    )
  })
}
