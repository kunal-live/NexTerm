// ==========================================================================
// Nexterm — Log Explorer (#10)
// Live-tail a remote log file with client-side search, regex, severity
// highlighting and an errors-only filter. Uses App.RunSSHCommand polling.
// ==========================================================================

import { showModal, hideModal } from "../ui/modal.js";
import { showToast, escapeHtml } from "../ui/notifications.js";
import { runSSH, targetName, pickTargetTab } from "./sshExec.js";

let pollTimer = null;
let state = { path: "", search: "", regex: false, errorsOnly: false, lines: 300, raw: [] };

function classify(line) {
  if (/\b(ERR|ERROR|FATAL|CRIT|CRITICAL|PANIC|EXCEPTION|FAIL(ED|URE)?)\b/i.test(line)) return "err";
  if (/\b(WARN|WARNING)\b/i.test(line)) return "warn";
  if (/\b(INFO|NOTICE)\b/i.test(line)) return "info";
  if (/\b(DEBUG|TRACE)\b/i.test(line)) return "debug";
  return "";
}

export function showLogExplorer() {
  if (!pickTargetTab()) { showToast("Connect to and focus a server first", "warning"); return; }
  showModal(`<div id="logRoot"></div>`, "modal-plain");
  render();
}

export function openLogInExplorer(path) {
  if (path) state.path = path;
  showLogExplorer();
}

function stopPoll() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

function render() {
  const root = document.getElementById("logRoot");
  if (!root) return;
  root.innerHTML = `
    <div class="sx-card log-card">
      <div class="sx-head">
        <div class="sx-title"><span class="sx-ico">📜</span> Log Explorer — ${escapeHtml(targetName())}</div>
        <button class="sx-x" id="logClose">&times;</button>
      </div>
      <div class="log-controls">
        <input type="text" id="logPath" class="sx-input mono" placeholder="/var/log/syslog  (path to a log file)" value="${escapeHtml(state.path)}" />
        <button class="sx-btn primary" id="logStart">${pollTimer ? "■ Stop" : "▶ Tail"}</button>
      </div>
      <div class="log-controls">
        <input type="text" id="logSearch" class="sx-input" placeholder="Filter / search…" value="${escapeHtml(state.search)}" />
        <label class="sched-inline"><input type="checkbox" id="logRegex" ${state.regex ? "checked" : ""}/> Regex</label>
        <label class="sched-inline"><input type="checkbox" id="logErr" ${state.errorsOnly ? "checked" : ""}/> Errors only</label>
      </div>
      <div class="log-view" id="logView"><div class="sched-empty">Enter a log path and press Tail. Live-updates every 3s; search, regex and error filters apply instantly.</div></div>
      <div class="log-foot" id="logFoot"></div>
    </div>`;
  root.querySelector("#logClose").onclick = () => { stopPoll(); hideModal(); };
  root.querySelector("#logStart").onclick = () => toggleTail();
  root.querySelector("#logPath").onchange = (e) => { state.path = e.target.value.trim(); };
  root.querySelector("#logSearch").oninput = (e) => { state.search = e.target.value; paint(); };
  root.querySelector("#logRegex").onchange = (e) => { state.regex = e.target.checked; paint(); };
  root.querySelector("#logErr").onchange = (e) => { state.errorsOnly = e.target.checked; paint(); };
}

async function toggleTail() {
  const pathEl = document.getElementById("logPath");
  if (pathEl) state.path = pathEl.value.trim();
  if (pollTimer) { stopPoll(); render(); return; }
  if (!state.path) { showToast("Enter a log file path", "warning"); return; }
  await pull();
  pollTimer = setInterval(pull, 3000);
  render();
  // keep view scrolled + re-bind after render
}

async function pull() {
  const res = await runSSH(`tail -n ${state.lines} ${JSON.stringify(state.path)} 2>&1`);
  if (!res.ok) { const v = document.getElementById("logView"); if (v) v.innerHTML = `<div class="sched-empty">Can't read log (${escapeHtml(res.err || "error")}).</div>`; return; }
  state.raw = res.out.split("\n");
  paint();
}

function paint() {
  const v = document.getElementById("logView");
  if (!v) return;
  let lines = state.raw;
  let re = null;
  if (state.search) {
    if (state.regex) { try { re = new RegExp(state.search, "i"); } catch (_) { re = null; } }
  }
  const counts = { err: 0, warn: 0, info: 0, debug: 0 };
  const filtered = lines.filter(l => {
    const cls = classify(l);
    if (cls) counts[cls] = (counts[cls] || 0) + 1;
    if (state.errorsOnly && cls !== "err" && cls !== "warn") return false;
    if (state.search) {
      if (re) return re.test(l);
      return l.toLowerCase().includes(state.search.toLowerCase());
    }
    return true;
  });
  v.innerHTML = filtered.length === 0
    ? `<div class="sched-empty">No matching lines.</div>`
    : filtered.map(l => `<div class="log-line log-${classify(l) || 'plain'}">${escapeHtml(l)}</div>`).join("");
  v.scrollTop = v.scrollHeight;
  const foot = document.getElementById("logFoot");
  if (foot) foot.innerHTML = `<span class="log-badge err">${counts.err} err</span><span class="log-badge warn">${counts.warn} warn</span><span class="log-badge info">${counts.info} info</span><span class="log-muted">${filtered.length}/${state.raw.length} lines${pollTimer ? " · live" : ""}</span>`;
}
