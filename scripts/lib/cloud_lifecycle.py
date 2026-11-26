"""Lifecycle orchestration helpers for runtime destroy, database restore, and full reconstruction."""

from __future__ import annotations

import pathlib
from typing import TYPE_CHECKING, Any, Dict, Optional

from .cloud_demo_flow import verify_destroy_cleanup, verify_destroy_target_environment
from .cloud_deployer import CloudDeployer
from .cloud_identity import DEFAULT_ACCOUNT_ID, DEFAULT_REGION, redact_sensitive_text
from .cloud_ops_dashboard import trigger_remote_restore
from .config import PROJECT_ROOT

if TYPE_CHECKING:
    from .cloud_orchestrator import CloudOrchestrator, OrchestratorCallbacks, PipelineStateStore


def sync_state_after_destroy(state_store: "PipelineStateStore", backup_meta: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Clear ephemeral host context and reset runtime stages cleanly after verified teardown."""
    backup_key = str((backup_meta or {}).get("key") or "")
    ctx_updates: Dict[str, Any] = {
        "instance_id": "",
        "public_ip": "",
        "app_url": "",
        "last_restore_key": "",
    }
    if backup_key:
        ctx_updates["last_backup_key"] = backup_key
    state_store.update_context(**ctx_updates)

    note = f"Host destroyed (backup: {backup_key})" if backup_key else "Host destroyed cleanly"
    state_store.update_stage("provision", "pending", summary=note)
    state_store.update_stage("deploy", "pending", summary="Awaiting reconstruction")
    return state_store.update_stage("verify", "pending", summary="Awaiting reconstruction")


def run_destroy_lifecycle(
    orchestrator: "CloudOrchestrator",
    callbacks: "OrchestratorCallbacks",
    *,
    account_id: str = DEFAULT_ACCOUNT_ID,
    region: str = DEFAULT_REGION,
    stage_ref: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    """Verify target, run fail-closed CloudDeployer.infra_destroy(), confirm cleanup, and sync state."""
    tracker_ref = stage_ref if stage_ref is not None else {}
    tracker_ref["stage"] = "auth"
    try:
        verified_env = orchestrator._require_verified_runtime_env(
            callbacks,
            account_id=account_id,
            region=region,
        )
        deployer = CloudDeployer(
            log_fn=orchestrator.log_fn,
            step_fn=orchestrator.step_fn,
            aws_env=verified_env,
        )
        tracker_ref["stage"] = "target_validation"
        target_info = verify_destroy_target_environment(
            deployer,
            aws_env=verified_env,
            account_id=account_id,
            region=region,
        )
        tracker_ref["stage"] = "backup_or_destroy"
        backup_meta = deployer.infra_destroy() or {}
        tracker_ref["stage"] = "cleanup_verify"
        cleanup_info = verify_destroy_cleanup(
            str(target_info.get("instance_id") or ""),
            aws_env=verified_env,
            region=region,
        )
    except Exception as exc:
        orchestrator.state_store.update_stage("provision", "failed", error=f"Destroy failed: {redact_sensitive_text(str(exc))}")
        raise
    state = sync_state_after_destroy(orchestrator.state_store, backup_meta)
    return {
        "status": "completed",
        "backup": backup_meta,
        "target": target_info,
        "cleanup": cleanup_info,
        "state": state,
    }


def execute_destroy_environment(
    orchestrator: "CloudOrchestrator",
    callbacks: "OrchestratorCallbacks",
    *,
    account_id: str = DEFAULT_ACCOUNT_ID,
    region: str = DEFAULT_REGION,
    raise_on_error: bool = False,
) -> Dict[str, Any]:
    """Unified destruction pipeline with structured phase tracking and preserved safeguards."""
    from .cloud_demo_flow import FoundationNotInitializedError

    tracker = orchestrator._make_tracker("destroy", callbacks)
    stage_ref: Dict[str, str] = {"stage": "auth"}
    tracker.transition("PREFLIGHT", stage="target_validation", message="Validating target environment and Terraform state...")
    try:
        res = run_destroy_lifecycle(
            orchestrator,
            callbacks,
            account_id=account_id,
            region=region,
            stage_ref=stage_ref,
        )
    except Exception as exc:
        failed_stage = stage_ref.get("stage") or "backup_or_destroy"
        infra_active = bool(CloudDeployer().get_instance_id())
        if isinstance(exc, FoundationNotInitializedError):
            tracker.fail(
                phase="FOUNDATION_NOT_INITIALIZED",
                outcome="BLOCKED",
                failed_stage=failed_stage,
                error=str(exc),
                rollback_attempted=False,
                infrastructure_active=infra_active,
                recovery_action="Initialize Persistent Foundation before attempting cloud teardown.",
            )
        else:
            rec_map = {
                "auth": "Re-authenticate Runtime MFA and retry Destroy Environment.",
                "target_validation": "Reconcile Terraform state and verify target EC2 tags/VPC before retrying Destroy Environment.",
                "backup_or_destroy": "Inspect Execution Logs to see whether pre-destroy PostgreSQL backup or terraform destroy failed.",
                "cleanup_verify": "Inspect EC2/Terraform state; resources may still require manual cleanup confirmation.",
            }
            tracker.fail(
                phase="FAILED",
                outcome="FAILED",
                failed_stage=failed_stage,
                error=str(exc),
                rollback_attempted=False,
                infrastructure_active=infra_active,
                recovery_action=rec_map.get(failed_stage, "Inspect Execution Logs before retrying Destroy Environment."),
            )
        if raise_on_error:
            raise
        return {
            "status": tracker.phase,
            "outcome": tracker.outcome,
            "phase": tracker.phase,
            "backup": {},
            "cleanup": {},
            "failure": tracker.failure,
            "state": orchestrator.state_store.load(),
        }

    bkp = res.get("backup") or {}
    cln = res.get("cleanup") or {}
    tracker.succeed(
        outcome="DESTROYED",
        message=f"Destroyed safely (backup={bkp.get('key', '-')}, remaining={cln.get('remaining_resources', 0)})",
    )
    return {
        "status": "SUCCEEDED",
        "outcome": "DESTROYED",
        "phase": "SUCCEEDED",
        "backup": bkp,
        "target": res.get("target") or {},
        "cleanup": cln,
        "failure": None,
        "state": res["state"],
    }


def run_restore_lifecycle(
    orchestrator: "CloudOrchestrator",
    callbacks: "OrchestratorCallbacks",
    *,
    backup_key: Optional[str] = None,
    skip_verify: bool = False,
    account_id: str = DEFAULT_ACCOUNT_ID,
    region: str = DEFAULT_REGION,
) -> Dict[str, Any]:
    """Restore a PostgreSQL dump from S3 onto the active runtime host and update PipelineStateStore."""
    orchestrator.state_store.update_stage("verify", "running", summary="Restoring PostgreSQL backup...")
    try:
        verified_env = orchestrator._require_verified_runtime_env(
            callbacks,
            account_id=account_id,
            region=region,
        )
        chosen_key = (backup_key or "").strip() or None
        res = trigger_remote_restore(
            backup_key=chosen_key,
            aws_env=verified_env,
            step_fn=orchestrator.step_fn,
            skip_verify=skip_verify,
        )
    except Exception as exc:
        orchestrator.state_store.update_stage("verify", "failed", error=f"Database restore failed: {redact_sensitive_text(str(exc))}")
        raise

    orchestrator.state_store.update_context(last_restore_key=res["key"])
    summary = (
        f"Restored {res['key']} "
        f"(tables={res.get('canonical_tables', 0)}/12, verify={res.get('verify_passed', False)})"
    )
    if res.get("verify_passed"):
        orchestrator.state_store.update_stage("verify", "completed", summary=summary)
    else:
        orchestrator.state_store.update_stage("verify", "pending", summary=f"Restored {res['key']} (post-restore verify skipped)")
    return {"status": "completed", **res, "summary": summary, "state": orchestrator.state_store.load()}


def run_reconstruct_lifecycle(
    orchestrator: "CloudOrchestrator",
    callbacks: "OrchestratorCallbacks",
    *,
    backup_key: Optional[str] = None,
    target_sha: Optional[str] = None,
    manifest_path: Optional[str] = None,
    skip_restore: bool = False,
    account_id: str = DEFAULT_ACCOUNT_ID,
    region: str = DEFAULT_REGION,
) -> Dict[str, Any]:
    """Reconstruct runtime EC2, deploy pinned release, restore PostgreSQL data, and verify health."""
    ctx = orchestrator.state_store.load().get("context", {})
    eff_manifest = manifest_path or ctx.get("manifest_path") or ""
    default_manifest = pathlib.Path(PROJECT_ROOT) / "release-manifest.json"
    release_res: Dict[str, Any] = {}
    if (not eff_manifest or not pathlib.Path(eff_manifest).is_file()) and not default_manifest.is_file():
        release_res = orchestrator.run_stage("release", callbacks=callbacks, target_sha=target_sha)
        eff_manifest = release_res.get("manifest_path", "")

    orchestrator.state_store.update_stage("deploy", "pending", summary="Awaiting reconstruction")
    orchestrator.state_store.update_stage("verify", "pending", summary="Awaiting reconstruction")
    prov_res = orchestrator.run_stage("provision", callbacks=callbacks, account_id=account_id, region=region)
    dep_res = orchestrator.run_stage(
        "deploy",
        callbacks=callbacks,
        target_sha=target_sha,
        manifest_path=eff_manifest or None,
        account_id=account_id,
        region=region,
    )

    restore_res: Dict[str, Any] = {"status": "skipped"}
    if not skip_restore:
        orchestrator.state_store.update_stage("verify", "running", summary="Restoring PostgreSQL backup...")
        try:
            verified_env = orchestrator._require_verified_runtime_env(
                callbacks,
                account_id=account_id,
                region=region,
            )
            effective_key = (backup_key or "").strip() or (ctx.get("last_backup_key") or "").strip() or None
            restore_res = trigger_remote_restore(
                backup_key=effective_key,
                aws_env=verified_env,
                step_fn=orchestrator.step_fn,
                skip_verify=False,
            )
        except Exception as exc:
            orchestrator.state_store.update_stage(
                "verify",
                "failed",
                error=f"Database restore failed: {redact_sensitive_text(str(exc))}",
            )
            raise
        orchestrator.state_store.update_context(last_restore_key=restore_res["key"])

    verify_res = orchestrator.run_stage("verify", callbacks=callbacks, account_id=account_id, region=region)
    final_state = orchestrator.state_store.load()
    return {
        "status": "completed",
        "release": release_res,
        "provision": prov_res,
        "deploy": dep_res,
        "restore": restore_res,
        "verify": verify_res,
        "app_url": dep_res.get("app_url") or verify_res.get("app_url") or "",
        "state": final_state,
    }


def execute_initialize_foundation(
    orchestrator: "CloudOrchestrator",
    callbacks: "OrchestratorCallbacks",
    *,
    ref: str = "develop",
    raise_on_error: bool = False,
    **opts: Any,
) -> Dict[str, Any]:
    """One-time administrative Foundation & SSM secrets setup workflow (separate from runtime deploy)."""
    tracker = orchestrator._make_tracker("foundation", callbacks)
    current_stage = "preflight"
    tracker.transition("PREFLIGHT", stage="preflight", message="Running preflight for one-time Foundation setup...")
    try:
        orchestrator.run_stage("preflight", callbacks=callbacks)
        current_stage = "foundation"
        tracker.transition("PROVISIONING", stage="foundation", message="Applying Persistent Foundation (GitHub OIDC)...")
        f_res = orchestrator.run_stage("foundation", callbacks=callbacks, ref=ref, **opts)
        if f_res.get("status") in ("needs_approval", "needs_mfa"):
            return {"status": f_res["status"].upper(), "outcome": "BLOCKED", "foundation": f_res, "secrets": None, "failure": None, "state": orchestrator.state_store.load()}
        current_stage = "secrets"
        tracker.transition("DEPLOYING", stage="secrets", message="Verifying and seeding /envscale/prod/* SSM secrets...")
        s_res = orchestrator.run_stage("secrets", callbacks=callbacks, **opts)
        if s_res.get("status") in ("needs_approval", "needs_mfa"):
            return {"status": s_res["status"].upper(), "outcome": "BLOCKED", "foundation": f_res, "secrets": s_res, "failure": None, "state": orchestrator.state_store.load()}
        tracker.succeed(outcome="READY", message="Persistent Foundation and SSM secrets initialized")
        return {"status": "SUCCEEDED", "outcome": "READY", "foundation": f_res, "secrets": s_res, "failure": None, "state": orchestrator.state_store.load()}
    except Exception as exc:
        tracker.fail(
            phase="FAILED", outcome="FAILED", failed_stage=current_stage, error=str(exc),
            rollback_attempted=False, infrastructure_active=bool(CloudDeployer().get_instance_id()),
            recovery_action="If foundation.yml failed plan validation, run one-time Foundation IAM reconciliation first.",
        )
        if raise_on_error:
            raise
        return {"status": "FAILED", "outcome": "FAILED", "foundation": None, "secrets": None, "failure": tracker.failure, "state": orchestrator.state_store.load()}
