# SecureScan Pro X Documentation

Welcome to the SecureScan Pro X documentation.

## Quick Links

- [Getting Started](guides/getting-started.md) — Set up and run your first assessment
- [Architecture](architecture/overview.md) — System design and layer architecture
- [API Reference](api/overview.md) — REST API documentation
- [Plugin Guide](guides/plugins.md) — Build custom plugins
- [Contributing](contributing.md) — How to contribute

## Overview

SecureScan Pro X is an enterprise-grade, defensive security assessment platform. It enables organizations to assess systems they own or have explicit authorization to test.

### Key Features

- **Privacy-First**: All data stays local
- **Offline-First**: Full functionality without internet
- **Accessibility-First**: WCAG 2.2 AA compliant
- **Plugin-Driven**: Extensible via plugins
- **Cross-Platform**: Windows, Linux, macOS

## Architecture

SecureScan Pro X follows a strict layered architecture:

```
Presentation → Workspace → Assessment → Correlation
                   ↓            ↓            ↓
              Platform Services (shared)
                   ↓
              Infrastructure → Persistence
```

See [Architecture Overview](architecture/overview.md) for details.

## Getting Started

### Prerequisites

- Python 3.13+
- Node.js 20+
- Rust (for Tauri)
- pnpm

### Quick Start

```bash
# Clone and setup
git clone https://github.com/securescan/securescan-pro-x.git
cd securescan-pro-x
./scripts/dev/setup.sh

# Start development
./scripts/dev/start.sh
```

See [Getting Started Guide](guides/getting-started.md) for detailed instructions.
