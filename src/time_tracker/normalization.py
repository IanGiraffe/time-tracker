"""Utilities to normalize process and window titles."""

from __future__ import annotations

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
    if not suffixes:
        return normalized or None

    for suffix in suffixes:
        if normalized.endswith(suffix):
            trimmed = normalized[: -len(suffix)].rstrip(" -")
            if trimmed:
                return trimmed
    return normalized or None

