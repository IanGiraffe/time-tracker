"""Helpers for locating application directories."""

from __future__ import annotations

from pathlib import Path

from platformdirs import PlatformDirs


APP_NAME = "TimeTracker"
APP_AUTHOR = "TimeTracker"


def get_data_dir() -> Path:
    """Return the base directory for persistent data."""
    dirs = PlatformDirs(appname=APP_NAME, appauthor=APP_AUTHOR, roaming=True)
    path = Path(dirs.user_data_path)
    path.mkdir(parents=True, exist_ok=True)
    return path


def get_db_path() -> Path:
    return get_data_dir() / "activity.sqlite3"


def get_log_path() -> Path:
    return get_data_dir() / "collector.log"

