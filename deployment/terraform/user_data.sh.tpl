#!/bin/bash
set -e

# Log all output to /var/log/user_data.log for debugging
exec > >(tee /var/log/user_data.log|logger -t user-data -s 2>/dev/console) 2>&1

echo "=== [1/5] Starting EnvScale Automated EC2 Provisioning ==="

export DEBIAN_FRONTEND=noninteractive

# Update system packages
apt-get update -y
apt-get upgrade -y

# Install essential dependencies, Docker, Docker Compose, Git, Caddy
apt-get install -y \
    ca-certificates \
    curl \
    gnupg \
    lsb-release \
    git \
    make \
    jq \
    debian-keyring \
    debian-archive-keyring \
    apt-transport-https

# Add Docker Official GPG Key & Repo
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  tee /etc/apt/sources.list.d/docker.list > /dev/null

apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

systemctl enable docker
systemctl start docker
usermod -aG docker ubuntu

# Add Caddy Repo
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt-get update -y
apt-get install -y caddy

echo "=== [2/5] Installing CNCF K3s (Lightweight Kubernetes) ==="
# Install K3s with disabled Traefik so Caddy has exclusive ownership of port 80/443
curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="--write-kubeconfig-mode 644 --disable traefik" sh -

# Verify K3s is responsive
kubectl wait --for=condition=Ready node --all --timeout=60s || true

echo "=== [3/5] Setting up Project Workspace & Reverse Proxy ==="
if [ ! -d /opt/envscale/.git ]; then
    git clone -b develop https://github.com/P20000/EnvScale.git /opt/envscale || mkdir -p /opt/envscale
fi
chown -R ubuntu:ubuntu /opt/envscale

DOMAIN="${DOMAIN_NAME}"

if [ -n "$DOMAIN" ]; then
cat <<EOF > /etc/caddy/Caddyfile
$DOMAIN {
    reverse_proxy /healthz localhost:8080
    reverse_proxy /ws* localhost:8080
    reverse_proxy /api/v1/stream/* localhost:8080
    reverse_proxy /api/v1/clusters/snapshot* localhost:8080
    reverse_proxy /api/v1/clusters/register* localhost:8080
    reverse_proxy /api/v1/clusters/unregister-all* localhost:8080
    reverse_proxy /api/v1/logs/stream* localhost:8080
    reverse_proxy /api/v1/chaos/* localhost:8080
    reverse_proxy /api/v1/resource/* localhost:8080
    reverse_proxy /api/v1/evaluator/* localhost:8080
    reverse_proxy /api/v1/rollout/* localhost:8080
    reverse_proxy /api* localhost:3001
    reverse_proxy localhost:3000
}
EOF
else
cat <<EOF > /etc/caddy/Caddyfile
http:// {
    reverse_proxy /healthz localhost:8080
    reverse_proxy /ws* localhost:8080
    reverse_proxy /api/v1/stream/* localhost:8080
    reverse_proxy /api/v1/clusters/snapshot* localhost:8080
    reverse_proxy /api/v1/clusters/register* localhost:8080
    reverse_proxy /api/v1/clusters/unregister-all* localhost:8080
    reverse_proxy /api/v1/logs/stream* localhost:8080
    reverse_proxy /api/v1/chaos/* localhost:8080
    reverse_proxy /api/v1/resource/* localhost:8080
    reverse_proxy /api/v1/evaluator/* localhost:8080
    reverse_proxy /api/v1/rollout/* localhost:8080
    reverse_proxy /api* localhost:3001
    reverse_proxy localhost:3000
}
EOF
fi

systemctl restart caddy

echo "=== [4/5] Node 22 & Pnpm Installation for Local Builds ==="
# Install Node.js 22 & PNPM
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs
corepack enable
corepack prepare pnpm@latest --activate

echo "=== [5/5] EC2 Setup Completed Successfully ==="
