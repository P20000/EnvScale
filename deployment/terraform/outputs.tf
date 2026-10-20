output "instance_id" {
  description = "EC2 Instance ID"
  value       = aws_instance.envscale_host.id
}

output "public_ip" {
  description = "EC2 Elastic Public IP"
  value       = aws_eip.envscale_eip.public_ip
}

output "ssh_connection_command" {
  description = "Command to SSH into the provisioned host"
  value       = "ssh -i envscale_key.pem ubuntu@${aws_eip.envscale_eip.public_ip}"
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
