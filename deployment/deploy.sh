#!/usr/bin/env bash
set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TF_DIR="$SCRIPT_DIR/terraform"

echo -e "${BLUE}=== [1/4] Verifying AWS Credentials ===${NC}"
if ! aws sts get-caller-identity > /dev/null 2>&1; then
    echo -e "${RED}Error: AWS CLI credentials not found or expired.${NC}"
    echo -e "${YELLOW}Please configure your AWS CLI using one of the following methods:${NC}"
    echo "  1) Run: aws configure"
    echo "  2) Or export AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY"
    echo "  3) Or run: aws sso login"
    exit 1
fi

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
USER_ARN=$(aws sts get-caller-identity --query Arn --output text)
echo -e "${GREEN}✓ Authenticated as: ${USER_ARN} (Account: ${ACCOUNT_ID})${NC}"

echo -e "\n${BLUE}=== [2/4] Initializing Terraform ===${NC}"
cd "$TF_DIR"
terraform init

echo -e "\n${BLUE}=== [3/4] Planning Deployment ===${NC}"
terraform plan -out=tfplan

echo -e "\n${BLUE}=== [4/4] Applying Deployment ===${NC}"
terraform apply tfplan

echo -e "\n${GREEN}================================================================${NC}"
echo -e "${GREEN}✓ Deployment completed!${NC}"
echo -e "${GREEN}Outputs:${NC}"
terraform output

echo -e "\n${YELLOW}Next Step:${NC}"
echo "1. Wait ~2 minutes for the EC2 user_data cloud-init script to install Docker, K3s, and Caddy."
echo "2. Connect to your instance using the output SSH command."
echo "3. Run deployment/deploy_apps.sh to build and start the containers."
echo -e "${GREEN}================================================================${NC}"
