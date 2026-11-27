#!/usr/bin/env python3
"""Regression tests covering Terraform state reconciliation, S3 conditional writes, crash recovery, and serial-330."""

from __future__ import annotations

import hashlib
import json
import pathlib
import subprocess
import sys
import tempfile
import unittest

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

from scripts.lib import tfstate_journal, tfstate_reconciler  # noqa: E402

ACCOUNT = "982534376726"
REGION = "ap-south-1"
BUCKET = f"envscale-tfstate-{ACCOUNT}-{REGION}"
KEY = "runtime/terraform.tfstate"


def _make_state(serial: int, lineage: str = "lin-1", resources=None) -> bytes:
    doc = {
        "version": 4, "terraform_version": "1.14.9", "serial": serial,
        "lineage": lineage, "outputs": {}, "resources": resources if resources is not None else [],
    }
    return json.dumps(doc, indent=2).encode("utf-8")


def _parse_metadata_arg(raw: str) -> dict:
    out = {}
    for kv in (raw or "").split(","):
        if "=" in kv:
            k, v = kv.split("=", 1)
            out[k.strip()] = v.strip()
    return out


class _MockVersionedS3:
    """In-memory versioned S3 + .tflock + Metadata + conditional-write precondition simulator."""

    def __init__(self, initial_bytes: bytes | None = None, initial_meta: dict | None = None):
        self.versions: list[dict] = []
        self.lock_bytes: bytes | None = None
        self.fail_put = False
        self.lost_put_response = False
        self.corrupt_readback = False
        self.drift_version_on_readback = False
        self.mutate_before_put_bytes: bytes | None = None
        self.put_calls = 0
        self.head_calls = 0
        if initial_bytes is not None:
            self._append_version(initial_bytes, initial_meta or {})

    def _etag(self, data: bytes) -> str:
        return f'"{hashlib.md5(data).hexdigest()}"'

    def _append_version(self, data: bytes, metadata: dict | None = None) -> dict:
        v = {
            "bytes": data, "version_id": f"v{len(self.versions) + 1}",
            "etag": self._etag(data), "size": len(data), "metadata": dict(metadata or {}),
        }
        self.versions.append(v)
        return v

    @property
    def current(self) -> dict | None:
        return self.versions[-1] if self.versions else None

    def run(self, cmd, **_kw):
        sub = cmd[:3]
        if sub == ["aws", "s3api", "head-object"]:
            self.head_calls += 1
            if not self.current:
                return subprocess.CompletedProcess(cmd, 254, stdout="", stderr="404 Not Found")
            meta = {
                "VersionId": self.current["version_id"], "ETag": self.current["etag"],
                "ContentLength": self.current["size"], "Metadata": self.current["metadata"],
            }
            return subprocess.CompletedProcess(cmd, 0, stdout=json.dumps(meta), stderr="")

        if sub == ["aws", "s3api", "put-object"]:
            key = cmd[cmd.index("--key") + 1]
            body_bytes = pathlib.Path(cmd[cmd.index("--body") + 1]).read_bytes()
            if key.endswith(".tflock"):
                if "--if-none-match" in cmd and self.lock_bytes is not None:
                    return subprocess.CompletedProcess(cmd, 254, stdout="", stderr="PreconditionFailed (412)")
                self.lock_bytes = body_bytes
                return subprocess.CompletedProcess(cmd, 0, stdout=json.dumps({"VersionId": "lv1", "ETag": '"le1"'}), stderr="")

            self.put_calls += 1
            if self.mutate_before_put_bytes is not None:
                self._append_version(self.mutate_before_put_bytes)
                self.mutate_before_put_bytes = None
            if self.fail_put:
                return subprocess.CompletedProcess(cmd, 254, stdout="", stderr="PutObject failed: network timeout")
            if "--if-none-match" in cmd and self.current is not None:
                return subprocess.CompletedProcess(cmd, 254, stdout="", stderr="PreconditionFailed (412)")
            if "--if-match" in cmd:
                expected = cmd[cmd.index("--if-match") + 1]
                if not self.current or self.current["etag"] != expected:
                    return subprocess.CompletedProcess(cmd, 254, stdout="", stderr="PreconditionFailed (412)")
            meta = _parse_metadata_arg(cmd[cmd.index("--metadata") + 1]) if "--metadata" in cmd else {}
            v = self._append_version(body_bytes, meta)
            if self.lost_put_response:
                self.lost_put_response = False
                return subprocess.CompletedProcess(cmd, 254, stdout="", stderr="Connection reset by peer while reading PutObject response")
            return subprocess.CompletedProcess(cmd, 0, stdout=json.dumps({"VersionId": v["version_id"], "ETag": v["etag"]}), stderr="")

        if sub == ["aws", "s3api", "delete-object"]:
            key = cmd[cmd.index("--key") + 1]
            if key.endswith(".tflock"):
                self.lock_bytes = None
            return subprocess.CompletedProcess(cmd, 0, stdout="{}", stderr="")

        if sub == ["aws", "s3api", "get-object"]:
            key = cmd[cmd.index("--key") + 1]
            dest = pathlib.Path(cmd[-3])
            if key.endswith(".tflock"):
                if self.lock_bytes is None:
                    return subprocess.CompletedProcess(cmd, 254, stdout="", stderr="NoSuchKey (404)")
                dest.write_bytes(self.lock_bytes)
                return subprocess.CompletedProcess(cmd, 0, stdout=json.dumps({"VersionId": "lv1", "ETag": '"le1"'}), stderr="")
            if not self.current:
                return subprocess.CompletedProcess(cmd, 254, stdout="", stderr="NoSuchKey (404)")
            data = self.current["bytes"]
            vid = self.current["version_id"]
            if self.corrupt_readback and self.put_calls > 0:
                data = _make_state(serial=max(1, json.loads(data)["serial"] - 1), lineage=json.loads(data)["lineage"])
            if self.drift_version_on_readback and self.put_calls > 0:
                vid = "v-drifted-concurrent"
            dest.write_bytes(data)
            out_doc = {"VersionId": vid, "ETag": self.current["etag"], "ContentLength": len(data), "Metadata": self.current["metadata"]}
            return subprocess.CompletedProcess(cmd, 0, stdout=json.dumps(out_doc), stderr="")

        if sub == ["aws", "s3", "cp"] and cmd[3].startswith("s3://"):
            if not self.current:
                return subprocess.CompletedProcess(cmd, 1, stdout="", stderr="NoSuchKey")
            pathlib.Path(cmd[4]).write_bytes(self.current["bytes"])
            return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")

        return subprocess.CompletedProcess(cmd, 1, stdout="", stderr=f"unexpected cmd {cmd}")


class _CrashAfterTf(BaseException):
    """Simulates hard process interruption right after Terraform exits 0."""


class TestTfStateReconciliation(unittest.TestCase):
    def test_1_and_2_apply_then_destroy_with_verified_s3_sync(self):
        with tempfile.TemporaryDirectory() as td:
            td_p = pathlib.Path(td)
            local_p, jpath = td_p / "terraform.tfstate", td_p / "journal.json"
            s1 = _make_state(1, "lin-a", [{"mode": "managed", "type": "aws_vpc", "name": "v", "instances": [{"attributes": {"id": "vpc-1"}}]}])
            s2 = _make_state(2, "lin-a", [])
            s3 = _MockVersionedS3(None)

            # 1: Normal apply -> verified sync + VersionId + result_resource_inventory
            apply_res = tfstate_reconciler.run_managed_terraform_mutation(
                operation_type="apply", tf_commands=[["terraform", "apply", "-auto-approve"]],
                cwd=td_p, local_path=local_p, account_id=ACCOUNT, region=REGION,
                exec_tf_fn=lambda c: (local_p.write_bytes(s1), subprocess.CompletedProcess(c, 0, "", ""))[1],
                run_fn=s3.run, journal_path=jpath,
            )
            self.assertEqual((apply_res["status"], apply_res["sync"]["serial"], apply_res["sync"]["version_id"]), ("completed", 1, "v1"))
            j1 = tfstate_journal.TfStateJournal(jpath).load()["history"][-1]
            self.assertEqual(j1["result_resource_inventory"], ["managed:aws_vpc.v:1:vpc-1"])

            # 2: Normal destroy -> verified sync -> v2
            destroy_res = tfstate_reconciler.run_managed_terraform_mutation(
                operation_type="destroy", tf_commands=[["terraform", "destroy", "-auto-approve"]],
                cwd=td_p, local_path=local_p, account_id=ACCOUNT, region=REGION,
                exec_tf_fn=lambda c: (local_p.write_bytes(s2), subprocess.CompletedProcess(c, 0, "", ""))[1],
                run_fn=s3.run, journal_path=jpath,
            )
            self.assertEqual((destroy_res["status"], destroy_res["sync"]["serial"], destroy_res["sync"]["version_id"]), ("completed", 2, "v2"))
            self.assertEqual(s3.current["bytes"], s2)

    def test_3_terraform_succeeds_but_s3_upload_fails_marks_pending(self):
        with tempfile.TemporaryDirectory() as td:
            td_p = pathlib.Path(td)
            local_p, jpath = td_p / "terraform.tfstate", td_p / "journal.json"
            s10 = _make_state(10, "lin-a", [{"mode": "managed", "type": "aws_eip", "name": "e", "instances": [{"attributes": {"id": "eip-1"}}]}])
            s11 = _make_state(11, "lin-a", [])
            local_p.write_bytes(s10)
            s3 = _MockVersionedS3(s10)
            s3.fail_put = True

            with self.assertRaises(tfstate_reconciler.StateSyncPendingError):
                tfstate_reconciler.run_managed_terraform_mutation(
                    operation_type="destroy", tf_commands=[["terraform", "destroy", "-auto-approve"]],
                    cwd=td_p, local_path=local_p, account_id=ACCOUNT, region=REGION,
                    exec_tf_fn=lambda c: (local_p.write_bytes(s11), subprocess.CompletedProcess(c, 0, "", ""))[1],
                    run_fn=s3.run, journal_path=jpath,
                )
            self.assertEqual((local_p.read_bytes(), s3.current["bytes"], s3.current["version_id"]), (s11, s10, "v1"))
            pending = tfstate_journal.TfStateJournal(jpath).inspect_local_pending_sync(local_p)
            self.assertTrue(pending["pending"])
            self.assertEqual(pending["operation"]["result_serial"], 11)

    def test_4_5_6_crash_after_tf_restart_and_resume_without_repeating_terraform(self):
        with tempfile.TemporaryDirectory() as td:
            td_p = pathlib.Path(td)
            local_p, jpath = td_p / "terraform.tfstate", td_p / "journal.json"
            s5 = _make_state(5, "lin-a", [{"mode": "managed", "type": "aws_vpc", "name": "v", "instances": [{"attributes": {"id": "vpc-5"}}]}])
            s6 = _make_state(6, "lin-a", [])
            local_p.write_bytes(s5)
            s3 = _MockVersionedS3(s5)
            tf_invocations = 0

            orig_sync = tfstate_reconciler.sync_local_state_to_s3_verified
            tfstate_reconciler.sync_local_state_to_s3_verified = lambda **_: (_ for _ in ()).throw(_CrashAfterTf("killed"))
            try:
                with self.assertRaises(_CrashAfterTf):
                    tfstate_reconciler.run_managed_terraform_mutation(
                        operation_type="destroy", tf_commands=[["terraform", "destroy"]],
                        cwd=td_p, local_path=local_p, account_id=ACCOUNT, region=REGION,
                        exec_tf_fn=lambda c: (local_p.write_bytes(s6), subprocess.CompletedProcess(c, 0, "", ""))[1],
                        run_fn=s3.run, journal_path=jpath,
                    )
            finally:
                tfstate_reconciler.sync_local_state_to_s3_verified = orig_sync

            status = tfstate_reconciler.inspect_state_status(
                local_path=local_p, account_id=ACCOUNT, region=REGION, run_fn=s3.run, journal_path=jpath
            )
            self.assertEqual(status["classification"], tfstate_reconciler.STATE_SYNC_PENDING)
            self.assertTrue(status["proven_local_mutation"])

            # New mutation blocked with auto_resume_pending=False without executing Terraform
            with self.assertRaises(tfstate_reconciler.StateSyncPendingError):
                tfstate_reconciler.run_managed_terraform_mutation(
                    operation_type="apply", tf_commands=[["terraform", "apply"]],
                    cwd=td_p, local_path=local_p, account_id=ACCOUNT, region=REGION,
                    exec_tf_fn=lambda c: (_ for _ in ()).throw(AssertionError("Terraform must not run")),
                    run_fn=s3.run, journal_path=jpath, auto_resume_pending=False,
                )

            rec = tfstate_reconciler.reconcile_terraform_state(
                local_path=local_p, account_id=ACCOUNT, region=REGION, run_fn=s3.run, journal_path=jpath
            )
            self.assertEqual((rec["status"], s3.current["bytes"], tf_invocations), ("resumed_sync", s6, 0))
            hist = tfstate_journal.TfStateJournal(jpath).load()["history"][-1]
            self.assertEqual(hist["recovery_attempts"], 1)

    def test_7_8_local_ahead_proven_vs_unproven_and_28_serial_330_incident(self):
        with tempfile.TemporaryDirectory() as td:
            td_p = pathlib.Path(td)
            local_p, jpath = td_p / "terraform.tfstate", td_p / "journal.json"
            s1, s2 = _make_state(1, "lin-x"), _make_state(2, "lin-x")
            local_p.write_bytes(s2)
            s3 = _MockVersionedS3(s1)

            # 8: Higher serial without journal proof NEVER auto-promotes
            st = tfstate_reconciler.inspect_state_status(local_path=local_p, account_id=ACCOUNT, region=REGION, run_fn=s3.run, journal_path=jpath)
            self.assertEqual((st["classification"], st["proven_local_mutation"]), (tfstate_reconciler.LOCAL_AHEAD, False))
            with self.assertRaises(tfstate_reconciler.StateDivergenceError):
                tfstate_reconciler.reconcile_terraform_state(local_path=local_p, account_id=ACCOUNT, region=REGION, run_fn=s3.run, journal_path=jpath)
            self.assertEqual(s3.current["bytes"], s1)

            # 7: With valid journal proof, sync resumes safely
            j = tfstate_journal.TfStateJournal(jpath)
            p_loc = tfstate_reconciler.parse_and_validate_tfstate(local_p)
            op = j.start_operation(
                operation_type="destroy", workspace="default", backend_bucket=BUCKET, backend_key=KEY,
                account_id=ACCOUNT, region=REGION, prev_local=None,
                prev_remote_meta={"version_id": "v1", "etag": s3.current["etag"]},
                prev_remote_state={"lineage": "lin-x", "serial": 1, "sha256": hashlib.sha256(s1).hexdigest(), "resource_count": 0},
            )
            j.record_terraform_result(op["operation_id"], exit_code=0, result_local=p_loc, sync_status="STATE_SYNC_PENDING")
            rec = tfstate_reconciler.reconcile_terraform_state(local_path=local_p, account_id=ACCOUNT, region=REGION, run_fn=s3.run, journal_path=jpath)
            self.assertEqual((rec["status"], s3.current["bytes"]), ("resumed_sync", s2))

            # 28: Exact serial-330 reproduction (lineage=5df018bd-c806-4c5d-57a3-1e1735cc61e9)
            lin_330 = "5df018bd-c806-4c5d-57a3-1e1735cc61e9"
            jpath_330 = td_p / "journal_330.json"
            s320 = _make_state(320, lin_330, [{"mode": "managed", "type": "aws_instance", "name": "web", "instances": [{"attributes": {"id": "i-old"}}]}])
            s330 = _make_state(330, lin_330, [])
            local_p.write_bytes(s330)
            s3_330 = _MockVersionedS3(s320)
            insp_330 = tfstate_reconciler.inspect_state_status(
                local_path=local_p, account_id=ACCOUNT, region=REGION, run_fn=s3_330.run, journal_path=jpath_330
            )
            self.assertEqual((insp_330["classification"], insp_330["proven_local_mutation"]), (tfstate_reconciler.LOCAL_AHEAD, False))
            with self.assertRaises(tfstate_reconciler.StateDivergenceError):
                tfstate_reconciler.reconcile_terraform_state(
                    local_path=local_p, account_id=ACCOUNT, region=REGION, run_fn=s3_330.run, journal_path=jpath_330
                )
            self.assertEqual(s3_330.current["bytes"], s320)
            # Explicit authorized promotion promotes serial 330 and records completed journal entry
            prom = tfstate_reconciler.reconcile_terraform_state(
                local_path=local_p, account_id=ACCOUNT, region=REGION, run_fn=s3_330.run,
                journal_path=jpath_330, allow_promote_local=True,
            )
            self.assertEqual((prom["status"], s3_330.current["bytes"]), ("promoted_local", s330))

    def test_9_10_11_remote_ahead_same_serial_and_lineage_mismatch(self):
        with tempfile.TemporaryDirectory() as td:
            td_p = pathlib.Path(td)
            local_p, jpath = td_p / "terraform.tfstate", td_p / "journal.json"

            # 9: REMOTE_AHEAD never overwrites remote; adopts only with allow_adopt_remote and records history
            s_old = _make_state(3, "lin-a")
            s_new = _make_state(7, "lin-a", [{"mode": "managed", "type": "aws_vpc", "name": "v", "instances": [{"attributes": {"id": "vpc-7"}}]}])
            local_p.write_bytes(s_old)
            s3 = _MockVersionedS3(s_new, initial_meta={"lineage": "lin-a", "serial": "7", "sha256": hashlib.sha256(s_new).hexdigest()})
            with self.assertRaises(tfstate_reconciler.StateDivergenceError):
                tfstate_reconciler.reconcile_terraform_state(local_path=local_p, account_id=ACCOUNT, region=REGION, run_fn=s3.run, journal_path=jpath, allow_adopt_remote=False)
            self.assertEqual(s3.current["bytes"], s_new)
            adopted = tfstate_reconciler.reconcile_terraform_state(local_path=local_p, account_id=ACCOUNT, region=REGION, run_fn=s3.run, journal_path=jpath, allow_adopt_remote=True)
            self.assertEqual((adopted["status"], local_p.read_bytes()), ("adopted_remote", s_new))
            self.assertEqual(tfstate_journal.TfStateJournal(jpath).load()["history"][-1]["operation_type"], "reconcile_adopt_remote")

            # 10: SAME_SERIAL_DIFFERENT_CONTENT always fails closed
            s7_alt = _make_state(7, "lin-a", [{"mode": "managed", "type": "aws_eip", "name": "x", "instances": [{"attributes": {"id": "eip-x"}}]}])
            local_p.write_bytes(s7_alt)
            with self.assertRaises(tfstate_reconciler.StateDivergenceError):
                tfstate_reconciler.reconcile_terraform_state(
                    local_path=local_p, account_id=ACCOUNT, region=REGION, run_fn=s3.run, journal_path=jpath,
                    allow_adopt_remote=True, allow_promote_local=True,
                )
            self.assertEqual((local_p.read_bytes(), s3.current["bytes"]), (s7_alt, s_new))

            # 11: LINEAGE_MISMATCH always fails closed
            local_p.write_bytes(_make_state(20, "lin-foreign"))
            with self.assertRaises(tfstate_reconciler.StateDivergenceError):
                tfstate_reconciler.reconcile_terraform_state(
                    local_path=local_p, account_id=ACCOUNT, region=REGION, run_fn=s3.run, journal_path=jpath,
                    allow_adopt_remote=True, allow_promote_local=True,
                )
            self.assertEqual(s3.current["bytes"], s_new)

    def test_14_15_16_17_etag_drift_412_lost_response_and_verification_failure(self):
        with tempfile.TemporaryDirectory() as td:
            td_p = pathlib.Path(td)
            local_p, jpath = td_p / "terraform.tfstate", td_p / "journal.json"
            s1, s2, s_conc = _make_state(1, "lin-a"), _make_state(2, "lin-a"), _make_state(3, "lin-a")
            local_p.write_bytes(s1)
            s3 = _MockVersionedS3(s1)
            j = tfstate_journal.TfStateJournal(jpath)

            # 14 & 15: ETag drift + PreconditionFailed 412 aborts without overwriting concurrent remote write
            op = j.start_operation(
                operation_type="apply", workspace="default", backend_bucket=BUCKET, backend_key=KEY,
                account_id=ACCOUNT, region=REGION, prev_local=tfstate_reconciler.parse_and_validate_tfstate(local_p),
                prev_remote_meta={"version_id": "v1", "etag": s3.current["etag"]},
            )
            local_p.write_bytes(s2)
            j.record_terraform_result(op["operation_id"], exit_code=0, result_local=tfstate_reconciler.parse_and_validate_tfstate(local_p), sync_status="STATE_SYNC_PENDING")
            expected_etag = s3.current["etag"]
            s3.mutate_before_put_bytes = s_conc
            with self.assertRaises(tfstate_reconciler.StateSyncPendingError) as ctx:
                tfstate_reconciler.sync_local_state_to_s3_verified(
                    local_path=local_p, account_id=ACCOUNT, region=REGION, expected_remote_etag=expected_etag,
                    expected_remote_version_id="v1", run_fn=s3.run, journal=j, operation_id=op["operation_id"],
                )
            self.assertTrue(any(m in str(ctx.exception).lower() for m in ("preconditionfailed", "changed between inspection")))
            self.assertEqual(s3.current["bytes"], s_conc)

            # 16: Lost client response after S3 committed exact upload recovers cleanly without duplicate put
            local_p.write_bytes(s1)
            s3_lost = _MockVersionedS3(s1)
            s3_lost.lost_put_response = True
            j2 = tfstate_journal.TfStateJournal(td_p / "j2.json")
            res_lost = tfstate_reconciler.run_managed_terraform_mutation(
                operation_type="apply", tf_commands=[["terraform", "apply"]],
                cwd=td_p, local_path=local_p, account_id=ACCOUNT, region=REGION,
                exec_tf_fn=lambda c: (local_p.write_bytes(s2), subprocess.CompletedProcess(c, 0, "", ""))[1],
                run_fn=s3_lost.run, journal_path=td_p / "j2.json",
            )
            self.assertEqual((res_lost["sync"]["status"], s3_lost.put_calls, s3_lost.current["bytes"]), ("synchronized_after_lost_response", 1, s2))

            # 17: VersionId drift after upload triggers StateSyncPendingError
            s3_vid = _MockVersionedS3(s2)
            s3_vid.drift_version_on_readback = True
            local_p.write_bytes(s2)
            with self.assertRaises(tfstate_reconciler.StateSyncPendingError) as ctx_v:
                tfstate_reconciler.run_managed_terraform_mutation(
                    operation_type="destroy", tf_commands=[["terraform", "destroy"]],
                    cwd=td_p, local_path=local_p, account_id=ACCOUNT, region=REGION,
                    exec_tf_fn=lambda c: (local_p.write_bytes(s_conc), subprocess.CompletedProcess(c, 0, "", ""))[1],
                    run_fn=s3_vid.run, journal_path=td_p / "j3.json",
                )
            self.assertIn("versionid", str(ctx_v.exception).lower())

    def test_12_13_25_missing_states_idempotency_and_readback_checksum_mismatch(self):
        with tempfile.TemporaryDirectory() as td:
            td_p = pathlib.Path(td)
            local_p, jpath = td_p / "terraform.tfstate", td_p / "journal.json"

            # Both missing -> synchronized
            s3_empty = _MockVersionedS3(None)
            self.assertEqual(
                tfstate_reconciler.inspect_state_status(local_path=local_p, account_id=ACCOUNT, region=REGION, run_fn=s3_empty.run, journal_path=jpath)["classification"],
                tfstate_reconciler.STATE_SYNCHRONIZED,
            )
            # 13: REMOTE_MISSING fails closed without promote flag
            s1 = _make_state(2, "lin-a", [{"mode": "managed", "type": "aws_vpc", "name": "v", "instances": [{"attributes": {"id": "vpc-1"}}]}])
            local_p.write_bytes(s1)
            with self.assertRaises(tfstate_reconciler.StateDivergenceError):
                tfstate_reconciler.reconcile_terraform_state(local_path=local_p, account_id=ACCOUNT, region=REGION, run_fn=s3_empty.run, journal_path=jpath)

            # 12: LOCAL_MISSING fails closed without adopt flag
            local_p.unlink()
            s3_has = _MockVersionedS3(s1)
            with self.assertRaises(tfstate_reconciler.StateDivergenceError):
                tfstate_reconciler.reconcile_terraform_state(local_path=local_p, account_id=ACCOUNT, region=REGION, run_fn=s3_has.run, journal_path=jpath)

            # 25: Repeated reconciliation is idempotent (0 redundant puts)
            local_p.write_bytes(s1)
            r1 = tfstate_reconciler.reconcile_terraform_state(local_path=local_p, account_id=ACCOUNT, region=REGION, run_fn=s3_has.run, journal_path=jpath)
            r2 = tfstate_reconciler.reconcile_terraform_state(local_path=local_p, account_id=ACCOUNT, region=REGION, run_fn=s3_has.run, journal_path=jpath)
            self.assertEqual((r1["status"], r2["status"], s3_has.put_calls), ("unchanged", "unchanged", 0))

            # 17b: Post-upload readback checksum mismatch raises StateSyncPendingError
            s2 = _make_state(3, "lin-a")
            s3_has.corrupt_readback = True
            with self.assertRaises(tfstate_reconciler.StateSyncPendingError) as ctx:
                tfstate_reconciler.run_managed_terraform_mutation(
                    operation_type="destroy", tf_commands=[["terraform", "destroy"]],
                    cwd=td_p, local_path=local_p, account_id=ACCOUNT, region=REGION,
                    exec_tf_fn=lambda c: (local_p.write_bytes(s2), subprocess.CompletedProcess(c, 0, "", ""))[1],
                    run_fn=s3_has.run, journal_path=jpath,
                )
            self.assertIn("mismatch", str(ctx.exception).lower())
            self.assertTrue(tfstate_journal.TfStateJournal(jpath).inspect_local_pending_sync(local_p)["pending"])


if __name__ == "__main__":
    unittest.main()
