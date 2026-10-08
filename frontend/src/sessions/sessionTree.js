// ==========================================================================
// Nexterm - Session Tree, Drag-and-Drop, Recent Grid, and Sidebar Navigation
// ==========================================================================

import { rootNode, setRootNode, isDescendantInTree } from '../state/sessionState.js';
import {
  tabs,
  activeTabId,
  getStateDotClass,
  getStateTooltip,
  getStateLabel,
  getEnvironmentInfo,
  getEnvironmentFromFolderName,
  registerTabStateRenderConnectedServers
} from '../state/tabState.js';
import { escapeHtml, showToast, registerRenderConnectedServers } from '../ui/notifications.js';
import {
  showFolderContextMenu,
  showSessionContextMenu,
  registerContextMenuRefreshTree,
  registerContextMenuOpenSFTP
} from './sessionContextMenu.js';
import { registerDialogRefreshTree } from './sessionDialog.js';
import {
  connectToSession,
  activateTab,
  closeTab,
  showTabContextMenu,
  showTabColorPalette
} from '../terminal/terminalManager.js';
import {
  refreshSFTP,
  currentSFTPPath,
  registerSFTPRenderConnectedServers
} from '../sftp/sftpPanel.js';
import { renderSidebarMacros, renderSidebarTunnels } from '../ui/modal.js';

// Helper to get tree DOM element
function getTreeEl() {
  return document.getElementById("sessionTree") || document.getElementById("tree");
}

// --------------------------------------------------------------------------
// Quick Connect String Parser (Supports user@host:port/path, host/path, etc.)
// --------------------------------------------------------------------------

export function parseQuickConnect(raw) {
  let str = (raw || "").trim();
  if (!str) return null;

  let protocol = "ssh";

  // Detect explicit protocol prefix (e.g. ssh, telnet, sftp, rdp, vnc)
  if (str.toLowerCase().startsWith("ssh ")) {
    protocol = "ssh";
    str = str.substring(4).trim();
  } else if (str.toLowerCase().startsWith("telnet ")) {
    protocol = "telnet";
    str = str.substring(7).trim();
  } else if (str.toLowerCase().startsWith("sftp ")) {
    protocol = "sftp";
    str = str.substring(5).trim();
  } else if (str.toLowerCase().startsWith("rdp ")) {
    protocol = "rdp";
    str = str.substring(4).trim();
  } else if (str.toLowerCase().startsWith("vnc ")) {
    protocol = "vnc";
    str = str.substring(4).trim();
  } else if (str.includes("://")) {
    const protoIdx = str.indexOf("://");
    protocol = str.substring(0, protoIdx).toLowerCase();
    str = str.substring(protoIdx + 3).trim();
  }

  let defaultPort = protocol === "rdp" ? 3389 : protocol === "vnc" ? 5900 : protocol === "telnet" ? 23 : 22;
  let port = defaultPort;

  // Check for OpenSSH flag -p <port> or -p<port>
  const pMatch = str.match(/-p\s*(\d+)/i);
  if (pMatch) {
    const parsedP = parseInt(pMatch[1], 10);
    if (!isNaN(parsedP) && parsedP > 0) port = parsedP;
    str = str.replace(/-p\s*\d+/i, "").trim();
  }

  // Check initial working directory / command suffix (e.g. user@host /var/log)
  let initialDir = "";
  if (str.includes(" ")) {
    const parts = str.split(/\s+/);
    str = parts[0];
    initialDir = parts.slice(1).join(" ");
  }

  let username = "";
  let host = "";

  if (str.includes("@")) {
    const atParts = str.split("@");
    username = atParts[0];
    str = atParts.slice(1).join("@");
  }

  if (str.includes("/") && !str.includes("://")) {
    const slashIdx = str.indexOf("/");
    if (!initialDir) initialDir = str.substring(slashIdx);
    str = str.substring(0, slashIdx);
  }

  if (str.includes(":")) {
    const colonParts = str.split(":");
    host = colonParts[0];
    const pNum = parseInt(colonParts[1], 10);
    if (!isNaN(pNum) && pNum > 0) port = pNum;
  } else {
    host = str;
  }

  if (!host) return null;

  return { protocol, host, port, username, initialDir };
}

// --------------------------------------------------------------------------
// Connected Servers Panel (Live Active Sessions)
// --------------------------------------------------------------------------

export function renderConnectedServers() {
  const listEl = document.getElementById("connectedServersList");
  const badgeEl = document.getElementById("connectedCountBadge");
  if (!listEl) return;

  const openTabsList = Object.entries(tabs);
  if (badgeEl) badgeEl.textContent = openTabsList.length.toString();

  if (openTabsList.length === 0) {
    listEl.innerHTML = `<div class="connected-empty-msg">No active connections</div>`;
    return;
  }

  listEl.innerHTML = "";
  openTabsList.forEach(([tabId, t]) => {
    const item = document.createElement("div");
    const isActive = activeTabId === tabId;
    item.className = `connected-server-item ${isActive ? 'active' : ''}`;
    item.dataset.tabId = tabId;

    const dotClass = getStateDotClass(t);
    const tooltip = getStateTooltip(t);
    const stateLabel = getStateLabel(t);

    const serialNo = t.serialNo || 1;
    const srvName = t.customTitle || t.remoteHostname || ((t.profile?.name && t.profile.name !== "New Server" && t.profile.name !== "New Session") ? t.profile.name : (t.profile?.host ? (t.profile.username ? `${t.profile.username}@${t.profile.host}` : t.profile.host) : (t.isLocal ? "Local Terminal" : "Terminal")));
    const titleText = `[${serialNo}] ${srvName}`;
    const subText = t.isLocal ? "Local Terminal (PowerShell)" : `SSH • ${t.profile?.username || 'user'}@${t.profile?.host || 'host'}:${t.profile?.port || 22}`;
    const activePath = t.sftpPath || (t.profile && t.profile.initialDir) || "/";

    const env = getEnvironmentInfo(t.environment || t.profile?.environment || t.color || t.profile?.color);
    const customColor = t.color || t.profile?.color || (env ? env.color : "");

    const dotStyle = customColor ? `style="background:${customColor}; box-shadow:0 0 6px ${customColor};"` : '';
    if (customColor) {
      item.style.borderLeft = `3px solid ${customColor}`;
    }

    const envBtnHtml = env
      ? `<button class="connected-env-btn env-${env.key}" style="color:${env.color}; background:${env.bg}; border: 1px solid ${env.border};" title="Environment: ${env.name} (Click to change color)" type="button">${env.label} ▾</button>`
      : `<button class="connected-env-btn unassigned" title="Click to set Environment & Color (UAT Yellow, Prod Red...)" type="button">🎨 Color ▾</button>`;

    item.innerHTML = `
      <span class="connected-item-dot ${dotClass}" ${dotStyle} title="${escapeHtml(tooltip)}"></span>
      <div class="connected-item-info">
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 4px;">
          <span class="connected-item-title" title="${escapeHtml(titleText)}"><span class="tab-serial">[${serialNo}] </span>${escapeHtml(srvName)}</span>
          <div style="display:flex; align-items:center; gap:4px;">
            ${envBtnHtml}
            <span class="connected-item-state ${dotClass}">${escapeHtml(stateLabel)}</span>
            <button class="connected-options-btn" title="Server Options (Rename, Color, Duplicate, Split, Close...)" type="button">⋯</button>
            <span class="connected-item-close" title="Close connection">&times;</span>
          </div>
        </div>
        <span class="connected-item-sub" title="${escapeHtml(subText)}">${escapeHtml(subText)}</span>
        ${!t.isLocal ? `<span class="connected-item-path" title="Current SFTP Path: ${escapeHtml(activePath)}">📁 ${escapeHtml(activePath)}</span>` : ''}
      </div>
    `;

    // 1. Env/Color button click
    const envBtn = item.querySelector(".connected-env-btn");
    if (envBtn) {
      envBtn.onclick = (e) => {
        e.stopPropagation();
        const rect = envBtn.getBoundingClientRect();
        showTabColorPalette(rect.right + 6, rect.top, tabId);
      };
    }

    // 2. Options button click
    const optBtn = item.querySelector(".connected-options-btn");
    if (optBtn) {
      optBtn.onclick = (e) => {
        e.stopPropagation();
        const rect = optBtn.getBoundingClientRect();
        showTabContextMenu(rect.right + 6, rect.top, tabId);
      };
    }

    // 3. Right-click anywhere on the server card
    item.oncontextmenu = (e) => {
      e.preventDefault();
      e.stopPropagation();
      showTabContextMenu(e.clientX, e.clientY, tabId);
    };

    // 4. Clicking the server item: switch tab, or if already active, open options menu
    item.onclick = (e) => {
      if (e.target.closest(".connected-env-btn") || e.target.closest(".connected-options-btn") || e.target.closest(".connected-item-close")) {
        return;
      }
      if (activeTabId === tabId) {
        const rect = item.getBoundingClientRect();
        showTabContextMenu(rect.right + 6, rect.top, tabId);
      } else {
        activateTab(tabId);
      }
    };

    const closeBtn = item.querySelector(".connected-item-close");
    if (closeBtn) {
      closeBtn.onclick = (e) => {
        e.stopPropagation();
        closeTab(tabId);
      };
    }

    listEl.appendChild(item);
  });
}

// --------------------------------------------------------------------------
// Tree Rendering & Session Management (Drag-and-Drop)
// --------------------------------------------------------------------------

function normalizeTreeNode(node) {
  if (!node) return;
  if (!node.session) {
    if (!Array.isArray(node.children)) node.children = [];
    if (node.expanded === undefined) node.expanded = true;
    node.children.forEach(normalizeTreeNode);
  }
}

export async function refreshTree(filter = "") {
  try {
    if (window.go && window.go.main && window.go.main.App) {
      const data = await window.go.main.App.GetSessionTree();
      normalizeTreeNode(data);
      setRootNode(data);
    } else {
      setRootNode({
        id: "root",
        name: "SAVED SESSIONS",
        expanded: true,
        children: [
          { id: "f1", name: "Production", expanded: true, children: [] },
          { id: "f2", name: "UAT", expanded: true, children: [] },
          {
            id: "f3",
            name: "Testing",
            expanded: true,
            children: [
              {
                id: "sess_pin",
                name: "pin",
                isFolder: false,
                session: {
                  id: "sess_pin",
                  name: "pin",
                  protocol: "ssh",
                  host: "192.168.1.7",
                  port: 22,
                  username: "pin",
                  environment: "testing",
                  color: "#10b981"
                }
              }
            ]
          },
          { id: "f4", name: "Local", expanded: true, children: [] },
          { id: "f5", name: "Client", expanded: true, children: [] },
          { id: "f6", name: "User", expanded: true, children: [] },
        ]
      });
    }
    renderTree(filter);
    updateRecentSessionsGrid(null, filter);
  } catch (err) {
    console.error("Failed to load session tree:", err);
  }
}

export function getSessionProtocolInfo(session) {
  const proto = (session && session.protocol ? session.protocol.toLowerCase() : "ssh");
  switch (proto) {
    case "sftp":
      return { icon: "📦", badge: "SFTP", cls: "sftp" };
    case "rdp":
      return { icon: "🪟", badge: "RDP", cls: "rdp" };
    case "vnc":
      return { icon: "🖥️", badge: "VNC", cls: "vnc" };
    case "telnet":
      return { icon: "📡", badge: "TELNET", cls: "telnet" };
    case "serial":
      return { icon: "🔌", badge: "SERIAL", cls: "serial" };
    case "local":
      return { icon: "💻", badge: "LOCAL", cls: "local" };
    default:
      return { icon: "🔑", badge: "SSH", cls: "ssh" };
  }
}

export function clearAllDragIndicators() {
  const treeEl = getTreeEl();
  document.querySelectorAll(".tree-node-row.drag-target-over").forEach(el => el.classList.remove("drag-target-over"));
  document.querySelectorAll(".tree-node-row.drag-insert-above").forEach(el => el.classList.remove("drag-insert-above"));
  document.querySelectorAll(".tree-node-row.drag-insert-below").forEach(el => el.classList.remove("drag-insert-below"));
  if (treeEl) treeEl.classList.remove("drag-target-root");
}

export function renderTree(filter = "") {
  const treeEl = getTreeEl();
  if (!treeEl) return;
  treeEl.innerHTML = "";
  if (!rootNode) return;
  const lowerFilter = filter.trim().toLowerCase();

  // Root tree container accepts drops to move items to root level
  if (!treeEl.dataset.hasDropListener) {
    treeEl.dataset.hasDropListener = "true";
    treeEl.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      treeEl.classList.add("drag-target-root");
    });
    treeEl.addEventListener("dragleave", (e) => {
      if (!treeEl.contains(e.relatedTarget)) {
        treeEl.classList.remove("drag-target-root");
      }
    });
    treeEl.addEventListener("drop", async (e) => {
      if (e.target.closest(".tree-node-row")) return;
      e.preventDefault();
      treeEl.classList.remove("drag-target-root");
      try {
        const raw = e.dataTransfer.getData("text/plain");
        if (!raw) return;
        const data = JSON.parse(raw);
        if (!data.nodeId || data.nodeId === rootNode.id) return;
        if (window.go && window.go.main && window.go.main.App) {
          await window.go.main.App.MoveNode(data.nodeId, rootNode.id, -1);
        }
        await refreshTree();
        showToast(`Moved "${data.nodeName}" to All Sessions`, "success");
      } catch (err) {
        console.error("Drop to root error:", err);
      }
    });
  }

  if (rootNode.children && rootNode.children.length > 0) {
    rootNode.children.forEach(child => {
      const el = renderNode(child, lowerFilter, rootNode, 0);
      if (el) treeEl.appendChild(el);
    });
  } else {
    const el = renderNode(rootNode, lowerFilter, null, 0);
    if (el) treeEl.appendChild(el);
  }
}

export function renderNode(node, filter = "", parentNode = null, level = 0) {
  if (!node) return null;
  const isFolder = !node.session;
  const matches = !filter || node.name.toLowerCase().includes(filter) ||
    (node.session && ((node.session.host && node.session.host.toLowerCase().includes(filter)) || (node.session.username && node.session.username.toLowerCase().includes(filter))));

  let filteredChildren = [];
  if (isFolder && node.children) {
    filteredChildren = node.children
      .map(child => renderNode(child, filter, node, level + 1))
      .filter(el => el !== null);
  }

  if (filter && !matches && filteredChildren.length === 0) return null;

  const wrap = document.createElement("div");
  const row = document.createElement("div");
  row.className = `tree-node-row ${isFolder ? "folder" : "session"}`;
  row.dataset.id = node.id;
  row.dataset.level = level;
  row.draggable = true;

  if (isFolder) {
    const isExpanded = node.expanded !== false;
    const fEnv = getEnvironmentInfo(node.environment) || getEnvironmentFromFolderName(node.name);
    const fBadgeHtml = fEnv
      ? `<span class="tree-node-env-badge env-${fEnv.key}" style="color:${fEnv.color}; background:${fEnv.bg}; border: 1px solid ${fEnv.border}; font-size: 9px; padding: 0 4px; margin-left: 4px;">${fEnv.label}</span>`
      : '';
    const userHintHtml = node.defaultUsername
      ? `<span class="tree-folder-user" style="font-size: 10px; color: var(--text-dim); margin-left: auto; margin-right: 4px;" title="Default username: ${escapeHtml(node.defaultUsername)}">👤 ${escapeHtml(node.defaultUsername)}</span>`
      : '';

    row.innerHTML = `
      <span class="chevron">${isExpanded ? "▾" : "▸"}</span>
      <span class="node-icon">${isExpanded ? "📂" : "📁"}</span>
      <span class="node-name" title="${escapeHtml(node.name)}">${escapeHtml(node.name)}</span>
      ${fBadgeHtml}
      ${userHintHtml}
      <span class="node-badge" style="${node.defaultUsername ? '' : 'margin-left:auto;'}">${node.children ? node.children.length : 0}</span>
      <button class="folder-options-btn" title="Folder Options (New Session, Properties, Rename, Delete...)" type="button">⋯</button>
    `;

    const optBtn = row.querySelector(".folder-options-btn");
    if (optBtn) {
      optBtn.onclick = (e) => {
        e.stopPropagation();
        e.preventDefault();
        const rect = optBtn.getBoundingClientRect();
        showFolderContextMenu(rect.right + 4, rect.top, node);
      };
    }

    row.addEventListener("click", (e) => {
      e.stopPropagation();
      node.expanded = !node.expanded;
      const sidebarQuickConnectInput = document.getElementById("sidebarQuickConnectInput") || document.getElementById("sidebarQuickConnect");
      renderTree(sidebarQuickConnectInput ? sidebarQuickConnectInput.value : "");
      if (window.go && window.go.main && window.go.main.App) {
        window.go.main.App.ToggleFolder(node.id, node.expanded);
      }
    });

    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      showFolderContextMenu(e.clientX, e.clientY, node);
    });

    // Drag-and-drop on folder
    row.addEventListener("dragstart", (e) => {
      e.stopPropagation();
      e.dataTransfer.setData("text/plain", JSON.stringify({ nodeId: node.id, nodeName: node.name, isFolder: true }));
      e.dataTransfer.effectAllowed = "move";
      row.classList.add("dragging");
    });

    row.addEventListener("dragend", (e) => {
      e.stopPropagation();
      row.classList.remove("dragging");
      clearAllDragIndicators();
    });

    row.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "move";
      const rect = row.getBoundingClientRect();
      const relY = (e.clientY - rect.top) / rect.height;

      row.classList.remove("drag-insert-above", "drag-insert-below", "drag-target-over");
      if (relY < 0.25) {
        row.classList.add("drag-insert-above");
      } else if (relY > 0.75) {
        row.classList.add("drag-insert-below");
      } else {
        row.classList.add("drag-target-over");
      }
    });

    row.addEventListener("dragleave", (e) => {
      e.stopPropagation();
      row.classList.remove("drag-insert-above", "drag-insert-below", "drag-target-over");
    });

    row.addEventListener("drop", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const isAbove = row.classList.contains("drag-insert-above");
      const isBelow = row.classList.contains("drag-insert-below");
      clearAllDragIndicators();

      try {
        const raw = e.dataTransfer.getData("text/plain");
        if (!raw) return;
        const data = JSON.parse(raw);
        if (!data.nodeId || data.nodeId === node.id) return;

        // Prevent cycle if moving a folder into its child
        if (data.isFolder && isDescendantInTree(data.nodeId, node.id)) {
          showToast(`Cannot move folder into itself or its subfolder`, "warning");
          return;
        }

        let targetParentId = node.id;
        let targetIndex = -1;

        if (isAbove || isBelow) {
          targetParentId = parentNode ? parentNode.id : rootNode.id;
          const siblings = parentNode && parentNode.children ? parentNode.children : (rootNode.children || []);
          const selfIdx = siblings.findIndex(c => c.id === node.id);
          targetIndex = isAbove ? Math.max(0, selfIdx) : selfIdx + 1;
        }

        if (window.go && window.go.main && window.go.main.App) {
          await window.go.main.App.MoveNode(data.nodeId, targetParentId, targetIndex);
        }
        await refreshTree();
        showToast(`Moved "${data.nodeName}"`, "success");
      } catch (err) {
        console.error("Drop error:", err);
        showToast(`Move failed: ${err}`, "error");
      }
    });

  } else {
    // Session Node
    const protoInfo = getSessionProtocolInfo(node.session);
    const isConn = Object.values(tabs).some(t => t.profile && t.profile.id === node.session.id && t.isConnected);
    const folderEnv = parentNode ? getEnvironmentFromFolderName(parentNode.name) : null;
    const env = folderEnv || getEnvironmentInfo(node.session.environment || node.session.color);
    const customColor = (folderEnv ? folderEnv.color : node.session.color) || (env ? env.color : "");
    const envBadgeHtml = env ? `<span class="tree-node-env-badge env-${env.key}" style="color:${env.color}; background:${env.bg}; border-color:${env.border};">${env.label}</span>` : '';

    row.innerHTML = `
      <span style="width: 14px;"></span>
      <span class="node-icon">${protoInfo.icon}</span>
      <span class="node-name" title="${escapeHtml(node.session.username || '')}@${escapeHtml(node.session.host || '')}">${escapeHtml(node.name)}</span>
      ${envBadgeHtml}
      <span class="tree-node-proto-badge ${protoInfo.cls}">${protoInfo.badge}</span>
      ${isConn ? `<span class="status-dot state-connected" title="● Connected"></span>` : ''}
    `;

    row.addEventListener("dragstart", (e) => {
      e.stopPropagation();
      e.dataTransfer.setData("text/plain", JSON.stringify({ nodeId: node.id, nodeName: node.name, isFolder: false }));
      e.dataTransfer.effectAllowed = "move";
      row.classList.add("dragging");
    });

    row.addEventListener("dragend", (e) => {
      e.stopPropagation();
      row.classList.remove("dragging");
      clearAllDragIndicators();
    });

    row.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "move";
      const rect = row.getBoundingClientRect();
      const relY = (e.clientY - rect.top) / rect.height;

      row.classList.remove("drag-insert-above", "drag-insert-below", "drag-target-over");
      if (relY < 0.5) {
        row.classList.add("drag-insert-above");
      } else {
        row.classList.add("drag-insert-below");
      }
    });

    row.addEventListener("dragleave", (e) => {
      e.stopPropagation();
      row.classList.remove("drag-insert-above", "drag-insert-below");
    });

    row.addEventListener("drop", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const isAbove = row.classList.contains("drag-insert-above");
      clearAllDragIndicators();

      try {
        const raw = e.dataTransfer.getData("text/plain");
        if (!raw) return;
        const data = JSON.parse(raw);
        if (!data.nodeId || data.nodeId === node.id) return;

        const targetParentId = parentNode ? parentNode.id : rootNode.id;
        const siblings = parentNode && parentNode.children ? parentNode.children : (rootNode.children || []);
        const selfIdx = siblings.findIndex(c => c.id === node.id);
        const targetIndex = isAbove ? Math.max(0, selfIdx) : selfIdx + 1;

        if (window.go && window.go.main && window.go.main.App) {
          await window.go.main.App.MoveNode(data.nodeId, targetParentId, targetIndex);
        }
        await refreshTree();
        showToast(`Moved "${data.nodeName}"`, "success");
      } catch (err) {
        console.error("Drop error:", err);
        showToast(`Move failed: ${err}`, "error");
      }
    });

    row.addEventListener("dblclick", () => {
      const sessWithEnv = {
        ...node.session,
        environment: env ? env.key : node.session.environment,
        color: customColor || node.session.color
      };
      connectToSession(sessWithEnv);
    });
    row.addEventListener("click", () => {
      document.querySelectorAll(".tree-node-row.selected").forEach(el => el.classList.remove("selected"));
      row.classList.add("selected");
      const statusMessageEl = document.getElementById("statusMessage");
      if (statusMessageEl) statusMessageEl.textContent = `Selected: ${node.name}`;
      const openTabEntry = Object.entries(tabs).find(([_, t]) => t.profile && (t.profile.id === node.session.id || (t.profile.host === node.session.host && t.profile.username === node.session.username)));
      if (openTabEntry) {
        activateTab(openTabEntry[0]);
      }
    });
    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      showSessionContextMenu(e.clientX, e.clientY, node.session, node.id);
    });
  }

  wrap.appendChild(row);

  if (isFolder && node.children && node.children.length > 0 && node.expanded !== false) {
    const childrenContainer = document.createElement("div");
    childrenContainer.className = "tree-node-children";
    filteredChildren.forEach(c => childrenContainer.appendChild(c));
    wrap.appendChild(childrenContainer);
  }

  return wrap;
}

let activeSavedSessionsEnv = "all";

export function updateRecentSessionsGrid(targetNode = null, filterText = "") {
  const section = document.getElementById("recentSessionsSection");
  const grid = document.getElementById("recentSessionsGrid");
  const chipsContainer = document.getElementById("nxEnvFilterChips");
  const searchInput = document.getElementById("welcomeSearchInput");
  const filterClearBtn = document.getElementById("welcomeSearchFilterBtn");
  if (!grid) return;

  const nodeToUse = targetNode || rootNode;
  const allSessions = [];
  const groups = [];

  function collectFromFolder(folderNode) {
    const list = [];
    if (folderNode.children) {
      folderNode.children.forEach(c => {
        if (!c.isFolder && c.session) {
          list.push({ session: c.session, nodeId: c.id, folder: folderNode });
        } else if (c.isFolder) {
          list.push(...collectFromFolder(c));
        }
      });
    }
    return list;
  }

  if (nodeToUse && nodeToUse.children) {
    nodeToUse.children.forEach(child => {
      if (child.isFolder || child.children) {
        const folderSessions = collectFromFolder(child);
        const folderEnv = getEnvironmentFromFolderName(child.name) || getEnvironmentInfo(child.name);
        if (folderSessions.length > 0) {
          groups.push({
            folder: child,
            name: child.name,
            env: folderEnv,
            sessions: folderSessions
          });
          allSessions.push(...folderSessions);
        }
      } else if (child.session) {
        const item = { session: child.session, nodeId: child.id, folder: null };
        allSessions.push(item);
      }
    });
  }

  // Also include any active or connected sessions from open tabs not yet in tree
  Object.values(tabs).forEach(t => {
    if (t.profile && !allSessions.some(item => item.session.id === t.profile.id || (item.session.host === t.profile.host && item.session.username === t.profile.username))) {
      const orphanItem = { session: t.profile, nodeId: "", folder: null };
      allSessions.unshift(orphanItem);
    }
  });

  if (section) {
    section.style.display = "";
  }
  if (grid) {
    grid.style.overflowY = "auto";
  }

  const q = (filterText || (searchInput ? searchInput.value : "") || "").trim().toLowerCase();

  // Clear button toggle on search box
  if (filterClearBtn) {
    if (q) {
      filterClearBtn.style.display = "flex";
      filterClearBtn.onclick = () => {
        if (searchInput) searchInput.value = "";
        activeSavedSessionsEnv = "all";
        updateRecentSessionsGrid(null, "");
      };
    } else {
      filterClearBtn.style.display = "none";
    }
  }

  // Helper to determine environment of session item
  const getItemEnv = item => {
    const folderEnv = item.folder ? getEnvironmentFromFolderName(item.folder.name) : null;
    return folderEnv || getEnvironmentInfo(item.session.environment || item.session.color);
  };

  // Build Environment Filter Chips
  if (chipsContainer) {
    if (allSessions.length === 0) {
      chipsContainer.innerHTML = "";
    } else {
      const envCounts = {};
      allSessions.forEach(item => {
        const env = getItemEnv(item);
        const key = env ? env.key : "other";
        if (!envCounts[key]) {
          envCounts[key] = {
            count: 0,
            label: env ? env.label : "OTHER",
            color: env ? env.color : "#94a3b8",
            bg: env ? env.bg : "rgba(255,255,255,0.06)"
          };
        }
        envCounts[key].count++;
      });

      const uniqueKeys = Object.keys(envCounts);
      if (uniqueKeys.length > 0) {
        let chipsHtml = `
          <button type="button" class="nx-env-chip ${activeSavedSessionsEnv === 'all' ? 'active' : ''}" data-env="all">
            <span>All</span>
            <span class="chip-count">${allSessions.length}</span>
          </button>
        `;
        uniqueKeys.forEach(k => {
          const info = envCounts[k];
          chipsHtml += `
            <button type="button" class="nx-env-chip ${activeSavedSessionsEnv === k ? 'active' : ''}" data-env="${k}" style="--chip-accent:${info.color};">
              <span class="chip-dot" style="background:${info.color};"></span>
              <span>${info.label}</span>
              <span class="chip-count">${info.count}</span>
            </button>
          `;
        });
        chipsContainer.innerHTML = chipsHtml;

        chipsContainer.querySelectorAll(".nx-env-chip").forEach(chip => {
          chip.onclick = () => {
            activeSavedSessionsEnv = chip.dataset.env;
            updateRecentSessionsGrid(null, searchInput ? searchInput.value : "");
          };
        });
      } else {
        chipsContainer.innerHTML = "";
      }
    }
  }

  // Filter items based on active env chip and search text
  const filterFn = item => {
    if (activeSavedSessionsEnv !== "all") {
      const env = getItemEnv(item);
      const key = env ? env.key : "other";
      if (key !== activeSavedSessionsEnv) return false;
    }
    if (!q) return true;
    const s = item.session;
    return (s.name && s.name.toLowerCase().includes(q)) ||
           (s.host && s.host.toLowerCase().includes(q)) ||
           (s.username && s.username.toLowerCase().includes(q)) ||
           (s.environment && s.environment.toLowerCase().includes(q)) ||
           (item.folder && item.folder.name.toLowerCase().includes(q));
  };

  const renderCard = item => {
    const s = item.session;
    const nodeId = item.nodeId || "";
    const protoInfo = getSessionProtocolInfo(s);
    const folderEnv = item.folder ? getEnvironmentFromFolderName(item.folder.name) : null;
    const env = folderEnv || getEnvironmentInfo(s.environment || s.color);
    const customColor = (folderEnv ? folderEnv.color : s.color) || (env ? env.color : "#38bdf8");
    
    const rawName = s.name || s.host || "Session";
    const safeName = rawName.replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
    
    const hostStr = s.host || 'localhost';
    const portStr = s.port ? `:${s.port}` : (protoInfo.badge === 'SSH' ? ':22' : '');
    const userHost = `${s.username ? s.username + '@' : ''}${hostStr}${portStr}`;
    
    // Avoid repeating title and subtitle if identical
    let subText = "";
    if (rawName.trim() === userHost || rawName.trim() === hostStr || rawName.trim() === `${s.username}@${hostStr}`) {
      subText = `${protoInfo.badge} • ${hostStr}${portStr}`;
    } else {
      subText = `${protoInfo.badge} • ${userHost}`;
    }
    const safeSub = subText.replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));

    const isConn = Object.values(tabs).some(t => t.profile && (t.profile.id === s.id || (t.profile.host === s.host && t.profile.username === s.username)) && t.isConnected);
    
    const envBadge = env
      ? `<span class="card-env-badge env-${env.key}" style="color:${env.color}; background:${env.bg}; border:1px solid ${env.border};" title="Environment: ${env.name}">${env.label}</span>`
      : `<span class="card-env-badge card-env-default" title="No environment set">DEFAULT</span>`;

    return `
      <div class="recent-session-card ${isConn ? 'is-connected' : ''}" data-id="${s.id}" data-node-id="${nodeId}" style="--card-accent:${customColor};" title="Click to ${isConn ? 'focus' : 'connect'} ${safeName}">
        <div class="card-top-bar">
          <div class="card-icon-box" style="background:${env ? env.bg : 'rgba(56,189,248,0.1)'}; color:${customColor}; border:1px solid ${env ? env.border : 'rgba(56,189,248,0.2)'};">
            <span class="card-proto-glyph">${protoInfo.icon}</span>
          </div>
          <div class="card-title-group">
            <span class="card-name" title="${safeName}">${safeName}</span>
            <span class="card-host" title="${safeSub}">${safeSub}</span>
          </div>
          <div class="card-tag-group">
            ${envBadge}
          </div>
        </div>

        <div class="card-bottom-bar">
          <div class="card-status-pill ${isConn ? 'is-live' : 'is-idle'}">
            <span class="status-dot"></span>
            <span class="status-label">${isConn ? 'Connected' : 'Ready'}</span>
          </div>
          <div class="card-hover-actions">
            <button class="card-action-btn card-connect-btn" type="button" data-id="${s.id}" title="${isConn ? 'Focus Tab' : 'Connect'}">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
              </svg>
              <span>${isConn ? 'Focus' : 'Connect'}</span>
            </button>
            <button class="card-action-btn card-edit-btn" type="button" data-id="${s.id}" title="Edit Configuration">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 20h9"></path>
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
              </svg>
            </button>
            <button class="card-action-btn card-delete-btn" type="button" data-id="${s.id}" data-node-id="${nodeId}" title="Remove Server">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
            </button>
          </div>
        </div>
      </div>
    `;
  };

  if (allSessions.length === 0) {
    grid.innerHTML = `
      <div class="empty-saved-sessions-card">
        <div style="font-size:30px; margin-bottom:8px;">🌐</div>
        <div style="font-size:14px; font-weight:700; color:var(--text-primary); margin-bottom:4px;">No Saved Sessions Yet</div>
        <div style="font-size:12px; color:var(--text-muted); margin-bottom:14px;">Create your first SSH, SFTP, or RDP connection to launch with one click.</div>
        <div style="display:flex; gap:10px; justify-content:center;">
          <button class="btn btn-sm btn-primary" id="homeCreateSessBtn" type="button">＋ New Session</button>
        </div>
      </div>
    `;
    const btn = grid.querySelector("#homeCreateSessBtn");
    if (btn) {
      btn.onclick = () => {
        import("./sessionDialog.js").then(m => m.showNewSessionDialog());
      };
    }
    return;
  }

  let html = "";

  if (activeSavedSessionsEnv !== "all") {
    // When an environment chip is selected, render a clean, direct flat grid
    const filtered = allSessions.filter(filterFn);
    if (filtered.length > 0) {
      html = `<div class="home-env-cards-grid">${filtered.map(renderCard).join("")}</div>`;
    }
  } else {
    // When "All" is active, group by folder but STRICTLY SKIP any group with 0 matching sessions!
    groups.forEach(grp => {
      const matched = grp.sessions.filter(filterFn);
      if (matched.length === 0) return; // Completely hide empty groups!
      const env = grp.env || { key: 'default', label: grp.name.toUpperCase(), name: grp.name, color: '#94a3b8', bg: 'rgba(255,255,255,0.08)', border: 'rgba(255,255,255,0.15)' };
      html += `
        <div class="home-env-group" data-folder-name="${escapeHtml(grp.name)}">
          <div class="home-env-header">
            <div class="home-env-title">
              <span class="home-env-pill env-${env.key}" style="color:${env.color}; background:${env.bg}; border: 1px solid ${env.border};">${env.label}</span>
              <span class="home-env-name">${escapeHtml(grp.name.toUpperCase())}</span>
              <span class="home-env-count">${matched.length}</span>
            </div>
          </div>
          <div class="home-env-cards-grid">
            ${matched.map(renderCard).join("")}
          </div>
        </div>
      `;
    });

    // Render any root unassigned sessions (if any exist)
    const unassigned = allSessions.filter(item => !item.folder && filterFn(item));
    if (unassigned.length > 0) {
      html += `
        <div class="home-env-group unassigned-group">
          <div class="home-env-header">
            <div class="home-env-title">
              <span class="home-env-pill" style="color:#94a3b8; background:rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15);">SERVERS</span>
              <span class="home-env-name">OTHER SAVED SERVERS</span>
              <span class="home-env-count">${unassigned.length}</span>
            </div>
          </div>
          <div class="home-env-cards-grid">
            ${unassigned.map(renderCard).join("")}
          </div>
        </div>
      `;
    }
  }

  grid.innerHTML = html || `
    <div class="empty-saved-sessions-card">
      <div style="font-size:24px; margin-bottom:6px;">🔍</div>
      <div style="font-size:13px; font-weight:600; color:var(--text-primary); margin-bottom:4px;">No matching sessions found</div>
      <div style="font-size:11.5px; color:var(--text-muted); margin-bottom:12px;">Try adjusting your search query or selected environment filter.</div>
      <button class="btn btn-xs btn-secondary" id="clearSavedFiltersBtn" type="button">Reset Filters</button>
    </div>
  `;

  const resetBtn = grid.querySelector("#clearSavedFiltersBtn");
  if (resetBtn) {
    resetBtn.onclick = () => {
      if (searchInput) searchInput.value = "";
      activeSavedSessionsEnv = "all";
      updateRecentSessionsGrid(null, "");
    };
  }

  const sessions = allSessions;

  // Launch / Connect Handler
  const handleLaunch = sessId => {
    const item = sessions.find(s => s.session.id === sessId);
    if (!item || !item.session) return;
    const openTabEntry = Object.entries(tabs).find(([_, t]) => t.profile && (t.profile.id === item.session.id || (t.profile.host === item.session.host && t.profile.username === item.session.username)));
    if (openTabEntry && openTabEntry[1].isConnected) {
      activateTab(openTabEntry[0]);
    } else {
      const folderEnv = item.folder ? getEnvironmentFromFolderName(item.folder.name) : null;
      const env = folderEnv || getEnvironmentInfo(item.session.environment || item.session.color);
      const customColor = (folderEnv ? folderEnv.color : item.session.color) || (env ? env.color : "");
      connectToSession({
        ...item.session,
        environment: env ? env.key : item.session.environment,
        color: customColor || item.session.color
      });
    }
  };

  grid.querySelectorAll(".card-connect-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      handleLaunch(btn.dataset.id);
    });
  });

  // Edit session handler
  grid.querySelectorAll(".card-edit-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const item = sessions.find(s => s.session.id === btn.dataset.id);
      if (item && item.session) {
        import("./sessionDialog.js").then(m => m.showEditSessionDialog(item.session));
      }
    });
  });

  // Remove / Delete Server Handler
  grid.querySelectorAll(".card-delete-btn").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const sessId = btn.dataset.id;
      const nodeId = btn.dataset.nodeId;
      const item = sessions.find(s => s.session.id === sessId);
      const serverName = (item && item.session && (item.session.name || item.session.host)) || "this server";

      if (!confirm(`Are you sure you want to remove "${serverName}" from saved servers?`)) {
        return;
      }

      try {
        if (nodeId && window.go && window.go.main && window.go.main.App) {
          await window.go.main.App.DeleteNode(nodeId);
        } else if (window.go && window.go.main && window.go.main.App) {
          function findNodeBySessionId(node, id) {
            if (!node) return null;
            if (node.session && node.session.id === id) return node;
            if (node.children) {
              for (const c of node.children) {
                const found = findNodeBySessionId(c, id);
                if (found) return found;
              }
            }
            return null;
          }
          const target = findNodeBySessionId(rootNode, sessId);
          if (target) {
            await window.go.main.App.DeleteNode(target.id);
          }
        }
        await refreshTree();
        showToast(`Removed "${serverName}"`, "info");
      } catch (err) {
        console.error("Failed to remove server:", err);
        showToast(`Failed to remove server: ${err}`, "error");
      }
    });
  });

  // 1-Click Connect on entire card body
  grid.querySelectorAll(".recent-session-card").forEach(card => {
    card.addEventListener("click", (e) => {
      if (e.target.closest(".card-action-btn")) return;
      handleLaunch(card.dataset.id);
    });

    // Native Context Menu on card right-click
    card.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const item = sessions.find(s => s.session.id === card.dataset.id);
      if (item && item.session) {
        showSessionContextMenu(e.clientX, e.clientY, item.session, item.nodeId);
      }
    });
  });
}

export function switchSidebarView(view) {
  const views = {
    sessions: { viewId: "viewSessions", tabId: "navTabSessions" },
    sftp: { viewId: "viewSFTP", tabId: "navTabSFTP" },
    macros: { viewId: "viewMacros", tabId: "navTabMacros" },
    tunnel: { viewId: "viewTunnel", tabId: "navTabTunnel" },
    tools: { viewId: "viewTools", tabId: "navTabTools" },
    followterm: { viewId: "viewFollowTerm", tabId: "navTabFollowTerm" },
    monitor: { viewId: "viewMonitor", tabId: "navTabMonitor" },
    brm: { viewId: "viewBRM", tabId: "navTabBRM" }
  };

  Object.entries(views).forEach(([v, ids]) => {
    const viewEl = document.getElementById(ids.viewId);
    const tabEl = document.getElementById(ids.tabId);
    const isTarget = v === view;
    if (viewEl) {
      viewEl.classList.toggle("hidden", !isTarget);
      viewEl.style.display = isTarget ? "flex" : "none";
    }
    if (tabEl) tabEl.classList.toggle("active", isTarget);
  });

  if (view === "sftp") {
    const path = (tabs[activeTabId] && tabs[activeTabId].sftpPath) || currentSFTPPath || "~";
    refreshSFTP(path);
  }
  if (view === "macros") renderSidebarMacros();
  if (view === "tunnel") renderSidebarTunnels();
}

// Connect registration delegates
registerDialogRefreshTree(refreshTree);
registerContextMenuRefreshTree(refreshTree);
registerRenderConnectedServers(renderConnectedServers);
registerSFTPRenderConnectedServers(renderConnectedServers);
registerTabStateRenderConnectedServers(renderConnectedServers);
registerContextMenuOpenSFTP((targetPath) => {
  switchSidebarView("sftp");
  if (typeof refreshSFTP === "function") {
    refreshSFTP(targetPath || "~");
  }
});

export { showMultiServerConnectDialog } from './multiServerConnect.js';
