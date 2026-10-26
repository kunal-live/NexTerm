// ==========================================================================
// Nexterm — Tab State Subsystem
// Manages the collection of open tabs, active tab ID, and connection states.
// ==========================================================================

export const tabs = {}; // tabID -> { term, fitAddon, searchAddon, profile, paneEl, tabEl, isConnected, isLocal, connectionState, errorInfo, color, environment, pinned, customTitle, ... }
export let activeTabId = null; // "home" or uuid

export const ENVIRONMENTS = {
  prod: { key: "prod", label: "PROD", name: "Production", color: "#ef4444", bg: "rgba(239,68,68,0.18)", border: "rgba(239,68,68,0.45)" },
  uat: { key: "uat", label: "UAT", name: "UAT / Staging", color: "#f59e0b", bg: "rgba(245,158,11,0.18)", border: "rgba(245,158,11,0.45)" },
  testing: { key: "testing", label: "TEST", name: "Testing / QA", color: "#10b981", bg: "rgba(16,185,129,0.18)", border: "rgba(16,185,129,0.45)" },
  dev: { key: "dev", label: "DEV", name: "Development", color: "#3b82f6", bg: "rgba(59,130,246,0.18)", border: "rgba(59,130,246,0.45)" },
  local: { key: "local", label: "LOCAL", name: "Local", color: "#3b82f6", bg: "rgba(59,130,246,0.18)", border: "rgba(59,130,246,0.45)" },
  client: { key: "client", label: "CLIENT", name: "Client", color: "#a855f7", bg: "rgba(168,85,247,0.18)", border: "rgba(168,85,247,0.45)" },
  user: { key: "user", label: "USER", name: "User", color: "#64748b", bg: "rgba(100,116,139,0.18)", border: "rgba(100,116,139,0.45)" },
  staging: { key: "staging", label: "STAGE", name: "Staging", color: "#8b5cf6", bg: "rgba(139,92,246,0.18)", border: "rgba(139,92,246,0.45)" },
  dr: { key: "dr", label: "DR", name: "Disaster Recovery", color: "#f97316", bg: "rgba(249,115,22,0.18)", border: "rgba(249,115,22,0.45)" }
};

export function getEnvironmentFromFolderName(folderName) {
  if (!folderName || typeof folderName !== "string") return null;
  const fn = folderName.trim().toLowerCase();
  if (fn.includes("prod")) return ENVIRONMENTS.prod;
  if (fn.includes("uat")) return ENVIRONMENTS.uat;
  if (fn.includes("test") || fn.includes("qa")) return ENVIRONMENTS.testing;
  if (fn.includes("local")) return ENVIRONMENTS.local;
  if (fn.includes("client")) return ENVIRONMENTS.client;
  if (fn.includes("user")) return ENVIRONMENTS.user;
  if (fn.includes("stag")) return ENVIRONMENTS.staging;
  if (fn.includes("dr") || fn.includes("disaster")) return ENVIRONMENTS.dr;
  if (fn.includes("dev")) return ENVIRONMENTS.dev;
  return null;
}

export function getEnvironmentInfo(keyOrColor) {
  if (!keyOrColor) return null;
  const k = keyOrColor.toLowerCase();
  if (ENVIRONMENTS[k]) return ENVIRONMENTS[k];
  for (const env of Object.values(ENVIRONMENTS)) {
    if (env.color.toLowerCase() === k || env.label.toLowerCase() === k) return env;
  }
  return null;
}

export function getTabs() {
  return tabs;
}

export function getAllTabs() {
  return Object.entries(tabs).map(([id, t]) => {
    if (t && !t.id) t.id = id;
    return t;
  });
}

export function deleteTab(tabId) {
  delete tabs[tabId];
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

export function getActiveTabId() {
  return activeTabId;
}

export function getActiveTab() {
  if (!activeTabId || !tabs[activeTabId]) return null;
  const t = tabs[activeTabId];
  if (!t.id) t.id = activeTabId;
  return t;
}

export function setActiveTabId(id) {
  activeTabId = id;
}

export function getStateDotClass(tabObj) {
  if (!tabObj) return "state-closed";
  const st = tabObj.connectionState || (tabObj.isConnected ? "Connected" : "Closed");
  const cat = tabObj.errorInfo?.category || "";

  switch (st) {
    case "Connected":
      return "state-connected";
    case "Connecting":
      return "state-connecting";
    case "Authenticating":
      return "state-authenticating";
    case "Reconnecting":
      return "state-reconnecting";
    case "Closing":
      return "state-closing";
    case "Closed":
      if (cat === "Server closed connection" || (tabObj.stateMessage && tabObj.stateMessage.toLowerCase().includes("lost"))) {
        return "state-connection-lost";
      }
      return "state-closed";
    case "Failed":
      if (cat === "Authentication failure") {
        return "state-auth-failed";
      }
      if (cat === "Server closed connection") {
        return "state-connection-lost";
      }
      return "state-failed";
    case "Disconnected":
      return "state-disconnected";
    default:
      return tabObj.isConnected ? "state-connected" : "state-closed";
  }
}

export function getStateTooltip(tabObj) {
  if (!tabObj) return "● Disconnected";
  const st = tabObj.connectionState || (tabObj.isConnected ? "Connected" : "Closed");
  const cat = tabObj.errorInfo?.category || "";

  switch (st) {
    case "Connected":
      return "● Connected";
    case "Connecting":
      return "● Connecting...";
    case "Authenticating":
      return "● Authenticating...";
    case "Reconnecting":
      return "● Reconnecting...";
    case "Closing":
      return "● Closing...";
    case "Closed":
      if (cat === "Server closed connection" || (tabObj.stateMessage && tabObj.stateMessage.toLowerCase().includes("lost"))) {
        return "● Connection lost";
      }
      return "● Disconnected";
    case "Failed":
      if (cat === "Authentication failure") {
        return "● Authentication failed";
      }
      if (cat === "Server closed connection") {
        return "● Connection lost";
      }
      if (cat) {
        return `● Connection failed: ${cat}`;
      }
      return "● Connection failed";
    case "Disconnected":
      return "● Disconnected";
    default:
      return tabObj.isConnected ? "● Connected" : "● Disconnected";
  }
}

export function getStateLabel(tabObj) {
  if (!tabObj) return "Disconnected";
  const st = tabObj.connectionState || (tabObj.isConnected ? "Connected" : "Closed");
  const cat = tabObj.errorInfo?.category || "";

  switch (st) {
    case "Connected":
      return "Connected";
    case "Connecting":
      return "Connecting...";
    case "Authenticating":
      return "Authenticating...";
    case "Reconnecting":
      return "Reconnecting...";
    case "Closing":
      return "Closing...";
    case "Closed":
      if (cat === "Server closed connection") return "Connection lost";
      return "Disconnected";
    case "Failed":
      if (cat === "Authentication failure") return "Auth failed";
      if (cat === "Server closed connection") return "Connection lost";
      return cat || "Failed";
    case "Disconnected":
      return "Disconnected";
    default:
      return tabObj.isConnected ? "Connected" : "Disconnected";
  }
}

export function setTabConnectionState(tabId, state, errorInfo = null, customMessage = "") {
  const t = tabs[tabId];
  if (!t) return;

  t.connectionState = state;
  if (errorInfo) t.errorInfo = errorInfo;
  if (customMessage) t.stateMessage = customMessage;

  if (state === "Connected") {
    t.isConnected = true;
    t.errorInfo = null;
  } else if (state === "Closed" || state === "Failed" || state === "Disconnected") {
    t.isConnected = false;
  }

  const dotClass = getStateDotClass(t);
  const tooltip = getStateTooltip(t);

  // Update tab bar dot
  if (t.tabEl) {
    const dot = t.tabEl.querySelector(".tab-dot");
    if (dot) {
      dot.className = "tab-dot " + dotClass;
      dot.title = tooltip;
    }
    t.tabEl.title = `${t.profile?.name || 'Terminal'} (${tooltip})`;
  }

  // Update workspace pane tab dots
  const paneDots = document.querySelectorAll(`.pane-tab-item[data-tab-id="${tabId}"] .pane-tab-dot`);
  paneDots.forEach(pDot => {
    pDot.className = "pane-tab-dot " + dotClass;
    pDot.style.background = "";
    pDot.title = tooltip;
  });

  // Update connected server list dot & badges
  const srvItem = document.querySelector(`.connected-server-item[data-tab-id="${tabId}"]`);
  if (srvItem) {
    const sDot = srvItem.querySelector(".connected-item-dot");
    if (sDot) {
      sDot.className = "connected-item-dot " + dotClass;
      sDot.title = tooltip;
    }
    const stateBadge = srvItem.querySelector(".connected-item-state");
    if (stateBadge) {
      stateBadge.className = "connected-item-state " + dotClass;
      stateBadge.textContent = getStateLabel(t);
      stateBadge.title = tooltip;
    }
  }

  applyTabVisuals(tabId);
}

export function setTabColor(tabId, color, envKey = "") {
  const t = tabs[tabId];
  if (!t) return;
  t.color = color;
  t.environment = envKey;
  if (t.profile) {
    t.profile.color = color;
    if (envKey) t.profile.environment = envKey;
  }
  applyTabVisuals(tabId);
}

export function setTabTitle(tabId, newTitle) {
  const t = tabs[tabId];
  if (!t) return;
  t.customTitle = newTitle;
  applyTabVisuals(tabId);
}

export function toggleTabPinned(tabId) {
  const t = tabs[tabId];
  if (!t) return false;
  t.pinned = !t.pinned;
  applyTabVisuals(tabId);
  return t.pinned;
}

export function isTabPinned(tabId) {
  const t = tabs[tabId];
  return !!(t && t.pinned);
}

export function setTabNotification(tabId, options = {}) {
  const t = tabs[tabId];
  if (!t) return;
  if (!t.notificationState) {
    t.notificationState = { active: false, level: "info", type: "activity", message: "", count: 0 };
  }
  const active = options.active !== undefined ? !!options.active : true;
  t.notificationState.active = active;
  if (options.level) t.notificationState.level = options.level;
  if (options.type) t.notificationState.type = options.type;
  if (options.message) t.notificationState.message = options.message;
  if (active) t.notificationState.count = (t.notificationState.count || 0) + 1;
  else t.notificationState.count = 0;
  t.hasActivity = active;

  renderTabNotification(tabId);
}

export function clearTabNotification(tabId) {
  setTabNotification(tabId, { active: false, count: 0, message: "" });
}

export function renderTabNotification(tabId) {
  const t = tabs[tabId];
  if (!t) return;
  const isNotif = t.notificationState && t.notificationState.active;
  const isDone = isNotif && t.notificationState?.type === "process-done";
  const tooltip = isNotif
    ? (t.notificationState.message || (isDone ? "Process completed on this tab" : "Yellow dot: Attention / Notification required"))
    : "";

  // 1. Main Top Tab Bar
  if (t.tabEl) {
    t.tabEl.classList.toggle("has-notification", isNotif);
    t.tabEl.classList.toggle("has-activity", isNotif);
    t.tabEl.classList.toggle("has-process-done", isDone);
    let dot = t.tabEl.querySelector(".tab-notify-dot");
    if (!dot) {
      dot = document.createElement("span");
      dot.className = "tab-notify-dot";
      const dropBtn = t.tabEl.querySelector(".tab-dropdown-btn") || t.tabEl.querySelector(".tab-close");
      if (dropBtn) t.tabEl.insertBefore(dot, dropBtn);
      else t.tabEl.appendChild(dot);
    }
    dot.style.display = isNotif ? "inline-flex" : "none";
    if (isDone) {
      dot.className = "tab-notify-dot tab-done-badge";
      dot.textContent = "✓ Done";
    } else {
      dot.className = "tab-notify-dot";
      dot.textContent = "•";
    }
    dot.title = tooltip;
  }

  // 2. Workspace Pane Tab Item (if present in multi-pane mode)
  const paneTabs = document.querySelectorAll(`.pane-tab-item[data-tab-id="${tabId}"]`);
  paneTabs.forEach(pTab => {
    pTab.classList.toggle("has-notification", isNotif);
    pTab.classList.toggle("has-activity", isNotif);
    pTab.classList.toggle("has-process-done", isDone);
    let pDot = pTab.querySelector(".tab-notify-dot");
    if (!pDot) {
      pDot = document.createElement("span");
      pDot.className = "tab-notify-dot";
      const pDropBtn = pTab.querySelector(".pane-tab-dropdown-btn") || pTab.querySelector(".pane-tab-close");
      if (pDropBtn) pTab.insertBefore(pDot, pDropBtn);
      else pTab.appendChild(pDot);
    }
    pDot.style.display = isNotif ? "inline-flex" : "none";
    if (isDone) {
      pDot.className = "tab-notify-dot tab-done-badge";
      pDot.textContent = "✓ Done";
    } else {
      pDot.className = "tab-notify-dot";
      pDot.textContent = "•";
    }
    pDot.title = tooltip;
  });

  // 3. Sidebar connected server card
  const connectedItem = document.querySelector(`.connected-server-item[data-tab-id="${tabId}"]`);
  if (connectedItem) {
    connectedItem.classList.toggle("has-notification", isNotif);
    connectedItem.classList.toggle("has-activity", isNotif);
    connectedItem.classList.toggle("has-process-done", isDone);
    let cBadge = connectedItem.querySelector(".connected-notify-dot");
    if (!cBadge) {
      cBadge = document.createElement("span");
      cBadge.className = "connected-notify-dot";
      const optBtn = connectedItem.querySelector(".connected-options-btn");
      if (optBtn) optBtn.before(cBadge);
    }
    if (cBadge) {
      cBadge.style.display = isNotif ? "inline-flex" : "none";
      cBadge.textContent = isDone ? "✓" : "•";
      cBadge.title = tooltip;
      if (isDone) cBadge.classList.add("connected-done-badge");
      else cBadge.classList.remove("connected-done-badge");
    }
  }
}

export function markTabActivity(tabId, hasActivity) {
  setTabNotification(tabId, {
    active: !!hasActivity,
    level: "info",
    type: "activity",
    message: hasActivity ? "New output or background activity" : ""
  });
}

export function applyTabVisuals(tabId) {
  const t = tabs[tabId];
  if (!t) return;

  // 1. Determine Server Name (replace generic "New Server")
  let serverName = t.customTitle || "";
  if (!serverName) {
    if (t.remoteHostname) {
      serverName = t.remoteHostname;
    } else if (t.profile?.name && t.profile.name !== "New Server" && t.profile.name !== "New Session") {
      serverName = t.profile.name;
    } else if (t.profile?.host) {
      serverName = t.profile.username ? `${t.profile.username}@${t.profile.host}` : t.profile.host;
    } else if (t.isLocal) {
      serverName = "Local Terminal";
    } else {
      serverName = t.profile?.host || "Terminal";
    }
  }

  // 2. Determine 1-based Serial Number of the tab
  let serialNo = t.serialNo || 1;
  const tabbarEl = document.getElementById("tabbar") || document.getElementById("tabBar");
  if (tabbarEl) {
    const tabEls = Array.from(tabbarEl.querySelectorAll(".tab-item:not(.home-tab)"));
    const idx = tabEls.indexOf(t.tabEl);
    if (idx !== -1) {
      serialNo = idx + 1;
      t.serialNo = serialNo;
    }
  }

  const serialPrefix = `[${serialNo}] `;
  const fullTitle = `${serialPrefix}${serverName}`;
  const env = getEnvironmentInfo(t.environment || t.profile?.environment || t.color || t.profile?.color);
  const color = t.color || t.profile?.color || (env ? env.color : "");

  // 1. Update main top tab bar element
  if (t.tabEl) {
    t.tabEl.title = `${fullTitle}${t.profile?.host ? ` (${t.profile.host})` : ''}${env ? ` [${env.name}]` : ''}`;
    const titleEl = t.tabEl.querySelector(".tab-title");
    if (titleEl) {
      titleEl.innerHTML = "";
      if (t.pinned) {
        const pinSpan = document.createElement("span");
        pinSpan.className = "tab-pin-badge";
        pinSpan.textContent = "📌";
        pinSpan.title = "Pinned Tab";
        titleEl.appendChild(pinSpan);
      }
      const serialSpan = document.createElement("span");
      serialSpan.className = "tab-serial";
      serialSpan.textContent = serialPrefix;
      titleEl.appendChild(serialSpan);

      const nameText = document.createTextNode(serverName);
      titleEl.appendChild(nameText);
    }

    // Place environment badge
    let envBadge = t.tabEl.querySelector(".tab-env-badge");
    if (env) {
      if (!envBadge) {
        envBadge = document.createElement("span");
        const titleNode = t.tabEl.querySelector(".tab-title");
        if (titleNode) titleNode.after(envBadge);
        else t.tabEl.appendChild(envBadge);
      }
      envBadge.className = `tab-env-badge env-${env.key}`;
      envBadge.textContent = env.label;
      envBadge.style.color = env.color;
      envBadge.style.background = env.bg;
      envBadge.style.borderColor = env.border;
      envBadge.style.display = "inline-flex";
    } else if (envBadge) {
      envBadge.style.display = "none";
    }

    if (color) {
      t.tabEl.style.setProperty("--tab-accent-color", color);
      t.tabEl.classList.add("has-custom-color");
    } else {
      t.tabEl.style.removeProperty("--tab-accent-color");
      t.tabEl.classList.remove("has-custom-color");
    }

    t.tabEl.classList.toggle("is-pinned", !!t.pinned);
  }

  // 2. Update workspace pane tab items
  const paneTabs = document.querySelectorAll(`.pane-tab-item[data-tab-id="${tabId}"]`);
  paneTabs.forEach(pTab => {
    const pTitle = pTab.querySelector(".pane-tab-title");
    if (pTitle) {
      pTitle.innerHTML = "";
      if (t.pinned) {
        const pinSpan = document.createElement("span");
        pinSpan.className = "tab-pin-badge";
        pinSpan.textContent = "📌";
        pTitle.appendChild(pinSpan);
      }
      const pSerialSpan = document.createElement("span");
      pSerialSpan.className = "tab-serial";
      pSerialSpan.textContent = serialPrefix;
      pTitle.appendChild(pSerialSpan);

      pTitle.appendChild(document.createTextNode(serverName));
    }

    let pEnvBadge = pTab.querySelector(".tab-env-badge");
    if (env) {
      if (!pEnvBadge) {
        pEnvBadge = document.createElement("span");
        const pTitleNode = pTab.querySelector(".pane-tab-title");
        if (pTitleNode) pTitleNode.after(pEnvBadge);
        else pTab.appendChild(pEnvBadge);
      }
      pEnvBadge.className = `tab-env-badge env-${env.key}`;
      pEnvBadge.textContent = env.label;
      pEnvBadge.style.color = env.color;
      pEnvBadge.style.background = env.bg;
      pEnvBadge.style.borderColor = env.border;
      pEnvBadge.style.display = "inline-flex";
    } else if (pEnvBadge) {
      pEnvBadge.style.display = "none";
    }

    if (color) {
      pTab.style.setProperty("--tab-accent-color", color);
      pTab.classList.add("has-custom-color");
    } else {
      pTab.style.removeProperty("--tab-accent-color");
      pTab.classList.remove("has-custom-color");
    }
    pTab.classList.toggle("is-pinned", !!t.pinned);
  });

  renderTabNotification(tabId);

  if (renderConnectedServersFn) {
    try { renderConnectedServersFn(); } catch (_) {}
  }
}

export function refreshAllTabVisuals() {
  const tabbarEl = document.getElementById("tabbar") || document.getElementById("tabBar");
  if (!tabbarEl) return;
  const tabEls = Array.from(tabbarEl.querySelectorAll(".tab-item:not(.home-tab)"));
  tabEls.forEach((el, idx) => {
    const tabId = el.dataset.tabId;
    if (tabId && tabs[tabId]) {
      tabs[tabId].serialNo = idx + 1;
      applyTabVisuals(tabId);
    }
  });
}

let renderConnectedServersFn = null;
export function registerTabStateRenderConnectedServers(fn) {
  renderConnectedServersFn = fn;
}

