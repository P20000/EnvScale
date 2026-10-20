#!/usr/bin/env bash
# ==============================================================================
# EnvScale — Unified Deployment & Cloud Infrastructure Orchestrator
#
# Inspired by the decoupled Relmonition architecture:
#   1. Application Deployment (Fast, artifact-driven via GHCR & Docker Compose)
#   2. Cloud Infrastructure Lifecycle (Stop/Start persistent EC2, save AWS credits)
#
# Usage:
#   ./envscale.sh [deploy]       - Deploy/update application stack (called by CD or CLI)
#   ./envscale.sh infra up       - Provision AWS EC2 infrastructure & sync GitHub Secrets
#   ./envscale.sh infra stop     - Pause EC2 instance (Compute: $0.00/hr, preserves state)
#   ./envscale.sh infra start    - Resume EC2 instance in ~20s & verify services
#   ./envscale.sh infra destroy  - Backup DB to S3 and tear down all AWS resources
#   ./envscale.sh status         - Check live container statuses and endpoints
#   ./envscale.sh logs [svc]     - Tail logs of production containers
#   ./envscale.sh ssh            - Open direct SSH shell into active EC2 instance
# ==============================================================================

set -e

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m'

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TF_DIR="$ROOT_DIR/deployment/terraform"
KEY_FILE="$TF_DIR/envscale_key.pem"
COMPOSE_FILE="$ROOT_DIR/deployment/docker-compose.prod.yml"

# Load local .env fallback if present
if [ -f "$ROOT_DIR/.env" ]; then
    [ -z "$DUCKDNS_TOKEN" ] && DUCKDNS_TOKEN=$(grep -E '^DUCKDNS_TOKEN=' "$ROOT_DIR/.env" | cut -d '=' -f2- | tr -d '"' | tr -d "'" || true)
    [ -z "$DUCKDNS_DOMAIN" ] && DUCKDNS_DOMAIN=$(grep -E '^DUCKDNS_DOMAIN=' "$ROOT_DIR/.env" | cut -d '=' -f2- | tr -d '"' | tr -d "'" || true)
    [ -z "$GOOGLE_CLIENT_ID" ] && GOOGLE_CLIENT_ID=$(grep -E '^GOOGLE_CLIENT_ID=' "$ROOT_DIR/.env" | cut -d '=' -f2- | tr -d '"' | tr -d "'" || true)
    [ -z "$GOOGLE_CLIENT_SECRET" ] && GOOGLE_CLIENT_SECRET=$(grep -E '^GOOGLE_CLIENT_SECRET=' "$ROOT_DIR/.env" | cut -d '=' -f2- | tr -d '"' | tr -d "'" || true)
    [ -z "$BETTER_AUTH_SECRET" ] && BETTER_AUTH_SECRET=$(grep -E '^BETTER_AUTH_SECRET=' "$ROOT_DIR/.env" | cut -d '=' -f2- | tr -d '"' | tr -d "'" || true)
    [ -z "$JWT_ACCESS_SECRET" ] && JWT_ACCESS_SECRET=$(grep -E '^JWT_ACCESS_SECRET=' "$ROOT_DIR/.env" | cut -d '=' -f2- | tr -d '"' | tr -d "'" || true)
    [ -z "$JWT_REFRESH_SECRET" ] && JWT_REFRESH_SECRET=$(grep -E '^JWT_REFRESH_SECRET=' "$ROOT_DIR/.env" | cut -d '=' -f2- | tr -d '"' | tr -d "'" || true)
    [ -z "$KUBECONFIG_ENCRYPTION_KEY" ] && KUBECONFIG_ENCRYPTION_KEY=$(grep -E '^KUBECONFIG_ENCRYPTION_KEY=' "$ROOT_DIR/.env" | cut -d '=' -f2- | tr -d '"' | tr -d "'" || true)
elif [ -f "$ROOT_DIR/apps/api-server/.env" ]; then
    [ -z "$GOOGLE_CLIENT_ID" ] && GOOGLE_CLIENT_ID=$(grep -E '^GOOGLE_CLIENT_ID=' "$ROOT_DIR/apps/api-server/.env" | cut -d '=' -f2- | tr -d '"' | tr -d "'" || true)
    [ -z "$GOOGLE_CLIENT_SECRET" ] && GOOGLE_CLIENT_SECRET=$(grep -E '^GOOGLE_CLIENT_SECRET=' "$ROOT_DIR/apps/api-server/.env" | cut -d '=' -f2- | tr -d '"' | tr -d "'" || true)
    [ -z "$BETTER_AUTH_SECRET" ] && BETTER_AUTH_SECRET=$(grep -E '^BETTER_AUTH_SECRET=' "$ROOT_DIR/apps/api-server/.env" | cut -d '=' -f2- | tr -d '"' | tr -d "'" || true)
fi

DUCKDNS_DOMAIN="${DUCKDNS_DOMAIN:-envscale}"
FULL_DOMAIN="${DUCKDNS_DOMAIN}.duckdns.org"

# ------------------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------------------
log_info()  { echo -e "${BLUE}${BOLD}[INFO]${NC} $1"; }
log_succ()  { echo -e "${GREEN}${BOLD}[SUCCESS]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}${BOLD}[WARN]${NC} $1"; }
log_err()   { echo -e "${RED}${BOLD}[ERROR]${NC} $1"; }

check_aws_cli() {
    if ! aws sts get-caller-identity > /dev/null 2>&1; then
        log_err "AWS CLI credentials are not configured or expired. Run: aws configure"
        exit 1
    fi
    ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
    AWS_REGION=$(aws configure get region || echo "ap-south-1")
    AWS_REGION="${AWS_REGION:-ap-south-1}"
    S3_BUCKET="envscale-cloud-vault-${ACCOUNT_ID}-${AWS_REGION}"
}

ensure_s3_vault() {
    check_aws_cli
    if ! aws s3 ls "s3://${S3_BUCKET}" > /dev/null 2>&1; then
        log_info "Creating permanent S3 Vault bucket: s3://${S3_BUCKET} ..."
        if [ "$AWS_REGION" = "us-east-1" ]; then
            aws s3api create-bucket --bucket "${S3_BUCKET}" --region "${AWS_REGION}" > /dev/null
        else
            aws s3api create-bucket --bucket "${S3_BUCKET}" --region "${AWS_REGION}" \
                --create-bucket-configuration LocationConstraint="${AWS_REGION}" > /dev/null
        fi
        aws s3api put-bucket-versioning --bucket "${S3_BUCKET}" \
            --versioning-configuration Status=Enabled > /dev/null
        log_succ "Permanent S3 Vault initialized (Versioning Enabled)."
    else
        log_info "Permanent S3 Vault verified: s3://${S3_BUCKET}"
    fi
}

backup_to_s3() {
    ensure_s3_vault
    log_info "Syncing Terraform state & keys into permanent S3 vault..."
    [ -f "$TF_DIR/terraform.tfstate" ] && aws s3 cp "$TF_DIR/terraform.tfstate" "s3://${S3_BUCKET}/state/terraform.tfstate"
    [ -f "$KEY_FILE" ] && aws s3 cp "$KEY_FILE" "s3://${S3_BUCKET}/secrets/envscale_key.pem"
    log_succ "S3 Cloud Vault backup complete."
}

restore_from_s3() {
    ensure_s3_vault
    log_info "Checking S3 vault for existing state or keys..."
    if aws s3 ls "s3://${S3_BUCKET}/state/terraform.tfstate" > /dev/null 2>&1; then
        aws s3 cp "s3://${S3_BUCKET}/state/terraform.tfstate" "$TF_DIR/terraform.tfstate"
        log_succ "Restored terraform.tfstate from S3 vault."
    fi
    if aws s3 ls "s3://${S3_BUCKET}/secrets/envscale_key.pem" > /dev/null 2>&1; then
        aws s3 cp "s3://${S3_BUCKET}/secrets/envscale_key.pem" "$KEY_FILE"
        chmod 600 "$KEY_FILE"
        log_succ "Restored envscale_key.pem from S3 vault."
    fi
}

get_public_ip() {
    if [ -f "$TF_DIR/terraform.tfstate" ]; then
        (cd "$TF_DIR" && terraform output -raw public_ip 2>/dev/null || true)
    fi
}

get_instance_id() {
    if [ -f "$TF_DIR/terraform.tfstate" ]; then
        (cd "$TF_DIR" && terraform output -raw instance_id 2>/dev/null || true)
    fi
}

sync_github_secrets() {
    local ip="$1"
    if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
        log_info "Synchronizing active EC2 IP and SSH credentials to GitHub Actions Secrets..."
        gh secret set EC2_HOST --body "$ip"
        if [ -f "$KEY_FILE" ]; then
            gh secret set SSH_PRIVATE_KEY < "$KEY_FILE"
        fi
        log_succ "GitHub Secrets synchronized! CI/CD is now targeted at ${ip}"
    else
        log_warn "GitHub CLI ('gh') not authenticated. Remember to update EC2_HOST in GitHub Secrets if IP changed."
    fi
}

# ------------------------------------------------------------------------------
# Action: DEPLOY (Core Application Deployment - Invoked by CD or CLI)
# ------------------------------------------------------------------------------
action_deploy() {
    # Check if running on remote EC2 host or locally
    if [ -d "/opt/envscale" ] && [ "$ROOT_DIR" = "/opt/envscale" ]; then
        log_info "Executing deployment on EC2 production host..."
        
        # 1. Generate/update secure atomic .env (chmod 600)
        log_info "Securing production environment configuration..."
        (
            umask 077
            cat <<EOF > "$ROOT_DIR/.env.tmp"
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://envscale:envscale_password@postgres:5432/envscale
REDIS_URL=redis://redis:6379
DUCKDNS_DOMAIN=${DUCKDNS_DOMAIN:-envscale}
DUCKDNS_TOKEN=${DUCKDNS_TOKEN}
BETTER_AUTH_SECRET=${BETTER_AUTH_SECRET:-9f8a3c4b1e2d7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a}
BETTER_AUTH_URL=https://${DUCKDNS_DOMAIN:-envscale}.duckdns.org
JWT_ACCESS_SECRET=${JWT_ACCESS_SECRET:-demo-college-jwt-access-secret-32-chars-long}
JWT_REFRESH_SECRET=${JWT_REFRESH_SECRET:-demo-college-jwt-refresh-secret-32-chars-long}
KUBECONFIG_ENCRYPTION_KEY=${KUBECONFIG_ENCRYPTION_KEY:-dGhpcy1pcy1hLTMyLWJ5dGUtYmFzZTY0LWtleS0xMjM=}
GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID}
GOOGLE_CLIENT_SECRET=${GOOGLE_CLIENT_SECRET}
CORS_ORIGIN=https://${DUCKDNS_DOMAIN:-envscale}.duckdns.org,http://${DUCKDNS_DOMAIN:-envscale}.duckdns.org,http://localhost:3000,http://localhost:5173
EOF
            chmod 600 "$ROOT_DIR/.env.tmp"
            mv -f "$ROOT_DIR/.env.tmp" "$ROOT_DIR/.env"
        )
        log_succ ".env configured with restricted permissions (0600)."

        # 2. Dynamic DNS Routing
        CURRENT_IP=$(curl -s --max-time 5 http://checkip.amazonaws.com || curl -s --max-time 5 http://169.254.169.254/latest/meta-data/public-ipv4 || true)
        if [ -n "$DUCKDNS_DOMAIN" ] && [ -n "$DUCKDNS_TOKEN" ] && [ -n "$CURRENT_IP" ]; then
            log_info "Routing DuckDNS record: ${FULL_DOMAIN} -> ${CURRENT_IP} ..."
            curl -s --max-time 10 "https://www.duckdns.org/update?domains=${DUCKDNS_DOMAIN}&token=${DUCKDNS_TOKEN}&ip=${CURRENT_IP}"
            echo ""
        fi

        # 3. Configure Caddy Reverse Proxy
        if [ -n "$CURRENT_IP" ]; then
            log_info "Reloading Caddy proxy for ${FULL_DOMAIN} and http://${CURRENT_IP}..."
            sudo bash -c "cat <<EOF > /etc/caddy/Caddyfile
http://${CURRENT_IP} {
    reverse_proxy /healthz localhost:8080
    reverse_proxy /ws* localhost:8080
    reverse_proxy /api/v1/stream/* localhost:8080
    reverse_proxy /api* localhost:3001
    reverse_proxy localhost:3000
}

${FULL_DOMAIN} {
    reverse_proxy /healthz localhost:8080
    reverse_proxy /ws* localhost:8080
    reverse_proxy /api/v1/stream/* localhost:8080
    reverse_proxy /api* localhost:3001
    reverse_proxy localhost:3000
}
EOF"
            sudo systemctl reload caddy || sudo systemctl restart caddy
        fi

        # 4. K3s Kubeconfig Permissions
        [ -f /etc/rancher/k3s/k3s.yaml ] && sudo chmod 644 /etc/rancher/k3s/k3s.yaml || true

        # 5. Pull Pre-built Container Images from GHCR & Start
        log_info "Pulling latest pre-built container images from GHCR..."
        docker compose -f "$COMPOSE_FILE" pull || log_warn "Pull failed or images local; continuing with compose up..."
        docker compose -f "$COMPOSE_FILE" up -d --remove-orphans

        # 6. Apply Schema Migrations
        log_info "Applying database schema migrations..."
        cat apps/api-server/src/db/migrations/*.sql 2>/dev/null | docker compose -f "$COMPOSE_FILE" exec -T postgres psql -U envscale -d envscale 2>/dev/null || true
        docker compose -f "$COMPOSE_FILE" exec -T postgres psql -U envscale -d envscale -c "
        CREATE TABLE IF NOT EXISTS \"workspace_members\" (
            \"id\" uuid DEFAULT gen_random_uuid() NOT NULL,
            \"workspace_id\" uuid NOT NULL,
            \"user_id\" uuid NOT NULL,
            \"role\" varchar(50) DEFAULT 'member',
            \"joined_at\" timestamp DEFAULT now() NOT NULL,
            \"updated_at\" timestamp DEFAULT now() NOT NULL,
            CONSTRAINT \"workspace_members_workspace_id_user_id_pk\" PRIMARY KEY(\"workspace_id\",\"user_id\")
        );
        CREATE INDEX IF NOT EXISTS \"workspace_members_workspace_id_idx\" ON \"workspace_members\" (\"workspace_id\");
        CREATE INDEX IF NOT EXISTS \"workspace_members_user_id_idx\" ON \"workspace_members\" (\"user_id\");
        " 2>/dev/null || true

        # Restart api-server & k8s-streamer to sync clean connections
        docker compose -f "$COMPOSE_FILE" restart api-server k8s-streamer

        log_succ "=== EnvScale Deployment Complete! ==="
        docker compose -f "$COMPOSE_FILE" ps
    else
        # Running from developer machine: dispatch over SSH to EC2
        PUBLIC_IP=$(get_public_ip)
        if [ -z "$PUBLIC_IP" ] || [ ! -f "$KEY_FILE" ]; then
            log_err "No active AWS host found. Run './envscale.sh infra up' to provision first."
            exit 1
        fi
        log_info "Deploying to active cloud host ${PUBLIC_IP} via SSH..."
        ssh -o StrictHostKeyChecking=no -i "$KEY_FILE" ubuntu@"$PUBLIC_IP" \
            "if [ ! -d /opt/envscale/.git ]; then
                git clone -b develop https://github.com/P20000/EnvScale.git /opt/envscale || (mkdir -p /opt/envscale && cd /opt/envscale && git init && git remote add origin https://github.com/P20000/EnvScale.git && git fetch origin develop && git checkout -b develop origin/develop -f)
             fi && \
             cd /opt/envscale && \
             git pull origin develop && \
             DUCKDNS_DOMAIN='$DUCKDNS_DOMAIN' \
             DUCKDNS_TOKEN='$DUCKDNS_TOKEN' \
             BETTER_AUTH_SECRET='$BETTER_AUTH_SECRET' \
             JWT_ACCESS_SECRET='$JWT_ACCESS_SECRET' \
             JWT_REFRESH_SECRET='$JWT_REFRESH_SECRET' \
             KUBECONFIG_ENCRYPTION_KEY='$KUBECONFIG_ENCRYPTION_KEY' \
             GOOGLE_CLIENT_ID='$GOOGLE_CLIENT_ID' \
             GOOGLE_CLIENT_SECRET='$GOOGLE_CLIENT_SECRET' \
             ./envscale.sh deploy"
    fi
}

# ------------------------------------------------------------------------------
# Action: INFRASTRUCTURE (Lifecycle Management: up, stop, start, destroy)
# ------------------------------------------------------------------------------
action_infra_up() {
    log_info "Provisioning EnvScale Cloud Infrastructure on AWS..."
    check_aws_cli
    ensure_s3_vault
    restore_from_s3

    cd "$TF_DIR"
    terraform init
    terraform apply -auto-approve

    PUBLIC_IP=$(terraform output -raw public_ip)
    INSTANCE_ID=$(terraform output -raw instance_id)
    chmod 600 "$KEY_FILE"

    backup_to_s3
    sync_github_secrets "$PUBLIC_IP"

    log_info "Waiting for EC2 SSH availability at ${PUBLIC_IP}..."
    until ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 -i "$KEY_FILE" ubuntu@"$PUBLIC_IP" "uptime" > /dev/null 2>&1; do
        sleep 5
    done

    log_info "Waiting for cloud-init bootstrap to complete..."
    until ssh -o StrictHostKeyChecking=no -i "$KEY_FILE" ubuntu@"$PUBLIC_IP" "grep -q 'EC2 Setup Completed Successfully' /var/log/user_data.log 2>/dev/null"; do
        sleep 10
    done
    log_succ "Host dependencies initialized!"

    log_info "Ensuring workspace repository is cloned & updated on EC2..."
    ssh -o StrictHostKeyChecking=no -i "$KEY_FILE" ubuntu@"$PUBLIC_IP" \
        "if [ ! -d /opt/envscale/.git ]; then
            git clone -b develop https://github.com/P20000/EnvScale.git /opt/envscale
         else
            cd /opt/envscale && git pull origin develop
         fi"

    # Run deployment to start containers
    action_deploy

    log_succ "EnvScale is ONLINE at https://${FULL_DOMAIN} (http://${PUBLIC_IP})"
}

action_infra_stop() {
    check_aws_cli
    INSTANCE_ID=$(get_instance_id)
    if [ -z "$INSTANCE_ID" ]; then
        log_err "No instance ID found in Terraform state. Is infrastructure provisioned?"
        exit 1
    fi
    log_info "Pausing EC2 instance (${INSTANCE_ID}) to eliminate compute costs..."
    aws ec2 stop-instances --instance-ids "$INSTANCE_ID" > /dev/null
    log_succ "EC2 instance paused!"
    echo -e "  ${BOLD}Compute Cost:${NC}  \$0.00/hour (All vCPU & RAM charges stopped)"
    echo -e "  ${BOLD}Storage Cost:${NC}  ~\$0.08/day (gp3 EBS disk preserved)"
    echo -e "  ${BOLD}Resume:${NC}        Run './envscale.sh infra start' to bring back online in 20s"
}

action_infra_start() {
    check_aws_cli
    INSTANCE_ID=$(get_instance_id)
    if [ -z "$INSTANCE_ID" ]; then
        log_err "No instance ID found in Terraform state."
        exit 1
    fi
    log_info "Resuming EC2 instance (${INSTANCE_ID})..."
    aws ec2 start-instances --instance-ids "$INSTANCE_ID" > /dev/null
    
    PUBLIC_IP=$(get_public_ip)
    log_info "Waiting for instance to resume and SSH to become ready..."
    until ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 -i "$KEY_FILE" ubuntu@"$PUBLIC_IP" "uptime" > /dev/null 2>&1; do
        sleep 5
    done
    log_succ "Instance is back online!"
    sync_github_secrets "$PUBLIC_IP"

    action_deploy
}

action_infra_destroy() {
    check_aws_cli
    ensure_s3_vault
    PUBLIC_IP=$(get_public_ip)
    if [ -n "$PUBLIC_IP" ] && [ -f "$KEY_FILE" ]; then
        if ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 -i "$KEY_FILE" ubuntu@"$PUBLIC_IP" "uptime" > /dev/null 2>&1; then
            log_info "Archiving database dump to S3 before destruction..."
            ssh -o StrictHostKeyChecking=no -i "$KEY_FILE" ubuntu@"$PUBLIC_IP" \
                "docker exec envscale-postgres pg_dump -U envscale envscale 2>/dev/null" > "$ROOT_DIR/backup_latest.sql" || true
            if [ -s "$ROOT_DIR/backup_latest.sql" ]; then
                aws s3 cp "$ROOT_DIR/backup_latest.sql" "s3://${S3_BUCKET}/database/backup_$(date +%Y%m%d_%H%M%S).sql"
                rm "$ROOT_DIR/backup_latest.sql"
                log_succ "Database archived safely in S3."
            fi
        fi
    fi
    backup_to_s3
    log_info "Destroying all AWS resources via Terraform..."
    cd "$TF_DIR" && terraform destroy -auto-approve
    backup_to_s3
    log_succ "All cloud resources destroyed. AWS credits preserved."
}

# ------------------------------------------------------------------------------
# Dispatcher
# ------------------------------------------------------------------------------
COMMAND="${1:-deploy}"
SUBCOMMAND="$2"

case "$COMMAND" in
    deploy)
        action_deploy
        ;;
    infra)
        case "$SUBCOMMAND" in
            up|prov|provision) action_infra_up ;;
            stop|pause)        action_infra_stop ;;
            start|resume)      action_infra_start ;;
            destroy|term|down) action_infra_destroy ;;
            *) echo "Usage: ./envscale.sh infra [up|stop|start|destroy]" ;;
        esac
        ;;
    status|ps)
        PUBLIC_IP=$(get_public_ip)
        [ -n "$PUBLIC_IP" ] && ssh -o StrictHostKeyChecking=no -i "$KEY_FILE" ubuntu@"$PUBLIC_IP" "docker ps"
        ;;
    logs)
        PUBLIC_IP=$(get_public_ip)
        [ -n "$PUBLIC_IP" ] && ssh -o StrictHostKeyChecking=no -i "$KEY_FILE" ubuntu@"$PUBLIC_IP" "docker compose -f /opt/envscale/deployment/docker-compose.prod.yml logs --tail=100 -f ${SUBCOMMAND:-}"
        ;;
    sync)
        PUBLIC_IP=$(get_public_ip)
        if [ -z "$PUBLIC_IP" ] || [ ! -f "$KEY_FILE" ]; then
            log_err "No active AWS host found. Run './envscale.sh infra up' to provision first."
            exit 1
        fi
        log_info "Syncing local file modifications to /opt/envscale/ on ${PUBLIC_IP}..."
        rsync -avz --filter='P .git' --exclude 'node_modules' --exclude '.turbo' --exclude 'dist' --exclude '.terraform' \
            -e "ssh -i \"$KEY_FILE\" -o StrictHostKeyChecking=no" \
            . ubuntu@"$PUBLIC_IP":/opt/envscale/
        action_deploy
        ;;
    ssh)
        PUBLIC_IP=$(get_public_ip)
        [ -n "$PUBLIC_IP" ] && ssh -o StrictHostKeyChecking=no -i "$KEY_FILE" ubuntu@"$PUBLIC_IP"
        ;;
    *)
        echo -e "${BOLD}EnvScale — Cloud Orchestrator${NC}"
        echo "Usage: ./envscale.sh [command]"
        echo ""
        echo "Commands:"
        echo "  deploy          Deploy/update application containers (Default, called by CD)"
        echo "  infra up        Provision EC2 host via Terraform & auto-sync GitHub Secrets"
        echo "  infra stop      Pause EC2 instance to stop compute billing (\$0.00/hr)"
        echo "  infra start     Resume EC2 instance in ~20s"
        echo "  infra destroy   Backup DB to S3 and tear down all AWS resources"
        echo "  sync            Sync local source changes to EC2 & deploy without committing"
        echo "  status          Check running Docker containers on EC2"
        echo "  logs [service]  Tail production container logs"
        echo "  ssh             Open direct SSH terminal into EC2 host"
        exit 1
        ;;
esac
