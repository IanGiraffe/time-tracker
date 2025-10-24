const statusIndicator = document.getElementById("collector-status");
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
    }

    renderActiveTable(entries) {
        this.tableBody.innerHTML = "";
        if (!entries.length) {
            this.tableBody.appendChild(createEmptyRow(3, "No active activity recorded for this range."));
            return;
        }

        for (const entry of entries) {
            const row = document.createElement("tr");
            const labelCell = document.createElement("td");
            labelCell.textContent = formatEntryLabel(entry);

            const processCell = document.createElement("td");
            processCell.textContent = entry.process_name ?? "—";

            const durationCell = document.createElement("td");
            durationCell.textContent = formatDuration(entry.seconds ?? 0);

            row.append(labelCell, processCell, durationCell);
            this.tableBody.appendChild(row);
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
            durationCell.textContent = formatDuration(entry.seconds ?? 0);

            row.append(labelCell, durationCell);
            this.idleTableBody.appendChild(row);
        }
    }

    renderError() {
        this.summaryContainer.innerHTML = `<p class="error">Overview not available.</p>`;
        this.tableBody.innerHTML = "";
        this.tableBody.appendChild(createEmptyRow(3, "No data available."));
        this.idleTableBody.innerHTML = "";
        this.idleTableBody.appendChild(createEmptyRow(2, "No data available."));
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
