// ==========================================================================
// Nexterm — Terminal Engine & xterm.js Controller
// Handles xterm instance configuration, addon attachment (fit, search),
// in-terminal search bar, diagnostic cards, and directory tracking (OSC7/cd/prompts).
// ==========================================================================

import { getTabs, getActiveTabId, applyTabVisuals } from "../state/tabState.js";
import { THEMES } from "../settings/settings.js";
import { notifyPromptReturned } from "./processNotifier.js";

let refreshSFTPCallback = null;

export function registerSFTPRefresh(cb) {
  refreshSFTPCallback = cb;
}

export function parseClassifiedError(err) {
  if (!err) {
    return {
      category: "Unknown",
      message: "Unknown connection error",
      description: "No additional diagnostic information available.",
      rawError: ""
    };
  }

  if (typeof err === "object" && err !== null) {
    if (err.category && err.message) {
      return {
        category: err.category,
        message: err.message,
        description: err.description || "",
        rawError: err.rawError || err.message
      };
    }
  }

  const raw = String(err).trim();

  // Check structured error "[Category] Message: Description"
  const bracketMatch = raw.match(/^\[(.*?)\]\s*(.*?)(?::\s*(.*))?$/);
  if (bracketMatch) {
    return {
      category: bracketMatch[1],
      message: bracketMatch[2] || bracketMatch[1],
      description: bracketMatch[3] || bracketMatch[2] || "",
      rawError: raw
    };
  }

  const lower = raw.toLowerCase();

  // 1. Timeout
  if (lower.includes("timeout") || lower.includes("timed out") || lower.includes("deadline exceeded") || lower.includes("connectex: a connection attempt failed")) {
    return {
      category: "Timeout",
      message: "Connection timed out",
      description: "The remote host did not respond within the connection timeout threshold. Check target IP/hostname, firewall, or network route.",
      rawError: raw
    };
  }

  // 2. Connection refused
  if (lower.includes("connection refused") || lower.includes("refused") || lower.includes("no connection could be made")) {
    return {
      category: "Connection refused",
      message: "Connection refused by host",
      description: "The target host is active but rejected the connection. Verify that the SSH service is running on the specified port.",
      rawError: raw
    };
  }

  // 3. DNS failure
  if (lower.includes("no such host") || lower.includes("getaddrinfow") || lower.includes("name resolution") || lower.includes("lookup")) {
    return {
      category: "DNS failure",
      message: "DNS lookup failed",
      description: "Could not resolve the domain name to an IP address. Check the hostname spelling and your network DNS settings.",
      rawError: raw
    };
  }

  // 4. Host-key mismatch
  if (lower.includes("host key") || lower.includes("hostkey") || lower.includes("known_hosts") || lower.includes("fingerprint mismatch") || lower.includes("man-in-the-middle")) {
    return {
      category: "Host-key mismatch",
      message: "Host-key verification failed",
      description: "The remote server presented a host key that does not match your saved known_hosts record. Possible security threat or re-installed server.",
      rawError: raw
    };
  }

  // 5. Authentication failure
  if (lower.includes("unable to authenticate") || lower.includes("auth fail") || lower.includes("authentication failure") || lower.includes("password change") || lower.includes("bad password")) {
    return {
      category: "Authentication failure",
      message: "Authentication failed",
      description: "The server rejected credentials. Verify your username, password, or SSH private key passphrase.",
      rawError: raw
    };
  }

  // 6. Permission denied
  if (lower.includes("permission denied") || lower.includes("access denied") || lower.includes("forbidden")) {
    return {
      category: "Permission denied",
      message: "Permission denied",
      description: "The remote host refused permission to open a terminal session or subsystem for this user account.",
      rawError: raw
    };
  }

  // 7. Server closed connection
  if (lower.includes("eof") || lower.includes("connection reset") || lower.includes("broken pipe") || lower.includes("closed by remote") || lower.includes("closed connection") || lower.includes("reset by peer")) {
    return {
      category: "Server closed connection",
      message: "Server closed connection",
      description: "The remote SSH server or intermediate gateway terminated the connection unexpectedly.",
      rawError: raw
    };
  }

  return {
    category: "Unknown",
    message: raw.replace(/^error:\s*/i, ""),
    description: "An unexpected connection error occurred.",
    rawError: raw
  };
}

export function wrapTerminalText(str, maxLen = 66) {
  if (!str) return [];
  const words = String(str).split(" ");
  const lines = [];
  let current = "";
  words.forEach(w => {
    if ((current + " " + w).trim().length <= maxLen) {
      current = (current + " " + w).trim();
    } else {
      if (current) lines.push(current);
      current = w;
    }
  });
  if (current) lines.push(current);
  return lines;
}

export function renderTerminalDiagnosticCard(term, profile, errInfo) {
  if (!term) return;
  const cat = errInfo?.category || "Unknown";
  const msg = errInfo?.message || "Connection failed";
  const desc = errInfo?.description || "An unexpected error occurred during connection.";
  const raw = errInfo?.rawError || "";

  term.write("\r\n");
  term.write("\x1b[1;31m┌────────────────────────────────────────────────────────────────────────┐\x1b[0m\r\n");
  term.write(`\x1b[1;31m│\x1b[0m \x1b[1;37;41m ❌ CONNECTION ERROR \x1b[0m \x1b[1;31m${(cat).padEnd(49).slice(0, 49)}\x1b[1;31m│\x1b[0m\r\n`);
  term.write("\x1b[1;31m├────────────────────────────────────────────────────────────────────────┤\x1b[0m\r\n");
  term.write(`\x1b[1;31m│\x1b[0m \x1b[1;36mTarget:\x1b[0m         ${(`${profile.host || 'unknown'}:${profile.port || 22}`).padEnd(56).slice(0, 56)}\x1b[1;31m│\x1b[0m\r\n`);
  term.write(`\x1b[1;31m│\x1b[0m \x1b[1;36mUser:\x1b[0m           ${(profile.username || "n/a").padEnd(56).slice(0, 56)}\x1b[1;31m│\x1b[0m\r\n`);
  term.write(`\x1b[1;31m│\x1b[0m \x1b[1;33mClassification:\x1b[0m ${cat.padEnd(56).slice(0, 56)}\x1b[1;31m│\x1b[0m\r\n`);
  term.write(`\x1b[1;31m│\x1b[0m \x1b[1;31mReason:\x1b[0m         ${msg.padEnd(56).slice(0, 56)}\x1b[1;31m│\x1b[0m\r\n`);
  term.write("\x1b[1;31m├────────────────────────────────────────────────────────────────────────┤\x1b[0m\r\n");
  term.write(`\x1b[1;31m│\x1b[0m \x1b[1;33mDiagnostics:\x1b[0m                                                           \x1b[1;31m│\x1b[0m\r\n`);

  const descLines = wrapTerminalText(desc, 68);
  descLines.forEach(l => {
    term.write(`\x1b[1;31m│\x1b[0m   \x1b[0;37m${l.padEnd(68).slice(0, 68)}\x1b[1;31m│\x1b[0m\r\n`);
  });

  if (raw && raw !== msg && raw !== desc) {
    term.write("\x1b[1;31m├────────────────────────────────────────────────────────────────────────┤\x1b[0m\r\n");
    const rawLines = wrapTerminalText("Raw details: " + raw, 68);
    rawLines.forEach(l => {
      term.write(`\x1b[1;31m│\x1b[0m   \x1b[0;90m${l.padEnd(68).slice(0, 68)}\x1b[1;31m│\x1b[0m\r\n`);
    });
  }

  term.write("\x1b[1;31m├────────────────────────────────────────────────────────────────────────┤\x1b[0m\r\n");
  term.write(`\x1b[1;31m│\x1b[0m \x1b[1;32m💡 Hint:\x1b[0m Click \x1b[1;33m↻ Reconnect\x1b[0m in top toolbar or press \x1b[1;33mCtrl+R\x1b[0m to retry      \x1b[1;31m│\x1b[0m\r\n`);
  term.write("\x1b[1;31m└────────────────────────────────────────────────────────────────────────┘\x1b[0m\r\n\r\n");
}

export function createTerminalInstance(profile, userSettings) {
  const chosenTheme = profile.theme || userSettings.theme || "dark-modern";
  const themeObj = Object.assign({}, THEMES[chosenTheme] || THEMES["dark-modern"]);

  if (profile.background) themeObj.background = profile.background;
  if (profile.cursorColor) themeObj.cursor = profile.cursorColor;
  if (profile.selectionColor) themeObj.selectionBackground = profile.selectionColor;
  if (profile.ansiColors && typeof profile.ansiColors === "object") {
    Object.assign(themeObj, profile.ansiColors);
  }

  const TerminalClass = window.Terminal || (typeof Terminal !== "undefined" ? Terminal : null);
  if (!TerminalClass) {
    console.error("[terminal] Terminal class is not defined. Ensure vendor/xterm.js is loaded.");
    throw new Error("Terminal class is not defined. Ensure vendor/xterm.js is loaded.");
  }

  const term = new TerminalClass({
    fontFamily: profile.fontFamily || userSettings.fontFamily,
    fontSize: profile.fontSize || userSettings.fontSize,
    cursorBlink: profile.cursorBlink !== undefined ? profile.cursorBlink : userSettings.cursorBlink,
    cursorStyle: profile.cursorStyle || userSettings.cursorStyle || "block",
    scrollback: profile.scrollback || userSettings.scrollback || 10000,
    cols: profile.cols > 0 ? profile.cols : 80,
    rows: profile.rows > 0 ? profile.rows : 24,
    theme: themeObj,
    allowTransparency: true,
    smoothScrollDuration: 0,
    scrollSensitivity: 1.5,
    fastScrollSensitivity: 5,
  });

  let fitAddon = null;
  try {
    const FitClass = window.FitAddon?.FitAddon || window.FitAddon || (typeof FitAddon !== "undefined" ? FitAddon : null);
    if (FitClass) {
      fitAddon = typeof FitClass === "function" ? new FitClass() : (typeof FitClass.FitAddon === "function" ? new FitClass.FitAddon() : null);
      if (fitAddon) term.loadAddon(fitAddon);
    }
  } catch (e) {
    console.warn("FitAddon error:", e);
  }

  let searchAddon = null;
  try {
    const SearchClass = window.SearchAddon?.SearchAddon || window.SearchAddon || (typeof SearchAddon !== "undefined" ? SearchAddon : null);
    if (SearchClass) {
      searchAddon = typeof SearchClass === "function" ? new SearchClass() : (typeof SearchClass.SearchAddon === "function" ? new SearchClass.SearchAddon() : null);
      if (searchAddon) term.loadAddon(searchAddon);
    }
  } catch (e) {
    console.warn("SearchAddon error:", e);
  }

  return { term, fitAddon, searchAddon };
}

export function setupTerminalSearch(tabId, paneEl, term, searchAddon) {
  if (!searchAddon) return null;

  const targetContainer = paneEl.querySelector(".pane-terminal-top") || paneEl;

  const searchBar = document.createElement("div");
  searchBar.className = "terminal-search-bar hidden";
  searchBar.id = `termSearchBar_${tabId}`;
  searchBar.setAttribute("role", "search");
  searchBar.innerHTML = `
    <div class="search-input-box">
      <span class="search-icon">🔍</span>
      <input type="text" class="search-input" id="termSearchInput_${tabId}" placeholder="Search terminal..." spellcheck="false" autocomplete="off" />
      <span class="search-count-badge" id="termSearchBadge_${tabId}"></span>
    </div>
    <div class="search-btn-group">
      <button type="button" class="btn-search btn-search-prev" id="termSearchPrev_${tabId}" title="Previous match (Shift+Enter)">▲</button>
      <button type="button" class="btn-search btn-search-next" id="termSearchNext_${tabId}" title="Next match (Enter)">▼</button>
      <button type="button" class="btn-search btn-search-toggle" id="termSearchCase_${tabId}" title="Match case (Alt+C)">Aa</button>
      <button type="button" class="btn-search btn-search-toggle" id="termSearchRegex_${tabId}" title="Regex (Alt+R)">.*</button>
      <button type="button" class="btn-search btn-search-close" id="termSearchClose_${tabId}" title="Close (Escape)">✕</button>
    </div>
  `;

  targetContainer.appendChild(searchBar);

  const inputEl = searchBar.querySelector(`#termSearchInput_${tabId}`);
  const badgeEl = searchBar.querySelector(`#termSearchBadge_${tabId}`);
  const prevBtn = searchBar.querySelector(`#termSearchPrev_${tabId}`);
  const nextBtn = searchBar.querySelector(`#termSearchNext_${tabId}`);
  const caseBtn = searchBar.querySelector(`#termSearchCase_${tabId}`);
  const regexBtn = searchBar.querySelector(`#termSearchRegex_${tabId}`);
  const closeBtn = searchBar.querySelector(`#termSearchClose_${tabId}`);

  const state = {
    isOpen: false,
    query: "",
    caseSensitive: false,
    regex: false,
    barEl: searchBar,
    inputEl,
    badgeEl,
    caseBtn,
    regexBtn
  };

  if (typeof searchAddon.onDidChangeResults === "function") {
    searchAddon.onDidChangeResults((e) => {
      if (!state.isOpen) return;
      if (!state.query) {
        badgeEl.textContent = "";
        badgeEl.classList.remove("no-matches");
        return;
      }
      if (e.resultCount === 0) {
        badgeEl.textContent = "No results";
        badgeEl.classList.add("no-matches");
      } else {
        badgeEl.classList.remove("no-matches");
        const idx = e.resultIndex >= 0 ? e.resultIndex + 1 : 0;
        badgeEl.textContent = `${idx} of ${e.resultCount}`;
      }
    });
  }

  const getSearchOptions = (incremental = false) => ({
    regex: state.regex,
    caseSensitive: state.caseSensitive,
    incremental,
    decorations: {
      matchOverviewRulerColor: "#3b82f6",
      activeMatchColorOverviewRuler: "#f59e0b",
      matchBackground: "rgba(59, 130, 246, 0.35)",
      activeMatchBackground: "rgba(245, 158, 11, 0.65)"
    }
  });

  const doSearch = (forward = true, incremental = false) => {
    const q = inputEl.value;
    state.query = q;

    if (!q) {
      badgeEl.textContent = "";
      badgeEl.classList.remove("no-matches");
      if (typeof searchAddon.clearDecorations === "function") {
        try { searchAddon.clearDecorations(); } catch (_) {}
      }
      return;
    }

    if (state.regex) {
      try {
        new RegExp(q);
      } catch (err) {
        badgeEl.textContent = "Invalid regex";
        badgeEl.classList.add("no-matches");
        return;
      }
    }

    const options = getSearchOptions(incremental);
    try {
      if (forward) {
        searchAddon.findNext(q, options);
      } else {
        searchAddon.findPrevious(q, options);
      }
    } catch (err) {
      console.warn("Search execution error:", err);
    }
  };

  inputEl.addEventListener("input", () => {
    doSearch(true, true);
  });

  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      doSearch(!e.shiftKey, false);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeTerminalSearch(tabId);
    } else if (e.altKey && (e.key === "c" || e.key === "C")) {
      e.preventDefault();
      e.stopPropagation();
      caseBtn.click();
    } else if (e.altKey && (e.key === "r" || e.key === "R")) {
      e.preventDefault();
      e.stopPropagation();
      regexBtn.click();
    }
  });

  prevBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    doSearch(false, false);
    inputEl.focus();
  });

  nextBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    doSearch(true, false);
    inputEl.focus();
  });

  caseBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    state.caseSensitive = !state.caseSensitive;
    caseBtn.classList.toggle("active", state.caseSensitive);
    doSearch(true, false);
    inputEl.focus();
  });

  regexBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    state.regex = !state.regex;
    regexBtn.classList.toggle("active", state.regex);
    doSearch(true, false);
    inputEl.focus();
  });

  closeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    closeTerminalSearch(tabId);
  });

  return state;
}

export function openTerminalSearch(tabId) {
  const tabs = getTabs();
  if (!tabId || !tabs[tabId]) return;
  const t = tabs[tabId];
  if (!t.searchState) return;

  t.searchState.isOpen = true;
  t.searchState.barEl.classList.remove("hidden");
  t.searchState.inputEl.focus();
  t.searchState.inputEl.select();

  if (t.searchState.inputEl.value && t.searchAddon) {
    try {
      t.searchAddon.findNext(t.searchState.inputEl.value, {
        regex: t.searchState.regex,
        caseSensitive: t.searchState.caseSensitive,
        incremental: true,
        decorations: {
          matchOverviewRulerColor: "#3b82f6",
          activeMatchColorOverviewRuler: "#f59e0b",
          matchBackground: "rgba(59, 130, 246, 0.35)",
          activeMatchBackground: "rgba(245, 158, 11, 0.65)"
        }
      });
    } catch (_) {}
  }
}

export function closeTerminalSearch(tabId) {
  const tabs = getTabs();
  if (!tabId || !tabs[tabId]) return;
  const t = tabs[tabId];
  if (!t.searchState) return;

  t.searchState.isOpen = false;
  t.searchState.barEl.classList.add("hidden");
  if (t.searchAddon && typeof t.searchAddon.clearDecorations === "function") {
    try { t.searchAddon.clearDecorations(); } catch (_) {}
  }
  if (t.term) {
    try { t.term.focus(); } catch (_) {}
  }
}

export function isFollowTerminalFolderEnabled() {
  const chk = document.getElementById("sftpFollowTermCheckbox");
  return !chk || chk.checked;
}

export function extractCdTarget(cmd) {
  if (!cmd) return null;
  const trimmed = cmd.trim();
  const match = trimmed.match(/^(?:cd|pushd)(?:[\s]+(.*))?$/i);
  if (!match) return null;

  let target = match[1] !== undefined ? match[1].trim() : "";
  if (!target) return "~";

  // Split on compound commands: cd /tmp && ls -> /tmp
  if (target.includes(";") || target.includes("&&") || target.includes("||") || target.includes("|")) {
    target = target.split(/[;&|]/)[0].trim();
  }

  // Remove surrounding quotes: "dir name" -> dir name
  if ((target.startsWith('"') && target.endsWith('"')) || (target.startsWith("'") && target.endsWith("'"))) {
    target = target.slice(1, -1);
  }
  // Replace backslash escaped spaces: dir\ name -> dir name
  target = target.replace(/\\ /g, " ");

  // Remove trailing slashes
  if (target.length > 1 && target.endsWith("/")) {
    target = target.slice(0, -1);
  }

  return target.trim();
}

export function cleanPathSegments(p) {
  const isAbs = p.startsWith("/");
  const segments = p.split("/").filter(s => s && s !== ".");
  const stack = [];
  for (const seg of segments) {
    if (seg === "..") {
      if (stack.length > 0) stack.pop();
    } else {
      stack.push(seg);
    }
  }
  return (isAbs ? "/" : "") + stack.join("/");
}

export function resolveTerminalPath(currentDir, target, lastDir = "~") {
  if (!target || target === "~" || target === "$HOME" || target === "") return "~";
  if (target === "-") return lastDir || "~";

  if (target.startsWith("/")) {
    return cleanPathSegments(target);
  }

  if (target.startsWith("~/")) {
    return "~/" + cleanPathSegments(target.slice(2));
  }

  let base = currentDir && currentDir !== "/" ? currentDir : "";
  if (!base || base === "~") {
    return "~/" + cleanPathSegments(target);
  }

  return cleanPathSegments(base + "/" + target);
}

export function getTerminalCurrentPromptDir(term) {
  if (!term || !term.buffer || !term.buffer.active) return null;
  const buf = term.buffer.active;
  const startY = Math.min(buf.baseY + buf.cursorY, buf.length - 1);
  for (let y = startY; y >= Math.max(0, startY - 20); y--) {
    const line = buf.getLine(y);
    if (!line) continue;
    const str = line.translateToString(true);
    if (!str || !str.trim()) continue;

    // Pattern 1: [user@host dir]$ or [user@host dir]# or [user@host:dir]$ or [dir]$
    const bracketMatch = str.match(/\[(?:[^@\s]+@)?[^\]\s:]+[\s:]([^\]]+)\][\$#%>\s]?/);
    if (bracketMatch && bracketMatch[1]) {
      const raw = bracketMatch[1].replace(/\s*\([^\)]*\)\s*$/, "").replace(/[\$#%>\s]+$/, "").trim();
      if (raw) return raw;
    }

    // Pattern 2: user@host:dir$ or user@host:dir# or [user@host:dir]
    const colonMatch = str.match(/(?:[^@\s]+@)?[^:\s]+:([^\$#%>\r\n]+)[\$#%>\s]?/);
    if (colonMatch && colonMatch[1]) {
      const raw = colonMatch[1].replace(/\s*\([^\)]*\)\s*$/, "").replace(/[\$#%>\s]+$/, "").trim();
      if (raw) return raw;
    }

    // Pattern 3: Simple [~/dir] or [/dir]
    const simpleBracket = str.match(/\[([~/][^\]\s]*)\][\$#%>\s]?/);
    if (simpleBracket && simpleBracket[1]) {
      return simpleBracket[1].trim();
    }
  }
  return null;
}

export function syncSFTPToCurrentTerminalCwd(tabId = getActiveTabId()) {
  const tabs = getTabs();
  const tab = tabs[tabId];
  if (!tab || tab.isLocal) return;

  // 1. Try reading the active prompt line directly from the terminal screen buffer
  let promptDir = null;
  try {
    promptDir = getTerminalCurrentPromptDir(tab.term);
  } catch (_) {}

  let target = "";
  if (promptDir) {
    if (promptDir === "~" || promptDir.startsWith("/") || promptDir.startsWith("~/")) {
      target = promptDir;
    } else {
      const base = tab.terminalCwd && tab.terminalCwd !== "~" ? tab.terminalCwd : "~";
      const baseClean = base.replace(/\/+$/, "");
      if (baseClean.split("/").pop() === promptDir) {
        target = base;
      } else {
        target = resolveTerminalPath(base, promptDir, tab.lastSftpPath);
      }
    }
    tab.terminalCwd = target;
  } else if (tab.terminalCwd) {
    target = tab.terminalCwd;
  } else {
    target = tab.sftpPath || "~";
  }

  tab.sftpPath = target;
  if (typeof refreshSFTPCallback === "function") {
    refreshSFTPCallback(target);
  }
  if (tab.loadRemoteList) {
    tab.loadRemoteList(target);
  }
}

let cdNavDebounceTimer = null;
export function handleTerminalCdCommand(tabId, cmd) {
  const target = extractCdTarget(cmd);
  if (target === null) return;

  const tabs = getTabs();
  const tab = tabs[tabId];
  if (!tab || tab.isLocal) return;

  const currentPath = tab.terminalCwd || tab.sftpPath || "~";
  const newPath = resolveTerminalPath(currentPath, target, tab.lastSftpPath);

  // ALWAYS track terminal CWD in background even if follow checkbox is off
  tab.lastSftpPath = tab.terminalCwd || tab.sftpPath;
  tab.terminalCwd = newPath;

  // Only refresh SFTP view if follow terminal checkbox is currently checked
  if (!isFollowTerminalFolderEnabled()) return;

  if (cdNavDebounceTimer) clearTimeout(cdNavDebounceTimer);
  cdNavDebounceTimer = setTimeout(async () => {
    if (tabs[tabId] && getActiveTabId() === tabId && isFollowTerminalFolderEnabled()) {
      tab.sftpPath = newPath;
      if (typeof refreshSFTPCallback === "function") {
        await refreshSFTPCallback(newPath);
      }
      if (tab.loadRemoteList) {
        tab.loadRemoteList(newPath);
      }
    }
  }, 350);
}

export function handleTerminalTitleChange(tabId, title) {
  let candidate = "";
  if (title.includes(":")) {
    const parts = title.split(":");
    candidate = parts[parts.length - 1].trim();
  } else if (title.startsWith("/") || title.startsWith("~")) {
    candidate = title.trim();
  }

  if (candidate && (candidate.startsWith("/") || candidate.startsWith("~"))) {
    candidate = candidate.split(/[\s\$#]/)[0].trim();
    const tabs = getTabs();
    const tab = tabs[tabId];
    if (candidate && tab) {
      tab.lastSftpPath = tab.terminalCwd || tab.sftpPath;
      tab.terminalCwd = candidate;
      if (isFollowTerminalFolderEnabled() && getActiveTabId() === tabId && tab.sftpPath !== candidate) {
        tab.sftpPath = candidate;
        if (typeof refreshSFTPCallback === "function") {
          refreshSFTPCallback(candidate);
        }
      }
    }
  }
}

export function handleTerminalOsc7(tabId, data) {
  let dir = data;
  if (dir.startsWith("file://")) {
    try {
      const u = new URL(dir);
      dir = decodeURIComponent(u.pathname);
    } catch (_) {
      dir = dir.replace(/^file:\/\/[^\/]*/, "");
    }
  }
  if (dir && dir.startsWith("/")) {
    const tabs = getTabs();
    const tab = tabs[tabId];
    if (tab) {
      tab.lastSftpPath = tab.terminalCwd || tab.sftpPath;
      tab.terminalCwd = dir;
      if (isFollowTerminalFolderEnabled() && getActiveTabId() === tabId && tab.sftpPath !== dir) {
        tab.sftpPath = dir;
        if (typeof refreshSFTPCallback === "function") {
          refreshSFTPCallback(dir);
        }
      }
    }
  }
}

export function handleTerminalOutputPrompt(tabId, buffer) {
  const clean = buffer
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")
    .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, "");

  const bracketMatch = clean.match(/\[([^@\s]+)@([^\]\s]+)\s+([^\]]+)\][\$#]\s*$/);
  if (bracketMatch && bracketMatch[1] && bracketMatch[2]) {
    const remoteHost = bracketMatch[2].trim();
    const tabs = getTabs();
    const tab = tabs[tabId];
    if (tab && !tab.remoteHostname && remoteHost) {
      tab.remoteHostname = remoteHost;
      applyTabVisuals(tabId);
    }
    syncPromptDir(tabId, bracketMatch[3].trim());
    try { notifyPromptReturned(tabId); } catch (_) {}
    return;
  }

  const colonMatch = clean.match(/([^@\s]+)@([^:\s]+):([^\$#\r\n]+)[\$#]\s*$/);
  if (colonMatch && colonMatch[1] && colonMatch[2]) {
    const remoteHost = colonMatch[2].trim();
    const tabs = getTabs();
    const tab = tabs[tabId];
    if (tab && !tab.remoteHostname && remoteHost) {
      tab.remoteHostname = remoteHost;
      applyTabVisuals(tabId);
    }
    syncPromptDir(tabId, colonMatch[3].trim());
    try { notifyPromptReturned(tabId); } catch (_) {}
    return;
  }
}

let lastPromptSyncDir = "";
export function syncPromptDir(tabId, dirToken) {
  if (!dirToken) return;
  const tabs = getTabs();
  const tab = tabs[tabId];
  if (!tab || tab.isLocal) return;

  let targetPath = "";
  if (dirToken === "~") {
    targetPath = "~";
  } else if (dirToken.startsWith("/") || dirToken.startsWith("~/")) {
    targetPath = dirToken;
  } else {
    const current = tab.terminalCwd || tab.sftpPath || "~";
    const currentClean = current.replace(/\/+$/, "");
    const baseName = currentClean.split("/").pop();
    if (baseName === dirToken) return;
    targetPath = resolveTerminalPath(current, dirToken, tab.lastSftpPath);
  }

  if (targetPath) {
    tab.lastSftpPath = tab.terminalCwd || tab.sftpPath;
    tab.terminalCwd = targetPath;
    if (isFollowTerminalFolderEnabled() && getActiveTabId() === tabId && targetPath !== tab.sftpPath && targetPath !== lastPromptSyncDir) {
      lastPromptSyncDir = targetPath;
      tab.sftpPath = targetPath;
      if (typeof refreshSFTPCallback === "function") {
        refreshSFTPCallback(targetPath);
      }
    }
  }
}
