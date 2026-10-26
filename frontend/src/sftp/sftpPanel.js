// ==========================================================================
// Nexterm - SFTP Panel & Dual Pane File Explorer
// ==========================================================================

import { tabs, activeTabId } from '../state/tabState.js';
import { escapeHtml, showToast } from '../ui/notifications.js';
import {
  getMobaFileIcon,
  formatMobaSize,
  openRemoteFileEditor,
  showSFTPContextMenu,
  openChmodModal,
  registerFileBrowserSFTPRefresh
} from './fileBrowser.js';
import { registerSFTPRefresh } from '../terminal/terminal.js';
import { registerDualPaneSFTP } from '../terminal/terminalManager.js';

export let currentSFTPPath = "/";
export let sftpCurrentItems = [];
export let selectedSFTPItem = null;
export let sftpSortColumn = "name"; // "name" or "size"
export let sftpSortOrder = "asc";   // "asc" or "desc"
export let showHiddenSFTPFiles = true;
export let recentSFTPPaths = ["/", "~", "/opt", "/etc", "/var/log", "/tmp"];

export function setSFTPSortColumn(col) { sftpSortColumn = col; }
export function setSFTPSortOrder(order) { sftpSortOrder = order; }
export function setShowHiddenSFTPFiles(val) { showHiddenSFTPFiles = val; }

let renderConnectedServersCallback = null;
export function registerSFTPRenderConnectedServers(fn) {
  renderConnectedServersCallback = fn;
}

export function goSFTPParentDirectory() {
  if (!currentSFTPPath || currentSFTPPath === "/") return;
  const lastSlash = currentSFTPPath.lastIndexOf("/");
  let parent = currentSFTPPath.substring(0, lastSlash);
  if (!parent || parent === "") parent = "/";
  refreshSFTP(parent);
}

export async function refreshSFTP(targetPath = "") {
  const fileListEl = document.getElementById("sftpFileList");
  const pathInput = document.getElementById("sftpPathInput");
  const badge = document.getElementById("sftpCountBadge");
  if (!fileListEl) return;

  if (!activeTabId || activeTabId === "home" || !tabs[activeTabId] || tabs[activeTabId].isLocal) {
    fileListEl.innerHTML = `<div class="sftp-empty-hint">Connect to an SSH server to browse remote files via SFTP</div>`;
    if (badge) badge.textContent = "0 items";
    return;
  }

  const activeTab = tabs[activeTabId];
  const path = targetPath || (activeTab && activeTab.sftpPath) || currentSFTPPath || "~";
  fileListEl.innerHTML = `<div class="sftp-empty-hint">Loading files from ${escapeHtml(path)}...</div>`;

  try {
    if (window.go && window.go.main && window.go.main.App && typeof window.go.main.App.SFTPList === "function") {
      const res = await window.go.main.App.SFTPList(activeTabId, path);
      currentSFTPPath = (res && res.path) || path;
      if (activeTab) activeTab.sftpPath = currentSFTPPath;
      if (pathInput) pathInput.value = currentSFTPPath;

      // Update recent paths history
      if (currentSFTPPath && !recentSFTPPaths.includes(currentSFTPPath)) {
        recentSFTPPaths.unshift(currentSFTPPath);
        if (recentSFTPPaths.length > 15) recentSFTPPaths.pop();
        updateRecentPathsDropdown();
      }

      sftpCurrentItems = (res && res.items) || [];
      renderSFTPItems(sftpCurrentItems, currentSFTPPath);
      if (renderConnectedServersCallback) {
        renderConnectedServersCallback();
      }
    } else {
      // Browser Preview / Mockup fallback (matching MobaXterm screenshot)
      const user = (activeTab.profile && activeTab.profile.username) || "pin";
      const resolvedPath = (path === "~" || !path || path === "/") ? `/home/${user}` : path;
      currentSFTPPath = resolvedPath;
      if (activeTab) activeTab.sftpPath = currentSFTPPath;
      if (pathInput) pathInput.value = currentSFTPPath;

      sftpCurrentItems = [
        { name: "Videos", isDir: true, size: 4096, permissions: "drwxr-xr-x", modTime: "2026-09-15 15:10", path: `${currentSFTPPath}/Videos` },
        { name: "Templates", isDir: true, size: 4096, permissions: "drwxr-xr-x", modTime: "2026-09-15 15:10", path: `${currentSFTPPath}/Templates` },
        { name: "Public", isDir: true, size: 4096, permissions: "drwxr-xr-x", modTime: "2026-09-15 15:10", path: `${currentSFTPPath}/Public` },
        { name: "Portal", isDir: true, size: 4096, permissions: "drwxr-xr-x", modTime: "2026-09-15 15:10", path: `${currentSFTPPath}/Portal` },
        { name: "Pictures", isDir: true, size: 4096, permissions: "drwxr-xr-x", modTime: "2026-09-15 15:10", path: `${currentSFTPPath}/Pictures` },
        { name: "Music", isDir: true, size: 4096, permissions: "drwxr-xr-x", modTime: "2026-09-15 15:10", path: `${currentSFTPPath}/Music` },
        { name: "Downloads", isDir: true, size: 4096, permissions: "drwxr-xr-x", modTime: "2026-09-15 15:10", path: `${currentSFTPPath}/Downloads` },
        { name: "Documents", isDir: true, size: 4096, permissions: "drwxr-xr-x", modTime: "2026-09-15 15:10", path: `${currentSFTPPath}/Documents` },
        { name: "Desktop", isDir: true, size: 4096, permissions: "drwxr-xr-x", modTime: "2026-09-15 15:10", path: `${currentSFTPPath}/Desktop` },
        { name: ".vim", isDir: true, size: 4096, permissions: "drwxr-xr-x", modTime: "2026-09-15 12:00", path: `${currentSFTPPath}/.vim` },
        { name: ".ssh", isDir: true, size: 4096, permissions: "drwx------", modTime: "2026-09-15 12:30", path: `${currentSFTPPath}/.ssh` },
        { name: ".pki", isDir: true, size: 4096, permissions: "drwx------", modTime: "2026-09-15 12:00", path: `${currentSFTPPath}/.pki` },
        { name: ".mozilla", isDir: true, size: 4096, permissions: "drwx------", modTime: "2026-09-15 12:00", path: `${currentSFTPPath}/.mozilla` },
        { name: ".local", isDir: true, size: 4096, permissions: "drwxr-xr-x", modTime: "2026-09-15 12:00", path: `${currentSFTPPath}/.local` },
        { name: ".java", isDir: true, size: 4096, permissions: "drwxr-xr-x", modTime: "2026-09-15 12:00", path: `${currentSFTPPath}/.java` },
        { name: ".dbus", isDir: true, size: 4096, permissions: "drwx------", modTime: "2026-09-15 12:00", path: `${currentSFTPPath}/.dbus` },
        { name: ".config", isDir: true, size: 4096, permissions: "drwxr-xr-x", modTime: "2026-09-15 12:00", path: `${currentSFTPPath}/.config` },
        { name: ".cache", isDir: true, size: 4096, permissions: "drwx------", modTime: "2026-09-15 12:00", path: `${currentSFTPPath}/.cache` },
        { name: "Infranet.properties", isDir: false, size: 1024, permissions: "-rw-r--r--", modTime: "2026-09-15 14:00", path: `${currentSFTPPath}/Infranet.properties` },
        { name: "default.pinlog", isDir: false, size: 1024, permissions: "-rw-r--r--", modTime: "2026-09-15 14:05", path: `${currentSFTPPath}/default.pinlog` },
        { name: "dead.letter", isDir: false, size: 1024, permissions: "-rw-r--r--", modTime: "2026-09-15 14:10", path: `${currentSFTPPath}/dead.letter` },
        { name: ".Xauthority", isDir: false, size: 1024, permissions: "-rw-------", modTime: "2026-09-15 14:12", path: `${currentSFTPPath}/.Xauthority` },
        { name: ".wget-hsts", isDir: false, size: 1024, permissions: "-rw-------", modTime: "2026-09-15 14:15", path: `${currentSFTPPath}/.wget-hsts` }
      ];
      renderSFTPItems(sftpCurrentItems, currentSFTPPath);
      if (renderConnectedServersCallback) {
        renderConnectedServersCallback();
      }
    }
  } catch (err) {
    fileListEl.innerHTML = `<div class="sftp-empty-hint" style="color: var(--accent-red); padding: 16px 12px; line-height: 1.5;">
      ⚠️ SFTP Listing failed for <b>${escapeHtml(path)}</b>:<br>
      <span style="font-size: 11px; opacity: 0.85;">${escapeHtml(err.toString())}</span><br><br>
      <button class="btn-primary" style="font-size: 11px; padding: 4px 10px; cursor: pointer;" id="sftpRetryHomeBtn">↻ Open Home Directory (~)</button>
    </div>`;
    const retryBtn = document.getElementById("sftpRetryHomeBtn");
    if (retryBtn) {
      retryBtn.onclick = () => refreshSFTP('~');
    }
  }
}

export function updateRecentPathsDropdown() {
  const container = document.getElementById("sftpRecentPathsContainer");
  if (!container) return;
  container.innerHTML = "";
  const uniqueRecents = recentSFTPPaths.filter(p => !["/", "~", "/opt", "/etc", "/var/log", "/tmp", "/home"].includes(p));
  if (uniqueRecents.length > 0) {
    const sep = document.createElement("div");
    sep.style.cssText = "border-top: 1px solid #38383e; margin: 4px 0;";
    container.appendChild(sep);
    uniqueRecents.slice(0, 8).forEach(p => {
      const item = document.createElement("div");
      item.className = "moba-path-item";
      item.dataset.path = p;
      item.textContent = p;
      item.onclick = () => {
        closeSFTPPathDropdown();
        refreshSFTP(p);
      };
      container.appendChild(item);
    });
  }
}

export function closeSFTPPathDropdown() {
  const menu = document.getElementById("sftpPathDropdownMenu");
  if (menu) menu.classList.add("hidden");
}

export function toggleSFTPPathDropdown() {
  const menu = document.getElementById("sftpPathDropdownMenu");
  if (menu) menu.classList.toggle("hidden");
}

export function renderSFTPItems(items, path = currentSFTPPath) {
  const fileListEl = document.getElementById("sftpFileList");
  const badge = document.getElementById("sftpCountBadge");
  if (!fileListEl) return;

  // Filter hidden files if toggled off
  let filteredItems = [...items];
  if (!showHiddenSFTPFiles) {
    filteredItems = filteredItems.filter(i => !i.name.startsWith("."));
  }

  // Sort items
  filteredItems.sort((a, b) => {
    if (a.isDir !== b.isDir) {
      return a.isDir ? -1 : 1;
    }
    if (sftpSortColumn === "size") {
      const diff = (a.size || 0) - (b.size || 0);
      return sftpSortOrder === "asc" ? diff : -diff;
    } else {
      const cmp = (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base" });
      return sftpSortOrder === "asc" ? cmp : -cmp;
    }
  });

  const dCount = filteredItems.filter(i => i.isDir).length;
  const fCount = filteredItems.filter(i => !i.isDir).length;
  if (badge) {
    badge.textContent = `${filteredItems.length} items (${dCount} dirs, ${fCount} files)`;
  }

  fileListEl.innerHTML = "";

  // 1. Parent Directory row `..` if not at root
  if (path && path !== "/" && path !== "") {
    const parentRow = document.createElement("div");
    parentRow.className = "moba-file-row moba-parent-row";
    parentRow.title = "Go to parent directory (Click or Double-click)";
    parentRow.innerHTML = `
      <div class="moba-row-left">
        <span class="moba-row-icon">
          <svg width="15" height="15" viewBox="0 0 16 16"><rect width="16" height="16" rx="2" fill="#86efac"/><path d="M11 11V7a2 2 0 0 0-2-2H5m0 0l2.5-2.5M5 5l2.5 2.5" stroke="#166534" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </span>
        <span class="moba-row-name" style="font-weight: bold; color: #a7f3d0;">..</span>
      </div>
      <span class="moba-row-size"></span>
    `;
    parentRow.addEventListener("click", (e) => {
      e.stopPropagation();
      goSFTPParentDirectory();
    });
    parentRow.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      goSFTPParentDirectory();
    });
    fileListEl.appendChild(parentRow);
  }

  if (filteredItems.length === 0) {
    const emptyEl = document.createElement("div");
    emptyEl.className = "sftp-empty-hint";
    emptyEl.textContent = "Directory is empty";
    fileListEl.appendChild(emptyEl);
    return;
  }

  filteredItems.forEach(item => {
    const row = document.createElement("div");
    const isSelected = selectedSFTPItem && selectedSFTPItem.path === item.path;
    row.className = `moba-file-row ${isSelected ? 'selected' : ''} ${item.isDir ? 'is-dir' : 'is-file'}`;
    row.dataset.path = item.path;
    row.dataset.isDir = item.isDir;

    const iconSvg = getMobaFileIcon(item);
    const sizeFormatted = formatMobaSize(item.size, item.isDir);
    const tooltip = `${item.path}\nSize: ${item.formattedSize || (item.size + ' B')}\nPermissions: ${item.permissions || 'N/A'}\nModified: ${item.modTime || 'N/A'}`;

    row.innerHTML = `
      <div class="moba-row-left" title="${escapeHtml(tooltip)}">
        <span class="moba-row-icon">${iconSvg}</span>
        <span class="moba-row-name">${escapeHtml(item.name)}</span>
      </div>
      <span class="moba-row-size">${escapeHtml(sizeFormatted)}</span>
    `;

    // Click on row
    row.addEventListener("click", async (e) => {
      e.stopPropagation();
      const wasSelected = selectedSFTPItem && selectedSFTPItem.path === item.path;
      selectedSFTPItem = item;
      fileListEl.querySelectorAll(".moba-file-row").forEach(r => r.classList.remove("selected"));
      row.classList.add("selected");

      // Clicking folder icon or re-clicking selected folder navigates into it
      if (item.isDir && (e.target.closest(".moba-row-icon") || wasSelected)) {
        selectedSFTPItem = null;
        await refreshSFTP(item.path);
      }
    });

    // Double Click -> Open in NexTerm Text Editor
    row.addEventListener("dblclick", async (e) => {
      e.stopPropagation();
      if (item.isDir) {
        selectedSFTPItem = null;
        await refreshSFTP(item.path);
      } else {
        openRemoteFileEditor(item.path);
      }
    });

    // Right Click -> Context Menu
    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      selectedSFTPItem = item;
      fileListEl.querySelectorAll(".moba-file-row").forEach(r => r.classList.remove("selected"));
      row.classList.add("selected");
      showSFTPContextMenu(e.clientX, e.clientY, item);
    });

    fileListEl.appendChild(row);
  });
}

// ==========================================================================
// Dual Pane SFTP Manager (Embedded split pane below terminal)
// ==========================================================================

export function setupDualPaneSFTP(tabId, profile, paneEl, fitAddon, term) {
  const localListEl = paneEl.querySelector(`#sftpLocalList_${tabId}`);
  const remoteListEl = paneEl.querySelector(`#sftpRemoteList_${tabId}`);
  const localPathInput = paneEl.querySelector(`#sftpLocalPath_${tabId}`);
  const remotePathInput = paneEl.querySelector(`#sftpRemotePath_${tabId}`);
  const driveSelect = paneEl.querySelector(`#sftpDriveSel_${tabId}`);
  const splitHandle = paneEl.querySelector(`#splitHandle_${tabId}`);
  const sftpBottom = paneEl.querySelector(`#sftpBottom_${tabId}`);
  const toggleBtn = paneEl.querySelector(`#sftpToggleBtn_${tabId}`);
  const uploadBtn = paneEl.querySelector(`#sftpUploadBtn_${tabId}`);
  const downloadBtn = paneEl.querySelector(`#sftpDownloadBtn_${tabId}`);

  let curLocalPath = "";
  let curRemotePath = profile.initialDir || "~";
  let selectedLocalItem = null;
  let selectedRemoteItem = null;
  let localItems = [];
  let remoteItems = [];

  // Toggle button for SFTP dual pane
  if (toggleBtn && sftpBottom) {
    toggleBtn.onclick = (e) => {
      e.stopPropagation();
      sftpBottom.classList.toggle("is-collapsed");
      const collapsed = sftpBottom.classList.contains("is-collapsed");
      toggleBtn.innerHTML = collapsed
        ? `<span class="split-icon">📂</span> Show SFTP Dual File Manager`
        : `<span class="split-icon">📂</span> SFTP Dual File Manager`;
      setTimeout(() => {
        if (fitAddon) fitAddon.fit();
      }, 50);
    };
  }

  // Split resize handle
  if (splitHandle && sftpBottom) {
    let isDragging = false;
    let startY = 0;
    let startH = 0;

    splitHandle.onmousedown = (e) => {
      if (e.target === toggleBtn || (toggleBtn && toggleBtn.contains(e.target))) return;
      isDragging = true;
      startY = e.clientY;
      startH = sftpBottom.offsetHeight;
      document.body.style.cursor = "row-resize";
      e.preventDefault();
    };

    window.addEventListener("mousemove", (e) => {
      if (!isDragging) return;
      const deltaY = startY - e.clientY;
      const newH = Math.max(100, Math.min(window.innerHeight * 0.75, startH + deltaY));
      sftpBottom.style.height = `${newH}px`;
      if (fitAddon) fitAddon.fit();
    });

    window.addEventListener("mouseup", () => {
      if (isDragging) {
        isDragging = false;
        document.body.style.cursor = "";
        if (fitAddon) fitAddon.fit();
      }
    });
  }

  // Drives initialization
  async function loadDrives() {
    if (!driveSelect) return;
    try {
      if (window.go && window.go.main && window.go.main.App && window.go.main.App.SFTPGetLocalDrives) {
        const drives = await window.go.main.App.SFTPGetLocalDrives();
        driveSelect.innerHTML = "";
        drives.forEach(d => {
          const opt = document.createElement("option");
          opt.value = d;
          opt.textContent = d;
          driveSelect.appendChild(opt);
        });
      }
    } catch (_) {}
  }

  if (driveSelect) {
    driveSelect.onchange = () => {
      curLocalPath = driveSelect.value;
      loadLocalList(curLocalPath);
    };
  }

  // Load Local Files
  async function loadLocalList(targetPath) {
    if (!localListEl) return;
    localListEl.innerHTML = `<div style="color: #64748b; padding: 12px; font-size: 11px;">Loading local files...</div>`;
    selectedLocalItem = null;

    try {
      if (window.go && window.go.main && window.go.main.App && window.go.main.App.SFTPListLocal) {
        const res = await window.go.main.App.SFTPListLocal(targetPath || curLocalPath);
        if (!res) return;
        curLocalPath = res.path;
        if (localPathInput) localPathInput.value = curLocalPath;
        localItems = res.items || [];
        renderLocalTable();
      }
    } catch (err) {
      localListEl.innerHTML = `<div style="color: #ef4444; padding: 10px; font-size: 11px;">Error: ${escapeHtml(err)}</div>`;
    }
  }

  function renderLocalTable() {
    localListEl.innerHTML = "";

    // Parent directory row `..`
    const parentRow = document.createElement("div");
    parentRow.className = "sftp-row";
    parentRow.innerHTML = `
      <div class="col-name" style="color: #a7f3d0; font-weight: 700;">
        <span class="file-icon">📁</span>
        <span>..</span>
      </div>
      <div class="col-size"></div>
      <div class="col-date"></div>
    `;
    parentRow.ondblclick = () => {
      const parent = curLocalPath.substring(0, Math.max(curLocalPath.lastIndexOf("\\"), curLocalPath.lastIndexOf("/")));
      if (parent) loadLocalList(parent);
      else loadLocalList(curLocalPath.substring(0, 3));
    };
    localListEl.appendChild(parentRow);

    if (localItems.length === 0) {
      const empty = document.createElement("div");
      empty.style.cssText = "color: #64748b; padding: 12px; font-size: 11px; text-align: center;";
      empty.textContent = "Folder is empty";
      localListEl.appendChild(empty);
      return;
    }

    localItems.forEach(item => {
      const row = document.createElement("div");
      row.className = `sftp-row ${selectedLocalItem && selectedLocalItem.path === item.path ? 'selected' : ''}`;
      row.draggable = true;
      row.ondragstart = (e) => {
        e.dataTransfer.setData("text/plain", JSON.stringify({ type: "local", path: item.path, name: item.name }));
      };

      row.innerHTML = `
        <div class="col-name">
          <span class="file-icon">${item.isDir ? '📁' : '📄'}</span>
          <span>${escapeHtml(item.name)}</span>
        </div>
        <div class="col-size">${escapeHtml(item.formattedSize || '')}</div>
        <div class="col-date">${escapeHtml(item.modTime || '')}</div>
      `;

      row.onclick = () => {
        selectedLocalItem = item;
        localListEl.querySelectorAll(".sftp-row").forEach(r => r.classList.remove("selected"));
        row.classList.add("selected");
      };

      row.ondblclick = () => {
        if (item.isDir) {
          loadLocalList(item.path);
        } else {
          if (confirm(`Upload "${item.name}" to remote server folder (${curRemotePath})?`)) {
            triggerUpload(item.path);
          }
        }
      };

      localListEl.appendChild(row);
    });
  }

  // Load Remote Files
  async function loadRemoteList(targetPath) {
    if (!remoteListEl) return;
    remoteListEl.innerHTML = `<div style="color: #64748b; padding: 12px; font-size: 11px;">Loading remote files...</div>`;
    selectedRemoteItem = null;

    try {
      if (window.go && window.go.main && window.go.main.App && window.go.main.App.SFTPList) {
        const res = await window.go.main.App.SFTPList(tabId, targetPath || curRemotePath);
        if (!res) return;
        curRemotePath = res.path;
        if (remotePathInput) remotePathInput.value = curRemotePath;
        remoteItems = res.items || [];
        renderRemoteTable();

        if (tabs[tabId]) {
          tabs[tabId].sftpPath = curRemotePath;
        }
      }
    } catch (err) {
      remoteListEl.innerHTML = `<div style="color: #ef4444; padding: 10px; font-size: 11px;">Error: ${escapeHtml(err)}</div>`;
    }
  }

  function renderRemoteTable() {
    remoteListEl.innerHTML = "";

    // Parent directory row `..`
    if (curRemotePath !== "/" && curRemotePath !== "") {
      const parentRow = document.createElement("div");
      parentRow.className = "sftp-row";
      parentRow.innerHTML = `
        <div class="col-name" style="color: #4ade80; font-weight: 700;">
          <span class="file-icon">📁</span>
          <span>..</span>
        </div>
        <div class="col-size"></div>
        <div class="col-perm"></div>
        <div class="col-date"></div>
      `;
      parentRow.ondblclick = () => {
        const idx = curRemotePath.lastIndexOf("/");
        const parent = idx > 0 ? curRemotePath.substring(0, idx) : "/";
        loadRemoteList(parent);
      };
      remoteListEl.appendChild(parentRow);
    }

    if (remoteItems.length === 0) {
      const empty = document.createElement("div");
      empty.style.cssText = "color: #64748b; padding: 12px; font-size: 11px; text-align: center;";
      empty.textContent = "Directory is empty";
      remoteListEl.appendChild(empty);
      return;
    }

    remoteItems.forEach(item => {
      const row = document.createElement("div");
      row.className = `sftp-row ${selectedRemoteItem && selectedRemoteItem.path === item.path ? 'selected' : ''}`;
      row.draggable = true;
      row.ondragstart = (e) => {
        e.dataTransfer.setData("text/plain", JSON.stringify({ type: "remote", path: item.path, name: item.name }));
      };

      row.innerHTML = `
        <div class="col-name">
          <span class="file-icon">${item.isDir ? '📁' : '📄'}</span>
          <span>${escapeHtml(item.name)}</span>
        </div>
        <div class="col-size">${escapeHtml(item.formattedSize || '')}</div>
        <div class="col-perm">${escapeHtml(item.octalPerm || item.permissions || '')}</div>
        <div class="col-date">${escapeHtml(item.modTime || '')}</div>
      `;

      row.onclick = () => {
        selectedRemoteItem = item;
        remoteListEl.querySelectorAll(".sftp-row").forEach(r => r.classList.remove("selected"));
        row.classList.add("selected");
      };

      row.ondblclick = () => {
        if (item.isDir) {
          loadRemoteList(item.path);
        } else {
          openRemoteFileEditor(item.path);
        }
      };

      remoteListEl.appendChild(row);
    });
  }

  // Drag & Drop handlers
  if (remoteListEl) {
    remoteListEl.ondragover = (e) => e.preventDefault();
    remoteListEl.ondrop = (e) => {
      e.preventDefault();
      try {
        const d = JSON.parse(e.dataTransfer.getData("text/plain"));
        if (d && d.type === "local") {
          triggerUpload(d.path);
        }
      } catch (_) {}
    };
  }

  if (localListEl) {
    localListEl.ondragover = (e) => e.preventDefault();
    localListEl.ondrop = (e) => {
      e.preventDefault();
      try {
        const d = JSON.parse(e.dataTransfer.getData("text/plain"));
        if (d && d.type === "remote") {
          triggerDownload(d.path);
        }
      } catch (_) {}
    };
  }

  // Upload helper
  async function triggerUpload(srcPath) {
    const p = srcPath || (selectedLocalItem ? selectedLocalItem.path : null);
    if (!p) {
      showToast("Please select a local file or folder to upload", "warning");
      return;
    }
    showToast(`Uploading ${p} ➔ ${curRemotePath}...`, "info");
    try {
      if (window.go && window.go.main && window.go.main.App) {
        await window.go.main.App.SFTPUpload(tabId, p, curRemotePath);
        showToast("Upload completed successfully", "success");
        loadRemoteList(curRemotePath);
        refreshSFTP();
      }
    } catch (err) {
      showToast(`Upload failed: ${err}`, "error");
    }
  }

  // Download helper
  async function triggerDownload(srcPath) {
    const p = srcPath || (selectedRemoteItem ? selectedRemoteItem.path : null);
    if (!p) {
      showToast("Please select a remote file or folder to download", "warning");
      return;
    }
    showToast(`Downloading ${p} ➔ ${curLocalPath}...`, "info");
    try {
      if (window.go && window.go.main && window.go.main.App) {
        await window.go.main.App.SFTPDownload(tabId, p, curLocalPath);
        showToast("Download completed successfully", "success");
        loadLocalList(curLocalPath);
      }
    } catch (err) {
      showToast(`Download failed: ${err}`, "error");
    }
  }

  if (uploadBtn) uploadBtn.onclick = () => triggerUpload();
  if (downloadBtn) downloadBtn.onclick = () => triggerDownload();

  // Local Path Input Enter key
  if (localPathInput) {
    localPathInput.onkeydown = (e) => {
      if (e.key === "Enter") loadLocalList(localPathInput.value.trim());
    };
  }

  // Remote Path Input Enter key
  if (remotePathInput) {
    remotePathInput.onkeydown = (e) => {
      if (e.key === "Enter") loadRemoteList(remotePathInput.value.trim());
    };
  }

  // Local Action buttons
  const btnLocalUp = paneEl.querySelector(`#sftpLocalUp_${tabId}`);
  if (btnLocalUp) {
    btnLocalUp.onclick = () => {
      const parent = curLocalPath.substring(0, Math.max(curLocalPath.lastIndexOf("\\"), curLocalPath.lastIndexOf("/")));
      if (parent) loadLocalList(parent);
    };
  }

  const btnLocalRef = paneEl.querySelector(`#sftpLocalRefresh_${tabId}`);
  if (btnLocalRef) btnLocalRef.onclick = () => loadLocalList(curLocalPath);

  const btnLocalMkdir = paneEl.querySelector(`#sftpLocalMkdir_${tabId}`);
  if (btnLocalMkdir) {
    btnLocalMkdir.onclick = async () => {
      const name = prompt("Enter new local folder name:");
      if (!name) return;
      try {
        const full = `${curLocalPath}\\${name}`;
        await window.go.main.App.SFTPMkdirLocal(full);
        showToast(`Created folder ${name}`, "success");
        loadLocalList(curLocalPath);
      } catch (err) {
        showToast(`Failed: ${err}`, "error");
      }
    };
  }

  const btnLocalMkfile = paneEl.querySelector(`#sftpLocalMkfile_${tabId}`);
  if (btnLocalMkfile) {
    btnLocalMkfile.onclick = async () => {
      const name = prompt("Enter new local file name:");
      if (!name) return;
      try {
        const full = `${curLocalPath}\\${name}`;
        await window.go.main.App.SFTPCreateFileLocal(full);
        showToast(`Created file ${name}`, "success");
        loadLocalList(curLocalPath);
      } catch (err) {
        showToast(`Failed: ${err}`, "error");
      }
    };
  }

  const btnLocalDel = paneEl.querySelector(`#sftpLocalDel_${tabId}`);
  if (btnLocalDel) {
    btnLocalDel.onclick = async () => {
      if (!selectedLocalItem) {
        showToast("Select a local file or folder to delete", "warning");
        return;
      }
      if (confirm(`Delete local "${selectedLocalItem.name}"?`)) {
        try {
          await window.go.main.App.SFTPDeleteLocal(selectedLocalItem.path);
          showToast(`Deleted ${selectedLocalItem.name}`, "info");
          loadLocalList(curLocalPath);
        } catch (err) {
          showToast(`Delete failed: ${err}`, "error");
        }
      }
    };
  }

  // Remote Action buttons
  const btnRemoteUp = paneEl.querySelector(`#sftpRemoteUp_${tabId}`);
  if (btnRemoteUp) {
    btnRemoteUp.onclick = () => {
      const idx = curRemotePath.lastIndexOf("/");
      const parent = idx > 0 ? curRemotePath.substring(0, idx) : "/";
      loadRemoteList(parent);
    };
  }

  const btnRemoteRef = paneEl.querySelector(`#sftpRemoteRefresh_${tabId}`);
  if (btnRemoteRef) btnRemoteRef.onclick = () => loadRemoteList(curRemotePath);

  const btnRemoteMkdir = paneEl.querySelector(`#sftpRemoteMkdir_${tabId}`);
  if (btnRemoteMkdir) {
    btnRemoteMkdir.onclick = async () => {
      const name = prompt("Enter new remote folder name:");
      if (!name) return;
      try {
        const full = `${curRemotePath === '/' ? '' : curRemotePath}/${name}`;
        await window.go.main.App.SFTPMkdir(tabId, full);
        showToast(`Created remote folder ${name}`, "success");
        loadRemoteList(curRemotePath);
      } catch (err) {
        showToast(`Failed: ${err}`, "error");
      }
    };
  }

  const btnRemoteMkfile = paneEl.querySelector(`#sftpRemoteMkfile_${tabId}`);
  if (btnRemoteMkfile) {
    btnRemoteMkfile.onclick = async () => {
      const name = prompt("Enter new remote file name:");
      if (!name) return;
      try {
        const full = `${curRemotePath === '/' ? '' : curRemotePath}/${name}`;
        await window.go.main.App.SFTPCreateFile(tabId, full);
        showToast(`Created remote file ${name}`, "success");
        loadRemoteList(curRemotePath);
      } catch (err) {
        showToast(`Failed: ${err}`, "error");
      }
    };
  }

  const btnRemoteEdit = paneEl.querySelector(`#sftpRemoteEdit_${tabId}`);
  if (btnRemoteEdit) {
    btnRemoteEdit.onclick = () => {
      if (!selectedRemoteItem || selectedRemoteItem.isDir) {
        showToast("Select a remote file to edit", "warning");
        return;
      }
      openRemoteFileEditor(selectedRemoteItem.path);
    };
  }

  const btnRemoteChmod = paneEl.querySelector(`#sftpRemoteChmod_${tabId}`);
  if (btnRemoteChmod) {
    btnRemoteChmod.onclick = () => {
      if (!selectedRemoteItem) {
        showToast("Select a remote file or folder to change permissions", "warning");
        return;
      }
      openChmodModal(tabId, selectedRemoteItem);
    };
  }

  const btnRemoteDel = paneEl.querySelector(`#sftpRemoteDel_${tabId}`);
  if (btnRemoteDel) {
    btnRemoteDel.onclick = async () => {
      if (!selectedRemoteItem) {
        showToast("Select a remote file or folder to delete", "warning");
        return;
      }
      if (confirm(`Delete remote "${selectedRemoteItem.name}"?`)) {
        try {
          await window.go.main.App.SFTPDelete(tabId, selectedRemoteItem.path);
          showToast(`Deleted ${selectedRemoteItem.name}`, "info");
          loadRemoteList(curRemotePath);
        } catch (err) {
          showToast(`Delete failed: ${err}`, "error");
        }
      }
    };
  }

  // Register in tabs dictionary
  if (tabs[tabId]) {
    tabs[tabId].refreshRemoteList = () => loadRemoteList(curRemotePath);
    tabs[tabId].refreshLocalList = () => loadLocalList(curLocalPath);
    tabs[tabId].loadRemoteList = loadRemoteList;
  }

  // Initial loads
  loadDrives();
  loadLocalList();
  setTimeout(() => loadRemoteList(curRemotePath), 400);
}

// Hook up delegates
registerSFTPRefresh(refreshSFTP);
registerFileBrowserSFTPRefresh(refreshSFTP);
registerDualPaneSFTP(setupDualPaneSFTP);
