"""Cloud deployment orchestration over AWS SSM (zero SSH)."""

import base64
import json
import os
import shutil
import subprocess
import time
import urllib.error
import urllib.request
from typing import Any, Callable, Dict, Optional

from .cloud_host_runner import (
    load_deployment_env,
    validate_deployment_secrets,
    verify_deployment_health,
)
from .config import PROJECT_ROOT, TERRAFORM_DIR
from .ssm_deployer import (
    DEFAULT_SECRETS_FILE,
    build_remote_deploy_commands,
    cleanup_external_references,
    resolve_and_validate_manifest,
    run_ssm_command,
    verify_runtime_instance_profile,
    wait_for_ssm_online,
)

LogCallback = Callable[[str], None]
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

    def _run_cmd(self, cmd: list, cwd: Optional[str] = None, check: bool = True, step_id: Optional[str] = None, step_title: Optional[str] = None, input_data: Optional[str] = None, display_cmd: Optional[str] = None) -> subprocess.CompletedProcess:
        cmd_str = display_cmd if display_cmd is not None else " ".join(cmd)
        if step_id and step_title:
            self._emit_step(step_id, step_title, "log", f"$ {cmd_str}")
        else:
            self._log(f"Executing: {cmd_str}")

        res = subprocess.run(cmd, cwd=cwd or PROJECT_ROOT, input=input_data, capture_output=True, text=True)
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
            if step_id and step_title:
                self._emit_step(step_id, step_title, "log", f"Creating permanent S3 Vault bucket: s3://{bucket}...")
            if region == "us-east-1":
                self._run_cmd(["aws", "s3api", "create-bucket", "--bucket", bucket, "--region", region], step_id=step_id, step_title=step_title)
            else:
                self._run_cmd([
                    "aws", "s3api", "create-bucket", "--bucket", bucket, "--region", region,
                    "--create-bucket-configuration", f"LocationConstraint={region}",
                ], step_id=step_id, step_title=step_title)
            self._run_cmd([
                "aws", "s3api", "put-bucket-versioning", "--bucket", bucket,
                "--versioning-configuration", "Status=Enabled",
            ], step_id=step_id, step_title=step_title)
        elif step_id and step_title:
            self._emit_step(step_id, step_title, "log", f"Verified S3 Vault bucket: s3://{bucket}")

    def backup_to_s3(self, step_id: Optional[str] = None, step_title: Optional[str] = None):
        """Back up Terraform state only (no SSH private key persistence)."""
        ctx = self.get_aws_context()
        bucket = ctx["s3_bucket"]
        tf_state = os.path.join(TERRAFORM_DIR, "terraform.tfstate")
        if os.path.exists(tf_state):
            self._run_cmd(["aws", "s3", "cp", tf_state, f"s3://{bucket}/state/terraform.tfstate"], step_id=step_id, step_title=step_title)

    def restore_from_s3(self, step_id: Optional[str] = None, step_title: Optional[str] = None):
        """Restore Terraform state only (zero SSH private key downloads)."""
        ctx = self.get_aws_context()
        bucket = ctx["s3_bucket"]
        tf_state = os.path.join(TERRAFORM_DIR, "terraform.tfstate")
        check_state = subprocess.run(["aws", "s3", "ls", f"s3://{bucket}/state/terraform.tfstate"], capture_output=True)
        if check_state.returncode == 0:
            self._run_cmd(["aws", "s3", "cp", f"s3://{bucket}/state/terraform.tfstate", tf_state], step_id=step_id, step_title=step_title)

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
        val = self._get_tf_outputs().get("public_ip", {}).get("value")
        return str(val).strip() if val else ""

    def get_instance_id(self) -> str:
        val = self._get_tf_outputs().get("instance_id", {}).get("value")
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
        if step_id and step_title:
            self._emit_step(step_id, step_title, "log", f"Updating DuckDNS record: {domain}.duckdns.org -> {target_ip}...")
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "EnvScale-TestCenter/1.0"})
            with urllib.request.urlopen(req, timeout=10) as resp:
                content = resp.read().decode("utf-8").strip()
                if content == "OK":
                    if step_id and step_title:
                        self._emit_step(step_id, step_title, "log", f"DuckDNS record updated to {target_ip} (OK).")
                    return True
                if step_id and step_title:
                    self._emit_step(step_id, step_title, "log", f"DuckDNS response: {content}")
                return False
        except Exception as e:
            if step_id and step_title:
                self._emit_step(step_id, step_title, "log", f"DuckDNS update request failed: {e}")
            return False

    def sync_github_secrets(self, ip: str, instance_id: Optional[str] = None, step_id: Optional[str] = None, step_title: Optional[str] = None):
        """Sync non-SSH host target secrets (EC2_HOST, EC2_INSTANCE_ID) to GitHub."""
        if shutil.which("gh"):
            auth_check = subprocess.run(["gh", "auth", "status"], capture_output=True)
            if auth_check.returncode == 0:
                if step_id and step_title:
                    self._emit_step(step_id, step_title, "log", f"Synchronizing EC2_HOST ({ip}) to GitHub Secrets...")
                self._run_cmd(["gh", "secret", "set", "EC2_HOST", "--body", ip], step_id=step_id, step_title=step_title)
                if instance_id:
                    self._run_cmd(["gh", "secret", "set", "EC2_INSTANCE_ID", "--body", instance_id], step_id=step_id, step_title=step_title)
                if step_id and step_title:
                    self._emit_step(step_id, step_title, "log", "GitHub Actions secrets updated successfully.")
                return
        if step_id and step_title:
            self._emit_step(step_id, step_title, "log", "GitHub CLI not authenticated; remember to update EC2_HOST/EC2_INSTANCE_ID secrets manually.")

    def infra_up(self):
        s1, t1 = "s1_vault", "Verifying AWS Credentials & S3 State Vault"
        self._emit_step(s1, t1, "start", "aws sts get-caller-identity && s3 vault sync")
        try:
            self.ensure_s3_vault(step_id=s1, step_title=t1)
            self.restore_from_s3(step_id=s1, step_title=t1)
            self._emit_step(s1, t1, "success")
        except Exception as e:
            self._emit_step(s1, t1, "error", str(e))
            raise

        s2, t2 = "s2_terraform", "Provisioning AWS Cloud Resources (Terraform Apply)"
        self._emit_step(s2, t2, "start", "terraform apply -auto-approve")
        try:
            verify_runtime_instance_profile(emit_fn=self._step_fn, step_id=s2, step_title=t2)
            self._run_cmd(["terraform", "init"], cwd=TERRAFORM_DIR, step_id=s2, step_title=t2)
            self._run_cmd(["terraform", "apply", "-auto-approve"], cwd=TERRAFORM_DIR, step_id=s2, step_title=t2)
            ip = self.get_public_ip()
            instance_id = self.get_instance_id()
            if not ip or not instance_id:
                raise RuntimeError("Failed to retrieve public_ip or instance_id from Terraform outputs.")
            self.backup_to_s3(step_id=s2, step_title=t2)
            self._emit_step(s2, t2, "success", f"Host Public IP: {ip} (Instance: {instance_id})")
        except Exception as e:
            self._emit_step(s2, t2, "error", str(e))
            raise

        s3, t3 = "s3_dns", "Routing DuckDNS & Updating GitHub Secrets"
        self._emit_step(s3, t3, "start", f"envscale.duckdns.org -> {ip}")
        try:
            self.sync_duckdns(ip, step_id=s3, step_title=t3)
            self.sync_github_secrets(ip, instance_id=instance_id, step_id=s3, step_title=t3)
            self._emit_step(s3, t3, "success")
        except Exception as e:
            self._emit_step(s3, t3, "error", str(e))
            raise

        s4, t4 = "s4_bootstrap", "Waiting for EC2 Host SSM Online & Cloud-Init"
        self._emit_step(s4, t4, "start", f"aws ssm wait {instance_id} /var/log/user_data.log")
        try:
            region = self.get_aws_context()["region"]
            wait_for_ssm_online(instance_id, region=region, emit_fn=self._step_fn, step_id=s4, step_title=t4)
            run_ssm_command(
                instance_id,
                [
                    "for i in $(seq 1 40); do "
                    "grep -q 'EC2 Setup Completed Successfully' /var/log/user_data.log 2>/dev/null && exit 0; "
                    "sleep 10; done; echo 'Cloud-init did not complete within timeout' >&2; exit 1"
                ],
                region=region,
                comment="Wait for cloud-init completion",
                emit_fn=self._step_fn,
                step_id=s4,
                step_title=t4,
            )
            self._emit_step(s4, t4, "success")
        except Exception as e:
            self._emit_step(s4, t4, "error", str(e))
            raise

        s5, t5 = "s5_deploy", "Deploying Containers & Verifying Health Endpoints"
        self._emit_step(s5, t5, "start", "ssm host-runtime.sh deploy")
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
            region = self.get_aws_context()["region"]
            wait_for_ssm_online(instance_id, region=region, emit_fn=self._step_fn, step_id=s1, step_title=t1)
            ip = self.get_public_ip()
            self._emit_step(s1, t1, "success", f"Host back online at {ip} ({instance_id})")
        except Exception as e:
            self._emit_step(s1, t1, "error", str(e))
            raise

        s2, t2 = "resume_sync", "Syncing DNS & Redeploying Stack"
        self._emit_step(s2, t2, "start", "Updating DuckDNS and redeploying via SSM")
        try:
            self.sync_duckdns(ip, step_id=s2, step_title=t2)
            self.sync_github_secrets(ip, instance_id=instance_id, step_id=s2, step_title=t2)
            self.deploy(step_id=s2, step_title=t2)
            self._emit_step(s2, t2, "success")
        except Exception as e:
            self._emit_step(s2, t2, "error", str(e))
            raise

    def infra_destroy(self):
        s1, t1 = "destroy_archive", "Archiving PostgreSQL Database to S3 Vault"
        self._emit_step(s1, t1, "start", "ssm pg_dump archive")
        try:
            self.ensure_s3_vault(step_id=s1, step_title=t1)
            instance_id = self.get_instance_id()
            if instance_id:
                ctx = self.get_aws_context()
                stamp = time.strftime("%Y%m%d_%H%M%S")
                s3_path = f"s3://{ctx['s3_bucket']}/database/backup_{stamp}.sql"
                try:
                    run_ssm_command(
                        instance_id,
                        [
                            "if docker ps --format '{{.Names}}' | grep -q '^envscale-postgres$'; then "
                            f"docker exec envscale-postgres pg_dump -U envscale envscale | aws s3 cp - {s3_path}; "
                            "fi"
                        ],
                        region=ctx["region"],
                        comment="Archive postgres before destroy",
                        emit_fn=self._step_fn,
                        step_id=s1,
                        step_title=t1,
                        check=False,
                    )
                except Exception:
                    pass
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
            env = self.load_deployment_env()
            cleanup_external_references(
                domain=env.get("DUCKDNS_DOMAIN"),
                token=env.get("DUCKDNS_TOKEN"),
                emit_fn=self._step_fn,
                step_id=s2,
                step_title=t2,
            )
            self._emit_step(s2, t2, "success", "All AWS cloud resources destroyed and external DNS/secrets cleaned.")
        except Exception as e:
            self._emit_step(s2, t2, "error", str(e))
            raise

    def rollback(self, step_id: Optional[str] = None, step_title: Optional[str] = None):
        """Revert EC2 host to previous stable release via SSM."""
        instance_id = self.get_instance_id()
        if not instance_id:
            raise RuntimeError("No active AWS instance found. Run 'infra up' first.")
        s = step_id or "rollback"
        t = step_title or "Rollback Stack on AWS"
        region = self.get_aws_context()["region"]
        self._emit_step(s, t, "start", f"Rolling back EC2 instance {instance_id} via SSM...")
        run_ssm_command(
            instance_id,
            [
                "set -euo pipefail",
                "cd /opt/envscale",
                f"ENVSCALE_SECRETS_FILE={DEFAULT_SECRETS_FILE} ./envscale.sh rollback",
            ],
            region=region,
            comment="EnvScale SSM rollback",
            emit_fn=self._step_fn,
            step_id=s,
            step_title=t,
        )
        self._emit_step(s, t, "success", f"EC2 instance {instance_id} successfully rolled back.")

    def deploy(
        self,
        release_sha: Optional[str] = None,
        manifest_path: Optional[str] = None,
        mode: str = "prod",
        step_id: Optional[str] = None,
        step_title: Optional[str] = None,
    ):
        instance_id = self.get_instance_id()
        ip = self.get_public_ip()
        if not instance_id:
            raise RuntimeError("No active AWS instance found. Run 'infra up' first.")
        s = step_id or "deploy"
        t = step_title or "Deploying Application Stack to AWS"

        sha = release_sha
        if not sha:
            sha = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=PROJECT_ROOT, text=True).strip()

        env = self.load_deployment_env()
        missing = [
            k for k in validate_deployment_secrets(env, require_duckdns=True)
            if k not in ("DATABASE_URL", "REDIS_URL")
        ]
        if missing:
            raise RuntimeError(f"Deployment halted: Required secret(s) missing or empty in .env: {', '.join(missing)}.")

        if ip and env.get("DUCKDNS_TOKEN"):
            self.sync_duckdns(ip, domain=env.get("DUCKDNS_DOMAIN"), token=env.get("DUCKDNS_TOKEN"), step_id=s, step_title=t)

        region = self.get_aws_context()["region"]
        manifest_file = resolve_and_validate_manifest(
            commit_sha=sha,
            manifest_path=manifest_path,
            recovery_bucket=env.get("RECOVERY_BUCKET") or os.environ.get("RECOVERY_BUCKET"),
            region=region,
        )
        manifest_b64 = base64.b64encode(manifest_file.read_bytes()).decode("ascii")
        commands = build_remote_deploy_commands(commit_sha=sha, manifest_b64=manifest_b64)

        self._emit_step(s, t, "log", f"Dispatching exact-SHA SSM deployment ({sha[:7]}) on {instance_id}...")
        run_ssm_command(
            instance_id,
            commands,
            region=region,
            comment=f"EnvScale SSM deploy {sha[:12]}",
            emit_fn=self._step_fn,
            step_id=s,
            step_title=t,
        )

        time.sleep(3)
        target = f"{env.get('DUCKDNS_DOMAIN')}.duckdns.org" if env.get("DUCKDNS_TOKEN") else f"{ip}.sslip.io"
        ok, errors = verify_deployment_health(target, emit=self._step_fn, step_id=s, step_title=t)
        if not ok:
            self._emit_step(s, t, "error", f"Verification failed on https://{target}: {'; '.join(errors)}")
            self._emit_step(s, t, "log", "Triggering automatic rollback on remote host...")
            self.rollback(step_id=s, step_title=t)
            raise RuntimeError(f"Deployment post-verification failed on https://{target}: {'; '.join(errors)}. Stack was automatically rolled back.")

        self._emit_step(s, t, "success", f"ONLINE at https://{target} ({instance_id})")
