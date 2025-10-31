const statusIndicator = document.getElementById("collector-status");
const projectBar = document.getElementById("project-bar");
const navButtons = Array.from(document.querySelectorAll(".nav-tab"));
const toast = document.getElementById("toast");

class OverviewView {
    constructor() {
        this.root = document.getElementById("overview-view");
        this.startInput = document.getElementById("overview-start");
        this.endInput = document.getElementById("overview-end");
        this.applyButton = document.getElementById("overview-apply");
        this.todayButton = document.getElementById("overview-today");
        this.summaryContainer = document.getElementById("overview-summary");
        this.tableBody = document.querySelector("#overview-table tbody");
        this.idleTableBody = document.querySelector("#idle-table tbody");
        this.projectTableBody = document.querySelector("#projects-table tbody");
        this.projectBarEl = projectBar;
        this.knownProjects = [];
        this.projectOptionsId = `project-options-${Math.random().toString(36).slice(2, 8)}`;
        this.projectOptionsList = document.createElement("datalist");
        this.projectOptionsList.id = this.projectOptionsId;
        document.body.appendChild(this.projectOptionsList);
        this.lastProjectName = "";
    }

    normalizeProjectList(names) {
        const map = new Map();
        if (Array.isArray(names)) {
            for (const raw of names) {
                if (typeof raw !== "string") {
                    continue;
                }
                const trimmed = raw.trim();
                if (!trimmed) {
                    continue;
                }
                const key = trimmed.toLowerCase();
                if (!map.has(key)) {
                    map.set(key, trimmed);
                }
            }
        }
        return Array.from(map.values()).sort((a, b) =>
            a.localeCompare(b, undefined, { sensitivity: "base" })
        );
    }

    updateProjectOptionsList(projectNames) {
        if (!this.projectOptionsList) {
            return;
        }
        this.projectOptionsList.innerHTML = "";
        for (const name of projectNames) {
            const option = document.createElement("option");
            option.value = name;
            this.projectOptionsList.appendChild(option);
        }
    }

    mergeProjectNames(names) {
        const merged = this.normalizeProjectList([...(this.knownProjects ?? []), ...(names ?? [])]);
        const hasChanged =
            merged.length !== this.knownProjects.length ||
            merged.some((value, index) => value !== this.knownProjects[index]);
        if (hasChanged) {
            this.knownProjects = merged;
            this.updateProjectOptionsList(merged);
        }
    }

    init() {
        this.applyButton.addEventListener("click", () => {
            const range = this.getNormalizedRange();
            if (range) {
                void this.refresh(range);
            }
        });

        this.todayButton.addEventListener("click", () => {
            this.setToday();
            void this.refresh();
        });

        [this.startInput, this.endInput].forEach((input) =>
            input.addEventListener("change", () => {
                const range = this.getNormalizedRange(false);
                if (range) {
                    void this.refresh(range);
                }
            })
        );

        this.setToday();
    }

    async activate() {
        if (!this.startInput.value || !this.endInput.value) {
            this.setToday();
        }
        await this.loadProjectMappings();
        await this.refresh();
    }

    async refresh(rangeOverride) {
        const range = rangeOverride ?? this.getNormalizedRange();
        if (!range) {
            return;
        }

        void refreshStatus();

        try {
            const params = new URLSearchParams({
                start: range.start,
                end: range.end,
            });
            const response = await fetch(`/api/overview?${params.toString()}`);
            if (!response.ok) {
                throw new Error(`Overview request failed: ${response.status}`);
            }
            const data = await response.json();
            this.renderOverview(data);
        } catch (error) {
            console.error(error);
            this.renderError();
            showToast("Unable to load overview.", true);
        }
    }

    async loadProjectMappings() {
        try {
            const response = await fetch("/api/project-mappings");
            if (!response.ok) {
                throw new Error(`Projects request failed: ${response.status}`);
            }
            const data = await response.json();
            const projectNames = this.normalizeProjectList(data?.projects ?? []);
            this.knownProjects = projectNames;
            this.updateProjectOptionsList(projectNames);
        } catch (error) {
            console.error(error);
        }
    }

    setToday() {
        const today = formatDateForInput(new Date());
        this.startInput.value = today;
        this.endInput.value = today;
    }

    getNormalizedRange(showToastOnMissing = true) {
        let start = this.startInput.value;
        let end = this.endInput.value;
        if (!start || !end) {
            if (showToastOnMissing) {
                showToast("Select both start and end dates.", true);
            }
            return null;
        }
        if (start > end) {
            [start, end] = [end, start];
            this.startInput.value = start;
            this.endInput.value = end;
        }
        return { start, end };
    }

    renderOverview(data) {
        const totals = data?.totals ?? {};
        const entries = Array.isArray(data?.entries) ? data.entries : [];
        const idleEntries = Array.isArray(data?.idle_entries) ? data.idle_entries : [];
        const projectTotals = Array.isArray(data?.project_totals) ? data.project_totals : [];

        this.summaryContainer.innerHTML = `
            <div class="summary-tile">
                <h3>Active</h3>
                <div class="value">${formatDuration(totals.active_seconds ?? 0)}</div>
            </div>
            <div class="summary-tile">
                <h3>Idle / Away</h3>
                <div class="value">${formatDuration(totals.idle_seconds ?? 0)}</div>
            </div>
            <div class="summary-tile">
                <h3>Total Logged</h3>
                <div class="value">${formatDuration(totals.overall_seconds ?? 0)}</div>
            </div>
        `;

        this.renderActiveTable(entries);
        this.renderIdleTable(idleEntries);
        this.renderProjectTable(projectTotals);

        // Render project totals bar across the top
        if (this.projectBarEl) {
            if (projectTotals.length) {
                this.projectBarEl.hidden = false;
                this.projectBarEl.innerHTML = projectTotals
                    .map((item) => {
                        const name = item?.project_name ?? "Unnamed";
                        const seconds = Number(item?.seconds ?? 0);
                        return `<span class="project-pill"><span class="name">${escapeHtml(name)}</span><span class="value">${formatDuration(seconds)}</span></span>`;
                    })
                    .join("");
            } else {
                this.projectBarEl.hidden = true;
                this.projectBarEl.innerHTML = "";
            }
        }

        if (projectTotals.length) {
            const newNames = projectTotals
                .map((item) => (typeof item?.project_name === "string" ? item.project_name : null))
                .filter((name) => typeof name === "string" && name.trim().length > 0)
                .map((name) => name.trim());
            if (newNames.length) {
                this.mergeProjectNames(newNames);
            }
        }
    }

    renderActiveTable(entries) {
        this.tableBody.innerHTML = "";
        if (!entries.length) {
            this.tableBody.appendChild(
                createEmptyRow(4, "No active activity recorded for this range.")
            );
            return;
        }

        const MIN_SIGNIFICANT_SECONDS = 60;
        const significantEntries = [];
        const quickEntries = [];
        for (const entry of entries) {
            const seconds = Number(entry.seconds ?? 0);
            if (seconds < MIN_SIGNIFICANT_SECONDS) {
                quickEntries.push(entry);
            } else {
                significantEntries.push(entry);
            }
        }

        const renderEntryRow = (entry) => {
            const row = document.createElement("tr");
            const labelCell = document.createElement("td");
            labelCell.textContent = formatEntryLabel(entry);

            const processCell = document.createElement("td");
            processCell.textContent = entry.process_name ?? "-";

            const projectCell = document.createElement("td");
            projectCell.className = "project-cell";
            const selectorWrap = document.createElement("div");
            selectorWrap.className = "project-selector-wrap";

            const projectInput = document.createElement("input");
            projectInput.type = "text";
            projectInput.className = "project-selector";
            projectInput.placeholder = "Select or type project";
            projectInput.value = entry.project_name ?? "";
            projectInput.dataset.initialValue = entry.project_name ?? "";
            projectInput.setAttribute("list", this.projectOptionsId);
            projectInput.autocomplete = "off";
            projectInput.spellcheck = false;
            if (!entry.project_name && this.lastProjectName) {
                projectInput.placeholder = `e.g. ${this.lastProjectName}`;
            }

            const pickerButton = document.createElement("button");
            pickerButton.type = "button";
            pickerButton.className = "project-picker-button";
            pickerButton.setAttribute("aria-label", "Show project suggestions");
            pickerButton.addEventListener("click", () => {
                projectInput.focus();
                if (typeof projectInput.showPicker === "function") {
                    projectInput.showPicker();
                }
            });

            selectorWrap.append(projectInput, pickerButton);

            const statusLabel = document.createElement("span");
            statusLabel.className = "project-status";

            const updateStatusForInput = () => {
                const normalized = projectInput.value.trim();
                const original = (projectInput.dataset.initialValue ?? "").trim();
                if (normalized !== original) {
                    statusLabel.textContent = "Unsaved";
                    statusLabel.classList.add("visible");
                    statusLabel.classList.remove("error");
                } else {
                    statusLabel.textContent = "";
                    statusLabel.classList.remove("visible");
                    statusLabel.classList.remove("error");
                }
            };

            projectInput.addEventListener("input", updateStatusForInput);

            projectInput.addEventListener("keydown", (event) => {
                if (event.key === "Enter") {
                    event.preventDefault();
                    projectInput.blur();
                } else if (event.key === "Escape") {
                    event.preventDefault();
                    projectInput.value = projectInput.dataset.initialValue ?? "";
                    updateStatusForInput();
                    projectInput.dataset.skipCommit = "true";
                    projectInput.blur();
                }
            });

            projectInput.addEventListener("blur", () => {
                if (projectInput.dataset.skipCommit === "true") {
                    delete projectInput.dataset.skipCommit;
                    return;
                }
                void this.handleProjectCommit(entry, projectInput, statusLabel);
            });

            projectCell.append(selectorWrap, statusLabel);
            updateStatusForInput();

            const durationCell = document.createElement("td");
            durationCell.className = "numeric-cell";
            durationCell.textContent = formatDuration(entry.seconds ?? 0);

            row.append(labelCell, processCell, projectCell, durationCell);
            this.tableBody.appendChild(row);
        };

        if (significantEntries.length) {
            for (const entry of significantEntries) {
                renderEntryRow(entry);
            }
        }
        if (quickEntries.length) {
            if (significantEntries.length) {
                this.tableBody.appendChild(
                    createDividerRow(4, "Quick hits (under 1 minute)")
                );
            }
            for (const entry of quickEntries) {
                renderEntryRow(entry);
            }
        }
    }

    renderIdleTable(entries) {
        this.idleTableBody.innerHTML = "";
        if (!entries.length) {
            this.idleTableBody.appendChild(createEmptyRow(2, "No idle time detected for this range."));
            return;
        }

        for (const entry of entries) {
            const row = document.createElement("tr");
            const labelCell = document.createElement("td");
            labelCell.textContent = formatEntryLabel(entry, "Idle");

            const durationCell = document.createElement("td");
            durationCell.className = "numeric-cell";
            durationCell.textContent = formatDuration(entry.seconds ?? 0);

            row.append(labelCell, durationCell);
            this.idleTableBody.appendChild(row);
        }
    }

    renderProjectTable(entries) {
        this.projectTableBody.innerHTML = "";
        if (!Array.isArray(entries) || !entries.length) {
            this.projectTableBody.appendChild(
                createEmptyRow(2, "No project time recorded for this range.")
            );
            return;
        }
        for (const item of entries) {
            const row = document.createElement("tr");
            const nameCell = document.createElement("td");
            nameCell.textContent = item?.project_name ?? "Unnamed";
            const durationCell = document.createElement("td");
            durationCell.className = "numeric-cell";
            durationCell.textContent = formatDuration(item?.seconds ?? 0);
            row.append(nameCell, durationCell);
            this.projectTableBody.appendChild(row);
        }
    }

    async handleProjectCommit(entry, projectInput, statusLabel) {
        const originalValue = (projectInput.dataset.initialValue ?? "").trim();
        const nextValue = projectInput.value.trim();

        if (!nextValue && !originalValue) {
            statusLabel.textContent = "";
            statusLabel.classList.remove("visible", "error");
            return;
        }
        if (nextValue === originalValue) {
            statusLabel.textContent = "";
            statusLabel.classList.remove("visible", "error");
            return;
        }

        const sanitized = sanitizeNullable(projectInput.value ?? "");
        if (!sanitized) {
            showToast("Project name is required.", true);
            projectInput.value = projectInput.dataset.initialValue ?? "";
            statusLabel.textContent = "";
            statusLabel.classList.remove("visible", "error");
            return;
        }

        const payload = {
            project_name: sanitized,
        };
        if (entry.process_name) {
            payload.process_name = entry.process_name;
        }
        if (entry.window_title) {
            payload.window_title = entry.window_title;
        }

        projectInput.disabled = true;
        projectInput.classList.add("saving");
        statusLabel.textContent = "Saving…";
        statusLabel.classList.add("visible");
        statusLabel.classList.remove("error");

        try {
            const response = await fetch("/api/project-mappings", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            if (!response.ok) {
                const detail = await response.json().catch(() => ({}));
                const message =
                    typeof detail?.detail === "string"
                        ? detail.detail
                        : `Assignment failed (${response.status})`;
                throw new Error(message);
            }

            projectInput.dataset.initialValue = sanitized;
            statusLabel.textContent = "Saved";
            statusLabel.classList.remove("error");
            this.lastProjectName = sanitized;
            this.mergeProjectNames([sanitized]);
            showToast(`Assigned to ${sanitized}.`);

            await this.loadProjectMappings();
            const currentRange = this.getNormalizedRange(false);
            if (currentRange) {
                void this.refresh(currentRange);
            } else {
                void this.refresh();
            }
        } catch (error) {
            console.error(error);
            statusLabel.textContent = "Failed";
            statusLabel.classList.add("error");
            showToast(
                error instanceof Error ? error.message : "Failed to assign project.",
                true
            );
            projectInput.value = projectInput.dataset.initialValue ?? "";
        } finally {
            projectInput.disabled = false;
            projectInput.classList.remove("saving");
            window.setTimeout(() => {
                statusLabel.classList.remove("visible");
                statusLabel.classList.remove("error");
            }, 1600);
        }
    }

    renderError() {
        this.summaryContainer.innerHTML = `<p class="error">Overview not available.</p>`;
        this.tableBody.innerHTML = "";
        this.tableBody.appendChild(createEmptyRow(4, "No data available."));
        this.idleTableBody.innerHTML = "";
        this.idleTableBody.appendChild(createEmptyRow(2, "No data available."));
        if (this.projectTableBody) {
            this.projectTableBody.innerHTML = "";
            this.projectTableBody.appendChild(createEmptyRow(2, "No data available."));
        }
        if (this.projectBarEl) {
            this.projectBarEl.hidden = true;
            this.projectBarEl.innerHTML = "";
        }
    }
}

class TimelineView {
    constructor() {
        this.root = document.getElementById("timeline-view");
        this.datePicker = document.getElementById("date-picker");
        this.refreshButton = document.getElementById("refresh-btn");
        this.todayButton = document.getElementById("today-btn");
        this.summaryContent = document.getElementById("summary-content");
        this.eventsTableBody = document.querySelector("#events-table tbody");
        this.editorCard = document.getElementById("editor-card");
        this.editorForm = document.getElementById("editor-form");
        this.cancelEditButton = document.getElementById("cancel-edit-btn");

        this.editorEventId = document.getElementById("editor-event-id");
        this.editorStart = document.getElementById("editor-start");
        this.editorEnd = document.getElementById("editor-end");
        this.editorProcess = document.getElementById("editor-process");
        this.editorWindow = document.getElementById("editor-window");
        this.editorIdle = document.getElementById("editor-idle");

        this.currentEditingEvent = null;
    }

    init() {
        this.setDateToToday();

        this.refreshButton.addEventListener("click", () => {
            void this.refresh();
        });

        this.todayButton.addEventListener("click", () => {
            this.setDateToToday();
            void this.refresh();
        });

        this.datePicker.addEventListener("change", () => {
            void this.refresh();
        });

        this.cancelEditButton.addEventListener("click", () => {
            this.closeEditor();
        });

        this.editorForm.addEventListener("submit", async (event) => {
            event.preventDefault();
            if (!this.currentEditingEvent) {
                return;
            }
            const payload = this.collectEditorPayload();
            if (!this.validateEditorPayload(payload)) {
                return;
            }
            try {
                await this.updateEvent(this.currentEditingEvent.id, payload);
                showToast("Event updated", false);
                this.closeEditor();
                await this.refresh();
            } catch (error) {
                console.error(error);
                showToast("Failed to update event", true);
            }
        });
    }

    deactivate() {
        this.closeEditor();
    }

    async activate() {
        if (!this.datePicker.value) {
            this.setDateToToday();
        }
        await this.refresh();
    }

    setDateToToday() {
        this.datePicker.value = formatDateForInput(new Date());
    }

    async refresh() {
        if (!this.datePicker.value) {
            this.setDateToToday();
        }
        const date = this.datePicker.value;
        void refreshStatus();
        try {
            await Promise.all([this.loadSummary(date), this.loadEvents(date)]);
        } catch (error) {
            console.error(error);
            showToast("Unable to load timeline.", true);
        }
    }

    async loadSummary(date) {
        const response = await fetch(`/api/summary?date=${encodeURIComponent(date)}`);
        if (!response.ok) {
            throw new Error(`Summary request failed: ${response.status}`);
        }
        const data = await response.json();
        this.renderSummary(data);
    }

    renderSummary(data) {
        const totals = data.totals;
        this.summaryContent.innerHTML = `
            <div class="summary-tile">
                <h3>Active</h3>
                <div class="value">${formatDuration(totals.active_seconds)}</div>
            </div>
            <div class="summary-tile">
                <h3>Idle</h3>
                <div class="value">${formatDuration(totals.idle_seconds)}</div>
            </div>
            <div class="summary-tile">
                <h3>Total Logged</h3>
                <div class="value">${formatDuration(totals.active_seconds + totals.idle_seconds)}</div>
            </div>
        `;
    }

    async loadEvents(date) {
        const response = await fetch(`/api/events?date=${encodeURIComponent(date)}`);
        if (!response.ok) {
            throw new Error(`Event request failed: ${response.status}`);
        }
        const data = await response.json();
        this.renderEvents(data.events);
    }

    renderEvents(events) {
        this.eventsTableBody.innerHTML = "";
        if (!events.length) {
            this.eventsTableBody.appendChild(
                createEmptyRow(7, "No events recorded for this date.")
            );
            return;
        }

        for (const event of events) {
            const row = document.createElement("tr");

            const startCell = document.createElement("td");
            startCell.textContent = formatTime(event.start_time);

            const endCell = document.createElement("td");
            endCell.textContent = formatTime(event.end_time);

            const durationCell = document.createElement("td");
            durationCell.textContent = formatDuration(event.duration_seconds);

            const processCell = document.createElement("td");
            processCell.textContent = event.process_name ?? "—";

            const windowCell = document.createElement("td");
            windowCell.textContent = event.window_title ?? "—";

            const idleCell = document.createElement("td");
            idleCell.innerHTML = `
                <span class="tag ${event.is_idle ? "idle" : "active"}">
                    ${event.is_idle ? "Idle" : "Active"}
                </span>
            `;

            const actionsCell = document.createElement("td");
            const editButton = document.createElement("button");
            editButton.type = "button";
            editButton.className = "link";
            editButton.dataset.id = String(event.id);
            editButton.textContent = "Edit";
            editButton.addEventListener("click", () => {
                this.openEditor(event);
            });
            actionsCell.appendChild(editButton);

            row.append(
                startCell,
                endCell,
                durationCell,
                processCell,
                windowCell,
                idleCell,
                actionsCell
            );
            this.eventsTableBody.appendChild(row);
        }
    }

    openEditor(event) {
        this.currentEditingEvent = event;
        this.editorEventId.value = event.id;
        this.editorStart.value = normalizeDateTime(event.start_time);
        this.editorEnd.value = normalizeDateTime(event.end_time);
        this.editorProcess.value = event.process_name ?? "";
        this.editorWindow.value = event.window_title ?? "";
        this.editorIdle.checked = event.is_idle;
        this.editorCard.hidden = false;
        this.editorStart.focus();
    }

    closeEditor() {
        this.currentEditingEvent = null;
        this.editorForm.reset();
        this.editorCard.hidden = true;
    }

    collectEditorPayload() {
        return {
            start_time: this.editorStart.value,
            end_time: this.editorEnd.value,
            process_name: sanitizeNullable(this.editorProcess.value),
            window_title: sanitizeNullable(this.editorWindow.value),
            is_idle: this.editorIdle.checked,
        };
    }

    validateEditorPayload(payload) {
        if (!payload.start_time || !payload.end_time) {
            showToast("Start and end times are required.", true);
            return false;
        }
        const start = new Date(payload.start_time);
        const end = new Date(payload.end_time);
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
            showToast("Invalid date/time values.", true);
            return false;
        }
        if (end <= start) {
            showToast("End time must be after start time.", true);
            return false;
        }
        return true;
    }

    async updateEvent(eventId, payload) {
        const response = await fetch(`/api/events/${eventId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            throw new Error(`Failed to update event: ${response.status}`);
        }
        return response.json();
    }
}

const views = {
    overview: new OverviewView(),
    timeline: new TimelineView(),
};

let activeViewKey = "overview";
function init() {
    Object.values(views).forEach((view) => {
        if (typeof view.init === "function") {
            view.init();
        }
    });

    navButtons.forEach((button) => {
        button.addEventListener("click", () => {
            const viewKey = button.dataset.view;
            if (viewKey) {
                void switchView(viewKey);
            }
        });
    });

    void switchView(activeViewKey, { force: true });
    void refreshStatus();

    setInterval(() => {
        void refreshStatus();
    }, 60000);
}

async function switchView(viewKey, options = {}) {
    if (!(viewKey in views)) {
        return;
    }

    const { force = false } = options;
    if (activeViewKey === viewKey && !force) {
        if (typeof views[viewKey].refresh === "function") {
            await views[viewKey].refresh();
        }
        return;
    }

    navButtons.forEach((button) => {
        button.classList.toggle("active", button.dataset.view === viewKey);
    });

    Object.entries(views).forEach(([key, view]) => {
        const hidden = key !== viewKey;
        view.root.hidden = hidden;
        if (hidden && typeof view.deactivate === "function") {
            view.deactivate();
        }
    });

    activeViewKey = viewKey;
    // Hide project bar when not in overview; Overview will show/update it on render
    if (projectBar) {
        projectBar.hidden = viewKey !== "overview";
    }
    const view = views[viewKey];
    if (typeof view.activate === "function") {
        try {
            await view.activate();
        } catch (error) {
            console.error(error);
            showToast("Unable to load view.", true);
        }
    }
}

async function refreshStatus() {
    try {
        const response = await fetch("/api/status");
        if (!response.ok) {
            throw new Error(`Status request failed: ${response.status}`);
        }
        const data = await response.json();
        statusIndicator.textContent = data.collector_running
            ? "Collector running"
            : "Collector stopped";
        statusIndicator.classList.toggle("online", data.collector_running);
        return data;
    } catch (error) {
        console.error(error);
        statusIndicator.textContent = "Status unavailable";
        statusIndicator.classList.remove("online");
        return null;
    }
}

function createEmptyRow(colSpan, message) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = colSpan;
    cell.textContent = message;
    row.appendChild(cell);
    return row;
}

function createDividerRow(colSpan, message) {
    const row = document.createElement("tr");
    row.className = "group-divider";
    const cell = document.createElement("td");
    cell.colSpan = colSpan;
    cell.textContent = message;
    row.appendChild(cell);
    return row;
}

function formatEntryLabel(entry, fallback = "Unknown") {
    if (entry.window_title) {
        return entry.window_title;
    }
    if (entry.process_name) {
        return entry.process_name;
    }
    return entry.is_idle ? "Idle" : fallback;
}

function sanitizeNullable(value) {
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
}

function normalizeDateTime(value) {
    if (!value) {
        return "";
    }
    const [main] = value.split(".");
    return main;
}

function formatDateForInput(date) {
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
}

function formatTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value;
    }
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDuration(totalSeconds) {
    const seconds = Math.max(0, Math.floor(totalSeconds ?? 0));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remaining = seconds % 60;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(
        2,
        "0"
    )}:${String(remaining).padStart(2, "0")}`;
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

let toastTimeout = null;
function showToast(message, isError = false) {
    toast.textContent = message;
    toast.classList.toggle("error", isError);
    toast.classList.toggle("success", !isError);
    toast.hidden = false;
    requestAnimationFrame(() => toast.classList.add("show"));
    if (toastTimeout) {
        clearTimeout(toastTimeout);
    }
    toastTimeout = setTimeout(() => {
        toast.classList.remove("show");
        toastTimeout = setTimeout(() => {
            toast.hidden = true;
            toastTimeout = null;
        }, 300);
    }, 3000);
}

init();
