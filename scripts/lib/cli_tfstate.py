"""CLI subcommands (`ops tfstate ...`) for Terraform state inspection, sync, unlock, and reconciliation."""

from __future__ import annotations

import os
from typing import Optional

import click
from rich.console import Console
from rich.panel import Panel
from rich.prompt import Confirm
from rich.table import Table

from .cloud_identity import DEFAULT_ACCOUNT_ID, DEFAULT_REGION, inspect_aws_identity
from .config import TERRAFORM_DIR, TERRAFORM_EKS_DIR
from .tfstate_journal import CorruptedStateJournalError, TfStateJournal, resolve_journal_path
from .tfstate_reconciler import (
    LINEAGE_MISMATCH,
    SAME_SERIAL_DIFFERENT_CONTENT,
    force_release_stale_lock,
    inspect_state_status,
    reconcile_terraform_state,
)
from .tfstate_sync import tfstate_bucket_and_key

console = Console()


def _runtime_env_for_tfstate(profile: Optional[str], *, require_runtime_role: bool):
    from .cli_cloud_ops import _cli_runtime_aws_env

    aws_env = _cli_runtime_aws_env(profile, require_runtime_role=require_runtime_role)
    info = inspect_aws_identity(aws_env=aws_env, profile=profile)
    acct = info.get("account_id") or DEFAULT_ACCOUNT_ID
    reg = info.get("region") or DEFAULT_REGION
    return aws_env, acct, reg


def _resolve_target(target: str) -> tuple[str, str]:
    if target == "eks":
        return os.path.join(TERRAFORM_EKS_DIR, "terraform.tfstate"), "eks/terraform.tfstate"
    return os.path.join(TERRAFORM_DIR, "terraform.tfstate"), "runtime/terraform.tfstate"


def print_local_tfstate_banner(out_console: Console) -> None:
    """Offline state/journal warning printer used by `ops status` (fails closed on corruption)."""
    st_p = os.path.join(TERRAFORM_DIR, "terraform.tfstate")
    try:
        p_info = TfStateJournal(resolve_journal_path(st_p)).inspect_local_pending_sync(st_p)
    except CorruptedStateJournalError as exc:
        out_console.print(f"[bold red]✘ State Journal Corrupted:[/bold red] {exc}")
        return
    if p_info.get("pending"):
        out_console.print(f"[bold yellow]! State Sync Status:[/bold yellow] STATE_SYNC_PENDING ({p_info['reason']})")


@click.group("tfstate")
def tfstate():
    """Inspect, resume pending S3 sync, unlock stale locks, and safely reconcile Terraform state."""


@tfstate.command("status")
@click.option("--target", type=click.Choice(["runtime", "eks"]), default="runtime", help="Target state namespace")
@click.option("--profile", default=None, help="Optional AWS CLI profile")
def tfstate_status(target, profile):
    """Compare local Terraform state, S3 backend state, remote lock, and operation journal."""
    aws_env, acct, reg = _runtime_env_for_tfstate(profile, require_runtime_role=False)
    local_p, state_key = _resolve_target(target)
    info = inspect_state_status(
        local_path=local_p, account_id=acct, region=reg, state_key=state_key,
        aws_env=aws_env, include_lock_status=True,
    )
    loc = info.get("local") or {}
    rem = info.get("remote") or {}
    rmeta = info.get("remote_meta") or {}
    op = info.get("journal_op") or {}
    rlock = info.get("remote_lock") or {}
    lock_desc = "Unlocked"
    if rlock.get("locked"):
        h = rlock.get("holder") or {}
        lock_desc = (
            f"LOCKED lock_id={h.get('lock_id', '?')} op={h.get('operation_id', '?')} "
            f"pid={h.get('pid', '?')}@{h.get('hostname', '?')} since={h.get('created_at_utc', '?')}"
        )

    tbl = Table(title=f"Terraform State Consistency ({target}): {info['classification']}", header_style="bold cyan")
    tbl.add_column("Source")
    tbl.add_column("Lineage")
    tbl.add_column("Serial")
    tbl.add_column("Resources")
    tbl.add_column("SHA-256")
    tbl.add_column("VersionId / Op")
    tbl.add_row(
        "Local",
        str(loc.get("lineage") or "-")[:18],
        str(loc.get("serial") if loc else "-"),
        str(loc.get("resource_count") if loc else "-"),
        str(loc.get("sha256") or "-")[:16],
        str(op.get("operation_id") or "-"),
    )
    tbl.add_row(
        f"S3 ({info['backend']['uri']})",
        str(rem.get("lineage") or "-")[:18],
        str(rem.get("serial") if rem else "-"),
        str(rem.get("resource_count") if rem else "-"),
        str(rem.get("sha256") or "-")[:16],
        str(rmeta.get("version_id") or "-"),
    )
    console.print(tbl)
    console.print(Panel(
        f"[bold]Message:[/bold] {info['message']}\n"
        f"[bold]Journal Proof:[/bold] {'yes' if info['proven_local_mutation'] else 'no'}\n"
        f"[bold]Remote Lock:[/bold] {lock_desc}\n"
        f"[bold]Recommended Action:[/bold] {info['recommended_action']}",
        title="Reconciliation Summary",
        border_style="yellow" if info["classification"] != "STATE_SYNCHRONIZED" or rlock.get("locked") else "green",
    ))


@tfstate.command("sync")
@click.option("--target", type=click.Choice(["runtime", "eks"]), default="runtime", help="Target state namespace")
@click.option("--profile", default=None, help="Optional AWS CLI profile")
def tfstate_sync(target, profile):
    """Resume any verified pending local->S3 state synchronization."""
    aws_env, acct, reg = _runtime_env_for_tfstate(profile, require_runtime_role=True)
    local_p, state_key = _resolve_target(target)
    res = reconcile_terraform_state(
        local_path=local_p, account_id=acct, region=reg, state_key=state_key,
        operation_type="sync", auto_resume_pending=True, allow_adopt_remote=False,
        allow_promote_local=False, aws_env=aws_env, use_remote_lock=True,
    )
    console.print(f"[bold green]✔ State sync status:[/bold green] {res['status']} ({res['classification']})")


@tfstate.command("reconcile")
@click.option("--target", type=click.Choice(["runtime", "eks"]), default="runtime", help="Target state namespace")
@click.option("--adopt-remote", is_flag=True, default=False, help="Adopt authoritative S3 state when REMOTE_AHEAD or LOCAL_MISSING")
@click.option("--promote-local", is_flag=True, default=False, help="Promote authoritative local state to S3 when LOCAL_AHEAD or REMOTE_MISSING")
@click.option("--yes", "assume_yes", is_flag=True, default=False, help="Skip confirmation prompt")
@click.option("--profile", default=None, help="Optional AWS CLI profile")
def tfstate_reconcile(target, adopt_remote, promote_local, assume_yes, profile):
    """Reconcile divergent local and S3 Terraform state safely using Runtime MFA."""
    aws_env, acct, reg = _runtime_env_for_tfstate(profile, require_runtime_role=True)
    local_p, state_key = _resolve_target(target)
    status = inspect_state_status(local_path=local_p, account_id=acct, region=reg, state_key=state_key, aws_env=aws_env)
    cls = status["classification"]
    if cls in (SAME_SERIAL_DIFFERENT_CONTENT, LINEAGE_MISMATCH):
        raise click.ClickException(status["message"])
    if (adopt_remote or promote_local) and not assume_yes:
        if not Confirm.ask(f"Classification is {cls}. Proceed with reconciliation ({status['message']})?"):
            raise click.Abort()
    res = reconcile_terraform_state(
        local_path=local_p, account_id=acct, region=reg, state_key=state_key,
        operation_type="reconcile", auto_resume_pending=True, allow_adopt_remote=adopt_remote,
        allow_promote_local=promote_local, aws_env=aws_env, use_remote_lock=True,
    )
    console.print(f"[bold green]✔ Reconciliation completed:[/bold green] {res['status']} ({res['classification']})")


@tfstate.command("unlock")
@click.option("--lock-id", required=True, help="Exact lock_id shown by `ops tfstate status`")
@click.option("--reason", required=True, help="Recorded operator reason for releasing stale lock")
@click.option("--target", type=click.Choice(["runtime", "eks"]), default="runtime", help="Target state namespace")
@click.option("--yes", "assume_yes", is_flag=True, default=False, help="Skip confirmation prompt")
@click.option("--profile", default=None, help="Optional AWS CLI profile")
def tfstate_unlock(lock_id, reason, target, assume_yes, profile):
    """Explicitly release a stale remote S3 .tflock after verifying its lock_id."""
    aws_env, acct, reg = _runtime_env_for_tfstate(profile, require_runtime_role=True)
    _, state_key = _resolve_target(target)
    bucket, key = tfstate_bucket_and_key(acct, reg, state_key=state_key)
    if not assume_yes and not Confirm.ask(f"Release remote lock s3://{bucket}/{key}.tflock (lock_id={lock_id})?"):
        raise click.Abort()
    res = force_release_stale_lock(
        bucket=bucket, state_key=key, region=reg, expected_lock_id=lock_id, reason=reason, aws_env=aws_env
    )
    console.print(f"[bold green]✔ Remote lock status:[/bold green] {res['status']} ({res['lock_key']})")
