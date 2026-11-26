# ==============================================================================
# EnvScale Persistent Foundation — Shared Tag-Scoped IAM Statement Locals
# ==============================================================================
# Modular IAM layout (< 500 lines per file):
#   - iam_locals.tf              : Shared ARNs, native S3 .tflock statements,
#                                  tag-enforced EC2 provisioning, AMI/snapshot
#                                  RunInstances scoping, & governance tag Denies
#   - iam.tf                     : Principal 1 (EC2 Runtime) + Principal 2 (GitHub Release)
#   - iam_cicd.tf                : Principal 3 (GitHub Deploy) + Principal 4 (GitHub Recovery)
#   - iam_admin.tf               : Principal 5 (MFA-enforced Human Break-Glass Admin Role)
#   - iam_foundation.tf          : Principal 6 (GitHub OIDC Automated Foundation Provisioner)
#   - iam_foundation_plan.tf     : Principal 7 (Read-Only GitHub OIDC Foundation Plan Role)
#   - iam_runtime_provisioner.tf : Principal 8 (MFA-enforced Runtime Provisioner)
# ZERO DynamoDB actions or resources exist anywhere in this module.
# ==============================================================================

locals {
  tfstate_bucket_arn      = "arn:aws:s3:::${local.tfstate_bucket_name}"
  legacy_vault_bucket_arn = "arn:aws:s3:::${local.legacy_vault_bucket_name}"
  recovery_bucket_arn     = "arn:aws:s3:::${local.recovery_bucket_name}"
  ssm_prod_param_arn      = "arn:aws:ssm:${var.aws_region}:${var.aws_account_id}:parameter${local.ssm_prefix}/*"
  ssm_all_param_arn       = "arn:aws:ssm:${var.aws_region}:${var.aws_account_id}:parameter/*"

  ssm_non_secret_param_arns = [
    for k in [
      "aws_region", "better_auth_url", "cors_origin", "duckdns_domain",
      "github_client_id", "google_client_id", "postgres_db", "postgres_user", "recovery_bucket",
    ] : "arn:aws:ssm:${var.aws_region}:${var.aws_account_id}:parameter${local.ssm_prefix}/${k}"
  ]

  ssm_securestring_param_arns = [
    for k in [
      "postgres_password", "redis_password", "jwt_access_secret", "jwt_refresh_secret",
      "better_auth_secret", "kubeconfig_encryption_key", "duckdns_token",
      "google_client_secret", "github_client_secret",
    ] : "arn:aws:ssm:${var.aws_region}:${var.aws_account_id}:parameter${local.ssm_prefix}/${k}"
  ]

  ec2_runtime_role_arn                    = "arn:aws:iam::${var.aws_account_id}:role/envscale-ec2-runtime-role"
  ec2_runtime_profile_arn                 = "arn:aws:iam::${var.aws_account_id}:instance-profile/envscale-ec2-runtime-profile"
  runtime_provisioner_role_arn            = "arn:aws:iam::${var.aws_account_id}:role/envscale-runtime-provisioner-role"
  workload_boundary_policy_arn            = "arn:aws:iam::${var.aws_account_id}:policy/envscale-workload-permissions-boundary"
  runtime_provisioner_boundary_policy_arn = "arn:aws:iam::${var.aws_account_id}:policy/envscale-runtime-provisioner-permissions-boundary"
  ssm_managed_core_policy_arn             = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
  workload_managed_role_arns = [
    "arn:aws:iam::${var.aws_account_id}:role/envscale-ec2-runtime-role",
    "arn:aws:iam::${var.aws_account_id}:role/envscale-github-release-role",
    "arn:aws:iam::${var.aws_account_id}:role/envscale-github-deploy-role",
    "arn:aws:iam::${var.aws_account_id}:role/envscale-github-recovery-role",
  ]
  foundation_protected_role_arns = [
    "arn:aws:iam::${var.aws_account_id}:role/envscale-github-foundation-role",
    "arn:aws:iam::${var.aws_account_id}:role/envscale-github-foundation-plan-role",
    "arn:aws:iam::${var.aws_account_id}:role/envscale-foundation-admin-role",
  ]
  foundation_enumerated_iam_read_arns = concat(
    local.workload_managed_role_arns,
    local.foundation_protected_role_arns,
    [
      local.runtime_provisioner_role_arn,
      local.ec2_runtime_profile_arn,
      local.github_oidc_provider_arn,
      local.workload_boundary_policy_arn,
      local.runtime_provisioner_boundary_policy_arn,
    ]
  )

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

  # Exact Ingress/Egress pair globs (bounded further by workload_permissions_boundary explicit actions)
  ec2_sg_rule_pair_actions = [
    "ec2:AuthorizeSecurityGroup*",
    "ec2:RevokeSecurityGroup*",
    "ec2:UpdateSecurityGroupRuleDescriptions*",
  ]

  ec2_nondestructive_runtime_actions = concat(
    [
      "ec2:ModifyVpcAttribute",
      "ec2:ModifySubnetAttribute",
      "ec2:AttachInternetGateway",
      "ec2:CreateRoute",
      "ec2:ReplaceRoute",
      "ec2:AssociateRouteTable",
    ],
    local.ec2_sg_rule_pair_actions,
    [
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
      "ssm:SendCommand",
    ]
  )

  ec2_destructive_runtime_actions = [
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

  shared_cicd_tfstate_statements = [
    {
      Sid      = "TfLs"
      Effect   = "Allow"
      Action   = "s3:ListBucket"
      Resource = local.tfstate_bucket_arn
      Condition = {
        StringLike = {
          "s3:prefix" = ["runtime/*", "eks/*", "foundation/terraform.tfstate"]
        }
      }
    },
    {
      Sid    = "RtSt"
      Effect = "Allow"
      Action = ["s3:GetObject", "s3:PutObject"]
      Resource = [
        "${local.tfstate_bucket_arn}/runtime/terraform.tfstate",
        "${local.tfstate_bucket_arn}/eks/terraform.tfstate",
        "${local.tfstate_bucket_arn}/runtime/terraform.tfstate.tflock",
        "${local.tfstate_bucket_arn}/eks/terraform.tfstate.tflock",
      ]
    },
    {
      Sid    = "LkDl"
      Effect = "Allow"
      Action = "s3:DeleteObject"
      Resource = [
        "${local.tfstate_bucket_arn}/runtime/terraform.tfstate.tflock",
        "${local.tfstate_bucket_arn}/eks/terraform.tfstate.tflock",
        "${local.recovery_bucket_arn}/lifecycle/active-op.lock",
      ]
    },
  ]

  shared_ec2_runtime_provisioning_statements = [
    {
      Sid    = "CrCh"
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
      Sid      = "VpcP"
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
      Sid    = "RnDp"
      Effect = "Allow"
      Action = "ec2:RunInstances"
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
      Sid    = "RnAm"
      Effect = "Allow"
      Action = "ec2:RunInstances"
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
      Sid    = "TgCr"
      Effect = "Allow"
      Action = "ec2:CreateTags"
      Resource = concat(local.ec2_runtime_tagged_arns, [
        "arn:aws:ec2:${var.aws_region}:${var.aws_account_id}:security-group-rule/*",
      ])
      Condition = {
        StringEquals = {
          "ec2:CreateAction" = [
            "CreateVpc", "CreateSubnet", "CreateInternetGateway", "CreateRouteTable",
            "CreateSecurityGroup", "AuthorizeSecurityGroupIngress", "AuthorizeSecurityGroupEgress",
            "CreateVolume", "RunInstances",
          ]
          "aws:RequestTag/Project" = "EnvScale"
          "aws:RequestTag/Layer"   = "DisposableRuntime"
        }
      }
    },
    {
      Sid      = "SgRl"
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
      Sid      = "StEp"
      Effect   = "Allow"
      Action   = ["ec2:AssociateAddress", "ec2:DisassociateAddress"]
      Resource = "arn:aws:ec2:${var.aws_region}:${var.aws_account_id}:elastic-ip/*"
      Condition = {
        StringEquals = { "aws:ResourceTag/Project" = "EnvScale" }
      }
    },
    {
      Sid      = "SsDc"
      Effect   = "Allow"
      Action   = "ssm:SendCommand"
      Resource = "arn:aws:ssm:${var.aws_region}::document/AWS-RunShellScript"
    },
  ]

  shared_governance_tag_deny_statements = [
    {
      Sid      = "DnTg"
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
      Sid      = "DnPr"
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
      Sid      = "DnLy"
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
