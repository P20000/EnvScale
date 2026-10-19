variable "aws_region" {
  description = "AWS Region to deploy resources into"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Environment identifier"
  type        = string
  default     = "demo"
}

variable "instance_type" {
  description = "EC2 instance size (t3a.large or t4g.large recommended for 8GB RAM at lowest cost)"
  type        = string
  default     = "t3a.large"
}

variable "volume_size_gb" {
  description = "Root gp3 volume size in GB"
  type        = number
  default     = 30
}

variable "allowed_ssh_cidr" {
  description = "CIDR block permitted to SSH into the instance (use your public IP /32 for security, e.g. 103.21.24.5/32, or 0.0.0.0/0)"
  type        = string
  default     = "0.0.0.0/0"
}

variable "domain_or_duckdns" {
  description = "Domain name or DuckDNS subdomain (e.g. envscale.duckdns.org or left empty to use EC2 public IP)"
  type        = string
  default     = "envscale.duckdns.org"
}

variable "acme_email" {
  description = "Email address for automatic Let's Encrypt SSL certificates (if using domain)"
  type        = string
  default     = "admin@example.com"
}
