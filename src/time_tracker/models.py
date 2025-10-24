"""Domain models for recorded activity."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Optional


@dataclass(slots=True)
class ActivityEvent:
    """Represents a contiguous block of time spent in a single activity."""

    start_time: datetime
    end_time: datetime
    process_name: Optional[str]
    window_title: Optional[str]
    is_idle: bool

    @property
    def duration_seconds(self) -> float:
        return (self.end_time - self.start_time).total_seconds()

