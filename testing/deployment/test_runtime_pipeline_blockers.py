#!/usr/bin/env python3
"""Focused regression tests for the four runtime pipeline blockers."""

from __future__ import annotations

import json
import os
import pathlib
import stat
import subprocess
import sys
import tempfile
import unittest
import zipfile
from unittest import mock

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
BOOTSTRAP_DIR = REPO_ROOT / "deployment" / "bootstrap"
FOUNDATION_DIR = REPO_ROOT / "deployment" / "foundation"
for _p in (str(REPO_ROOT), str(BOOTSTRAP_DIR)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import iam_policy_simulator as sim  # noqa: E402
import runtime_provisioner_iam as rp_iam  # noqa: E402
from scripts.lib import (  # noqa: E402
    cloud_deployer,
    cloud_ops_dashboard,
    postgres_backup_verifier,
    ssm_deployer,
)

ACCOUNT = "982534376726"
REGION = "ap-south-1"
SAMPLE_SHA = "a" * 40


def _write_exe(path: pathlib.Path, body: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body, encoding="utf-8")
    os.chmod(path, stat.S_IRWXU | stat.S_IRGRP | stat.S_IXGRP)


class TestRuntimePipelineBlockers(unittest.TestCase):
    def test_ssm_get_parameters_by_path_prefix_arn_and_boundary_intact(self):
        pols = sim.build_rendered_foundation_policies(FOUNDATION_DIR)
        ec2_pol = pols["role_ec2_runtime"]
        read_stmt = next(s for s in ec2_pol["Statement"] if s["Sid"] == "AllowSSMProdParameterRead")
        prefix_arn = f"arn:aws:ssm:{REGION}:{ACCOUNT}:parameter/envscale/prod"
        wild_arn = f"arn:aws:ssm:{REGION}:{ACCOUNT}:parameter/envscale/prod/*"
        self.assertEqual(read_stmt["Resource"], [prefix_arn, wild_arn])
        self.assertEqual(ec2_pol, rp_iam.build_ec2_runtime_policy(ACCOUNT, REGION))

        wb = pols["role_workload_permissions_boundary"]
        self.assertEqual(
            sim.eval_iam_policy_local_harness(ec2_pol, "ssm:GetParametersByPath", prefix_arn, {}, None, wb),
            "allowed",
        )
        self.assertEqual(
            sim.eval_iam_policy_local_harness(ec2_pol, "ssm:GetParametersByPath", wild_arn, {}, None, wb),
            "allowed",
        )
        self.assertEqual(
            sim.eval_iam_policy_local_harness(
                ec2_pol, "ssm:GetParametersByPath", f"arn:aws:ssm:{REGION}:{ACCOUNT}:parameter/other", {}, None, wb
            ),
            "implicitDeny",
        )
        iam_locals = (FOUNDATION_DIR / "iam_locals.tf").read_text(encoding="utf-8")
        iam_tf = (FOUNDATION_DIR / "iam.tf").read_text(encoding="utf-8")
        self.assertIn("ssm_prod_prefix_arn", iam_locals)
        self.assertIn("[local.ssm_prod_prefix_arn, local.ssm_prod_param_arn]", iam_tf)

    def test_ssm_command_polling_delayed_completion_timeout_and_terminal_failures(self):
        # 1. Delayed completion beyond 100s (InvocationDoesNotExist -> Pending -> InProgress -> Delayed -> Success)
        clock = {"t": 0.0}

        def _fake_monotonic() -> float:
            return clock["t"]

        def _fake_sleep(dt: float) -> None:
            clock["t"] += dt

        statuses = iter([
            subprocess.CompletedProcess([], 254, "", "InvocationDoesNotExist"),
            subprocess.CompletedProcess([], 0, json.dumps({"Status": "Pending"}), ""),
            subprocess.CompletedProcess([], 0, json.dumps({"Status": "InProgress"}), ""),
            subprocess.CompletedProcess([], 0, json.dumps({"Status": "Delayed"}), ""),
            subprocess.CompletedProcess([], 0, json.dumps({"Status": "Success", "ResponseCode": 0, "StandardOutputContent": "deployed ok\n", "StandardErrorContent": ""}), ""),
        ])

        def _fake_run_delayed(cmd, **kwargs):
            self.assertNotIn("wait", cmd)
            if "send-command" in cmd:
                return subprocess.CompletedProcess(cmd, 0, "cmd-slow\n", "")
            clock["t"] += 45.0
            return next(statuses)

        with (
            mock.patch.object(ssm_deployer.time, "monotonic", side_effect=_fake_monotonic),
            mock.patch.object(ssm_deployer.time, "sleep", side_effect=_fake_sleep),
            mock.patch.object(ssm_deployer.subprocess, "run", side_effect=_fake_run_delayed),
        ):
            res = ssm_deployer.run_ssm_command("i-0123", ["echo ok"], timeout_s=600, poll_interval_s=5)
        self.assertEqual(res.returncode, 0)
        self.assertGreater(clock["t"], 100.0)
        self.assertEqual(res.stdout, "deployed ok")

        # 2. Timeout expiration while still InProgress
        t_clock = {"t": 0.0}

        def _fake_run_timeout(cmd, **kwargs):
            if "send-command" in cmd:
                return subprocess.CompletedProcess(cmd, 0, "cmd-hang\n", "")
            return subprocess.CompletedProcess(cmd, 0, json.dumps({"Status": "InProgress", "StandardErrorContent": "still pulling"}), "")

        with (
            mock.patch.object(ssm_deployer.time, "monotonic", side_effect=lambda: t_clock["t"]),
            mock.patch.object(ssm_deployer.time, "sleep", side_effect=lambda dt: t_clock.__setitem__("t", t_clock["t"] + max(dt, 10))),
            mock.patch.object(ssm_deployer.subprocess, "run", side_effect=_fake_run_timeout),
        ):
            with self.assertRaises(RuntimeError) as to_exc:
                ssm_deployer.run_ssm_command("i-0123", ["sleep 999"], timeout_s=30, poll_interval_s=10)
        self.assertIn("timed out after 30s", str(to_exc.exception))
        self.assertIn("InProgress", str(to_exc.exception))

        # 3. Terminal failures preserve stderr and status/code diagnostics
        for term_status, rc, stderr_txt in [
            ("Failed", 1, "boom stderr"),
            ("Cancelled", -1, "operator cancelled"),
            ("TimedOut", -1, "ssm agent execution timeout"),
        ]:
            def _fake_term(cmd, _st=term_status, _rc=rc, _se=stderr_txt, **kwargs):
                if "send-command" in cmd:
                    return subprocess.CompletedProcess(cmd, 0, "cmd-term\n", "")
                return subprocess.CompletedProcess(cmd, 0, json.dumps({"Status": _st, "ResponseCode": _rc, "StandardErrorContent": _se}), "")

            with mock.patch.object(ssm_deployer.subprocess, "run", side_effect=_fake_term):
                with self.assertRaises(RuntimeError) as err_ctx:
                    ssm_deployer.run_ssm_command("i-0123", ["false"])
            self.assertIn(term_status, str(err_ctx.exception))
            self.assertIn(stderr_txt, str(err_ctx.exception))

        # 4. cd.yml uses bounded 600s polling rather than 100s waiter
        cd_yml = (REPO_ROOT / ".github/workflows/cd.yml").read_text(encoding="utf-8")
        self.assertNotIn("aws ssm wait command-executed", cd_yml)
        self.assertIn("MAX_WAIT=600", cd_yml)
        self.assertIn("Pending|InProgress|Delayed", cd_yml)

    def test_ensure_awscli_v2_script_handles_v2_present_v1_upgrade_and_failure(self):
        script = REPO_ROOT / "deployment/scripts/ensure-awscli-v2.sh"
        with tempfile.TemporaryDirectory() as td:
            root = pathlib.Path(td)

            # 1. Existing v2 binary skips download/reinstall
            bin_v2 = root / "bin_v2"
            _write_exe(bin_v2 / "aws", "#!/bin/sh\necho 'aws-cli/2.17.1 Python/3.12 Linux/6.8 exe/x86_64'\n")
            env_v2 = {
                **os.environ,
                "AWSCLI_BIN_DIR": str(bin_v2),
                "AWSCLI_INSTALL_DIR": str(root / "inst_v2"),
                "AWSCLI_BUNDLE_URL": "http://127.0.0.1:9/should-not-fetch.zip",
            }
            p_v2 = subprocess.run(["bash", str(script)], env=env_v2, capture_output=True, text=True, check=False)
            self.assertEqual(p_v2.returncode, 0, msg=p_v2.stderr)

            # 2. Existing v1 binary triggers upgrade using bundle zip without unzip dependency
            bin_v1 = root / "bin_v1"
            inst_v1 = root / "inst_v1"
            _write_exe(bin_v1 / "aws", "#!/bin/sh\necho 'aws-cli/1.22.34 Python/3.10 Linux/6.8 botocore/1.24.0'\n")
            bundle_zip = root / "bundle.zip"
            install_sh = (
                "#!/bin/sh\n"
                "BIN_D=''\n"
                "while [ $# -gt 0 ]; do case \"$1\" in --bin-dir) BIN_D=\"$2\"; shift 2;; --install-dir) shift 2;; *) shift;; esac; done\n"
                "cat > \"$BIN_D/aws\" <<'EOF'\n#!/bin/sh\necho 'aws-cli/2.22.0 Python/3.12 Linux/6.8 exe/x86_64'\nEOF\n"
                "chmod +x \"$BIN_D/aws\"\n"
            )
            with zipfile.ZipFile(bundle_zip, "w") as zf:
                zi = zipfile.ZipInfo("aws/install")
                zi.external_attr = 0o755 << 16
                zf.writestr(zi, install_sh)
            env_up = {
                **os.environ,
                "PATH": f"{bin_v1}:/usr/bin:/bin",
                "AWSCLI_BIN_DIR": str(bin_v1),
                "AWSCLI_INSTALL_DIR": str(inst_v1),
                "AWSCLI_BUNDLE_URL": bundle_zip.as_uri(),
            }
            p_up = subprocess.run(["bash", str(script)], env=env_up, capture_output=True, text=True, check=False)
            self.assertEqual(p_up.returncode, 0, msg=p_up.stderr + p_up.stdout)
            ver = subprocess.run([str(bin_v1 / "aws"), "--version"], capture_output=True, text=True, check=True)
            self.assertRegex(ver.stdout, r"^aws-cli/2\.")

            # 3. Download failure aborts with fatal diagnostic
            bin_fail = root / "bin_fail"
            _write_exe(bin_fail / "aws", "#!/bin/sh\necho 'aws-cli/1.22.34 Python/3.10'\n")
            env_fail = {
                **os.environ,
                "PATH": f"{bin_fail}:/usr/bin:/bin",
                "AWSCLI_BIN_DIR": str(bin_fail),
                "AWSCLI_INSTALL_DIR": str(root / "inst_fail"),
                "AWSCLI_BUNDLE_URL": (root / "missing.zip").as_uri(),
            }
            p_fail = subprocess.run(["bash", str(script)], env=env_fail, capture_output=True, text=True, check=False)
            self.assertNotEqual(p_fail.returncode, 0)
            self.assertIn("Failed downloading AWS CLI v2", p_fail.stderr)

        # Verify deploy, backup, and restore scripts enforce CLI v2 before S3/SSM operations
        dep_joined = "\n".join(ssm_deployer.build_remote_deploy_commands(SAMPLE_SHA, "e30="))
        self.assertLess(dep_joined.index("aws-cli/2"), dep_joined.index("sync-ssm-secrets.py"))
        bkp_joined = "\n".join(postgres_backup_verifier.build_postgres_backup_ssm_commands("envscale-recovery-982534376726-ap-south-1", "backups/postgres/b.dump"))
        self.assertLess(bkp_joined.index("aws-cli/2"), bkp_joined.index("--checksum-algorithm SHA256"))
        db_rest = (REPO_ROOT / "deployment/scripts/db-restore.sh").read_text(encoding="utf-8")
        self.assertLess(db_rest.index("ensure-awscli-v2.sh"), db_rest.index("--checksum-mode ENABLED"))

    def test_first_time_tls_verification_retries_transient_handshake_and_rejects_real_cert_errors(self):
        with tempfile.TemporaryDirectory() as td:
            mpath = pathlib.Path(td) / "manifest.json"
            mpath.write_text('{"git":{"commit_sha":"' + SAMPLE_SHA + '"}}', encoding="utf-8")
            deployer = cloud_deployer.CloudDeployer()

            # 1. Transient TLSV1_ALERT_INTERNAL_ERROR / handshake succeeds on 5th attempt (6 total attempts default)
            outcomes = [
                (False, ["SSL/TLS certificate verification failed: [SSL: TLSV1_ALERT_INTERNAL_ERROR] tlsv1 alert internal error"]),
                (False, ["SSL/TLS handshake failure: EOF occurred in violation of protocol"]),
                (False, ["SSL/TLS certificate verification failed: CERTIFICATE_VERIFY_FAILED"]),
                (False, ["SSL/TLS certificate verification failed: tlsv1 alert internal error"]),
                (True, []),
            ]
            with (
                mock.patch.object(deployer, "get_instance_id", return_value="i-0123"),
                mock.patch.object(deployer, "get_public_ip", return_value="3.6.66.234"),
                mock.patch.object(deployer, "_get_tf_outputs", return_value={"app_url": {"value": "https://envscale.duckdns.org"}}),
                mock.patch.object(deployer, "load_deployment_env", return_value={}),
                mock.patch.object(deployer, "get_aws_context", return_value={"account_id": ACCOUNT, "region": REGION, "s3_bucket": "b"}),
                mock.patch.object(cloud_deployer, "verify_ssm_parameters_present"),
                mock.patch.object(cloud_deployer, "resolve_and_validate_manifest", return_value=mpath),
                mock.patch.object(cloud_deployer, "run_ssm_command"),
                mock.patch.object(cloud_deployer, "verify_deployment_health", side_effect=outcomes) as m_health,
                mock.patch.object(cloud_deployer.time, "sleep") as m_sleep,
            ):
                deployer.deploy(release_sha=SAMPLE_SHA, manifest_path=str(mpath))
            self.assertEqual(m_health.call_count, 5)
            self.assertEqual(m_sleep.call_count, 5)  # 1 initial settle + 4 retry waits

            # 2. Permanent cert failures do NOT burn retry loops
            for real_err in (
                ["SSL certificate for envscale.duckdns.org has expired"],
                ["SSL/TLS certificate verification failed: Hostname mismatch"],
                ["SSL/TLS certificate verification failed: self-signed certificate"],
            ):
                with (
                    mock.patch.object(deployer, "get_instance_id", return_value="i-0123"),
                    mock.patch.object(deployer, "get_public_ip", return_value="3.6.66.234"),
                    mock.patch.object(deployer, "_get_tf_outputs", return_value={"app_url": {"value": "https://envscale.duckdns.org"}}),
                    mock.patch.object(deployer, "load_deployment_env", return_value={}),
                    mock.patch.object(deployer, "get_aws_context", return_value={"account_id": ACCOUNT, "region": REGION, "s3_bucket": "b"}),
                    mock.patch.object(cloud_deployer, "verify_ssm_parameters_present"),
                    mock.patch.object(cloud_deployer, "resolve_and_validate_manifest", return_value=mpath),
                    mock.patch.object(cloud_deployer, "run_ssm_command"),
                    mock.patch.object(cloud_deployer, "verify_deployment_health", return_value=(False, real_err)) as m_fail,
                    mock.patch.object(cloud_deployer.time, "sleep"),
                ):
                    with self.assertRaises(RuntimeError):
                        deployer.deploy(release_sha=SAMPLE_SHA, manifest_path=str(mpath), auto_rollback=False)
                self.assertEqual(m_fail.call_count, 1)


if __name__ == "__main__":
    unittest.main()

