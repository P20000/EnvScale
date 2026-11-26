#!/usr/bin/env python3
"""Offline tests for the unified deployment pipeline state machine, callbacks, failure classification, and UI."""

from __future__ import annotations

import json
import pathlib
import sys
import tempfile
import unittest
from unittest import mock

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

from scripts.lib import (  # noqa: E402
    cloud_demo_flow,
    cloud_identity,
    cloud_lifecycle,
    cloud_orchestrator,
)
from scripts.lib.cloud_config_utils import AwsSessionContext  # noqa: E402

ACCOUNT = "982534376726"
REGION = "ap-south-1"
REC_BUCKET = f"envscale-recovery-{ACCOUNT}-{REGION}"
RUNTIME_ROLE = cloud_identity.RUNTIME_PROVISIONER_ROLE_NAME
CALLER_ARN = f"arn:aws:sts::{ACCOUNT}:assumed-role/{RUNTIME_ROLE}/envscale-unified"
RUNTIME_ARN = f"arn:aws:iam::{ACCOUNT}:role/{RUNTIME_ROLE}"


def _make_runtime_session(token: str = "tok-unified") -> AwsSessionContext:
    return AwsSessionContext(
        account_id=ACCOUNT,
        region=REGION,
        caller_arn=CALLER_ARN,
        role_arn=RUNTIME_ARN,
        expires_at_utc="2099-01-01T00:00:00+00:00",
        _creds={"AccessKeyId": "ASIATESTKEYID1234567", "SecretAccessKey": "sec-unified", "SessionToken": token},
    )


class TestUnifiedDeploymentPipeline(unittest.TestCase):
    def test_deploy_environment_state_transitions_and_progress_callbacks(self):
        events = []
        with tempfile.TemporaryDirectory() as td:
            td_p = pathlib.Path(td)
            manifest = td_p / "release-manifest.json"
            manifest.write_text(json.dumps({"release_id": "rel-u-1", "git": {"commit_sha": "a" * 40}}), encoding="utf-8")
            orch = cloud_orchestrator.CloudOrchestrator(
                state_store=cloud_orchestrator.PipelineStateStore(td_p / "state.json"),
                runtime_session=_make_runtime_session(),
                allow_ram_handoff=False,
                progress_fn=events.append,
            )

            def _fake_stage(sid, callbacks=None, **opts):
                if sid == "provision":
                    orch.state_store.update_context(instance_id="i-0u1", public_ip="1.2.3.4")
                    return {"status": "completed", "instance_id": "i-0u1", "ip": "1.2.3.4"}
                if sid == "deploy":
                    orch.state_store.update_context(app_url="https://envscale.duckdns.org")
                    return {"status": "completed", "app_url": "https://envscale.duckdns.org", "instance_id": "i-0u1", "public_ip": "1.2.3.4"}
                if sid == "verify":
                    # SUCCEEDED must NOT be emitted before verify completes
                    self.assertNotIn("SUCCEEDED", [e["phase"] for e in events])
                    return {"status": "completed", "app_url": "https://envscale.duckdns.org"}
                raise AssertionError(f"Unexpected stage {sid}")

            with (
                mock.patch.object(orch, "_require_verified_runtime_env", return_value={"AWS_REGION": REGION}),
                mock.patch.object(cloud_demo_flow.shutil, "which", return_value="/usr/bin/ok"),
                mock.patch.object(cloud_demo_flow, "verify_runtime_instance_profile", return_value={"profile_name": "p"}),
                mock.patch.object(cloud_demo_flow.CloudDeployer, "ensure_s3_vault", return_value=None),
                mock.patch.object(cloud_demo_flow, "verify_ssm_parameters_present", return_value=["duckdns_domain"]),
                mock.patch.object(cloud_demo_flow.CloudDeployer, "get_aws_context", return_value={"recovery_bucket": REC_BUCKET}),
                mock.patch.object(cloud_demo_flow.CloudDeployer, "restore_from_s3", return_value={"status": "unchanged"}),
                mock.patch.object(cloud_demo_flow, "resolve_and_validate_manifest", return_value=manifest),
                mock.patch.object(cloud_demo_flow, "_maybe_start_stopped_host", return_value=None),
                mock.patch.object(orch, "run_stage", side_effect=_fake_stage),
            ):
                res = orch.deploy_environment(manifest_path=str(manifest))

            self.assertEqual(res["status"], "SUCCEEDED")
            self.assertEqual(res["outcome"], "READY")
            self.assertEqual(res["app_url"], "https://envscale.duckdns.org")
            self.assertIsNone(res["failure"])
            phases = [e["phase"] for e in events]
            for expected in ("PREFLIGHT", "PROVISIONING", "DEPLOYING", "VERIFYING", "SUCCEEDED"):
                self.assertIn(expected, phases)
            self.assertEqual(phases[-1], "SUCCEEDED")
            self.assertTrue(all(v == "completed" for v in events[-1]["ui_stages"].values()))

    def test_deploy_environment_blocks_immediately_when_foundation_missing(self):
        events = []
        missing_info = {
            "authenticated": True,
            "account_id": ACCOUNT,
            "region": REGION,
            "roles": {RUNTIME_ROLE: {"exists": False, "error": "NoSuchEntity"}},
            "instance_profile": {"exists": False, "error": "NoSuchEntity"},
        }
        with tempfile.TemporaryDirectory() as td:
            orch = cloud_orchestrator.CloudOrchestrator(
                state_store=cloud_orchestrator.PipelineStateStore(pathlib.Path(td) / "state.json"),
                allow_ram_handoff=False,
                progress_fn=events.append,
            )
            with (
                mock.patch.object(cloud_demo_flow.shutil, "which", return_value="/usr/bin/ok"),
                mock.patch.object(cloud_orchestrator, "inspect_aws_identity", return_value=missing_info),
                mock.patch.object(orch, "run_stage") as m_stage,
            ):
                res = orch.deploy_environment()

            m_stage.assert_not_called()
            self.assertEqual(res["status"], "FOUNDATION_NOT_INITIALIZED")
            self.assertEqual(res["outcome"], "BLOCKED")
            self.assertEqual(res["failure"]["failed_stage"], "prerequisites")
            self.assertIn(RUNTIME_ROLE, res["failure"]["error"])
            self.assertEqual(events[-1]["phase"], "FOUNDATION_NOT_INITIALIZED")
            self.assertGreaterEqual(len(events[-1]["missing_prerequisites"]), 2)

    def test_deploy_environment_auth_failure_returns_structured_failure(self):
        with tempfile.TemporaryDirectory() as td:
            orch = cloud_orchestrator.CloudOrchestrator(
                state_store=cloud_orchestrator.PipelineStateStore(pathlib.Path(td) / "state.json"),
                allow_ram_handoff=False,
            )
            cbs = cloud_orchestrator.OrchestratorCallbacks(on_runtime_mfa_session=lambda: None)
            with mock.patch.object(cloud_demo_flow.shutil, "which", return_value="/usr/bin/ok"):
                res = orch.deploy_environment(callbacks=cbs)

            self.assertEqual(res["status"], "FAILED")
            self.assertEqual(res["outcome"], "FAILED")
            self.assertEqual(res["failure"]["failed_stage"], "auth")
            self.assertFalse(res["failure"]["rollback_attempted"])
            self.assertIn("TOTP", res["failure"]["recovery_action"])

    def test_deploy_environment_records_recovering_rollback_and_verify_failure(self):
        events = []
        with tempfile.TemporaryDirectory() as td:
            td_p = pathlib.Path(td)
            manifest = td_p / "release-manifest.json"
            manifest.write_text(json.dumps({"release_id": "rel-rb", "git": {"commit_sha": "b" * 40}}), encoding="utf-8")
            orch = cloud_orchestrator.CloudOrchestrator(
                state_store=cloud_orchestrator.PipelineStateStore(td_p / "state.json"),
                runtime_session=_make_runtime_session(),
                allow_ram_handoff=False,
                progress_fn=events.append,
            )

            def _failing_deploy(sid, callbacks=None, **opts):
                if sid == "provision":
                    orch.state_store.update_context(instance_id="i-active", public_ip="2.3.4.5")
                    return {"status": "completed", "instance_id": "i-active", "ip": "2.3.4.5"}
                if sid == "deploy":
                    orch.step_fn("stage_deploy", "Deploy", "log", "Triggering automatic rollback on remote host...")
                    raise RuntimeError("Post-deploy verification failed: 502")
                raise AssertionError(sid)

            with (
                mock.patch.object(orch, "_require_verified_runtime_env", return_value={"AWS_REGION": REGION}),
                mock.patch.object(cloud_demo_flow.shutil, "which", return_value="/usr/bin/ok"),
                mock.patch.object(cloud_demo_flow, "verify_runtime_instance_profile", return_value={"profile_name": "p"}),
                mock.patch.object(cloud_demo_flow.CloudDeployer, "ensure_s3_vault", return_value=None),
                mock.patch.object(cloud_demo_flow, "verify_ssm_parameters_present", return_value=["duckdns_domain"]),
                mock.patch.object(cloud_demo_flow.CloudDeployer, "get_aws_context", return_value={"recovery_bucket": REC_BUCKET}),
                mock.patch.object(cloud_demo_flow.CloudDeployer, "restore_from_s3", return_value={"status": "unchanged"}),
                mock.patch.object(cloud_demo_flow, "resolve_and_validate_manifest", return_value=manifest),
                mock.patch.object(cloud_demo_flow, "_maybe_start_stopped_host", return_value=None),
                mock.patch.object(orch, "run_stage", side_effect=_failing_deploy),
            ):
                res = orch.deploy_environment(manifest_path=str(manifest))

            self.assertEqual(res["status"], "FAILED")
            self.assertEqual(res["failure"]["failed_stage"], "deploy")
            self.assertTrue(res["failure"]["rollback_attempted"])
            self.assertTrue(res["failure"]["infrastructure_active"])
            self.assertIn("RECOVERING", [e["phase"] for e in events])

            # Verify stage failure keeps infrastructure_active=True and never marks SUCCEEDED
            events.clear()
            def _failing_verify(sid, callbacks=None, **opts):
                if sid == "provision":
                    return {"status": "completed", "instance_id": "i-active", "ip": "2.3.4.5"}
                if sid == "deploy":
                    return {"status": "completed", "app_url": "https://envscale.duckdns.org", "instance_id": "i-active", "public_ip": "2.3.4.5"}
                raise RuntimeError("TLS handshake failed")

            with (
                mock.patch.object(orch, "_require_verified_runtime_env", return_value={"AWS_REGION": REGION}),
                mock.patch.object(cloud_demo_flow.shutil, "which", return_value="/usr/bin/ok"),
                mock.patch.object(cloud_demo_flow, "verify_runtime_instance_profile", return_value={"profile_name": "p"}),
                mock.patch.object(cloud_demo_flow.CloudDeployer, "ensure_s3_vault", return_value=None),
                mock.patch.object(cloud_demo_flow, "verify_ssm_parameters_present", return_value=["duckdns_domain"]),
                mock.patch.object(cloud_demo_flow.CloudDeployer, "get_aws_context", return_value={"recovery_bucket": REC_BUCKET}),
                mock.patch.object(cloud_demo_flow.CloudDeployer, "restore_from_s3", return_value={"status": "unchanged"}),
                mock.patch.object(cloud_demo_flow, "resolve_and_validate_manifest", return_value=manifest),
                mock.patch.object(cloud_demo_flow, "_maybe_start_stopped_host", return_value=None),
                mock.patch.object(orch, "run_stage", side_effect=_failing_verify),
            ):
                res_v = orch.deploy_environment(manifest_path=str(manifest))
            self.assertEqual(res_v["failure"]["failed_stage"], "verify")
            self.assertTrue(res_v["failure"]["infrastructure_active"])
            self.assertNotIn("SUCCEEDED", [e["phase"] for e in events])

    def test_destroy_environment_and_initialize_foundation_workflows(self):
        events = []
        with tempfile.TemporaryDirectory() as td:
            orch = cloud_orchestrator.CloudOrchestrator(
                state_store=cloud_orchestrator.PipelineStateStore(pathlib.Path(td) / "state.json"),
                runtime_session=_make_runtime_session(),
                allow_ram_handoff=False,
                progress_fn=events.append,
            )
            with (
                mock.patch.object(orch, "_require_verified_runtime_env", return_value={"AWS_REGION": REGION}),
                mock.patch.object(cloud_lifecycle, "verify_destroy_target_environment", return_value={"verified": True, "instance_id": "i-1"}),
                mock.patch.object(cloud_lifecycle.CloudDeployer, "infra_destroy", return_value={"key": "backups/postgres/b1.dump", "sha256": "c" * 64}),
                mock.patch.object(cloud_lifecycle, "verify_destroy_cleanup", return_value={"verified": True, "remaining_resources": 0}),
            ):
                d_res = orch.destroy_environment()
            self.assertEqual(d_res["status"], "SUCCEEDED")
            self.assertEqual(d_res["outcome"], "DESTROYED")
            self.assertEqual(events[-1]["phase"], "SUCCEEDED")

            with (
                mock.patch.object(orch, "_require_verified_runtime_env", return_value={"AWS_REGION": REGION}),
                mock.patch.object(cloud_lifecycle, "verify_destroy_target_environment", side_effect=RuntimeError("VPC mismatch")),
                mock.patch.object(cloud_lifecycle.CloudDeployer, "get_instance_id", return_value="i-1"),
            ):
                d_fail = orch.destroy_environment()
            self.assertEqual(d_fail["status"], "FAILED")
            self.assertEqual(d_fail["failure"]["failed_stage"], "target_validation")
            self.assertTrue(d_fail["failure"]["infrastructure_active"])

            called = []
            def _init_stage(sid, callbacks=None, **opts):
                called.append(sid)
                return {"status": "completed"}

            with mock.patch.object(orch, "run_stage", side_effect=_init_stage):
                f_res = orch.initialize_foundation()
            self.assertEqual(f_res["status"], "SUCCEEDED")
            self.assertEqual(called, ["preflight", "foundation", "secrets"])

    def test_unified_ui_eliminates_competing_deployment_controls(self):
        demo_src = (REPO_ROOT / "scripts/lib/gui_adw/demo_cloud_panel.py").read_text(encoding="utf-8")
        pipe_src = (REPO_ROOT / "scripts/lib/gui_adw/cloud_pipeline_panel.py").read_text(encoding="utf-8")
        ops_src = (REPO_ROOT / "scripts/lib/gui_adw/cloud_ops_panel.py").read_text(encoding="utf-8")
        self.assertIn("Deploy Environment", demo_src)
        self.assertIn("Destroy Environment", demo_src)
        self.assertIn("DEPLOY_UI_STAGES", demo_src)
        self.assertNotIn("_stage_buttons", pipe_src)
        self.assertNotIn("Runtime MFA", pipe_src)
        self.assertIn("Initialize Foundation (One-Time)", pipe_src)
        self.assertNotIn("EC2 Host & IP", ops_src)
        self.assertNotIn("Active Release & History", ops_src)


if __name__ == "__main__":
    unittest.main()

