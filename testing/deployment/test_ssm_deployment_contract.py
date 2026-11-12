"""Offline contract tests for EnvScale's SSM + manifest deployment migration."""

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

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))


def _load_script_module(name: str, rel_path: str):
    path = REPO_ROOT / rel_path
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


MANIFEST_GEN = _load_script_module("gen_manifest", "deployment/scripts/generate-release-manifest.py")
MANIFEST_VAL = _load_script_module("val_manifest", "deployment/scripts/validate-release-manifest.py")
SSM_SECRETS = _load_script_module("ssm_secrets", "deployment/scripts/sync-ssm-secrets.py")

from scripts.lib import cloud_deployer, ssm_deployer  # noqa: E402

SAMPLE_SHA = "0123456789abcdef0123456789abcdef01234567"
API_DIGEST = "sha256:1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f809"
STREAMER_DIGEST = "sha256:9f8e7d6c5b4a392817263544536271809f8e7d6c5b4a39281726354453627180"
WEB_DIGEST = "sha256:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"


class TestReleaseManifestContract(unittest.TestCase):
    def test_generate_and_validate_manifest(self):
        manifest = MANIFEST_GEN.build_release_manifest(
            repository="P20000/EnvScale",
            branch="develop",
            commit_sha=SAMPLE_SHA,
            owner_lc="p20000",
            api_digest=API_DIGEST,
            streamer_digest=STREAMER_DIGEST,
            web_digest=WEB_DIGEST,
            workflow_name="EnvScale CD - Build & Deploy",
            workflow_run_id="42",
            workflow_run_attempt=1,
            builder_identity="P20000/EnvScale/.github/workflows/cd.yml@refs/heads/develop",
        )
        self.assertEqual(manifest["manifest_kind"], "release")
        self.assertEqual(manifest["images"]["api_server"]["pinned_ref"], f"ghcr.io/p20000/envscale-api-server@{API_DIGEST}")
        self.assertEqual(manifest["images"]["web"]["commit_tag"], f"sha-{SAMPLE_SHA}")

    def test_rejects_low_entropy_synthetic_digest(self):
        with self.assertRaises(Exception):
            MANIFEST_GEN.build_release_manifest(
                repository="P20000/EnvScale",
                branch="develop",
                commit_sha=SAMPLE_SHA,
                owner_lc="p20000",
                api_digest="sha256:" + ("1" * 64),
                streamer_digest=STREAMER_DIGEST,
                web_digest=WEB_DIGEST,
                workflow_name="EnvScale CD - Build & Deploy",
                workflow_run_id="42",
                workflow_run_attempt=1,
                builder_identity="P20000/EnvScale/.github/workflows/cd.yml@refs/heads/develop",
            )


class TestSsmSecretsSync(unittest.TestCase):
    def test_fetches_paginated_ssm_and_writes_0600_secrets_file(self):
        page1 = {
            "Parameters": [
                {"Name": "/envscale/prod/postgres_password", "Value": "super-secret-pg-1234"},
                {"Name": "/envscale/prod/redis_password", "Value": "super-secret-rd-1234"},
                {"Name": "/envscale/prod/jwt_access_secret", "Value": "a" * 36},
                {"Name": "/envscale/prod/jwt_refresh_secret", "Value": "b" * 36},
                {"Name": "/envscale/prod/better_auth_secret", "Value": "c" * 36},
            ],
            "NextToken": "page-2",
        }
        page2 = {
            "Parameters": [
                {"Name": "/envscale/prod/better_auth_url", "Value": "https://envscale.duckdns.org"},
                {"Name": "/envscale/prod/cors_origin", "Value": "https://envscale.duckdns.org"},
                {"Name": "/envscale/prod/kubeconfig_encryption_key", "Value": "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY="},
                {"Name": "/envscale/prod/duckdns_domain", "Value": "envscale"},
                {"Name": "/envscale/prod/duckdns_token", "Value": "token-value-123"},
            ],
        }
        calls = [
            subprocess.CompletedProcess([], 0, stdout=json.dumps(page1), stderr=""),
            subprocess.CompletedProcess([], 0, stdout=json.dumps(page2), stderr=""),
        ]
        with mock.patch.object(SSM_SECRETS.subprocess, "run", side_effect=calls):
            env_map = SSM_SECRETS.fetch_ssm_parameters("/envscale/prod", region="ap-south-1")

        with tempfile.TemporaryDirectory() as tmpdir:
            out_path = pathlib.Path(tmpdir) / "secrets.env"
            SSM_SECRETS.render_secrets_env(env_map, out_path)
            mode = stat.S_IMODE(out_path.stat().st_mode)
            self.assertEqual(mode, 0o600)
            content = out_path.read_text(encoding="utf-8")
            self.assertIn('POSTGRES_PASSWORD="super-secret-pg-1234"', content)
            self.assertIn('DUCKDNS_DOMAIN="envscale"', content)

    def test_refuses_missing_required_ssm_parameter(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            out_path = pathlib.Path(tmpdir) / "secrets.env"
            with self.assertRaises(RuntimeError):
                SSM_SECRETS.render_secrets_env({"DUCKDNS_DOMAIN": "envscale"}, out_path)


class TestSsmCommandsAndCleanup(unittest.TestCase):
    def test_remote_commands_require_exact_sha_and_manifest(self):
        cmds = ssm_deployer.build_remote_deploy_commands(SAMPLE_SHA, "e30=")
        joined = "\n".join(cmds)
        self.assertIn("test -d /opt/envscale/.git", joined)
        self.assertIn(f"git fetch --no-tags origin {SAMPLE_SHA}", joined)
        self.assertIn(f"git checkout --detach {SAMPLE_SHA}", joined)
        self.assertNotIn("origin/develop", joined)
        self.assertIn("sync-ssm-secrets.py --ssm-prefix /envscale/prod --output /etc/envscale/secrets.env", joined)
        self.assertIn("ENVSCALE_SECRETS_FILE=/etc/envscale/secrets.env /opt/envscale/envscale.sh deploy --manifest /var/lib/envscale/pending-release-manifest.json", joined)

    def test_resolve_manifest_rejects_commit_sha_mismatch(self):
        manifest = MANIFEST_GEN.build_release_manifest(
            repository="P20000/EnvScale",
            branch="develop",
            commit_sha=SAMPLE_SHA,
            owner_lc="p20000",
            api_digest=API_DIGEST,
            streamer_digest=STREAMER_DIGEST,
            web_digest=WEB_DIGEST,
            workflow_name="EnvScale CD - Build & Deploy",
            workflow_run_id="42",
            workflow_run_attempt=1,
            builder_identity="P20000/EnvScale/.github/workflows/cd.yml@refs/heads/develop",
        )
        with tempfile.TemporaryDirectory() as tmpdir:
            mpath = pathlib.Path(tmpdir) / "release-manifest.json"
            mpath.write_text(json.dumps(manifest), encoding="utf-8")
            with self.assertRaises(RuntimeError):
                ssm_deployer.resolve_and_validate_manifest("f" * 40, manifest_path=str(mpath))

    def test_cleanup_external_references_clears_duckdns_and_github_secrets(self):
        mock_resp = mock.MagicMock()
        mock_resp.__enter__.return_value = mock_resp
        mock_resp.read.return_value = b"OK"

        with (
            mock.patch.object(ssm_deployer.urllib.request, "urlopen", return_value=mock_resp) as mock_url,
            mock.patch.object(ssm_deployer.shutil, "which", return_value="/usr/bin/gh"),
            mock.patch.object(
                ssm_deployer.subprocess,
                "run",
                return_value=subprocess.CompletedProcess([], 0, stdout="", stderr=""),
            ) as mock_run,
        ):
            res = ssm_deployer.cleanup_external_references("envscale", "duck-tok")

        self.assertEqual(res["duckdns"], "OK")
        self.assertEqual(res["EC2_HOST"], "deleted")
        self.assertEqual(res["SSH_PRIVATE_KEY"], "deleted")
        req_arg = mock_url.call_args[0][0]
        self.assertIn("clear=true", req_arg.full_url)
        deleted_cmds = [c.args[0] for c in mock_run.call_args_list if "delete" in c.args[0]]
        self.assertEqual(len(deleted_cmds), 3)

    def test_cloud_deployer_s3_never_persists_ssh_key(self):
        deployer = cloud_deployer.CloudDeployer(log_fn=lambda _: None)
        with (
            mock.patch.object(deployer, "get_aws_context", return_value={"account_id": "123", "region": "ap-south-1", "s3_bucket": "bkt"}),
            mock.patch.object(deployer, "_run_cmd") as mock_cmd,
            mock.patch.object(os.path, "exists", return_value=True),
        ):
            deployer.backup_to_s3()
        called_cmds = [str(c.args[0]) for c in mock_cmd.call_args_list]
        self.assertTrue(any("terraform.tfstate" in cmd for cmd in called_cmds))
        self.assertFalse(any("envscale_key.pem" in cmd for cmd in called_cmds))

    def test_verify_runtime_instance_profile_checks_profile_and_role(self):
        ok_payload = {"InstanceProfile": {"Roles": [{"RoleName": "envscale-ec2-runtime-role"}]}}
        with mock.patch.object(
            ssm_deployer.subprocess,
            "run",
            return_value=subprocess.CompletedProcess([], 0, stdout=json.dumps(ok_payload), stderr=""),
        ):
            res = ssm_deployer.verify_runtime_instance_profile()
        self.assertEqual(res["role_name"], "envscale-ec2-runtime-role")

        with mock.patch.object(
            ssm_deployer.subprocess,
            "run",
            return_value=subprocess.CompletedProcess([], 255, stdout="", stderr="NoSuchEntity"),
        ):
            with self.assertRaises(RuntimeError):
                ssm_deployer.verify_runtime_instance_profile()

        with mock.patch.object(
            ssm_deployer.subprocess,
            "run",
            return_value=subprocess.CompletedProcess([], 0, stdout=json.dumps({"InstanceProfile": {"Roles": []}}), stderr=""),
        ):
            with self.assertRaises(RuntimeError):
                ssm_deployer.verify_runtime_instance_profile()


class TestRepoInfrastructureContracts(unittest.TestCase):
    def test_terraform_has_zero_ssh_and_attaches_ssm_instance_profile(self):
        compute_tf = (REPO_ROOT / "deployment/terraform/compute.tf").read_text(encoding="utf-8")
        sg_tf = (REPO_ROOT / "deployment/terraform/security_group.tf").read_text(encoding="utf-8")
        self.assertNotIn("tls_private_key", compute_tf)
        self.assertNotIn("aws_key_pair", compute_tf)
        self.assertNotIn("envscale_key.pem", compute_tf)
        self.assertIn("iam_instance_profile", compute_tf)
        self.assertNotIn("from_port   = 22", sg_tf)

    def test_cd_workflow_uses_ssm_manifest_and_no_ssh(self):
        cd_yml = (REPO_ROOT / ".github/workflows/cd.yml").read_text(encoding="utf-8")
        self.assertNotIn("appleboy/ssh-action", cd_yml)
        self.assertNotIn("SSH_PRIVATE_KEY", cd_yml)
        self.assertNotIn("origin/develop", cd_yml)
        self.assertIn("generate-release-manifest.py", cd_yml)
        self.assertIn("aws ssm send-command", cd_yml)
        self.assertIn("--manifest", cd_yml)


if __name__ == "__main__":
    unittest.main()

