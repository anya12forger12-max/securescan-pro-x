# Getting Started

## Prerequisites

- **Python 3.13+**
- **Node.js 20+**
- **Rust** (latest stable, for Tauri)
- **pnpm** (package manager)
- **Git**

## Quick Start

### 1. Clone the Repository

```bash
git clone https://github.com/securescan/securescan-pro-x.git
cd securescan-pro-x
```

### 2. Run Setup Script

```bash
./scripts/dev/setup.sh
```

This will:
- Create a Python virtual environment
- Install backend dependencies
- Install frontend dependencies

### 3. Start Development Servers

```bash
./scripts/dev/start.sh
```

This starts:
- **Backend API**: http://localhost:8000
- **Frontend UI**: http://localhost:1420
- **API Docs**: http://localhost:8000/docs

### 4. Create Your First Workspace

Visit http://localhost:1420 and click "Create Workspace" on the dashboard.

## Manual Setup

### Backend

```bash
cd backend

# Create virtual environment
python3 -m venv .venv
source .venv/bin/activate  # Linux/macOS
# .venv\Scripts\activate   # Windows

# Install dependencies
pip install -e ".[dev]"

# Start API server
uvicorn app.api:app --reload
```

### Frontend

```bash
cd frontend

# Install dependencies
pnpm install

# Start dev server
pnpm dev
```

## Running Tests

### Backend Tests

```bash
cd backend
pytest                          # Run all tests
pytest -v                       # Verbose output
pytest --cov=app                # With coverage
pytest tests/unit/              # Unit tests only
```

### Frontend Tests

```bash
cd frontend
pnpm test                       # Unit tests
pnpm test:e2e                   # E2E tests
pnpm test:a11y                  # Accessibility tests
```

## CLI Usage

```bash
cd backend
python -m app.cli version       # Show version
python -m app.cli serve         # Start API server
python -m app.cli check         # System health check
python -m app.cli config --show # Show configuration
```

## Docker

```bash
# Development
docker compose -f docker/compose/docker-compose.dev.yml up

# Production
docker compose -f docker/compose/docker-compose.prod.yml up
```

## IDE Setup

### VS Code

Install recommended extensions:
- Python
- Pylance
- ESLint
- Prettier
- Tailwind CSS IntelliSense

### PyCharm

1. Open the `backend/` directory
2. Configure Python interpreter to `.venv`
3. Enable MyPy integration

## Next Steps

- [Configuration Guide](configuration.md) — Customize your setup
- [First Assessment Tutorial](../tutorials/first-assessment.md) — Run your first assessment
- [Plugin Development](plugins.md) — Build custom plugins
