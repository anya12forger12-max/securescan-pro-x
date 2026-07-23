# Security Guide

Security principles, practices, and checklists for the Malware Hash Checker Pro codebase.

## Table of Contents

- [Security-First Principles](#security-first-principles)
- [Path Traversal Prevention](#path-traversal-prevention)
- [Permission Checks](#permission-checks)
- [No File Execution Policy](#no-file-execution-policy)
- [Data Redaction](#data-redaction)
- [Dependency Auditing](#dependency-auditing)
- [Vulnerability Reporting](#vulnerability-reporting)
- [Secure Coding Checklist](#secure-coding-checklist)

---

## Security-First Principles

MHCP is a cybersecurity tool. Security is not an afterthought — it is a core design principle.

### Core Tenets

1. **Read-only by default.** MHCP never executes, modifies, or deletes files. It only reads file contents for hash computation.

2. **No file execution.** The application does not open, run, or otherwise execute any scanned file. Files are read in binary mode for hash computation only.

3. **Path safety.** All file paths are validated and sanitized before use. Path traversal, null bytes, and other injection vectors are blocked.

4. **Least privilege.** The application requests only the minimum permissions necessary. It does not require administrator or root access for normal operation.

5. **Data minimization.** Only the data necessary for hash computation and threat lookup is collected. Personal data is never stored or transmitted.

6. **Defense in depth.** Multiple layers of security checks are applied. No single failure point can compromise the system.

### Threat Model

MHCP is designed to defend against:

- **Path traversal attacks** — Attempting to access files outside allowed directories.
- **Symlink attacks** — Using symbolic links to bypass path restrictions.
- **Null byte injection** — Injecting null bytes into file paths.
- **Malicious file content** — Files containing exploit code (MHCP never executes them).
- **Dependency vulnerabilities** — Vulnerabilities in third-party libraries.
- **Data leakage** — Accidental exposure of file contents or scan results.

### Out of Scope

- **Network attacks** — MHCP does not expose network services (except optional API lookup).
- **Physical access** — Physical device compromise is out of scope.
- **Social engineering** — User manipulation is out of scope.
- **Denial of service** — Resource exhaustion attacks are out of scope.

---

## Path Traversal Prevention

### Path Safety Module

The `mhcp-security` package provides path safety utilities:

```python
from mhcp_security.lib.src.path_safety import is_safe_path, sanitize_path, PathSafetyResult
```

### is_safe_path

Checks whether a path is safe to use:

```python
from mhcp_security.lib.src.path_safety import is_safe_path

# Safe paths
assert is_safe_path("/tmp/data/file.txt") is True

# Unsafe — path traversal
assert is_safe_path("/tmp/data/../../etc/passwd") is False

# Unsafe — null byte
assert is_safe_path("/tmp/data/file.txt\x00.txt") is False
```

### sanitize_path

Analyzes a path and returns a `PathSafetyResult` with issues found:

```python
from mhcp_security.lib.src.path_safety import sanitize_path

result = sanitize_path("/tmp/test.txt")
assert result.is_safe is True
assert result.issues == []

result = sanitize_path("file\x00hidden")
assert result.is_safe is False
assert any("null byte" in i for i in result.issues)
assert "\x00" not in result.sanitised

result = sanitize_path("dir/../../../escape")
assert result.is_safe is False
assert any("traversal" in i.lower() for i in result.issues)
```

### PathSafetyResult

| Field | Type | Description |
|-------|------|-------------|
| `is_safe` | `bool` | Whether the path passes all safety checks |
| `sanitised` | `str` | The path with dangerous characters removed |
| `issues` | `list[str]` | List of identified safety issues |

### Detected Issues

| Issue | Description |
|-------|-------------|
| Null bytes | `\x00` characters in the path |
| Path traversal | `../` sequences that could escape the base directory |
| Symbolic links | Symlinks that could point outside allowed directories |
| Control characters | Non-printable characters (except tab and newline) |

### Integration with Scanner

The scanner validates all file paths before processing:

```python
from mhcp_security.lib.src.path_safety import is_safe_path

def scan_file(file_path: Path) -> dict[str, Any]:
    if not is_safe_path(str(file_path)):
        raise SecurityError(
            message=f"Unsafe path: {file_path}",
            error_code="PATH_UNSAFE",
            severity=Severity.CRITICAL,
            recovery_suggestion="Use a path without traversal sequences.",
        )
    # Proceed with scan...
```

---

## Permission Checks

### File Permissions Module

The `mhcp-security` package provides file permission utilities:

```python
from mhcp_security.lib.src.file_permissions import (
    check_read_permission,
    get_file_permissions,
    ensure_safe_permissions,
    FilePermissionInfo,
)
```

### check_read_permission

Checks whether a file is readable:

```python
from mhcp_security.lib.src.file_permissions import check_read_permission

assert check_read_permission(Path("/tmp/readable.txt")) is True
assert check_read_permission(Path("/tmp/nonexistent.txt")) is False
```

### get_file_permissions

Returns detailed permission information:

```python
from mhcp_security.lib.src.file_permissions import get_file_permissions

info = get_file_permissions(Path("/tmp/file.txt"))
assert info.owner_read is True
assert info.owner_write is True
assert info.is_world_writable is False
```

### FilePermissionInfo

| Field | Type | Description |
|-------|------|-------------|
| `owner_read` | `bool` | Owner has read permission |
| `owner_write` | `bool` | Owner has write permission |
| `is_world_writable` | `bool` | File is writable by all users |
| `is_world_executable` | `bool` | File is executable by all users |

### ensure_safe_permissions

Checks for dangerous permission configurations:

```python
from mhcp_security.lib.src.file_permissions import ensure_safe_permissions

issues = ensure_safe_permissions(safe_file)
assert issues == []

issues = ensure_safe_permissions(world_writable_file)
assert len(issues) == 1
assert "world-writable" in issues[0]
```

### Permission Check Integration

```python
from mhcp_security.lib.src.file_permissions import (
    check_read_permission,
    ensure_safe_permissions,
)
from mhcp_core.errors import SecurityError, Severity

def safe_scan(file_path: Path) -> dict[str, Any]:
    # Check read permission
    if not check_read_permission(file_path):
        raise SecurityError(
            message=f"Cannot read: {file_path}",
            error_code="PERMISSION_DENIED",
            severity=Severity.ERROR,
            recovery_suggestion="Check file permissions.",
        )

    # Check for dangerous permissions
    issues = ensure_safe_permissions(file_path)
    if issues:
        logger.warning(
            "Permission issues for %s: %s",
            file_path,
            ", ".join(issues),
        )

    # Proceed with scan...
```

---

## No File Execution Policy

### Design Principle

MHCP is a **read-only** tool. It never:

- Executes files (`.exe`, `.bat`, `.sh`, `.ps1`, etc.)
- Opens files with the system default application
- Loads dynamic libraries (`.dll`, `.so`, `.dylib`)
- Spawns subprocesses for file processing
- Writes to scanned files

### Implementation

File access is limited to binary read operations:

```python
def compute_file(self, file_path: Path) -> str:
    """Compute hash by reading the file in binary mode."""
    hasher = hashlib.new(self._algorithm.value)
    with open(file_path, "rb") as fh:  # Binary read only
        while True:
            chunk = fh.read(self.chunk_size)
            if not chunk:
                break
            hasher.update(chunk)
    return hasher.hexdigest()
```

### No Dynamic Code Execution

MHCP does not use:

- `exec()` or `eval()`
- `importlib` for loading untrusted modules
- `__import__()` with user-controlled input
- `compile()` on untrusted code
- Subprocess execution of scanned files

### Security Scanning

The project uses `bandit` for static security analysis:

```bash
bandit -r packages/ -x tests/
```

Bandit is configured in `pyproject.toml`:

```toml
[tool.bandit]
exclude_dirs = ["tests"]
skips = ["B101"]  # Allow assert in tests
```

---

## Data Redaction

### Logging Redaction

The `RedactionFilter` automatically redacts sensitive information from log messages:

```python
from mhcp_logging.redaction import RedactionFilter

filter = RedactionFilter()

# Email addresses
result = filter.redact("User alice@example.com logged in")
assert "alice@example.com" not in result

# IPv4 addresses
result = filter.redact("Server at 192.168.1.1 is down")
assert "192.168.1.1" not in result

# SHA-256 hashes (64-char hex strings)
sha256 = "a" * 64
result = filter.redact(f"Hash is {sha256}")
assert sha256 not in result

# MD5 hashes (32-char hex strings)
md5 = "b" * 32
result = filter.redact(f"MD5: {md5}")
assert md5 not in result
```

### Custom Redaction Patterns

```python
filter = RedactionFilter(patterns=[r"SECRET-\d+"])
result = filter.redact("Code SECRET-12345 is invalid")
assert "SECRET-12345" not in result
```

### Custom Replacement Token

```python
filter = RedactionFilter(replacement="***")
result = filter.redact("mail me at bob@test.org")
assert "***" in result
```

### Runtime Pattern Addition

```python
filter = RedactionFilter(use_builtin_patterns=False)
filter.add_pattern(r"API_KEY-[a-zA-Z0-9]+")
result = filter.redact("Key API_KEY-abc123 exposed")
assert "API_KEY-abc123" not in result
```

### Configuration

Redaction is configured via the `ConfigurationManager`:

```toml
[logging]
redact_sensitive = true
```

---

## Dependency Auditing

### Automated Scanning

Dependencies are audited in CI with multiple tools:

```bash
# pip-audit for known vulnerabilities
pip-audit

# safety for additional checks
safety check

# GitHub dependency review
gh audit
```

### Configuration

```toml
[tool.pip-audit]
desc = true
fix = false
```

### Updating Dependencies

```bash
# Check for outdated packages
pip list --outdated

# Update a specific package
pip install --upgrade package-name

# Update all packages
pip list --outdated --format=freeze | grep -v '^\-e' | cut -d = -f 1 | xargs -n1 pip install -U
```

### Security Patches

Security patches are applied within **72 hours** of disclosure:

1. Monitor GitHub Security Advisories for dependencies.
2. Run `pip-audit` daily in CI.
3. Apply patches immediately for critical vulnerabilities.
4. Run full test suite after patching.
5. Document the patch in CHANGELOG.md.

### Supply Chain Security

- Dependencies are pinned to specific versions.
- Lock files are committed to the repository.
- Signed commits are required for merges.
- CI pipelines verify dependency integrity.

---

## Vulnerability Reporting

### How to Report

**Do NOT report security vulnerabilities through public GitHub issues.**

Send an email to **security@malwarehashchecker.dev** with:

1. A description of the vulnerability
2. Steps to reproduce
3. Potential impact
4. Suggested fix (if any)

### Response Timeline

| Step | Timeline |
|------|----------|
| Acknowledgment | 48 hours |
| Initial assessment | 5 business days |
| Fix development | Depends on severity |
| Public disclosure | After fix is released |

### Scope

**In scope:**
- Code execution vulnerabilities
- Path traversal vulnerabilities
- Cryptographic weaknesses
- Dependency vulnerabilities
- Authentication/authorization bypass
- Data exposure risks
- Privilege escalation

**Out of scope:**
- Social engineering attacks
- Physical access to devices
- Denial of service attacks
- Issues in third-party dependencies (report to upstream)

### Security Advisories

Published via:
1. GitHub Security Advisories
2. SECURITY.md
3. Release notes for patched versions

---

## Secure Coding Checklist

### Before Every Commit

- [ ] No hardcoded secrets, keys, or credentials
- [ ] All external input is validated
- [ ] File paths are sanitized before use
- [ ] No `exec()` or `eval()` with untrusted input
- [ ] No string formatting in SQL queries (use parameterized queries)
- [ ] Error messages do not leak sensitive information
- [ ] Log messages are redacted for PII
- [ ] Dependencies are pinned to specific versions

### Before Every Release

- [ ] Run `bandit` security scan
- [ ] Run `pip-audit` dependency audit
- [ ] Verify all tests pass
- [ ] Review CHANGELOG.md for security-related changes
- [ ] Sign the release artifact
- [ ] Verify checksums

### Code Review Security Focus

All code changes require review. Security-sensitive changes require review from a maintainer with security expertise. Reviewers should check for:

- Input validation
- Path traversal prevention
- SQL injection prevention
- Information leakage
- Error handling
- Dependency changes
- Cryptographic usage

### Cryptographic Guidelines

- Use only well-established libraries (`hashlib`, `cryptography`).
- No custom cryptographic implementations.
- MD5 and SHA-1 are supported for compatibility only; SHA-256+ is recommended.
- Key management follows platform best practices.

### Compliance

The project follows:
- OWASP Secure Coding Practices
- CWE/SANS Top 25
- NIST Cybersecurity Framework principles

---

## Resources

- [SECURITY.md](../../../SECURITY.md) — Vulnerability reporting process
- [OWASP Secure Coding Practices](https://owasp.org/www-project-secure-coding-practices-quick-reference-guide/)
- [CWE/SANS Top 25](https://cwe.mitre.org/top25/)
- [Python Security](https://python-security.readthedocs.io/)
- [bandit Documentation](https://bandit.readthedocs.io/)
