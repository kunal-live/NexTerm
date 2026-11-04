// ==========================================================================
// Nexterm - Session & Folder Context Menus
// Desktop connection manager context menus for sessions and folders.
// ==========================================================================

import { getContextMenuEl, posMenu, hideContextMenu } from '../ui/contextMenu.js';
import { showToast, escapeHtml } from '../ui/notifications.js';
import { rootNode } from '../state/sessionState.js';
import { tabs } from '../state/tabState.js';
import { connectToSession, activateTab, disconnectTab } from '../terminal/terminalManager.js';
import { showModal, hideModal } from '../ui/modal.js';
import {
  showNewSessionDialog,
  showFolderDialog,
  showRenameNodeDialog,
  showMoveNodeDialog
} from './sessionDialog.js';
import { connectFolderSessionsAndBroadcast, connectFolderSessionsTabbed } from './multiServerConnect.js';

let refreshTreeCallback = null;
export function registerContextMenuRefreshTree(fn) {
  refreshTreeCallback = fn;
}

let openSFTPCallback = null;
export function registerContextMenuOpenSFTP(fn) {
  openSFTPCallback = fn;
}

async function triggerRefreshTree() {
  if (refreshTreeCallback) {
    await refreshTreeCallback();
  }
}

// --------------------------------------------------------------------------
// Clipboard Utility
// --------------------------------------------------------------------------

export async function copyToClipboard(text) {
  if (!text) return false;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (err) {
    // Fallback below
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    ta.style.top = "-9999px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const success = document.execCommand("copy");
    document.body.removeChild(ta);
    return success;
  } catch (e) {
    return false;
  }
}

// --------------------------------------------------------------------------
// Format Connection Details
// --------------------------------------------------------------------------

export function formatConnectionDetails(profile) {
  if (!profile) return "";
  const proto = (profile.protocol || "ssh").toLowerCase();
  const host = profile.host || "localhost";
  const defaultPort = proto === "rdp" ? 3389 : proto === "vnc" ? 5900 : proto === "telnet" ? 23 : 22;
  const port = profile.port || defaultPort;
  const user = profile.username || "";

  switch (proto) {
    case "ssh":
      return user ? `ssh -p ${port} ${user}@${host}` : `ssh -p ${port} ${host}`;
    case "sftp":
      return user ? `sftp://${user}@${host}:${port}` : `sftp://${host}:${port}`;
    case "telnet":
      return `telnet ${host} ${port}`;
    case "rdp":
      return `mstsc.exe /v:${host}:${port}`;
    case "vnc":
      return `vnc://${host}:${port}`;
    case "serial":
      return `Serial: ${profile.port || "COM1"} (Baud: ${profile.baudRate || 9600})`;
    case "local":
      return `Local Shell: ${profile.shellPath || "powershell.exe"}`;
    default:
      return `${proto}://${user ? user + "@" : ""}${host}:${port}`;
  }
}

// --------------------------------------------------------------------------
// Open SFTP for Session
// --------------------------------------------------------------------------

export async function openSFTPForSession(profile) {
  if (!profile) return;
  const proto = (profile.protocol || "ssh").toLowerCase();
  if (proto !== "ssh" && proto !== "sftp") {
    showToast("SFTP is only available for SSH and SFTP sessions", "warning");
    return;
  }

  // Check if a tab is already open for this session profile
  let foundTabId = null;
  if (tabs) {
    for (const [id, tab] of Object.entries(tabs)) {
      if (tab && tab.profile && (tab.profile.id === profile.id || (tab.profile.host === profile.host && tab.profile.username === profile.username))) {
        foundTabId = id;
        break;
      }
    }
  }

  if (foundTabId) {
    activateTab(foundTabId);
    if (openSFTPCallback) {
      openSFTPCallback(tabs[foundTabId].sftpPath || "~");
    }
    showToast(`Opened SFTP for "${profile.name}"`, "success");
  } else {
    showToast(`Connecting to "${profile.name}" for SFTP...`, "info");
    connectToSession(profile);
    if (openSFTPCallback) {
      setTimeout(() => openSFTPCallback("~"), 650);
    }
  }
}

// --------------------------------------------------------------------------
// Session Properties Modal
// --------------------------------------------------------------------------

export function showSessionPropertiesModal(profile) {
  if (!profile) return;
  const proto = (profile.protocol || "ssh").toUpperCase();
  const connStr = formatConnectionDetails(profile);

  // Check if session is currently connected in an active tab
  let isConnected = false;
  if (tabs) {
    for (const tab of Object.values(tabs)) {
      if (tab && tab.profile && tab.profile.id === profile.id) {
        isConnected = true;
        break;
      }
    }
  }

  const html = `
    <div class="modal-header">
      <div class="modal-title" style="display:flex; align-items:center; gap:8px;">
        <span style="font-size:16px;">ℹ️</span>
        <span>Session Properties — <b>${escapeHtml(profile.name)}</b></span>
        <span class="session-prop-badge" style="font-size:10px; font-weight:700; padding:2px 7px; border-radius:3px; background:rgba(96,165,250,0.15); color:#60a5fa; border:1px solid rgba(96,165,250,0.3); font-family:var(--font-mono);">${proto}</span>
      </div>
      <button class="modal-close-btn" id="propModalClose">&times;</button>
    </div>
    <div class="modal-body" style="padding:16px 20px; max-height:480px; overflow-y:auto;">
      <div style="font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.8px; color:var(--text-muted); margin-bottom:8px;">General Information</div>
      <div style="display:grid; grid-template-columns:140px 1fr; gap:6px 12px; font-size:12.5px; margin-bottom:16px; background:rgba(0,0,0,0.25); padding:10px 12px; border-radius:4px; border:1px solid var(--border-subtle);">
        <span style="color:var(--text-muted);">Session Name:</span>
        <span style="color:var(--text-primary); font-weight:600;">${escapeHtml(profile.name)}</span>

        <span style="color:var(--text-muted);">Session ID:</span>
        <span style="color:var(--text-secondary); font-family:var(--font-mono); font-size:11px;">${escapeHtml(profile.id || "Auto-generated")}</span>

        <span style="color:var(--text-muted);">Protocol:</span>
        <span style="color:var(--text-primary); font-weight:600;">${proto}</span>

        <span style="color:var(--text-muted);">Live Status:</span>
        <span>${isConnected ? '<span style="color:#22c55e; font-weight:600;">● Active / Connected</span>' : '<span style="color:var(--text-muted);">○ Idle / Disconnected</span>'}</span>
      </div>

      <div style="font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.8px; color:var(--text-muted); margin-bottom:8px;">Connection Endpoint</div>
      <div style="display:grid; grid-template-columns:140px 1fr; gap:6px 12px; font-size:12.5px; margin-bottom:16px; background:rgba(0,0,0,0.25); padding:10px 12px; border-radius:4px; border:1px solid var(--border-subtle);">
        <span style="color:var(--text-muted);">Remote Host:</span>
        <span style="color:var(--text-primary); font-family:var(--font-mono); font-weight:500;">${escapeHtml(profile.host || "—")}</span>

        <span style="color:var(--text-muted);">Port:</span>
        <span style="color:var(--text-primary); font-family:var(--font-mono); font-weight:500;">${profile.port || (proto === "RDP" ? 3389 : proto === "VNC" ? 5900 : proto === "TELNET" ? 23 : 22)}</span>

        <span style="color:var(--text-muted);">Username:</span>
        <span style="color:var(--text-primary);">${escapeHtml(profile.username || "—")}</span>

        <span style="color:var(--text-muted);">Connection Target:</span>
        <span style="color:#93c5fd; font-family:var(--font-mono); font-size:11.5px; word-break:break-all;">${escapeHtml(connStr)}</span>
      </div>

      <div style="font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.8px; color:var(--text-muted); margin-bottom:8px;">Security & Terminal Environment</div>
      <div style="display:grid; grid-template-columns:140px 1fr; gap:6px 12px; font-size:12.5px; background:rgba(0,0,0,0.25); padding:10px 12px; border-radius:4px; border:1px solid var(--border-subtle);">
        <span style="color:var(--text-muted);">Authentication:</span>
        <span style="color:var(--text-primary); text-transform:capitalize;">${escapeHtml(profile.authType || "Password / Credential Vault")}</span>

        ${profile.keyPath ? `
          <span style="color:var(--text-muted);">Private Key:</span>
          <span style="color:var(--text-secondary); font-family:var(--font-mono); font-size:11px; word-break:break-all;">${escapeHtml(profile.keyPath)}</span>
        ` : ''}

        ${profile.initialDir ? `
          <span style="color:var(--text-muted);">Initial Directory:</span>
          <span style="color:var(--text-secondary); font-family:var(--font-mono); font-size:11.5px;">${escapeHtml(profile.initialDir)}</span>
        ` : ''}

        <span style="color:var(--text-muted);">Keep-Alive:</span>
        <span style="color:var(--text-secondary);">${profile.keepaliveInterval ? profile.keepaliveInterval + "s" : "Default (30s)"}</span>

        <span style="color:var(--text-muted);">Font Size:</span>
        <span style="color:var(--text-secondary);">${profile.fontSize ? profile.fontSize + "px" : "Default (13px)"}</span>
      </div>
    </div>
    <div class="modal-footer" style="display:flex; justify-content:space-between; align-items:center; padding:12px 20px; border-top:1px solid var(--border-subtle); background:rgba(0,0,0,0.15);">
      <div style="display:flex; gap:8px;">
        <button class="btn-action" id="propCopyBtn" title="Copy Connection Command">📋 Copy Details</button>
        ${(proto === "SSH" || proto === "SFTP") ? `
          <button class="btn-action" id="propSFTPBtn" title="Open SFTP Explorer">📁 Open SFTP</button>
        ` : ''}
      </div>
      <div style="display:flex; gap:8px;">
        <button class="btn-action" id="propEditBtn">✏️ Edit</button>
        <button class="btn-action primary" id="propConnectBtn">⚡ Connect</button>
        <button class="btn-action" id="propCloseBtn">Close</button>
      </div>
    </div>
  `;

  const box = showModal(html, "session-props-modal");
  if (!box) return;

  const close = () => hideModal();
  const closeBtn = document.getElementById("propModalClose");
  const bottomCloseBtn = document.getElementById("propCloseBtn");
  if (closeBtn) closeBtn.onclick = close;
  if (bottomCloseBtn) bottomCloseBtn.onclick = close;

  const copyBtn = document.getElementById("propCopyBtn");
  if (copyBtn) {
    copyBtn.onclick = async () => {
      await copyToClipboard(connStr);
      showToast(`Copied: ${connStr}`, "success");
    };
  }

  const sftpBtn = document.getElementById("propSFTPBtn");
  if (sftpBtn) {
    sftpBtn.onclick = () => {
      close();
      openSFTPForSession(profile);
    };
  }

  const editBtn = document.getElementById("propEditBtn");
  if (editBtn) {
    editBtn.onclick = () => {
      close();
      showNewSessionDialog("", profile);
    };
  }

  const connBtn = document.getElementById("propConnectBtn");
  if (connBtn) {
    connBtn.onclick = () => {
      close();
      connectToSession(profile);
    };
  }
}

// --------------------------------------------------------------------------
// Folder Context Menu
// Supported:
//   New Session
//   New Folder
//   Rename
//   Delete
//   Move
//   Expand
//   Collapse
// --------------------------------------------------------------------------

export function showFolderContextMenu(x, y, node) {
  const contextMenuEl = getContextMenuEl();
  if (!contextMenuEl) return;

  const isRoot = node.id === (rootNode ? rootNode.id : "");

  contextMenuEl.innerHTML = `
    <div class="context-menu-item" id="cConnectAllFold" style="color: #22c55e; font-weight: 600;">▶ Open All in Tabs</div>
    <div class="context-menu-item" id="cConnectBcastFold" style="color: #38bdf8; font-weight: 600;">⚡ Connect All & Broadcast</div>
    <div class="context-menu-separator"></div>
    <div class="context-menu-item" id="cAddSess">＋ New Session</div>
    <div class="context-menu-item" id="cAddFold">📁 New Folder</div>
    <div class="context-menu-separator"></div>
    ${!isRoot ? `<div class="context-menu-item" id="cFolderProps">⚙️ Folder Properties & Options</div>` : ''}
    ${!isRoot ? `<div class="context-menu-item" id="cRenFold">✏️ Rename</div>` : ''}
    ${!isRoot ? `<div class="context-menu-item" id="cMoveFold">📦 Move</div>` : ''}
    <div class="context-menu-separator"></div>
    <div class="context-menu-item" id="cExpFold">⊞ Expand</div>
    <div class="context-menu-item" id="cColFold">⊟ Collapse</div>
    ${!isRoot ? `
      <div class="context-menu-separator"></div>
      <div class="context-menu-item danger" id="cDelFold">🗑️ Delete</div>
    ` : ''}
  `;
  posMenu(x, y);

  // 0a. Open All in Tabs (no broadcast / no split)
  const openAllBtn = contextMenuEl.querySelector("#cConnectAllFold");
  if (openAllBtn) {
    openAllBtn.onclick = () => {
      hideContextMenu();
      connectFolderSessionsTabbed(node);
    };
  }

  // 0b. Connect All & Broadcast
  const bcastBtn = contextMenuEl.querySelector("#cConnectBcastFold");
  if (bcastBtn) {
    bcastBtn.onclick = () => {
      hideContextMenu();
      connectFolderSessionsAndBroadcast(node);
    };
  }

  // 1. New Session
  contextMenuEl.querySelector("#cAddSess").onclick = () => {
    hideContextMenu();
    showNewSessionDialog(node.id);
  };

  // 2. New Folder
  contextMenuEl.querySelector("#cAddFold").onclick = () => {
    hideContextMenu();
    showFolderDialog(node.id);
  };

  // 2b. Folder Properties & Options
  const propsBtn = contextMenuEl.querySelector("#cFolderProps");
  if (propsBtn) {
    propsBtn.onclick = () => {
      hideContextMenu();
      showFolderDialog(node.parentId || "", node);
    };
  }

  // 3. Rename
  const ren = contextMenuEl.querySelector("#cRenFold");
  if (ren) {
    ren.onclick = () => {
      hideContextMenu();
      showRenameNodeDialog(node.id, node.name, true);
    };
  }

  // 4. Move
  const move = contextMenuEl.querySelector("#cMoveFold");
  if (move) {
    move.onclick = () => {
      hideContextMenu();
      showMoveNodeDialog(node.id, node.name, true);
    };
  }

  // 5. Expand
  contextMenuEl.querySelector("#cExpFold").onclick = async () => {
    hideContextMenu();
    node.expanded = true;
    if (window.go && window.go.main && window.go.main.App) {
      await window.go.main.App.ToggleFolder(node.id, true);
    }
    await triggerRefreshTree();
    showToast(`Expanded "${node.name}"`, "info");
  };

  // 6. Collapse
  contextMenuEl.querySelector("#cColFold").onclick = async () => {
    hideContextMenu();
    node.expanded = false;
    if (window.go && window.go.main && window.go.main.App) {
      await window.go.main.App.ToggleFolder(node.id, false);
    }
    await triggerRefreshTree();
    showToast(`Collapsed "${node.name}"`, "info");
  };

  // 7. Delete
  const del = contextMenuEl.querySelector("#cDelFold");
  if (del) {
    del.onclick = async () => {
      hideContextMenu();
      const childCount = node.children ? node.children.length : 0;
      const msg = childCount > 0
        ? `Are you sure you want to delete folder "${node.name}" and its ${childCount} item(s)?`
        : `Are you sure you want to delete folder "${node.name}"?`;
      if (!confirm(msg)) return;
      try {
        if (window.go && window.go.main && window.go.main.App) await window.go.main.App.DeleteNode(node.id);
        await triggerRefreshTree();
        showToast(`Deleted folder "${node.name}"`, "info");
      } catch (err) {
        showToast("Delete failed: " + err, "error");
      }
    };
  }
}

// --------------------------------------------------------------------------
// Session Context Menu
// Supported:
//   Connect
//   Edit
//   Duplicate
//   Rename
//   Delete
//   Move To
//   Copy Connection Details
//   Open SFTP
//   Properties
// --------------------------------------------------------------------------

export function showSessionContextMenu(x, y, profile, nodeId) {
  const contextMenuEl = getContextMenuEl();
  if (!contextMenuEl) return;

  let activeTabForProfile = null;
  if (tabs) {
    for (const [id, tab] of Object.entries(tabs)) {
      if (tab && tab.profile && tab.profile.id === profile.id && tab.isConnected) {
        activeTabForProfile = id;
        break;
      }
    }
  }

  contextMenuEl.innerHTML = `
    <div class="context-menu-item" id="cConn">⚡ Connect</div>
    <div class="context-menu-item" id="cConnNew">⧉ Open in New Tab (Duplicate)</div>
    ${activeTabForProfile ? `<div class="context-menu-item" id="cDisconn" style="color:#ef4444;">🔌 Disconnect Session</div>` : ''}
    <div class="context-menu-item" id="cEdit">✏️ Edit</div>
    <div class="context-menu-item" id="cDup">📋 Duplicate Saved Entry</div>
    <div class="context-menu-item" id="cRenSess">🏷️ Rename</div>
    <div class="context-menu-separator"></div>
    <div class="context-menu-item" id="cMoveSess">📦 Move To</div>
    <div class="context-menu-item" id="cCopyDetails">📋 Copy Connection Details</div>
    <div class="context-menu-item" id="cOpenSFTP">📁 Open SFTP</div>
    <div class="context-menu-item" id="cProps">ℹ️ Properties</div>
    <div class="context-menu-separator"></div>
    <div class="context-menu-item danger" id="cDel">🗑️ Delete</div>
  `;
  posMenu(x, y);

  // 1. Connect
  contextMenuEl.querySelector("#cConn").onclick = () => {
    hideContextMenu();
    connectToSession(profile);
  };

  // 1b. Open in New Tab (duplicate live connection — forces a fresh tab even if
  // one is already open for this server)
  contextMenuEl.querySelector("#cConnNew").onclick = () => {
    hideContextMenu();
    connectToSession(profile, true);
  };

  const disconnBtn = contextMenuEl.querySelector("#cDisconn");
  if (disconnBtn && activeTabForProfile) {
    disconnBtn.onclick = () => {
      hideContextMenu();
      disconnectTab(activeTabForProfile);
    };
  }

  // 2. Edit
  contextMenuEl.querySelector("#cEdit").onclick = () => {
    hideContextMenu();
    showNewSessionDialog("", profile);
  };

  // 3. Duplicate
  contextMenuEl.querySelector("#cDup").onclick = async () => {
    hideContextMenu();
    try {
      if (window.go && window.go.main && window.go.main.App) await window.go.main.App.DuplicateSession(nodeId);
      await triggerRefreshTree();
      showToast(`Duplicated "${profile.name}"`, "success");
    } catch (err) {
      showToast("Duplicate failed: " + err, "error");
    }
  };

  // 4. Rename
  contextMenuEl.querySelector("#cRenSess").onclick = () => {
    hideContextMenu();
    showRenameNodeDialog(nodeId, profile.name, false);
  };

  // 5. Move To
  contextMenuEl.querySelector("#cMoveSess").onclick = () => {
    hideContextMenu();
    showMoveNodeDialog(nodeId, profile.name, false);
  };

  // 6. Copy Connection Details
  contextMenuEl.querySelector("#cCopyDetails").onclick = async () => {
    hideContextMenu();
    const details = formatConnectionDetails(profile);
    await copyToClipboard(details);
    showToast(`Copied connection details: ${details}`, "success");
  };

  // 7. Open SFTP
  contextMenuEl.querySelector("#cOpenSFTP").onclick = () => {
    hideContextMenu();
    openSFTPForSession(profile);
  };

  // 8. Properties
  contextMenuEl.querySelector("#cProps").onclick = () => {
    hideContextMenu();
    showSessionPropertiesModal(profile);
  };

  // 9. Delete
  contextMenuEl.querySelector("#cDel").onclick = async () => {
    hideContextMenu();
    if (!confirm(`Are you sure you want to delete session "${profile.name}"?`)) return;
    try {
      if (window.go && window.go.main && window.go.main.App) await window.go.main.App.DeleteNode(nodeId);
      await triggerRefreshTree();
      showToast(`Deleted session "${profile.name}"`, "info");
    } catch (err) {
      showToast("Delete failed: " + err, "error");
    }
  };
}
