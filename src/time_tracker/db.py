"""SQLite database layer for activity events."""

from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta
from pathlib import Path
from typing import Iterable, Iterator, Optional

from .models import ActivityEvent


DATETIME_FMT = "%Y-%m-%d %H:%M:%S.%f"

_UNSET = object()


def open_database(path: Path, *, check_same_thread: bool = True) -> sqlite3.Connection:
    """Open (and initialize) the SQLite database."""
    conn = sqlite3.connect(
        path,
        isolation_level=None,
        check_same_thread=check_same_thread,
    )
    conn.row_factory = sqlite3.Row
    enable_foreign_keys(conn)
    initialize_schema(conn)
    return conn


@contextmanager
def database_connection(
    path: Path, *, check_same_thread: bool = True
) -> Iterator[sqlite3.Connection]:
    conn = open_database(path, check_same_thread=check_same_thread)
    try:
        yield conn
    finally:
        conn.close()


def enable_foreign_keys(conn: sqlite3.Connection) -> None:
    conn.execute("PRAGMA foreign_keys = ON;")


def initialize_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS activity_events (
            id INTEGER PRIMARY KEY,
            start_time TEXT NOT NULL,
            end_time TEXT NOT NULL,
            process_name TEXT,
            window_title TEXT,
            is_idle INTEGER NOT NULL DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_events_start_time
            ON activity_events(start_time);
        """
    )


def insert_events(conn: sqlite3.Connection, events: Iterable[ActivityEvent]) -> None:
    conn.executemany(
        """
        INSERT INTO activity_events (
            start_time,
            end_time,
            process_name,
            window_title,
            is_idle
        ) VALUES (?, ?, ?, ?, ?)
        """,
        [
            (
                event.start_time.strftime(DATETIME_FMT),
                event.end_time.strftime(DATETIME_FMT),
                event.process_name,
                event.window_title,
                1 if event.is_idle else 0,
            )
            for event in events
        ],
    )


def fetch_summary_by_day(
    conn: sqlite3.Connection, day: datetime
) -> list[sqlite3.Row]:
    """Return total seconds for each idle flag/process on a given day."""
    start = day.replace(hour=0, minute=0, second=0, microsecond=0)
    end = start + timedelta(days=1)
    start_iso = start.strftime(DATETIME_FMT)
    end_iso = end.strftime(DATETIME_FMT)
    return list(
        conn.execute(
            """
            SELECT
                process_name,
                window_title,
                is_idle,
                SUM(strftime('%s', end_time) - strftime('%s', start_time)) AS seconds
            FROM activity_events
            WHERE start_time >= ? AND start_time < ?
            GROUP BY process_name, window_title, is_idle
            ORDER BY seconds DESC;
            """,
            (start_iso, end_iso),
        )
    )


def fetch_events_for_day(
    conn: sqlite3.Connection, day: datetime
) -> list[sqlite3.Row]:
    """Fetch individual activity events for the provided day."""
    start = day.replace(hour=0, minute=0, second=0, microsecond=0)
    end = start + timedelta(days=1)
    start_iso = start.strftime(DATETIME_FMT)
    end_iso = end.strftime(DATETIME_FMT)
    return list(
        conn.execute(
            """
            SELECT
                id,
                start_time,
                end_time,
                process_name,
                window_title,
                is_idle
            FROM activity_events
            WHERE start_time >= ? AND start_time < ?
            ORDER BY start_time;
            """,
            (start_iso, end_iso),
        )
    )


def update_event(
    conn: sqlite3.Connection,
    event_id: int,
    *,
    start_time: Optional[datetime] = None,
    end_time: Optional[datetime] = None,
    process_name: object = _UNSET,
    window_title: object = _UNSET,
    is_idle: Optional[bool] = None,
) -> None:
    """Update a single event record."""
    fields: list[str] = []
    params: list[object] = []

    if start_time is not None:
        fields.append("start_time = ?")
        params.append(
            start_time.strftime(DATETIME_FMT)
            if isinstance(start_time, datetime)
            else start_time
        )
    if end_time is not None:
        fields.append("end_time = ?")
        params.append(
            end_time.strftime(DATETIME_FMT)
            if isinstance(end_time, datetime)
            else end_time
        )
    if process_name is not _UNSET:
        fields.append("process_name = ?")
        params.append(process_name)
    if window_title is not _UNSET:
        fields.append("window_title = ?")
        params.append(window_title)
    if is_idle is not None:
        fields.append("is_idle = ?")
        params.append(1 if is_idle else 0)

    if not fields:
        return

    params.append(event_id)
    cur = conn.execute(
        f"UPDATE activity_events SET {', '.join(fields)} WHERE id = ?",
        params,
    )
    if cur.rowcount == 0:
        raise ValueError(f"No event found for id={event_id}")
