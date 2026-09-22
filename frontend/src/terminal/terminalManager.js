// ==========================================================================
// Nexterm — Terminal Manager Subsystem
// Manages tab creation, activation, closure, local & remote SSH launchers,
// automatic reconnection backoff sequences, and multiexec broadcast.
// ==========================================================================

import {
  tabs,
  getTabs,
  getActiveTabId,
  setActiveTabId,
  setTabConnectionState,
  deleteTab,
  setTabColor,
  setTabTitle,
  toggleTabPinned,
  isTabPinned,
  applyTabVisuals,
  refreshAllTabVisuals,
  markTabActivity,
  clearTabNotification,
  ENVIRONMENTS,
  getEnvironmentInfo
} from "../state/tabState.js";
import { workspaceState, getActiveWorkspacePane, renderWorkspace, toggleMaximizePane } from "../state/workspaceState.js";
import {
  createTerminalInstance,
  setupTerminalSearch,
  openTerminalSearch,
  closeTerminalSearch,
  renderTerminalDiagnosticCard,
  parseClassifiedError,
  handleTerminalCdCommand,
  handleTerminalTitleChange,
  handleTerminalOsc7,
  handleTerminalOutputPrompt,
  isFollowTerminalFolderEnabled,
  syncSFTPToCurrentTerminalCwd
} from "./terminal.js";
import { userSettings, THEMES } from "../settings/settings.js";
import { showToast, updateStatus, escapeHtml, registerNotifTabSwitcher } from "../ui/notifications.js";
import {
  notifyProcessStarted,
  notifyProcessOutput,
  clearTabProcess,
  registerSwitchTabHandler
} from "./processNotifier.js";
import { promptPasswordDialog, promptPassphraseDialog, promptBastionSecretDialog, registerLocalTerminalLauncher } from "../ui/modal.js";
import { getContextMenuEl, posMenu, hideContextMenu } from "../ui/contextMenu.js";
import { openBroadcastDialog } from "./broadcast.js";
import { recordCommand } from "./sessionRecorder.js";
import { pushHistory } from "./cmdHistory.js";
import { runStartupCommands } from "./serverExtras.js";

let setupDualPaneSFTPFn = null;
let switchSidebarViewFn = null;
let renderTreeFn = null;
let refreshSFTPFn = null;

export function registerDualPaneSFTP(fn) {
  setupDualPaneSFTPFn = fn;
}

export function registerTerminalManagerDependencies(deps) {
  if (deps.setupDualPaneSFTP) setupDualPaneSFTPFn = deps.setupDualPaneSFTP;
  if (deps.switchSidebarView) switchSidebarViewFn = deps.switchSidebarView;
  if (deps.renderTree) renderTreeFn = deps.renderTree;
  if (deps.refreshSFTP) refreshSFTPFn = deps.refreshSFTP;
}

// --------------------------------------------------------------------------
// Terminal Dimension Synchronization
// Ensures remote PTY / ConPTY rows and cols always match xterm viewport.
// --------------------------------------------------------------------------

export function syncTerminalSize(tabId) {
  const t = tabs[tabId];
  if (!t || !t.term) return;
  try {
    if (t.fitAddon) {
      t.fitAddon.fit();
    }
    const cols = (t.term.cols && t.term.cols > 0) ? t.term.cols : 120;
    const rows = (t.term.rows && t.term.rows > 0) ? t.term.rows : 30;
    if (window.go && window.go.main && window.go.main.App && window.go.main.App.ResizeTerminal) {
      window.go.main.App.ResizeTerminal(tabId, cols, rows).catch(() => {});
    }
  } catch (_) {}
}

// --------------------------------------------------------------------------
// Reconnection Subsystem
// --------------------------------------------------------------------------

export function getTabReconnectBanner(tabId) {
  const t = tabs[tabId];
  if (!t || !t.paneEl) return null;
  return t.paneEl.querySelector(`#reconnectBanner_${tabId}`);
}

export function hideReconnectBanner(tabId) {
  const banner = getTabReconnectBanner(tabId);
  if (banner) banner.remove();
  if (tabs[tabId]) {
    tabs[tabId].awaitingReconnectPrompt = false;
  }
}

export function showReconnectPromptBanner(tabId, profile, classifiedErr) {
  const t = tabs[tabId];
  if (!t || !t.paneEl) return;
  hideReconnectBanner(tabId);

  const container = t.paneEl.querySelector(".pane-terminal-top") || t.paneEl;
  const banner = document.createElement("div");
  banner.className = "reconnect-banner";
  banner.id = `reconnectBanner_${tabId}`;
  banner.innerHTML = `
    <div class="reconnect-banner-left">
      <span class="reconnect-pulse-icon">⚡</span>
      <div>
        <div class="reconnect-banner-title">Connection Lost</div>
        <div class="reconnect-banner-desc">Connection to <b>${escapeHtml(profile.host)}</b> was terminated. Reconnect?</div>
      </div>
    </div>
    <div class="reconnect-banner-actions">
      <button class="btn btn-primary" id="btnRecNow_${tabId}">⚡ Reconnect (Yes)</button>
      <button class="btn btn-secondary" id="btnRecAuto_${tabId}">🔄 Auto-Retry (5x)</button>
      <button class="btn btn-outline" id="btnRecDismiss_${tabId}">✕ Dismiss</button>
    </div>
  `;

  container.appendChild(banner);
  t.awaitingReconnectPrompt = true;

  const btnNow = banner.querySelector(`#btnRecNow_${tabId}`);
  if (btnNow) {
    btnNow.onclick = () => {
      hideReconnectBanner(tabId);
      startReconnectionSequence(tabId, true);
    };
  }

  const btnAuto = banner.querySelector(`#btnRecAuto_${tabId}`);
  if (btnAuto) {
    btnAuto.onclick = () => {
      hideReconnectBanner(tabId);
      startReconnectionSequence(tabId, false);
    };
  }

  const btnDismiss = banner.querySelector(`#btnRecDismiss_${tabId}`);
  if (btnDismiss) {
    btnDismiss.onclick = () => {
      hideReconnectBanner(tabId);
      if (t.term) t.term.write("\r\n\x1b[90m● Reconnection prompt dismissed.\x1b[0m\r\n");
    };
  }
}

export function updateReconnectProgressBanner(tabId, attempt, maxAttempts, secondsRemaining) {
  const t = tabs[tabId];
  if (!t || !t.paneEl) return;

  let banner = getTabReconnectBanner(tabId);
  const container = t.paneEl.querySelector(".pane-terminal-top") || t.paneEl;

  if (!banner) {
    banner = document.createElement("div");
    banner.id = `reconnectBanner_${tabId}`;
    container.appendChild(banner);
  }

  banner.className = "reconnect-banner in-progress";
  banner.innerHTML = `
    <div class="reconnect-banner-left">
      <span class="reconnect-spinner">↻</span>
      <div>
        <div class="reconnect-banner-title">Reconnecting...</div>
        <div class="reconnect-banner-desc">Attempt <b>${attempt} of ${maxAttempts}</b> — retrying in <b>${secondsRemaining}s</b> (backoff: 1s, 2s, 4s...)</div>
      </div>
    </div>
    <div class="reconnect-banner-actions">
      <button class="btn btn-primary" id="btnRecForceNow_${tabId}">Retry Now</button>
      <button class="btn btn-danger" id="btnRecCancel_${tabId}">✕ Cancel</button>
    </div>
  `;

  const btnForce = banner.querySelector(`#btnRecForceNow_${tabId}`);
  if (btnForce) {
    btnForce.onclick = () => {
      if (t.reconnectState) {
        if (t.reconnectState.timerId) clearTimeout(t.reconnectState.timerId);
        if (t.reconnectState.countdownTimerId) clearInterval(t.reconnectState.countdownTimerId);
      }
      executeReconnectAttempt(tabId, attempt);
    };
  }

  const btnCancel = banner.querySelector(`#btnRecCancel_${tabId}`);
  if (btnCancel) {
    btnCancel.onclick = () => {
      cancelReconnection(tabId);
    };
  }
}

export function showReconnectFailedBanner(tabId, maxAttempts) {
  const t = tabs[tabId];
  if (!t || !t.paneEl) return;

  let banner = getTabReconnectBanner(tabId);
  const container = t.paneEl.querySelector(".pane-terminal-top") || t.paneEl;

  if (!banner) {
    banner = document.createElement("div");
    banner.id = `reconnectBanner_${tabId}`;
    container.appendChild(banner);
  }

  banner.className = "reconnect-banner failed";
  banner.innerHTML = `
    <div class="reconnect-banner-left">
      <span class="reconnect-pulse-icon">❌</span>
      <div>
        <div class="reconnect-banner-title">Reconnection Failed</div>
        <div class="reconnect-banner-desc">Could not restore connection after <b>${maxAttempts} attempts</b>.</div>
      </div>
    </div>
    <div class="reconnect-banner-actions">
      <button class="btn btn-primary" id="btnRecRetryLoop_${tabId}">↻ Try Again</button>
      <button class="btn btn-outline" id="btnRecDismissFailed_${tabId}">✕ Dismiss</button>
    </div>
  `;

  const btnRetry = banner.querySelector(`#btnRecRetryLoop_${tabId}`);
  if (btnRetry) {
    btnRetry.onclick = () => {
      hideReconnectBanner(tabId);
      startReconnectionSequence(tabId, true);
    };
  }

  const btnDismiss = banner.querySelector(`#btnRecDismissFailed_${tabId}`);
  if (btnDismiss) {
    btnDismiss.onclick = () => {
      hideReconnectBanner(tabId);
    };
  }
}

export function cancelReconnection(tabId) {
  const t = tabs[tabId];
  if (!t) return;

  if (t.reconnectState) {
    if (t.reconnectState.timerId) clearTimeout(t.reconnectState.timerId);
    if (t.reconnectState.countdownTimerId) clearInterval(t.reconnectState.countdownTimerId);
    t.reconnectState.active = false;
    t.reconnectState.manualCancel = true;
  }

  hideReconnectBanner(tabId);
  setTabConnectionState(tabId, "Closed", null, "Reconnection canceled by user");
  if (t.term) {
    t.term.write("\r\n\x1b[1;90m● Reconnection canceled by user.\x1b[0m\r\n\r\n");
  }
  showToast("Reconnection canceled", "info");
}

export function startReconnectionSequence(tabId, forceImmediate = false) {
  const t = tabs[tabId];
  if (!t || t.isLocal) return;

  hideReconnectBanner(tabId);

  if (t.reconnectState) {
    if (t.reconnectState.timerId) clearTimeout(t.reconnectState.timerId);
    if (t.reconnectState.countdownTimerId) clearInterval(t.reconnectState.countdownTimerId);
  }

  const p = t.profile;
  const maxAttempts = p.reconnectAttempts || userSettings.reconnectAttempts || 5;
  const initialDelay = p.reconnectDelay || userSettings.reconnectDelay || 2;

  t.reconnectState = {
    active: true,
    attempt: 1,
    maxAttempts,
    initialDelay,
    timerId: null,
    countdownTimerId: null,
    secondsRemaining: 0,
    manualCancel: false
  };

  scheduleReconnectAttempt(tabId, 1, forceImmediate);
}

export function scheduleReconnectAttempt(tabId, attempt, forceImmediate = false) {
  const t = tabs[tabId];
  if (!t || !t.reconnectState || !t.reconnectState.active) return;

  const { maxAttempts, initialDelay } = t.reconnectState;
  t.reconnectState.attempt = attempt;

  let delaySeconds = 0;
  if (forceImmediate && attempt === 1) {
    delaySeconds = 0;
  } else {
    delaySeconds = Math.min(60, Math.round(initialDelay * Math.pow(2, attempt - 1)));
  }

  if (delaySeconds <= 0) {
    executeReconnectAttempt(tabId, attempt);
    return;
  }

  t.reconnectState.secondsRemaining = delaySeconds;
  setTabConnectionState(tabId, "Reconnecting", null, `Reconnecting to ${t.profile.host} (Attempt ${attempt}/${maxAttempts} in ${delaySeconds}s)...`);

  if (t.term) {
    t.term.write(`\r\n\x1b[1;33m● [Attempt ${attempt}/${maxAttempts}] Reconnecting in ${delaySeconds}s... (Press Esc or click Cancel to stop)\x1b[0m\r\n`);
  }

  updateReconnectProgressBanner(tabId, attempt, maxAttempts, delaySeconds);

  t.reconnectState.countdownTimerId = setInterval(() => {
    if (!t.reconnectState || !t.reconnectState.active) {
      clearInterval(t.reconnectState?.countdownTimerId);
      return;
    }
    t.reconnectState.secondsRemaining -= 1;
    const remaining = t.reconnectState.secondsRemaining;
    if (remaining > 0) {
      updateReconnectProgressBanner(tabId, attempt, maxAttempts, remaining);
      const statusMessageEl = document.getElementById("statusMessage");
      if (statusMessageEl && getActiveTabId() === tabId) {
        statusMessageEl.textContent = `● Reconnecting to ${t.profile.host} (Attempt ${attempt}/${maxAttempts} in ${remaining}s)...`;
      }
    } else {
      clearInterval(t.reconnectState.countdownTimerId);
    }
  }, 1000);

  t.reconnectState.timerId = setTimeout(() => {
    clearInterval(t.reconnectState?.countdownTimerId);
    executeReconnectAttempt(tabId, attempt);
  }, delaySeconds * 1000);
}

export async function executeReconnectAttempt(tabId, attempt) {
  const t = tabs[tabId];
  if (!t || !t.reconnectState || !t.reconnectState.active) return;

  const { maxAttempts } = t.reconnectState;
  const profile = t.profile;

  setTabConnectionState(tabId, "Reconnecting", null, `Connecting to ${profile.host} (Attempt ${attempt}/${maxAttempts})...`);
  if (t.term) {
    t.term.write(`\x1b[1;36m● [Attempt ${attempt}/${maxAttempts}] Connecting to ${profile.host}:${profile.port || 22}...\x1b[0m\r\n`);
    try {
      if (t.fitAddon) t.fitAddon.fit();
      if (t.term.cols > 0) profile.cols = t.term.cols;
      if (t.term.rows > 0) profile.rows = t.term.rows;
    } catch (_) {}
  }

  let password = "";
  const vKey = profile.vaultKey || profile.id;
  if (!profile.privateKeyPath && window.go && window.go.main && window.go.main.App) {
    try {
      if (vKey && typeof window.go.main.App.GetSessionPassword === "function") {
        password = await window.go.main.App.GetSessionPassword(vKey);
      } else if (vKey && typeof window.go.main.App.GetSavedPassword === "function") {
        password = await window.go.main.App.GetSavedPassword(vKey);
      }
      if (!password && window.go.main.App.FindSessionPassword && profile.host && profile.username) {
        password = await window.go.main.App.FindSessionPassword(vKey || "", profile.host, profile.port || 22, profile.username);
      }
    } catch (_) {}
  }

  try {
    if (window.go && window.go.main && window.go.main.App) {
      if (typeof window.go.main.App.OpenSessionWithTabID === "function") {
        await window.go.main.App.OpenSessionWithTabID(tabId, profile, password);
      } else {
        await window.go.main.App.OpenSession(profile, password);
      }
      syncTerminalSize(tabId);
      setTimeout(() => syncTerminalSize(tabId), 60);
    }

    if (t.reconnectState) {
      if (t.reconnectState.timerId) clearTimeout(t.reconnectState.timerId);
      if (t.reconnectState.countdownTimerId) clearInterval(t.reconnectState.countdownTimerId);
      t.reconnectState.active = false;
    }

    hideReconnectBanner(tabId);
    setTabConnectionState(tabId, "Connected");
    if (t.term) {
      t.term.write(`\r\n\x1b[1;32m✔ [Attempt ${attempt}/${maxAttempts}] Successfully reconnected to ${profile.host}!\x1b[0m\r\n\r\n`);
    }
    showToast(`Reconnected to ${profile.name}`, "success");
  } catch (err) {
    if (!t.reconnectState || !t.reconnectState.active) return;

    const classified = parseClassifiedError(err);
    if (attempt < maxAttempts) {
      const nextDelay = Math.min(60, Math.round(t.reconnectState.initialDelay * Math.pow(2, attempt)));
      if (t.term) {
        t.term.write(`\x1b[1;31m✖ [Attempt ${attempt}/${maxAttempts}] Connection failed: [${classified.category}] ${classified.message}. Next retry in ${nextDelay}s...\x1b[0m\r\n`);
      }
      scheduleReconnectAttempt(tabId, attempt + 1, false);
    } else {
      t.reconnectState.active = false;
      setTabConnectionState(tabId, "Failed", classified);
      if (t.term) {
        t.term.write(`\r\n\x1b[1;31m✖ Reconnection failed after ${maxAttempts} attempts.\x1b[0m\r\n`);
        renderTerminalDiagnosticCard(t.term, profile, classified);
      }
      showReconnectFailedBanner(tabId, maxAttempts);
      showToast(`Reconnection failed after ${maxAttempts} attempts: [${classified.category}]`, "error");
    }
  }
}

// --------------------------------------------------------------------------
// MultiExec Command Broadcast & Streaming
// --------------------------------------------------------------------------

const multiExecDataListeners = new Set();

export function addMultiExecDataListener(cb) {
  multiExecDataListeners.add(cb);
  return () => multiExecDataListeners.delete(cb);
}

export function broadcastMultiExecData(tabId, data) {
  for (const cb of multiExecDataListeners) {
    try { cb(tabId, data); } catch (e) { console.error("multiExecData error:", e); }
  }
}

// --------------------------------------------------------------------------
// Session Logging — auto-save terminal transcripts to timestamped files
// --------------------------------------------------------------------------
const ANSI_RE = new RegExp("[\\u001b\\u009b][[\\]()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]", "g");
function stripAnsi(s) {
  try { return String(s).replace(ANSI_RE, "").replace(/\r/g, ""); } catch (_) { return s; }
}

export function isAutoLogEnabled() {
  try { return localStorage.getItem("nexterm_autolog") === "1"; } catch (_) { return false; }
}
export function setAutoLog(on) {
  try { localStorage.setItem("nexterm_autolog", on ? "1" : "0"); } catch (_) {}
}

function tabLogName(t) {
  return (t && (t.customTitle || t.remoteHostname || t.profile?.name || t.profile?.host)) || "session";
}

export function maybeLogSessionData(tabId, data) {
  const t = tabs[tabId];
  if (!t || !t.logging) return;
  if (window.go && window.go.main && window.go.main.App && window.go.main.App.AppendSessionLog) {
    try { window.go.main.App.AppendSessionLog(tabId, tabLogName(t), stripAnsi(data)); } catch (_) {}
  }
}

export async function toggleSessionLogging(tabId) {
  const t = tabs[tabId];
  if (!t) { showToast("Open a terminal first", "warning"); return; }
  if (t.logging) {
    t.logging = false;
    let path = "";
    if (window.go && window.go.main && window.go.main.App && window.go.main.App.StopSessionLog) {
      try { path = await window.go.main.App.StopSessionLog(tabId); } catch (_) {}
    }
    showToast(path ? `Logging stopped — saved to ${path}` : "Session logging stopped", "info");
  } else {
    t.logging = true;
    showToast("Session logging started — auto-saving transcript to the Nexterm Logs folder", "success");
  }
}

export function toggleMultiExec() {
  const multiExecBarEl = document.getElementById("multiExecBar");
  const multiExecInputEl = document.getElementById("multiExecInput");
  if (!multiExecBarEl) return;

  const isHidden = multiExecBarEl.classList.toggle("hidden");
  if (!isHidden && multiExecInputEl) {
    multiExecInputEl.focus();
    showToast("MultiExec enabled: Commands will broadcast to all tabs", "info");
  }
}

export async function sendMultiExec() {
  const multiExecInputEl = document.getElementById("multiExecInput");
  if (!multiExecInputEl) return;

  const text = multiExecInputEl.value;
  if (!text) return;
  if (window.go && window.go.main && window.go.main.App) {
    await window.go.main.App.BroadcastCommand([], text, "parallel");
  } else {
    Object.values(tabs).forEach(t => t.term.write(text + "\r\n"));
  }
  multiExecInputEl.value = "";
  showToast("Broadcast sent to all active tabs", "success");
}

// --------------------------------------------------------------------------
// Per-environment color enforcement — a colored border + badge around the
// active terminal so it's obvious when you're working on Production/UAT/etc.
// --------------------------------------------------------------------------
function applyEnvGuard(tab) {
  const ws = document.getElementById("workspace");
  if (!ws) return;
  const env = tab ? getEnvironmentInfo(tab.environment || tab.profile?.environment || tab.color || tab.profile?.color) : null;
  const color = env ? env.color : "";
  // Only guard Production — it's the high-risk environment. Other environments
  // (test/uat/dev/…) don't get the border+badge so it stays out of the way.
  if (env && env.key === "prod" && color) {
    ws.style.borderTop = `3px solid ${color}`;
    ws.style.boxShadow = `inset 0 0 0 1px ${color}44`;
    let badge = document.getElementById("envGuardBadge");
    if (!badge) {
      badge = document.createElement("div");
      badge.id = "envGuardBadge";
      badge.className = "env-guard-badge";
      ws.appendChild(badge);
    }
    const host = tab.profile?.host || "";
    badge.textContent = `${env.label}${host ? " · " + host : ""}`;
    badge.style.background = env.bg || color;
    badge.style.color = color;
    badge.style.borderColor = color;
    badge.hidden = false;
  } else {
    clearEnvGuard();
  }
}

function clearEnvGuard() {
  const ws = document.getElementById("workspace");
  if (ws) { ws.style.borderTop = ""; ws.style.boxShadow = ""; }
  const badge = document.getElementById("envGuardBadge");
  if (badge) badge.hidden = true;
}

// --------------------------------------------------------------------------
// Tab Lifecycle & Terminal Creation
// --------------------------------------------------------------------------

export function activateHomeTab() {
  clearEnvGuard();
  setActiveTabId("home");
  const homeTabBtnEl = document.getElementById("homeTabBtn");
  const welcomeStateEl = document.getElementById("welcomeState");

  if (homeTabBtnEl) homeTabBtnEl.classList.add("active");
  if (welcomeStateEl) welcomeStateEl.classList.add("active");

  Object.values(tabs).forEach(t => {
    if (t.tabEl) t.tabEl.classList.remove("active");
    if (t.paneEl) t.paneEl.classList.remove("active");
  });

  if (switchSidebarViewFn) switchSidebarViewFn("sessions");
  if (renderTreeFn) renderTreeFn();

  const searchInput = document.getElementById("welcomeSearchInput");
  if (searchInput && typeof searchInput.focus === "function") {
    setTimeout(() => {
      try { searchInput.focus(); } catch (_) {}
    }, 50);
  }

  updateStatus();
}

export function activateTab(tabId) {
  if (tabId === "home") {
    activateHomeTab();
    return;
  }

  const homeTabBtnEl = document.getElementById("homeTabBtn");
  const welcomeStateEl = document.getElementById("welcomeState");

  if (homeTabBtnEl) homeTabBtnEl.classList.remove("active");
  if (welcomeStateEl) welcomeStateEl.classList.remove("active");

  setActiveTabId(tabId);
  markTabActivity(tabId, false);
  try { clearTabProcess(tabId); } catch (_) {}

  const ownerPane = workspaceState.panes.find(p => p.tabIds && p.tabIds.includes(tabId));
  if (ownerPane) {
    ownerPane.activeTabId = tabId;
    workspaceState.activePaneId = ownerPane.id;
  }

  Object.entries(tabs).forEach(([id, t]) => {
    const isActive = id === tabId;
    if (t.tabEl) t.tabEl.classList.toggle("active", isActive);
  });

  renderWorkspace();

  const currentTab = tabs[tabId];
  applyEnvGuard(currentTab);
  if (currentTab) {
    syncTerminalSize(tabId);
    setTimeout(() => {
      try {
        syncTerminalSize(tabId);
        if (currentTab.term) currentTab.term.focus();
      } catch (e) {}
    }, 40);

    const sftpBadge = document.getElementById("sftpActiveTabBadge");
    if (!currentTab.isLocal) {
      const serialPrefix = currentTab.serialNo ? `[${currentTab.serialNo}] ` : "";
      const sName = currentTab.remoteHostname || ((currentTab.profile?.name && currentTab.profile.name !== "New Server" && currentTab.profile.name !== "New Session") ? currentTab.profile.name : (currentTab.profile?.host ? (currentTab.profile.username ? `${currentTab.profile.username}@${currentTab.profile.host}` : currentTab.profile.host) : "Server"));
      if (sftpBadge) sftpBadge.textContent = `${serialPrefix}${sName}`;
      if (switchSidebarViewFn) switchSidebarViewFn("sftp");
      if (isFollowTerminalFolderEnabled()) {
        syncSFTPToCurrentTerminalCwd(tabId);
      } else {
        const currentSFTPPath = currentTab.sftpPath || (currentTab.profile && currentTab.profile.initialDir) || "~";
        if (refreshSFTPFn) refreshSFTPFn(currentSFTPPath);
      }
    } else {
      if (sftpBadge) sftpBadge.textContent = "Local Terminal";
      if (switchSidebarViewFn) switchSidebarViewFn("sessions");
    }
  }

  updateStatus();
}

try {
  registerSwitchTabHandler(activateTab);
  registerNotifTabSwitcher(activateTab);
} catch (_) {}

export function closeTab(tabId) {
  const t = tabs[tabId];
  if (!t) return;

  if (t.isConnected) {
    const sName = t.profile?.name || t.profile?.host || (t.isLocal ? "Local Terminal" : "Session");
    showToast(`● Disconnected: ${sName}`, "info", { eventType: "disconnect", isSystemEvent: true });
  }
  try { clearTabProcess(tabId); } catch (_) {}

  // Flush and close any active session log for this tab.
  if (t.logging && window.go && window.go.main && window.go.main.App && window.go.main.App.StopSessionLog) {
    try { window.go.main.App.StopSessionLog(tabId); } catch (_) {}
    t.logging = false;
  }

  if (t.reconnectState) {
    if (t.reconnectState.timerId) clearTimeout(t.reconnectState.timerId);
    if (t.reconnectState.countdownTimerId) clearInterval(t.reconnectState.countdownTimerId);
    t.reconnectState.active = false;
  }
  hideReconnectBanner(tabId);

  if (t.unsubscribers && Array.isArray(t.unsubscribers)) {
    t.unsubscribers.forEach(unsub => {
      try {
        if (typeof unsub === "function") unsub();
      } catch (_) {}
    });
    t.unsubscribers = [];
  }

  if (window.runtime && window.runtime.EventsOff) {
    try { window.runtime.EventsOff("terminal:data:" + tabId); } catch (_) {}
    try { window.runtime.EventsOff("terminal:state:" + tabId); } catch (_) {}
    try { window.runtime.EventsOff("terminal:closed:" + tabId); } catch (_) {}
  }

  if (window.go && window.go.main && window.go.main.App) {
    window.go.main.App.CloseTab(tabId);
  }

  const ownerPane = workspaceState.panes.find(p => p.tabIds && p.tabIds.includes(tabId));
  if (ownerPane) {
    const idx = ownerPane.tabIds.indexOf(tabId);
    if (idx !== -1) ownerPane.tabIds.splice(idx, 1);
    if (ownerPane.activeTabId === tabId) {
      ownerPane.activeTabId = ownerPane.tabIds.length > 0 ? ownerPane.tabIds[ownerPane.tabIds.length - 1] : null;
    }
  }

  if (t.searchAddon && typeof t.searchAddon.dispose === "function") {
    try { t.searchAddon.dispose(); } catch (_) {}
  }
  try { t.term.dispose(); } catch (_) {}
  if (t.tabEl) t.tabEl.remove();
  if (t.paneEl) t.paneEl.remove();
  deleteTab(tabId);

  refreshAllTabVisuals();
  renderWorkspace();

  const remaining = Object.keys(tabs);
  if (remaining.length > 0) {
    if (ownerPane && ownerPane.activeTabId) {
      activateTab(ownerPane.activeTabId);
    } else {
      activateTab(remaining[remaining.length - 1]);
    }
  } else {
    activateHomeTab();
  }

  updateStatus();
  if (renderTreeFn) renderTreeFn();
}

export function findTabBySessionId(sessionId) {
  if (!sessionId) return null;
  for (const [id, t] of Object.entries(tabs)) {
    if (t.profile && (t.profile.id === sessionId || t.profile.sessionId === sessionId)) {
      return id;
    }
  }
  return null;
}

export function duplicateTab(tabId) {
  if (tabId && tabs[tabId]) {
    const t = tabs[tabId];
    if (t.isLocal) {
      startLocalTerminal("powershell");
    } else if (t.profile) {
      const dupProfile = {
        ...t.profile,
        id: "dup-" + Date.now() + "-" + Math.random().toString(36).substr(2, 6),
        sessionId: t.profile.id,
        vaultKey: t.profile.vaultKey || t.profile.id,
        name: t.profile.name || t.profile.host
      };
      connectToSession(dupProfile, true);
      showToast(`Duplicating tab for "${dupProfile.name}"...`, "info");
    }
  }
}

export function createTab(tabId, profile, isLocal = false, initialState = "Connected") {
  const welcomeStateEl = document.getElementById("welcomeState");
  const homeTabBtnEl = document.getElementById("homeTabBtn");
  const tabbarEl = document.getElementById("tabbar");

  if (welcomeStateEl) welcomeStateEl.classList.remove("active");
  if (homeTabBtnEl) homeTabBtnEl.classList.remove("active");

  const initialDotClass = isLocal ? "state-connected" : (initialState === "Connecting" ? "state-connecting" : "state-connected");
  const initialTooltip = isLocal ? "● Connected" : (initialState === "Connecting" ? "● Connecting..." : "● Connected");

  const env = getEnvironmentInfo(profile.environment || profile.color);
  const envBadgeHtml = env
    ? `<span class="tab-env-badge env-${env.key}" style="color:${env.color}; background:${env.bg}; border-color:${env.border};" title="Environment: ${env.name}">${env.label}</span>`
    : '';

  const existingTabEls = tabbarEl ? tabbarEl.querySelectorAll(".tab-item:not(.home-tab)") : [];
  const initialSerial = existingTabEls.length + 1;
  const initialServerName = (profile.name && profile.name !== "New Server" && profile.name !== "New Session")
    ? profile.name
    : (profile.host ? (profile.username ? `${profile.username}@${profile.host}` : profile.host) : (isLocal ? "Local Terminal" : "Terminal"));
  const initialFullTitle = `[${initialSerial}] ${initialServerName}`;

  const tabEl = document.createElement("div");
  tabEl.className = "tab-item active";
  tabEl.dataset.tabId = tabId;
  tabEl.title = `${initialFullTitle} (${initialTooltip})${env ? ` [${env.name}]` : ''}`;
  tabEl.innerHTML = `
    <span class="tab-dot ${initialDotClass}" title="${initialTooltip}"></span>
    <span class="tab-title" title="${escapeHtml(initialFullTitle)}"><span class="tab-serial">[${initialSerial}] </span>${escapeHtml(initialServerName)}</span>
    ${envBadgeHtml}
    <span class="tab-notify-dot" title="Attention / Notification" style="display:none;">•</span>
    <span class="tab-dropdown-btn" title="Server Options & Color">▾</span>
    <span class="tab-close" title="Close (Ctrl+W)">&times;</span>
  `;

  tabEl.addEventListener("click", () => activateTab(tabId));
  tabEl.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    showTabContextMenu(e.clientX, e.clientY, tabId);
  });
  const tabDropBtn = tabEl.querySelector(".tab-dropdown-btn");
  if (tabDropBtn) {
    tabDropBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const rect = tabDropBtn.getBoundingClientRect();
      showTabContextMenu(rect.left, rect.bottom + 4, tabId);
    });
  }
  tabEl.querySelector(".tab-close").addEventListener("click", (e) => {
    e.stopPropagation();
    closeTab(tabId);
  });

  if (tabbarEl) {
    const inlineAdd = document.getElementById("tabInlineAddBtn");
    if (inlineAdd && inlineAdd.parentNode === tabbarEl) tabbarEl.insertBefore(tabEl, inlineAdd);
    else tabbarEl.appendChild(tabEl);
  }

  const paneEl = document.createElement("div");
  paneEl.className = "terminal-pane active";
  paneEl.dataset.tabId = tabId;

  let termCanvas = paneEl;
  if (!isLocal) {
    paneEl.innerHTML = `
      <div class="pane-split-wrap">
        <div class="pane-terminal-top">
          <div class="terminal-canvas-wrap" id="termCanvas_${tabId}"></div>
        </div>
        <div class="pane-split-divider" id="splitDivider_${tabId}">
          <div class="pane-split-handle" id="splitHandle_${tabId}" title="Drag to resize / Click toggle button to collapse SFTP">
            <span class="split-drag-bar"></span>
            <button class="split-toggle-btn" id="sftpToggleBtn_${tabId}" type="button">
              <span class="split-icon">📂</span> Show SFTP Dual File Manager
            </button>
          </div>
        </div>
        <div class="pane-sftp-bottom is-collapsed" id="sftpBottom_${tabId}">
          <div class="sftp-dual-container" id="sftpDual_${tabId}">
            <!-- Local Files Half -->
            <div class="sftp-half-pane sftp-pane-local" id="sftpLocalHalf_${tabId}">
              <div class="sftp-pane-header">
                <div class="sftp-header-left">
                  <span class="sftp-pane-badge local">💻 Local PC</span>
                  <select class="sftp-drive-select" id="sftpDriveSel_${tabId}" title="Select Drive"></select>
                  <input type="text" class="sftp-path-bar" id="sftpLocalPath_${tabId}" spellcheck="false" autocomplete="off" />
                </div>
                <div class="sftp-pane-actions">
                  <button class="sftp-mini-btn" id="sftpLocalUp_${tabId}" title="Up one folder">⬆</button>
                  <button class="sftp-mini-btn" id="sftpLocalRefresh_${tabId}" title="Refresh local files">↻</button>
                  <button class="sftp-mini-btn" id="sftpLocalMkdir_${tabId}" title="New local folder">📁+</button>
                  <button class="sftp-mini-btn" id="sftpLocalMkfile_${tabId}" title="New local file">📄+</button>
                  <button class="sftp-mini-btn" id="sftpLocalDel_${tabId}" title="Delete local file/folder">🗑️</button>
                </div>
              </div>
              <div class="sftp-table-head">
                <div class="sftp-col name">Name</div>
                <div class="sftp-col size">Size</div>
                <div class="sftp-col date">Modified</div>
              </div>
              <div class="sftp-file-tbody" id="sftpLocalList_${tabId}">
                <div style="color: #64748b; padding: 12px; font-size: 11px;">Loading local files...</div>
              </div>
            </div>

            <!-- Transfer Center Controls -->
            <div class="sftp-transfer-divider">
              <button class="btn-sftp-transfer btn-transfer-upload" id="sftpUploadBtn_${tabId}" title="Upload selected local file to remote server">
                <span class="arrow">➔</span>
                <span class="label">Upload</span>
              </button>
              <button class="btn-sftp-transfer btn-transfer-download" id="sftpDownloadBtn_${tabId}" title="Download selected remote file to local PC">
                <span class="arrow">⬅</span>
                <span class="label">Download</span>
              </button>
            </div>

            <!-- Remote Files Half -->
            <div class="sftp-half-pane sftp-pane-remote" id="sftpRemoteHalf_${tabId}">
              <div class="sftp-pane-header">
                <div class="sftp-header-left">
                  <span class="sftp-pane-badge remote">🌐 Remote Server</span>
                  <input type="text" class="sftp-path-bar" id="sftpRemotePath_${tabId}" spellcheck="false" autocomplete="off" />
                </div>
                <div class="sftp-pane-actions">
                  <button class="sftp-mini-btn" id="sftpRemoteUp_${tabId}" title="Up one folder">⬆</button>
                  <button class="sftp-mini-btn" id="sftpRemoteRefresh_${tabId}" title="Refresh remote files">↻</button>
                  <button class="sftp-mini-btn" id="sftpRemoteMkdir_${tabId}" title="New remote folder">📁+</button>
                  <button class="sftp-mini-btn" id="sftpRemoteMkfile_${tabId}" title="New remote file">📄+</button>
                  <button class="sftp-mini-btn" id="sftpRemoteEdit_${tabId}" title="Edit in NexTerm Editor">📝</button>
                  <button class="sftp-mini-btn" id="sftpRemoteChmod_${tabId}" title="Change Permissions (chmod)">🔑</button>
                  <button class="sftp-mini-btn" id="sftpRemoteDel_${tabId}" title="Delete remote file/folder">🗑️</button>
                </div>
              </div>
              <div class="sftp-table-head">
                <div class="sftp-col name">Name</div>
                <div class="sftp-col size">Size</div>
                <div class="sftp-col perm">Perms</div>
                <div class="sftp-col date">Modified</div>
              </div>
              <div class="sftp-file-tbody" id="sftpRemoteList_${tabId}">
                <div style="color: #64748b; padding: 12px; font-size: 11px;">Loading remote files...</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
    termCanvas = paneEl.querySelector(`#termCanvas_${tabId}`);
  }

  const { term, fitAddon, searchAddon } = createTerminalInstance(profile, userSettings);
  term.open(termCanvas);

  const unsubs = [];

  // Synchronize terminal dimensions to remote PTY whenever xterm is resized
  term.onResize(({ cols, rows }) => {
    if (window.go && window.go.main && window.go.main.App && window.go.main.App.ResizeTerminal) {
      window.go.main.App.ResizeTerminal(tabId, cols, rows).catch(() => {});
    }
  });

  // Observe container size changes (window resize, sidebar drag, pane split, SFTP drawer)
  const termContainer = paneEl.querySelector(".pane-terminal-top") || paneEl;
  let roTimer = null;
  const ro = new ResizeObserver(() => {
    clearTimeout(roTimer);
    roTimer = setTimeout(() => {
      try {
        if (tabs[tabId] && tabs[tabId].fitAddon) {
          tabs[tabId].fitAddon.fit();
        }
      } catch (_) {}
    }, 40);
  });
  ro.observe(termContainer);
  unsubs.push(() => ro.disconnect());

  // Terminal search keyboard intercept
  term.attachCustomKeyEventHandler((e) => {
    if ((e.ctrlKey || e.metaKey) && ((e.shiftKey && (e.key === "F" || e.key === "f")) || (!e.shiftKey && (e.key === "f" || e.key === "F")))) {
      if (e.type === "keydown") {
        openTerminalSearch(tabId);
      }
      return false;
    }
    if (e.key === "Escape" && tabs[tabId] && tabs[tabId].searchState && tabs[tabId].searchState.isOpen) {
      if (e.type === "keydown") {
        closeTerminalSearch(tabId);
      }
      return false;
    }
    return true;
  });

  const searchState = setupTerminalSearch(tabId, paneEl, term, searchAddon);

  if (!isLocal && setupDualPaneSFTPFn) {
    setupDualPaneSFTPFn(tabId, profile, paneEl, fitAddon, term);
  }

  setTimeout(() => {
    try {
      syncTerminalSize(tabId);
      term.focus();
    } catch (e) {}
  }, 50);

  let inputBuffer = "";
  let outputBuffer = "";

  term.onData((data) => {
    if (window.go && window.go.main && window.go.main.App) {
      window.go.main.App.WriteToTerminal(tabId, data);
    }

    for (let i = 0; i < data.length; i++) {
      const ch = data[i];
      if (ch === "\r" || ch === "\n") {
        const cmd = inputBuffer.trim();
        inputBuffer = "";
        if (cmd) {
          try { notifyProcessStarted(tabId, cmd); } catch (_) {}
        }
        if (!isLocal) {
          handleTerminalCdCommand(tabId, cmd);
          try { recordCommand(tabId, cmd); } catch (_) {}
          try { pushHistory(tabs[tabId] && tabs[tabId].profile ? tabs[tabId].profile.host : "", cmd); } catch (_) {}
        }
      } else if (ch === "\x7f" || ch === "\b") {
        inputBuffer = inputBuffer.slice(0, -1);
      } else if (ch === "\x03" || ch === "\x15") {
        inputBuffer = "";
      } else if (ch >= " " && ch <= "~") {
        inputBuffer += ch;
      }
    }
  });

  term.onTitleChange((title) => {
    if (!title || isLocal) return;
    handleTerminalTitleChange(tabId, title);
  });

  try {
    if (term.parser && typeof term.parser.registerOscHandler === "function") {
      term.parser.registerOscHandler(7, (data) => {
        if (!isLocal) handleTerminalOsc7(tabId, data);
        return true;
      });
    }
  } catch (_) {}

  if (window.runtime && window.runtime.EventsOn) {
    const unsubData = window.runtime.EventsOn("terminal:data:" + tabId, (data) => {
      term.write(data);
      broadcastMultiExecData(tabId, data);
      maybeLogSessionData(tabId, data);
      try { notifyProcessOutput(tabId, data); } catch (_) {}
      if (!isLocal) {
        outputBuffer = (outputBuffer + data).slice(-500);
        handleTerminalOutputPrompt(tabId, outputBuffer);
      }
      if (getActiveTabId() !== tabId) {
        markTabActivity(tabId, true);
      }
    });
    if (typeof unsubData === "function") unsubs.push(unsubData);

    if (term.onBell) {
      term.onBell(() => {
        if (getActiveTabId() !== tabId) {
          markTabActivity(tabId, true);
        }
      });
    }

    const unsubState = window.runtime.EventsOn("terminal:state:" + tabId, (payload) => {
      if (!payload) return;
      const st = payload.state;
      const msg = payload.message || "";
      const errInfo = payload.error ? parseClassifiedError(payload.error) : null;
      setTabConnectionState(tabId, st, errInfo, msg);

      if (st === "Connecting") {
        term.write(`\r\n\x1b[1;36m● Connecting to ${profile.username || 'user'}@${profile.host}:${profile.port || 22}...\x1b[0m\r\n`);
      } else if (st === "Authenticating") {
        term.write(`\x1b[1;33m● Authenticating user '${profile.username}'...\x1b[0m\r\n`);
      } else if (st === "Connected") {
        term.write(`\x1b[1;32m● Connected to ${profile.host}\x1b[0m\r\n\r\n`);
        showToast(`● Connected: ${profile.name || profile.host}`, "success", { eventType: "connect", isSystemEvent: true });
        syncTerminalSize(tabId);
        setTimeout(() => syncTerminalSize(tabId), 100);
        if (switchSidebarViewFn) switchSidebarViewFn("sftp");
        const currentSFTPPath = (tabs[tabId] && tabs[tabId].sftpPath) || (profile && profile.initialDir) || "~";
        if (refreshSFTPFn) refreshSFTPFn(currentSFTPPath);
      } else if (st === "Failed") {
        renderTerminalDiagnosticCard(term, profile, errInfo);
        showToast(`● Connection failed: ${profile.name || profile.host}`, "error", { isSystemEvent: true });
      }
    });
    if (typeof unsubState === "function") unsubs.push(unsubState);

    const unsubClosed = window.runtime.EventsOn("terminal:closed:" + tabId, (payload) => {
      let reason = "Disconnected";
      let errInfo = null;
      if (typeof payload === "object" && payload !== null) {
        reason = payload.reason || "Disconnected";
        errInfo = {
          category: payload.category || "Server closed connection",
          message: payload.reason || "Session closed",
          description: payload.description || "The remote server or network closed the connection.",
          rawError: payload.rawError || payload.reason || ""
        };
      } else if (typeof payload === "string") {
        reason = payload;
        errInfo = parseClassifiedError(payload);
      }

      setTabConnectionState(tabId, "Closed", errInfo, reason);
      term.write(`\r\n\x1b[1;31m[● Connection lost: ${errInfo.category} - ${errInfo.message}]\x1b[0m\r\n`);
      showToast(`● Disconnected: ${profile.name || profile.host}`, "warning", { eventType: "disconnect", isSystemEvent: true });
      renderTerminalDiagnosticCard(term, profile, errInfo);

      if (!isLocal && tabs[tabId]) {
        const shouldAuto = profile.autoReconnect !== undefined ? profile.autoReconnect : userSettings.autoReconnect;
        if (shouldAuto) {
          startReconnectionSequence(tabId, false);
        } else {
          showReconnectPromptBanner(tabId, profile, errInfo);
          term.write(`\x1b[1;33m● Connection lost to ${profile.host}. Press \x1b[1;36m[Enter]\x1b[1;33m or \x1b[1;36m[Y]\x1b[1;33m to reconnect, or \x1b[1;36m[N]\x1b[1;33m to dismiss.\x1b[0m\r\n\r\n`);
          tabs[tabId].awaitingReconnectPrompt = true;
        }
      }
    });
    if (typeof unsubClosed === "function") unsubs.push(unsubClosed);
  }

  term.onKey((e) => {
    const tObj = tabs[tabId];
    if (!tObj) return;

    if (tObj.awaitingReconnectPrompt) {
      if (e.key === "\r" || e.key.toLowerCase() === "y") {
        tObj.awaitingReconnectPrompt = false;
        hideReconnectBanner(tabId);
        startReconnectionSequence(tabId, true);
        return;
      } else if (e.key.toLowerCase() === "n" || (e.domEvent && e.domEvent.key === "Escape")) {
        tObj.awaitingReconnectPrompt = false;
        hideReconnectBanner(tabId);
        term.write("\r\n\x1b[90m● Reconnection dismissed.\x1b[0m\r\n");
        return;
      }
    }

    if (tObj.reconnectState && tObj.reconnectState.active && e.domEvent && e.domEvent.key === "Escape") {
      cancelReconnection(tabId);
      return;
    }
  });

  paneEl.addEventListener("contextmenu", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (userSettings.rightClickPaste !== false) {
      try {
        const text = await navigator.clipboard.readText();
        if (text && window.go && window.go.main && window.go.main.App) {
          window.go.main.App.WriteToTerminal(tabId, text);
        }
      } catch (err) {
        console.warn("Clipboard paste error:", err);
      }
    }
  });

  paneEl.addEventListener("auxclick", async (e) => {
    if (e.button === 1) {
      e.preventDefault();
      try {
        const text = await navigator.clipboard.readText();
        if (text && window.go && window.go.main && window.go.main.App) {
          window.go.main.App.WriteToTerminal(tabId, text);
        }
      } catch (_) {}
    }
  });

  term.onSelectionChange(() => {
    if (userSettings.autoCopySelection !== false) {
      const selection = term.getSelection();
      if (selection && selection.length > 0) {
        navigator.clipboard.writeText(selection).catch(() => {});
      }
    }
  });

  paneEl.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
  });

  paneEl.addEventListener("drop", async (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const paths = [];
      for (let i = 0; i < e.dataTransfer.files.length; i++) {
        const file = e.dataTransfer.files[i];
        const p = file.path || file.name;
        paths.push(p.includes(" ") ? `"${p}"` : p);
      }
      const textToPaste = paths.join(" ") + " ";
      if (window.go && window.go.main && window.go.main.App) {
        window.go.main.App.WriteToTerminal(tabId, textToPaste);
      }
    } else {
      const text = e.dataTransfer.getData("text");
      if (text && window.go && window.go.main && window.go.main.App) {
        window.go.main.App.WriteToTerminal(tabId, text);
      }
    }
  });

  const targetPane = getActiveWorkspacePane();
  if (!targetPane.tabIds.includes(tabId)) {
    targetPane.tabIds.push(tabId);
  }
  targetPane.activeTabId = tabId;

  tabs[tabId] = {
    id: tabId,
    title: profile?.name || (isLocal ? "Local Terminal" : "SSH Session"),
    host: profile?.host || (isLocal ? "Local Shell" : "127.0.0.1"),
    term,
    fitAddon,
    searchAddon,
    searchState,
    profile,
    paneEl,
    tabEl,
    paneId: targetPane.id,
    isConnected: initialState === "Connected" || isLocal,
    connectionState: isLocal ? "Connected" : initialState,
    stateMessage: "",
    errorInfo: null,
    isLocal,
    sftpPath: profile.initialDir || "~",
    terminalCwd: profile.initialDir || "~",
    lastSftpPath: "~",
    unsubscribers: unsubs,
    reconnectState: null,
    awaitingReconnectPrompt: false,
    color: profile.color || "",
    environment: profile.environment || "",
    pinned: false,
    customTitle: ""
  };

  renderWorkspace();
  refreshAllTabVisuals();
  applyTabVisuals(tabId);
  activateTab(tabId);
  if (renderTreeFn) renderTreeFn();
}

// --------------------------------------------------------------------------
// Launchers: Local Terminal & SSH Connect
// --------------------------------------------------------------------------

export async function startLocalTerminal(shellType = "powershell") {
  showToast("Launching local terminal...", "info");
  let tabId;
  try {
    if (window.go && window.go.main && window.go.main.App) {
      tabId = await window.go.main.App.OpenLocalTerminal(shellType);
    } else {
      tabId = "mock-local-" + Date.now();
    }
  } catch (err) {
    showToast("Failed to start local terminal: " + err, "error");
    return;
  }

  const profile = {
    id: tabId,
    name: shellType === "powershell" ? "PowerShell" : "Command Prompt",
    host: "localhost",
    username: "Local"
  };

  createTab(tabId, profile, true);
  showToast("Local terminal started", "success");
}

// Register local terminal launcher so modal text editor can launch PS
registerLocalTerminalLauncher(startLocalTerminal);

export async function connectToSession(profile, forceNewTab = false) {
  if (!profile) return;

  const activePane = getActiveWorkspacePane();
  const currentPaneHasTab = profile.id && activePane && activePane.tabIds && activePane.tabIds.some(tId => {
    const t = tabs[tId];
    return t && t.profile && (t.profile.id === profile.id || t.profile.sessionId === profile.id);
  });

  // Single Tab Policy: Focus existing active connection ONLY if not forceNewTab and current pane already has it
  if (!forceNewTab && profile.id) {
    const existingTabId = findTabBySessionId(profile.id);
    if (existingTabId && tabs[existingTabId]) {
      const ex = tabs[existingTabId];
      if (ex.isConnected || ex.connectionState === "Connecting" || ex.connectionState === "Authenticating") {
        if (workspaceState.layout === "single" || currentPaneHasTab) {
          activateTab(existingTabId);
          showToast(`Focused active connection for "${profile.name || profile.host}"`, "info");
          return;
        }
      }
    }
  }

  let password = profile.password || profile.tempPassword || "";
  const authType = profile.authType || (profile.privateKeyPath ? "key" : "password");
  const vKey = profile.vaultKey || profile.id;

  if (authType === "password") {
    if (!password) {
      let hasSaved = false;
      if (window.go && window.go.main && window.go.main.App) {
        try {
          if (vKey) {
            hasSaved = await window.go.main.App.HasSavedPassword(vKey);
            if (hasSaved) {
              if (typeof window.go.main.App.GetSessionPassword === "function") {
                password = await window.go.main.App.GetSessionPassword(vKey);
              } else if (typeof window.go.main.App.GetSavedPassword === "function") {
                password = await window.go.main.App.GetSavedPassword(vKey);
              }
            }
          }
          // Cross-session fallback: check if existing credentials match this host/username
          if (!password && window.go.main.App.FindSessionPassword && profile.host && profile.username) {
            const found = await window.go.main.App.FindSessionPassword(vKey || "", profile.host, profile.port || 22, profile.username);
            if (found) {
              password = found;
              hasSaved = true;
            }
          }
        } catch (err) {}
      }

      if (!hasSaved || !password) {
        password = await promptPasswordDialog(profile);
        if (password === null) return;
      }
    }
  } else if (authType === "key") {
    if (profile.privateKeyPath && window.go && window.go.main && window.go.main.App && window.go.main.App.ValidatePrivateKeyFile) {
      let hasSavedPass = false;
      const passKey = profile.passphraseVaultKey || (profile.vaultKey ? profile.vaultKey + "_passphrase" : "");
      if (passKey && window.go.main.App.GetSessionPassphrase) {
        try {
          const saved = await window.go.main.App.GetSessionPassphrase(passKey);
          if (saved) hasSavedPass = true;
        } catch (_) {}
      }
      if (!hasSavedPass && !profile.keyPassphrase) {
        try {
          const info = await window.go.main.App.ValidatePrivateKeyFile(profile.privateKeyPath, "");
          if (info && info.encrypted) {
            const enteredPass = await promptPassphraseDialog(profile);
            if (enteredPass === null) return;
            profile.keyPassphrase = enteredPass;
          }
        } catch (_) {}
      }
    }
  } else if (authType === "agent") {
    if (window.go && window.go.main && window.go.main.App && window.go.main.App.CheckSSHAgent) {
      try {
        const agentStatus = await window.go.main.App.CheckSSHAgent();
        if (agentStatus && !agentStatus.available) {
          showToast(`Warning: SSH Agent not active (${agentStatus.error || 'service not running'})`, "warning");
        }
      } catch (_) {}
    }
  }

  // Bastion / Jump Host: resolve whatever secret the gateway hop needs
  // *before* we ever hit the backend, mirroring the target-host password
  // flow above. Without this, a jump host configured for password or
  // encrypted-key auth has no way to actually authenticate — the tunnel
  // dials out but the SSH handshake to the gateway itself fails.
  let jumpSecret = "";
  if (profile.useJumpHost && profile.jumpHost) {
    const jumpAuthType = profile.jumpAuthType || "password";
    const gatewayLabel = `${profile.jumpUsername || 'bastion'}@${profile.jumpHost}:${profile.jumpPort || 22}`;

    if (jumpAuthType === "key") {
      if (profile.jumpVaultKey && window.go?.main?.App?.GetSessionPassphrase) {
        try {
          jumpSecret = (await window.go.main.App.GetSessionPassphrase(profile.jumpVaultKey + "_passphrase")) || "";
        } catch (_) {}
      }
      if (!jumpSecret && profile.jumpPrivateKeyPath && window.go?.main?.App?.ValidatePrivateKeyFile) {
        try {
          const info = await window.go.main.App.ValidatePrivateKeyFile(profile.jumpPrivateKeyPath, "");
          if (info && info.encrypted) {
            const entered = await promptBastionSecretDialog({
              gatewayLabel,
              vaultKey: profile.jumpVaultKey,
              isKey: true,
              keyPath: profile.jumpPrivateKeyPath
            });
            if (entered === null) return;
            jumpSecret = entered;
          }
        } catch (_) {}
      }
    } else {
      if (profile.jumpVaultKey && window.go?.main?.App?.HasSavedPassword) {
        try {
          const hasSaved = await window.go.main.App.HasSavedPassword(profile.jumpVaultKey);
          if (hasSaved && window.go.main.App.GetSessionPassword) {
            jumpSecret = (await window.go.main.App.GetSessionPassword(profile.jumpVaultKey)) || "";
          }
        } catch (_) {}
      }
      if (!jumpSecret) {
        const entered = await promptBastionSecretDialog({
          gatewayLabel,
          vaultKey: profile.jumpVaultKey,
          isKey: false
        });
        if (entered === null) return;
        jumpSecret = entered;
      }
    }
  }

  // Reuse existing tab if disconnected/failed, otherwise create exactly one tab
  let tabId = (!forceNewTab && profile.id && findTabBySessionId(profile.id)) || null;
  if (tabId && tabs[tabId]) {
    tabs[tabId].profile = profile;
    setTabConnectionState(tabId, "Connecting", null, `Connecting to ${profile.host}...`);
    activateTab(tabId);
    if (tabs[tabId].term) {
      tabs[tabId].term.reset();
    }
  } else {
    tabId = "ssh-" + Math.random().toString(36).substring(2, 9) + "-" + Date.now().toString(36);
    createTab(tabId, profile, false, "Connecting");
  }

  showToast(`Connecting to ${profile.username}@${profile.host}...`, "info");
  setTabConnectionState(tabId, "Connecting", null, `Connecting to ${profile.host}...`);

  try {
    if (tabs[tabId] && tabs[tabId].term) {
      try {
        if (tabs[tabId].fitAddon) tabs[tabId].fitAddon.fit();
        if (tabs[tabId].term.cols > 0) profile.cols = tabs[tabId].term.cols;
        if (tabs[tabId].term.rows > 0) profile.rows = tabs[tabId].term.rows;
      } catch (_) {}
    }

    if (window.go && window.go.main && window.go.main.App) {
      if (typeof window.go.main.App.OpenSessionWithTabIDAndJumpSecret === "function") {
        await window.go.main.App.OpenSessionWithTabIDAndJumpSecret(tabId, profile, password, jumpSecret);
      } else if (typeof window.go.main.App.OpenSessionWithTabID === "function") {
        await window.go.main.App.OpenSessionWithTabID(tabId, profile, password);
      } else {
        const actualTabId = await window.go.main.App.OpenSession(profile, password);
        if (actualTabId && actualTabId !== tabId && tabs[tabId]) {
          tabs[actualTabId] = tabs[tabId];
          deleteTab(tabId);
        }
      }
      syncTerminalSize(tabId);
      setTimeout(() => syncTerminalSize(tabId), 60);
    } else {
      // Preview / Browser test mode fallback
      await new Promise(r => setTimeout(r, 300));
      if (tabs[tabId] && tabs[tabId].term) {
        tabs[tabId].term.write(`\r\n\x1b[1;32m● Connected to ${profile.host || "192.168.1.7"}\x1b[0m\r\n\r\n`);
        tabs[tabId].term.write(`Last login: ${new Date().toLocaleString()} from 192.168.1.108\r\n`);
        tabs[tabId].term.write(`\x1b[1;32m[${profile.username || "pin"}@${(profile.host || "SRV-01").split(".")[0]} ~]$\x1b[0m `);
      }
    }
    setTabConnectionState(tabId, "Connected");
    if (isAutoLogEnabled() && tabs[tabId]) tabs[tabId].logging = true;
    showToast(`Connected to ${profile.name || profile.host}`, "success");
    try { runStartupCommands(tabId, profile); } catch (_) {}
    if (switchSidebarViewFn) switchSidebarViewFn("sftp");
    const currentSFTPPath = (tabs[tabId] && tabs[tabId].sftpPath) || (profile && profile.initialDir) || "~";
    if (refreshSFTPFn) refreshSFTPFn(currentSFTPPath);
  } catch (err) {
    const classified = parseClassifiedError(err);
    setTabConnectionState(tabId, "Failed", classified);
    if (tabs[tabId] && tabs[tabId].term) {
      renderTerminalDiagnosticCard(tabs[tabId].term, profile, classified);
    }
    showToast(`Connection failed: [${classified.category}] ${classified.message}`, "error");
  }
}

// --------------------------------------------------------------------------
// Tab Context Menu & Color Customization Subsystem (MobaXterm Parity)
// --------------------------------------------------------------------------

export function showTabContextMenu(x, y, tabId) {
  const contextMenuEl = getContextMenuEl();
  if (!contextMenuEl) return;
  const t = tabs[tabId];
  if (!t) return;

  const isPinned = isTabPinned(tabId);
  const tabIds = Object.keys(tabs);
  const targetIdx = tabIds.indexOf(tabId);
  const hasLeft = targetIdx > 0;
  const hasRight = targetIdx !== -1 && targetIdx < tabIds.length - 1;

  contextMenuEl.innerHTML = `
    <div class="context-menu-item" id="tabCtxRename">
      <span class="ctx-icon">✏️</span>
      <span class="ctx-text">Rename tab</span>
    </div>
    <div class="context-menu-item" id="tabCtxColor">
      <span class="ctx-icon">🎨</span>
      <span class="ctx-text">Set tab color</span>
      <span class="ctx-arrow" style="margin-left:auto; font-size:10px; color:var(--text-muted);">▸</span>
    </div>
    <div class="context-menu-item" id="tabCtxDup">
      <span class="ctx-icon">📋</span>
      <span class="ctx-text">Duplicate tab</span>
    </div>
    <div class="context-menu-item" id="tabCtxBroadcast">
      <span class="ctx-icon">📡</span>
      <span class="ctx-text">Broadcast command...</span>
      <span class="ctx-shortcut">Alt+B</span>
    </div>
    <div class="context-menu-item danger" id="tabCtxClose">
      <span class="ctx-icon">✕</span>
      <span class="ctx-text">Close tab</span>
      <span class="ctx-shortcut">Ctrl+W</span>
    </div>
    <div class="context-menu-separator"></div>
    <div class="context-menu-item ${hasLeft ? '' : 'disabled'}" id="tabCtxCloseLeft">
      <span class="ctx-icon">⬅</span>
      <span class="ctx-text">Close all tabs to the left</span>
    </div>
    <div class="context-menu-item ${hasRight ? '' : 'disabled'}" id="tabCtxCloseRight">
      <span class="ctx-icon">➔</span>
      <span class="ctx-text">Close all tabs to the right</span>
    </div>
    <div class="context-menu-item" id="tabCtxCloseOther">
      <span class="ctx-icon">⛔</span>
      <span class="ctx-text">Close all except this tab</span>
    </div>
    <div class="context-menu-item danger" id="tabCtxCloseAll">
      <span class="ctx-icon">⏻</span>
      <span class="ctx-text">Close all tabs</span>
    </div>
    <div class="context-menu-separator"></div>
    <div class="context-menu-item" id="tabCtxSplit">
      <span class="ctx-icon">✂</span>
      <span class="ctx-text">Detach tab (Split Pane)</span>
    </div>
    <div class="context-menu-item" id="tabCtxFullscreen">
      <span class="ctx-icon">⛶</span>
      <span class="ctx-text">Fullscreen</span>
    </div>
    <div class="context-menu-item" id="tabCtxPin">
      <span class="ctx-icon">📌</span>
      <span class="ctx-text">${isPinned ? 'Unpin this tab' : 'Pin/unpin this tab'}</span>
    </div>
    <div class="context-menu-separator"></div>
    <div class="context-menu-item" id="tabCtxSave">
      <span class="ctx-icon">💾</span>
      <span class="ctx-text">Save terminal output</span>
    </div>
    <div class="context-menu-item" id="tabCtxPrint">
      <span class="ctx-icon">🖨️</span>
      <span class="ctx-text">Print terminal output</span>
    </div>
    <div class="context-menu-item" id="tabCtxFontPlus">
      <span class="ctx-icon">🔍➕</span>
      <span class="ctx-text">Increase font size</span>
      <span class="ctx-shortcut">Ctrl++</span>
    </div>
    <div class="context-menu-item" id="tabCtxFontMinus">
      <span class="ctx-icon">🔍➖</span>
      <span class="ctx-text">Decrease font size</span>
      <span class="ctx-shortcut">Ctrl+-</span>
    </div>
    <div class="context-menu-separator"></div>
    <div class="context-menu-item" id="tabCtxClear">
      <span class="ctx-icon">⌫</span>
      <span class="ctx-text">Clear terminal screen</span>
    </div>
  `;

  posMenu(x, y);

  // 1. Rename tab
  const btnRename = contextMenuEl.querySelector("#tabCtxRename");
  if (btnRename) {
    btnRename.onclick = () => {
      hideContextMenu();
      const cur = t.customTitle || t.profile?.name || "Terminal";
      const val = prompt("Enter new tab name:", cur);
      if (val !== null && val.trim()) {
        setTabTitle(tabId, val.trim());
        showToast(`Tab renamed to "${val.trim()}"`, "success");
      }
    };
  }

  // 2. Set tab color / environment
  const btnColor = contextMenuEl.querySelector("#tabCtxColor");
  if (btnColor) {
    btnColor.onclick = (e) => {
      e.stopPropagation();
      showTabColorPalette(x + 180, y + 20, tabId);
    };
  }

  // 3. Duplicate tab
  const btnDup = contextMenuEl.querySelector("#tabCtxDup");
  if (btnDup) {
    btnDup.onclick = () => {
      hideContextMenu();
      duplicateTab(tabId);
    };
  }

  // Broadcast command
  const btnBcast = contextMenuEl.querySelector("#tabCtxBroadcast");
  if (btnBcast) {
    btnBcast.onclick = () => {
      hideContextMenu();
      openBroadcastDialog("selected", [tabId]);
    };
  }

  // 4. Close tab
  const btnClose = contextMenuEl.querySelector("#tabCtxClose");
  if (btnClose) {
    btnClose.onclick = () => {
      hideContextMenu();
      closeTab(tabId);
    };
  }

  // 5. Close Left
  const btnCloseLeft = contextMenuEl.querySelector("#tabCtxCloseLeft");
  if (btnCloseLeft && hasLeft) {
    btnCloseLeft.onclick = () => {
      hideContextMenu();
      tabIds.slice(0, targetIdx).forEach(id => {
        if (!isTabPinned(id)) closeTab(id);
      });
      showToast("Closed tabs to the left", "info");
    };
  }

  // 6. Close Right
  const btnCloseRight = contextMenuEl.querySelector("#tabCtxCloseRight");
  if (btnCloseRight && hasRight) {
    btnCloseRight.onclick = () => {
      hideContextMenu();
      tabIds.slice(targetIdx + 1).forEach(id => {
        if (!isTabPinned(id)) closeTab(id);
      });
      showToast("Closed tabs to the right", "info");
    };
  }

  // 7. Close Other
  const btnCloseOther = contextMenuEl.querySelector("#tabCtxCloseOther");
  if (btnCloseOther) {
    btnCloseOther.onclick = () => {
      hideContextMenu();
      tabIds.forEach(id => {
        if (id !== tabId && !isTabPinned(id)) closeTab(id);
      });
      showToast("Closed other tabs", "info");
    };
  }

  // 8. Close All
  const btnCloseAll = contextMenuEl.querySelector("#tabCtxCloseAll");
  if (btnCloseAll) {
    btnCloseAll.onclick = () => {
      hideContextMenu();
      tabIds.forEach(id => {
        if (!isTabPinned(id)) closeTab(id);
      });
      activateHomeTab();
      showToast("Closed all tabs", "info");
    };
  }

  // 9. Detach / Split
  const btnSplit = contextMenuEl.querySelector("#tabCtxSplit");
  if (btnSplit) {
    btnSplit.onclick = async () => {
      hideContextMenu();
      const mod = await import("../state/workspaceState.js");
      const curPaneId = t.paneId || mod.getWorkspaceState().activePaneId;
      mod.splitPane(curPaneId, "right");
      const state = mod.getWorkspaceState();
      const targetPane = state.panes.find(p => p.id !== curPaneId) || state.panes[state.panes.length - 1];
      if (targetPane) {
        mod.moveTabToPane(tabId, targetPane.id);
        mod.setActiveWorkspacePane(targetPane.id);
      }
      showToast("Tab detached into split pane", "success");
    };
  }

  // 10. Fullscreen / Maximize
  const btnFullscreen = contextMenuEl.querySelector("#tabCtxFullscreen");
  if (btnFullscreen) {
    btnFullscreen.onclick = () => {
      hideContextMenu();
      const paneId = t.paneId || workspaceState.activePaneId;
      toggleMaximizePane(paneId);
    };
  }

  // 11. Pin / Unpin
  const btnPin = contextMenuEl.querySelector("#tabCtxPin");
  if (btnPin) {
    btnPin.onclick = () => {
      hideContextMenu();
      const pinned = toggleTabPinned(tabId);
      showToast(pinned ? "Tab pinned 📌 (protected from bulk close)" : "Tab unpinned", "info");
    };
  }

  // 12. Save Terminal Output
  const btnSave = contextMenuEl.querySelector("#tabCtxSave");
  if (btnSave) {
    btnSave.onclick = () => {
      hideContextMenu();
      if (!t.term) return;
      const buffer = t.term.buffer.active;
      const lines = [];
      for (let i = 0; i < buffer.length; i++) {
        const l = buffer.getLine(i);
        if (l) lines.push(l.translateToString(true));
      }
      const text = lines.join("\n").trimEnd();
      const safeTitle = (t.profile?.name || 'terminal').replace(/[^a-zA-Z0-9_-]/g, '_');
      const filename = `${safeTitle}_${new Date().toISOString().replace(/[:.]/g, '-')}.log`;

      const downloadBlobFallback = () => {
        const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast(`Saved terminal output as ${filename}`, "success");
      };

      if (window.go && window.go.main && window.go.main.App && window.go.main.App.SaveTerminalOutput) {
        window.go.main.App.SaveTerminalOutput(filename, text).then((savedPath) => {
          if (savedPath) {
            showToast(`Terminal output saved: ${savedPath}`, "success");
          }
        }).catch((err) => {
          console.warn("Native SaveTerminalOutput failed, falling back to browser download:", err);
          downloadBlobFallback();
        });
      } else {
        downloadBlobFallback();
      }
    };
  }

  // 13. Print Terminal Output
  const btnPrint = contextMenuEl.querySelector("#tabCtxPrint");
  if (btnPrint) {
    btnPrint.onclick = () => {
      hideContextMenu();
      if (!t.term) return;
      const buffer = t.term.buffer.active;
      const lines = [];
      for (let i = 0; i < buffer.length; i++) {
        const l = buffer.getLine(i);
        if (l) lines.push(l.translateToString(true));
      }
      const text = lines.join("\n").trimEnd();
      const pw = window.open("", "_blank");
      if (pw) {
        pw.document.write(`<title>${escapeHtml(t.profile?.name || 'Terminal Output')}</title><pre style="font-family: Consolas, monospace; font-size: 11px; white-space: pre-wrap; line-height: 1.4; padding: 16px;">${escapeHtml(text)}</pre>`);
        pw.document.close();
        pw.focus();
        pw.print();
      }
    };
  }

  // 14. Font size +
  const btnFontPlus = contextMenuEl.querySelector("#tabCtxFontPlus");
  if (btnFontPlus) {
    btnFontPlus.onclick = () => {
      hideContextMenu();
      if (t.term) {
        const curSize = t.term.options.fontSize || 13;
        if (curSize < 36) {
          t.term.options.fontSize = curSize + 1;
          if (t.fitAddon) t.fitAddon.fit();
          showToast(`Terminal font: ${t.term.options.fontSize}px`, "info");
        }
      }
    };
  }

  // 15. Font size -
  const btnFontMinus = contextMenuEl.querySelector("#tabCtxFontMinus");
  if (btnFontMinus) {
    btnFontMinus.onclick = () => {
      hideContextMenu();
      if (t.term) {
        const curSize = t.term.options.fontSize || 13;
        if (curSize > 8) {
          t.term.options.fontSize = curSize - 1;
          if (t.fitAddon) t.fitAddon.fit();
          showToast(`Terminal font: ${t.term.options.fontSize}px`, "info");
        }
      }
    };
  }

  // 16. Clear
  const btnClear = contextMenuEl.querySelector("#tabCtxClear");
  if (btnClear) {
    btnClear.onclick = () => {
      hideContextMenu();
      if (t.term) t.term.clear();
      showToast("Terminal screen cleared", "info");
    };
  }
}

export function showTabColorPalette(x, y, tabId) {
  let pop = document.getElementById("tabColorPopover");
  if (!pop) {
    pop = document.createElement("div");
    pop.id = "tabColorPopover";
    pop.className = "tab-color-popover";
    document.body.appendChild(pop);
  }

  const t = tabs[tabId];
  if (!t) return;
  const currentEnv = t.environment || t.profile?.environment || "";
  const currentColor = t.color || t.profile?.color || "";

  pop.innerHTML = `
    <div class="color-popover-header">
      <span class="color-popover-title">🎨 Tab / Server Environment</span>
      <button class="color-popover-close" id="closeColorPopover">&times;</button>
    </div>
    <div class="color-popover-desc">Select an environment tag to color-code this server (e.g. Yellow for UAT, Red for Prod):</div>
    <div class="color-popover-grid">
      ${Object.values(ENVIRONMENTS).map(env => `
        <button class="color-swatch-chip ${currentEnv === env.key ? 'active' : ''}" data-env="${env.key}" data-color="${env.color}" type="button">
          <span class="swatch-dot" style="background:${env.color};"></span>
          <span class="swatch-label">${env.label}</span>
          <span class="swatch-name">${env.name}</span>
        </button>
      `).join("")}
      <button class="color-swatch-chip ${!currentEnv && !currentColor ? 'active' : ''}" data-env="" data-color="" type="button">
        <span class="swatch-dot" style="background:#64748b;"></span>
        <span class="swatch-label">NONE</span>
        <span class="swatch-name">Default</span>
      </button>
    </div>
    <div class="color-popover-custom-row">
      <span style="font-size:12px; color:var(--text-secondary);">Custom Hex:</span>
      <input type="color" id="tabCustomColorInput" value="${currentColor || '#f59e0b'}" />
      <button class="btn btn-sm btn-primary" id="applyCustomColorBtn" style="padding:2px 8px; font-size:11px;">Apply</button>
    </div>
    ${t.profile && t.profile.id && !t.isLocal ? `
      <div class="color-popover-save-row">
        <label style="display:flex; align-items:center; gap:6px; font-size:11px; cursor:pointer; color:var(--text-secondary);">
          <input type="checkbox" id="chkSaveColorToProfile" checked />
          <span>Save as default environment for "<b>${escapeHtml(t.profile.name)}</b>"</span>
        </label>
      </div>
    ` : ''}
  `;

  pop.style.left = Math.min(x, window.innerWidth - 290) + "px";
  pop.style.top = Math.min(y, window.innerHeight - 360) + "px";
  pop.classList.remove("hidden");
  hideContextMenu();

  const closePop = () => pop.classList.add("hidden");
  const closeBtn = pop.querySelector("#closeColorPopover");
  if (closeBtn) closeBtn.onclick = closePop;

  const saveToProfileIfNeeded = async (color, envKey) => {
    const chk = pop.querySelector("#chkSaveColorToProfile");
    if (chk && chk.checked && t.profile && window.go && window.go.main && window.go.main.App) {
      t.profile.color = color;
      t.profile.environment = envKey;
      try {
        await window.go.main.App.UpdateSession(t.profile);
        if (renderTreeFn) await renderTreeFn();
        showToast(`Saved ${envKey ? envKey.toUpperCase() : 'color'} tag to "${t.profile.name}"`, "success");
      } catch (err) {
        console.warn("Failed to persist session color:", err);
      }
    }
  };

  pop.querySelectorAll(".color-swatch-chip").forEach(btn => {
    btn.onclick = async () => {
      const color = btn.dataset.color;
      const envKey = btn.dataset.env;
      setTabColor(tabId, color, envKey);
      await saveToProfileIfNeeded(color, envKey);
      closePop();
      showToast(envKey ? `Tab environment: ${envKey.toUpperCase()}` : "Tab color reset", "info");
    };
  });

  const customColorInput = pop.querySelector("#tabCustomColorInput");
  const applyCustomColorBtn = pop.querySelector("#applyCustomColorBtn");
  if (applyCustomColorBtn && customColorInput) {
    applyCustomColorBtn.onclick = async () => {
      const val = customColorInput.value;
      const envMatch = getEnvironmentInfo(val);
      const envKey = envMatch ? envMatch.key : "";
      setTabColor(tabId, val, envKey);
      await saveToProfileIfNeeded(val, envKey);
      closePop();
      showToast(`Applied custom tab color ${val}`, "info");
    };
  }

  const handleOutsideClick = (e) => {
    if (!pop.contains(e.target)) {
      closePop();
      document.removeEventListener("mousedown", handleOutsideClick);
    }
  };
  setTimeout(() => document.addEventListener("mousedown", handleOutsideClick), 50);
}

