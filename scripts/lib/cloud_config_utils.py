"""Shared AWS configuration constants, session model, recovery bucket validation, and log redaction."""

from __future__ import annotations

import json
import os
import pathlib
import re
import shutil
import stat
import subprocess
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

DEFAULT_ACCOUNT_ID = "982534376726"
DEFAULT_REGION = "ap-south-1"
CANONICAL_RECOVERY_BUCKET = f"envscale-recovery-{DEFAULT_ACCOUNT_ID}-{DEFAULT_REGION}"
_RECOVERY_BUCKET_RE = re.compile(r"^envscale-recovery-[0-9]{12}-[a-z0-9-]+$")
_FORBIDDEN_BUCKET_PREFIXES = ("envscale-cloud-vault-", "envscale-tfstate-")

SENSITIVE_KEYS = (
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
    "DUCKDNS_TOKEN",
    "POSTGRES_PASSWORD",
    "REDIS_PASSWORD",
    "JWT_ACCESS_SECRET",
    "JWT_REFRESH_SECRET",
    "BETTER_AUTH_SECRET",
    "KUBECONFIG_ENCRYPTION_KEY",
    "GOOGLE_CLIENT_SECRET",
    "GITHUB_CLIENT_SECRET",
)

_SENSITIVE_KV_RE = re.compile(
    r"(?i)\b(" + "|".join(SENSITIVE_KEYS) + r")(\s*[=:]\s*)(?:\"[^\"]*\"|'[^']*'|[^\s,;]+)"
)
_SENSITIVE_JSON_RE = re.compile(
    r'("(?:SecretAccessKey|SessionToken|AccessKeyId|Base32StringSeed)"\s*:\s*")[^"]*(")'
)
_AWS_KEY_ID_RE = re.compile(r"\b(?:ASIA|AKIA)[A-Z0-9]{16}\b")
_DUCKDNS_QUERY_TOKEN_RE = re.compile(r"([?&]token=)[^&\s\"']+")


@dataclass
class AwsSessionContext:
    """In-memory temporary AWS STS or profile session (never serialized with secrets)."""

    account_id: str
    region: str
    caller_arn: str
    role_arn: str
    expires_at_utc: str = ""
    profile: Optional[str] = None
    _creds: Optional[Dict[str, str]] = field(default=None, repr=False)

    def build_env(self, base_env: Optional[Dict[str, str]] = None) -> Dict[str, str]:
        env = dict(base_env if base_env is not None else os.environ)
        env["AWS_REGION"] = self.region or DEFAULT_REGION
        env["AWS_DEFAULT_REGION"] = self.region or DEFAULT_REGION
        if self._creds:
            env["AWS_ACCESS_KEY_ID"] = self._creds["AccessKeyId"]
            env["AWS_SECRET_ACCESS_KEY"] = self._creds["SecretAccessKey"]
            env["AWS_SESSION_TOKEN"] = self._creds["SessionToken"]
            env.pop("AWS_PROFILE", None)
            env.pop("AWS_DEFAULT_PROFILE", None)
        elif self.profile:
            env["AWS_PROFILE"] = self.profile
            for k in ("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN"):
                env.pop(k, None)
        return env

    def is_expired(self, margin_seconds: int = 120) -> bool:
        if not self.expires_at_utc:
            return True if self._creds else False
        raw = self.expires_at_utc.replace("Z", "+00:00")
        try:
            exp_dt = datetime.fromisoformat(raw)
        except ValueError:
            return True
        if exp_dt.tzinfo is None:
            exp_dt = exp_dt.replace(tzinfo=timezone.utc)
        return datetime.now(timezone.utc) + timedelta(seconds=margin_seconds) >= exp_dt

    def to_public_dict(self) -> Dict[str, Any]:
        return {
            "account_id": self.account_id,
            "region": self.region,
            "caller_arn": self.caller_arn,
            "role_arn": self.role_arn,
            "expires_at_utc": self.expires_at_utc,
            "profile": self.profile,
            "expired": self.is_expired(),
        }


def redact_sensitive_text(text: str) -> str:
    """Scrub AWS credentials, STS tokens, and application secrets from log or UI text."""
    if not text:
        return text
    cleaned = _AWS_KEY_ID_RE.sub("[REDACTED_AWS_KEY_ID]", text)
    cleaned = _SENSITIVE_JSON_RE.sub(r"\1[REDACTED]\2", cleaned)
    cleaned = _SENSITIVE_KV_RE.sub(r"\1\2[REDACTED]", cleaned)
    cleaned = _DUCKDNS_QUERY_TOKEN_RE.sub(r"\1[REDACTED]", cleaned)
    return cleaned


def resolve_recovery_bucket(
    *,
    account_id: str = DEFAULT_ACCOUNT_ID,
    region: str = DEFAULT_REGION,
    configured_bucket: Optional[str] = None,
) -> str:
    """Resolve and strictly validate the canonical EnvScale recovery bucket name."""
    acct = (account_id or "").strip()
    reg = (region or "").strip()
    if not re.fullmatch(r"[0-9]{12}", acct):
        raise ValueError(f"Invalid AWS account ID '{acct}' when resolving recovery bucket.")
    if not re.fullmatch(r"[a-z]{2}-[a-z]+-[0-9]+", reg):
        raise ValueError(f"Invalid AWS region '{reg}' when resolving recovery bucket.")

    expected = f"envscale-recovery-{acct}-{reg}"
    raw_cfg = (configured_bucket if configured_bucket is not None else os.environ.get("RECOVERY_BUCKET", "")).strip()
    if not raw_cfg:
        return expected

    for bad_prefix in _FORBIDDEN_BUCKET_PREFIXES:
        if raw_cfg.startswith(bad_prefix):
            raise ValueError(
                f"Forbidden recovery bucket '{raw_cfg}' (prefix '{bad_prefix}' is prohibited; expected '{expected}')."
            )
    if not _RECOVERY_BUCKET_RE.fullmatch(raw_cfg) or raw_cfg != expected:
        raise ValueError(
            f"Invalid RECOVERY_BUCKET '{raw_cfg}'; must match canonical recovery bucket '{expected}'."
        )
    return raw_cfg


def parse_caller_arn(arn: str) -> Tuple[str, Optional[str]]:
    if ":user/" in arn:
        return "iam-user", arn.rsplit("/", 1)[-1]
    if ":assumed-role/" in arn:
        return "assumed-role", None
    if arn.endswith(":root"):
        return "root", None
    return "unknown", None


def is_totp_mfa_serial(serial: str) -> bool:
    """Return True if an IAM MFA serial supports 6-digit TOTP codes for STS AssumeRole."""
    s = serial.strip()
    if not s or ":u2f/" in s or ":sms-mfa/" in s:
        return False
    return ":mfa/" in s or not s.startswith("arn:")


def select_totp_mfa_serials(serials: List[str]) -> List[str]:
    """Filter MFA serials to TOTP-capable devices, prioritizing ':mfa/' virtual devices."""
    totp = [s.strip() for s in serials if is_totp_mfa_serial(s)]
    return sorted(totp, key=lambda s: (0 if ":mfa/" in s else 1, s))


def unauthenticated_identity(err: str) -> Dict[str, Any]:
    return {
        "authenticated": False,
        "error": err,
        "bootstrap_deny_active": False,
        "mfa_enrolled": False,
        "mfa_serials": [],
        "all_mfa_serials": [],
        "unsupported_mfa_serials": [],
        "roles": {},
        "instance_profile": {"exists": False, "name": "envscale-ec2-runtime-profile"},
    }


def read_ram_session_payload(
    session_path: pathlib.Path,
    *,
    require_ram_dir: bool = True,
) -> Optional[Dict[str, Any]]:
    """Validate file-system security invariants (RAM dir, non-symlink, owner UID, 0600/0400) and load JSON."""
    path = pathlib.Path(session_path)
    try:
        st = path.lstat()
    except OSError:
        return None
    if stat.S_ISLNK(st.st_mode) or not stat.S_ISREG(st.st_mode):
        return None
    if st.st_uid != os.getuid() or stat.S_IMODE(st.st_mode) not in (0o600, 0o400):
        return None
    try:
        resolved = path.resolve(strict=True)
        if require_ram_dir and not resolved.as_posix().startswith("/dev/shm/"):
            return None
        raw = json.loads(resolved.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return None
    return raw if isinstance(raw, dict) else None


def build_profile_env(
    profile: Optional[str] = None,
    region: str = DEFAULT_REGION,
    base_env: Optional[Dict[str, str]] = None,
) -> Optional[Dict[str, str]]:
    """Return a clean subprocess env dict pinned to an AWS CLI profile, or None for default."""
    if not profile:
        return None
    env = dict(base_env if base_env is not None else os.environ)
    env["AWS_PROFILE"] = profile
    env["AWS_REGION"] = region
    env["AWS_DEFAULT_REGION"] = region
    for k in ("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN"):
        env.pop(k, None)
    return env


def list_aws_profiles() -> List[str]:
    """Return configured AWS CLI profile names without mutating configuration."""
    if not shutil.which("aws"):
        return []
    res = subprocess.run(["aws", "configure", "list-profiles"], capture_output=True, text=True)
    if res.returncode != 0:
        return []
    return [line.strip() for line in res.stdout.splitlines() if line.strip()]
