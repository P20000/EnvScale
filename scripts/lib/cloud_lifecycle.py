"""Lifecycle orchestration helpers for runtime destroy, database restore, and full reconstruction."""

from __future__ import annotations

import pathlib
from typing import TYPE_CHECKING, Any, Dict, Optional

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
) -> Dict[str, Any]:
    """Run fail-closed CloudDeployer.infra_destroy() and synchronize PipelineStateStore."""
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
        backup_meta = deployer.infra_destroy() or {}
    except Exception as exc:
        orchestrator.state_store.update_stage("provision", "failed", error=f"Destroy failed: {redact_sensitive_text(str(exc))}")
        raise
    state = sync_state_after_destroy(orchestrator.state_store, backup_meta)
    return {"status": "completed", "backup": backup_meta, "state": state}


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
