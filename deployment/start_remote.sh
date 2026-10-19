#!/usr/bin/env bash
set -e

# Script executed ON the remote EC2 instance to sync and start all apps
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "=== Pulling dependencies & starting production stack ==="
cd "$ROOT_DIR"

# Ensure K3s is running
until kubectl get nodes > /dev/null 2>&1; do
    echo "Waiting for local K3s cluster to initialize..."
    sleep 3
done
echo "✓ K3s cluster is online and healthy!"

# Ensure permissions on Kubeconfig
sudo chmod 644 /etc/rancher/k3s/k3s.yaml

# Build and start Docker Compose stack
docker compose -f deployment/docker-compose.prod.yml up -d --build

echo "=== Applying database schema migrations ==="
# Apply all schema migrations directly to Postgres container
cat apps/api-server/src/db/migrations/*.sql 2>/dev/null | docker compose -f deployment/docker-compose.prod.yml exec -T postgres psql -U envscale -d envscale 2>/dev/null || true

# Ensure workspace_members is created
docker compose -f deployment/docker-compose.prod.yml exec -T postgres psql -U envscale -d envscale -c "
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

# Restart api-server to hydrate schemas cleanly
docker compose -f deployment/docker-compose.prod.yml restart api-server

echo "=== EnvScale is running! ==="
docker compose -f deployment/docker-compose.prod.yml ps
