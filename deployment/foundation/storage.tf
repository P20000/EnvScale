# ==============================================================================
# EnvScale Persistent Foundation — Isolated Disaster Recovery S3 Vault
# ==============================================================================
# Bucket: envscale-recovery-982534376726-ap-south-1
# Strictly isolated from Terraform state (`envscale-tfstate-*`) and from the
# untouched legacy bucket (`envscale-cloud-vault-*`).
# Prefix layout:
#   - backups/postgres/*    : Automated & pre-destroy PostgreSQL 16 dumps + latest-valid.json
#   - backups/historical/*  : Phase 1/3 verified historical SQL & converted .dump archive
#   - releases/*            : Immutable digest-pinned release manifests & pointers
#   - lifecycle/*           : Operational state.json, alerts, & active-op.lock
#
# Cost & Encryption Note (Profile A < $0.10/mo Idle Budget):
#   Uses SSE-S3 (`AES256`) rather than a $1.00/month Customer-Managed KMS Key
#   (CMK); S3 Bucket Keys are omitted because they apply only to SSE-KMS, not
#   SSE-S3. Self-referential access log amplification is avoided while S3
#   Versioning + Bucket Policy explicit Denies prevent silent deletion.
# ==============================================================================

# trivy:ignore:AVD-AWS-0089 -- Self-referential access logging omitted on <1GB Profile A vault to avoid infinite object churn; S3 Versioning + DenyObjectDeletion enforce audit retention.
resource "aws_s3_bucket" "recovery" {
  bucket        = local.recovery_bucket_name
  force_destroy = false

  lifecycle {
    prevent_destroy = true
  }

  tags = {
    Name    = local.recovery_bucket_name
    Purpose = "DisasterRecoveryAndReleaseVault"
  }
}

resource "aws_s3_bucket_ownership_controls" "recovery" {
  bucket = aws_s3_bucket.recovery.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_public_access_block" "recovery" {
  bucket = aws_s3_bucket.recovery.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "recovery" {
  bucket = aws_s3_bucket.recovery.id

  versioning_configuration {
    status = "Enabled"
  }
}

# trivy:ignore:AVD-AWS-0132 -- Profile A mandates $0 SSE-S3 (AES256) to maintain <$0.10/mo idle cost; $1/mo KMS CMK is reserved for Profile B (enterprise-ha).
resource "aws_s3_bucket_server_side_encryption_configuration" "recovery" {
  bucket = aws_s3_bucket.recovery.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "recovery" {
  bucket = aws_s3_bucket.recovery.id

  depends_on = [aws_s3_bucket_versioning.recovery]

  rule {
    id     = "abort-incomplete-multipart-uploads"
    status = "Enabled"

    filter {
      prefix = ""
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

data "aws_iam_policy_document" "recovery_bucket_policy" {
  statement {
    sid     = "DenyInsecureTransport"
    effect  = "Deny"
    actions = ["s3:*"]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    resources = [
      aws_s3_bucket.recovery.arn,
      "${aws_s3_bucket.recovery.arn}/*",
    ]

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }

  statement {
    sid     = "DenyForeignAccountPrincipals"
    effect  = "Deny"
    actions = ["s3:*"]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    resources = [
      aws_s3_bucket.recovery.arn,
      "${aws_s3_bucket.recovery.arn}/*",
    ]

    condition {
      test     = "Null"
      variable = "aws:PrincipalAccount"
      values   = ["false"]
    }

    condition {
      test     = "StringNotEquals"
      variable = "aws:PrincipalAccount"
      values   = [var.aws_account_id]
    }
  }

  statement {
    sid    = "DenyBucketAndObjectVersionDestruction"
    effect = "Deny"
    actions = [
      "s3:DeleteBucket",
      "s3:DeleteObjectVersion",
      "s3:DeleteBucketPolicy",
    ]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    resources = [
      aws_s3_bucket.recovery.arn,
      "${aws_s3_bucket.recovery.arn}/*",
    ]
  }

  statement {
    sid     = "DenyUnauthorizedBucketPolicyMutation"
    effect  = "Deny"
    actions = ["s3:PutBucketPolicy"]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    resources = [
      aws_s3_bucket.recovery.arn,
      "${aws_s3_bucket.recovery.arn}/*",
    ]

    condition {
      test     = "ArnNotLike"
      variable = "aws:PrincipalArn"
      values = [
        "arn:aws:sts::${var.aws_account_id}:assumed-role/envscale-github-foundation-role/*",
        "arn:aws:iam::${var.aws_account_id}:role/envscale-github-foundation-role",
        "arn:aws:sts::${var.aws_account_id}:assumed-role/envscale-foundation-admin-role/*",
        "arn:aws:iam::${var.aws_account_id}:role/envscale-foundation-admin-role",
      ]
    }
  }

  statement {
    sid     = "DenyBackupAndReleaseObjectDeletion"
    effect  = "Deny"
    actions = ["s3:DeleteObject"]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    resources = [
      "${aws_s3_bucket.recovery.arn}/backups/*",
      "${aws_s3_bucket.recovery.arn}/releases/*",
    ]
  }
}

resource "aws_s3_bucket_policy" "recovery" {
  bucket = aws_s3_bucket.recovery.id
  policy = data.aws_iam_policy_document.recovery_bucket_policy.json

  depends_on = [
    aws_s3_bucket_public_access_block.recovery,
    aws_s3_bucket_ownership_controls.recovery,
  ]
}

