#!/usr/bin/env python3
"""EnvScale Repeatable Foundation Reconciliation & Bootstrap Plan Executor.

Builds validated bootstrap Terraform plans, enforces state monotonicity, delegates
protected IAM reconciliation to bootstrap-state.sh and Foundation deployments to
.github/workflows/foundation.yml, and reuses unexpired RAM MFA sessions.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import pathlib
import subprocess
import sys
import tempfile
from typing import Any, Callable, Dict, List, Optional

_BOOTSTRAP_DIR = pathlib.Path(__file__).resolve().parent
_REPO_ROOT = _BOOTSTRAP_DIR.parent.parent
_SCRIPTS_DIR = _REPO_ROOT / "scripts"
for _p in (str(_BOOTSTRAP_DIR), str(_SCRIPTS_DIR)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from foundation_state_inspector import (  # noqa: E402
    DEFAULT_RECOVERY_BUCKET,
    DEFAULT_REGION,
    DEFAULT_SSM_PREFIX,
    DEFAULT_STATE_KEY,
    DEFAULT_TFSTATE_BUCKET,
    PROTECTED_BOUNDARY_SPECS,
    PROTECTED_ROLE_SPECS,
    REQUIRED_NON_SECRET_SSM_KEYS,
    REQUIRED_SECURESTRING_KEYS,
    REQUIRED_WORKLOAD_ROLES,
    STATE_BOOTSTRAP_REQUIRED,
    STATE_FOUNDATION_DEPLOY_REQUIRED,
    STATE_HEALTHY,
    STATE_SECRETS_REQUIRED,
    AwsCliFn,
    default_aws_cli,
    inspect_foundation_state,
    read_live_tfstate_meta,
    verify_state_monotonicity,
)
from plan_iam_safety import (  # noqa: E402
    PROTECTED_FOUNDATION_IAM_ADDRESSES,
    verify_bootstrap_iam_and_boundary_live,
)

RunFn = Callable[..., subprocess.CompletedProcess]


def generate_and_validate_bootstrap_plan(
    foundation_dir: pathlib.Path,
    *,
    backend_hcl: Optional[pathlib.Path] = None,
    plan_dir: Optional[pathlib.Path] = None,
    existing_plan_bin: Optional[pathlib.Path] = None,
    aws_cli: Optional[AwsCliFn] = None,
    aws_env: Optional[Dict[str, str]] = None,
    run_fn: RunFn = subprocess.run,
    inspection: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Generate (or inspect an existing) targeted bootstrap plan, verify monotonicity, and run plan validator."""
    fdir = pathlib.Path(foundation_dir).resolve()
    report = inspection or inspect_foundation_state(fdir, aws_cli=aws_cli, aws_env=aws_env)
    prot = report["protected_iam"]
    if prot["untracked_in_state"]:
        raise RuntimeError(
            f"Refusing silent import of existing AWS protected IAM resources not in state: {prot['untracked_in_state']}"
        )
    if prot["unexpected"]:
        raise RuntimeError(f"Unexpected protected IAM anomalies detected: {prot['unexpected']}")

    pre_meta = read_live_tfstate_meta(aws_cli=aws_cli, aws_env=aws_env)
    work_dir = pathlib.Path(plan_dir) if plan_dir else pathlib.Path(tempfile.mkdtemp(prefix="envscale-reconcile-plan-"))
    work_dir.mkdir(parents=True, exist_ok=True)
    os.chmod(work_dir, 0o700)
    plan_json = work_dir / "bootstrap.reconcile.tfplan.json"

    hcl = backend_hcl or (fdir / "backend.hcl")
    if hcl.is_file():
        run_fn(["terraform", "init", "-input=false", f"-backend-config={hcl}"], cwd=str(fdir), env=aws_env, check=True)
    if existing_plan_bin is not None:
        plan_bin = pathlib.Path(existing_plan_bin).resolve()
        if not plan_bin.is_file():
            raise FileNotFoundError(f"Reviewed bootstrap plan binary not found: {plan_bin}")
    else:
        plan_bin = work_dir / "bootstrap.reconcile.tfplan"
        targets = [f"-target={a}" for a in sorted(PROTECTED_FOUNDATION_IAM_ADDRESSES)]
        run_fn(
            ["terraform", "plan", "-input=false", "-lock=false", f"-out={plan_bin}", *targets],
            cwd=str(fdir), env=aws_env, check=True,
        )
        os.chmod(plan_bin, 0o600)

    show_proc = run_fn(
        ["terraform", "show", "-json", str(plan_bin)],
        cwd=str(fdir), env=aws_env, capture_output=True, text=True, check=True,
    )
    plan_json.write_text(show_proc.stdout, encoding="utf-8")
    os.chmod(plan_json, 0o600)
    plan_doc = json.loads(show_proc.stdout)

    post_meta = read_live_tfstate_meta(aws_cli=aws_cli, aws_env=aws_env)
    verify_state_monotonicity(pre_meta, post_meta, plan_doc=plan_doc)

    spec = importlib.util.spec_from_file_location("validate_foundation_plan", str(_BOOTSTRAP_DIR / "validate-foundation-plan.py"))
    vmod = importlib.util.module_from_spec(spec)  # type: ignore[arg-type]
    assert spec and spec.loader
    spec.loader.exec_module(vmod)  # type: ignore[union-attr]

    old_ci = {k: os.environ.pop(k, None) for k in ("GITHUB_ACTIONS", "CI")}
    try:
        errors = vmod.validate_plan_doc(plan_doc, mode="bootstrap", allow_protected_iam_updates=True)
    finally:
        for k, v in old_ci.items():
            if v is not None:
                os.environ[k] = v

    if errors:
        raise RuntimeError(f"Plan failed safety validation: {'; '.join(errors)}")

    changes: List[Dict[str, Any]] = []
    for rc in plan_doc.get("resource_changes") or []:
        if rc.get("mode") != "managed":
            continue
        addr = str(rc.get("address", ""))
        acts = list((rc.get("change") or {}).get("actions") or [])
        if "delete" in acts or len(acts) > 1:
            raise RuntimeError(f"Destructive or replace action rejected on '{addr}': {acts}")
        if addr not in PROTECTED_FOUNDATION_IAM_ADDRESSES:
            raise RuntimeError(f"Non-protected resource rejected in bootstrap plan: '{addr}'")
        if acts != ["no-op"]:
            changes.append({"address": addr, "actions": acts})

    plan_sha = hashlib.sha256(plan_bin.read_bytes()).hexdigest()
    return {
        "plan_bin": str(plan_bin),
        "plan_json": str(plan_json),
        "plan_sha256": plan_sha,
        "has_changes": bool(changes),
        "changes": changes,
        "state_fingerprint": {
            "version_id": post_meta["version_id"],
            "etag": post_meta["etag"],
            "serial": post_meta["serial"],
        },
    }


def reconcile_foundation(
    foundation_dir: Optional[pathlib.Path] = None,
    *,
    dry_run: bool = True,
    apply_bootstrap: bool = False,
    expected_plan_sha256: Optional[str] = None,
    plan_bin: Optional[str] = None,
    deploy_foundation: bool = False,
    plan_only_oidc: bool = False,
    ref: str = "develop",
    approval_cb: Optional[Callable[[Dict[str, Any]], bool]] = None,
    aws_cli: Optional[AwsCliFn] = None,
    aws_env: Optional[Dict[str, str]] = None,
    run_fn: RunFn = subprocess.run,
) -> Dict[str, Any]:
    """Inspect live Foundation state and execute only explicitly authorized reconciliation."""
    fdir = pathlib.Path(foundation_dir or (_REPO_ROOT / "deployment/foundation")).resolve()
    report = inspect_foundation_state(fdir, aws_cli=aws_cli, aws_env=aws_env)
    cls = report["classification"]

    if cls == STATE_HEALTHY:
        return {"status": "NO_CHANGES", "classification": cls, "applied": False, "changes_made": 0, "report": report}

    if cls == STATE_BOOTSTRAP_REQUIRED:
        plan_info = generate_and_validate_bootstrap_plan(
            fdir,
            existing_plan_bin=pathlib.Path(plan_bin) if plan_bin else None,
            aws_cli=aws_cli,
            aws_env=aws_env,
            run_fn=run_fn,
            inspection=report,
        )
        if dry_run or not apply_bootstrap:
            return {"status": "NEEDS_BOOTSTRAP_APPLY", "classification": cls, "applied": False, "plan": plan_info, "report": report}

        actual_sha = plan_info["plan_sha256"]
        if expected_plan_sha256:
            if actual_sha.lower() != expected_plan_sha256.lower().strip():
                raise RuntimeError(f"Plan SHA-256 mismatch: expected {expected_plan_sha256}, got {actual_sha}")
        elif approval_cb is None or not approval_cb({"kind": "bootstrap_reconcile", **plan_info}):
            raise RuntimeError(f"Bootstrap apply aborted: missing matching --confirm-plan-sha256 ({actual_sha}) or explicit operator approval.")

        live_now = read_live_tfstate_meta(aws_cli=aws_cli, aws_env=aws_env)
        verify_state_monotonicity(plan_info["state_fingerprint"] | {"exists": True}, live_now)

        bs_script = str(_BOOTSTRAP_DIR / "bootstrap-state.sh")
        run_fn(
            [
                "bash", bs_script,
                "--bootstrap-foundation-iam",
                "--reconcile-existing",
                "--plan-bin", plan_info["plan_bin"],
                "--plan-sha256", actual_sha,
            ],
            cwd=str(_REPO_ROOT),
            env=aws_env,
            check=True,
        )
        iam_caller = (lambda op, params: (aws_cli or (lambda s, o, p: default_aws_cli(s, o, p, env=aws_env)))("iam", op, params))
        live_ver = verify_bootstrap_iam_and_boundary_live(fdir, iam_caller=iam_caller)
        post_report = inspect_foundation_state(fdir, aws_cli=aws_cli, aws_env=aws_env)
        return {
            "status": "APPLIED_BOOTSTRAP",
            "classification": post_report["classification"],
            "applied": True,
            "changes_made": len(plan_info["changes"]),
            "plan": plan_info,
            "live_verification": live_ver,
            "report": post_report,
        }

    if cls == STATE_FOUNDATION_DEPLOY_REQUIRED:
        if dry_run or not deploy_foundation:
            return {"status": "NEEDS_FOUNDATION_DEPLOY", "classification": cls, "applied": False, "report": report}
        cmd = [
            "gh", "workflow", "run", "foundation.yml", "--ref", ref,
            "-f", f"action={'plan-only' if plan_only_oidc else 'plan-and-apply'}", "-f", "plan_mode=auto",
        ]
        if not plan_only_oidc:
            cmd.extend(["-f", "apply_confirmation=APPLY-FOUNDATION"])
        run_fn(cmd, cwd=str(_REPO_ROOT), check=True)
        return {"status": "DISPATCHED_FOUNDATION_OIDC", "classification": cls, "applied": True, "ref": ref, "plan_only": plan_only_oidc, "report": report}

    return {"status": "NEEDS_SECRETS_INIT", "classification": cls, "applied": False, "report": report}


def _resolve_cli_aws_env() -> Optional[Dict[str, str]]:
    if os.environ.get("AWS_ACCESS_KEY_ID") and os.environ.get("AWS_SESSION_TOKEN"):
        return None
    try:
        from lib.cloud_identity import load_ram_admin_session, load_ram_runtime_session
        admin = load_ram_admin_session(verify_caller=True)
        if admin is not None and not admin.is_expired():
            return admin.build_env()
        rt = load_ram_runtime_session(verify_caller=True)
        if rt is not None and not rt.is_expired():
            return rt.build_env()
    except Exception:
        pass
    return None


def main() -> None:
    p = argparse.ArgumentParser(description="EnvScale Repeatable Foundation Reconciliation")
    p.add_argument("--inspect", action="store_true", help="Read-only inspection and 4-state classification (default)")
    p.add_argument("--dry-run", action="store_true", help="Inspect and generate/validate bootstrap plan if needed without applying")
    p.add_argument("--apply-bootstrap", action="store_true", help="Apply reviewed bootstrap plan via bootstrap-state.sh")
    p.add_argument("--plan-bin", default=None, help="Existing reviewed .tfplan binary path to inspect/apply without re-planning")
    p.add_argument("--confirm-plan-sha256", default=None, help="Reviewed bootstrap plan SHA-256 required for --apply-bootstrap")
    p.add_argument("--deploy-foundation", action="store_true", help="Dispatch .github/workflows/foundation.yml when Foundation deploy is required")
    p.add_argument("--plan-only", action="store_true", help="Dispatch foundation.yml with action=plan-only")
    p.add_argument("--ref", default="develop", help="Git ref for foundation.yml dispatch")
    p.add_argument("--json", action="store_true", help="Emit structured JSON report")
    args = p.parse_args()

    aws_env = _resolve_cli_aws_env()
    if args.inspect or (not args.dry_run and not args.apply_bootstrap and not args.deploy_foundation):
        report = inspect_foundation_state(_REPO_ROOT / "deployment/foundation", aws_env=aws_env)
        res = {
            "status": "NO_CHANGES" if report["classification"] == STATE_HEALTHY else report["classification"],
            "classification": report["classification"],
            "applied": False,
            "changes_made": 0,
            "report": report,
        }
    else:
        res = reconcile_foundation(
            _REPO_ROOT / "deployment/foundation",
            dry_run=bool(args.dry_run),
            apply_bootstrap=bool(args.apply_bootstrap),
            expected_plan_sha256=args.confirm_plan_sha256,
            plan_bin=args.plan_bin,
            deploy_foundation=bool(args.deploy_foundation),
            plan_only_oidc=bool(args.plan_only),
            ref=args.ref,
            aws_env=aws_env,
        )
    if args.json:
        print(json.dumps(res, indent=2, default=sorted))
    else:
        r = res["report"]
        print(f"Classification : {res['classification']}")
        print(f"Status         : {res['status']} (applied={res['applied']})")
        print(f"TF State       : version_id={r['state_metadata']['version_id']} serial={r['state_metadata']['serial']}")
        print(f"Protected IAM  : missing={r['protected_iam']['missing']} drifted={r['protected_iam']['drifted']} untracked={r['protected_iam']['untracked_in_state']}")
        print(f"Foundation     : missing={r['foundation_resources']['missing']}")
        print(f"SSM Secrets    : {r['ssm_secrets']['present_count']}/9 (missing={r['ssm_secrets']['missing_securestrings']})")
        print(f"Next Action    : {r['recommended_action']}")


if __name__ == "__main__":
    main()
