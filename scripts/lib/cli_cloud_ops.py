"""Rich/Click CLI commands (`ops`) for EnvScale's 7-stage operational control plane."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

import click
from rich.console import Console
from rich.panel import Panel
from rich.prompt import Confirm
from rich.table import Table

from .cloud_identity import (
    ADMIN_ROLE_NAME,
    RUNTIME_PROVISIONER_ROLE_NAME,
    AwsSessionContext,
    assume_foundation_admin_role,
    assume_runtime_provisioner_role,
    build_profile_env,
    complete_virtual_mfa_enrollment,
    inspect_aws_identity,
    load_ram_admin_session,
    load_ram_runtime_session,
    redact_sensitive_text,
    start_virtual_mfa_enrollment,
)
from .cloud_ops_dashboard import (
    ALLOWED_REMOTE_SERVICES,
    fetch_ops_snapshot,
    fetch_remote_logs,
    trigger_remote_backup,
    trigger_remote_verify,
)
from .cloud_orchestrator import STAGE_IDS, CloudOrchestrator, OrchestratorCallbacks, PipelineStateStore

console = Console()


def _cli_step_fn(step_id: str, title: str, status: str, detail: str = "") -> None:
    safe = redact_sensitive_text(detail)
    if status == "start":
        console.print(f"[bold cyan]▶ {title}[/bold cyan] [dim]{safe}[/dim]")
    elif status == "log" and safe:
        console.print(f"  [dim]{safe}[/dim]")
    elif status == "success":
        console.print(f"[bold green]✔ {title}:[/bold green] {safe}")
    elif status == "error":
        console.print(f"[bold red]✘ {title}:[/bold red] {safe}")


def _cli_approval(payload: Dict[str, Any]) -> bool:
    kind = payload.get("kind", "")
    if kind == "configure_github_foundation_vars":
        table = Table(title="GitHub Foundation Variables to Configure", header_style="bold yellow")
        table.add_column("Variable")
        table.add_column("Environment")
        table.add_column("Existing Role ARN")
        for var_name, (env_name, role_arn) in payload.get("vars", {}).items():
            table.add_row(var_name, env_name, role_arn)
        console.print(table)
        return Confirm.ask("Configure these missing GitHub Environment variables now?")

    if kind == "foundation_apply":
        summary = payload.get("plan_summary", {})
        counts = summary.get("counts", {})
        console.print(
            Panel(
                f"Run #{payload.get('plan_run_id')} ({payload.get('run_url', '')})\n"
                f"Plan counts: create={counts.get('create', 0)}, update={counts.get('update', 0)}, "
                f"delete={counts.get('delete', 0)}, replace={counts.get('replace', 0)}",
                title="Foundation Terraform Plan Review",
                border_style="yellow",
            )
        )
        for ch in summary.get("changes", [])[:25]:
            console.print(f"  [cyan]{','.join(ch.get('actions', []))}[/cyan] {ch.get('address', '')}")
        typed = click.prompt("Type APPLY-FOUNDATION to approve applying this plan (or 'cancel')", default="cancel")
        return typed.strip() == "APPLY-FOUNDATION"

    return Confirm.ask(f"Approve operation ({kind})?")


def _cli_ensure_role_session(runtime_profile: Optional[str], *, role_name: str) -> AwsSessionContext:
    if role_name == ADMIN_ROLE_NAME:
        ram_loader, assume_fn, label = load_ram_admin_session, assume_foundation_admin_role, "Foundation Admin"
    elif role_name == RUNTIME_PROVISIONER_ROLE_NAME:
        ram_loader, assume_fn, label = load_ram_runtime_session, assume_runtime_provisioner_role, "Runtime Provisioner"
    else:
        raise ValueError(f"Unsupported MFA role '{role_name}'.")

    runtime_env = build_profile_env(runtime_profile) if runtime_profile else None
    info = inspect_aws_identity(aws_env=runtime_env, profile=runtime_profile)
    if not info.get("authenticated"):
        raise click.ClickException(info.get("error", "AWS CLI is not authenticated."))

    ram_kw: Dict[str, str] = {}
    if info.get("account_id"):
        ram_kw["account_id"] = info["account_id"]
    if info.get("region"):
        ram_kw["region"] = info["region"]
    ram_session = ram_loader(**ram_kw)
    if ram_session is not None:
        console.print(
            f"[green]✔ Reusing verified RAM {label} session:[/green] "
            f"{redact_sensitive_text(ram_session.caller_arn)} "
            f"(expires {ram_session.expires_at_utc})"
        )
        return ram_session

    serials = info.get("mfa_serials", [])
    if not serials:
        unsupported = info.get("unsupported_mfa_serials", [])
        if unsupported:
            console.print(
                f"[yellow]Ignoring non-TOTP MFA device(s) unsupported by STS AssumeRole: "
                f"{', '.join(unsupported)}[/yellow]"
            )
        user_name = info.get("user_name")
        if not user_name:
            raise click.ClickException("No TOTP MFA device enrolled and caller is not an IAM user.")
        if not Confirm.ask(f"No TOTP MFA device enrolled on '{user_name}'. Enroll a virtual MFA device now?"):
            raise click.ClickException(f"TOTP MFA enrollment is required before assuming {role_name}.")
        enroll = start_virtual_mfa_enrollment(user_name=user_name, account_id=info["account_id"], aws_env=runtime_env)
        console.print(Panel(
            f"[bold]Serial:[/bold] {enroll['serial_number']}\n"
            f"[bold]Base32 Seed (enter into authenticator app):[/bold] {enroll['base32_seed']}\n"
            f"[bold]OTPAuth URI:[/bold] {enroll['otpauth_uri']}\n"
            "[dim]Displayed interactively only — never logged or saved to disk.[/dim]",
            title="One-Time Virtual MFA Enrollment",
            border_style="magenta",
        ))
        c1 = click.prompt("Enter 1st 6-digit TOTP code", hide_input=True)
        c2 = click.prompt("Enter next consecutive 6-digit TOTP code", hide_input=True)
        complete_virtual_mfa_enrollment(user_name, enroll["serial_number"], c1, c2, aws_env=runtime_env)
        serials = [enroll["serial_number"]]
        console.print(f"[green]✔ Virtual MFA enabled on '{user_name}'.[/green]")

    chosen_serial = serials[0]
    console.print(f"[cyan]Assuming {role_name} ({label}) using TOTP MFA {chosen_serial}...[/cyan]")
    token_code = click.prompt("Enter current 6-digit MFA TOTP code", hide_input=True)
    return assume_fn(
        mfa_serial=chosen_serial,
        token_code=token_code,
        account_id=info["account_id"],
        region=info["region"],
        aws_env=runtime_env,
    )


def _cli_ensure_admin_session(runtime_profile: Optional[str]) -> AwsSessionContext:
    return _cli_ensure_role_session(runtime_profile, role_name=ADMIN_ROLE_NAME)


def _cli_ensure_runtime_session(runtime_profile: Optional[str]) -> AwsSessionContext:
    return _cli_ensure_role_session(runtime_profile, role_name=RUNTIME_PROVISIONER_ROLE_NAME)


def _cli_runtime_aws_env(profile: Optional[str], *, require_runtime_role: bool = False) -> Optional[Dict[str, str]]:
    ram_sess = load_ram_runtime_session()
    if ram_sess is not None:
        return ram_sess.build_env()
    if require_runtime_role:
        return _cli_ensure_runtime_session(profile).build_env()
    return build_profile_env(profile) if profile else None


def _cli_secrets_input(existing: List[str], missing: List[str], defaults: Dict[str, str]) -> Dict[str, str]:
    console.print(Panel(
        f"Existing /envscale/prod/* params: {len(existing)}\n"
        f"Missing SecureStrings ({len(missing)}): {', '.join(missing) or 'none'}",
        title="SSM SecureString Seeding",
        border_style="cyan",
    ))
    duck_default = defaults.get("DUCKDNS_TOKEN", "")
    prompt_lbl = "DUCKDNS_TOKEN (required; press Enter to keep value from local .env)" if duck_default else "DUCKDNS_TOKEN (required)"
    duck_val = click.prompt(prompt_lbl, default=duck_default, hide_input=True, show_default=False).strip()
    if not duck_val:
        raise click.ClickException("DUCKDNS_TOKEN cannot be empty.")

    disp = click.prompt(
        "KUBECONFIG_ENCRYPTION_KEY disposition",
        type=click.Choice(["generate-fresh-no-historical-ciphertext", "preserve-from-secrets-file"]),
        default=defaults.get("kubeconfig_key_disposition", "generate-fresh-no-historical-ciphertext"),
    )
    out: Dict[str, str] = {"DUCKDNS_TOKEN": duck_val, "kubeconfig_key_disposition": disp}
    if disp == "preserve-from-secrets-file":
        out["KUBECONFIG_ENCRYPTION_KEY"] = click.prompt("Enter 32-byte Base64 KUBECONFIG_ENCRYPTION_KEY", hide_input=True).strip()
    if Confirm.ask("Configure optional Google/GitHub OAuth client secrets?", default=False):
        g_sec = click.prompt("GOOGLE_CLIENT_SECRET (blank to skip)", default="", hide_input=True, show_default=False).strip()
        gh_sec = click.prompt("GITHUB_CLIENT_SECRET (blank to skip)", default="", hide_input=True, show_default=False).strip()
        if g_sec:
            out["GOOGLE_CLIENT_SECRET"] = g_sec
        if gh_sec:
            out["GITHUB_CLIENT_SECRET"] = gh_sec
    return out


def _make_orchestrator(profile: Optional[str]) -> tuple[CloudOrchestrator, OrchestratorCallbacks]:
    orch = CloudOrchestrator(
        runtime_profile=profile,
        admin_session=load_ram_admin_session(),
        runtime_session=load_ram_runtime_session(),
        step_fn=_cli_step_fn,
    )
    cbs = OrchestratorCallbacks(
        on_approval=_cli_approval,
        on_mfa_session=lambda: _cli_ensure_admin_session(orch.runtime_profile),
        on_runtime_mfa_session=lambda: _cli_ensure_runtime_session(orch.runtime_profile),
        on_secrets_input=_cli_secrets_input,
    )
    return orch, cbs


@click.group("ops")
def ops():
    """Unified 7-stage cloud deployment control plane & operations dashboard."""


@ops.command("status")
def ops_status():
    """Show persisted non-sensitive progress across all 7 deployment stages."""
    store = PipelineStateStore()
    state = store.load()
    table = Table(title="EnvScale Cloud Control Plane Stages", header_style="bold cyan")
    table.add_column("Stage", style="bold")
    table.add_column("Title")
    table.add_column("Status", justify="center")
    table.add_column("Summary / Error")

    colors = {"completed": "green", "running": "cyan", "failed": "red", "needs_approval": "yellow", "needs_mfa": "yellow", "pending": "dim"}
    for sid in STAGE_IDS:
        st = state["stages"][sid]
        status = st["status"]
        col = colors.get(status, "white")
        detail = st["error"] or st["summary"] or "-"
        table.add_row(sid, st["title"], f"[{col}]{status.upper()}[/{col}]", detail)
    console.print(table)

    ctx = state.get("context", {})
    if ctx:
        ctx_lines = "\n".join(f"  [bold]{k}:[/bold] {v}" for k, v in ctx.items() if v)
        console.print(Panel(ctx_lines or "No context recorded yet.", title="Saved Context (Non-Sensitive)", border_style="blue"))
    nxt = store.next_incomplete_stage()
    console.print(f"Next incomplete stage: [bold cyan]{nxt or 'ALL COMPLETED'}[/bold cyan]")


@ops.command("preflight")
@click.option("--profile", default=None, help="Optional AWS CLI profile for runtime inspection")
def ops_preflight(profile):
    """Run Stage 1 preflight checks across tools, AWS identity, GitHub, Foundation, and Git."""
    orch, cbs = _make_orchestrator(profile)
    report = orch.run_stage("preflight", callbacks=cbs)
    table = Table(title="Stage 1: Preflight & Identity Diagnostics", header_style="bold cyan")
    table.add_column("Check", style="bold")
    table.add_column("Status", justify="center")
    table.add_column("Details")
    table.add_column("Remediation")
    for c in report["checks"]:
        st = c["status"]
        col = "green" if st == "pass" else ("yellow" if st == "warn" else "red")
        table.add_row(c["name"], f"[{col}]{st.upper()}[/{col}]", c["detail"], c["remediation"] or "-")
    console.print(table)


@ops.group("mfa")
def ops_mfa():
    """Manage one-time IAM virtual MFA enrollment."""


@ops_mfa.command("enroll")
@click.option("--profile", default=None, help="Optional AWS CLI profile")
def ops_mfa_enroll(profile):
    """Enroll a virtual TOTP MFA device on the current AWS IAM user."""
    runtime_env = build_profile_env(profile) if profile else None
    info = inspect_aws_identity(aws_env=runtime_env, profile=profile)
    if not info.get("authenticated"):
        raise click.ClickException(info.get("error", "AWS CLI not authenticated."))
    if info.get("mfa_enrolled"):
        console.print(f"[green]MFA already enrolled:[/green] {', '.join(info['mfa_serials'])}")
        return
    user_name = info.get("user_name")
    if not user_name:
        raise click.ClickException("Active AWS caller is not an IAM user.")
    enroll = start_virtual_mfa_enrollment(user_name=user_name, account_id=info["account_id"], aws_env=runtime_env)
    console.print(Panel(
        f"[bold]Serial:[/bold] {enroll['serial_number']}\n"
        f"[bold]Base32 Seed:[/bold] {enroll['base32_seed']}\n"
        f"[bold]OTPAuth URI:[/bold] {enroll['otpauth_uri']}",
        title="Virtual MFA Enrollment",
        border_style="magenta",
    ))
    c1 = click.prompt("1st 6-digit TOTP code", hide_input=True)
    c2 = click.prompt("2nd consecutive 6-digit TOTP code", hide_input=True)
    complete_virtual_mfa_enrollment(user_name, enroll["serial_number"], c1, c2, aws_env=runtime_env)
    console.print(f"[bold green]✔ Virtual MFA device enabled on {user_name}![/bold green]")


@ops.command("foundation")
@click.option("--plan-only", "plan_only", flag_value=True, default=False, help="Run OIDC Terraform plan only")
@click.option("--apply", "plan_only", flag_value=False, help="Run OIDC plan, prompt for approval, and apply")
@click.option("--ref", default="develop", help="Git ref for foundation.yml workflow")
@click.option("--profile", default=None, help="Optional AWS CLI profile")
def ops_foundation(plan_only, ref, profile):
    """Run Stage 2 Persistent Foundation plan/apply via GitHub Actions OIDC."""
    orch, cbs = _make_orchestrator(profile)
    res = orch.run_stage("foundation", callbacks=cbs, plan_only=plan_only, ref=ref)
    console.print(f"[bold green]Foundation stage status:[/bold green] {res.get('status')}")


@ops.command("secrets")
@click.option("--dry-run", is_flag=True, default=False, help="Validate secret plan locally without AWS SSM writes")
@click.option("--profile", default=None, help="Optional AWS CLI profile used to assume Foundation admin role")
@click.option("--kubeconfig-key-disposition", default="generate-fresh-no-historical-ciphertext", type=click.Choice(["generate-fresh-no-historical-ciphertext", "preserve-from-secrets-file"]))
def ops_secrets(dry_run, profile, kubeconfig_key_disposition):
    """Run Stage 3 SSM SecureString seeding using MFA-assumed admin session."""
    orch, cbs = _make_orchestrator(profile)
    res = orch.run_stage("secrets", callbacks=cbs, dry_run=dry_run, force_prompt=dry_run, kubeconfig_key_disposition=kubeconfig_key_disposition)
    console.print(f"[bold green]Secrets stage status:[/bold green] {res.get('status')} ({res.get('seeded_count', 0)}/9)")


@ops.command("release")
@click.option("--run-id", type=int, default=None, help="Specific cd.yml GitHub run ID")
@click.option("--sha", default=None, help="Specific commit SHA (or prefix)")
@click.option("--branch", default="develop", help="Branch to search successful cd.yml runs")
def ops_release(run_id, sha, branch):
    """Run Stage 4 release-manifest retrieval and validation from GitHub Actions."""
    orch, cbs = _make_orchestrator(None)
    res = orch.run_stage("release", callbacks=cbs, run_id=run_id, target_sha=sha, branch=branch)
    table = Table(title=f"Validated Release: {res['release_id']}", header_style="bold green")
    table.add_column("Service")
    table.add_column("Pinned @sha256 Reference")
    for svc, img in res["images"].items():
        table.add_row(svc, img["pinned_ref"])
    console.print(table)


@ops.command("deploy-flow")
@click.option("--stage", default=None, type=click.Choice(list(STAGE_IDS)), help="Run only one specific stage independently")
@click.option("--from-stage", default=None, type=click.Choice(list(STAGE_IDS)), help="Start sequential pipeline from a specific stage")
@click.option("--profile", default=None, help="Optional AWS CLI profile for runtime EC2/SSM operations")
@click.option("--fresh", is_flag=True, default=False, help="Reset stage history and execute from Stage 1")
def ops_deploy_flow(stage, from_stage, profile, fresh):
    """Single guided Provision & Deploy workflow with resumable stages."""
    orch, cbs = _make_orchestrator(profile)
    if fresh:
        orch.state_store.reset()
    if stage:
        res = orch.run_stage(stage, callbacks=cbs)
        console.print(f"[bold green]Stage '{stage}' -> {res.get('status')}[/bold green]")
        return

    out = orch.run_pipeline(start_stage=from_stage, resume=not fresh, callbacks=cbs)
    status = out.get("status")
    if status == "completed":
        app_url = out.get("state", {}).get("context", {}).get("app_url", "")
        console.print(Panel(f"All 7 stages completed!\nApplication URL: {app_url}", title="Deployment Ready", border_style="green"))
    else:
        console.print(f"[bold yellow]Pipeline paused at stage '{out.get('stopped_at')}' (status={status}). Re-run 'ops deploy-flow' to resume.[/bold yellow]")


@ops.command("demo-deploy")
@click.option("--sha", default=None, help="Specific commit SHA to deploy")
@click.option("--manifest", default=None, help="Path to local validated release-manifest.json")
@click.option("--branch", default="develop", help="Git branch for release manifest lookup")
@click.option("--profile", default=None, help="Optional AWS CLI profile")
def ops_demo_deploy(sha, manifest, branch, profile):
    """Single-command Demo Deploy: preflight -> release -> provision/start -> deploy -> verify."""
    orch, cbs = _make_orchestrator(profile)
    res = orch.deploy_environment(callbacks=cbs, target_sha=sha, manifest_path=manifest, branch=branch, raise_on_error=True)
    console.print(Panel(
        f"[bold]Application URL:[/bold] {res.get('app_url') or '-'}\n"
        f"[bold]Instance ID:[/bold] {res.get('instance_id') or '-'} (IP={res.get('public_ip') or '-'})\n"
        f"[bold]Release:[/bold] {res.get('release_id') or '-'}",
        title="Demo Environment Ready",
        border_style="green",
    ))


@ops.command("dashboard")
@click.option("--profile", default=None, help="Optional AWS CLI profile")
@click.option("--skip-http", is_flag=True, default=False, help="Skip external HTTPS probe")
def ops_dashboard(profile, skip_http):
    """Display live EC2, SSM, container, release history, HTTPS health, and S3 backup status."""
    aws_env = _cli_runtime_aws_env(profile, require_runtime_role=False)
    snap = fetch_ops_snapshot(aws_env=aws_env, include_http_health=not skip_http)
    ec2 = snap["ec2"]
    ssm = snap["ssm"]
    rel = snap["active_release"]
    health = snap["health"]
    console.print(Panel(
        f"[bold]EC2:[/bold] {ec2.get('instance_id') or 'none'} ({ec2.get('state')}) IP={ec2.get('public_ip') or '-'}\n"
        f"[bold]SSM:[/bold] {ssm.get('ping_status')} (agent={ssm.get('agent_version') or '-'})\n"
        f"[bold]Active Release:[/bold] {rel.get('release_id') or '-'} ({str(rel.get('commit_sha', ''))[:7]})\n"
        f"[bold]HTTPS Health:[/bold] {'HEALTHY' if health.get('ok') else 'UNVERIFIED/FAIL'} {health.get('target_url') or ''}",
        title="EnvScale Operations Dashboard",
        border_style="cyan",
    ))
    if snap["containers"]:
        ct = Table(title="Host Containers", header_style="bold magenta")
        ct.add_column("Name")
        ct.add_column("State")
        ct.add_column("Status")
        for c in snap["containers"]:
            ct.add_row(c["name"], c["state"], c["status"])
        console.print(ct)


@ops.command("logs")
@click.option("--service", default="all", type=click.Choice(list(ALLOWED_REMOTE_SERVICES)))
@click.option("--tail", default=80, type=int)
@click.option("--profile", default=None)
def ops_logs(service, tail, profile):
    """Fetch remote container logs from EC2 via AWS SSM."""
    aws_env = _cli_runtime_aws_env(profile, require_runtime_role=False)
    console.print(fetch_remote_logs(service=service, tail=tail, aws_env=aws_env))


@ops.command("backup")
@click.option("--profile", default=None)
def ops_backup(profile):
    """Trigger a remote PostgreSQL backup to S3 via AWS SSM."""
    aws_env = _cli_runtime_aws_env(profile, require_runtime_role=True)
    res = trigger_remote_backup(aws_env=aws_env, step_fn=_cli_step_fn)
    if res.get("key"):
        PipelineStateStore().update_context(last_backup_key=res["key"])
    console.print(f"[bold green]✔ Backup uploaded:[/bold green] {res['s3_uri']}")


@ops.command("verify")
@click.option("--profile", default=None)
def ops_verify(profile):
    """Run /opt/envscale/envscale.sh verify on EC2 via AWS SSM."""
    aws_env = _cli_runtime_aws_env(profile, require_runtime_role=True)
    out = trigger_remote_verify(aws_env=aws_env, step_fn=_cli_step_fn)
    if out:
        console.print(out)


@ops.command("destroy")
@click.option("--profile", default=None, help="Optional AWS CLI profile")
@click.option("--yes", "assume_yes", is_flag=True, default=False, help="Skip interactive confirmation prompt")
def ops_destroy(profile, assume_yes):
    """Verify PostgreSQL backup in S3, destroy runtime infrastructure, and reset pipeline state."""
    if not assume_yes and not Confirm.ask("[bold red]Verify DB backup and destroy all disposable runtime AWS resources?[/bold red]"):
        raise click.Abort()
    orch, cbs = _make_orchestrator(profile)
    res = orch.destroy_runtime(callbacks=cbs)
    bkp = res.get("backup", {})
    console.print(Panel(
        f"[bold]Verified S3 Backup:[/bold] s3://{bkp.get('bucket', '-')}/{bkp.get('key', '-')}\n"
        f"[bold]Size / SHA-256:[/bold] {bkp.get('content_length', 0)} bytes | {str(bkp.get('sha256', ''))[:16]}...\n"
        "[bold]Pipeline State:[/bold] Runtime stages reset to pending (ready for reconstruction)",
        title="Runtime Destroyed Safely",
        border_style="yellow",
    ))


@ops.command("restore")
@click.option("--key", default=None, help="Specific S3 key under backups/postgres/*.dump (defaults to latest)")
@click.option("--profile", default=None, help="Optional AWS CLI profile")
@click.option("--skip-verify", is_flag=True, default=False, help="Skip verify.sh after DB schema/table restore")
def ops_restore(key, profile, skip_verify):
    """Restore PostgreSQL backup from S3 onto the active runtime EC2 host and verify schema/data."""
    orch, cbs = _make_orchestrator(profile)
    res = orch.restore_database(callbacks=cbs, backup_key=key, skip_verify=skip_verify)
    tbl = Table(title="PostgreSQL Restore Summary", header_style="bold green")
    tbl.add_column("Check")
    tbl.add_column("Result")
    tbl.add_row("Backup S3 URI", res.get("s3_uri", "-"))
    tbl.add_row("SHA-256", str(res.get("sha256", "-"))[:24])
    tbl.add_row("Canonical Tables", f"{res.get('canonical_tables', 0)}/12")
    tbl.add_row("Applied Migrations", str(res.get("migrations", 0)))
    tbl.add_row("Row Counts", str(res.get("row_counts") or {}))
    tbl.add_row("Post-Restore Verify", "PASSED" if res.get("verify_passed") else "SKIPPED/UNVERIFIED")
    console.print(tbl)


@ops.command("reconstruct")
@click.option("--key", default=None, help="Specific S3 backup key to restore (defaults to saved/latest backup)")
@click.option("--sha", default=None, help="Specific release commit SHA to deploy")
@click.option("--manifest", default=None, help="Path to local validated release-manifest.json")
@click.option("--profile", default=None, help="Optional AWS CLI profile")
@click.option("--skip-restore", is_flag=True, default=False, help="Provision & deploy without running DB restore")
def ops_reconstruct(key, sha, manifest, profile, skip_restore):
    """Reconstruct runtime EC2 host, deploy pinned release, restore PostgreSQL data, and verify health."""
    orch, cbs = _make_orchestrator(profile)
    res = orch.reconstruct_runtime(callbacks=cbs, backup_key=key, target_sha=sha, manifest_path=manifest, skip_restore=skip_restore)
    rest = res.get("restore") or {}
    console.print(Panel(
        f"[bold]Application URL:[/bold] {res.get('app_url') or '-'}\n"
        f"[bold]Restored Backup:[/bold] {rest.get('s3_uri') or rest.get('status', '-')}\n"
        f"[bold]Restored Tables / Rows:[/bold] {rest.get('canonical_tables', '-')}/12 | {rest.get('row_counts') or '-'}",
        title="Reconstruction & Verification Complete",
        border_style="green",
    ))

