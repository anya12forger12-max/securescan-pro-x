#!/usr/bin/env bash
# One-command bootstrap for this repository.
#   ./setup.sh              install dependencies
#   ./setup.sh run          start the project (when a run target exists)
#   ./setup.sh test         run the project's checks
#   SETUP_TARGET=sub/dir ./setup.sh   choose a subproject explicitly
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
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

# Find the root manifest, or the most likely subproject (up to 3 levels deep).
pick_target() {
  if [ -n "${SETUP_TARGET:-}" ]; then
    if [ ! -d "$ROOT/$SETUP_TARGET" ]; then
      printf 'SETUP_TARGET directory not found: %s\n' "$SETUP_TARGET" >&2
      exit 1
    fi
    printf '%s' "$SETUP_TARGET"
    return
  fi
  for f in pubspec.yaml package.json pyproject.toml requirements.txt setup.py go.mod Cargo.toml pom.xml composer.json Gemfile; do
    if [ -f "$ROOT/$f" ]; then printf '.'; return; fi
  done
  if compgen -G "$ROOT/*.sln" >/dev/null || compgen -G "$ROOT/*.csproj" >/dev/null \
     || [ -f "$ROOT/gradlew" ] || [ -f "$ROOT/Makefile" ]; then
    printf '.'
    return
  fi

  best=''
  rank=99
  while IFS= read -r d; do
    r=''
    if [ -f "$d/pubspec.yaml" ]; then r=0
    elif [ -f "$d/package.json" ]; then r=1
    elif [ -f "$d/pyproject.toml" ] || [ -f "$d/requirements.txt" ] || [ -f "$d/setup.py" ]; then r=2
    elif compgen -G "$d/*.sln" >/dev/null; then r=3
    elif [ -f "$d/go.mod" ]; then r=4
    elif [ -f "$d/Cargo.toml" ]; then r=5
    elif [ -f "$d/pom.xml" ]; then r=6
    elif [ -f "$d/gradlew" ]; then r=7
    elif [ -f "$d/composer.json" ]; then r=8
    elif [ -f "$d/Gemfile" ]; then r=9
    elif [ -f "$d/Makefile" ]; then r=10
    fi
    if [ -n "$r" ] && [ "$r" -lt "$rank" ]; then rank="$r"; best="${d#$ROOT/}"; fi
  done < <(find "$ROOT" -mindepth 1 -maxdepth 3 -type d \
             -not -path '*/.git*' -not -path '*/node_modules*' \
             -not -path '*/.venv*' -not -path '*/dist*' -not -path '*/build*' \
             2>/dev/null | sort)
  if [ -n "$best" ]; then
    printf '\n==> No root manifest; using ./%s (override: SETUP_TARGET=<dir>)\n' "$best" >&2
    printf '%s' "$best"
  else
    printf '.'
  fi
}

do_install() {
  log "Installing dependencies in $(pwd)"
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
  elif [ -f gradlew ]; then
    log "Run ./gradlew build to compile"
  elif [ -f composer.json ]; then
    need composer; composer install
  elif [ -f Gemfile ]; then
    need bundle; bundle install
  elif compgen -G '*.ino' >/dev/null; then
    log "Arduino sketch detected. With arduino-cli installed, compile with:"
    log "  arduino-cli compile --fqbn <your-board> <sketch-directory>"
    log "See README.md for supported boards and wiring."
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
  elif compgen -G '*.ino' >/dev/null; then
    log "Upload the sketch from Arduino IDE or arduino-cli; see README.md."
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
  install) cd "$ROOT/$(pick_target)"; do_install ;;
  run) cd "$ROOT/$(pick_target)"; do_run ;;
  test) cd "$ROOT/$(pick_target)"; do_test ;;
  -h|--help|help)
    printf 'Usage: ./setup.sh [install|run|test]\n'
    printf 'Set SETUP_TARGET=<dir> to pick a subproject explicitly.\n'
    ;;
  *) printf 'Unknown mode: %s\nUsage: ./setup.sh [install|run|test]\n' "$MODE" >&2; exit 2 ;;
esac
