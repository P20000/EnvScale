variable "region" {
  description = "AWS region to deploy EKS cluster"
  type        = string
  default     = "ap-south-1"
}

variable "cluster_name" {
  description = "Name of the target EKS cluster"
  type        = string
  default     = "envscale-todo-eks"
}

variable "kubernetes_version" {
  description = "Kubernetes control plane version"
  type        = string
  default     = "1.32"
}

variable "node_instance_types" {
  description = "EC2 instance types for the worker nodegroup"
  type        = list(string)
  default     = ["t3.medium"]
}

variable "capacity_type" {
  description = "Capacity type for worker nodes (SPOT or ON_DEMAND)"
  type        = string
  default     = "SPOT"
}
