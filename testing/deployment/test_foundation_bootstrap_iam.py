#!/usr/bin/env python3
"""Unit tests for one-time MFA-free operator Foundation IAM bootstrap (admin absent & present)."""

from __future__ import annotations

import hashlib
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
FOUNDATION_DIR = REPO_ROOT / "deployment" / "foundation"
if str(BOOTSTRAP_DIR) not in sys.path:
    sys.path.insert(0, str(BOOTSTRAP_DIR))

import day0_bucket_bootstrap  # noqa: E402
import iam_policy_simulator as sim  # noqa: E402
import plan_iam_safety  # noqa: E402


ACCOUNT = "982534376726"
OPERATOR_ARN = f"arn:aws:iam::{ACCOUNT}:user/DEV-user-alpha"
BOOTSTRAP_POL_PATH = BOOTSTRAP_DIR / "foundation-iam-bootstrap-policy.json"
BOOTSTRAP_POL_ARN = f"arn:aws:iam::{ACCOUNT}:policy/envscale-foundation-iam-bootstrap-policy"
WB_ARN = f"arn:aws:iam::{ACCOUNT}:policy/envscale-workload-permissions-boundary"


class TestFoundationBootstrapIam(unittest.TestCase):
    def setUp(self) -> None:
        self.env_patcher = mock.patch.dict(os.environ, {"GITHUB_ACTIONS": "", "CI": ""}, clear=False)
        self.env_patcher.start()
        self.addCleanup(self.env_patcher.stop)
        self.pols = sim.build_rendered_foundation_policies(FOUNDATION_DIR)
        self.bootstrap_doc = json.loads(BOOTSTRAP_POL_PATH.read_text(encoding="utf-8"))
        self.operator_sts = {"Account": ACCOUNT, "Arn": OPERATOR_ARN}
        self.admin_sts = {"Account": ACCOUNT, "Arn": f"arn:aws:sts::{ACCOUNT}:assumed-role/envscale-foundation-admin-role/op-mfa"}

    def _make_iam_caller(
        self,
        *,
        admin_exists: bool = False,
        all_exist: bool = False,
        user_inline: list[str] | None = None,
        user_attached: list[str] | None = None,
        live_bootstrap_doc: dict | None = None,
        admin_trust_override: dict | None = None,
        admin_attached: list[str] | None = None,
    ):
        inline = [] if user_inline is None else user_inline
        attached = [BOOTSTRAP_POL_ARN] if user_attached is None else user_attached
        live_bp = self.bootstrap_doc if live_bootstrap_doc is None else live_bootstrap_doc
        admin_att = [] if admin_attached is None else admin_attached

        roles = {}
        role_pols = {}
        if admin_exists or all_exist:
            roles["envscale-foundation-admin-role"] = {
                "MaxSessionDuration": 3600,
                "AssumeRolePolicyDocument": admin_trust_override or self.pols["trust_foundation_admin"],
            }
            role_pols[("envscale-foundation-admin-role", "envscale-foundation-admin-policy")] = self.pols["role_foundation_admin"]
        if all_exist:
            roles["envscale-github-foundation-plan-role"] = {"MaxSessionDuration": 3600, "AssumeRolePolicyDocument": self.pols["trust_github_foundation_plan"]}
            role_pols[("envscale-github-foundation-plan-role", "envscale-github-foundation-plan-policy")] = self.pols["role_github_foundation_plan"]
            roles["envscale-github-foundation-role"] = {"MaxSessionDuration": 3600, "AssumeRolePolicyDocument": self.pols["trust_github_foundation"]}
            role_pols[("envscale-github-foundation-role", "envscale-github-foundation-policy")] = self.pols["role_github_foundation"]

        policies = {BOOTSTRAP_POL_ARN: live_bp}
        if all_exist:
            policies[WB_ARN] = self.pols["role_workload_permissions_boundary"]

        def caller(op: str, params: list[str]):
            if op == "list-mfa-devices":
                raise AssertionError("Operator bootstrap caller check must not require list-mfa-devices.")
            if op == "list-user-policies":
                return {"PolicyNames": inline}
            if op == "list-attached-user-policies":
                return {"AttachedPolicies": [{"PolicyArn": a} for a in attached]}
            if op == "list-attached-role-policies":
                rname = params[params.index("--role-name") + 1]
                return {"AttachedPolicies": [{"PolicyArn": a} for a in (admin_att if rname == "envscale-foundation-admin-role" else [])]}
            if op == "get-policy":
                arn = params[params.index("--policy-arn") + 1]
                if arn not in policies:
                    raise SystemExit(f"[FATAL] aws iam get-policy failed: NoSuchEntity {arn}")
                return {"Policy": {"DefaultVersionId": "v1"}}
            if op == "get-policy-version":
                arn = params[params.index("--policy-arn") + 1]
                if arn not in policies:
                    raise SystemExit(f"[FATAL] aws iam get-policy-version failed: NoSuchEntity {arn}")
                return {"PolicyVersion": {"Document": policies[arn]}}
            if op == "get-role":
                rname = params[params.index("--role-name") + 1]
                if rname not in roles:
                    raise SystemExit(f"[FATAL] aws iam get-role failed: NoSuchEntity {rname}")
                return {"Role": roles[rname]}
            if op == "get-role-policy":
                rname = params[params.index("--role-name") + 1]
                pname = params[params.index("--policy-name") + 1]
                if (rname, pname) not in role_pols:
                    raise SystemExit(f"[FATAL] aws iam get-role-policy failed: NoSuchEntity {rname}:{pname}")
                return {"PolicyDocument": role_pols[(rname, pname)]}
            raise AssertionError(f"Unexpected IAM operation: {op} {params}")

        return caller, roles, role_pols, policies

    def test_bootstrap_caller_allowed_without_mfa_when_admin_role_absent_and_present(self):
        caller_absent, *_ = self._make_iam_caller(admin_exists=False)
        info_absent = plan_iam_safety.verify_foundation_iam_bootstrap_caller(
            self.operator_sts, BOOTSTRAP_POL_PATH, iam_caller=caller_absent, rendered_policies=self.pols
        )
        self.assertEqual(info_absent["mode"], "operator_direct")
        self.assertFalse(info_absent["admin_role_preexisted"])

        caller_present, *_ = self._make_iam_caller(admin_exists=True)
        info_present = plan_iam_safety.verify_foundation_iam_bootstrap_caller(
            self.operator_sts, BOOTSTRAP_POL_PATH, iam_caller=caller_present, rendered_policies=self.pols
        )
        self.assertEqual(info_present["mode"], "operator_direct")
        self.assertTrue(info_present["admin_role_preexisted"])

        # Option B: Operator carrying narrow policy AND temporary AdministratorAccess during initial bootstrap
        caller_opt_b, *_ = self._make_iam_caller(
            admin_exists=False, user_attached=[BOOTSTRAP_POL_ARN, "arn:aws:iam::aws:policy/AdministratorAccess"]
        )
        info_opt_b = plan_iam_safety.verify_foundation_iam_bootstrap_caller(
            self.operator_sts, BOOTSTRAP_POL_PATH, iam_caller=caller_opt_b, rendered_policies=self.pols
        )
        self.assertEqual(info_opt_b["mode"], "operator_direct")
        self.assertFalse(info_opt_b["admin_role_preexisted"])

        info_role = plan_iam_safety.verify_foundation_iam_bootstrap_caller(
            self.admin_sts, BOOTSTRAP_POL_PATH, iam_caller=caller_present, rendered_policies=self.pols
        )
        self.assertEqual(info_role["mode"], "breakglass_admin_mfa")
        self.assertTrue(info_role["admin_role_preexisted"])

    def test_bootstrap_caller_rejects_admin_access_drift_wrong_user_weak_admin_trust_and_ci(self):
        caller_ok, *_ = self._make_iam_caller(admin_exists=False)
        drifted_bp = json.loads(json.dumps(self.bootstrap_doc))
        drifted_bp["Statement"][3]["Condition"] = {"Bool": {"aws:MultiFactorAuthPresent": "true"}}

        bad_admin_trust = {
            "Version": "2012-10-17",
            "Statement": [{"Effect": "Allow", "Principal": {"AWS": [OPERATOR_ARN]}, "Action": "sts:AssumeRole"}],
        }

        cases = [
            ("AdministratorAccess attached", self.operator_sts, self._make_iam_caller(user_attached=["arn:aws:iam::aws:policy/AdministratorAccess"])[0]),
            ("AdministratorAccess plus bootstrap policy once admin role exists", self.operator_sts, self._make_iam_caller(admin_exists=True, user_attached=[BOOTSTRAP_POL_ARN, "arn:aws:iam::aws:policy/AdministratorAccess"])[0]),
            ("no bootstrap policy attached", self.operator_sts, self._make_iam_caller(user_attached=[])[0]),
            ("extra user inline policy", self.operator_sts, self._make_iam_caller(user_inline=["extra-inline"])[0]),
            ("drifted live bootstrap policy", self.operator_sts, self._make_iam_caller(live_bootstrap_doc=drifted_bp)[0]),
            ("other IAM user", {"Account": ACCOUNT, "Arn": f"arn:aws:iam::{ACCOUNT}:user/other-operator"}, caller_ok),
            ("Day-0 bootstrap user", {"Account": ACCOUNT, "Arn": f"arn:aws:iam::{ACCOUNT}:user/envscale-day0-bootstrap"}, caller_ok),
            ("AWS root", {"Account": ACCOUNT, "Arn": f"arn:aws:iam::{ACCOUNT}:root"}, caller_ok),
            ("wrong AWS account", {"Account": "111122223333", "Arn": "arn:aws:iam::111122223333:user/DEV-user-alpha"}, caller_ok),
            ("preexisting admin lacks MFA trust", self.operator_sts, self._make_iam_caller(admin_exists=True, admin_trust_override=bad_admin_trust)[0]),
            ("admin role has AdministratorAccess", self.admin_sts, self._make_iam_caller(admin_exists=True, admin_attached=["arn:aws:iam::aws:policy/AdministratorAccess"])[0]),
        ]
        for label, sts, caller in cases:
            with self.subTest(label=label), self.assertRaises(SystemExit):
                plan_iam_safety.verify_foundation_iam_bootstrap_caller(
                    sts, BOOTSTRAP_POL_PATH, iam_caller=caller, rendered_policies=self.pols
                )

        # Policy validator rejects MFA conditions or missing s3:prefix constraint.
        with tempfile.TemporaryDirectory() as td:
            bad_f = pathlib.Path(td) / "bad-bp.json"
            bad_f.write_text(json.dumps(drifted_bp), encoding="utf-8")
            with self.assertRaises(SystemExit):
                plan_iam_safety.validate_foundation_iam_bootstrap_policy(bad_f)

        for ci_env in ({"GITHUB_ACTIONS": "true"}, {"CI": "true"}):
            with self.subTest(ci_env=ci_env), mock.patch.dict(os.environ, ci_env, clear=False), self.assertRaises(SystemExit):
                plan_iam_safety.verify_foundation_iam_bootstrap_caller(
                    self.operator_sts, BOOTSTRAP_POL_PATH, iam_caller=caller_ok, rendered_policies=self.pols
                )

    def _run_bootstrap_scenario(self, *, preexists: bool, action_for_resources: list[str], reconcile_existing: bool = False, plan_bin_path: Any = None, expected_plan_sha256: str | None = None):
        import importlib.util
        spec = importlib.util.spec_from_file_location("vfp", BOOTSTRAP_DIR / "validate-foundation-plan.py")
        assert spec and spec.loader
        vfp = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(vfp)

        caller, roles, role_pols, policies = self._make_iam_caller(admin_exists=preexists, all_exist=preexists)
        cmds: list[list[str]] = []

        def fake_runner(cmd, cwd=None, stdout=None, capture_output=False, text=False, check=True):
            cmds.append(list(cmd))
            if cmd[:2] == ["terraform", "state"] and cmd[2] == "list":
                return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")
            if cmd[:2] == ["terraform", "show"] and stdout is not None:
                pdoc = vfp.make_valid_plan_doc("bootstrap")
                for rc in pdoc["resource_changes"]:
                    if rc["mode"] == "managed":
                        rc["change"]["actions"] = list(action_for_resources)
                stdout.write(json.dumps(pdoc))
                return subprocess.CompletedProcess(cmd, 0)
            if cmd[0] == sys.executable:
                return subprocess.run(cmd, cwd=cwd, check=check, capture_output=True, text=True)
            if cmd[:2] == ["terraform", "apply"]:
                # Populate simulated live AWS resources upon apply so post-verify succeeds.
                roles["envscale-foundation-admin-role"] = {"MaxSessionDuration": 3600, "AssumeRolePolicyDocument": self.pols["trust_foundation_admin"]}
                role_pols[("envscale-foundation-admin-role", "envscale-foundation-admin-policy")] = self.pols["role_foundation_admin"]
                roles["envscale-github-foundation-plan-role"] = {"MaxSessionDuration": 3600, "AssumeRolePolicyDocument": self.pols["trust_github_foundation_plan"]}
                role_pols[("envscale-github-foundation-plan-role", "envscale-github-foundation-plan-policy")] = self.pols["role_github_foundation_plan"]
                roles["envscale-github-foundation-role"] = {"MaxSessionDuration": 3600, "AssumeRolePolicyDocument": self.pols["trust_github_foundation"]}
                role_pols[("envscale-github-foundation-role", "envscale-github-foundation-policy")] = self.pols["role_github_foundation"]
                policies[WB_ARN] = self.pols["role_workload_permissions_boundary"]
            return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")

        with tempfile.TemporaryDirectory() as td:
            td_p = pathlib.Path(td)
            sts_f, hcl_f = td_p / "sts.json", td_p / "backend.hcl"
            sts_f.write_text(json.dumps(self.operator_sts), encoding="utf-8")
            hcl_f.write_text('bucket = "envscale-tfstate-982534376726-ap-south-1"\nkey = "foundation/terraform.tfstate"\n', encoding="utf-8")
            tf_dir = td_p / "deployment" / "foundation"
            tf_dir.mkdir(parents=True)
            (td_p / "deployment" / "bootstrap").symlink_to(BOOTSTRAP_DIR)
            for f in FOUNDATION_DIR.glob("*.tf"):
                (tf_dir / f.name).symlink_to(f)
            res = plan_iam_safety.run_bootstrap_foundation_iam(
                tf_dir, sts_f, hcl_f, iam_caller=caller, runner=fake_runner, reconcile_existing=reconcile_existing, plan_bin_path=plan_bin_path, expected_plan_sha256=expected_plan_sha256
            )
            return res, cmds

    def test_greenfield_and_repeat_bootstrap_orchestration(self):
        # Case 1: Greenfield (admin role absent) -> 0 imports, executes apply, verifies live resources.
        res_new, cmds_new = self._run_bootstrap_scenario(preexists=False, action_for_resources=["create"])
        self.assertFalse(res_new["admin_role_preexisted"])
        self.assertTrue(res_new["apply_executed"])
        self.assertEqual([c for c in cmds_new if c[:2] == ["terraform", "import"]], [])
        self.assertEqual(len([c for c in cmds_new if c[:2] == ["terraform", "apply"]]), 1)

        # Case 2: Repeat run (admin & OIDC resources already present, missing from state) -> imports 7, no-op skips apply!
        res_rep, cmds_rep = self._run_bootstrap_scenario(preexists=True, action_for_resources=["no-op"])
        self.assertTrue(res_rep["admin_role_preexisted"])
        self.assertFalse(res_rep["apply_executed"])
        self.assertEqual(len([c for c in cmds_rep if c[:2] == ["terraform", "import"]]), 7)
        self.assertEqual([c for c in cmds_rep if c[:2] == ["terraform", "apply"]], [])

        # Case 3: Pre-existing resources planning an unexpected update -> refuse blind overwrite unless --reconcile-existing.
        with self.assertRaises(SystemExit):
            self._run_bootstrap_scenario(preexists=True, action_for_resources=["update"], reconcile_existing=False)

        # Case 4: bootstrap-state.sh verifies CI & caller BEFORE bucket readback / backend.hcl write.
        bs_text = (BOOTSTRAP_DIR / "bootstrap-state.sh").read_text(encoding="utf-8")
        boot_block = bs_text[bs_text.index('if [[ "$MODE" == "bootstrap-foundation-iam" ]]; then'):]
        self.assertLess(boot_block.index("GITHUB_ACTIONS"), boot_block.index("check-bucket"))
        self.assertLess(boot_block.index("check-bucket"), boot_block.index("verify-bootstrap-caller"))
        self.assertLess(boot_block.index("verify-bootstrap-caller"), boot_block.index("write_backend_hcl_atomic"))

        # Case 5: Reviewed binary plan passed with SHA-256 enforcement.
        with tempfile.NamedTemporaryFile(suffix=".bin") as pbf:
            pb_path = pathlib.Path(pbf.name)
            expected_sha = hashlib.sha256(pb_path.read_bytes()).hexdigest()
            res_bin, cmds_bin = self._run_bootstrap_scenario(
                preexists=False, action_for_resources=["create"], plan_bin_path=pb_path, expected_plan_sha256=expected_sha
            )
            self.assertTrue(res_bin["apply_executed"])
            self.assertEqual([c for c in cmds_bin if c[:2] == ["terraform", "plan"]], [])
            self.assertEqual(len([c for c in cmds_bin if c[:2] == ["terraform", "apply"]]), 1)
            self.assertTrue(pb_path.exists())
            # Subcase: Mismatched SHA-256 aborts immediately.
            with self.assertRaises(SystemExit):
                self._run_bootstrap_scenario(
                    preexists=False, action_for_resources=["create"], plan_bin_path=pb_path, expected_plan_sha256="deadbeef" * 8
                )

    def test_day0_bucket_validation_and_prefix_readiness(self):
        with tempfile.TemporaryDirectory() as td:
            td_p = pathlib.Path(td)
            pol_f = td_p / "pol.json"
            lic_f = td_p / "lic.json"
            enc_f = td_p / "enc.json"
            arts = day0_bucket_bootstrap.generate_bucket_artifacts(
                ACCOUNT, f"envscale-tfstate-{ACCOUNT}-ap-south-1", pol_f, lic_f, enc_f
            )

            valid_s3 = {
                "get-bucket-location": {"LocationConstraint": "ap-south-1"},
                "get-public-access-block": {"PublicAccessBlockConfiguration": {"BlockPublicAcls": True, "IgnorePublicAcls": True, "BlockPublicPolicy": True, "RestrictPublicBuckets": True}},
                "get-bucket-versioning": {"Status": "Enabled"},
                "get-bucket-encryption": {"ServerSideEncryptionConfiguration": {"Rules": [{"ApplyServerSideEncryptionByDefault": {"SSEAlgorithm": "AES256"}}]}},
                "get-bucket-policy": {"Policy": json.dumps(arts["policy"])},
                "list-objects-v2": {"KeyCount": 0, "Contents": []},
            }

            def s3_caller(op, params):
                if op in valid_s3:
                    return valid_s3[op]
                raise AssertionError(f"Unexpected S3 op: {op}")

            res = day0_bucket_bootstrap.validate_state_bucket_configuration(expected_policy_path=pol_f, s3_caller=s3_caller)
            self.assertTrue(res["policy_matches"])
            self.assertEqual(res["region"], "ap-south-1")

            pref = day0_bucket_bootstrap.verify_state_prefix_readiness(s3_caller=s3_caller)
            self.assertTrue(pref["accessible"])

            # Negative cases: wrong region, missing PAB, unencrypted, drifted policy
            neg_cases = [
                ("wrong region", {"get-bucket-location": {"LocationConstraint": "us-east-1"}}),
                ("disabled versioning", {"get-bucket-versioning": {"Status": "Suspended"}}),
                ("missing PAB key", {"get-public-access-block": {"PublicAccessBlockConfiguration": {"BlockPublicAcls": True}}}),
                ("invalid KMS bucket key", {"get-bucket-encryption": {"ServerSideEncryptionConfiguration": {"Rules": [{"ApplyServerSideEncryptionByDefault": {"SSEAlgorithm": "AES256"}, "BucketKeyEnabled": True}]}}}),
                ("drifted policy", {"get-bucket-policy": {"Policy": json.dumps({"Version": "2012-10-17", "Statement": []})}}),
            ]
            for label, override in neg_cases:
                bad_s3 = dict(valid_s3)
                bad_s3.update(override)
                with self.subTest(label=label), self.assertRaises(SystemExit):
                    day0_bucket_bootstrap.validate_state_bucket_configuration(
                        expected_policy_path=pol_f, s3_caller=lambda op, params: bad_s3[op]
                    )

            # Missing policy when expected_policy_path is provided must raise SystemExit
            def s3_missing_policy(op, params):
                if op == "get-bucket-policy":
                    raise SystemExit("NoSuchBucketPolicy")
                return valid_s3[op]

            with self.assertRaises(SystemExit):
                day0_bucket_bootstrap.validate_state_bucket_configuration(
                    expected_policy_path=pol_f, s3_caller=s3_missing_policy
                )

            # When expected_policy_path is None, missing policy reports policy_status='missing'
            unsealed = day0_bucket_bootstrap.validate_state_bucket_configuration(
                expected_policy_path=None, s3_caller=s3_missing_policy
            )
            self.assertEqual(unsealed["policy_status"], "missing")
            self.assertFalse(unsealed["policy_matches"])

    def test_independent_admin_recovery_and_operator_transition_safeguards(self):
        recovery_user = f"arn:aws:iam::{ACCOUNT}:user/IndependentRecoveryAdmin"
        recovery_role = f"arn:aws:iam::{ACCOUNT}:role/envscale-foundation-admin-role"

        def make_iam_caller(*, user_attached=None, role_trust=None, op_attached=None):
            def caller(op, params):
                if op == "get-user":
                    uname = params[params.index("--user-name") + 1]
                    if uname == "IndependentRecoveryAdmin":
                        return {"User": {"UserName": uname, "Arn": recovery_user}}
                    if uname == "DEV-user-alpha":
                        return {"User": {"UserName": uname, "Arn": OPERATOR_ARN}}
                    raise SystemExit(f"NoSuchEntity {uname}")
                if op == "list-attached-user-policies":
                    uname = params[params.index("--user-name") + 1]
                    if uname == "IndependentRecoveryAdmin":
                        return {"AttachedPolicies": [{"PolicyArn": a} for a in (user_attached or ["arn:aws:iam::aws:policy/AdministratorAccess"])]}
                    if uname == "DEV-user-alpha":
                        return {"AttachedPolicies": [{"PolicyArn": a} for a in (op_attached or [BOOTSTRAP_POL_ARN, "arn:aws:iam::aws:policy/AdministratorAccess"])]}
                if op == "get-role":
                    rname = params[params.index("--role-name") + 1]
                    if rname == "envscale-foundation-admin-role":
                        return {"Role": {"RoleName": rname, "AssumeRolePolicyDocument": role_trust or self.pols["trust_foundation_admin"]}}
                    raise SystemExit(f"NoSuchEntity {rname}")
                if op == "get-policy":
                    return {"Policy": {"DefaultVersionId": "v1"}}
                if op == "get-policy-version":
                    return {"PolicyVersion": {"Document": self.bootstrap_doc}}
                if op == "detach-user-policy":
                    uname = params[params.index("--user-name") + 1]
                    parn = params[params.index("--policy-arn") + 1]
                    if uname == "DEV-user-alpha" and parn == "arn:aws:iam::aws:policy/AdministratorAccess":
                        if op_attached is not None and parn in op_attached:
                            op_attached.remove(parn)
                        return {}
                raise AssertionError(f"Unexpected IAM call: {op} {params}")
            return caller

        # 1. Independent recovery role & user succeed
        rec_role = day0_bucket_bootstrap.verify_independent_admin_recovery(
            account_id=ACCOUNT, operator_principal=OPERATOR_ARN, recovery_principal=recovery_role, iam_caller=make_iam_caller()
        )
        self.assertEqual(rec_role["mode"], "independent_admin_role")

        rec_user = day0_bucket_bootstrap.verify_independent_admin_recovery(
            account_id=ACCOUNT, operator_principal=OPERATOR_ARN, recovery_principal=recovery_user, iam_caller=make_iam_caller()
        )
        self.assertEqual(rec_user["mode"], "independent_admin_user")

        # 2. Operator cannot be its own recovery admin
        with self.assertRaises(SystemExit):
            day0_bucket_bootstrap.verify_independent_admin_recovery(
                account_id=ACCOUNT, operator_principal=OPERATOR_ARN, recovery_principal=OPERATOR_ARN, iam_caller=make_iam_caller()
            )

        # 3. Recovery user lacking AdministratorAccess rejected
        with self.assertRaises(SystemExit):
            day0_bucket_bootstrap.verify_independent_admin_recovery(
                account_id=ACCOUNT, operator_principal=OPERATOR_ARN, recovery_principal=recovery_user,
                iam_caller=make_iam_caller(user_attached=["arn:aws:iam::aws:policy/ReadOnlyAccess"]),
            )

        # 4. Recovery role lacking AssumeRole trust rejected
        with self.assertRaises(SystemExit):
            day0_bucket_bootstrap.verify_independent_admin_recovery(
                account_id=ACCOUNT, operator_principal=OPERATOR_ARN, recovery_principal=recovery_role,
                iam_caller=make_iam_caller(role_trust={"Version": "2012-10-17", "Statement": []}),
            )

        # 5. Transition succeeds and safely detaches AdministratorAccess
        active_attached = [BOOTSTRAP_POL_ARN, "arn:aws:iam::aws:policy/AdministratorAccess"]
        call_trans = make_iam_caller(op_attached=active_attached)
        res_trans = day0_bucket_bootstrap.execute_operator_iam_transition(
            operator_principal=OPERATOR_ARN,
            account_id=ACCOUNT,
            confirm_token=f"TRANSITION-DEV-USER-ALPHA-{ACCOUNT}",
            bootstrap_policy_path=BOOTSTRAP_POL_PATH,
            recovery_principal=recovery_role,
            iam_caller=call_trans,
        )
        self.assertEqual(res_trans["status"], "transitioned")
        self.assertEqual(res_trans["remaining_attached_policies"], [BOOTSTRAP_POL_ARN])

        # 6. Transition rejected without exact confirmation token
        with self.assertRaises(SystemExit):
            day0_bucket_bootstrap.execute_operator_iam_transition(
                operator_principal=OPERATOR_ARN,
                account_id=ACCOUNT,
                confirm_token="WRONG-TOKEN",
                bootstrap_policy_path=BOOTSTRAP_POL_PATH,
                recovery_principal=recovery_role,
                iam_caller=make_iam_caller(),
            )

    def test_seal_state_bucket_policy_script_contract(self):
        script_p = BOOTSTRAP_DIR / "seal-state-bucket-policy.sh"
        self.assertTrue(script_p.is_file())
        text = script_p.read_text(encoding="utf-8")
        self.assertIn("trap 'cleanup 0' EXIT", text)
        self.assertIn("trap 'cleanup 130' INT", text)
        self.assertIn("trap 'cleanup 143' TERM", text)
        self.assertIn("ORIGINAL_DEF_VER", text)
        self.assertIn("set-default-policy-version", text)
        self.assertIn("delete-policy-version", text)
        self.assertIn("CRITICAL ALARM", text)
        self.assertIn("length(Versions)", text)

        # Rejection on missing or wrong token
        proc_bad = subprocess.run(["bash", str(script_p), "WRONG-TOKEN"], capture_output=True, text=True)
        self.assertNotEqual(proc_bad.returncode, 0)
        self.assertIn("Usage:", proc_bad.stderr)


if __name__ == "__main__":
    unittest.main()

