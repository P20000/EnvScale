# ==============================================================================
# EnvScale Persistent Foundation — Non-Secret SSM String Parameters ONLY
# ==============================================================================
# CRITICAL SECURITY INVARIANT:
#   Terraform's `aws_ssm_parameter` provider refreshes `value` with decryption on
#   every `plan`/`apply`, which would record plaintext secrets in `terraform.tfstate`
#   even if `ignore_changes = [value]` or `sensitive = true` were set.
#   Therefore:
#     1. ONLY public / non-secret `String` parameters live in this Terraform file.
#     2. ALL 9 `SecureString` secrets (`/envscale/prod/postgres_password`,
#        `redis_password`, `jwt_access_secret`, `jwt_refresh_secret`,
#        `better_auth_secret`, `kubeconfig_encryption_key`, `duckdns_token`,
#        `google_client_secret`, `github_client_secret`) are created strictly
#        out-of-band via `deployment/bootstrap/seed-parameters.sh`.
# ==============================================================================

locals {
  public_base_url = "https://${var.duckdns_domain}.duckdns.org"

  non_secret_ssm_parameters = {
    postgres_user    = { value = "envscale", description = "Non-secret PostgreSQL 16 role name" }
    postgres_db      = { value = "envscale", description = "Non-secret PostgreSQL 16 database name" }
    duckdns_domain   = { value = var.duckdns_domain, description = "Non-secret DuckDNS subdomain label" }
    better_auth_url  = { value = local.public_base_url, description = "Public HTTPS BetterAuth canonical base URL" }
    cors_origin      = { value = local.public_base_url, description = "Allowed HTTPS CORS origin (wildcards prohibited)" }
    recovery_bucket  = { value = aws_s3_bucket.recovery.bucket, description = "Isolated S3 recovery vault bucket name" }
    aws_region       = { value = var.aws_region, description = "Canonical AWS region for runtime S3/SSM calls" }
    google_client_id = { value = var.google_client_id, description = "Optional non-secret Google OAuth Client ID (DISABLED if unused)" }
    github_client_id = { value = var.github_client_id, description = "Optional non-secret GitHub OAuth Client ID (DISABLED if unused)" }
  }

  required_out_of_band_securestring_names = [
    "${local.ssm_prefix}/postgres_password",
    "${local.ssm_prefix}/redis_password",
    "${local.ssm_prefix}/jwt_access_secret",
    "${local.ssm_prefix}/jwt_refresh_secret",
    "${local.ssm_prefix}/better_auth_secret",
    "${local.ssm_prefix}/kubeconfig_encryption_key",
    "${local.ssm_prefix}/duckdns_token",
    "${local.ssm_prefix}/google_client_secret",
    "${local.ssm_prefix}/github_client_secret",
  ]
}

resource "aws_ssm_parameter" "non_secret" {
  for_each = local.non_secret_ssm_parameters

  name        = "${local.ssm_prefix}/${each.key}"
  description = each.value.description
  type        = "String"
  tier        = "Standard"
  value       = each.value.value

  tags = {
    ParameterClassification = "NonSecretConfiguration"
  }
}

