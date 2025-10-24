"""Activity collector implementation for Windows."""

from __future__ import annotations

import ctypes
import logging
import threading
from ctypes import wintypes
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Optional

import psutil

from .config import CollectorSettings
from .db import insert_events, open_database
from .models import ActivityEvent
from .normalization import normalize_window_title

logger = logging.getLogger(__name__)


class WindowsIdleDetector:
    """Detects idle state using Win32 APIs."""

    class LASTINPUTINFO(ctypes.Structure):
        _fields_ = [("cbSize", wintypes.UINT), ("dwTime", wintypes.DWORD)]

    def __init__(self) -> None:
        self._user32 = ctypes.windll.user32  # type: ignore[attr-defined]
        self._kernel32 = ctypes.windll.kernel32  # type: ignore[attr-defined]

    def milliseconds_since_input(self) -> int:
        last_input = self.LASTINPUTINFO()
        last_input.cbSize = ctypes.sizeof(last_input)
        if not self._user32.GetLastInputInfo(ctypes.byref(last_input)):
            raise ctypes.WinError()
        elapsed = self._kernel32.GetTickCount64() - last_input.dwTime
        return int(elapsed)

    def is_idle(self, threshold_ms: int) -> bool:
        try:
            idle_ms = self.milliseconds_since_input()
            return idle_ms >= threshold_ms
        except Exception:  # pragma: no cover - defensive log path
            logger.exception("Failed to query idle state; assuming not idle.")
            return False


class WindowsActiveWindowProbe:
    """Retrieves the foreground window title and process name."""

    def __init__(self) -> None:
        self._user32 = ctypes.windll.user32  # type: ignore[attr-defined]
        self._kernel32 = ctypes.windll.kernel32  # type: ignore[attr-defined]

    def get_active_window(self) -> tuple[Optional[str], Optional[str]]:
        hwnd = self._user32.GetForegroundWindow()
        if not hwnd:
            return None, None

        length = self._user32.GetWindowTextLengthW(hwnd)
        buffer = ctypes.create_unicode_buffer(length + 1)
        self._user32.GetWindowTextW(hwnd, buffer, length + 1)
        window_title = buffer.value.strip() or None

        pid = wintypes.DWORD()
        self._user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        process_name: Optional[str]
        try:
            if pid.value:
                process_name = psutil.Process(pid.value).name()
            else:
                process_name = None
        except (psutil.Error, ProcessLookupError):
            process_name = None

        return process_name, window_title


@dataclass(slots=True)
class CollectorState:
    current_event: Optional[ActivityEvent] = None
    last_flush_time: datetime = field(default_factory=datetime.now)


class ActivityCollector:
    """Samples foreground activity at a fixed interval and writes to SQLite."""

    def __init__(self, db_path: Path, settings: CollectorSettings) -> None:
        self.db_path = Path(db_path)
        self.settings = settings
        self._probe = WindowsActiveWindowProbe()
        self._idle_detector = WindowsIdleDetector()
        self._conn = open_database(self.db_path, check_same_thread=False)
        self._state = CollectorState()
        self._pending: list[ActivityEvent] = []
        self._lock = threading.Lock()

    def run_forever(self) -> None:
        stop_event = threading.Event()
        try:
            self._run_loop(stop_event)
        except KeyboardInterrupt:
            logger.info("Collector interrupted; flushing remaining events.")
        finally:
            self._shutdown(force=True)

    def run_until_stopped(self, stop_event: threading.Event) -> None:
        """Run the collector until the provided event is set."""
        try:
            self._run_loop(stop_event)
        finally:
            self._shutdown(force=True)

    def sample_once(self) -> None:
        now = datetime.now()
        idle = self._idle_detector.is_idle(
            int(self.settings.idle_threshold.total_seconds() * 1000)
        )
        if idle:
            sample = self._create_or_extend_event(now, None, None, True)
        else:
            process_name, window_title = self._probe.get_active_window()
            window_title = normalize_window_title(process_name, window_title)
            sample = self._create_or_extend_event(
                now, process_name, window_title, False
            )
        if sample:
            logger.debug(
                "Event updated: idle=%s process=%s title=%s",
                sample.is_idle,
                sample.process_name,
                sample.window_title,
            )

    def _create_or_extend_event(
        self,
        timestamp: datetime,
        process_name: Optional[str],
        window_title: Optional[str],
        is_idle: bool,
    ) -> Optional[ActivityEvent]:
        with self._lock:
            current = self._state.current_event
            if current and self._matches(current, process_name, window_title, is_idle):
                current.end_time = timestamp
                return current

            if current:
                current.end_time = timestamp
                self._pending.append(current)

            new_event = ActivityEvent(
                start_time=timestamp,
                end_time=timestamp,
                process_name=process_name,
                window_title=window_title,
                is_idle=is_idle,
            )
            self._state.current_event = new_event
            return new_event

    def flush_if_needed(self) -> None:
        with self._lock:
            elapsed = datetime.now() - self._state.last_flush_time
            if elapsed >= self.settings.flush_interval and self._pending:
                self._flush_locked()

    def flush(self, force: bool = False) -> None:
        with self._lock:
            if force and self._state.current_event:
                self._state.current_event.end_time = datetime.now()
                self._pending.append(self._state.current_event)
                self._state.current_event = None
            if force or self._pending:
                self._flush_locked()

    def _flush_locked(self) -> None:
        if not self._pending:
            return
        insert_events(self._conn, self._pending)
        logger.debug("Flushed %d events.", len(self._pending))
        self._pending.clear()
        self._state.last_flush_time = datetime.now()

    @staticmethod
    def _matches(
        event: ActivityEvent,
        process_name: Optional[str],
        window_title: Optional[str],
        is_idle: bool,
    ) -> bool:
        return (
            event.is_idle == is_idle
            and event.process_name == process_name
            and event.window_title == window_title
        )

    def _run_loop(self, stop_event: threading.Event) -> None:
        logger.info("Starting collector; writing to %s", self.db_path)
        interval = self.settings.sample_interval.total_seconds()
        while not stop_event.is_set():
            self.sample_once()
            self.flush_if_needed()
            # Sleep in an interruptible manner.
            stop_event.wait(interval)

    def _shutdown(self, force: bool) -> None:
        try:
            self.flush(force=force)
        finally:
            self._conn.close()
            logger.info("Collector stopped.")
