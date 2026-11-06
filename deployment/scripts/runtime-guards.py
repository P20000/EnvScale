#!/usr/bin/env python3
"""
EnvScale — Runtime Safety Guards & Atomic State Helpers.

Subcommands:
  - verify-inherited-flock   Kernel-level fstat + flock verification of inherited lock FD
  - verify-pre-deploy-backup Validates RESTORE_VERIFIED backup manifest, SHA-256 & freshness
  - render-caddyfile         Strict ipaddress + 1..65535 port validation & atomic rendering
  - verify-db-migrations     Exact Drizzle migration hash/timestamp prefix & rollback safety check
  - rotate-release-pointers  Safe in-memory-staged atomic rotation of last/previous-known-good
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import fcntl
import hashlib
import ipaddress
import json
import os
import pathlib
import re
import sys
import tempfile
from typing import Any


def fail(msg: str) -> None:
    raise SystemExit(msg)


def write_bytes_atomic_0600(dst: pathlib.Path, payload: bytes) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=f".{dst.name}.", dir=str(dst.parent))
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_name, dst)
    except BaseException:
        if os.path.exists(tmp_name):
            os.unlink(tmp_name)
        raise


def cmd_verify_inherited_flock(args: argparse.Namespace) -> None:
    fd = args.fd
    lock_path = pathlib.Path(args.lock_file)

    if fd < 3:
        fail(f"[LOCK GUARD FAILED] Invalid lock descriptor {fd} (must be >= 3)")
    if lock_path.is_symlink() or not lock_path.exists():
        fail(f"[LOCK GUARD FAILED] Lock file missing or symlinked: {lock_path}")

    try:
        fd_stat = os.fstat(fd)
        flags = fcntl.fcntl(fd, fcntl.F_GETFL)
    except OSError as exc:
        fail(f"[LOCK GUARD FAILED] Inherited lock FD {fd} is not open: {exc}")

    if (flags & os.O_ACCMODE) not in (os.O_WRONLY, os.O_RDWR):
        fail(f"[LOCK GUARD FAILED] Inherited lock FD {fd} is not open for writing")

    file_stat = os.stat(lock_path, follow_symlinks=False)
    if (fd_stat.st_dev, fd_stat.st_ino) != (file_stat.st_dev, file_stat.st_ino):
        fail(
            f"[LOCK GUARD FAILED] Inherited FD {fd} inode {(fd_stat.st_dev, fd_stat.st_ino)} "
            f"does not match lock file {lock_path} {(file_stat.st_dev, file_stat.st_ino)}"
        )

    # 1. Prove that an independent open file description CANNOT acquire LOCK_EX
    probe_fd = os.open(str(lock_path), os.O_RDWR)
    try:
        try:
            fcntl.flock(probe_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            pass
        else:
            fcntl.flock(probe_fd, fcntl.LOCK_UN)
            fail(
                f"[LOCK GUARD FAILED] Lock file {lock_path} was NOT exclusively locked "
                f"(unheld descriptor {fd} rejected)"
            )
    finally:
        os.close(probe_fd)

    # 2. Prove that inherited `fd` ITSELF owns that active kernel open-file-description lock
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        fail(
            f"[LOCK GUARD FAILED] Descriptor {fd} does not own the active exclusive lock on {lock_path}"
        )


def cmd_verify_pre_deploy_backup(args: argparse.Namespace) -> None:
    man_path = pathlib.Path(args.manifest)
    art_path = pathlib.Path(args.artifact)
    max_age = args.max_age_seconds

    if max_age < 1 or max_age > 86400:
        fail(f"[BACKUP GATE FAILED] --max-age-seconds must be in 1..86400 (got {max_age})")

    for label, p in (("manifest", man_path), ("artifact", art_path)):
        if p.is_symlink() or not p.is_file():
            fail(f"[BACKUP GATE FAILED] Pre-deploy backup {label} missing or symlinked: {p}")
        if p.stat().st_size <= 0:
            fail(f"[BACKUP GATE FAILED] Pre-deploy backup {label} is empty: {p}")

    try:
        manifest = json.loads(man_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        fail(f"[BACKUP GATE FAILED] Invalid JSON in backup manifest {man_path}: {exc}")

    if not isinstance(manifest, dict):
        fail("[BACKUP GATE FAILED] Backup manifest root must be a JSON object")
    if manifest.get("schema_version") != "1.0":
        fail(f"[BACKUP GATE FAILED] Unsupported backup manifest schema_version: {manifest.get('schema_version')!r}")
    if manifest.get("verification_level") != "RESTORE_VERIFIED":
        fail(
            f"[BACKUP GATE FAILED] Backup verification_level is {manifest.get('verification_level')!r}; "
            "must be 'RESTORE_VERIFIED'"
        )
    if manifest.get("status") != "VERIFIED_OPERATIONAL":
        fail(
            f"[BACKUP GATE FAILED] Backup status is {manifest.get('status')!r}; "
            "must be 'VERIFIED_OPERATIONAL' (historical archives are not fresh pre-deploy backups)"
        )
    if manifest.get("eligible_for_auto_latest_pointer") is not True:
        fail("[BACKUP GATE FAILED] Backup manifest eligible_for_auto_latest_pointer must be true")

    verified_at_raw = manifest.get("verified_at_utc", "")
    if not isinstance(verified_at_raw, str) or not re.fullmatch(
        r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z", verified_at_raw
    ):
        fail(f"[BACKUP GATE FAILED] Invalid verified_at_utc timestamp: {verified_at_raw!r}")

    verified_dt = datetime.strptime(verified_at_raw, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    now_dt = datetime.now(timezone.utc)
    age_sec = (now_dt - verified_dt).total_seconds()
    if age_sec < -60:
        fail(f"[BACKUP GATE FAILED] Backup verified_at_utc ({verified_at_raw}) is in the future")
    if age_sec > max_age:
        fail(
            f"[BACKUP GATE FAILED] Pre-deploy backup is stale: age {int(age_sec)}s exceeds max {max_age}s "
            f"(verified_at_utc={verified_at_raw})"
        )

    dump_meta = manifest.get("dump")
    if not isinstance(dump_meta, dict):
        fail("[BACKUP GATE FAILED] Backup manifest missing 'dump' metadata object")
    if dump_meta.get("format") != "pg_custom_fc":
        fail(f"[BACKUP GATE FAILED] Backup dump.format must be 'pg_custom_fc', got {dump_meta.get('format')!r}")

    toc_entries = dump_meta.get("toc_entries")
    if isinstance(toc_entries, bool) or not isinstance(toc_entries, int) or toc_entries <= 0:
        fail(f"[BACKUP GATE FAILED] Backup dump.toc_entries must be a positive integer, got {toc_entries!r}")

    expected_sha = dump_meta.get("sha256", "")
    expected_size = dump_meta.get("byte_size", -1)
    if not isinstance(expected_sha, str) or not re.fullmatch(r"[0-9a-f]{64}", expected_sha):
        fail(f"[BACKUP GATE FAILED] Invalid dump.sha256 in backup manifest: {expected_sha!r}")

    art_bytes = art_path.read_bytes()
    actual_size = len(art_bytes)
    actual_sha = hashlib.sha256(art_bytes).hexdigest()
    if actual_size != expected_size:
        fail(f"[BACKUP GATE FAILED] Backup artifact byte size ({actual_size}) != manifest ({expected_size})")
    if actual_sha != expected_sha:
        fail(f"[BACKUP GATE FAILED] Backup artifact SHA-256 ({actual_sha}) != manifest ({expected_sha})")

    if args.expected_migrations_sha256:
        db_meta = manifest.get("database", {})
        rec_mig_sha = db_meta.get("drizzle_migrations_bundle_sha256") if isinstance(db_meta, dict) else None
        if rec_mig_sha != args.expected_migrations_sha256:
            fail(
                f"[BACKUP GATE FAILED] Backup database.drizzle_migrations_bundle_sha256 ({rec_mig_sha!r}) "
                f"!= active pre-migration release ({args.expected_migrations_sha256!r})"
            )


def _parse_valid_port(label: str, raw: str) -> int:
    if not re.fullmatch(r"[0-9]+", raw):
        fail(f"[CADDY RENDER FAILED] {label} must be an integer in 1..65535 (got {raw!r})")
    val = int(raw)
    if val < 1 or val > 65535:
        fail(f"[CADDY RENDER FAILED] {label} out of valid TCP port range 1..65535 (got {val})")
    return val


def cmd_render_caddyfile(args: argparse.Namespace) -> None:
    try:
        ip_obj = ipaddress.ip_address(args.public_ip.strip())
    except ValueError as exc:
        fail(f"[CADDY RENDER FAILED] Invalid PUBLIC_IP {args.public_ip!r}: {exc}")

    if not isinstance(ip_obj, ipaddress.IPv4Address):
        fail(f"[CADDY RENDER FAILED] PUBLIC_IP must be IPv4, got {ip_obj!r}")
    if (
        ip_obj.is_unspecified
        or ip_obj.is_loopback
        or ip_obj.is_multicast
        or ip_obj.is_link_local
        or ip_obj == ipaddress.IPv4Address("255.255.255.255")
    ):
        fail(f"[CADDY RENDER FAILED] Refusing non-routable/reserved IPv4 address: {ip_obj}")

    dom = args.domain.strip()
    if not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", dom):
        fail(f"[CADDY RENDER FAILED] Invalid DUCKDNS_DOMAIN label: {dom!r}")

    api_p = _parse_valid_port("API_HOST_PORT", args.api_port)
    str_p = _parse_valid_port("STREAMER_HOST_PORT", args.streamer_port)
    web_p = _parse_valid_port("WEB_HOST_PORT", args.web_port)
    if len({api_p, str_p, web_p}) != 3:
        fail(f"[CADDY RENDER FAILED] Host ports must be distinct (got {api_p}, {str_p}, {web_p})")

    tpl = pathlib.Path(args.template).read_text(encoding="utf-8")
    ip_str = str(ip_obj)
    rendered = (
        tpl.replace("__PUBLIC_IP__", ip_str)
        .replace("__SSLIP_HOST__", f"{ip_str}.sslip.io")
        .replace("__FULL_DOMAIN__", f"{dom}.duckdns.org")
        .replace("__API_HOST_PORT__", str(api_p))
        .replace("__STREAMER_HOST_PORT__", str(str_p))
        .replace("__WEB_HOST_PORT__", str(web_p))
    )
    write_bytes_atomic_0600(pathlib.Path(args.output), rendered.encode("utf-8"))


def _parse_live_migrations(stdin_text: str) -> list[tuple[int, str, int]]:
    rows: list[tuple[int, str, int]] = []
    for lineno, raw in enumerate(stdin_text.splitlines(), 1):
        line = raw.strip()
        if not line:
            continue
        parts = line.split("|")
        if len(parts) != 3:
            fail(f"[MIGRATION CHECK FAILED] Malformed journal row on line {lineno}: {line!r}")
        id_s, hash_s, when_s = parts[0].strip(), parts[1].strip(), parts[2].strip()
        if not re.fullmatch(r"-?[0-9]+", id_s) or not re.fullmatch(r"-?[0-9]+", when_s):
            fail(f"[MIGRATION CHECK FAILED] Non-integer id/created_at on line {lineno}: {line!r}")
        if not re.fullmatch(r"[0-9a-f]{64}", hash_s):
            fail(f"[MIGRATION CHECK FAILED] Invalid SHA-256 hash on line {lineno}: {hash_s!r}")
        rows.append((int(id_s), hash_s, int(when_s)))
    return rows


def cmd_verify_db_migrations(args: argparse.Namespace) -> None:
    manifest = json.loads(pathlib.Path(args.manifest).read_text(encoding="utf-8"))
    target_migs: list[dict[str, Any]] = manifest["compatibility"]["drizzle_migrations"]
    live_rows = _parse_live_migrations(sys.stdin.read())

    if len(live_rows) < len(target_migs):
        fail(
            f"[MIGRATION CHECK FAILED] Live PostgreSQL has {len(live_rows)} applied migrations, "
            f"fewer than target release requirement ({len(target_migs)})"
        )

    for idx, exp in enumerate(target_migs):
        _, live_hash, live_when = live_rows[idx]
        if live_hash != exp["sql_sha256"] or live_when != int(exp["when"]):
            fail(
                f"[MIGRATION CHECK FAILED] Divergent migration history at index {idx} ({exp['tag']}): "
                f"live=(hash={live_hash}, created_at={live_when}) != "
                f"expected=(hash={exp['sql_sha256']}, created_at={exp['when']})"
            )

    if args.mode != "rollback":
        return

    if args.last_good and pathlib.Path(args.last_good).is_file():
        cur = json.loads(pathlib.Path(args.last_good).read_text(encoding="utf-8"))
        cur_c = cur["compatibility"]
        if cur_c.get("drizzle_migrations") != target_migs and not cur_c.get("backward_compatible_db", False):
            fail(
                "[ROLLBACK BLOCKED] Active last-known-good release applied non-backward-compatible DB migrations. "
                "Restore PostgreSQL backup via db-restore.sh first or pass --allow-schema-divergent-rollback."
            )

    if len(live_rows) > len(target_migs):
        ledger_records: list[dict[str, Any]] = []
        if args.ledger and pathlib.Path(args.ledger).is_file():
            for raw in pathlib.Path(args.ledger).read_text(encoding="utf-8").splitlines():
                if raw.strip():
                    ledger_records.append(json.loads(raw))

        for rec in ledger_records:
            rec_migs = rec.get("drizzle_migrations")
            if isinstance(rec_migs, list) and len(rec_migs) > len(target_migs):
                if not rec.get("backward_compatible_db", False):
                    fail(
                        f"[ROLLBACK BLOCKED] Release {rec.get('release_id')} applied non-backward-compatible "
                        "migrations beyond rollback target. Restore DB backup first."
                    )

        for extra_idx in range(len(target_migs), len(live_rows)):
            _, extra_hash, extra_when = live_rows[extra_idx]
            proven_safe = False
            for rec in ledger_records:
                rec_migs = rec.get("drizzle_migrations")
                if (
                    isinstance(rec_migs, list)
                    and len(rec_migs) > extra_idx
                    and rec_migs[: len(target_migs)] == target_migs
                    and rec_migs[extra_idx].get("sql_sha256") == extra_hash
                    and int(rec_migs[extra_idx].get("when", -1)) == extra_when
                    and rec.get("backward_compatible_db") is True
                ):
                    proven_safe = True
                    break
            if not proven_safe:
                fail(
                    f"[ROLLBACK BLOCKED] Live PostgreSQL migration at index {extra_idx} "
                    f"(hash={extra_hash[:16]}...) is ahead of target and not proven backward-compatible."
                )


def cmd_rotate_release_pointers(args: argparse.Namespace) -> None:
    tgt_path = pathlib.Path(args.target_manifest)
    last_path = pathlib.Path(args.last_good)
    prev_path = pathlib.Path(args.prev_good)

    # Read target & current last-known-good into memory BEFORE modifying either file
    # (critical when target_manifest == prev_good).
    tgt_bytes = tgt_path.read_bytes()
    tgt_id = json.loads(tgt_bytes.decode("utf-8"))["release_id"]

    if last_path.is_file():
        old_last_bytes = last_path.read_bytes()
        old_last_id = json.loads(old_last_bytes.decode("utf-8"))["release_id"]
        if old_last_id != tgt_id:
            write_bytes_atomic_0600(prev_path, old_last_bytes)

    write_bytes_atomic_0600(last_path, tgt_bytes)


def main() -> None:
    parser = argparse.ArgumentParser(description="EnvScale runtime safety guard helper.")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_lock = sub.add_parser("verify-inherited-flock")
    p_lock.add_argument("--fd", required=True, type=int)
    p_lock.add_argument("--lock-file", required=True)
    p_lock.set_defaults(func=cmd_verify_inherited_flock)

    p_bkp = sub.add_parser("verify-pre-deploy-backup")
    p_bkp.add_argument("--manifest", required=True)
    p_bkp.add_argument("--artifact", required=True)
    p_bkp.add_argument("--max-age-seconds", required=True, type=int)
    p_bkp.add_argument("--expected-migrations-sha256", default="")
    p_bkp.set_defaults(func=cmd_verify_pre_deploy_backup)

    p_cad = sub.add_parser("render-caddyfile")
    p_cad.add_argument("--template", required=True)
    p_cad.add_argument("--output", required=True)
    p_cad.add_argument("--public-ip", required=True)
    p_cad.add_argument("--domain", required=True)
    p_cad.add_argument("--api-port", required=True)
    p_cad.add_argument("--streamer-port", required=True)
    p_cad.add_argument("--web-port", required=True)
    p_cad.set_defaults(func=cmd_render_caddyfile)

    p_mig = sub.add_parser("verify-db-migrations")
    p_mig.add_argument("--manifest", required=True)
    p_mig.add_argument("--mode", required=True, choices=["verify", "rollback"])
    p_mig.add_argument("--last-good", default="")
    p_mig.add_argument("--ledger", default="")
    p_mig.set_defaults(func=cmd_verify_db_migrations)

    p_rot = sub.add_parser("rotate-release-pointers")
    p_rot.add_argument("--target-manifest", required=True)
    p_rot.add_argument("--last-good", required=True)
    p_rot.add_argument("--prev-good", required=True)
    p_rot.set_defaults(func=cmd_rotate_release_pointers)

    parsed = parser.parse_args()
    parsed.func(parsed)


if __name__ == "__main__":
    main()

