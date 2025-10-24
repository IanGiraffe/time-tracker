"""Helpers to launch the local web dashboard."""

from __future__ import annotations

import logging
import threading
import time
import webbrowser
from pathlib import Path
from typing import Optional

import uvicorn

from .config import CollectorSettings
from .paths import get_db_path
from .webapp import create_app


def run_dashboard(
    *,
    host: str = "127.0.0.1",
    port: int = 8765,
    db_path: Optional[Path] = None,
    settings: Optional[CollectorSettings] = None,
    open_browser: bool = True,
    log_level: str = "info",
) -> None:
    """Start the FastAPI dashboard and optional browser tab."""
    app = create_app(
        db_path=db_path or get_db_path(),
        settings=settings or CollectorSettings(),
    )

    if open_browser:
        url = f"http://{host}:{port}"
        threading.Thread(
            target=_launch_browser_after_delay, args=(url,), daemon=True
        ).start()

    logging.getLogger("uvicorn.error").setLevel(log_level.upper())
    uvicorn.run(app, host=host, port=port, log_level=log_level)


def _launch_browser_after_delay(url: str) -> None:
    time.sleep(1.0)
    try:
        webbrowser.open(url)
    except Exception:
        logging.getLogger(__name__).exception("Failed to launch browser for %s", url)
