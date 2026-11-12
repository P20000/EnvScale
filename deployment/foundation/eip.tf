# ==============================================================================
# EnvScale Persistent Foundation — Opt-In Static Elastic IP
# ==============================================================================
# Default (`retain_static_eip = false`):
#   Zero Elastic IP is allocated ($0.00/hr idle cost). Disposable runtime EC2
#   instances use their ephemeral public IPv4 and update DuckDNS on boot.
# Opt-in (`retain_static_eip = true`):
#   Allocates a persistent EIP (~$3.65/mo while unassociated) attached by
#   `deployment/runtime` via `aws_eip_association` and protected from release
#   by explicit IAM Deny (`ec2:ReleaseAddress`) on deploy & recovery roles.
# ==============================================================================

resource "aws_eip" "static_runtime" {
  count  = var.retain_static_eip ? 1 : 0
  domain = "vpc"

  lifecycle {
    prevent_destroy = true
  }

  tags = {
    Name    = "envscale-prod-static-eip"
    Purpose = "OptionalPersistentRuntimeIngress"
  }
}

