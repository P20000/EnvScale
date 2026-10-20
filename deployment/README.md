# EnvScale Production Deployment Guide (Relmonition Pattern)

This directory contains the production Docker packaging, CI/CD orchestration, and modular Terraform configurations to deploy the full **EnvScale** stack (Frontend + Backend + Streaming Gateway + Postgres + Redis + CNCF K3s Kubernetes) on AWS using a decoupled, cost-optimized pattern inspired by **Relmonition**.

---

## 1. Architectural Philosophy: Decoupled Deployments

In traditional throwaway setups, infrastructure is destroyed and recreated on every deploy or test session, which causes IP changes, DNS/SSL breakage, and slow 15-minute rebuilds. 

EnvScale decouples **Infrastructure Lifecycle** from **Application Deployment**:

1. **Infrastructure (EC2 + VPC + EIP):** Provisioned once via Terraform. When testing is paused, the EC2 instance is **stopped** (`./envscale.sh infra stop`), dropping compute charges to **$0.00/hour** while preserving the static Elastic IP, database records, and cached images for ~8¢/day (EBS storage).
2. **CI/CD Pipeline (`cd.yml`):** Automatically builds Docker images on GitHub Actions runners, pushes to GitHub Container Registry (`ghcr.io`), and executes `./envscale.sh deploy` over SSH. The EC2 instance merely pulls pre-built images in ~15 seconds instead of compiling from source.

---

## 2. Quick Command Reference

All deployment and infrastructure commands are accessible via `./envscale.sh`:

```bash
# Application Deployment (Invoked by GitHub Actions CD or manually)
./envscale.sh deploy         # Pulls pre-built GHCR images, updates .env/Caddy, & runs migrations

# Infrastructure Lifecycle Management
./envscale.sh infra up       # Provisions EC2 via Terraform & auto-syncs secrets to GitHub Actions
./envscale.sh infra stop     # Pauses EC2 instance (Compute: $0.00/hr, preserves state)
./envscale.sh infra start    # Resumes EC2 instance in ~20s & syncs GitHub secrets
./envscale.sh infra destroy  # Archives Postgres dump to S3 vault and destroys AWS resources

# Diagnostics & Monitoring
./envscale.sh status         # Checks container statuses and health on EC2
./envscale.sh logs [service] # Tails container logs (e.g. ./envscale.sh logs api-server)
./envscale.sh ssh            # Opens direct SSH terminal into the EC2 instance
```

---

## 3. GitHub Actions CI/CD Pipeline

The `.github/workflows/cd.yml` workflow triggers automatically on pushes to `develop` (ignoring changes to `deployment/terraform/**` or markdown files):

1. **Build & Push Job:**
   - Multi-stage Docker Buildx runs on GitHub's 4-core runner.
   - Images are tagged and pushed to GitHub Container Registry:
     - `ghcr.io/p20000/envscale-api-server:latest`
     - `ghcr.io/p20000/envscale-k8s-streamer:latest`
     - `ghcr.io/p20000/envscale-web:latest`
2. **Deploy Job:**
   - SSHes into `secrets.EC2_HOST` using `secrets.SSH_PRIVATE_KEY`.
   - Injects production secrets (`DUCKDNS_TOKEN`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, etc.).
   - Executes `./envscale.sh deploy` on the host.
   - Total deployment time: **< 45 seconds**.

---

## 4. Why This Architecture Burns Minimal Credits

- **Zero NAT Gateway Fees:** Saves ~$35 - $65/month by routing traffic via Internet Gateway.
- **Zero Managed EKS Fees:** Runs CNCF K3s directly on the node, avoiding the $73/month flat AWS EKS control plane fee.
- **Zero Managed RDS/ElastiCache Fees:** Postgres 16 and Redis 7 run directly in Docker on the instance.
- **Zero Compute Fees When Idle:** Run `./envscale.sh infra stop` anytime. Compute drops to $0.00/hr. The only fee while paused is ~$2.40/month (~$0.08/day) for 30 GB gp3 root EBS disk.
