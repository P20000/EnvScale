"""Offline unit and contract tests for EnvScale's Test Center operational control plane."""

from __future__ import annotations

import importlib.util
import json
import os
import pathlib
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

from click.testing import CliRunner

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))


def _load_script_module(name: str, rel_path: str):
    path = REPO_ROOT / rel_path
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


MANIFEST_GEN = _load_script_module("gen_manifest_cp", "deployment/scripts/generate-release-manifest.py")

from scripts.lib import (  # noqa: E402
    cli_app,
    cloud_deployer,
    cloud_identity,
    cloud_ops_dashboard,
    cloud_orchestrator,
    cloud_preflight,
    cloud_stages,
)

SAMPLE_SHA = "4d17f9371ebc1d601efc9dc83f636340e727cdfa"
API_DIGEST = "sha256:1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f809"
STREAMER_DIGEST = "sha256:9f8e7d6c5b4a392817263544536271809f8e7d6c5b4a39281726354453627180"
WEB_DIGEST = "sha256:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"


class TestCloudIdentityAndRedaction(unittest.TestCase):
    def test_redact_sensitive_text_scrubs_aws_and_app_secrets(self):
        raw = (
            'AKIAIOSFODNN7EXAMPLE ASIA1234567890ABCDEF '
            '{"SecretAccessKey": "topsecret123", "SessionToken": "tok-xyz"} '
            'DUCKDNS_TOKEN="duck-secret-99" POSTGRES_PASSWORD=pgsecretvalue '
            'https://www.duckdns.org/update?domains=envscale&token=abc123def&ip=1.2.3.4'
        )
        scrubbed = cloud_identity.redact_sensitive_text(raw)
        for leaked in ("AKIAIOSFODNN7EXAMPLE", "ASIA1234567890ABCDEF", "topsecret123", "tok-xyz", "duck-secret-99", "pgsecretvalue", "abc123def"):
            self.assertNotIn(leaked, scrubbed)

    def test_inspect_aws_identity_detects_bootstrap_deny_and_mfa(self):
        responses = {
            ("sts", "get-caller-identity"): {"Account": "982534376726", "Arn": "arn:aws:iam::982534376726:user/DEV-user-alpha", "UserId": "AIDATEST"},
            ("iam", "list-attached-user-policies"): {"AttachedPolicies": [{"PolicyName": "envscale-foundation-iam-bootstrap-policy"}, {"PolicyName": "AdministratorAccess"}]},
            ("iam", "list-mfa-devices"): {"MFADevices": []},
            ("iam", "get-instance-profile"): (1, None, "NoSuchEntity"),
        }

        def _fake_json(args, aws_env=None):
            key = (args[0], args[1])
            if key == ("iam", "get-instance-profile"):
                return 1, None, "NoSuchEntity"
            if key == ("iam", "get-role"):
                role = args[3]
                if "foundation" in role:
                    return 0, {"Role": {"Arn": f"arn:aws:iam::982534376726:role/{role}"}}, ""
                return 1, None, "NoSuchEntity"
            return 0, responses[key], ""

        with (
            mock.patch.object(cloud_identity.shutil, "which", return_value="/usr/bin/aws"),
            mock.patch.object(cloud_identity, "_run_aws_json", side_effect=_fake_json),
            mock.patch.object(cloud_identity, "_run_aws_cmd", return_value=subprocess.CompletedProcess([], 0, stdout="ap-south-1\n", stderr="")),
        ):
            info = cloud_identity.inspect_aws_identity()

        self.assertTrue(info["authenticated"])
        self.assertTrue(info["bootstrap_deny_active"])
        self.assertFalse(info["mfa_enrolled"])
        self.assertFalse(info["instance_profile"]["exists"])
        self.assertIn("AdministratorAccess", info["deny_explanation"])

    def test_start_virtual_mfa_cleans_seed_file_even_on_error(self):
        created_dirs = []
        orig_mkdtemp = tempfile.mkdtemp

        def _track_mkdtemp(**kw):
            d = orig_mkdtemp(**kw)
            created_dirs.append(d)
            return d

        with (
            mock.patch.object(cloud_identity.tempfile, "mkdtemp", side_effect=_track_mkdtemp),
            mock.patch.object(cloud_identity, "_run_aws_json", return_value=(1, None, "EntityAlreadyExists")),
        ):
            with self.assertRaises(RuntimeError):
                cloud_identity.start_virtual_mfa_enrollment("DEV-user-alpha", "982534376726")

        self.assertEqual(len(created_dirs), 1)
        self.assertFalse(os.path.exists(created_dirs[0]))

    def test_assume_foundation_admin_role_keeps_creds_in_memory_only(self):
        sts_payload = {
            "AssumedRoleUser": {"Arn": "arn:aws:sts::982534376726:assumed-role/envscale-foundation-admin-role/test"},
            "Credentials": {
                "AccessKeyId": "ASIATESTKEYID1234567",
                "SecretAccessKey": "super-secret-key-xyz",
                "SessionToken": "super-secret-session-token",
                "Expiration": "2099-01-01T00:00:00+00:00",
            },
        }
        with mock.patch.object(cloud_identity, "_run_aws_json", return_value=(0, sts_payload, "")):
            sess = cloud_identity.assume_foundation_admin_role(
                mfa_serial="arn:aws:iam::982534376726:mfa/DEV-user-alpha",
                token_code="123456",
            )

        self.assertNotIn("super-secret-key-xyz", repr(sess))
        self.assertNotIn("super-secret-session-token", json.dumps(sess.to_public_dict()))
        env = sess.build_env({})
        self.assertEqual(env["AWS_ACCESS_KEY_ID"], "ASIATESTKEYID1234567")
        self.assertEqual(env["AWS_SESSION_TOKEN"], "super-secret-session-token")
        self.assertFalse(sess.is_expired())

    def test_totp_mfa_filtering_and_recovery_role_check(self):
        self.assertIn("envscale-github-recovery-role", cloud_identity.FOUNDATION_CHECK_ROLES)
        u2f = "arn:aws:iam::982534376726:u2f/user/DEV-user-alpha/passkey1"
        totp = "arn:aws:iam::982534376726:mfa/envscale-authenticator-app"
        self.assertEqual(cloud_identity.select_totp_mfa_serials([u2f, totp]), [totp])
        self.assertEqual(cloud_identity.select_totp_mfa_serials([u2f]), [])
        with self.assertRaises(ValueError):
            cloud_identity.assume_foundation_admin_role(mfa_serial=u2f, token_code="123456")

        for devices, exp_ok, exp_totp, exp_unsup in (
            ([{"SerialNumber": u2f}, {"SerialNumber": totp}], True, [totp], [u2f]),
            ([{"SerialNumber": u2f}], False, [], [u2f]),
        ):
            def _fake_json(args, aws_env=None, _dev=devices):
                k = (args[0], args[1])
                if k == ("sts", "get-caller-identity"):
                    return 0, {"Account": "982534376726", "Arn": "arn:aws:iam::982534376726:user/DEV-user-alpha"}, ""
                if k == ("iam", "list-mfa-devices"):
                    return 0, {"MFADevices": _dev}, ""
                return (0, {"AttachedPolicies": []}, "") if k[1] == "list-attached-user-policies" else (1, None, "NoSuchEntity")

            with (
                mock.patch.object(cloud_identity.shutil, "which", return_value="/usr/bin/aws"),
                mock.patch.object(cloud_identity, "_run_aws_json", side_effect=_fake_json),
                mock.patch.object(cloud_identity, "_run_aws_cmd", return_value=subprocess.CompletedProcess([], 0, stdout="ap-south-1\n", stderr="")),
            ):
                info = cloud_identity.inspect_aws_identity()
            self.assertEqual((info["mfa_enrolled"], info["mfa_serials"], info["unsupported_mfa_serials"]), (exp_ok, exp_totp, exp_unsup))

    def test_load_ram_admin_session_validates_security_invariants(self):
        payload = {
            "AssumedRoleUser": {"Arn": "arn:aws:sts::982534376726:assumed-role/envscale-foundation-admin-role/test"},
            "Credentials": {
                "AccessKeyId": "ASIATESTKEYID1234567", "SecretAccessKey": "ram-secret-key-xyz",
                "SessionToken": "ram-secret-token-xyz", "Expiration": "2099-01-01T00:00:00+00:00",
            },
        }
        with tempfile.TemporaryDirectory() as tmp:
            p = pathlib.Path(tmp) / "sts.json"
            p.write_text(json.dumps(payload), encoding="utf-8")
            os.chmod(p, 0o600)
            self.assertIsNone(cloud_identity.load_ram_admin_session(p, verify_caller=False, require_ram_dir=True))
            caller_ok = (0, {"Account": "982534376726", "Arn": payload["AssumedRoleUser"]["Arn"]}, "")
            with mock.patch.object(cloud_identity, "_run_aws_json", return_value=caller_ok):
                sess = cloud_identity.load_ram_admin_session(p, verify_caller=True, require_ram_dir=False)
            self.assertIsNotNone(sess)
            self.assertNotIn("ram-secret-key-xyz", repr(sess))
            self.assertNotIn("ram-secret-token-xyz", json.dumps(sess.to_public_dict()))
            os.chmod(p, 0o644)
            self.assertIsNone(cloud_identity.load_ram_admin_session(p, verify_caller=False, require_ram_dir=False))
            os.chmod(p, 0o600)
            sym = pathlib.Path(tmp) / "sts-link.json"
            os.symlink(p, sym)
            self.assertIsNone(cloud_identity.load_ram_admin_session(sym, verify_caller=False, require_ram_dir=False))
            for mutator in (
                lambda d: d["Credentials"].update(Expiration="2020-01-01T00:00:00+00:00"),
                lambda d: d["AssumedRoleUser"].update(Arn="arn:aws:sts::982534376726:assumed-role/other-role/test"),
            ):
                bad = json.loads(json.dumps(payload))
                mutator(bad)
                p.write_text(json.dumps(bad), encoding="utf-8")
                self.assertIsNone(cloud_identity.load_ram_admin_session(p, verify_caller=False, require_ram_dir=False))


class TestCloudPreflightAndStages(unittest.TestCase):
    def test_run_preflight_reports_checks_cleanly(self):
        fake_aws = {
            "authenticated": True,
            "account_id": "982534376726",
            "region": "ap-south-1",
            "arn": "arn:aws:iam::982534376726:user/DEV-user-alpha",
            "bootstrap_deny_active": True,
            "deny_explanation": "Bootstrap policy denies EC2/SSM",
            "mfa_enrolled": False,
            "mfa_serials": [],
            "roles": {"envscale-github-deploy-role": {"exists": False}, "envscale-github-release-role": {"exists": False}},
            "instance_profile": {"exists": False},
        }

        def _fake_cmd(cmd, env=None, cwd=None):
            joined = " ".join(cmd)
            if "terraform version" in joined:
                return subprocess.CompletedProcess(cmd, 0, stdout='{"terraform_version": "1.14.9"}', stderr="")
            if "gh auth status" in joined:
                return subprocess.CompletedProcess(cmd, 0, stdout="ok", stderr="")
            if "gh repo view" in joined:
                return subprocess.CompletedProcess(cmd, 0, stdout='{"nameWithOwner": "P20000/EnvScale"}', stderr="")
            if "gh variable list" in joined or "gh secret list" in joined:
                return subprocess.CompletedProcess(cmd, 0, stdout="[]", stderr="")
            if "head-bucket" in joined:
                return subprocess.CompletedProcess(cmd, 1, stdout="", stderr="404 Not Found")
            if "describe-parameters" in joined:
                return subprocess.CompletedProcess(cmd, 1, stdout="", stderr="AccessDeniedException")
            if "rev-parse --abbrev-ref" in joined:
                return subprocess.CompletedProcess(cmd, 0, stdout="develop\n", stderr="")
            if "rev-parse" in joined:
                return subprocess.CompletedProcess(cmd, 0, stdout=f"{SAMPLE_SHA}\n", stderr="")
            return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")

        with (
            mock.patch.object(cloud_preflight.shutil, "which", return_value="/usr/bin/tool"),
            mock.patch.object(cloud_preflight, "inspect_aws_identity", return_value=fake_aws),
            mock.patch.object(cloud_preflight, "_run_cmd", side_effect=_fake_cmd),
            mock.patch.object(cloud_preflight, "load_deployment_env", return_value={"DUCKDNS_DOMAIN": "envscale", "DUCKDNS_TOKEN": "tok123456"}),
        ):
            report = cloud_preflight.run_preflight()

        self.assertTrue(report["runtime_blocked_by_bootstrap_deny"])
        self.assertFalse(report["foundation_ready"])
        by_id = {c["id"]: c for c in report["checks"]}
        self.assertEqual(by_id["aws_identity"]["status"], "warn")
        self.assertEqual(by_id["ssm_secrets"]["status"], "warn")
        self.assertEqual(by_id["github_auth"]["status"], "pass")

    def test_foundation_stage_skips_when_already_provisioned(self):
        fake_aws = {
            "region": "ap-south-1",
            "instance_profile": {"exists": True},
            "roles": {
                "envscale-github-deploy-role": {"exists": True},
                "envscale-github-release-role": {"exists": True},
                "envscale-github-recovery-role": {"exists": True},
                "envscale-runtime-provisioner-role": {"exists": True},
            },
        }
        with (
            mock.patch.object(cloud_stages, "inspect_aws_identity", return_value=fake_aws),
            mock.patch.object(cloud_stages, "_check_recovery_bucket", return_value={"exists": True}),
        ):
            res = cloud_stages.run_foundation_stage()
        self.assertEqual(res["status"], "completed")
        self.assertTrue(res["already_provisioned"])

        fake_aws["roles"]["envscale-github-recovery-role"]["exists"] = False
        with (
            mock.patch.object(cloud_stages, "inspect_aws_identity", return_value=fake_aws),
            mock.patch.object(cloud_stages, "_check_recovery_bucket", return_value={"exists": True}),
            mock.patch.object(cloud_stages, "_check_gh_env_config", return_value={"configured": False}),
            mock.patch.object(cloud_stages, "_run_cmd", return_value=subprocess.CompletedProcess([], 0, stdout='{"nameWithOwner": "P20000/EnvScale"}', stderr="")),
        ):
            res_missing = cloud_stages.run_foundation_stage()
        self.assertEqual(res_missing["status"], "needs_approval")

    def test_foundation_stage_requires_approval_before_apply(self):
        fake_aws = {
            "region": "ap-south-1",
            "instance_profile": {"exists": False},
            "roles": {
                "envscale-github-deploy-role": {"exists": False},
                "envscale-github-release-role": {"exists": False},
                "envscale-github-foundation-plan-role": {"exists": True, "arn": "arn:aws:iam::982534376726:role/envscale-github-foundation-plan-role"},
                "envscale-github-foundation-role": {"exists": True, "arn": "arn:aws:iam::982534376726:role/envscale-github-foundation-role"},
            },
        }
        dispatched = []

        def _fake_cmd(cmd, env=None, cwd=None):
            joined = " ".join(cmd)
            if "gh workflow run" in joined:
                dispatched.append(joined)
                return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")
            if "gh repo view" in joined:
                return subprocess.CompletedProcess(cmd, 0, stdout='{"nameWithOwner": "P20000/EnvScale"}', stderr="")
            return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")

        with (
            mock.patch.object(cloud_stages, "inspect_aws_identity", return_value=fake_aws),
            mock.patch.object(cloud_stages, "_check_recovery_bucket", return_value={"exists": False}),
            mock.patch.object(cloud_stages, "_check_gh_env_config", return_value={"configured": True}),
            mock.patch.object(cloud_stages, "_run_cmd", side_effect=_fake_cmd),
            mock.patch.object(cloud_stages, "_find_new_workflow_run", return_value={"databaseId": 777}),
            mock.patch.object(cloud_stages, "_poll_workflow_run", return_value={"conclusion": "success", "url": "https://example.invalid/run/777"}),
            mock.patch.object(cloud_stages, "_summarize_tfplan_artifact", return_value={"has_changes": True, "counts": {"create": 4}, "changes": []}),
        ):
            res = cloud_stages.run_foundation_stage(approval_cb=lambda payload: False)

        self.assertEqual(res["status"], "needs_approval")
        self.assertEqual(len(dispatched), 1)
        self.assertIn("plan-only", dispatched[0])

    def test_secrets_stage_requires_mfa_and_cleans_ephemeral_secrets_file(self):
        no_mfa = cloud_stages.run_secrets_stage(admin_session=None)
        self.assertEqual(no_mfa["status"], "needs_mfa")

        sess = cloud_identity.AwsSessionContext(
            account_id="982534376726",
            region="ap-south-1",
            caller_arn="arn:aws:sts::982534376726:assumed-role/envscale-foundation-admin-role/s",
            role_arn="arn:aws:iam::982534376726:role/envscale-foundation-admin-role",
            expires_at_utc="2099-01-01T00:00:00+00:00",
            _creds={"AccessKeyId": "ASIA1234567890ABCDEF", "SecretAccessKey": "sec", "SessionToken": "tok"},
        )
        observed_file = {}
        logs = []

        def _fake_stream(cmd, cwd=None, env=None, on_line=None, **kw):
            sf = pathlib.Path(cmd[cmd.index("--secrets-file") + 1])
            observed_file["path"] = str(sf)
            observed_file["mode"] = stat.S_IMODE(sf.stat().st_mode)
            observed_file["content"] = sf.read_text(encoding="utf-8")
            observed_file["has_sts"] = env.get("AWS_SESSION_TOKEN") == "tok"
            if on_line:
                on_line("DUCKDNS_TOKEN=my-secret-duck-token-999 seeded")
            return 0

        with (
            mock.patch.object(cloud_stages, "_inspect_ssm_parameters", side_effect=[
                {"accessible": True, "names": [], "missing_securestrings": ["/envscale/prod/duckdns_token"], "seeded_count": 0},
                {"accessible": True, "names": ["/envscale/prod/duckdns_token"], "missing_securestrings": [], "seeded_count": 9},
            ]),
            mock.patch.object(cloud_stages, "safe_stream", side_effect=_fake_stream),
        ):
            res = cloud_stages.run_secrets_stage(
                admin_session=sess,
                secrets_input_cb=lambda *_: {"DUCKDNS_TOKEN": "my-secret-duck-token-999", "kubeconfig_key_disposition": "generate-fresh-no-historical-ciphertext"},
                step_fn=lambda sid, t, st, d: logs.append(d),
            )

        self.assertEqual(res["status"], "completed")
        self.assertEqual(observed_file["mode"], 0o600)
        self.assertTrue(observed_file["has_sts"])
        self.assertIn("DUCKDNS_TOKEN=my-secret-duck-token-999", observed_file["content"])
        self.assertFalse(os.path.exists(observed_file["path"]))
        self.assertFalse(any("my-secret-duck-token-999" in line for line in logs))

    def test_release_stage_downloads_and_validates_manifest(self):
        manifest = MANIFEST_GEN.build_release_manifest(
            repository="P20000/EnvScale",
            branch="develop",
            commit_sha=SAMPLE_SHA,
            owner_lc="p20000",
            api_digest=API_DIGEST,
            streamer_digest=STREAMER_DIGEST,
            web_digest=WEB_DIGEST,
            workflow_name="EnvScale CD - Build & Deploy",
            workflow_run_id="44897676930",
            workflow_run_attempt=1,
            builder_identity="P20000/EnvScale/.github/workflows/cd.yml@refs/heads/develop",
        )
        with tempfile.TemporaryDirectory() as fake_root:
            (pathlib.Path(fake_root) / "deployment/scripts").mkdir(parents=True)
            real_val = pathlib.Path(REPO_ROOT) / "deployment/scripts/validate-release-manifest.py"

            def _fake_cmd(cmd, env=None, cwd=None):
                if "gh" in cmd[0] and "download" in cmd:
                    dest_dir = pathlib.Path(cmd[cmd.index("-D") + 1])
                    (dest_dir / "release-manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
                    return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")
                if "validate-release-manifest.py" in cmd[1]:
                    return subprocess.run(
                        ["python3", str(real_val), "--manifest", cmd[3], "--verify-repo-migrations"],
                        capture_output=True, text=True,
                    )
                return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")

            with (
                mock.patch.object(cloud_stages, "PROJECT_ROOT", fake_root),
                mock.patch.object(cloud_stages, "list_cd_releases", return_value=[{"databaseId": 44897676930, "headSha": SAMPLE_SHA}]),
                mock.patch.object(cloud_stages, "_run_cmd", side_effect=_fake_cmd),
            ):
                res = cloud_stages.run_release_stage()

        self.assertEqual(res["status"], "completed")
        self.assertEqual(res["commit_sha"], SAMPLE_SHA)
        self.assertEqual(res["images"]["api_server"]["digest"], API_DIGEST)


class TestCloudOrchestratorAndDashboard(unittest.TestCase):
    def test_state_store_strips_secrets_and_resumes_from_failed_stage(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = cloud_orchestrator.PipelineStateStore(pathlib.Path(tmp) / "state.json")
            store.update_context(target_sha=SAMPLE_SHA, AWS_SESSION_TOKEN="SECRET", DUCKDNS_TOKEN="SECRET")
            loaded = store.load()
            self.assertEqual(loaded["context"]["target_sha"], SAMPLE_SHA)
            self.assertNotIn("AWS_SESSION_TOKEN", loaded["context"])
            self.assertNotIn("DUCKDNS_TOKEN", loaded["context"])

            store.update_stage("preflight", "completed", summary="ok")
            store.update_stage("foundation", "completed", summary="done")
            store.update_stage("secrets", "failed", error="pending mfa")
            self.assertEqual(store.next_incomplete_stage(), "secrets")

            orch = cloud_orchestrator.CloudOrchestrator(state_store=store)
            executed = []

            def _fake_dispatch(stage_id, cb, opts):
                executed.append(stage_id)
                if stage_id == "preflight":
                    return {"status": "completed", "checks": []}
                return {"status": "completed", "summary": "ok", "commit_sha": SAMPLE_SHA, "release_id": "rel-1", "manifest_path": "m.json", "cd_run_id": 1}

            with mock.patch.object(orch, "_dispatch_stage", side_effect=_fake_dispatch):
                out = orch.run_pipeline(resume=True)

            self.assertEqual(out["status"], "completed")
            self.assertNotIn("foundation", executed)
            self.assertEqual(executed[0], "preflight")
            self.assertIn("secrets", executed)

    def test_provision_stage_halts_early_on_bootstrap_deny(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = cloud_orchestrator.PipelineStateStore(pathlib.Path(tmp) / "state.json")
            orch = cloud_orchestrator.CloudOrchestrator(state_store=store)
            with (
                mock.patch.object(cloud_orchestrator, "load_ram_runtime_session", return_value=None),
                mock.patch.object(cloud_orchestrator, "inspect_aws_identity", return_value={"authenticated": True, "bootstrap_deny_active": True, "deny_explanation": "Explicit deny via bootstrap policy"}),
                mock.patch.object(cloud_deployer.CloudDeployer, "provision_host") as mock_prov,
            ):
                with self.assertRaises(RuntimeError) as ctx:
                    orch.run_stage("provision")
                self.assertIn("bootstrap policy", str(ctx.exception))
                mock_prov.assert_not_called()

    def test_ops_snapshot_parses_probe_and_rejects_invalid_log_service(self):
        probe_out = "\n".join([
            "===CONTAINERS===",
            "envscale-web|running|Up 5 minutes (healthy)|ghcr.io/p20000/envscale-web@sha256:abc",
            "===LAST_GOOD===",
            json.dumps({"release_id": "rel-20261121T111100Z-4d17f937", "git": {"commit_sha": SAMPLE_SHA}, "compatibility": {"latest_migration_tag": "0003_init"}}),
            "===HISTORY===",
            json.dumps({"status": "DEPLOYED_HEALTHY", "release_id": "rel-20261121T111100Z-4d17f937"}),
        ])
        ec2_json = json.dumps({"Reservations": [{"Instances": [{"State": {"Name": "running"}, "PublicIpAddress": "1.2.3.4", "InstanceType": "t3a.large"}]}]})
        ssm_json = json.dumps({"InstanceInformationList": [{"PingStatus": "Online", "AgentVersion": "3.3.0"}]})

        def _fake_aws(args, aws_env=None):
            if args[0] == "ec2":
                return subprocess.CompletedProcess(args, 0, stdout=ec2_json, stderr="")
            if args[0] == "ssm":
                return subprocess.CompletedProcess(args, 0, stdout=ssm_json, stderr="")
            return subprocess.CompletedProcess(args, 1, stdout="", stderr="AccessDenied")

        with (
            mock.patch.object(cloud_ops_dashboard.CloudDeployer, "get_instance_id", return_value="i-012345"),
            mock.patch.object(cloud_ops_dashboard.CloudDeployer, "get_public_ip", return_value="1.2.3.4"),
            mock.patch.object(cloud_ops_dashboard.CloudDeployer, "get_aws_context", return_value={"account_id": "982534376726", "region": "ap-south-1", "s3_bucket": "b"}),
            mock.patch.object(cloud_ops_dashboard, "_aws_cmd", side_effect=_fake_aws),
            mock.patch.object(cloud_ops_dashboard, "run_ssm_command", return_value=subprocess.CompletedProcess([], 0, stdout=probe_out, stderr="")),
            mock.patch.object(cloud_ops_dashboard, "verify_deployment_health", return_value=(True, [])),
            mock.patch.object(cloud_ops_dashboard, "load_deployment_env", return_value={"DUCKDNS_DOMAIN": "envscale", "DUCKDNS_TOKEN": "tok"}),
        ):
            snap = cloud_ops_dashboard.fetch_ops_snapshot()

        self.assertEqual(snap["ec2"]["state"], "running")
        self.assertEqual(snap["ssm"]["ping_status"], "Online")
        self.assertEqual(len(snap["containers"]), 1)
        self.assertEqual(snap["active_release"]["commit_sha"], SAMPLE_SHA)
        self.assertTrue(snap["health"]["ok"])
        self.assertIn("AccessDenied", snap["backups"]["error"])

        with self.assertRaises(ValueError):
            cloud_ops_dashboard.fetch_remote_logs(service="bad;rm -rf")

    def test_cli_ops_help_and_status_smoke(self):
        runner = CliRunner()
        res_help = runner.invoke(cli_app.cli, ["ops", "--help"])
        self.assertEqual(res_help.exit_code, 0)
        self.assertIn("deploy-flow", res_help.output)
        res_status = runner.invoke(cli_app.cli, ["ops", "status"])
        self.assertEqual(res_status.exit_code, 0)
        self.assertIn("Preflight & Identity", res_status.output)


if __name__ == "__main__":
    unittest.main()
