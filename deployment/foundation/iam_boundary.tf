# ==============================================================================
# EnvScale Persistent Foundation — Workload & CI/CD IAM Permissions Boundary
# ==============================================================================
# Attached to workload and runtime CI/CD roles (`ec2_runtime`, `github_release`,
# `github_deploy`, `github_recovery`) so effective permissions never exceed this
# ceiling even if an inline role policy is expanded.
# Protected from mutation/removal by `envscale-github-foundation-role`; managed
# strictly by break-glass MFA administration (`envscale-foundation-admin-role`).
# ==============================================================================

resource "aws_iam_policy" "workload_permissions_boundary" {
  name        = "envscale-workload-permissions-boundary"
  description = "Upper-bound IAM permissions boundary for EnvScale workload and runtime CI/CD roles."

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowBoundedStateAndRecoveryS3Operations"
        Effect = "Allow"
        Action = [
          "s3:ListBucket",
          "s3:GetBucketLocation",
          "s3:GetObject",
          "s3:GetObjectVersion",
          "s3:PutObject",
          "s3:DeleteObject",
        ]
        Resource = [
          local.tfstate_bucket_arn,
          "${local.tfstate_bucket_arn}/*",
          local.recovery_bucket_arn,
          "${local.recovery_bucket_arn}/*",
        ]
      },
      {
        Sid    = "AllowBoundedSSMAndKmsViaSSMOperations"
        Effect = "Allow"
        Action = [
          "ssm:DescribeAssociation",
          "ssm:GetDeployablePatchSnapshotForInstance",
          "ssm:GetDocument",
          "ssm:DescribeDocument",
          "ssm:GetManifest",
          "ssm:GetParameter",
          "ssm:GetParameters",
          "ssm:GetParametersByPath",
          "ssm:ListAssociations",
          "ssm:ListInstanceAssociations",
          "ssm:PutInventory",
          "ssm:PutComplianceItems",
          "ssm:PutConfigurePackageResult",
          "ssm:UpdateAssociationStatus",
          "ssm:UpdateInstanceAssociationStatus",
          "ssm:UpdateInstanceInformation",
          "ssm:DescribeParameters",
          "ssm:DescribeInstanceInformation",
          "ssm:ListCommandInvocations",
          "ssm:GetCommandInvocation",
          "ssm:SendCommand",
          "ssmmessages:CreateControlChannel",
          "ssmmessages:CreateDataChannel",
          "ssmmessages:OpenControlChannel",
          "ssmmessages:OpenDataChannel",
          "ec2messages:AcknowledgeMessage",
          "ec2messages:DeleteMessage",
          "ec2messages:FailMessage",
          "ec2messages:GetEndpoint",
          "ec2messages:GetMessages",
          "ec2messages:SendReply",
        ]
        Resource = "*"
      },
      {
        Sid      = "AllowBoundedSSMKmsDecryptViaServiceOnly"
        Effect   = "Allow"
        Action   = ["kms:Decrypt"]
        Resource = "arn:aws:kms:${var.aws_region}:${var.aws_account_id}:key/*"
        Condition = {
          StringEquals = {
            "kms:ViaService" = "ssm.${var.aws_region}.amazonaws.com"
          }
        }
      },
      {
        Sid    = "AllowBoundedRuntimeEc2AndEksLifecycle"
        Effect = "Allow"
        Action = [
          "ec2:Describe*",
          "ec2:CreateVpc",
          "ec2:CreateInternetGateway",
          "ec2:CreateVolume",
          "ec2:CreateSubnet",
          "ec2:CreateRouteTable",
          "ec2:CreateSecurityGroup",
          "ec2:RunInstances",
          "ec2:CreateTags",
          "ec2:DeleteTags",
          "ec2:ModifyVpcAttribute",
          "ec2:ModifySubnetAttribute",
          "ec2:AttachInternetGateway",
          "ec2:CreateRoute",
          "ec2:ReplaceRoute",
          "ec2:AssociateRouteTable",
          "ec2:AuthorizeSecurityGroupIngress",
          "ec2:AuthorizeSecurityGroupEgress",
          "ec2:RevokeSecurityGroupIngress",
          "ec2:RevokeSecurityGroupEgress",
          "ec2:UpdateSecurityGroupRuleDescriptionsIngress",
          "ec2:UpdateSecurityGroupRuleDescriptionsEgress",
          "ec2:StartInstances",
          "ec2:StopInstances",
          "ec2:RebootInstances",
          "ec2:ModifyInstanceAttribute",
          "ec2:ModifyInstanceMetadataOptions",
          "ec2:ModifyVolume",
          "ec2:AttachVolume",
          "ec2:AssociateAddress",
          "ec2:DisassociateAddress",
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
          "eks:DescribeCluster",
          "eks:DescribeNodegroup",
          "eks:ListClusters",
          "eks:ListNodegroups",
          "eks:CreateCluster",
          "eks:CreateNodegroup",
          "eks:DeleteCluster",
          "eks:DeleteNodegroup",
          "eks:UpdateClusterConfig",
          "eks:UpdateNodegroupConfig",
          "eks:TagResource",
          "eks:UntagResource",
        ]
        Resource = "*"
        Condition = {
          StringEquals = {
            "aws:RequestedRegion" = var.aws_region
          }
        }
      },
      {
        Sid    = "AllowBoundedRuntimeRoleLookup"
        Effect = "Allow"
        Action = ["iam:GetRole", "iam:GetInstanceProfile"]
        Resource = [
          "arn:aws:iam::${var.aws_account_id}:role/envscale-ec2-runtime-role",
          "arn:aws:iam::${var.aws_account_id}:role/envscale-eks-*",
          "arn:aws:iam::${var.aws_account_id}:instance-profile/envscale-ec2-runtime-profile",
        ]
      },
      {
        Sid    = "AllowBoundedPassEc2AndNodeRolesToEc2Only"
        Effect = "Allow"
        Action = ["iam:PassRole"]
        Resource = [
          "arn:aws:iam::${var.aws_account_id}:role/envscale-ec2-runtime-role",
          "arn:aws:iam::${var.aws_account_id}:role/envscale-eks-node-*",
        ]
        Condition = {
          StringEquals = {
            "iam:PassedToService" = "ec2.amazonaws.com"
          }
        }
      },
      {
        Sid      = "AllowBoundedPassEksClusterRoleToEksOnly"
        Effect   = "Allow"
        Action   = ["iam:PassRole"]
        Resource = "arn:aws:iam::${var.aws_account_id}:role/envscale-eks-cluster-*"
        Condition = {
          StringEquals = {
            "iam:PassedToService" = "eks.amazonaws.com"
          }
        }
      },
      {
        Sid    = "DenyIamPrivilegeEscalationWithinBoundary"
        Effect = "Deny"
        Action = [
          "iam:Create*",
          "iam:Delete*",
          "iam:Put*",
          "iam:Update*",
          "iam:Attach*",
          "iam:Detach*",
          "iam:Add*",
          "iam:Remove*",
          "iam:Tag*",
          "iam:Untag*",
        ]
        Resource = "*"
      },
      {
        Sid    = "DenyProtectedFoundationAndVaultDestruction"
        Effect = "Deny"
        Action = [
          "s3:DeleteBucket",
          "s3:DeleteObjectVersion",
          "s3:DeleteBucketPolicy",
          "s3:PutBucketPolicy",
        ]
        Resource = [
          local.tfstate_bucket_arn,
          "${local.tfstate_bucket_arn}/*",
          local.recovery_bucket_arn,
          "${local.recovery_bucket_arn}/*",
        ]
      },
      {
        Sid    = "DenyCriticalStateAndBackupDeletionAndLegacyVault"
        Effect = "Deny"
        Action = ["s3:DeleteObject"]
        Resource = [
          "${local.tfstate_bucket_arn}/*.tfstate",
          "${local.recovery_bucket_arn}/backups/*",
          "${local.recovery_bucket_arn}/releases/*",
        ]
      },
      {
        Sid      = "DenyLegacyVaultAccess"
        Effect   = "Deny"
        Action   = ["s3:*"]
        Resource = [local.legacy_vault_bucket_arn, "${local.legacy_vault_bucket_arn}/*"]
      },
      {
        Sid      = "DenyFoundationStateWriteAndEipRelease"
        Effect   = "Deny"
        Action   = ["s3:PutObject"]
        Resource = "${local.tfstate_bucket_arn}/foundation/*"
      },
      {
        Sid      = "DenyStaticEipReleaseAndOrgBilling"
        Effect   = "Deny"
        Action   = ["ec2:ReleaseAddress", "organizations:*", "account:*"]
        Resource = "*"
      },
    ]
  })

  tags = {
    Name    = "envscale-workload-permissions-boundary"
    Purpose = "WorkloadAndCICDPermissionsBoundary"
  }
}

