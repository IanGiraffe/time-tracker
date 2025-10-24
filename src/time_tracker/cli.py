"""Command-line interface for the time tracker."""

from __future__ import annotations

import logging
from datetime import datetime
from pathlib import Path
from typing import Optional

import typer

from .config import CollectorSettings
from .server_runner import run_dashboard
from .paths import get_db_path

app = typer.Typer(help="Local-first activity tracker.")


@app.callback(no_args_is_help=True)
def main(verbose: bool = typer.Option(False, "--verbose", "-v", help="Enable verbose logs.")) -> None:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )


@app.command()
def collect(
    db_path: Optional[Path] = typer.Option(
        None,
        "--db",
        path_type=Path,
        help="Location of the activity SQLite database.",
    ),
    sample_seconds: float = typer.Option(
        5.0,
        "--interval",
        min=1.0,
        help="Sampling interval in seconds.",
    ),
    idle_minutes: float = typer.Option(
        5.0,
        "--idle-threshold",
        min=0.5,
        help="Minutes of inactivity before counting time as idle.",
    ),
) -> None:
    """Run the background collector until interrupted."""
    from .collector import ActivityCollector

    db_path = db_path or get_db_path()
    settings = CollectorSettings.from_intervals(
        sample_seconds=sample_seconds, idle_minutes=idle_minutes
    )
    collector = ActivityCollector(db_path=db_path, settings=settings)
    collector.run_forever()


@app.command()
def summary(
    date: Optional[str] = typer.Option(
        None,
        "--date",
        help="Date (YYYY-MM-DD) to summarize. Defaults to today.",
    ),
    db_path: Optional[Path] = typer.Option(
        None,
        "--db",
        path_type=Path,
        help="Location of the activity SQLite database.",
    ),
) -> None:
    """Print a high-level summary for a specific day."""
    from .reporting import SummaryPrinter

    target = datetime.strptime(date, "%Y-%m-%d") if date else datetime.now()
    summary_printer = SummaryPrinter(db_path=db_path or get_db_path())
    summary_printer.print_daily_summary(target)


@app.command()
def web(
    host: str = typer.Option("127.0.0.1", "--host", help="Interface to bind the dashboard."),
    port: int = typer.Option(
        8765, "--port", min=1, max=65535, help="TCP port for the dashboard."
    ),
    db_path: Optional[Path] = typer.Option(
        None, "--db", path_type=Path, help="Location of the activity SQLite database."
    ),
    sample_seconds: float = typer.Option(
        5.0,
        "--interval",
        min=1.0,
        help="Sampling interval in seconds.",
    ),
    idle_minutes: float = typer.Option(
        5.0,
        "--idle-threshold",
        min=0.5,
        help="Minutes of inactivity before counting time as idle.",
    ),
    flush_seconds: Optional[float] = typer.Option(
        None,
        "--flush-interval",
        min=10.0,
        help="Collector flush interval in seconds (defaults to 6× sampling interval).",
    ),
    open_browser: bool = typer.Option(
        True,
        "--open-browser/--no-open-browser",
        help="Automatically launch the dashboard in your default browser.",
    ),
) -> None:
    """Start the local dashboard with the background collector."""
    settings = CollectorSettings.from_intervals(
        sample_seconds=sample_seconds,
        idle_minutes=idle_minutes,
        flush_seconds=flush_seconds,
    )
    run_dashboard(
        host=host,
        port=port,
        db_path=db_path or get_db_path(),
        settings=settings,
        open_browser=open_browser,
    )
