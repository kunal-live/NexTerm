// ==========================================================================
// Nexterm — Per-server extras: Notes, Quick-command buttons, Startup commands
// All keyed by the active terminal's profile. Frontend-only (localStorage):
//   nexterm_server_notes = { [key]: "notes" }
//   nexterm_quick_cmds   = { [key]: [{label, cmd}] }
//   nexterm_startup      = { [key]: ["cmd", ...] }
// ==========================================================================

import { showModal, hideModal } from "../ui/modal.js";
import { showToast, escapeHtml } from "../ui/notifications.js";
import { getActiveTabId, getTabs } from "../state/tabState.js";

const K_NOTES = "nexterm_server_notes";
const K_QUICK = "nexterm_quick_cmds";
const K_START = "nexterm_startup";

function jget(k) { try { return JSON.parse(localStorage.getItem(k)) || {}; } catch (_) { return {}; } }
function jset(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} }

export function profileKey(p) {
  if (!p) return "";
  return p.id || ((p.username || "") + "@" + (p.host || "") + ":" + (p.port || 22));
}

function activeProfile() {
  const t = getTabs()[getActiveTabId()];
  return (t && t.profile) ? t.profile : null;
}

function writeActive(cmd) {
  const id = getActiveTabId();
  const t = getTabs()[id];
  if (!id || id === "home" || !t) { showToast("Focus a terminal first", "warning"); return false; }
  const App = window.go && window.go.main && window.go.main.App;
  if (!App || !App.WriteToTerminal) { showToast("Needs the built app (run.bat)", "error"); return false; }
  App.WriteToTerminal(id, cmd + "\r");
  return true;
}

// ---- Startup commands (run automatically on connect) ----
export function getStartupCommands(profile) {
  const m = jget(K_START);
  return m[profileKey(profile)] || [];
}
export function runStartupCommands(tabId, profile) {
  const cmds = getStartupCommands(profile);
  if (!cmds.length) return;
  const App = window.go && window.go.main && window.go.main.App;
  if (!App || !App.WriteToTerminal) return;
  let i = 0;
  const send = () => {
    if (i >= cmds.length) return;
    try { App.WriteToTerminal(tabId, cmds[i] + "\r"); } catch (_) {}
    i++;
    setTimeout(send, 700);
  };
  setTimeout(send, 900); // let the shell prompt settle first
  showToast(`Running ${cmds.length} startup command(s)…`, "info");
}

// ---- Dialog ----
export function showServerExtrasDialog() {
  showModal(`<div id="serverExtrasRoot"></div>`, "modal-plain");
  renderExtras("notes");
}

function renderExtras(tab) {
  const root = document.getElementById("serverExtrasRoot");
  if (!root) return;
  const p = activeProfile();
  const name = p ? (p.name || p.host || "Active server") : null;
  const key = profileKey(p);

  if (!p) {
    root.innerHTML = `
      <div class="sx-card">
        <div class="sx-head"><div class="sx-title"><span class="sx-ico">🗂️</span> Server Tools</div>
          <button class="sx-x" id="sxClose">&times;</button></div>
        <div class="sx-empty">Connect to and focus a server first.<br/>Notes, quick commands and startup commands are saved per server.</div>
      </div>`;
    root.querySelector("#sxClose").onclick = () => hideModal();
    return;
  }

  const notes = jget(K_NOTES)[key] || "";
  const quick = jget(K_QUICK)[key] || [];
  const startup = (jget(K_START)[key] || []).join("\n");

  const tabBtn = (id, label) => `<button class="sx-tab ${tab === id ? 'active' : ''}" data-tab="${id}">${label}</button>`;

  let body = "";
  if (tab === "notes") {
    body = `
      <label class="sx-label">Notes for ${escapeHtml(name)}</label>
      <textarea id="sxNotes" class="sx-textarea" placeholder="Anything you want to remember about this server — credentials hints, quirks, IPs, runbooks…">${escapeHtml(notes)}</textarea>
      <div class="sx-actions"><button class="sx-btn primary" id="sxSaveNotes">Save notes</button></div>`;
  } else if (tab === "quick") {
    const rows = quick.length === 0
      ? `<div class="sx-empty sm">No quick commands yet. Add one below.</div>`
      : quick.map((q, i) => `
        <div class="sx-quick-row">
          <span class="sx-quick-label">${escapeHtml(q.label)}</span>
          <span class="sx-quick-cmd">${escapeHtml(q.cmd)}</span>
          <button class="sx-btn sm run-quick" data-i="${i}" title="Run on this server">▶</button>
          <button class="sx-btn sm danger del-quick" data-i="${i}" title="Delete">🗑️</button>
        </div>`).join("");
    body = `
      <label class="sx-label">One-click commands for ${escapeHtml(name)}</label>
      <div class="sx-quick-list">${rows}</div>
      <div class="sx-add-row">
        <input type="text" id="sxQLabel" class="sx-input" placeholder="Label (e.g. Restart nginx)" />
        <input type="text" id="sxQCmd" class="sx-input mono" placeholder="Command (e.g. sudo systemctl restart nginx)" />
        <button class="sx-btn primary" id="sxAddQuick">Add</button>
      </div>`;
  } else {
    body = `
      <label class="sx-label">Startup commands for ${escapeHtml(name)} — run automatically on connect (one per line)</label>
      <textarea id="sxStartup" class="sx-textarea mono" spellcheck="false" placeholder="cd /var/www&#10;source .env&#10;tail -f logs/app.log">${escapeHtml(startup)}</textarea>
      <div class="sx-note" style="font-size:10.5px;color:#f59e0b;margin-top:6px;">⚠️ Avoid putting passwords or secrets here — Notes, Quick Commands and Startup Commands are stored unencrypted on this PC.</div>
      <div class="sx-actions"><button class="sx-btn primary" id="sxSaveStartup">Save startup commands</button></div>`;
  }

  root.innerHTML = `
    <div class="sx-card">
      <div class="sx-head">
        <div class="sx-title"><span class="sx-ico">🗂️</span> ${escapeHtml(name)}</div>
        <button class="sx-x" id="sxClose">&times;</button>
      </div>
      <div class="sx-tabs">${tabBtn("notes", "📝 Notes")}${tabBtn("quick", "⚡ Quick Commands")}${tabBtn("startup", "🚀 Startup")}</div>
      <div class="sx-body">${body}</div>
    </div>`;

  root.querySelector("#sxClose").onclick = () => hideModal();
  root.querySelectorAll(".sx-tab").forEach(b => b.onclick = () => renderExtras(b.getAttribute("data-tab")));

  if (tab === "notes") {
    root.querySelector("#sxSaveNotes").onclick = () => {
      const m = jget(K_NOTES); m[key] = root.querySelector("#sxNotes").value; jset(K_NOTES, m);
      showToast("Notes saved", "success");
    };
  } else if (tab === "quick") {
    root.querySelector("#sxAddQuick").onclick = () => {
      const label = (root.querySelector("#sxQLabel").value || "").trim();
      const cmd = (root.querySelector("#sxQCmd").value || "").trim();
      if (!label || !cmd) { showToast("Enter a label and a command", "warning"); return; }
      const m = jget(K_QUICK); const arr = m[key] || []; arr.push({ label, cmd }); m[key] = arr; jset(K_QUICK, m);
      renderExtras("quick");
    };
    root.querySelectorAll(".run-quick").forEach(b => b.onclick = () => {
      const q = (jget(K_QUICK)[key] || [])[parseInt(b.getAttribute("data-i"), 10)];
      if (q) { hideModal(); writeActive(q.cmd); }
    });
    root.querySelectorAll(".del-quick").forEach(b => b.onclick = () => {
      const m = jget(K_QUICK); const arr = m[key] || []; arr.splice(parseInt(b.getAttribute("data-i"), 10), 1); m[key] = arr; jset(K_QUICK, m);
      renderExtras("quick");
    });
  } else {
    root.querySelector("#sxSaveStartup").onclick = () => {
      const m = jget(K_START);
      m[key] = root.querySelector("#sxStartup").value.split("\n").map(s => s.replace(/\s+$/, "")).filter(s => s.trim().length);
      jset(K_START, m);
      showToast("Startup commands saved — they run next time you connect", "success");
    };
  }
}
