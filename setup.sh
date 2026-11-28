#!/usr/bin/env bash
# One-command bootstrap for this repository.
#   ./setup.sh          install dependencies
#   ./setup.sh run      start the project (when a run target exists)
#   ./setup.sh test     run the project's checks
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"
MODE="${1:-install}"

log() { printf '\n==> %s\n' "$*"; }
need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'Missing required tool: %s\n' "$1" >&2
    exit 1
  fi
}
has_script() {
  [ -f package.json ] || return 1
  python3 -c 'import json,sys; d=json.load(open("package.json")); sys.exit(0 if sys.argv[1] in d.get("scripts",{}) else 1)' "$1" 2>/dev/null
}
node_pm() {
  if [ -f pnpm-lock.yaml ] || [ -f pnpm-workspace.yaml ]; then echo pnpm
  elif [ -f yarn.lock ]; then echo yarn
  else echo npm
  fi
}
activate_venv() {
  if [ -d .venv ]; then
    # shellcheck disable=SC1091
    . .venv/bin/activate
  fi
}

do_install() {
  log "Detecting project type in $ROOT"
  if [ -f pubspec.yaml ]; then
    need flutter; flutter pub get
  elif [ -f package.json ]; then
    pm="$(node_pm)"; need "$pm"; "$pm" install
  elif [ -f pyproject.toml ] || [ -f requirements.txt ] || [ -f setup.py ]; then
    need python3
    [ -d .venv ] || python3 -m venv .venv
    activate_venv
    python3 -m pip install --upgrade pip >/dev/null
    [ -f requirements.txt ] && python3 -m pip install -r requirements.txt
    [ -f pyproject.toml ] && python3 -m pip install -e .
  elif compgen -G '*.sln' >/dev/null || compgen -G '*.csproj' >/dev/null; then
    need dotnet; dotnet restore
  elif [ -f go.mod ]; then
    need go; go mod download
  elif [ -f Cargo.toml ]; then
    need cargo; cargo fetch
  elif [ -f pom.xml ]; then
    need mvn; mvn -q -DskipTests package
  elif compgen -G 'gradlew' >/dev/null; then
    log "Run ./gradlew build to compile"
  elif [ -f composer.json ]; then
    need composer; composer install
  elif [ -f Gemfile ]; then
    need bundle; bundle install
  elif [ -f Makefile ]; then
    log "Run make to build"
  else
    log "No recognised build system. Follow README.md for setup."
  fi
  log "Install step finished"
}

do_run() {
  if [ -f pubspec.yaml ]; then
    need flutter; flutter run
  elif [ -f package.json ]; then
    pm="$(node_pm)"; need "$pm"
    if has_script dev; then "$pm" run dev
    elif has_script start; then "$pm" start
    elif has_script serve; then "$pm" run serve
    else log "No dev/start script defined. See README.md for how to run this project."; fi
  elif [ -f pyproject.toml ] || [ -f requirements.txt ] || [ -f setup.py ]; then
    activate_venv
    for entry in main.py app.py run.py cli.py; do
      if [ -f "$entry" ]; then python3 "$entry"; exit 0; fi
    done
    log "No obvious entry point. See README.md for the CLI/module to run."
  elif compgen -G '*.sln' >/dev/null || compgen -G '*.csproj' >/dev/null; then
    need dotnet; dotnet run
  elif [ -f go.mod ]; then
    need go; go run .
  elif [ -f Cargo.toml ]; then
    need cargo; cargo run
  elif [ -f Makefile ]; then
    log "Run make or see README.md for the run target"
  else
    log "No run target detected. See README.md."
  fi
}

do_test() {
  if [ -f pubspec.yaml ]; then
    need flutter; flutter test
  elif [ -f package.json ]; then
    pm="$(node_pm)"; need "$pm"
    if has_script test; then "$pm" test; else log "No test script defined."; fi
  elif [ -f pyproject.toml ] || [ -f requirements.txt ] || [ -f setup.py ]; then
    activate_venv
    if python3 -c 'import pytest' 2>/dev/null; then python3 -m pytest
    else log "pytest not installed; see README.md"; fi
  elif compgen -G '*.sln' >/dev/null || compgen -G '*.csproj' >/dev/null; then
    need dotnet; dotnet test
  elif [ -f go.mod ]; then
    need go; go test ./...
  elif [ -f Cargo.toml ]; then
    need cargo; cargo test
  elif [ -f Makefile ]; then
    log "Run make test or see README.md"
  else
    log "No test runner detected. See README.md."
  fi
}

case "$MODE" in
  install) do_install ;;
  run) do_run ;;
  test) do_test ;;
  -h|--help|help)
    printf 'Usage: ./setup.sh [install|run|test]\n'
    ;;
  *) printf 'Unknown mode: %s\nUsage: ./setup.sh [install|run|test]\n' "$MODE" >&2; exit 2 ;;
esac
