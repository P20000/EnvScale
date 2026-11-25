#!/usr/bin/env python3
"""Unit tests covering exact immutable GitHub OIDC subjects across all five OIDC IAM roles."""

from __future__ import annotations

import json
import pathlib
import sys
import unittest

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
BOOTSTRAP_DIR = REPO_ROOT / "deployment" / "bootstrap"
FOUNDATION_DIR = REPO_ROOT / "deployment" / "foundation"
if str(BOOTSTRAP_DIR) not in sys.path:
    sys.path.insert(0, str(BOOTSTRAP_DIR))

import iam_policy_simulator as sim  # noqa: E402
import oidc_trust_guard  # noqa: E402
import plan_iam_safety  # noqa: E402

ACCOUNT = "982534376726"
PREFIX = "P20000@61460949/EnvScale@1323134407"
OIDC_ARN = f"arn:aws:iam::{ACCOUNT}:oidc-provider/token.actions.githubusercontent.com"
BOUNDARY_ARN = f"arn:aws:iam::{ACCOUNT}:policy/envscale-workload-permissions-boundary"

ROLE_CASES = (
    ("aws_iam_role.github_foundation_plan", "envscale-github-foundation-plan-role", "trust_github_foundation_plan", "environment:foundation-plan", ("environment:foundation", "environment:production")),
    ("aws_iam_role.github_foundation", "envscale-github-foundation-role", "trust_github_foundation", "environment:foundation", ("environment:foundation-plan", "environment:production")),
    ("aws_iam_role.github_release", "envscale-github-release-role", "trust_github_release", "ref:refs/heads/develop", ("environment:release", "ref:refs/heads/main")),
    ("aws_iam_role.github_deploy", "envscale-github-deploy-role", "trust_github_deploy", "environment:production", ("environment:recovery", "environment:foundation")),
    ("aws_iam_role.github_recovery", "envscale-github-recovery-role", "trust_github_recovery", "environment:recovery", ("environment:production", "environment:foundation")),
)


class TestOidcImmutableSubjects(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.pols = sim.build_rendered_foundation_policies(FOUNDATION_DIR)

    def test_all_five_rendered_trust_policies_use_exact_immutable_subjects(self):
        for _, role_name, pol_key, good_tail, _ in ROLE_CASES:
            with self.subTest(role=role_name):
                doc = self.pols[pol_key]
                expected_sub = f"repo:{PREFIX}:{good_tail}"
                self.assertEqual(len(doc["Statement"]), 1)
                stmt = doc["Statement"][0]
                self.assertEqual(stmt["Effect"], "Allow")
                self.assertEqual(stmt["Action"], "sts:AssumeRoleWithWebIdentity")
                self.assertEqual(stmt["Principal"], {"Federated": OIDC_ARN})
                self.assertEqual(set(stmt["Condition"].keys()), {"StringEquals"})
                se = stmt["Condition"]["StringEquals"]
                self.assertEqual(set(se.keys()), {"token.actions.githubusercontent.com:aud", "token.actions.githubusercontent.com:sub"})
                self.assertEqual(se["token.actions.githubusercontent.com:aud"], "sts.amazonaws.com")
                self.assertEqual(se["token.actions.githubusercontent.com:sub"], expected_sub)
                self.assertNotIn("*", expected_sub)
                self.assertNotIn("?", expected_sub)

    def test_workflows_match_exact_oidc_role_bindings(self):
        f_wf = (REPO_ROOT / ".github/workflows/foundation.yml").read_text(encoding="utf-8")
        c_wf = (REPO_ROOT / ".github/workflows/cd.yml").read_text(encoding="utf-8")
        self.assertIn("environment: foundation-plan", f_wf)
        self.assertIn("environment: foundation\n", f_wf)
        self.assertIn("branches:\n      - develop", c_wf)
        release_block = c_wf[c_wf.index("  generate-manifest:"):c_wf.index("  check-deploy-target:")]
        self.assertIn("AWS_RELEASE_ROLE_ARN", release_block)
        self.assertNotIn("\n    environment:", release_block)
        deploy_block = c_wf[c_wf.index("  deploy:"):c_wf.index("  deploy-fallback-summary:")]
        self.assertIn("\n    environment: production\n", deploy_block)
        self.assertIn("AWS_DEPLOY_ROLE_ARN", deploy_block)

    def test_all_five_trust_policies_local_harness_positive_and_negative_matrix(self):
        for _, role_name, pol_key, good_tail, wrong_tails in ROLE_CASES:
            doc = self.pols[pol_key]
            target = f"arn:aws:iam::{ACCOUNT}:role/{role_name}"
            good_sub = f"repo:{PREFIX}:{good_tail}"
            with self.subTest(role=role_name):
                self.assertEqual(
                    sim.eval_iam_policy_local_harness(doc, "sts:AssumeRoleWithWebIdentity", target, {"token.actions.githubusercontent.com:aud": "sts.amazonaws.com", "token.actions.githubusercontent.com:sub": good_sub}),
                    "allowed",
                )
                neg_contexts = [
                    ("old mutable subject", {"token.actions.githubusercontent.com:aud": "sts.amazonaws.com", "token.actions.githubusercontent.com:sub": f"repo:P20000/EnvScale:{good_tail}"}),
                    ("wrong audience", {"token.actions.githubusercontent.com:aud": "wrong-aud", "token.actions.githubusercontent.com:sub": good_sub}),
                    ("missing audience", {"token.actions.githubusercontent.com:sub": good_sub}),
                    *[(f"wrong scope {wt}", {"token.actions.githubusercontent.com:aud": "sts.amazonaws.com", "token.actions.githubusercontent.com:sub": f"repo:{PREFIX}:{wt}"}) for wt in wrong_tails],
                ]
                for label, ctx in neg_contexts:
                    self.assertEqual(
                        sim.eval_iam_policy_local_harness(doc, "sts:AssumeRoleWithWebIdentity", target, ctx),
                        "implicitDeny",
                        f"{role_name} should deny {label}",
                    )

    def test_plan_safety_guard_validates_all_five_oidc_roles(self):
        for addr, _, pol_key, good_tail, wrong_tails in ROLE_CASES:
            after_base = {"permissions_boundary": BOUNDARY_ARN} if addr in plan_iam_safety.BOUNDARY_ENFORCED_ROLE_ADDRESSES else {}
            valid_rc = {"address": addr, "type": "aws_iam_role", "change": {"actions": ["update"], "after": {**after_base, "assume_role_policy": json.dumps(self.pols[pol_key])}}}
            self.assertEqual(plan_iam_safety.check_iam_resource_change_safety(valid_rc), [])

            mutable = json.loads(json.dumps(self.pols[pol_key]))
            mutable["Statement"][0]["Condition"]["StringEquals"]["token.actions.githubusercontent.com:sub"] = f"repo:P20000/EnvScale:{good_tail}"
            wrong_scope = json.loads(json.dumps(self.pols[pol_key]))
            wrong_scope["Statement"][0]["Condition"]["StringEquals"]["token.actions.githubusercontent.com:sub"] = f"repo:{PREFIX}:{wrong_tails[0]}"
            bad_aud = json.loads(json.dumps(self.pols[pol_key]))
            bad_aud["Statement"][0]["Condition"]["StringEquals"]["token.actions.githubusercontent.com:aud"] = "wrong-aud"
            wildcard = json.loads(json.dumps(self.pols[pol_key]))
            wildcard["Statement"][0]["Condition"]["StringEquals"]["token.actions.githubusercontent.com:sub"] = f"repo:{PREFIX}:*"
            string_like = json.loads(json.dumps(self.pols[pol_key]))
            string_like["Statement"][0]["Condition"] = {"StringLike": string_like["Statement"][0]["Condition"]["StringEquals"]}

            for bad_name, bad_doc in (("mutable", mutable), ("wrong_scope", wrong_scope), ("bad_aud", bad_aud), ("wildcard", wildcard), ("string_like", string_like)):
                bad_rc = {"address": addr, "type": "aws_iam_role", "change": {"actions": ["update"], "after": {**after_base, "assume_role_policy": json.dumps(bad_doc)}}}
                self.assertTrue(plan_iam_safety.check_iam_resource_change_safety(bad_rc), f"Expected rejection for {addr} ({bad_name})")

    def test_live_role_verifiers_enforce_immutable_subjects_for_all_five_roles(self):
        role_map = {
            "envscale-foundation-admin-role": ("trust_foundation_admin", "role_foundation_admin", None),
            "envscale-github-foundation-plan-role": ("trust_github_foundation_plan", "role_github_foundation_plan", None),
            "envscale-github-foundation-role": ("trust_github_foundation", "role_github_foundation", None),
            "envscale-github-release-role": ("trust_github_release", "role_github_release", BOUNDARY_ARN),
            "envscale-github-deploy-role": ("trust_github_deploy", "role_github_deploy", BOUNDARY_ARN),
            "envscale-github-recovery-role": ("trust_github_recovery", "role_github_recovery", BOUNDARY_ARN),
        }

        def make_caller(trust_overrides: dict | None = None, boundary_overrides: dict | None = None):
            trust_overrides = trust_overrides or {}
            boundary_overrides = boundary_overrides or {}

            def caller(op: str, params: list[str]):
                if op == "get-role":
                    rname = params[params.index("--role-name") + 1]
                    tkey, _, pb = role_map[rname]
                    pb_arn = boundary_overrides.get(rname, pb)
                    role_obj = {"RoleName": rname, "MaxSessionDuration": 3600, "AssumeRolePolicyDocument": trust_overrides.get(rname, self.pols[tkey])}
                    if pb_arn:
                        role_obj["PermissionsBoundary"] = {"PermissionsBoundaryArn": pb_arn, "PermissionsBoundaryUsageType": "PermissionsBoundaryPolicy"}
                    return {"Role": role_obj}
                if op == "get-role-policy":
                    rname = params[params.index("--role-name") + 1]
                    return {"PolicyDocument": self.pols[role_map[rname][1]]}
                if op == "get-policy":
                    return {"Policy": {"DefaultVersionId": "v1"}}
                if op == "get-policy-version":
                    parn = params[params.index("--policy-arn") + 1]
                    pkey = "boundary_runtime_provisioner" if parn.endswith("runtime-provisioner-permissions-boundary") else "role_workload_permissions_boundary"
                    return {"PolicyVersion": {"Document": self.pols[pkey]}}
                raise AssertionError(f"Unexpected IAM op: {op} {params}")

            return caller

        self.assertEqual(plan_iam_safety.verify_bootstrap_iam_and_boundary_live(FOUNDATION_DIR, iam_caller=make_caller())["foundation_apply_role"], "envscale-github-foundation-role")
        self.assertEqual(oidc_trust_guard.verify_workload_oidc_roles_live(FOUNDATION_DIR, iam_caller=make_caller()), {
            "role_github_release": "envscale-github-release-role",
            "role_github_deploy": "envscale-github-deploy-role",
            "role_github_recovery": "envscale-github-recovery-role",
        })

        for _, role_name, pol_key, good_tail, _ in ROLE_CASES:
            mutable_doc = json.loads(json.dumps(self.pols[pol_key]))
            mutable_doc["Statement"][0]["Condition"]["StringEquals"]["token.actions.githubusercontent.com:sub"] = f"repo:P20000/EnvScale:{good_tail}"
            fn = plan_iam_safety.verify_bootstrap_iam_and_boundary_live if "foundation" in role_name else oidc_trust_guard.verify_workload_oidc_roles_live
            with self.subTest(drifted_role=role_name), self.assertRaises(SystemExit):
                fn(FOUNDATION_DIR, iam_caller=make_caller(trust_overrides={role_name: mutable_doc}))

        with self.assertRaises(SystemExit):
            oidc_trust_guard.verify_workload_oidc_roles_live(FOUNDATION_DIR, iam_caller=make_caller(boundary_overrides={"envscale-github-deploy-role": ""}))


if __name__ == "__main__":
    unittest.main()

