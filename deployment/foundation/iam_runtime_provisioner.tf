# ==============================================================================
# EnvScale Persistent Foundation — Principal 8 (MFA-Enforced Runtime Provisioner)
# ==============================================================================
# Dedicated two-role Runtime IAM separation:
#   - Principal 1 (`iam.tf`): `envscale-ec2-runtime-role` (EC2 workload identity;
#     reads `/envscale/prod/*` SSM secrets & KMS decrypt via SSM, zero provisioning)
#   - Principal 8 (this file): `envscale-runtime-provisioner-role` (human MFA
#     disposable-runtime provisioner; tagged EC2 lifecycle, SSM SendCommand,
#     `runtime/terraform.tfstate`, zero SSM secret reads, zero KMS, zero IAM write)
#
# Governance Boundary:
#   `aws_iam_policy.runtime_provisioner_permissions_boundary` (`iam_boundary.tf`)
#   is protected from mutation/removal by `envscale-github-foundation-role` and
#   managed strictly by break-glass MFA administration (`envscale-foundation-admin-role`).
# ==============================================================================

resource "aws_iam_role" "runtime_provisioner" {
  name                 = "envscale-runtime-provisioner-role"
  max_session_duration = 3600
  permissions_boundary = aws_iam_policy.runtime_provisioner_permissions_boundary.arn

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AllowSameAccountHumanProvisionersWithRecentMFA"
      Effect    = "Allow"
      Principal = { AWS = var.runtime_provisioner_trusted_principal_arns }
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
    Name    = "envscale-runtime-provisioner-role"
    Purpose = "MFAEnforcedDisposableRuntimeProvisioner"
  }
}

resource "aws_iam_role_policy" "runtime_provisioner" {
  name = "envscale-runtime-provisioner-policy"
  role = aws_iam_role.runtime_provisioner.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "Ec2SsmRead"
        Effect   = "Allow"
        Action   = ["ec2:Describe*", "ssm:DescribeParameters", "ssm:DescribeInstanceInformation", "ssm:ListCommandInvocations", "ssm:GetCommandInvocation"]
        Resource = "*"
        Condition = {
          StringEquals = { "aws:RequestedRegion" = var.aws_region }
        }
      },
      {
        Sid    = "CreateRt"
        Effect = "Allow"
        Action = ["ec2:CreateVpc", "ec2:CreateInternetGateway", "ec2:CreateVolume", "ec2:AllocateAddress", "ec2:RunInstances"]
        Resource = [
          "arn:aws:ec2:${var.aws_region}:${var.aws_account_id}:vpc/*",
          "arn:aws:ec2:${var.aws_region}:${var.aws_account_id}:internet-gateway/*",
          "arn:aws:ec2:${var.aws_region}:${var.aws_account_id}:volume/*",
          "arn:aws:ec2:${var.aws_region}:${var.aws_account_id}:elastic-ip/*",
          "arn:aws:ec2:${var.aws_region}:${var.aws_account_id}:instance/*",
        ]
        Condition = {
          StringEquals = {
            "aws:RequestTag/Project" = "EnvScale"
            "aws:RequestTag/Layer"   = "DisposableRuntime"
          }
        }
      },
      {
        Sid    = "CreateChild"
        Effect = "Allow"
        Action = ["ec2:CreateSubnet", "ec2:CreateRouteTable", "ec2:CreateSecurityGroup"]
        Resource = [
          "arn:aws:ec2:${var.aws_region}:${var.aws_account_id}:subnet/*",
          "arn:aws:ec2:${var.aws_region}:${var.aws_account_id}:route-table/*",
          "arn:aws:ec2:${var.aws_region}:${var.aws_account_id}:security-group/*",
        ]
        Condition = {
          StringEquals = {
            "aws:RequestTag/Project" = "EnvScale"
            "aws:RequestTag/Layer"   = "DisposableRuntime"
          }
        }
      },
      {
        Sid      = "VpcParent"
        Effect   = "Allow"
        Action   = ["ec2:CreateSubnet", "ec2:CreateRouteTable", "ec2:CreateSecurityGroup"]
        Resource = "arn:aws:ec2:${var.aws_region}:${var.aws_account_id}:vpc/*"
        Condition = {
          StringEquals = {
            "aws:ResourceTag/Project" = "EnvScale"
            "aws:ResourceTag/Layer"   = "DisposableRuntime"
          }
        }
      },
      {
        Sid    = "RunInstDeps"
        Effect = "Allow"
        Action = ["ec2:RunInstances"]
        Resource = [
          "arn:aws:ec2:${var.aws_region}:${var.aws_account_id}:subnet/*",
          "arn:aws:ec2:${var.aws_region}:${var.aws_account_id}:security-group/*",
          "arn:aws:ec2:${var.aws_region}:${var.aws_account_id}:network-interface/*",
        ]
        Condition = {
          StringEquals = {
            "aws:ResourceTag/Project" = "EnvScale"
            "aws:ResourceTag/Layer"   = "DisposableRuntime"
          }
        }
      },
      {
        Sid      = "RunInstEni"
        Effect   = "Allow"
        Action   = ["ec2:RunInstances"]
        Resource = "arn:aws:ec2:${var.aws_region}:${var.aws_account_id}:network-interface/*"
        Condition = {
          StringEquals = { "aws:RequestedRegion" = var.aws_region }
          Null = {
            "aws:ResourceTag/Project" = "true"
            "aws:ResourceTag/Layer"   = "true"
          }
          StringEqualsIfExists = {
            "aws:RequestTag/Project" = "EnvScale"
            "aws:RequestTag/Layer"   = "DisposableRuntime"
          }
        }
      },
      {
        Sid    = "RunInstAmi"
        Effect = "Allow"
        Action = ["ec2:RunInstances"]
        Resource = [
          "arn:aws:ec2:${var.aws_region}::image/*",
          "arn:aws:ec2:${var.aws_region}::snapshot/*",
        ]
        Condition = {
          StringEquals = { "ec2:Owner" = var.approved_ami_owner_ids }
        }
      },
      {
        Sid    = "TagCreate"
        Effect = "Allow"
        Action = ["ec2:CreateTags"]
        Resource = concat(local.ec2_runtime_tagged_arns, [
          "arn:aws:ec2:${var.aws_region}:${var.aws_account_id}:security-group-rule/*",
          "arn:aws:ec2:${var.aws_region}:${var.aws_account_id}:elastic-ip/*",
        ])
        Condition = {
          StringEquals = {
            "ec2:CreateAction" = [
              "CreateVpc", "CreateSubnet", "CreateInternetGateway", "CreateRouteTable",
              "CreateSecurityGroup", "AuthorizeSecurityGroupIngress", "AuthorizeSecurityGroupEgress",
              "CreateVolume", "RunInstances", "AllocateAddress",
            ]
            "aws:RequestTag/Project" = "EnvScale"
            "aws:RequestTag/Layer"   = "DisposableRuntime"
          }
        }
      },
      {
        Sid    = "Lifecycle"
        Effect = "Allow"
        Action = [
          "ec2:ModifyVpcAttribute", "ec2:ModifySubnetAttribute", "ec2:AttachInternetGateway", "ec2:DetachInternetGateway",
          "ec2:CreateRoute", "ec2:ReplaceRoute", "ec2:DeleteRoute", "ec2:AssociateRouteTable", "ec2:DisassociateRouteTable",
          "ec2:AuthorizeSecurityGroupIngress", "ec2:AuthorizeSecurityGroupEgress", "ec2:RevokeSecurityGroupIngress",
          "ec2:RevokeSecurityGroupEgress", "ec2:UpdateSecurityGroupRuleDescriptionsIngress", "ec2:UpdateSecurityGroupRuleDescriptionsEgress",
          "ec2:StartInstances", "ec2:StopInstances", "ec2:RebootInstances", "ec2:ModifyInstanceAttribute",
          "ec2:ModifyInstanceMetadataOptions", "ec2:ModifyVolume", "ec2:AttachVolume", "ec2:DetachVolume",
          "ec2:TerminateInstances", "ec2:DeleteVolume", "ec2:DeleteSecurityGroup", "ec2:DeleteRouteTable",
          "ec2:DeleteInternetGateway", "ec2:DeleteSubnet", "ec2:DeleteVpc", "ec2:AssociateAddress",
          "ec2:DisassociateAddress", "ec2:CreateTags", "ec2:DeleteTags",
        ]
        Resource = concat(local.ec2_runtime_tagged_arns, ["arn:aws:ec2:${var.aws_region}:${var.aws_account_id}:elastic-ip/*"])
        Condition = {
          StringEquals = {
            "aws:ResourceTag/Project" = "EnvScale"
            "aws:ResourceTag/Layer"   = "DisposableRuntime"
          }
        }
      },
      {
        Sid      = "SgRules"
        Effect   = "Allow"
        Action   = ["ec2:AuthorizeSecurityGroupIngress", "ec2:AuthorizeSecurityGroupEgress"]
        Resource = "arn:aws:ec2:${var.aws_region}:${var.aws_account_id}:security-group-rule/*"
        Condition = {
          StringEquals = {
            "aws:RequestTag/Project" = "EnvScale"
            "aws:RequestTag/Layer"   = "DisposableRuntime"
          }
        }
      },
      {
        Sid      = "RelDispEip"
        Effect   = "Allow"
        Action   = ["ec2:ReleaseAddress"]
        Resource = "arn:aws:ec2:${var.aws_region}:${var.aws_account_id}:elastic-ip/*"
        Condition = {
          StringEquals = {
            "aws:ResourceTag/Project" = "EnvScale"
            "aws:ResourceTag/Layer"   = "DisposableRuntime"
          }
        }
      },
      {
        Sid      = "IamRead"
        Effect   = "Allow"
        Action   = ["iam:GetRole", "iam:GetInstanceProfile"]
        Resource = [local.ec2_runtime_role_arn, local.ec2_runtime_profile_arn]
      },
      {
        Sid      = "PassRole"
        Effect   = "Allow"
        Action   = ["iam:PassRole"]
        Resource = local.ec2_runtime_role_arn
        Condition = {
          StringEquals = { "iam:PassedToService" = "ec2.amazonaws.com" }
        }
      },
      {
        Sid      = "SsmDoc"
        Effect   = "Allow"
        Action   = ["ssm:SendCommand"]
        Resource = "arn:aws:ssm:${var.aws_region}::document/AWS-RunShellScript"
      },
      {
        Sid      = "SsmInst"
        Effect   = "Allow"
        Action   = ["ssm:SendCommand"]
        Resource = "arn:aws:ec2:${var.aws_region}:${var.aws_account_id}:instance/*"
        Condition = {
          StringEquals = {
            "aws:ResourceTag/Project" = "EnvScale"
            "aws:ResourceTag/Layer"   = "DisposableRuntime"
          }
        }
      },
      {
        Sid      = "TfList"
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = local.tfstate_bucket_arn
        Condition = {
          StringLike = { "s3:prefix" = ["runtime/*", "foundation/terraform.tfstate"] }
        }
      },
      {
        Sid      = "S3Read"
        Effect   = "Allow"
        Action   = ["s3:GetBucketLocation", "s3:GetObject", "s3:GetObjectVersion"]
        Resource = [local.tfstate_bucket_arn, "${local.tfstate_bucket_arn}/foundation/terraform.tfstate", local.recovery_bucket_arn, "${local.recovery_bucket_arn}/releases/*", "${local.recovery_bucket_arn}/backups/postgres/*"]
      },
      {
        Sid      = "RtState"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject"]
        Resource = ["${local.tfstate_bucket_arn}/runtime/terraform.tfstate", "${local.tfstate_bucket_arn}/runtime/terraform.tfstate.tflock"]
      },
      {
        Sid      = "RtLockDel"
        Effect   = "Allow"
        Action   = ["s3:DeleteObject"]
        Resource = "${local.tfstate_bucket_arn}/runtime/terraform.tfstate.tflock"
      },
      {
        Sid      = "RecList"
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = local.recovery_bucket_arn
        Condition = {
          StringLike = { "s3:prefix" = ["releases/*", "backups/postgres/*"] }
        }
      },
      {
        Sid      = "DenySsmKms"
        Effect   = "Deny"
        Action   = ["ssm:GetParameter*", "ssm:PutParameter", "ssm:DeleteParameter*", "ssm:LabelParameterVersion", "kms:*"]
        Resource = "*"
      },
      {
        Sid      = "DenyIam"
        Effect   = "Deny"
        Action   = ["iam:Create*", "iam:Delete*", "iam:Put*", "iam:Update*", "iam:Attach*", "iam:Detach*", "iam:Add*", "iam:Remove*", "iam:Tag*", "iam:Untag*"]
        Resource = "*"
      },
      {
        Sid      = "DenyDelTags"
        Effect   = "Deny"
        Action   = ["ec2:DeleteTags"]
        Resource = "*"
        Condition = {
          "ForAnyValue:StringEquals" = { "aws:TagKeys" = ["Project", "Layer"] }
        }
      },
      {
        Sid      = "DenyMutProj"
        Effect   = "Deny"
        Action   = ["ec2:CreateTags"]
        Resource = "*"
        Condition = {
          Null            = { "aws:RequestTag/Project" = "false" }
          StringNotEquals = { "aws:RequestTag/Project" = "EnvScale" }
        }
      },
      {
        Sid      = "DenyMutLayer"
        Effect   = "Deny"
        Action   = ["ec2:CreateTags"]
        Resource = "*"
        Condition = {
          Null            = { "aws:RequestTag/Layer" = "false" }
          StringNotEquals = { "aws:RequestTag/Layer" = "DisposableRuntime" }
        }
      },
      {
        Sid      = "DenyEipProj"
        Effect   = "Deny"
        Action   = ["ec2:ReleaseAddress"]
        Resource = "*"
        Condition = {
          StringNotEqualsIfExists = { "aws:ResourceTag/Project" = "EnvScale" }
        }
      },
      {
        Sid      = "DenyEipLayer"
        Effect   = "Deny"
        Action   = ["ec2:ReleaseAddress"]
        Resource = "*"
        Condition = {
          StringNotEqualsIfExists = { "aws:ResourceTag/Layer" = "DisposableRuntime" }
        }
      },
      {
        Sid      = "DenyS3Wr"
        Effect   = "Deny"
        Action   = ["s3:PutObject", "s3:DeleteObject"]
        Resource = ["${local.tfstate_bucket_arn}/foundation/*", "${local.recovery_bucket_arn}/backups/*", "${local.recovery_bucket_arn}/releases/*"]
      },
      {
        Sid      = "DenyStateDel"
        Effect   = "Deny"
        Action   = ["s3:DeleteObject"]
        Resource = "${local.tfstate_bucket_arn}/*.tfstate"
      },
      {
        Sid      = "DenyBucketDestroy"
        Effect   = "Deny"
        Action   = ["s3:DeleteBucket", "s3:DeleteBucketPolicy", "s3:PutBucketPolicy", "s3:DeleteObjectVersion"]
        Resource = [local.tfstate_bucket_arn, "${local.tfstate_bucket_arn}/*", local.recovery_bucket_arn, "${local.recovery_bucket_arn}/*"]
      },
      {
        Sid      = "DenyLegacyVault"
        Effect   = "Deny"
        Action   = ["s3:*"]
        Resource = [local.legacy_vault_bucket_arn, "${local.legacy_vault_bucket_arn}/*"]
      },
      {
        Sid      = "DenyOrgAcct"
        Effect   = "Deny"
        Action   = ["organizations:*", "account:*"]
        Resource = "*"
      },
    ]
  })
}
