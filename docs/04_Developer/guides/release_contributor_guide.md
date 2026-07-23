# Release and Contributor Guide

Processes for releasing new versions and contributing to Malware Hash Checker Pro.

## Table of Contents

- [Release Process Overview](#release-process-overview)
- [Versioning](#versioning)
- [Changelog Maintenance](#changelog-maintenance)
- [Release Branches](#release-branches)
- [Artifact Signing](#artifact-signing)
- [Post-Release Tasks](#post-release-tasks)
- [Contributor Workflow](#contributor-workflow)
- [Code Review Process](#code-review-process)

---

## Release Process Overview

### Release Lifecycle

```
main branch → release/vX.Y.Z branch → CI validation → tag → publish → post-release
```

### Steps

1. **Prepare** — Update version numbers, changelog, and documentation.
2. **Branch** — Create a release branch from `main`.
3. **Validate** — Run the full test suite and all CI checks.
4. **Sign** — Sign release artifacts with GPG keys.
5. **Tag** — Create a Git tag for the release.
6. **Publish** — Upload artifacts to PyPI and create a GitHub Release.
7. **Announce** — Update documentation and notify users.

### Release Checklist

- [ ] All tests pass on `main`
- [ ] Version bumped in `pyproject.toml` and all package configs
- [ ] CHANGELOG.md updated with all changes since last release
- [ ] Documentation updated for any API changes
- [ ] Security audit completed (`pip-audit`, `bandit`)
- [ ] Release branch created and validated
- [ ] Release artifacts signed with GPG
- [ ] Git tag created with annotated message
- [ ] GitHub Release created with release notes
- [ ] PyPI upload successful
- [ ] Post-release cleanup completed

---

## Versioning

MHCP follows [Semantic Versioning](https://semver.org/) (SemVer):

```
MAJOR.MINOR.PATCH[-PRERELEASE]
```

### Version Scheme

| Component | Increment When |
|-----------|---------------|
| MAJOR | Incompatible API changes |
| MINOR | New functionality, backward-compatible |
| PATCH | Backward-compatible bug fixes |
| PRERELEASE | Pre-release identifiers (alpha, beta, rc) |

### Current Version Format

The project is currently in pre-release:

```
0.1.0-alpha.1
```

### When to Bump

| Change Type | Version Bump | Example |
|------------|-------------|---------|
| New hash algorithm | MINOR | 0.1.0 → 0.2.0 |
| Bug fix in scanner | PATCH | 0.1.0 → 0.1.1 |
| Breaking API change in pipeline | MAJOR | 0.1.0 → 1.0.0 |
| New pre-release | PRERELEASE | 0.1.0-alpha.1 → 0.1.0-alpha.2 |
| Promote alpha to beta | PRERELEASE | 0.1.0-alpha.3 → 0.1.0-beta.1 |
| Promote beta to stable | Remove PRERELEASE | 0.1.0-beta.2 → 0.1.0 |

### Version Locations

Version must be updated in:

1. `pyproject.toml` (root project)
2. `packages/core/pyproject.toml`
3. `packages/hashing/pyproject.toml`
4. `packages/scanner/pyproject.toml`
5. `packages/database/pyproject.toml`
6. `packages/security/pyproject.toml`
7. `packages/logging/pyproject.toml`
8. `packages/config/pyproject.toml`
9. `packages/reports/pyproject.toml`
10. `packages/ui/pyproject.toml`

---

## Changelog Maintenance

### Format

Follow [Keep a Changelog](https://keepachangelog.com/) format:

```markdown
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- New hash algorithm support for BLAKE3
- Plugin system for custom threat intelligence providers

### Changed
- Improved streaming hash computation performance by 30%

### Deprecated
- `old_function()` is deprecated, use `new_function()` instead

### Removed
- Removed support for Python 3.12

### Fixed
- Fixed path traversal detection for encoded paths
- Fixed database connection leak on timeout

### Security
- Updated cryptography library to patch CVE-2024-XXXX

## [0.1.0-alpha.1] - 2024-01-15

### Added
- Initial pre-release
- SHA-256, MD5, SHA-1, SHA-384, SHA-512 hash computation
- File scanning pipeline
- SQLite database integration
- Structured logging with PII redaction
```

### Categories

| Category | Description |
|----------|-------------|
| `Added` | New features |
| `Changed` | Changes to existing functionality |
| `Deprecated` | Features that will be removed |
| `Removed` | Features that have been removed |
| `Fixed` | Bug fixes |
| `Security` | Vulnerability fixes |

### Entry Guidelines

- Each entry should describe a user-facing change.
- Link to the relevant issue or pull request.
- Group by package when multiple packages are affected.
- Include breaking changes prominently.

---

## Release Branches

### Branch Naming

```
release/v{MAJOR}.{MINOR}.{PATCH}[-{PRERELEASE}]
```

Examples:
- `release/v0.1.0-alpha.1`
- `release/v0.1.0`
- `release/v1.0.0`

### Branch Creation

```bash
# Create release branch from main
git checkout main
git pull origin main
git checkout -b release/v0.1.0

# Push the branch
git push origin release/v0.1.0
```

### Branch Lifecycle

1. **Created** from `main` when release preparation begins.
2. **CI validates** all tests pass on the branch.
3. **Hotfixes** are applied directly to the release branch and cherry-picked to `main`.
4. **Merged** back to `main` after the release is published.
5. **Deleted** after merge.

### Hotfix Process

```bash
# Create hotfix from release branch
git checkout release/v0.1.0
git checkout -b hotfix/v0.1.1

# Make fix, commit, push
git add .
git commit -m "fix(security): patch CVE-2024-XXXX"
git push origin hotfix/v0.1.1

# Merge to release branch
git checkout release/v0.1.0
git merge hotfix/v0.1.1

# Cherry-pick to main
git checkout main
git cherry-pick <commit-hash>
```

---

## Artifact Signing

### GPG Key Setup

```bash
# Generate a GPG key
gpg --full-generate-key

# List keys
gpg --list-secret-keys --keyid-format=long

# Export public key
gpg --armor --export <KEY_ID> > public-key.asc
```

### Signing Releases

```bash
# Sign the distribution
gpg --detach-sign --armor dist/malwarehashchecker_pro-0.1.0.tar.gz
gpg --detach-sign --armor dist/malwarehashchecker_pro-0.1.0-py3-none-any.whl
```

### Verifying Signatures

```bash
# Import the maintainer's public key
gpg --import public-key.asc

# Verify a signature
gpg --verify dist/malwarehashchecker_pro-0.1.0.tar.gz.asc dist/malwarehashchecker_pro-0.1.0.tar.gz
```

### Checksums

Generate and verify checksums:

```bash
# Generate
sha256sum dist/* > dist/SHA256SUMS

# Verify
sha256sum -c dist/SHA256SUMS
```

---

## Post-Release Tasks

### After Publishing

1. **Merge release branch** back to `main`:

```bash
git checkout main
git merge release/v0.1.0
git push origin main
```

2. **Delete the release branch**:

```bash
git branch -d release/v0.1.0
git push origin --delete release/v0.1.0
```

3. **Update `main` with new version**:

```bash
# Bump to next development version
# In pyproject.toml: version = "0.1.1-dev.0"
```

4. **Verify the release**:

```bash
pip install malwarehashchecker-pro==0.1.0
python -c "import mhcp_core; print(mhcp_core.__version__)"
```

5. **Announce the release**:
   - Update the project README if needed
   - Post release notes in the GitHub Release
   - Update any external documentation

### Monitoring

After release, monitor for:

- Issue reports from users
- Security vulnerability disclosures
- Dependency update needs
- Performance regressions

---

## Contributor Workflow

### Getting Started

1. **Read the [Contributing Guidelines](../../../CONTRIBUTING.md)**.
2. **Set up the [Development Environment](developer_guide.md#development-environment-setup)**.
3. **Pick an issue** (look for `good-first-issue` labels).
4. **Create a branch** and start coding.
5. **Write tests** and run the validation suite.
6. **Submit a Pull Request**.

### Branch Naming

| Prefix | Purpose | Example |
|--------|---------|---------|
| `feature/` | New features | `feature/sha512-computation` |
| `fix/` | Bug fixes | `fix/path-traversal-check` |
| `docs/` | Documentation | `docs/developer-guide` |
| `refactor/` | Code refactoring | `refactor/pipeline-stages` |
| `test/` | Test additions | `test/database-connection` |
| `security/` | Security fixes | `security/dependency-audit` |
| `accessibility/` | A11y improvements | `accessibility/keyboard-nav` |
| `chore/` | Maintenance | `chore/update-deps` |

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): description

[optional body]

[optional footer(s)]
```

**Types**:

| Type | Description |
|------|-------------|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation |
| `style` | Formatting (no code change) |
| `refactor` | Code refactoring |
| `test` | Adding tests |
| `chore` | Maintenance |
| `security` | Security fix |
| `accessibility` | Accessibility improvement |

**Scopes**: `core`, `hashing`, `scanner`, `database`, `security`, `logging`, `config`, `reports`, `ui`, `deps`

**Examples**:

```
feat(hashing): add SHA-512 hash computation

fix(scanner): prevent path traversal in file resolution

docs(api): update hash computation API documentation

security(deps): update cryptography to patch CVE-2024-XXXX

test(database): add connection pool integration tests

refactor(core): simplify Result type generics

chore: update pre-commit hooks
```

### Pull Request Requirements

- [ ] Linked to an issue
- [ ] Tests added/updated
- [ ] Documentation updated (if public API changes)
- [ ] Changelog entry added
- [ ] No breaking changes (or documented)
- [ ] Accessibility considerations addressed
- [ ] Security implications considered
- [ ] All CI checks pass

---

## Code Review Process

### Review Checklist

Reviewers should verify:

#### Functionality
- [ ] Code does what it claims to do
- [ ] Edge cases are handled
- [ ] Error handling is appropriate
- [ ] Tests cover the new code

#### Code Quality
- [ ] Follows the [Style Guide](style_guide.md)
- [ ] Type annotations are complete
- [ ] Docstrings follow Google style
- [ ] No code duplication

#### Security
- [ ] Input validation is present
- [ ] Path traversal prevention is in place
- [ ] No secrets or credentials are hardcoded
- [ ] Error messages do not leak sensitive information

#### Accessibility
- [ ] UI changes support keyboard navigation
- [ ] Color contrast meets WCAG AA
- [ ] Screen reader labels are present
- [ ] Reduced motion is respected

#### Testing
- [ ] Tests are well-organized
- [ ] Tests have descriptive names and docstrings
- [ ] Fixtures are appropriately scoped
- [ ] No flaky or brittle tests

### Review Etiquette

- Be constructive and specific in feedback.
- Suggest alternatives when requesting changes.
- Approve when the code meets all standards.
- Use "Request Changes" for blocking issues.
- Use "Comment" for non-blocking suggestions.

### Merge Strategy

- **Squash-merge** for feature branches (cleaner history).
- **Regular merge** for release branches (preserves branch history).
- **No fast-forward merges** (preserve context).

### After Merge

1. Delete the feature branch.
2. Verify CI passes on `main`.
3. Update the issue status.
