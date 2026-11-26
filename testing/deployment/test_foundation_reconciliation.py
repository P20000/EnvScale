#!/usr/bin/env python3
"""Tests for repeatable Foundation reconciliation, state monotonicity, safety validation, and Test Center integration."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import pathlib
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
BOOTSTRAP_DIR = REPO_ROOT / "deployment" / "bootstrap"
FOUNDATION_DIR = REPO_ROOT / "deployment" / "foundation"
for _p in (str(REPO_ROOT), str(BOOTSTRAP_DIR)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import foundation_reconcile_lib as rec_lib  # noqa: E402
import iam_policy_simulator as sim  # noqa: E402
from plan_iam_safety import PROTECTED_FOUNDATION_IAM_ADDRESSES  # noqa: E402
from scripts.lib import cloud_demo_flow, cloud_orchestrator, foundation_reconcile  # noqa: E402
from scripts.lib.cloud_config_utils import AwsSessionContext  # noqa: E402

ACCOUNT = "982534376726"
REGION = "ap-south-1"


def _make_admin_session() -> AwsSessionContext:
    return AwsSessionContext(
        account_id=ACCOUNT,
        region=REGION,
        caller_arn=f"arn:aws:sts::{ACCOUNT}:assumed-role/envscale-foundation-admin-role/test-mfa",
        role_arn=f"arn:aws:iam::{ACCOUNT}:role/envscale-foundation-admin-role",
        expires_at_utc="2099-01-01T00:00:00+00:00",
        _creds={"AccessKeyId": "ASIATESTADMIN1234567", "SecretAccessKey": "sec-admin", "SessionToken": "tok-admin"},
    )


def _state_resources(addrs: list[str]) -> list[dict]:
    out = []
    for a in addrs:
        mode = "managed"
        raw = a
        if raw.startswith("data."):
            mode = "data"
            raw = raw[5:]
        idx = None
        if "[" in raw and raw.endswith("]"):
            base, idx_s = raw[:-1].split("[", 1)
            idx = int(idx_s) if idx_s.isdigit() else idx_s.strip('"')
        else:
            base = raw
        rtype, rname = base.split(".", 1)
        inst = {"index_key": idx} if idx is not None else {}
        out.append({"mode": mode, "type": rtype, "name": rname, "instances": [inst]})
    return out


class FakeAwsEnvironment:
    """In-memory AWS IAM/S3/SSM responder matching real Foundation HCL definitions."""

    def __init__(self) -> None:
        self.rendered = sim.build_rendered_foundation_policies(FOUNDATION_DIR)
        self.serial = 7
        self.version_id = "ver-7"
        self.etag = '"etag-7"'
        self.tracked_addrs = ["data.aws_iam_openid_connect_provider.github[0]", *sorted(PROTECTED_FOUNDATION_IAM_ADDRESSES)]
        self.admin_policy = json.loads(json.dumps(self.rendered["role_foundation_admin"]))
        self.gf_policy = json.loads(json.dumps(self.rendered["role_github_foundation"]))
        self.gfp_policy = json.loads(json.dumps(self.rendered["role_github_foundation_plan"]))
        self.wb_policy = json.loads(json.dumps(self.rendered["role_workload_permissions_boundary"]))
        self.rtb_policy = json.loads(json.dumps(self.rendered["boundary_runtime_provisioner"]))
        self.runtime_boundary_exists = True
        self.workload_roles_exist = True
        self.instance_profile_exists = True
        self.instance_profile_role_attached = True
        self.recovery_bucket_exists = True
        self.ssm_accessible = True
        self.non_secret_keys = set(rec_lib.REQUIRED_NON_SECRET_SSM_KEYS)
        self.secure_keys = set(rec_lib.REQUIRED_SECURESTRING_KEYS)

    def __call__(self, service: str, op: str, params: list[str]) -> dict:
        if service == "s3api" and op == "head-object":
            return {"VersionId": self.version_id, "ETag": self.etag, "LastModified": "2026-11-26T00:00:00Z"}
        if service == "s3api" and op == "get-object-body":
            return {"serial": self.serial, "lineage": "lin-test", "resources": _state_resources(self.tracked_addrs)}
        if service == "s3api" and op == "head-bucket":
            if self.recovery_bucket_exists:
                return {}
            raise RuntimeError("404 NotFound")
        if service == "iam" and op == "get-role":
            rname = params[params.index("--role-name") + 1]
            trust_map = {
                "envscale-foundation-admin-role": self.rendered["trust_foundation_admin"],
                "envscale-github-foundation-role": self.rendered["trust_github_foundation"],
                "envscale-github-foundation-plan-role": self.rendered["trust_github_foundation_plan"],
            }
            if rname in trust_map:
                return {"Role": {"RoleName": rname, "MaxSessionDuration": 3600, "AssumeRolePolicyDocument": trust_map[rname]}}
            if rname in rec_lib.REQUIRED_WORKLOAD_ROLES and self.workload_roles_exist:
                return {"Role": {"RoleName": rname}}
            raise RuntimeError("NoSuchEntity")
        if service == "iam" and op == "list-attached-role-policies":
            return {"AttachedPolicies": []}
        if service == "iam" and op == "get-role-policy":
            rname = params[params.index("--role-name") + 1]
            doc_map = {
                "envscale-foundation-admin-role": self.admin_policy,
                "envscale-github-foundation-role": self.gf_policy,
                "envscale-github-foundation-plan-role": self.gfp_policy,
            }
            if rname in doc_map:
                return {"PolicyDocument": doc_map[rname]}
            raise RuntimeError("NoSuchEntity")
        if service == "iam" and op == "get-policy":
            arn = params[params.index("--policy-arn") + 1]
            if arn.endswith("envscale-workload-permissions-boundary"):
                return {"Policy": {"Arn": arn, "DefaultVersionId": "v1"}}
            if arn.endswith("envscale-runtime-provisioner-permissions-boundary") and self.runtime_boundary_exists:
                return {"Policy": {"Arn": arn, "DefaultVersionId": "v1"}}
            raise RuntimeError("NoSuchEntity")
        if service == "iam" and op == "get-policy-version":
            arn = params[params.index("--policy-arn") + 1]
            doc = self.wb_policy if "workload-permissions-boundary" in arn else self.rtb_policy
            return {"PolicyVersion": {"Document": doc}}
        if service == "iam" and op == "get-instance-profile":
            if self.instance_profile_exists:
                roles = [{"RoleName": "envscale-ec2-runtime-role"}] if self.instance_profile_role_attached else []
                return {"InstanceProfile": {"InstanceProfileName": "envscale-ec2-runtime-profile", "Roles": roles}}
            raise RuntimeError("NoSuchEntity")
        if service == "ssm" and op == "describe-parameters":
            if not self.ssm_accessible:
                raise RuntimeError("AccessDeniedException")
            names = [f"/envscale/prod/{k}" for k in sorted(self.non_secret_keys | self.secure_keys)]
            return {"Parameters": [{"Name": n} for n in names]}
        raise AssertionError(f"Unexpected AWS call: {service} {op} {params}")


def _make_bootstrap_plan_doc(
    *,
    actions_override: dict[str, list[str]] | None = None,
    drift: list | None = None,
    extra_rc: list[dict] | None = None,
    prior_serial: int | None = None,
) -> dict:
    actions_override = actions_override or {}
    rcs = []
    for addr in sorted(PROTECTED_FOUNDATION_IAM_ADDRESSES):
        rtype = "aws_iam_policy" if addr.startswith("aws_iam_policy.") else ("aws_iam_role" if addr.startswith("aws_iam_role.") else "aws_iam_role_policy")
        acts = actions_override.get(addr, ["no-op"])
        rc: dict = {"address": addr, "mode": "managed", "type": rtype, "change": {"actions": acts}}
        if addr == "aws_iam_role_policy.github_foundation" and acts == ["update"]:
            rc["change"]["after"] = {"policy": json.dumps({"Version": "2012-10-17", "Statement": [{"Sid": "DenySelfAndBreakGlassAdminMutation", "Effect": "Deny", "Action": "iam:Delete*", "Resource": "*"}, {"Sid": "DenyBoundaryRemovalAndPolicyWeakening", "Effect": "Deny", "Action": "iam:DeleteRolePermissionsBoundary", "Resource": "*"}]})}
        rcs.append(rc)
    if extra_rc:
        rcs.extend(extra_rc)
    prior_state: dict = {
        "format_version": "1.0",
        "terraform_version": "1.14.9",
        "values": {
            "root_module": {
                "resources": [{
                    "address": "data.aws_iam_openid_connect_provider.github[0]",
                    "mode": "data",
                    "type": "aws_iam_openid_connect_provider",
                }]
            }
        },
    }
    if prior_serial is not None:
        prior_state["serial"] = prior_serial
    return {
        "format_version": "1.2",
        "terraform_version": "1.14.9",
        "errored": False,
        "applyable": True,
        "complete": True,
        "deferred_changes": [],
        "deferred_action_invocations": [],
        "action_invocations": [],
        "resource_drift": drift or [],
        "prior_state": prior_state,
        "resource_changes": rcs,
    }


class TestFoundationReconciliation(unittest.TestCase):
    def test_four_state_classification_matrix(self):
        fake = FakeAwsEnvironment()
        rep_healthy = rec_lib.inspect_foundation_state(FOUNDATION_DIR, aws_cli=fake)
        self.assertEqual(rep_healthy["classification"], rec_lib.STATE_HEALTHY)

        # 3. Secrets required when Foundation exists but SecureStrings are missing
        fake_sec = FakeAwsEnvironment()
        fake_sec.secure_keys.remove("duckdns_token")
        rep_sec = rec_lib.inspect_foundation_state(FOUNDATION_DIR, aws_cli=fake_sec)
        self.assertEqual(rep_sec["classification"], rec_lib.STATE_SECRETS_REQUIRED)
        self.assertEqual(rep_sec["ssm_secrets"]["missing_securestrings"], ["/envscale/prod/duckdns_token"])

        # 2. Foundation deployment required when workload role / bucket / profile missing
        fake_fnd = FakeAwsEnvironment()
        fake_fnd.workload_roles_exist = False
        fake_fnd.instance_profile_exists = False
        fake_fnd.recovery_bucket_exists = False
        rep_fnd = rec_lib.inspect_foundation_state(FOUNDATION_DIR, aws_cli=fake_fnd)
        self.assertEqual(rep_fnd["classification"], rec_lib.STATE_FOUNDATION_DEPLOY_REQUIRED)
        self.assertIn("instance-profile:envscale-ec2-runtime-profile", rep_fnd["foundation_resources"]["missing"])

        # 2b. Empty instance profile (no attached ec2-runtime role) must also require Foundation deploy
        fake_empty_ip = FakeAwsEnvironment()
        fake_empty_ip.instance_profile_role_attached = False
        rep_empty_ip = rec_lib.inspect_foundation_state(FOUNDATION_DIR, aws_cli=fake_empty_ip)
        self.assertEqual(rep_empty_ip["classification"], rec_lib.STATE_FOUNDATION_DEPLOY_REQUIRED)
        self.assertEqual(
            rep_empty_ip["foundation_resources"]["missing"],
            ["instance-profile-role:envscale-ec2-runtime-profile->envscale-ec2-runtime-role"],
        )

        # 1. Bootstrap reconciliation required when protected IAM drifts or is missing
        fake_boot = FakeAwsEnvironment()
        fake_boot.gf_policy["Statement"].pop()
        rep_boot = rec_lib.inspect_foundation_state(FOUNDATION_DIR, aws_cli=fake_boot)
        self.assertEqual(rep_boot["classification"], rec_lib.STATE_BOOTSTRAP_REQUIRED)
        self.assertIn("aws_iam_role_policy.github_foundation", rep_boot["protected_iam"]["drifted"])

    def test_reconcile_idempotency_when_already_healthy(self):
        fake = FakeAwsEnvironment()
        calls = []
        def _fail_if_called(*args, **kwargs):
            calls.append(args)
            raise AssertionError("Subprocess must not be called when Foundation is healthy")

        r1 = rec_lib.reconcile_foundation(FOUNDATION_DIR, dry_run=False, apply_bootstrap=True, deploy_foundation=True, aws_cli=fake, run_fn=_fail_if_called)
        r2 = rec_lib.reconcile_foundation(FOUNDATION_DIR, dry_run=False, apply_bootstrap=True, deploy_foundation=True, aws_cli=fake, run_fn=_fail_if_called)
        self.assertEqual(r1["status"], "NO_CHANGES")
        self.assertEqual(r2["status"], "NO_CHANGES")
        self.assertFalse(r1["applied"])
        self.assertEqual(r1["changes_made"], 0)
        self.assertEqual(calls, [])

    def test_refuses_silent_import_of_untracked_protected_iam(self):
        fake = FakeAwsEnvironment()
        fake.tracked_addrs = [a for a in fake.tracked_addrs if a != "aws_iam_policy.runtime_provisioner_permissions_boundary"]
        rep = rec_lib.inspect_foundation_state(FOUNDATION_DIR, aws_cli=fake)
        self.assertEqual(rep["classification"], rec_lib.STATE_BOOTSTRAP_REQUIRED)
        self.assertEqual(rep["protected_iam"]["untracked_in_state"], ["aws_iam_policy.runtime_provisioner_permissions_boundary"])
        with self.assertRaises(RuntimeError) as ctx:
            rec_lib.generate_and_validate_bootstrap_plan(FOUNDATION_DIR, aws_cli=fake, inspection=rep)
        self.assertIn("Refusing silent import", str(ctx.exception))

    def test_state_monotonicity_rejects_older_state_conflict_and_rollback(self):
        older = {"exists": True, "version_id": "ver-5", "etag": '"etag-5"', "serial": 5}
        newer = {"exists": True, "version_id": "ver-6", "etag": '"etag-6"', "serial": 6}
        with self.assertRaises(RuntimeError) as ctx:
            rec_lib.verify_state_monotonicity(older, newer)
        self.assertIn("newer than plan-time serial", str(ctx.exception))

        same_ser_diff_ver = {"exists": True, "version_id": "ver-6b", "etag": '"etag-6"', "serial": 6}
        with self.assertRaises(RuntimeError) as ctx2:
            rec_lib.verify_state_monotonicity(newer, same_ser_diff_ver)
        self.assertIn("VersionId", str(ctx2.exception))

        plan_with_old_prior = _make_bootstrap_plan_doc(prior_serial=4)
        with self.assertRaises(RuntimeError) as ctx3:
            rec_lib.verify_state_monotonicity(newer, newer, plan_doc=plan_with_old_prior)
        self.assertIn("prior_state serial", str(ctx3.exception))

    def test_bootstrap_plan_rejects_deletes_replacements_drift_and_privilege_expansion(self):
        fake = FakeAwsEnvironment()
        fake.gf_policy["Statement"].pop()

        bad_cases = [
            ("delete", _make_bootstrap_plan_doc(actions_override={"aws_iam_role_policy.github_foundation": ["delete"]}), "delete"),
            ("replace", _make_bootstrap_plan_doc(actions_override={"aws_iam_role_policy.github_foundation": ["delete", "create"]}), "delete"),
            ("drift", _make_bootstrap_plan_doc(drift=[{"address": "aws_iam_role.foundation_admin[0]"}]), "resource_drift"),
            ("non_protected", _make_bootstrap_plan_doc(extra_rc=[{"address": "aws_s3_bucket.recovery", "mode": "managed", "type": "aws_s3_bucket", "change": {"actions": ["create"]}}]), "Non-bootstrap"),
            (
                "priv_expansion",
                _make_bootstrap_plan_doc(extra_rc=[{
                    "address": "aws_iam_role_policy.ec2_runtime", "mode": "managed", "type": "aws_iam_role_policy",
                    "change": {"actions": ["create"], "after": {"policy": json.dumps({"Version": "2012-10-17", "Statement": [{"Effect": "Allow", "Action": ["iam:*"], "Resource": "*"}]})}},
                }]),
                "wildcard Allow",
            ),
        ]

        for label, bad_doc, needle in bad_cases:
            with self.subTest(label=label), tempfile.TemporaryDirectory() as td:
                def _fake_run(cmd, **kwargs):
                    if cmd[:2] == ["terraform", "plan"]:
                        p = pathlib.Path(next(a.split("=", 1)[1] for a in cmd if a.startswith("-out=")))
                        p.write_bytes(b"fake-tfplan-binary")
                        return subprocess.CompletedProcess(cmd, 0, "", "")
                    if cmd[:3] == ["terraform", "show", "-json"]:
                        return subprocess.CompletedProcess(cmd, 0, json.dumps(bad_doc), "")
                    return subprocess.CompletedProcess(cmd, 0, "", "")

                with self.assertRaises(RuntimeError, msg=f"Expected failure for {label}") as exc_ctx:
                    rec_lib.generate_and_validate_bootstrap_plan(
                        FOUNDATION_DIR, plan_dir=pathlib.Path(td), aws_cli=fake, run_fn=_fake_run,
                        inspection=rec_lib.inspect_foundation_state(FOUNDATION_DIR, aws_cli=fake),
                    )
                self.assertIn(needle, str(exc_ctx.exception))

    def test_bootstrap_apply_requires_matching_sha_or_approval_and_delegates_to_bootstrap_state(self):
        fake = FakeAwsEnvironment()
        fake.gf_policy["Statement"].pop()
        valid_doc = _make_bootstrap_plan_doc(actions_override={"aws_iam_role_policy.github_foundation": ["update"]})
        bs_cmds = []

        def _run_ok(cmd, **kwargs):
            if cmd[:2] == ["terraform", "plan"]:
                p = pathlib.Path(next(a.split("=", 1)[1] for a in cmd if a.startswith("-out=")))
                p.write_bytes(b"reviewed-plan-bytes")
                return subprocess.CompletedProcess(cmd, 0, "", "")
            if cmd[:3] == ["terraform", "show", "-json"]:
                return subprocess.CompletedProcess(cmd, 0, json.dumps(valid_doc), "")
            if len(cmd) >= 2 and cmd[1].endswith("bootstrap-state.sh"):
                bs_cmds.append(cmd)
                fake.gf_policy = json.loads(json.dumps(fake.rendered["role_github_foundation"]))
                return subprocess.CompletedProcess(cmd, 0, "[SUCCESS]", "")
            return subprocess.CompletedProcess(cmd, 0, "", "")

        # Wrong SHA rejected before apply
        with self.assertRaises(RuntimeError) as bad_sha:
            rec_lib.reconcile_foundation(
                FOUNDATION_DIR, dry_run=False, apply_bootstrap=True,
                expected_plan_sha256="0" * 64, aws_cli=fake, run_fn=_run_ok,
            )
        self.assertIn("SHA-256 mismatch", str(bad_sha.exception))
        self.assertEqual(bs_cmds, [])

        # Declined approval rejected
        with self.assertRaises(RuntimeError) as declined:
            rec_lib.reconcile_foundation(
                FOUNDATION_DIR, dry_run=False, apply_bootstrap=True,
                approval_cb=lambda _p: False, aws_cli=fake, run_fn=_run_ok,
            )
        self.assertIn("aborted", str(declined.exception))
        self.assertEqual(bs_cmds, [])

        # Exact SHA accepted and delegated to bootstrap-state.sh
        expected_sha = hashlib.sha256(b"reviewed-plan-bytes").hexdigest()
        res = rec_lib.reconcile_foundation(
            FOUNDATION_DIR, dry_run=False, apply_bootstrap=True,
            expected_plan_sha256=expected_sha, aws_cli=fake, run_fn=_run_ok,
        )
        self.assertEqual(res["status"], "APPLIED_BOOTSTRAP")
        self.assertEqual(res["classification"], rec_lib.STATE_HEALTHY)
        self.assertEqual(len(bs_cmds), 1)
        self.assertIn("--bootstrap-foundation-iam", bs_cmds[0])
        self.assertIn(expected_sha, bs_cmds[0])

    def test_test_center_reuses_mfa_session_and_deploy_never_runs_bootstrap(self):
        with tempfile.TemporaryDirectory() as td:
            mfa_prompts = []
            orch = cloud_orchestrator.CloudOrchestrator(
                state_store=cloud_orchestrator.PipelineStateStore(pathlib.Path(td) / "state.json"),
                admin_session=_make_admin_session(),
                allow_ram_handoff=False,
            )
            cbs = cloud_orchestrator.OrchestratorCallbacks(
                on_mfa_session=lambda: mfa_prompts.append("prompted") or _make_admin_session(),
            )
            healthy_report = {
                "classification": rec_lib.STATE_HEALTHY,
                "recommended_action": "No action required",
                "state_metadata": {"version_id": "v7", "serial": 7},
                "protected_iam": {"missing": [], "untracked_in_state": [], "drifted": [], "unexpected": []},
                "foundation_resources": {"missing": [], "ready": True},
                "ssm_secrets": {"accessible": True, "present_count": 9, "missing_securestrings": []},
            }
            with mock.patch.object(foundation_reconcile, "inspect_foundation_state", return_value=healthy_report):
                out = orch.initialize_foundation(callbacks=cbs, reconcile=True)
            self.assertEqual(out["status"], "SUCCEEDED")
            self.assertEqual(out["changes_made"], 0)
            self.assertEqual(mfa_prompts, [])

            # Normal Runtime Deploy must only check readiness and never invoke bootstrap reconciliation
            missing_info = {
                "authenticated": True, "account_id": ACCOUNT, "region": REGION,
                "roles": {"envscale-runtime-provisioner-role": {"exists": False, "error": "NoSuchEntity"}},
                "instance_profile": {"exists": False, "error": "NoSuchEntity"},
            }
            with (
                mock.patch.object(cloud_demo_flow.shutil, "which", return_value="/usr/bin/ok"),
                mock.patch.object(cloud_orchestrator, "inspect_aws_identity", return_value=missing_info),
                mock.patch.object(foundation_reconcile, "reconcile_foundation") as m_rec,
            ):
                dep_res = orch.deploy_environment()
            self.assertEqual(dep_res["status"], "FOUNDATION_NOT_INITIALIZED")
            m_rec.assert_not_called()

        pipe_src = (REPO_ROOT / "scripts/lib/gui_adw/cloud_pipeline_panel.py").read_text(encoding="utf-8")
        demo_src = (REPO_ROOT / "scripts/lib/gui_adw/demo_cloud_panel.py").read_text(encoding="utf-8")
        self.assertIn("reconcile=True", pipe_src)
        self.assertIn("bootstrap_reconcile", pipe_src)
        self.assertNotIn("reconcile", demo_src.lower())

    def test_bootstrap_apply_reuses_reviewed_plan_bin_without_regenerating_plan(self):
        fake = FakeAwsEnvironment()
        fake.gf_policy["Statement"].pop()
        valid_doc = _make_bootstrap_plan_doc(actions_override={"aws_iam_role_policy.github_foundation": ["update"]})
        tf_cmds, bs_cmds = [], []

        with tempfile.TemporaryDirectory() as td:
            reviewed_bin = pathlib.Path(td) / "reviewed.tfplan"
            reviewed_bin.write_bytes(b"deterministic-reviewed-tfplan")
            expected_sha = hashlib.sha256(b"deterministic-reviewed-tfplan").hexdigest()

            def _run_reuse(cmd, **kwargs):
                if cmd and cmd[0] == "terraform":
                    tf_cmds.append(cmd[:3])
                if cmd[:3] == ["terraform", "show", "-json"]:
                    return subprocess.CompletedProcess(cmd, 0, json.dumps(valid_doc), "")
                if len(cmd) >= 2 and cmd[1].endswith("bootstrap-state.sh"):
                    bs_cmds.append(cmd)
                    fake.gf_policy = json.loads(json.dumps(fake.rendered["role_github_foundation"]))
                    return subprocess.CompletedProcess(cmd, 0, "[SUCCESS]", "")
                return subprocess.CompletedProcess(cmd, 0, "", "")

            with self.assertRaises(RuntimeError) as bad_sha:
                rec_lib.reconcile_foundation(
                    FOUNDATION_DIR, dry_run=False, apply_bootstrap=True,
                    plan_bin=str(reviewed_bin), expected_plan_sha256="f" * 64,
                    aws_cli=fake, run_fn=_run_reuse,
                )
            self.assertIn("SHA-256 mismatch", str(bad_sha.exception))

            res = rec_lib.reconcile_foundation(
                FOUNDATION_DIR, dry_run=False, apply_bootstrap=True,
                plan_bin=str(reviewed_bin), expected_plan_sha256=expected_sha,
                aws_cli=fake, run_fn=_run_reuse,
            )
            self.assertEqual(res["status"], "APPLIED_BOOTSTRAP")
            self.assertFalse(any(c[:2] == ["terraform", "plan"] for c in tf_cmds))
            self.assertIn(str(reviewed_bin.resolve()), bs_cmds[0])
            self.assertIn(expected_sha, bs_cmds[0])

    def test_plan_validator_update_prior_data_source_and_benign_shadow_drift(self):
        spec = importlib.util.spec_from_file_location("vfp_mod", str(BOOTSTRAP_DIR / "validate-foundation-plan.py"))
        vfp = importlib.util.module_from_spec(spec)  # type: ignore[arg-type]
        assert spec and spec.loader
        spec.loader.exec_module(vfp)  # type: ignore[union-attr]
        upd = vfp.make_valid_plan_doc("update")
        # 1. data.aws_iam_policy_document.recovery_bucket_policy present only in prior_state passes update mode
        ds_rc = next(rc for rc in upd["resource_changes"] if rc["address"] == "data.aws_iam_policy_document.recovery_bucket_policy")
        upd["resource_changes"].remove(ds_rc)
        self.assertTrue(vfp.validate_plan_doc(upd, mode="auto"))
        upd["prior_state"]["values"]["root_module"]["resources"].append(
            {"address": ds_rc["address"], "mode": "data", "type": ds_rc["type"]}
        )
        self.assertEqual(vfp.validate_plan_doc(upd, mode="auto"), [])

        # 2. Benign provider-v5 shadow drift on no-op S3 resources passes update mode
        sse_before = {"rule": [{"apply_server_side_encryption_by_default": [{"kms_master_key_id": "", "sse_algorithm": "AES256"}], "bucket_key_enabled": None}]}
        sse_after = {"rule": [{"apply_server_side_encryption_by_default": [{"kms_master_key_id": "", "sse_algorithm": "AES256"}], "bucket_key_enabled": False}]}
        upd["resource_drift"] = [
            {"address": "aws_s3_bucket.recovery", "mode": "managed", "type": "aws_s3_bucket", "change": {
                "actions": ["update"], "before": {"policy": "", "versioning": [], "force_destroy": False},
                "after": {"policy": "{\"Version\":\"2012-10-17\"}", "versioning": [{"enabled": True}], "force_destroy": False},
            }},
            {"address": "aws_s3_bucket_server_side_encryption_configuration.recovery", "mode": "managed", "type": "aws_s3_bucket_server_side_encryption_configuration", "change": {
                "actions": ["update"], "before": sse_before, "after": sse_after,
            }},
        ]
        self.assertEqual(vfp.validate_plan_doc(upd, mode="auto"), [])

        # 3. Real/unsafe drift must fail closed
        for bad_label, mutator in [
            ("sse_algorithm", lambda d: d["resource_drift"][1]["change"]["after"]["rule"][0]["apply_server_side_encryption_by_default"][0].update(sse_algorithm="aws:kms")),
            ("force_destroy", lambda d: d["resource_drift"][0]["change"]["after"].update(force_destroy=True)),
            ("delete_drift", lambda d: d["resource_drift"][0]["change"].update(actions=["delete"])),
            ("drift_on_updated_rc", lambda d: next(rc for rc in d["resource_changes"] if rc["address"] == "aws_s3_bucket.recovery")["change"].update(actions=["update"])),
        ]:
            doc = json.loads(json.dumps(upd))
            mutator(doc)
            self.assertTrue(vfp.validate_plan_doc(doc, mode="auto"), msg=f"Expected rejection for {bad_label}")

        init_doc = vfp.make_valid_plan_doc("initial")
        init_doc["resource_drift"] = json.loads(json.dumps(upd["resource_drift"]))
        self.assertTrue(vfp.validate_plan_doc(init_doc, mode="initial"))


if __name__ == "__main__":
    unittest.main()
