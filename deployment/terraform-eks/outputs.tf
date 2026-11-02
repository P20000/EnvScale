output "cluster_name" {
  description = "EKS Cluster Name"
  value       = aws_eks_cluster.main.name
}

output "cluster_endpoint" {
  description = "EKS Cluster API Server Endpoint"
  value       = aws_eks_cluster.main.endpoint
}

output "cluster_arn" {
  description = "EKS Cluster ARN"
  value       = aws_eks_cluster.main.arn
}

output "region" {
  description = "AWS Region"
  value       = var.region
}

output "update_kubeconfig_command" {
  description = "Command to configure kubectl for this EKS cluster"
  value       = "aws eks update-kubeconfig --name ${aws_eks_cluster.main.name} --region ${var.region}"
}
