# ==============================================================================
# EnvScale Persistent Foundation — Shared Tag-Scoped IAM Statement Locals
# ==============================================================================
# Modular IAM layout (< 500 lines per file):
#   - iam_locals.tf : Shared ARNs, native S3 .tflock statements, tag-enforced EC2
#                     provisioning, AMI/snapshot RunInstances scoping, & tag Denies
#   - iam.tf        : Principal 1 (EC2 Runtime) + Principal 2 (GitHub Release)
#   - iam_cicd.tf   : Principal 3 (GitHub Deploy) + Principal 4 (GitHub Recovery)
#   - iam_admin.tf  : Principal 5 (MFA-enforced Human Foundation Admin Role)
# ZERO DynamoDB actions or resources exist anywhere in this module.
# ==============================================================================

locals {
  tfstate_bucket_arn      = "arn:aws:s3:::${local.tfstate_bucket_name}"
  legacy_vault_bucket_arn = "arn:aws:s3:::${local.legacy_vault_bucket_name}"
  recovery_bucket_arn     = aws_s3_bucket.recovery.arn
  ssm_prod_param_arn      = "arn:aws:ssm:${var.aws_region}:${var.aws_account_id}:parameter${local.ssm_prefix}/*"
  ssm_all_param_arn       = "arn:aws:ssm:${var.aws_region}:${var.aws_account_id}:parameter/*"

  ec2_runtime_tagged_arns = [
    "arn:aws:ec2:${var.aws_region}:${var.aws_account_id}:vpc/*",
    "arn:aws:ec2:${var.aws_region}:${var.aws_account_id}:subnet/*",
    "arn:aws:ec2:${var.aws_region}:${var.aws_account_id}:internet-gateway/*",
    "arn:aws:ec2:${var.aws_region}:${var.aws_account_id}:route-table/*",
    "arn:aws:ec2:${var.aws_region}:${var.aws_account_id}:security-group/*",
    "arn:aws:ec2:${var.aws_region}:${var.aws_account_id}:instance/*",
    "arn:aws:ec2:${var.aws_region}:${var.aws_account_id}:volume/*",
    "arn:aws:ec2:${var.aws_region}:${var.aws_account_id}:network-interface/*",
  ]

  eks_envscale_scoped_arns = [
    "arn:aws:eks:${var.aws_region}:${var.aws_account_id}:cluster/envscale-*",
    "arn:aws:eks:${var.aws_region}:${var.aws_account_id}:nodegroup/envscale-*/*/*",
  ]

  shared_cicd_tfstate_statements = [
    {
      Sid      = "AllowTfstateListScoped"
      Effect   = "Allow"
      Action   = ["s3:ListBucket"]
      Resource = local.tfstate_bucket_arn
      Condition = {
        StringLike = {
          "s3:prefix" = ["runtime/*", "eks/*", "foundation/terraform.tfstate"]
        }
      }
    },
    {
      Sid      = "AllowTfstateBucketLocation"
      Effect   = "Allow"
      Action   = ["s3:GetBucketLocation"]
      Resource = local.tfstate_bucket_arn
    },
    {
      Sid      = "AllowFoundationStateReadOnly"
      Effect   = "Allow"
      Action   = ["s3:GetObject"]
      Resource = "${local.tfstate_bucket_arn}/foundation/terraform.tfstate"
    },
    {
      Sid    = "AllowRuntimeAndEksStateReadWrite"
      Effect = "Allow"
      Action = ["s3:GetObject", "s3:PutObject"]
      Resource = [
        "${local.tfstate_bucket_arn}/runtime/terraform.tfstate",
        "${local.tfstate_bucket_arn}/eks/terraform.tfstate",
      ]
    },
    {
      Sid    = "AllowRuntimeAndEksNativeLockFiles"
      Effect = "Allow"
      Action = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
      Resource = [
        "${local.tfstate_bucket_arn}/runtime/terraform.tfstate.tflock",
        "${local.tfstate_bucket_arn}/eks/terraform.tfstate.tflock",
      ]
    },
  ]

  shared_ec2_runtime_provisioning_statements = [
    {
      Sid    = "AllowCreateTaggedTopLevelRuntimeResources"
      Effect = "Allow"
      Action = [
        "ec2:CreateVpc",
        "ec2:CreateInternetGateway",
        "ec2:CreateVolume",
      ]
      Resource = [
        "arn:aws:ec2:${var.aws_region}:${var.aws_account_id}:vpc/*",
        "arn:aws:ec2:${var.aws_region}:${var.aws_account_id}:internet-gateway/*",
        "arn:aws:ec2:${var.aws_region}:${var.aws_account_id}:volume/*",
      ]
      Condition = {
        StringEquals = {
          "aws:RequestTag/Project" = "EnvScale"
          "aws:RequestTag/Layer"   = "DisposableRuntime"
        }
      }
    },
    {
      Sid    = "AllowCreateTaggedVpcChildResources"
      Effect = "Allow"
      Action = [
        "ec2:CreateSubnet",
        "ec2:CreateRouteTable",
        "ec2:CreateSecurityGroup",
      ]
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
      Sid    = "AllowVpcParentForChildResourceCreation"
      Effect = "Allow"
      Action = [
        "ec2:CreateSubnet",
        "ec2:CreateRouteTable",
        "ec2:CreateSecurityGroup",
      ]
      Resource = "arn:aws:ec2:${var.aws_region}:${var.aws_account_id}:vpc/*"
      Condition = {
        StringEquals = {
          "aws:ResourceTag/Project" = "EnvScale"
          "aws:ResourceTag/Layer"   = "DisposableRuntime"
        }
      }
    },
    {
      Sid    = "AllowRunInstancesTaggedInstanceAndVolume"
      Effect = "Allow"
      Action = ["ec2:RunInstances"]
      Resource = [
        "arn:aws:ec2:${var.aws_region}:${var.aws_account_id}:instance/*",
        "arn:aws:ec2:${var.aws_region}:${var.aws_account_id}:volume/*",
      ]
      Condition = {
        StringEquals = {
          "aws:RequestTag/Project" = "EnvScale"
          "aws:RequestTag/Layer"   = "DisposableRuntime"
        }
      }
    },
    {
      Sid    = "AllowRunInstancesInEnvScaleSubnetAndSg"
      Effect = "Allow"
      Action = ["ec2:RunInstances"]
      Resource = [
        "arn:aws:ec2:${var.aws_region}:${var.aws_account_id}:subnet/*",
        "arn:aws:ec2:${var.aws_region}:${var.aws_account_id}:security-group/*",
      ]
      Condition = {
        StringEquals = {
          "aws:ResourceTag/Project" = "EnvScale"
          "aws:ResourceTag/Layer"   = "DisposableRuntime"
        }
      }
    },
    {
      Sid      = "AllowRunInstancesTaggedNewEni"
      Effect   = "Allow"
      Action   = ["ec2:RunInstances"]
      Resource = "arn:aws:ec2:${var.aws_region}:${var.aws_account_id}:network-interface/*"
      Condition = {
        StringEquals = {
          "aws:RequestTag/Project" = "EnvScale"
          "aws:RequestTag/Layer"   = "DisposableRuntime"
        }
      }
    },
    {
      Sid      = "AllowRunInstancesTaggedExistingEni"
      Effect   = "Allow"
      Action   = ["ec2:RunInstances"]
      Resource = "arn:aws:ec2:${var.aws_region}:${var.aws_account_id}:network-interface/*"
      Condition = {
        StringEquals = {
          "aws:ResourceTag/Project" = "EnvScale"
          "aws:ResourceTag/Layer"   = "DisposableRuntime"
        }
      }
    },
    {
      Sid    = "AllowRunInstancesApprovedAmiAndSnapshot"
      Effect = "Allow"
      Action = ["ec2:RunInstances"]
      Resource = [
        "arn:aws:ec2:${var.aws_region}::image/*",
        "arn:aws:ec2:${var.aws_region}::snapshot/*",
      ]
      Condition = {
        StringEquals = {
          "ec2:Owner" = var.approved_ami_owner_ids
        }
      }
    },
    {
      Sid    = "AllowTagOnCreateForRuntimeResources"
      Effect = "Allow"
      Action = ["ec2:CreateTags"]
      Resource = concat(local.ec2_runtime_tagged_arns, [
        "arn:aws:ec2:${var.aws_region}:${var.aws_account_id}:security-group-rule/*",
      ])
      Condition = {
        StringEquals = {
          "ec2:CreateAction" = [
            "CreateVpc",
            "CreateSubnet",
            "CreateInternetGateway",
            "CreateRouteTable",
            "CreateSecurityGroup",
            "AuthorizeSecurityGroupIngress",
            "AuthorizeSecurityGroupEgress",
            "CreateVolume",
            "RunInstances",
          ]
          "aws:RequestTag/Project" = "EnvScale"
          "aws:RequestTag/Layer"   = "DisposableRuntime"
        }
      }
    },
    {
      Sid    = "AllowNonDestructiveTaggedRuntimeOperations"
      Effect = "Allow"
      Action = [
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
        "ec2:CreateTags",
        "ec2:DeleteTags",
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
      Sid    = "AllowSecurityGroupRuleSubresourceManagement"
      Effect = "Allow"
      Action = [
        "ec2:AuthorizeSecurityGroupIngress",
        "ec2:AuthorizeSecurityGroupEgress",
        "ec2:RevokeSecurityGroupIngress",
        "ec2:RevokeSecurityGroupEgress",
        "ec2:UpdateSecurityGroupRuleDescriptionsIngress",
        "ec2:UpdateSecurityGroupRuleDescriptionsEgress",
      ]
      Resource = "arn:aws:ec2:${var.aws_region}:${var.aws_account_id}:security-group-rule/*"
      Condition = {
        StringEquals = { "aws:RequestedRegion" = var.aws_region }
      }
    },
    {
      Sid      = "AllowFoundationStaticEipAssociation"
      Effect   = "Allow"
      Action   = ["ec2:AssociateAddress", "ec2:DisassociateAddress"]
      Resource = "arn:aws:ec2:${var.aws_region}:${var.aws_account_id}:elastic-ip/*"
      Condition = {
        StringEquals = {
          "aws:ResourceTag/Project" = "EnvScale"
        }
      }
    },
  ]

  shared_ssm_run_command_statements = [
    {
      Sid      = "AllowSSMSendCommandRunShellDocument"
      Effect   = "Allow"
      Action   = ["ssm:SendCommand"]
      Resource = "arn:aws:ssm:${var.aws_region}::document/AWS-RunShellScript"
    },
    {
      Sid      = "AllowSSMSendCommandDisposableRuntimeInstances"
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
  ]

  shared_governance_tag_deny_statements = [
    {
      Sid      = "DenyDeletingGovernanceOwnershipTags"
      Effect   = "Deny"
      Action   = ["ec2:DeleteTags", "eks:UntagResource"]
      Resource = "*"
      Condition = {
        "ForAnyValue:StringEquals" = {
          "aws:TagKeys" = ["Project", "Layer"]
        }
      }
    },
    {
      Sid      = "DenyMutatingProjectTagValue"
      Effect   = "Deny"
      Action   = ["ec2:CreateTags", "eks:TagResource"]
      Resource = "*"
      Condition = {
        Null = {
          "aws:RequestTag/Project" = "false"
        }
        StringNotEquals = {
          "aws:RequestTag/Project" = "EnvScale"
        }
      }
    },
    {
      Sid      = "DenyMutatingLayerTagValue"
      Effect   = "Deny"
      Action   = ["ec2:CreateTags", "eks:TagResource"]
      Resource = "*"
      Condition = {
        Null = {
          "aws:RequestTag/Layer" = "false"
        }
        StringNotEquals = {
          "aws:RequestTag/Layer" = "DisposableRuntime"
        }
      }
    },
  ]
}

