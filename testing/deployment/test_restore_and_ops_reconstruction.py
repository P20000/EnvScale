#!/usr/bin/env python3
"""Targeted offline regression tests for PostgreSQL restore, reconstruction orchestration, URL/prefix parity, and CD/bootstrap contracts."""

from __future__ import annotations

import base64
import hashlib
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
SCRIPTS_DIR = REPO_ROOT / "deployment" / "scripts"
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from scripts.lib import cli_app, cloud_deployer, cloud_lifecycle, cloud_ops_dashboard, cloud_orchestrator  # noqa: E402
from scripts.lib.cloud_identity import AwsSessionContext  # noqa: E402

ACCOUNT = "982534376726"
REGION = "ap-south-1"
REC_BUCKET = f"envscale-recovery-{ACCOUNT}-{REGION}"
TF_BUCKET = f"envscale-tfstate-{ACCOUNT}-{REGION}"
RUNTIME_ARN = f"arn:aws:iam::{ACCOUNT}:role/envscale-runtime-provisioner-role"
CALLER_ARN = f"arn:aws:sts::{ACCOUNT}:assumed-role/envscale-runtime-provisioner-role/tc-op"


def _write_exe(path: pathlib.Path, content: str) -> None:
    path.write_text(content, encoding="utf-8")
    path.chmod(path.stat().st_mode | stat.S_IXUSR | stat.S_IRUSR)


class TestDbRestoreScriptOffline(unittest.TestCase):
    """End-to-end offline tests for deployment/scripts/db-restore.sh and envscale.sh restore."""

    def _run_restore_script(
        self,
        args: list[str],
        *,
        toc_output: str = "1; 1234 TABLE public users envscale\n",
        table_count: str = "12",
        mig_count: str = "4",
        row_json: str = '{"users":3,"workspaces":2,"clusters":1,"alert_policies":2,"incidents":1}',
        dump_bytes: bytes = b"PGDMP_FAKE_CUSTOM_ARCHIVE",
        pg_restore_list_rc: int = 0,
    ) -> tuple[subprocess.CompletedProcess[str], pathlib.Path]:
        td = pathlib.Path(tempfile.mkdtemp(prefix="envscale-dbrestore-test-"))
        self.addCleanup(lambda: subprocess.run(["rm", "-rf", str(td)], check=False))

        bin_dir = td / "bin"
        bin_dir.mkdir()
        scripts_copy = td / "scripts"
        scripts_copy.mkdir()
        for fname in ("runtime-common.sh", "db-restore.sh", "runtime-guards.py", "validate-release-manifest.py"):
            src = SCRIPTS_DIR / fname
            dst = scripts_copy / fname
            dst.write_text(src.read_text(encoding="utf-8"), encoding="utf-8")
            if fname.endswith((".sh", ".py")):
                dst.chmod(0o755)
        verify_marker = td / "verify_called.txt"
        _write_exe(
            scripts_copy / "verify.sh",
            f"#!/usr/bin/env bash\necho called > {verify_marker}\nexit 0\n",
        )

        # Fake docker + aws CLI on PATH
        dump_b64 = base64.b64encode(dump_bytes).decode("ascii")
        dump_sha = hashlib.sha256(dump_bytes).hexdigest()
        dump_chk_b64 = base64.b64encode(hashlib.sha256(dump_bytes).digest()).decode("ascii")
        head_payload = json.dumps({"ContentLength": len(dump_bytes), "ChecksumSHA256": dump_chk_b64, "Metadata": {"sha256": dump_sha}})
        _write_exe(
            bin_dir / "aws",
            f"""#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == "s3api" && "$2" == "head-object" ]]; then
  printf '%s\\n' '{head_payload}'
  exit 0
fi
if [[ "$1" == "s3" && "$2" == "cp" ]]; then
  dst="$4"
  printf '%s' "{dump_b64}" | base64 -d > "$dst"
  exit 0
fi
exit 1
""",
        )
        _write_exe(
            bin_dir / "docker",
            f"""#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == "inspect" ]]; then
  echo "true"
  exit 0
fi
if [[ "$1" == "exec" ]]; then
  shift
  while [[ $# -gt 0 && "$1" == -* ]]; do shift; done
  # container name is $1
  shift
  if [[ "$1" == "pg_isready" ]]; then
    exit 0
  fi
  if [[ "$1" == "pg_restore" ]]; then
    for a in "$@"; do
      if [[ "$a" == "--list" ]]; then
        printf '%s' {toc_output!r}
        exit {pg_restore_list_rc}
      fi
    done
    cat >/dev/null
    exit 0
  fi
  if [[ "$1" == "psql" ]]; then
    for a in "$@"; do
      if [[ "$a" == "SELECT count(*) FROM drizzle.__drizzle_migrations;" ]]; then
        echo "{mig_count}"
        exit 0
      fi
    done
    sql="$(cat || true)"
    if grep -q "pg_terminate_backend" <<<"$sql"; then
      exit 0
    elif grep -q "information_schema.tables" <<<"$sql"; then
      echo "{table_count}"
      exit 0
    elif grep -q "json_build_object" <<<"$sql"; then
      echo '{row_json}'
      exit 0
    fi
    exit 0
  fi
fi
if [[ "$1" == "compose" ]]; then
  exit 0
fi
exit 0
""",
        )

        cfg_dir = td / "etc_envscale"
        st_dir = td / "var_envscale"
        cfg_dir.mkdir()
        (st_dir / "releases").mkdir(parents=True)
        env_file = cfg_dir / "rendered.compose.env"
        env_file.write_text('COMPOSE_PROJECT_NAME="envscale"\nPOSTGRES_USER="envscale"\nPOSTGRES_DB="envscale"\n', encoding="utf-8")
        env_file.chmod(0o600)

        env = dict(os.environ)
        env["PATH"] = f"{bin_dir}:{env.get('PATH', '')}"
        env["ENVSCALE_CONFIG_DIR"] = str(cfg_dir)
        env["ENVSCALE_STATE_DIR"] = str(st_dir)
        env["ENVSCALE_LOCK_FILE"] = str(td / "restore.lock")

        res = subprocess.run(
            ["bash", str(scripts_copy / "db-restore.sh"), *args],
            env=env,
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            timeout=30,
        )
        return res, td

    def test_db_restore_success_and_json_result(self):
        dump_bytes = b"PGDMP_VALID_CUSTOM_ARCHIVE_CONTENT"
        sha = hashlib.sha256(dump_bytes).hexdigest()
        res, _ = self._run_restore_script(
            [
                "--bucket", REC_BUCKET,
                "--key", "backups/postgres/backup_20261126T000000Z_i-abc_123456.dump",
                "--expected-sha256", sha,
                "--local-smoke",
                "--skip-verify",
            ],
            dump_bytes=dump_bytes,
        )
        self.assertEqual(res.returncode, 0, msg=res.stderr or res.stdout)
        marker = next(ln for ln in res.stdout.splitlines() if ln.startswith("ENVSCALE_RESTORE_RESULT="))
        payload = json.loads(marker.split("=", 1)[1])
        self.assertEqual(payload["canonical_tables"], 12)
        self.assertEqual(payload["migrations"], 4)
        self.assertEqual(payload["row_counts"]["users"], 3)
        self.assertEqual(payload["sha256"], sha)

    def test_db_restore_fails_closed_on_bad_key_sha_toc_empty_and_missing_tables(self):
        # 1. Invalid key prefix
        r1, _ = self._run_restore_script(["--bucket", REC_BUCKET, "--key", "releases/foo.json"])
        self.assertNotEqual(r1.returncode, 0)

        # 2. SHA-256 mismatch
        r2, _ = self._run_restore_script(
            ["--bucket", REC_BUCKET, "--key", "backups/postgres/b.dump", "--expected-sha256", "0" * 64, "--local-smoke"]
        )
        self.assertNotEqual(r2.returncode, 0)
        self.assertIn("SHA-256 mismatch", r2.stderr)

        # 3. Empty 0-byte dump
        r3, _ = self._run_restore_script(
            ["--bucket", REC_BUCKET, "--key", "backups/postgres/b.dump", "--local-smoke"],
            dump_bytes=b"",
        )
        self.assertNotEqual(r3.returncode, 0)
        self.assertIn("empty", r3.stderr)

        # 4. Corrupt archive TOC
        r4, _ = self._run_restore_script(
            ["--bucket", REC_BUCKET, "--key", "backups/postgres/b.dump", "--local-smoke"],
            pg_restore_list_rc=1,
        )
        self.assertNotEqual(r4.returncode, 0)
        self.assertIn("pg_restore --list failed", r4.stderr)

        # 5. Missing canonical tables post-restore (< 12)
        r5, _ = self._run_restore_script(
            ["--bucket", REC_BUCKET, "--key", "backups/postgres/b.dump", "--local-smoke"],
            table_count="8",
        )
        self.assertNotEqual(r5.returncode, 0)
        self.assertIn("expected 12 canonical public tables", r5.stderr)

    def test_envscale_sh_routes_restore_to_db_restore(self):
        txt = (REPO_ROOT / "envscale.sh").read_text(encoding="utf-8")
        self.assertIn("restore)", txt)
        self.assertIn("db-restore.sh", txt)


class TestOpsReconstructionAndContracts(unittest.TestCase):
    """Offline tests for restore/reconstruct orchestration, state sync, URL/prefix fixes, and CD/bootstrap contracts."""

    def test_fetch_ops_snapshot_uses_postgres_prefix_and_duckdns_url_without_local_token(self):
        seen_s3 = []

        def _fake_aws(args, aws_env=None):
            if args[0] == "s3api":
                seen_s3.append(args)
                return subprocess.CompletedProcess(
                    args, 0,
                    stdout=json.dumps({"Contents": [{"Key": "backups/postgres/b1.dump", "Size": 100, "LastModified": "2026-11-26T00:00:00Z"}]}),
                    stderr="",
                )
            if args[0] == "ec2":
                return subprocess.CompletedProcess(args, 0, stdout=json.dumps({"Reservations": [{"Instances": [{"State": {"Name": "running"}, "PublicIpAddress": "1.2.3.4"}]}]}), stderr="")
            return subprocess.CompletedProcess(args, 0, stdout=json.dumps({"InstanceInformationList": [{"PingStatus": "Online"}]}), stderr="")

        with (
            mock.patch.object(cloud_ops_dashboard.CloudDeployer, "get_instance_id", return_value="i-0abc"),
            mock.patch.object(cloud_ops_dashboard.CloudDeployer, "get_public_ip", return_value="1.2.3.4"),
            mock.patch.object(cloud_ops_dashboard.CloudDeployer, "_get_tf_outputs", return_value={}),
            mock.patch.object(cloud_ops_dashboard.CloudDeployer, "get_aws_context", return_value={"account_id": ACCOUNT, "region": REGION, "recovery_bucket": REC_BUCKET}),
            mock.patch.object(cloud_ops_dashboard, "_aws_cmd", side_effect=_fake_aws),
            mock.patch.object(cloud_ops_dashboard, "run_ssm_command", return_value=subprocess.CompletedProcess([], 0, stdout="", stderr="")),
            mock.patch.object(cloud_ops_dashboard, "verify_deployment_health", return_value=(True, [])),
            mock.patch.object(cloud_ops_dashboard, "load_deployment_env", return_value={"DUCKDNS_DOMAIN": "envscale-demo", "DUCKDNS_TOKEN": ""}),
        ):
            snap = cloud_ops_dashboard.fetch_ops_snapshot(include_http_health=True)

        self.assertEqual(snap["health"]["target_url"], "https://envscale-demo.duckdns.org")
        self.assertEqual(seen_s3[0][seen_s3[0].index("--prefix") + 1], "backups/postgres/")

    def test_trigger_remote_restore_selects_latest_verifies_head_and_parses_result(self):
        sha = "a" * 64
        chk_b64 = base64.b64encode(bytes.fromhex(sha)).decode("ascii")
        ssm_out = 'ENVSCALE_RESTORE_RESULT={"source":"s3://b/k","size":2048,"sha256":"' + sha + '","toc_entries":14,"canonical_tables":12,"migrations":4,"row_counts":{"users":5},"verify_passed":true}'

        def _fake_aws(args, aws_env=None):
            if "get-bucket-location" in args:
                return subprocess.CompletedProcess(args, 0, stdout='{"LocationConstraint":"ap-south-1"}', stderr="")
            if "list-objects-v2" in args:
                return subprocess.CompletedProcess(
                    args, 0,
                    stdout=json.dumps({"Contents": [{"Key": "backups/postgres/latest.dump", "Size": 2048, "LastModified": "2026-11-26T05:00:00Z"}]}),
                    stderr="",
                )
            if "head-object" in args:
                return subprocess.CompletedProcess(
                    args, 0,
                    stdout=json.dumps({"ContentLength": 2048, "ChecksumSHA256": chk_b64, "Metadata": {"sha256": sha}}),
                    stderr="",
                )
            return subprocess.CompletedProcess(args, 1, stdout="", stderr="unexpected")

        with (
            mock.patch.object(cloud_ops_dashboard.CloudDeployer, "get_instance_id", return_value="i-0abc"),
            mock.patch.object(cloud_ops_dashboard.CloudDeployer, "get_aws_context", return_value={"account_id": ACCOUNT, "region": REGION}),
            mock.patch.object(cloud_ops_dashboard, "_aws_cmd", side_effect=_fake_aws),
            mock.patch.object(cloud_ops_dashboard, "run_ssm_command", return_value=subprocess.CompletedProcess([], 0, stdout=ssm_out, stderr="")) as m_ssm,
            mock.patch.object(cloud_ops_dashboard, "load_deployment_env", return_value={}),
        ):
            res = cloud_ops_dashboard.trigger_remote_restore()

        self.assertEqual(res["key"], "backups/postgres/latest.dump")
        self.assertEqual(res["canonical_tables"], 12)
        self.assertTrue(res["verify_passed"])
        cmd_line = "\n".join(m_ssm.call_args.args[1])
        self.assertIn("/opt/envscale/envscale.sh restore", cmd_line)
        self.assertIn(f"--expected-sha256 {sha}", cmd_line)

    def test_cloud_deployer_state_backup_uses_canonical_tfstate_runtime_key(self):
        deployer = cloud_deployer.CloudDeployer(log_fn=lambda _: None)
        with tempfile.TemporaryDirectory() as td:
            tf_state = pathlib.Path(td) / "terraform.tfstate"
            tf_state.write_text(json.dumps({"version": 4, "serial": 2, "lineage": "lin-a", "resources": []}), encoding="utf-8")
            with (
                mock.patch.object(cloud_deployer, "TERRAFORM_DIR", td),
                mock.patch.object(deployer, "get_aws_context", return_value={"account_id": ACCOUNT, "region": REGION, "s3_bucket": REC_BUCKET}),
                mock.patch.object(deployer, "_run_cmd") as m_cmd,
                mock.patch("scripts.lib.tfstate_sync._head_remote_tfstate", return_value=False),
            ):
                deployer.backup_to_s3()
            cmd = m_cmd.call_args.args[0]
            self.assertIn(f"s3://{TF_BUCKET}/runtime/terraform.tfstate", cmd)

    def test_destroy_and_reconstruct_sync_pipeline_state(self):
        with tempfile.TemporaryDirectory() as td:
            td_p = pathlib.Path(td)
            store = cloud_orchestrator.PipelineStateStore(td_p / "state.json")
            manifest_f = td_p / "release-manifest.json"
            manifest_f.write_text('{"git":{"commit_sha":"deadbeef1234"}}', encoding="utf-8")
            store.update_context(instance_id="i-old", public_ip="1.2.3.4", app_url="https://old.example", manifest_path=str(manifest_f))
            for sid in cloud_orchestrator.STAGE_IDS:
                store.update_stage(sid, "completed", summary="ok")

            rt_sess = AwsSessionContext(
                account_id=ACCOUNT, region=REGION, caller_arn=CALLER_ARN, role_arn=RUNTIME_ARN,
                expires_at_utc="2099-01-01T00:00:00Z",
                _creds={"AccessKeyId": "AK", "SecretAccessKey": "SK", "SessionToken": "ST"},
            )
            orch = cloud_orchestrator.CloudOrchestrator(runtime_session=rt_sess, state_store=store)

            with (
                mock.patch.object(orch, "_require_verified_runtime_env", return_value={"AWS_REGION": REGION}),
                mock.patch.object(cloud_lifecycle, "verify_destroy_target_environment", return_value={"verified": True, "instance_id": "i-old"}),
                mock.patch.object(cloud_lifecycle, "verify_destroy_cleanup", return_value={"verified": True, "remaining_resources": 0}),
                mock.patch.object(cloud_lifecycle.CloudDeployer, "infra_destroy", return_value={"bucket": REC_BUCKET, "key": "backups/postgres/b1.dump", "content_length": 4096, "sha256": "b" * 64}),
            ):
                d_res = orch.destroy_runtime()
            self.assertEqual(d_res["status"], "completed")
            st_after_destroy = store.load()
            self.assertEqual(st_after_destroy["context"]["instance_id"], "")
            self.assertEqual(st_after_destroy["context"]["last_backup_key"], "backups/postgres/b1.dump")
            self.assertEqual(st_after_destroy["stages"]["provision"]["status"], "pending")
            self.assertEqual(st_after_destroy["stages"]["deploy"]["status"], "pending")
            self.assertEqual(st_after_destroy["stages"]["verify"]["status"], "pending")

            with (
                mock.patch.object(orch, "_require_verified_runtime_env", return_value={"AWS_REGION": REGION}),
                mock.patch.object(cloud_orchestrator.CloudDeployer, "provision_host", return_value={"instance_id": "i-new", "ip": "5.6.7.8"}),
                mock.patch.object(cloud_orchestrator.CloudDeployer, "deploy", return_value=None),
                mock.patch.object(cloud_orchestrator.CloudDeployer, "get_public_ip", return_value="5.6.7.8"),
                mock.patch.object(cloud_orchestrator.CloudDeployer, "get_instance_id", return_value="i-new"),
                mock.patch.object(cloud_orchestrator.CloudDeployer, "_get_tf_outputs", return_value={}),
                mock.patch.object(cloud_lifecycle, "trigger_remote_restore", return_value={"key": "backups/postgres/b1.dump", "s3_uri": f"s3://{REC_BUCKET}/backups/postgres/b1.dump", "canonical_tables": 12, "row_counts": {"users": 5}, "verify_passed": True}),
                mock.patch.object(cloud_orchestrator, "fetch_ops_snapshot", return_value={"ec2": {"state": "running"}, "ssm": {"ping_status": "Online"}, "health": {"ok": True, "target_url": "https://envscale.duckdns.org"}}),
            ):
                r_res = orch.reconstruct_runtime(manifest_path=str(manifest_f), target_sha="deadbeef1234")
            self.assertEqual(r_res["status"], "completed")
            st_final = store.load()
            self.assertEqual(st_final["context"]["instance_id"], "i-new")
            self.assertEqual(st_final["context"]["last_restore_key"], "backups/postgres/b1.dump")
            self.assertEqual(st_final["stages"]["verify"]["status"], "completed")

    def test_cli_ops_destroy_restore_reconstruct_cd_and_userdata_contracts(self):
        runner = CliRunner()
        for sub in ("destroy", "restore", "reconstruct"):
            res = runner.invoke(cli_app.cli, ["ops", sub, "--help"])
            self.assertEqual(res.exit_code, 0, msg=res.output)

        cd_yml = (REPO_ROOT / ".github/workflows/cd.yml").read_text(encoding="utf-8")
        self.assertIn("CD Live SSM Rollout Summary", cd_yml)
        self.assertIn("Verify External HTTPS Application Endpoints", cd_yml)

        ud_tpl = (REPO_ROOT / "deployment/terraform/user_data.sh.tpl").read_text(encoding="utf-8")
        self.assertIn("Failed cloning EnvScale repository into /opt/envscale", ud_tpl)
        self.assertNotIn("git clone -b develop https://github.com/P20000/EnvScale.git /opt/envscale || mkdir", ud_tpl)


if __name__ == "__main__":
    unittest.main()
