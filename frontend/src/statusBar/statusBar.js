// ==========================================================================
// NexTerm — Server Status Bar Subsystem
// Compact developer context status bar & details popover per Modern UI/UX Plan
// ==========================================================================

import { getActiveTab, getTabs } from '../state/tabState.js';

let statusInterval = null;
let currentMetrics = {
  cpu: "2.4%",
  ram: "11.6 / 30.9 GB",
  netUp: "0.01 MB/s",
  netDown: "0.12 MB/s",
  uptime: "65d",
  disks: [
    { mount: "/", usage: "14%" },
    { mount: "/opt", usage: "28%" },
    { mount: "/home", usage: "3%" }
  ]
};

export function initStatusBar() {
  const bar = document.getElementById("statusBar");
  if (!bar) return;

  bar.addEventListener("click", (e) => {
    // Trigger popover when clicking the creative capsule or server pill
    if (e.target.closest("#statusCreativeCapsule") || e.target.closest(".status-server-pill") || e.target.closest("#activeTargetText")) {
      toggleServerDetailsPopover();
    }
  });

  updateStatusBarDisplay();

  // Periodic subtle status refresh
  if (statusInterval) clearInterval(statusInterval);
  statusInterval = setInterval(() => {
    updateStatusBarDisplay();
  }, 3000);
}

export function updateStatusBarDisplay() {
  const activeTab = getActiveTab();
  const allTabs = getTabs();
  const activeCount = Object.keys(allTabs).length;

  const countEl = document.getElementById("activeSessionsCount");
  if (countEl) {
    countEl.textContent = `${activeCount} tab${activeCount === 1 ? '' : 's'}`;
  }

  const orbEl = document.getElementById("statusBeaconOrb");
  const msgEl = document.getElementById("statusMessage");
  const envBadgeEl = document.getElementById("statusEnvBadge");
  const capsuleTextEl = document.getElementById("capsuleTelemetryText");
  const capsuleChipEl = document.getElementById("capsuleSubChip");
  const protoBadgeEl = document.getElementById("statusProtoBadge");
  const capsuleBtn = document.getElementById("statusCreativeCapsule");

  if (!activeTab || !activeTab.profile) {
    if (orbEl) {
      orbEl.className = "status-dot-ready";
      orbEl.style.background = "#64748b";
      orbEl.style.boxShadow = "none";
    }
    if (msgEl) msgEl.textContent = "Workspace Ready";
    if (envBadgeEl) envBadgeEl.style.display = "none";
    if (capsuleTextEl) capsuleTextEl.textContent = "✨ NexTerm Core · Ready";
    if (capsuleChipEl) capsuleChipEl.textContent = "Idle";
    if (protoBadgeEl) protoBadgeEl.style.display = "none";
    return;
  }

  const p = activeTab.profile;
  const isConn = activeTab.isConnected;
  const proto = (p.protocol || "ssh").toUpperCase();
  const serialPrefix = activeTab.serialNo ? `[${activeTab.serialNo}] ` : "";
  const host = activeTab.remoteHostname || ((p.name && p.name !== "New Server" && p.name !== "New Session") ? p.name : (p.host || "Terminal"));
  const hostDisplay = `${serialPrefix}${host}`;

  // Resolve environment label cleanly without undefined
  let envLabel = "";
  let envColor = "#38bdf8";
  if (typeof activeTab.environment === "string" && activeTab.environment && activeTab.environment !== "undefined") {
    envLabel = activeTab.environment;
  } else if (activeTab.environment && typeof activeTab.environment === "object") {
    envLabel = activeTab.environment.label || activeTab.environment.name || "";
    envColor = activeTab.environment.color || envColor;
  } else if (p.environment) {
    envLabel = typeof p.environment === "string" ? p.environment : (p.environment.label || "");
  }

  if (envLabel && envLabel !== "undefined") {
    const upper = envLabel.toUpperCase();
    if (upper === "UAT") envColor = "#f59e0b";
    else if (upper === "PROD" || upper === "PRODUCTION") envColor = "#f43f5e";
    else if (upper === "TESTING" || upper === "TEST") envColor = "#a855f7";
    else if (upper === "LOCAL") envColor = "#10b981";
  }

  // 1. Connection orb & message
  if (orbEl) {
    orbEl.className = "status-dot-ready";
    if (isConn) {
      orbEl.style.background = "#10b981";
      orbEl.style.boxShadow = "0 0 8px #10b981";
    } else {
      orbEl.style.background = "#f59e0b";
      orbEl.style.boxShadow = "0 0 6px #f59e0b";
    }
  }

  if (msgEl) {
    if (activeTab.isLocal) {
      msgEl.textContent = isConn ? "Local Terminal" : "Local Terminal (Closed)";
    } else {
      const userHost = p.username ? `${p.username}@${p.host || host}` : host;
      msgEl.textContent = `${isConn ? '' : 'Connecting: '}${hostDisplay} (${userHost})`;
    }
  }

  // 2. Environment pill
  if (envBadgeEl) {
    if (envLabel && envLabel !== "undefined") {
      envBadgeEl.textContent = envLabel.toUpperCase();
      envBadgeEl.style.display = "inline-flex";
      envBadgeEl.style.color = envColor;
      envBadgeEl.style.borderColor = `${envColor}40`;
      envBadgeEl.style.backgroundColor = `${envColor}15`;
    } else {
      envBadgeEl.style.display = "none";
    }
  }

  // 3. Creative Telemetry Capsule in Center
  if (capsuleTextEl) {
    const memShort = (currentMetrics.ram || "").split('/')[0].trim();
    capsuleTextEl.textContent = `⚡ CPU ${currentMetrics.cpu} · RAM ${memShort || '11.6 GB'} · ↑${currentMetrics.netUp} ↓${currentMetrics.netDown}`;
  }
  if (capsuleChipEl) {
    capsuleChipEl.textContent = "Live Telemetry";
  }

  // 4. Protocol badge in right
  if (protoBadgeEl) {
    protoBadgeEl.textContent = proto;
    protoBadgeEl.style.display = "inline-flex";
  }
}

export function toggleServerDetailsPopover() {
  let popover = document.getElementById("serverDetailsPopover");
  if (popover) {
    popover.remove();
    return;
  }

  const activeTab = getActiveTab();
  if (!activeTab || !activeTab.profile) return;

  const p = activeTab.profile;
  const serialPrefix = activeTab.serialNo ? `[${activeTab.serialNo}] ` : "";
  const host = activeTab.remoteHostname || ((p.name && p.name !== "New Server" && p.name !== "New Session") ? p.name : (p.host || "Terminal"));
  const hostDisplay = `${serialPrefix}${host}`;
  const userHost = `${p.username ? p.username + '@' : ''}${p.host || 'localhost'}${p.port ? ':' + p.port : ''}`;

  let envLabel = "DEV";
  let envColor = "#38bdf8";
  if (typeof activeTab.environment === "string" && activeTab.environment && activeTab.environment !== "undefined") {
    envLabel = activeTab.environment;
  } else if (activeTab.environment && typeof activeTab.environment === "object") {
    envLabel = activeTab.environment.label || activeTab.environment.name || "DEV";
    envColor = activeTab.environment.color || envColor;
  } else if (p.environment) {
    envLabel = typeof p.environment === "string" ? p.environment : (p.environment.label || "DEV");
  }

  const upper = envLabel.toUpperCase();
  if (upper === "UAT") envColor = "#f59e0b";
  else if (upper === "PROD" || upper === "PRODUCTION") envColor = "#f43f5e";
  else if (upper === "TESTING" || upper === "TEST") envColor = "#a855f7";
  else if (upper === "LOCAL") envColor = "#10b981";

  popover = document.createElement("div");
  popover.id = "serverDetailsPopover";
  popover.className = "server-details-popover";
  popover.innerHTML = `
    <div class="popover-header">
      <div class="popover-title-row">
        <span class="popover-host">${escapeHtml(hostDisplay)}</span>
        <span class="popover-env" style="color:${envColor}; border-color:${envColor}40; background:${envColor}18;">${escapeHtml(upper)}</span>
      </div>
      <span class="popover-conn-info">${escapeHtml(userHost)}</span>
      <button class="popover-close-btn" type="button">&times;</button>
    </div>
    <div class="popover-body">
      <div class="metric-row">
        <span class="metric-label">CPU Utilization</span>
        <span class="metric-val accent">${currentMetrics.cpu}</span>
      </div>
      <div class="metric-row">
        <span class="metric-label">Memory In-Use</span>
        <span class="metric-val">${currentMetrics.ram}</span>
      </div>
      <div class="metric-divider"></div>
      <div class="disk-section">
        <span class="metric-label" style="margin-bottom:4px; display:block;">Storage Mounts</span>
        ${currentMetrics.disks.map(d => `
          <div class="disk-row">
            <span class="disk-mount">${d.mount}</span>
            <span class="disk-usage">${d.usage}</span>
          </div>
        `).join('')}
      </div>
      <div class="metric-divider"></div>
      <div class="metric-row">
        <span class="metric-label">Network Throughput</span>
        <span class="metric-val">↑ ${currentMetrics.netUp}  ↓ ${currentMetrics.netDown}</span>
      </div>
      <div class="metric-row">
        <span class="metric-label">Server Uptime</span>
        <span class="metric-val">${currentMetrics.uptime}</span>
      </div>
    </div>
  `;

  document.body.appendChild(popover);

  popover.querySelector(".popover-close-btn").addEventListener("click", () => {
    popover.remove();
  });

  const dismissHandler = (evt) => {
    if (!popover.contains(evt.target) && !evt.target.closest(".status-server-pill") && !evt.target.closest("#statusCreativeCapsule")) {
      popover.remove();
      window.removeEventListener("click", dismissHandler);
    }
  };

  setTimeout(() => {
    window.addEventListener("click", dismissHandler);
  }, 10);
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
