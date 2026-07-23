#!/usr/bin/env bash
# =============================================================================
# Malware Hash Checker Pro - Full Validation Script
# Runs all linting, formatting, type-checking, testing, and doc validation.
# Usage: bash scripts/dev/validate.sh [--lint-only] [--no-coverage]
# =============================================================================
set -euo pipefail

# -- Colors -------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# -- Helpers ------------------------------------------------------------------
info()    { printf "${BLUE}[INFO]${NC}  %s\n" "$*"; }
success() { printf "${GREEN}[PASS]${NC}  %s\n" "$*"; }
warn()    { printf "${YELLOW}[WARN]${NC}  %s\n" "$*"; }
fail()    { printf "${RED}[FAIL]${NC}  %s\n" "$*"; }
section() { printf "\n${CYAN}${BOLD}--- %s ---${NC}\n" "$*"; }

# -- Flags --------------------------------------------------------------------
LINT_ONLY=false
NO_COVERAGE=false
for arg in "$@"; do
    case "$arg" in
        --lint-only)     LINT_ONLY=true ;;
        --no-coverage)   NO_COVERAGE=true ;;
        -h|--help)
            echo "Usage: $0 [--lint-only] [--no-coverage]"
            echo ""
            echo "Options:"
            echo "  --lint-only      Run only linting/formatting checks"
            echo "  --no-coverage    Skip coverage report generation"
            echo "  -h, --help       Show this help message"
            exit 0
            ;;
        *)
            printf "${RED}Unknown argument: %s${NC}\n" "$arg" >&2
            exit 1
            ;;
    esac
done

# -- Config -------------------------------------------------------------------
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
FAILED=0
RESULTS=()

run_check() {
    local name="$1"
    shift
    section "$name"
    if "$@"; then
        success "$name"
        RESULTS+=("PASS: $name")
    else
        fail "$name"
        RESULTS+=("FAIL: $name")
        FAILED=1
    fi
}

# -- 1. Ruff Linting ---------------------------------------------------------
run_check "Ruff Linting" \
    ruff check "${REPO_ROOT}/packages" "${REPO_ROOT}/tests" "${REPO_ROOT}/scripts" \
    --output-format=concise

# -- 2. Ruff Formatting (import sorting) -------------------------------------
run_check "Ruff Import Sorting" \
    ruff check "${REPO_ROOT}/packages" "${REPO_ROOT}/tests" "${REPO_ROOT}/scripts" \
    --select I --output-format=concise

# -- 3. Black Format Check ---------------------------------------------------
run_check "Black Format Check" \
    black --check --diff "${REPO_ROOT}/packages" "${REPO_ROOT}/tests" "${REPO_ROOT}/scripts"

# -- 4. Mypy Type Checking ---------------------------------------------------
if [[ "$LINT_ONLY" == "false" ]]; then
    run_check "Mypy Type Checking" \
        mypy "${REPO_ROOT}/packages" \
        --config-file "${REPO_ROOT}/pyproject.toml"
fi

# -- 5. Trailing Whitespace Check --------------------------------------------
section "Trailing Whitespace"
WHITESPACE_FILES=()
while IFS= read -r -d '' file; do
    if grep -Pn '\s+$' "$file" >/dev/null 2>&1; then
        WHITESPACE_FILES+=("$file")
    fi
done < <(find "${REPO_ROOT}/packages" "${REPO_ROOT}/tests" -name '*.py' -print0 2>/dev/null || true)

if [[ ${#WHITESPACE_FILES[@]} -eq 0 ]]; then
    success "Trailing Whitespace"
    RESULTS+=("PASS: Trailing Whitespace")
else
    fail "Trailing Whitespace (${#WHITESPACE_FILES[@]} files affected)"
    for f in "${WHITESPACE_FILES[@]}"; do
        printf "  %s\n" "$f"
    done
    RESULTS+=("FAIL: Trailing Whitespace")
    FAILED=1
fi

# -- 6. Documentation Validation ---------------------------------------------
section "Documentation Validation"
DOC_ISSUES=0

# Check for broken relative links in markdown files
while IFS= read -r -d '' md_file; do
    # Extract markdown links: [text](path)
    while IFS= read -r link; do
        path=$(echo "$link" | sed -E 's/.*\]\(([^)#]+).*/\1/' | head -1)
        if [[ -n "$path" ]] && [[ ! "$path" =~ ^https?:// ]] && [[ ! "$path" =~ ^# ]]; then
            # Resolve relative to the markdown file's directory
            dir="$(dirname "$md_file")"
            resolved="${dir}/${path}"
            if [[ ! -e "$resolved" ]]; then
                warn "Broken link in ${md_file}: ${path}"
                DOC_ISSUES=$((DOC_ISSUES + 1))
            fi
        fi
    done < <(grep -oE '\[[^]]+\]\([^)]+\)' "$md_file" 2>/dev/null || true)
done < <(find "${REPO_ROOT}" -name '*.md' -not -path '*/.git/*' -not -path '*/node_modules/*' -print0 2>/dev/null || true)

# Check that key documentation files exist
DOCS=(
    "README.md"
    "LICENSE"
    "CONTRIBUTING.md"
    "CODE_OF_CONDUCT.md"
    "SECURITY.md"
    "SUPPORT.md"
)

for doc in "${DOCS[@]}"; do
    if [[ ! -f "${REPO_ROOT}/${doc}" ]]; then
        warn "Missing documentation file: ${doc}"
        DOC_ISSUES=$((DOC_ISSUES + 1))
    fi
done

if [[ $DOC_ISSUES -eq 0 ]]; then
    success "Documentation Validation"
    RESULTS+=("PASS: Documentation Validation")
else
    fail "Documentation Validation (${DOC_ISSUES} issues)"
    RESULTS+=("FAIL: Documentation Validation")
    FAILED=1
fi

# -- 7. Pytest with Coverage -------------------------------------------------
if [[ "$LINT_ONLY" == "false" ]]; then
    section "Pytest Test Suite"

    PYTEST_ARGS=(
        "${REPO_ROOT}/tests"
        --tb=short
        -q
    )

    if [[ "$NO_COVERAGE" == "true" ]]; then
        PYTEST_ARGS+=(--no-cov)
    fi

    if run_check "Pytest Test Suite" pytest "${PYTEST_ARGS[@]}"; then
        :
    fi
fi

# -- 8. Security Checks (non-blocking) ---------------------------------------
if [[ "$LINT_ONLY" == "false" ]]; then
    section "Security Checks"

    # Bandit
    if command -v bandit &>/dev/null; then
        if bandit -r "${REPO_ROOT}/packages" -c "${REPO_ROOT}/pyproject.toml" -q 2>/dev/null; then
            success "Bandit Security Scan"
            RESULTS+=("PASS: Bandit Security Scan")
        else
            warn "Bandit found potential security issues"
            RESULTS+=("WARN: Bandit Security Scan")
        fi
    else
        warn "Bandit not installed, skipping security scan"
    fi

    # pip-audit
    if command -v pip-audit &>/dev/null; then
        if pip-audit --desc 2>/dev/null; then
            success "pip-audit Dependency Scan"
            RESULTS+=("PASS: pip-audit Dependency Scan")
        else
            warn "pip-audit found vulnerable dependencies"
            RESULTS+=("WARN: pip-audit Dependency Scan")
        fi
    else
        warn "pip-audit not installed, skipping dependency audit"
    fi
fi

# -- Summary ------------------------------------------------------------------
printf "\n${CYAN}${BOLD}========================================${NC}\n"
printf "${CYAN}${BOLD}         Validation Summary${NC}\n"
printf "${CYAN}${BOLD}========================================${NC}\n\n"

for result in "${RESULTS[@]}"; do
    case "$result" in
        PASS:*) printf "${GREEN}  PASS${NC}  %s\n" "${result#PASS: }" ;;
        FAIL:*) printf "${RED}  FAIL${NC}  %s\n" "${result#FAIL: }" ;;
        WARN:*) printf "${YELLOW}  WARN${NC}  %s\n" "${result#WARN: }" ;;
    esac
done

echo ""

if [[ $FAILED -ne 0 ]]; then
    printf "${RED}${BOLD}Validation FAILED. Please fix the issues above.${NC}\n"
    exit 1
else
    printf "${GREEN}${BOLD}All validations PASSED.${NC}\n"
    exit 0
fi
