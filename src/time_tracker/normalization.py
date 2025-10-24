"""Utilities to normalize process and window titles."""

from __future__ import annotations

import re
from typing import Optional

_BROWSER_SUFFIXES: dict[str, tuple[str, ...]] = {
    "msedge.exe": (" - Microsoft Edge",),
    "chrome.exe": (" - Google Chrome",),
    "firefox.exe": (" - Mozilla Firefox",),
    "brave.exe": (" - Brave",),
    "opera.exe": (" - Opera",),
}


def normalize_window_title(process_name: Optional[str], window_title: Optional[str]) -> Optional[str]:
    """Remove common browser suffixes to surface tab names."""
    if not window_title:
        return None
    normalized = window_title.strip()
    if not process_name:
        return normalized or None

    suffixes = _BROWSER_SUFFIXES.get(process_name.lower())
    if suffixes:
        for suffix in suffixes:
            if normalized.endswith(suffix):
                normalized = normalized[: -len(suffix)].rstrip(" -")
                break

    normalized = _strip_tab_count(normalized)
    normalized = re.sub(r"\s{2,}", " ", normalized).strip()
    return normalized or None


_EXTRA_TAB_COUNT_PATTERN = re.compile(r"\s+and\s+\d+\s+more\s+pages?", re.IGNORECASE)


def _strip_tab_count(value: str) -> str:
    cleaned = _EXTRA_TAB_COUNT_PATTERN.sub("", value)
    return cleaned.strip(" -|")
