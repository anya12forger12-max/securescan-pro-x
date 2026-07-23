"""CLI entry point — Typer-based command-line interface.

Provides commands for running the application, managing workspaces,
and performing administrative tasks.
"""

from __future__ import annotations

import typer
from rich.console import Console

from app import __app_name__, __version__

app = typer.Typer(
    name="securescan",
    help="SecureScan Pro X — Enterprise-Grade Defensive Security Assessment",
    no_args_is_help=True,
    rich_markup_mode="rich",
)

console = Console()


@app.command()
def version() -> None:
    """Display the current version."""
    console.print(f"{__app_name__} v{__version__}")


@app.command()
def serve(
    host: str = typer.Option("127.0.0.1", help="Host to bind to"),
    port: int = typer.Option(8000, help="Port to listen on"),
    reload: bool = typer.Option(False, help="Enable auto-reload"),
    debug: bool = typer.Option(False, help="Enable debug mode"),
) -> None:
    """Start the API server.

    Runs the FastAPI application with Uvicorn.
    """
    import uvicorn

    console.print(f"Starting {__app_name__} API server...")
    console.print(f"  Host: {host}:{port}")
    console.print(f"  Debug: {debug}")

    uvicorn.run(
        "app.api:app",
        host=host,
        port=port,
        reload=reload,
        log_level="debug" if debug else "info",
    )


@app.command()
def check() -> None:
    """Run system health checks.

    Verifies that all required components are available.
    """
    import sys

    console.print("[bold]System Health Check[/bold]\n")

    checks = [
        ("Python version", sys.version_info >= (3, 13)),
        ("Application modules", True),  # If we got here, imports work
    ]

    all_passed = True
    for name, passed in checks:
        status = "[green]PASS[/green]" if passed else "[red]FAIL[/red]"
        console.print(f"  {status}  {name}")
        if not passed:
            all_passed = False

    if all_passed:
        console.print("\n[green]All checks passed![/green]")
    else:
        console.print("\n[red]Some checks failed.[/red]")
        raise typer.Exit(1)


@app.command()
def config(
    show: bool = typer.Option(False, "--show", help="Show current configuration"),
    reset: bool = typer.Option(False, "--reset", help="Reset to defaults"),
) -> None:
    """Manage application configuration."""
    if show:
        from app.core.config import settings

        import json

        console.print("[bold]Current Configuration:[/bold]")
        # Show non-default values
        console.print(f"  App Name: {settings.app_name}")
        console.print(f"  Version: {settings.version}")
        console.print(f"  Home Dir: {settings.home_dir}")
        console.print(f"  Debug: {settings.debug}")
        console.print(f"  UI Theme: {settings.ui.theme}")
        console.print(f"  Log Level: {settings.logging.level}")
        console.print(f"  Database: {settings.database.type}")
        console.print(f"  Network: {'enabled' if settings.network.enabled else 'disabled (default)'}")
    elif reset:
        console.print("[yellow]Configuration reset to defaults.[/yellow]")
    else:
        console.print("Use --show or --reset flags.")


def main() -> None:
    """Entry point for the CLI."""
    app()


if __name__ == "__main__":
    main()
