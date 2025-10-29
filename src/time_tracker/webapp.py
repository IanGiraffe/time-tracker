"""FastAPI application that exposes a local web UI and API for the time tracker."""

from __future__ import annotations

import logging
import threading
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, Optional

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict

from .collector import ActivityCollector
from .config import CollectorSettings
from .db import (
    DATETIME_FMT,
    database_connection,
    fetch_activity_totals,
    fetch_events_for_day,
    fetch_project_mappings,
    fetch_summary_by_day,
    update_event,
    upsert_project_mapping,
)
from .normalization import normalize_window_title
from .paths import get_db_path

logger = logging.getLogger(__name__)


class CollectorRunner:
    """Manage the activity collector in a background thread."""

    def __init__(self, db_path: Path, settings: CollectorSettings) -> None:
        self._db_path = Path(db_path)
        self._settings = settings
        self._lock = threading.Lock()
        self._thread: Optional[threading.Thread] = None
        self._stop_event: Optional[threading.Event] = None

    def start(self) -> None:
        with self._lock:
            if self._thread and self._thread.is_alive():
                return
            stop_event = threading.Event()
            collector = ActivityCollector(db_path=self._db_path, settings=self._settings)
            thread = threading.Thread(
                target=self._run_collector,
                args=(collector, stop_event),
                daemon=True,
            )
            self._thread = thread
            self._stop_event = stop_event
            thread.start()
            logger.info("Collector background thread started.")

    def stop(self) -> None:
        thread: Optional[threading.Thread] = None
        with self._lock:
            if not self._thread or not self._thread.is_alive() or not self._stop_event:
                return
            self._stop_event.set()
            thread = self._thread
            self._thread = None
            self._stop_event = None
        if thread:
            thread.join(timeout=10)
            logger.info("Collector background thread stopped.")

    def is_running(self) -> bool:
        with self._lock:
            return bool(self._thread and self._thread.is_alive())

    @staticmethod
    def _run_collector(collector: ActivityCollector, stop_event: threading.Event) -> None:
        collector.run_until_stopped(stop_event)


class EventUpdate(BaseModel):
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    process_name: Optional[str] = None
    window_title: Optional[str] = None
    is_idle: Optional[bool] = None

    model_config = ConfigDict(extra="forbid")


class ProjectMappingPayload(BaseModel):
    project_name: str
    process_name: Optional[str] = None
    window_title: Optional[str] = None

    model_config = ConfigDict(extra="forbid")


def create_app(
    *,
    db_path: Optional[Path] = None,
    settings: Optional[CollectorSettings] = None,
) -> FastAPI:
    """Instantiate the FastAPI application."""
    resolved_db_path = Path(db_path or get_db_path())
    resolved_settings = settings or CollectorSettings()
    runner = CollectorRunner(resolved_db_path, resolved_settings)

    app = FastAPI(title="Time Tracker", version="0.2.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.state.db_path = resolved_db_path
    app.state.collector_runner = runner

    static_dir = Path(__file__).parent / "static"
    if static_dir.exists():
        app.mount("/static", StaticFiles(directory=static_dir), name="static")

    @app.on_event("startup")
    async def _startup() -> None:
        logging.basicConfig(
            level=logging.INFO,
            format="%(asctime)s %(levelname)s %(name)s %(message)s",
        )
        runner.start()

    @app.on_event("shutdown")
    async def _shutdown() -> None:
        runner.stop()

    @app.get("/api/status")
    def status(request: Request) -> Dict[str, Any]:
        return {
            "collector_running": request.app.state.collector_runner.is_running(),
            "database_path": str(request.app.state.db_path),
            "sample_seconds": resolved_settings.sample_interval.total_seconds(),
            "idle_minutes": resolved_settings.idle_threshold.total_seconds() / 60.0,
        }

    @app.get("/api/overview")
    def overview(
        request: Request,
        start: Optional[str] = Query(
            default=None,
            description="Start date in YYYY-MM-DD format (inclusive).",
        ),
        end: Optional[str] = Query(
            default=None,
            description="End date in YYYY-MM-DD format (inclusive).",
        ),
    ) -> Dict[str, Any]:
        start_day = _parse_date(start)
        end_day = _parse_date(end) if end else start_day
        if end_day < start_day:
            raise HTTPException(
                status_code=400, detail="end date must be on or after start date"
            )
        end_exclusive = end_day + timedelta(days=1)

        with database_connection(request.app.state.db_path) as conn:
            rows = fetch_activity_totals(conn, start_day, end_exclusive)
            mapping_rows = fetch_project_mappings(conn)

        buckets: dict[tuple[Optional[str], Optional[str], bool], int] = defaultdict(int)
        for row in rows:
            seconds = int(row["seconds"] or 0)
            title = _canonical_window_title(row["process_name"], row["window_title"])
            key = (row["process_name"], title, bool(row["is_idle"]))
            buckets[key] += seconds

        project_lookup = _build_project_lookup(mapping_rows)
        active_entries: list[Dict[str, Any]] = []
        idle_entries: list[Dict[str, Any]] = []
        project_totals: dict[str, int] = defaultdict(int)
        total_active = 0
        total_idle = 0
        for (process_name, title, is_idle), seconds in buckets.items():
            project_name: Optional[str] = None
            if not is_idle:
                project_name = _resolve_project(project_lookup, process_name, title)
                if project_name:
                    project_totals[project_name] += seconds
            entry = {
                "process_name": process_name,
                "window_title": title,
                "seconds": seconds,
                "is_idle": is_idle,
                "project_name": project_name,
            }
            if is_idle:
                total_idle += seconds
                idle_entries.append(entry)
            else:
                total_active += seconds
                active_entries.append(entry)

        active_entries.sort(key=lambda item: item["seconds"], reverse=True)
        idle_entries.sort(key=lambda item: item["seconds"], reverse=True)
        project_entries = [
            {"project_name": name, "seconds": total}
            for name, total in sorted(
                project_totals.items(), key=lambda item: item[1], reverse=True
            )
        ]

        return {
            "start": start_day.strftime("%Y-%m-%d"),
            "end": end_day.strftime("%Y-%m-%d"),
            "totals": {
                "active_seconds": total_active,
                "idle_seconds": total_idle,
                "overall_seconds": total_active + total_idle,
            },
            "entries": active_entries,
            "idle_entries": idle_entries,
            "project_totals": project_entries,
        }

    @app.get("/api/project-mappings")
    def list_project_mappings(request: Request) -> Dict[str, Any]:
        with database_connection(request.app.state.db_path) as conn:
            rows = fetch_project_mappings(conn)
        mappings_payload = [
            {
                "id": row["id"],
                "project_name": row["project_name"],
                "process_name": row["process_name"],
                "window_title": row["window_title"],
                "created_at": row["created_at"],
                "updated_at": row["updated_at"],
            }
            for row in rows
        ]
        project_names = sorted(
            {row["project_name"] for row in rows if row["project_name"]},
            key=str.casefold,
        )
        return {
            "mappings": mappings_payload,
            "projects": project_names,
        }

    @app.post("/api/project-mappings")
    def create_or_update_project_mapping(
        payload: ProjectMappingPayload, request: Request
    ) -> Dict[str, Any]:
        project_name = payload.project_name.strip()
        if not project_name:
            raise HTTPException(status_code=400, detail="project_name is required")

        process_name = payload.process_name.strip() if payload.process_name else None
        canonical_title = (
            _canonical_window_title(process_name, payload.window_title)
            if payload.window_title
            else None
        )
        normalized_process = _normalize_process_name(process_name)

        with database_connection(request.app.state.db_path) as conn:
            try:
                upsert_project_mapping(
                    conn,
                    project_name,
                    process_name=normalized_process,
                    window_title=canonical_title,
                )
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc
            row = conn.execute(
                """
                SELECT id, project_name, process_name, window_title, created_at, updated_at
                FROM project_mappings
                WHERE
                    ((? IS NULL AND process_name IS NULL) OR process_name = ?)
                    AND
                    ((? IS NULL AND window_title IS NULL) OR window_title = ?)
                """,
                (
                    normalized_process,
                    normalized_process,
                    canonical_title,
                    canonical_title,
                ),
            ).fetchone()

        if row is None:
            raise HTTPException(status_code=500, detail="Failed to persist mapping.")

        return {
            "mapping": {
                "id": row["id"],
                "project_name": row["project_name"],
                "process_name": row["process_name"],
                "window_title": row["window_title"],
                "created_at": row["created_at"],
                "updated_at": row["updated_at"],
            }
        }

    @app.get("/api/summary")
    def summary(
        request: Request,
        date: Optional[str] = Query(
            default=None,
            description="Target date in YYYY-MM-DD format.",
        ),
    ) -> Dict[str, Any]:
        target_day = _parse_date(date)
        with database_connection(request.app.state.db_path) as conn:
            rows = fetch_summary_by_day(conn, target_day)
        total_active = sum(row["seconds"] for row in rows if row["is_idle"] == 0)
        total_idle = sum(row["seconds"] for row in rows if row["is_idle"] == 1)
        return {
            "date": target_day.strftime("%Y-%m-%d"),
            "totals": {
                "active_seconds": total_active,
                "idle_seconds": total_idle,
            },
            "entries": [
                {
                    "process_name": row["process_name"],
                    "window_title": row["window_title"],
                    "is_idle": bool(row["is_idle"]),
                    "seconds": row["seconds"],
                }
                for row in rows
            ],
        }

    @app.get("/api/events")
    def events(
        request: Request,
        date: Optional[str] = Query(
            default=None,
            description="Target date in YYYY-MM-DD format.",
        ),
    ) -> Dict[str, Any]:
        target_day = _parse_date(date)
        with database_connection(request.app.state.db_path) as conn:
            rows = fetch_events_for_day(conn, target_day)
        events_payload = [_row_to_event_payload(row) for row in rows]
        return {
            "date": target_day.strftime("%Y-%m-%d"),
            "events": events_payload,
        }

    @app.patch("/api/events/{event_id}")
    def update_event_endpoint(
        event_id: int,
        payload: EventUpdate,
        request: Request,
    ) -> Dict[str, Any]:
        updates = payload.model_dump(exclude_unset=True)
        if updates and "start_time" in updates and "end_time" in updates:
            if updates["end_time"] <= updates["start_time"]:
                raise HTTPException(
                    status_code=400, detail="end_time must be after start_time"
                )
        with database_connection(request.app.state.db_path) as conn:
            try:
                update_event(conn, event_id, **updates)
            except ValueError as exc:
                raise HTTPException(status_code=404, detail="Event not found") from exc
            row = conn.execute(
                """
                SELECT id, start_time, end_time, process_name, window_title, is_idle
                FROM activity_events
                WHERE id = ?
                """,
                (event_id,),
            ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Event not found")
        return _row_to_event_payload(row)

    @app.get("/")
    def index(request: Request):
        index_path = (Path(__file__).parent / "static" / "index.html").resolve()
        if not index_path.exists():
            raise HTTPException(status_code=404, detail="UI not found")
        return FileResponse(index_path)

    return app


def _parse_date(value: Optional[str]) -> datetime:
    if not value:
        return _start_of_day(datetime.now())
    try:
        parsed = datetime.strptime(value, "%Y-%m-%d")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid date format") from exc
    return _start_of_day(parsed)


def _start_of_day(value: datetime) -> datetime:
    return value.replace(hour=0, minute=0, second=0, microsecond=0)


def _canonical_window_title(
    process_name: Optional[str], window_title: Optional[str]
) -> Optional[str]:
    normalized = normalize_window_title(process_name, window_title)
    if normalized:
        return normalized
    if window_title:
        fallback = window_title.strip()
        return fallback or None
    return None


def _normalize_process_name(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    lowered = value.strip().lower()
    return lowered or None


def _build_project_lookup(
    rows: list[Any],
) -> dict[tuple[Optional[str], Optional[str]], str]:
    lookup: dict[tuple[Optional[str], Optional[str]], str] = {}
    for row in rows:
        process_key = _normalize_process_name(row["process_name"])
        title_key = row["window_title"] if row["window_title"] else None
        project_name = row["project_name"].strip()
        if not project_name:
            continue
        lookup[(process_key, title_key)] = project_name
    return lookup


def _resolve_project(
    lookup: dict[tuple[Optional[str], Optional[str]], str],
    process_name: Optional[str],
    window_title: Optional[str],
) -> Optional[str]:
    process_key = _normalize_process_name(process_name)
    title_key = window_title if window_title else None
    candidates = [
        (process_key, title_key),
        (process_key, None),
        (None, title_key),
    ]
    for key in candidates:
        project = lookup.get(key)
        if project:
            return project
    return None


def _row_to_event_payload(row: Any) -> Dict[str, Any]:
    start = datetime.strptime(row["start_time"], DATETIME_FMT)
    end = datetime.strptime(row["end_time"], DATETIME_FMT)
    duration = (end - start).total_seconds()
    return {
        "id": row["id"],
        "start_time": start.isoformat(),
        "end_time": end.isoformat(),
        "process_name": row["process_name"],
        "window_title": row["window_title"],
        "is_idle": bool(row["is_idle"]),
        "duration_seconds": duration,
    }
