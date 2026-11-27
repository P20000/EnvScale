"""Cloud deployment orchestration over AWS SSM (zero SSH)."""

import base64
import json
import os
import subprocess
import time
from typing import Any, Callable, Dict, List, Optional

from .cloud_host_runner import assert_runtime_state_ready_for_host_ops, load_deployment_env, verify_deployment_health
from .cloud_identity import DEFAULT_ACCOUNT_ID, DEFAULT_REGION, redact_sensitive_text, resolve_recovery_bucket
from .cloud_target_sync import is_tls_propagation_error as _is_tls_propagation_error, sync_duckdns_record, sync_github_target_secrets
from .config import PROJECT_ROOT, TERRAFORM_DIR
from .ssm_deployer import (
    DEFAULT_SECRETS_FILE, build_postgres_backup_ssm_commands, build_remote_deploy_commands,
    cleanup_external_references, extract_tfstate_deployment_identity, generate_postgres_backup_key,
    parse_postgres_backup_ssm_output, resolve_and_validate_manifest, run_ssm_command,
    verify_no_host_destroy_safety, verify_runtime_instance_profile, verify_s3_postgres_backup_object,
    verify_ssm_parameters_present, wait_for_ssm_online,
)
from .tfstate_reconciler import inspect_state_status, reconcile_terraform_state, run_managed_terraform_mutation
from .tfstate_sync import safe_backup_tfstate_to_s3, tfstate_bucket_and_key

LogCallback = Callable[[str], None]
StepCallback = Callable[[str, str, str, str], None]


class CloudDeployer:
    def __init__(
        self,
        log_fn: Optional[LogCallback] = None,
        step_fn: Optional[StepCallback] = None,
        aws_env: Optional[Dict[str, str]] = None,
    ):
        self._log = log_fn or (lambda msg: print(f"[CloudDeployer] {msg}"))
        self._step_fn = step_fn or (lambda sid, title, status, detail: None)
        self._aws_env = aws_env

    def _env_kw(self) -> Dict[str, Any]:
        return {"env": self._aws_env} if self._aws_env is not None else {}

    def _emit_step(self, step_id: str, title: str, status: str, detail: str = ""):
        safe = redact_sensitive_text(detail)
        self._step_fn(step_id, title, status, safe)
        if safe and status == "log":
            self._log(f"[{title}] {safe}")
        elif status == "start":
            self._log(f"Starting step: {title} ({safe})")
        elif status == "success":
            self._log(f"Completed step: {title}")
        elif status == "error":
            self._log(f"Failed step: {title} - {safe}")

    def _run_cmd(self, cmd: list, cwd: Optional[str] = None, check: bool = True, step_id: Optional[str] = None, step_title: Optional[str] = None, input_data: Optional[str] = None, display_cmd: Optional[str] = None) -> subprocess.CompletedProcess:
        cmd_str = display_cmd if display_cmd is not None else " ".join(cmd)
        if step_id and step_title:
            self._emit_step(step_id, step_title, "log", f"$ {cmd_str}")
        else:
            self._log(f"Executing: {cmd_str}")

        res = subprocess.run(cmd, cwd=cwd or PROJECT_ROOT, input=input_data, capture_output=True, text=True, **self._env_kw())
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
        res = subprocess.run(["aws", "sts", "get-caller-identity", "--output", "json"], capture_output=True, text=True, **self._env_kw())
        if res.returncode != 0:
            raise RuntimeError("AWS CLI credentials not configured or expired. Run 'aws configure'.")
        data = json.loads(res.stdout)
        account_id = data.get("Account", "")
        reg_res = subprocess.run(["aws", "configure", "get", "region"], capture_output=True, text=True, **self._env_kw())
        region = (self._aws_env or {}).get("AWS_REGION") or reg_res.stdout.strip() or DEFAULT_REGION
        env_cfg = self.load_deployment_env()
        bucket = resolve_recovery_bucket(
            account_id=account_id,
            region=region,
            configured_bucket=env_cfg.get("RECOVERY_BUCKET") or os.environ.get("RECOVERY_BUCKET"),
        )
        return {"account_id": account_id, "region": region, "s3_bucket": bucket, "recovery_bucket": bucket}

    def ensure_s3_vault(self, step_id: Optional[str] = None, step_title: Optional[str] = None):
        """Verify canonical Persistent Foundation recovery bucket exists (never creates legacy buckets)."""
        ctx = self.get_aws_context()
        bucket = ctx["s3_bucket"]
        region = ctx["region"]
        check = subprocess.run(
            ["aws", "s3api", "get-bucket-location", "--bucket", bucket, "--region", region],
            capture_output=True, text=True, **self._env_kw(),
        )
        if check.returncode != 0:
            err = (check.stderr or check.stdout or "Bucket unreachable").strip()
            raise RuntimeError(
                f"Canonical recovery bucket 's3://{bucket}' is not accessible ({err}). "
                "Apply Persistent Foundation via foundation.yml before runtime operations."
            )
        if step_id and step_title:
            self._emit_step(step_id, step_title, "log", f"Verified canonical recovery bucket: s3://{bucket}")

    def _tfstate_s3_uri(self, ctx: Dict[str, str]) -> str:
        acct = (ctx.get("account_id") or DEFAULT_ACCOUNT_ID).strip() or DEFAULT_ACCOUNT_ID
        reg = (ctx.get("region") or DEFAULT_REGION).strip() or DEFAULT_REGION
        bucket, key = tfstate_bucket_and_key(acct, reg)
        return f"s3://{bucket}/{key}"

    def _tfstate_kwargs(self, step_id: Optional[str], step_title: Optional[str]) -> Dict[str, Any]:
        ctx = self.get_aws_context()
        return {
            "local_path": os.path.join(TERRAFORM_DIR, "terraform.tfstate"),
            "account_id": (ctx.get("account_id") or DEFAULT_ACCOUNT_ID).strip() or DEFAULT_ACCOUNT_ID,
            "region": (ctx.get("region") or DEFAULT_REGION).strip() or DEFAULT_REGION,
            "aws_env": self._aws_env, "emit_fn": self._emit_step, "step_id": step_id, "step_title": step_title,
        }

    def backup_to_s3(self, step_id: Optional[str] = None, step_title: Optional[str] = None):
        """Validate local state and upload manual S3 tfstate backup copy safely."""
        return safe_backup_tfstate_to_s3(run_cmd_fn=self._run_cmd, **self._tfstate_kwargs(step_id, step_title))

    def restore_from_s3(self, step_id: Optional[str] = None, step_title: Optional[str] = None):
        """Reconcile local and S3 tfstate via centralized preflight and pending-sync recovery."""
        return self.reconcile_state(allow_adopt_remote=True, operation_type="restore", step_id=step_id, step_title=step_title)

    def inspect_state_sync(self) -> Dict[str, Any]:
        kw = self._tfstate_kwargs(None, None)
        return inspect_state_status(local_path=kw["local_path"], account_id=kw["account_id"], region=kw["region"], aws_env=self._aws_env)

    def reconcile_state(
        self,
        *,
        allow_adopt_remote: bool = False,
        allow_promote_local: bool = False,
        operation_type: str = "reconcile",
        step_id: Optional[str] = None,
        step_title: Optional[str] = None,
    ) -> Dict[str, Any]:
        kw = self._tfstate_kwargs(step_id, step_title)
        return reconcile_terraform_state(
            local_path=kw["local_path"], account_id=kw["account_id"], region=kw["region"],
            operation_type=operation_type, auto_resume_pending=True,
            allow_adopt_remote=allow_adopt_remote, allow_promote_local=allow_promote_local,
            aws_env=self._aws_env, emit_fn=self._emit_step, step_id=step_id, step_title=step_title,
        )

    def _run_managed_tf(
        self, operation_type: str, commands: List[List[str]], *,
        allow_adopt_remote: bool = False, auto_resume_pending: bool = False,
        step_id: Optional[str] = None, step_title: Optional[str] = None,
    ) -> Dict[str, Any]:
        kw = self._tfstate_kwargs(step_id, step_title)
        return run_managed_terraform_mutation(
            operation_type=operation_type, tf_commands=commands, cwd=TERRAFORM_DIR,
            local_path=kw["local_path"], account_id=kw["account_id"], region=kw["region"], aws_env=self._aws_env,
            exec_tf_fn=lambda cmd: self._run_cmd(cmd, cwd=TERRAFORM_DIR, step_id=step_id, step_title=step_title),
            allow_adopt_remote=allow_adopt_remote, auto_resume_pending=auto_resume_pending,
            emit_fn=self._emit_step, step_id=step_id, step_title=step_title,
        )

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
        return sync_duckdns_record(
            target_ip, domain or env.get("DUCKDNS_DOMAIN", "envscale"), token or env.get("DUCKDNS_TOKEN", ""),
            emit_step=self._emit_step, log_fn=self._log, step_id=step_id, step_title=step_title,
        )

    def sync_github_secrets(self, ip: str, instance_id: Optional[str] = None, step_id: Optional[str] = None, step_title: Optional[str] = None):
        """Sync non-SSH host target secrets (EC2_HOST, EC2_INSTANCE_ID) to GitHub."""
        sync_github_target_secrets(
            ip, instance_id, run_cmd=self._run_cmd, emit_step=self._emit_step, step_id=step_id, step_title=step_title,
        )

    def provision_host(self) -> Dict[str, str]:
        """Provision AWS runtime EC2 host, sync DNS/GitHub targets, and await SSM/cloud-init."""
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
            verify_runtime_instance_profile(emit_fn=self._step_fn, step_id=s2, step_title=t2, aws_env=self._aws_env)
            self._run_managed_tf(
                "apply",
                [["terraform", "init"], ["terraform", "apply", "-auto-approve"]],
                allow_adopt_remote=True,
                step_id=s2,
                step_title=t2,
            )
            ip = self.get_public_ip()
            instance_id = self.get_instance_id()
            if not ip or not instance_id:
                raise RuntimeError("Failed to retrieve public_ip or instance_id from Terraform outputs.")
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
            wait_for_ssm_online(instance_id, region=region, emit_fn=self._step_fn, step_id=s4, step_title=t4, aws_env=self._aws_env)
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
                aws_env=self._aws_env,
            )
            self._emit_step(s4, t4, "success")
        except Exception as e:
            self._emit_step(s4, t4, "error", str(e))
            raise

        return {"ip": ip, "instance_id": instance_id}

    def infra_up(self, release_sha: Optional[str] = None, manifest_path: Optional[str] = None) -> Dict[str, str]:
        info = self.provision_host()
        s5, t5 = "s5_deploy", "Deploying Containers & Verifying Health Endpoints"
        self._emit_step(s5, t5, "start", "ssm host-runtime.sh deploy")
        try:
            self.deploy(release_sha=release_sha, manifest_path=manifest_path, step_id=s5, step_title=t5)
            self._emit_step(s5, t5, "success", f"ONLINE at https://{info['ip']}.sslip.io (http://{info['ip']})")
        except Exception as e:
            self._emit_step(s5, t5, "error", str(e))
            raise
        return info

    def infra_stop(self):
        assert_runtime_state_ready_for_host_ops(os.path.join(TERRAFORM_DIR, "terraform.tfstate"))
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
        assert_runtime_state_ready_for_host_ops(os.path.join(TERRAFORM_DIR, "terraform.tfstate"))
        s1, t1 = "resume_instance", "Resuming AWS EC2 Instance"
        instance_id = self.get_instance_id()
        if not instance_id:
            raise RuntimeError("No instance ID found in Terraform state.")
        self._emit_step(s1, t1, "start", f"aws ec2 start-instances --instance-ids {instance_id}")
        try:
            self._run_cmd(["aws", "ec2", "start-instances", "--instance-ids", instance_id], step_id=s1, step_title=t1)
            region = self.get_aws_context()["region"]
            wait_for_ssm_online(instance_id, region=region, emit_fn=self._step_fn, step_id=s1, step_title=t1, aws_env=self._aws_env)
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
        self._emit_step(s1, t1, "start", "ssm pg_dump archive & s3api head-object verification")
        try:
            self.ensure_s3_vault(step_id=s1, step_title=t1)
            ctx = self.get_aws_context()
            account_id = (ctx.get("account_id") or DEFAULT_ACCOUNT_ID).strip()
            region = (ctx.get("region") or DEFAULT_REGION).strip()
            bucket = resolve_recovery_bucket(
                account_id=account_id, region=region,
                configured_bucket=ctx.get("recovery_bucket") or ctx.get("s3_bucket"),
            )
            tf_state = os.path.join(TERRAFORM_DIR, "terraform.tfstate")
            instance_id = self.get_instance_id()
            if instance_id:
                dep_ident = extract_tfstate_deployment_identity(tf_state) if os.path.isfile(tf_state) else {}
                backup_key = generate_postgres_backup_key(instance_id)
                ssm_res = run_ssm_command(
                    instance_id,
                    build_postgres_backup_ssm_commands(
                        bucket, backup_key, region=region, instance_id=instance_id,
                        tf_lineage=dep_ident.get("tf_lineage", ""), vpc_id=dep_ident.get("vpc_id", ""),
                        release_id=dep_ident.get("release_id", ""), commit_sha=dep_ident.get("commit_sha", ""),
                    ),
                    region=region, comment="Archive and validate postgres before destroy",
                    emit_fn=self._step_fn, step_id=s1, step_title=t1, check=True, aws_env=self._aws_env,
                )
                if ssm_res.returncode != 0:
                    raise RuntimeError(ssm_res.stderr or f"SSM PostgreSQL backup failed (code {ssm_res.returncode})")
                dump_meta = parse_postgres_backup_ssm_output(ssm_res.stdout or "", expected_bucket=bucket, expected_key=backup_key)
                verified = verify_s3_postgres_backup_object(
                    bucket=bucket, backup_key=backup_key, region=region,
                    expected_size=dump_meta["size"], expected_sha256=dump_meta["sha256"],
                    aws_env=self._aws_env, run_fn=subprocess.run,
                )
            else:
                verified = verify_no_host_destroy_safety(
                    tf_state_path=tf_state,
                    bucket=bucket, region=region, aws_env=self._aws_env, run_fn=subprocess.run,
                )
            self._emit_step(s1, t1, "log", f"Verified S3 backup s3://{bucket}/{verified['key']} ({verified['content_length']} bytes).")
            self._emit_step(s1, t1, "success")
        except Exception as e:
            self._emit_step(s1, t1, "error", str(e))
            raise

        s2, t2 = "destroy_tf", "Tearing Down AWS Cloud Resources (Terraform Destroy)"
        self._emit_step(s2, t2, "start", "terraform destroy -auto-approve")
        try:
            self._run_managed_tf(
                "destroy",
                [["terraform", "destroy", "-auto-approve"]],
                allow_adopt_remote=False,
                step_id=s2,
                step_title=t2,
            )
            env = self.load_deployment_env()
            cleanup_external_references(
                domain=env.get("DUCKDNS_DOMAIN"), token=env.get("DUCKDNS_TOKEN"),
                emit_fn=self._step_fn, step_id=s2, step_title=t2,
            )
            self._emit_step(s2, t2, "success", "All AWS cloud resources destroyed and external DNS/secrets cleaned.")
            return verified
        except Exception as e:
            self._emit_step(s2, t2, "error", str(e))
            raise

    def rollback(self, step_id: Optional[str] = None, step_title: Optional[str] = None):
        """Revert EC2 host to previous stable release via SSM."""
        assert_runtime_state_ready_for_host_ops(os.path.join(TERRAFORM_DIR, "terraform.tfstate"))
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
            aws_env=self._aws_env,
        )
        self._emit_step(s, t, "success", f"EC2 instance {instance_id} successfully rolled back.")

    def deploy(
        self,
        release_sha: Optional[str] = None,
        manifest_path: Optional[str] = None,
        mode: str = "prod",
        step_id: Optional[str] = None,
        step_title: Optional[str] = None,
        auto_rollback: bool = True,
        tls_retry_attempts: int = 6,
        tls_retry_delay_s: int = 10,
    ):
        assert_runtime_state_ready_for_host_ops(os.path.join(TERRAFORM_DIR, "terraform.tfstate"))
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
        aws_ctx = self.get_aws_context()
        region = aws_ctx["region"]
        verify_ssm_parameters_present(region=region, aws_env=self._aws_env, emit_fn=self._step_fn, step_id=s, step_title=t)

        if ip and env.get("DUCKDNS_TOKEN"):
            self.sync_duckdns(ip, domain=env.get("DUCKDNS_DOMAIN"), token=env.get("DUCKDNS_TOKEN"), step_id=s, step_title=t)
        elif ip:
            self._emit_step(s, t, "log", "Skipping local DuckDNS sync; EC2 runtime syncs DuckDNS from SSM /envscale/prod/duckdns_token.")

        manifest_file = resolve_and_validate_manifest(
            commit_sha=sha, manifest_path=manifest_path,
            recovery_bucket=aws_ctx.get("recovery_bucket") or aws_ctx.get("s3_bucket"),
            region=region, aws_env=self._aws_env,
        )
        manifest_b64 = base64.b64encode(manifest_file.read_bytes()).decode("ascii")
        commands = build_remote_deploy_commands(commit_sha=sha, manifest_b64=manifest_b64, region=region)

        self._emit_step(s, t, "log", f"Dispatching exact-SHA SSM deployment ({sha[:7]}) on {instance_id}...")
        run_ssm_command(
            instance_id, commands, region=region, comment=f"EnvScale SSM deploy {sha[:12]}",
            emit_fn=self._step_fn, step_id=s, step_title=t, aws_env=self._aws_env,
        )

        time.sleep(3)
        tf_app_url = str(self._get_tf_outputs().get("app_url", {}).get("value") or "").strip()
        duck_dom = env.get("DUCKDNS_DOMAIN", "").strip()
        if tf_app_url.startswith("https://"):
            target = tf_app_url[len("https://"):].split("/", 1)[0]
        elif duck_dom:
            target = duck_dom if duck_dom.endswith(".duckdns.org") else f"{duck_dom}.duckdns.org"
        else:
            target = f"{ip}.sslip.io"
        ok, errors = verify_deployment_health(target, emit=self._step_fn, step_id=s, step_title=t)
        attempts = max(1, tls_retry_attempts)
        for attempt in range(1, attempts):
            if ok or not _is_tls_propagation_error(errors):
                break
            self._emit_step(s, t, "log", f"Waiting {tls_retry_delay_s}s for initial TLS certificate propagation (attempt {attempt + 1}/{attempts})...")
            time.sleep(tls_retry_delay_s)
            ok, errors = verify_deployment_health(target, emit=self._step_fn, step_id=s, step_title=t)

        if not ok:
            self._emit_step(s, t, "error", f"Verification failed on https://{target}: {'; '.join(errors)}")
            if auto_rollback:
                self._emit_step(s, t, "log", "Triggering automatic rollback on remote host...")
                try:
                    self.rollback(step_id=s, step_title=t)
                except Exception as rb_err:
                    self._emit_step(s, t, "log", f"Notice: automatic rollback did not complete ({rb_err}).")
            raise RuntimeError(f"Deployment post-verification failed on https://{target}: {'; '.join(errors)}.")

        self._emit_step(s, t, "success", f"ONLINE at https://{target} ({instance_id})")
