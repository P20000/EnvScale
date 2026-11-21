#!/usr/bin/env python3
"""
EnvScale — Immutable Release Manifest Generator.

Builds a schema-validated release-manifest.json binding a 40-character Git
commit SHA to immutable @sha256: container digests and Drizzle migration metadata.
"""

from __future__ import annotations

import argparse
import datetime as dt
import importlib.util
import json
import os
import pathlib
import sys
import tempfile
from typing import Any

SCRIPT_DIR = pathlib.Path(__file__).resolve().parent
VALIDATOR_PATH = SCRIPT_DIR / "validate-release-manifest.py"
DEFAULT_SCHEMA = SCRIPT_DIR.parent / "release" / "release-schema.json"
DEFAULT_MIGRATIONS = SCRIPT_DIR.parent.parent / "apps" / "api-server" / "src" / "db" / "migrations"


def _load_validator_module():
    spec = importlib.util.spec_from_file_location("validate_release_manifest", VALIDATOR_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load validator module at {VALIDATOR_PATH}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _normalize_digest(raw_digest: str) -> str:
    digest = raw_digest.strip().lower()
    if not digest.startswith("sha256:"):
        digest = f"sha256:{digest}"
    return digest


def _build_image_entry(owner_lc: str, image_name: str, commit_sha: str, raw_digest: str) -> dict[str, str]:
    repo = f"ghcr.io/{owner_lc.lower()}/{image_name}"
    digest = _normalize_digest(raw_digest)
    return {
        "repository": repo,
        "commit_tag": f"sha-{commit_sha}",
        "digest": digest,
        "pinned_ref": f"{repo}@{digest}",
        "platform": "linux/amd64",
    }


def build_release_manifest(
    *,
    repository: str,
    branch: str,
    commit_sha: str,
    owner_lc: str,
    api_digest: str,
    streamer_digest: str,
    web_digest: str,
    workflow_name: str,
    workflow_run_id: str,
    workflow_run_attempt: int,
    builder_identity: str,
    migrations_dir: pathlib.Path = DEFAULT_MIGRATIONS,
    schema_path: pathlib.Path = DEFAULT_SCHEMA,
    built_at_utc: str | None = None,
    backward_compatible_db: bool = True,
    requires_pre_deploy_backup: bool = False,
) -> dict[str, Any]:
    """Build and strictly validate an immutable release manifest dictionary."""
    validator = _load_validator_module()
    commit_sha_lc = commit_sha.strip().lower()
    now_utc = dt.datetime.now(dt.timezone.utc)
    built_ts = built_at_utc or now_utc.strftime("%Y-%m-%dT%H:%M:%SZ")
    compact_ts = dt.datetime.strptime(built_ts, "%Y-%m-%dT%H:%M:%SZ").strftime("%Y%m%dT%H%M%SZ")
    release_id = f"rel-{compact_ts}-{commit_sha_lc[:8]}"

    count, latest_tag, bundle_sha256, entries = validator.compute_drizzle_bundle(migrations_dir)

    manifest: dict[str, Any] = {
        "schema_version": "1.0",
        "manifest_kind": "release",
        "release_id": release_id,
        "git": {
            "repository": repository,
            "branch": branch,
            "commit_sha": commit_sha_lc,
            "tree_clean": True,
        },
        "build": {
            "built_at_utc": built_ts,
            "workflow_name": workflow_name,
            "workflow_run_id": str(workflow_run_id),
            "workflow_run_attempt": int(workflow_run_attempt),
            "builder_identity": builder_identity,
        },
        "images": {
            "api_server": _build_image_entry(owner_lc, "envscale-api-server", commit_sha_lc, api_digest),
            "k8s_streamer": _build_image_entry(owner_lc, "envscale-k8s-streamer", commit_sha_lc, streamer_digest),
            "web": _build_image_entry(owner_lc, "envscale-web", commit_sha_lc, web_digest),
        },
        "compatibility": {
            "compose_contract_version": "2.0",
            "postgres_major": 16,
            "redis_major": 7,
            "drizzle_journal_entries": count,
            "latest_migration_tag": latest_tag,
            "drizzle_migrations_bundle_sha256": bundle_sha256,
            "drizzle_migrations": entries,
            "backward_compatible_db": backward_compatible_db,
            "requires_pre_deploy_backup": requires_pre_deploy_backup,
        },
    }

    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    validator.validate_manifest(
        manifest,
        schema,
        migrations_dir=migrations_dir,
        manifest_filename="release-manifest.json",
        allow_example=False,
    )
    return manifest


def write_manifest_atomic(manifest: dict[str, Any], output_path: pathlib.Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=f".{output_path.name}.", dir=str(output_path.parent))
    try:
        os.fchmod(fd, 0o644)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(manifest, handle, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_name, output_path)
    except BaseException:
        if os.path.exists(tmp_name):
            os.unlink(tmp_name)
        raise


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate a validated EnvScale release manifest.")
    parser.add_argument("--repository", required=True, help="GitHub owner/repo (e.g. P20000/EnvScale)")
    parser.add_argument("--branch", required=True, help="Git branch name (e.g. develop)")
    parser.add_argument("--commit-sha", required=True, help="Full 40-char commit SHA")
    parser.add_argument("--owner-lc", required=True, help="Lowercase GHCR owner namespace")
    parser.add_argument("--api-digest", required=True, help="sha256:... digest for envscale-api-server")
    parser.add_argument("--streamer-digest", required=True, help="sha256:... digest for envscale-k8s-streamer")
    parser.add_argument("--web-digest", required=True, help="sha256:... digest for envscale-web")
    parser.add_argument("--workflow-name", default="EnvScale CD - Build & Deploy")
    parser.add_argument("--workflow-run-id", default="1")
    parser.add_argument("--workflow-run-attempt", type=int, default=1)
    parser.add_argument("--builder-identity", required=True)
    parser.add_argument("--built-at-utc", default=None)
    parser.add_argument("--backward-compatible-db", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--requires-pre-deploy-backup", action=argparse.BooleanOptionalAction, default=False)
    parser.add_argument("--migrations-dir", type=pathlib.Path, default=DEFAULT_MIGRATIONS)
    parser.add_argument("--schema", type=pathlib.Path, default=DEFAULT_SCHEMA)
    parser.add_argument("--output", required=True, type=pathlib.Path)

    args = parser.parse_args()
    manifest = build_release_manifest(
        repository=args.repository,
        branch=args.branch,
        commit_sha=args.commit_sha,
        owner_lc=args.owner_lc,
        api_digest=args.api_digest,
        streamer_digest=args.streamer_digest,
        web_digest=args.web_digest,
        workflow_name=args.workflow_name,
        workflow_run_id=args.workflow_run_id,
        workflow_run_attempt=args.workflow_run_attempt,
        builder_identity=args.builder_identity,
        migrations_dir=args.migrations_dir,
        schema_path=args.schema,
        built_at_utc=args.built_at_utc,
        backward_compatible_db=args.backward_compatible_db,
        requires_pre_deploy_backup=args.requires_pre_deploy_backup,
    )
    write_manifest_atomic(manifest, args.output)
    print(f"[MANIFEST GENERATED] release_id={manifest['release_id']} -> {args.output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

