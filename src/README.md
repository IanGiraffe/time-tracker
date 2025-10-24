### What this app does

Time Tracker collects local activity data, stores it (likely in SQLite), and exposes a FastAPI-powered web dashboard for viewing reports. It includes a CLI to start/stop collection, run the server, and generate summaries.

### Directory overview

- `time_tracker/` — main application package
  - `__init__.py`: Marks package; may expose version or top-level exports.
  - `cli.py`: Command-line interface (likely Typer) to run collect/serve/report commands.
  - `collector.py`: Gathers raw time/activity data (e.g., apps, windows, idle), hands off to storage.
  - `config.py`: Loads/saves application settings and environment-driven config.
  - `db.py`: Database layer (likely SQLite): connections, schema setup, CRUD, queries.
  - `models.py`: Data schemas (likely Pydantic) for activities, sessions, reports.
  - `normalization.py`: Cleans and standardizes raw collected events into canonical models.
  - `paths.py`: Resolves OS-specific paths (config, data, cache) used across the app.
  - `reporting.py`: Aggregations, summaries, and export utilities for reports.
  - `server_runner.py`: Boots the web server (e.g., uvicorn) and manages its lifecycle.
  - `webapp.py`: FastAPI app with HTTP routes serving data to the dashboard.
  - `static/` — frontend assets for the dashboard
    - `index.html`: Dashboard HTML shell.
    - `app.js`: Frontend logic/UI for viewing time data via API.
    - `styles.css`: Dashboard styling.

- `time_tracker.egg-info/` — packaging metadata (generated when installed)
  - `PKG-INFO`, `entry_points.txt`, `requires.txt`, `SOURCES.txt`, `dependency_links.txt`, `top_level.txt`: Distribution info for installers and tooling; not runtime code.


