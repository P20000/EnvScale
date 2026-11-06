# ==============================================================================
# EnvScale Persistent Foundation — Validated Non-Secret Input Variables
# ==============================================================================
# SECURITY INVARIANT:
#   ZERO secret / SecureString variables exist in this module. Production
#   secrets are seeded strictly out-of-band via deployment/bootstrap/seed-parameters.sh.
# ==============================================================================

variable "aws_account_id" {
  description = "Target 12-digit AWS Account ID (locked to 982534376726)."
  type        = string
  default     = "982534376726"

  validation {
    condition     = var.aws_account_id == "982534376726"
    error_message = "aws_account_id must equal EnvScale target account 982534376726."
  }
}

variable "aws_region" {
  description = "Target AWS Region for persistent foundation assets."
  type        = string
  default     = "ap-south-1"

  validation {
    condition     = var.aws_region == "ap-south-1"
    error_message = "aws_region must equal ap-south-1."
  }
}

variable "environment" {
  description = "Canonical deployment environment identifier."
  type        = string
  default     = "production"

  validation {
    condition     = contains(["production"], var.environment)
    error_message = "environment must be 'production'."
  }
}

variable "github_repository" {
  description = "GitHub owner/repository permitted by OIDC trust policies."
  type        = string
  default     = "P20000/EnvScale"

  validation {
    condition     = can(regex("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", var.github_repository))
    error_message = "github_repository must follow '<owner>/<repo>' format."
  }
}

variable "release_branch" {
  description = "Git branch permitted to assume envscale-github-release-role."
  type        = string
  default     = "develop"

  validation {
    condition     = var.release_branch == "develop"
    error_message = "release_branch must equal 'develop' per repository governance."
  }
}

variable "production_environment_name" {
  description = "GitHub Environment name scoped to envscale-github-deploy-role."
  type        = string
  default     = "production"

  validation {
    condition     = can(regex("^[a-z0-9_-]+$", var.production_environment_name))
    error_message = "production_environment_name must match ^[a-z0-9_-]+$."
  }
}

variable "recovery_environment_name" {
  description = "GitHub Environment name scoped to envscale-github-recovery-role."
  type        = string
  default     = "recovery"

  validation {
    condition     = can(regex("^[a-z0-9_-]+$", var.recovery_environment_name)) && var.recovery_environment_name != "production"
    error_message = "recovery_environment_name must match ^[a-z0-9_-]+$ and differ from 'production'."
  }
}

variable "create_oidc_provider" {
  description = "Whether to create token.actions.githubusercontent.com OIDC provider (false when pre-existing in account)."
  type        = bool
  default     = false
}

variable "github_oidc_thumbprints" {
  description = "GitHub Actions OIDC root CA SHA-1 thumbprints (used only when create_oidc_provider = true)."
  type        = list(string)
  default = [
    "6938fd4d98bab03faadb97b34396831e3780aea1",
    "1c58a3a8518e8759bf075b76b750d4f2df264fcd",
  ]

  validation {
    condition     = length(var.github_oidc_thumbprints) > 0 && alltrue([for t in var.github_oidc_thumbprints : can(regex("^[0-9a-f]{40}$", t))])
    error_message = "Every github_oidc_thumbprints entry must be a 40-char lowercase hex SHA-1 digest."
  }
}

variable "retain_static_eip" {
  description = "Opt-in persistent Elastic IP ($0/hr default when false; ~$3.65/mo idle convenience fee when true)."
  type        = bool
  default     = false
}

variable "duckdns_domain" {
  description = "Non-secret DuckDNS subdomain label (e.g. 'envscale' -> https://envscale.duckdns.org)."
  type        = string
  default     = "envscale"

  validation {
    condition     = can(regex("^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$", var.duckdns_domain))
    error_message = "duckdns_domain must be a valid lowercase RFC-1123 DNS label."
  }
}

variable "google_client_id" {
  description = "Non-secret Google OAuth Client ID (set to 'DISABLED' when Google OAuth is unused)."
  type        = string
  default     = "DISABLED"

  validation {
    condition     = length(trimspace(var.google_client_id)) > 0
    error_message = "google_client_id must be non-empty ('DISABLED' when unused)."
  }
}

variable "github_client_id" {
  description = "Non-secret GitHub OAuth Client ID (set to 'DISABLED' when GitHub OAuth is unused)."
  type        = string
  default     = "DISABLED"

  validation {
    condition     = length(trimspace(var.github_client_id)) > 0
    error_message = "github_client_id must be non-empty ('DISABLED' when unused)."
  }
}

variable "approved_ami_owner_ids" {
  description = "Approved AWS account IDs whose EBS-backed AMIs may be launched by disposable runtime roles (Canonical Ubuntu = 099720109477)."
  type        = list(string)
  default     = ["099720109477"]

  validation {
    condition     = length(var.approved_ami_owner_ids) > 0 && alltrue([for id in var.approved_ami_owner_ids : can(regex("^[0-9]{12}$", id))])
    error_message = "approved_ami_owner_ids must contain 12-digit AWS account IDs."
  }
}

variable "create_foundation_admin_role" {
  description = "Provision dedicated MFA-enforced envscale-foundation-admin-role for out-of-band human administration."
  type        = bool
  default     = true
}

variable "foundation_admin_trusted_principal_arns" {
  description = "Same-account human IAM user principal ARNs permitted to assume envscale-foundation-admin-role WITH MFA (account root, OIDC, and automated roles strictly forbidden)."
  type        = list(string)
  default     = ["arn:aws:iam::982534376726:user/DEV-user-alpha"]

  validation {
    condition = (
      length(var.foundation_admin_trusted_principal_arns) > 0 &&
      alltrue([
        for arn in var.foundation_admin_trusted_principal_arns :
        can(regex("^arn:aws:iam::982534376726:user/[A-Za-z0-9+=,.@_-]+$", arn)) &&
        !endswith(arn, ":root")
      ])
    )
    error_message = "foundation_admin_trusted_principal_arns must contain only specific account 982534376726 IAM user ARNs (account root, OIDC, and automated roles are strictly forbidden)."
  }
}

