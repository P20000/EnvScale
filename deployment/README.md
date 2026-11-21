# EnvScale Production & Cloud Deployment Suite (`deployment/`)

This directory contains the Day-0 AWS bootstrap tooling, Terraform Foundation & Runtime modules, production Docker Compose stack, Caddy TLS reverse proxy template, immutable release-manifest validators, and zero-SSH AWS SSM deployment runtime scripts for **EnvScale**.

---

## Directory Layout

| Path | Responsibility |
| :--- | :--- |
| [`bootstrap/`](bootstrap) | Idempotent Day-0 S3 Terraform state bucket bootstrapper (`bootstrap-state.sh`), IAM boundary/transition guards, policy seal scripts, and SSM `/envscale/prod/*` parameter seeder (`seed-parameters.sh`). |
| [`foundation/`](foundation) | Persistent AWS Foundation Terraform stack (`ap-south-1`): GitHub Actions OIDC trust & scoped roles (`release`, `deploy`, `recovery`, `foundation-plan`, `foundation`), S3 recovery bucket, SSM parameters, and optional EIP. |
| [`terraform/`](terraform) | Disposable single-EC2 runtime Terraform stack (`t3a.large`, `30 GB` gp3, `envscale-ec2-runtime-profile` zero-SSH SSM access, K3s host bootstrap via `user_data.sh.tpl`). |
| [`terraform-eks/`](terraform-eks) | Optional AWS EKS cluster Terraform module (`envscale-todo-eks` in `ap-south-1`, K8s `1.32`, `t3.medium` Spot nodes) and sample workloads ([`eks-todo-app.yaml`](eks-todo-app.yaml)). |
| [`release/`](release) | JSON Schema (`release-schema.json`) and example manifest (`release-manifest.example.json`) enforcing immutable `@sha256` GHCR image digests and Drizzle migration checksums. |
| [`scripts/`](scripts) | Host runtime engine (`host-runtime.sh`), app-only rollback (`rollback.sh`), readiness/DB verifier (`verify.sh`), SSM secret sync (`sync-ssm-secrets.py`), release manifest generator/validator, and Python safety guards (`runtime-guards.py`). |
| [`docker-compose.prod.yml`](docker-compose.prod.yml) | Digest-pinned production Compose stack separating persistent `postgres:16.15-alpine` + `redis:7.4.12-alpine` (`envscale_internal`) from read-only, loopback-bound `api-server`, `k8s-streamer` (`10001:10001`, `ALLOW_ANONYMOUS_WS=false`), and `web` containers. |
| [`Caddyfile.tpl`](Caddyfile.tpl) | Host Caddy reverse-proxy & automatic TLS template routing `/ws*`, `/api/v1/stream/*`, `/api/v1/chaos/*`, `/api/v1/clusters/snapshot*`, `/api/v1/clusters/*/rollout/*` to `k8s-streamer`, `/api*` to `api-server`, and `/` to `web`. |
| [`runtime.env.example`](runtime.env.example) | Host runtime configuration contract rendered alongside `/etc/envscale/secrets.env`. |

---

## Execution Entrypoints

- **On the EC2 Runtime Host (`/opt/envscale`):** [`envscale.sh`](../envscale.sh) dispatches directly to `deployment/scripts/`:
  ```bash
  ./envscale.sh deploy --manifest /path/to/release-manifest.json
  ./envscale.sh rollback --target last-known-good
  ./envscale.sh verify
  ```
- **From a Developer Workstation:** [`envscale.sh`](../envscale.sh) delegates to `scripts/test-center --cli` (or run `pnpm test-center`), managing local dev, Terraform EC2/EKS lifecycle, and zero-SSH `aws ssm send-command` deployments.

---

## Canonical Documentation

- [Production & Cloud Deployment Runbook](../docs/deployment.md)
- [CI/CD Pipelines, Release Guards & Environment Reference](../docs/cicd-and-environment-reference.md)
- [Developer Control Center (`test-center`) & Tooling](../docs/developer-control-center-and-tooling.md)
