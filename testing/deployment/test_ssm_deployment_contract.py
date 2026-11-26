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
import urllib.error
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

from scripts.lib import cloud_deployer, cloud_host_runner, ssm_deployer  # noqa: E402

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

    def test_resolve_aws_region_precedence_and_imds_fallback(self):
        with mock.patch.dict(os.environ, {"AWS_REGION": "us-east-1", "AWS_DEFAULT_REGION": "eu-west-1"}, clear=False):
            self.assertEqual(SSM_SECRETS.resolve_aws_region("ap-south-1", allow_imds=False), "ap-south-1")
            self.assertEqual(SSM_SECRETS.resolve_aws_region(None, allow_imds=False), "us-east-1")
        with mock.patch.dict(os.environ, {"AWS_REGION": "", "AWS_DEFAULT_REGION": ""}, clear=False):
            tok_resp, reg_resp = mock.MagicMock(), mock.MagicMock()
            tok_resp.__enter__.return_value = tok_resp
            tok_resp.read.return_value = b"imds-tok"
            reg_resp.__enter__.return_value = reg_resp
            reg_resp.read.return_value = b"ap-south-1\n"
            with mock.patch.object(SSM_SECRETS.urllib.request, "urlopen", side_effect=[tok_resp, reg_resp]) as mock_open:
                self.assertEqual(SSM_SECRETS.resolve_aws_region(None, allow_imds=True), "ap-south-1")
            self.assertEqual(mock_open.call_count, 2)
            with mock.patch.object(SSM_SECRETS.urllib.request, "urlopen", side_effect=urllib.error.URLError("timeout")):
                self.assertIsNone(SSM_SECRETS.resolve_aws_region(None, allow_imds=True))
        with self.assertRaises(ValueError):
            SSM_SECRETS.resolve_aws_region("bad region!", allow_imds=False)

    def test_normalizes_disabled_oauth_sentinel_to_empty(self):
        ssm_payload = {
            "Parameters": [
                {"Name": "/envscale/prod/google_client_id", "Value": "DISABLED"},
                {"Name": "/envscale/prod/google_client_secret", "Value": "disabled"},
                {"Name": "/envscale/prod/github_client_id", "Value": "real-gh-id"},
                {"Name": "/envscale/prod/github_client_secret", "Value": "DISABLED"},
            ],
        }
        with mock.patch.object(SSM_SECRETS.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, stdout=json.dumps(ssm_payload), stderr="")):
            fetched = SSM_SECRETS.fetch_ssm_parameters("/envscale/prod", region="ap-south-1")
        self.assertEqual((fetched["GOOGLE_CLIENT_ID"], fetched["GOOGLE_CLIENT_SECRET"]), ("", ""))
        self.assertEqual((fetched["GITHUB_CLIENT_ID"], fetched["GITHUB_CLIENT_SECRET"]), ("real-gh-id", ""))

        base = {k: "val-123" for k in SSM_SECRETS.REQUIRED_KEYS}
        base.update({"GOOGLE_CLIENT_ID": "DISABLED", "GOOGLE_CLIENT_SECRET": "Disabled", "GITHUB_CLIENT_ID": "real-gh-id", "GITHUB_CLIENT_SECRET": "real-gh-sec"})
        with tempfile.TemporaryDirectory() as tmpdir:
            out_path = pathlib.Path(tmpdir) / "secrets.env"
            SSM_SECRETS.render_secrets_env(base, out_path)
            txt = out_path.read_text(encoding="utf-8")
        self.assertIn('GOOGLE_CLIENT_ID=""', txt)
        self.assertIn('GOOGLE_CLIENT_SECRET=""', txt)
        self.assertIn('GITHUB_CLIENT_ID="real-gh-id"', txt)
        self.assertIn('GITHUB_CLIENT_SECRET="real-gh-sec"', txt)


class TestSsmCommandsAndCleanup(unittest.TestCase):
    def test_remote_commands_require_exact_sha_and_manifest(self):
        cmds = ssm_deployer.build_remote_deploy_commands(SAMPLE_SHA, "e30=")
        joined = "\n".join(cmds)
        self.assertIn("test -d /opt/envscale/.git", joined)
        self.assertIn("safe.directory /opt/envscale", joined)
        self.assertIn(f"git fetch --no-tags origin {SAMPLE_SHA}", joined)
        self.assertIn(f"git checkout --detach {SAMPLE_SHA}", joined)
        self.assertNotIn("origin/develop", joined)
        self.assertIn("sync-ssm-secrets.py --ssm-prefix /envscale/prod --region ap-south-1 --output /etc/envscale/secrets.env", joined)
        self.assertIn("ENVSCALE_SECRETS_FILE=/etc/envscale/secrets.env /opt/envscale/envscale.sh deploy --manifest /var/lib/envscale/pending-release-manifest.json", joined)
        custom_joined = "\n".join(ssm_deployer.build_remote_deploy_commands(SAMPLE_SHA, "e30=", region="us-west-2"))
        self.assertIn("--region us-west-2", custom_joined)

    def test_verify_ssm_parameters_present_checks_paginated_metadata_without_decryption(self):
        p1 = {"Parameters": [{"Name": f"/envscale/prod/{k}"} for k in ssm_deployer.REQUIRED_RUNTIME_SSM_PARAMS[:5]], "NextToken": "t2"}
        p2 = {"Parameters": [{"Name": f"/envscale/prod/{k}"} for k in ssm_deployer.REQUIRED_RUNTIME_SSM_PARAMS[5:]]}
        calls = [subprocess.CompletedProcess([], 0, stdout=json.dumps(p1), stderr=""), subprocess.CompletedProcess([], 0, stdout=json.dumps(p2), stderr="")]
        with mock.patch.object(ssm_deployer.subprocess, "run", side_effect=calls) as m_run:
            found = ssm_deployer.verify_ssm_parameters_present(region="ap-south-1")
        self.assertEqual(len(found), len(ssm_deployer.REQUIRED_RUNTIME_SSM_PARAMS))
        for c in m_run.call_args_list:
            cmd = c.args[0]
            self.assertIn("describe-parameters", cmd)
            self.assertIn("ap-south-1", cmd)
            self.assertNotIn("get-parameter", " ".join(cmd))

        incomplete = {"Parameters": [{"Name": "/envscale/prod/duckdns_domain"}]}
        with mock.patch.object(ssm_deployer.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, stdout=json.dumps(incomplete), stderr="")):
            with self.assertRaises(RuntimeError) as ctx:
                ssm_deployer.verify_ssm_parameters_present(region="ap-south-1")
        self.assertIn("duckdns_token", str(ctx.exception))

    def test_cloud_deployer_deploy_decoupled_from_local_env_secrets(self):
        deployer = cloud_deployer.CloudDeployer(log_fn=lambda _: None)
        with tempfile.TemporaryDirectory() as tmpdir:
            mpath = pathlib.Path(tmpdir) / "manifest.json"
            mpath.write_text('{"git":{"commit_sha":"' + SAMPLE_SHA + '"}}', encoding="utf-8")
            with (
                mock.patch.object(deployer, "get_instance_id", return_value="i-0123456789abcdef0"),
                mock.patch.object(deployer, "get_public_ip", return_value="203.0.113.10"),
                mock.patch.object(deployer, "_get_tf_outputs", return_value={"app_url": {"value": "https://envscale.duckdns.org"}}),
                mock.patch.object(deployer, "load_deployment_env", return_value={}),
                mock.patch.object(deployer, "get_aws_context", return_value={"account_id": "982534376726", "region": "ap-south-1", "s3_bucket": "bkt"}),
                mock.patch.object(cloud_deployer, "verify_ssm_parameters_present", return_value=list(ssm_deployer.REQUIRED_RUNTIME_SSM_PARAMS)) as m_ssm,
                mock.patch.object(cloud_deployer, "resolve_and_validate_manifest", return_value=mpath),
                mock.patch.object(cloud_deployer, "run_ssm_command") as m_run,
                mock.patch.object(cloud_deployer, "verify_deployment_health", return_value=(True, [])),
                mock.patch.object(cloud_deployer.time, "sleep"),
            ):
                deployer.deploy(release_sha=SAMPLE_SHA, manifest_path=str(mpath))
            m_ssm.assert_called_once()
            self.assertIn("--region ap-south-1", "\n".join(m_run.call_args.args[1]))

            with (
                mock.patch.object(deployer, "get_instance_id", return_value="i-0123456789abcdef0"),
                mock.patch.object(deployer, "get_public_ip", return_value="203.0.113.10"),
                mock.patch.object(deployer, "load_deployment_env", return_value={}),
                mock.patch.object(deployer, "get_aws_context", return_value={"account_id": "982534376726", "region": "ap-south-1", "s3_bucket": "bkt"}),
                mock.patch.object(cloud_deployer, "verify_ssm_parameters_present", side_effect=RuntimeError("Missing SSM params")),
                mock.patch.object(cloud_deployer, "run_ssm_command") as m_run_blocked,
            ):
                with self.assertRaises(RuntimeError):
                    deployer.deploy(release_sha=SAMPLE_SHA, manifest_path=str(mpath))
                m_run_blocked.assert_not_called()

    def test_websocket_health_probe_enforces_401_and_detects_failures(self):
        sock_cm = mock.MagicMock()
        sock_cm.__enter__.return_value = sock_cm
        ssl_sock = mock.MagicMock()
        ssl_sock.__enter__.return_value = ssl_sock
        ssl_sock.getpeercert.return_value = {"notAfter": "Dec 31 23:59:59 2099 GMT"}
        ssl_ctx = mock.MagicMock()
        ssl_ctx.wrap_socket.return_value = ssl_sock

        def _make_urlopen(ws_outcome):
            def _urlopen(req, timeout=10):
                url = req.full_url
                if url.endswith("/ws/k8s"):
                    if isinstance(ws_outcome, Exception):
                        raise ws_outcome
                    resp = mock.MagicMock()
                    resp.__enter__.return_value = resp
                    resp.status = ws_outcome
                    return resp
                resp = mock.MagicMock()
                resp.__enter__.return_value = resp
                if url.endswith("/healthz"):
                    resp.status, resp.read.return_value = 200, b'{"service":"k8s-streamer"}'
                elif url.endswith("/api/v1/workspaces"):
                    raise urllib.error.HTTPError(url, 401, "Unauthorized", {}, None)  # type: ignore[arg-type]
                else:
                    resp.status, resp.read.return_value = 200, b"ok"
                return resp
            return _urlopen

        cases = [
            (False, urllib.error.HTTPError("u", 401, "Unauthorized", {}, None), True),  # type: ignore[arg-type]
            (False, 200, False),
            (False, 101, False),
            (False, urllib.error.HTTPError("u", 400, "Bad Request", {}, None), False),  # type: ignore[arg-type]
            (False, urllib.error.HTTPError("u", 404, "Not Found", {}, None), False),  # type: ignore[arg-type]
            (False, urllib.error.HTTPError("u", 502, "Bad Gateway", {}, None), False),  # type: ignore[arg-type]
            (False, urllib.error.URLError("refused"), False),
            (True, 101, True),
            (True, urllib.error.HTTPError("u", 400, "Bad Request", {}, None), True),  # type: ignore[arg-type]
            (True, urllib.error.HTTPError("u", 401, "Unauthorized", {}, None), False),  # type: ignore[arg-type]
        ]
        with (
            mock.patch("socket.create_connection", return_value=sock_cm),
            mock.patch("ssl.create_default_context", return_value=ssl_ctx),
        ):
            for allow_anon, outcome, expected_ok in cases:
                with mock.patch.object(cloud_host_runner.urllib.request, "urlopen", side_effect=_make_urlopen(outcome)):
                    ok, errs = cloud_host_runner.verify_deployment_health("envscale.duckdns.org", allow_anonymous_ws=allow_anon)
                self.assertEqual(ok, expected_ok, f"allow_anon={allow_anon}, outcome={outcome}, errs={errs}")

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
        with tempfile.TemporaryDirectory() as td:
            tf_state = pathlib.Path(td) / "terraform.tfstate"
            tf_state.write_text(json.dumps({"version": 4, "serial": 1, "lineage": "lin-test", "resources": []}), encoding="utf-8")
            with (
                mock.patch.object(cloud_deployer, "TERRAFORM_DIR", td),
                mock.patch.object(deployer, "get_aws_context", return_value={"account_id": "123", "region": "ap-south-1", "s3_bucket": "bkt"}),
                mock.patch.object(deployer, "_run_cmd") as mock_cmd,
                mock.patch("scripts.lib.tfstate_sync._head_remote_tfstate", return_value=False),
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
        self.assertIn("sync-ssm-secrets.py --ssm-prefix /envscale/prod --region", cd_yml)

    def test_cd_workflow_gates_production_deploy_with_no_host_fallback(self):
        cd_yml = (REPO_ROOT / ".github/workflows/cd.yml").read_text(encoding="utf-8")
        self.assertIn("force_deploy_gate:", cd_yml)
        self.assertIn("check-deploy-target:", cd_yml)
        self.assertIn("ec2_configured:", cd_yml)
        self.assertLess(cd_yml.index("check-deploy-target:"), cd_yml.index("\n  deploy:\n"))
        self.assertIn("needs: [generate-manifest, check-deploy-target]", cd_yml)
        self.assertIn("if: needs.check-deploy-target.outputs.ec2_configured == 'true'", cd_yml)
        self.assertLess(
            cd_yml.index("if: needs.check-deploy-target.outputs.ec2_configured == 'true'"),
            cd_yml.index("environment: production"),
        )
        self.assertLess(
            cd_yml.index("Configure AWS Deploy Credentials"),
            cd_yml.index("aws ec2 describe-instances"),
        )
        self.assertIn("deploy-fallback-summary:", cd_yml)
        self.assertIn("safe.directory /opt/envscale", cd_yml)
        self.assertIn("/bin/bash -c", cd_yml)
        self.assertIn("if: needs.check-deploy-target.outputs.ec2_configured != 'true'", cd_yml)
        self.assertIn("$GITHUB_STEP_SUMMARY", cd_yml)

    def test_foundation_workflow_uses_oidc_plan_validator_and_idempotency(self):
        foundation_yml = (REPO_ROOT / ".github/workflows/foundation.yml").read_text(encoding="utf-8")
        self.assertIn("workflow_dispatch:", foundation_yml)
        self.assertIn('default: "plan-only"', foundation_yml)
        self.assertIn("environment: foundation", foundation_yml)
        self.assertIn("id-token: write", foundation_yml)
        self.assertIn("aws-actions/configure-aws-credentials@v4", foundation_yml)
        self.assertIn("AWS_FOUNDATION_ROLE_ARN", foundation_yml)
        self.assertNotIn("AWS_ACCESS_KEY_ID", foundation_yml)
        self.assertNotIn("AWS_SECRET_ACCESS_KEY", foundation_yml)
        self.assertNotIn("dynamodb", foundation_yml.lower())
        self.assertIn("use_lockfile = true", foundation_yml)
        self.assertIn("validate-foundation-plan.py", foundation_yml)
        self.assertIn("APPLY-FOUNDATION", foundation_yml)
        self.assertLess(
            foundation_yml.index("validate-foundation-plan.py --mode"),
            foundation_yml.index("terraform apply -input=false -auto-approve tfplan.bin"),
        )
        self.assertIn("Verify Post-Apply Idempotency", foundation_yml)

    def test_runtime_and_eks_terraform_enforce_disposable_runtime_tags(self):
        runtime_versions = (REPO_ROOT / "deployment/terraform/versions.tf").read_text(encoding="utf-8")
        eks_versions = (REPO_ROOT / "deployment/terraform-eks/versions.tf").read_text(encoding="utf-8")
        codeowners = (REPO_ROOT / ".github/CODEOWNERS").read_text(encoding="utf-8")

        for tf_text in (runtime_versions, eks_versions):
            self.assertIn("default_tags", tf_text)
            self.assertIn('"EnvScale"', tf_text)
            self.assertIn('"DisposableRuntime"', tf_text)

        for handle in ("@P20000", "@vinit1730", "@Neha874-ctrl", "@ishikaduhan"):
            self.assertIn(handle, codeowners)
        self.assertNotIn("@PranavDwivedi", codeowners)
        self.assertNotIn("@NehaSharma", codeowners)

    def test_run_ssm_command_wraps_commands_in_bash_for_dash_compatibility(self):
        captured = []

        def _fake_subproc(cmd, **kwargs):
            captured.append(cmd)
            if "send-command" in cmd:
                return subprocess.CompletedProcess(cmd, 0, stdout="cmd-123\n", stderr="")
            if "get-command-invocation" in cmd:
                return subprocess.CompletedProcess(cmd, 0, stdout=json.dumps({"Status": "Success", "ResponseCode": 0}), stderr="")
            return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")

        with mock.patch.object(ssm_deployer.subprocess, "run", side_effect=_fake_subproc):
            ssm_deployer.run_ssm_command("i-0123456789abcdef0", ["set -euo pipefail", "printf '%s' 'ok-pipefail' | cat"])

        send_cmd = next(c for c in captured if "send-command" in c)
        params = json.loads(send_cmd[send_cmd.index("--parameters") + 1])
        self.assertEqual(len(params["commands"]), 1)
        self.assertTrue(params["commands"][0].startswith("/bin/bash -c "))

        # Execute wrapped script under /bin/sh to verify dash + single-quote + pipefail safety
        wrapped = ssm_deployer._wrap_commands_for_bash(["set -euo pipefail", "printf '%s' 'ok-pipefail' | cat"])
        proc = subprocess.run(["/bin/sh", "-c", wrapped[0]], capture_output=True, text=True, check=False)
        self.assertEqual(proc.returncode, 0, msg=proc.stderr)
        self.assertEqual(proc.stdout, "ok-pipefail")


if __name__ == "__main__":
    unittest.main()

