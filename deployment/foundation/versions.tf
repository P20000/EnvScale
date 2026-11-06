# ==============================================================================
# EnvScale Persistent Foundation — Provider & Terraform Version Constraints
# ==============================================================================

terraform {
  required_version = "~> 1.14.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.40"
    }
  }
}

provider "aws" {
  region              = var.aws_region
  allowed_account_ids = [var.aws_account_id]

  default_tags {
    tags = {
      Project     = "EnvScale"
      Environment = var.environment
      Layer       = "PersistentFoundation"
      ManagedBy   = "Terraform"
      Module      = "deployment/foundation"
    }
  }
}

locals {
  tfstate_bucket_name      = "envscale-tfstate-${var.aws_account_id}-${var.aws_region}"
  recovery_bucket_name     = "envscale-recovery-${var.aws_account_id}-${var.aws_region}"
  legacy_vault_bucket_name = "envscale-cloud-vault-${var.aws_account_id}-${var.aws_region}"
  ssm_prefix               = "/envscale/prod"
}

