#!/usr/bin/env python3
"""Offline regression tests for demo simplification, single STS session ownership, and destroy safeguards."""

from __future__ import annotations

import base64
import hashlib
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
    cloud_identity,
    cloud_lifecycle,
    cloud_ops_dashboard,
    cloud_orchestrator,
)
from scripts.lib.cloud_config_utils import AwsSessionContext  # noqa: E402

ACCOUNT = "982534376726"
REGION = "ap-south-1"
REC_BUCKET = f"envscale-recovery-{ACCOUNT}-{REGION}"
RUNTIME_ROLE = cloud_identity.RUNTIME_PROVISIONER_ROLE_NAME
CALLER_ARN = f"arn:aws:sts::{ACCOUNT}:assumed-role/{RUNTIME_ROLE}/envscale-demo"
RUNTIME_ARN = f"arn:aws:iam::{ACCOUNT}:role/{RUNTIME_ROLE}"


def _make_runtime_session(expires_at_utc: str = "2099-01-01T00:00:00+00:00", token: str = "tok-demo") -> AwsSessionContext:
    return AwsSessionContext(
        account_id=ACCOUNT,
        region=REGION,
        caller_arn=CALLER_ARN,
        role_arn=RUNTIME_ARN,
        expires_at_utc=expires_at_utc,
        _creds={"AccessKeyId": "ASIATESTKEYID1234567", "SecretAccessKey": "sec-demo", "SessionToken": token},
    )


class TestDemoSimplification(unittest.TestCase):
    def test_single_sts_session_ownership_without_ram_handoff_or_disk_persistence(self):
        sess = _make_runtime_session(token="ram-free-tok")
        mfa_calls = []

        def _on_mfa():
            mfa_calls.append(1)
            return sess

        live_ok = (0, {"Account": ACCOUNT, "Arn": CALLER_ARN}, "")
        with tempfile.TemporaryDirectory() as td:
            store = cloud_orchestrator.PipelineStateStore(pathlib.Path(td) / "state.json")
            orch = cloud_orchestrator.CloudOrchestrator(state_store=store, allow_ram_handoff=False)
            cbs = cloud_orchestrator.OrchestratorCallbacks(on_runtime_mfa_session=_on_mfa)
            with (
                mock.patch.object(cloud_orchestrator, "load_ram_runtime_session") as m_ram,
                mock.patch.object(cloud_identity, "_run_aws_json", return_value=live_ok),
                mock.patch.object(cloud_orchestrator, "inspect_aws_identity", return_value={"authenticated": True, "bootstrap_deny_active": False}),
            ):
                env1 = orch._require_verified_runtime_env(cbs)
                env2 = orch._require_verified_runtime_env(cbs)

            m_ram.assert_not_called()
            self.assertEqual(len(mfa_calls), 1)
            self.assertEqual(env1["AWS_SESSION_TOKEN"], "ram-free-tok")
            self.assertEqual(env2["AWS_SESSION_TOKEN"], "ram-free-tok")
            raw_state = (pathlib.Path(td) / "state.json").read_text(encoding="utf-8") if (pathlib.Path(td) / "state.json").exists() else ""
            self.assertNotIn("ram-free-tok", raw_state)
            self.assertNotIn("sec-demo", raw_state)

    def test_expired_sts_session_requires_reauth_and_never_extends_silently(self):
        expired = _make_runtime_session(expires_at_utc="2020-01-01T00:00:00+00:00", token="old-tok")
        fresh = _make_runtime_session(expires_at_utc="2099-01-01T00:00:00+00:00", token="new-tok")
        with tempfile.TemporaryDirectory() as td:
            orch = cloud_orchestrator.CloudOrchestrator(
                state_store=cloud_orchestrator.PipelineStateStore(pathlib.Path(td) / "state.json"),
                runtime_session=expired,
                allow_ram_handoff=False,
            )
            with self.assertRaises(RuntimeError) as ctx:
                orch._require_verified_runtime_env(cloud_orchestrator.OrchestratorCallbacks())
            self.assertIn("expired", str(ctx.exception).lower())

            live_ok = (0, {"Account": ACCOUNT, "Arn": CALLER_ARN}, "")
            with (
                mock.patch.object(cloud_identity, "_run_aws_json", return_value=live_ok),
                mock.patch.object(cloud_orchestrator, "inspect_aws_identity", return_value={"authenticated": True, "bootstrap_deny_active": False}),
            ):
                env = orch._require_verified_runtime_env(cloud_orchestrator.OrchestratorCallbacks(on_runtime_mfa_session=lambda: fresh))
            self.assertEqual(env["AWS_SESSION_TOKEN"], "new-tok")

    def test_deploy_demo_runs_preflight_provision_deploy_verify_without_admin_mfa(self):
        sess = _make_runtime_session()
        called_stages = []
        with tempfile.TemporaryDirectory() as td:
            td_p = pathlib.Path(td)
            manifest = td_p / "release-manifest.json"
            manifest.write_text(json.dumps({"release_id": "rel-demo-1", "git": {"commit_sha": "a" * 40}}), encoding="utf-8")
            orch = cloud_orchestrator.CloudOrchestrator(
                state_store=cloud_orchestrator.PipelineStateStore(td_p / "state.json"),
                runtime_session=sess,
                allow_ram_handoff=False,
            )

            def _fake_run_stage(stage_id, callbacks=None, **opts):
                called_stages.append(stage_id)
                if stage_id == "provision":
                    orch.state_store.update_context(instance_id="i-0demo", public_ip="1.2.3.4")
                    return {"status": "completed", "instance_id": "i-0demo", "ip": "1.2.3.4"}
                if stage_id == "deploy":
                    orch.state_store.update_context(app_url="https://envscale.duckdns.org")
                    return {"status": "completed", "app_url": "https://envscale.duckdns.org", "instance_id": "i-0demo", "public_ip": "1.2.3.4"}
                if stage_id == "verify":
                    return {"status": "completed", "app_url": "https://envscale.duckdns.org"}
                raise AssertionError(f"Unexpected stage {stage_id}")

            with (
                mock.patch.object(orch, "_require_verified_runtime_env", return_value={"AWS_REGION": REGION}),
                mock.patch.object(cloud_demo_flow.shutil, "which", return_value="/usr/bin/ok"),
                mock.patch.object(cloud_demo_flow, "verify_runtime_instance_profile", return_value={"profile_name": "p"}),
                mock.patch.object(cloud_demo_flow.CloudDeployer, "ensure_s3_vault", return_value=None),
                mock.patch.object(cloud_demo_flow, "verify_ssm_parameters_present", return_value=["duckdns_domain"]),
                mock.patch.object(cloud_demo_flow.CloudDeployer, "get_aws_context", return_value={"recovery_bucket": REC_BUCKET}),
                mock.patch.object(cloud_demo_flow, "resolve_and_validate_manifest", return_value=manifest),
                mock.patch.object(cloud_demo_flow, "_maybe_start_stopped_host", return_value=None),
                mock.patch.object(orch, "run_stage", side_effect=_fake_run_stage),
            ):
                res = orch.deploy_demo(manifest_path=str(manifest))

            self.assertEqual(res["status"], "completed")
            self.assertEqual(res["app_url"], "https://envscale.duckdns.org")
            self.assertEqual(called_stages, ["provision", "deploy", "verify"])

    def test_deploy_demo_starts_stopped_host_and_fails_fast_when_foundation_missing(self):
        sess = _make_runtime_session()
        with tempfile.TemporaryDirectory() as td:
            td_p = pathlib.Path(td)
            manifest = td_p / "release-manifest.json"
            manifest.write_text(json.dumps({"release_id": "rel-demo-2", "git": {"commit_sha": "b" * 40}}), encoding="utf-8")
            orch = cloud_orchestrator.CloudOrchestrator(
                state_store=cloud_orchestrator.PipelineStateStore(td_p / "state.json"),
                runtime_session=sess,
                allow_ram_handoff=False,
            )

            with (
                mock.patch.object(orch, "_require_verified_runtime_env", return_value={"AWS_REGION": REGION}),
                mock.patch.object(cloud_demo_flow.shutil, "which", return_value="/usr/bin/ok"),
                mock.patch.object(cloud_demo_flow, "verify_runtime_instance_profile", side_effect=RuntimeError("missing profile")),
            ):
                with self.assertRaises(RuntimeError) as ctx:
                    orch.deploy_demo(manifest_path=str(manifest))
                self.assertIn("Advanced Operations", str(ctx.exception))

            called = []
            def _fake_stage(sid, callbacks=None, **opts):
                called.append(sid)
                return {"status": "completed", "app_url": "https://envscale.duckdns.org", "instance_id": "i-stopped", "public_ip": "5.6.7.8"}

            with (
                mock.patch.object(orch, "_require_verified_runtime_env", return_value={"AWS_REGION": REGION}),
                mock.patch.object(cloud_demo_flow.shutil, "which", return_value="/usr/bin/ok"),
                mock.patch.object(cloud_demo_flow, "verify_runtime_instance_profile", return_value={"profile_name": "p"}),
                mock.patch.object(cloud_demo_flow.CloudDeployer, "ensure_s3_vault", return_value=None),
                mock.patch.object(cloud_demo_flow, "verify_ssm_parameters_present", return_value=["duckdns_domain"]),
                mock.patch.object(cloud_demo_flow.CloudDeployer, "get_aws_context", return_value={"recovery_bucket": REC_BUCKET}),
                mock.patch.object(cloud_demo_flow, "resolve_and_validate_manifest", return_value=manifest),
                mock.patch.object(cloud_demo_flow, "_maybe_start_stopped_host", return_value={"instance_id": "i-stopped", "ip": "5.6.7.8", "resumed": True}),
                mock.patch.object(orch, "run_stage", side_effect=_fake_stage),
            ):
                res = orch.deploy_demo(manifest_path=str(manifest))
            self.assertTrue(res["resumed"])
            self.assertEqual(called, ["deploy", "verify"])

    def test_destroy_target_and_cleanup_verification_fail_closed(self):
        with tempfile.TemporaryDirectory() as td:
            tf_path = pathlib.Path(td) / "terraform.tfstate"
            tf_path.write_text(
                json.dumps({
                    "version": 4, "serial": 5, "lineage": "lin-1",
                    "resources": [
                        {"type": "aws_vpc", "instances": [{"attributes": {"id": "vpc-111"}}]},
                        {"type": "aws_instance", "instances": [{"attributes": {"id": "i-111"}}]},
                    ],
                }),
                encoding="utf-8",
            )
            deployer = mock.MagicMock()
            deployer.get_instance_id.return_value = "i-111"

            # Wrong account blocked
            with self.assertRaises(RuntimeError):
                cloud_demo_flow.verify_destroy_target_environment(
                    deployer, aws_env={"AWS_REGION": REGION}, account_id="111122223333", tf_state_path=str(tf_path)
                )

            # Wrong tags blocked
            bad_tags = {"Reservations": [{"Instances": [{"VpcId": "vpc-111", "Tags": [{"Key": "Project", "Value": "Other"}]}]}]}
            with (
                mock.patch.object(cloud_demo_flow, "safe_restore_tfstate_from_s3", return_value={"status": "unchanged"}),
                self.assertRaises(RuntimeError) as ctx_tag,
            ):
                cloud_demo_flow.verify_destroy_target_environment(
                    deployer,
                    aws_env={"AWS_REGION": REGION},
                    tf_state_path=str(tf_path),
                    run_fn=lambda *a, **kw: subprocess.CompletedProcess(a[0], 0, stdout=json.dumps(bad_tags), stderr=""),
                )
            self.assertIn("DisposableRuntime", str(ctx_tag.exception))

            # VPC mismatch blocked
            bad_vpc = {
                "Reservations": [{"Instances": [{"VpcId": "vpc-wrong", "Tags": [{"Key": "Project", "Value": "EnvScale"}, {"Key": "Layer", "Value": "DisposableRuntime"}]}]}]
            }
            with (
                mock.patch.object(cloud_demo_flow, "safe_restore_tfstate_from_s3", return_value={"status": "unchanged"}),
                self.assertRaises(RuntimeError) as ctx_vpc,
            ):
                cloud_demo_flow.verify_destroy_target_environment(
                    deployer,
                    aws_env={"AWS_REGION": REGION},
                    tf_state_path=str(tf_path),
                    run_fn=lambda *a, **kw: subprocess.CompletedProcess(a[0], 0, stdout=json.dumps(bad_vpc), stderr=""),
                )
            self.assertIn("VPC", str(ctx_vpc.exception))

            # Post-destroy: non-zero resources blocked
            with self.assertRaises(RuntimeError) as ctx_res:
                cloud_demo_flow.verify_destroy_cleanup("i-111", aws_env={"AWS_REGION": REGION}, tf_state_path=str(tf_path))
            self.assertIn("active resource", str(ctx_res.exception))

            # Post-destroy: still running instance blocked
            tf_path.write_text(json.dumps({"version": 4, "serial": 6, "lineage": "lin-1", "resources": []}), encoding="utf-8")
            still_running = {"Reservations": [{"Instances": [{"State": {"Name": "running"}}]}]}
            with self.assertRaises(RuntimeError) as ctx_run:
                cloud_demo_flow.verify_destroy_cleanup(
                    "i-111",
                    aws_env={"AWS_REGION": REGION},
                    tf_state_path=str(tf_path),
                    run_fn=lambda *a, **kw: subprocess.CompletedProcess(a[0], 0, stdout=json.dumps(still_running), stderr=""),
                )
            self.assertIn("running", str(ctx_run.exception))

            # Post-destroy: 0 resources + terminated passes
            terminated = {"Reservations": [{"Instances": [{"State": {"Name": "terminated"}}]}]}
            cln = cloud_demo_flow.verify_destroy_cleanup(
                "i-111",
                aws_env={"AWS_REGION": REGION},
                tf_state_path=str(tf_path),
                run_fn=lambda *a, **kw: subprocess.CompletedProcess(a[0], 0, stdout=json.dumps(terminated), stderr=""),
            )
            self.assertTrue(cln["verified"])
            self.assertEqual(cln["instance_state"], "terminated")

    def test_run_destroy_lifecycle_enforces_target_and_cleanup_around_infra_destroy(self):
        order = []
        with tempfile.TemporaryDirectory() as td:
            orch = cloud_orchestrator.CloudOrchestrator(
                state_store=cloud_orchestrator.PipelineStateStore(pathlib.Path(td) / "state.json"),
                runtime_session=_make_runtime_session(),
                allow_ram_handoff=False,
            )
            with (
                mock.patch.object(orch, "_require_verified_runtime_env", return_value={"AWS_REGION": REGION}),
                mock.patch.object(cloud_lifecycle, "verify_destroy_target_environment", side_effect=lambda *a, **kw: (order.append("target"), {"verified": True, "instance_id": "i-111"})[1]),
                mock.patch.object(cloud_lifecycle.CloudDeployer, "infra_destroy", side_effect=lambda: (order.append("destroy"), {"bucket": REC_BUCKET, "key": "backups/postgres/b.dump", "sha256": "a" * 64})[1]),
                mock.patch.object(cloud_lifecycle, "verify_destroy_cleanup", side_effect=lambda *a, **kw: (order.append("cleanup"), {"verified": True, "remaining_resources": 0})[1]),
            ):
                res = orch.destroy_runtime()
            self.assertEqual(order, ["target", "destroy", "cleanup"])
            self.assertEqual(res["status"], "completed")

    def test_manual_remote_backup_rejects_missing_native_checksum(self):
        raw_sha = hashlib.sha256(b"dump").hexdigest()
        no_chk = {"ContentLength": 128, "Metadata": {"sha256": raw_sha}}

        def _fake_aws(args, aws_env=None):
            if "get-bucket-location" in args:
                return subprocess.CompletedProcess(args, 0, stdout='{"LocationConstraint":"ap-south-1"}', stderr="")
            return subprocess.CompletedProcess(args, 0, stdout=json.dumps(no_chk), stderr="")

        def _fake_ssm(instance_id, cmds, **kw):
            s3_line = next(c for c in cmds if "ENVSCALE_BACKUP_RESULT=" in c)
            key = next(t for t in s3_line.split() if "backups/postgres/" in t).strip("'\"")
            out = f'ENVSCALE_BACKUP_RESULT={{"bucket":"{REC_BUCKET}","key":"{key}","size":128,"sha256":"{raw_sha}","toc_entries":2}}'
            return subprocess.CompletedProcess([], 0, stdout=out, stderr="")

        with (
            mock.patch.object(cloud_ops_dashboard.CloudDeployer, "get_instance_id", return_value="i-0123"),
            mock.patch.object(cloud_ops_dashboard.CloudDeployer, "get_aws_context", return_value={"account_id": ACCOUNT, "region": REGION}),
            mock.patch.object(cloud_ops_dashboard, "_aws_cmd", side_effect=_fake_aws),
            mock.patch.object(cloud_ops_dashboard, "run_ssm_command", side_effect=_fake_ssm),
            mock.patch.object(cloud_ops_dashboard, "load_deployment_env", return_value={}),
        ):
            with self.assertRaises(RuntimeError) as ctx:
                cloud_ops_dashboard.trigger_remote_backup()
            self.assertIn("ChecksumSHA256", str(ctx.exception))

    def test_gui_and_cli_demo_contracts(self):
        view_src = (REPO_ROOT / "scripts/lib/gui_adw/view_cloud.py").read_text(encoding="utf-8")
        pipe_src = (REPO_ROOT / "scripts/lib/gui_adw/cloud_pipeline_panel.py").read_text(encoding="utf-8")
        self.assertIn("DemoCloudPanel", view_src)
        self.assertIn("Advanced Operations & Administration", view_src)
        self.assertIn("set_expanded(False)", view_src)
        self.assertIn("Adw.MessageDialog", view_src)
        self.assertIn("orchestrator.destroy_runtime", view_src)
        self.assertIn("orchestrator.restore_database", view_src)
        self.assertIn("orchestrator.reconstruct_runtime", view_src)
        self.assertIn("allow_ram_handoff=False", pipe_src)
        self.assertNotIn("load_ram_admin_session", pipe_src)
        self.assertNotIn("load_ram_runtime_session", pipe_src)

        res = CliRunner().invoke(cli_app.cli, ["ops", "demo-deploy", "--help"])
        self.assertEqual(res.exit_code, 0, msg=res.output)


if __name__ == "__main__":
    unittest.main()
