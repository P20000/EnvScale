output "instance_id" {
  description = "EC2 Instance ID"
  value       = aws_instance.envscale_host.id
}

output "public_ip" {
  description = "EC2 Elastic Public IP"
  value       = aws_eip.envscale_eip.public_ip
}

output "ssm_session_command" {
  description = "Command to start an AWS SSM Session on the provisioned host (zero SSH)"
  value       = "aws ssm start-session --target ${aws_instance.envscale_host.id}"
}

output "iam_instance_profile" {
  description = "IAM Instance Profile attached to the EC2 runtime host"
  value       = aws_instance.envscale_host.iam_instance_profile
}

output "app_url" {
  description = "EnvScale Web Application URL"
  value       = var.domain_or_duckdns != "" ? "https://${var.domain_or_duckdns}" : "http://${aws_eip.envscale_eip.public_ip}"
}

output "api_url" {
  description = "EnvScale API Server URL"
  value       = var.domain_or_duckdns != "" ? "https://${var.domain_or_duckdns}/api" : "http://${aws_eip.envscale_eip.public_ip}/api"
}

output "ws_url" {
  description = "EnvScale WebSocket URL"
  value       = var.domain_or_duckdns != "" ? "wss://${var.domain_or_duckdns}/ws/k8s" : "ws://${aws_eip.envscale_eip.public_ip}:8080/ws/k8s"
}
