"""Streamlined demo deploy/destroy orchestration helpers reusing existing control-plane stages and guards."""

from __future__ import annotations

import json
import os
import pathlib
import shutil
import subprocess
from typing import TYPE_CHECKING, Any, Callable, Dict, Optional

from .cloud_deployer import CloudDeployer
from .cloud_identity import (
    DEFAULT_ACCOUNT_ID,
    DEFAULT_REGION,
    RUNTIME_PROVISIONER_ROLE_NAME,
    redact_sensitive_text,
    resolve_recovery_bucket,
)
from .config import PROJECT_ROOT, TERRAFORM_DIR
from .postgres_backup_verifier import extract_tfstate_deployment_identity
from .ssm_deployer import (
    resolve_and_validate_manifest,
    verify_runtime_instance_profile,
    verify_ssm_parameters_present,
    wait_for_ssm_online,
)
from .tfstate_sync import parse_and_validate_tfstate, verify_tfstate_consistency_with_s3

if TYPE_CHECKING:
    from .cloud_orchestrator import CloudOrchestrator, OrchestratorCallbacks, PipelineStateStore

_RunFn = Callable[..., subprocess.CompletedProcess]


class FoundationNotInitializedError(RuntimeError):
    """Raised when Persistent Foundation IAM resources are not yet provisioned in AWS."""


def check_role_exists_for_mfa(aws_info: Dict[str, Any], role_name: str) -> None:
    """Fail fast before TOTP entry when the Runtime Provisioner role is absent in AWS."""
    if role_name != RUNTIME_PROVISIONER_ROLE_NAME:
        return
    role_entry = (aws_info.get("roles") or {}).get(role_name)
    if (
        isinstance(role_entry, dict)
        and role_entry.get("exists") is False
        and "AccessDenied" not in str(role_entry.get("error") or "")
    ):
        raise FoundationNotInitializedError(
            f"Missing IAM role '{role_name}' in AWS. Complete Foundation IAM reconciliation "
            "(bootstrap-state.sh --bootstrap-foundation-iam --reconcile-existing) and Persistent "
            "Foundation deployment (foundation.yml) before assuming the Runtime role."
        )


def _default_tfstate_path() -> str:
    return os.path.join(TERRAFORM_DIR, "terraform.tfstate")


def run_demo_preflight(
    orchestrator: "CloudOrchestrator",
    callbacks: "OrchestratorCallbacks",
    *,
    account_id: str = DEFAULT_ACCOUNT_ID,
    region: str = DEFAULT_REGION,
) -> Dict[str, Any]:
    """Run internal demo preflight using a single Runtime Provisioner STS session (no Admin MFA)."""
    sid, title = "demo_preflight", "Demo Preflight"
    orchestrator._emit_step(sid, title, "start", "Checking tools, Runtime STS session, Foundation, and SSM")
    try:
        missing_tools = [t for t in ("aws", "gh", "terraform", "git", "python3") if shutil.which(t) is None]
        if missing_tools:
            raise RuntimeError(f"Missing required CLI tool(s) on PATH: {', '.join(missing_tools)}.")

        verified_env = orchestrator._require_verified_runtime_env(callbacks, account_id=account_id, region=region)
        try:
            verify_runtime_instance_profile(emit_fn=orchestrator.step_fn, step_id=sid, step_title=title, aws_env=verified_env)
            CloudDeployer(log_fn=orchestrator.log_fn, step_fn=orchestrator.step_fn, aws_env=verified_env).ensure_s3_vault(
                step_id=sid, step_title=title
            )
        except Exception as exc:
            raise RuntimeError(
                f"{exc} Complete Persistent Foundation setup under 'Advanced Operations & Administration' first."
            ) from exc

        try:
            verify_ssm_parameters_present(
                region=region, aws_env=verified_env, emit_fn=orchestrator.step_fn, step_id=sid, step_title=title
            )
        except Exception as exc:
            raise RuntimeError(
                f"{exc} Seed /envscale/prod/* secrets under 'Advanced Operations & Administration' first."
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


def run_demo_deploy(
    orchestrator: "CloudOrchestrator",
    callbacks: "OrchestratorCallbacks",
    *,
    target_sha: Optional[str] = None,
    manifest_path: Optional[str] = None,
    branch: str = "develop",
    account_id: str = DEFAULT_ACCOUNT_ID,
    region: str = DEFAULT_REGION,
) -> Dict[str, Any]:
    """Single-click Demo Deploy: preflight -> release manifest -> provision/start -> deploy -> verify."""
    pre = run_demo_preflight(orchestrator, callbacks, account_id=account_id, region=region)
    verified_env = pre["aws_env"]
    orchestrator.state_store.update_stage("preflight", "completed", summary="Demo preflight passed")

    ctx = orchestrator.state_store.load().get("context", {})
    candidate = manifest_path or ctx.get("manifest_path") or ""
    default_manifest = pathlib.Path(PROJECT_ROOT) / "release-manifest.json"
    if not candidate and default_manifest.is_file():
        candidate = str(default_manifest)

    need_release_fetch = not candidate or not pathlib.Path(candidate).is_file()
    eff_sha = (target_sha or "").strip()
    release_id = str(ctx.get("release_id") or "")
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
        candidate = rel["manifest_path"]
        eff_sha = rel["commit_sha"]
        release_id = rel["release_id"]
    else:
        deployer_ctx = CloudDeployer(log_fn=orchestrator.log_fn, step_fn=orchestrator.step_fn, aws_env=verified_env).get_aws_context()
        validated = resolve_and_validate_manifest(
            commit_sha=eff_sha,
            manifest_path=candidate,
            recovery_bucket=deployer_ctx.get("recovery_bucket"),
            region=region,
            aws_env=verified_env,
        )
        candidate = str(validated)
        orchestrator.state_store.update_context(target_sha=eff_sha, manifest_path=candidate, release_id=release_id)
        orchestrator.state_store.update_stage("release", "completed", summary=f"{release_id} ({eff_sha[:7]})")

    deployer = CloudDeployer(log_fn=orchestrator.log_fn, step_fn=orchestrator.step_fn, aws_env=verified_env)
    resumed = _maybe_start_stopped_host(deployer, aws_env=verified_env, region=region, emit_fn=orchestrator.step_fn)
    if resumed:
        orchestrator.state_store.update_context(instance_id=resumed["instance_id"], public_ip=resumed["ip"])
        orchestrator.state_store.update_stage(
            "provision", "completed", summary=f"Started stopped EC2 {resumed['instance_id']} ({resumed['ip']})"
        )
    else:
        orchestrator.run_stage("provision", callbacks=callbacks, account_id=account_id, region=region)

    dep = orchestrator.run_stage(
        "deploy", callbacks=callbacks, target_sha=eff_sha, manifest_path=candidate, account_id=account_id, region=region
    )
    ver = orchestrator.run_stage("verify", callbacks=callbacks, account_id=account_id, region=region)
    state = orchestrator.state_store.load()
    final_ctx = state.get("context", {})
    return {
        "status": "completed",
        "app_url": ver.get("app_url") or dep.get("app_url") or final_ctx.get("app_url") or "",
        "instance_id": dep.get("instance_id") or final_ctx.get("instance_id") or "",
        "public_ip": dep.get("public_ip") or final_ctx.get("public_ip") or "",
        "release_id": release_id,
        "resumed": bool(resumed),
        "state": state,
    }


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
        "account_id": account_id,
        "region": region,
        "instance_id": instance_id,
        "vpc_id": str(ident.get("vpc_id") or ""),
        "tf_lineage": str(ident.get("tf_lineage") or ""),
        "app_url": str(ctx.get("app_url") or ""),
        "recovery_bucket": resolve_recovery_bucket(account_id=account_id, region=region),
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
        raise RuntimeError(
            f"Destruction blocked: target scope ({account_id}, {region}) does not match "
            f"allowed demo scope ({DEFAULT_ACCOUNT_ID}, {DEFAULT_REGION})."
        )
    tf_path = tf_state_path or _default_tfstate_path()
    verify_tfstate_consistency_with_s3(
        local_path=tf_path, account_id=account_id, region=region, aws_env=aws_env, run_fn=run_fn
    )
    ident = extract_tfstate_deployment_identity(tf_path) if os.path.isfile(tf_path) else {}
    instance_id = deployer.get_instance_id() or str(ident.get("state_instance_id") or "")
    vpc_id = str(ident.get("vpc_id") or "")
    if instance_id:
        inst = _describe_ec2_instance(instance_id, region=region, aws_env=aws_env, run_fn=run_fn)
        tags = {str(t.get("Key")): str(t.get("Value")) for t in (inst.get("Tags") or []) if isinstance(t, dict)}
        if tags.get("Project") != "EnvScale" or tags.get("Layer") != "DisposableRuntime":
            raise RuntimeError(
                f"Destruction blocked: EC2 {instance_id} tags (Project={tags.get('Project')!r}, "
                f"Layer={tags.get('Layer')!r}) do not match EnvScale DisposableRuntime."
            )
        live_vpc = str(inst.get("VpcId") or "")
        if vpc_id and live_vpc != vpc_id:
            raise RuntimeError(
                f"Destruction blocked: EC2 {instance_id} VPC ({live_vpc!r}) does not match Terraform state VPC ({vpc_id!r})."
            )
        vpc_id = live_vpc or vpc_id
    return {
        "verified": True,
        "account_id": account_id,
        "region": region,
        "instance_id": instance_id,
        "vpc_id": vpc_id,
        "tf_lineage": str(ident.get("tf_lineage") or ""),
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
            raise RuntimeError(
                f"Teardown verification failed: Terraform state still reports {meta['resource_count']} active resource(s)."
            )
    inst_state = "none"
    if destroyed_instance_id:
        res = run_fn(
            ["aws", "ec2", "describe-instances", "--instance-ids", destroyed_instance_id, "--region", region, "--output", "json"],
            capture_output=True, text=True, env=aws_env,
        )
        if res.returncode != 0:
            err = redact_sensitive_text((res.stderr or res.stdout or "").strip())
            if "InvalidInstanceID.NotFound" in err:
                inst_state = "not_found"
            else:
                raise RuntimeError(f"Post-destroy EC2 verification failed for {destroyed_instance_id}: {err}")
        else:
            doc = json.loads(res.stdout or "{}")
            reservations = doc.get("Reservations") or []
            instances = (reservations[0].get("Instances") or []) if reservations else []
            inst_state = str(((instances[0].get("State") or {}).get("Name")) or "not_found") if instances else "not_found"
            if inst_state not in ("terminated", "shutting-down", "not_found"):
                raise RuntimeError(
                    f"Teardown verification failed: EC2 instance {destroyed_instance_id} is still in state '{inst_state}'."
                )
    return {"verified": True, "remaining_resources": 0, "instance_state": inst_state}

