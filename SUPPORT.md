# Support — SecureScan Pro X

## Getting Help

### Documentation

- **User Guide**: [docs/guides/](docs/guides/)
- **API Reference**: [docs/api/](docs/api/)
- **Architecture**: [ARCHITECTURE.md](ARCHITECTURE.md)
- **FAQ**: [docs/guides/faq.md](docs/guides/faq.md)

### Community

- **GitHub Discussions**: [Discussions](https://github.com/securescan/securescan-pro-x/discussions)
  - Ask questions
  - Share ideas
  - Get help from community
  - Discuss best practices

- **GitHub Issues**: [Issues](https://github.com/securescan/securescan-pro-x/issues)
  - Report bugs
  - Request features
  - Track progress

### Professional Support

For enterprise support inquiries: support@securescan.dev

## Issue Templates

### Bug Report

```markdown
**Describe the bug**
A clear description of what the bug is.

**To reproduce**
Steps to reproduce the behavior:
1. Go to '...'
2. Click on '...'
3. See error

**Expected behavior**
What you expected to happen.

**Screenshots**
If applicable, add screenshots.

**Environment:**
- OS: [e.g., Windows 11, macOS 14, Ubuntu 22.04]
- Version: [e.g., 0.1.0]
- Python: [e.g., 3.13.0]
- Node.js: [e.g., 20.11.0]

**Additional context**
Any other context about the problem.
```

### Feature Request

```markdown
**Is your feature request related to a problem?**
A clear description of the problem.

**Describe the solution you'd like**
What you want to happen.

**Describe alternatives you've considered**
Other solutions you've thought about.

**Additional context**
Any other context or screenshots.
```

### Security Issue

**Do not** use public issues for security vulnerabilities. See [SECURITY.md](SECURITY.md).

## Troubleshooting

### Application Won't Start

1. Check Python version: `python --version` (requires 3.13+)
2. Check Node.js version: `node --version` (requires 20+)
3. Check Rust version: `rustc --version` (requires 1.75+)
4. Check logs: `~/.securescan/logs/`
5. Try verbose mode: `securescan --verbose`

### Database Issues

1. Check disk space
2. Check file permissions
3. Run integrity check: `securescan db verify`
4. Restore from backup: `securescan backup restore`

### Plugin Issues

1. Check plugin logs: `~/.securescan/logs/plugins/`
2. Verify permissions: `securescan plugin info <plugin-id>`
3. Reinstall plugin: `securescan plugin reinstall <plugin-id>`
4. Check compatibility: Plugin version vs app version

### Performance Issues

1. Check system resources: `securescan health`
2. Reduce concurrent assessments
3. Check for large datasets
4. Optimize database: `securescan db optimize`

## FAQ

### General

**Q: Is SecureScan Pro X free?**
A: Yes, SecureScan Pro X is open source under the MIT License.

**Q: Does it work offline?**
A: Yes, all features work offline by default.

**Q: Is my data sent anywhere?**
A: No, all data stays on your local machine. See [PRIVACY.md](PRIVACY.md).

**Q: Can I use it on multiple machines?**
A: Yes, you can install it on as many machines as you need.

### Security

**Q: Is it safe to use?**
A: Yes, SecureScan Pro X is designed with security first. See [SECURITY.md](SECURITY.md).

**Q: Can it be used for offensive testing?**
A: No, SecureScan Pro X is exclusively for defensive security. See [RESPONSIBLE_USE.md](RESPONSIBLE_USE.md).

**Q: How do I report a vulnerability?**
A: See [SECURITY.md](SECURITY.md) for the reporting process.

### Technical

**Q: What databases are supported?**
A: SQLite (default) with PostgreSQL support planned.

**Q: Can I write my own plugins?**
A: Yes, see [PLUGIN_GUIDE.md](PLUGIN_GUIDE.md) and [SDK_GUIDE.md](SDK_GUIDE.md).

**Q: How do I contribute?**
A: See [CONTRIBUTING.md](CONTRIBUTING.md).

## Response Times

| Channel | Response Time |
|---|---|
| GitHub Issues | 1-3 business days |
| GitHub Discussions | 1-5 business days |
| Security Reports | 24-48 hours |
| Email Support | 3-5 business days |

## Feedback

We value your feedback! Please share:

- What works well
- What could be improved
- What features you'd like to see
- Any pain points

Via GitHub Discussions or email: feedback@securescan.dev
