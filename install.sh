#!/usr/bin/env bash
# SecureScan Pro X — Quick Setup Script
# Usage: curl -sSL <url>/install.sh | bash
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info() { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

echo -e "${BLUE}"
echo "  ╔═══════════════════════════════════════╗"
echo "  ║     SecureScan Pro X — Installer      ║"
echo "  ║   Enterprise Security Assessment      ║"
echo "  ╚═══════════════════════════════════════╝"
echo -e "${NC}"

# Check prerequisites
command -v python3 >/dev/null 2>&1 || error "Python 3.13+ required. Install from https://python.org"
command -v node >/dev/null 2>&1 || error "Node.js 20+ required. Install from https://nodejs.org"
command -v pnpm >/dev/null 2>&1 || error "pnpm required. Install: npm install -g pnpm"

PYTHON_VERSION=$(python3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
NODE_VERSION=$(node --version)
info "Python: $PYTHON_VERSION | Node: $NODE_VERSION"

# Setup backend
info "Setting up backend..."
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -e ".[dev]"
success "Backend dependencies installed"

# Create data directory
mkdir -p data
success "Backend ready"

# Setup frontend
info "Setting up frontend..."
cd ../frontend
pnpm install
success "Frontend dependencies installed"

# Return to root
cd ..

echo ""
success "Installation complete!"
echo ""
echo -e "  ${GREEN}To start development:${NC}"
echo "    ./scripts/dev/start.sh"
echo ""
echo -e "  ${GREEN}Or manually:${NC}"
echo "    Backend:  cd backend && source .venv/bin/activate && uvicorn app.api:app --reload"
echo "    Frontend: cd frontend && pnpm dev"
echo ""
echo -e "  ${GREEN}Open:${NC} http://localhost:5173"
echo ""
echo -e "  ${GREEN}Default login:${NC} admin / admin123!@#SecureScan"
echo ""
