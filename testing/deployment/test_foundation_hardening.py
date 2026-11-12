#!/usr/bin/env python3
"""
EnvScale Foundation Hardening Unit & Security Regression Tests.

Covers:
  - Foundation workflow branch authorization & plan artifact attestation integrity
  - Separated read-only plan vs protected environment apply structure
  - Day-0 dedicated identity enforcement & true permissions boundary invariants
  - Protected foundation IAM immutability, trust-policy hardening & unsafe IAM mutation rejection
"""

from __future__ import annotations

import importlib.util
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
BOOTSTRAP_DIR = REPO_ROOT / "deployment" / "bootstrap"
if str(BOOTSTRAP_DIR) not in sys.path:
    sys.path.insert(0, str(BOOTSTRAP_DIR))

import day0_identity_guard  # noqa: E402
import foundation_workflow_guard  # noqa: E402
import plan_iam_safety  # noqa: E402


def _load_plan_validator():
    spec = importlib.util.spec_from_file_location(
        "validate_foundation_plan", BOOTSTRAP_DIR / "validate-foundation-plan.py"
    )
    mod = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(mod)
    return mod


class TestFoundationHardening(unittest.TestCase):
    def setUp(self) -> None:
        self._env_patch = mock.patch.dict(os.environ, {"GITHUB_ACTIONS": "", "CI": ""}, clear=False)
        self._env_patch.start()
        self.addCleanup(self._env_patch.stop)

    def test_authorized_and_unauthorized_workflow_branches(self):
        self.assertEqual(foundation_workflow_guard.check_authorized_branch("refs/heads/develop"), "refs/heads/develop")
        self.assertEqual(foundation_workflow_guard.check_authorized_branch("refs/heads/main"), "refs/heads/main")
        for bad_ref in ("refs/heads/feature/pranav-k8s-streamer", "refs/tags/v1.0.0", "refs/pull/42/merge", ""):
            with self.assertRaises(SystemExit):
                foundation_workflow_guard.check_authorized_branch(bad_ref)

    def test_plan_attestation_write_verify_and_tamper_detection(self):
        with tempfile.TemporaryDirectory(prefix="envscale-att-") as td:
            d = pathlib.Path(td)
            bin_p, json_p, rec_p = d / "tfplan.bin", d / "tfplan.json", d / "tfplan.recheck.json"
            att_p, sums_p = d / "plan-attestation.json", d / "SHA256SUMS"
            plan_doc = {"format_version": "1.2", "resource_changes": []}
            bin_p.write_bytes(b"FAKE-TFPLAN-BINARY-BYTES")
            json_p.write_text(json.dumps(plan_doc), encoding="utf-8")
            rec_p.write_text(json.dumps(plan_doc), encoding="utf-8")

            kw = dict(
                commit_sha="deadbeef" * 5,
                git_ref="refs/heads/develop",
                run_id="123456",
                run_attempt="1",
                tfstate_bucket="envscale-tfstate-982534376726-ap-south-1",
                state_key="foundation/terraform.tfstate",
            )
            foundation_workflow_guard.write_attestation(
                bin_path=bin_p, json_path=json_p, out_path=att_p, sums_path=sums_p,
                plan_mode="update", has_changes="true", **kw,
            )
            verify_kw = dict(
                bin_path=bin_p, json_path=json_p, recheck_json_path=rec_p,
                att_path=att_p, sums_path=sums_p,
                expected_sha=kw["commit_sha"], expected_ref=kw["git_ref"],
                expected_run_id=kw["run_id"], expected_run_attempt=kw["run_attempt"],
                expected_bucket=kw["tfstate_bucket"], expected_key=kw["state_key"],
            )
            foundation_workflow_guard.verify_attestation(**verify_kw)

            # Tamper, provenance, expiry, state-key consistency, and stale-state checks
            for bad_patch in (
                {"expected_sha": "0" * 40},
                {"expected_run_id": "999999"},
                {"expected_repository": "attacker/EnvScale"},
                {"expected_key": "foundation/other.tfstate"},
                {"current_state_fingerprint": "etag:mutated|ver:2"},
                {"now_epoch": int(json.loads(att_p.read_text())["expires_at_epoch"]) + 1},
                {"now_epoch": int(json.loads(att_p.read_text())["created_at_epoch"]) - 120},
            ):
                with self.assertRaises(SystemExit):
                    foundation_workflow_guard.verify_attestation(**{**verify_kw, **bad_patch})
            rec_p.write_text(json.dumps({"format_version": "1.2", "resource_changes": [{"address": "evil"}]}), encoding="utf-8")
            with self.assertRaises(SystemExit):
                foundation_workflow_guard.verify_attestation(**verify_kw)
            rec_p.write_text(json.dumps(plan_doc), encoding="utf-8")
            bin_p.write_bytes(b"TAMPERED-PLAN")
            with self.assertRaises(SystemExit):
                foundation_workflow_guard.verify_attestation(**verify_kw)

    def test_foundation_workflow_separates_plan_and_protected_apply(self):
        wf = (REPO_ROOT / ".github/workflows/foundation.yml").read_text(encoding="utf-8")
        for req in (
            "environment: foundation-plan", "environment: foundation\n", "AWS_FOUNDATION_PLAN_ROLE_ARN",
            "AWS_FOUNDATION_ROLE_ARN", "-lock=false", "write-attestation", "verify-attestation",
            "--current-state-fingerprint", "retention-days: 1", "needs: plan", "needs.plan.outputs.has_changes == 'true'",
        ):
            self.assertIn(req, wf)
        self.assertNotIn("--allow-protected-iam-updates", wf)
        self.assertNotIn("inputs.state_key", wf)
        self.assertIn('STATE_KEY: "foundation/terraform.tfstate"', wf)
        self.assertLess(wf.index("environment: foundation-plan"), wf.index("environment: foundation\n"))
        self.assertLess(wf.index("verify-attestation"), wf.index("terraform apply -input=false -auto-approve tfplan.bin"))

    def test_day0_identity_and_boundary_guards(self):
        self.assertIn("envscale-day0-bootstrap", day0_identity_guard.validate_day0_caller_identity({"Account": "982534376726", "Arn": "arn:aws:iam::982534376726:user/envscale-day0-bootstrap"}))
        self.assertIn("assumed-role/envscale-day0-bootstrap-ci", day0_identity_guard.validate_day0_caller_identity({"Account": "982534376726", "Arn": "arn:aws:sts::982534376726:assumed-role/envscale-day0-bootstrap-ci/session1"}))

        for bad_arn in (
            "arn:aws:iam::982534376726:root",
            "arn:aws:iam::982534376726:user/DEV-user-alpha",
            "arn:aws:sts::982534376726:assumed-role/envscale-foundation-admin-role/op",
            "arn:aws:sts::982534376726:assumed-role/envscale-github-foundation-role/gha",
        ):
            with self.assertRaises(SystemExit):
                day0_identity_guard.validate_day0_caller_identity({"Account": "982534376726", "Arn": bad_arn})

        day0_identity_guard.validate_day0_policy_pair(
            BOOTSTRAP_DIR / "day0-bootstrap-policy.json",
            BOOTSTRAP_DIR / "day0-bootstrap-permissions-boundary.json",
        )

    def test_plan_validator_blocks_self_escalation_breakglass_and_unsafe_iam(self):
        vfp = _load_plan_validator()
        self.assertFalse(vfp.validate_plan_doc(vfp.make_valid_plan_doc("bootstrap"), mode="bootstrap", allow_protected_iam_updates=True))
        self.assertTrue(vfp.validate_plan_doc(vfp.make_valid_plan_doc("bootstrap"), mode="bootstrap", allow_protected_iam_updates=False))
        for protected_addr in ("aws_iam_role.github_foundation", "aws_iam_role_policy.github_foundation", "aws_iam_role.github_foundation_plan", "aws_iam_role_policy.foundation_admin[0]", "aws_iam_policy.workload_permissions_boundary"):
            for m, act in (("initial", ["create"]), ("update", ["update"])):
                plan = vfp.make_valid_plan_doc(m)
                next(rc for rc in plan["resource_changes"] if rc["address"] == protected_addr)["change"]["actions"] = act
                self.assertTrue(vfp.validate_plan_doc(plan, mode=m, allow_protected_iam_updates=False), f"Expected {m} rejection for {protected_addr} {act}")
                self.assertFalse(vfp.validate_plan_doc(plan, mode=m, allow_protected_iam_updates=True))

        unsafe_cases = [
            ("missing boundary", "aws_iam_role.github_deploy", {
                "actions": ["update"], "after": {"name": "envscale-github-deploy-role", "permissions_boundary": None}, "after_unknown": {},
            }),
            ("StringLike trust", "aws_iam_role.github_deploy", {
                "actions": ["update"], "after": {"permissions_boundary": "arn:aws:iam::982534376726:policy/envscale-workload-permissions-boundary", "assume_role_policy": '{"Statement":[{"Effect":"Allow","Principal":{"Federated":"x"},"Condition":{"StringLike":{"sub":"*"}}}]}'},
            }),
            ("wildcard allow", "aws_iam_role_policy.github_deploy", {
                "actions": ["update"], "after": {"policy": '{"Statement":[{"Effect":"Allow","Action":"*","Resource":"*"}]}'},
            }),
            ("workload iam escalation", "aws_iam_role_policy.github_deploy", {
                "actions": ["update"], "after": {"policy": '{"Statement":[{"Effect":"Allow","Action":["iam:PutRolePolicy"],"Resource":"*"}]}'},
            }),
            ("unrestricted iam:PassRole missing PassedToService", "aws_iam_policy.workload_permissions_boundary", {
                "actions": ["create"], "after": {"policy": '{"Statement":[{"Effect":"Allow","Action":["iam:PassRole"],"Resource":"*"}]}'},
            }),
            ("unrestricted iam:PassRole wildcard PassedToService", "aws_iam_policy.workload_permissions_boundary", {
                "actions": ["create"], "after": {"policy": '{"Statement":[{"Effect":"Allow","Action":["iam:PassRole"],"Resource":"*","Condition":{"StringEquals":{"iam:PassedToService":"*"}}}]}'},
            }),
            ("foreign account in trust policy", "aws_iam_role.github_deploy", {
                "actions": ["update"], "after": {"permissions_boundary": "arn:aws:iam::982534376726:policy/envscale-workload-permissions-boundary", "assume_role_policy": '{"Statement":[{"Effect":"Allow","Principal":{"AWS":"arn:aws:iam::111122223333:user/op"}}]}'},
            }),
            ("unauthorized managed policy attachment", "aws_iam_role_policy_attachment.ec2_runtime_ssm_core", {
                "actions": ["update"], "after": {"role": "envscale-ec2-runtime-role", "policy_arn": "arn:aws:iam::aws:policy/AdministratorAccess"},
            }),
            ("foundation hidden self-escalation", "aws_iam_role_policy.github_foundation", {
                "actions": ["create"], "after": {"policy": '{"Statement":[{"Sid":"DenySelfAndBreakGlassAdminMutation","Effect":"Deny","Action":"iam:Delete*","Resource":"*"},{"Sid":"DenyBoundaryRemovalAndPolicyWeakening","Effect":"Deny","Action":"iam:Delete*","Resource":"*"},{"Effect":"Allow","Action":["iam:PutRolePolicy"],"Resource":["arn:aws:iam::982534376726:role/envscale-github-foundation-role"]}]}'},
            }),
            ("recovery public-access-block weakened", "aws_s3_bucket_public_access_block.recovery", {
                "actions": ["update"], "after": {"block_public_acls": True, "ignore_public_acls": False, "block_public_policy": True, "restrict_public_buckets": True},
            }),
        ]
        for label, addr, change_doc in unsafe_cases:
            with self.subTest(label=label):
                plan = vfp.make_valid_plan_doc("update")
                rc = next(r for r in plan["resource_changes"] if r["address"] == addr)
                rc["change"] = change_doc
                self.assertTrue(plan_iam_safety.check_iam_resource_change_safety(rc), f"Expected unsafe IAM detection for {label}")
                self.assertTrue(vfp.validate_plan_doc(plan, mode="update", allow_protected_iam_updates=True), f"Expected validate_plan_doc failure for {label}")

    def test_day0_attached_boundary_and_bucket_policy_negative_cases(self):
        id_path = BOOTSTRAP_DIR / "day0-bootstrap-policy.json"
        pb_path = BOOTSTRAP_DIR / "day0-bootstrap-permissions-boundary.json"
        id_doc = json.loads(id_path.read_text(encoding="utf-8"))
        pb_doc = json.loads(pb_path.read_text(encoding="utf-8"))
        sts_user = {"Account": "982534376726", "Arn": "arn:aws:iam::982534376726:user/envscale-day0-bootstrap"}
        expected_pb = "arn:aws:iam::982534376726:policy/envscale-day0-bootstrap-permissions-boundary"
        expected_id = "arn:aws:iam::982534376726:policy/envscale-day0-bootstrap-policy"

        def make_caller(*, pb_arn=expected_pb, pb_type="PermissionsBoundaryPolicy", inline=None, attached=None, live_pb=pb_doc, live_id=id_doc):
            attached = [expected_id] if attached is None else attached
            inline = [] if inline is None else inline
            def caller(op, params):
                if op == "get-user":
                    pb = {"PermissionsBoundaryUsageType": pb_type, "PermissionsBoundaryArn": pb_arn} if pb_arn else {}
                    return {"User": {"UserName": "envscale-day0-bootstrap", "PermissionsBoundary": pb}}
                if op == "list-user-policies":
                    return {"PolicyNames": inline}
                if op == "list-attached-user-policies":
                    return {"AttachedPolicies": [{"PolicyArn": a} for a in attached]}
                if op == "get-policy":
                    return {"Policy": {"DefaultVersionId": "v1"}}
                if op == "get-policy-version":
                    arn = params[params.index("--policy-arn") + 1]
                    return {"PolicyVersion": {"Document": live_pb if arn == expected_pb else live_id}}
                raise AssertionError(f"Unexpected IAM op: {op}")
            return caller

        res = day0_identity_guard.verify_day0_attached_boundary_and_policies(sts_user, id_path, pb_path, iam_caller=make_caller())
        self.assertEqual(res["boundary_arn"], expected_pb)

        drifted_pb = json.loads(json.dumps(pb_doc))
        drifted_pb["Statement"].append({"Effect": "Allow", "Action": "iam:CreateRole", "Resource": "*"})
        for label, bad_caller in [
            ("missing permissions boundary", make_caller(pb_arn="")),
            ("wrong permissions boundary", make_caller(pb_arn="arn:aws:iam::982534376726:policy/other-boundary")),
            ("drifted live boundary document", make_caller(live_pb=drifted_pb)),
            ("inline policy present", make_caller(inline=["inline-admin"])),
            ("extra managed policy", make_caller(attached=[expected_id, "arn:aws:iam::aws:policy/AdministratorAccess"])),
            ("drifted live identity policy", make_caller(live_id={"Version": "2012-10-17", "Statement": [{"Effect": "Allow", "Action": "*", "Resource": "*"}]})),
        ]:
            with self.subTest(label=label), self.assertRaises(SystemExit):
                day0_identity_guard.verify_day0_attached_boundary_and_policies(sts_user, id_path, pb_path, iam_caller=bad_caller)

    def test_foundation_workflow_serializes_across_branches_sharing_state(self):
        grp = foundation_workflow_guard.check_concurrency_serialization(REPO_ROOT / ".github/workflows/foundation.yml")
        self.assertIn("tfstate_bucket", grp)
        self.assertIn("foundation/terraform.tfstate", grp)
        self.assertNotIn("github.ref", grp)

        with tempfile.TemporaryDirectory(prefix="envscale-wf-") as td:
            for bad_yaml in (
                "concurrency:\n  group: envscale-foundation-${{ github.ref }}\n  cancel-in-progress: false\n",
                "concurrency:\n  group: envscale-foundation-${{ inputs.tfstate_bucket }}-foundation/terraform.tfstate\n  cancel-in-progress: true\n",
                "concurrency:\n  group: envscale-foundation-static\n  cancel-in-progress: false\n",
                "concurrency:\n  group: envscale-foundation-${{ inputs.tfstate_bucket }}-${{ inputs.state_key }}\n  cancel-in-progress: false\n",
                "concurrency:\n  group: envscale-foundation-${{ inputs.tfstate_bucket }}-foundation/terraform.tfstate\n  cancel-in-progress: false\njobs:\n  plan:\n    steps:\n      - run: validate-foundation-plan.py --allow-protected-iam-updates\n",
            ):
                p = pathlib.Path(td) / "bad.yml"
                p.write_text(bad_yaml, encoding="utf-8")
                with self.assertRaises(SystemExit):
                    foundation_workflow_guard.check_concurrency_serialization(p)

    def test_day0_cannot_weaken_or_replace_state_bucket_policy_after_bootstrap(self):
        id_path = BOOTSTRAP_DIR / "day0-bootstrap-policy.json"
        pb_path = BOOTSTRAP_DIR / "day0-bootstrap-permissions-boundary.json"
        seal_path = BOOTSTRAP_DIR / "day0-initial-policy-seal.json"

        day0_identity_guard.validate_day0_policy_pair(id_path, pb_path)
        day0_identity_guard.validate_day0_initial_seal_policy(seal_path)

        id_doc = json.loads(id_path.read_text(encoding="utf-8"))
        pb_doc = json.loads(pb_path.read_text(encoding="utf-8"))
        seal_doc = json.loads(seal_path.read_text(encoding="utf-8"))

        with tempfile.TemporaryDirectory(prefix="envscale-day0-neg-") as td:
            td_path = pathlib.Path(td)

            # Mutate steady-state identity & boundary policies to re-allow or stop denying s3:PutBucketPolicy.
            def allow_put_policy(doc):
                stmt = next(s for s in doc["Statement"] if s.get("Effect") == "Allow")
                actions = stmt["Action"] if isinstance(stmt["Action"], list) else [stmt["Action"]]
                actions.append("s3:PutBucketPolicy")
                stmt["Action"] = actions

            def strip_deny_put_policy(doc):
                removed = False
                for stmt in doc["Statement"]:
                    if stmt.get("Effect") == "Deny":
                        actions = stmt["Action"] if isinstance(stmt["Action"], list) else [stmt["Action"]]
                        if "s3:PutBucketPolicy" in actions:
                            stmt["Action"] = [a for a in actions if a != "s3:PutBucketPolicy"]
                            removed = True
                if not removed:
                    raise AssertionError("Expected s3:PutBucketPolicy in a Deny statement")

            for label, base_is_id, mutator in [
                ("identity grants s3:PutBucketPolicy", True, allow_put_policy),
                ("identity removes PutBucketPolicy Deny", True, strip_deny_put_policy),
                ("boundary grants s3:PutBucketPolicy", False, allow_put_policy),
                ("boundary removes PutBucketPolicy Deny", False, strip_deny_put_policy),
            ]:
                mutated = json.loads(json.dumps(id_doc if base_is_id else pb_doc))
                mutator(mutated)
                m_path = td_path / f"{label.replace(' ', '_')}.json"
                m_path.write_text(json.dumps(mutated), encoding="utf-8")
                with self.subTest(label=label), self.assertRaises(SystemExit):
                    day0_identity_guard.validate_day0_policy_pair(
                        m_path if base_is_id else id_path,
                        pb_path if base_is_id else m_path,
                    )

            # Mutate initial seal policy to allow destructive bucket or IAM actions.
            for label, bad_action in [("seal allows DeleteBucket", "s3:DeleteBucket"), ("seal allows iam:*", "iam:*")]:
                mutated = json.loads(json.dumps(seal_doc))
                mutated["Statement"][0]["Action"].append(bad_action)
                bad_seal = td_path / f"{label.replace(' ', '_')}.json"
                bad_seal.write_text(json.dumps(mutated), encoding="utf-8")
                with self.subTest(label=label), self.assertRaises(SystemExit):
                    day0_identity_guard.validate_day0_initial_seal_policy(bad_seal)

        # Verify rendered bucket policy from bootstrap-state.sh --dry-run forbids Day-0 PutBucketPolicy.
        proc = subprocess.run(
            ["bash", str(BOOTSTRAP_DIR / "bootstrap-state.sh"), "--dry-run"],
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
            check=True,
        )
        marker = "--- Rendered Bucket Policy JSON ---\n"
        self.assertIn(marker, proc.stdout)
        rendered_raw = proc.stdout.split(marker, 1)[1].split("\n[DRY-RUN SUCCESS]", 1)[0]
        rendered_pol = json.loads(rendered_raw)
        day0_identity_guard.validate_tfstate_bucket_policy_doc(rendered_pol)

        mut_stmt = next(s for s in rendered_pol["Statement"] if s.get("Sid") == "DenyUnauthorizedBucketPolicyMutation")
        exempt_arns = mut_stmt["Condition"]["ArnNotLike"]["aws:PrincipalArn"]
        self.assertTrue(all("day0" not in a.lower() and "bootstrap" not in a.lower() for a in exempt_arns))
        self.assertTrue(any("envscale-foundation-admin-role" in a for a in exempt_arns))

        weakened_pol = json.loads(json.dumps(rendered_pol))
        weakened_mut = next(s for s in weakened_pol["Statement"] if s.get("Sid") == "DenyUnauthorizedBucketPolicyMutation")
        weakened_mut["Condition"]["ArnNotLike"]["aws:PrincipalArn"].append("arn:aws:iam::982534376726:user/envscale-day0-bootstrap")
        with self.assertRaises(SystemExit):
            day0_identity_guard.validate_tfstate_bucket_policy_doc(weakened_pol)

        no_mut_guard = json.loads(json.dumps(rendered_pol))
        no_mut_guard["Statement"] = [s for s in no_mut_guard["Statement"] if s.get("Sid") != "DenyUnauthorizedBucketPolicyMutation"]
        with self.assertRaises(SystemExit):
            day0_identity_guard.validate_tfstate_bucket_policy_doc(no_mut_guard)

        # Verify bootstrap-state.sh only applies bucket policy during initial creation or explicit reconciliation, never on an existing bucket without reconcile flag.
        script_text = (BOOTSTRAP_DIR / "bootstrap-state.sh").read_text(encoding="utf-8")
        init_pos = script_text.index('if [[ "$MODE" == "init-bucket-policy" ]]; then')
        reconcile_pos = script_text.index('if [[ "$MODE" == "reconcile-bucket-policy" ]]; then')
        apply_start = script_text.index('echo "[1/5] Verifying AWS account')
        self.assertLess(init_pos, reconcile_pos)
        self.assertLess(reconcile_pos, apply_start)
        self.assertIn("put-bucket-policy", script_text[init_pos:reconcile_pos])
        self.assertIn("put-bucket-policy", script_text[reconcile_pos:apply_start])
        self.assertIn('if [[ "$BUCKET_IS_NEW" == "true" || -n "$RECONCILE_EXISTING_FLAG" ]]; then', script_text)
        self.assertEqual(script_text.count("put-bucket-policy"), 3)

    def test_initial_seal_requires_dedicated_identity_boundary_and_rejects_day0_or_ordinary_users(self):
        seal_id_path = BOOTSTRAP_DIR / "day0-initial-policy-seal.json"
        seal_pb_path = BOOTSTRAP_DIR / "day0-initial-seal-permissions-boundary.json"
        day0_id_path = BOOTSTRAP_DIR / "day0-bootstrap-policy.json"
        day0_pb_path = BOOTSTRAP_DIR / "day0-bootstrap-permissions-boundary.json"

        day0_identity_guard.validate_initial_seal_policy_pair(seal_id_path, seal_pb_path)
        seal_id_doc = json.loads(seal_id_path.read_text(encoding="utf-8"))
        seal_pb_doc = json.loads(seal_pb_path.read_text(encoding="utf-8"))

        sts_seal = {"Account": "982534376726", "Arn": "arn:aws:iam::982534376726:user/envscale-day0-initial-seal"}
        sts_seal_role = {"Account": "982534376726", "Arn": "arn:aws:sts::982534376726:assumed-role/envscale-day0-initial-seal/seal-run"}
        expected_pb = "arn:aws:iam::982534376726:policy/envscale-day0-initial-seal-permissions-boundary"
        expected_id = "arn:aws:iam::982534376726:policy/envscale-day0-initial-seal-policy"
        valid_trust = {
            "Version": "2012-10-17",
            "Statement": [{"Effect": "Allow", "Principal": {"AWS": ["arn:aws:iam::982534376726:user/DEV-user-alpha"]}, "Action": "sts:AssumeRole"}],
        }

        def make_caller(*, pb_arn=expected_pb, pb_type="PermissionsBoundaryPolicy", inline=None, attached=None, live_pb=seal_pb_doc, live_id=seal_id_doc, trust=valid_trust):
            attached = [expected_id] if attached is None else attached
            inline = [] if inline is None else inline

            def caller(op, params):
                if op in ("get-user", "get-role"):
                    key = "User" if op == "get-user" else "Role"
                    obj = {"PermissionsBoundary": {"PermissionsBoundaryArn": pb_arn, "PermissionsBoundaryUsageType": pb_type}} if pb_arn else {}
                    if op == "get-role" and trust is not None:
                        obj["AssumeRolePolicyDocument"] = trust
                    return {key: obj}
                if op in ("list-user-policies", "list-role-policies"):
                    return {"PolicyNames": inline}
                if op in ("list-attached-user-policies", "list-attached-role-policies"):
                    return {"AttachedPolicies": [{"PolicyArn": a} for a in attached]}
                if op == "get-policy":
                    return {"Policy": {"DefaultVersionId": "v1"}}
                if op == "get-policy-version":
                    arn = params[params.index("--policy-arn") + 1]
                    return {"PolicyVersion": {"Document": live_pb if arn == expected_pb else live_id}}
                raise AssertionError(f"Unexpected IAM op: {op}")

            return caller

        for valid_sts in (sts_seal, sts_seal_role):
            res = day0_identity_guard.verify_initial_seal_attached_boundary_and_policies(
                valid_sts, seal_id_path, seal_pb_path, iam_caller=make_caller()
            )
            self.assertEqual(res["boundary_arn"], expected_pb)
            self.assertEqual(res["identity_policy_arn"], expected_id)

        # Live role trust-policy negative checks (even when attached policy and boundary are valid).
        oidc_arn = "arn:aws:iam::982534376726:oidc-provider/token.actions.githubusercontent.com"
        for label, bad_trust in [
            ("missing AssumeRolePolicyDocument", None),
            ("wildcard Principal *", {"Version": "2012-10-17", "Statement": [{"Effect": "Allow", "Principal": "*", "Action": "sts:AssumeRole"}]}),
            ("wildcard AWS *", {"Version": "2012-10-17", "Statement": [{"Effect": "Allow", "Principal": {"AWS": "*"}, "Action": "sts:AssumeRole"}]}),
            ("foreign AWS account", {"Version": "2012-10-17", "Statement": [{"Effect": "Allow", "Principal": {"AWS": ["arn:aws:iam::111122223333:user/DEV-user-alpha"]}, "Action": "sts:AssumeRole"}]}),
            ("unauthorized operator user", {"Version": "2012-10-17", "Statement": [{"Effect": "Allow", "Principal": {"AWS": ["arn:aws:iam::982534376726:user/rogue-admin"]}, "Action": "sts:AssumeRole"}]}),
            ("AWS root principal", {"Version": "2012-10-17", "Statement": [{"Effect": "Allow", "Principal": {"AWS": ["arn:aws:iam::982534376726:root"]}, "Action": "sts:AssumeRole"}]}),
            ("unintended OIDC provider", {"Version": "2012-10-17", "Statement": [{"Effect": "Allow", "Principal": {"Federated": "arn:aws:iam::982534376726:oidc-provider/evil.example.com"}, "Action": "sts:AssumeRoleWithWebIdentity", "Condition": {"StringEquals": {"token.actions.githubusercontent.com:aud": "sts.amazonaws.com", "token.actions.githubusercontent.com:sub": "repo:P20000/EnvScale:environment:day0-initial-seal"}}}]}),
            ("wildcard OIDC sub", {"Version": "2012-10-17", "Statement": [{"Effect": "Allow", "Principal": {"Federated": oidc_arn}, "Action": "sts:AssumeRoleWithWebIdentity", "Condition": {"StringEquals": {"token.actions.githubusercontent.com:aud": "sts.amazonaws.com", "token.actions.githubusercontent.com:sub": "repo:P20000/EnvScale:*"}}}]}),
            ("StringLike OIDC sub", {"Version": "2012-10-17", "Statement": [{"Effect": "Allow", "Principal": {"Federated": oidc_arn}, "Action": "sts:AssumeRoleWithWebIdentity", "Condition": {"StringLike": {"token.actions.githubusercontent.com:aud": "sts.amazonaws.com", "token.actions.githubusercontent.com:sub": "repo:P20000/EnvScale:environment:day0-initial-seal"}}}]}),
            ("unintended OIDC subject", {"Version": "2012-10-17", "Statement": [{"Effect": "Allow", "Principal": {"Federated": oidc_arn}, "Action": "sts:AssumeRoleWithWebIdentity", "Condition": {"StringEquals": {"token.actions.githubusercontent.com:aud": "sts.amazonaws.com", "token.actions.githubusercontent.com:sub": "repo:P20000/EnvScale:environment:production"}}}]}),
            ("unintended Service principal", {"Version": "2012-10-17", "Statement": [{"Effect": "Allow", "Principal": {"Service": "ec2.amazonaws.com"}, "Action": "sts:AssumeRole"}]}),
            ("extra trust statement", {"Version": "2012-10-17", "Statement": [valid_trust["Statement"][0], valid_trust["Statement"][0]]}),
            ("unrecognized trust condition", {"Version": "2012-10-17", "Statement": [{"Effect": "Allow", "Principal": {"AWS": ["arn:aws:iam::982534376726:user/DEV-user-alpha"]}, "Action": "sts:AssumeRole", "Condition": {"IpAddress": {"aws:SourceIp": "0.0.0.0/0"}}}]}),
        ]:
            with self.subTest(label=label), self.assertRaises(SystemExit):
                day0_identity_guard.verify_initial_seal_attached_boundary_and_policies(
                    sts_seal_role, seal_id_path, seal_pb_path, iam_caller=make_caller(trust=bad_trust)
                )
        with self.assertRaises(SystemExit):
            day0_identity_guard.validate_live_role_trust_policy(
                {"AssumeRolePolicyDocument": valid_trust}, role_label="Initial-seal",
                expected_trust_doc={"Version": "2012-10-17", "Statement": []},
            )
        # Break-glass live MFA trust checks: reject non-MFA trust or OIDC trust on foundation-admin.
        with self.assertRaises(SystemExit):
            day0_identity_guard.verify_breakglass_admin_caller_and_trust(
                {"Account": "982534376726", "Arn": "arn:aws:sts::982534376726:assumed-role/envscale-foundation-admin-role/op"},
                iam_caller=lambda op, p: {"Role": {"MaxSessionDuration": 3600, "AssumeRolePolicyDocument": valid_trust}},
            )

        # Mutual isolation: ordinary non-root identities, root, admin, and steady-state Day-0 CANNOT run initial sealing.
        for label, bad_sts in [
            ("ordinary non-root IAM user", {"Account": "982534376726", "Arn": "arn:aws:iam::982534376726:user/DEV-user-alpha"}),
            ("ordinary assumed role", {"Account": "982534376726", "Arn": "arn:aws:sts::982534376726:assumed-role/DeveloperAdmin/sess"}),
            ("break-glass admin role", {"Account": "982534376726", "Arn": "arn:aws:sts::982534376726:assumed-role/envscale-foundation-admin-role/op"}),
            ("steady-state Day-0 user", {"Account": "982534376726", "Arn": "arn:aws:iam::982534376726:user/envscale-day0-bootstrap"}),
            ("steady-state Day-0 role", {"Account": "982534376726", "Arn": "arn:aws:sts::982534376726:assumed-role/envscale-day0-bootstrap/sess"}),
            ("AWS root user", {"Account": "982534376726", "Arn": "arn:aws:iam::982534376726:root"}),
            ("foreign account initial seal", {"Account": "111122223333", "Arn": "arn:aws:iam::111122223333:user/envscale-day0-initial-seal"}),
        ]:
            with self.subTest(label=label), self.assertRaises(SystemExit):
                day0_identity_guard.verify_initial_seal_attached_boundary_and_policies(bad_sts, seal_id_path, seal_pb_path, iam_caller=make_caller())
        with self.assertRaises(SystemExit):
            day0_identity_guard.verify_day0_attached_boundary_and_policies(sts_seal, day0_id_path, day0_pb_path, iam_caller=make_caller())

        # Fail closed on missing/wrong/drifted boundary, inline policy, extra attached policy, or drifted seal policy.
        drifted_pb = json.loads(json.dumps(seal_pb_doc))
        drifted_pb["Statement"][0]["Action"].append("s3:GetObject")
        drifted_id = json.loads(json.dumps(seal_id_doc))
        drifted_id["Statement"][0]["Action"].append("s3:PutObject")
        for label, bad_caller in [
            ("missing permissions boundary", make_caller(pb_arn="")),
            ("steady-state boundary attached to seal user", make_caller(pb_arn="arn:aws:iam::982534376726:policy/envscale-day0-bootstrap-permissions-boundary")),
            ("drifted boundary doc allows GetObject", make_caller(live_pb=drifted_pb)),
            ("inline policy present on seal user", make_caller(inline=["inline-s3-admin"])),
            ("extra managed policy attached", make_caller(attached=[expected_id, "arn:aws:iam::aws:policy/AdministratorAccess"])),
            ("steady-state policy attached instead of seal policy", make_caller(attached=["arn:aws:iam::982534376726:policy/envscale-day0-bootstrap-policy"])),
            ("drifted live seal doc allows PutObject", make_caller(live_id=drifted_id)),
        ]:
            with self.subTest(label=label), self.assertRaises(SystemExit):
                day0_identity_guard.verify_initial_seal_attached_boundary_and_policies(sts_seal, seal_id_path, seal_pb_path, iam_caller=bad_caller)
        script_text = (BOOTSTRAP_DIR / "bootstrap-state.sh").read_text(encoding="utf-8")
        init_block = script_text[script_text.index('if [[ "$MODE" == "init-bucket-policy" ]]; then'):script_text.index('if [[ "$MODE" == "reconcile-bucket-policy" ]]; then')]
        for s1, s2 in [("check-initial-seal-sts", "ensure_bucket_exists"), ("check-initial-seal-boundary", "ensure_bucket_exists"), ("ensure_bucket_exists", "put-bucket-policy")]:
            self.assertLess(init_block.index(s1), init_block.index(s2))

    def test_persistent_recovery_and_runtime_destroy_isolation_guarantees(self):
        import iam_policy_simulator as sim
        pols = sim.build_rendered_foundation_policies(REPO_ROOT / "deployment/foundation")
        wb = pols["role_workload_permissions_boundary"]
        rc_rp = pols["recovery_bucket_policy"]
        tf_b, rc_b = "arn:aws:s3:::envscale-tfstate-982534376726-ap-south-1", "arn:aws:s3:::envscale-recovery-982534376726-ap-south-1"
        ctx = {"aws:SecureTransport": True, "aws:PrincipalAccount": "982534376726"}
        for act, res in [("s3:DeleteBucket", tf_b), ("s3:DeleteBucket", rc_b), ("s3:DeleteObject", f"{tf_b}/runtime/terraform.tfstate"), ("s3:DeleteObject", f"{rc_b}/backups/postgres/archive/x/db.dump"), ("iam:DeleteRole", "arn:aws:iam::982534376726:role/envscale-github-foundation-role")]:
            self.assertEqual(sim.eval_iam_policy_local_harness(pols["role_github_deploy"], act, res, ctx, None, wb), "explicitDeny")
        self.assertEqual(sim.eval_iam_policy_local_harness(pols["role_github_recovery"], "s3:PutObject", f"{rc_b}/backups/postgres/latest-valid.json", ctx, rc_rp, wb), "allowed")
        self.assertEqual(sim.eval_iam_policy_local_harness(pols["role_github_recovery"], "s3:PutObject", f"{rc_b}/backups/postgres/archive/x/db.dump", ctx, rc_rp, wb), "explicitDeny")
        self.assertEqual(sim.eval_iam_policy_local_harness(pols["role_github_recovery"], "s3:DeleteObject", f"{rc_b}/backups/postgres/archive/x/db.dump", ctx, rc_rp, wb), "explicitDeny")
        rmap = {"envscale-github-foundation-plan-role": ("trust_github_foundation_plan", "role_github_foundation_plan"), "envscale-github-foundation-role": ("trust_github_foundation", "role_github_foundation"), "envscale-foundation-admin-role": ("trust_foundation_admin", "role_foundation_admin")}
        boot_caller = lambda op, p, b_doc=wb: {"Role": {"AssumeRolePolicyDocument": pols[rmap[p[1]][0]], "MaxSessionDuration": 3600}} if op == "get-role" else ({"PolicyDocument": pols[rmap[p[1]][1]]} if op == "get-role-policy" else ({"Policy": {"DefaultVersionId": "v1"}} if op == "get-policy" else {"PolicyVersion": {"Document": b_doc}}))
        self.assertEqual(plan_iam_safety.verify_bootstrap_iam_and_boundary_live(REPO_ROOT / "deployment/foundation", iam_caller=boot_caller)["foundation_apply_role"], "envscale-github-foundation-role")
        with self.assertRaises(SystemExit):
            plan_iam_safety.verify_bootstrap_iam_and_boundary_live(REPO_ROOT / "deployment/foundation", iam_caller=lambda op, p: boot_caller(op, p, b_doc={"Version": "2012-10-17", "Statement": []}))


if __name__ == "__main__":
    unittest.main()

