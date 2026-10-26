// ==========================================================================
// Nexterm — Live Server Monitoring Dashboard
// Polls a connected SSH session for load, memory, users, listening ports,
// network throughput and disk usage; renders live sparkline graphs and lets
// the operator kill a listening port's process or disconnect an idle user.
// ==========================================================================

import { tabs, activeTabId } from '../state/tabState.js';
import { showModal, hideModal } from '../ui/modal.js';
import { showToast, escapeHtml } from '../ui/notifications.js';

let monitorState = {
  open: false,
  tabId: null,
  interval: null,
  intervalMs: 2500,
  view: 'overview',    // overview | processes | services | docker
  busy: false,
  procSort: 'cpu',     // cpu | mem
  prevNet: null,       // { ts, rx, tx }
  prevCpu: null,       // { idle, total }
  history: {
    cpu: [],           // % 0..100
    ram: [],           // % 0..100
    net: []            // total KB/s
  },
  lastAlert: {},       // key -> timestamp (debounce threshold alerts)
  lastUsers: [],
  lastPorts: []
};

const HISTORY_LEN = 120; // ~5 minutes of history at 2.5s cadence

// Threshold alerts: fire a toast (debounced) when a metric crosses a limit.
const ALERT_THRESHOLDS = { cpu: 90, ram: 90, disk: 90 };
const ALERT_DEBOUNCE_MS = 60000;

// The single combined probe. Each section is delimited so we can parse robustly
// even when a distro is missing a tool (ss vs netstat, etc.).
const PROBE = [
  'echo "@@UPTIME@@"; uptime 2>/dev/null',
  'echo "@@NPROC@@"; nproc 2>/dev/null',
  'echo "@@STAT@@"; grep "^cpu " /proc/stat 2>/dev/null',
  'echo "@@MEM@@"; free -m 2>/dev/null',
  'echo "@@WHO@@"; who 2>/dev/null',
  'echo "@@PORTS@@"; (ss -H -tulnp 2>/dev/null || netstat -tulnp 2>/dev/null)',
  'echo "@@NET@@"; cat /proc/net/dev 2>/dev/null',
  'echo "@@DISK@@"; df -hP 2>/dev/null | tail -n +2',
  'echo "@@HOST@@"; hostname 2>/dev/null'
].join('; ');

function connectedSSHTabs() {
  return Object.entries(tabs)
    .filter(([id, t]) => t && id !== 'home' && !t.isLocal && t.isConnected)
    .map(([id, t]) => ({
      id: t.id || id,
      name: t.customTitle || t.profile?.name || t.profile?.host || 'Server',
      host: t.profile?.host || ''
    }));
}

function pickTargetTab() {
  const at = tabs[activeTabId];
  if (at && !at.isLocal && at.isConnected) return at.id || activeTabId;
  const list = connectedSSHTabs();
  return list.length ? list[0].id : null;
}

export function openServerMonitor() {
  const tabId = pickTargetTab();
  if (!tabId) {
    showToast('Connect to an SSH server first to open Server Monitoring', 'warning');
    return;
  }
  if (!(window.go && window.go.main && window.go.main.App && window.go.main.App.RunSSHCommand)) {
    showToast('Server Monitoring requires the latest build (RunSSHCommand not available)', 'error');
    return;
  }

  monitorState.open = true;
  monitorState.tabId = tabId;
  monitorState.view = 'overview';
  monitorState.busy = false;
  monitorState.prevNet = null;
  monitorState.prevCpu = null;
  monitorState.history = { cpu: [], ram: [], net: [] };

  showModal(renderShell(), 'modal-plain');
  attachHandlers();
  poll();                 // immediate first sample (seeds CPU/net baselines)
  // A quick follow-up sample so CPU% and network speed (which need a delta
  // between two readings) show real numbers within ~1.5s instead of a full cycle.
  setTimeout(() => { if (monitorState.open) poll(); }, 1300);
  if (monitorState.interval) clearInterval(monitorState.interval);
  monitorState.interval = setInterval(poll, monitorState.intervalMs);
}

export function closeServerMonitor() {
  monitorState.open = false;
  if (monitorState.interval) {
    clearInterval(monitorState.interval);
    monitorState.interval = null;
  }
  hideModal();
}

function renderShell() {
  const conn = connectedSSHTabs();
  const options = conn.map(s =>
    `<option value="${s.id}" ${s.id === monitorState.tabId ? 'selected' : ''}>${escapeHtml(s.name)} (${escapeHtml(s.host)})</option>`
  ).join('');

  return `
    <div class="broadcast-modal-card bcast-large-modal mon-modal">
      <div class="broadcast-header">
        <div class="broadcast-title-row">
          <span class="broadcast-icon">📈</span>
          <div>
            <h3>Server Monitoring <span id="monHostName" class="mon-host-name"></span></h3>
            <p class="broadcast-subtitle">Live metrics · refreshes every ${monitorState.intervalMs / 1000}s</p>
          </div>
        </div>
        <div class="mon-header-tools">
          <select id="monServerSelect" class="mon-select" title="Choose server to monitor">${options}</select>
          <button id="monCloseBtn" class="broadcast-close-btn" title="Close">✕</button>
        </div>
      </div>

      <div class="mon-tabbar">
        <button class="mon-tab active" data-view="overview">📊 Overview</button>
        <button class="mon-tab" data-view="processes">⚙️ Processes</button>
        <button class="mon-tab" data-view="services">🧩 Services</button>
        <button class="mon-tab" data-view="docker">🐳 Docker</button>
      </div>

      <div class="broadcast-body mon-body">
        <!-- ===== OVERVIEW VIEW ===== -->
        <div id="monViewOverview">
        <!-- Metric tiles -->
        <div class="mon-tiles">
          <div class="mon-tile"><div class="mon-tile-label">CPU Load</div><div class="mon-tile-val" id="monCpuVal">—</div><canvas class="mon-spark" id="monCpuGraph" width="240" height="46"></canvas></div>
          <div class="mon-tile"><div class="mon-tile-label">Memory</div><div class="mon-tile-val" id="monRamVal">—</div><canvas class="mon-spark" id="monRamGraph" width="240" height="46"></canvas></div>
          <div class="mon-tile"><div class="mon-tile-label">Network (↓/↑)</div><div class="mon-tile-val" id="monNetVal">—</div><canvas class="mon-spark" id="monNetGraph" width="240" height="46"></canvas></div>
          <div class="mon-tile"><div class="mon-tile-label">Uptime / Load Avg</div><div class="mon-tile-val mon-tile-sm" id="monUptimeVal">—</div><div class="mon-tile-sub" id="monLoadAvg"></div></div>
        </div>

        <div class="mon-cols">
          <!-- Connected users -->
          <div class="mon-panel">
            <div class="mon-panel-head"><span>👥 Connected Users (<span id="monUserCount">0</span>)</span></div>
            <div class="mon-table" id="monUsers"><div class="mon-empty">Loading…</div></div>
          </div>

          <!-- Listening ports -->
          <div class="mon-panel">
            <div class="mon-panel-head"><span>🔌 Listening Ports (<span id="monPortCount">0</span>)</span></div>
            <div class="mon-table" id="monPorts"><div class="mon-empty">Loading…</div></div>
          </div>
        </div>

        <!-- Disk + local tab info -->
        <div class="mon-panel">
          <div class="mon-panel-head"><span>💾 Disk Usage</span></div>
          <div class="mon-table" id="monDisk"><div class="mon-empty">Loading…</div></div>
        </div>

        <div class="mon-localbar" id="monLocalBar"></div>
        </div><!-- /overview -->

        <!-- ===== PROCESSES VIEW ===== -->
        <div id="monViewProcesses" hidden>
          <div class="mon-panel">
            <div class="mon-panel-head" style="display:flex; justify-content:space-between; align-items:center;">
              <span>⚙️ Top Processes (<span id="monProcCount">0</span>)</span>
              <span class="mon-sort-toggle">
                Sort:
                <button class="mon-mini-tab" id="monSortCpu" data-sort="cpu">CPU</button>
                <button class="mon-mini-tab" id="monSortMem" data-sort="mem">Memory</button>
              </span>
            </div>
            <div class="mon-table mon-table-tall" id="monProcs"><div class="mon-empty">Loading…</div></div>
          </div>
        </div>

        <!-- ===== SERVICES VIEW ===== -->
        <div id="monViewServices" hidden>
          <div class="mon-panel">
            <div class="mon-panel-head"><span>🧩 systemd Services (<span id="monSvcCount">0</span>)</span></div>
            <div class="mon-table mon-table-tall" id="monServices"><div class="mon-empty">Loading…</div></div>
          </div>
        </div>

        <!-- ===== DOCKER VIEW ===== -->
        <div id="monViewDocker" hidden>
          <div class="mon-panel">
            <div class="mon-panel-head"><span>🐳 Docker Containers (<span id="monDockerCount">0</span>)</span></div>
            <div class="mon-table mon-table-tall" id="monDocker"><div class="mon-empty">Loading…</div></div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function attachHandlers() {
  const closeBtn = document.getElementById('monCloseBtn');
  if (closeBtn) closeBtn.onclick = closeServerMonitor;

  const sel = document.getElementById('monServerSelect');
  if (sel) {
    sel.onchange = () => {
      monitorState.tabId = sel.value;
      monitorState.prevNet = null;
      monitorState.prevCpu = null;
      monitorState.history = { cpu: [], ram: [], net: [] };
      poll();
    };
  }

  document.querySelectorAll('.mon-tab').forEach(btn => {
    btn.onclick = () => switchView(btn.getAttribute('data-view'));
  });
  const sc = document.getElementById('monSortCpu');
  const sm = document.getElementById('monSortMem');
  if (sc) sc.onclick = () => { monitorState.procSort = 'cpu'; markProcSort(); fetchProcesses(); };
  if (sm) sm.onclick = () => { monitorState.procSort = 'mem'; markProcSort(); fetchProcesses(); };
  markProcSort();
}

function switchView(view) {
  monitorState.view = view;
  document.querySelectorAll('.mon-tab').forEach(b => b.classList.toggle('active', b.getAttribute('data-view') === view));
  const map = { overview: 'monViewOverview', processes: 'monViewProcesses', services: 'monViewServices', docker: 'monViewDocker' };
  Object.entries(map).forEach(([v, id]) => { const el = document.getElementById(id); if (el) el.hidden = (v !== view); });
  // Fetch the newly shown view's data immediately.
  if (view === 'processes') fetchProcesses();
  else if (view === 'services') fetchServices();
  else if (view === 'docker') fetchDocker();
}

function markProcSort() {
  const sc = document.getElementById('monSortCpu');
  const sm = document.getElementById('monSortMem');
  if (sc) sc.classList.toggle('active', monitorState.procSort === 'cpu');
  if (sm) sm.classList.toggle('active', monitorState.procSort === 'mem');
}

async function poll() {
  if (!monitorState.open || !monitorState.tabId) return;
  // If the modal was dismissed another way (Esc key, overlay click), the monitor
  // DOM is gone — stop polling so we don't keep hitting the server in the background.
  if (!document.getElementById('monCloseBtn')) { closeServerMonitor(); return; }
  if (monitorState.busy) return;   // don't stack requests on a slow link
  monitorState.busy = true;
  let raw = '';
  try {
    raw = await window.go.main.App.RunSSHCommand(monitorState.tabId, PROBE);
  } catch (err) {
    monitorState.busy = false;
    // Session may have dropped; show gentle notice but keep the panel open.
    setText('monHostName', '(unreachable)');
    return;
  }
  monitorState.busy = false;
  if (!monitorState.open) return;
  try {
    const s = parseProbe(raw);
    updateUI(s);
    checkAlerts(s);
  } catch (e) {
    // Never let a parse hiccup kill the polling loop.
    console.warn('monitor parse error', e);
  }
  updateLocalBar();

  // Refresh whichever sub-view is currently visible.
  if (monitorState.view === 'processes') fetchProcesses();
  else if (monitorState.view === 'services') fetchServices();
  else if (monitorState.view === 'docker') fetchDocker();
}

// ---- Threshold alerts -----------------------------------------------------
function checkAlerts(s) {
  const now = Date.now();
  const fire = (key, label) => {
    if (now - (monitorState.lastAlert[key] || 0) > ALERT_DEBOUNCE_MS) {
      monitorState.lastAlert[key] = now;
      showToast('⚠️ ' + label, 'warning');
    }
  };
  if (s.cpuPct >= ALERT_THRESHOLDS.cpu) fire('cpu', `High CPU on ${s.host || 'server'}: ${Math.round(s.cpuPct)}%`);
  if (s.memPct >= ALERT_THRESHOLDS.ram) fire('ram', `High memory on ${s.host || 'server'}: ${Math.round(s.memPct)}%`);
  (s.disks || []).forEach(d => {
    const pct = parseInt(d.pct, 10) || 0;
    if (pct >= ALERT_THRESHOLDS.disk) fire('disk:' + d.mount, `Disk ${d.mount} on ${s.host || 'server'} is ${pct}% full`);
  });
}

// ---- Processes ------------------------------------------------------------
async function fetchProcesses() {
  const el = document.getElementById('monProcs');
  if (!el) return;
  const sortKey = monitorState.procSort === 'mem' ? '-pmem' : '-pcpu';
  const cmd = `ps -eo pid,user,pcpu,pmem,comm --sort=${sortKey} 2>/dev/null | head -n 31`;
  let out = '';
  try { out = await window.go.main.App.RunSSHCommand(monitorState.tabId, cmd); } catch (e) { return; }
  const rows = out.split('\n').map(l => l.trim()).filter(Boolean);
  rows.shift(); // header
  const procs = rows.map(l => {
    const p = l.split(/\s+/);
    return { pid: p[0], user: p[1], cpu: p[2], mem: p[3], cmd: p.slice(4).join(' ') };
  }).filter(p => p.pid && /^\d+$/.test(p.pid));
  setText('monProcCount', String(procs.length));
  if (!procs.length) { el.innerHTML = '<div class="mon-empty">No process data</div>'; return; }
  el.innerHTML = `<div class="mon-row mon-row-hdr"><div class="mon-row-main">PID · User · Command</div><div class="mon-row-side">CPU / MEM</div></div>` +
    procs.map(p => `
      <div class="mon-row">
        <div class="mon-row-main"><strong>${escapeHtml(p.pid)}</strong> <span class="mon-dim">${escapeHtml(p.user)}</span> ${escapeHtml(p.cmd)}</div>
        <div class="mon-row-side">
          <span class="mon-metric">${escapeHtml(p.cpu)}% / ${escapeHtml(p.mem)}%</span>
          <button class="mon-act-btn danger" data-killproc="${escapeHtml(p.pid)}" data-name="${escapeHtml(p.cmd)}" title="Kill this process">Kill</button>
        </div>
      </div>`).join('');
  el.querySelectorAll('[data-killproc]').forEach(b => {
    b.onclick = () => killProcess(b.getAttribute('data-killproc'), b.getAttribute('data-name'));
  });
}

async function killProcess(pid, name) {
  if (!pid) return;
  if (!confirm(`Kill process ${pid} (${name}) on this server?`)) return;
  try {
    await window.go.main.App.RunSSHCommand(monitorState.tabId, `kill -TERM ${pid} 2>&1 || sudo kill -TERM ${pid} 2>&1`);
    showToast(`Sent terminate to PID ${pid}`, 'info');
    setTimeout(fetchProcesses, 500);
  } catch (err) { showToast('Kill failed: ' + err, 'error'); }
}

// ---- Services (systemd) ---------------------------------------------------
async function fetchServices() {
  const el = document.getElementById('monServices');
  if (!el) return;
  const cmd = `systemctl list-units --type=service --all --no-legend --no-pager 2>/dev/null | head -n 60`;
  let out = '';
  try { out = await window.go.main.App.RunSSHCommand(monitorState.tabId, cmd); } catch (e) { return; }
  const svcs = out.split('\n').map(l => l.replace(/^\s*[●*]\s*/, '').trim()).filter(Boolean).map(l => {
    const p = l.split(/\s+/);
    return { unit: p[0], load: p[1], active: p[2], sub: p[3], desc: p.slice(4).join(' ') };
  }).filter(s => s.unit && s.unit.endsWith('.service'));
  setText('monSvcCount', String(svcs.length));
  if (!svcs.length) { el.innerHTML = '<div class="mon-empty">No services found (systemd may be unavailable)</div>'; return; }
  el.innerHTML = svcs.map(s => {
    const running = s.active === 'active';
    const dot = running ? '#22c55e' : (s.active === 'failed' ? '#ef4444' : '#94a3b8');
    return `<div class="mon-row">
      <div class="mon-row-main"><span class="mon-status-dot" style="background:${dot};"></span><strong>${escapeHtml(s.unit.replace('.service', ''))}</strong> <span class="mon-dim">${escapeHtml(s.active)}/${escapeHtml(s.sub)}</span></div>
      <div class="mon-row-side">
        <button class="mon-act-btn" data-svc="${escapeHtml(s.unit)}" data-op="restart" title="Restart">Restart</button>
        ${running
          ? `<button class="mon-act-btn danger" data-svc="${escapeHtml(s.unit)}" data-op="stop" title="Stop">Stop</button>`
          : `<button class="mon-act-btn" data-svc="${escapeHtml(s.unit)}" data-op="start" title="Start">Start</button>`}
      </div>
    </div>`;
  }).join('');
  el.querySelectorAll('[data-svc]').forEach(b => {
    b.onclick = () => serviceAction(b.getAttribute('data-svc'), b.getAttribute('data-op'));
  });
}

async function serviceAction(unit, op) {
  if (!unit || !op) return;
  if (!confirm(`${op} service "${unit}" on this server?`)) return;
  try {
    await window.go.main.App.RunSSHCommand(monitorState.tabId, `systemctl ${op} ${unit} 2>&1 || sudo systemctl ${op} ${unit} 2>&1`);
    showToast(`${op} sent to ${unit}`, 'info');
    setTimeout(fetchServices, 700);
  } catch (err) { showToast('Service action failed: ' + err, 'error'); }
}

// ---- Docker ---------------------------------------------------------------
async function fetchDocker() {
  const el = document.getElementById('monDocker');
  if (!el) return;
  const cmd = `docker ps -a --format '{{.ID}}|{{.Names}}|{{.Image}}|{{.State}}|{{.Status}}' 2>&1 | head -n 60`;
  let out = '';
  try { out = await window.go.main.App.RunSSHCommand(monitorState.tabId, cmd); } catch (e) { return; }
  if (/command not found|permission denied|Cannot connect to the Docker daemon/i.test(out)) {
    el.innerHTML = `<div class="mon-empty">Docker not available on this host (${escapeHtml(out.split('\n')[0] || '')})</div>`;
    setText('monDockerCount', '0');
    return;
  }
  const rows = out.split('\n').map(l => l.trim()).filter(l => l.includes('|')).map(l => {
    const p = l.split('|');
    return { id: p[0], name: p[1], image: p[2], state: p[3], status: p[4] };
  });
  setText('monDockerCount', String(rows.length));
  if (!rows.length) { el.innerHTML = '<div class="mon-empty">No containers</div>'; return; }
  el.innerHTML = rows.map(c => {
    const running = /running|up/i.test(c.state) || /^Up/i.test(c.status);
    const dot = running ? '#22c55e' : '#94a3b8';
    return `<div class="mon-row">
      <div class="mon-row-main"><span class="mon-status-dot" style="background:${dot};"></span><strong>${escapeHtml(c.name)}</strong> <span class="mon-dim">${escapeHtml(c.image)}</span> <span class="mon-dim">${escapeHtml(c.status)}</span></div>
      <div class="mon-row-side">
        <button class="mon-act-btn" data-dockerlogs="${escapeHtml(c.id)}" data-name="${escapeHtml(c.name)}" title="View recent logs">Logs</button>
        <button class="mon-act-btn" data-dockerrestart="${escapeHtml(c.id)}" data-name="${escapeHtml(c.name)}" title="Restart container">Restart</button>
        ${running ? `<button class="mon-act-btn danger" data-dockerstop="${escapeHtml(c.id)}" data-name="${escapeHtml(c.name)}" title="Stop container">Stop</button>` : ''}
      </div>
    </div>`;
  }).join('');
  el.querySelectorAll('[data-dockerrestart]').forEach(b => b.onclick = () => dockerAction(b.getAttribute('data-dockerrestart'), 'restart', b.getAttribute('data-name')));
  el.querySelectorAll('[data-dockerstop]').forEach(b => b.onclick = () => dockerAction(b.getAttribute('data-dockerstop'), 'stop', b.getAttribute('data-name')));
  el.querySelectorAll('[data-dockerlogs]').forEach(b => b.onclick = () => dockerLogs(b.getAttribute('data-dockerlogs'), b.getAttribute('data-name')));
}

async function dockerAction(id, op, name) {
  if (!id) return;
  if (op === 'stop' && !confirm(`Stop container ${name}?`)) return;
  try {
    await window.go.main.App.RunSSHCommand(monitorState.tabId, `docker ${op} ${id} 2>&1 || sudo docker ${op} ${id} 2>&1`);
    showToast(`docker ${op} ${name}`, 'info');
    setTimeout(fetchDocker, 900);
  } catch (err) { showToast('Docker action failed: ' + err, 'error'); }
}

async function dockerLogs(id, name) {
  try {
    const out = await window.go.main.App.RunSSHCommand(monitorState.tabId, `docker logs --tail 200 ${id} 2>&1 || sudo docker logs --tail 200 ${id} 2>&1`);
    // Pause polling so a background refresh doesn't close/overwrite the logs view.
    if (monitorState.interval) { clearInterval(monitorState.interval); monitorState.interval = null; }
    monitorState.open = false;
    showModal(`
      <div class="broadcast-modal-card bcast-large-modal mon-modal">
        <div class="broadcast-header">
          <div class="broadcast-title-row"><span class="broadcast-icon">🐳</span><div><h3>Logs: ${escapeHtml(name)}</h3><p class="broadcast-subtitle">Last 200 lines</p></div></div>
          <button id="monLogsClose" class="broadcast-close-btn">✕</button>
        </div>
        <div class="broadcast-body"><pre class="mon-logs">${escapeHtml(out || '(empty)')}</pre></div>
      </div>`, 'modal-plain');
    const c = document.getElementById('monLogsClose');
    if (c) c.onclick = () => reopenMonitor('docker');
  } catch (err) { showToast('Could not fetch logs: ' + err, 'error'); }
}

// Rebuild the monitor shell and resume polling (used after the logs sub-modal).
function reopenMonitor(view) {
  monitorState.open = true;
  showModal(renderShell(), 'modal-plain');
  attachHandlers();
  switchView(view || 'overview');
  if (!monitorState.interval) monitorState.interval = setInterval(poll, monitorState.intervalMs);
  poll();
}

function section(raw, name) {
  const re = new RegExp('@@' + name + '@@\\n?([\\s\\S]*?)(?=@@[A-Z]+@@|$)');
  const m = raw.match(re);
  return m ? m[1].trim() : '';
}

function parseProbe(raw) {
  const out = {};
  out.host = section(raw, 'HOST').split('\n')[0] || '';
  out.nproc = parseInt(section(raw, 'NPROC'), 10) || 1;

  // Load average from uptime
  const up = section(raw, 'UPTIME');
  out.uptimeText = formatUptime(up);
  const la = up.match(/load average[s]?:\s*([\d.]+),?\s*([\d.]+),?\s*([\d.]+)/i);
  out.load = la ? [parseFloat(la[1]), parseFloat(la[2]), parseFloat(la[3])] : [0, 0, 0];

  // CPU % from /proc/stat delta
  const stat = section(raw, 'STAT').split(/\s+/).slice(1).map(Number).filter(n => !isNaN(n));
  if (stat.length >= 4) {
    const idle = stat[3] + (stat[4] || 0);
    const total = stat.reduce((a, b) => a + b, 0);
    if (monitorState.prevCpu) {
      const dIdle = idle - monitorState.prevCpu.idle;
      const dTotal = total - monitorState.prevCpu.total;
      out.cpuPct = dTotal > 0 ? Math.max(0, Math.min(100, (1 - dIdle / dTotal) * 100)) : 0;
    } else {
      out.cpuPct = Math.max(0, Math.min(100, (out.load[0] / out.nproc) * 100));
    }
    monitorState.prevCpu = { idle, total };
  } else {
    out.cpuPct = Math.max(0, Math.min(100, (out.load[0] / out.nproc) * 100));
  }

  // Memory from free -m
  const mem = section(raw, 'MEM');
  const memLine = mem.split('\n').find(l => /^Mem:/i.test(l.trim()));
  if (memLine) {
    const p = memLine.trim().split(/\s+/);
    out.memTotal = parseInt(p[1], 10) || 0;
    out.memUsed = parseInt(p[2], 10) || 0;
    out.memPct = out.memTotal ? (out.memUsed / out.memTotal) * 100 : 0;
  } else {
    out.memTotal = 0; out.memUsed = 0; out.memPct = 0;
  }

  // Users from who
  out.users = section(raw, 'WHO').split('\n').filter(Boolean).map(l => {
    const p = l.trim().split(/\s+/);
    return { user: p[0] || '', tty: p[1] || '', since: p.slice(2, 5).join(' '), from: (l.match(/\(([^)]+)\)/) || [])[1] || '' };
  }).filter(u => u.user);

  // Listening ports from ss/netstat
  out.ports = parsePorts(section(raw, 'PORTS'));

  // Network throughput from /proc/net/dev
  out.net = parseNet(section(raw, 'NET'));

  // Disk
  out.disks = section(raw, 'DISK').split('\n').filter(Boolean).map(l => {
    const p = l.trim().split(/\s+/);
    return { fs: p[0], size: p[1], used: p[2], avail: p[3], pct: p[4], mount: p[5] };
  }).filter(d => d.mount && d.fs && !/^(tmpfs|devtmpfs|udev|overlay)$/.test(d.fs));

  return out;
}

function parsePorts(txt) {
  const ports = [];
  txt.split('\n').filter(Boolean).forEach(l => {
    if (/^Netid|^Proto|^Active/i.test(l.trim())) return;
    const cols = l.trim().split(/\s+/);
    // ss: Netid State Recv-Q Send-Q Local:Port Peer users:(("proc",pid=NN,..))
    const local = cols.find(c => /:\d+$/.test(c)) || '';
    const port = (local.match(/:(\d+)$/) || [])[1] || '';
    if (!port) return;
    const proto = cols[0] && /tcp|udp/i.test(cols[0]) ? cols[0].toLowerCase() : (l.includes('tcp') ? 'tcp' : 'udp');
    const pidm = l.match(/pid=(\d+)/) || l.match(/,(\d+),/) || l.match(/\/(\d+)\//);
    const procm = l.match(/\(\("([^"]+)"/) || l.match(/\d+\/([\w.-]+)/);
    ports.push({ proto, port, pid: pidm ? pidm[1] : '', proc: procm ? procm[1] : '', addr: local });
  });
  // de-dup by proto+port
  const seen = new Set();
  return ports.filter(p => { const k = p.proto + p.port; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => (parseInt(a.port) - parseInt(b.port)));
}

function parseNet(txt) {
  let rx = 0, tx = 0;
  txt.split('\n').forEach(l => {
    const m = l.split(':');
    if (m.length < 2) return;
    const iface = m[0].trim();
    if (iface === 'lo' || !iface) return;
    const nums = m[1].trim().split(/\s+/).map(Number);
    if (nums.length >= 9) { rx += nums[0]; tx += nums[8]; }
  });
  const now = Date.now();
  let rxRate = 0, txRate = 0;
  if (monitorState.prevNet) {
    const dt = (now - monitorState.prevNet.ts) / 1000;
    if (dt > 0) {
      rxRate = Math.max(0, (rx - monitorState.prevNet.rx) / dt);
      txRate = Math.max(0, (tx - monitorState.prevNet.tx) / dt);
    }
  }
  monitorState.prevNet = { ts: now, rx, tx };
  return { rxRate, txRate };
}

function updateUI(s) {
  setText('monHostName', s.host ? '· ' + s.host : '');
  setText('monCpuVal', Math.round(s.cpuPct) + '%  (' + s.nproc + ' cores)');
  setText('monRamVal', s.memTotal ? `${fmtMB(s.memUsed)} / ${fmtMB(s.memTotal)} (${Math.round(s.memPct)}%)` : '—');
  setText('monNetVal', `↓ ${fmtRate(s.net.rxRate)}   ↑ ${fmtRate(s.net.txRate)}`);
  setText('monUptimeVal', s.uptimeText || '—');
  setText('monLoadAvg', `load ${s.load.map(x => x.toFixed(2)).join('  ')}`);

  pushHist('cpu', s.cpuPct);
  pushHist('ram', s.memPct);
  pushHist('net', (s.net.rxRate + s.net.txRate) / 1024);
  drawSpark('monCpuGraph', monitorState.history.cpu, '#38bdf8', 100);
  drawSpark('monRamGraph', monitorState.history.ram, '#a855f7', 100);
  drawSpark('monNetGraph', monitorState.history.net, '#22c55e', null);

  renderUsers(s.users);
  renderPorts(s.ports);
  renderDisks(s.disks);
}

function renderUsers(users) {
  monitorState.lastUsers = users;
  setText('monUserCount', String(users.length));
  const el = document.getElementById('monUsers');
  if (!el) return;
  if (!users.length) { el.innerHTML = '<div class="mon-empty">No interactive users</div>'; return; }
  el.innerHTML = users.map(u => `
    <div class="mon-row">
      <div class="mon-row-main"><strong>${escapeHtml(u.user)}</strong> <span class="mon-dim">${escapeHtml(u.tty)}</span>${u.from ? ` <span class="mon-dim">from ${escapeHtml(u.from)}</span>` : ''}</div>
      <div class="mon-row-side"><span class="mon-dim">${escapeHtml(u.since)}</span>
        <button class="mon-act-btn danger" data-kick="${escapeHtml(u.tty)}" data-user="${escapeHtml(u.user)}" title="Disconnect this login session">Disconnect</button>
      </div>
    </div>`).join('');
  el.querySelectorAll('[data-kick]').forEach(b => {
    b.onclick = () => kickUser(b.getAttribute('data-user'), b.getAttribute('data-kick'));
  });
}

function renderPorts(ports) {
  monitorState.lastPorts = ports;
  setText('monPortCount', String(ports.length));
  const el = document.getElementById('monPorts');
  if (!el) return;
  if (!ports.length) { el.innerHTML = '<div class="mon-empty">No listening ports detected (may need root)</div>'; return; }
  el.innerHTML = ports.map(p => `
    <div class="mon-row">
      <div class="mon-row-main"><strong>${escapeHtml(p.port)}</strong>/<span class="mon-dim">${escapeHtml(p.proto)}</span> ${p.proc ? `<span class="mon-tag">${escapeHtml(p.proc)}</span>` : ''}${p.pid ? ` <span class="mon-dim">pid ${escapeHtml(p.pid)}</span>` : ''}</div>
      <div class="mon-row-side">
        ${p.pid ? `<button class="mon-act-btn danger" data-killpid="${escapeHtml(p.pid)}" data-port="${escapeHtml(p.port)}" title="Kill the process holding this port">Close Port</button>` : '<span class="mon-dim">—</span>'}
      </div>
    </div>`).join('');
  el.querySelectorAll('[data-killpid]').forEach(b => {
    b.onclick = () => killPort(b.getAttribute('data-killpid'), b.getAttribute('data-port'));
  });
}

function renderDisks(disks) {
  const el = document.getElementById('monDisk');
  if (!el) return;
  if (!disks || !disks.length) { el.innerHTML = '<div class="mon-empty">No disk data</div>'; return; }
  el.innerHTML = disks.map(d => {
    const pct = parseInt(d.pct, 10) || 0;
    const col = pct >= 90 ? '#ef4444' : pct >= 75 ? '#f59e0b' : '#22c55e';
    return `<div class="mon-row">
      <div class="mon-row-main"><strong>${escapeHtml(d.mount)}</strong> <span class="mon-dim">${escapeHtml(d.used)}/${escapeHtml(d.size)}</span></div>
      <div class="mon-row-side" style="flex:1; max-width:220px;">
        <div class="mon-bar"><div class="mon-bar-fill" style="width:${pct}%; background:${col};"></div></div>
        <span class="mon-dim">${escapeHtml(d.pct)}</span>
      </div>
    </div>`;
  }).join('');
}

function updateLocalBar() {
  const el = document.getElementById('monLocalBar');
  if (!el) return;
  const all = Object.entries(tabs).filter(([id]) => id !== 'home');
  const connected = all.filter(([, t]) => t && t.isConnected);
  const inactive = connected.filter(([id]) => id !== activeTabId).length;
  let mem = '';
  try {
    if (performance && performance.memory) {
      const used = performance.memory.usedJSHeapSize / 1048576;
      const lim = performance.memory.jsHeapSizeLimit / 1048576;
      mem = ` · App memory: ${used.toFixed(0)} MB / ${lim.toFixed(0)} MB`;
    }
  } catch (_) {}
  el.textContent = `Open tabs: ${all.length} · Connected: ${connected.length} · Inactive (background) tabs: ${inactive}${mem}`;
}

async function killPort(pid, port) {
  if (!pid) return;
  if (!confirm(`Close port ${port} by terminating process PID ${pid} on this server?\n\nThis can disrupt a running service. Continue?`)) return;
  try {
    await window.go.main.App.RunSSHCommand(monitorState.tabId, `kill -TERM ${pid} 2>&1 || sudo kill -TERM ${pid} 2>&1`);
    showToast(`Sent terminate to PID ${pid} (port ${port})`, 'info');
    setTimeout(poll, 600);
  } catch (err) {
    showToast('Failed to close port: ' + err, 'error');
  }
}

async function kickUser(user, tty) {
  if (!tty) { showToast('No TTY to disconnect', 'warning'); return; }
  if (!confirm(`Disconnect user "${user}" on ${tty}?\n\nTheir session will be terminated. Continue?`)) return;
  try {
    // Kill processes attached to that terminal line.
    await window.go.main.App.RunSSHCommand(monitorState.tabId, `pkill -9 -t ${tty} 2>&1 || sudo pkill -9 -t ${tty} 2>&1`);
    showToast(`Disconnected ${user} (${tty})`, 'info');
    setTimeout(poll, 600);
  } catch (err) {
    showToast('Failed to disconnect user: ' + err, 'error');
  }
}

// ---- small helpers ----
function pushHist(key, val) {
  const arr = monitorState.history[key];
  arr.push(isFinite(val) ? val : 0);
  if (arr.length > HISTORY_LEN) arr.shift();
}

function drawSpark(id, data, color, fixedMax) {
  const c = document.getElementById(id);
  if (!c || !c.getContext) return;
  const ctx = c.getContext('2d');
  const w = c.width, h = c.height;
  ctx.clearRect(0, 0, w, h);
  if (!data.length) return;
  const max = fixedMax != null ? fixedMax : Math.max(1, ...data);
  const stepX = w / Math.max(1, HISTORY_LEN - 1);
  ctx.beginPath();
  data.forEach((v, i) => {
    const x = i * stepX;
    const y = h - (Math.min(v, max) / max) * (h - 4) - 2;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  ctx.stroke();
  ctx.lineTo((data.length - 1) * stepX, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fillStyle = color + '22';
  ctx.fill();
}

function formatUptime(up) {
  const m = up.match(/up\s+(.+?),\s+\d+\s+user/);
  return m ? m[1].trim() : (up.split(',')[0] || '').replace(/.*up/, 'up').trim();
}
function fmtMB(mb) { return mb >= 1024 ? (mb / 1024).toFixed(1) + ' GB' : mb + ' MB'; }
function fmtRate(bps) {
  if (bps >= 1048576) return (bps / 1048576).toFixed(1) + ' MB/s';
  if (bps >= 1024) return (bps / 1024).toFixed(1) + ' KB/s';
  return Math.round(bps) + ' B/s';
}
function setText(id, txt) { const el = document.getElementById(id); if (el) el.textContent = txt; }
