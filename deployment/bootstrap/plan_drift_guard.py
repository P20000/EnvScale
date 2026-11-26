"""Guard allowing only harmless AWS Provider v5 shadow attribute drift in update plans."""

from __future__ import annotations

from typing import Any

_S3_BUCKET_SHADOW_KEYS = frozenset({
    "policy",
    "versioning",
    "lifecycle_rule",
    "server_side_encryption_configuration",
    "grant",
    "tags",
    "tags_all",
})
_IAM_ROLE_SHADOW_KEYS = frozenset({"inline_policy", "managed_policy_arns", "tags", "tags_all"})


def _is_benign_sse_bucket_key_drift(before: dict[str, Any], after: dict[str, Any], diff_keys: set[str]) -> bool:
    if diff_keys != {"rule"}:
        return False
    b_rules, a_rules = before.get("rule"), after.get("rule")
    if not isinstance(b_rules, list) or not isinstance(a_rules, list) or not b_rules or len(b_rules) != len(a_rules):
        return False
    for rb, ra in zip(b_rules, a_rules):
        if not isinstance(rb, dict) or not isinstance(ra, dict):
            return False
        for k in set(rb) | set(ra):
            if k != "bucket_key_enabled" and rb.get(k) != ra.get(k):
                return False
        if not (rb.get("bucket_key_enabled") is None and ra.get("bucket_key_enabled") is False):
            return False
    return True


def _is_benign_drift_entry(
    entry: Any,
    *,
    effective_mode: str,
    approved_managed: dict[str, str],
    seen_managed: dict[str, dict[str, Any]],
) -> tuple[bool, str]:
    if not isinstance(entry, dict):
        return False, f"non-dict:{type(entry).__name__}"
    addr = str(entry.get("address") or "<missing>")
    rtype = entry.get("type")
    ch = entry.get("change")
    acts = list(ch.get("actions") or []) if isinstance(ch, dict) else []
    before = ch.get("before") if isinstance(ch, dict) else None
    after = ch.get("after") if isinstance(ch, dict) else None
    diff_keys = (
        {k for k in set(before) | set(after) if before.get(k) != after.get(k)}
        if isinstance(before, dict) and isinstance(after, dict)
        else set()
    )
    label = f"{addr}(actions={acts},keys={sorted(diff_keys)})"

    if effective_mode != "update" or entry.get("mode") != "managed":
        return False, label
    if addr not in approved_managed or rtype != approved_managed[addr]:
        return False, label
    rc = seen_managed.get(addr)
    if not rc or (rc.get("change") or {}).get("actions") != ["no-op"]:
        return False, label
    if acts != ["update"] or not diff_keys:
        return False, label

    if addr == "aws_s3_bucket.recovery" and diff_keys <= _S3_BUCKET_SHADOW_KEYS:
        return True, label
    if rtype == "aws_iam_role" and diff_keys <= _IAM_ROLE_SHADOW_KEYS:
        return True, label
    if addr == "aws_s3_bucket_server_side_encryption_configuration.recovery":
        assert isinstance(before, dict) and isinstance(after, dict)
        if _is_benign_sse_bucket_key_drift(before, after, diff_keys):
            return True, label
    return False, label


def validate_resource_drift(
    drift_list: Any,
    *,
    effective_mode: str,
    approved_managed: dict[str, str],
    seen_managed: dict[str, dict[str, Any]],
) -> list[str]:
    """Validate resource_drift, failing closed on any entry outside strict update-only shadow refreshes."""
    if not isinstance(drift_list, list):
        return [
            f"Plan field 'resource_drift' has invalid type '{type(drift_list).__name__}' "
            f"(strictly requires empty list; found {drift_list!r})"
        ]
    if not drift_list:
        return []
    rejected = [
        desc
        for entry in drift_list
        for ok, desc in [_is_benign_drift_entry(
            entry, effective_mode=effective_mode, approved_managed=approved_managed, seen_managed=seen_managed
        )]
        if not ok
    ]
    if rejected:
        return [
            f"Plan contains unexpected resource_drift ({len(rejected)} item(s)); "
            f"secondary channels forbidden: {', '.join(rejected)}"
        ]
    return []

