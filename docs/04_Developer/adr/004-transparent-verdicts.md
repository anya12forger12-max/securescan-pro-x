# ADR-004: Transparent Verdict Model

## Status

Accepted

## Context

Users need to understand WHY a file was flagged, not just that it was. Security tools that provide opaque results erode trust — if a user cannot understand the basis for a verdict, they cannot evaluate its reliability or take appropriate action.

Conversely, claiming a file is "safe" based only on hash matching is misleading. A hash match against a known database only means the file was not previously catalogued as malicious — it does not mean the file is safe. Zero-day threats, polymorphic malware, and novel attack vectors will not appear in any database.

The verdict model must:
- Explain the reasoning behind every verdict
- Cite specific evidence (which database matches, which algorithms)
- Document limitations (what the engine cannot determine)
- Avoid overstating confidence or making safety guarantees
- Be serializable for reporting and export

## Decision

Every verdict includes: type, reason, evidence (database, algorithm, confidence), limitations, and recommended action. The engine NEVER states "this file is safe" — only reports what was found or not found.

### Verdict Types

| Type | Meaning |
|---|---|
| `MALICIOUS` | Hash matched one or more known malware records |
| `SUSPICIOUS` | Partial match, unusual characteristics, or low-confidence indicators |
| `UNKNOWN` | No database match found; absence of evidence is not evidence of absence |
| `ERROR` | Scan could not be completed due to technical issues |

### Verdict Structure

```python
{
    "type": "MALICIOUS",
    "reason": "SHA-256 hash matches known malware record",
    "evidence": {
        "algorithm": "SHA-256",
        "hash": "abc123...",
        "database_match": True,
        "confidence": 0.95,
    },
    "limitations": [
        "Only hash-based comparison was performed",
        "File behavior was not analyzed",
    ],
    "recommended_action": "Quarantine file and investigate origin",
}
```

## Consequences

### Positive

- Users understand the basis for each verdict and can evaluate its reliability
- Limitations are always documented, preventing overconfidence
- No false sense of security — "UNKNOWN" is a valid and honest verdict
- Evidence enables manual verification by security analysts
- Verdicts are serializable for reporting, logging, and export
- The model is extensible — new evidence types and verdict types can be added

### Negative

- Verdicts are longer and more complex than simple "safe/unsafe" flags
- Users unfamiliar with hash-based scanning may find the nuances confusing
- The verdict generator must be carefully implemented to avoid contradictory statements

### Neutral

- The transparent verdict model aligns with industry best practices for security tooling
- The model can be adapted for different audiences (technical vs. non-technical) by adjusting verbosity
