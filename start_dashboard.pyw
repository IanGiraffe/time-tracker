"""
Launch the Time Tracker dashboard without opening a console window.

Double-click this file on Windows to start the collector and web UI, then open
your browser to http://127.0.0.1:8765.
"""

from __future__ import annotations

import sys
from pathlib import Path


def main() -> None:
    repo_root = Path(__file__).resolve().parent
    src_dir = repo_root / "src"
    if src_dir.exists():
        sys.path.insert(0, str(src_dir))

    try:
        from time_tracker.server_runner import run_dashboard  # type: ignore[import]
    except ModuleNotFoundError as exc:  # pragma: no cover - runtime convenience
        _notify_missing_dependency(exc)
        return

    run_dashboard(host="127.0.0.1", port=8765, open_browser=True)


def _notify_missing_dependency(exc: ModuleNotFoundError) -> None:
    message = (
        "The Time Tracker dashboard could not start because the Python package "
        f"'{exc.name}' is not installed.\n\n"
        "Activate your virtual environment and run:\n"
        '    pip install -e "."\n'
        "to install the latest dependencies (including FastAPI and Uvicorn)."
    )
    try:
        import tkinter as tk
        from tkinter import messagebox

        root = tk.Tk()
        root.withdraw()
        messagebox.showerror("Time Tracker Dashboard", message)
        root.destroy()
    except Exception:
        print(message)


if __name__ == "__main__":
    main()
