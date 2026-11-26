"""Regression tests ensuring validate-foundation-plan self-test runs under CI env without weakening CI guards."""

from __future__ import annotations

import importlib.util
import os
import pathlib
import subprocess
import sys
import unittest
from unittest import mock

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
VALIDATOR_PATH = REPO_ROOT / "deployment" / "bootstrap" / "validate-foundation-plan.py"


def _load_validator():
    spec = importlib.util.spec_from_file_location("validate_foundation_plan_ci", VALIDATOR_PATH)
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class TestFoundationPlanCiSelfTest(unittest.TestCase):
    def test_self_test_cli_succeeds_under_github_actions_env(self):
        env = dict(os.environ)
        env["GITHUB_ACTIONS"] = "true"
        env["CI"] = "true"
        res = subprocess.run(
            [sys.executable, str(VALIDATOR_PATH), "--self-test"],
            cwd=str(REPO_ROOT),
            env=env,
            capture_output=True,
            text=True,
        )
        self.assertEqual(res.returncode, 0, msg=res.stderr or res.stdout)
        self.assertIn("[SUCCESS]", res.stdout)

    def test_protected_iam_override_remains_rejected_in_ci(self):
        mod = _load_validator()
        bootstrap_doc = mod.make_valid_plan_doc("bootstrap")
        update_doc = mod.make_valid_plan_doc("update")
        next(
            rc for rc in update_doc["resource_changes"]
            if rc["address"] == "aws_iam_role.github_foundation"
        )["change"]["actions"] = ["update"]

        for ci_vars in (
            {"GITHUB_ACTIONS": "true", "CI": "true"},
            {"GITHUB_ACTIONS": "true", "CI": ""},
            {"GITHUB_ACTIONS": "", "CI": "true"},
        ):
            with mock.patch.dict(os.environ, ci_vars, clear=False):
                boot_errs = mod.validate_plan_doc(bootstrap_doc, mode="bootstrap", allow_protected_iam_updates=True)
                upd_errs = mod.validate_plan_doc(update_doc, mode="update", allow_protected_iam_updates=True)
                self.assertTrue(any("forbidden inside automated CI" in e for e in boot_errs), msg=f"{ci_vars}: {boot_errs}")
                self.assertTrue(any("forbidden inside automated CI" in e for e in upd_errs), msg=f"{ci_vars}: {upd_errs}")

    def test_run_self_tests_restores_ci_env_variables(self):
        mod = _load_validator()
        with mock.patch.dict(os.environ, {"GITHUB_ACTIONS": "true", "CI": "true"}, clear=False):
            mod.run_self_tests()
            self.assertEqual(os.environ.get("GITHUB_ACTIONS"), "true")
            self.assertEqual(os.environ.get("CI"), "true")


if __name__ == "__main__":
    unittest.main()

