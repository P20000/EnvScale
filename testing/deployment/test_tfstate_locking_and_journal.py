#!/usr/bin/env python3
"""Regression tests for Terraform state locking ownership, stale lock recovery, journal durability, and workspace/backend guards."""

from __future__ import annotations

import json
import os
import pathlib
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

from scripts.lib import (  # noqa: E402
    cloud_deployer,
    cloud_host_runner,
    cloud_orchestrator,
    tfstate_journal,
    tfstate_lock,
    tfstate_reconciler,
    tfstate_sync,
)
from scripts.lib.cloud_config_utils import AwsSessionContext  # noqa: E402

ACCOUNT = "982534376726"
REGION = "ap-south-1"
BUCKET = f"envscale-tfstate-{ACCOUNT}-{REGION}"
KEY = "runtime/terraform.tfstate"


def _make_state(serial: int, lineage: str = "lin-1", resources=None) -> bytes:
    return json.dumps({
        "version": 4, "terraform_version": "1.14.9", "serial": serial,
        "lineage": lineage, "outputs": {}, "resources": resources or [],
    }).encode("utf-8")


class _MockLockS3:
    def __init__(self):
        self.lock_bytes: bytes | None = None
        self.delete_calls = 0

    def run(self, cmd, **_kw):
        sub = cmd[:3]
        if sub == ["aws", "s3api", "put-object"]:
            if "--if-none-match" in cmd and self.lock_bytes is not None:
                return subprocess.CompletedProcess(cmd, 254, stdout="", stderr="PreconditionFailed (412)")
            self.lock_bytes = pathlib.Path(cmd[cmd.index("--body") + 1]).read_bytes()
            return subprocess.CompletedProcess(cmd, 0, stdout=json.dumps({"VersionId": "lv1", "ETag": '"le1"'}), stderr="")
        if sub == ["aws", "s3api", "get-object"]:
            if self.lock_bytes is None:
                return subprocess.CompletedProcess(cmd, 254, stdout="", stderr="NoSuchKey (404)")
            pathlib.Path(cmd[-3]).write_bytes(self.lock_bytes)
            return subprocess.CompletedProcess(cmd, 0, stdout=json.dumps({"VersionId": "lv1", "ETag": '"le1"'}), stderr="")
        if sub == ["aws", "s3api", "delete-object"]:
            self.delete_calls += 1
            self.lock_bytes = None
            return subprocess.CompletedProcess(cmd, 0, stdout="{}", stderr="")
        if sub == ["aws", "s3api", "head-object"]:
            return subprocess.CompletedProcess(cmd, 254, stdout="", stderr="404 Not Found")
        return subprocess.CompletedProcess(cmd, 1, stdout="", stderr=f"unexpected {cmd}")


class TestTfStateLockingAndJournal(unittest.TestCase):
    def test_18_concurrent_deploy_and_destroy_blocked_by_lock(self):
        with tempfile.TemporaryDirectory() as td:
            td_p = pathlib.Path(td)
            local_p = td_p / "terraform.tfstate"
            jpath = td_p / "journal.json"
            s1 = _make_state(1, "lin-a")
            local_p.write_bytes(s1)
            s3 = _MockLockS3()

            def _apply_holding_concurrent_destroy(cmd):
                with self.assertRaises(tfstate_reconciler.ConcurrentStateOperationError):
                    tfstate_reconciler.run_managed_terraform_mutation(
                        operation_type="destroy", tf_commands=[["terraform", "destroy"]],
                        cwd=td_p, local_path=local_p, account_id=ACCOUNT, region=REGION,
                        run_fn=s3.run, journal_path=jpath, use_remote_lock=True,
                    )
                raise RuntimeError("stop after concurrency check")

            with self.assertRaises(RuntimeError):
                tfstate_reconciler.run_managed_terraform_mutation(
                    operation_type="apply", tf_commands=[["terraform", "apply"]],
                    cwd=td_p, local_path=local_p, account_id=ACCOUNT, region=REGION,
                    exec_tf_fn=_apply_holding_concurrent_destroy, run_fn=s3.run, journal_path=jpath,
                    use_remote_lock=True,
                )

    def test_19_concurrent_cli_and_test_center_race_blocked(self):
        with tempfile.TemporaryDirectory() as td:
            td_p = pathlib.Path(td)
            local_p = td_p / "terraform.tfstate"
            jpath = td_p / "journal.json"
            local_p.write_bytes(_make_state(2, "lin-a"))
            s3 = _MockLockS3()

            role = "envscale-runtime-provisioner-role"
            sess = AwsSessionContext(
                account_id=ACCOUNT, region=REGION, caller_arn=f"arn:aws:sts::{ACCOUNT}:assumed-role/{role}/tc",
                role_arn=f"arn:aws:iam::{ACCOUNT}:role/{role}", expires_at_utc="2099-01-01T00:00:00+00:00",
                _creds={"AccessKeyId": "ASIA", "SecretAccessKey": "sec", "SessionToken": "tok"},
            )
            orch = cloud_orchestrator.CloudOrchestrator(
                state_store=cloud_orchestrator.PipelineStateStore(td_p / "pipe.json"),
                runtime_session=sess, allow_ram_handoff=False,
            )
            deployer = cloud_deployer.CloudDeployer(log_fn=lambda _: None, aws_env={"AWS_REGION": REGION})

            with tfstate_lock.TfStateOperationLock(
                local_path=local_p, bucket=BUCKET, state_key=KEY, region=REGION,
                run_fn=s3.run, use_remote_lock=True, operation_id="cli-destroy-1", operation_type="destroy",
            ):
                with (
                    mock.patch.object(cloud_deployer, "TERRAFORM_DIR", str(td_p)),
                    mock.patch.object(orch, "_require_verified_runtime_env", return_value={"AWS_REGION": REGION}),
                    mock.patch.object(cloud_deployer.CloudDeployer, "ensure_s3_vault"),
                    mock.patch("scripts.lib.cloud_demo_flow.verify_runtime_instance_profile", return_value={"profile_name": "p"}),
                    mock.patch("scripts.lib.cloud_demo_flow.verify_ssm_parameters_present", return_value=["duckdns_domain"]),
                    mock.patch("scripts.lib.cloud_demo_flow.shutil.which", return_value="/usr/bin/ok"),
                    mock.patch("scripts.lib.cloud_demo_flow.CloudDeployer.get_aws_context", return_value={"account_id": ACCOUNT, "region": REGION, "recovery_bucket": "b"}),
                    mock.patch("scripts.lib.cloud_demo_flow.resolve_and_validate_manifest", return_value=td_p / "m.json"),
                ):
                    (td_p / "m.json").write_text('{"release_id":"r1","git":{"commit_sha":"' + ("a" * 40) + '"}}', encoding="utf-8")
                    # Reconcile/restore called during Test Center deploy hits held local/S3 lock -> BLOCKED
                    with mock.patch("scripts.lib.cloud_deployer.reconcile_terraform_state", side_effect=lambda **kw: tfstate_reconciler.reconcile_terraform_state(
                        local_path=local_p, account_id=ACCOUNT, region=REGION, run_fn=s3.run, journal_path=jpath, use_remote_lock=True,
                    )):
                        res = orch.deploy_environment(manifest_path=str(td_p / "m.json"))
                self.assertEqual(res["outcome"], "BLOCKED")
                self.assertIn("Concurrent", res["failure"]["error"])
                # CLI lock still intact
                self.assertIsNotNone(s3.lock_bytes)
                self.assertEqual(json.loads(s3.lock_bytes.decode("utf-8"))["operation_id"], "cli-destroy-1")
                self.assertEqual(deployer.get_instance_id(), "")

    def test_20_and_21_lock_ownership_verification_and_explicit_stale_lock_recovery(self):
        with tempfile.TemporaryDirectory() as td:
            local_p = pathlib.Path(td) / "terraform.tfstate"
            s3 = _MockLockS3()

            # 20: If another process steals/replaces remote lock_id, __exit__ MUST NOT delete it!
            lock = tfstate_lock.TfStateOperationLock(
                local_path=local_p, bucket=BUCKET, state_key=KEY, region=REGION,
                run_fn=s3.run, use_remote_lock=True, operation_id="op-owner-1", operation_type="apply",
            )
            with lock:
                holder_doc = json.loads(s3.lock_bytes.decode("utf-8"))
                self.assertEqual(holder_doc["operation_id"], "op-owner-1")
                self.assertEqual(holder_doc["lock_id"], lock.lock_id)
                # Another holder replaces the S3 .tflock
                s3.lock_bytes = json.dumps({"lock_id": "foreign-lock-999", "operation_id": "op-other"}).encode("utf-8")
            self.assertEqual(s3.delete_calls, 0)
            self.assertIn("foreign-lock-999", lock.release_warning)

            # 21: Normal lock acquisition never auto-force-unlocks stale remote lock
            with self.assertRaises(tfstate_lock.ConcurrentStateOperationError) as ctx:
                with tfstate_lock.TfStateOperationLock(
                    local_path=local_p, bucket=BUCKET, state_key=KEY, region=REGION,
                    run_fn=s3.run, use_remote_lock=True, operation_id="op-new",
                ):
                    pass
            self.assertIn("foreign-lock-999", str(ctx.exception))
            self.assertEqual(s3.delete_calls, 0)

            insp = tfstate_lock.inspect_remote_lock(bucket=BUCKET, state_key=KEY, region=REGION, run_fn=s3.run)
            self.assertTrue(insp["locked"])
            self.assertEqual(insp["holder"]["lock_id"], "foreign-lock-999")

            # Wrong lock_id or empty reason fails closed
            with self.assertRaises(ValueError):
                tfstate_lock.force_release_stale_lock(
                    bucket=BUCKET, state_key=KEY, region=REGION, expected_lock_id="foreign-lock-999", reason="  ", run_fn=s3.run
                )
            with self.assertRaises(tfstate_lock.ConcurrentStateOperationError):
                tfstate_lock.force_release_stale_lock(
                    bucket=BUCKET, state_key=KEY, region=REGION, expected_lock_id="wrong-id", reason="stale", run_fn=s3.run
                )
            self.assertIsNotNone(s3.lock_bytes)

            # Matching lock_id + explicit reason unlocks cleanly
            rel = tfstate_lock.force_release_stale_lock(
                bucket=BUCKET, state_key=KEY, region=REGION, expected_lock_id="foreign-lock-999",
                reason="Confirmed process crash after reboot", run_fn=s3.run,
            )
            self.assertEqual(rel["status"], "unlocked")
            self.assertEqual(s3.delete_calls, 1)
            self.assertIsNone(s3.lock_bytes)

    def test_22_and_23_corrupted_journal_fails_closed_and_interrupted_write_preserves_prior_state(self):
        with tempfile.TemporaryDirectory() as td:
            td_p = pathlib.Path(td)
            local_p = td_p / "terraform.tfstate"
            jpath = td_p / "journal.json"
            s1 = _make_state(1, "lin-a")
            local_p.write_bytes(s1)

            # 22: Malformed JSON / wrong root type / missing operation_id MUST fail closed (never appear empty)
            sidecar_jpath = local_p.with_name(".envscale_tfstate_operations.json")
            for bad in ("{corrupt json", "[]", json.dumps({"active_operation": {"operation_type": "apply"}})):
                jpath.write_text(bad, encoding="utf-8")
                sidecar_jpath.write_text(bad, encoding="utf-8")
                j = tfstate_journal.TfStateJournal(jpath)
                with self.assertRaises(tfstate_journal.CorruptedStateJournalError):
                    j.load()
                with self.assertRaises(tfstate_journal.CorruptedStateJournalError):
                    cloud_host_runner.assert_runtime_state_ready_for_host_ops(str(local_p), journal_path=str(jpath))
                with self.assertRaises(tfstate_journal.CorruptedStateJournalError):
                    tfstate_sync.verify_tfstate_consistency_with_s3(
                        local_path=local_p, account_id=ACCOUNT, region=REGION, run_fn=_MockLockS3().run
                    )
                with self.assertRaises(tfstate_journal.CorruptedStateJournalError):
                    tfstate_reconciler.inspect_state_status(
                        local_path=local_p, account_id=ACCOUNT, region=REGION, journal_path=jpath, run_fn=_MockLockS3().run
                    )

            # 23: Simulate write interruption during save(): old valid committed journal preserved at 0600, no orphan tmp
            jpath.unlink()
            j = tfstate_journal.TfStateJournal(jpath)
            op = j.start_operation(
                operation_type="apply", workspace="default", backend_bucket=BUCKET, backend_key=KEY,
                account_id=ACCOUNT, region=REGION, prev_local=None, prev_remote_meta=None,
            )
            mode = stat.S_IMODE(os.stat(jpath).st_mode)
            self.assertEqual(mode, 0o600)
            baseline_bytes = jpath.read_bytes()

            with mock.patch.object(pathlib.Path, "replace", side_effect=OSError("simulated disk power loss")):
                with self.assertRaises(OSError):
                    j.mark_sync_pending(op["operation_id"], "interrupted write")

            self.assertEqual(jpath.read_bytes(), baseline_bytes)
            self.assertEqual(list(td_p.glob(".*.tmp")), [])

    def test_24_workspace_and_backend_mismatch_blocked(self):
        with tempfile.TemporaryDirectory() as td:
            td_p = pathlib.Path(td)
            local_p = td_p / "terraform.tfstate"
            jpath = td_p / "journal.json"
            local_p.write_bytes(_make_state(1, "lin-a"))
            s3 = _MockLockS3()

            # Explicit non-default workspace rejected
            with self.assertRaises(tfstate_reconciler.StateDivergenceError):
                tfstate_reconciler.inspect_state_status(
                    local_path=local_p, account_id=ACCOUNT, region=REGION, workspace="staging", run_fn=s3.run, journal_path=jpath
                )

            # Foundation key rejected from runtime/EKS manager
            with self.assertRaises(tfstate_reconciler.StateDivergenceError):
                tfstate_reconciler.run_managed_terraform_mutation(
                    operation_type="apply", tf_commands=[["terraform", "apply"]], cwd=td_p, local_path=local_p,
                    account_id=ACCOUNT, region=REGION, state_key="foundation/terraform.tfstate",
                    run_fn=s3.run, journal_path=jpath,
                )

            # On-disk .terraform/environment != default rejected
            tf_meta_dir = td_p / ".terraform"
            tf_meta_dir.mkdir()
            (tf_meta_dir / "environment").write_text("staging\n", encoding="utf-8")
            with self.assertRaises(tfstate_reconciler.StateDivergenceError):
                cloud_host_runner.assert_runtime_state_ready_for_host_ops(str(local_p), journal_path=str(jpath))
            with self.assertRaises(tfstate_reconciler.StateDivergenceError):
                tfstate_reconciler.inspect_state_status(
                    local_path=local_p, account_id=ACCOUNT, region=REGION, run_fn=s3.run, journal_path=jpath
                )


if __name__ == "__main__":
    unittest.main()
