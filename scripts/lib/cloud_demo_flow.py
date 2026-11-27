"""Streamlined demo deploy/destroy orchestration helpers reusing existing control-plane stages and guards."""

from __future__ import annotations

import json
import os
import pathlib
import shutil
import subprocess
from typing import TYPE_CHECKING, Any, Callable, Dict, List, Optional

from .cloud_deployer import CloudDeployer
from .cloud_identity import (
    DEFAULT_ACCOUNT_ID, DEFAULT_REGION, RUNTIME_PROVISIONER_ROLE_NAME,
    redact_sensitive_text, resolve_recovery_bucket,
)
from .cloud_target_sync import infer_state_sync_status_from_error
from .config import PROJECT_ROOT, TERRAFORM_DIR
from .postgres_backup_verifier import extract_tfstate_deployment_identity
from .ssm_deployer import (
    resolve_and_validate_manifest, verify_runtime_instance_profile,
    verify_ssm_parameters_present, wait_for_ssm_online,
)
from .tfstate_reconciler import (
    ConcurrentStateOperationError, CorruptedStateJournalError, STATE_SYNC_PENDING,
    STATE_SYNCHRONIZED, StateDivergenceError, StateSyncPendingError, inspect_state_status,
)
from .tfstate_sync import parse_and_validate_tfstate, verify_tfstate_consistency_with_s3

if TYPE_CHECKING:
    from .cloud_orchestrator import CloudOrchestrator, OrchestratorCallbacks, PipelineStateStore

_RunFn = Callable[..., subprocess.CompletedProcess]


class FoundationNotInitializedError(RuntimeError):
    """Raised when Persistent Foundation IAM resources or SSM secrets are not yet provisioned in AWS."""

    def __init__(self, message: str, missing_prerequisites: Optional[List[str]] = None):
        super().__init__(message)
        self.missing_prerequisites: List[str] = list(missing_prerequisites or [])


def inspect_missing_foundation_prerequisites(
    aws_info: Dict[str, Any],
    *,
    account_id: str = DEFAULT_ACCOUNT_ID,
    region: str = DEFAULT_REGION,
) -> List[str]:
    """Return human-readable missing Persistent Foundation IAM prerequisites from inspect_aws_identity()."""
    missing: List[str] = []
    roles = aws_info.get("roles") or {}
    role_entry = roles.get(RUNTIME_PROVISIONER_ROLE_NAME)
    if (
        isinstance(role_entry, dict)
        and role_entry.get("exists") is False
        and "AccessDenied" not in str(role_entry.get("error") or "")
    ):
        missing.append(f"IAM role '{RUNTIME_PROVISIONER_ROLE_NAME}'")

    prof_entry = aws_info.get("instance_profile")
    if (
        isinstance(prof_entry, dict)
        and prof_entry.get("exists") is False
        and "AccessDenied" not in str(prof_entry.get("error") or "")
    ):
        missing.append("IAM instance profile 'envscale-ec2-runtime-profile'")
    return missing


def check_role_exists_for_mfa(aws_info: Dict[str, Any], role_name: str) -> None:
    """Fail fast before TOTP entry when Persistent Foundation runtime IAM resources are absent in AWS."""
    if role_name != RUNTIME_PROVISIONER_ROLE_NAME:
        return
    missing = inspect_missing_foundation_prerequisites(aws_info)
    if missing and any(RUNTIME_PROVISIONER_ROLE_NAME in item for item in missing):
        raise FoundationNotInitializedError(
            f"Missing AWS Foundation resource(s): {', '.join(missing)}. "
            "Run one-time Foundation setup ('Initialize Foundation' under Advanced Operations; "
            "bootstrap-state.sh --bootstrap-foundation-iam --reconcile-existing / foundation.yml) before deploying.",
            missing_prerequisites=missing,
        )


def _default_tfstate_path() -> str:
    return os.path.join(TERRAFORM_DIR, "terraform.tfstate")


def run_demo_preflight(
    orchestrator: "CloudOrchestrator",
    callbacks: "OrchestratorCallbacks",
    *,
    account_id: str = DEFAULT_ACCOUNT_ID,
    region: str = DEFAULT_REGION,
    tracker: Optional[Any] = None,
) -> Dict[str, Any]:
    """Run internal demo preflight using a single Runtime Provisioner STS session (no Admin MFA)."""
    sid, title = "demo_preflight", "Demo Preflight"
    orchestrator._emit_step(sid, title, "start", "Checking tools, Runtime STS session, Foundation, and SSM")
    try:
        missing_tools = [t for t in ("aws", "gh", "terraform", "git", "python3") if shutil.which(t) is None]
        if missing_tools:
            raise RuntimeError(f"Missing required CLI tool(s) on PATH: {', '.join(missing_tools)}.")

        verified_env = orchestrator._require_verified_runtime_env(callbacks, account_id=account_id, region=region)
        if tracker is not None:
            tracker.mark_ui_stage("preflight", "completed")
            tracker.transition(
                "PREFLIGHT",
                stage="prerequisites",
                ui_stage="readiness",
                ui_status="running",
                message="Checking Foundation instance profile, S3 recovery bucket, and SSM parameters...",
            )

        try:
            verify_runtime_instance_profile(emit_fn=orchestrator.step_fn, step_id=sid, step_title=title, aws_env=verified_env)
            CloudDeployer(log_fn=orchestrator.log_fn, step_fn=orchestrator.step_fn, aws_env=verified_env).ensure_s3_vault(
                step_id=sid, step_title=title
            )
        except Exception as exc:
            raise FoundationNotInitializedError(
                f"{exc} Run one-time Foundation setup under 'Advanced Operations and Administration' first.",
                missing_prerequisites=[str(exc)],
            ) from exc

        try:
            verify_ssm_parameters_present(
                region=region, aws_env=verified_env, emit_fn=orchestrator.step_fn, step_id=sid, step_title=title
            )
        except Exception as exc:
            msg = str(exc)
            if "missing" in msg.lower():
                raise FoundationNotInitializedError(
                    f"{msg} Run one-time 'Initialize Foundation' under 'Advanced Operations and Administration' first.",
                    missing_prerequisites=["/envscale/prod/* SSM parameters"],
                ) from exc
            raise RuntimeError(
                f"{msg} Seed /envscale/prod/* secrets under 'Advanced Operations and Administration' first."
            ) from exc
    except Exception as exc:
        orchestrator._emit_step(sid, title, "error", str(exc))
        raise

    orchestrator._emit_step(sid, title, "success", "Preflight checks passed")
    return {"status": "completed", "aws_env": verified_env, "account_id": account_id, "region": region}


def _describe_ec2_instance(
    instance_id: str,
    *,
    region: str,
    aws_env: Optional[Dict[str, str]],
    run_fn: _RunFn = subprocess.run,
) -> Dict[str, Any]:
    kw: Dict[str, Any] = {"capture_output": True, "text": True}
    if aws_env is not None:
        kw["env"] = aws_env
    res = run_fn(
        ["aws", "ec2", "describe-instances", "--instance-ids", instance_id, "--region", region, "--output", "json"],
        **kw,
    )
    if res.returncode != 0:
        err = redact_sensitive_text((res.stderr or res.stdout or f"exit {res.returncode}").strip())
        raise RuntimeError(f"Failed inspecting EC2 instance {instance_id} in {region}: {err}")
    doc = json.loads(res.stdout or "{}")
    reservations = doc.get("Reservations") or []
    instances = (reservations[0].get("Instances") or []) if reservations else []
    if not instances:
        raise RuntimeError(f"EC2 instance {instance_id} was not returned by describe-instances in {region}.")
    return instances[0]


def _maybe_start_stopped_host(
    deployer: CloudDeployer,
    *,
    aws_env: Dict[str, str],
    region: str,
    emit_fn: Optional[Callable[[str, str, str, str], None]],
    run_fn: _RunFn = subprocess.run,
) -> Optional[Dict[str, Any]]:
    """If Terraform state points to a stopped EC2 demo host, start it instead of re-provisioning."""
    instance_id = deployer.get_instance_id()
    if not instance_id:
        return None
    try:
        inst = _describe_ec2_instance(instance_id, region=region, aws_env=aws_env, run_fn=run_fn)
    except RuntimeError:
        return None
    state_name = str((inst.get("State") or {}).get("Name") or "")
    if state_name != "stopped":
        return None

    sid, title = "demo_start", "Start Stopped Demo Host"
    if emit_fn:
        emit_fn(sid, title, "start", f"aws ec2 start-instances --instance-ids {instance_id}")
    try:
        res = run_fn(
            ["aws", "ec2", "start-instances", "--instance-ids", instance_id, "--region", region, "--output", "json"],
            capture_output=True, text=True, env=aws_env,
        )
        if res.returncode != 0:
            raise RuntimeError(redact_sensitive_text((res.stderr or res.stdout or "start-instances failed").strip()))
        wait_for_ssm_online(instance_id, region=region, emit_fn=emit_fn, step_id=sid, step_title=title, aws_env=aws_env)
        refreshed = _describe_ec2_instance(instance_id, region=region, aws_env=aws_env, run_fn=run_fn)
        live_ip = str(refreshed.get("PublicIpAddress") or deployer.get_public_ip() or "").strip()
        if live_ip:
            deployer.sync_duckdns(live_ip, step_id=sid, step_title=title)
        if emit_fn:
            emit_fn(sid, title, "success", f"Started {instance_id} ({live_ip or 'SSM online'})")
        return {"instance_id": instance_id, "ip": live_ip, "resumed": True}
    except Exception as exc:
        if emit_fn:
            emit_fn(sid, title, "error", str(exc))
        raise


def _recovery_hint_for_stage(stage: str) -> str:
    hints = {
        "auth": "Authenticate the Runtime Provisioner STS session with a 6-digit TOTP code and retry Deploy.",
        "preflight": "Install missing local CLI tools on PATH and retry Deploy.",
        "prerequisites": "Expand Advanced Operations and run 'Initialize Foundation (One-Time)'.",
        "release": "Ensure a successful cd.yml build exists on develop or pass a valid release-manifest.json.",
        "tfstate_sync": "Reconcile local and S3 runtime Terraform state before provisioning.",
        "provision": "Inspect Execution Logs for Terraform/EC2 errors; run Destroy Environment if partial resources remain.",
        "deploy": "Inspect Execution Logs; automatic rollback was attempted if the host failed verification.",
        "verify": "Host is active but HTTPS health check failed. Inspect Execution Logs or run Destroy Environment.",
    }
    return hints.get(stage, "Inspect Execution Logs for diagnostic details before retrying.")


def execute_deploy_environment(
    orchestrator: "CloudOrchestrator",
    callbacks: "OrchestratorCallbacks",
    *,
    target_sha: Optional[str] = None,
    manifest_path: Optional[str] = None,
    branch: str = "develop",
    account_id: str = DEFAULT_ACCOUNT_ID,
    region: str = DEFAULT_REGION,
    raise_on_error: bool = False,
) -> Dict[str, Any]:
    """Unified deployment pipeline: auth -> preflight -> release -> tfstate -> provision/start -> deploy -> verify."""
    tracker = orchestrator._make_tracker("deploy", callbacks)
    current_stage, current_ui = "preflight", "preflight"
    rollback_attempted = False
    infra_active = bool(CloudDeployer().get_instance_id())
    release_id = str(orchestrator.state_store.load().get("context", {}).get("release_id") or "")
    resumed = None

    tracker.transition("PREFLIGHT", stage="preflight", ui_stage="preflight", ui_status="running", message="Validating tools and Runtime STS session...")
    try:
        current_stage = "auth"
        pre = run_demo_preflight(orchestrator, callbacks, account_id=account_id, region=region, tracker=tracker)
        verified_env = pre["aws_env"]
        current_ui = "readiness"
        current_stage = "release"

        ctx = orchestrator.state_store.load().get("context", {})
        candidate = manifest_path or ctx.get("manifest_path") or ""
        default_manifest = pathlib.Path(PROJECT_ROOT) / "release-manifest.json"
        if not candidate and default_manifest.is_file():
            candidate = str(default_manifest)
        need_release_fetch = not candidate or not pathlib.Path(candidate).is_file()
        eff_sha = (target_sha or "").strip()
        if not need_release_fetch:
            doc = json.loads(pathlib.Path(candidate).read_text(encoding="utf-8"))
            manifest_sha = str((doc.get("git") or {}).get("commit_sha") or "")
            release_id = str(doc.get("release_id") or release_id)
            if eff_sha and not manifest_sha.startswith(eff_sha):
                need_release_fetch = True
            else:
                eff_sha = manifest_sha

        if need_release_fetch:
            rel = orchestrator.run_stage("release", callbacks=callbacks, target_sha=target_sha, branch=branch)
            candidate, eff_sha, release_id = rel["manifest_path"], rel["commit_sha"], rel["release_id"]
        else:
            deployer_ctx = CloudDeployer(log_fn=orchestrator.log_fn, step_fn=orchestrator.step_fn, aws_env=verified_env).get_aws_context()
            candidate = str(resolve_and_validate_manifest(
                commit_sha=eff_sha, manifest_path=candidate,
                recovery_bucket=deployer_ctx.get("recovery_bucket"), region=region, aws_env=verified_env,
            ))
            orchestrator.state_store.update_context(target_sha=eff_sha, manifest_path=candidate, release_id=release_id)
            orchestrator.state_store.update_stage("release", "completed", summary=f"{release_id} ({eff_sha[:7]})")

        orchestrator.state_store.update_stage("preflight", "completed", summary="Demo preflight passed")
        tracker.mark_ui_stage("readiness", "completed")

        current_ui, current_stage = "provision", "tfstate_sync"
        if str(ctx.get("state_sync_status") or "STATE_SYNCHRONIZED") != "STATE_SYNCHRONIZED":
            orchestrator.state_store.update_context(state_sync_status="RECOVERING")
        tracker.transition("PROVISIONING", stage="tfstate_sync", ui_stage="provision", ui_status="running", message="Synchronizing Terraform state...")
        deployer = CloudDeployer(log_fn=orchestrator.log_fn, step_fn=orchestrator.step_fn, aws_env=verified_env)
        deployer.restore_from_s3(step_id="stage_tfstate_sync", step_title="Synchronizing Terraform State")
        orchestrator.state_store.update_context(state_sync_status="STATE_SYNCHRONIZED")

        current_stage = "provision"
        tracker.transition("PROVISIONING", stage="provision", ui_stage="provision", ui_status="running", message="Provisioning or starting EC2 infrastructure...")
        resumed = _maybe_start_stopped_host(deployer, aws_env=verified_env, region=region, emit_fn=orchestrator.step_fn)
        if resumed:
            orchestrator.state_store.update_context(instance_id=resumed["instance_id"], public_ip=resumed["ip"])
            orchestrator.state_store.update_stage("provision", "completed", summary=f"Started stopped EC2 {resumed['instance_id']} ({resumed['ip']})")
        else:
            orchestrator.run_stage("provision", callbacks=callbacks, account_id=account_id, region=region)
        infra_active = True
        tracker.mark_ui_stage("provision", "completed")

        current_ui, current_stage = "deploy", "deploy"
        tracker.transition("DEPLOYING", stage="deploy", ui_stage="deploy", ui_status="running", message="Deploying host configuration and application stack...")
        orig_step_fn = orchestrator.step_fn

        def _watch_rollback(sid: str, title: str, status: str, detail: str = "") -> None:
            nonlocal rollback_attempted
            if "Triggering automatic rollback" in (detail or ""):
                rollback_attempted = True
                tracker.transition("RECOVERING", stage="rollback", ui_stage="deploy", ui_status="running", message="Verification failed; automatic rollback in progress...", outcome="RECOVERING")
            if orig_step_fn:
                orig_step_fn(sid, title, status, detail)

        orchestrator.step_fn = _watch_rollback
        try:
            dep = orchestrator.run_stage("deploy", callbacks=callbacks, target_sha=eff_sha, manifest_path=candidate, account_id=account_id, region=region)
        finally:
            orchestrator.step_fn = orig_step_fn
        tracker.mark_ui_stage("deploy", "completed")

        current_ui, current_stage = "verify", "verify"
        tracker.transition("VERIFYING", stage="verify", ui_stage="verify", ui_status="running", message="Verifying HTTPS endpoints and application health...")
        ver = orchestrator.run_stage("verify", callbacks=callbacks, account_id=account_id, region=region)
        tracker.mark_ui_stage("verify", "completed")

        state = orchestrator.state_store.load()
        final_ctx = state.get("context", {})
        app_url = ver.get("app_url") or dep.get("app_url") or final_ctx.get("app_url") or ""
        tracker.succeed(outcome="READY", message=f"Live at {app_url}" if app_url else "Runtime verified")
        return {
            "status": "SUCCEEDED", "outcome": "READY", "phase": "SUCCEEDED",
            "app_url": app_url, "instance_id": dep.get("instance_id") or final_ctx.get("instance_id") or "",
            "public_ip": dep.get("public_ip") or final_ctx.get("public_ip") or "",
            "release_id": release_id, "resumed": bool(resumed), "failure": None, "state": state,
        }
    except Exception as exc:
        infra_active = infra_active or bool(CloudDeployer().get_instance_id())
        if isinstance(exc, FoundationNotInitializedError):
            tracker.fail(
                phase="FOUNDATION_NOT_INITIALIZED", outcome="BLOCKED", failed_stage="prerequisites",
                ui_stage=current_ui, error=str(exc), rollback_attempted=False, infrastructure_active=infra_active,
                recovery_action="Expand Advanced Operations and run 'Initialize Foundation (One-Time)' (after one-time IAM reconciliation if required).",
                missing_prerequisites=exc.missing_prerequisites,
            )
        elif isinstance(exc, StateSyncPendingError):
            orchestrator.state_store.update_context(state_sync_status="STATE_SYNC_PENDING")
            tracker.fail(
                phase="STATE_SYNC_PENDING", outcome="BLOCKED", failed_stage=current_stage,
                ui_stage=current_ui, error=str(exc), rollback_attempted=False, infrastructure_active=infra_active,
                recovery_action="Run 'ops tfstate reconcile' or retry once AWS S3 connectivity is restored to finish pending state synchronization.",
            )
        elif isinstance(exc, (StateDivergenceError, ConcurrentStateOperationError, CorruptedStateJournalError)):
            orchestrator.state_store.update_context(state_sync_status=infer_state_sync_status_from_error(exc))
            tracker.fail(
                phase="FAILED", outcome="BLOCKED", failed_stage=current_stage, ui_stage=current_ui,
                error=str(exc), rollback_attempted=False, infrastructure_active=infra_active,
                recovery_action="Inspect state with 'ops tfstate status' and explicitly reconcile before retrying provisioning.",
            )
        else:
            tracker.fail(
                phase="FAILED", outcome="FAILED", failed_stage=current_stage, ui_stage=current_ui,
                error=str(exc), rollback_attempted=rollback_attempted, infrastructure_active=infra_active,
                recovery_action=_recovery_hint_for_stage(current_stage),
            )
        if raise_on_error:
            raise
        final_ctx = orchestrator.state_store.load().get("context", {})
        return {
            "status": tracker.phase, "outcome": tracker.outcome, "phase": tracker.phase,
            "app_url": "", "instance_id": str(final_ctx.get("instance_id") or ""),
            "public_ip": str(final_ctx.get("public_ip") or ""), "release_id": release_id,
            "resumed": False, "failure": tracker.failure, "state": orchestrator.state_store.load(),
        }


def run_demo_deploy(orchestrator: "CloudOrchestrator", callbacks: "OrchestratorCallbacks", **opts: Any) -> Dict[str, Any]:
    """Backwards-compatible wrapper around execute_deploy_environment(raise_on_error=True)."""
    return execute_deploy_environment(orchestrator, callbacks, raise_on_error=True, **opts)


def inspect_destroy_target(
    state_store: "PipelineStateStore",
    *,
    account_id: str = DEFAULT_ACCOUNT_ID,
    region: str = DEFAULT_REGION,
    tf_state_path: Optional[str] = None,
) -> Dict[str, str]:
    """Read local non-secret target details (ZERO AWS calls) for the destroy confirmation dialog."""
    tf_path = tf_state_path or _default_tfstate_path()
    ident: Dict[str, Any] = {}
    if tf_path and os.path.isfile(tf_path):
        try:
            ident = extract_tfstate_deployment_identity(tf_path, pipeline_state_path=str(state_store.path))
        except RuntimeError:
            ident = {}
    ctx = state_store.load().get("context", {})
    deployer = CloudDeployer()
    instance_id = deployer.get_instance_id() or str(ident.get("state_instance_id") or ctx.get("instance_id") or "")
    return {
        "account_id": account_id, "region": region, "instance_id": instance_id,
        "vpc_id": str(ident.get("vpc_id") or ""), "tf_lineage": str(ident.get("tf_lineage") or ""),
        "app_url": str(ctx.get("app_url") or ""), "recovery_bucket": resolve_recovery_bucket(account_id=account_id, region=region),
    }


def verify_destroy_target_environment(
    deployer: CloudDeployer,
    *,
    aws_env: Dict[str, str],
    account_id: str = DEFAULT_ACCOUNT_ID,
    region: str = DEFAULT_REGION,
    tf_state_path: Optional[str] = None,
    run_fn: _RunFn = subprocess.run,
) -> Dict[str, Any]:
    """Fail-closed pre-destroy verification: scope, tfstate S3 consistency, and Project/Layer/VPC tags."""
    if account_id != DEFAULT_ACCOUNT_ID or region != DEFAULT_REGION:
        raise RuntimeError(f"Destruction blocked: target scope ({account_id}, {region}) does not match allowed demo scope ({DEFAULT_ACCOUNT_ID}, {DEFAULT_REGION}).")
    tf_path = tf_state_path or _default_tfstate_path()
    chk = verify_tfstate_consistency_with_s3(local_path=tf_path, account_id=account_id, region=region, aws_env=aws_env, run_fn=run_fn)
    if isinstance(chk, dict) and chk.get("status") == "local_newer":
        st = inspect_state_status(local_path=tf_path, account_id=account_id, region=region, aws_env=aws_env, run_fn=run_fn)
        if st.get("classification") == STATE_SYNC_PENDING:
            raise StateSyncPendingError(st["message"])
        if st.get("classification") != STATE_SYNCHRONIZED:
            raise StateDivergenceError(st["message"])
    ident = extract_tfstate_deployment_identity(tf_path) if os.path.isfile(tf_path) else {}
    instance_id = deployer.get_instance_id() or str(ident.get("state_instance_id") or "")
    vpc_id = str(ident.get("vpc_id") or "")
    if instance_id:
        inst = _describe_ec2_instance(instance_id, region=region, aws_env=aws_env, run_fn=run_fn)
        tags = {str(t.get("Key")): str(t.get("Value")) for t in (inst.get("Tags") or []) if isinstance(t, dict)}
        if tags.get("Project") != "EnvScale" or tags.get("Layer") != "DisposableRuntime":
            raise RuntimeError(f"Destruction blocked: EC2 {instance_id} tags (Project={tags.get('Project')!r}, Layer={tags.get('Layer')!r}) do not match EnvScale DisposableRuntime.")
        live_vpc = str(inst.get("VpcId") or "")
        if vpc_id and live_vpc != vpc_id:
            raise RuntimeError(f"Destruction blocked: EC2 {instance_id} VPC ({live_vpc!r}) does not match Terraform state VPC ({vpc_id!r}).")
        vpc_id = live_vpc or vpc_id
    return {
        "verified": True, "account_id": account_id, "region": region,
        "instance_id": instance_id, "vpc_id": vpc_id, "tf_lineage": str(ident.get("tf_lineage") or ""),
    }


def verify_destroy_cleanup(
    destroyed_instance_id: str,
    *,
    aws_env: Dict[str, str],
    region: str = DEFAULT_REGION,
    tf_state_path: Optional[str] = None,
    run_fn: _RunFn = subprocess.run,
) -> Dict[str, Any]:
    """Fail-closed post-destroy confirmation: tfstate has 0 resources and EC2 instance is terminated."""
    tf_path = tf_state_path or _default_tfstate_path()
    if os.path.isfile(tf_path):
        meta = parse_and_validate_tfstate(tf_path)
        if meta["resource_count"] != 0:
            raise RuntimeError(f"Teardown verification failed: Terraform state still reports {meta['resource_count']} active resource(s).")
    inst_state = "none"
    if destroyed_instance_id:
        res = run_fn(
            ["aws", "ec2", "describe-instances", "--instance-ids", destroyed_instance_id, "--region", region, "--output", "json"],
            capture_output=True, text=True, env=aws_env,
        )
        if res.returncode != 0:
            err = redact_sensitive_text((res.stderr or res.stdout or "").strip())
            if "InvalidInstanceID.NotFound" not in err:
                raise RuntimeError(f"Post-destroy EC2 verification failed for {destroyed_instance_id}: {err}")
            inst_state = "not_found"
        else:
            doc = json.loads(res.stdout or "{}")
            reservations = doc.get("Reservations") or []
            instances = (reservations[0].get("Instances") or []) if reservations else []
            inst_state = str(((instances[0].get("State") or {}).get("Name")) or "not_found") if instances else "not_found"
            if inst_state not in ("terminated", "shutting-down", "not_found"):
                raise RuntimeError(f"Teardown verification failed: EC2 instance {destroyed_instance_id} is still in state '{inst_state}'.")
    return {"verified": True, "remaining_resources": 0, "instance_state": inst_state}

