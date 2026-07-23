# Non-Goals — SecureScan Pro X

This document explicitly states what SecureScan Pro X will **not** do. Defining non-goals prevents scope creep and maintains focus.

## Security Non-Goals

### Offensive Capabilities

- **Exploit execution** — We do not execute exploits against targets
- **Payload generation** — We do not generate attack payloads
- **Persistence mechanisms** — We do not create or maintain backdoors
- **Credential theft** — We do not harvest credentials
- **Malware functionality** — We do not create, distribute, or use malware
- **Lateral movement** — We do not move between systems
- **Privilege escalation** — We do not attempt to escalate privileges
- **Post-exploitation** — We do not perform post-exploitation activities

### Active Attack

- **Denial of service** — We do not perform DoS attacks
- **Traffic interception** — We do not intercept network traffic (unless authorized)
- **Active exploitation** — We do not actively exploit vulnerabilities
- **Social engineering** — We do not perform social engineering attacks

## Technical Non-Goals

### Cloud/SaaS

- **Cloud-hosted version** — We are not building a SaaS product
- **Multi-tenant architecture** — We are not designing for multiple organizations
- **Cloud storage** — We do not store data in the cloud
- **Real-time collaboration** — We are not building a collaborative platform (yet)

### Mobile

- **Mobile app** — We are not building iOS or Android apps
- **Mobile device assessment** — We do not assess mobile devices directly

### Enterprise Features (Phase 1)

- **Multi-user concurrent access** — Not in initial release
- **LDAP/AD integration** — Not in initial release
- **SSO integration** — Not in initial release
- **Enterprise deployment tools** — Not in initial release

## Product Non-Goals

### Compliance Automation

- **Automated compliance remediation** — We identify issues, not fix them
- **Compliance certification** — We are not a certification body
- **Continuous compliance monitoring** — Not a primary feature (future consideration)

### Penetration Testing

- **Penetration testing automation** — We do not automate pen tests
- **Red team operations** — We do not support red teaming
- **Attack simulation** — We do not simulate attacks

### Incident Response

- **Incident response management** — Not our primary focus
- **Forensic analysis** — We do not perform forensics
- **Malware analysis** — We do not analyze malware

## Scope Boundaries

### What We Are

- A **defensive** security assessment platform
- A **privacy-first** desktop application
- A **plugin-driven** extensible tool
- A **local-first** data management system

### What We Are Not

- An **offensive** security tool
- A **cloud-based** service
- A **real-time** monitoring system
- A **SIEM** or log management system
- A **vulnerability scanner** (we orchestrate checks, not perform scans)
- An **endpoint detection and response** (EDR) tool

## Future Considerations

These are explicitly **not** in scope now but may be reconsidered:

- Team collaboration features (Phase 3+)
- PostgreSQL support for multi-user (Phase 2+)
- API for third-party integration (Phase 3+)
- Cloud sync (opt-in only, Phase 4+)
- Remote assessment orchestration (opt-in only, Phase 5+)
- Custom check authoring UI (Phase 3+)

## Rationale

These non-goals exist because:

1. **Focus** — We cannot build everything; focus enables quality
2. **Security** — Offensive capabilities create liability
3. **Privacy** — Cloud features compromise our privacy guarantee
4. **Simplicity** — Desktop-first keeps the architecture clean
5. **Legal** — Offensive tools have different legal requirements
6. **Trust** — Clear boundaries build user trust
