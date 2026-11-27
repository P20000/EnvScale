"""Resumable 7-stage Test Center orchestration engine and non-sensitive state store."""

from __future__ import annotations

import json
import os
import pathlib
import subprocess
from dataclasses import dataclass
from typing import Any, Callable, Dict, Optional

from .cloud_deployer import CloudDeployer
from .cloud_host_runner import assert_runtime_state_ready_for_host_ops, load_deployment_env
from .cloud_identity import (
    ADMIN_ROLE_NAME,
    DEFAULT_ACCOUNT_ID,
    DEFAULT_REGION,
    RUNTIME_PROVISIONER_ROLE_NAME,
    AwsSessionContext,
    build_profile_env,
    inspect_aws_identity,
    load_ram_runtime_session,
    redact_sensitive_text,
    verify_session_caller_identity,
)
from .cloud_ops_dashboard import fetch_ops_snapshot, resolve_app_url
from .cloud_pipeline_state import (
    ALLOWED_CONTEXT_KEYS,
    DEPLOY_UI_STAGES,
    EXECUTION_PHASES,
    STAGE_DEFINITIONS,
    STAGE_IDS,
    ExecutionTracker,
    PipelineStateStore,
    build_failure_info,
)
from .cloud_preflight import (
    AdminSessionCallback,
    ApprovalCallback,
    SecretsInputCallback,
    run_preflight,
)
from .cloud_stages import (
    run_foundation_stage,
    run_release_stage,
    run_secrets_stage,
)
from .config import PROJECT_ROOT

StepCallback = Optional[Callable[[str, str, str, str], None]]
LogCallback = Optional[Callable[[str], None]]
ProgressCallback = Optional[Callable[[Dict[str, Any]], None]]


@dataclass
class OrchestratorCallbacks:
    on_approval: ApprovalCallback = None
    on_mfa_session: AdminSessionCallback = None
    on_runtime_mfa_session: AdminSessionCallback = None
    on_secrets_input: SecretsInputCallback = None
    on_progress: ProgressCallback = None


class CloudOrchestrator:
    """Single control-plane coordinator for EnvScale's deployment, destruction, and foundation lifecycles."""

    def __init__(
        self,
        runtime_profile: Optional[str] = None,
        admin_session: Optional[AwsSessionContext] = None,
        runtime_session: Optional[AwsSessionContext] = None,
        state_store: Optional[PipelineStateStore] = None,
        step_fn: StepCallback = None,
        log_fn: LogCallback = None,
        allow_ram_handoff: bool = True,
        progress_fn: ProgressCallback = None,
    ):
        self.state_store = state_store or PipelineStateStore()
        saved_profile = self.state_store.load().get("context", {}).get("runtime_profile")
        self.runtime_profile = runtime_profile if runtime_profile is not None else (saved_profile or None)
        self.admin_session = admin_session
        self.runtime_session = runtime_session
        self.step_fn = step_fn
        self.log_fn = log_fn
        self.allow_ram_handoff = allow_ram_handoff
        self.progress_fn = progress_fn
        self.execution_state: Dict[str, Any] = ExecutionTracker("deploy").snapshot()

    def _make_tracker(self, workflow: str, cb: Optional[OrchestratorCallbacks] = None) -> ExecutionTracker:
        def _emit_progress(snap: Dict[str, Any]) -> None:
            self.execution_state = snap
            if self.progress_fn:
                self.progress_fn(snap)
            if cb and cb.on_progress:
                cb.on_progress(snap)

        return ExecutionTracker(workflow=workflow, progress_fn=_emit_progress)

    def _emit_step(self, step_id: str, title: str, status: str, detail: str = "") -> None:
        safe = redact_sensitive_text(detail)
        if self.step_fn:
            self.step_fn(step_id, title, status, safe)
        if self.log_fn and safe:
            self.log_fn(f"[{title}] {safe}")

    def set_runtime_profile(self, profile: Optional[str]) -> None:
        self.runtime_profile = profile or None
        self.state_store.update_context(runtime_profile=self.runtime_profile or "")

    def get_runtime_aws_env(self) -> Optional[Dict[str, str]]:
        """Return verified runtime provisioner STS env when active, else profile env for read-only inspection."""
        if (
            isinstance(self.runtime_session, AwsSessionContext)
            and not self.runtime_session.is_expired()
            and self.runtime_session.role_arn.endswith(f":role/{RUNTIME_PROVISIONER_ROLE_NAME}")
        ):
            return self.runtime_session.build_env()
        return build_profile_env(self.runtime_profile) if self.runtime_profile else None

    def _require_verified_runtime_env(
        self,
        cb: OrchestratorCallbacks,
        *,
        account_id: str = DEFAULT_ACCOUNT_ID,
        region: str = DEFAULT_REGION,
    ) -> Dict[str, str]:
        """Fail-closed runtime authorization: require verified MFA-assumed envscale-runtime-provisioner-role."""
        session = self.runtime_session
        if session is not None:
            # Explicit role separation: never accept Foundation admin or other role as runtime provisioner.
            if not session.role_arn.endswith(f":role/{RUNTIME_PROVISIONER_ROLE_NAME}") or f":assumed-role/{RUNTIME_PROVISIONER_ROLE_NAME}/" not in session.caller_arn:
                raise RuntimeError(
                    f"Role separation violation: runtime operations require '{RUNTIME_PROVISIONER_ROLE_NAME}', "
                    f"not '{session.role_arn or session.caller_arn}'. Never reuse '{ADMIN_ROLE_NAME}' for runtime provisioning."
                )
            if session.is_expired():
                if cb.on_runtime_mfa_session is None:
                    raise RuntimeError(f"STS session for '{RUNTIME_PROVISIONER_ROLE_NAME}' has expired; re-assume with TOTP MFA.")
                session = None

        if session is None and self.allow_ram_handoff:
            session = load_ram_runtime_session(account_id=account_id, region=region, verify_caller=True)

        if session is None and cb.on_runtime_mfa_session is not None:
            session = cb.on_runtime_mfa_session()
            if session is None:
                raise RuntimeError(f"MFA role assumption for '{RUNTIME_PROVISIONER_ROLE_NAME}' failed or was cancelled.")

        if session is not None:
            verify_session_caller_identity(session, expected_role_name=RUNTIME_PROVISIONER_ROLE_NAME, expected_account_id=account_id, expected_region=region)
            sess_env = session.build_env()
            ident = inspect_aws_identity(aws_env=sess_env)
            if ident.get("bootstrap_deny_active"):
                raise RuntimeError(
                    ident.get("deny_explanation")
                    or "Unresolved bootstrap_deny_active detected on runtime session; refusing to proceed."
                )
            self.runtime_session = session
            return sess_env

        profile_env = build_profile_env(self.runtime_profile) if self.runtime_profile else None
        ident = inspect_aws_identity(aws_env=profile_env, profile=self.runtime_profile)
        if not ident.get("authenticated"):
            raise RuntimeError(ident.get("error", "AWS identity not authenticated for runtime provisioning."))
        from .cloud_demo_flow import check_role_exists_for_mfa
        check_role_exists_for_mfa(ident, RUNTIME_PROVISIONER_ROLE_NAME)
        if ident.get("bootstrap_deny_active"):
            raise RuntimeError(
                ident.get("deny_explanation")
                or f"Active AWS identity has explicit bootstrap denies on EC2/SSM. Assume '{RUNTIME_PROVISIONER_ROLE_NAME}' with TOTP MFA."
            )
        if ident.get("account_id") != account_id or ident.get("region") != region:
            raise RuntimeError(
                f"Active AWS scope (account={ident.get('account_id')}, region={ident.get('region')}) "
                f"does not match required ({account_id}, {region})."
            )
        active_arn = str(ident.get("arn") or "")
        if f":{account_id}:assumed-role/{RUNTIME_PROVISIONER_ROLE_NAME}/" not in active_arn:
            raise RuntimeError(
                f"Runtime stages require MFA-assumed '{RUNTIME_PROVISIONER_ROLE_NAME}' "
                f"(active caller: '{active_arn}'). Never substitute '{ADMIN_ROLE_NAME}' or a raw IAM user."
            )
        return profile_env if profile_env is not None else dict(os.environ, AWS_REGION=region, AWS_DEFAULT_REGION=region)

    def run_stage(
        self,
        stage_id: str,
        callbacks: Optional[OrchestratorCallbacks] = None,
        **opts: Any,
    ) -> Dict[str, Any]:
        if stage_id not in STAGE_IDS:
            raise ValueError(f"Unknown stage '{stage_id}'. Valid stages: {', '.join(STAGE_IDS)}")

        cb = callbacks or OrchestratorCallbacks()
        self.state_store.update_stage(stage_id, "running")
        try:
            res = self._dispatch_stage(stage_id, cb, opts)
        except Exception as exc:
            msg = redact_sensitive_text(str(exc))
            self.state_store.update_stage(stage_id, "failed", error=msg)
            raise

        status = res.get("status", "completed")
        if status in ("needs_approval", "needs_mfa"):
            self.state_store.update_stage(stage_id, status, summary=res.get("summary", status))
        else:
            self.state_store.update_stage(stage_id, "completed", summary=res.get("summary", "Completed"))
        return res

    def _dispatch_stage(self, stage_id: str, cb: OrchestratorCallbacks, opts: Dict[str, Any]) -> Dict[str, Any]:
        runtime_env = self.get_runtime_aws_env()
        ctx = self.state_store.load().get("context", {})

        if stage_id == "preflight":
            report = run_preflight(
                runtime_profile=self.runtime_profile,
                admin_session=self.admin_session,
                runtime_session=self.runtime_session,
                step_fn=self.step_fn,
                log_fn=self.log_fn,
            )
            fail_count = sum(1 for c in report["checks"] if c["status"] == "fail")
            if fail_count:
                report["summary"] = f"{fail_count} preflight failure(s) detected"
            else:
                report["summary"] = f"Preflight complete ({len(report['checks'])} checks)"
            return report

        if stage_id == "foundation":
            res = run_foundation_stage(
                ref=opts.get("ref", "develop"),
                plan_mode=opts.get("plan_mode", "auto"),
                plan_only=bool(opts.get("plan_only", False)),
                account_id=opts.get("account_id", DEFAULT_ACCOUNT_ID),
                aws_env=runtime_env,
                approval_cb=cb.on_approval,
                step_fn=self.step_fn,
                log_fn=self.log_fn,
            )
            run_id = res.get("apply_run_id") or res.get("plan_run_id")
            if run_id:
                self.state_store.update_context(foundation_run_id=run_id)
            res.setdefault("summary", f"Foundation {res.get('status', 'completed')}")
            return res

        if stage_id == "secrets":
            res = run_secrets_stage(
                admin_session=self.admin_session,
                ensure_admin_session_cb=cb.on_mfa_session,
                secrets_input_cb=cb.on_secrets_input,
                dry_run=bool(opts.get("dry_run", False)),
                force_prompt=bool(opts.get("force_prompt", False)),
                kubeconfig_key_disposition=opts.get("kubeconfig_key_disposition", "generate-fresh-no-historical-ciphertext"),
                account_id=opts.get("account_id", DEFAULT_ACCOUNT_ID),
                region=opts.get("region", DEFAULT_REGION),
                step_fn=self.step_fn,
                log_fn=self.log_fn,
            )
            if isinstance(res.get("admin_session"), AwsSessionContext):
                self.admin_session = res.pop("admin_session")
            res.setdefault("summary", f"Secrets {res.get('status', 'completed')} ({res.get('seeded_count', 0)}/9)")
            return res

        if stage_id == "release":
            res = run_release_stage(
                run_id=opts.get("run_id"),
                target_sha=opts.get("target_sha"),
                branch=opts.get("branch", "develop"),
                step_fn=self.step_fn,
                log_fn=self.log_fn,
            )
            self.state_store.update_context(
                target_sha=res["commit_sha"],
                release_id=res["release_id"],
                manifest_path=res["manifest_path"],
                cd_run_id=res["cd_run_id"],
            )
            res["summary"] = f"{res['release_id']} ({res['commit_sha'][:7]})"
            return res

        if stage_id == "provision":
            verified_env = self._require_verified_runtime_env(
                cb,
                account_id=opts.get("account_id", DEFAULT_ACCOUNT_ID),
                region=opts.get("region", DEFAULT_REGION),
            )
            deployer = CloudDeployer(log_fn=self.log_fn, step_fn=self.step_fn, aws_env=verified_env)
            info = deployer.provision_host()
            self.state_store.update_context(instance_id=info["instance_id"], public_ip=info["ip"])
            return {"status": "completed", **info, "summary": f"EC2 {info['instance_id']} ({info['ip']}) ready"}

        if stage_id == "deploy":
            verified_env = self._require_verified_runtime_env(
                cb,
                account_id=opts.get("account_id", DEFAULT_ACCOUNT_ID),
                region=opts.get("region", DEFAULT_REGION),
            )
            target_sha = opts.get("target_sha") or ctx.get("target_sha")
            manifest_path = opts.get("manifest_path") or ctx.get("manifest_path")
            if not manifest_path:
                default_manifest = pathlib.Path(PROJECT_ROOT) / "release-manifest.json"
                if default_manifest.is_file():
                    manifest_path = str(default_manifest)
            if not target_sha and manifest_path and pathlib.Path(manifest_path).is_file():
                target_sha = json.loads(pathlib.Path(manifest_path).read_text(encoding="utf-8")).get("git", {}).get("commit_sha")
            if not target_sha:
                target_sha = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=PROJECT_ROOT, text=True).strip()

            deployer = CloudDeployer(log_fn=self.log_fn, step_fn=self.step_fn, aws_env=verified_env)
            deployer.deploy(release_sha=target_sha, manifest_path=manifest_path, step_id="stage_deploy", step_title="Stage 6: Deploy Application Stack")
            env_cfg = load_deployment_env()
            ip = deployer.get_public_ip()
            instance_id = deployer.get_instance_id()
            domain = env_cfg.get("DUCKDNS_DOMAIN", "envscale")
            app_url = resolve_app_url(deployer, env_cfg, live_ip=ip)
            self.state_store.update_context(instance_id=instance_id, public_ip=ip, domain=domain, app_url=app_url, target_sha=target_sha, manifest_path=manifest_path)
            return {"status": "completed", "app_url": app_url, "instance_id": instance_id, "public_ip": ip, "summary": f"Live at {app_url}"}

        # stage_id == "verify"
        assert_runtime_state_ready_for_host_ops()
        self._emit_step("stage_verify", "Stage 7: Operations Health Verify", "start", "Checking EC2, SSM, containers, and HTTPS")
        verified_env = self._require_verified_runtime_env(
            cb,
            account_id=opts.get("account_id", DEFAULT_ACCOUNT_ID),
            region=opts.get("region", DEFAULT_REGION),
        )
        snap = fetch_ops_snapshot(aws_env=verified_env, step_fn=self.step_fn, include_http_health=True)
        health = snap.get("health", {})
        ec2_state = snap.get("ec2", {}).get("state")
        ssm_ping = snap.get("ssm", {}).get("ping_status")
        if snap.get("aws_error"):
            self._emit_step("stage_verify", "Stage 7: Operations Health Verify", "error", snap["aws_error"])
            raise RuntimeError(snap["aws_error"])
        if ec2_state != "running" or ssm_ping != "Online" or not health.get("ok"):
            err = "; ".join(health.get("errors") or []) or snap.get("ec2", {}).get("error") or snap.get("ssm", {}).get("error") or f"ec2={ec2_state}, ssm={ssm_ping}"
            self._emit_step("stage_verify", "Stage 7: Operations Health Verify", "error", err)
            raise RuntimeError(f"Live verification failed: {err}")
        app_url = health.get("target_url", "")
        if app_url:
            self.state_store.update_context(app_url=app_url)
        self._emit_step("stage_verify", "Stage 7: Operations Health Verify", "success", f"Verified {app_url}")
        return {"status": "completed", "snapshot": snap, "app_url": app_url, "summary": f"Healthy at {app_url}"}

    def run_pipeline(
        self,
        start_stage: Optional[str] = None,
        resume: bool = True,
        callbacks: Optional[OrchestratorCallbacks] = None,
        **opts: Any,
    ) -> Dict[str, Any]:
        """Run the 7-stage Provision & Deploy pipeline sequentially with stage-level resumption."""
        if start_stage and start_stage not in STAGE_IDS:
            raise ValueError(f"Unknown start_stage '{start_stage}'")

        start_idx = STAGE_IDS.index(start_stage) if start_stage else 0
        state = self.state_store.load()
        results: Dict[str, Any] = {}

        for sid in STAGE_IDS[start_idx:]:
            prior_status = state["stages"].get(sid, {}).get("status")
            if resume and sid != "preflight" and prior_status == "completed":
                results[sid] = {"status": "skipped", "summary": "Already completed"}
                continue
            res = self.run_stage(sid, callbacks=callbacks, **opts)
            results[sid] = res
            if res.get("status") in ("needs_approval", "needs_mfa"):
                return {"status": res["status"], "stopped_at": sid, "results": results, "state": self.state_store.load()}
            if sid == "preflight" and any(c["status"] == "fail" for c in res.get("checks", [])):
                return {"status": "blocked", "stopped_at": "preflight", "results": results, "state": self.state_store.load()}

        return {"status": "completed", "stopped_at": None, "results": results, "state": self.state_store.load()}

    def deploy_environment(self, callbacks: Optional[OrchestratorCallbacks] = None, **opts: Any) -> Dict[str, Any]:
        """Single unified deployment entry point: auth -> preflight -> release -> tfstate -> provision/start -> deploy -> verify."""
        from .cloud_demo_flow import execute_deploy_environment
        return execute_deploy_environment(self, callbacks or OrchestratorCallbacks(), **opts)

    def destroy_environment(self, callbacks: Optional[OrchestratorCallbacks] = None, **opts: Any) -> Dict[str, Any]:
        """Single unified destruction entry point with target, backup, state, and cleanup safeguards."""
        from .cloud_lifecycle import execute_destroy_environment
        return execute_destroy_environment(self, callbacks or OrchestratorCallbacks(), **opts)

    def initialize_foundation(self, callbacks: Optional[OrchestratorCallbacks] = None, **opts: Any) -> Dict[str, Any]:
        """One-time administrative Foundation & SSM secrets setup workflow (separate from runtime deploy)."""
        from .cloud_lifecycle import execute_initialize_foundation
        return execute_initialize_foundation(self, callbacks or OrchestratorCallbacks(), **opts)

    def deploy_demo(self, callbacks: Optional[OrchestratorCallbacks] = None, **opts: Any) -> Dict[str, Any]:
        """Compatibility wrapper around deploy_environment(raise_on_error=True)."""
        opts.setdefault("raise_on_error", True)
        return self.deploy_environment(callbacks=callbacks, **opts)

    def destroy_runtime(self, callbacks: Optional[OrchestratorCallbacks] = None, **opts: Any) -> Dict[str, Any]:
        """Execute fail-closed infrastructure destruction and synchronize PipelineStateStore."""
        from .cloud_lifecycle import run_destroy_lifecycle
        return run_destroy_lifecycle(self, callbacks or OrchestratorCallbacks(), **opts)

    def restore_database(
        self,
        callbacks: Optional[OrchestratorCallbacks] = None,
        backup_key: Optional[str] = None,
        skip_verify: bool = False,
        **opts: Any,
    ) -> Dict[str, Any]:
        """Restore a PostgreSQL backup from S3 onto the active runtime host."""
        from .cloud_lifecycle import run_restore_lifecycle
        return run_restore_lifecycle(self, callbacks or OrchestratorCallbacks(), backup_key=backup_key, skip_verify=skip_verify, **opts)

    def reconstruct_runtime(
        self,
        callbacks: Optional[OrchestratorCallbacks] = None,
        backup_key: Optional[str] = None,
        target_sha: Optional[str] = None,
        manifest_path: Optional[str] = None,
        skip_restore: bool = False,
        **opts: Any,
    ) -> Dict[str, Any]:
        """Provision a fresh runtime host, deploy pinned release, restore PostgreSQL, and verify health."""
        from .cloud_lifecycle import run_reconstruct_lifecycle
        return run_reconstruct_lifecycle(
            self,
            callbacks or OrchestratorCallbacks(),
            backup_key=backup_key,
            target_sha=target_sha,
            manifest_path=manifest_path,
            skip_restore=skip_restore,
            **opts,
        )
