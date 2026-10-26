// ==========================================================================
// Nexterm — Session Recorder
// Record the commands you type in a terminal, save them (editable), and
// replay the whole procedure later with one click / shortcut.
// Storage: localStorage "nexterm_recordings" — an array of
//   { id, name, commands: [string], delayMs, created }
// ==========================================================================

import { showModal, hideModal } from "../ui/modal.js";
import { showToast, escapeHtml } from "../ui/notifications.js";
import { getActiveTabId, getTabs } from "../state/tabState.js";

const KEY = "nexterm_recordings";
const DEFAULT_DELAY = 600;

let recordingActive = false;
let current = null; // { name, commands:[], tabId }

function loadAll() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY));
    return Array.isArray(v) ? v : [];
  } catch (_) { return []; }
}
function saveAll(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (_) {}
}

// Called from terminalManager on every completed command line (Enter pressed)
export function recordCommand(tabId, cmd) {
  if (!recordingActive || !current) return;
  if (current.tabId && tabId !== current.tabId) return;
  const c = (cmd || "").trim();
  if (!c) return;
  current.commands.push(c);
  updateRecIndicator();
}

export function startRecording(name) {
  const tabId = getActiveTabId();
  const tabs = getTabs();
  if (!tabId || tabId === "home" || !tabs[tabId]) {
    showToast("Open or focus a terminal first, then start recording", "warning");
    return false;
  }
  current = { name: name || ("Recording " + new Date().toLocaleString()), commands: [], tabId };
  recordingActive = true;
  showToast("● Recording started — every command you run is being captured", "success");
  updateRecIndicator();
  return true;
}

export function stopRecording() {
  if (!current) { recordingActive = false; updateRecIndicator(); return null; }
  recordingActive = false;
  const rec = { id: "rec_" + Date.now(), name: current.name, commands: current.commands.slice(), delayMs: DEFAULT_DELAY, created: Date.now() };
  const hadCommands = rec.commands.length > 0;
  current = null;
  updateRecIndicator();
  if (!hadCommands) {
    showToast("Recording stopped — no commands captured, nothing saved", "warning");
    return null;
  }
  const list = loadAll();
  list.unshift(rec);
  saveAll(list);
  showToast(`■ Saved "${rec.name}" — ${rec.commands.length} command(s)`, "success");
  return rec;
}

export function toggleRecording() {
  if (recordingActive) stopRecording();
  else startRecording();
  // refresh dialog if open
  const box = document.getElementById("recorderDialogRoot");
  if (box) renderRecorder("list");
}

async function replayRecording(id) {
  const rec = loadAll().find(r => r.id === id);
  if (!rec) return;
  const tabId = getActiveTabId();
  const tabs = getTabs();
  if (!tabId || tabId === "home" || !tabs[tabId]) {
    showToast("Open or focus a terminal tab, then run the recording", "warning");
    return;
  }
  if (!(window.go && window.go.main && window.go.main.App && window.go.main.App.WriteToTerminal)) {
    showToast("Replay needs the built app (run.bat)", "error");
    return;
  }
  const delay = Math.max(150, rec.delayMs || DEFAULT_DELAY);
  showToast(`▶ Running "${rec.name}" — ${rec.commands.length} command(s)`, "info");
  for (const cmd of rec.commands) {
    try { window.go.main.App.WriteToTerminal(tabId, cmd + "\r"); } catch (_) {}
    await new Promise(r => setTimeout(r, delay));
  }
  showToast(`✔ Finished "${rec.name}"`, "success");
}

async function replayOnAllConnected(id) {
  const rec = loadAll().find(r => r.id === id);
  if (!rec) return;
  const App = window.go && window.go.main && window.go.main.App;
  if (!App || !App.WriteToTerminal) { showToast("Replay needs the built app (run.bat)", "error"); return; }
  const tabs = getTabs();
  const targets = Object.keys(tabs).filter(tid => tid !== "home" && tabs[tid] && tabs[tid].isConnected && !tabs[tid].isLocal);
  if (targets.length === 0) { showToast("No connected SSH terminals to run on", "warning"); return; }
  const delay = Math.max(150, rec.delayMs || DEFAULT_DELAY);
  showToast(`⇉ Running "${rec.name}" on ${targets.length} server(s)`, "info");
  for (const cmd of rec.commands) {
    targets.forEach(tid => { try { App.WriteToTerminal(tid, cmd + "\r"); } catch (_) {} });
    await new Promise(r => setTimeout(r, delay));
  }
  showToast(`✔ Finished on ${targets.length} server(s)`, "success");
}

// ---- Floating REC indicator ----
function updateRecIndicator() {
  let el = document.getElementById("recIndicator");
  if (recordingActive && current) {
    if (!el) {
      el = document.createElement("div");
      el.id = "recIndicator";
      el.className = "rec-indicator";
      el.onclick = () => showRecorderDialog();
      document.body.appendChild(el);
    }
    el.innerHTML = `<span class="rec-dot"></span> REC <span class="rec-count">${current.commands.length}</span>`;
    el.title = "Recording — click to open the Session Recorder";
  } else if (el) {
    el.remove();
  }
}

// ---- Dialog ----
export function showRecorderDialog() {
  showModal(`<div id="recorderDialogRoot"></div>`, "modal-plain");
  renderRecorder("list");
}

function renderRecorder(mode, editId) {
  const root = document.getElementById("recorderDialogRoot");
  if (!root) return;
  const list = loadAll();

  if (mode === "edit") {
    const rec = list.find(r => r.id === editId);
    if (!rec) { renderRecorder("list"); return; }
    root.innerHTML = `
      <div class="recorder-card">
        <div class="recorder-head">
          <div class="recorder-title"><span class="recorder-ico">✏️</span> Edit Recording</div>
          <button class="recorder-x" id="recBack" title="Back">&larr;</button>
        </div>
        <label class="recorder-label">Name</label>
        <input type="text" id="recEditName" class="recorder-input" value="${escapeHtml(rec.name)}" />
        <label class="recorder-label">Commands (one per line — runs top to bottom)</label>
        <textarea id="recEditCmds" class="recorder-textarea" spellcheck="false">${escapeHtml(rec.commands.join("\n"))}</textarea>
        <label class="recorder-label">Delay between commands (ms)</label>
        <input type="number" id="recEditDelay" class="recorder-input" value="${rec.delayMs || DEFAULT_DELAY}" min="150" step="50" />
        <div class="recorder-actions-row">
          <button class="recorder-btn primary" id="recSaveEdit">Save changes</button>
          <button class="recorder-btn" id="recBack2">Cancel</button>
        </div>
      </div>`;
    root.querySelector("#recBack").onclick = () => renderRecorder("list");
    root.querySelector("#recBack2").onclick = () => renderRecorder("list");
    root.querySelector("#recSaveEdit").onclick = () => {
      const all = loadAll();
      const r = all.find(x => x.id === editId);
      if (r) {
        r.name = (root.querySelector("#recEditName").value || r.name).trim();
        r.commands = root.querySelector("#recEditCmds").value.split("\n").map(s => s.replace(/\s+$/,"")).filter(s => s.trim().length);
        r.delayMs = Math.max(150, parseInt(root.querySelector("#recEditDelay").value, 10) || DEFAULT_DELAY);
        saveAll(all);
        showToast("Recording updated", "success");
      }
      renderRecorder("list");
    };
    return;
  }

  // list mode
  const recRows = list.length === 0
    ? `<div class="recorder-empty">No recordings yet.<br/>Focus a terminal and press <b>Start Recording</b> — every command you run gets captured. Stop when done, then Run it any time.</div>`
    : list.map(r => `
      <div class="recorder-row" data-id="${r.id}">
        <div class="recorder-row-main">
          <div class="recorder-row-name">${escapeHtml(r.name)}</div>
          <div class="recorder-row-sub">${r.commands.length} command(s)${r.commands[0] ? ' · <span class="recorder-row-cmd">' + escapeHtml(r.commands[0]) + (r.commands.length>1?' …':'') + '</span>' : ''}</div>
        </div>
        <div class="recorder-row-actions">
          <button class="recorder-btn primary run-rec" data-id="${r.id}" title="Run all commands on the active terminal">▶ Run</button>
          <button class="recorder-btn run-all-rec" data-id="${r.id}" title="Run on ALL connected servers">⇉ All</button>
          <button class="recorder-btn edit-rec" data-id="${r.id}" title="Edit commands">✏️</button>
          <button class="recorder-btn export-rec" data-id="${r.id}" title="Copy commands to clipboard">⧉</button>
          <button class="recorder-btn danger del-rec" data-id="${r.id}" title="Delete">🗑️</button>
        </div>
      </div>`).join("");

  root.innerHTML = `
    <div class="recorder-card">
      <div class="recorder-head">
        <div class="recorder-title"><span class="recorder-ico">⏺</span> Session Recorder</div>
        <button class="recorder-x" id="recClose" title="Close">&times;</button>
      </div>
      <div class="recorder-controls">
        ${recordingActive
          ? `<button class="recorder-btn rec-stop" id="recToggle">■ Stop Recording <span class="rec-live">● ${current ? current.commands.length : 0}</span></button>
             <span class="recorder-hint">Recording the active terminal — run your commands, then stop to save.</span>`
          : `<input type="text" id="recName" class="recorder-input inline" placeholder="Recording name (optional)" />
             <button class="recorder-btn rec-start" id="recToggle">● Start Recording</button>`}
      </div>
      <div class="recorder-list">${recRows}</div>
    </div>`;

  root.querySelector("#recClose").onclick = () => hideModal();
  root.querySelector("#recToggle").onclick = () => {
    if (recordingActive) { stopRecording(); }
    else {
      const nm = (root.querySelector("#recName")?.value || "").trim();
      startRecording(nm);
    }
    renderRecorder("list");
  };
  root.querySelectorAll(".run-rec").forEach(b => b.onclick = () => { hideModal(); replayRecording(b.getAttribute("data-id")); });
  root.querySelectorAll(".run-all-rec").forEach(b => b.onclick = () => { hideModal(); replayOnAllConnected(b.getAttribute("data-id")); });
  root.querySelectorAll(".edit-rec").forEach(b => b.onclick = () => renderRecorder("edit", b.getAttribute("data-id")));
  root.querySelectorAll(".del-rec").forEach(b => b.onclick = () => {
    const id = b.getAttribute("data-id");
    const all = loadAll().filter(r => r.id !== id);
    saveAll(all);
    showToast("Recording deleted", "info");
    renderRecorder("list");
  });
  root.querySelectorAll(".export-rec").forEach(b => b.onclick = async () => {
    const rec = loadAll().find(r => r.id === b.getAttribute("data-id"));
    if (!rec) return;
    const text = rec.commands.join("\n");
    try { await navigator.clipboard.writeText(text); showToast("Commands copied to clipboard", "success"); }
    catch (_) { showToast("Copy failed — open Edit to view the commands", "warning"); }
  });
}
