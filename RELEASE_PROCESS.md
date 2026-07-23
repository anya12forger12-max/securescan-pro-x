# Release Process — SecureScan Pro X

## Versioning

SecureScan Pro X follows [Semantic Versioning](https://semver.org/):

```
MAJOR.MINOR.PATCH
```

| Increment | When | Example |
|---|---|---|
| **MAJOR** | Breaking changes | 1.0.0 → 2.0.0 |
| **MINOR** | New features (backward compatible) | 1.0.0 → 1.1.0 |
| **PATCH** | Bug fixes (backward compatible) | 1.0.0 → 1.0.1 |

### Pre-release Versions

```
MAJOR.MINOR.PATCH-alpha.N
MAJOR.MINOR.PATCH-beta.N
MAJOR.MINOR.PATCH-rc.N
```

## Release Checklist

### Pre-Release

- [ ] All CI checks passing
- [ ] All tests passing
- [ ] Code coverage meets threshold
- [ ] Security scan passes (Bandit, Safety)
- [ ] Accessibility audit passes
- [ ] Performance benchmarks meet targets
- [ ] Documentation updated
- [ ] CHANGELOG updated
- [ ] Version bumped
- [ ] Dependencies updated

### Release Steps

1. **Create Release Branch**
   ```bash
   git checkout -b release/vX.Y.Z main
   ```

2. **Update Version**
   ```bash
   # Backend
   # Update version in pyproject.toml

   # Frontend
   cd frontend && pnpm version X.Y.Z
   ```

3. **Update CHANGELOG**
   ```markdown
   ## [X.Y.Z] — YYYY-MM-DD
   
   ### Added
   - ...
   
   ### Changed
   - ...
   
   ### Fixed
   - ...
   ```

4. **Run Final Checks**
   ```bash
   ./scripts/release/validate.sh
   ```

5. **Create Tag**
   ```bash
   git tag -s vX.Y.Z -m "Release vX.Y.Z"
   ```

6. **Push**
   ```bash
   git push origin main --tags
   ```

7. **Create GitHub Release**
   ```bash
   gh release create vX.Y.Z \
     --title "vX.Y.Z" \
     --notes "Release notes"
   ```

8. **Build and Upload Artifacts**
   ```bash
   ./scripts/release/build.sh
   ./scripts/release/upload.sh
   ```

### Post-Release

- [ ] Verify release artifacts
- [ ] Test installation on all platforms
- [ ] Update documentation site
- [ ] Announce release
- [ ] Close release milestone
- [ ] Create next milestone

## Artifact Types

| Artifact | Platform | Description |
|---|---|---|
| `.msi` | Windows | Windows installer |
| `.exe` | Windows | Portable executable |
| `.dmg` | macOS | macOS disk image |
| `.AppImage` | Linux | Universal Linux app |
| `.deb` | Linux | Debian/Ubuntu package |
| `.rpm` | Linux | RHEL/Fedora package |
| Docker | All | Container image |

## Hotfix Process

1. Create hotfix branch from release tag
2. Apply fix
3. Bump patch version
4. Run full test suite
5. Get security review
6. Merge and tag
7. Update release notes

## Signed Releases

All releases are signed with GPG:

```bash
# Verify signature
gpg --verify securescan-pro-x-vX.Y.Z.tar.gz.sig \
            securescan-pro-x-vX.Y.Z.tar.gz
```

Public key available at: securescan.dev/release-key.asc

## Rollback

If a critical issue is found post-release:

1. Assess severity
2. Notify users via security advisory if security-related
3. Prepare hotfix or rollback
4. Communicate timeline

## Release Schedule

- **Major releases**: Every 6 months
- **Minor releases**: Every 2 months
- **Patch releases**: As needed (within 48 hours for critical fixes)
- **Security patches**: Within 24 hours for critical vulnerabilities
