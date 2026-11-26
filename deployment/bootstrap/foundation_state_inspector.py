#!/usr/bin/env python3
"""EnvScale Foundation Live State Inspector & Monotonicity Guard.

Reads S3 Terraform state metadata/resources and live AWS IAM/S3/SSM state,
classifies readiness into four deterministic states, and enforces state
monotonicity before any reconciliation mutation.
"""

from __future__ import annotations

import json
import pathlib
import subprocess
import sys
from typing import Any, Callable, Dict, List, Optional

_BOOTSTRAP_DIR = pathlib.Path(__file__).resolve().parent
if str(_BOOTSTRAP_DIR) not in sys.path:
    sys.path.insert(0, str(_BOOTSTRAP_DIR))

import day0_identity_guard as guard  # noqa: E402
import iam_policy_simulator as sim  # noqa: E402
from plan_iam_safety import IMMUTABLE_ACCOUNT_ID  # noqa: E402

STATE_BOOTSTRAP_REQUIRED = "BOOTSTRAP_RECONCILIATION_REQUIRED"
STATE_FOUNDATION_DEPLOY_REQUIRED = "FOUNDATION_DEPLOYMENT_REQUIRED"
STATE_SECRETS_REQUIRED = "SECRETS_INITIALIZATION_REQUIRED"
STATE_HEALTHY = "FOUNDATION_HEALTHY"

DEFAULT_REGION = "ap-south-1"
DEFAULT_TFSTATE_BUCKET = f"envscale-tfstate-{IMMUTABLE_ACCOUNT_ID}-{DEFAULT_REGION}"
DEFAULT_RECOVERY_BUCKET = f"envscale-recovery-{IMMUTABLE_ACCOUNT_ID}-{DEFAULT_REGION}"
DEFAULT_STATE_KEY = "foundation/terraform.tfstate"
DEFAULT_SSM_PREFIX = "/envscale/prod"

REQUIRED_WORKLOAD_ROLES = (
    "envscale-runtime-provisioner-role",
    "envscale-ec2-runtime-role",
    "envscale-github-release-role",
    "envscale-github-deploy-role",
    "envscale-github-recovery-role",
)
REQUIRED_NON_SECRET_SSM_KEYS = (
    "aws_region",
    "better_auth_url",
    "cors_origin",
    "duckdns_domain",
    "github_client_id",
    "google_client_id",
    "postgres_db",
    "postgres_user",
    "recovery_bucket",
)
REQUIRED_SECURESTRING_KEYS = (
    "postgres_password",
    "redis_password",
    "jwt_access_secret",
    "jwt_refresh_secret",
    "better_auth_secret",
    "kubeconfig_encryption_key",
    "duckdns_token",
    "google_client_secret",
    "github_client_secret",
)

PROTECTED_ROLE_SPECS = (
    (
        "aws_iam_role.foundation_admin[0]",
        "aws_iam_role_policy.foundation_admin[0]",
        "envscale-foundation-admin-role",
        "envscale-foundation-admin-policy",
        "trust_foundation_admin",
        "role_foundation_admin",
    ),
    (
        "aws_iam_role.github_foundation",
        "aws_iam_role_policy.github_foundation",
        "envscale-github-foundation-role",
        "envscale-github-foundation-policy",
        "trust_github_foundation",
        "role_github_foundation",
    ),
    (
        "aws_iam_role.github_foundation_plan",
        "aws_iam_role_policy.github_foundation_plan",
        "envscale-github-foundation-plan-role",
        "envscale-github-foundation-plan-policy",
        "trust_github_foundation_plan",
        "role_github_foundation_plan",
    ),
)
PROTECTED_BOUNDARY_SPECS = (
    (
        "aws_iam_policy.workload_permissions_boundary",
        f"arn:aws:iam::{IMMUTABLE_ACCOUNT_ID}:policy/envscale-workload-permissions-boundary",
        "role_workload_permissions_boundary",
    ),
    (
        "aws_iam_policy.runtime_provisioner_permissions_boundary",
        f"arn:aws:iam::{IMMUTABLE_ACCOUNT_ID}:policy/envscale-runtime-provisioner-permissions-boundary",
        "boundary_runtime_provisioner",
    ),
)

AwsCliFn = Callable[[str, str, List[str]], Dict[str, Any]]


def default_aws_cli(service: str, op: str, params: List[str], env: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
    proc = subprocess.run(
        ["aws", service, op, *params, "--output", "json"],
        capture_output=True,
        text=True,
        env=env,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"aws {service} {op} failed: {(proc.stderr or proc.stdout).strip()}")
    return json.loads(proc.stdout) if proc.stdout.strip() else {}


def _probe_aws(
    aws_cli: AwsCliFn, service: str, op: str, params: List[str]
) -> tuple[bool, Optional[Dict[str, Any]], str]:
    try:
        return True, aws_cli(service, op, params), ""
    except (RuntimeError, SystemExit) as exc:
        return False, None, str(exc)


def _extract_state_addresses(state_doc: Dict[str, Any]) -> set[str]:
    addrs: set[str] = set()
    for res in state_doc.get("resources") or []:
        prefix = "data." if res.get("mode") == "data" else ""
        base = f"{prefix}{res.get('type')}.{res.get('name')}"
        instances = res.get("instances") or []
        if not instances:
            addrs.add(base)
            continue
        for inst in instances:
            if "index_key" in inst:
                idx = inst["index_key"]
                key_str = f'"{idx}"' if isinstance(idx, str) else str(idx)
                addrs.add(f"{base}[{key_str}]")
            else:
                addrs.add(base)
    return addrs


def read_live_tfstate_meta(
    *,
    bucket: str = DEFAULT_TFSTATE_BUCKET,
    key: str = DEFAULT_STATE_KEY,
    account_id: str = IMMUTABLE_ACCOUNT_ID,
    aws_cli: Optional[AwsCliFn] = None,
    aws_env: Optional[Dict[str, str]] = None,
    include_state_doc: bool = True,
) -> Dict[str, Any]:
    """Read live S3 terraform.tfstate metadata and optionally parse serial/lineage/resources."""
    call = aws_cli or (lambda svc, op, p: default_aws_cli(svc, op, p, env=aws_env))
    ok, head, err = _probe_aws(
        call, "s3api", "head-object", ["--bucket", bucket, "--key", key, "--expected-bucket-owner", account_id]
    )
    if not ok or head is None:
        return {"exists": False, "version_id": "", "etag": "", "serial": None, "lineage": "", "addresses": set(), "error": err}

    meta: Dict[str, Any] = {
        "exists": True,
        "version_id": str(head.get("VersionId") or ""),
        "etag": str(head.get("ETag") or ""),
        "last_modified": str(head.get("LastModified") or ""),
        "serial": None,
        "lineage": "",
        "addresses": set(),
        "error": "",
    }
    if include_state_doc:
        if aws_cli is not None:
            raw_obj = call("s3api", "get-object-body", ["--bucket", bucket, "--key", key])
            state_doc = raw_obj if isinstance(raw_obj, dict) else {}
        else:
            cp = subprocess.run(
                ["aws", "s3", "cp", f"s3://{bucket}/{key}", "-"],
                capture_output=True, text=True, env=aws_env, check=False,
            )
            if cp.returncode != 0:
                meta["error"] = (cp.stderr or cp.stdout).strip()
                return meta
            state_doc = json.loads(cp.stdout)
        meta["serial"] = state_doc.get("serial")
        meta["lineage"] = str(state_doc.get("lineage") or "")
        meta["addresses"] = _extract_state_addresses(state_doc)
    return meta


def verify_state_monotonicity(
    expected_meta: Dict[str, Any],
    live_meta: Dict[str, Any],
    plan_doc: Optional[Dict[str, Any]] = None,
) -> None:
    """Fail closed if live Terraform state advanced past the plan-time S3 version/serial."""
    if not expected_meta.get("exists"):
        if live_meta.get("exists"):
            raise RuntimeError("State conflict: remote Terraform state appeared after plan generation.")
        return
    if not live_meta.get("exists"):
        raise RuntimeError("State conflict: remote Terraform state disappeared after plan generation.")

    exp_ser, live_ser = expected_meta.get("serial"), live_meta.get("serial")
    if isinstance(exp_ser, int) and isinstance(live_ser, int) and live_ser > exp_ser:
        raise RuntimeError(
            f"State conflict: live Terraform state serial ({live_ser}) is newer than plan-time serial ({exp_ser}); "
            "refusing to overwrite newer Terraform state."
        )
    if expected_meta.get("version_id") and live_meta.get("version_id") and expected_meta["version_id"] != live_meta["version_id"]:
        raise RuntimeError(
            f"State conflict: live S3 VersionId ({live_meta['version_id']}) diverged from plan-time VersionId "
            f"({expected_meta['version_id']})."
        )
    if expected_meta.get("etag") and live_meta.get("etag") and expected_meta["etag"] != live_meta["etag"]:
        raise RuntimeError(
            f"State conflict: live S3 ETag ({live_meta['etag']}) diverged from plan-time ETag ({expected_meta['etag']})."
        )
    if plan_doc is not None and isinstance(live_ser, int):
        prior_ser = (plan_doc.get("prior_state") or {}).get("serial")
        if isinstance(prior_ser, int) and live_ser > prior_ser:
            raise RuntimeError(f"State conflict: plan prior_state serial ({prior_ser}) < live serial ({live_ser}).")


def inspect_foundation_state(
    foundation_dir: pathlib.Path,
    *,
    account_id: str = IMMUTABLE_ACCOUNT_ID,
    region: str = DEFAULT_REGION,
    tfstate_bucket: str = DEFAULT_TFSTATE_BUCKET,
    recovery_bucket: str = DEFAULT_RECOVERY_BUCKET,
    ssm_prefix: str = DEFAULT_SSM_PREFIX,
    aws_cli: Optional[AwsCliFn] = None,
    aws_env: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    """Inspect live AWS resources and Terraform state to classify Foundation readiness."""
    call = aws_cli or (lambda svc, op, p: default_aws_cli(svc, op, p, env=aws_env))
    fdir = pathlib.Path(foundation_dir).resolve()
    rendered = sim.build_rendered_foundation_policies(fdir)

    state_meta = read_live_tfstate_meta(
        bucket=tfstate_bucket, key=DEFAULT_STATE_KEY, account_id=account_id, aws_cli=aws_cli, aws_env=aws_env
    )
    tracked: set[str] = set(state_meta.get("addresses") or set())

    missing_prot: List[str] = []
    untracked_prot: List[str] = []
    drifted_prot: List[str] = []
    unexpected: List[str] = []

    for role_addr, pol_addr, rname, pname, trust_key, pol_key in PROTECTED_ROLE_SPECS:
        ok_r, role_resp, err_r = _probe_aws(call, "iam", "get-role", ["--role-name", rname])
        if not ok_r or role_resp is None:
            if "NoSuchEntity" in err_r:
                missing_prot.extend([role_addr, pol_addr])
            else:
                unexpected.append(f"Failed probing {role_addr}: {err_r}")
            continue
        if role_addr not in tracked:
            untracked_prot.append(role_addr)
        live_trust = guard._decode_policy_doc((role_resp.get("Role") or {}).get("AssumeRolePolicyDocument"))
        if guard._canonical_policy(live_trust) != guard._canonical_policy(rendered[trust_key]):
            drifted_prot.append(role_addr)

        ok_att, att_resp, _ = _probe_aws(call, "iam", "list-attached-role-policies", ["--role-name", rname])
        if ok_att and att_resp and (att_resp.get("AttachedPolicies") or []):
            unexpected.append(f"Protected role '{rname}' has unexpected attached managed policies.")

        ok_p, pol_resp, err_p = _probe_aws(call, "iam", "get-role-policy", ["--role-name", rname, "--policy-name", pname])
        if not ok_p or pol_resp is None:
            if "NoSuchEntity" in err_p:
                missing_prot.append(pol_addr)
            else:
                unexpected.append(f"Failed probing {pol_addr}: {err_p}")
            continue
        if pol_addr not in tracked:
            untracked_prot.append(pol_addr)
        live_inline = guard._decode_policy_doc(pol_resp.get("PolicyDocument"))
        if guard._canonical_policy(live_inline) != guard._canonical_policy(rendered[pol_key]):
            drifted_prot.append(pol_addr)

    for b_addr, b_arn, b_key in PROTECTED_BOUNDARY_SPECS:
        ok_b, b_meta, err_b = _probe_aws(call, "iam", "get-policy", ["--policy-arn", b_arn])
        if not ok_b or b_meta is None:
            if "NoSuchEntity" in err_b:
                missing_prot.append(b_addr)
            else:
                unexpected.append(f"Failed probing {b_addr}: {err_b}")
            continue
        if b_addr not in tracked:
            untracked_prot.append(b_addr)
        ver_id = str((b_meta.get("Policy") or {}).get("DefaultVersionId") or "")
        ok_v, ver_resp, err_v = _probe_aws(call, "iam", "get-policy-version", ["--policy-arn", b_arn, "--version-id", ver_id])
        if not ok_v or ver_resp is None:
            unexpected.append(f"Failed reading policy version for {b_addr}: {err_v}")
            continue
        live_bdoc = guard._decode_policy_doc((ver_resp.get("PolicyVersion") or {}).get("Document"))
        if guard._canonical_policy(live_bdoc) != guard._canonical_policy(rendered[b_key]):
            drifted_prot.append(b_addr)

    missing_foundation: List[str] = []
    for rname in REQUIRED_WORKLOAD_ROLES:
        ok_wr, _, _ = _probe_aws(call, "iam", "get-role", ["--role-name", rname])
        if not ok_wr:
            missing_foundation.append(f"role:{rname}")
    ok_ip, ip_resp, _ = _probe_aws(
        call, "iam", "get-instance-profile", ["--instance-profile-name", "envscale-ec2-runtime-profile"]
    )
    if not ok_ip or ip_resp is None:
        missing_foundation.append("instance-profile:envscale-ec2-runtime-profile")
    else:
        attached_roles = [
            str(r.get("RoleName", ""))
            for r in ((ip_resp.get("InstanceProfile") or {}).get("Roles") or [])
            if isinstance(r, dict)
        ]
        if "envscale-ec2-runtime-role" not in attached_roles:
            missing_foundation.append("instance-profile-role:envscale-ec2-runtime-profile->envscale-ec2-runtime-role")
    if not _probe_aws(call, "s3api", "head-bucket", ["--bucket", recovery_bucket, "--expected-bucket-owner", account_id])[0]:
        missing_foundation.append(f"s3:{recovery_bucket}")

    ok_ssm, ssm_resp, ssm_err = _probe_aws(
        call, "ssm", "describe-parameters",
        ["--region", region, "--parameter-filters", f"Key=Name,Option=BeginsWith,Values={ssm_prefix}/"],
    )
    ssm_names: set[str] = set()
    if ok_ssm and ssm_resp is not None:
        ssm_names = {str(p.get("Name", "")) for p in ssm_resp.get("Parameters") or [] if p.get("Name")}
        for k in REQUIRED_NON_SECRET_SSM_KEYS:
            if f"{ssm_prefix}/{k}" not in ssm_names:
                missing_foundation.append(f"ssm-string:{ssm_prefix}/{k}")

    missing_secrets = (
        [f"{ssm_prefix}/{k}" for k in REQUIRED_SECURESTRING_KEYS if f"{ssm_prefix}/{k}" not in ssm_names]
        if ok_ssm else [f"{ssm_prefix}/{k}" for k in REQUIRED_SECURESTRING_KEYS]
    )

    if missing_prot or untracked_prot or drifted_prot or unexpected:
        classification = STATE_BOOTSTRAP_REQUIRED
        rec_action = "Run controlled bootstrap reconciliation (reconcile-foundation.sh --apply-bootstrap)."
    elif missing_foundation:
        classification = STATE_FOUNDATION_DEPLOY_REQUIRED
        rec_action = "Run GitHub Actions OIDC Foundation deployment (.github/workflows/foundation.yml)."
    elif (not ok_ssm) or missing_secrets:
        classification = STATE_SECRETS_REQUIRED
        rec_action = "Seed missing /envscale/prod/* SSM SecureString parameters via seed-parameters.sh under MFA admin."
    else:
        classification = STATE_HEALTHY
        rec_action = "No action required; Persistent Foundation and SSM secrets are healthy."

    return {
        "classification": classification,
        "recommended_action": rec_action,
        "account_id": account_id,
        "region": region,
        "state_metadata": {
            "bucket": tfstate_bucket,
            "key": DEFAULT_STATE_KEY,
            "exists": state_meta["exists"],
            "version_id": state_meta["version_id"],
            "etag": state_meta["etag"],
            "serial": state_meta["serial"],
            "lineage": state_meta["lineage"],
            "tracked_count": len(tracked),
        },
        "protected_iam": {
            "missing": sorted(set(missing_prot)),
            "untracked_in_state": sorted(set(untracked_prot)),
            "drifted": sorted(set(drifted_prot)),
            "unexpected": unexpected,
        },
        "foundation_resources": {"missing": missing_foundation, "ready": not missing_foundation},
        "ssm_secrets": {
            "accessible": ok_ssm,
            "error": ssm_err if not ok_ssm else "",
            "present_count": len(REQUIRED_SECURESTRING_KEYS) - len(missing_secrets) if ok_ssm else 0,
            "missing_securestrings": missing_secrets,
        },
    }

