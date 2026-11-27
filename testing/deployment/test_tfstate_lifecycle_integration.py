#!/usr/bin/env python3
"""Lifecycle integration tests, bypass detection, EKS isolation, CLI contracts, and Test Center UI status."""

from __future__ import annotations

import json
import pathlib
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

from click.testing import CliRunner

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

from scripts.lib import (  # noqa: E402
    cli_app,
    cloud_demo_flow,
    cloud_deployer,
    cloud_host_runner,
    cloud_identity,
    cloud_lifecycle,
    cloud_orchestrator,
    cloud_target_sync,
    eks_deployer,
    tfstate_journal,
    tfstate_reconciler,
)
from scripts.lib.cloud_config_utils import AwsSessionContext  # noqa: E402

ACCOUNT = "982534376726"
REGION = "ap-south-1"
BUCKET = f"envscale-tfstate-{ACCOUNT}-{REGION}"
KEY = "runtime/terraform.tfstate"


def _make_runtime_session() -> AwsSessionContext:
    role = cloud_identity.RUNTIME_PROVISIONER_ROLE_NAME
    return AwsSessionContext(
        account_id=ACCOUNT,
        region=REGION,
        caller_arn=f"arn:aws:sts::{ACCOUNT}:assumed-role/{role}/test",
        role_arn=f"arn:aws:iam::{ACCOUNT}:role/{role}",
        expires_at_utc="2099-01-01T00:00:00+00:00",
        _creds={"AccessKeyId": "ASIATEST", "SecretAccessKey": "sec", "SessionToken": "tok"},
    )


class TestTfStateLifecycleIntegration(unittest.TestCase):
    def test_26_static_audit_and_manual_mutation_bypass_detection(self):
        scripts_dir = REPO_ROOT / "scripts" / "lib"
        offenders = []
        for py_file in sorted(scripts_dir.rglob("*.py")):
            if py_file.name.startswith("tfstate_"):
                continue
            text = py_file.read_text(encoding="utf-8")
            for idx, line in enumerate(text.splitlines(), start=1):
                stripped = line.strip()
                if stripped.startswith("#"):
                    continue
                if ('"apply"' in stripped or '"destroy"' in stripped) and '"terraform"' in stripped:
                    if py_file.name not in ("cloud_deployer.py", "eks_deployer.py"):
                        offenders.append(f"{py_file.name}:{idx}: {stripped}")
        self.assertEqual(offenders, [], f"Direct terraform mutations found outside centralized manager: {offenders}")

        deployer_src = (scripts_dir / "cloud_deployer.py").read_text(encoding="utf-8")
        eks_src = (scripts_dir / "eks_deployer.py").read_text(encoding="utf-8")
        self.assertIn("run_managed_terraform_mutation", deployer_src)
        self.assertIn("run_managed_terraform_mutation", eks_src)
        self.assertNotIn('self._run_cmd(["terraform", "apply"', deployer_src)
        self.assertNotIn('self._run_cmd(["terraform", "destroy"', deployer_src)

        # Runtime check: manual un-journaled local mutation (local serial 9 > S3 serial 5) blocks destroy target validation
        with tempfile.TemporaryDirectory() as td:
            td_p = pathlib.Path(td)
            tf_p = td_p / "terraform.tfstate"
            tf_p.write_text(json.dumps({"version": 4, "serial": 9, "lineage": "lin-man", "resources": []}), encoding="utf-8")
            rem = json.dumps({"version": 4, "serial": 5, "lineage": "lin-man", "resources": []}).encode("utf-8")

            def _s3_run(cmd, **_kw):
                if cmd[:3] == ["aws", "s3api", "head-object"]:
                    return subprocess.CompletedProcess(cmd, 0, stdout=json.dumps({"VersionId": "v1", "ETag": '"e1"', "ContentLength": len(rem)}), stderr="")
                if cmd[:3] == ["aws", "s3api", "get-object"]:
                    pathlib.Path(cmd[-3]).write_bytes(rem)
                    return subprocess.CompletedProcess(cmd, 0, stdout=json.dumps({"VersionId": "v1", "ETag": '"e1"'}), stderr="")
                if cmd[:3] == ["aws", "s3", "cp"]:
                    pathlib.Path(cmd[4]).write_bytes(rem)
                    return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")
                return subprocess.CompletedProcess(cmd, 1, stdout="", stderr="unexpected")

            deployer = mock.MagicMock()
            deployer.get_instance_id.return_value = ""
            with self.assertRaises(tfstate_reconciler.StateDivergenceError):
                cloud_demo_flow.verify_destroy_target_environment(
                    deployer, aws_env={"AWS_REGION": REGION}, account_id=ACCOUNT, region=REGION,
                    tf_state_path=str(tf_p), run_fn=_s3_run,
                )

    def test_27_eks_uses_independent_state_key_and_journal_path(self):
        self.assertNotEqual(tfstate_journal.DEFAULT_EKS_JOURNAL_PATH, tfstate_journal.DEFAULT_JOURNAL_PATH)
        eks_state_p = pathlib.Path(eks_deployer.TERRAFORM_EKS_DIR) / "terraform.tfstate"
        self.assertEqual(tfstate_journal.resolve_journal_path(eks_state_p), tfstate_journal.DEFAULT_EKS_JOURNAL_PATH)

        seen_calls = []
        ed = eks_deployer.EKSDeployer(log_fn=lambda _: None)
        with (
            mock.patch.object(eks_deployer.shutil, "which", return_value="/usr/bin/ok"),
            mock.patch.object(eks_deployer, "safe_run", return_value=subprocess.CompletedProcess(["aws"], 0, stdout=json.dumps({"Account": ACCOUNT}), stderr="")),
            mock.patch.object(eks_deployer, "_stream_cmd" if hasattr(eks_deployer, "_stream_cmd") else "safe_stream", return_value=0, create=True),
            mock.patch.object(eks_deployer, "run_managed_terraform_mutation", side_effect=lambda **kw: seen_calls.append(kw) or {"status": "completed"}),
        ):
            ed.eks_up()
            ed.eks_destroy()
        self.assertEqual([c["state_key"] for c in seen_calls], ["eks/terraform.tfstate", "eks/terraform.tfstate"])
        self.assertEqual([c["operation_type"] for c in seen_calls], ["eks_apply", "eks_destroy"])

    def test_pending_sync_blocks_deploy_destroy_power_verify_restore_and_reconstruct(self):
        with tempfile.TemporaryDirectory() as td:
            td_p = pathlib.Path(td)
            state_p = td_p / "terraform.tfstate"
            jpath = state_p.with_name(".envscale_tfstate_operations.json")
            state_p.write_text('{"version":4,"serial":9,"lineage":"lin-p","resources":[]}', encoding="utf-8")

            j = tfstate_journal.TfStateJournal(jpath)
            op = j.start_operation(
                operation_type="destroy", workspace="default", backend_bucket=BUCKET, backend_key=KEY,
                account_id=ACCOUNT, region=REGION, prev_local=None, prev_remote_meta=None,
            )
            j.record_terraform_result(
                op["operation_id"], exit_code=0,
                result_local=tfstate_reconciler.parse_and_validate_tfstate(state_p),
                sync_status="STATE_SYNC_PENDING", error="S3 offline during destroy",
            )

            # Host ops, infra_stop, infra_start, verify, restore, reconstruct all blocked before AWS calls
            with self.assertRaises(RuntimeError) as ctx_h:
                cloud_host_runner.assert_runtime_state_ready_for_host_ops(str(state_p), journal_path=str(jpath))
            self.assertIn("STATE_SYNC_PENDING", str(ctx_h.exception))

            deployer = cloud_deployer.CloudDeployer(log_fn=lambda _: None, aws_env={"AWS_REGION": REGION})
            with mock.patch.object(cloud_deployer, "TERRAFORM_DIR", str(td_p)):
                for fn in (deployer.infra_stop, deployer.infra_start):
                    with self.assertRaises(RuntimeError) as ctx_p:
                        fn()
                    self.assertIn("STATE_SYNC_PENDING", str(ctx_p.exception))

            manifest = td_p / "release-manifest.json"
            manifest.write_text('{"release_id":"rel-1","git":{"commit_sha":"' + ("a" * 40) + '"}}', encoding="utf-8")
            events = []
            orch = cloud_orchestrator.CloudOrchestrator(
                state_store=cloud_orchestrator.PipelineStateStore(td_p / "pipe.json"),
                runtime_session=_make_runtime_session(), allow_ram_handoff=False, progress_fn=events.append,
            )
            with mock.patch.object(cloud_host_runner, "TERRAFORM_DIR", str(td_p)):
                with self.assertRaises(RuntimeError) as ctx_v:
                    orch.run_stage("verify")
                self.assertIn("STATE_SYNC_PENDING", str(ctx_v.exception))

            with (
                mock.patch.object(orch, "_require_verified_runtime_env", return_value={"AWS_REGION": REGION}),
                mock.patch.object(cloud_demo_flow.shutil, "which", return_value="/usr/bin/ok"),
                mock.patch.object(cloud_demo_flow, "verify_runtime_instance_profile", return_value={"profile_name": "p"}),
                mock.patch.object(cloud_demo_flow.CloudDeployer, "ensure_s3_vault", return_value=None),
                mock.patch.object(cloud_demo_flow, "verify_ssm_parameters_present", return_value=["duckdns_domain"]),
                mock.patch.object(cloud_demo_flow.CloudDeployer, "get_aws_context", return_value={"account_id": ACCOUNT, "region": REGION, "recovery_bucket": "b"}),
                mock.patch.object(cloud_demo_flow, "resolve_and_validate_manifest", return_value=manifest),
                mock.patch.object(cloud_demo_flow.CloudDeployer, "restore_from_s3", side_effect=tfstate_reconciler.StateSyncPendingError("S3 still offline")),
                mock.patch.object(orch, "run_stage") as m_stage,
            ):
                res = orch.deploy_environment(manifest_path=str(manifest))
            m_stage.assert_not_called()
            self.assertEqual((res["status"], res["outcome"], events[-1]["phase"]), ("STATE_SYNC_PENDING", "BLOCKED", "STATE_SYNC_PENDING"))

            events.clear()
            with (
                mock.patch.object(orch, "_require_verified_runtime_env", return_value={"AWS_REGION": REGION}),
                mock.patch.object(cloud_lifecycle, "verify_destroy_target_environment", side_effect=tfstate_reconciler.StateSyncPendingError("STATE_SYNC_PENDING")),
            ):
                dres = orch.destroy_environment()
            self.assertEqual((dres["status"], dres["outcome"], events[-1]["phase"]), ("STATE_SYNC_PENDING", "BLOCKED", "STATE_SYNC_PENDING"))
            self.assertNotEqual(dres["outcome"], "DESTROYED")

    def test_cli_tfstate_and_infra_reconcile_help_contracts(self):
        runner = CliRunner()
        for cmd_args in (
            ["ops", "tfstate", "--help"], ["ops", "tfstate", "status", "--help"],
            ["ops", "tfstate", "sync", "--help"], ["ops", "tfstate", "reconcile", "--help"],
            ["ops", "tfstate", "unlock", "--help"], ["infra", "reconcile", "--help"],
        ):
            r = runner.invoke(cli_app.cli, cmd_args)
            self.assertEqual(r.exit_code, 0, f"Help failed for {cmd_args}: {r.output}")

    def test_demo_cloud_panel_and_ui_status_vocabulary(self):
        expected_labels = {
            "Synchronized",
            "Synchronization pending",
            "Reconciliation required",
            "Remote state ahead",
            "Local state ahead",
            "State conflict",
            "Recovery in progress",
        }
        self.assertEqual(set(cloud_target_sync.STATE_SYNC_UI_LABELS.values()), expected_labels)

        demo_src = (REPO_ROOT / "scripts" / "lib" / "gui_adw" / "demo_cloud_panel.py").read_text(encoding="utf-8")
        panel_src = (REPO_ROOT / "scripts" / "lib" / "gui_adw" / "tfstate_panel.py").read_text(encoding="utf-8")
        view_src = (REPO_ROOT / "scripts" / "lib" / "gui_adw" / "view_cloud.py").read_text(encoding="utf-8")
        self.assertIn('"STATE_SYNC_PENDING": ("STATE SYNC PENDING", "warning")', demo_src)
        self.assertIn('if sync_code != "STATE_SYNCHRONIZED":', demo_src)
        self.assertIn("CorruptedStateJournalError", demo_src)
        self.assertIn("State: {sync_label}", demo_src)
        self.assertIn("Inspect & Resolve State", demo_src)
        self.assertNotIn("reconcile", demo_src.lower())

        for req in (
            "class TfStateSyncPanel", "Inspect State", "Resume Pending Sync", "Adopt Remote State",
            "Promote Local State", "Unlock Stale Lock", "Adw.MessageDialog", "use_remote_lock=True",
            "self.btn_adopt.set_sensitive(cls in (REMOTE_AHEAD, LOCAL_MISSING))",
            "self.btn_promote.set_sensitive(cls in (LOCAL_AHEAD, REMOTE_MISSING))",
        ):
            self.assertIn(req, panel_src)
        self.assertIn("TfStateSyncPanel", view_src)
        self.assertIn("_open_tfstate_recovery", view_src)

    def test_infer_state_sync_status_and_tfstate_stage_logging(self):
        self.assertEqual(
            cloud_target_sync.infer_state_sync_status_from_error(
                tfstate_reconciler.StateDivergenceError(
                    "Local state (serial=330) is ahead of remote s3://b/runtime/terraform.tfstate (serial=320) without operation journal proof."
                )
            ),
            "LOCAL_AHEAD",
        )
        self.assertEqual(
            cloud_target_sync.infer_state_sync_status_from_error(
                tfstate_reconciler.StateDivergenceError(
                    "Remote state s3://b/runtime/terraform.tfstate (serial=10) is ahead of local (serial=4)."
                )
            ),
            "REMOTE_AHEAD",
        )
        self.assertEqual(
            cloud_target_sync.infer_state_sync_status_from_error(
                tfstate_reconciler.StateDivergenceError("conflict", classification="SAME_SERIAL_DIFFERENT_CONTENT")
            ),
            "SAME_SERIAL_DIFFERENT_CONTENT",
        )
        self.assertEqual(
            cloud_target_sync.infer_state_sync_status_from_error(
                tfstate_reconciler.CorruptedStateJournalError("bad json")
            ),
            "JOURNAL_CORRUPTED",
        )

        # Verify execute_deploy_environment logs stage_tfstate_sync start/error and records LOCAL_AHEAD (never REMOTE_AHEAD)
        with tempfile.TemporaryDirectory() as td:
            td_p = pathlib.Path(td)
            manifest = td_p / "release-manifest.json"
            manifest.write_text('{"release_id":"rel-1","git":{"commit_sha":"' + ("a" * 40) + '"}}', encoding="utf-8")
            step_events = []
            orch = cloud_orchestrator.CloudOrchestrator(
                state_store=cloud_orchestrator.PipelineStateStore(td_p / "pipe.json"),
                runtime_session=_make_runtime_session(), allow_ram_handoff=False,
                step_fn=lambda sid, title, st, det="": step_events.append((sid, st, det)),
            )
            local_ahead_err = tfstate_reconciler.StateDivergenceError(
                "Local state (serial=330) is ahead of remote s3://envscale-tfstate-982534376726-ap-south-1/runtime/terraform.tfstate (serial=320).",
                classification=tfstate_reconciler.LOCAL_AHEAD,
            )
            with (
                mock.patch.object(orch, "_require_verified_runtime_env", return_value={"AWS_REGION": REGION}),
                mock.patch.object(cloud_demo_flow.shutil, "which", return_value="/usr/bin/ok"),
                mock.patch.object(cloud_demo_flow, "verify_runtime_instance_profile", return_value={"profile_name": "p"}),
                mock.patch.object(cloud_demo_flow.CloudDeployer, "ensure_s3_vault", return_value=None),
                mock.patch.object(cloud_demo_flow, "verify_ssm_parameters_present", return_value=["duckdns_domain"]),
                mock.patch.object(cloud_demo_flow.CloudDeployer, "get_aws_context", return_value={"account_id": ACCOUNT, "region": REGION, "recovery_bucket": "b"}),
                mock.patch.object(cloud_demo_flow, "resolve_and_validate_manifest", return_value=manifest),
                mock.patch.object(cloud_demo_flow.CloudDeployer, "restore_from_s3", side_effect=local_ahead_err),
            ):
                res = orch.deploy_environment(manifest_path=str(manifest))
            self.assertEqual((res["status"], res["outcome"]), ("FAILED", "BLOCKED"))
            self.assertEqual(res["state"]["context"]["state_sync_status"], "LOCAL_AHEAD")
            tf_steps = [(st, det) for sid, st, det in step_events if sid == "stage_tfstate_sync"]
            self.assertEqual(tf_steps[0][0], "start")
            self.assertEqual(tf_steps[-1][0], "error")
            self.assertIn("serial=330", tf_steps[-1][1])


if __name__ == "__main__":
    unittest.main()
