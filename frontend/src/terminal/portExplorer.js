// ==========================================================================
// Nexterm — Port & Service Discovery (#7)
// Live view of listening ports on the active/connected SSH server and the
// process behind each. Click a port for details; kill the owning process.
// ==========================================================================

import { showModal, hideModal } from "../ui/modal.js";
import { showToast, escapeHtml } from "../ui/notifications.js";
import { runSSH, targetName, pickTargetTab } from "./sshExec.js";
import { isPid } from "./shellQuote.js";

const WELL_KNOWN = {
  "22": "SSH", "80": "HTTP", "443": "HTTPS", "3306": "MySQL", "5432": "PostgreSQL",
  "6379": "Redis", "27017": "MongoDB", "3000": "Node/Dev", "8080": "HTTP-alt",
  "9200": "Elasticsearch", "5672": "RabbitMQ", "11211": "Memcached", "25": "SMTP",
  "53": "DNS", "21": "FTP", "3389": "RDP", "8000": "HTTP-alt", "5000": "Dev"
};

function parsePorts(out) {
  // ss -tulnp lines
  const rows = [];
  (out || "").split("\n").forEach(l => {
    l = l.trim();
    if (!l || /^Netid|^State/i.test(l)) return;
    const proto = /^udp/i.test(l) ? "udp" : (/^tcp/i.test(l) ? "tcp" : (l.includes("users:") || l.includes(":") ? "tcp" : ""));
    // local address:port is the 4th-ish column containing :port
    const addrMatch = l.match(/(\d{1,3}(?:\.\d{1,3}){3}|\[[0-9a-fA-F:]+\]|\*|0\.0\.0\.0|\[::\]):(\d+)\s/);
    if (!addrMatch) return;
    const port = addrMatch[2];
    let proc = "", pid = "";
    const um = l.match(/users:\(\("([^"]+)",pid=(\d+)/);
    if (um) { proc = um[1]; pid = um[2]; }
    rows.push({ port, proto, proc, pid, svc: WELL_KNOWN[port] || "" });
  });
  // dedupe by port+proto
  const seen = new Set(); const uniq = [];
  rows.forEach(r => { const k = r.port + r.proto; if (!seen.has(k)) { seen.add(k); uniq.push(r); } });
  uniq.sort((a, b) => (+a.port) - (+b.port));
  return uniq;
}

export function showPortExplorer() {
  if (!pickTargetTab()) { showToast("Connect to and focus a server first", "warning"); return; }
  showModal(`<div id="portRoot"></div>`, "modal-plain");
  renderPorts();
}

async function renderPorts() {
  const root = document.getElementById("portRoot");
  if (!root) return;
  root.innerHTML = `
    <div class="sx-card proc-card">
      <div class="sx-head">
        <div class="sx-title"><span class="sx-ico">🔌</span> Ports &amp; Services — ${escapeHtml(targetName())}</div>
        <div style="display:flex;gap:6px;align-items:center">
          <button class="sx-btn sm" id="portRefresh" title="Refresh">↻</button>
          <button class="sx-x" id="portClose">&times;</button>
        </div>
      </div>
      <div class="proc-list" id="portList"><div class="sched-empty">Scanning listening ports…</div></div>
    </div>`;
  root.querySelector("#portClose").onclick = () => hideModal();
  root.querySelector("#portRefresh").onclick = () => loadPorts();
  loadPorts();
}

async function loadPorts() {
  const el = document.getElementById("portList");
  if (!el) return;
  let res = await runSSH("ss -tulnp 2>/dev/null || sudo ss -tulnp 2>/dev/null || netstat -tulnp 2>/dev/null");
  if (!res.ok) { el.innerHTML = `<div class="sched-empty">Couldn't scan ports (${escapeHtml(res.err || "error")}).</div>`; return; }
  const rows = parsePorts(res.out);
  if (rows.length === 0) { el.innerHTML = `<div class="sched-empty">No listening ports found (process names may need sudo).</div>`; return; }
  el.innerHTML = `
    <div class="port-row port-head-row"><span>PORT</span><span>PROTO</span><span>SERVICE</span><span>PROCESS</span><span>PID</span></div>
    ${rows.map(r => `
      <div class="port-row port-item" data-pid="${escapeHtml(r.pid)}" data-port="${escapeHtml(r.port)}" data-proc="${escapeHtml(r.proc)}" title="Click for details">
        <span class="port-num">:${escapeHtml(r.port)}</span>
        <span class="port-proto">${escapeHtml(r.proto)}</span>
        <span class="port-svc">${escapeHtml(r.svc || "—")}</span>
        <span class="port-proc">${escapeHtml(r.proc || "—")}</span>
        <span class="port-pid">${escapeHtml(r.pid || "—")}</span>
      </div>`).join("")}`;
  el.querySelectorAll(".port-item").forEach(x => x.onclick = () => showPortDetails(x.dataset.port, x.dataset.pid, x.dataset.proc));
}

async function showPortDetails(port, pid, proc) {
  const root = document.getElementById("portRoot");
  if (!root) return;
  if (!isPid(pid)) pid = "—"; // only a numeric pid may ever reach a command line
  root.innerHTML = `
    <div class="sx-card proc-card">
      <div class="sx-head">
        <div class="sx-title"><span class="sx-ico">🔌</span> Port :${escapeHtml(port)}</div>
        <button class="sx-x" id="portBack" title="Back">&larr;</button>
      </div>
      <div class="proc-detail" id="portDetail"><div class="sched-empty">Loading…</div></div>
      <div class="sx-actions" style="padding:0 18px 16px">
        ${pid && pid !== "—" ? `<button class="sx-btn danger" id="portKill">Kill process ${escapeHtml(pid)}</button>` : ""}
      </div>
    </div>`;
  root.querySelector("#portBack").onclick = () => renderPorts();
  const killBtn = root.querySelector("#portKill");
  if (killBtn) killBtn.onclick = async () => {
    if (!confirm(`Kill process ${pid} (${proc}) on port ${port}?`)) return;
    const r = await runSSH(`kill -TERM ${pid} 2>&1 || sudo kill -TERM ${pid} 2>&1`);
    showToast(r.ok ? `Killed ${pid}` : "Kill failed", r.ok ? "success" : "error");
    setTimeout(() => renderPorts(), 500);
  };
  const det = document.getElementById("portDetail");
  if (!pid || pid === "—") { det.innerHTML = `<div class="sched-empty">No owning process resolved for this port (try running the app's SSH user with sudo).</div>`; return; }
  const cmd = [
    `echo '###USER'`, `ps -o user= -p ${pid} 2>/dev/null`,
    `echo '###CMD'`, `ps -o args= -p ${pid} 2>/dev/null`,
    `echo '###CWD'`, `readlink /proc/${pid}/cwd 2>/dev/null`
  ].join(" ; ");
  const res = await runSSH(cmd);
  if (!res.ok) { det.innerHTML = `<div class="sched-empty">Couldn't read details.</div>`; return; }
  const sect = (t) => { const p = res.out.split("###").find(x => x.startsWith(t)); return p ? p.slice(t.length).trim() : ""; };
  det.innerHTML = `
    <div class="proc-kv"><b>Service</b><span>${escapeHtml(WELL_KNOWN[port] || "—")}</span></div>
    <div class="proc-kv"><b>Process</b><span class="mono">${escapeHtml(proc || "—")}</span></div>
    <div class="proc-kv"><b>PID</b><span>${escapeHtml(pid)}</span></div>
    <div class="proc-kv"><b>User</b><span>${escapeHtml(sect("USER") || "—")}</span></div>
    <div class="proc-kv"><b>Command</b><span class="mono">${escapeHtml(sect("CMD") || "—")}</span></div>
    <div class="proc-kv"><b>Directory</b><span class="mono">${escapeHtml(sect("CWD") || "—")}</span></div>`;
}
