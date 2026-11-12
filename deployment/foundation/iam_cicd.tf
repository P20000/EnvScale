# ==============================================================================
# EnvScale Persistent Foundation — Environment-Scoped CI/CD & DR IAM Roles
# ==============================================================================
# Principals 3 & 4 enforce exact GitHub Environment OIDC `sub` claims
# (`environment:production` vs `environment:recovery`), native S3 `.tflock`
# permissions without `.tfstate` delete access, mandatory EnvScale resource/
# request tag boundaries (`Project = EnvScale`, `Layer = DisposableRuntime`),
# owner-verified AMI/snapshot `RunInstances` scoping, and explicit Denies.
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
          "token.actions.githubusercontent.com:sub" = "repo:${var.github_repository}:environment:${var.production_environment_name}"
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
          Sid      = "AllowRecoveryListScoped"
          Effect   = "Allow"
          Action   = ["s3:ListBucket"]
          Resource = local.recovery_bucket_arn
          Condition = {
            StringLike = {
              "s3:prefix" = ["releases/*", "lifecycle/*", "backups/*"]
            }
          }
        },
        {
          Sid      = "AllowRecoveryBucketLocation"
          Effect   = "Allow"
          Action   = ["s3:GetBucketLocation"]
          Resource = local.recovery_bucket_arn
        },
        {
          Sid    = "AllowRecoveryReleasesAndLifecycleRW"
          Effect = "Allow"
          Action = ["s3:GetObject", "s3:GetObjectVersion", "s3:PutObject"]
          Resource = [
            "${local.recovery_bucket_arn}/releases/*",
            "${local.recovery_bucket_arn}/lifecycle/*",
          ]
        },
        {
          Sid      = "AllowRecoveryLifecycleLockRelease"
          Effect   = "Allow"
          Action   = ["s3:DeleteObject"]
          Resource = "${local.recovery_bucket_arn}/lifecycle/active-op.lock"
        },
        {
          Sid      = "AllowRecoveryBackupsReadOnly"
          Effect   = "Allow"
          Action   = ["s3:GetObject", "s3:GetObjectVersion"]
          Resource = "${local.recovery_bucket_arn}/backups/*"
        },
        {
          Sid    = "AllowRegionalMetadataDescribeOnly"
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
          Sid      = "AllowGetEc2RuntimeRoleAndProfile"
          Effect   = "Allow"
          Action   = ["iam:GetRole", "iam:GetInstanceProfile"]
          Resource = [aws_iam_role.ec2_runtime.arn, aws_iam_instance_profile.ec2_runtime.arn]
        },
        {
          Sid      = "AllowPassEc2RuntimeRoleToEc2Only"
          Effect   = "Allow"
          Action   = ["iam:PassRole"]
          Resource = aws_iam_role.ec2_runtime.arn
          Condition = {
            StringEquals = {
              "iam:PassedToService" = "ec2.amazonaws.com"
            }
          }
        },
      ],
      local.shared_ec2_runtime_provisioning_statements,
      local.shared_ssm_run_command_statements,
      local.shared_governance_tag_deny_statements,
      [
        {
          Sid      = "DenyFoundationStateMutation"
          Effect   = "Deny"
          Action   = ["s3:PutObject", "s3:DeleteObject", "s3:DeleteObjectVersion"]
          Resource = "${local.tfstate_bucket_arn}/foundation/*"
        },
        {
          Sid      = "DenyTfstateObjectDeletion"
          Effect   = "Deny"
          Action   = ["s3:DeleteObject", "s3:DeleteObjectVersion"]
          Resource = "${local.tfstate_bucket_arn}/*.tfstate"
        },
        {
          Sid    = "DenyBucketAndVersionDeletion"
          Effect = "Deny"
          Action = ["s3:DeleteBucket", "s3:DeleteBucketPolicy", "s3:PutBucketPolicy", "s3:DeleteObjectVersion"]
          Resource = [
            local.tfstate_bucket_arn,
            "${local.tfstate_bucket_arn}/*",
            local.recovery_bucket_arn,
            "${local.recovery_bucket_arn}/*",
          ]
        },
        {
          Sid      = "DenyBackupMutationsAndDeletions"
          Effect   = "Deny"
          Action   = ["s3:PutObject", "s3:DeleteObject"]
          Resource = "${local.recovery_bucket_arn}/backups/*"
        },
        {
          Sid      = "DenyReleaseArtifactDeletion"
          Effect   = "Deny"
          Action   = ["s3:DeleteObject"]
          Resource = "${local.recovery_bucket_arn}/releases/*"
        },
        {
          Sid      = "DenyLegacyVaultAccess"
          Effect   = "Deny"
          Action   = ["s3:*"]
          Resource = [local.legacy_vault_bucket_arn, "${local.legacy_vault_bucket_arn}/*"]
        },
        {
          Sid    = "DenyDestructiveComputeAndEipRelease"
          Effect = "Deny"
          Action = [
            "ec2:TerminateInstances",
            "ec2:DeleteVolume",
            "ec2:DeleteVpc",
            "ec2:DeleteSubnet",
            "ec2:DeleteSecurityGroup",
            "ec2:DeleteRouteTable",
            "ec2:DeleteInternetGateway",
            "ec2:ReleaseAddress",
          ]
          Resource = "*"
        },
        {
          Sid      = "DenySSMParameterValuesAndMutations"
          Effect   = "Deny"
          Action   = ["ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath", "ssm:PutParameter", "ssm:DeleteParameter", "ssm:DeleteParameters"]
          Resource = local.ssm_all_param_arn
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
          "token.actions.githubusercontent.com:sub" = "repo:${var.github_repository}:environment:${var.recovery_environment_name}"
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
          Sid      = "AllowRecoveryListScoped"
          Effect   = "Allow"
          Action   = ["s3:ListBucket"]
          Resource = local.recovery_bucket_arn
          Condition = {
            StringLike = {
              "s3:prefix" = ["backups/*", "releases/*", "lifecycle/*"]
            }
          }
        },
        {
          Sid      = "AllowRecoveryBucketLocation"
          Effect   = "Allow"
          Action   = ["s3:GetBucketLocation"]
          Resource = local.recovery_bucket_arn
        },
        {
          Sid    = "AllowRecoveryBackupsAndReleasesReadOnly"
          Effect = "Allow"
          Action = ["s3:GetObject", "s3:GetObjectVersion"]
          Resource = [
            "${local.recovery_bucket_arn}/backups/*",
            "${local.recovery_bucket_arn}/releases/*",
          ]
        },
        {
          Sid    = "AllowRecoveryLifecycleAndPointerWrite"
          Effect = "Allow"
          Action = ["s3:PutObject"]
          Resource = [
            "${local.recovery_bucket_arn}/lifecycle/*",
            "${local.recovery_bucket_arn}/releases/latest-known-good.json",
            "${local.recovery_bucket_arn}/releases/previous-known-good.json",
            "${local.recovery_bucket_arn}/backups/postgres/latest-valid.json",
          ]
        },
        {
          Sid      = "AllowRecoveryLifecycleLockRelease"
          Effect   = "Allow"
          Action   = ["s3:DeleteObject"]
          Resource = "${local.recovery_bucket_arn}/lifecycle/active-op.lock"
        },
        {
          Sid    = "AllowRegionalMetadataDescribeOnly"
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
          Sid    = "AllowTaggedRuntimeDestruction"
          Effect = "Allow"
          Action = [
            "ec2:TerminateInstances",
            "ec2:DetachVolume",
            "ec2:DeleteVolume",
            "ec2:DeleteSecurityGroup",
            "ec2:DisassociateRouteTable",
            "ec2:DeleteRoute",
            "ec2:DeleteRouteTable",
            "ec2:DetachInternetGateway",
            "ec2:DeleteInternetGateway",
            "ec2:DeleteSubnet",
            "ec2:DeleteVpc",
          ]
          Resource = local.ec2_runtime_tagged_arns
          Condition = {
            StringEquals = {
              "aws:ResourceTag/Project" = "EnvScale"
              "aws:ResourceTag/Layer"   = "DisposableRuntime"
            }
          }
        },
        {
          Sid      = "AllowEnvScaleEksClusterCreation"
          Effect   = "Allow"
          Action   = ["eks:CreateCluster"]
          Resource = "arn:aws:eks:${var.aws_region}:${var.aws_account_id}:cluster/envscale-*"
          Condition = {
            StringEquals = {
              "aws:RequestTag/Project" = "EnvScale"
              "aws:RequestTag/Layer"   = "DisposableRuntime"
            }
          }
        },
        {
          Sid    = "AllowEnvScaleEksNodegroupCreation"
          Effect = "Allow"
          Action = ["eks:CreateNodegroup"]
          Resource = [
            "arn:aws:eks:${var.aws_region}:${var.aws_account_id}:cluster/envscale-*",
            "arn:aws:eks:${var.aws_region}:${var.aws_account_id}:nodegroup/envscale-*/*/*",
          ]
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
          Sid    = "AllowEnvScaleEksTaggedLifecycleAndDelete"
          Effect = "Allow"
          Action = [
            "eks:DeleteCluster",
            "eks:DeleteNodegroup",
            "eks:UpdateClusterConfig",
            "eks:UpdateNodegroupConfig",
            "eks:UntagResource",
          ]
          Resource = local.eks_envscale_scoped_arns
          Condition = {
            StringEquals = {
              "aws:ResourceTag/Project" = "EnvScale"
              "aws:ResourceTag/Layer"   = "DisposableRuntime"
            }
          }
        },
        {
          Sid      = "AllowEnvScaleEksTaggedResourceTagging"
          Effect   = "Allow"
          Action   = ["eks:TagResource"]
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
          Sid    = "AllowGetRuntimeAndEksRoles"
          Effect = "Allow"
          Action = ["iam:GetRole", "iam:GetInstanceProfile"]
          Resource = [
            aws_iam_role.ec2_runtime.arn,
            aws_iam_instance_profile.ec2_runtime.arn,
            "arn:aws:iam::${var.aws_account_id}:role/envscale-eks-*",
          ]
        },
        {
          Sid    = "AllowPassEc2AndNodeRolesToEc2Only"
          Effect = "Allow"
          Action = ["iam:PassRole"]
          Resource = [
            aws_iam_role.ec2_runtime.arn,
            "arn:aws:iam::${var.aws_account_id}:role/envscale-eks-node-*",
          ]
          Condition = {
            StringEquals = {
              "iam:PassedToService" = "ec2.amazonaws.com"
            }
          }
        },
        {
          Sid      = "AllowPassEksClusterRoleToEksOnly"
          Effect   = "Allow"
          Action   = ["iam:PassRole"]
          Resource = "arn:aws:iam::${var.aws_account_id}:role/envscale-eks-cluster-*"
          Condition = {
            StringEquals = {
              "iam:PassedToService" = "eks.amazonaws.com"
            }
          }
        },
      ],
      local.shared_ec2_runtime_provisioning_statements,
      local.shared_ssm_run_command_statements,
      local.shared_governance_tag_deny_statements,
      [
        {
          Sid      = "DenyFoundationStaticEipRelease"
          Effect   = "Deny"
          Action   = ["ec2:ReleaseAddress"]
          Resource = "*"
        },
        {
          Sid      = "DenyFoundationStateMutation"
          Effect   = "Deny"
          Action   = ["s3:PutObject", "s3:DeleteObject", "s3:DeleteObjectVersion"]
          Resource = "${local.tfstate_bucket_arn}/foundation/*"
        },
        {
          Sid      = "DenyTfstateObjectDeletion"
          Effect   = "Deny"
          Action   = ["s3:DeleteObject", "s3:DeleteObjectVersion"]
          Resource = "${local.tfstate_bucket_arn}/*.tfstate"
        },
        {
          Sid    = "DenyBucketAndVersionDestruction"
          Effect = "Deny"
          Action = ["s3:DeleteBucket", "s3:DeleteBucketPolicy", "s3:PutBucketPolicy", "s3:DeleteObjectVersion"]
          Resource = [
            local.tfstate_bucket_arn,
            "${local.tfstate_bucket_arn}/*",
            local.recovery_bucket_arn,
            "${local.recovery_bucket_arn}/*",
          ]
        },
        {
          Sid    = "DenyBackupArchiveWritesAndAllBackupDeletions"
          Effect = "Deny"
          Action = ["s3:PutObject"]
          Resource = [
            "${local.recovery_bucket_arn}/backups/historical/*",
            "${local.recovery_bucket_arn}/backups/postgres/archive/*",
          ]
        },
        {
          Sid      = "DenyBackupDeletions"
          Effect   = "Deny"
          Action   = ["s3:DeleteObject"]
          Resource = "${local.recovery_bucket_arn}/backups/*"
        },
        {
          Sid      = "DenyReleaseArtifactDeletion"
          Effect   = "Deny"
          Action   = ["s3:DeleteObject"]
          Resource = "${local.recovery_bucket_arn}/releases/*"
        },
        {
          Sid      = "DenyLegacyVaultAccess"
          Effect   = "Deny"
          Action   = ["s3:*"]
          Resource = [local.legacy_vault_bucket_arn, "${local.legacy_vault_bucket_arn}/*"]
        },
        {
          Sid      = "DenySSMParameterValuesAndMutations"
          Effect   = "Deny"
          Action   = ["ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath", "ssm:PutParameter", "ssm:DeleteParameter", "ssm:DeleteParameters"]
          Resource = local.ssm_all_param_arn
        },
        {
          Sid    = "DenyFoundationIAMMutations"
          Effect = "Deny"
          Action = [
            "iam:Delete*",
            "iam:PutRolePolicy",
            "iam:AttachRolePolicy",
            "iam:DetachRolePolicy",
            "iam:UpdateAssumeRolePolicy",
          ]
          Resource = [
            "arn:aws:iam::${var.aws_account_id}:role/envscale-ec2-runtime-role",
            "arn:aws:iam::${var.aws_account_id}:role/envscale-foundation-admin-role",
            "arn:aws:iam::${var.aws_account_id}:role/envscale-github-*",
            "arn:aws:iam::${var.aws_account_id}:instance-profile/envscale-*",
            "arn:aws:iam::${var.aws_account_id}:oidc-provider/*",
          ]
        },
      ]
    )
  })
}
