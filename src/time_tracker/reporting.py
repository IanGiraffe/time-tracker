"""Simple reporting utilities for CLI output."""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Iterable, Optional

from .db import database_connection, fetch_summary_by_day


class SummaryPrinter:
    """Render human-readable summaries in the console."""

    def __init__(self, db_path: Path) -> None:
        self.db_path = Path(db_path)

    def print_daily_summary(self, day: datetime) -> None:
        with database_connection(self.db_path) as conn:
            rows = fetch_summary_by_day(conn, day)
        if not rows:
            print("No activity recorded for the selected day.")
            return

        total_active = sum(row["seconds"] for row in rows if row["is_idle"] == 0)
        total_idle = sum(row["seconds"] for row in rows if row["is_idle"] == 1)

        print(f"Summary for {day.strftime('%Y-%m-%d')}")
        print("-" * 40)
        print(f"Active time: {format_duration(total_active)}")
        print(f"Idle time:   {format_duration(total_idle)}")
        print()

        top_entries = aggregate_by_process(rows)
        if top_entries:
            print("Top activities:")
            for process, seconds in top_entries[:5]:
                print(f"  {process:<30} {format_duration(seconds)}")

        top_windows = aggregate_top_windows(rows)
        if top_windows:
            print()
            print("Top windows / tabs:")
            for process, window, seconds in top_windows[:5]:
                label = window or "(untitled)"
                print(f"  {process:<12} {label[:45]:<45} {format_duration(seconds)}")


def aggregate_by_process(rows: Iterable[dict]) -> list[tuple[str, float]]:
    totals: defaultdict[str, float] = defaultdict(float)
    for row in rows:
        if row["is_idle"] == 1:
            continue
        process = row["process_name"] or "Unknown"
        totals[process] += row["seconds"]
    return sorted(totals.items(), key=lambda item: item[1], reverse=True)


def aggregate_top_windows(rows: Iterable[dict]) -> list[tuple[str, Optional[str], float]]:
    totals: defaultdict[tuple[str, Optional[str]], float] = defaultdict(float)
    for row in rows:
        if row["is_idle"] == 1:
            continue
        process = row["process_name"] or "Unknown"
        window = row["window_title"]
        totals[(process, window)] += row["seconds"]
    sorted_items = sorted(totals.items(), key=lambda item: item[1], reverse=True)
    return [(proc, window, seconds) for (proc, window), seconds in sorted_items]


def format_duration(seconds: float) -> str:
    total_seconds = int(round(seconds))
    hours, remainder = divmod(total_seconds, 3600)
    minutes, secs = divmod(remainder, 60)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}"
