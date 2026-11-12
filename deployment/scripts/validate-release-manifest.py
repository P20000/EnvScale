#!/usr/bin/env python3
"""
EnvScale — Zero-Dependency Release Manifest Schema & Consistency Validator.

Validates a release manifest JSON file against deployment/release/release-schema.json
plus cross-field consistency, anti-floating-tag, and deployability rules:
  1. Strict schema tree audit: rejects any unsupported JSON Schema keyword or type
     anywhere in the schema (including $defs and unvisited array item schemas).
  2. Exact structural, type, const, enum, range, array, and regex validation.
  3. Deployability guard: rejects 'manifest_kind == "example"', '*.example.json'
     filenames, and illustrative/low-entropy placeholder digests unless
     --allow-example is explicitly passed (and never with --emit-env).
  4. Cross-field consistency: images.<svc>.pinned_ref == "<repository>@<digest>",
     images.<svc>.commit_tag == "sha-<git.commit_sha>", release_id suffix, and
     ordered Drizzle migration entries (idx, tag, when, sql_sha256).
  5. Optional --verify-repo-migrations check against local Drizzle migration files.
  6. Optional --emit-env output producing shell-safe variable assignments.

Note: JSON manifest validation verifies structural and digest-reference consistency;
it is NOT cryptographic build-provenance attestation (which is enforced separately
via signed CI build attestations prior to deployment).
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import pathlib
import re
import shlex
import sys
from typing import Any

SCRIPT_DIR = pathlib.Path(__file__).resolve().parent
DEFAULT_SCHEMA = SCRIPT_DIR.parent / "release" / "release-schema.json"
DEFAULT_MIGRATIONS = SCRIPT_DIR.parent.parent / "apps" / "api-server" / "src" / "db" / "migrations"

FLOATING_TAG_TOKENS = (":latest", ":main", ":develop", ":master", ":prod", ":edge")
MIN_REAL_DIGEST_DISTINCT_HEX = 8

SUPPORTED_SCHEMA_KEYWORDS = frozenset({
    "$schema",
    "$id",
    "title",
    "description",
    "$defs",
    "$ref",
    "type",
    "const",
    "enum",
    "required",
    "properties",
    "additionalProperties",
    "minLength",
    "maxLength",
    "pattern",
    "minimum",
    "maximum",
    "items",
    "minItems",
    "maxItems",
})

SUPPORTED_SCHEMA_TYPES = frozenset({
    "object",
    "array",
    "string",
    "integer",
    "boolean",
})


class ValidationError(Exception):
    """Raised when a schema or release manifest violates validation rules."""


def _resolve_ref(root_schema: dict[str, Any], ref: str) -> dict[str, Any]:
    if not isinstance(ref, str) or not ref.startswith("#/"):
        raise ValidationError(f"Unsupported $ref: {ref!r}")
    node: Any = root_schema
    for part in ref[2:].split("/"):
        if not isinstance(node, dict) or part not in node:
            raise ValidationError(f"Unresolvable $ref: {ref}")
        node = node[part]
    if not isinstance(node, dict):
        raise ValidationError(f"$ref target is not a schema object: {ref}")
    return node


def audit_schema_tree(root_schema: Any, node: Any = None, path: str = "#") -> None:
    """Fail closed if the JSON Schema uses any unsupported keyword or type."""
    if not isinstance(root_schema, dict):
        raise ValidationError("#: root JSON Schema must be an object")
    if node is None:
        node = root_schema
    if not isinstance(node, dict):
        raise ValidationError(f"{path}: schema node must be a JSON object, got {type(node).__name__}")

    unknown_kws = sorted(set(node.keys()) - SUPPORTED_SCHEMA_KEYWORDS)
    if unknown_kws:
        raise ValidationError(
            f"{path}: unsupported JSON Schema keyword(s): {', '.join(unknown_kws)}"
        )

    if "$ref" in node:
        _resolve_ref(root_schema, node["$ref"])
        extra_with_ref = set(node.keys()) - {"$ref", "description", "title"}
        if extra_with_ref:
            raise ValidationError(
                f"{path}: sibling validation keywords alongside $ref are not supported: {sorted(extra_with_ref)}"
            )

    if "type" in node:
        expected_type = node["type"]
        if not isinstance(expected_type, str) or expected_type not in SUPPORTED_SCHEMA_TYPES:
            raise ValidationError(
                f"{path}: unsupported JSON Schema type {expected_type!r} (allowed: {sorted(SUPPORTED_SCHEMA_TYPES)})"
            )

    if "additionalProperties" in node and not isinstance(node["additionalProperties"], bool):
        raise ValidationError(f"{path}: additionalProperties must be a boolean")

    if "required" in node:
        req = node["required"]
        if not isinstance(req, list) or not all(isinstance(k, str) for k in req):
            raise ValidationError(f"{path}: required must be an array of strings")

    if "enum" in node:
        if not isinstance(node["enum"], list) or len(node["enum"]) == 0:
            raise ValidationError(f"{path}: enum must be a non-empty list")

    if "pattern" in node:
        pat = node["pattern"]
        if not isinstance(pat, str):
            raise ValidationError(f"{path}: pattern must be a string")
        try:
            re.compile(pat)
        except re.error as exc:
            raise ValidationError(f"{path}: invalid regex pattern {pat!r}: {exc}") from exc

    for int_kw in ("minLength", "maxLength", "minimum", "maximum", "minItems", "maxItems"):
        if int_kw in node:
            val = node[int_kw]
            if isinstance(val, bool) or not isinstance(val, int):
                raise ValidationError(f"{path}: {int_kw} must be an integer")

    if "properties" in node:
        props = node["properties"]
        if not isinstance(props, dict):
            raise ValidationError(f"{path}: properties must be an object")
        for prop_name, subschema in props.items():
            audit_schema_tree(root_schema, subschema, f"{path}/properties/{prop_name}")

    if "items" in node:
        items_schema = node["items"]
        if not isinstance(items_schema, dict):
            raise ValidationError(f"{path}: items must be a single schema object")
        audit_schema_tree(root_schema, items_schema, f"{path}/items")

    if "$defs" in node:
        defs = node["$defs"]
        if not isinstance(defs, dict):
            raise ValidationError(f"{path}: $defs must be an object")
        for def_name, def_schema in defs.items():
            audit_schema_tree(root_schema, def_schema, f"{path}/$defs/{def_name}")


def _validate_node(instance: Any, schema: dict[str, Any], root_schema: dict[str, Any], path: str) -> None:
    if "$ref" in schema:
        schema = _resolve_ref(root_schema, schema["$ref"])

    if "const" in schema and instance != schema["const"]:
        raise ValidationError(f"{path}: expected const {schema['const']!r}, got {instance!r}")

    if "enum" in schema and instance not in schema["enum"]:
        raise ValidationError(f"{path}: value {instance!r} not in enum {schema['enum']!r}")

    expected_type = schema.get("type")
    if expected_type == "object":
        if not isinstance(instance, dict):
            raise ValidationError(f"{path}: expected object, got {type(instance).__name__}")
        for req_key in schema.get("required", []):
            if req_key not in instance:
                raise ValidationError(f"{path}: missing required field '{req_key}'")
        props = schema.get("properties", {})
        if schema.get("additionalProperties") is False:
            unknown = sorted(set(instance.keys()) - set(props.keys()))
            if unknown:
                raise ValidationError(f"{path}: unexpected additional properties {unknown}")
        for key, val in instance.items():
            if key in props:
                _validate_node(val, props[key], root_schema, f"{path}.{key}")

    elif expected_type == "array":
        if not isinstance(instance, list):
            raise ValidationError(f"{path}: expected array, got {type(instance).__name__}")
        if "minItems" in schema and len(instance) < schema["minItems"]:
            raise ValidationError(f"{path}: array length {len(instance)} < minItems {schema['minItems']}")
        if "maxItems" in schema and len(instance) > schema["maxItems"]:
            raise ValidationError(f"{path}: array length {len(instance)} > maxItems {schema['maxItems']}")
        if "items" in schema:
            item_schema = schema["items"]
            for idx, elem in enumerate(instance):
                _validate_node(elem, item_schema, root_schema, f"{path}[{idx}]")

    elif expected_type == "string":
        if not isinstance(instance, str):
            raise ValidationError(f"{path}: expected string, got {type(instance).__name__}")
        if "minLength" in schema and len(instance) < schema["minLength"]:
            raise ValidationError(f"{path}: length {len(instance)} < minLength {schema['minLength']}")
        if "maxLength" in schema and len(instance) > schema["maxLength"]:
            raise ValidationError(f"{path}: length {len(instance)} > maxLength {schema['maxLength']}")
        if "pattern" in schema and not re.fullmatch(schema["pattern"], instance):
            raise ValidationError(f"{path}: {instance!r} does not match pattern {schema['pattern']!r}")

    elif expected_type == "integer":
        if isinstance(instance, bool) or not isinstance(instance, int):
            raise ValidationError(f"{path}: expected integer, got {type(instance).__name__}")
        if "minimum" in schema and instance < schema["minimum"]:
            raise ValidationError(f"{path}: {instance} < minimum {schema['minimum']}")
        if "maximum" in schema and instance > schema["maximum"]:
            raise ValidationError(f"{path}: {instance} > maximum {schema['maximum']}")

    elif expected_type == "boolean":
        if not isinstance(instance, bool):
            raise ValidationError(f"{path}: expected boolean, got {type(instance).__name__}")

    elif expected_type is not None:
        raise ValidationError(f"{path}: unsupported schema type {expected_type!r}")


def compute_drizzle_bundle(migrations_dir: pathlib.Path) -> tuple[int, str, str, list[dict[str, Any]]]:
    journal_path = migrations_dir / "meta" / "_journal.json"
    if not journal_path.is_file():
        raise ValidationError(f"Drizzle journal not found at {journal_path}")

    journal_bytes = journal_path.read_bytes()
    journal = json.loads(journal_bytes.decode("utf-8"))
    entries = journal.get("entries", [])
    if not entries:
        raise ValidationError("Drizzle _journal.json has zero entries")

    hasher = hashlib.sha256()
    hasher.update(journal_bytes)

    expected_migrations: list[dict[str, Any]] = []
    for pos, entry in enumerate(entries):
        tag = entry["tag"]
        sql_file = migrations_dir / f"{tag}.sql"
        if not sql_file.is_file():
            raise ValidationError(f"Missing SQL migration file referenced by journal: {sql_file}")
        sql_bytes = sql_file.read_bytes()
        hasher.update(tag.encode("utf-8"))
        hasher.update(sql_bytes)
        expected_migrations.append({
            "idx": int(entry.get("idx", pos)),
            "tag": tag,
            "when": int(entry["when"]),
            "sql_sha256": hashlib.sha256(sql_bytes).hexdigest(),
        })

    return len(entries), entries[-1]["tag"], hasher.hexdigest(), expected_migrations


def validate_manifest(
    manifest: dict[str, Any],
    schema: dict[str, Any],
    migrations_dir: pathlib.Path | None = None,
    manifest_filename: str = "",
    allow_example: bool = False,
) -> None:
    audit_schema_tree(schema)
    _validate_node(manifest, schema, schema, "$")

    manifest_kind = manifest["manifest_kind"]
    lower_name = manifest_filename.lower()
    is_example_filename = lower_name.endswith(".example.json") or ".example." in lower_name

    if not allow_example:
        if manifest_kind != "release":
            raise ValidationError(
                f"$.manifest_kind is '{manifest_kind}'; only 'release' manifests are deployable"
            )
        if is_example_filename:
            raise ValidationError(
                f"Refusing example filename '{manifest_filename}' in deployable validation path"
            )

    commit_sha = manifest["git"]["commit_sha"]
    release_id = manifest["release_id"]
    ts_part = release_id.split("-")[1]
    sha_suffix = release_id.split("-")[2]

    try:
        dt.datetime.strptime(ts_part, "%Y%m%dT%H%M%SZ")
    except ValueError as exc:
        raise ValidationError(f"$.release_id has invalid UTC timestamp '{ts_part}': {exc}") from exc

    if not commit_sha.startswith(sha_suffix):
        raise ValidationError(
            f"$.release_id suffix '{sha_suffix}' is not a prefix of $.git.commit_sha '{commit_sha}'"
        )

    try:
        dt.datetime.strptime(manifest["build"]["built_at_utc"], "%Y-%m-%dT%H:%M:%SZ")
    except ValueError as exc:
        raise ValidationError(f"$.build.built_at_utc is not a valid UTC timestamp: {exc}") from exc

    expected_commit_tag = f"sha-{commit_sha}"
    for svc_name, img in manifest["images"].items():
        repo = img["repository"]
        digest = img["digest"]
        pinned_ref = img["pinned_ref"]
        commit_tag = img["commit_tag"]

        for forbidden in FLOATING_TAG_TOKENS:
            if forbidden in repo or forbidden in pinned_ref:
                raise ValidationError(
                    f"$.images.{svc_name}: floating tag token '{forbidden}' is strictly prohibited"
                )

        if commit_tag != expected_commit_tag:
            raise ValidationError(
                f"$.images.{svc_name}.commit_tag ({commit_tag!r}) != {expected_commit_tag!r}"
            )

        expected_pinned = f"{repo}@{digest}"
        if pinned_ref != expected_pinned:
            raise ValidationError(
                f"$.images.{svc_name}.pinned_ref ({pinned_ref!r}) != {expected_pinned!r}"
            )

        if not allow_example:
            digest_hex = digest.split(":", 1)[1]
            distinct_chars = len(set(digest_hex))
            if distinct_chars < MIN_REAL_DIGEST_DISTINCT_HEX:
                raise ValidationError(
                    f"$.images.{svc_name}.digest ({digest}) appears synthetic/illustrative "
                    f"({distinct_chars} distinct hex chars < {MIN_REAL_DIGEST_DISTINCT_HEX})"
                )

    compat = manifest["compatibility"]
    migs = compat["drizzle_migrations"]
    if len(migs) != compat["drizzle_journal_entries"]:
        raise ValidationError(
            f"$.compatibility.drizzle_migrations length ({len(migs)}) != "
            f"drizzle_journal_entries ({compat['drizzle_journal_entries']})"
        )

    seen_tags: set[str] = set()
    prev_when = -1
    for expected_idx, entry in enumerate(migs):
        if entry["idx"] != expected_idx:
            raise ValidationError(
                f"$.compatibility.drizzle_migrations[{expected_idx}].idx ({entry['idx']}) != {expected_idx}"
            )
        if entry["tag"] in seen_tags:
            raise ValidationError(f"Duplicate migration tag in $.compatibility.drizzle_migrations: {entry['tag']}")
        seen_tags.add(entry["tag"])
        if entry["when"] < prev_when:
            raise ValidationError(
                f"$.compatibility.drizzle_migrations[{expected_idx}].when ({entry['when']}) < previous ({prev_when})"
            )
        prev_when = entry["when"]

    if migs and migs[-1]["tag"] != compat["latest_migration_tag"]:
        raise ValidationError(
            f"$.compatibility.drizzle_migrations[-1].tag ({migs[-1]['tag']!r}) != "
            f"latest_migration_tag ({compat['latest_migration_tag']!r})"
        )

    if migrations_dir is not None:
        exp_count, exp_tag, exp_hash, exp_migs = compute_drizzle_bundle(migrations_dir)
        if compat["drizzle_journal_entries"] != exp_count:
            raise ValidationError(
                f"drizzle_journal_entries ({compat['drizzle_journal_entries']}) != repo journal ({exp_count})"
            )
        if compat["latest_migration_tag"] != exp_tag:
            raise ValidationError(
                f"latest_migration_tag ({compat['latest_migration_tag']!r}) != repo journal ({exp_tag!r})"
            )
        if compat["drizzle_migrations_bundle_sha256"] != exp_hash:
            raise ValidationError(
                f"drizzle_migrations_bundle_sha256 ({compat['drizzle_migrations_bundle_sha256']}) "
                f"!= repo migrations SHA-256 ({exp_hash})"
            )
        if migs != exp_migs:
            raise ValidationError(
                "drizzle_migrations entries do not match repository SQL hashes/timestamps"
            )


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate an EnvScale release manifest.")
    parser.add_argument("--manifest", required=True, type=pathlib.Path, help="Path to release manifest JSON")
    parser.add_argument("--schema", default=DEFAULT_SCHEMA, type=pathlib.Path, help="Path to release JSON schema")
    parser.add_argument(
        "--verify-repo-migrations",
        action="store_true",
        help="Verify compatibility.drizzle_* fields match local apps/api-server/src/db/migrations",
    )
    parser.add_argument(
        "--migrations-dir",
        default=DEFAULT_MIGRATIONS,
        type=pathlib.Path,
        help="Override Drizzle migrations directory when --verify-repo-migrations is set",
    )
    parser.add_argument(
        "--allow-example",
        action="store_true",
        help="Allow validating documentation example manifests (never valid with --emit-env)",
    )
    parser.add_argument(
        "--emit-env",
        action="store_true",
        help="Emit shell-quoted environment variables for host-runtime.sh consumption",
    )
    parser.add_argument(
        "--compute-migrations-hash",
        action="store_true",
        help="Print current local Drizzle migration bundle metadata as JSON and exit",
    )

    args = parser.parse_args()

    if args.allow_example and args.emit_env:
        print("[MANIFEST INVALID] --allow-example cannot be combined with --emit-env", file=sys.stderr)
        return 1

    try:
        if args.compute_migrations_hash:
            count, tag, digest, entries = compute_drizzle_bundle(args.migrations_dir)
            print(json.dumps({
                "drizzle_journal_entries": count,
                "latest_migration_tag": tag,
                "drizzle_migrations_bundle_sha256": digest,
                "drizzle_migrations": entries,
            }, indent=2))
            return 0

        schema = json.loads(args.schema.read_text(encoding="utf-8"))
        manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
        mig_dir = args.migrations_dir if args.verify_repo_migrations else None
        validate_manifest(
            manifest,
            schema,
            mig_dir,
            manifest_filename=args.manifest.name,
            allow_example=args.allow_example,
        )
    except (OSError, json.JSONDecodeError, ValidationError) as exc:
        print(f"[MANIFEST INVALID] {exc}", file=sys.stderr)
        return 1

    if args.emit_env:
        imgs = manifest["images"]
        compat = manifest["compatibility"]
        pairs = {
            "MANIFEST_RELEASE_ID": manifest["release_id"],
            "MANIFEST_COMMIT_SHA": manifest["git"]["commit_sha"],
            "API_SERVER_IMAGE": imgs["api_server"]["pinned_ref"],
            "STREAMER_IMAGE": imgs["k8s_streamer"]["pinned_ref"],
            "WEB_IMAGE": imgs["web"]["pinned_ref"],
            "MANIFEST_MIGRATIONS_SHA256": compat["drizzle_migrations_bundle_sha256"],
            "MANIFEST_LATEST_MIGRATION_TAG": compat["latest_migration_tag"],
            "MANIFEST_JOURNAL_ENTRIES": str(compat["drizzle_journal_entries"]),
            "MANIFEST_BACKWARD_COMPATIBLE_DB": "true" if compat["backward_compatible_db"] else "false",
            "MANIFEST_REQUIRES_PRE_DEPLOY_BACKUP": "true" if compat["requires_pre_deploy_backup"] else "false",
        }
        for key, value in pairs.items():
            print(f"{key}={shlex.quote(value)}")
    else:
        print(
            f"[MANIFEST VALID] kind={manifest['manifest_kind']} release_id={manifest['release_id']} "
            f"commit={manifest['git']['commit_sha'][:12]} "
            f"api={manifest['images']['api_server']['digest'][:19]}... "
            f"streamer={manifest['images']['k8s_streamer']['digest'][:19]}... "
            f"web={manifest['images']['web']['digest'][:19]}..."
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
