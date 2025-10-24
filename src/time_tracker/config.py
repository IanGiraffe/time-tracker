"""Configuration models and helpers for the time tracker."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta


@dataclass(slots=True)
class CollectorSettings:
    """Runtime configuration for the activity collector."""

    sample_interval: timedelta = timedelta(seconds=5)
    idle_threshold: timedelta = timedelta(minutes=5)
    flush_interval: timedelta = timedelta(seconds=30)
    sleep_gap: timedelta = timedelta(minutes=2)

    @classmethod
    def from_intervals(
        cls,
        sample_seconds: float,
        idle_minutes: float,
        flush_seconds: float | None = None,
        sleep_gap_minutes: float | None = None,
    ) -> "CollectorSettings":
        flush = flush_seconds if flush_seconds is not None else max(sample_seconds * 6, 30.0)
        sleep_gap = (
            sleep_gap_minutes if sleep_gap_minutes is not None else max(idle_minutes, 2.0)
        )
        return cls(
            sample_interval=timedelta(seconds=sample_seconds),
            idle_threshold=timedelta(minutes=idle_minutes),
            flush_interval=timedelta(seconds=flush),
            sleep_gap=timedelta(minutes=sleep_gap),
        )
