"""Fail-closed PostgreSQL pre-destroy backup command generation, native S3 ChecksumSHA256 verification, and deployment identity validation."""

from __future__ import annotations

import base64
import binascii
import json
import os
import pathlib
import shlex
import subprocess
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional

from .cloud_config_utils import redact_sensitive_text
from .config import PROJECT_ROOT

BACKUP_RESULT_PREFIX = "ENVSCALE_BACKUP_RESULT="
DEFAULT_AWS_REGION = "ap-south-1"
DEFAULT_MAX_BACKUP_AGE_SECONDS = 86400
MAX_FUTURE_SKEW_SECONDS = 300
DEFAULT_PIPELINE_STATE_PATH = os.path.join(PROJECT_ROOT, ".envscale_test_center_logs", "cloud_pipeline_state.json")


def _clean_meta_token(val: Optional[str], fallback: str = "") -> str:
    cleaned = "".join(c for c in (val or "").strip() if c.isalnum() or c in ("-", "_", "."))
    return cleaned or fallback


def generate_postgres_backup_key(instance_id: str = "") -> str:
    """Generate a collision-free S3 object key under backups/postgres/ for pre-destroy dumps."""
    stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    uid = uuid.uuid4().hex[:12]
    inst_part = _clean_meta_token(instance_id, "host")
    return f"backups/postgres/backup_{stamp}_{inst_part}_{uid}.dump"


def extract_tfstate_deployment_identity(
    tf_state_path: str,
    pipeline_state_path: Optional[str] = None,
) -> Dict[str, Any]:
    """Extract deployment lineage, VPC ID, instance ID, and active release identity from local state files."""
    info: Dict[str, Any] = {
        "tf_state_exists": False,
        "tf_lineage": "",
        "tf_serial": None,
        "has_aws_instance": False,
        "state_instance_id": "",
        "vpc_id": "",
        "pipeline_instance_id": "",
        "release_id": "",
        "commit_sha": "",
    }
    if tf_state_path and os.path.isfile(tf_state_path):
        try:
            st_doc = json.loads(pathlib.Path(tf_state_path).read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise RuntimeError(f"Destruction blocked: failed reading Terraform state file: {exc}") from exc
        if not isinstance(st_doc, dict) or not isinstance(st_doc.get("resources"), list):
            raise RuntimeError("Destruction blocked: Terraform state is missing a valid 'resources' list.")
        info["tf_state_exists"] = True
        info["tf_lineage"] = str(st_doc.get("lineage") or "").strip()
        info["tf_serial"] = st_doc.get("serial")
        outputs = st_doc.get("outputs") if isinstance(st_doc.get("outputs"), dict) else {}
        out_vpc = (outputs.get("vpc_id") or {}).get("value") if isinstance(outputs.get("vpc_id"), dict) else ""
        if out_vpc:
            info["vpc_id"] = str(out_vpc).strip()
        for res_entry in st_doc["resources"]:
            if not isinstance(res_entry, dict):
                continue
            rtype = res_entry.get("type")
            insts = res_entry.get("instances") if isinstance(res_entry.get("instances"), list) else []
            if rtype == "aws_instance" and insts:
                info["has_aws_instance"] = True
                attrs = insts[0].get("attributes") if isinstance(insts[0], dict) else {}
                if isinstance(attrs, dict) and attrs.get("id"):
                    info["state_instance_id"] = str(attrs["id"]).strip()
            elif rtype == "aws_vpc" and insts and not info["vpc_id"]:
                attrs = insts[0].get("attributes") if isinstance(insts[0], dict) else {}
                if isinstance(attrs, dict) and attrs.get("id"):
                    info["vpc_id"] = str(attrs["id"]).strip()

    p_path = pipeline_state_path if pipeline_state_path is not None else DEFAULT_PIPELINE_STATE_PATH
    if p_path and os.path.isfile(p_path):
        try:
            p_doc = json.loads(pathlib.Path(p_path).read_text(encoding="utf-8"))
            ctx = p_doc.get("context") if isinstance(p_doc, dict) and isinstance(p_doc.get("context"), dict) else {}
            info["pipeline_instance_id"] = str(ctx.get("instance_id") or "").strip()
            info["release_id"] = str(ctx.get("release_id") or "").strip()
            info["commit_sha"] = str(ctx.get("target_sha") or "").strip()
        except (OSError, json.JSONDecodeError):
            pass

    return info


def build_postgres_backup_ssm_commands(
    bucket: str,
    backup_key: str,
    region: str = DEFAULT_AWS_REGION,
    instance_id: str = "",
    tf_lineage: str = "",
    vpc_id: str = "",
    release_id: str = "",
    commit_sha: str = "",
) -> List[str]:
    """Build fail-closed SSM commands to verify postgres state, dump, pg_restore --list, and upload to S3."""
    if not bucket or not backup_key.startswith("backups/postgres/") or not backup_key.endswith(".dump"):
        raise ValueError(f"Invalid PostgreSQL backup S3 target: s3://{bucket}/{backup_key}")
    q_bucket, q_key = shlex.quote(bucket), shlex.quote(backup_key)
    q_s3_uri = shlex.quote(f"s3://{bucket}/{backup_key}")
    q_region = shlex.quote((region or DEFAULT_AWS_REGION).strip() or DEFAULT_AWS_REGION)
    inst_clean = _clean_meta_token(instance_id, "unknown")
    extra_meta = ""
    for k, v in (("tf_lineage", tf_lineage), ("vpc_id", vpc_id), ("release_id", release_id), ("commit_sha", commit_sha)):
        tok = _clean_meta_token(v)
        if tok:
            extra_meta += f",{k}={tok}"
    return [
        "set -euo pipefail",
        "umask 077",
        "docker inspect envscale-postgres >/dev/null 2>&1 || { echo \"[FATAL] PostgreSQL container 'envscale-postgres' is missing on host.\" >&2; exit 1; }",
        "[ \"$(docker inspect -f '{{.State.Running}}' envscale-postgres 2>/dev/null || echo false)\" = \"true\" ] || { echo \"[FATAL] PostgreSQL container 'envscale-postgres' is not running.\" >&2; exit 1; }",
        "PG_USER=\"envscale\"; PG_DB=\"envscale\"",
        "docker exec envscale-postgres pg_isready -U \"$PG_USER\" -d \"$PG_DB\" >/dev/null 2>&1 || { echo \"[FATAL] PostgreSQL database '$PG_DB' is unavailable (pg_isready failed).\" >&2; exit 1; }",
        "[ \"$(docker exec envscale-postgres psql -U \"$PG_USER\" -d \"$PG_DB\" -tAc 'SELECT 1' 2>/dev/null | tr -d '[:space:]')\" = \"1\" ] || { echo \"[FATAL] PostgreSQL database '$PG_DB' failed live connectivity query.\" >&2; exit 1; }",
        "TMP_DUMP=\"$(mktemp /tmp/envscale_pg_destroy_XXXXXX.dump)\"; TMP_TOC=\"${TMP_DUMP}.toc\"",
        "trap 'rm -f \"$TMP_DUMP\" \"$TMP_TOC\"' EXIT INT TERM",
        "docker exec envscale-postgres pg_dump --format=custom -U \"$PG_USER\" \"$PG_DB\" > \"$TMP_DUMP\" || { echo \"[FATAL] pg_dump execution failed.\" >&2; exit 1; }",
        "[ -s \"$TMP_DUMP\" ] || { echo \"[FATAL] PostgreSQL dump file is missing or empty (0 bytes).\" >&2; exit 1; }",
        "DUMP_SIZE=\"$(stat -c '%s' \"$TMP_DUMP\")\"",
        "[ -n \"$DUMP_SIZE\" ] && [ \"$DUMP_SIZE\" -gt 0 ] || { echo \"[FATAL] PostgreSQL dump size is invalid (${DUMP_SIZE:-0} bytes).\" >&2; exit 1; }",
        "docker exec -i envscale-postgres pg_restore --list < \"$TMP_DUMP\" > \"$TMP_TOC\" || { echo \"[FATAL] pg_restore --list failed; dump archive is corrupt or invalid.\" >&2; exit 1; }",
        "TOC_ENTRIES=\"$((grep -Ev '^[[:space:]]*(;|$)' \"$TMP_TOC\" || true) | wc -l | tr -d '[:space:]')\"",
        "[ -n \"$TOC_ENTRIES\" ] && [ \"$TOC_ENTRIES\" -gt 0 ] || { echo \"[FATAL] pg_restore --list found zero archive entries in dump.\" >&2; exit 1; }",
        "DUMP_SHA256=\"$(sha256sum \"$TMP_DUMP\" | awk '{print $1}')\"",
        "printf '%s' \"$DUMP_SHA256\" | grep -Eq '^[0-9a-f]{64}$' || { echo \"[FATAL] Failed computing valid SHA-256 checksum for dump archive.\" >&2; exit 1; }",
        f"aws s3 cp \"$TMP_DUMP\" {q_s3_uri} --region {q_region} --sse AES256 --metadata \"sha256=${{DUMP_SHA256}},byte_size=${{DUMP_SIZE}},instance_id={inst_clean}{extra_meta}\" --checksum-algorithm SHA256",
        f"printf '{BACKUP_RESULT_PREFIX}{{\"bucket\":\"%s\",\"key\":\"%s\",\"size\":%s,\"sha256\":\"%s\",\"toc_entries\":%s}}\\n' {q_bucket} {q_key} \"$DUMP_SIZE\" \"$DUMP_SHA256\" \"$TOC_ENTRIES\"",
    ]


def parse_postgres_backup_ssm_output(stdout: str, *, expected_bucket: str, expected_key: str) -> Dict[str, Any]:
    """Parse and validate the structured ENVSCALE_BACKUP_RESULT payload from SSM stdout."""
    marker = ""
    for line in (stdout or "").splitlines():
        s = line.strip()
        if s.startswith(BACKUP_RESULT_PREFIX):
            marker = s[len(BACKUP_RESULT_PREFIX):].strip()
    if not marker:
        raise RuntimeError("PostgreSQL backup SSM command did not return verified backup metadata (interrupted or incomplete).")
    try:
        data = json.loads(marker)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Malformed PostgreSQL backup metadata from SSM: {exc}") from exc
    if not isinstance(data, dict) or data.get("bucket") != expected_bucket or data.get("key") != expected_key:
        raise RuntimeError(f"PostgreSQL backup target mismatch in SSM metadata for s3://{expected_bucket}/{expected_key}.")
    size, toc = data.get("size"), data.get("toc_entries")
    if not isinstance(size, int) or isinstance(size, bool) or size <= 0:
        raise RuntimeError(f"PostgreSQL dump validation failed: invalid dump size ({size!r}).")
    if not isinstance(toc, int) or isinstance(toc, bool) or toc <= 0:
        raise RuntimeError(f"PostgreSQL pg_restore --list validation failed: toc_entries={toc!r}.")
    sha = str(data.get("sha256") or "").strip().lower()
    if len(sha) != 64 or any(c not in "0123456789abcdef" for c in sha):
        raise RuntimeError(f"PostgreSQL backup reported invalid SHA-256 digest: {sha!r}.")
    return {"bucket": expected_bucket, "key": expected_key, "size": size, "sha256": sha, "toc_entries": toc}


def _decode_and_validate_native_s3_checksum_sha256(chk_b64: str, s3_target: str) -> str:
    """Require, Base64-decode, and validate a 32-byte native S3 ChecksumSHA256 attribute, returning its 64-char hex digest."""
    if not chk_b64:
        raise RuntimeError(
            f"S3 backup {s3_target} is missing mandatory native S3 ChecksumSHA256 "
            "(custom Metadata.sha256 and ETag are not accepted substitutes)."
        )
    if "-" in chk_b64:
        raise RuntimeError(
            f"S3 backup {s3_target} returned composite multipart ChecksumSHA256 ({chk_b64!r}) instead of full-object SHA-256."
        )
    try:
        raw_digest = base64.b64decode(chk_b64, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise RuntimeError(f"S3 backup {s3_target} returned malformed Base64 ChecksumSHA256 ({chk_b64!r}): {exc}") from exc
    if len(raw_digest) != 32 or base64.b64encode(raw_digest).decode("ascii") != chk_b64:
        raise RuntimeError(
            f"S3 backup {s3_target} returned invalid ChecksumSHA256 digest length ({len(raw_digest)} bytes; expected 32)."
        )
    return raw_digest.hex().lower()


def verify_s3_postgres_backup_object(
    *,
    bucket: str,
    backup_key: str,
    region: str = DEFAULT_AWS_REGION,
    expected_size: Optional[int] = None,
    expected_sha256: Optional[str] = None,
    aws_env: Optional[Dict[str, str]] = None,
    run_fn: Callable[..., subprocess.CompletedProcess] = subprocess.run,
) -> Dict[str, Any]:
    """Independently verify uploaded S3 backup object via s3api head-object (size + mandatory native ChecksumSHA256)."""
    s3_target = f"s3://{bucket}/{backup_key}"
    if not bucket or not backup_key.startswith("backups/postgres/") or not backup_key.endswith(".dump"):
        raise ValueError(f"Invalid PostgreSQL backup S3 target: {s3_target}")
    kw: Dict[str, Any] = {"capture_output": True, "text": True}
    if aws_env is not None:
        kw["env"] = aws_env
    res = run_fn(
        ["aws", "s3api", "head-object", "--bucket", bucket, "--key", backup_key, "--region", region, "--checksum-mode", "ENABLED", "--output", "json"],
        **kw,
    )
    if res.returncode != 0:
        err = redact_sensitive_text((res.stderr or res.stdout or f"exit code {res.returncode}").strip())
        raise RuntimeError(f"S3 head-object verification failed for {s3_target}: {err}")
    try:
        doc = json.loads(res.stdout or "{}")
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Invalid JSON from s3api head-object for {s3_target}: {exc}") from exc
    content_length = doc.get("ContentLength") if isinstance(doc, dict) else None
    if not isinstance(content_length, int) or isinstance(content_length, bool) or content_length <= 0:
        raise RuntimeError(f"Uploaded S3 backup {s3_target} has zero or invalid ContentLength ({content_length!r}).")
    if expected_size is not None and content_length != expected_size:
        raise RuntimeError(f"S3 backup ContentLength mismatch for {s3_target}: remote={content_length} != local={expected_size}.")

    chk_b64 = str(doc.get("ChecksumSHA256") or "").strip()
    native_sha256_hex = _decode_and_validate_native_s3_checksum_sha256(chk_b64, s3_target)

    meta = doc.get("Metadata") if isinstance(doc.get("Metadata"), dict) else {}
    meta_sha = str(meta.get("sha256") or meta.get("SHA256") or "").strip().lower()
    if meta_sha and meta_sha != native_sha256_hex:
        raise RuntimeError(
            f"S3 backup Metadata.sha256 ({meta_sha}) disagrees with native ChecksumSHA256 ({native_sha256_hex}) for {s3_target}."
        )

    if expected_sha256 is not None:
        exp_hex = expected_sha256.strip().lower()
        if len(exp_hex) != 64 or any(c not in "0123456789abcdef" for c in exp_hex):
            raise ValueError(f"Invalid expected_sha256 digest: {expected_sha256!r}")
        if native_sha256_hex != exp_hex:
            raise RuntimeError(
                f"S3 backup native ChecksumSHA256 mismatch for {s3_target}: decoded={native_sha256_hex} != local={exp_hex}."
            )

    if "byte_size" in meta:
        try:
            meta_size = int(meta["byte_size"])
        except (TypeError, ValueError) as exc:
            raise RuntimeError(f"Invalid Metadata.byte_size on {s3_target}.") from exc
        if meta_size != content_length:
            raise RuntimeError(f"S3 backup Metadata.byte_size ({meta_size}) != ContentLength ({content_length}) on {s3_target}.")

    return {
        "bucket": bucket,
        "key": backup_key,
        "content_length": content_length,
        "sha256": native_sha256_hex,
        "checksum_sha256": chk_b64,
        "metadata": dict(meta),
    }


def _parse_s3_last_modified(raw_ts: Any, s3_target: str) -> datetime:
    """Parse an S3 LastModified timestamp into a timezone-aware UTC datetime, failing closed on missing or malformed values."""
    if not isinstance(raw_ts, str) or not raw_ts.strip():
        raise RuntimeError(f"Destruction blocked: S3 backup {s3_target} is missing LastModified timestamp.")
    ts_str = raw_ts.strip()
    try:
        dt = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
    except ValueError as exc:
        raise RuntimeError(f"Destruction blocked: invalid LastModified timestamp on {s3_target}: {raw_ts!r}") from exc
    if dt.tzinfo is None:
        raise RuntimeError(f"Destruction blocked: LastModified timestamp on {s3_target} lacks timezone offset: {raw_ts!r}")
    return dt.astimezone(timezone.utc)


def verify_no_host_destroy_safety(
    *,
    tf_state_path: str,
    bucket: str,
    region: str = DEFAULT_AWS_REGION,
    aws_env: Optional[Dict[str, str]] = None,
    run_fn: Callable[..., subprocess.CompletedProcess] = subprocess.run,
    pipeline_state_path: Optional[str] = None,
    expected_instance_id: Optional[str] = None,
    max_backup_age_seconds: int = DEFAULT_MAX_BACKUP_AGE_SECONDS,
    now_utc: Optional[datetime] = None,
) -> Dict[str, Any]:
    """Fail-closed no-host teardown check: select newest S3 dump without pre-filtering and prove deployment ownership."""
    if not os.path.isfile(tf_state_path):
        raise RuntimeError("Destruction blocked: no active EC2 instance ID resolved and Terraform state file is missing.")
    ident = extract_tfstate_deployment_identity(tf_state_path, pipeline_state_path=pipeline_state_path)
    if ident["has_aws_instance"]:
        raise RuntimeError("Destruction blocked: Terraform state still records an aws_instance resource, but instance_id could not be resolved.")

    tf_lineage = ident["tf_lineage"]
    vpc_id = ident["vpc_id"]
    req_instance_id = (expected_instance_id or ident["pipeline_instance_id"] or "").strip()
    if not tf_lineage or not vpc_id or not req_instance_id:
        raise RuntimeError(
            "Destruction blocked: cannot establish deployment and instance identity from state "
            f"(tf_lineage={tf_lineage!r}, vpc_id={vpc_id!r}, instance_id={req_instance_id!r}). "
            "Refusing to accept an unverified historical backup without explicit operator decision."
        )

    kw: Dict[str, Any] = {"capture_output": True, "text": True}
    if aws_env is not None:
        kw["env"] = aws_env
    ls_res = run_fn(["aws", "s3api", "list-objects-v2", "--bucket", bucket, "--prefix", "backups/postgres/", "--region", region, "--output", "json"], **kw)
    if ls_res.returncode != 0:
        err = redact_sensitive_text((ls_res.stderr or ls_res.stdout or f"exit code {ls_res.returncode}").strip())
        raise RuntimeError(f"Destruction blocked: no EC2 instance present and failed listing s3://{bucket}/backups/postgres/: {err}")
    raw_stdout = (ls_res.stdout or "").strip()
    if not raw_stdout:
        raise RuntimeError(f"Destruction blocked: malformed empty response from s3api list-objects-v2 for s3://{bucket}/backups/postgres/.")
    try:
        ls_doc = json.loads(raw_stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Destruction blocked: malformed JSON from s3api list-objects-v2 for s3://{bucket}/backups/postgres/: {exc}") from exc
    if not isinstance(ls_doc, dict):
        raise RuntimeError(
            f"Destruction blocked: unexpected JSON structure from s3api list-objects-v2 for s3://{bucket}/backups/postgres/ "
            f"(expected object, got {type(ls_doc).__name__})."
        )
    if "Contents" not in ls_doc or not isinstance(ls_doc.get("Contents"), list):
        raise RuntimeError(f"Destruction blocked: S3 listing for s3://{bucket}/backups/postgres/ is missing a valid 'Contents' list.")

    contents = ls_doc["Contents"]
    parsed_candidates: List[tuple[datetime, str, Dict[str, Any]]] = []
    for entry in contents:
        if not isinstance(entry, dict):
            raise RuntimeError(f"Destruction blocked: malformed object entry in S3 listing for s3://{bucket}/backups/postgres/.")
        raw_key = entry.get("Key")
        if not isinstance(raw_key, str) or not raw_key.strip():
            raise RuntimeError(f"Destruction blocked: S3 listing for s3://{bucket}/backups/postgres/ contains an entry with missing or invalid Key.")
        key_str = raw_key.strip()
        if not key_str.startswith("backups/postgres/") or not key_str.endswith(".dump"):
            continue
        dt = _parse_s3_last_modified(entry.get("LastModified"), f"s3://{bucket}/{key_str}")
        parsed_candidates.append((dt, key_str, entry))

    if not parsed_candidates:
        raise RuntimeError(f"Destruction blocked: no EC2 instance found and no existing PostgreSQL backup (.dump) exists in s3://{bucket}/backups/postgres/.")

    # Sort by parsed LastModified descending (then Key descending) BEFORE checking Size so a newer 0-byte dump never falls back to an older dump.
    parsed_candidates.sort(key=lambda item: (item[0], item[1]), reverse=True)
    mod_dt, latest_key, latest = parsed_candidates[0]
    s3_latest = f"s3://{bucket}/{latest_key}"

    raw_size = latest.get("Size")
    if not isinstance(raw_size, int) or isinstance(raw_size, bool) or raw_size <= 0:
        raise RuntimeError(
            f"Destruction blocked: newest S3 backup candidate {s3_latest} has zero or invalid Size ({raw_size!r}); "
            "refusing to fall back to older backups."
        )

    effective_now = (
        now_utc.astimezone(timezone.utc)
        if isinstance(now_utc, datetime) and now_utc.tzinfo is not None
        else datetime.now(timezone.utc)
    )
    age_s = (effective_now - mod_dt).total_seconds()
    if age_s < -MAX_FUTURE_SKEW_SECONDS:
        raise RuntimeError(
            f"Destruction blocked: newest S3 backup {s3_latest} has an implausible future LastModified timestamp "
            f"({latest.get('LastModified')!r}, {int(-age_s)}s ahead of current UTC)."
        )
    if age_s > max_backup_age_seconds:
        raise RuntimeError(
            f"Destruction blocked: S3 backup {s3_latest} is stale (age={int(age_s)}s > max={max_backup_age_seconds}s)."
        )

    verified = verify_s3_postgres_backup_object(
        bucket=bucket, backup_key=latest_key, region=region,
        expected_size=raw_size, aws_env=aws_env, run_fn=run_fn,
    )
    meta = verified.get("metadata") or {}
    b_lineage = str(meta.get("tf_lineage") or "").strip()
    b_inst = str(meta.get("instance_id") or "").strip()
    b_vpc = str(meta.get("vpc_id") or "").strip()
    if not b_lineage or not b_inst or b_inst == "unknown" or not b_vpc:
        raise RuntimeError(
            f"Destruction blocked: S3 backup {s3_latest} is missing required deployment ownership metadata "
            f"(tf_lineage={b_lineage!r}, instance_id={b_inst!r}, vpc_id={b_vpc!r})."
        )
    if b_lineage != tf_lineage:
        raise RuntimeError(
            f"Destruction blocked: S3 backup tf_lineage ({b_lineage!r}) does not match deployment tf_lineage ({tf_lineage!r})."
        )
    if b_inst != req_instance_id:
        raise RuntimeError(
            f"Destruction blocked: S3 backup instance_id ({b_inst!r}) does not match deployment instance_id ({req_instance_id!r})."
        )
    if b_vpc != vpc_id:
        raise RuntimeError(
            f"Destruction blocked: S3 backup vpc_id ({b_vpc!r}) does not match deployment vpc_id ({vpc_id!r})."
        )
    for field_name, exp_val in (("release_id", ident["release_id"]), ("commit_sha", ident["commit_sha"])):
        if exp_val:
            actual_val = str(meta.get(field_name) or "").strip()
            if actual_val != exp_val:
                raise RuntimeError(
                    f"Destruction blocked: S3 backup {field_name} ({actual_val!r}) does not match deployment {field_name} ({exp_val!r})."
                )
    return verified
