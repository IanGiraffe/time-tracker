# Time Tracker

Lightweight, local-first tooling to observe where your workday goes without depending on manual entry. The project currently focuses on a Windows collector and a small command-line interface that records active window usage, classifies idle time, and summarizes activity.

## Current Capabilities

- Background collector that samples the active window and process name.
- Idle detection based on user input inactivity.
- SQLite storage for event logs and daily rollups.
- Command-line tools to run the collector and review summaries.
- Local web dashboard to inspect, edit, and categorize your timeline.
- Project assignments that roll up window/app activity into project totals.

## Usage

After installing the project in a Python environment:

```powershell
time-tracker collect
```

The collector runs until you press `Ctrl+C`, writing activity to a local SQLite database (default: `%APPDATA%\TimeTracker\activity.sqlite3`). Review a day's activity with:

```powershell
time-tracker summary --date 2025-10-23
```

Use `--help` on any command to see configuration options like sampling interval, idle threshold, or database path.

### Local Web Dashboard

Launch the collector and browser-based dashboard together:

```powershell
time-tracker web --open-browser
```

The server starts on `http://127.0.0.1:8765` by default, keeps the collector running in the background, and exposes a dashboard for summaries and per-event edits. Override the port, host, or sampling cadence with `--help`.

Prefer to start it without touching a terminal? Double-click `start_dashboard.pyw` from the project root (or create a desktop shortcut to it). The script bootstraps the Python path, runs the collector + API, and opens your browser automatically.

From the Overview tab you can now assign a browser tab or application to a project. Once assigned, new activity for that window/app is automatically rolled into the project totals shown alongside the daily summary.

## Roadmap

1. Foundation (in progress): collector service, persistence layer, CLI summaries.
2. Categorization features, CSV export, and manual overrides.
3. Local web dashboard for richer analytics and editing.
4. Optional notifications, encryption, and integrations.

## Development

Create a Python virtual environment with at least Python 3.10, install the package in editable mode, and run the CLI:

```powershell
python -m venv .venv
.\\.venv\\Scripts\\Activate.ps1
pip install -e ".[dev]"
time-tracker --help
```

Data is stored by default in your platform-specific application data directory (`%APPDATA%\\TimeTracker` on Windows). Adjust paths and configuration via CLI flags or forthcoming config files.
