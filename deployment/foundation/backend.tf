# ==============================================================================
# EnvScale Persistent Foundation — Native S3 Backend (Zero DynamoDB)
# ==============================================================================
# Initialized via:
#   terraform init -backend-config=backend.hcl
# where backend.hcl is generated out-of-band by deployment/bootstrap/bootstrap-state.sh.
# Native S3 `.tflock` state locking (`use_lockfile = true`, Terraform 1.14.9) is
# enforced directly in HCL so DynamoDB state locking is never used.
# ==============================================================================

terraform {
  backend "s3" {
    key          = "foundation/terraform.tfstate"
    encrypt      = true
    use_lockfile = true
  }
}

