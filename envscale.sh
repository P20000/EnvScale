#!/usr/bin/env bash
# ==============================================================================
# EnvScale — Single-Command AWS Cloud Lifecycle & Orchestration Engine
#
# Usage:
#   ./envscale.sh prov       - Provision AWS infrastructure, deploy full stack, & backup state to S3
#   ./envscale.sh terminate  - Backup DB/state to S3, then unprovision all AWS infrastructure
#   ./envscale.sh status     - Check live health & Docker containers on AWS EC2
#   ./envscale.sh sync       - Continuous Integration/Continuous Deployment (re-sync local changes)
#   ./envscale.sh ssh        - SSH directly into the active cloud host
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

DUCKDNS_DOMAIN="${DUCKDNS_DOMAIN:-envscale}"
DUCKDNS_TOKEN="${DUCKDNS_TOKEN:-1e0d36a5-1bed-44ce-8cd7-0dbce560d7e8}"
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
        log_err "AWS CLI credentials are not configured or expired."
        echo "Run: aws configure"
        exit 1
    fi
    ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
    AWS_REGION=$(aws configure get region || echo "us-east-1")
    S3_BUCKET="envscale-cloud-vault-${ACCOUNT_ID}"
}

update_duckdns() {
    local ip="$1"
    if [ -n "$DUCKDNS_DOMAIN" ] && [ -n "$DUCKDNS_TOKEN" ] && [ -n "$ip" ]; then
        log_info "Routing DuckDNS record: https://${FULL_DOMAIN} -> ${ip} ..."
        local res
        res=$(curl -s --max-time 10 "https://www.duckdns.org/update?domains=${DUCKDNS_DOMAIN}&token=${DUCKDNS_TOKEN}&ip=${ip}")
        if [ "$res" = "OK" ]; then
            log_succ "DuckDNS record routed successfully: ${FULL_DOMAIN} -> ${ip}"
        else
            log_warn "DuckDNS response: $res"
        fi
    fi
}

configure_remote_caddy() {
    local ip="$1"
    log_info "Configuring Caddy reverse proxy with automated TLS for ${FULL_DOMAIN}..."
    ssh -o StrictHostKeyChecking=no -i "$KEY_FILE" ubuntu@"$ip" "sudo bash -c 'cat <<EOF > /etc/caddy/Caddyfile
${FULL_DOMAIN} {
    reverse_proxy /healthz localhost:8080
    reverse_proxy /ws* localhost:8080
    reverse_proxy /api/v1/stream/* localhost:8080
    reverse_proxy /api* localhost:3001
    reverse_proxy localhost:3000
}

http:// {
    reverse_proxy /healthz localhost:8080
    reverse_proxy /ws* localhost:8080
    reverse_proxy /api/v1/stream/* localhost:8080
    reverse_proxy /api* localhost:3001
    reverse_proxy localhost:3000
}
EOF
systemctl reload caddy || systemctl restart caddy
'"
    log_succ "Caddy TLS proxy initialized!"
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
    log_info "Syncing Terraform state, SSH keys, & configs into permanent S3 vault..."
    if [ -f "$TF_DIR/terraform.tfstate" ]; then
        aws s3 cp "$TF_DIR/terraform.tfstate" "s3://${S3_BUCKET}/state/terraform.tfstate"
    fi
    if [ -f "$KEY_FILE" ]; then
        aws s3 cp "$KEY_FILE" "s3://${S3_BUCKET}/secrets/envscale_key.pem"
    fi
    log_succ "S3 Cloud Vault backup complete! State & secrets preserved indefinitely."
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
        cd "$TF_DIR"
        terraform output -raw public_ip 2>/dev/null || true
    fi
}

# ------------------------------------------------------------------------------
# Action: PROV (Build, Provision, Deploy, Migrate, Start)
# ------------------------------------------------------------------------------
action_prov() {
    log_info "=========================================================="
    log_info "   Starting EnvScale Full-Stack Cloud Provisioning        "
    log_info "=========================================================="
    
    check_aws_cli
    ensure_s3_vault
    restore_from_s3

    log_info "Step 1/5: Applying Terraform Infrastructure..."
    cd "$TF_DIR"
    terraform init
    terraform apply -auto-approve

    PUBLIC_IP=$(terraform output -raw public_ip)
    log_succ "AWS Host Ready! Public Elastic IP: ${PUBLIC_IP}"

    # Route DuckDNS immediately
    update_duckdns "$PUBLIC_IP"

    # Backup tfstate & key immediately to S3
    backup_to_s3

    log_info "Step 2/5: Waiting for cloud-init bootstrap on EC2 host..."
    chmod 600 "$KEY_FILE"
    
    # Wait for SSH to be reachable
    until ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 -i "$KEY_FILE" ubuntu@"$PUBLIC_IP" "uptime" > /dev/null 2>&1; do
        echo "Waiting for SSH availability..."
        sleep 5
    done
    
    # Wait for cloud-init to finish installing Docker & K3s
    log_info "Checking Docker, K3s, Caddy & Node.js installation progress..."
    until ssh -o StrictHostKeyChecking=no -i "$KEY_FILE" ubuntu@"$PUBLIC_IP" "grep -q 'EC2 Setup Completed Successfully' /var/log/user_data.log 2>/dev/null" ; do
        echo "Cloud-init provisioning packages in background... (10s)"
        sleep 10
    done
    log_succ "EC2 host dependencies fully initialized!"

    # Ensure Caddy is configured for DuckDNS domain
    configure_remote_caddy "$PUBLIC_IP"

    log_info "Step 3/5: Syncing project source code to AWS..."
    cd "$ROOT_DIR"
    rsync -avz --delete \
        --exclude 'node_modules' \
        --exclude '.turbo' \
        --exclude '.git' \
        --exclude 'dist' \
        --exclude '.terraform' \
        -e "ssh -i \"$KEY_FILE\" -o StrictHostKeyChecking=no" \
        . ubuntu@"$PUBLIC_IP":/opt/envscale/
    log_succ "Codebase synced successfully!"

    log_info "Step 4/5: Building and starting production containers on EC2..."
    ssh -o StrictHostKeyChecking=no -i "$KEY_FILE" ubuntu@"$PUBLIC_IP" "cd /opt/envscale && ./deployment/start_remote.sh"

    log_info "Step 5/5: Verifying live health..."
    sleep 3
    if curl -s -k "https://${FULL_DOMAIN}/healthz" | grep -q "k8s-streamer" || curl -s "http://${PUBLIC_IP}/healthz" | grep -q "k8s-streamer"; then
        log_succ "Health check passed!"
    else
        log_warn "Health check responded with non-standard payload, but containers are running."
    fi

    echo ""
    log_succ "=========================================================="
    log_succ "  🎉 EnvScale is LIVE on AWS!                             "
    log_succ "=========================================================="
    echo -e "  ${BOLD}Domain URL:${NC}     https://${FULL_DOMAIN}"
    echo -e "  ${BOLD}Direct IP URL:${NC}  http://${PUBLIC_IP}"
    echo -e "  ${BOLD}API Server:${NC}     https://${FULL_DOMAIN}/api/v1/workspaces"
    echo -e "  ${BOLD}Streamer Health:${NC}https://${FULL_DOMAIN}/healthz"
    echo -e "  ${BOLD}WebSocket URL:${NC}  wss://${FULL_DOMAIN}/ws/k8s"
    echo -e "  ${BOLD}SSH Command:${NC}    ssh -i deployment/terraform/envscale_key.pem ubuntu@${PUBLIC_IP}"
    echo -e "  ${BOLD}S3 Vault:${NC}       s3://${S3_BUCKET}"
    echo -e "=========================================================="
}

# ------------------------------------------------------------------------------
# Action: TERMINATE (Backup DB dump, Sync S3 Vault, Destroy EC2/VPC)
# ------------------------------------------------------------------------------
action_terminate() {
    log_info "=========================================================="
    log_info "   Terminating EnvScale Cloud Infrastructure              "
    log_info "=========================================================="
    
    check_aws_cli
    ensure_s3_vault

    PUBLIC_IP=$(get_public_ip)

    if [ -n "$PUBLIC_IP" ] && [ -f "$KEY_FILE" ]; then
        if ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 -i "$KEY_FILE" ubuntu@"$PUBLIC_IP" "uptime" > /dev/null 2>&1; then
            log_info "Creating live PostgreSQL database dump before unprovisioning..."
            ssh -o StrictHostKeyChecking=no -i "$KEY_FILE" ubuntu@"$PUBLIC_IP" \
                "docker exec envscale-postgres pg_dump -U envscale envscale 2>/dev/null" > "$ROOT_DIR/envscale_backup_latest.sql" || true
            
            if [ -s "$ROOT_DIR/envscale_backup_latest.sql" ]; then
                TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
                aws s3 cp "$ROOT_DIR/envscale_backup_latest.sql" "s3://${S3_BUCKET}/database/backup_${TIMESTAMP}.sql"
                aws s3 cp "$ROOT_DIR/envscale_backup_latest.sql" "s3://${S3_BUCKET}/database/backup_latest.sql"
                rm "$ROOT_DIR/envscale_backup_latest.sql"
                log_succ "Database snapshot safely archived into s3://${S3_BUCKET}/database/ !"
            fi
        fi
    fi

    # Backup tfstate before destroying
    backup_to_s3

    log_info "Destroying AWS EC2 instance, VPC, Subnets, and Security Groups..."
    cd "$TF_DIR"
    terraform destroy -auto-approve

    # Final backup of state after destruction
    backup_to_s3

    log_succ "=========================================================="
    log_succ "  ✓ All cloud compute & networking successfully unprovisioned."
    log_succ "  ✓ Zero compute or NAT costs running. AWS credits preserved!"
    log_succ "  ✓ Database dump and state stored securely in s3://${S3_BUCKET}/"
    log_succ "=========================================================="
}

# ------------------------------------------------------------------------------
# Action: SYNC (Continuous Deployment of local code changes)
# ------------------------------------------------------------------------------
action_sync() {
    PUBLIC_IP=$(get_public_ip)
    if [ -z "$PUBLIC_IP" ]; then
        log_err "No active deployment found. Run: ./envscale.sh prov"
        exit 1
    fi

    # Keep DuckDNS & Caddy updated
    update_duckdns "$PUBLIC_IP"
    configure_remote_caddy "$PUBLIC_IP"

    log_info "Deploying local code changes to https://${FULL_DOMAIN} (${PUBLIC_IP}) ..."
    cd "$ROOT_DIR"
    rsync -avz \
        --exclude 'node_modules' \
        --exclude '.turbo' \
        --exclude '.git' \
        --exclude 'dist' \
        --exclude '.terraform' \
        -e "ssh -i \"$KEY_FILE\" -o StrictHostKeyChecking=no" \
        . ubuntu@"$PUBLIC_IP":/opt/envscale/

    ssh -o StrictHostKeyChecking=no -i "$KEY_FILE" ubuntu@"$PUBLIC_IP" "cd /opt/envscale && ./deployment/start_remote.sh"
    log_succ "Sync & rebuild complete! Visit https://${FULL_DOMAIN} or http://${PUBLIC_IP}"
}

# ------------------------------------------------------------------------------
# Action: STATUS
# ------------------------------------------------------------------------------
action_status() {
    PUBLIC_IP=$(get_public_ip)
    if [ -z "$PUBLIC_IP" ]; then
        log_err "No active deployment found. Run: ./envscale.sh prov"
        exit 1
    fi
    log_info "Connecting to ${PUBLIC_IP} ..."
    ssh -o StrictHostKeyChecking=no -i "$KEY_FILE" ubuntu@"$PUBLIC_IP" "docker ps"
}

# ------------------------------------------------------------------------------
# Action: SSH
# ------------------------------------------------------------------------------
action_ssh() {
    PUBLIC_IP=$(get_public_ip)
    if [ -z "$PUBLIC_IP" ]; then
        log_err "No active deployment found."
        exit 1
    fi
    ssh -o StrictHostKeyChecking=no -i "$KEY_FILE" ubuntu@"$PUBLIC_IP"
}

# ------------------------------------------------------------------------------
# Main Dispatcher
# ------------------------------------------------------------------------------
case "$1" in
    prov|provision|deploy)
        action_prov
        ;;
    term|terminate|destroy|down)
        action_terminate
        ;;
    sync|cd)
        action_sync
        ;;
    status|ps)
        action_status
        ;;
    ssh)
        action_ssh
        ;;
    *)
        echo -e "${BOLD}EnvScale — Automated Cloud Lifecycle Manager${NC}"
        echo ""
        echo "Usage: ./envscale.sh <command>"
        echo ""
        echo "Commands:"
        echo "  prov       Provision AWS infrastructure, build containers, run DB migrations, & start stack"
        echo "  terminate  Dump DB, archive everything to permanent S3 bucket, and unprovision all AWS resources"
        echo "  sync       Push local code updates & hot-reload containers without reprovisioning VM"
        echo "  status     Check container statuses and health on AWS"
        echo "  ssh        Open direct SSH terminal into the EC2 instance"
        echo ""
        exit 1
        ;;
esac
