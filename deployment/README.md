# EnvScale AWS Low-Cost Deployment Guide

This directory contains the production Docker packaging and modular Terraform configurations to deploy the full **EnvScale** stack (Frontend + Backend + Streaming Gateway + Postgres + Redis + CNCF K3s Kubernetes) on AWS using **minimal AWS credits**.

---

## 1. Directory Structure

```text
deployment/
├── terraform/
│   ├── versions.tf              # Terraform & AWS provider requirements (~> 5.40)
│   ├── variables.tf             # Configurable input variables (region, instance type, volume)
│   ├── network.tf               # Free VPC + Internet Gateway + Public Subnet (No NAT Gateway)
│   ├── security_group.tf        # Ingress (22, 80, 443, 3000, 3001, 8080) & Egress rules
│   ├── compute.tf               # Ubuntu 22.04 LTS EC2 + Auto SSH Keypair + gp3 EBS
│   ├── user_data.sh.tpl         # Cloud-init script: installs Docker, K3s, Caddy, Node.js, pnpm
│   ├── outputs.tf               # Elastic IP, SSH command, and application URLs
│   └── terraform.tfvars.example # Sample variable overrides
├── docker-compose.prod.yml       # Production Compose orchestrating all 5 services
├── deploy.sh                    # Host runner to verify AWS CLI and apply Terraform
└── start_remote.sh              # Remote runner to spin up the containerized stack on EC2
```

---

## 2. Prerequisites

1. **AWS CLI:** Configure credentials with your AWS Academy/Credit account:
   ```bash
   aws configure
   # or export AWS_ACCESS_KEY_ID="..." AWS_SECRET_ACCESS_KEY="..." AWS_SESSION_TOKEN="..."
   ```
2. **Terraform CLI:** (Already installed on your system: `/usr/bin/terraform`).

---

## 3. How to Deploy (Step-by-Step)

### Step 1: Execute the Deployment Script
From the repository root:
```bash
./deployment/deploy.sh
```
This script will:
- Authenticate using your active AWS CLI profile/credentials.
- Initialize Terraform.
- Automatically generate a local SSH key pair (`deployment/terraform/envscale_key.pem`).
- Provision the cost-optimized VPC, Security Group, and EC2 instance (`t3a.large` with 8 GB RAM, ~$0.06/hr).
- Output the public IP, SSH command, and Web/API/WebSocket URLs.

### Step 2: SSH into the Provisioned EC2 Instance
```bash
cd deployment/terraform
ssh -i envscale_key.pem ubuntu@<EC2_PUBLIC_IP>
```

### Step 3: Run the Application Stack
Once logged into the EC2 instance:
```bash
git clone https://github.com/<your-username>/EnvScale.git
cd EnvScale
./deployment/start_remote.sh
```

---

## 4. Why This Architecture Burns Minimal Credits

- **Zero NAT Gateway Fees:** Saves ~$35 - $65/month by using an Internet Gateway.
- **Zero Managed EKS Fees:** Runs CNCF K3s on-node, avoiding the $73/month flat AWS EKS control plane fee.
- **Zero Managed RDS/ElastiCache Fees:** Postgres 16 and Redis 7 run directly in Docker on the instance.
- **Can Be Stopped When Idle:** You can stop the EC2 instance anytime via AWS Console when not presenting or testing. The compute cost drops to $0.00 while paused!
