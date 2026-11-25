"""Regression tests for fail-closed PostgreSQL backup and S3 verification before Terraform destroy."""

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
from typing import Any, Dict, List, Optional
from unittest import mock

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

from scripts.lib import cloud_deployer, ssm_deployer  # noqa: E402

_REAL_SUBPROCESS_RUN = subprocess.run
ACCOUNT = "982534376726"
REGION = "ap-south-1"
BUCKET = f"envscale-recovery-{ACCOUNT}-{REGION}"
INSTANCE_ID = "i-0123456789abcdef0"
VALID_DUMP_BYTES = b"PGDMP\x01\x0e\x00\x04\x08envscale_custom_dump_payload_tables_and_rows_v1"
VALID_DUMP_SHA256 = hashlib.sha256(VALID_DUMP_BYTES).hexdigest()
VALID_DUMP_B64_SHA256 = base64.b64encode(hashlib.sha256(VALID_DUMP_BYTES).digest()).decode("ascii")
VALID_TOC_TEXT = (
    ";\n; Archive created at 2026-11-26 00:00:00 UTC\n;\n"
    "3412; 1262 16384 DATABASE - envscale envscale\n"
    "215; 1259 16390 TABLE public workspaces envscale\n"
    "3401; 0 16390 TABLE DATA public workspaces envscale\n"
)


class _FakeHostAndS3Sandbox:
    """Executes real SSM backup shell commands against sandboxed docker/aws shims and a local S3 store."""

    def __init__(self, tmp_dir: str):
        self.root = pathlib.Path(tmp_dir)
        self.bin_dir = self.root / "bin"
        self.s3_dir = self.root / "s3"
        self.state_file = self.root / "sandbox_state.json"
        self.bin_dir.mkdir(parents=True, exist_ok=True)
        self.s3_dir.mkdir(parents=True, exist_ok=True)
        self._write_shims()
        self.configure()

    def configure(
        self,
        *,
        container_exists: bool = True,
        container_running: bool = True,
        pg_isready_ok: bool = True,
        psql_select1_ok: bool = True,
        pg_dump_ok: bool = True,
        dump_bytes: bytes = VALID_DUMP_BYTES,
        pg_restore_ok: bool = True,
        pg_restore_stdout: str = VALID_TOC_TEXT,
        s3_cp_ok: bool = True,
        s3_cp_stderr: str = "",
    ) -> None:
        dump_file = self.root / "fixture_dump.bin"
        dump_file.write_bytes(dump_bytes)
        cfg = {
            "container_exists": container_exists,
            "container_running": container_running,
            "pg_isready_ok": pg_isready_ok,
            "psql_select1_ok": psql_select1_ok,
            "pg_dump_ok": pg_dump_ok,
            "dump_file": str(dump_file),
            "pg_restore_ok": pg_restore_ok,
            "pg_restore_stdout": pg_restore_stdout,
            "s3_cp_ok": s3_cp_ok,
            "s3_cp_stderr": s3_cp_stderr,
            "s3_dir": str(self.s3_dir),
            "s3_cp_calls": 0,
        }
        self.state_file.write_text(json.dumps(cfg), encoding="utf-8")

    def s3_cp_call_count(self) -> int:
        return int(json.loads(self.state_file.read_text(encoding="utf-8")).get("s3_cp_calls", 0))

    def stored_objects(self) -> List[pathlib.Path]:
        return [p for p in self.s3_dir.rglob("*.dump") if p.is_file()]

    def _write_shims(self) -> None:
        docker_py = self.bin_dir / "docker"
        docker_py.write_text(
            "#!/usr/bin/env python3\n"
            "import json, os, pathlib, sys\n"
            "st = json.loads(pathlib.Path(os.environ['SANDBOX_STATE']).read_text())\n"
            "args = sys.argv[1:]\n"
            "if args and args[0] == 'inspect':\n"
            "    if not st['container_exists']:\n"
            "        sys.stderr.write('Error: No such object: envscale-postgres\\n')\n"
            "        sys.exit(1)\n"
            "    if '-f' in args:\n"
            "        sys.stdout.write('true\\n' if st['container_running'] else 'false\\n')\n"
            "    sys.exit(0)\n"
            "if args and args[0] == 'exec':\n"
            "    if 'pg_isready' in args:\n"
            "        sys.exit(0 if st['pg_isready_ok'] else 1)\n"
            "    if 'psql' in args:\n"
            "        if not st['psql_select1_ok']:\n"
            "            sys.stderr.write('psql: FATAL: database unavailable\\n')\n"
            "            sys.exit(2)\n"
            "        sys.stdout.write('1\\n')\n"
            "        sys.exit(0)\n"
            "    if 'pg_dump' in args:\n"
            "        if not st['pg_dump_ok']:\n"
            "            sys.stderr.write('pg_dump: error: connection to database failed\\n')\n"
            "            sys.exit(1)\n"
            "        sys.stdout.buffer.write(pathlib.Path(st['dump_file']).read_bytes())\n"
            "        sys.exit(0)\n"
            "    if 'pg_restore' in args:\n"
            "        data = sys.stdin.buffer.read()\n"
            "        if not st['pg_restore_ok'] or not data.startswith(b'PGDMP'):\n"
            "            sys.stderr.write('pg_restore: error: input file does not appear to be a valid archive\\n')\n"
            "            sys.exit(1)\n"
            "        sys.stdout.write(st['pg_restore_stdout'])\n"
            "        sys.exit(0)\n"
            "sys.exit(1)\n",
            encoding="utf-8",
        )
        os.chmod(docker_py, stat.S_IRWXU)

        aws_py = self.bin_dir / "aws"
        aws_py.write_text(
            "#!/usr/bin/env python3\n"
            "import base64, hashlib, json, os, pathlib, sys\n"
            "st_path = pathlib.Path(os.environ['SANDBOX_STATE'])\n"
            "st = json.loads(st_path.read_text())\n"
            "args = sys.argv[1:]\n"
            "if args[:2] == ['s3', 'cp']:\n"
            "    st['s3_cp_calls'] = int(st.get('s3_cp_calls', 0)) + 1\n"
            "    st_path.write_text(json.dumps(st))\n"
            "    if not st['s3_cp_ok']:\n"
            "        sys.stderr.write((st.get('s3_cp_stderr') or 'An error occurred (AccessDenied) when calling PutObject') + '\\n')\n"
            "        sys.exit(1)\n"
            "    src, dst = args[2], args[3]\n"
            "    meta = {}\n"
            "    if '--metadata' in args:\n"
            "        m_str = args[args.index('--metadata') + 1]\n"
            "        for kv in m_str.split(','):\n"
            "            if '=' in kv:\n"
            "                k, v = kv.split('=', 1)\n"
            "                meta[k] = v\n"
            "    _, rest = dst.split('s3://', 1)\n"
            "    bkt, key = rest.split('/', 1)\n"
            "    raw = pathlib.Path(src).read_bytes()\n"
            "    obj_path = pathlib.Path(st['s3_dir']) / bkt / key\n"
            "    obj_path.parent.mkdir(parents=True, exist_ok=True)\n"
            "    obj_path.write_bytes(raw)\n"
            "    chk_b64 = base64.b64encode(hashlib.sha256(raw).digest()).decode('ascii')\n"
            "    head_meta = {'ContentLength': len(raw), 'Metadata': meta, 'ChecksumSHA256': chk_b64, 'VersionId': 'v1'}\n"
            "    obj_path.with_suffix('.dump.meta.json').write_text(json.dumps(head_meta))\n"
            "    sys.exit(0)\n"
            "sys.exit(1)\n",
            encoding="utf-8",
        )
        os.chmod(aws_py, stat.S_IRWXU)

    def run_ssm_commands(self, commands: List[str], *, check: bool = True) -> subprocess.CompletedProcess:
        env = dict(os.environ)
        env["PATH"] = f"{self.bin_dir}:{env.get('PATH', '')}"
        env["SANDBOX_STATE"] = str(self.state_file)
        script = "\n".join(commands)
        proc = _REAL_SUBPROCESS_RUN(["/bin/bash", "-c", script], capture_output=True, text=True, env=env)
        if proc.returncode != 0 and check:
            raise RuntimeError(proc.stderr.strip() or f"SSM command exited {proc.returncode}")
        return subprocess.CompletedProcess(
            args=["aws", "ssm", "send-command"],
            returncode=proc.returncode,
            stdout=proc.stdout.strip(),
            stderr=proc.stderr.strip(),
        )

    def head_object_response(
        self,
        cmd: List[str],
        *,
        override_rc: int = 0,
        override_stderr: str = "",
        override_doc: Optional[Dict[str, Any]] = None,
    ) -> subprocess.CompletedProcess:
        if override_rc != 0:
            return subprocess.CompletedProcess(cmd, override_rc, stdout="", stderr=override_stderr or "NotFound")
        if override_doc is not None:
            return subprocess.CompletedProcess(cmd, 0, stdout=json.dumps(override_doc), stderr="")
        bkt = cmd[cmd.index("--bucket") + 1]
        key = cmd[cmd.index("--key") + 1]
        meta_path = self.s3_dir / bkt / pathlib.Path(key).with_suffix(".dump.meta.json")
        if not meta_path.is_file():
            return subprocess.CompletedProcess(cmd, 254, stdout="", stderr="An error occurred (404) when calling the HeadObject operation: Not Found")
        return subprocess.CompletedProcess(cmd, 0, stdout=meta_path.read_text(encoding="utf-8"), stderr="")


class TestPostgresBackupDestroySafety(unittest.TestCase):
    def _run_destroy_with_sandbox(
        self,
        sandbox: _FakeHostAndS3Sandbox,
        *,
        ssm_side_effect=None,
        head_override_rc: int = 0,
        head_override_stderr: str = "",
        head_override_doc: Optional[Dict[str, Any]] = None,
        tf_destroy_side_effect=None,
    ):
        deployer = cloud_deployer.CloudDeployer(log_fn=lambda _: None, aws_env={"AWS_REGION": REGION})
        executed_cmds: List[List[str]] = []

        def _fake_ssm(instance_id, commands, **kwargs):
            if ssm_side_effect is not None:
                return ssm_side_effect(instance_id, commands, **kwargs)
            return sandbox.run_ssm_commands(commands, check=kwargs.get("check", True))

        def _fake_subproc_run(cmd, **kwargs):
            executed_cmds.append(list(cmd))
            if cmd[:3] == ["aws", "s3api", "get-bucket-location"]:
                return subprocess.CompletedProcess(cmd, 0, stdout='{"LocationConstraint":"ap-south-1"}', stderr="")
            if cmd[:3] == ["aws", "s3api", "head-object"]:
                return sandbox.head_object_response(
                    cmd,
                    override_rc=head_override_rc,
                    override_stderr=head_override_stderr,
                    override_doc=head_override_doc,
                )
            if cmd[:2] == ["terraform", "destroy"]:
                if tf_destroy_side_effect is not None:
                    return tf_destroy_side_effect(cmd)
                return subprocess.CompletedProcess(cmd, 0, stdout="Destroy complete!", stderr="")
            return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")

        with (
            mock.patch.object(deployer, "get_aws_context", return_value={"account_id": ACCOUNT, "region": REGION, "s3_bucket": BUCKET, "recovery_bucket": BUCKET}),
            mock.patch.object(deployer, "get_instance_id", return_value=INSTANCE_ID),
            mock.patch.object(deployer, "backup_to_s3"),
            mock.patch.object(deployer, "load_deployment_env", return_value={}),
            mock.patch.object(cloud_deployer, "cleanup_external_references") as m_cleanup,
            mock.patch.object(cloud_deployer, "run_ssm_command", side_effect=_fake_ssm) as m_ssm,
            mock.patch.object(cloud_deployer.subprocess, "run", side_effect=_fake_subproc_run),
        ):
            result = deployer.infra_destroy()
            return result, executed_cmds, m_ssm, m_cleanup

    @staticmethod
    def _assert_terraform_destroy_not_called(testcase: unittest.TestCase, executed_cmds: List[List[str]]) -> None:
        tf_destroy_calls = [c for c in executed_cmds if len(c) >= 2 and c[0] == "terraform" and c[1] == "destroy"]
        testcase.assertEqual(tf_destroy_calls, [], f"Terraform destroy must NEVER be invoked on backup failure; saw {tf_destroy_calls}")

    def test_valid_postgres_dump_and_verified_s3_object_allows_destroy(self):
        with tempfile.TemporaryDirectory() as tmp:
            sb = _FakeHostAndS3Sandbox(tmp)
            res, cmds, m_ssm, m_cleanup = self._run_destroy_with_sandbox(sb)
            self.assertEqual(res["bucket"], BUCKET)
            self.assertTrue(res["key"].startswith(f"backups/postgres/backup_"))
            self.assertTrue(res["key"].endswith(".dump"))
            self.assertEqual(res["content_length"], len(VALID_DUMP_BYTES))
            self.assertEqual(res["sha256"], VALID_DUMP_SHA256)
            self.assertEqual(res["checksum_sha256"], VALID_DUMP_B64_SHA256)
            self.assertEqual(sb.s3_cp_call_count(), 1)
            self.assertEqual(len(sb.stored_objects()), 1)
            self.assertTrue(m_ssm.call_args.kwargs.get("check", True))
            head_calls = [c for c in cmds if c[:3] == ["aws", "s3api", "head-object"]]
            tf_calls = [c for c in cmds if c[:2] == ["terraform", "destroy"]]
            self.assertEqual(len(head_calls), 1)
            self.assertEqual(len(tf_calls), 1)
            self.assertLess(cmds.index(head_calls[0]), cmds.index(tf_calls[0]))
            m_cleanup.assert_called_once()

    def test_host_failure_modes_block_upload_and_block_terraform_destroy(self):
        failure_cases = [
            ("container_missing", {"container_exists": False}, "missing on host"),
            ("container_stopped", {"container_running": False}, "not running"),
            ("pg_isready_fails", {"pg_isready_ok": False}, "pg_isready failed"),
            ("psql_query_fails", {"psql_select1_ok": False}, "connectivity query"),
            ("pg_dump_fails", {"pg_dump_ok": False}, "pg_dump"),
            ("empty_backup_0_bytes", {"dump_bytes": b""}, "missing or empty"),
            ("invalid_corrupt_archive", {"dump_bytes": b"NOT_A_VALID_PG_CUSTOM_ARCHIVE"}, "pg_restore"),
            ("pg_restore_command_fails", {"pg_restore_ok": False}, "pg_restore"),
            ("pg_restore_zero_entries", {"pg_restore_stdout": ";\n; comment only\n"}, "zero archive entries"),
        ]
        for label, cfg_kw, expected_msg in failure_cases:
            with self.subTest(case=label), tempfile.TemporaryDirectory() as tmp:
                sb = _FakeHostAndS3Sandbox(tmp)
                sb.configure(**cfg_kw)
                with self.assertRaises(RuntimeError) as ctx:
                    try:
                        self._run_destroy_with_sandbox(sb)
                    except RuntimeError:
                        # Verify zero partial uploads reached S3
                        self.assertEqual(sb.s3_cp_call_count(), 0, f"Case {label} must not upload corrupt/empty dump to S3")
                        self.assertEqual(sb.stored_objects(), [])
                        raise
                self.assertIn(expected_msg, str(ctx.exception))

    def test_s3_upload_failure_and_permission_denial_block_terraform_destroy(self):
        with tempfile.TemporaryDirectory() as tmp:
            sb = _FakeHostAndS3Sandbox(tmp)
            sb.configure(s3_cp_ok=False, s3_cp_stderr="An error occurred (AccessDenied) when calling the PutObject operation")
            deployer = cloud_deployer.CloudDeployer(log_fn=lambda _: None)
            executed: List[List[str]] = []

            def _track_subproc(cmd, **kw):
                executed.append(list(cmd))
                if cmd[:3] == ["aws", "s3api", "get-bucket-location"]:
                    return subprocess.CompletedProcess(cmd, 0, stdout="{}", stderr="")
                return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")

            with (
                mock.patch.object(deployer, "get_aws_context", return_value={"account_id": ACCOUNT, "region": REGION, "s3_bucket": BUCKET}),
                mock.patch.object(deployer, "get_instance_id", return_value=INSTANCE_ID),
                mock.patch.object(cloud_deployer, "run_ssm_command", side_effect=lambda iid, cmds, **kw: sb.run_ssm_commands(cmds, check=kw.get("check", True))),
                mock.patch.object(cloud_deployer.subprocess, "run", side_effect=_track_subproc),
            ):
                with self.assertRaises(RuntimeError) as ctx:
                    deployer.infra_destroy()
            self.assertIn("AccessDenied", str(ctx.exception))
            self._assert_terraform_destroy_not_called(self, executed)

    def test_head_object_verification_failures_block_terraform_destroy(self):
        wrong_sha = "f" * 64
        wrong_b64 = base64.b64encode(bytes.fromhex(wrong_sha)).decode("ascii")
        valid_len = len(VALID_DUMP_BYTES)
        head_cases = [
            ("head_object_404_missing", 254, "NotFound", None, "head-object verification failed"),
            ("head_object_403_access_denied", 254, "AccessDenied", None, "AccessDenied"),
            ("uploaded_object_zero_bytes", 0, "", {"ContentLength": 0, "Metadata": {"sha256": VALID_DUMP_SHA256}}, "zero or invalid ContentLength"),
            ("content_length_mismatch", 0, "", {"ContentLength": valid_len + 17, "Metadata": {"sha256": VALID_DUMP_SHA256}}, "ContentLength mismatch"),
            ("etag_only_without_sha256", 0, "", {"ContentLength": valid_len, "ETag": f'"{VALID_DUMP_SHA256[:32]}"', "Metadata": {}}, "ETag is not accepted as SHA-256"),
            ("metadata_sha256_mismatch", 0, "", {"ContentLength": valid_len, "Metadata": {"sha256": wrong_sha}}, "Metadata.sha256 mismatch"),
            ("checksum_sha256_mismatch", 0, "", {"ContentLength": valid_len, "Metadata": {"sha256": VALID_DUMP_SHA256}, "ChecksumSHA256": wrong_b64}, "ChecksumSHA256 mismatch"),
        ]
        for label, rc, err, doc, expected_substr in head_cases:
            with self.subTest(case=label), tempfile.TemporaryDirectory() as tmp:
                sb = _FakeHostAndS3Sandbox(tmp)
                deployer = cloud_deployer.CloudDeployer(log_fn=lambda _: None)
                executed: List[List[str]] = []

                def _subproc(cmd, **kw):
                    executed.append(list(cmd))
                    if cmd[:3] == ["aws", "s3api", "get-bucket-location"]:
                        return subprocess.CompletedProcess(cmd, 0, stdout="{}", stderr="")
                    if cmd[:3] == ["aws", "s3api", "head-object"]:
                        return sb.head_object_response(cmd, override_rc=rc, override_stderr=err, override_doc=doc)
                    return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")

                with (
                    mock.patch.object(deployer, "get_aws_context", return_value={"account_id": ACCOUNT, "region": REGION, "s3_bucket": BUCKET}),
                    mock.patch.object(deployer, "get_instance_id", return_value=INSTANCE_ID),
                    mock.patch.object(cloud_deployer, "run_ssm_command", side_effect=lambda iid, cmds, **kw: sb.run_ssm_commands(cmds, check=kw.get("check", True))),
                    mock.patch.object(cloud_deployer.subprocess, "run", side_effect=_subproc),
                ):
                    with self.assertRaises(RuntimeError) as ctx:
                        deployer.infra_destroy()
                self.assertIn(expected_substr, str(ctx.exception))
                self._assert_terraform_destroy_not_called(self, executed)

    def test_ssm_timeout_failure_and_interrupted_output_block_terraform_destroy(self):
        ssm_cases = [
            ("ssm_timeout_exception", lambda *a, **kw: (_ for _ in ()).throw(RuntimeError("SSM command cmd-1 ended with status TimedOut")), "TimedOut"),
            ("ssm_nonzero_returncode", lambda *a, **kw: subprocess.CompletedProcess([], 1, stdout="", stderr="SSM invocation failed"), "SSM invocation failed"),
            ("interrupted_missing_marker", lambda *a, **kw: subprocess.CompletedProcess([], 0, stdout="partial stdout before kill", stderr=""), "interrupted or incomplete"),
            ("malformed_marker_json", lambda *a, **kw: subprocess.CompletedProcess([], 0, stdout="ENVSCALE_BACKUP_RESULT={bad json", stderr=""), "Malformed PostgreSQL backup metadata"),
            ("wrong_bucket_in_marker", lambda *a, **kw: subprocess.CompletedProcess([], 0, stdout='ENVSCALE_BACKUP_RESULT={"bucket":"other","key":"k","size":10,"sha256":"' + VALID_DUMP_SHA256 + '","toc_entries":2}', stderr=""), "target mismatch"),
        ]
        for label, ssm_fn, expected_substr in ssm_cases:
            with self.subTest(case=label), tempfile.TemporaryDirectory() as tmp:
                sb = _FakeHostAndS3Sandbox(tmp)
                deployer = cloud_deployer.CloudDeployer(log_fn=lambda _: None)
                executed: List[List[str]] = []

                def _subproc(cmd, **kw):
                    executed.append(list(cmd))
                    return subprocess.CompletedProcess(cmd, 0, stdout="{}", stderr="")

                with (
                    mock.patch.object(deployer, "get_aws_context", return_value={"account_id": ACCOUNT, "region": REGION, "s3_bucket": BUCKET}),
                    mock.patch.object(deployer, "get_instance_id", return_value=INSTANCE_ID),
                    mock.patch.object(cloud_deployer, "run_ssm_command", side_effect=ssm_fn),
                    mock.patch.object(cloud_deployer.subprocess, "run", side_effect=_subproc),
                ):
                    with self.assertRaises(RuntimeError) as ctx:
                        deployer.infra_destroy()
                self.assertIn(expected_substr, str(ctx.exception))
                self._assert_terraform_destroy_not_called(self, executed)

    def test_backup_succeeds_but_terraform_destroy_fails_preserves_backup_and_surfaces_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            sb = _FakeHostAndS3Sandbox(tmp)

            def _fail_tf(cmd):
                return subprocess.CompletedProcess(cmd, 1, stdout="", stderr="Error: VpcInUse: vpc-123 has lingering ENI")

            with self.assertRaises(RuntimeError) as ctx:
                self._run_destroy_with_sandbox(sb, tf_destroy_side_effect=_fail_tf)
            self.assertIn("VpcInUse", str(ctx.exception))
            stored = sb.stored_objects()
            self.assertEqual(len(stored), 1)
            self.assertEqual(stored[0].read_bytes(), VALID_DUMP_BYTES)

    def test_no_host_teardown_blocks_without_verified_backup_and_allows_when_verified(self):
        with tempfile.TemporaryDirectory() as tmp:
            tf_dir = pathlib.Path(tmp)
            tf_state = tf_dir / "terraform.tfstate"
            deployer = cloud_deployer.CloudDeployer(log_fn=lambda _: None)

            # 1. Missing tfstate file -> blocked
            executed: List[List[str]] = []
            with (
                mock.patch.object(cloud_deployer, "TERRAFORM_DIR", str(tf_dir)),
                mock.patch.object(deployer, "get_aws_context", return_value={"account_id": ACCOUNT, "region": REGION, "s3_bucket": BUCKET}),
                mock.patch.object(deployer, "get_instance_id", return_value=""),
                mock.patch.object(cloud_deployer.subprocess, "run", side_effect=lambda c, **k: (executed.append(c), subprocess.CompletedProcess(c, 0, stdout="{}", stderr=""))[1]),
            ):
                with self.assertRaises(RuntimeError) as ctx:
                    deployer.infra_destroy()
            self.assertIn("Terraform state file is missing", str(ctx.exception))
            self._assert_terraform_destroy_not_called(self, executed)

            # 2. Lingering aws_instance in tfstate -> blocked
            tf_state.write_text(json.dumps({"resources": [{"type": "aws_instance", "instances": [{"attributes": {"id": INSTANCE_ID}}]}]}), encoding="utf-8")
            executed.clear()
            with (
                mock.patch.object(cloud_deployer, "TERRAFORM_DIR", str(tf_dir)),
                mock.patch.object(deployer, "get_aws_context", return_value={"account_id": ACCOUNT, "region": REGION, "s3_bucket": BUCKET}),
                mock.patch.object(deployer, "get_instance_id", return_value=""),
                mock.patch.object(cloud_deployer.subprocess, "run", side_effect=lambda c, **k: (executed.append(c), subprocess.CompletedProcess(c, 0, stdout="{}", stderr=""))[1]),
            ):
                with self.assertRaises(RuntimeError) as ctx:
                    deployer.infra_destroy()
            self.assertIn("still records an aws_instance", str(ctx.exception))
            self._assert_terraform_destroy_not_called(self, executed)

            # 3. Clean tfstate (no aws_instance) but empty S3 backup history -> blocked
            tf_state.write_text(json.dumps({"resources": [{"type": "aws_vpc", "instances": [{"attributes": {"id": "vpc-1"}}]}]}), encoding="utf-8")
            executed.clear()
            with (
                mock.patch.object(cloud_deployer, "TERRAFORM_DIR", str(tf_dir)),
                mock.patch.object(deployer, "get_aws_context", return_value={"account_id": ACCOUNT, "region": REGION, "s3_bucket": BUCKET}),
                mock.patch.object(deployer, "get_instance_id", return_value=""),
                mock.patch.object(cloud_deployer.subprocess, "run", side_effect=lambda c, **k: (executed.append(c), subprocess.CompletedProcess(c, 0, stdout='{"Contents":[]}', stderr=""))[1]),
            ):
                with self.assertRaises(RuntimeError) as ctx:
                    deployer.infra_destroy()
            self.assertIn("no existing PostgreSQL backup", str(ctx.exception))
            self._assert_terraform_destroy_not_called(self, executed)

            # 4. Clean tfstate + verified existing backup in S3 -> allowed
            executed.clear()

            def _ok_no_host_subproc(cmd, **kw):
                executed.append(list(cmd))
                if cmd[:3] == ["aws", "s3api", "list-objects-v2"]:
                    return subprocess.CompletedProcess(cmd, 0, stdout=json.dumps({"Contents": [{"Key": "backups/postgres/backup_prior.dump", "Size": 512, "LastModified": "2026-11-25T10:00:00Z"}]}), stderr="")
                if cmd[:3] == ["aws", "s3api", "head-object"]:
                    return subprocess.CompletedProcess(cmd, 0, stdout=json.dumps({"ContentLength": 512}), stderr="")
                return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")

            with (
                mock.patch.object(cloud_deployer, "TERRAFORM_DIR", str(tf_dir)),
                mock.patch.object(deployer, "get_aws_context", return_value={"account_id": ACCOUNT, "region": REGION, "s3_bucket": BUCKET}),
                mock.patch.object(deployer, "get_instance_id", return_value=""),
                mock.patch.object(deployer, "backup_to_s3"),
                mock.patch.object(deployer, "load_deployment_env", return_value={}),
                mock.patch.object(cloud_deployer, "cleanup_external_references"),
                mock.patch.object(cloud_deployer.subprocess, "run", side_effect=_ok_no_host_subproc),
            ):
                verified = deployer.infra_destroy()
            self.assertEqual(verified["key"], "backups/postgres/backup_prior.dump")
            self.assertEqual(verified["content_length"], 512)
            self.assertTrue(any(c[:2] == ["terraform", "destroy"] for c in executed))

    def test_unique_backup_keys_never_collide_on_retry(self):
        keys = {ssm_deployer.generate_postgres_backup_key(INSTANCE_ID) for _ in range(50)}
        self.assertEqual(len(keys), 50)
        for k in keys:
            self.assertTrue(k.startswith("backups/postgres/backup_"))
            self.assertTrue(k.endswith(".dump"))


if __name__ == "__main__":
    unittest.main()
