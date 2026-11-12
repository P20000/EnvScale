# ==============================================================================
# EnvScale Persistent Foundation — GitHub Actions OIDC Identity Provider
# ==============================================================================
# Account 982534376726 already has `token.actions.githubusercontent.com`
# provisioned (`var.create_oidc_provider = false` by default). Setting
# `var.create_oidc_provider = true` allows clean bootstrap in a greenfield DR
# account without code edits.
# ==============================================================================

data "aws_iam_openid_connect_provider" "github" {
  count = var.create_oidc_provider ? 0 : 1
  url   = "https://token.actions.githubusercontent.com"
}

resource "aws_iam_openid_connect_provider" "github" {
  count = var.create_oidc_provider ? 1 : 0

  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = var.github_oidc_thumbprints

  tags = {
    Name    = "envscale-github-actions-oidc"
    Purpose = "GitHubActionsOIDCFederation"
  }
}

locals {
  github_oidc_provider_arn = (
    var.create_oidc_provider
    ? aws_iam_openid_connect_provider.github[0].arn
    : data.aws_iam_openid_connect_provider.github[0].arn
  )
}

