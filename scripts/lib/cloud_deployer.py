import os
import sys
import time
import json
import shutil
import subprocess
import urllib.request
import urllib.error
from typing import Callable, Optional, Dict, Any

from .config import PROJECT_ROOT, TERRAFORM_DIR, KEY_FILE, PROD_COMPOSE_FILE
from .cloud_host_runner import (
    execute_remote_host_deploy,
    load_deployment_env,
    validate_deployment_secrets,
    verify_deployment_health,
)

LogCallback = Callable[[str], None]
# StepCallback signature: (step_id: str, title: str, status: str, detail: str) -> None
# status: "start", "log", "success", "error"
StepCallback = Callable[[str, str, str, str], None]

class CloudDeployer:
    def __init__(self, log_fn: Optional[LogCallback] = None, step_fn: Optional[StepCallback] = None):
        self._log = log_fn or (lambda msg: print(f"[CloudDeployer] {msg}"))
        self._step_fn = step_fn or (lambda sid, title, status, detail: None)

    def _emit_step(self, step_id: str, title: str, status: str, detail: str = ""):
        self._step_fn(step_id, title, status, detail)
        if detail and status == "log":
            self._log(f"[{title}] {detail}")
        elif status == "start":
            self._log(f"Starting step: {title} ({detail})")
        elif status == "success":
            self._log(f"Completed step: {title}")
        elif status == "error":
            self._log(f"Failed step: {title} - {detail}")

    def _run_cmd(self, cmd: list, cwd: Optional[str] = None, check: bool = True, step_id: Optional[str] = None, step_title: Optional[str] = None) -> subprocess.CompletedProcess:
        cmd_str = " ".join(cmd)
        if step_id and step_title:
            self._emit_step(step_id, step_title, "log", f"$ {cmd_str}")
        else:
            self._log(f"Executing: {cmd_str}")

        res = subprocess.run(cmd, cwd=cwd or PROJECT_ROOT, capture_output=True, text=True)
        if res.stdout:
            for line in res.stdout.strip().split("\n"):
                if line:
                    if step_id and step_title:
                        self._emit_step(step_id, step_title, "log", line)
                    else:
                        self._log(line)
        if res.returncode != 0 and check:
            err_msg = res.stderr.strip() if res.stderr else f"Command exited with code {res.returncode}"
            if step_id and step_title:
                self._emit_step(step_id, step_title, "log", f"ERROR: {err_msg}")
            else:
                self._log(f"ERROR: {err_msg}")
            raise RuntimeError(err_msg)
        return res

    def get_aws_context(self) -> Dict[str, str]:
        res = subprocess.run(["aws", "sts", "get-caller-identity", "--output", "json"], capture_output=True, text=True)
        if res.returncode != 0:
            raise RuntimeError("AWS CLI credentials not configured or expired. Run 'aws configure'.")
        data = json.loads(res.stdout)
        account_id = data.get("Account", "")
        reg_res = subprocess.run(["aws", "configure", "get", "region"], capture_output=True, text=True)
        region = reg_res.stdout.strip() or "ap-south-1"
        bucket = f"envscale-cloud-vault-{account_id}-{region}"
        return {"account_id": account_id, "region": region, "s3_bucket": bucket}

    def ensure_s3_vault(self, step_id: Optional[str] = None, step_title: Optional[str] = None):
        ctx = self.get_aws_context()
        bucket = ctx["s3_bucket"]
        region = ctx["region"]
        check = subprocess.run(["aws", "s3", "ls", f"s3://{bucket}"], capture_output=True, text=True)
        if check.returncode != 0:
            msg = f"Creating permanent S3 Vault bucket: s3://{bucket}..."
            if step_id and step_title:
                self._emit_step(step_id, step_title, "log", msg)
            if region == "us-east-1":
                self._run_cmd(["aws", "s3api", "create-bucket", "--bucket", bucket, "--region", region], step_id=step_id, step_title=step_title)
            else:
                self._run_cmd([
                    "aws", "s3api", "create-bucket", "--bucket", bucket, "--region", region,
                    "--create-bucket-configuration", f"LocationConstraint={region}"
                ], step_id=step_id, step_title=step_title)
            self._run_cmd([
                "aws", "s3api", "put-bucket-versioning", "--bucket", bucket,
                "--versioning-configuration", "Status=Enabled"
            ], step_id=step_id, step_title=step_title)
        else:
            if step_id and step_title:
                self._emit_step(step_id, step_title, "log", f"Verified S3 Vault bucket: s3://{bucket}")

    def backup_to_s3(self, step_id: Optional[str] = None, step_title: Optional[str] = None):
        ctx = self.get_aws_context()
        bucket = ctx["s3_bucket"]
        tf_state = os.path.join(TERRAFORM_DIR, "terraform.tfstate")
        if os.path.exists(tf_state):
            self._run_cmd(["aws", "s3", "cp", tf_state, f"s3://{bucket}/state/terraform.tfstate"], step_id=step_id, step_title=step_title)
        if os.path.exists(KEY_FILE):
            self._run_cmd(["aws", "s3", "cp", KEY_FILE, f"s3://{bucket}/secrets/envscale_key.pem"], step_id=step_id, step_title=step_title)

    def restore_from_s3(self, step_id: Optional[str] = None, step_title: Optional[str] = None):
        ctx = self.get_aws_context()
        bucket = ctx["s3_bucket"]
        tf_state = os.path.join(TERRAFORM_DIR, "terraform.tfstate")
        check_state = subprocess.run(["aws", "s3", "ls", f"s3://{bucket}/state/terraform.tfstate"], capture_output=True)
        if check_state.returncode == 0:
            self._run_cmd(["aws", "s3", "cp", f"s3://{bucket}/state/terraform.tfstate", tf_state], step_id=step_id, step_title=step_title)
        check_key = subprocess.run(["aws", "s3", "ls", f"s3://{bucket}/secrets/envscale_key.pem"], capture_output=True)
        if check_key.returncode == 0:
            self._run_cmd(["aws", "s3", "cp", f"s3://{bucket}/secrets/envscale_key.pem", KEY_FILE], step_id=step_id, step_title=step_title)
            os.chmod(KEY_FILE, 0o600)

    def _get_tf_outputs(self) -> Dict[str, Any]:
        tf_state = os.path.join(TERRAFORM_DIR, "terraform.tfstate")
        if not os.path.exists(tf_state):
            return {}
        try:
            res = subprocess.run(["terraform", "output", "-json"], cwd=TERRAFORM_DIR, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
            if res.returncode == 0 and res.stdout.strip():
                return json.loads(res.stdout)
        except Exception:
            pass
        return {}

    def get_public_ip(self) -> str:
        outputs = self._get_tf_outputs()
        val = outputs.get("public_ip", {}).get("value")
        return str(val).strip() if val else ""

    def get_instance_id(self) -> str:
        outputs = self._get_tf_outputs()
        val = outputs.get("instance_id", {}).get("value")
        return str(val).strip() if val else ""

    def load_deployment_env(self) -> Dict[str, str]:
        return load_deployment_env()

    def sync_duckdns(self, target_ip: str, domain: Optional[str] = None, token: Optional[str] = None, step_id: Optional[str] = None, step_title: Optional[str] = None) -> bool:
        env = self.load_deployment_env()
        domain = domain or env.get("DUCKDNS_DOMAIN", "envscale")
        token = token or env.get("DUCKDNS_TOKEN", "")
        if not token:
            msg = f"Notice: DUCKDNS_TOKEN not set; skipping DuckDNS DNS record synchronization. Zero-config HTTPS will use https://{target_ip}.sslip.io."
            if step_id and step_title:
                self._emit_step(step_id, step_title, "log", msg)
            else:
                self._log(msg)
            return False
        url = f"https://www.duckdns.org/update?domains={domain}&token={token}&ip={target_ip}"
        msg = f"Updating DuckDNS record: {domain}.duckdns.org -> {target_ip}..."
        if step_id and step_title:
            self._emit_step(step_id, step_title, "log", msg)
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "EnvScale-TestCenter/1.0"})
            with urllib.request.urlopen(req, timeout=10) as resp:
                content = resp.read().decode("utf-8").strip()
                if content == "OK":
                    ok_msg = f"DuckDNS record updated to {target_ip} (OK)."
                    if step_id and step_title:
                        self._emit_step(step_id, step_title, "log", ok_msg)
                    return True
                else:
                    warn_msg = f"DuckDNS response: {content}"
                    if step_id and step_title:
                        self._emit_step(step_id, step_title, "log", warn_msg)
                    return False
        except Exception as e:
            err_msg = f"DuckDNS update request failed: {e}"
            if step_id and step_title:
                self._emit_step(step_id, step_title, "log", err_msg)
            return False

    def sync_github_secrets(self, ip: str, step_id: Optional[str] = None, step_title: Optional[str] = None):
        if shutil.which("gh"):
            auth_check = subprocess.run(["gh", "auth", "status"], capture_output=True)
            if auth_check.returncode == 0:
                if step_id and step_title:
                    self._emit_step(step_id, step_title, "log", f"Synchronizing EC2_HOST ({ip}) to GitHub Secrets...")
                self._run_cmd(["gh", "secret", "set", "EC2_HOST", "--body", ip], step_id=step_id, step_title=step_title)
                if os.path.exists(KEY_FILE):
                    with open(KEY_FILE, "r") as f:
                        subprocess.run(["gh", "secret", "set", "SSH_PRIVATE_KEY"], input=f.read(), text=True, check=True)
                if step_id and step_title:
                    self._emit_step(step_id, step_title, "log", "GitHub Actions secrets updated successfully.")
                return
        msg = "GitHub CLI not authenticated; remember to update EC2_HOST secret manually if changed."
        if step_id and step_title:
            self._emit_step(step_id, step_title, "log", msg)

    def infra_up(self):
        # Step 1: AWS Credentials & S3 State Vault
        s1, t1 = "s1_vault", "Verifying AWS Credentials & S3 State Vault"
        self._emit_step(s1, t1, "start", "aws sts get-caller-identity && s3 vault sync")
        try:
            self.ensure_s3_vault(step_id=s1, step_title=t1)
            self.restore_from_s3(step_id=s1, step_title=t1)
            self._emit_step(s1, t1, "success")
        except Exception as e:
            self._emit_step(s1, t1, "error", str(e))
            raise

        # Step 2: Terraform Init & Apply
        s2, t2 = "s2_terraform", "Provisioning AWS Cloud Resources (Terraform Apply)"
        self._emit_step(s2, t2, "start", "terraform apply -auto-approve")
        try:
            self._run_cmd(["terraform", "init"], cwd=TERRAFORM_DIR, step_id=s2, step_title=t2)
            self._run_cmd(["terraform", "apply", "-auto-approve"], cwd=TERRAFORM_DIR, step_id=s2, step_title=t2)
            ip = self.get_public_ip()
            if not ip:
                raise RuntimeError("Failed to retrieve public IP from Terraform outputs.")
            if os.path.exists(KEY_FILE):
                os.chmod(KEY_FILE, 0o600)
            self.backup_to_s3(step_id=s2, step_title=t2)
            self._emit_step(s2, t2, "success", f"Host Public IP: {ip}")
        except Exception as e:
            self._emit_step(s2, t2, "error", str(e))
            raise

        # Step 3: Dynamic DNS & CI/CD Synchronization
        s3, t3 = "s3_dns", "Routing DuckDNS & Updating GitHub Secrets"
        self._emit_step(s3, t3, "start", f"envscale.duckdns.org -> {ip}")
        try:
            self.sync_duckdns(ip, step_id=s3, step_title=t3)
            self.sync_github_secrets(ip, step_id=s3, step_title=t3)
            self._emit_step(s3, t3, "success")
        except Exception as e:
            self._emit_step(s3, t3, "error", str(e))
            raise

        # Step 4: Host Bootstrap & Dependency Verification
        s4, t4 = "s4_bootstrap", "Waiting for EC2 Host Bootstrap & Cloud-Init"
        self._emit_step(s4, t4, "start", f"ssh ubuntu@{ip} /var/log/user_data.log")
        try:
            self._emit_step(s4, t4, "log", f"Checking SSH availability on {ip}:22...")
            for _ in range(30):
                res = subprocess.run(["ssh", "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=5", "-i", KEY_FILE, f"ubuntu@{ip}", "uptime"], capture_output=True)
                if res.returncode == 0:
                    break
                time.sleep(5)
            self._emit_step(s4, t4, "log", "SSH connection established. Waiting for cloud-init dependencies...")
            for _ in range(40):
                res = subprocess.run(["ssh", "-o", "StrictHostKeyChecking=no", "-i", KEY_FILE, f"ubuntu@{ip}", "grep -q 'EC2 Setup Completed Successfully' /var/log/user_data.log 2>/dev/null"], capture_output=True)
                if res.returncode == 0:
                    break
                time.sleep(10)
            self._emit_step(s4, t4, "success")
        except Exception as e:
            self._emit_step(s4, t4, "error", str(e))
            raise

        # Step 5: Application Deployment & Verification
        s5, t5 = "s5_deploy", "Deploying Containers & Verifying Health Endpoints"
        self._emit_step(s5, t5, "start", "docker compose pull && up")
        try:
            self.deploy(step_id=s5, step_title=t5)
            self._emit_step(s5, t5, "success", f"ONLINE at https://{ip}.sslip.io (http://{ip})")
        except Exception as e:
            self._emit_step(s5, t5, "error", str(e))
            raise

    def infra_stop(self):
        s1, t1 = "stop_instance", "Pausing AWS EC2 Instance"
        instance_id = self.get_instance_id()
        if not instance_id:
            raise RuntimeError("No instance ID found in Terraform state. Is infrastructure provisioned?")
        self._emit_step(s1, t1, "start", f"aws ec2 stop-instances --instance-ids {instance_id}")
        try:
            self._run_cmd(["aws", "ec2", "stop-instances", "--instance-ids", instance_id], step_id=s1, step_title=t1)
            self._emit_step(s1, t1, "success", "Compute charges eliminated ($0.00/hour)")
        except Exception as e:
            self._emit_step(s1, t1, "error", str(e))
            raise

    def infra_start(self):
        s1, t1 = "resume_instance", "Resuming AWS EC2 Instance"
        instance_id = self.get_instance_id()
        if not instance_id:
            raise RuntimeError("No instance ID found in Terraform state.")
        self._emit_step(s1, t1, "start", f"aws ec2 start-instances --instance-ids {instance_id}")
        try:
            self._run_cmd(["aws", "ec2", "start-instances", "--instance-ids", instance_id], step_id=s1, step_title=t1)
            ip = self.get_public_ip()
            self._emit_step(s1, t1, "log", f"Waiting for SSH availability at {ip}...")
            for _ in range(25):
                res = subprocess.run(["ssh", "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=5", "-i", KEY_FILE, f"ubuntu@{ip}", "uptime"], capture_output=True)
                if res.returncode == 0:
                    break
                time.sleep(5)
            self._emit_step(s1, t1, "success", f"Host back online at {ip}")
        except Exception as e:
            self._emit_step(s1, t1, "error", str(e))
            raise

        s2, t2 = "resume_sync", "Syncing DNS & Redeploying Stack"
        self._emit_step(s2, t2, "start", "Updating DuckDNS and restarting containers")
        try:
            self.sync_duckdns(ip, step_id=s2, step_title=t2)
            self.sync_github_secrets(ip, step_id=s2, step_title=t2)
            self.deploy(step_id=s2, step_title=t2)
            self._emit_step(s2, t2, "success")
        except Exception as e:
            self._emit_step(s2, t2, "error", str(e))
            raise

    def infra_destroy(self):
        s1, t1 = "destroy_archive", "Archiving PostgreSQL Database to S3 Vault"
        self._emit_step(s1, t1, "start", "docker exec envscale-postgres pg_dump")
        try:
            self.ensure_s3_vault(step_id=s1, step_title=t1)
            ip = self.get_public_ip()
            if ip and os.path.exists(KEY_FILE):
                ssh_check = subprocess.run(["ssh", "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=5", "-i", KEY_FILE, f"ubuntu@{ip}", "uptime"], capture_output=True)
                if ssh_check.returncode == 0:
                    dump_res = subprocess.run(["ssh", "-o", "StrictHostKeyChecking=no", "-i", KEY_FILE, f"ubuntu@{ip}", "docker exec envscale-postgres pg_dump -U envscale envscale 2>/dev/null"], capture_output=True)
                    if dump_res.returncode == 0 and len(dump_res.stdout) > 50:
                        ctx = self.get_aws_context()
                        stamp = time.strftime("%Y%m%d_%H%M%S")
                        s3_path = f"s3://{ctx['s3_bucket']}/database/backup_{stamp}.sql"
                        p = subprocess.Popen(["aws", "s3", "cp", "-", s3_path], stdin=subprocess.PIPE)
                        p.communicate(input=dump_res.stdout.encode("utf-8"))
                        self._emit_step(s1, t1, "log", f"Archived database dump to {s3_path}")
            self.backup_to_s3(step_id=s1, step_title=t1)
            self._emit_step(s1, t1, "success")
        except Exception as e:
            self._emit_step(s1, t1, "error", str(e))
            raise

        s2, t2 = "destroy_tf", "Tearing Down AWS Cloud Resources (Terraform Destroy)"
        self._emit_step(s2, t2, "start", "terraform destroy -auto-approve")
        try:
            self._run_cmd(["terraform", "destroy", "-auto-approve"], cwd=TERRAFORM_DIR, step_id=s2, step_title=t2)
            self.backup_to_s3(step_id=s2, step_title=t2)
            self._emit_step(s2, t2, "success", "All AWS cloud resources destroyed. AWS credits preserved.")
        except Exception as e:
            self._emit_step(s2, t2, "error", str(e))
            raise

    def deploy_remote_host(self, step_id: Optional[str] = None, step_title: Optional[str] = None):
        """Executed directly on the remote EC2 host."""
        execute_remote_host_deploy(self._step_fn, step_id=step_id, step_title=step_title)

    def rollback(self, step_id: Optional[str] = None, step_title: Optional[str] = None):
        """Revert EC2 host to previous stable release image."""
        ip = self.get_public_ip()
        if not ip or not os.path.exists(KEY_FILE):
            raise RuntimeError("No active AWS host found. Run 'infra up' first.")
        s = step_id or "rollback"
        t = step_title or "Rollback Stack on AWS"
        self._emit_step(s, t, "start", f"Rolling back EC2 host {ip} to previous container release...")
        cmd = ["ssh", "-o", "StrictHostKeyChecking=no", "-i", KEY_FILE, f"ubuntu@{ip}", "cd /opt/envscale && ./envscale.sh rollback"]
        self._run_cmd(cmd, step_id=s, step_title=t)
        self._emit_step(s, t, "success", f"EC2 host {ip} successfully rolled back.")

    def deploy(self, release_sha: Optional[str] = None, mode: str = "prod", step_id: Optional[str] = None, step_title: Optional[str] = None):
        if os.path.exists("/opt/envscale") and os.path.abspath(PROJECT_ROOT) == "/opt/envscale":
            return self.deploy_remote_host(step_id=step_id, step_title=step_title)

        ip = self.get_public_ip()
        if not ip or not os.path.exists(KEY_FILE):
            raise RuntimeError("No active AWS host found. Run 'infra up' first.")
        s = step_id or "deploy"
        t = step_title or "Deploying Application Stack to AWS"

        # Resolve immutable release SHA
        sha = release_sha
        if not sha:
            try:
                sha = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=PROJECT_ROOT, text=True).strip()
            except Exception:
                sha = os.environ.get("RELEASE_SHA", "latest")

        env = self.load_deployment_env()

        # Strict Secret Validation: Refuse to proceed with empty secrets
        missing = validate_deployment_secrets(env, require_duckdns=True)
        if missing:
            raise RuntimeError(f"Deployment halted: Required secret(s) missing or empty in .env: {', '.join(missing)}.")

        if env.get("DUCKDNS_TOKEN"):
            self.sync_duckdns(ip, domain=env.get("DUCKDNS_DOMAIN"), token=env.get("DUCKDNS_TOKEN"), step_id=s, step_title=t)

        if mode == "dev":
            self._emit_step(s, t, "log", f"[DEV MODE] Syncing local workspace snapshot to {ip}:/opt/envscale/ via rsync...")
            rsync_cmd = [
                "rsync", "-avz",
                "--exclude", "node_modules",
                "--exclude", "**/node_modules",
                "--exclude", ".turbo",
                "--exclude", "**/.turbo",
                "--exclude", ".git",
                "--exclude", "dist",
                "--exclude", "**/dist",
                "--exclude", ".terraform",
                "--exclude", "**/.terraform",
                "--exclude", "apps/k8s-streamer/k8s-streamer-bin",
                "--exclude", "apps/k8s-streamer/main",
                "--exclude", ".playwright-mcp",
                "--exclude", ".codegraph",
                "-e", f'ssh -i "{KEY_FILE}" -o StrictHostKeyChecking=no',
                f"{PROJECT_ROOT}/",
                f"ubuntu@{ip}:/opt/envscale/"
            ]
            self._run_cmd(rsync_cmd, step_id=s, step_title=t)
        else:
            self._emit_step(s, t, "log", f"[PROD MODE] Committed release ({sha[:7] if len(sha)>=7 else sha}): skipping local source tree rsync.")
            # Sync only minimal compose & migration manifests
            self._run_cmd(["ssh", "-o", "StrictHostKeyChecking=no", "-i", KEY_FILE, f"ubuntu@{ip}", "mkdir -p /opt/envscale/deployment /opt/envscale/apps/api-server/src/db"], step_id=s, step_title=t)
            self._run_cmd(["scp", "-o", "StrictHostKeyChecking=no", "-i", KEY_FILE, f"{PROJECT_ROOT}/deployment/docker-compose.prod.yml", f"ubuntu@{ip}:/opt/envscale/deployment/docker-compose.prod.yml"], step_id=s, step_title=t)
            self._run_cmd(["scp", "-o", "StrictHostKeyChecking=no", "-i", KEY_FILE, f"{PROJECT_ROOT}/envscale.sh", f"ubuntu@{ip}:/opt/envscale/envscale.sh"], step_id=s, step_title=t)
            migrations_dir = f"{PROJECT_ROOT}/apps/api-server/src/db/migrations"
            if os.path.exists(migrations_dir):
                self._run_cmd(["scp", "-o", "StrictHostKeyChecking=no", "-i", KEY_FILE, "-r", migrations_dir, f"ubuntu@{ip}:/opt/envscale/apps/api-server/src/db/"], step_id=s, step_title=t)

        self._emit_step(s, t, "log", f"Dispatching deployment ({sha[:7] if len(sha)>=7 else sha}) on EC2 host via SSH...")
        remote_cmd = (
            f"cd /opt/envscale && "
            f"RELEASE_SHA='{sha}' "
            f"DUCKDNS_DOMAIN='{env.get('DUCKDNS_DOMAIN', 'envscale')}' "
            f"DUCKDNS_TOKEN='{env.get('DUCKDNS_TOKEN', '')}' "
            f"BETTER_AUTH_SECRET='{env.get('BETTER_AUTH_SECRET', '')}' "
            f"JWT_ACCESS_SECRET='{env.get('JWT_ACCESS_SECRET', '')}' "
            f"JWT_REFRESH_SECRET='{env.get('JWT_REFRESH_SECRET', '')}' "
            f"KUBECONFIG_ENCRYPTION_KEY='{env.get('KUBECONFIG_ENCRYPTION_KEY', '')}' "
            f"GOOGLE_CLIENT_ID='{env.get('GOOGLE_CLIENT_ID', '')}' "
            f"GOOGLE_CLIENT_SECRET='{env.get('GOOGLE_CLIENT_SECRET', '')}' "
            f"./envscale.sh deploy"
        )
        self._run_cmd(["ssh", "-o", "StrictHostKeyChecking=no", "-i", KEY_FILE, f"ubuntu@{ip}", remote_cmd], step_id=s, step_title=t)

        # Post-deployment live verification suite
        time.sleep(3)
        target = f"{env.get('DUCKDNS_DOMAIN')}.duckdns.org" if env.get("DUCKDNS_TOKEN") else f"{ip}.sslip.io"
        ok, errors = verify_deployment_health(target, emit=self._step_fn, step_id=s, step_title=t)
        if not ok:
            self._emit_step(s, t, "error", f"Verification failed on https://{target}: {'; '.join(errors)}")
            self._emit_step(s, t, "log", "Triggering automatic rollback on remote host...")
            self.rollback(step_id=s, step_title=t)
            raise RuntimeError(f"Deployment post-verification failed on https://{target}: {'; '.join(errors)}. Stack was automatically rolled back.")

        self._emit_step(s, t, "success", f"ONLINE at https://{target} (http://{ip})")
