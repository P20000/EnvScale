# ==============================================================================
# EnvScale Persistent Foundation — Non-Sensitive Module Outputs
# ==============================================================================
# Consumed read-only by `deployment/runtime` via `terraform_remote_state` and by
# GitHub Actions workflows for preflight contract checks. Zero secret values.
# ==============================================================================

output "aws_account_id" {
  description = "Locked target AWS Account ID."
  value       = var.aws_account_id
}

output "aws_region" {
  description = "Locked target AWS Region."
  value       = var.aws_region
}

output "tfstate_bucket_name" {
  description = "Isolated S3 bucket storing Terraform .tfstate and native .tflock files."
  value       = local.tfstate_bucket_name
}

output "recovery_bucket_name" {
  description = "Isolated S3 disaster-recovery & release-manifest bucket name."
  value       = aws_s3_bucket.recovery.bucket
}

output "recovery_bucket_arn" {
  description = "ARN of the isolated S3 disaster-recovery & release-manifest bucket."
  value       = aws_s3_bucket.recovery.arn
}

output "github_oidc_provider_arn" {
  description = "ARN of the GitHub Actions OIDC identity provider."
  value       = local.github_oidc_provider_arn
}

output "ec2_runtime_role_name" {
  description = "IAM role name attached to disposable runtime EC2 hosts."
  value       = aws_iam_role.ec2_runtime.name
}

output "ec2_runtime_role_arn" {
  description = "IAM role ARN attached to disposable runtime EC2 hosts."
  value       = aws_iam_role.ec2_runtime.arn
}

output "ec2_runtime_instance_profile_name" {
  description = "IAM Instance Profile name attached to disposable runtime EC2 hosts."
  value       = aws_iam_instance_profile.ec2_runtime.name
}

output "ec2_runtime_instance_profile_arn" {
  description = "IAM Instance Profile ARN attached to disposable runtime EC2 hosts."
  value       = aws_iam_instance_profile.ec2_runtime.arn
}

output "github_release_role_arn" {
  description = "IAM role ARN for immutable release manifest publishing (develop branch)."
  value       = aws_iam_role.github_release.arn
}

output "github_deploy_role_arn" {
  description = "IAM role ARN for non-destructive provisioning, deploy, and rollback (production env)."
  value       = aws_iam_role.github_deploy.arn
}

output "github_recovery_role_arn" {
  description = "IAM role ARN for gated destruction and full disaster recovery rebuilds (recovery env)."
  value       = aws_iam_role.github_recovery.arn
}

output "github_foundation_role_arn" {
  description = "IAM role ARN for automated GitHub Actions OIDC foundation apply (protected foundation env)."
  value       = aws_iam_role.github_foundation.arn
}

output "github_foundation_plan_role_arn" {
  description = "Read-only IAM role ARN for automated GitHub Actions OIDC foundation plan generation (foundation-plan env)."
  value       = aws_iam_role.github_foundation_plan.arn
}

output "workload_permissions_boundary_arn" {
  description = "IAM Permissions Boundary policy ARN attached to workload and runtime CI/CD roles."
  value       = aws_iam_policy.workload_permissions_boundary.arn
}

output "foundation_admin_role_name" {
  description = "Dedicated MFA-enforced human break-glass IAM role name for out-of-band SSM seeding and historical archive upload."
  value       = var.create_foundation_admin_role ? aws_iam_role.foundation_admin[0].name : null
}

output "foundation_admin_role_arn" {
  description = "Dedicated MFA-enforced human break-glass IAM role ARN for out-of-band SSM seeding and historical archive upload."
  value       = var.create_foundation_admin_role ? aws_iam_role.foundation_admin[0].arn : null
}

output "retain_static_eip" {
  description = "Whether an opt-in persistent Elastic IP is provisioned in foundation."
  value       = var.retain_static_eip
}

output "static_eip_allocation_id" {
  description = "Allocation ID of the opt-in persistent Elastic IP (null when retain_static_eip = false)."
  value       = var.retain_static_eip ? aws_eip.static_runtime[0].allocation_id : null
}

output "static_eip_public_ip" {
  description = "Public IPv4 of the opt-in persistent Elastic IP (null when retain_static_eip = false)."
  value       = var.retain_static_eip ? aws_eip.static_runtime[0].public_ip : null
}

output "ssm_parameter_prefix" {
  description = "SSM Parameter Store hierarchy prefix for runtime configuration & secrets."
  value       = local.ssm_prefix
}

output "managed_non_secret_ssm_parameters" {
  description = "Sorted list of non-secret SSM String parameter names managed by Terraform."
  value       = sort([for p in aws_ssm_parameter.non_secret : p.name])
}

output "required_out_of_band_securestring_parameters" {
  description = "Names (ONLY names, zero values) of SecureString parameters seeded out-of-band by seed-parameters.sh."
  value       = local.required_out_of_band_securestring_names
}

