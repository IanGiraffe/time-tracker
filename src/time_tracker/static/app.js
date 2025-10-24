const datePicker = document.getElementById("date-picker");
const refreshButton = document.getElementById("refresh-btn");
const todayButton = document.getElementById("today-btn");
const summaryContent = document.getElementById("summary-content");
const eventsTableBody = document.querySelector("#events-table tbody");
const statusIndicator = document.getElementById("collector-status");
const editorCard = document.getElementById("editor-card");
const editorForm = document.getElementById("editor-form");
const cancelEditButton = document.getElementById("cancel-edit-btn");
const toast = document.getElementById("toast");

const editorEventId = document.getElementById("editor-event-id");
const editorStart = document.getElementById("editor-start");
const editorEnd = document.getElementById("editor-end");
const editorProcess = document.getElementById("editor-process");
const editorWindow = document.getElementById("editor-window");
const editorIdle = document.getElementById("editor-idle");

let currentEditingEvent = null;

function init() {
    setDateToToday();
    refreshAll();

    refreshButton.addEventListener("click", refreshAll);
    todayButton.addEventListener("click", () => {
        setDateToToday();
        refreshAll();
    });
    datePicker.addEventListener("change", refreshAll);
    cancelEditButton.addEventListener("click", closeEditor);

    editorForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!currentEditingEvent) {
            return;
        }
        const payload = collectEditorPayload();
        if (!validateEditorPayload(payload)) {
            return;
        }
        try {
            await updateEvent(currentEditingEvent.id, payload);
            showToast("Event updated", false);
            closeEditor();
            refreshAll();
        } catch (error) {
            console.error(error);
            showToast("Failed to update event", true);
        }
    });

    // Keep status fresh in the background.
    setInterval(() => {
        loadStatus().catch((error) => console.error("Status refresh failed", error));
    }, 60000);
}

function setDateToToday() {
    datePicker.value = formatDateForInput(new Date());
}

async function refreshAll() {
    if (!datePicker.value) {
        setDateToToday();
    }
    const date = datePicker.value;
    await Promise.all([loadStatus(), loadSummary(date), loadEvents(date)]);
}

async function loadStatus() {
    const response = await fetch("/api/status");
    if (!response.ok) {
        throw new Error("Unable to load status");
    }
    const data = await response.json();
    statusIndicator.textContent = data.collector_running
        ? "Collector running"
        : "Collector stopped";
    statusIndicator.classList.toggle("online", data.collector_running);
}

async function loadSummary(date) {
    try {
        const response = await fetch(`/api/summary?date=${encodeURIComponent(date)}`);
        if (!response.ok) {
            throw new Error("Summary request failed");
        }
        const data = await response.json();
        renderSummary(data);
    } catch (error) {
        console.error(error);
        summaryContent.innerHTML = `<p class="error">Unable to load summary.</p>`;
    }
}

function renderSummary(data) {
    const totals = data.totals;
    summaryContent.innerHTML = `
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
            <div class="value">${formatDuration(
                totals.active_seconds + totals.idle_seconds
            )}</div>
        </div>
    `;
}

async function loadEvents(date) {
    try {
        const response = await fetch(`/api/events?date=${encodeURIComponent(date)}`);
        if (!response.ok) {
            throw new Error("Event request failed");
        }
        const data = await response.json();
        renderEvents(data.events);
    } catch (error) {
        console.error(error);
        eventsTableBody.innerHTML = `
            <tr>
                <td colspan="7">Unable to load events for this day.</td>
            </tr>
        `;
    }
}

function renderEvents(events) {
    eventsTableBody.innerHTML = "";
    if (events.length === 0) {
        eventsTableBody.innerHTML = `
            <tr>
                <td colspan="7">No activity recorded for this day.</td>
            </tr>
        `;
        return;
    }

    for (const event of events) {
        const row = document.createElement("tr");
        row.innerHTML = `
            <td>${formatTime(event.start_time)}</td>
            <td>${formatTime(event.end_time)}</td>
            <td>${formatDuration(event.duration_seconds)}</td>
            <td>${event.process_name ?? "—"}</td>
            <td>${event.window_title ?? "—"}</td>
            <td>
                <span class="tag ${event.is_idle ? "idle" : "active"}">
                    ${event.is_idle ? "Idle" : "Active"}
                </span>
            </td>
            <td><button class="link" data-id="${event.id}">Edit</button></td>
        `;

        row.querySelector("button").addEventListener("click", () => {
            openEditor(event);
        });
        eventsTableBody.appendChild(row);
    }
}

function openEditor(event) {
    currentEditingEvent = event;
    editorEventId.value = event.id;
    editorStart.value = normalizeDateTime(event.start_time);
    editorEnd.value = normalizeDateTime(event.end_time);
    editorProcess.value = event.process_name ?? "";
    editorWindow.value = event.window_title ?? "";
    editorIdle.checked = event.is_idle;
    editorCard.hidden = false;
    editorStart.focus();
}

function closeEditor() {
    currentEditingEvent = null;
    editorForm.reset();
    editorCard.hidden = true;
}

function collectEditorPayload() {
    return {
        start_time: editorStart.value,
        end_time: editorEnd.value,
        process_name: sanitizeNullable(editorProcess.value),
        window_title: sanitizeNullable(editorWindow.value),
        is_idle: editorIdle.checked,
    };
}

function sanitizeNullable(value) {
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
}

function validateEditorPayload(payload) {
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

async function updateEvent(eventId, payload) {
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
    const seconds = Math.max(0, Math.floor(totalSeconds));
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
