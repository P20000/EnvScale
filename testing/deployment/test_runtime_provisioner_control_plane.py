"""Offline tests for Runtime Provisioner MFA AssumeRole, orchestrator role separation, and recovery bucket cleanup."""

from __future__ import annotations

import json
import os
import pathlib
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

from scripts.lib import (  # noqa: E402
    cloud_config_utils,
    cloud_deployer,
    cloud_identity,
    cloud_ops_dashboard,
    cloud_orchestrator,
    cloud_preflight,
    cloud_stages,
)

ACCOUNT = "982534376726"
REGION = "ap-south-1"
CANONICAL_BUCKET = f"envscale-recovery-{ACCOUNT}-{REGION}"
RUNTIME_ROLE = cloud_identity.RUNTIME_PROVISIONER_ROLE_NAME
ADMIN_ROLE = cloud_identity.ADMIN_ROLE_NAME
TOTP_SERIAL = f"arn:aws:iam::{ACCOUNT}:mfa/DEV-user-alpha-totp"
U2F_SERIAL = f"arn:aws:iam::{ACCOUNT}:u2f/user/DEV-user-alpha/passkey1"
SMS_SERIAL = f"arn:aws:iam::{ACCOUNT}:sms-mfa/DEV-user-alpha"


def _make_session(
    role_name: str = RUNTIME_ROLE,
    *,
    account_id: str = ACCOUNT,
    region: str = REGION,
    expires_at_utc: str = "2099-01-01T00:00:00+00:00",
    token: str = "sts-token-secret",
) -> cloud_identity.AwsSessionContext:
    return cloud_identity.AwsSessionContext(
        account_id=account_id,
        region=region,
        caller_arn=f"arn:aws:sts::{account_id}:assumed-role/{role_name}/envscale-test",
        role_arn=f"arn:aws:iam::{account_id}:role/{role_name}",
        expires_at_utc=expires_at_utc,
        _creds={
            "AccessKeyId": "ASIATESTKEYID1234567",
            "SecretAccessKey": "sts-secret-key-xyz",
            "SessionToken": token,
        },
    )


def _sts_assume_payload(
    role_name: str = RUNTIME_ROLE,
    *,
    account_id: str = ACCOUNT,
    expiration: str = "2099-01-01T00:00:00+00:00",
) -> dict:
    return {
        "AssumedRoleUser": {"Arn": f"arn:aws:sts::{account_id}:assumed-role/{role_name}/envscale-test"},
        "Credentials": {
            "AccessKeyId": "ASIATESTKEYID1234567",
            "SecretAccessKey": "sts-secret-key-xyz",
            "SessionToken": "sts-session-token-xyz",
            "Expiration": expiration,
        },
    }


class TestRuntimeProvisionerAssumeRole(unittest.TestCase):
    def test_assume_runtime_provisioner_role_enforces_totp_1h_and_live_caller_check(self):
        assume_doc = _sts_assume_payload(RUNTIME_ROLE)
        live_caller = {"Account": ACCOUNT, "Arn": assume_doc["AssumedRoleUser"]["Arn"]}
        seen_cmds = []

        def _fake_aws_json(args, aws_env=None):
            seen_cmds.append((list(args), aws_env))
            if args[:2] == ["sts", "assume-role"]:
                return 0, assume_doc, ""
            if args[:2] == ["sts", "get-caller-identity"]:
                return 0, live_caller, ""
            return 1, None, "unexpected"

        with mock.patch.object(cloud_identity, "_run_aws_json", side_effect=_fake_aws_json):
            sess = cloud_identity.assume_runtime_provisioner_role(
                mfa_serial=TOTP_SERIAL,
                token_code="654321",
                duration_seconds=3600,
            )

        self.assertEqual(sess.role_arn, f"arn:aws:iam::{ACCOUNT}:role/{RUNTIME_ROLE}")
        self.assertIn(f":assumed-role/{RUNTIME_ROLE}/", sess.caller_arn)
        self.assertFalse(sess.is_expired())
        self.assertNotIn("sts-secret-key-xyz", repr(sess))
        self.assertNotIn("sts-session-token-xyz", json.dumps(sess.to_public_dict()))
        self.assertEqual(len(seen_cmds), 2)
        self.assertEqual(seen_cmds[0][0][:2], ["sts", "assume-role"])
        self.assertIn("--duration-seconds", seen_cmds[0][0])
        self.assertEqual(seen_cmds[0][0][seen_cmds[0][0].index("--duration-seconds") + 1], "3600")
        self.assertEqual(seen_cmds[1][0][:2], ["sts", "get-caller-identity"])
        self.assertEqual(seen_cmds[1][1]["AWS_SESSION_TOKEN"], "sts-session-token-xyz")

    def test_rejects_fido2_u2f_sms_invalid_codes_and_invalid_duration(self):
        for bad_serial in ("", U2F_SERIAL, SMS_SERIAL):
            with self.assertRaises(ValueError):
                cloud_identity.assume_runtime_provisioner_role(mfa_serial=bad_serial, token_code="123456")

        for bad_code in ("", "12345", "1234567", "abcdef"):
            with self.assertRaises(ValueError):
                cloud_identity.assume_runtime_provisioner_role(mfa_serial=TOTP_SERIAL, token_code=bad_code)

        for bad_dur in (899, 3601, 7200):
            with self.assertRaises(ValueError):
                cloud_identity.assume_runtime_provisioner_role(
                    mfa_serial=TOTP_SERIAL, token_code="123456", duration_seconds=bad_dur
                )

    def test_rejects_wrong_account_region_and_mismatched_sts_caller(self):
        with self.assertRaises(ValueError):
            cloud_identity.assume_runtime_provisioner_role(
                mfa_serial=TOTP_SERIAL, token_code="123456", account_id="111122223333"
            )
        with self.assertRaises(ValueError):
            cloud_identity.assume_runtime_provisioner_role(
                mfa_serial=TOTP_SERIAL, token_code="123456", region="us-east-1"
            )

        wrong_role_payload = _sts_assume_payload(ADMIN_ROLE)
        with mock.patch.object(cloud_identity, "_run_aws_json", return_value=(0, wrong_role_payload, "")):
            with self.assertRaises(RuntimeError):
                cloud_identity.assume_runtime_provisioner_role(mfa_serial=TOTP_SERIAL, token_code="123456")

        good_payload = _sts_assume_payload(RUNTIME_ROLE)
        with mock.patch.object(
            cloud_identity,
            "_run_aws_json",
            side_effect=[
                (0, good_payload, ""),
                (0, {"Account": "111122223333", "Arn": good_payload["AssumedRoleUser"]["Arn"]}, ""),
            ],
        ):
            with self.assertRaises(RuntimeError):
                cloud_identity.assume_runtime_provisioner_role(mfa_serial=TOTP_SERIAL, token_code="123456")

    def test_load_ram_runtime_session_enforces_ram_perms_expiry_and_role_isolation(self):
        runtime_doc = _sts_assume_payload(RUNTIME_ROLE)
        admin_doc = _sts_assume_payload(ADMIN_ROLE)
        with tempfile.TemporaryDirectory() as tmp:
            p = pathlib.Path(tmp) / "runtime-sts.json"
            p.write_text(json.dumps(runtime_doc), encoding="utf-8")
            os.chmod(p, 0o600)

            self.assertIsNone(cloud_identity.load_ram_runtime_session(p, verify_caller=False, require_ram_dir=True))

            caller_ok = (0, {"Account": ACCOUNT, "Arn": runtime_doc["AssumedRoleUser"]["Arn"]}, "")
            with mock.patch.object(cloud_identity, "_run_aws_json", return_value=caller_ok):
                sess = cloud_identity.load_ram_runtime_session(p, verify_caller=True, require_ram_dir=False)
            self.assertIsNotNone(sess)
            self.assertEqual(sess.role_arn, f"arn:aws:iam::{ACCOUNT}:role/{RUNTIME_ROLE}")

            # Admin RAM loader MUST reject a runtime provisioner file and vice versa.
            self.assertIsNone(cloud_identity.load_ram_admin_session(p, verify_caller=False, require_ram_dir=False))
            p_admin = pathlib.Path(tmp) / "admin-sts.json"
            p_admin.write_text(json.dumps(admin_doc), encoding="utf-8")
            os.chmod(p_admin, 0o600)
            self.assertIsNone(cloud_identity.load_ram_runtime_session(p_admin, verify_caller=False, require_ram_dir=False))

            # Permissions, symlink, expiry, wrong account/region, live verify failure all rejected.
            os.chmod(p, 0o644)
            self.assertIsNone(cloud_identity.load_ram_runtime_session(p, verify_caller=False, require_ram_dir=False))
            os.chmod(p, 0o600)
            sym = pathlib.Path(tmp) / "link.json"
            os.symlink(p, sym)
            self.assertIsNone(cloud_identity.load_ram_runtime_session(sym, verify_caller=False, require_ram_dir=False))
            self.assertIsNone(
                cloud_identity.load_ram_runtime_session(p, account_id="111122223333", verify_caller=False, require_ram_dir=False)
            )
            self.assertIsNone(
                cloud_identity.load_ram_runtime_session(p, region="us-east-1", verify_caller=False, require_ram_dir=False)
            )
            with mock.patch.object(cloud_identity, "_run_aws_json", return_value=(1, None, "ExpiredToken")):
                self.assertIsNone(cloud_identity.load_ram_runtime_session(p, verify_caller=True, require_ram_dir=False))
            expired_doc = _sts_assume_payload(RUNTIME_ROLE, expiration="2020-01-01T00:00:00+00:00")
            p.write_text(json.dumps(expired_doc), encoding="utf-8")
            self.assertIsNone(cloud_identity.load_ram_runtime_session(p, verify_caller=False, require_ram_dir=False))


class TestOrchestratorRuntimeRoleEnforcement(unittest.TestCase):
    def _make_orch(self, tmp: str, *, admin_session=None, runtime_session=None):
        store = cloud_orchestrator.PipelineStateStore(pathlib.Path(tmp) / "state.json")
        return cloud_orchestrator.CloudOrchestrator(
            state_store=store,
            admin_session=admin_session,
            runtime_session=runtime_session,
        )

    def test_runtime_stages_succeed_with_verified_runtime_provisioner_session(self):
        runtime_sess = _make_session(RUNTIME_ROLE, token="runtime-only-tok")
        live_ok = (0, {"Account": ACCOUNT, "Arn": runtime_sess.caller_arn}, "")
        seen_envs = []

        def _fake_provision(self_dep, **kw):
            seen_envs.append(("provision", self_dep._aws_env))
            return {"instance_id": "i-0123456789abcdef0", "ip": "1.2.3.4"}

        def _fake_deploy(self_dep, **kw):
            seen_envs.append(("deploy", self_dep._aws_env))
            return {"release_id": "rel-1", "commit_sha": "a" * 40, "manifest_path": "m.json"}

        def _fake_snapshot(aws_env=None, **kw):
            seen_envs.append(("verify", aws_env))
            return {
                "ec2": {"state": "running"},
                "ssm": {"ping_status": "Online"},
                "health": {"ok": True, "target_url": "https://envscale.duckdns.org"},
            }

        with tempfile.TemporaryDirectory() as tmp:
            orch = self._make_orch(tmp, runtime_session=runtime_sess)
            orch.state_store.update_context(manifest_path="deployment/release-manifest.json", target_sha="a" * 40)
            with (
                mock.patch.object(cloud_identity, "_run_aws_json", return_value=live_ok),
                mock.patch.object(cloud_orchestrator, "inspect_aws_identity", return_value={"authenticated": True, "bootstrap_deny_active": False}),
                mock.patch.object(cloud_deployer.CloudDeployer, "provision_host", _fake_provision),
                mock.patch.object(cloud_deployer.CloudDeployer, "deploy", _fake_deploy),
                mock.patch.object(cloud_deployer.CloudDeployer, "get_public_ip", return_value="1.2.3.4"),
                mock.patch.object(cloud_deployer.CloudDeployer, "get_instance_id", return_value="i-0123456789abcdef0"),
                mock.patch.object(cloud_orchestrator, "fetch_ops_snapshot", side_effect=_fake_snapshot),
                mock.patch.object(cloud_orchestrator, "load_deployment_env", return_value={"DUCKDNS_DOMAIN": "envscale", "DUCKDNS_TOKEN": "tok"}),
            ):
                p_res = orch.run_stage("provision")
                d_res = orch.run_stage("deploy")
                v_res = orch.run_stage("verify")

        self.assertEqual(p_res["status"], "completed")
        self.assertEqual(d_res["status"], "completed")
        self.assertEqual(v_res["status"], "completed")
        self.assertEqual(len(seen_envs), 3)
        for _, env in seen_envs:
            self.assertEqual(env["AWS_SESSION_TOKEN"], "runtime-only-tok")
            self.assertEqual(env["AWS_REGION"], REGION)

    def test_foundation_admin_session_cannot_substitute_for_runtime_provisioner(self):
        admin_sess = _make_session(ADMIN_ROLE)
        with tempfile.TemporaryDirectory() as tmp:
            orch = self._make_orch(tmp, admin_session=admin_sess, runtime_session=admin_sess)
            with (
                mock.patch.object(cloud_deployer.CloudDeployer, "provision_host") as m_prov,
                mock.patch.object(cloud_deployer.CloudDeployer, "deploy") as m_dep,
                mock.patch.object(cloud_orchestrator, "fetch_ops_snapshot") as m_ver,
            ):
                for stage in ("provision", "deploy", "verify"):
                    with self.assertRaises(RuntimeError) as ctx:
                        orch.run_stage(stage)
                    self.assertIn("Role separation violation", str(ctx.exception))
                m_prov.assert_not_called()
                m_dep.assert_not_called()
                m_ver.assert_not_called()

    def test_runtime_provisioner_session_cannot_run_foundation_secrets_stage(self):
        runtime_sess = _make_session(RUNTIME_ROLE)
        with self.assertRaises(RuntimeError) as ctx:
            cloud_stages.run_secrets_stage(admin_session=runtime_sess)
        self.assertIn("Role separation violation", str(ctx.exception))

    def test_expired_runtime_session_rejected_and_fail_closed_on_callback_failure(self):
        expired_sess = _make_session(RUNTIME_ROLE, expires_at_utc="2020-01-01T00:00:00+00:00")
        fresh_sess = _make_session(RUNTIME_ROLE, token="fresh-tok")
        with tempfile.TemporaryDirectory() as tmp:
            orch = self._make_orch(tmp, runtime_session=expired_sess)
            with (
                mock.patch.object(cloud_orchestrator, "load_ram_runtime_session", return_value=None),
                mock.patch.object(cloud_deployer.CloudDeployer, "provision_host") as m_prov,
            ):
                with self.assertRaises(RuntimeError) as ctx:
                    orch.run_stage("provision")
                self.assertIn("expired", str(ctx.exception).lower())
                m_prov.assert_not_called()

                cbs_fail = cloud_orchestrator.OrchestratorCallbacks(on_runtime_mfa_session=lambda: None)
                with self.assertRaises(RuntimeError):
                    orch.run_stage("provision", callbacks=cbs_fail)
                m_prov.assert_not_called()

                cbs_ok = cloud_orchestrator.OrchestratorCallbacks(on_runtime_mfa_session=lambda: fresh_sess)
                live_ok = (0, {"Account": ACCOUNT, "Arn": fresh_sess.caller_arn}, "")
                with (
                    mock.patch.object(cloud_identity, "_run_aws_json", return_value=live_ok),
                    mock.patch.object(cloud_orchestrator, "inspect_aws_identity", return_value={"authenticated": True, "bootstrap_deny_active": False}),
                ):
                    m_prov.return_value = {"instance_id": "i-1", "ip": "1.2.3.4"}
                    res = orch.run_stage("provision", callbacks=cbs_ok)
                self.assertEqual(res["status"], "completed")
                self.assertIs(orch.runtime_session, fresh_sess)

    def test_wrong_account_region_bootstrap_deny_and_raw_user_fail_closed(self):
        wrong_acct_sess = _make_session(RUNTIME_ROLE, account_id="111122223333")
        wrong_reg_sess = _make_session(RUNTIME_ROLE, region="us-west-2")
        good_sess = _make_session(RUNTIME_ROLE)
        with tempfile.TemporaryDirectory() as tmp:
            for bad_sess, expected_err in ((wrong_acct_sess, "account"), (wrong_reg_sess, "region")):
                orch = self._make_orch(tmp, runtime_session=bad_sess)
                with mock.patch.object(cloud_deployer.CloudDeployer, "provision_host") as m_prov:
                    with self.assertRaises(RuntimeError) as ctx:
                        orch.run_stage("provision")
                    self.assertIn(expected_err, str(ctx.exception).lower())
                    m_prov.assert_not_called()

            # Even with a valid runtime session, bootstrap_deny_active must halt fail-closed.
            orch_deny = self._make_orch(tmp, runtime_session=good_sess)
            live_ok = (0, {"Account": ACCOUNT, "Arn": good_sess.caller_arn}, "")
            with (
                mock.patch.object(cloud_identity, "_run_aws_json", return_value=live_ok),
                mock.patch.object(
                    cloud_orchestrator,
                    "inspect_aws_identity",
                    return_value={"authenticated": True, "bootstrap_deny_active": True, "deny_explanation": "bootstrap deny"},
                ),
                mock.patch.object(cloud_deployer.CloudDeployer, "provision_host") as m_prov,
            ):
                with self.assertRaises(RuntimeError) as ctx:
                    orch_deny.run_stage("provision")
                self.assertIn("bootstrap deny", str(ctx.exception).lower())
                m_prov.assert_not_called()

            # Raw IAM user without assumed runtime role fails closed.
            orch_raw = self._make_orch(tmp, runtime_session=None)
            with (
                mock.patch.object(cloud_orchestrator, "load_ram_runtime_session", return_value=None),
                mock.patch.object(
                    cloud_orchestrator,
                    "inspect_aws_identity",
                    return_value={
                        "authenticated": True,
                        "account_id": ACCOUNT,
                        "region": REGION,
                        "arn": f"arn:aws:iam::{ACCOUNT}:user/DEV-user-alpha",
                        "bootstrap_deny_active": False,
                    },
                ),
                mock.patch.object(cloud_deployer.CloudDeployer, "provision_host") as m_prov,
            ):
                with self.assertRaises(RuntimeError) as ctx:
                    orch_raw.run_stage("provision")
                self.assertIn(RUNTIME_ROLE, str(ctx.exception))
                m_prov.assert_not_called()

    def test_preflight_checks_runtime_provisioner_session_and_role(self):
        fake_aws = {
            "authenticated": True,
            "account_id": ACCOUNT,
            "region": REGION,
            "arn": f"arn:aws:iam::{ACCOUNT}:user/DEV-user-alpha",
            "bootstrap_deny_active": True,
            "deny_explanation": "Bootstrap deny active",
            "mfa_enrolled": True,
            "mfa_serials": [TOTP_SERIAL],
            "roles": {
                "envscale-github-deploy-role": {"exists": True},
                "envscale-github-release-role": {"exists": True},
                "envscale-github-recovery-role": {"exists": True},
                RUNTIME_ROLE: {"exists": True},
            },
            "instance_profile": {"exists": True},
        }
        runtime_sess = _make_session(RUNTIME_ROLE)
        with (
            mock.patch.object(cloud_preflight.shutil, "which", return_value="/usr/bin/tool"),
            mock.patch.object(cloud_preflight, "inspect_aws_identity", return_value=fake_aws),
            mock.patch.object(cloud_preflight, "_run_cmd", return_value=subprocess.CompletedProcess([], 0, stdout='{"terraform_version":"1.14.9"}', stderr="")),
            mock.patch.object(cloud_preflight, "load_deployment_env", return_value={"DUCKDNS_DOMAIN": "envscale", "DUCKDNS_TOKEN": "tok"}),
        ):
            report = cloud_preflight.run_preflight(runtime_session=runtime_sess)

        by_id = {c["id"]: c for c in report["checks"]}
        self.assertEqual(by_id["runtime_provisioner_session"]["status"], "pass")
        self.assertIn(RUNTIME_ROLE, by_id["runtime_provisioner_session"]["detail"])


class TestCanonicalRecoveryBucketAndLegacyCleanup(unittest.TestCase):
    def test_resolve_recovery_bucket_validates_canonical_and_rejects_legacy_prefixes(self):
        self.assertEqual(cloud_config_utils.resolve_recovery_bucket(configured_bucket=""), CANONICAL_BUCKET)
        self.assertEqual(cloud_config_utils.resolve_recovery_bucket(configured_bucket=CANONICAL_BUCKET), CANONICAL_BUCKET)
        for bad in (
            f"envscale-cloud-vault-{ACCOUNT}-{REGION}",
            f"envscale-tfstate-{ACCOUNT}-{REGION}",
            "envscale-recovery-111122223333-ap-south-1",
            "arbitrary-bucket-name",
        ):
            with self.assertRaises(ValueError):
                cloud_config_utils.resolve_recovery_bucket(configured_bucket=bad)

    def test_deployer_context_and_ensure_s3_vault_use_canonical_and_fail_closed(self):
        deployer = cloud_deployer.CloudDeployer(aws_env={"AWS_REGION": REGION})
        with (
            mock.patch.object(deployer, "load_deployment_env", return_value={}),
            mock.patch.object(
                cloud_deployer.subprocess,
                "run",
                side_effect=[
                    subprocess.CompletedProcess([], 0, stdout=json.dumps({"Account": ACCOUNT}), stderr=""),
                    subprocess.CompletedProcess([], 0, stdout=f"{REGION}\n", stderr=""),
                ],
            ),
        ):
            ctx = deployer.get_aws_context()
        self.assertEqual(ctx["recovery_bucket"], CANONICAL_BUCKET)
        self.assertEqual(ctx["s3_bucket"], CANONICAL_BUCKET)

        with (
            mock.patch.object(deployer, "get_aws_context", return_value=ctx),
            mock.patch.object(
                cloud_deployer.subprocess,
                "run",
                return_value=subprocess.CompletedProcess([], 0, stdout='{"LocationConstraint": "ap-south-1"}', stderr=""),
            ) as mock_run,
        ):
            deployer.ensure_s3_vault()
        cmd = mock_run.call_args.args[0]
        self.assertIn("get-bucket-location", cmd)
        self.assertIn(CANONICAL_BUCKET, cmd)

        with (
            mock.patch.object(deployer, "get_aws_context", return_value=ctx),
            mock.patch.object(
                cloud_deployer.subprocess,
                "run",
                return_value=subprocess.CompletedProcess([], 1, stdout="", stderr="NoSuchBucket"),
            ),
        ):
            with self.assertRaises(RuntimeError):
                deployer.ensure_s3_vault()

    def test_ops_dashboard_uses_canonical_bucket_and_fails_closed_on_backup(self):
        seen_s3_args = []

        def _fake_aws(args, aws_env=None):
            if args[0] == "s3api":
                seen_s3_args.append(args)
                return subprocess.CompletedProcess(args, 0, stdout='{"LocationConstraint":"ap-south-1"}', stderr="")
            if args[0] == "ec2":
                return subprocess.CompletedProcess(args, 0, stdout='{"Reservations":[]}', stderr="")
            return subprocess.CompletedProcess(args, 0, stdout='{"InstanceInformationList":[]}', stderr="")

        with (
            mock.patch.object(cloud_ops_dashboard.CloudDeployer, "get_instance_id", return_value="i-0123"),
            mock.patch.object(cloud_ops_dashboard.CloudDeployer, "get_public_ip", return_value="1.2.3.4"),
            mock.patch.object(cloud_ops_dashboard.CloudDeployer, "get_aws_context", return_value={"account_id": ACCOUNT, "region": REGION, "recovery_bucket": CANONICAL_BUCKET}),
            mock.patch.object(cloud_ops_dashboard, "_aws_cmd", side_effect=_fake_aws),
            mock.patch.object(cloud_ops_dashboard, "run_ssm_command", return_value=subprocess.CompletedProcess([], 0, stdout="", stderr="")),
            mock.patch.object(cloud_ops_dashboard, "load_deployment_env", return_value={}),
        ):
            snap = cloud_ops_dashboard.fetch_ops_snapshot(include_http_health=False)
            res = cloud_ops_dashboard.trigger_remote_backup()

        self.assertEqual(snap["backups"]["bucket"], CANONICAL_BUCKET)
        self.assertTrue(res["s3_uri"].startswith(f"s3://{CANONICAL_BUCKET}/backups/postgres/backup_"))
        self.assertTrue(res["s3_uri"].endswith(".dump"))
        self.assertTrue(any(CANONICAL_BUCKET in a for a in seen_s3_args))

        with (
            mock.patch.object(cloud_ops_dashboard.CloudDeployer, "get_instance_id", return_value="i-0123"),
            mock.patch.object(cloud_ops_dashboard.CloudDeployer, "get_aws_context", return_value={"account_id": ACCOUNT, "region": REGION}),
            mock.patch.object(cloud_ops_dashboard, "_aws_cmd", return_value=subprocess.CompletedProcess([], 1, stdout="", stderr="AccessDenied")),
            mock.patch.object(cloud_ops_dashboard, "load_deployment_env", return_value={}),
        ):
            with self.assertRaises(RuntimeError):
                cloud_ops_dashboard.trigger_remote_backup()

    def test_no_unintended_legacy_cloud_vault_references_in_scripts(self):
        scripts_dir = REPO_ROOT / "scripts"
        offending = []
        for path in sorted(scripts_dir.rglob("*")):
            if not path.is_file() or "__pycache__" in path.parts:
                continue
            try:
                text = path.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                continue
            rel = path.relative_to(REPO_ROOT).as_posix()
            for lineno, line in enumerate(text.splitlines(), start=1):
                if "envscale-cloud-vault" in line:
                    if rel == "scripts/lib/cloud_config_utils.py" and "_FORBIDDEN_BUCKET_PREFIXES" in line:
                        continue
                    offending.append(f"{rel}:{lineno}: {line.strip()}")
        self.assertEqual(offending, [], f"Unexpected legacy vault references found: {offending}")


if __name__ == "__main__":
    unittest.main()
