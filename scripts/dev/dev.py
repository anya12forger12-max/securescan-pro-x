#!/usr/bin/env python3
"""
Malware Hash Checker Pro - Developer Utility Script
====================================================
Self-contained CLI for common development tasks. No external dependencies
beyond the Python standard library.

Usage:
    python scripts/dev/dev.py <command> [options]

Commands:
    setup          Run the development environment setup
    validate       Run all validation checks (lint, format, typecheck, test)
    test           Run the test suite
    lint           Run ruff linting only
    format         Auto-format code with black and ruff
    typecheck      Run mypy type checking
    health         Run repository health checks
    bench          Run benchmarks
    docs-validate  Validate documentation links and structure
    clean          Remove build artifacts and caches
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Final

# -- Constants ----------------------------------------------------------------
REPO_ROOT: Final[Path] = Path(__file__).resolve().parent.parent.parent
SCRIPTS_DIR: Final[Path] = REPO_ROOT / "scripts" / "dev"
PACKAGES_DIR: Final[Path] = REPO_ROOT / "packages"
TESTS_DIR: Final[Path] = REPO_ROOT / "tests"
DOCS_DIR: Final[Path] = REPO_ROOT / "docs"

# Directories cleaned by the `clean` command
CLEAN_DIRS: Final[list[str]] = [
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    ".hypothesis",
    "htmlcov",
    "dist",
    "build",
    "*.egg-info",
    ".coverage",
    "coverage.xml",
    "__pycache__",
]

# Source directories for linting/formatting
SOURCE_DIRS: Final[list[str]] = ["packages", "tests", "scripts"]

# ANSI color codes
COLORS: Final[dict[str, str]] = {
    "reset": "\033[0m",
    "red": "\033[0;31m",
    "green": "\033[0;32m",
    "yellow": "\033[1;33m",
    "blue": "\033[0;34m",
    "cyan": "\033[0;36m",
    "bold": "\033[1m",
}

# Whether the terminal supports color
USE_COLOR: Final[bool] = sys.stdout.isatty() and os.environ.get("NO_COLOR") is None


def _c(color: str, text: str) -> str:
    """Wrap text in ANSI color codes if the terminal supports it."""
    if not USE_COLOR:
        return text
    code = COLORS.get(color, "")
    reset = COLORS["reset"]
    return f"{code}{text}{reset}"


def _banner(title: str) -> None:
    """Print a styled section banner."""
    width = max(len(title) + 4, 50)
    line = "=" * width
    print(f"\n{_c('cyan', line)}")
    print(f"  {_c('bold', title)}")
    print(f"{_c('cyan', line)}\n")


def _info(message: str) -> None:
    print(f"{_c('blue', '[INFO]')}  {message}")


def _pass(message: str) -> None:
    print(f"{_c('green', '[PASS]')}  {message}")


def _fail(message: str) -> None:
    print(f"{_c('red', '[FAIL]')}  {message}")


def _warn(message: str) -> None:
    print(f"{_c('yellow', '[WARN]')}  {message}")


# -- Subprocess Helpers -------------------------------------------------------
def _run(
    args: list[str],
    *,
    cwd: Path | None = None,
    check: bool = True,
    capture: bool = False,
    env: dict[str, str] | None = None,
) -> subprocess.CompletedProcess[str]:
    """Run a subprocess with consistent error handling."""
    merged_env = dict(os.environ)
    if env:
        merged_env.update(env)

    effective_cwd = str(cwd) if cwd else str(REPO_ROOT)

    try:
        result = subprocess.run(
            args,
            cwd=effective_cwd,
            env=merged_env,
            text=True,
            check=False,
            stdout=subprocess.PIPE if capture else None,
            stderr=subprocess.STDOUT if capture else None,
        )
        if check and result.returncode != 0:
            if capture and result.stdout:
                print(result.stdout)
            _fail(f"Command failed: {' '.join(args[:3])}...")
            sys.exit(result.returncode)
        return result
    except FileNotFoundError:
        _fail(f"Command not found: {args[0]}")
        _warn(f"Make sure it is installed and on your PATH.")
        if check:
            sys.exit(1)
        return subprocess.CompletedProcess(args, returncode=127, stdout="", stderr="")


def _tool_available(name: str) -> bool:
    """Check if a command-line tool is available on PATH."""
    return shutil.which(name) is not None


# -- Commands -----------------------------------------------------------------
def cmd_setup(args: argparse.Namespace) -> None:
    """Run the development environment setup script."""
    _banner("Development Setup")

    setup_script = SCRIPTS_DIR / "setup.sh"
    if not setup_script.exists():
        _fail(f"Setup script not found: {setup_script}")
        sys.exit(1)

    cmd = ["bash", str(setup_script)]
    if args.skip_validation:
        cmd.append("--skip-validation")
    if args.skip_hooks:
        cmd.append("--skip-hooks")

    _run(cmd, check=True)


def cmd_validate(args: argparse.Namespace) -> None:
    """Run all validation checks."""
    _banner("Full Validation")

    validate_script = SCRIPTS_DIR / "validate.sh"
    if not validate_script.exists():
        _fail(f"Validate script not found: {validate_script}")
        sys.exit(1)

    cmd = ["bash", str(validate_script)]
    if args.lint_only:
        cmd.append("--lint-only")
    if args.no_coverage:
        cmd.append("--no-coverage")

    _run(cmd, check=True)


def cmd_test(args: argparse.Namespace) -> None:
    """Run the test suite."""
    _banner("Test Suite")

    cmd: list[str] = ["python", "-m", "pytest"]

    if args.unit:
        cmd.extend(["-m", "unit"])
    if args.integration:
        cmd.extend(["-m", "integration"])
    if args.e2e:
        cmd.extend(["-m", "e2e"])
    if args.security:
        cmd.extend(["-m", "security"])
    if args.benchmark:
        cmd.extend(["-m", "benchmark"])
    if args.no_coverage:
        cmd.append("--no-cov")
    if args.verbose:
        cmd.append("-v")

    if args.file:
        cmd.append(str(args.file))
    else:
        cmd.append(str(TESTS_DIR))

    _run(cmd, check=True)


def cmd_lint(args: argparse.Namespace) -> None:
    """Run ruff linting."""
    _banner("Ruff Linting")

    if not _tool_available("ruff"):
        _fail("ruff is not installed. Run: pip install ruff")
        sys.exit(1)

    target = args.path or " ".join(SOURCE_DIRS)
    target_list = target.split() if isinstance(target, str) and " " in target else [target]

    cmd = ["ruff", "check", *target_list]

    if args.fix:
        cmd.append("--fix")
    if args.show_fixes:
        cmd.append("--show-fixes")

    _run(cmd, check=True)
    _pass("Ruff linting complete")


def cmd_format(args: argparse.Namespace) -> None:
    """Auto-format code with black and ruff."""
    _banner("Code Formatting")

    if args.check:
        _info("Running format CHECK only (no changes will be made)")
    else:
        _info("Auto-formatting code...")

    # Ruff import sorting
    if _tool_available("ruff"):
        _info("Running ruff import sorting...")
        cmd = ["ruff", "check", "--select", "I", "--fix"]
        cmd.extend(SOURCE_DIRS)
        _run(cmd, check=True)
        _pass("Ruff import sorting complete")
    else:
        _warn("ruff not found, skipping import sorting")

    # Black formatting
    if _tool_available("black"):
        _info("Running black formatting...")
        cmd = ["black"]
        if args.check:
            cmd.append("--check")
        cmd.extend(SOURCE_DIRS)
        _run(cmd, check=True)
        _pass("Black formatting complete")
    else:
        _fail("black is not installed. Run: pip install black")
        sys.exit(1)


def cmd_typecheck(args: argparse.Namespace) -> None:
    """Run mypy type checking."""
    _banner("Mypy Type Checking")

    if not _tool_available("mypy"):
        _fail("mypy is not installed. Run: pip install mypy")
        sys.exit(1)

    cmd = ["mypy", str(PACKAGES_DIR)]
    if args.strict:
        cmd.append("--strict")

    _run(cmd, check=True)
    _pass("Type checking complete")


def cmd_health(args: argparse.Namespace) -> None:
    """Run repository health checks."""
    _banner("Repository Health Check")

    health_script = SCRIPTS_DIR / "health-check.sh"
    if not health_script.exists():
        _fail(f"Health check script not found: {health_script}")
        sys.exit(1)

    _run(["bash", str(health_script)], check=True)


def cmd_bench(args: argparse.Namespace) -> None:
    """Run benchmarks."""
    _banner("Benchmarks")

    cmd: list[str] = [
        "python",
        "-m",
        "pytest",
        str(TESTS_DIR / "benchmarks"),
        "-m",
        "benchmark",
        "--benchmark-only",
        "--tb=short",
        "-v",
    ]

    if args.compare:
        cmd.extend(["--benchmark-compare", args.compare])

    if args.min_rounds:
        cmd.extend(["--benchmark-min-rounds", str(args.min_rounds)])

    _run(cmd, check=True)


def cmd_docs_validate(args: argparse.Namespace) -> None:
    """Validate documentation links and structure."""
    _banner("Documentation Validation")

    issues = 0

    # Check required doc files
    _info("Checking required documentation files...")
    required_files = [
        "README.md",
        "LICENSE",
        "CONTRIBUTING.md",
        "CODE_OF_CONDUCT.md",
        "SECURITY.md",
        "SUPPORT.md",
    ]

    for filename in required_files:
        filepath = REPO_ROOT / filename
        if filepath.exists():
            _pass(f"Found: {filename}")
        else:
            _fail(f"Missing: {filename}")
            issues += 1

    # Check doc directory structure
    _info("Checking documentation directory structure...")
    expected_doc_dirs = [
        "00_Project",
        "01_Getting_Started",
        "02_User_Guide",
        "03_Administrator",
        "04_Developer",
        "05_Security",
        "06_Testing",
    ]

    for dirname in expected_doc_dirs:
        dirpath = DOCS_DIR / dirname
        if dirpath.exists():
            _pass(f"Doc directory: {dirname}")
        else:
            _fail(f"Missing doc directory: {dirname}")
            issues += 1

    # Check for broken relative links in markdown files
    _info("Checking documentation links...")
    import re

    link_pattern = re.compile(r"\[([^\]]*)\]\(([^)#]+)\)")

    for md_file in REPO_ROOT.rglob("*.md"):
        # Skip .git, node_modules, .venv
        parts = md_file.relative_to(REPO_ROOT).parts
        if any(p.startswith(".") for p in parts[:2]):
            continue
        if "node_modules" in parts or ".venv" in parts:
            continue

        try:
            content = md_file.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue

        for match in link_pattern.finditer(content):
            path_str = match.group(2)
            # Skip external URLs and anchors
            if path_str.startswith(("http://", "https://", "#", "mailto:")):
                continue

            resolved = (md_file.parent / path_str).resolve()
            if not resolved.exists():
                rel_path = md_file.relative_to(REPO_ROOT)
                _fail(f"Broken link in {rel_path}: {path_str}")
                issues += 1

    print()
    if issues == 0:
        _pass("Documentation validation complete - all checks passed")
    else:
        _fail(f"Documentation validation found {issues} issue(s)")
        sys.exit(1)


def cmd_clean(args: argparse.Namespace) -> None:
    """Remove build artifacts and caches."""
    _banner("Cleaning Build Artifacts")

    cleaned = 0

    for pattern in CLEAN_DIRS:
        if "*" in pattern:
            # Glob pattern
            for match in REPO_ROOT.glob(pattern):
                if match.is_dir():
                    shutil.rmtree(match, ignore_errors=True)
                elif match.is_file():
                    match.unlink(missing_ok=True)
                _info(f"Removed: {match.name}")
                cleaned += 1
        else:
            target = REPO_ROOT / pattern
            if target.is_dir():
                shutil.rmtree(target, ignore_errors=True)
                _info(f"Removed directory: {pattern}")
                cleaned += 1
            elif target.is_file():
                target.unlink(missing_ok=True)
                _info(f"Removed file: {pattern}")
                cleaned += 1

    # Also clean __pycache__ recursively
    for cache_dir in REPO_ROOT.rglob("__pycache__"):
        if ".venv" not in str(cache_dir) and "myenv" not in str(cache_dir):
            shutil.rmtree(cache_dir, ignore_errors=True)
            _info(f"Removed: {cache_dir.relative_to(REPO_ROOT)}")
            cleaned += 1

    # Clean .egg-info directories
    for egg_info in REPO_ROOT.rglob("*.egg-info"):
        shutil.rmtree(egg_info, ignore_errors=True)
        _info(f"Removed: {egg_info.relative_to(REPO_ROOT)}")
        cleaned += 1

    print()
    _pass(f"Cleaned {cleaned} item(s)")


# -- Argument Parser ----------------------------------------------------------
def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="dev.py",
        description="Malware Hash Checker Pro - Developer Utility Script",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python scripts/dev/dev.py setup\n"
            "  python scripts/dev/dev.py validate\n"
            "  python scripts/dev/dev.py test --unit\n"
            "  python scripts/dev/dev.py lint --fix\n"
            "  python scripts/dev/dev.py format\n"
            "  python scripts/dev/dev.py typecheck --strict\n"
            "  python scripts/dev/dev.py clean\n"
        ),
    )
    subparsers = parser.add_subparsers(dest="command", help="Available commands")

    # setup
    p_setup = subparsers.add_parser("setup", help="Run development environment setup")
    p_setup.add_argument("--skip-validation", action="store_true", help="Skip post-setup validation")
    p_setup.add_argument("--skip-hooks", action="store_true", help="Skip git hook installation")

    # validate
    p_validate = subparsers.add_parser("validate", help="Run all validation checks")
    p_validate.add_argument("--lint-only", action="store_true", help="Run only linting checks")
    p_validate.add_argument("--no-coverage", action="store_true", help="Skip coverage reporting")

    # test
    p_test = subparsers.add_parser("test", help="Run the test suite")
    p_test.add_argument("--unit", action="store_true", help="Run only unit tests")
    p_test.add_argument("--integration", action="store_true", help="Run only integration tests")
    p_test.add_argument("--e2e", action="store_true", help="Run only end-to-end tests")
    p_test.add_argument("--security", action="store_true", help="Run only security tests")
    p_test.add_argument("--benchmark", action="store_true", help="Run only benchmark tests")
    p_test.add_argument("--no-coverage", action="store_true", help="Disable coverage reporting")
    p_test.add_argument("-v", "--verbose", action="store_true", help="Verbose test output")
    p_test.add_argument("file", nargs="?", help="Run a specific test file")

    # lint
    p_lint = subparsers.add_parser("lint", help="Run ruff linting")
    p_lint.add_argument("--fix", action="store_true", help="Automatically fix issues")
    p_lint.add_argument("--show-fixes", action="store_true", help="Show available fixes")
    p_lint.add_argument("path", nargs="?", help="Target path (default: all source dirs)")

    # format
    p_format = subparsers.add_parser("format", help="Auto-format code")
    p_format.add_argument("--check", action="store_true", help="Check only, do not modify files")

    # typecheck
    p_typecheck = subparsers.add_parser("typecheck", help="Run mypy type checking")
    p_typecheck.add_argument("--strict", action="store_true", help="Enable strict mode")

    # health
    subparsers.add_parser("health", help="Run repository health checks")

    # bench
    p_bench = subparsers.add_parser("bench", help="Run benchmarks")
    p_bench.add_argument("--compare", metavar="REF", help="Compare against a benchmark reference")
    p_bench.add_argument("--min-rounds", type=int, help="Minimum number of benchmark rounds")

    # docs-validate
    subparsers.add_parser("docs-validate", help="Validate documentation")

    # clean
    subparsers.add_parser("clean", help="Remove build artifacts and caches")

    return parser


# -- Dispatch -----------------------------------------------------------------
COMMANDS: Final[dict[str, callable]] = {
    "setup": cmd_setup,
    "validate": cmd_validate,
    "test": cmd_test,
    "lint": cmd_lint,
    "format": cmd_format,
    "typecheck": cmd_typecheck,
    "health": cmd_health,
    "bench": cmd_bench,
    "docs-validate": cmd_docs_validate,
    "clean": cmd_clean,
}


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(0)

    command_func = COMMANDS.get(args.command)
    if command_func is None:
        _fail(f"Unknown command: {args.command}")
        parser.print_help()
        sys.exit(1)

    command_func(args)


if __name__ == "__main__":
    main()
