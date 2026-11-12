#!/usr/bin/env python3
"""
EnvScale Phase 3 — Strict Remote Terraform Plan Allowlist Validator.

Supports both clean Day-1 initial foundation plans (`mode=initial`) and
subsequent idempotent Day-1+ updates (`mode=update`, or `auto`-detected from
`prior_state`). Enforces complete plan metadata, TOCTOU-free 0600 descriptor
reading (O_NOFOLLOW, fstat, fchmod), strict allowlisted resource types/addresses,
and zero deletions or replacements.
"""

from __future__ import annotations

import argparse
import errno
import json
import os
import pathlib
import stat
import sys
import tempfile
from typing import Any, Callable

_SCRIPT_DIR = str(pathlib.Path(__file__).resolve().parent)
if _SCRIPT_DIR not in sys.path:
    sys.path.insert(0, _SCRIPT_DIR)

from plan_iam_safety import PROTECTED_FOUNDATION_IAM_ADDRESSES, check_iam_resource_change_safety, check_protected_iam_immutability  # noqa: E402

SUPPORTED_TERRAFORM_VERSION = "1.14.9"
SUPPORTED_FORMAT_VERSIONS = {"1.2"}

# Core Approved Managed Resources (33 resources when create_foundation_admin_role = true)
APPROVED_MANAGED_RESOURCES: dict[str, str] = {
    "aws_iam_policy.workload_permissions_boundary": "aws_iam_policy",
    "aws_iam_role.ec2_runtime": "aws_iam_role", "aws_iam_instance_profile.ec2_runtime": "aws_iam_instance_profile",
    "aws_iam_role_policy.ec2_runtime": "aws_iam_role_policy", "aws_iam_role_policy_attachment.ec2_runtime_ssm_core": "aws_iam_role_policy_attachment",
    "aws_iam_role.github_release": "aws_iam_role", "aws_iam_role_policy.github_release": "aws_iam_role_policy",
    "aws_iam_role.github_deploy": "aws_iam_role", "aws_iam_role_policy.github_deploy": "aws_iam_role_policy",
    "aws_iam_role.github_recovery": "aws_iam_role", "aws_iam_role_policy.github_recovery": "aws_iam_role_policy",
    "aws_iam_role.github_foundation": "aws_iam_role", "aws_iam_role_policy.github_foundation": "aws_iam_role_policy",
    "aws_iam_role.github_foundation_plan": "aws_iam_role", "aws_iam_role_policy.github_foundation_plan": "aws_iam_role_policy",
    "aws_iam_role.foundation_admin[0]": "aws_iam_role", "aws_iam_role_policy.foundation_admin[0]": "aws_iam_role_policy",
    "aws_s3_bucket.recovery": "aws_s3_bucket", "aws_s3_bucket_ownership_controls.recovery": "aws_s3_bucket_ownership_controls",
    "aws_s3_bucket_public_access_block.recovery": "aws_s3_bucket_public_access_block", "aws_s3_bucket_versioning.recovery": "aws_s3_bucket_versioning",
    "aws_s3_bucket_server_side_encryption_configuration.recovery": "aws_s3_bucket_server_side_encryption_configuration",
    "aws_s3_bucket_lifecycle_configuration.recovery": "aws_s3_bucket_lifecycle_configuration", "aws_s3_bucket_policy.recovery": "aws_s3_bucket_policy",
    **{f'aws_ssm_parameter.non_secret["{k}"]': "aws_ssm_parameter" for k in (
        "aws_region", "better_auth_url", "cors_origin", "duckdns_domain",
        "github_client_id", "google_client_id", "postgres_db", "postgres_user", "recovery_bucket",
    )},
}
OPTIONAL_MANAGED_RESOURCES: dict[str, str] = {"aws_iam_openid_connect_provider.github[0]": "aws_iam_openid_connect_provider", "aws_eip.static_runtime[0]": "aws_eip"}
ALL_APPROVED_MANAGED = {**APPROVED_MANAGED_RESOURCES, **OPTIONAL_MANAGED_RESOURCES}
APPROVED_DATA_SOURCES: dict[str, str] = {"data.aws_iam_policy_document.recovery_bucket_policy": "aws_iam_policy_document"}
APPROVED_PRIOR_DATA_SOURCES: dict[str, str] = {"data.aws_iam_openid_connect_provider.github[0]": "aws_iam_openid_connect_provider"}


def _collect_prior_resources(mod: dict[str, Any]) -> list[dict[str, Any]]:
    out = list(mod.get("resources") or [])
    for child in mod.get("child_modules") or []:
        if isinstance(child, dict):
            out.extend(_collect_prior_resources(child))
    return out


def validate_plan_doc(
    plan_doc: dict[str, Any], mode: str = "auto", allow_protected_iam_updates: bool = False
) -> list[str]:
    """Validate a terraform show -json plan document for initial or update foundation applies."""
    errors: list[str] = []
    if not isinstance(plan_doc, dict):
        return ["Plan document root is not a JSON object"]
    if mode not in ("auto", "bootstrap", "initial", "update"):
        return [f"Unsupported validator mode '{mode}'"]

    if plan_doc.get("terraform_version") != SUPPORTED_TERRAFORM_VERSION:
        errors.append(f"Unsupported terraform_version '{plan_doc.get('terraform_version')}' (strictly requires '{SUPPORTED_TERRAFORM_VERSION}')")
    if plan_doc.get("format_version") not in SUPPORTED_FORMAT_VERSIONS:
        errors.append(f"Unsupported format_version '{plan_doc.get('format_version')}' (strictly requires one of {sorted(SUPPORTED_FORMAT_VERSIONS)})")
    if plan_doc.get("errored") is not False:
        errors.append(f"Plan document errored is {plan_doc.get('errored')!r} (strictly requires False)")
    if plan_doc.get("applyable") is not True:
        errors.append(f"Plan document applyable is {plan_doc.get('applyable')!r} (strictly requires True)")
    rcs = plan_doc.get("resource_changes")
    if not isinstance(rcs, list):
        errors.append("Missing or invalid 'resource_changes' list in plan document")
        return errors

    prior_root = ((plan_doc.get("prior_state") or {}).get("values") or {}).get("root_module")
    prior_res = _collect_prior_resources(prior_root) if isinstance(prior_root, dict) else []
    prior_managed_addrs = {pr.get("address") for pr in prior_res if pr.get("mode") == "managed"}
    rc_managed_addrs = {rc.get("address") for rc in rcs if isinstance(rc, dict) and rc.get("mode") == "managed"}
    if mode == "auto":
        effective_mode = "bootstrap" if (rc_managed_addrs and rc_managed_addrs == set(PROTECTED_FOUNDATION_IAM_ADDRESSES)) else ("initial" if prior_managed_addrs <= set(PROTECTED_FOUNDATION_IAM_ADDRESSES) else "update")
    else:
        effective_mode = mode

    if effective_mode != "bootstrap" and plan_doc.get("complete") is not True:
        errors.append(f"Plan document complete is {plan_doc.get('complete')!r} (strictly requires True; incomplete plans forbidden)")
    elif effective_mode == "bootstrap" and plan_doc.get("complete") not in (True, False):
        errors.append(f"Plan document complete is {plan_doc.get('complete')!r} (strictly requires boolean True or False)")

    for field in ("deferred_changes", "deferred_action_invocations", "action_invocations", "resource_drift"):
        if field in plan_doc:
            val = plan_doc.get(field)
            if not isinstance(val, list):
                errors.append(f"Plan field '{field}' has invalid type '{type(val).__name__}' (strictly requires empty list; found {val!r})")
            elif len(val) > 0:
                errors.append(f"Plan contains unexpected {field} ({len(val)} item(s)); secondary channels forbidden")

    allowed_managed_actions = (["create"], ["no-op"], ["update"]) if effective_mode in ("bootstrap", "update") else (["create"], ["no-op"])

    seen_managed: dict[str, dict[str, Any]] = {}
    seen_data: dict[str, dict[str, Any]] = {}
    seen_all_addresses: set[str] = set()

    for rc in rcs:
        if not isinstance(rc, dict):
            errors.append(f"Encountered non-dict entry in resource_changes: {rc}")
            continue
        addr, rmode, rtype = rc.get("address"), rc.get("mode"), rc.get("type")
        actions = (rc.get("change") or {}).get("actions") or []
        if not addr:
            errors.append(f"Resource change missing address: {rc}")
            continue
        if addr in seen_all_addresses:
            errors.append(f"Duplicate resource change entry for address '{addr}'")
            continue
        seen_all_addresses.add(addr)

        if rmode == "managed":
            seen_managed[addr] = rc
            if addr not in ALL_APPROVED_MANAGED:
                errors.append(f"Unapproved managed resource address '{addr}' (type='{rtype}') detected in plan. Not present in allowlist!")
                continue
            if rtype != ALL_APPROVED_MANAGED[addr]:
                errors.append(f"Managed resource '{addr}' has unexpected type '{rtype}' (expected '{ALL_APPROVED_MANAGED[addr]}')")
            if actions not in allowed_managed_actions:
                errors.append(f"Managed resource '{addr}' has unapproved change actions {actions} (allowed in {effective_mode}: {list(allowed_managed_actions)})")
            if effective_mode == "bootstrap" and addr not in PROTECTED_FOUNDATION_IAM_ADDRESSES:
                errors.append(f"Non-bootstrap resource '{addr}' is forbidden in one-time '--mode bootstrap' plan.")
            if effective_mode == "initial" and addr not in PROTECTED_FOUNDATION_IAM_ADDRESSES and actions != ["create"]:
                errors.append(f"Managed resource '{addr}' has unapproved change actions {actions} (allowed in initial: [['create']])")
            errors.extend(check_protected_iam_immutability(addr, actions, effective_mode, allow_protected_iam_updates))
            errors.extend(check_iam_resource_change_safety(rc))
        elif rmode == "data":
            seen_data[addr] = rc
            allowed_data = {**APPROVED_DATA_SOURCES, **APPROVED_PRIOR_DATA_SOURCES}
            if addr not in allowed_data:
                errors.append(f"Unapproved data source read '{addr}' (type='{rtype}') detected in plan. Not present in allowlist!")
                continue
            if rtype != allowed_data[addr]:
                errors.append(f"Data source '{addr}' has unexpected type '{rtype}' (expected '{allowed_data[addr]}')")
            if actions != ["read"] and not (effective_mode in ("bootstrap", "update") and actions == ["no-op"]):
                errors.append(f"Data source '{addr}' has unapproved actions {actions} (strictly requires ['read'])")
        else:
            errors.append(f"Resource change '{addr}' has unrecognized mode '{rmode}' (strictly requires 'managed' or 'data')")

    expected_managed = PROTECTED_FOUNDATION_IAM_ADDRESSES if effective_mode == "bootstrap" else set(APPROVED_MANAGED_RESOURCES)
    for m in sorted(expected_managed - set(seen_managed)):
        errors.append(f"Missing expected managed foundation resource in plan: '{m}'")
    if effective_mode != "bootstrap":
        for md in sorted(set(APPROVED_DATA_SOURCES) - set(seen_data)):
            errors.append(f"Missing expected approved data source in plan: '{md}'")

    seen_prior_data: set[str] = set()
    seen_prior_managed: set[str] = set()
    for pr in prior_res:
        paddr, pmode, ptype = pr.get("address"), pr.get("mode"), pr.get("type")
        if pmode == "managed":
            if effective_mode == "initial" and paddr not in PROTECTED_FOUNDATION_IAM_ADDRESSES:
                errors.append(f"Unexpected non-data resource '{paddr}' (mode='managed') in prior_state; clean bootstrap requires empty managed state")
            elif not paddr or paddr in seen_prior_managed:
                errors.append(f"Invalid or duplicate prior_state managed resource '{paddr}'")
            elif paddr not in ALL_APPROVED_MANAGED:
                errors.append(f"Unapproved managed resource '{paddr}' (type='{ptype}') in prior_state")
            elif ptype != ALL_APPROVED_MANAGED[paddr]:
                errors.append(f"Prior managed resource '{paddr}' has unexpected type '{ptype}' (expected '{ALL_APPROVED_MANAGED[paddr]}')")
            else:
                seen_prior_managed.add(paddr)
        elif pmode == "data":
            if not paddr or paddr in seen_prior_data:
                errors.append(f"Invalid or duplicate prior_state data source '{paddr}'")
            elif paddr not in {**APPROVED_PRIOR_DATA_SOURCES, **APPROVED_DATA_SOURCES}:
                errors.append(f"Unapproved data source '{paddr}' (type='{ptype}') in prior_state")
            elif ptype != {**APPROVED_PRIOR_DATA_SOURCES, **APPROVED_DATA_SOURCES}[paddr]:
                errors.append(f"Prior data source '{paddr}' has unexpected type '{ptype}' (expected '{ {**APPROVED_PRIOR_DATA_SOURCES, **APPROVED_DATA_SOURCES}[paddr] }')")
            else:
                seen_prior_data.add(paddr)
        else:
            errors.append(f"Unexpected prior_state resource '{paddr}' with mode='{pmode}'")

    if effective_mode in ("initial", "update"):
        for req_boot in sorted(PROTECTED_FOUNDATION_IAM_ADDRESSES - seen_prior_managed):
            errors.append(
                f"Missing bootstrap-owned IAM resource '{req_boot}' in prior_state; "
                "run one-time bootstrap (bootstrap-state.sh --bootstrap-foundation-iam) before OIDC apply."
            )
    if "aws_iam_openid_connect_provider.github[0]" not in seen_managed:
        for mp in sorted(set(APPROVED_PRIOR_DATA_SOURCES) - seen_prior_data):
            errors.append(f"Missing expected approved data source in prior_state: '{mp}'")
    return errors


def verify_security_primitives() -> None:
    """Verify required atomic security primitives (O_NOFOLLOW, fchmod) are available; fail closed if absent."""
    if not hasattr(os, "O_NOFOLLOW"):
        raise SystemExit("[FATAL] Security primitive 'os.O_NOFOLLOW' is unavailable on this platform; failing closed.")
    if not hasattr(os, "fchmod"):
        raise SystemExit("[FATAL] Security primitive 'os.fchmod' is unavailable on this platform; failing closed.")


def open_secure_plan_fd(plan_path: pathlib.Path) -> int:
    """Atomically open plan file via O_NOFOLLOW, verify S_ISREG, and enforce mode 0600 via fchmod."""
    verify_security_primitives()
    try:
        fd = os.open(str(plan_path), os.O_RDONLY | os.O_NOFOLLOW)
    except OSError as exc:
        raise SystemExit(f"[FATAL] Failed opening plan file '{plan_path}' (symlinks forbidden): {exc}")
    try:
        st = os.fstat(fd)
        if not stat.S_ISREG(st.st_mode):
            raise SystemExit(f"[FATAL] Plan file '{plan_path}' is not a regular file (mode={oct(st.st_mode)})")
        if (st.st_mode & 0o777) != 0o600:
            os.fchmod(fd, 0o600)
            new_mode = os.fstat(fd).st_mode & 0o777
            if new_mode != 0o600:
                raise SystemExit(f"[FATAL] Failed to enforce mode 0600 on '{plan_path}' (mode remains {oct(new_mode)})")
        return fd
    except BaseException as exc:
        try:
            os.close(fd)
        except OSError:
            pass
        if isinstance(exc, SystemExit):
            raise
        raise SystemExit(f"[FATAL] Permission check/hardening failed on plan file '{plan_path}': {exc}")


def enforce_secure_plan_file_permissions(plan_path: pathlib.Path) -> None:
    """Enforce exact mode 0600 on plan file and reject symlinks using atomic file descriptor."""
    fd = open_secure_plan_fd(plan_path)
    try:
        os.close(fd)
    except OSError:
        pass


def validate_plan_file(
    plan_path: pathlib.Path, mode: str = "auto", allow_protected_iam_updates: bool = False
) -> None:
    """Read and validate a terraform show -json plan file via atomic descriptor with TOCTOU-free fstat/fchmod."""
    if not plan_path.is_file():
        raise SystemExit(f"[FATAL] Plan file not found: {plan_path}")
    fd = open_secure_plan_fd(plan_path)
    try:
        with os.fdopen(fd, "r", encoding="utf-8") as f:
            doc = json.load(f)
    except (OSError, json.JSONDecodeError) as exc:
        raise SystemExit(f"[FATAL] Failed reading JSON plan from '{plan_path}': {exc}")
    except BaseException:
        try:
            os.close(fd)
        except OSError:
            pass
        raise

    errors = validate_plan_doc(doc, mode=mode, allow_protected_iam_updates=allow_protected_iam_updates)
    if errors:
        print(f"[FATAL] Terraform Plan Allowlist Validation Failed ({len(errors)} violation(s)):", file=sys.stderr)
        for err in errors:
            print(f"  - {err}", file=sys.stderr)
        raise SystemExit(1)

    print(
        f"[PASS] Remote Terraform Plan matches approved allowlist ({mode}): "
        f"{len(APPROVED_MANAGED_RESOURCES)} core resources verified, 0 deletes/replacements, 0 drift, complete=True, applyable=True."
    )


def make_valid_plan_doc(mode: str = "initial") -> dict[str, Any]:
    """Construct an authoritative golden plan document for bootstrap, initial OIDC, or update testing."""
    prior_res = [{"address": a, "mode": "data", "type": t} for a, t in APPROVED_PRIOR_DATA_SOURCES.items()]
    if mode == "bootstrap":
        rcs = [
            {"address": a, "mode": "managed", "type": APPROVED_MANAGED_RESOURCES[a], "change": {"actions": ["create"]}}
            for a in sorted(PROTECTED_FOUNDATION_IAM_ADDRESSES)
        ]
    else:
        rcs = [{"address": a, "mode": "data", "type": t, "change": {"actions": ["read"]}} for a, t in APPROVED_DATA_SOURCES.items()]
        for a, t in APPROVED_MANAGED_RESOURCES.items():
            act = ["no-op"] if (mode == "update" or a in PROTECTED_FOUNDATION_IAM_ADDRESSES) else ["create"]
            rcs.append({"address": a, "mode": "managed", "type": t, "change": {"actions": act}})
        if mode == "initial":
            prior_res.extend({"address": a, "mode": "managed", "type": APPROVED_MANAGED_RESOURCES[a]} for a in sorted(PROTECTED_FOUNDATION_IAM_ADDRESSES))
        elif mode == "update":
            prior_res.extend({"address": a, "mode": "managed", "type": t} for a, t in APPROVED_MANAGED_RESOURCES.items())
    return {
        "format_version": "1.2", "terraform_version": "1.14.9",
        "errored": False, "applyable": True, "complete": True,
        "deferred_changes": [], "deferred_action_invocations": [], "action_invocations": [], "resource_drift": [],
        "prior_state": {"format_version": "1.0", "terraform_version": "1.14.9", "values": {"root_module": {"resources": prior_res}}},
        "resource_changes": rcs,
    }


def run_self_tests() -> None:
    """Run comprehensive negative, positive, and integration tests for bootstrap, initial, and update plan validation."""
    print("=== [Plan Validator] Running Negative, Positive & Integration Self-Tests ===")
    assert not validate_plan_doc(make_valid_plan_doc("bootstrap"), mode="bootstrap", allow_protected_iam_updates=True)
    assert validate_plan_doc(make_valid_plan_doc("bootstrap"), mode="bootstrap", allow_protected_iam_updates=False)
    print("  [PASS] Golden 7-resource one-time bootstrap plan accepted with break-glass flag and rejected without it")

    assert not validate_plan_doc(make_valid_plan_doc("initial"), mode="auto")
    print("  [PASS] Golden initial OIDC plan (7 bootstrap no-ops + 26 workload/S3/SSM creates) accepted cleanly")

    upd_doc = make_valid_plan_doc("update")
    next(rc for rc in upd_doc["resource_changes"] if rc["address"] == "aws_iam_role.ec2_runtime")["change"]["actions"] = ["update"]
    assert not validate_plan_doc(upd_doc, mode="auto")
    print("  [PASS] Golden subsequent update/no-op plan accepted cleanly (auto & update modes)")

    def assert_rejected(mutator: Callable[[dict[str, Any]], None], substr: str, name: str, base_mode: str = "initial", check_mode: str = "auto") -> None:
        doc = make_valid_plan_doc(base_mode)
        mutator(doc)
        err_list = validate_plan_doc(doc, mode=check_mode)
        assert any(substr in e for e in err_list), f"{name} failed; expected '{substr}', got {err_list}"
        print(f"  [PASS] {name}")

    for patch, substr, name in [
        ({"terraform_version": "1.15.0"}, "Unsupported terraform_version '1.15.0'", "Mismatched terraform_version rejected"),
        ({"format_version": "0.1"}, "Unsupported format_version '0.1'", "Unsupported format_version rejected"),
        ({"errored": True}, "errored is True", "errored=True rejected"),
        ({"errored": None}, "errored is None", "Missing/None errored rejected"),
        ({"applyable": False}, "applyable is False", "applyable=False rejected"),
        ({"applyable": None}, "applyable is None", "Missing/None applyable rejected"),
        ({"complete": False}, "complete is False", "complete=False rejected"),
        ({"complete": None}, "complete is None", "Missing/None complete rejected"),
        ({"deferred_changes": [{"address": "aws_iam_role.foo"}]}, "deferred_changes (1 item(s))", "Unexpected deferred_changes rejected"),
        ({"deferred_changes": {}}, "invalid type 'dict'", "Malformed deferred_changes rejected"),
        ({"deferred_action_invocations": [{"name": "act"}]}, "deferred_action_invocations (1 item(s))", "Unexpected deferred_action_invocations rejected"),
        ({"deferred_action_invocations": ""}, "invalid type 'str'", "Malformed deferred_action_invocations rejected"),
        ({"action_invocations": [{"name": "act"}]}, "action_invocations (1 item(s))", "Unexpected action_invocations rejected"),
        ({"action_invocations": {}}, "invalid type 'dict'", "Malformed action_invocations rejected"),
        ({"resource_drift": [{"address": "aws_s3_bucket.recovery"}]}, "resource_drift (1 item(s))", "Unexpected resource_drift rejected"),
        ({"resource_drift": ""}, "invalid type 'str'", "Malformed resource_drift rejected"),
    ]:
        assert_rejected(lambda d, p=patch: d.update(p), substr, name)
    assert_rejected(lambda d: d.pop("resource_changes"), "Missing or invalid 'resource_changes'", "Missing resource_changes rejected")

    assert_rejected(lambda d: d["resource_changes"].append({"address": "data.aws_s3_bucket.rogue_vault", "mode": "data", "type": "aws_s3_bucket", "change": {"actions": ["read"]}}), "Unapproved data source read 'data.aws_s3_bucket.rogue_vault'", "Unexpected data source read rejected")
    assert_rejected(lambda d: [rc["change"].update(actions=["create"]) for rc in d["resource_changes"] if rc["mode"] == "data"], "strictly requires ['read']", "Data source with create action rejected")
    assert_rejected(lambda d: [rc.update(type="aws_s3_bucket") for rc in d["resource_changes"] if rc["mode"] == "data"], "unexpected type", "Data source with altered type rejected")
    assert_rejected(lambda d: d.update(resource_changes=[rc for rc in d["resource_changes"] if rc["mode"] != "data"]), "Missing expected approved data source in plan", "Plan missing approved data source rejected")
    assert_rejected(lambda d: d["prior_state"]["values"]["root_module"]["resources"].clear(), "Missing expected approved data source in prior_state", "Plan missing prior_state OIDC data source rejected")
    assert_rejected(lambda d: d["prior_state"]["values"]["root_module"]["resources"].append({"address": "aws_s3_bucket.rogue", "mode": "managed", "type": "aws_s3_bucket"}), "clean bootstrap requires empty managed state", "Managed resource in initial prior_state rejected", check_mode="initial")
    assert_rejected(lambda d: d["prior_state"]["values"]["root_module"]["resources"].append({"address": "aws_s3_bucket.rogue", "mode": "managed", "type": "aws_s3_bucket"}), "Unapproved managed resource 'aws_s3_bucket.rogue'", "Unapproved managed resource in update prior_state rejected", base_mode="update")
    assert_rejected(lambda d: d["prior_state"]["values"]["root_module"]["resources"].append({"address": "data.aws_s3_bucket.rogue", "mode": "data", "type": "aws_s3_bucket"}), "Unapproved data source 'data.aws_s3_bucket.rogue'", "Unapproved prior_state data source rejected")
    assert_rejected(lambda d: d["resource_changes"].append({"address": "aws_instance.rogue_vm", "mode": "managed", "type": "aws_instance", "change": {"actions": ["create"]}}), "Unapproved managed resource address 'aws_instance.rogue_vm'", "Unexpected extraneous managed resource rejected")
    assert_rejected(lambda d: [rc["change"].update(actions=["update"]) for rc in d["resource_changes"] if rc["mode"] == "managed" and rc["address"] not in PROTECTED_FOUNDATION_IAM_ADDRESSES][:1], "unapproved change actions ['update']", "Initial mode rejects update action", check_mode="initial")
    assert_rejected(lambda d: next(rc for rc in d["resource_changes"] if rc["address"] == "aws_iam_policy.workload_permissions_boundary")["change"].update(actions=["create"]), "cannot be modified or created", "Initial OIDC mode rejects creating workload_permissions_boundary without bootstrap", check_mode="initial")
    for bad_act in (["delete"], ["delete", "create"], ["create", "delete"]):
        assert_rejected(lambda d, ba=bad_act: [rc["change"].update(actions=ba) for rc in d["resource_changes"] if rc["mode"] == "managed" and rc["address"] not in PROTECTED_FOUNDATION_IAM_ADDRESSES][:1], f"unapproved change actions {bad_act}", f"Update mode rejects {bad_act}", base_mode="update")
    assert_rejected(lambda d: [rc.update(type="aws_iam_user") for rc in d["resource_changes"] if rc["mode"] == "managed"][:1], "unexpected type 'aws_iam_user'", "Managed resource with altered type rejected")
    assert_rejected(lambda d: d["resource_changes"].pop(), "Missing expected managed foundation resource", "Plan missing expected managed foundation resource rejected")
    assert_rejected(lambda d: d["resource_changes"].append(d["resource_changes"][-1].copy()), "Duplicate resource change entry", "Duplicate resource change entry rejected")
    assert_rejected(lambda d: d["resource_changes"][0].update(mode="orphan"), "unrecognized mode 'orphan'", "Resource change with unrecognized mode rejected")

    for prot_addr in ("aws_iam_role.github_foundation", "aws_iam_role.foundation_admin[0]", "aws_iam_policy.workload_permissions_boundary"):
        assert_rejected(lambda d, pa=prot_addr: next(rc for rc in d["resource_changes"] if rc["address"] == pa)["change"].update(actions=["update"]), "cannot be modified", f"Protected IAM update to {prot_addr} rejected", base_mode="update")
    assert_rejected(lambda d: next(rc for rc in d["resource_changes"] if rc["address"] == "aws_iam_role.ec2_runtime")["change"].update(after={"name": "envscale-ec2-runtime-role", "permissions_boundary": None}), "missing mandatory permissions_boundary", "Workload role missing permissions_boundary rejected")
    assert_rejected(lambda d: next(rc for rc in d["resource_changes"] if rc["address"] == "aws_iam_role.github_deploy")["change"].update(after={"permissions_boundary": "arn:aws:iam::982534376726:policy/envscale-workload-permissions-boundary", "assume_role_policy": '{"Statement":[{"Effect":"Allow","Condition":{"StringLike":{"sub":"*"}}}]}'}), "must not contain StringLike", "Trust policy StringLike mutation rejected")
    assert_rejected(lambda d: next(rc for rc in d["resource_changes"] if rc["address"] == "aws_iam_role_policy.github_deploy")["change"].update(after={"policy": '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["iam:PutRolePolicy"],"Resource":"*"}]}'}), "disallowed IAM escalation", "Workload inline policy IAM escalation rejected")
    assert_rejected(lambda d: next(rc for rc in d["resource_changes"] if rc["address"] == "aws_iam_role_policy_attachment.ec2_runtime_ssm_core")["change"].update(after={"role": "envscale-ec2-runtime-role", "policy_arn": "arn:aws:iam::aws:policy/AdministratorAccess"}), "unauthorized managed policy", "Unauthorized managed policy attachment rejected")
    assert_rejected(lambda d: next(rc for rc in d["resource_changes"] if rc["address"] == "aws_s3_bucket_public_access_block.recovery")["change"].update(after={"block_public_acls": False}), "weakens public access blocking", "Recovery bucket public-access-block weakening rejected")
    old_gha = os.environ.get("GITHUB_ACTIONS")
    try:
        os.environ["GITHUB_ACTIONS"] = "true"
        ci_doc = make_valid_plan_doc("update")
        next(rc for rc in ci_doc["resource_changes"] if rc["address"] == "aws_iam_role.github_foundation")["change"]["actions"] = ["update"]
        ci_errs = validate_plan_doc(ci_doc, mode="update", allow_protected_iam_updates=True)
        assert any("forbidden inside automated CI" in e for e in ci_errs), f"Expected CI block on --allow-protected-iam-updates, got {ci_errs}"
        print("  [PASS] --allow-protected-iam-updates rejected inside GITHUB_ACTIONS=true")
    finally:
        if old_gha is None:
            os.environ.pop("GITHUB_ACTIONS", None)
        else:
            os.environ["GITHUB_ACTIONS"] = old_gha

    def expect_exit(fn: Callable[[], None], needle: str, fail_msg: str) -> None:
        try:
            fn()
        except SystemExit as exc:
            assert needle in str(exc) or str(exc.code) == needle, f"{fail_msg}: {exc}"
            return
        raise AssertionError(fail_msg)

    with tempfile.TemporaryDirectory() as td:
        tdp = pathlib.Path(td)
        for name, initial_mode in [("test_644.json", 0o644), ("test_700.json", 0o700), ("test_400.json", 0o400)]:
            p = tdp / name
            p.write_text("{}", encoding="utf-8")
            p.chmod(initial_mode)
            enforce_secure_plan_file_permissions(p)
            assert (p.stat().st_mode & 0o777) == 0o600
        p_fail = tdp / "test_fail.json"
        p_fail.write_text("{}", encoding="utf-8")
        p_fail.chmod(0o644)
        orig_fchmod = getattr(os, "fchmod", None)
        try:
            os.fchmod = lambda fd, mode: (_ for _ in ()).throw(OSError("mocked fchmod failure"))
            expect_exit(lambda: enforce_secure_plan_file_permissions(p_fail), "Permission check/hardening failed", "fchmod failure must exit")
        finally:
            if orig_fchmod is not None:
                os.fchmod = orig_fchmod
        p_target = tdp / "target.json"
        p_target.write_text("{}", encoding="utf-8")
        p_symlink = tdp / "symlink_plan.json"
        p_symlink.symlink_to(p_target)
        expect_exit(lambda: enforce_secure_plan_file_permissions(p_symlink), "symlinks forbidden", "Symlink input must exit")

        orig_open, tracked_fds = os.open, []
        def tracking_open(path, flags, *args, **kwargs):
            fd = orig_open(path, flags, *args, **kwargs)
            tracked_fds.append(fd)
            return fd
        def verify_all_fds_closed() -> None:
            while tracked_fds:
                fd = tracked_fds.pop()
                try:
                    os.fstat(fd)
                    assert False, f"Descriptor {fd} remained open!"
                except OSError as e:
                    assert e.errno == errno.EBADF
        try:
            os.open = tracking_open
            for fname, content, err_sub in [
                ("valid_plan.json", json.dumps(make_valid_plan_doc("initial")), None),
                ("valid_update.json", json.dumps(make_valid_plan_doc("update")), None),
                ("invalid_json.json", "NOT_VALID_JSON{", "Failed reading JSON plan"),
            ]:
                pf = tdp / fname
                pf.write_text(content, encoding="utf-8")
                pf.chmod(0o644)
                if err_sub:
                    expect_exit(lambda p=pf: validate_plan_file(p), err_sub, f"{fname} must exit")
                else:
                    validate_plan_file(pf)
                verify_all_fds_closed()
        finally:
            os.open = orig_open

        for prim in ("O_NOFOLLOW", "fchmod"):
            orig = getattr(os, prim, None)
            try:
                delattr(os, prim)
                expect_exit(verify_security_primitives, f"os.{prim}", f"Missing {prim} must fail closed")
            finally:
                if orig is not None:
                    setattr(os, prim, orig)
    print("[SUCCESS] All plan validator self-tests (initial + update + security primitives) passed cleanly.\n")


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate EnvScale foundation Terraform JSON plan.")
    parser.add_argument("--self-test", action="store_true", help="Run offline negative/positive self-tests")
    parser.add_argument("--mode", choices=["auto", "bootstrap", "initial", "update"], default="auto", help="Plan validation mode")
    parser.add_argument("--allow-protected-iam-updates", action="store_true", help="Break-glass flag allowing updates to protected IAM roles/boundary")
    parser.add_argument("plan_files", nargs="*", help="Path(s) to terraform show -json plan files")
    args = parser.parse_args()
    if args.self_test or not args.plan_files:
        run_self_tests()
    for pf in args.plan_files:
        validate_plan_file(pathlib.Path(pf), mode=args.mode, allow_protected_iam_updates=args.allow_protected_iam_updates)


if __name__ == "__main__":
    main()
