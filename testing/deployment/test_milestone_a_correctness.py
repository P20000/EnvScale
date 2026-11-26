#!/usr/bin/env python3
"""Targeted pre-push correctness tests for Milestone A: tfstate sync, restore integrity, lifecycle state, CD & bootstrap."""

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

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
SCRIPTS_DIR = REPO_ROOT / "deployment" / "scripts"
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from scripts.lib import cloud_lifecycle, cloud_ops_dashboard, cloud_orchestrator, tfstate_sync  # noqa: E402
from scripts.lib.cloud_identity import AwsSessionContext  # noqa: E402

ACCOUNT = "982534376726"
REGION = "ap-south-1"
REC_BUCKET = f"envscale-recovery-{ACCOUNT}-{REGION}"
TF_BUCKET = f"envscale-tfstate-{ACCOUNT}-{REGION}"
RUNTIME_ARN = f"arn:aws:iam::{ACCOUNT}:role/envscale-runtime-provisioner-role"
CALLER_ARN = f"arn:aws:sts::{ACCOUNT}:assumed-role/envscale-runtime-provisioner-role/tc-op"


def _tfstate(serial: int = 1, lineage: str = "lin-a", resources: list | None = None) -> bytes:
    payload = {"version": 4, "serial": serial, "lineage": lineage, "resources": resources if resources is not None else []}
    return json.dumps(payload).encode("utf-8")


def _write_exe(path: pathlib.Path, content: str) -> None:
    path.write_text(content, encoding="utf-8")
    path.chmod(path.stat().st_mode | stat.S_IXUSR | stat.S_IRUSR)


class TestTerraformStateSyncCorrectness(unittest.TestCase):
    """Area 1: Verify safe manual Terraform state S3 backup/restore without accidental overwrites."""

    def test_tfstate_bucket_and_key_rejects_invalid_scope(self):
        self.assertEqual(tfstate_sync.tfstate_bucket_and_key(ACCOUNT, REGION), (TF_BUCKET, "runtime/terraform.tfstate"))
        for acct, reg in (("", REGION), (ACCOUNT, ""), ("bad/acct", REGION), (ACCOUNT, "ap south")):
            with self.assertRaises(ValueError):
                tfstate_sync.tfstate_bucket_and_key(acct, reg)

    def test_missing_local_or_remote_skips_and_head_error_fails_closed(self):
        with tempfile.TemporaryDirectory() as td:
            local_p = pathlib.Path(td) / "terraform.tfstate"
            b_res = tfstate_sync.safe_backup_tfstate_to_s3(local_path=local_p, account_id=ACCOUNT, region=REGION)
            self.assertEqual(b_res["status"], "skipped")

            def _not_found(cmd, **_kw):
                return subprocess.CompletedProcess(cmd, 255, stdout="", stderr="An error occurred (404) when calling the HeadObject operation: Not Found")

            r_res = tfstate_sync.safe_restore_tfstate_from_s3(local_path=local_p, account_id=ACCOUNT, region=REGION, run_fn=_not_found)
            self.assertEqual(r_res["status"], "skipped")
            self.assertEqual(r_res["reason"], "remote_missing")

            def _denied(cmd, **_kw):
                return subprocess.CompletedProcess(cmd, 255, stdout="", stderr="AccessDenied: Forbidden")

            with self.assertRaises(RuntimeError):
                tfstate_sync.safe_restore_tfstate_from_s3(local_path=local_p, account_id=ACCOUNT, region=REGION, run_fn=_denied)

    def test_rejects_empty_malformed_and_incomplete_state(self):
        with tempfile.TemporaryDirectory() as td:
            td_p = pathlib.Path(td)
            for idx, raw in enumerate((b"", b"{bad-json", b'{"version":4,"serial":1,"resources":[]}', b'{"version":4,"lineage":"x","resources":[]}', b'{"version":4,"serial":1,"lineage":"x"}')):
                p = td_p / f"bad_{idx}.tfstate"
                p.write_bytes(raw)
                with self.assertRaises(RuntimeError):
                    tfstate_sync.safe_backup_tfstate_to_s3(local_path=p, account_id=ACCOUNT, region=REGION)

            # Corrupt remote download is rejected during restore and leaves local untouched
            local_p = td_p / "terraform.tfstate"
            def _bad_dl(cmd, **_kw):
                if cmd[:3] == ["aws", "s3api", "head-object"]:
                    return subprocess.CompletedProcess(cmd, 0, stdout="{}", stderr="")
                pathlib.Path(cmd[4]).write_bytes(b"{corrupt")
                return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")

            with self.assertRaises(RuntimeError):
                tfstate_sync.safe_restore_tfstate_from_s3(local_path=local_p, account_id=ACCOUNT, region=REGION, run_fn=_bad_dl)
            self.assertFalse(local_p.exists())
            self.assertEqual(list(td_p.glob(".terraform.tfstate.dl.*")), [])

    def test_failed_download_cleans_temp_and_preserves_existing_state(self):
        with tempfile.TemporaryDirectory() as td:
            td_p = pathlib.Path(td)
            local_p = td_p / "terraform.tfstate"
            orig = _tfstate(serial=5, lineage="lin-orig", resources=[{"type": "aws_instance"}])
            local_p.write_bytes(orig)

            def _fail_cp(cmd, **_kw):
                if cmd[:3] == ["aws", "s3api", "head-object"]:
                    return subprocess.CompletedProcess(cmd, 0, stdout="{}", stderr="")
                pathlib.Path(cmd[4]).write_bytes(b'{"partial":')
                return subprocess.CompletedProcess(cmd, 1, stdout="", stderr="connection reset")

            with self.assertRaises(RuntimeError):
                tfstate_sync.safe_restore_tfstate_from_s3(local_path=local_p, account_id=ACCOUNT, region=REGION, run_fn=_fail_cp)
            self.assertEqual(local_p.read_bytes(), orig)
            self.assertEqual(list(td_p.glob(".terraform.tfstate.dl.*")), [])

    def test_backup_refuses_newer_diverged_or_foreign_remote_and_uploads_newer_local(self):
        with tempfile.TemporaryDirectory() as td:
            local_p = pathlib.Path(td) / "terraform.tfstate"
            uploaded = []

            def _runner(remote_bytes: bytes):
                def _fn(cmd, **_kw):
                    if cmd[:3] == ["aws", "s3api", "head-object"]:
                        return subprocess.CompletedProcess(cmd, 0, stdout="{}", stderr="")
                    if cmd[:3] == ["aws", "s3", "cp"] and cmd[3].startswith("s3://"):
                        pathlib.Path(cmd[4]).write_bytes(remote_bytes)
                        return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")
                    uploaded.append(cmd)
                    return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")
                return _fn

            local_p.write_bytes(_tfstate(serial=2, lineage="lin-a"))
            with self.assertRaises(RuntimeError):
                tfstate_sync.safe_backup_tfstate_to_s3(local_path=local_p, account_id=ACCOUNT, region=REGION, run_fn=_runner(_tfstate(serial=4, lineage="lin-a")))

            local_p.write_bytes(_tfstate(serial=4, lineage="lin-a", resources=[{"type": "aws_vpc"}]))
            with self.assertRaises(RuntimeError):
                tfstate_sync.safe_backup_tfstate_to_s3(local_path=local_p, account_id=ACCOUNT, region=REGION, run_fn=_runner(_tfstate(serial=4, lineage="lin-a")))

            with self.assertRaises(RuntimeError):
                tfstate_sync.safe_backup_tfstate_to_s3(local_path=local_p, account_id=ACCOUNT, region=REGION, run_fn=_runner(_tfstate(serial=1, lineage="lin-other", resources=[{"type": "aws_eip"}])))

            local_p.write_bytes(_tfstate(serial=5, lineage="lin-a", resources=[{"type": "aws_vpc"}]))
            ok = tfstate_sync.safe_backup_tfstate_to_s3(local_path=local_p, account_id=ACCOUNT, region=REGION, run_fn=_runner(_tfstate(serial=4, lineage="lin-a")))
            self.assertEqual(ok["status"], "uploaded")
            self.assertIn(f"s3://{TF_BUCKET}/runtime/terraform.tfstate", uploaded[0])

    def test_restore_refuses_older_remote_diverged_or_foreign_and_restores_newer(self):
        with tempfile.TemporaryDirectory() as td:
            local_p = pathlib.Path(td) / "terraform.tfstate"

            def _runner(remote_bytes: bytes):
                def _fn(cmd, **_kw):
                    if cmd[:3] == ["aws", "s3api", "head-object"]:
                        return subprocess.CompletedProcess(cmd, 0, stdout="{}", stderr="")
                    pathlib.Path(cmd[4]).write_bytes(remote_bytes)
                    return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")
                return _fn

            local_p.write_bytes(_tfstate(serial=6, lineage="lin-a", resources=[{"type": "aws_instance"}]))
            with self.assertRaises(RuntimeError):
                tfstate_sync.safe_restore_tfstate_from_s3(local_path=local_p, account_id=ACCOUNT, region=REGION, run_fn=_runner(_tfstate(serial=5, lineage="lin-a")))
            with self.assertRaises(RuntimeError):
                tfstate_sync.safe_restore_tfstate_from_s3(local_path=local_p, account_id=ACCOUNT, region=REGION, run_fn=_runner(_tfstate(serial=6, lineage="lin-a")))
            with self.assertRaises(RuntimeError):
                tfstate_sync.safe_restore_tfstate_from_s3(local_path=local_p, account_id=ACCOUNT, region=REGION, run_fn=_runner(_tfstate(serial=9, lineage="lin-b")))

            newer = _tfstate(serial=7, lineage="lin-a", resources=[{"type": "aws_instance", "id": "i-new"}])
            res = tfstate_sync.safe_restore_tfstate_from_s3(local_path=local_p, account_id=ACCOUNT, region=REGION, run_fn=_runner(newer))
            self.assertEqual(res["status"], "restored")
            self.assertEqual(local_p.read_bytes(), newer)


class TestPostgresRestoreIntegrityAndFailures(unittest.TestCase):
    """Area 2: Verify db-restore.sh fail-closed behavior, cleanup, and mocked app-record preservation."""

    def _run_harnesses(self, *, args=None, non_smoke=False, missing_env=False, missing_manifest=False, aws_cp_rc=0, inspect_out="true", pg_restore_rc=0, mig_rc=0, mig_out="4", compose_run_rc=0, compose_up_rc=0, verify_rc=0, db_records=None):
        td = pathlib.Path(tempfile.mkdtemp(prefix="envscale-m1a-db-"))
        self.addCleanup(lambda: subprocess.run(["rm", "-rf", str(td)], check=False))
        bin_dir, scripts_copy, tmp_dir = td / "bin", td / "scripts", td / "tmp"
        bin_dir.mkdir(); scripts_copy.mkdir(); tmp_dir.mkdir()
        for fn in ("runtime-common.sh", "db-restore.sh", "runtime-guards.py", "validate-release-manifest.py"):
            dst = scripts_copy / fn
            dst.write_text((SCRIPTS_DIR / fn).read_text(encoding="utf-8"), encoding="utf-8")
            dst.chmod(0o755)
        _write_exe(scripts_copy / "verify.sh", f"#!/usr/bin/env bash\nexit {verify_rc}\n")

        seed_payload = db_records or {"users": [{"email": "canary@envscale.dev"}], "workspaces": [{"slug": "envscale-recon-canary"}], "clusters": [{"name": "prod-eks-canary"}]}
        dump_bytes = json.dumps(seed_payload, sort_keys=True).encode("utf-8")
        dump_sha = hashlib.sha256(dump_bytes).hexdigest()
        chk_b64 = base64.b64encode(hashlib.sha256(dump_bytes).digest()).decode("ascii")
        head_json = json.dumps({"ContentLength": len(dump_bytes), "ChecksumSHA256": chk_b64, "Metadata": {"sha256": dump_sha}})
        live_db = td / "live_db.json"
        live_db.write_text('{"wiped":true}', encoding="utf-8")

        _write_exe(
            bin_dir / "aws",
            f"""#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == "s3api" && "$2" == "head-object" ]]; then printf '%s\\n' '{head_json}'; exit 0; fi
if [[ "$1" == "s3" && "$2" == "cp" ]]; then
  [[ {aws_cp_rc} -eq 0 ]] || exit {aws_cp_rc}
  printf '%s' "{base64.b64encode(dump_bytes).decode('ascii')}" | base64 -d > "$4"
  exit 0
fi
exit 1
""",
        )
        _write_exe(
            bin_dir / "docker",
            f"""#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == "inspect" ]]; then echo "{inspect_out}"; exit 0; fi
if [[ "$1" == "compose" ]]; then
  shift
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --env-file|-f) shift 2 ;;
      run) exit {compose_run_rc} ;;
      up) exit {compose_up_rc} ;;
      stop) exit 0 ;;
      *) shift ;;
    esac
  done
  exit 0
fi
if [[ "$1" == "exec" ]]; then
  shift
  while [[ $# -gt 0 && "$1" == -* ]]; do shift; done
  shift
  [[ "$1" == "pg_isready" ]] && exit 0
  if [[ "$1" == "pg_restore" ]]; then
    for a in "$@"; do [[ "$a" == "--list" ]] && {{ echo "1; 1 TABLE public users envscale"; exit 0; }}; done
    [[ {pg_restore_rc} -eq 0 ]] || exit {pg_restore_rc}
    cat > "{live_db}"
    exit 0
  fi
  if [[ "$1" == "psql" ]]; then
    for a in "$@"; do
      if [[ "$a" == "SELECT count(*) FROM drizzle.__drizzle_migrations;" ]]; then
        [[ {mig_rc} -eq 0 ]] || exit {mig_rc}
        echo "{mig_out}"; exit 0
      fi
    done
    sql="$(cat || true)"
    grep -q "pg_terminate_backend" <<<"$sql" && exit 0
    grep -q "information_schema.tables" <<<"$sql" && {{ echo "12"; exit 0; }}
    if grep -q "json_build_object" <<<"$sql"; then
      python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(json.dumps(dict(users=len(d["users"]),workspaces=len(d["workspaces"]),clusters=len(d["clusters"]),alert_policies=1,incidents=1),separators=(",",":")))' "{live_db}"
      exit 0
    fi
  fi
fi
exit 0
""",
        )
        cfg_dir, st_dir = td / "etc", td / "var"
        cfg_dir.mkdir(); (st_dir / "releases").mkdir(parents=True)
        if not missing_env:
            env_f = cfg_dir / "rendered.compose.env"
            env_f.write_text('COMPOSE_PROJECT_NAME="envscale"\nPOSTGRES_USER="envscale"\nPOSTGRES_DB="envscale"\n', encoding="utf-8")
            env_f.chmod(0o600)
        if not missing_manifest:
            (st_dir / "releases" / "last-known-good.manifest.json").write_text('{"release_id":"rel-1","git":{"commit_sha":"deadbeef"},"images":{"api_server":{"pinned_ref":"a@sha256:' + ("0" * 64) + '"},"k8s_streamer":{"pinned_ref":"b@sha256:' + ("0" * 64) + '"},"web":{"pinned_ref":"c@sha256:' + ("0" * 64) + '"}},"compatibility":{"drizzle_migrations_bundle_sha256":"' + ("0" * 64) + '","drizzle_journal_entries":1,"drizzle_migrations":[{"tag":"0000"}],"backward_compatible_db":true}}', encoding="utf-8")

        run_args = args or (["--bucket", REC_BUCKET, "--key", "backups/postgres/canary.dump"] if non_smoke else ["--bucket", REC_BUCKET, "--key", "backups/postgres/canary.dump", "--local-smoke", "--skip-verify"])
        env = dict(os.environ, PATH=f"{bin_dir}:{os.environ.get('PATH', '')}", ENVSCALE_CONFIG_DIR=str(cfg_dir), ENVSCALE_STATE_DIR=str(st_dir), ENVSCALE_LOCK_FILE=str(td / "restore.lock"), TMPDIR=str(tmp_dir))
        res = subprocess.run(["bash", str(scripts_copy / "db-restore.sh"), *run_args], env=env, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=30)
        leftover_tmps = [p.name for p in tmp_dir.iterdir()]
        return res, live_db, leftover_tmps

    def test_mocked_backup_wipe_restore_preserves_recognizable_application_record(self):
        """Deterministic mocked contract test proving recognizable records survive wipe + db-restore.sh (NOT a live Postgres test)."""
        records = {"users": [{"id": "u-1", "email": "canary@envscale.dev"}], "workspaces": [{"id": "w-1", "slug": "envscale-recon-canary"}], "clusters": [{"id": "c-1", "name": "prod-eks-canary"}]}
        res, live_db, leftover = self._run_harnesses(non_smoke=True, db_records=records)
        self.assertEqual(res.returncode, 0, msg=res.stderr or res.stdout)
        self.assertEqual(leftover, [])
        restored = json.loads(live_db.read_text(encoding="utf-8"))
        self.assertEqual(restored["workspaces"][0]["slug"], "envscale-recon-canary")
        self.assertEqual(restored["users"][0]["email"], "canary@envscale.dev")
        self.assertEqual(restored["clusters"][0]["name"], "prod-eks-canary")
        marker = next(ln for ln in res.stdout.splitlines() if ln.startswith("ENVSCALE_RESTORE_RESULT="))
        payload = json.loads(marker.split("=", 1)[1])
        self.assertTrue(payload["verify_passed"])
        self.assertEqual(payload["canonical_tables"], 12)

    def test_db_restore_fail_closed_matrix_and_temp_cleanup(self):
        cases = (
            ("s3_cp_fail", {"aws_cp_rc": 1}),
            ("mig_query_fail", {"mig_rc": 1}),
            ("mig_zero", {"mig_out": "0"}),
            ("container_down", {"inspect_out": "false"}),
            ("pg_restore_fail", {"pg_restore_rc": 1}),
            ("migrate_fail", {"non_smoke": True, "compose_run_rc": 1}),
            ("restart_fail", {"non_smoke": True, "compose_up_rc": 1}),
            ("verify_fail", {"non_smoke": True, "verify_rc": 1}),
            ("missing_env", {"non_smoke": True, "missing_env": True}),
            ("missing_manifest", {"non_smoke": True, "missing_manifest": True}),
        )
        for name, kw in cases:
            with self.subTest(case=name):
                res, _, leftover = self._run_harnesses(**kw)
                self.assertNotEqual(res.returncode, 0, msg=f"{name} unexpectedly succeeded")
                self.assertNotIn("ENVSCALE_RESTORE_RESULT=", res.stdout)
                self.assertEqual(leftover, [])

    def test_trigger_remote_restore_fail_closed_contracts(self):
        sha = "b" * 64
        chk_b64 = base64.b64encode(bytes.fromhex(sha)).decode("ascii")

        def _aws(args, aws_env=None, newest_size=2048, meta_sha=sha):
            if "get-bucket-location" in args:
                return subprocess.CompletedProcess(args, 0, stdout='{"LocationConstraint":"ap-south-1"}', stderr="")
            if "list-objects-v2" in args:
                return subprocess.CompletedProcess(args, 0, stdout=json.dumps({"Contents": [{"Key": "backups/postgres/newest.dump", "Size": newest_size, "LastModified": "2026-11-26T06:00:00Z"}, {"Key": "backups/postgres/older.dump", "Size": 1024, "LastModified": "2026-11-26T05:00:00Z"}]}), stderr="")
            if "head-object" in args:
                return subprocess.CompletedProcess(args, 0, stdout=json.dumps({"ContentLength": 2048, "ChecksumSHA256": chk_b64, "Metadata": {"sha256": meta_sha}}), stderr="")
            return subprocess.CompletedProcess(args, 1, stdout="", stderr="err")

        base_patches = (
            mock.patch.object(cloud_ops_dashboard.CloudDeployer, "get_instance_id", return_value="i-0abc"),
            mock.patch.object(cloud_ops_dashboard.CloudDeployer, "get_aws_context", return_value={"account_id": ACCOUNT, "region": REGION}),
            mock.patch.object(cloud_ops_dashboard, "load_deployment_env", return_value={}),
        )
        with base_patches[0], base_patches[1], base_patches[2]:
            with mock.patch.object(cloud_ops_dashboard, "_aws_cmd", side_effect=lambda a, aws_env=None: _aws(a, aws_env, newest_size=0)):
                with self.assertRaises(RuntimeError):
                    cloud_ops_dashboard.trigger_remote_restore()
            with mock.patch.object(cloud_ops_dashboard, "_aws_cmd", side_effect=lambda a, aws_env=None: _aws(a, aws_env, meta_sha="c" * 64)):
                with self.assertRaises(RuntimeError):
                    cloud_ops_dashboard.trigger_remote_restore()
            for bad_out in ("no marker", 'ENVSCALE_RESTORE_RESULT={"canonical_tables":12,"migrations":4,"sha256":"' + sha + '","verify_passed":false}', 'ENVSCALE_RESTORE_RESULT={"canonical_tables":8,"migrations":4,"sha256":"' + sha + '","verify_passed":true}'):
                with mock.patch.object(cloud_ops_dashboard, "_aws_cmd", side_effect=_aws), mock.patch.object(cloud_ops_dashboard, "run_ssm_command", return_value=subprocess.CompletedProcess([], 0, stdout=bad_out, stderr="")):
                    with self.assertRaises(RuntimeError):
                        cloud_ops_dashboard.trigger_remote_restore()


class TestLifecycleAndStateStoreFailures(unittest.TestCase):
    """Area 3: Verify PipelineStateStore partial-failure invariants and GUI parity."""

    def _make_orch(self, td_p: pathlib.Path) -> tuple[cloud_orchestrator.CloudOrchestrator, cloud_orchestrator.PipelineStateStore]:
        store = cloud_orchestrator.PipelineStateStore(td_p / "state.json")
        store.update_context(instance_id="i-old", public_ip="1.2.3.4", app_url="https://old.example", last_backup_key="backups/postgres/b0.dump", last_restore_key="backups/postgres/b0.dump")
        for sid in cloud_orchestrator.STAGE_IDS:
            store.update_stage(sid, "completed", summary="ok")
        sess = AwsSessionContext(account_id=ACCOUNT, region=REGION, caller_arn=CALLER_ARN, role_arn=RUNTIME_ARN, expires_at_utc="2099-01-01T00:00:00Z", _creds={"AccessKeyId": "AK", "SecretAccessKey": "SK", "SessionToken": "ST"})
        return cloud_orchestrator.CloudOrchestrator(runtime_session=sess, state_store=store), store

    def test_destroy_and_restore_failures_and_skip_verify(self):
        with tempfile.TemporaryDirectory() as td:
            orch, store = self._make_orch(pathlib.Path(td))
            with (
                mock.patch.object(orch, "_require_verified_runtime_env", return_value={"AWS_REGION": REGION}),
                mock.patch.object(cloud_lifecycle, "verify_destroy_target_environment", return_value={"verified": True, "instance_id": "i-old"}),
                mock.patch.object(cloud_lifecycle, "verify_destroy_cleanup", return_value={"verified": True, "remaining_resources": 0}),
                mock.patch.object(cloud_lifecycle.CloudDeployer, "infra_destroy", side_effect=RuntimeError("boom")),
            ):
                with self.assertRaises(RuntimeError):
                    orch.destroy_runtime()
            st = store.load()
            self.assertEqual(st["context"]["instance_id"], "i-old")
            self.assertEqual(st["stages"]["provision"]["status"], "failed")

            with mock.patch.object(orch, "_require_verified_runtime_env", return_value={"AWS_REGION": REGION}), mock.patch.object(cloud_lifecycle, "trigger_remote_restore", side_effect=RuntimeError("bad dump")):
                with self.assertRaises(RuntimeError):
                    orch.restore_database(backup_key="backups/postgres/bad.dump")
            st = store.load()
            self.assertEqual(st["stages"]["verify"]["status"], "failed")
            self.assertEqual(st["context"]["last_restore_key"], "backups/postgres/b0.dump")

            with mock.patch.object(orch, "_require_verified_runtime_env", return_value={"AWS_REGION": REGION}), mock.patch.object(cloud_lifecycle, "trigger_remote_restore", return_value={"key": "backups/postgres/b1.dump", "canonical_tables": 12, "verify_passed": False}):
                orch.restore_database(backup_key="backups/postgres/b1.dump", skip_verify=True)
            st = store.load()
            self.assertEqual(st["context"]["last_restore_key"], "backups/postgres/b1.dump")
            self.assertEqual(st["stages"]["verify"]["status"], "pending")

    def test_reconstruct_partial_failures_and_repeated_lifecycle(self):
        with tempfile.TemporaryDirectory() as td:
            td_p = pathlib.Path(td)
            manifest_f = td_p / "release-manifest.json"
            manifest_f.write_text('{"git":{"commit_sha":"deadbeef1234"}}', encoding="utf-8")
            orch, store = self._make_orch(td_p)

            with mock.patch.object(cloud_orchestrator.CloudDeployer, "provision_host", side_effect=RuntimeError("tf err")):
                with self.assertRaises(RuntimeError):
                    orch.reconstruct_runtime(manifest_path=str(manifest_f), target_sha="deadbeef1234")
            st = store.load()
            self.assertEqual(st["stages"]["provision"]["status"], "failed")
            self.assertEqual(st["stages"]["deploy"]["status"], "pending")
            self.assertEqual(st["stages"]["verify"]["status"], "pending")

            with mock.patch.object(orch, "_require_verified_runtime_env", return_value={"AWS_REGION": REGION}), mock.patch.object(cloud_orchestrator.CloudDeployer, "provision_host", return_value={"instance_id": "i-new", "ip": "5.6.7.8"}), mock.patch.object(cloud_orchestrator.CloudDeployer, "deploy", side_effect=RuntimeError("ssm fail")):
                with self.assertRaises(RuntimeError):
                    orch.reconstruct_runtime(manifest_path=str(manifest_f), target_sha="deadbeef1234")
            st = store.load()
            self.assertEqual(st["stages"]["provision"]["status"], "completed")
            self.assertEqual(st["context"]["instance_id"], "i-new")
            self.assertEqual(st["stages"]["deploy"]["status"], "failed")
            self.assertEqual(st["stages"]["verify"]["status"], "pending")

            with mock.patch.object(orch, "_require_verified_runtime_env", return_value={"AWS_REGION": REGION}), mock.patch.object(cloud_orchestrator.CloudDeployer, "provision_host", return_value={"instance_id": "i-new", "ip": "5.6.7.8"}), mock.patch.object(cloud_orchestrator.CloudDeployer, "deploy", return_value=None), mock.patch.object(cloud_orchestrator.CloudDeployer, "get_public_ip", return_value="5.6.7.8"), mock.patch.object(cloud_orchestrator.CloudDeployer, "get_instance_id", return_value="i-new"), mock.patch.object(cloud_orchestrator.CloudDeployer, "_get_tf_outputs", return_value={}), mock.patch.object(cloud_lifecycle, "trigger_remote_restore", side_effect=RuntimeError("restore err")):
                with self.assertRaises(RuntimeError):
                    orch.reconstruct_runtime(manifest_path=str(manifest_f), target_sha="deadbeef1234")
            st = store.load()
            self.assertEqual(st["stages"]["deploy"]["status"], "completed")
            self.assertEqual(st["stages"]["verify"]["status"], "failed")
            self.assertEqual(st["context"]["last_restore_key"], "backups/postgres/b0.dump")

            with mock.patch.object(orch, "_require_verified_runtime_env", return_value={"AWS_REGION": REGION}), mock.patch.object(cloud_orchestrator.CloudDeployer, "provision_host", return_value={"instance_id": "i-new", "ip": "5.6.7.8"}), mock.patch.object(cloud_orchestrator.CloudDeployer, "deploy", return_value=None), mock.patch.object(cloud_orchestrator.CloudDeployer, "get_public_ip", return_value="5.6.7.8"), mock.patch.object(cloud_orchestrator.CloudDeployer, "get_instance_id", return_value="i-new"), mock.patch.object(cloud_orchestrator.CloudDeployer, "_get_tf_outputs", return_value={}), mock.patch.object(cloud_lifecycle, "trigger_remote_restore", return_value={"key": "backups/postgres/b2.dump", "canonical_tables": 12, "verify_passed": True}), mock.patch.object(cloud_orchestrator, "fetch_ops_snapshot", return_value={"ec2": {"state": "running"}, "ssm": {"ping_status": "Online"}, "health": {"ok": False, "errors": ["502"]}}):
                with self.assertRaises(RuntimeError):
                    orch.reconstruct_runtime(manifest_path=str(manifest_f), target_sha="deadbeef1234")
            st = store.load()
            self.assertEqual(st["context"]["last_restore_key"], "backups/postgres/b2.dump")
            self.assertEqual(st["stages"]["verify"]["status"], "failed")

            with (
                mock.patch.object(orch, "_require_verified_runtime_env", return_value={"AWS_REGION": REGION}),
                mock.patch.object(cloud_lifecycle, "verify_destroy_target_environment", return_value={"verified": True, "instance_id": "i-new"}),
                mock.patch.object(cloud_lifecycle, "verify_destroy_cleanup", return_value={"verified": True, "remaining_resources": 0}),
                mock.patch.object(cloud_lifecycle.CloudDeployer, "infra_destroy", return_value={"key": "backups/postgres/b3.dump"}),
            ):
                orch.destroy_runtime()
            st = store.load()
            self.assertEqual(st["context"]["last_backup_key"], "backups/postgres/b3.dump")
            self.assertEqual(st["context"]["last_restore_key"], "")

    def test_gui_and_cd_bootstrap_contracts(self):
        view_src = (REPO_ROOT / "scripts/lib/gui_adw/view_cloud.py").read_text(encoding="utf-8")
        panel_src = (REPO_ROOT / "scripts/lib/gui_adw/cloud_ops_panel.py").read_text(encoding="utf-8")
        self.assertIn("Adw.MessageDialog", view_src)
        self.assertIn("orchestrator.destroy_runtime", view_src)
        self.assertIn("orchestrator.restore_database", view_src)
        self.assertIn("self.restore_fn()", panel_src)

        cd_src = (REPO_ROOT / ".github/workflows/cd.yml").read_text(encoding="utf-8")
        self.assertIn('[ "${STATUS}" != "Success" ] || [ "${RESP_CODE}" != "0" ]', cd_src)
        self.assertIn("Failure Diagnostics (tail, redacted)", cd_src)
        self.assertIn("== *.duckdns.org", cd_src)
        self.assertIn('!= https://*', cd_src)
        for ep in ("${TARGET_URL}/", "${TARGET_URL}/api/health", "${TARGET_URL}/healthz", "${TARGET_URL}/api/v1/workspaces"):
            self.assertIn(ep, cd_src)

        ud_src = (REPO_ROOT / "deployment/terraform/user_data.sh.tpl").read_text(encoding="utf-8")
        self.assertIn("rm -rf /opt/envscale", ud_src)
        self.assertIn('if [ "$${attempt}" -lt 3 ]; then', ud_src)


if __name__ == "__main__":
    unittest.main()
