#!/usr/bin/env python3
"""
EnvScale Phase 3 — Strict Remote Terraform Plan Allowlist Validator.

Enforces exact, itemized change-set verification for the Persistent Foundation
Terraform plan. Differentiates managed-resource creations from approved data-source
reads, validates complete plan metadata (Terraform version, format, applyable,
complete, errored), enforces exact 0600 permissions and rejects symlinks via
atomic, TOCTOU-free file descriptors (O_NOFOLLOW, fstat, fchmod), enforces strict
list types on secondary channels, fails closed on unapproved mutations or missing
security primitives, and guarantees descriptor closure via os.fdopen / BaseException.
"""

from __future__ import annotations

import errno
import json
import os
import pathlib
import stat
import sys
import tempfile
from typing import Any, Callable

SUPPORTED_TERRAFORM_VERSION = "1.14.9"
SUPPORTED_FORMAT_VERSIONS = {"1.2"}

# Exactly 28 Approved Managed Resources (mode: "managed", action: ["create"])
APPROVED_MANAGED_RESOURCES: dict[str, str] = {
    "aws_iam_role.ec2_runtime": "aws_iam_role",
    "aws_iam_instance_profile.ec2_runtime": "aws_iam_instance_profile",
    "aws_iam_role_policy.ec2_runtime": "aws_iam_role_policy",
    "aws_iam_role_policy_attachment.ec2_runtime_ssm_core": "aws_iam_role_policy_attachment",
    "aws_iam_role.github_release": "aws_iam_role",
    "aws_iam_role_policy.github_release": "aws_iam_role_policy",
    "aws_iam_role.github_deploy": "aws_iam_role",
    "aws_iam_role_policy.github_deploy": "aws_iam_role_policy",
    "aws_iam_role.github_recovery": "aws_iam_role",
    "aws_iam_role_policy.github_recovery": "aws_iam_role_policy",
    "aws_iam_role.foundation_admin[0]": "aws_iam_role",
    "aws_iam_role_policy.foundation_admin[0]": "aws_iam_role_policy",
    "aws_s3_bucket.recovery": "aws_s3_bucket",
    "aws_s3_bucket_ownership_controls.recovery": "aws_s3_bucket_ownership_controls",
    "aws_s3_bucket_public_access_block.recovery": "aws_s3_bucket_public_access_block",
    "aws_s3_bucket_versioning.recovery": "aws_s3_bucket_versioning",
    "aws_s3_bucket_server_side_encryption_configuration.recovery": "aws_s3_bucket_server_side_encryption_configuration",
    "aws_s3_bucket_lifecycle_configuration.recovery": "aws_s3_bucket_lifecycle_configuration",
    "aws_s3_bucket_policy.recovery": "aws_s3_bucket_policy",
    **{f'aws_ssm_parameter.non_secret["{k}"]': "aws_ssm_parameter" for k in (
        "aws_region", "better_auth_url", "cors_origin", "duckdns_domain",
        "github_client_id", "google_client_id", "postgres_db", "postgres_user", "recovery_bucket"
    )},
}

# Exactly 1 Approved Data Source Read (mode: "data", action: ["read"])
APPROVED_DATA_SOURCES: dict[str, str] = {
    "data.aws_iam_openid_connect_provider.github[0]": "aws_iam_openid_connect_provider",
}

EXPECTED_MANAGED_COUNT = len(APPROVED_MANAGED_RESOURCES)  # 28
EXPECTED_DATA_COUNT = len(APPROVED_DATA_SOURCES)          # 1
EXPECTED_TOTAL_COUNT = EXPECTED_MANAGED_COUNT + EXPECTED_DATA_COUNT  # 29


def validate_plan_doc(plan_doc: dict[str, Any]) -> list[str]:
    """Validate a terraform show -json plan document against strict foundation criteria."""
    errors: list[str] = []
    if not isinstance(plan_doc, dict):
        return ["Plan document root is not a JSON object"]

    tf_ver = plan_doc.get("terraform_version")
    if tf_ver != SUPPORTED_TERRAFORM_VERSION:
        errors.append(f"Unsupported terraform_version '{tf_ver}' (strictly requires '{SUPPORTED_TERRAFORM_VERSION}')")

    fmt_ver = plan_doc.get("format_version")
    if fmt_ver not in SUPPORTED_FORMAT_VERSIONS:
        errors.append(f"Unsupported format_version '{fmt_ver}' (strictly requires one of {sorted(SUPPORTED_FORMAT_VERSIONS)})")

    if plan_doc.get("errored") is not False:
        errors.append(f"Plan document errored is {plan_doc.get('errored')!r} (strictly requires False)")
    if plan_doc.get("applyable") is not True:
        errors.append(f"Plan document applyable is {plan_doc.get('applyable')!r} (strictly requires True)")
    if plan_doc.get("complete") is not True:
        errors.append(f"Plan document complete is {plan_doc.get('complete')!r} (strictly requires True; incomplete plans forbidden)")

    for field in ("deferred_changes", "deferred_action_invocations", "action_invocations", "resource_drift"):
        if field in plan_doc:
            val = plan_doc.get(field)
            if not isinstance(val, list):
                errors.append(f"Plan field '{field}' has invalid type '{type(val).__name__}' (strictly requires empty list; found {val!r})")
            elif len(val) > 0:
                errors.append(f"Plan contains unexpected {field} ({len(val)} item(s)); secondary channels forbidden")

    rcs = plan_doc.get("resource_changes")
    if not isinstance(rcs, list):
        errors.append("Missing or invalid 'resource_changes' list in plan document")
        return errors

    seen_managed: dict[str, dict[str, Any]] = {}
    seen_data: dict[str, dict[str, Any]] = {}
    seen_all_addresses: set[str] = set()

    for rc in rcs:
        if not isinstance(rc, dict):
            errors.append(f"Encountered non-dict entry in resource_changes: {rc}")
            continue

        addr, mode, rtype = rc.get("address"), rc.get("mode"), rc.get("type")
        change = rc.get("change") or {}
        actions = change.get("actions") or []

        if not addr:
            errors.append(f"Resource change missing address: {rc}")
            continue
        if addr in seen_all_addresses:
            errors.append(f"Duplicate resource change entry for address '{addr}'")
            continue
        seen_all_addresses.add(addr)

        if mode == "managed":
            seen_managed[addr] = rc
            if addr not in APPROVED_MANAGED_RESOURCES:
                errors.append(f"Unapproved managed resource address '{addr}' (type='{rtype}') detected in plan. Not present in allowlist!")
                continue
            expected_type = APPROVED_MANAGED_RESOURCES[addr]
            if rtype != expected_type:
                errors.append(f"Managed resource '{addr}' has unexpected type '{rtype}' (expected '{expected_type}')")
            if actions != ["create"]:
                errors.append(f"Managed resource '{addr}' has unapproved change actions {actions} (strictly requires ['create'])")

        elif mode == "data":
            seen_data[addr] = rc
            if addr not in APPROVED_DATA_SOURCES:
                errors.append(f"Unapproved data source read '{addr}' (type='{rtype}') detected in plan. Not present in allowlist!")
                continue
            expected_type = APPROVED_DATA_SOURCES[addr]
            if rtype != expected_type:
                errors.append(f"Data source '{addr}' has unexpected type '{rtype}' (expected '{expected_type}')")
            if actions != ["read"]:
                errors.append(f"Data source '{addr}' has unapproved actions {actions} (strictly requires ['read'])")
        else:
            errors.append(f"Resource change '{addr}' has unrecognized mode '{mode}' (strictly requires 'managed' or 'data')")

    missing_managed = set(APPROVED_MANAGED_RESOURCES.keys()) - set(seen_managed.keys())
    if missing_managed:
        for m in sorted(missing_managed):
            errors.append(f"Missing expected managed foundation resource in plan: '{m}'")

    missing_data = set(APPROVED_DATA_SOURCES.keys()) - set(seen_data.keys())
    if missing_data:
        for md in sorted(missing_data):
            errors.append(f"Missing expected approved data source in plan: '{md}'")

    if len(seen_managed) != EXPECTED_MANAGED_COUNT:
        errors.append(f"Managed resource count ({len(seen_managed)}) != expected allowlist count ({EXPECTED_MANAGED_COUNT})")
    if len(seen_data) != EXPECTED_DATA_COUNT:
        errors.append(f"Data source count ({len(seen_data)}) != expected allowlist count ({EXPECTED_DATA_COUNT})")
    if len(seen_all_addresses) != EXPECTED_TOTAL_COUNT:
        errors.append(f"Total change count ({len(seen_all_addresses)}) != expected total ({EXPECTED_TOTAL_COUNT})")

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
    flags = os.O_RDONLY | os.O_NOFOLLOW
    try:
        fd = os.open(str(plan_path), flags)
    except OSError as exc:
        raise SystemExit(f"[FATAL] Failed opening plan file '{plan_path}' (symlinks forbidden): {exc}")

    try:
        st = os.fstat(fd)
        if not stat.S_ISREG(st.st_mode):
            raise SystemExit(f"[FATAL] Plan file '{plan_path}' is not a regular file (mode={oct(st.st_mode)})")
        cur_mode = st.st_mode & 0o777
        if cur_mode != 0o600:
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


def validate_plan_file(plan_path: pathlib.Path) -> None:
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

    errors = validate_plan_doc(doc)
    if errors:
        print(f"[FATAL] Terraform Plan Allowlist Validation Failed ({len(errors)} violation(s)):", file=sys.stderr)
        for err in errors:
            print(f"  - {err}", file=sys.stderr)
        raise SystemExit(1)

    print(
        f"[PASS] Remote Terraform Plan matches approved allowlist exactly: "
        f"{EXPECTED_MANAGED_COUNT} creates + {EXPECTED_DATA_COUNT} data read (total {EXPECTED_TOTAL_COUNT}), "
        "0 destroys, 0 updates, 0 drift, complete=True, applyable=True."
    )


def make_valid_plan_doc() -> dict[str, Any]:
    """Construct an authoritative golden plan document for testing."""
    rcs = []
    for addr, rtype in APPROVED_DATA_SOURCES.items():
        rcs.append({"address": addr, "mode": "data", "type": rtype, "change": {"actions": ["read"]}})
    for addr, rtype in APPROVED_MANAGED_RESOURCES.items():
        rcs.append({"address": addr, "mode": "managed", "type": rtype, "change": {"actions": ["create"]}})
    return {
        "format_version": "1.2",
        "terraform_version": "1.14.9",
        "errored": False,
        "applyable": True,
        "complete": True,
        "deferred_changes": [],
        "deferred_action_invocations": [],
        "action_invocations": [],
        "resource_drift": [],
        "resource_changes": rcs,
    }


def run_self_tests() -> None:
    """Run comprehensive negative, positive, and integration tests for all plan validation gates."""
    print("=== [Plan Validator] Running Negative, Positive & Integration Self-Tests ===")

    # Test 1 (Positive): Golden baseline plan passes
    golden = make_valid_plan_doc()
    errs = validate_plan_doc(golden)
    assert not errs, f"Golden plan failed validation: {errs}"
    print("  [PASS] Golden 28-create / 1-read plan (complete=True, applyable=True) accepted cleanly")

    def assert_rejected(mutator: Callable[[dict[str, Any]], None], expected_substr: str, test_name: str) -> None:
        doc = make_valid_plan_doc()
        mutator(doc)
        err_list = validate_plan_doc(doc)
        assert any(expected_substr in e for e in err_list), f"{test_name} failed; expected '{expected_substr}', got {err_list}"
        print(f"  [PASS] {test_name}")

    # Section A: Plan Metadata & Execution Channel Negative Tests (17 tests)
    meta_cases = [
        ({"terraform_version": "1.15.0"}, "Unsupported terraform_version '1.15.0'", "Mismatched terraform_version rejected"),
        ({"format_version": "0.1"}, "Unsupported format_version '0.1'", "Unsupported format_version rejected"),
        ({"errored": True}, "errored is True", "errored=True rejected"),
        ({"errored": None}, "errored is None", "Missing/None errored rejected"),
        ({"applyable": False}, "applyable is False", "applyable=False rejected"),
        ({"applyable": None}, "applyable is None", "Missing/None applyable rejected"),
        ({"complete": False}, "complete is False", "complete=False (incomplete plan) rejected"),
        ({"complete": None}, "complete is None", "Missing/None complete rejected"),
        ({"deferred_changes": [{"address": "aws_iam_role.foo"}]}, "deferred_changes (1 item(s))", "Unexpected deferred_changes rejected"),
        ({"deferred_changes": {}}, "invalid type 'dict'", "Malformed type for deferred_changes (empty dict) rejected"),
        ({"deferred_action_invocations": [{"name": "act"}]}, "deferred_action_invocations (1 item(s))", "Unexpected deferred_action_invocations rejected"),
        ({"deferred_action_invocations": ""}, "invalid type 'str'", "Malformed type for deferred_action_invocations (empty str) rejected"),
        ({"action_invocations": [{"name": "act"}]}, "action_invocations (1 item(s))", "Unexpected action_invocations rejected"),
        ({"action_invocations": {}}, "invalid type 'dict'", "Malformed type for action_invocations (empty dict) rejected"),
        ({"resource_drift": [{"address": "aws_s3_bucket.recovery"}]}, "resource_drift (1 item(s))", "Unexpected resource_drift rejected"),
        ({"resource_drift": ""}, "invalid type 'str'", "Malformed type for resource_drift (empty str) rejected"),
    ]
    for patch, substr, name in meta_cases:
        assert_rejected(lambda d, p=patch: d.update(p), substr, name)
    assert_rejected(lambda d: d.pop("resource_changes"), "Missing or invalid 'resource_changes'", "Incomplete plan missing resource_changes rejected")

    # Section B: Data Source & Managed Resource Negative Tests (13 tests)
    assert_rejected(lambda d: d["resource_changes"].append({"address": "data.aws_s3_bucket.rogue_vault", "mode": "data", "type": "aws_s3_bucket", "change": {"actions": ["read"]}}), "Unapproved data source read 'data.aws_s3_bucket.rogue_vault'", "Unexpected data source read rejected")
    assert_rejected(lambda d: [rc["change"].update(actions=["create"]) for rc in d["resource_changes"] if rc["mode"] == "data"], "strictly requires ['read']", "Data source with unapproved action=['create'] rejected")
    assert_rejected(lambda d: [rc.update(type="aws_s3_bucket") for rc in d["resource_changes"] if rc["mode"] == "data"], "Data source 'data.aws_iam_openid_connect_provider.github[0]' has unexpected type", "Data source with altered type rejected")
    assert_rejected(lambda d: d.update(resource_changes=[rc for rc in d["resource_changes"] if rc["mode"] != "data"]), "Missing expected approved data source in plan", "Plan missing approved data source read rejected")
    assert_rejected(lambda d: d["resource_changes"].append({"address": "aws_instance.rogue_vm", "mode": "managed", "type": "aws_instance", "change": {"actions": ["create"]}}), "Unapproved managed resource address 'aws_instance.rogue_vm'", "Unexpected extraneous managed resource rejected")
    assert_rejected(lambda d: [rc["change"].update(actions=["update"]) for rc in d["resource_changes"] if rc["mode"] == "managed"][:1], "unapproved change actions ['update']", "Managed resource with action=['update'] rejected")
    assert_rejected(lambda d: [rc["change"].update(actions=["delete"]) for rc in d["resource_changes"] if rc["mode"] == "managed"][:1], "unapproved change actions ['delete']", "Managed resource with action=['delete'] rejected")
    assert_rejected(lambda d: [rc["change"].update(actions=["delete", "create"]) for rc in d["resource_changes"] if rc["mode"] == "managed"][:1], "unapproved change actions ['delete', 'create']", "Managed resource with replacement ['delete', 'create'] rejected")
    assert_rejected(lambda d: [rc["change"].update(actions=["create", "delete"]) for rc in d["resource_changes"] if rc["mode"] == "managed"][:1], "unapproved change actions ['create', 'delete']", "Managed resource with reverse replacement ['create', 'delete'] rejected")
    assert_rejected(lambda d: [rc.update(type="aws_iam_user") for rc in d["resource_changes"] if rc["mode"] == "managed"][:1], "unexpected type 'aws_iam_user'", "Managed resource with altered type rejected")
    assert_rejected(lambda d: d["resource_changes"].pop(), "Missing expected managed foundation resource", "Plan missing expected managed foundation resource rejected")
    assert_rejected(lambda d: d["resource_changes"].append(d["resource_changes"][-1].copy()), "Duplicate resource change entry", "Duplicate resource change entry rejected")
    assert_rejected(lambda d: d["resource_changes"][0].update(mode="orphan"), "unrecognized mode 'orphan'", "Resource change with unrecognized mode rejected")

    # Section C: Plan File Permission & Symlink Guards (5 tests)
    with tempfile.TemporaryDirectory() as td:
        tdp = pathlib.Path(td)

        for name, initial_mode in [("test_644.json", 0o644), ("test_700.json", 0o700), ("test_400.json", 0o400)]:
            p = tdp / name
            p.write_text("{}", encoding="utf-8")
            p.chmod(initial_mode)
            enforce_secure_plan_file_permissions(p)
            assert (p.stat().st_mode & 0o777) == 0o600, f"{oct(initial_mode)} was not hardened to 0600"
            print(f"  [PASS] Mode {oct(initial_mode)} successfully hardened to 0600")

        p_fail = tdp / "test_fail.json"
        p_fail.write_text("{}", encoding="utf-8")
        p_fail.chmod(0o644)
        orig_fchmod = getattr(os, "fchmod", None)
        try:
            os.fchmod = lambda fd, mode: (_ for _ in ()).throw(OSError("Operation not permitted (mocked fchmod failure)"))
            failed = False
            try:
                enforce_secure_plan_file_permissions(p_fail)
            except SystemExit as exc:
                failed = True
                assert "Permission check/hardening failed" in str(exc)
            assert failed, "fchmod failure must raise SystemExit"
            print("  [PASS] Permission modification failure causes non-zero exit")
        finally:
            if orig_fchmod is not None:
                os.fchmod = orig_fchmod

        p_target = tdp / "target.json"
        p_target.write_text("{}", encoding="utf-8")
        p_target.chmod(0o600)
        p_symlink = tdp / "symlink_plan.json"
        p_symlink.symlink_to(p_target)
        symlink_failed = False
        try:
            enforce_secure_plan_file_permissions(p_symlink)
        except SystemExit as exc:
            symlink_failed = True
            assert "symlinks forbidden" in str(exc)
        assert symlink_failed, "Symlink input must raise SystemExit via O_NOFOLLOW"
        print("  [PASS] Symlink input is rejected with non-zero exit via O_NOFOLLOW")

        # Section D: Integration Tests (validate_plan_file, fd closure, missing primitives) (6 tests)
        orig_open = os.open
        tracked_fds: list[int] = []

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
                    assert e.errno == errno.EBADF, f"Expected EBADF for closed fd {fd}, got: {e}"

        try:
            os.open = tracking_open

            # Integration Test 1: Valid JSON plan accepted through validate_plan_file()
            p_valid = tdp / "valid_plan.json"
            p_valid.write_text(json.dumps(make_valid_plan_doc()), encoding="utf-8")
            p_valid.chmod(0o644)
            validate_plan_file(p_valid)
            verify_all_fds_closed()
            print("  [PASS] Integration: Valid JSON plan accepted through validate_plan_file() (descriptor closed)")

            # Integration Test 2: Invalid JSON rejected through validate_plan_file()
            p_invalid = tdp / "invalid_json.json"
            p_invalid.write_text("NOT_VALID_JSON{", encoding="utf-8")
            p_invalid.chmod(0o644)
            inv_failed = False
            try:
                validate_plan_file(p_invalid)
            except SystemExit as exc:
                inv_failed = True
                assert "Failed reading JSON plan" in str(exc)
            assert inv_failed, "Invalid JSON must raise SystemExit"
            verify_all_fds_closed()
            print("  [PASS] Integration: Invalid JSON rejected through validate_plan_file() (descriptor closed)")

            # Integration Test 3: Unapproved resource rejected through validate_plan_file()
            p_unapproved = tdp / "unapproved_res.json"
            unapproved_doc = make_valid_plan_doc()
            unapproved_doc["resource_changes"].append({
                "address": "aws_instance.rogue",
                "mode": "managed",
                "type": "aws_instance",
                "change": {"actions": ["create"]},
            })
            p_unapproved.write_text(json.dumps(unapproved_doc), encoding="utf-8")
            p_unapproved.chmod(0o644)
            unapp_failed = False
            try:
                validate_plan_file(p_unapproved)
            except SystemExit as exc:
                unapp_failed = True
                assert exc.code == 1 or "1" in str(exc.code)
            assert unapp_failed, "Unapproved resource must fail validate_plan_file()"
            verify_all_fds_closed()
            print("  [PASS] Integration: Unapproved resource rejected through validate_plan_file() (descriptor closed)")
        finally:
            os.open = orig_open

        # Integration Test 4: Guaranteed closure on internal exception in open_secure_plan_fd()
        p_dummy = tdp / "dummy.json"
        p_dummy.write_text("{}", encoding="utf-8")
        orig_fstat = os.fstat
        opened_fail_fds: list[int] = []
        try:
            def failing_fstat(fd):
                opened_fail_fds.append(fd)
                raise SystemExit("[FATAL] Mocked failure inside open_secure_plan_fd")
            os.fstat = failing_fstat
            fstat_failed = False
            try:
                open_secure_plan_fd(p_dummy)
            except SystemExit as exc:
                fstat_failed = True
                assert "Mocked failure" in str(exc)
            assert fstat_failed, "open_secure_plan_fd must raise on internal failure"
            for fd in opened_fail_fds:
                try:
                    orig_fstat(fd)
                    assert False, f"fd {fd} was not closed during failure in open_secure_plan_fd!"
                except OSError as e:
                    assert e.errno == errno.EBADF
            print("  [PASS] Integration: Descriptor closed on internal exception/SystemExit in open_secure_plan_fd")
        finally:
            os.fstat = orig_fstat

        # Integration Tests 5 & 6: Missing security primitives cause fail-closed exit
        for prim in ("O_NOFOLLOW", "fchmod"):
            orig = getattr(os, prim, None)
            try:
                delattr(os, prim)
                failed = False
                try:
                    verify_security_primitives()
                except SystemExit as exc:
                    failed = True
                    assert f"os.{prim}" in str(exc)
                assert failed, f"Missing {prim} must fail closed"
                print(f"  [PASS] Integration: Missing primitive 'os.{prim}' causes fail-closed exit")
            finally:
                if orig is not None:
                    setattr(os, prim, orig)

    print("[SUCCESS] All 42 plan validator self-tests passed cleanly.\n")


def main() -> None:
    if len(sys.argv) < 2 or "--self-test" in sys.argv:
        run_self_tests()
        if len(sys.argv) < 2:
            return

    for arg in sys.argv[1:]:
        if arg == "--self-test":
            continue
        validate_plan_file(pathlib.Path(arg))


if __name__ == "__main__":
    main()
