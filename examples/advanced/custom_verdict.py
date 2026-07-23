"""Advanced example — custom verdict generation.

Extends the built-in VerdictGenerator with two additional verdict types:
  SUSPICIOUS    — for hashes not in the DB but with risky metadata.
  POLICY_BLOCK  — for files blocked by an organisation policy.

Usage:
    python custom_verdict.py
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any

from mhcp_scanner.engine.verdict import (
    Verdict,
    VerdictEvidence,
    VerdictGenerator,
    VerdictType,
)


# ── Extended verdict types ─────────────────────────────────────────

class ExtendedVerdictType(Enum):
    """Verdict types beyond the built-in set."""

    KNOWN_MALICIOUS = "known_malicious"
    UNKNOWN = "unknown"
    CLEAN = "clean"
    SUSPICIOUS = "suspicious"
    POLICY_BLOCK = "policy_block"


# ── Custom verdict generator ──────────────────────────────────────

@dataclass
class PolicyRule:
    """A single organisation policy rule."""

    name: str
    blocked_extensions: list[str] = field(default_factory=list)
    blocked_patterns: list[str] = field(default_factory=list)
    max_file_size_bytes: int = 0


class ExtendedVerdictGenerator(VerdictGenerator):
    """VerdictGenerator subclass that adds heuristic and policy verdicts."""

    def __init__(self, *, policy_rules: list[PolicyRule] | None = None) -> None:
        super().__init__()
        self._policy_rules = policy_rules or []

    # -- Public API ---------------------------------------------------

    def generate(
        self,
        *,
        lookup_results: list[dict[str, Any]] | None = None,
        file_metadata: dict[str, Any] | None = None,
        database_error: str | None = None,
        scan_error: str | None = None,
        cancelled: bool = False,
    ) -> Verdict:
        """Generate a verdict, falling through to heuristics when unknown.

        The method first delegates to the parent ``generate`` for the
        standard ``KNOWN_MALICIOUS`` / ``UNKNOWN`` / ``CLEAN`` path.
        When the parent returns ``UNKNOWN`` and metadata is available,
        heuristic and policy checks are applied.
        """
        base_verdict = super().generate(
            lookup_results=lookup_results or [],
            database_error=database_error,
            scan_error=scan_error,
            cancelled=cancelled,
        )

        # If the base verdict is already definitive, return it.
        if base_verdict.verdict_type is not VerdictType.UNKNOWN:
            return base_verdict

        # No metadata to heuristic-check — stick with UNKNOWN.
        if file_metadata is None:
            return base_verdict

        # Policy check first (hard block).
        policy_verdict = self._check_policy(file_metadata)
        if policy_verdict is not None:
            return policy_verdict

        # Heuristic check.
        heuristic_verdict = self._check_heuristics(file_metadata, lookup_results or [])
        if heuristic_verdict is not None:
            return heuristic_verdict

        return base_verdict

    # -- Policy checks ------------------------------------------------

    def _check_policy(self, metadata: dict[str, Any]) -> Verdict | None:
        """Return a POLICY_BLOCK verdict if any rule matches."""
        file_path: str = metadata.get("file_path", "")
        file_size: int = metadata.get("file_size", 0)

        for rule in self._policy_rules:
            reasons: list[str] = []

            for ext in rule.blocked_extensions:
                if file_path.lower().endswith(ext.lower()):
                    reasons.append(f"extension '{ext}' is blocked by policy '{rule.name}'")

            if rule.max_file_size_bytes > 0 and file_size > rule.max_file_size_bytes:
                reasons.append(
                    f"file size {file_size} exceeds policy limit "
                    f"{rule.max_file_size_bytes} ({rule.name})"
                )

            if reasons:
                return Verdict(
                    verdict_type=VerdictType.UNKNOWN,
                    evidence=VerdictEvidence(matched_records=[]),
                    limitations=[],
                )._replace_type(ExtendedVerdictType.POLICY_BLOCK, reasons)

        return None

    # -- Heuristic checks ---------------------------------------------

    def _check_heuristics(
        self,
        metadata: dict[str, Any],
        lookup_results: list[dict[str, Any]],
    ) -> Verdict | None:
        """Return a SUSPICIOUS verdict when heuristics fire."""
        reasons: list[str] = []

        # Double extension heuristic (e.g. report.pdf.exe).
        file_path: str = metadata.get("file_path", "")
        name_parts = Path(file_path).name.split(".")
        if len(name_parts) > 2:
            executable_exts = {".exe", ".dll", ".scr", ".bat", ".cmd", ".ps1"}
            if name_parts[-1].lower() in executable_exts:
                reasons.append("double extension detected — possible disguise")

        # High entropy heuristic (encrypted or packed content).
        entropy = metadata.get("shannon_entropy", 0.0)
        if entropy > 7.5:
            reasons.append(f"high entropy ({entropy:.2f}) — possible packing or encryption")

        # Small file with executable extension.
        file_size = metadata.get("file_size", 0)
        if file_size < 1024 and file_path.lower().endswith((".exe", ".dll")):
            reasons.append(f"very small executable ({file_size} bytes) — suspicious")

        if reasons:
            return Verdict(
                verdict_type=VerdictType.UNKNOWN,
                evidence=VerdictEvidence(matched_records=[]),
                limitations=[],
            )._replace_type(ExtendedVerdictType.SUSPICIOUS, reasons)

        return None


# ── Helpers ────────────────────────────────────────────────────────

def _path(p: str) -> Any:
    """Lazy import of Path to keep the top of file clean."""
    from pathlib import Path
    return Path(p)


# Patch Verdict at import time so custom types can be attached.
_orig_init = Verdict.__init__


def _patched_init(
    self: Verdict,
    *,
    verdict_type: Any,
    evidence: Any = None,
    limitations: list[str] | None = None,
    **_kwargs: Any,
) -> None:
    _orig_init(self, verdict_type=verdict_type, evidence=evidence, limitations=limitations)


Verdict.__init__ = _patched_init  # type: ignore[assignment]


def _replace_type(self: Any, new_type: Any, reasons: list[str]) -> Any:
    """Return a new Verdict with the given type and reasons as limitations."""
    return Verdict(
        verdict_type=new_type,
        evidence=self.evidence,
        limitations=reasons,
    )


Verdict._replace_type = _replace_type  # type: ignore[attr-defined]


# ── Demo ───────────────────────────────────────────────────────────

def main() -> None:
    from pathlib import Path

    rules = [
        PolicyRule(
            name="no-executables",
            blocked_extensions=[".exe", ".dll", ".scr"],
            max_file_size_bytes=50 * 1024 * 1024,
        ),
    ]

    gen = ExtendedVerdictGenerator(policy_rules=rules)

    # --- Scenario 1: known malicious (base behaviour) ---
    verdict = gen.generate(
        lookup_results=[{"threat_type": "ransomware", "severity": "critical"}]
    )
    print("Scenario 1 — known malicious")
    print(f"  Type: {verdict.verdict_type}")
    print(f"  Malicious: {verdict.is_malicious}")
    print()

    # --- Scenario 2: unknown, no metadata → stays UNKNOWN ---
    verdict = gen.generate(lookup_results=[])
    print("Scenario 2 — unknown, no metadata")
    print(f"  Type: {verdict.verdict_type}")
    print(f"  Unknown: {verdict.is_unknown}")
    print()

    # --- Scenario 3: suspicious double extension ---
    verdict = gen.generate(
        lookup_results=[],
        file_metadata={
            "file_path": "/tmp/report.pdf.exe",
            "file_size": 4096,
            "shannon_entropy": 5.2,
        },
    )
    print("Scenario 3 — suspicious double extension")
    print(f"  Type: {verdict.verdict_type}")
    print(f"  Limitations: {verdict.limitations}")
    print()

    # --- Scenario 4: policy block ---
    verdict = gen.generate(
        lookup_results=[],
        file_metadata={
            "file_path": "/tmp/payload.exe",
            "file_size": 100 * 1024 * 1024,
        },
    )
    print("Scenario 4 — policy block (oversized executable)")
    print(f"  Type: {verdict.verdict_type}")
    print(f"  Limitations: {verdict.limitations}")
    print()

    # --- Scenario 5: high entropy → suspicious ---
    verdict = gen.generate(
        lookup_results=[],
        file_metadata={
            "file_path": "/tmp/data.bin",
            "file_size": 8192,
            "shannon_entropy": 7.9,
        },
    )
    print("Scenario 5 — high entropy (possible packing)")
    print(f"  Type: {verdict.verdict_type}")
    print(f"  Limitations: {verdict.limitations}")


if __name__ == "__main__":
    main()
