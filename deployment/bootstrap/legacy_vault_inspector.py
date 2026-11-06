#!/usr/bin/env python3
"""
EnvScale — Historical Vault Verification & Restore-Baseline Inspector.

Enforces Phase 1 artifact approval pins (AWS account, bucket ownership, S3 VersionId,
ETag, byte size, SHA-256), plain-SQL structural validation, deterministic schema/data
fingerprinting, and isolated PostgreSQL restore equivalence checks for S3 round-trips.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
import pathlib
import re
import sys
import urllib.parse
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

FOUNDATION_ADMIN_ROLE_NAME = "envscale-foundation-admin-role"

PINNED_CONTRACT = {
    "schema_version": "1.0",
    "approved_phase": "phase-1",
    "aws_account_id": "982534376726",
    "aws_region": "ap-south-1",
    "source_bucket": "envscale-cloud-vault-982534376726-ap-south-1",
    "source_key": "database/backup_20261023_005151.sql",
    "source_version_id": "hBlNyXzLVfUE5UuHGZ.XkUIUp.RnNxCg",
    "source_etag": '"1e2fafedf46e12bb3ceaacf0c6df9d33"',
    "expected_byte_size": 28383,
    "expected_sha256": "34911494ae4a634505e17956b4ec58c000a65d583f02c04715be34ad03f6a2a7",
    "recovery_bucket": "envscale-recovery-982534376726-ap-south-1",
}

CANONICAL_TABLES = [
    "users", "refresh_tokens", "sessions", "accounts", "verifications", "jwks",
    "workspaces", "workspace_members", "clusters", "health_snapshots", "alert_policies", "incidents",
]


def fail(msg: str) -> None:
    raise SystemExit(f"[FATAL] {msg}")


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def cmd_verify_approval_pin(approval_json_path: str) -> None:
    p = pathlib.Path(approval_json_path)
    if not p.is_file() or p.is_symlink():
        fail(f"Approval pin file missing or symlinked: {approval_json_path}")
    loaded = json.loads(p.read_text(encoding="utf-8"))
    if loaded != PINNED_CONTRACT:
        fail(
            f"Approval manifest {approval_json_path} diverged from immutable Phase 1 contract! "
            f"Expected {PINNED_CONTRACT}, got {loaded}"
        )


def cmd_verify_aws_identity(sts_json_path: str) -> None:
    sts = json.loads(pathlib.Path(sts_json_path).read_text(encoding="utf-8"))
    acct = str(sts.get("Account", "")).strip()
    arn = str(sts.get("Arn", "")).strip()
    expected_acct = PINNED_CONTRACT["aws_account_id"]
    if acct != expected_acct:
        fail(f"AWS caller Account '{acct}' != expected account '{expected_acct}'")
    if not (
        arn.startswith(f"arn:aws:iam::{expected_acct}:")
        or arn.startswith(f"arn:aws:sts::{expected_acct}:")
    ):
        fail(f"AWS caller ARN '{arn}' does not belong to account '{expected_acct}'")
    if ":assumed-role/envscale-github-" in arn or ":assumed-role/envscale-ec2-" in arn:
        fail(f"Automated CI/runtime role '{arn}' is forbidden from running historical vault migration")
    print(f"      Verified Caller   : {arn} (account {acct})")


def cmd_verify_foundation_admin_mfa(sts_json_path: str, role_json_path: str) -> None:
    sts = json.loads(pathlib.Path(sts_json_path).read_text(encoding="utf-8"))
    acct = str(sts.get("Account", "")).strip()
    arn = str(sts.get("Arn", "")).strip()
    expected_acct = str(PINNED_CONTRACT["aws_account_id"])
    if acct != expected_acct:
        fail(f"AWS caller Account '{acct}' != expected account '{expected_acct}'")
    expected_arn_re = rf"^arn:aws:sts::{expected_acct}:assumed-role/{FOUNDATION_ADMIN_ROLE_NAME}/[A-Za-z0-9+=,.@_-]+$"
    if not re.match(expected_arn_re, arn):
        fail(
            f"Mutating foundation operation requires assumed MFA role "
            f"'arn:aws:sts::{expected_acct}:assumed-role/{FOUNDATION_ADMIN_ROLE_NAME}/<session>'; got '{arn}'"
        )

    role_wrapper = json.loads(pathlib.Path(role_json_path).read_text(encoding="utf-8"))
    role_obj = role_wrapper.get("Role") or {}
    if role_obj.get("RoleName") != FOUNDATION_ADMIN_ROLE_NAME:
        fail(f"IAM role metadata RoleName '{role_obj.get('RoleName')}' != '{FOUNDATION_ADMIN_ROLE_NAME}'")
    max_dur = int(role_obj.get("MaxSessionDuration", 999999))
    if max_dur > 3600:
        fail(f"{FOUNDATION_ADMIN_ROLE_NAME} MaxSessionDuration ({max_dur}s) exceeds 3600s ceiling")

    raw_trust = role_obj.get("AssumeRolePolicyDocument")
    if isinstance(raw_trust, str):
        trust_doc = json.loads(urllib.parse.unquote(raw_trust))
    elif isinstance(raw_trust, dict):
        trust_doc = raw_trust
    else:
        fail(f"{FOUNDATION_ADMIN_ROLE_NAME} missing AssumeRolePolicyDocument")

    stmts = trust_doc.get("Statement") or []
    if isinstance(stmts, dict):
        stmts = [stmts]
    allow_stmts = [s for s in stmts if s.get("Effect") == "Allow"]
    if not allow_stmts:
        fail(f"{FOUNDATION_ADMIN_ROLE_NAME} trust policy has zero Allow statements")

    for st in allow_stmts:
        principal = st.get("Principal") or {}
        if principal == "*" or "Federated" in principal or "Service" in principal:
            fail(f"{FOUNDATION_ADMIN_ROLE_NAME} trust policy illegally trusts wildcard/Federated/Service principal: {principal}")
        aws_p = principal.get("AWS")
        aws_list = aws_p if isinstance(aws_p, list) else ([aws_p] if aws_p else [])
        if not aws_list or not all(
            isinstance(p, str) and re.match(rf"^arn:aws:iam::{expected_acct}:user/[A-Za-z0-9+=,.@_-]+$", p) and not p.endswith(":root")
            for p in aws_list
        ):
            fail(f"{FOUNDATION_ADMIN_ROLE_NAME} trust policy contains non-user or account root principal (root is strictly forbidden): {aws_list}")

        cond = st.get("Condition") or {}
        mfa_present = (cond.get("Bool") or {}).get("aws:MultiFactorAuthPresent")
        if str(mfa_present).lower() != "true":
            fail(f"{FOUNDATION_ADMIN_ROLE_NAME} trust policy lacks Bool aws:MultiFactorAuthPresent == 'true'")
        mfa_age_raw = (cond.get("NumericLessThan") or {}).get("aws:MultiFactorAuthAge")
        try:
            mfa_age = int(mfa_age_raw)
        except (TypeError, ValueError):
            fail(f"{FOUNDATION_ADMIN_ROLE_NAME} trust policy lacks NumericLessThan aws:MultiFactorAuthAge")
        if mfa_age <= 0 or mfa_age > 3600:
            fail(f"{FOUNDATION_ADMIN_ROLE_NAME} NumericLessThan aws:MultiFactorAuthAge ({mfa_age}) must be in 1..3600")

    print(f"      Verified MFA Admin: {arn} (trust MFA=true, maxAge<=3600s)")


def cmd_verify_bucket_location(loc_json_path: str, bucket_name: str) -> None:
    loc_doc = json.loads(pathlib.Path(loc_json_path).read_text(encoding="utf-8"))
    constraint = loc_doc.get("LocationConstraint") or "us-east-1"
    expected_region = PINNED_CONTRACT["aws_region"]
    if constraint != expected_region:
        fail(
            f"Bucket '{bucket_name}' LocationConstraint '{constraint}' != expected region '{expected_region}'"
        )


def _ist_tz() -> timezone | ZoneInfo:
    try:
        return ZoneInfo("Asia/Kolkata")
    except ZoneInfoNotFoundError:
        return timezone(timedelta(hours=5, minutes=30), name="IST")


def _convert_legacy_ist_key_to_utc(source_key: str) -> tuple[str | None, str | None, datetime | None]:
    basename = os.path.basename(source_key)
    m_legacy = re.search(r"([0-9]{8})_([0-9]{6})", basename)
    if not m_legacy:
        return None, None, None
    naive = datetime.strptime(m_legacy.group(1) + m_legacy.group(2), "%Y%m%d%H%M%S")
    dt_ist = naive.replace(tzinfo=_ist_tz())
    dt_utc = dt_ist.astimezone(timezone.utc)
    return dt_ist.isoformat(), dt_utc.strftime("%Y-%m-%dT%H:%M:%SZ"), dt_utc


def _derive_timestamp(source_key: str, last_modified: str) -> tuple[str, str, str, str]:
    if not last_modified or not last_modified.strip():
        fail("S3 object metadata missing LastModified timestamp")
    try:
        parsed = datetime.fromisoformat(last_modified.strip().replace("Z", "+00:00"))
    except ValueError as exc:
        fail(f"Invalid S3 LastModified timestamp '{last_modified}': {exc}")
    if parsed.tzinfo is None or parsed.tzinfo.utcoffset(parsed) is None:
        fail(f"S3 LastModified timestamp '{last_modified}' lacks explicit timezone offset")

    dt_s3 = parsed.astimezone(timezone.utc)
    s3_utc_iso = dt_s3.strftime("%Y-%m-%dT%H:%M:%SZ")
    archive_ts_utc = dt_s3.strftime("%Y%m%dT%H%M%SZ")

    _, key_conv_utc_iso, dt_key_utc = _convert_legacy_ist_key_to_utc(source_key)
    if dt_key_utc is not None:
        skew_sec = abs((dt_s3 - dt_key_utc).total_seconds())
        if skew_sec > 600:
            fail(
                f"Legacy IST filename UTC conversion ({key_conv_utc_iso}) diverges from "
                f"S3 LastModified ({s3_utc_iso}) by {int(skew_sec)}s (> 600s)"
            )
        return archive_ts_utc, "s3_last_modified_utc", s3_utc_iso, key_conv_utc_iso or "none"

    basename = os.path.basename(source_key)
    m_iso = re.search(r"([0-9]{8}T[0-9]{6}Z)", basename)
    if m_iso:
        dt_iso = datetime.strptime(m_iso.group(1), "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc)
        return archive_ts_utc, "s3_last_modified_utc", s3_utc_iso, dt_iso.strftime("%Y-%m-%dT%H:%M:%SZ")

    return archive_ts_utc, "s3_last_modified_utc", s3_utc_iso, "none"


def cmd_verify_source_object(head_json_path: str, get_json_path: str, sql_path: str) -> None:
    head_meta = json.loads(pathlib.Path(head_json_path).read_text(encoding="utf-8"))
    get_meta = json.loads(pathlib.Path(get_json_path).read_text(encoding="utf-8"))
    sql_bytes = pathlib.Path(sql_path).read_bytes()

    expected_ver = PINNED_CONTRACT["source_version_id"]
    expected_etag = PINNED_CONTRACT["source_etag"]
    expected_size = PINNED_CONTRACT["expected_byte_size"]
    expected_sha = PINNED_CONTRACT["expected_sha256"]

    head_ver = head_meta.get("VersionId")
    get_ver = get_meta.get("VersionId")
    if head_ver != expected_ver:
        fail(
            f"Current S3 head VersionId '{head_ver}' != Phase 1-approved VersionId '{expected_ver}'! "
            "Source object was overwritten, unversioned, or replaced."
        )
    if get_ver != expected_ver:
        fail(f"Downloaded S3 VersionId '{get_ver}' != Phase 1-approved VersionId '{expected_ver}'!")

    for label, meta in (("head-object", head_meta), ("get-object", get_meta)):
        if meta.get("ContentLength") != expected_size:
            fail(
                f"S3 {label} ContentLength ({meta.get('ContentLength')}) != Phase 1-approved byte size ({expected_size})"
            )
        if meta.get("ETag") != expected_etag:
            fail(f"S3 {label} ETag ({meta.get('ETag')}) != Phase 1-approved ETag ({expected_etag})")

    actual_size = len(sql_bytes)
    if actual_size != expected_size:
        fail(f"Downloaded SQL byte size ({actual_size}) != Phase 1-approved size ({expected_size})")

    actual_sha = sha256_bytes(sql_bytes)
    if actual_sha != expected_sha:
        fail(f"Downloaded SQL SHA-256 ({actual_sha}) != Phase 1-approved SHA-256 ({expected_sha})")

    archive_ts, ts_source, s3_last_mod_utc, key_conv_utc = _derive_timestamp(
        str(PINNED_CONTRACT["source_key"]), str(get_meta.get("LastModified", ""))
    )
    print(f"{archive_ts} {ts_source} {s3_last_mod_utc} {key_conv_utc} {actual_size} {actual_sha}")


def cmd_inspect_sql(sql_path: str) -> None:
    raw = pathlib.Path(sql_path).read_bytes()
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        fail(f"SQL dump is not valid UTF-8: {exc}")

    lines = text.splitlines()
    create_tables = 0
    copy_starts = 0
    copy_ends = 0
    in_copy = False

    for line in lines:
        upper = line.lstrip().upper()
        if not in_copy:
            if upper.startswith("CREATE TABLE "):
                create_tables += 1
            elif upper.startswith("COPY ") and " FROM STDIN" in upper:
                copy_starts += 1
                in_copy = True
        else:
            if line == "\\.":
                copy_ends += 1
                in_copy = False

    if in_copy or copy_starts != copy_ends:
        fail(f"Truncated COPY block detected (starts={copy_starts}, terminators={copy_ends})")
    if create_tables == 0 and copy_starts == 0:
        fail("SQL file contains no CREATE TABLE or COPY statements")

    print(f"      UTF-8 Valid        : true ({len(lines)} lines)")
    print(f"      CREATE TABLE count : {create_tables}")
    print(f"      COPY blocks        : {copy_starts} opened / {copy_ends} terminated cleanly")


def _parse_baseline(rows_tsv: str, cols_tsv: str, hashes_tsv: str) -> tuple[dict[str, int], dict[str, int], str, str, list[str], dict[str, str]]:
    rows_raw = pathlib.Path(rows_tsv).read_text(encoding="utf-8")
    cols_raw = pathlib.Path(cols_tsv).read_text(encoding="utf-8")
    hashes_raw = pathlib.Path(hashes_tsv).read_text(encoding="utf-8")

    tables: dict[str, int] = {}
    public_tables: dict[str, int] = {}
    for line in rows_raw.splitlines():
        if not line.strip():
            continue
        schema_name, table_name, cnt_str = line.split("\t")
        fq = f"{schema_name}.{table_name}"
        tables[fq] = int(cnt_str)
        if schema_name == "public":
            public_tables[table_name] = int(cnt_str)

    col_lines = [ln.strip() for ln in cols_raw.splitlines() if ln.strip()]
    if not col_lines:
        fail("Restored database column catalog is empty")

    table_hashes: dict[str, str] = {}
    for line in hashes_raw.splitlines():
        if not line.strip():
            continue
        schema_name, table_name, digest = line.split("\t")
        table_hashes[f"{schema_name}.{table_name}"] = digest

    if set(table_hashes.keys()) != set(tables.keys()):
        fail("Mismatch between row-count table set and content-hash table set")

    schema_fp = sha256_bytes("\n".join(col_lines).encode("utf-8"))
    data_canonical = "\n".join(f"{fq}\t{tables[fq]}\t{table_hashes[fq]}" for fq in sorted(tables))
    data_fp = sha256_bytes(data_canonical.encode("utf-8"))
    return tables, public_tables, schema_fp, data_fp, col_lines, table_hashes


def cmd_build_manifest(
    rows_tsv: str,
    cols_tsv: str,
    hashes_tsv: str,
    manifest_path: str,
    s3_last_mod_utc: str,
    dump_bytes: str,
    dump_sha256: str,
    toc_count: str,
    archive_ts_utc: str,
    archive_ts_source: str,
) -> None:
    tables, public_tables, schema_fp, data_fp, _, _ = _parse_baseline(rows_tsv, cols_tsv, hashes_tsv)
    present_canonical = [t for t in CANONICAL_TABLES if t in public_tables]
    missing_canonical = [t for t in CANONICAL_TABLES if t not in public_tables]
    extra_public = [t for t in sorted(public_tables) if t not in CANONICAL_TABLES]
    has_drizzle_journal = "drizzle.__drizzle_migrations" in tables

    if missing_canonical:
        fail(f"Phase 1 restore missing canonical public tables: {', '.join(missing_canonical)}")

    print("      Restored Schema/Table Row Baseline:")
    for fq, count in tables.items():
        print(f"        - {fq:<36} : {count} rows")
    print(f"      Canonical Public Tables Present : {len(present_canonical)}/{len(CANONICAL_TABLES)}")
    print(f"      Drizzle __drizzle_migrations    : {'present' if has_drizzle_journal else 'absent'}")
    print(f"      Schema Fingerprint (SHA-256)    : {schema_fp}")
    print(f"      Data Fingerprint (SHA-256)      : {data_fp}")

    key_ist_iso, key_conv_utc_iso, _ = _convert_legacy_ist_key_to_utc(str(PINNED_CONTRACT["source_key"]))

    manifest = {
        "schema_version": "1.0",
        "status": "VERIFIED_HISTORICAL",
        "verification_level": "RESTORE_VERIFIED",
        "eligible_for_auto_latest_pointer": False,
        "verified_at_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "archive_timestamp_utc": archive_ts_utc,
        "archive_timestamp_source": archive_ts_source,
        "source": {
            "aws_account_id": PINNED_CONTRACT["aws_account_id"],
            "bucket": PINNED_CONTRACT["source_bucket"],
            "key": PINNED_CONTRACT["source_key"],
            "version_id": PINNED_CONTRACT["source_version_id"],
            "etag": PINNED_CONTRACT["source_etag"],
            "last_modified_utc": s3_last_mod_utc,
            "filename_nominal_ist": key_ist_iso,
            "filename_converted_utc": key_conv_utc_iso,
            "format": "plain_sql",
            "byte_size": PINNED_CONTRACT["expected_byte_size"],
            "sha256": PINNED_CONTRACT["expected_sha256"],
        },
        "converted_dump": {
            "format": "pg_custom_fc",
            "byte_size": int(dump_bytes),
            "sha256": dump_sha256,
            "toc_entries": int(toc_count),
        },
        "schema_fingerprint_sha256": schema_fp,
        "data_fingerprint_sha256": data_fp,
        "restored_tables": tables,
        "table_presence": {
            "canonical_expected": len(CANONICAL_TABLES),
            "canonical_present": present_canonical,
            "canonical_missing": missing_canonical,
            "extra_public_tables": extra_public,
            "has_drizzle_migrations_journal": has_drizzle_journal,
        },
    }
    pathlib.Path(manifest_path).write_text(json.dumps(manifest, indent=2), encoding="utf-8")


def cmd_compare_dump_restore(
    local_rows: str, local_cols: str, local_hashes: str,
    dump_rows: str, dump_cols: str, dump_hashes: str,
) -> None:
    l_tbl, _, l_sfp, l_dfp, l_col_list, l_th = _parse_baseline(local_rows, local_cols, local_hashes)
    d_tbl, _, d_sfp, d_dfp, d_col_list, d_th = _parse_baseline(dump_rows, dump_cols, dump_hashes)

    if d_col_list != l_col_list or d_sfp != l_sfp:
        fail("Isolated PostgreSQL restore of S3 database.dump has divergent column/type schema!")
    if d_tbl != l_tbl:
        fail(f"Isolated PostgreSQL restore of S3 database.dump has divergent table/row counts: {d_tbl} != {l_tbl}")
    if d_th != l_th or d_dfp != l_dfp:
        fail("Isolated PostgreSQL restore of S3 database.dump has altered row data contents!")


def cmd_verify_roundtrip_manifest(
    s3_manifest_path: str,
    local_manifest_path: str,
    s3_sql_sha: str,
    s3_dump_sha: str,
    s3_dump_bytes: str,
    s3_toc_count: str,
) -> None:
    s3_m = json.loads(pathlib.Path(s3_manifest_path).read_text(encoding="utf-8"))
    loc_m = json.loads(pathlib.Path(local_manifest_path).read_text(encoding="utf-8"))
    expected_sha = PINNED_CONTRACT["expected_sha256"]

    if s3_sql_sha != expected_sha:
        fail(f"Round-trip S3 original.sql SHA-256 ({s3_sql_sha}) != Phase 1 SHA-256 ({expected_sha})")
    if s3_m.get("source") != loc_m.get("source"):
        fail("S3 manifest source object/version/checksum metadata diverged from Phase 1 pin!")
    if (
        s3_m.get("archive_timestamp_utc") != loc_m.get("archive_timestamp_utc")
        or s3_m.get("archive_timestamp_source") != "s3_last_modified_utc"
    ):
        fail("S3 manifest archive_timestamp_utc/source diverged from S3 authoritative UTC LastModified!")

    cd = s3_m.get("converted_dump", {})
    toc_int = int(s3_toc_count)
    if (
        cd.get("format") != "pg_custom_fc"
        or cd.get("sha256") != s3_dump_sha
        or cd.get("byte_size") != int(s3_dump_bytes)
        or cd.get("toc_entries") != toc_int
        or toc_int <= 0
    ):
        fail("S3 database.dump does not match S3 manifest converted_dump checksum/size/TOC!")

    for key in ("restored_tables", "table_presence", "schema_fingerprint_sha256", "data_fingerprint_sha256"):
        if s3_m.get(key) != loc_m.get(key):
            fail(f"S3 manifest '{key}' diverged from locally verified restore baseline!")

    if s3_m.get("status") != "VERIFIED_HISTORICAL" or s3_m.get("verification_level") != "RESTORE_VERIFIED":
        fail("S3 manifest has invalid status or verification_level!")
    if s3_m.get("eligible_for_auto_latest_pointer") is not False:
        fail("S3 manifest illegally sets eligible_for_auto_latest_pointer != False!")


def main() -> None:
    if len(sys.argv) < 2:
        fail("Missing subcommand")
    sub = sys.argv[1]
    args = sys.argv[2:]
    dispatch = {
        "verify-approval-pin": (cmd_verify_approval_pin, 1),
        "verify-aws-identity": (cmd_verify_aws_identity, 1),
        "verify-foundation-admin-mfa": (cmd_verify_foundation_admin_mfa, 2),
        "verify-bucket-location": (cmd_verify_bucket_location, 2),
        "verify-source-object": (cmd_verify_source_object, 3),
        "inspect-sql": (cmd_inspect_sql, 1),
        "build-manifest": (cmd_build_manifest, 10),
        "compare-dump-restore": (cmd_compare_dump_restore, 6),
        "verify-roundtrip-manifest": (cmd_verify_roundtrip_manifest, 6),
    }
    if sub not in dispatch:
        fail(f"Unknown subcommand: {sub}")
    fn, arity = dispatch[sub]
    if len(args) != arity:
        fail(f"{sub} expects {arity} args, got {len(args)}")
    fn(*args)


if __name__ == "__main__":
    main()

