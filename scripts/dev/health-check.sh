#!/usr/bin/env bash
# =============================================================================
# Malware Hash Checker Pro - Repository Health Check
# Verifies structure, config validity, docs links, license & version consistency.
# Usage: bash scripts/dev/health-check.sh
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

# -- Config -------------------------------------------------------------------
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
FAILED=0
CHECKS_RUN=0
CHECKS_PASSED=0

check() {
    local name="$1"
    shift
    CHECKS_RUN=$((CHECKS_RUN + 1))
    section "$name"
    if "$@"; then
        CHECKS_PASSED=$((CHECKS_PASSED + 1))
        return 0
    else
        FAILED=1
        return 1
    fi
}

# =============================================================================
# 1. Expected Directory Structure
# =============================================================================
check_directory_structure() {
    local missing=0

    EXPECTED_DIRS=(
        "packages/core"
        "packages/hashing"
        "packages/scanner"
        "packages/database"
        "packages/security"
        "packages/logging"
        "packages/reports"
        "packages/config"
        "packages/ui"
        "tests/unit"
        "tests/integration"
        "tests/e2e"
        "tests/security"
        "tests/accessibility"
        "tests/benchmarks"
        "docs/00_Project"
        "docs/01_Getting_Started"
        "docs/02_User_Guide"
        "docs/03_Administrator"
        "docs/04_Developer"
        "docs/05_Security"
        "docs/06_Testing"
        "scripts/dev"
        "scripts/build"
        "scripts/ci"
        "scripts/release"
        "configs"
        "assets"
        "examples"
        "benchmarks"
    )

    for dir in "${EXPECTED_DIRS[@]}"; do
        if [[ -d "${REPO_ROOT}/${dir}" ]]; then
            success "Directory exists: ${dir}"
        else
            fail "Missing directory: ${dir}"
            missing=$((missing + 1))
        fi
    done

    [[ $missing -eq 0 ]]
}

check "Directory Structure" check_directory_structure

# =============================================================================
# 2. pyproject.toml Validation
# =============================================================================
check_pyproject_toml() {
    local issues=0

    TOML_FILES=(
        "${REPO_ROOT}/pyproject.toml"
        "${REPO_ROOT}/packages/core/pyproject.toml"
        "${REPO_ROOT}/packages/hashing/pyproject.toml"
        "${REPO_ROOT}/packages/scanner/pyproject.toml"
        "${REPO_ROOT}/packages/database/pyproject.toml"
        "${REPO_ROOT}/packages/security/pyproject.toml"
        "${REPO_ROOT}/packages/logging/pyproject.toml"
        "${REPO_ROOT}/packages/reports/pyproject.toml"
        "${REPO_ROOT}/packages/config/pyproject.toml"
    )

    for toml_file in "${TOML_FILES[@]}"; do
        local rel="${toml_file#${REPO_ROOT}/}"
        if [[ -f "$toml_file" ]]; then
            # Basic TOML syntax check: look for key=value patterns
            # Verify required fields exist
            local has_name has_version has_build
            has_name=$(grep -c '^\s*name\s*=' "$toml_file" 2>/dev/null || echo "0")
            has_version=$(grep -c '^\s*version\s*=' "$toml_file" 2>/dev/null || echo "0")
            has_build=$(grep -c '^\[build-system\]' "$toml_file" 2>/dev/null || echo "0")

            local file_issues=0
            if [[ "$has_name" -eq 0 ]]; then
                warn "  ${rel}: missing [project] name"
                file_issues=$((file_issues + 1))
            fi
            if [[ "$has_version" -eq 0 ]]; then
                warn "  ${rel}: missing [project] version"
                file_issues=$((file_issues + 1))
            fi
            if [[ "$has_build" -eq 0 ]]; then
                warn "  ${rel}: missing [build-system]"
                file_issues=$((file_issues + 1))
            fi

            if [[ $file_issues -eq 0 ]]; then
                success "Valid: ${rel}"
            else
                issues=$((issues + file_issues))
            fi
        else
            warn "File not found: ${rel}"
            issues=$((issues + 1))
        fi
    done

    [[ $issues -eq 0 ]]
}

check "pyproject.toml Validation" check_pyproject_toml

# =============================================================================
# 3. Broken Documentation Links
# =============================================================================
check_doc_links() {
    local broken=0

    while IFS= read -r -d '' md_file; do
        local rel="${md_file#${REPO_ROOT}/}"
        while IFS= read -r match; do
            # Extract the path from [text](path)
            local path
            path=$(echo "$match" | sed -E 's/.*\]\(([^)#]+).*/\1/' | head -1)

            # Skip external URLs and anchors
            if [[ -z "$path" ]] || [[ "$path" =~ ^https?:// ]] || [[ "$path" =~ ^# ]] || [[ "$path" =~ ^mailto: ]]; then
                continue
            fi

            # Resolve relative to the markdown file's directory
            local dir
            dir="$(dirname "$md_file")"
            local resolved="${dir}/${path}"

            if [[ ! -e "$resolved" ]]; then
                warn "Broken link in ${rel}: ${path}"
                broken=$((broken + 1))
            fi
        done < <(grep -oE '\[[^]]+\]\([^)]+\)' "$md_file" 2>/dev/null || true)
    done < <(find "${REPO_ROOT}" -name '*.md' -not -path '*/.git/*' -not -path '*/node_modules/*' -not -path '*/.venv/*' -print0 2>/dev/null || true)

    [[ $broken -eq 0 ]]
}

check "Documentation Links" check_doc_links

# =============================================================================
# 4. License Consistency
# =============================================================================
check_license() {
    local issues=0

    # Root LICENSE file
    if [[ -f "${REPO_ROOT}/LICENSE" ]]; then
        local license_type
        license_type=$(head -5 "${REPO_ROOT}/LICENSE" 2>/dev/null || echo "")
        if echo "$license_type" | grep -qi "gpl\|general public license"; then
            success "Root LICENSE file: GPL-3.0 detected"
        else
            warn "Root LICENSE file exists but license type unclear"
            issues=$((issues + 1))
        fi
    else
        fail "Root LICENSE file missing"
        issues=$((issues + 1))
    fi

    # Check pyproject.toml license fields
    local root_license
    root_license=$(grep -E '^\s*license\s*=' "${REPO_ROOT}/pyproject.toml" 2>/dev/null | head -1 || echo "")
    if echo "$root_license" | grep -qi "GPL-3.0-only\|GPL-3.0"; then
        success "Root pyproject.toml license: GPL-3.0"
    else
        warn "Root pyproject.toml license field missing or mismatched"
        issues=$((issues + 1))
    fi

    # Check all sub-packages reference the same license
    local pkg_license
    while IFS= read -r toml_file; do
        pkg_license=$(grep -E '^\s*license\s*=' "$toml_file" 2>/dev/null | head -1 || echo "")
        local rel="${toml_file#${REPO_ROOT}/}"
        if [[ -n "$pkg_license" ]]; then
            if echo "$pkg_license" | grep -qi "GPL-3.0-only\|GPL-3.0"; then
                success "License consistent: ${rel}"
            else
                warn "License mismatch in ${rel}: ${pkg_license}"
                issues=$((issues + 1))
            fi
        fi
    done < <(find "${REPO_ROOT}/packages" -name 'pyproject.toml' 2>/dev/null || true)

    [[ $issues -eq 0 ]]
}

check "License Consistency" check_license

# =============================================================================
# 5. Version Consistency Across pyproject.toml
# =============================================================================
check_versions() {
    local issues=0

    ROOT_VERSION=$(grep -E '^\s*version\s*=' "${REPO_ROOT}/pyproject.toml" 2>/dev/null \
        | head -1 | sed -E 's/.*=\s*["'"'"']([^"'"'"']+)["'"'"'].*/\1/' || echo "")

    if [[ -z "$ROOT_VERSION" ]]; then
        fail "Could not read root version from pyproject.toml"
        return 1
    fi
    info "Root version: ${ROOT_VERSION}"

    while IFS= read -r toml_file; do
        local rel="${toml_file#${REPO_ROOT}/}"
        local pkg_version
        pkg_version=$(grep -E '^\s*version\s*=' "$toml_file" 2>/dev/null \
            | head -1 | sed -E 's/.*=\s*["'"'"']([^"'"'"']+)["'"'"'].*/\1/' || echo "")

        if [[ -n "$pkg_version" ]]; then
            if [[ "$pkg_version" == "$ROOT_VERSION" ]]; then
                success "Version match: ${rel} (${pkg_version})"
            else
                warn "Version mismatch in ${rel}: ${pkg_version} (expected ${ROOT_VERSION})"
                issues=$((issues + 1))
            fi
        else
            warn "No version found in ${rel}"
            issues=$((issues + 1))
        fi
    done < <(find "${REPO_ROOT}/packages" -name 'pyproject.toml' 2>/dev/null || true)

    [[ $issues -eq 0 ]]
}

check "Version Consistency" check_versions

# =============================================================================
# 6. Template Consistency (conftest, __init__, etc.)
# =============================================================================
check_templates() {
    local issues=0

    # Every package should have __init__.py
    local pkg_dirs=(
        "packages/core"
        "packages/hashing"
        "packages/scanner"
        "packages/database"
        "packages/security"
        "packages/logging"
        "packages/reports"
        "packages/config"
        "packages/ui"
    )

    for pkg_dir in "${pkg_dirs[@]}"; do
        local init_file="${REPO_ROOT}/${pkg_dir}/__init__.py"
        local rel="${pkg_dir}/__init__.py"
        if [[ -f "$init_file" ]]; then
            success "Has __init__.py: ${rel}"
        else
            warn "Missing __init__.py: ${rel}"
            issues=$((issues + 1))
        fi
    done

    # Check that tests have conftest.py
    local test_dirs=(
        "tests"
        "tests/unit"
        "tests/integration"
        "tests/e2e"
        "tests/security"
    )

    for test_dir in "${test_dirs[@]}"; do
        local conftest="${REPO_ROOT}/${test_dir}/conftest.py"
        local rel="${test_dir}/conftest.py"
        if [[ -f "$conftest" ]]; then
            success "Has conftest.py: ${rel}"
        else
            warn "Missing conftest.py: ${rel}"
            issues=$((issues + 1))
        fi
    done

    # Check that test directories have __init__.py
    for test_dir in "${test_dirs[@]}"; do
        local init_file="${REPO_ROOT}/${test_dir}/__init__.py"
        local rel="${test_dir}/__init__.py"
        if [[ -f "$init_file" ]]; then
            success "Has __init__.py: ${rel}"
        else
            warn "Missing __init__.py: ${rel}"
            issues=$((issues + 1))
        fi
    done

    [[ $issues -eq 0 ]]
}

check "Template Consistency" check_templates

# =============================================================================
# 7. Repository Structure Compliance
# =============================================================================
check_structure() {
    local issues=0

    # Required root files
    ROOT_FILES=(
        "pyproject.toml"
        "README.md"
        "LICENSE"
        "CONTRIBUTING.md"
        "CODE_OF_CONDUCT.md"
        "SECURITY.md"
        "SUPPORT.md"
        ".gitignore"
        "main.py"
    )

    for file in "${ROOT_FILES[@]}"; do
        if [[ -f "${REPO_ROOT}/${file}" ]]; then
            success "Root file exists: ${file}"
        else
            warn "Missing root file: ${file}"
            issues=$((issues + 1))
        fi
    done

    # No .pyc files in source
    local pyc_count
    pyc_count=$(find "${REPO_ROOT}/packages" "${REPO_ROOT}/tests" -name '*.pyc' 2>/dev/null | wc -l || echo "0")
    if [[ "$pyc_count" -eq 0 ]]; then
        success "No .pyc files in source directories"
    else
        warn "Found ${pyc_count} .pyc files in source (should be gitignored)"
        issues=$((issues + 1))
    fi

    # No __pycache__ in source (unless .gitignore handles it)
    local cache_count
    cache_count=$(find "${REPO_ROOT}/packages" -name '__pycache__' -type d 2>/dev/null | wc -l || echo "0")
    if [[ "$cache_count" -eq 0 ]]; then
        success "No __pycache__ directories in packages"
    else
        warn "Found ${cache_count} __pycache__ directories in packages"
    fi

    # Scripts should be executable-ready (have shebangs)
    while IFS= read -r -d '' script; do
        local first_line
        first_line=$(head -1 "$script" 2>/dev/null || echo "")
        local rel="${script#${REPO_ROOT}/}"
        if [[ "$first_line" == "#!"* ]]; then
            success "Has shebang: ${rel}"
        else
            warn "Missing shebang: ${rel}"
            issues=$((issues + 1))
        fi
    done < <(find "${REPO_ROOT}/scripts" -name '*.sh' -print0 2>/dev/null || true)

    [[ $issues -eq 0 ]]
}

check "Repository Structure Compliance" check_structure

# =============================================================================
# Summary
# =============================================================================
printf "\n${CYAN}${BOLD}========================================${NC}\n"
printf "${CYAN}${BOLD}         Health Check Summary${NC}\n"
printf "${CYAN}${BOLD}========================================${NC}\n\n"

printf "  Checks run:    %d\n" "$CHECKS_RUN"
printf "  Checks passed: ${GREEN}%d${NC}\n" "$CHECKS_PASSED"
printf "  Checks failed: ${RED}%d${NC}\n" "$((CHECKS_RUN - CHECKS_PASSED))"

echo ""

if [[ $FAILED -ne 0 ]]; then
    printf "${RED}${BOLD}Health check FAILED. Review the issues above.${NC}\n"
    exit 1
else
    printf "${GREEN}${BOLD}Repository health: ALL CHECKS PASSED.${NC}\n"
    exit 0
fi
