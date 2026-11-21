#!/usr/bin/env python3
"""
EnvScale Foundation OIDC Workflow Integrity & Branch Authorization Guard.

Subcommands:
  - check-branch        Enforce authorized git branches (`refs/heads/develop`, `refs/heads/main`)
  - write-attestation   Emit SHA256SUMS & signed-context attestation for saved Terraform plan
  - verify-attestation  Verify saved plan binary, reviewed JSON, SHA-256 sums, & run bindings
"""

from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import sys
import time

AUTHORIZED_REFS = frozenset({"refs/heads/develop", "refs/heads/main"})
DEFAULT_REPOSITORY = "P20000/EnvScale"
IMMUTABLE_FOUNDATION_STATE_KEY = "foundation/terraform.tfstate"
DEFAULT_MAX_PLAN_AGE_SECONDS = 3600


def fail(msg: str) -> None:
    raise SystemExit(f"[FATAL] {msg}")


def sha256_file(path: pathlib.Path) -> str:
    if not path.is_file() or path.is_symlink():
        fail(f"Artifact file missing or symlinked: {path}")
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def check_authorized_branch(git_ref: str) -> str:
    if git_ref not in AUTHORIZED_REFS:
        fail(
            f"Unauthorized workflow ref '{git_ref}'. Foundation workflow may run only on "
            f"{sorted(AUTHORIZED_REFS)}."
        )
    return git_ref


def check_concurrency_serialization(workflow_path: pathlib.Path) -> str:
    """Verify Foundation workflow serializes across branches sharing the same Terraform state."""
    if not workflow_path.is_file():
        fail(f"Workflow file not found: {workflow_path}")
    lines = workflow_path.read_text(encoding="utf-8").splitlines()
    group_val = ""
    cancel_val = ""
    in_concurrency = False
    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if not line.startswith(" "):
            in_concurrency = stripped == "concurrency:"
            continue
        if in_concurrency:
            if stripped.startswith("group:"):
                group_val = stripped.split(":", 1)[1].strip()
            elif stripped.startswith("cancel-in-progress:"):
                cancel_val = stripped.split(":", 1)[1].strip().lower()
    if not group_val or cancel_val != "false":
        fail(f"Foundation workflow concurrency must set cancel-in-progress: false and a non-empty group (got group={group_val!r}, cancel={cancel_val!r}).")
    for branch_expr in ("github.ref", "github.head_ref", "github.base_ref"):
        if branch_expr in group_val:
            fail(f"Foundation workflow concurrency.group must not vary by branch ({branch_expr}); group={group_val!r}.")
    if "tfstate_bucket" not in group_val or IMMUTABLE_FOUNDATION_STATE_KEY not in group_val:
        fail(
            f"Foundation workflow concurrency.group must key on tfstate_bucket and fixed "
            f"'{IMMUTABLE_FOUNDATION_STATE_KEY}'; group={group_val!r}."
        )
    raw_wf = "\n".join(lines)
    if "inputs.state_key" in raw_wf:
        fail("Foundation workflow must not expose a configurable inputs.state_key; state key must be fixed to 'foundation/terraform.tfstate'.")
    if "--allow-protected-iam-updates" in raw_wf:
        fail("Foundation workflow must never invoke --allow-protected-iam-updates in automated CI.")
    return group_val


def write_attestation(
    *,
    bin_path: pathlib.Path,
    json_path: pathlib.Path,
    out_path: pathlib.Path,
    sums_path: pathlib.Path,
    commit_sha: str,
    git_ref: str,
    run_id: str,
    run_attempt: str,
    tfstate_bucket: str,
    state_key: str,
    plan_mode: str,
    has_changes: str,
    repository: str = DEFAULT_REPOSITORY,
    state_fingerprint: str = "ABSENT",
    max_age_seconds: int = DEFAULT_MAX_PLAN_AGE_SECONDS,
    now_epoch: int | None = None,
) -> dict:
    check_authorized_branch(git_ref)
    if state_key != IMMUTABLE_FOUNDATION_STATE_KEY:
        fail(
            f"Invalid Foundation state_key {state_key!r}; must equal fixed "
            f"{IMMUTABLE_FOUNDATION_STATE_KEY!r}."
        )
    if not repository or "/" not in repository or "*" in repository:
        fail(f"Invalid repository identifier for plan attestation: {repository!r}")
    if max_age_seconds <= 0 or max_age_seconds > 86400:
        fail(f"Invalid attestation max_age_seconds={max_age_seconds} (must be in 1..86400).")
    now_ts = int(time.time()) if now_epoch is None else int(now_epoch)
    bin_sha = sha256_file(bin_path)
    json_sha = sha256_file(json_path)
    plan_doc = json.loads(json_path.read_text(encoding="utf-8"))
    prior = plan_doc.get("prior_state") if isinstance(plan_doc, dict) else None
    att = {
        "schema_version": "1.1",
        "repository": repository,
        "commit_sha": commit_sha,
        "git_ref": git_ref,
        "workflow_run_id": str(run_id),
        "workflow_run_attempt": str(run_attempt),
        "tfstate_bucket": tfstate_bucket,
        "state_key": state_key,
        "state_fingerprint": state_fingerprint,
        "prior_state_present": isinstance(prior, dict),
        "created_at_epoch": now_ts,
        "expires_at_epoch": now_ts + int(max_age_seconds),
        "plan_mode": plan_mode,
        "has_changes": has_changes == "true",
        "artifacts": {
            bin_path.name: bin_sha,
            json_path.name: json_sha,
        },
    }
    sums_text = f"{bin_sha}  {bin_path.name}\n{json_sha}  {json_path.name}\n"
    sums_path.write_text(sums_text, encoding="utf-8")
    out_path.write_text(json.dumps(att, indent=2) + "\n", encoding="utf-8")
    return att


def verify_attestation(
    *,
    bin_path: pathlib.Path,
    json_path: pathlib.Path,
    recheck_json_path: pathlib.Path,
    att_path: pathlib.Path,
    sums_path: pathlib.Path,
    expected_sha: str,
    expected_ref: str,
    expected_run_id: str,
    expected_run_attempt: str,
    expected_bucket: str,
    expected_key: str,
    expected_repository: str = DEFAULT_REPOSITORY,
    current_state_fingerprint: str | None = None,
    now_epoch: int | None = None,
) -> dict:
    check_authorized_branch(expected_ref)
    if expected_key != IMMUTABLE_FOUNDATION_STATE_KEY:
        fail(
            f"Invalid expected Foundation state_key {expected_key!r}; must equal fixed "
            f"{IMMUTABLE_FOUNDATION_STATE_KEY!r}."
        )
    if not att_path.is_file() or not sums_path.is_file():
        fail("Missing plan attestation or SHA256SUMS file.")
    att = json.loads(att_path.read_text(encoding="utf-8"))
    for field, exp in (
        ("repository", expected_repository),
        ("commit_sha", expected_sha),
        ("git_ref", expected_ref),
        ("workflow_run_id", str(expected_run_id)),
        ("workflow_run_attempt", str(expected_run_attempt)),
        ("tfstate_bucket", expected_bucket),
        ("state_key", expected_key),
    ):
        if att.get(field) != exp:
            fail(f"Plan attestation mismatch for '{field}': got {att.get(field)!r}, expected {exp!r}.")

    now_ts = int(time.time()) if now_epoch is None else int(now_epoch)
    created_at = att.get("created_at_epoch")
    expires_at = att.get("expires_at_epoch")
    if not isinstance(created_at, int) or not isinstance(expires_at, int) or expires_at < created_at:
        fail("Plan attestation missing or invalid created_at_epoch / expires_at_epoch timestamps.")
    if now_ts > expires_at or now_ts + 60 < created_at:
        fail(f"Plan attestation expired or timestamp invalid (now={now_ts}, created={created_at}, expires={expires_at}).")

    if current_state_fingerprint is not None and att.get("state_fingerprint") != current_state_fingerprint:
        fail(
            f"Stale Terraform plan detected: live S3 state fingerprint '{current_state_fingerprint}' "
            f"diverged from plan-time fingerprint '{att.get('state_fingerprint')}'."
        )

    actual_bin_sha = sha256_file(bin_path)
    actual_json_sha = sha256_file(json_path)
    att_files = att.get("artifacts") or {}
    if att_files.get(bin_path.name) != actual_bin_sha:
        fail(f"SHA-256 mismatch for '{bin_path.name}': artifact integrity check failed.")
    if att_files.get(json_path.name) != actual_json_sha:
        fail(f"SHA-256 mismatch for '{json_path.name}': reviewed JSON integrity check failed.")

    expected_sums = f"{actual_bin_sha}  {bin_path.name}\n{actual_json_sha}  {json_path.name}\n"
    if sums_path.read_text(encoding="utf-8") != expected_sums:
        fail("SHA256SUMS content mismatch against attested plan artifacts.")

    reviewed_doc = json.loads(json_path.read_text(encoding="utf-8"))
    recheck_doc = json.loads(recheck_json_path.read_text(encoding="utf-8"))
    if reviewed_doc != recheck_doc:
        fail("Saved binary plan does not match the reviewed JSON representation.")
    return att


def main() -> None:
    p = argparse.ArgumentParser(description="Foundation OIDC workflow guard")
    sub = p.add_subparsers(dest="cmd", required=True)

    pb = sub.add_parser("check-branch")
    pb.add_argument("--ref", required=True)

    pc = sub.add_parser("check-concurrency")
    pc.add_argument("--workflow", required=True)

    for name in ("write-attestation", "verify-attestation"):
        sp = sub.add_parser(name)
        sp.add_argument("--bin", required=True)
        sp.add_argument("--json", required=True)
        sp.add_argument("--sums", required=True)
        sp.add_argument("--attestation", required=True)
        sp.add_argument("--commit-sha", required=True)
        sp.add_argument("--ref", required=True)
        sp.add_argument("--run-id", required=True)
        sp.add_argument("--run-attempt", required=True)
        sp.add_argument("--tfstate-bucket", required=True)
        sp.add_argument("--state-key", required=True)
        sp.add_argument("--repository", default=DEFAULT_REPOSITORY)
        if name == "write-attestation":
            sp.add_argument("--plan-mode", required=True)
            sp.add_argument("--has-changes", required=True)
            sp.add_argument("--state-fingerprint", default="ABSENT")
            sp.add_argument("--max-age-seconds", type=int, default=DEFAULT_MAX_PLAN_AGE_SECONDS)
        else:
            sp.add_argument("--recheck-json", required=True)
            sp.add_argument("--current-state-fingerprint", default=None)

    args = p.parse_args()
    if args.cmd == "check-branch":
        print(f"[PASS] Authorized workflow ref: {check_authorized_branch(args.ref)}")
    elif args.cmd == "check-concurrency":
        grp = check_concurrency_serialization(pathlib.Path(args.workflow))
        print(f"[PASS] Serialized workflow concurrency group: {grp}")
    elif args.cmd == "write-attestation":
        write_attestation(
            bin_path=pathlib.Path(args.bin), json_path=pathlib.Path(args.json),
            out_path=pathlib.Path(args.attestation), sums_path=pathlib.Path(args.sums),
            commit_sha=args.commit_sha, git_ref=args.ref, run_id=args.run_id,
            run_attempt=args.run_attempt, tfstate_bucket=args.tfstate_bucket,
            state_key=args.state_key, plan_mode=args.plan_mode, has_changes=args.has_changes,
            repository=args.repository, state_fingerprint=args.state_fingerprint,
            max_age_seconds=args.max_age_seconds,
        )
    elif args.cmd == "verify-attestation":
        verify_attestation(
            bin_path=pathlib.Path(args.bin), json_path=pathlib.Path(args.json),
            recheck_json_path=pathlib.Path(args.recheck_json),
            att_path=pathlib.Path(args.attestation), sums_path=pathlib.Path(args.sums),
            expected_sha=args.commit_sha, expected_ref=args.ref, expected_run_id=args.run_id,
            expected_run_attempt=args.run_attempt, expected_bucket=args.tfstate_bucket,
            expected_key=args.state_key, expected_repository=args.repository,
            current_state_fingerprint=args.current_state_fingerprint,
        )
        print("[PASS] Verified saved Terraform plan artifact integrity and attestation bindings.")


if __name__ == "__main__":
    main()

