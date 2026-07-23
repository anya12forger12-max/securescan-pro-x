#!/usr/bin/env bash
# SecureScan Pro X — Start Development Servers
set -euo pipefail

echo "Starting SecureScan Pro X development environment..."

# Start backend
echo "Starting backend server on http://localhost:8000..."
cd backend
source .venv/bin/activate 2>/dev/null || true
uvicorn app.api:app --reload --host 127.0.0.1 --port 8000 &
BACKEND_PID=$!

# Start frontend
echo "Starting frontend server on http://localhost:1420..."
cd ../frontend
pnpm dev &
FRONTEND_PID=$!

echo ""
echo "Development servers started!"
echo "  Backend:  http://localhost:8000"
echo "  Frontend: http://localhost:1420"
echo "  API Docs: http://localhost:8000/docs"
echo ""
echo "Press Ctrl+C to stop all servers."

# Cleanup on exit
cleanup() {
    echo "Stopping servers..."
    kill $BACKEND_PID 2>/dev/null || true
    kill $FRONTEND_PID 2>/dev/null || true
    wait
}
trap cleanup EXIT INT TERM

wait
