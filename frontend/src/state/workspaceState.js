// ==========================================================================
// Nexterm — Workspace & Split Panes Subsystem
// Manages multi-pane layouts (single, vertical, horizontal, 2-top-1-bot, grid-4),
// tab distribution among panes, resizing, and maximizing.
// ==========================================================================

import { getTabs } from "./tabState.js";
import { getStateDotClass, getStateTooltip, getEnvironmentInfo, applyTabVisuals } from "./tabState.js";
import { escapeHtml, showToast } from "../ui/notifications.js";

export const workspaceState = {
  layout: "single", // "single", "split-v", "split-h", "2-top-1-bot", "1-top-2-bot", "grid-4", "3-cols"
  activePaneId: "pane-1",
  panes: [
    {
      id: "pane-1",
      title: "Terminal 1",
      activeTabId: null,
      tabIds: [],
      maximized: false
    }
  ]
};

let activateTabFn = null;
let closeTabFn = null;
let showNewSessionDialogFn = null;
let showTabContextMenuFn = null;
let activateHomeTabFn = null;

export function registerWorkspaceTabActions(handlers) {
  if (handlers.activateTab) activateTabFn = handlers.activateTab;
  if (handlers.closeTab) closeTabFn = handlers.closeTab;
  if (handlers.showNewSessionDialog) showNewSessionDialogFn = handlers.showNewSessionDialog;
  if (handlers.showTabContextMenu) showTabContextMenuFn = handlers.showTabContextMenu;
  if (handlers.activateHomeTab) activateHomeTabFn = handlers.activateHomeTab;
}

export function getWorkspaceState() {
  return workspaceState;
}

export function getWorkspaceLayout() {
  return workspaceState.layout || "single";
}

export function initWorkspace() {
  renderWorkspace();
  if (window.go && window.go.main && window.go.main.App) {
    window.go.main.App.GetWorkspace().then(ws => {
      if (ws && ws.panes && ws.panes.length > 0) {
        workspaceState.layout = ws.layout || "single";
        workspaceState.activePaneId = ws.activePaneId || "pane-1";
        renderWorkspace();
      }
    }).catch(() => {});
  }
}

export function getActiveWorkspacePane() {
  let p = workspaceState.panes.find(p => p.id === workspaceState.activePaneId);
  if (!p && workspaceState.panes.length > 0) {
    p = workspaceState.panes[0];
    workspaceState.activePaneId = p.id;
  }
  if (!p) {
    p = { id: "pane-1", title: "Terminal 1", activeTabId: null, tabIds: [], maximized: false };
    workspaceState.panes = [p];
    workspaceState.activePaneId = p.id;
  }
  return p;
}

export function setActiveWorkspacePane(paneId) {
  workspaceState.activePaneId = paneId;
  if (window.go && window.go.main && window.go.main.App) {
    window.go.main.App.FocusWorkspacePane(paneId).catch(() => {});
  }
  updateWorkspacePaneActiveClasses();
}

export function updateWorkspacePaneActiveClasses() {
  document.querySelectorAll(".workspace-pane").forEach(el => {
    const isAct = el.dataset.paneId === workspaceState.activePaneId;
    el.classList.toggle("active", isAct);
  });
}

export function getLayoutDisplayName(layout) {
  switch (layout) {
    case "single": return "1 Terminal (Single)";
    case "split-v": return "2 Terminals Vertical";
    case "split-h": return "2 Terminals Horizontal";
    case "2-top-1-bot": return "2 Top + 1 Bottom Wide";
    case "1-top-2-bot": return "1 Top Wide + 2 Bottom";
    case "grid-4": return "4 Terminals (2x2 Grid)";
    case "3-cols": return "3 Columns Vertical";
    default: return layout;
  }
}

export function setSplitMode(layout) {
  workspaceState.layout = layout;
  let needed = 1;
  if (layout === "split-v" || layout === "split-h") needed = 2;
  else if (layout === "2-top-1-bot" || layout === "1-top-2-bot" || layout === "3-cols") needed = 3;
  else if (layout === "grid-4") needed = 4;

  while (workspaceState.panes.length < needed) {
    const nextIdx = workspaceState.panes.length + 1;
    workspaceState.panes.push({
      id: `pane-${nextIdx}`,
      title: `Terminal ${nextIdx}`,
      activeTabId: null,
      tabIds: [],
      maximized: false
    });
  }

  // Un-maximize any maximized panes
  workspaceState.panes.forEach(p => p.maximized = false);

  if (window.go && window.go.main && window.go.main.App) {
    window.go.main.App.SetWorkspaceLayout(layout).catch(() => {});
  }

  renderWorkspace();
  showToast(`Layout switched to: ${getLayoutDisplayName(layout)}`, "info");
  refitAllTerminals();
}

export function renderWorkspace() {
  const panesEl = document.getElementById("panes");
  if (!panesEl) return;

  panesEl.className = "panes layout-" + (workspaceState.layout || "single");

  // Determine which panes to show based on layout
  let visibleLimit = 1;
  if (workspaceState.layout === "split-v" || workspaceState.layout === "split-h") visibleLimit = 2;
  else if (workspaceState.layout === "2-top-1-bot" || workspaceState.layout === "1-top-2-bot" || workspaceState.layout === "3-cols") visibleLimit = 3;
  else if (workspaceState.layout === "grid-4") visibleLimit = 4;

  const visiblePanes = workspaceState.panes.slice(0, visibleLimit);
  const tabs = getTabs();

  // Single-layer header rule: when the workspace is split into multiple panes,
  // each pane draws its own header (server name + split/maximize/close controls),
  // so the global top tab bar would be a redundant second layer. Hide the global
  // tab bar in multi-pane layouts and show it only in single-pane mode. This
  // keeps exactly ONE header layer on screen at all times.
  const tabbarContainer = document.getElementById("tabbarContainer");
  if (tabbarContainer) {
    tabbarContainer.style.display = visiblePanes.length > 1 ? "none" : "";
  }

  // Remove stale pane DOM elements
  const existingDomPanes = Array.from(panesEl.querySelectorAll(".workspace-pane"));
  existingDomPanes.forEach(domP => {
    const pid = domP.dataset.paneId;
    if (!visiblePanes.find(p => p.id === pid)) {
      domP.remove();
    }
  });

  visiblePanes.forEach((pane, idx) => {
    let domPane = panesEl.querySelector(`.workspace-pane[data-pane-id="${pane.id}"]`);
    if (!domPane) {
      domPane = document.createElement("div");
      domPane.className = "workspace-pane";
      domPane.dataset.paneId = pane.id;
      domPane.innerHTML = `
        <div class="workspace-pane-header">
          <div class="pane-tab-strip"></div>
          <div class="pane-header-actions">
            <button class="pane-tool-btn" data-action="split-right" title="Split Right (Ctrl+Shift+E)">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"></rect><line x1="12" y1="3" x2="12" y2="21"></line></svg>
            </button>
            <button class="pane-tool-btn" data-action="split-down" title="Split Down (Ctrl+Shift+O)">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"></rect><line x1="3" y1="12" x2="21" y2="12"></line></svg>
            </button>
            <button class="pane-tool-btn" data-action="maximize" title="Maximize / Restore Pane">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>
            </button>
            <button class="pane-tool-btn pane-close-btn" data-action="close" title="Close Pane">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
          </div>
        </div>
        <div class="workspace-pane-body"></div>
      `;

      domPane.addEventListener("mousedown", () => {
        setActiveWorkspacePane(pane.id);
      });

      // Action buttons
      const btnSplitRight = domPane.querySelector('[data-action="split-right"]');
      if (btnSplitRight) {
        btnSplitRight.onclick = (e) => {
          e.stopPropagation();
          splitPane(pane.id, "right");
        };
      }
      const btnSplitDown = domPane.querySelector('[data-action="split-down"]');
      if (btnSplitDown) {
        btnSplitDown.onclick = (e) => {
          e.stopPropagation();
          splitPane(pane.id, "down");
        };
      }
      const btnMaximize = domPane.querySelector('[data-action="maximize"]');
      if (btnMaximize) {
        btnMaximize.onclick = (e) => {
          e.stopPropagation();
          toggleMaximizePane(pane.id);
        };
      }
      const btnClose = domPane.querySelector('[data-action="close"]');
      if (btnClose) {
        btnClose.onclick = (e) => {
          e.stopPropagation();
          closePane(pane.id);
        };
      }

      // Drag & Drop tab drop target on pane
      domPane.addEventListener("dragover", (e) => {
        if (e.dataTransfer.types.includes("application/x-nexterm-tab")) {
          e.preventDefault();
          domPane.classList.add("pane-drop-target");
        }
      });
      domPane.addEventListener("dragleave", () => {
        domPane.classList.remove("pane-drop-target");
      });
      domPane.addEventListener("drop", (e) => {
        domPane.classList.remove("pane-drop-target");
        const movedTabId = e.dataTransfer.getData("application/x-nexterm-tab");
        if (movedTabId) {
          e.preventDefault();
          moveTabToPane(movedTabId, pane.id);
        }
      });

      panesEl.appendChild(domPane);
    }

    // Set classes
    domPane.classList.toggle("active", pane.id === workspaceState.activePaneId);
    domPane.classList.toggle("maximized", !!pane.maximized);

    // Single Active Tab Guarantee: In single-pane mode, hide nested pane header to avoid duplicate tabs
    const headerEl = domPane.querySelector(".workspace-pane-header");
    if (headerEl) {
      headerEl.style.display = visiblePanes.length > 1 ? "flex" : "none";
    }

    // Render Tab Strip (multi-pane mode)
    const stripEl = domPane.querySelector(".pane-tab-strip");
    if (stripEl) {
      stripEl.innerHTML = "";

      pane.tabIds.forEach(tId => {
        const tabObj = tabs[tId];
        if (!tabObj) return;

        const env = getEnvironmentInfo(tabObj.environment || tabObj.profile?.environment || tabObj.color || tabObj.profile?.color);
        const customColor = tabObj.color || tabObj.profile?.color || (env ? env.color : "");

        const itemEl = document.createElement("div");
        itemEl.className = `pane-tab-item ${tId === pane.activeTabId ? 'active' : ''} ${customColor ? 'has-custom-color' : ''}`;
        itemEl.dataset.tabId = tId;
        itemEl.draggable = true;
        if (customColor) {
          itemEl.style.setProperty("--tab-accent-color", customColor);
        }
        const pDotClass = getStateDotClass(tabObj);
        const pTooltip = getStateTooltip(tabObj);
        const srvName = tabObj.customTitle || tabObj.remoteHostname || ((tabObj.profile?.name && tabObj.profile.name !== "New Server" && tabObj.profile.name !== "New Session") ? tabObj.profile.name : (tabObj.profile?.host ? (tabObj.profile.username ? `${tabObj.profile.username}@${tabObj.profile.host}` : tabObj.profile.host) : (tabObj.isLocal ? "Local Terminal" : "Terminal")));
        const serialNo = tabObj.serialNo || 1;
        const displayName = `[${serialNo}] ${srvName}`;
        itemEl.title = `${displayName} (${pTooltip})${env ? ` [${env.name}]` : ''}`;
        
        const envBadgeHtml = env ? `<span class="tab-env-badge env-${env.key}" style="color:${env.color}; background:${env.bg}; border-color:${env.border};" title="Environment: ${env.name}">${env.label}</span>` : '';
        const pinBadgeHtml = tabObj.pinned ? `<span class="tab-pin-badge" title="Pinned Tab">📌</span>` : '';
        const isNotif = tabObj.notificationState && tabObj.notificationState.active;

        itemEl.innerHTML = `
          <span class="pane-tab-dot ${pDotClass}" title="${escapeHtml(pTooltip)}"></span>
          ${pinBadgeHtml}
          <span class="pane-tab-title" title="${escapeHtml(displayName)}"><span class="tab-serial">[${serialNo}] </span>${escapeHtml(srvName)}</span>
          ${envBadgeHtml}
          <span class="tab-notify-dot" title="Attention / Notification" style="display:${isNotif ? 'inline-flex' : 'none'};">•</span>
          <span class="pane-tab-dropdown-btn" title="Server Options & Color">▾</span>
          <span class="pane-tab-close" title="Close Tab">&times;</span>
        `;

        itemEl.onclick = (e) => {
          e.stopPropagation();
          setActiveWorkspacePane(pane.id);
          if (activateTabFn) activateTabFn(tId);
        };

        const dropdownBtn = itemEl.querySelector(".pane-tab-dropdown-btn");
        if (dropdownBtn) {
          dropdownBtn.onclick = (e) => {
            e.stopPropagation();
            const rect = dropdownBtn.getBoundingClientRect();
            if (showTabContextMenuFn) showTabContextMenuFn(rect.left, rect.bottom + 4, tId);
          };
        }

        itemEl.oncontextmenu = (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (showTabContextMenuFn) showTabContextMenuFn(e.clientX, e.clientY, tId);
        };

        const closeBtn = itemEl.querySelector(".pane-tab-close");
        if (closeBtn) {
          closeBtn.onclick = (e) => {
            e.stopPropagation();
            if (closeTabFn) closeTabFn(tId);
          };
        }

        itemEl.addEventListener("dragstart", (e) => {
          if (e.dataTransfer) e.dataTransfer.setData("application/x-nexterm-tab", tId);
        });

        stripEl.appendChild(itemEl);
      });

      const addTabBtn = document.createElement("button");
      addTabBtn.className = "pane-add-tab-btn";
      addTabBtn.title = "Add Server / New Session";
      addTabBtn.textContent = "＋";
      addTabBtn.onclick = (e) => {
        e.stopPropagation();
        setActiveWorkspacePane(pane.id);
        if (showNewSessionDialogFn) {
          showNewSessionDialogFn();
        } else if (activateHomeTabFn) {
          activateHomeTabFn();
        } else if (activateTabFn) {
          activateTabFn("home");
        }
      };
      stripEl.appendChild(addTabBtn);
    }

    // Render Pane Body
    const bodyEl = domPane.querySelector(".workspace-pane-body");
    if (bodyEl) {
      // Detach any other tab paneEls
      Array.from(bodyEl.children).forEach(child => {
        if (child.classList.contains("terminal-pane") && child.dataset.tabId !== pane.activeTabId) {
          child.classList.remove("active");
          child.remove();
        }
      });

      if (pane.activeTabId && tabs[pane.activeTabId]) {
        const activeTabObj = tabs[pane.activeTabId];
        if (!bodyEl.contains(activeTabObj.paneEl)) {
          bodyEl.appendChild(activeTabObj.paneEl);
        }
        activeTabObj.paneEl.classList.add("active");
        const emptyHint = bodyEl.querySelector(".pane-empty-placeholder");
        if (emptyHint) emptyHint.remove();
      } else {
        let emptyHint = bodyEl.querySelector(".pane-empty-placeholder");
        if (!emptyHint) {
          emptyHint = document.createElement("div");
          emptyHint.className = "pane-empty-placeholder";
          emptyHint.innerHTML = `
            <div class="empty-icon">🖥️</div>
            <div>${escapeHtml(pane.title || `Terminal ${idx+1}`)}</div>
            <button class="btn-empty-connect" type="button">＋ Connect Session</button>
          `;
          const connectBtn = emptyHint.querySelector(".btn-empty-connect");
          if (connectBtn) {
            connectBtn.onclick = () => {
              setActiveWorkspacePane(pane.id);
              if (showNewSessionDialogFn) showNewSessionDialogFn();
            };
          }
          bodyEl.appendChild(emptyHint);
        }
      }
    }
  });

  // Hide close button if only 1 pane visible
  const closeBtns = panesEl.querySelectorAll('.workspace-pane .pane-close-btn');
  closeBtns.forEach(b => b.style.display = visiblePanes.length <= 1 ? 'none' : 'flex');
}

export function splitPane(paneId, direction) {
  let nextLayout = "split-v";
  if (direction === "down") {
    if (workspaceState.layout === "single") nextLayout = "split-h";
    else if (workspaceState.layout === "split-v" || workspaceState.layout === "split-h") nextLayout = "2-top-1-bot";
    else if (workspaceState.layout === "2-top-1-bot" || workspaceState.layout === "1-top-2-bot") nextLayout = "grid-4";
  } else {
    if (workspaceState.layout === "single") nextLayout = "split-v";
    else if (workspaceState.layout === "split-v" || workspaceState.layout === "split-h") nextLayout = "2-top-1-bot";
    else if (workspaceState.layout === "2-top-1-bot" || workspaceState.layout === "1-top-2-bot") nextLayout = "grid-4";
  }

  setSplitMode(nextLayout);
  if (window.go && window.go.main && window.go.main.App) {
    window.go.main.App.AddWorkspacePane(direction).catch(() => {});
  }
}

export function closePane(paneId) {
  if (workspaceState.panes.length <= 1) return;

  const paneIdx = workspaceState.panes.findIndex(p => p.id === paneId);
  if (paneIdx === -1) return;

  const closingPane = workspaceState.panes[paneIdx];
  workspaceState.panes.splice(paneIdx, 1);

  // Redistribute orphan tabs
  const remaining = workspaceState.panes[0];
  const tabs = getTabs();
  if (closingPane.tabIds.length > 0) {
    closingPane.tabIds.forEach(tId => {
      remaining.tabIds.push(tId);
      if (tabs[tId]) tabs[tId].paneId = remaining.id;
    });
    if (!remaining.activeTabId) remaining.activeTabId = closingPane.tabIds[0];
  }

  if (workspaceState.activePaneId === paneId) {
    workspaceState.activePaneId = remaining.id;
  }

  // Adjust layout downwards
  if (workspaceState.panes.length === 1) workspaceState.layout = "single";
  else if (workspaceState.panes.length === 2 && (workspaceState.layout === "2-top-1-bot" || workspaceState.layout === "grid-4")) workspaceState.layout = "split-v";
  else if (workspaceState.panes.length === 3 && workspaceState.layout === "grid-4") workspaceState.layout = "2-top-1-bot";

  if (window.go && window.go.main && window.go.main.App) {
    window.go.main.App.CloseWorkspacePane(paneId).catch(() => {});
  }

  renderWorkspace();
  refitAllTerminals();
}

export function moveTabToPane(tabId, targetPaneId) {
  const currentPane = workspaceState.panes.find(p => p.tabIds && p.tabIds.includes(tabId));
  const targetPane = workspaceState.panes.find(p => p.id === targetPaneId);
  if (!targetPane) return;

  if (currentPane) {
    const idx = currentPane.tabIds.indexOf(tabId);
    if (idx !== -1) currentPane.tabIds.splice(idx, 1);
    if (currentPane.activeTabId === tabId) {
      currentPane.activeTabId = currentPane.tabIds.length > 0 ? currentPane.tabIds[currentPane.tabIds.length - 1] : null;
    }
  }

  if (!targetPane.tabIds.includes(tabId)) {
    targetPane.tabIds.push(tabId);
  }
  targetPane.activeTabId = tabId;
  workspaceState.activePaneId = targetPane.id;

  const tabs = getTabs();
  if (tabs[tabId]) {
    tabs[tabId].paneId = targetPane.id;
  }

  if (window.go && window.go.main && window.go.main.App) {
    window.go.main.App.MoveWorkspaceTab(tabId, targetPaneId, -1).catch(() => {});
  }

  renderWorkspace();
  if (activateTabFn) activateTabFn(tabId);
}

export function toggleMaximizePane(paneId) {
  const pane = workspaceState.panes.find(p => p.id === paneId);
  if (!pane) return;
  pane.maximized = !pane.maximized;
  renderWorkspace();
  refitAllTerminals();
}

export function refitAllTerminals() {
  setTimeout(() => {
    const tabs = getTabs();
    Object.entries(tabs).forEach(([tId, t]) => {
      if (t && t.fitAddon && t.term) {
        try {
          t.fitAddon.fit();
          const cols = (t.term.cols && t.term.cols > 0) ? t.term.cols : 120;
          const rows = (t.term.rows && t.term.rows > 0) ? t.term.rows : 30;
          if (window.go && window.go.main && window.go.main.App && window.go.main.App.ResizeTerminal) {
            window.go.main.App.ResizeTerminal(tId, cols, rows).catch(() => {});
          }
        } catch (_) {}
      }
    });
  }, 80);
}
