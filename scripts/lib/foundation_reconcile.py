"""Control-plane Foundation initialization & repeatable reconciliation adapter for Test Center."""

from __future__ import annotations

import json
import pathlib
import sys
from typing import TYPE_CHECKING, Any, Dict, Optional

import click

from .cloud_deployer import CloudDeployer
from .cloud_identity import ADMIN_ROLE_NAME, redact_sensitive_text
from .config import PROJECT_ROOT

_BOOTSTRAP_DIR = pathlib.Path(PROJECT_ROOT) / "deployment" / "bootstrap"
if str(_BOOTSTRAP_DIR) not in sys.path:
    sys.path.insert(0, str(_BOOTSTRAP_DIR))

from foundation_reconcile_lib import (  # noqa: E402
    STATE_BOOTSTRAP_REQUIRED,
    STATE_FOUNDATION_DEPLOY_REQUIRED,
    STATE_HEALTHY,
    STATE_SECRETS_REQUIRED,
    inspect_foundation_state,
    reconcile_foundation,
)

if TYPE_CHECKING:
    from .cloud_orchestrator import CloudOrchestrator, OrchestratorCallbacks


def _ensure_admin_env_reuse(
    orchestrator: "CloudOrchestrator", callbacks: "OrchestratorCallbacks"
) -> Optional[Dict[str, str]]:
    """Reuse an unexpired MFA admin session (or RAM admin handoff) without re-prompting."""
    if orchestrator.admin_session is not None and not orchestrator.admin_session.is_expired():
        return orchestrator.admin_session.build_env()
    if orchestrator.allow_ram_handoff:
        from .cloud_identity import load_ram_admin_session
        ram_sess = load_ram_admin_session(verify_caller=True)
        if ram_sess is not None and not ram_sess.is_expired():
            orchestrator.admin_session = ram_sess
            return ram_sess.build_env()
    if callbacks.on_mfa_session is not None:
        sess = callbacks.on_mfa_session()
        if sess is not None and not sess.role_arn.endswith(f":role/{ADMIN_ROLE_NAME}"):
            raise RuntimeError(f"Bootstrap reconciliation requires '{ADMIN_ROLE_NAME}', got '{sess.role_arn}'.")
        if sess is not None:
            orchestrator.admin_session = sess
            return sess.build_env()
    return None


def execute_reconcile_foundation(
    orchestrator: "CloudOrchestrator",
    callbacks: "OrchestratorCallbacks",
    *,
    ref: str = "develop",
    plan_only: bool = False,
    raise_on_error: bool = False,
    **opts: Any,
) -> Dict[str, Any]:
    """Inspect, reconcile bootstrap IAM (with approval), deploy OIDC Foundation, and seed SSM secrets."""
    tracker = orchestrator._make_tracker("foundation", callbacks)
    fdir = pathlib.Path(PROJECT_ROOT) / "deployment" / "foundation"
    current_stage = "preflight"
    tracker.transition("PREFLIGHT", stage="preflight", message="Inspecting AWS Foundation and Terraform state...")
    try:
        inspect_env = _ensure_admin_env_reuse(orchestrator, callbacks) if (
            orchestrator.admin_session is not None and not orchestrator.admin_session.is_expired()
        ) else orchestrator.get_runtime_aws_env()
        report = inspect_foundation_state(fdir, aws_env=inspect_env)
        cls = report["classification"]
        orchestrator._emit_step("foundation_inspect", "Foundation State Classification", "success", f"{cls}: {report['recommended_action']}")

        if cls == STATE_HEALTHY:
            orchestrator.state_store.update_stage("foundation", "completed", summary="Foundation healthy (0 changes)")
            orchestrator.state_store.update_stage("secrets", "completed", summary="All 9 /envscale/prod/* SecureStrings verified")
            tracker.succeed(outcome="READY", message="Foundation already healthy (no changes needed)")
            return {"status": "SUCCEEDED", "outcome": "READY", "classification": cls, "changes_made": 0, "report": report, "failure": None, "state": orchestrator.state_store.load()}

        if cls == STATE_BOOTSTRAP_REQUIRED:
            current_stage = "bootstrap_reconcile"
            tracker.transition("PREFLIGHT", stage="bootstrap_reconcile", message="Reconciling protected Foundation IAM via bootstrap-state.sh...")
            admin_env = _ensure_admin_env_reuse(orchestrator, callbacks)
            if admin_env is None:
                return {"status": "NEEDS_MFA", "outcome": "BLOCKED", "classification": cls, "report": report, "failure": None, "state": orchestrator.state_store.load()}
            b_res = reconcile_foundation(
                fdir,
                dry_run=False,
                apply_bootstrap=True,
                approval_cb=callbacks.on_approval,
                aws_env=admin_env,
            )
            report = b_res["report"]
            cls = report["classification"]
            orchestrator._emit_step("bootstrap_reconcile", "Bootstrap IAM Reconciliation", "success", f"Applied {b_res.get('changes_made', 0)} change(s)")

        f_res: Optional[Dict[str, Any]] = None
        if cls == STATE_FOUNDATION_DEPLOY_REQUIRED:
            current_stage = "foundation"
            tracker.transition("PROVISIONING", stage="foundation", message="Applying Persistent Foundation via GitHub Actions OIDC...")
            f_res = orchestrator.run_stage("foundation", callbacks=callbacks, ref=ref, plan_only=plan_only, **opts)
            if f_res.get("status") in ("needs_approval", "needs_mfa"):
                return {"status": f_res["status"].upper(), "outcome": "BLOCKED", "classification": cls, "foundation": f_res, "secrets": None, "failure": None, "state": orchestrator.state_store.load()}
            post_env = (orchestrator.admin_session.build_env() if orchestrator.admin_session and not orchestrator.admin_session.is_expired() else orchestrator.get_runtime_aws_env())
            report = inspect_foundation_state(fdir, aws_env=post_env)
            cls = report["classification"]

        s_res: Optional[Dict[str, Any]] = None
        if cls == STATE_SECRETS_REQUIRED:
            current_stage = "secrets"
            tracker.transition("DEPLOYING", stage="secrets", message="Verifying and seeding /envscale/prod/* SSM secrets...")
            s_res = orchestrator.run_stage("secrets", callbacks=callbacks, **opts)
            if s_res.get("status") in ("needs_approval", "needs_mfa"):
                return {"status": s_res["status"].upper(), "outcome": "BLOCKED", "classification": cls, "foundation": f_res, "secrets": s_res, "failure": None, "state": orchestrator.state_store.load()}

        tracker.succeed(outcome="READY", message="Persistent Foundation reconciled and verified")
        return {"status": "SUCCEEDED", "outcome": "READY", "classification": cls, "foundation": f_res, "secrets": s_res, "report": report, "failure": None, "state": orchestrator.state_store.load()}
    except Exception as exc:
        tracker.fail(
            phase="FAILED", outcome="FAILED", failed_stage=current_stage, error=redact_sensitive_text(str(exc)),
            rollback_attempted=False, infrastructure_active=bool(CloudDeployer().get_instance_id()),
            recovery_action="Inspect Execution Logs; run deployment/bootstrap/reconcile-foundation.sh --dry-run to diagnose.",
        )
        if raise_on_error:
            raise
        return {"status": "FAILED", "outcome": "FAILED", "foundation": None, "secrets": None, "failure": tracker.failure, "state": orchestrator.state_store.load()}


def register_ops_reconcile_command(ops_group: click.Group) -> None:
    """Attach `ops reconcile-foundation` to the CLI ops group without bloating cli_cloud_ops.py."""

    @ops_group.command("reconcile-foundation")
    @click.option("--apply-bootstrap", is_flag=True, default=False, help="Apply reviewed bootstrap IAM plan (requires MFA admin + SHA-256)")
    @click.option("--confirm-plan-sha256", default=None, help="Reviewed bootstrap plan SHA-256")
    @click.option("--deploy-foundation", is_flag=True, default=False, help="Dispatch foundation.yml OIDC workflow when needed")
    @click.option("--ref", default="develop", help="Git ref for foundation.yml")
    @click.option("--json", "as_json", is_flag=True, default=False, help="Print JSON output")
    def ops_reconcile_foundation(apply_bootstrap: bool, confirm_plan_sha256: Optional[str], deploy_foundation: bool, ref: str, as_json: bool) -> None:
        """Inspect and reconcile Foundation IAM, GitHub OIDC deployment, and SSM readiness."""
        from .cloud_identity import load_ram_admin_session, load_ram_runtime_session
        sess = load_ram_admin_session(verify_caller=True) or load_ram_runtime_session(verify_caller=True)
        aws_env = sess.build_env() if sess and not sess.is_expired() else None
        fdir = pathlib.Path(PROJECT_ROOT) / "deployment" / "foundation"
        res = reconcile_foundation(
            fdir,
            dry_run=not (apply_bootstrap or deploy_foundation),
            apply_bootstrap=apply_bootstrap,
            expected_plan_sha256=confirm_plan_sha256,
            deploy_foundation=deploy_foundation,
            ref=ref,
            aws_env=aws_env,
        )
        if as_json:
            click.echo(json.dumps(res, indent=2, default=sorted))
        else:
            click.echo(f"{res['classification']} -> {res['status']} (applied={res['applied']})")

