// ==========================================================================
// Nexterm — Process Explorer (#6)
// Live process list for the active/connected SSH server, with a details
// drawer (user, cpu, mem, cwd, open files, listening ports) + Kill.
// ==========================================================================

import { showModal, hideModal } from "../ui/modal.js";
import { showToast, escapeHtml } from "../ui/notifications.js";
import { runSSH, targetName, pickTargetTab } from "./sshExec.js";
import { isPid, isSignal } from "./shellQuote.js";

let sortKey = "cpu";

function parsePs(out) {
  // ps -eo pid,user,pcpu,pmem,comm,args
  const lines = (out || "").split("\n").map(l => l.trim()).filter(Boolean);
  const rows = [];
  for (const l of lines) {
    if (/^PID\s+USER/i.test(l)) continue;
    const m = l.match(/^(\d+)\s+(\S+)\s+([\d.]+)\s+([\d.]+)\s+(\S+)\s+(.*)$/);
    if (!m) continue;
    rows.push({ pid: m[1], user: m[2], cpu: parseFloat(m[3]), mem: parseFloat(m[4]), comm: m[5], args: m[6] });
  }
  return rows;
}

export function showProcessExplorer() {
  if (!pickTargetTab()) { showToast("Connect to and focus a server first", "warning"); return; }
  showModal(`<div id="procRoot"></div>`, "modal-plain");
  renderList();
}

async function renderList() {
  const root = document.getElementById("procRoot");
  if (!root) return;
  root.innerHTML = `
    <div class="sx-card proc-card">
      <div class="sx-head">
        <div class="sx-title"><span class="sx-ico">🧩</span> Process Explorer — ${escapeHtml(targetName())}</div>
        <div style="display:flex;gap:6px;align-items:center">
          <button class="sx-btn sm" id="procRefresh" title="Refresh">↻</button>
          <button class="sx-x" id="procClose">&times;</button>
        </div>
      </div>
      <div class="proc-sort">
        Sort: <button class="sx-btn sm ${sortKey==='cpu'?'primary':''}" data-k="cpu">CPU</button>
        <button class="sx-btn sm ${sortKey==='mem'?'primary':''}" data-k="mem">MEM</button>
        <button class="sx-btn sm ${sortKey==='pid'?'primary':''}" data-k="pid">PID</button>
      </div>
      <div class="proc-list" id="procList"><div class="sched-empty">Loading processes…</div></div>
    </div>`;
  root.querySelector("#procClose").onclick = () => hideModal();
  root.querySelector("#procRefresh").onclick = () => loadRows();
  root.querySelectorAll(".proc-sort [data-k]").forEach(b => b.onclick = () => { sortKey = b.getAttribute("data-k"); renderList(); });
  loadRows();
}

async function loadRows() {
  const listEl = document.getElementById("procList");
  if (!listEl) return;
  const res = await runSSH("ps -eo pid,user,pcpu,pmem,comm,args --sort=-pcpu 2>/dev/null | head -80");
  if (!res.ok) { listEl.innerHTML = `<div class="sched-empty">Couldn't read processes (${escapeHtml(res.err || "error")}). Needs a connected SSH server.</div>`; return; }
  let rows = parsePs(res.out);
  if (sortKey === "mem") rows.sort((a, b) => b.mem - a.mem);
  else if (sortKey === "pid") rows.sort((a, b) => (+a.pid) - (+b.pid));
  else rows.sort((a, b) => b.cpu - a.cpu);
  if (rows.length === 0) { listEl.innerHTML = `<div class="sched-empty">No processes returned.</div>`; return; }
  listEl.innerHTML = `
    <div class="proc-row proc-head-row"><span>PID</span><span>USER</span><span>CPU</span><span>MEM</span><span>COMMAND</span></div>
    ${rows.map(r => `
      <div class="proc-row proc-item" data-pid="${r.pid}" title="Click for details">
        <span class="proc-pid">${r.pid}</span>
        <span class="proc-user">${escapeHtml(r.user)}</span>
        <span class="proc-cpu">${r.cpu.toFixed(1)}%</span>
        <span class="proc-mem">${r.mem.toFixed(1)}%</span>
        <span class="proc-cmd" title="${escapeHtml(r.args)}">${escapeHtml(r.args)}</span>
      </div>`).join("")}`;
  listEl.querySelectorAll(".proc-item").forEach(el => el.onclick = () => showDetails(el.getAttribute("data-pid")));
}

async function showDetails(pid) {
  const root = document.getElementById("procRoot");
  if (!root) return;
  if (!isPid(pid)) { showToast("Invalid process id", "error"); return; }
  root.innerHTML = `
    <div class="sx-card proc-card">
      <div class="sx-head">
        <div class="sx-title"><span class="sx-ico">🧩</span> Process ${escapeHtml(pid)}</div>
        <button class="sx-x" id="procBack" title="Back">&larr;</button>
      </div>
      <div class="proc-detail" id="procDetail"><div class="sched-empty">Loading details…</div></div>
      <div class="sx-actions" style="padding:0 18px 16px">
        <button class="sx-btn danger" id="procKill">Kill (SIGTERM)</button>
        <button class="sx-btn danger" id="procKill9">Force kill (SIGKILL)</button>
      </div>
    </div>`;
  root.querySelector("#procBack").onclick = () => renderList();
  root.querySelector("#procKill").onclick = () => killProc(pid, "TERM");
  root.querySelector("#procKill9").onclick = () => killProc(pid, "KILL");

  const cmd = [
    `echo '###INFO'`, `ps -o pid,ppid,user,pcpu,pmem,etime,stat,nice -p ${pid} 2>/dev/null`,
    `echo '###CWD'`, `readlink /proc/${pid}/cwd 2>/dev/null`,
    `echo '###CMD'`, `tr '\\0' ' ' < /proc/${pid}/cmdline 2>/dev/null`,
    `echo '###FILES'`, `ls /proc/${pid}/fd 2>/dev/null | wc -l`,
    `echo '###PORTS'`, `ss -tlnp 2>/dev/null | grep "pid=${pid}," || sudo ss -tlnp 2>/dev/null | grep "pid=${pid},"`
  ].join(" ; ");
  const res = await runSSH(cmd);
  const detEl = document.getElementById("procDetail");
  if (!detEl) return;
  if (!res.ok) { detEl.innerHTML = `<div class="sched-empty">Couldn't read details.</div>`; return; }
  const sect = (tag) => {
    const parts = res.out.split("###");
    const m = parts.find(p => p.startsWith(tag));
    return m ? m.slice(tag.length).trim() : "";
  };
  const info = sect("INFO"), cwd = sect("CWD"), cmdline = sect("CMD"), files = sect("FILES"), ports = sect("PORTS");
  const portList = ports ? ports.split("\n").map(l => (l.match(/:(\d+)\s/) || [])[1]).filter(Boolean) : [];
  detEl.innerHTML = `
    <pre class="proc-info">${escapeHtml(info || "(no info)")}</pre>
    <div class="proc-kv"><b>Command</b><span class="mono">${escapeHtml(cmdline || "")}</span></div>
    <div class="proc-kv"><b>Working dir</b><span class="mono">${escapeHtml(cwd || "—")}</span></div>
    <div class="proc-kv"><b>Open files</b><span>${escapeHtml(files || "—")}</span></div>
    <div class="proc-kv"><b>Listening ports</b><span class="mono">${portList.length ? portList.join(", ") : "—"}</span></div>`;
}

async function killProc(pid, sig) {
  if (!isPid(pid) || !isSignal(sig)) { showToast("Invalid process id or signal", "error"); return; }
  if (!confirm(`Send SIG${sig} to process ${pid}?`)) return;
  const res = await runSSH(`kill -${sig} ${pid} 2>&1 || sudo kill -${sig} ${pid} 2>&1`);
  showToast(res.ok ? `Sent SIG${sig} to ${pid}` : "Kill failed", res.ok ? "success" : "error");
  setTimeout(() => renderList(), 500);
}
