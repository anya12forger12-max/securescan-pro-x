#!/usr/bin/env bash
# SecureScan Pro X — Development Environment Setup
set -euo pipefail

echo "Setting up SecureScan Pro X development environment..."

# Check prerequisites
echo "Checking prerequisites..."

if ! command -v python3 &> /dev/null; then
    echo "ERROR: Python 3.13+ is required"
    exit 1
fi

PYTHON_VERSION=$(python3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
echo "  Python: $PYTHON_VERSION"

if ! command -v node &> /dev/null; then
    echo "ERROR: Node.js 20+ is required"
    exit 1
fi

NODE_VERSION=$(node --version)
echo "  Node.js: $NODE_VERSION"

if ! command -v pnpm &> /dev/null; then
    echo "Installing pnpm..."
    npm install -g pnpm
fi

echo "  pnpm: $(pnpm --version)"

# Setup backend
echo ""
echo "Setting up backend..."
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
cd ..

# Setup frontend
echo ""
echo "Setting up frontend..."
cd frontend
pnpm install
cd ..

echo ""
echo "Development environment ready!"
echo ""
echo "To start development:"
echo "  source backend/.venv/bin/activate"
echo "  ./scripts/dev/start.sh"
