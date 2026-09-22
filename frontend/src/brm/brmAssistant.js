// ==========================================================================
// NextTerm — Oracle BRM Diagnostic Assistant (#AI-BRM)
// Read-only diagnostic assistant for Oracle BRM developers and operators.
// ==========================================================================

import { BRM_SAMPLE_QUERIES, BRM_SOURCE_OPTIONS, BRM_OPCODES } from "./brmKnowledge.js";
import { showToast, escapeHtml } from "../ui/notifications.js";
import { openRemoteFileEditor } from "../sftp/fileBrowser.js";
import { openLogInExplorer } from "../terminal/logExplorer.js";
import { switchSidebarView } from "../sessions/sessionTree.js";
import { refreshSFTP } from "../sftp/sftpPanel.js";
import { tabs, activeTabId } from "../state/tabState.js";

let conversation = [];
let diagnosticHistory = [];
let pendingQuestion = "";
let activeInstallation = null;
let isBusy = false;

export function initBRMAssistant() {
  const container = document.getElementById("viewBRM");
  if (!container) return;

  renderAssistantLayout(container);
  bindAssistantEvents(container);
  detectCurrentEnvironment();
}

function getEffectiveTabId() {
  if (activeTabId && tabs[activeTabId] && !tabs[activeTabId].isLocal && tabs[activeTabId].isConnected) {
    return activeTabId;
  }
  return "local";
}

function getEffectiveTabName() {
  if (activeTabId && tabs[activeTabId]) {
    const t = tabs[activeTabId];
    return t.profile?.name || t.profile?.host || (t.isLocal ? "Local Terminal" : "SSH Session");
  }
  return "Local Machine";
}

export async function detectCurrentEnvironment() {
  const tabId = getEffectiveTabId();
  const badgeEl = document.getElementById("brmTargetBadge");
  const rootEl = document.getElementById("brmDetectedRoot");

  if (badgeEl) {
    const isRemote = tabId !== "local";
    badgeEl.textContent = isRemote ? `SSH: ${getEffectiveTabName()}` : "Local Environment";
    badgeEl.className = isRemote ? "brm-badge brm-badge-remote" : "brm-badge brm-badge-local";
  }

  try {
    if (window.go?.main?.App?.BRMDetectInstallation) {
      const inst = await window.go.main.App.BRMDetectInstallation(tabId);
      activeInstallation = inst;
      if (rootEl && inst?.rootPath) {
        rootEl.textContent = inst.rootPath;
        rootEl.title = `BRM Root: ${inst.rootPath} (${inst.components?.length || 0} components discovered)`;
      }
    }
  } catch (err) {
    console.warn("BRM installation detection:", err);
  }
}

function renderAssistantLayout(container) {
  container.innerHTML = `
    <div class="brm-assistant-wrapper">
      <!-- 1. Header Toolbar -->
      <div class="brm-header">
        <div class="brm-header-left">
          <span class="brm-header-title">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 2a4 4 0 0 1 4 4c0 1.5-.8 2.8-2 3.5v1.5h-4v-1.5c-1.2-.7-2-2-2-3.5a4 4 0 0 1 4-4z"></path>
              <path d="M9 15h6"></path>
              <path d="M10 18h4"></path>
              <path d="M11 21h2"></path>
            </svg>
            Oracle BRM Assistant
          </span>
          <span class="brm-readonly-pill" title="Read-only assistant: never modifies files or restarts services">READ-ONLY</span>
        </div>
        <div class="brm-header-right">
          <button id="brmRefreshEnvBtn" class="brm-icon-btn" title="Refresh Environment Discovery">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="23 4 23 10 17 10"></polyline>
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
            </svg>
          </button>
          <button id="brmHistoryToggleBtn" class="brm-icon-btn" title="Diagnostic History">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <polyline points="12 6 12 12 16 14"></polyline>
            </svg>
            <span id="brmHistoryBadge" class="brm-count-bubble">0</span>
          </button>
          <button id="brmClearChatBtn" class="brm-icon-btn" title="Clear Conversation">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
        </div>
      </div>

      <!-- Environment Info Strip -->
      <div class="brm-env-strip">
        <span id="brmTargetBadge" class="brm-badge brm-badge-local">Local Environment</span>
        <span id="brmDetectedRoot" class="brm-root-path" title="Discovered BRM root">/opt/portal</span>
      </div>

      <!-- History Dropdown (initially hidden) -->
      <div id="brmHistoryDropdown" class="brm-history-panel hidden">
        <div class="brm-history-header">
          <span>Diagnostic Session History</span>
          <button id="brmCloseHistoryBtn" class="brm-close-sm">&times;</button>
        </div>
        <div id="brmHistoryList" class="brm-history-list">
          <div class="brm-history-empty">No diagnoses recorded in this session.</div>
        </div>
      </div>

      <!-- 2. Chat Timeline -->
      <div id="brmChatTimeline" class="brm-timeline">
        <div class="brm-welcome-card">
          <div class="brm-welcome-title">Ask your BRM question or describe an issue</div>
          <div class="brm-welcome-subtitle">
            Diagnostics strictly rely on evidence from your CM, DM, opcode sources, and pin.conf configurations.
          </div>
          <div class="brm-quick-chips">
            ${BRM_SAMPLE_QUERIES.map(q => `
              <button class="brm-chip" data-query="${escapeHtml(q.text)}">${escapeHtml(q.label)}</button>
            `).join("")}
          </div>
        </div>
      </div>

      <!-- 3. Query Input Bar -->
      <div class="brm-input-section">
        <div class="brm-input-row">
          <textarea id="brmInput" class="brm-input" placeholder="Ask BRM question (e.g. Why is billing failing? Where is pin.conf?)..." rows="1"></textarea>
          <button id="brmSendBtn" class="brm-send-btn" title="Send (Enter)">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"></line>
              <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
            </svg>
          </button>
        </div>
        <div class="brm-input-hint">Enter to send • Shift+Enter for newline • Read-only non-invasive inspection</div>
      </div>
    </div>
  `;
}

function bindAssistantEvents(container) {
  const input = container.querySelector("#brmInput");
  const sendBtn = container.querySelector("#brmSendBtn");
  const clearBtn = container.querySelector("#brmClearChatBtn");
  const refreshBtn = container.querySelector("#brmRefreshEnvBtn");
  const historyToggleBtn = container.querySelector("#brmHistoryToggleBtn");
  const historyCloseBtn = container.querySelector("#brmCloseHistoryBtn");
  const timeline = container.querySelector("#brmChatTimeline");

  // Send action
  const handleSend = () => {
    const q = input.value.trim();
    if (!q || isBusy) return;
    input.value = "";
    input.style.height = "auto";
    submitQuestion(q);
  };

  sendBtn?.addEventListener("click", handleSend);

  input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });

  input?.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 120) + "px";
  });

  clearBtn?.addEventListener("click", () => {
    conversation = [];
    pendingQuestion = "";
    renderAssistantLayout(container);
    bindAssistantEvents(container);
    detectCurrentEnvironment();
  });

  refreshBtn?.addEventListener("click", () => {
    detectCurrentEnvironment();
    showToast("Refreshed BRM environment discovery", "info");
  });

  historyToggleBtn?.addEventListener("click", () => {
    const panel = container.querySelector("#brmHistoryDropdown");
    if (panel) panel.classList.toggle("hidden");
  });

  historyCloseBtn?.addEventListener("click", () => {
    const panel = container.querySelector("#brmHistoryDropdown");
    if (panel) panel.classList.add("hidden");
  });

  // Delegated clicks inside timeline (chips, source selection, action buttons)
  timeline?.addEventListener("click", async (e) => {
    const chip = e.target.closest(".brm-chip");
    if (chip) {
      const q = chip.getAttribute("data-query");
      if (q) submitQuestion(q);
      return;
    }

    const sourceBtn = e.target.closest(".brm-source-pill");
    if (sourceBtn) {
      const sourceKey = sourceBtn.getAttribute("data-source");
      if (sourceKey && pendingQuestion) {
        const q = pendingQuestion;
        pendingQuestion = "";
        submitQuestionWithSource(q, sourceKey);
      }
      return;
    }

    const customSourceBtn = e.target.closest(".brm-custom-source-btn");
    if (customSourceBtn) {
      const customPathInput = container.querySelector("#brmCustomPathInput");
      const p = customPathInput?.value?.trim();
      if (p && pendingQuestion) {
        const q = pendingQuestion;
        pendingQuestion = "";
        submitQuestionWithSource(q, "custom", p);
      } else {
        showToast("Enter a valid file path to inspect", "warning");
      }
      return;
    }

    const actionBtn = e.target.closest(".brm-action-btn");
    if (actionBtn) {
      const actionType = actionBtn.getAttribute("data-action");
      const target = actionBtn.getAttribute("data-target");
      const line = parseInt(actionBtn.getAttribute("data-line") || "1", 10);
      handleDiagnosticAction(actionType, target, line, actionBtn);
      return;
    }
  });
}

async function submitQuestion(question) {
  isBusy = true;
  pendingQuestion = question;
  appendMessage({ role: "user", text: question, timestamp: new Date() });

  const loadingMsgId = appendLoadingIndicator();
  const tabId = getEffectiveTabId();

  try {
    if (!window.go?.main?.App?.BRMDiagnose) {
      removeLoadingIndicator(loadingMsgId);
      appendMessage({
        role: "assistant",
        text: "BRM Assistant backend service is currently initializing or unavailable."
      });
      isBusy = false;
      return;
    }

    const req = {
      tabId: tabId,
      question: question,
      selectedSource: "",
      customPath: ""
    };

    const res = await window.go.main.App.BRMDiagnose(req);
    removeLoadingIndicator(loadingMsgId);

    if (res.status === "needs_source") {
      appendSourceSelectionPrompt(question, res.suggestedSources || []);
    } else {
      appendDiagnosisCard(res);
      recordHistory(question, res);
      pendingQuestion = "";
    }
  } catch (err) {
    removeLoadingIndicator(loadingMsgId);
    appendMessage({
      role: "assistant",
      text: `Diagnostic evaluation encountered an error: ${escapeHtml(err.message || String(err))}`
    });
  } finally {
    isBusy = false;
  }
}

async function submitQuestionWithSource(question, selectedSource, customPath = "") {
  isBusy = true;
  const loadingMsgId = appendLoadingIndicator();
  const tabId = getEffectiveTabId();

  try {
    const req = {
      tabId: tabId,
      question: question,
      selectedSource: selectedSource,
      customPath: customPath
    };

    const res = await window.go.main.App.BRMDiagnose(req);
    removeLoadingIndicator(loadingMsgId);
    appendDiagnosisCard(res);
    recordHistory(question, res);
  } catch (err) {
    removeLoadingIndicator(loadingMsgId);
    appendMessage({
      role: "assistant",
      text: `Failed to inspect source: ${escapeHtml(err.message || String(err))}`
    });
  } finally {
    isBusy = false;
  }
}

function appendMessage(msg) {
  conversation.push(msg);
  const timeline = document.getElementById("brmChatTimeline");
  if (!timeline) return;

  const row = document.createElement("div");
  row.className = `brm-chat-row brm-chat-${msg.role}`;
  row.innerHTML = `
    <div class="brm-bubble brm-bubble-${msg.role}">
      ${escapeHtml(msg.text)}
    </div>
  `;
  timeline.appendChild(row);
  scrollToBottom();
}

function appendLoadingIndicator() {
  const timeline = document.getElementById("brmChatTimeline");
  if (!timeline) return "";

  const id = "brm_loading_" + Date.now();
  const row = document.createElement("div");
  row.id = id;
  row.className = "brm-chat-row brm-chat-assistant";
  row.innerHTML = `
    <div class="brm-loading-bubble">
      <span class="brm-spinner"></span>
      <span>Performing read-only inspection of BRM evidence...</span>
    </div>
  `;
  timeline.appendChild(row);
  scrollToBottom();
  return id;
}

function removeLoadingIndicator(id) {
  if (!id) return;
  const el = document.getElementById(id);
  if (el) el.remove();
}

function appendSourceSelectionPrompt(question, sources) {
  const timeline = document.getElementById("brmChatTimeline");
  if (!timeline) return;

  const row = document.createElement("div");
  row.className = "brm-chat-row brm-chat-assistant";

  const options = sources && sources.length > 0 ? sources : BRM_SOURCE_OPTIONS;

  row.innerHTML = `
    <div class="brm-bubble brm-bubble-assistant brm-source-selector-card">
      <div class="brm-source-prompt-title">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="16" x2="12" y2="12"></line>
          <line x1="12" y1="8" x2="12.01" y2="8"></line>
        </svg>
        Evidence required to diagnose
      </div>
      <div class="brm-source-prompt-desc">
        Which source should I inspect? Only bounded, read-only analysis will be performed.
      </div>
      <div class="brm-source-pills-wrap">
        ${options.map(s => `
          <button class="brm-source-pill" data-source="${escapeHtml(s.key)}" title="${escapeHtml(s.description || s.desc || '')}">
            <span class="brm-pill-label">${escapeHtml(s.label)}</span>
            <span class="brm-pill-desc">${escapeHtml(s.description || s.desc || '')}</span>
          </button>
        `).join("")}
      </div>
      <div class="brm-custom-source-row">
        <input type="text" id="brmCustomPathInput" class="brm-custom-input" placeholder="Or inspect custom file: /path/to/logfile.log" />
        <button class="brm-custom-source-btn">Inspect</button>
      </div>
    </div>
  `;

  timeline.appendChild(row);
  scrollToBottom();
}

function appendDiagnosisCard(res) {
  const timeline = document.getElementById("brmChatTimeline");
  if (!timeline) return;

  const row = document.createElement("div");
  row.className = "brm-chat-row brm-chat-assistant";

  const confClass = res.confidence?.toLowerCase() === "high" ? "conf-high" : (res.confidence?.toLowerCase() === "medium" ? "conf-med" : "conf-low");

  row.innerHTML = `
    <div class="brm-diagnosis-card">
      <!-- Card Header -->
      <div class="brm-card-header">
        <div class="brm-card-tags">
          <span class="brm-tag brm-tag-comp">${escapeHtml(res.component || "Oracle BRM")}</span>
          ${res.error ? `<span class="brm-tag brm-tag-err">${escapeHtml(res.error)}</span>` : ""}
          <span class="brm-tag brm-conf-badge ${confClass}">${escapeHtml(res.confidence || "High")} Confidence</span>
        </div>
      </div>

      <!-- Problem Statement -->
      <div class="brm-problem-row">
        <strong>Problem:</strong> ${escapeHtml(res.problem)}
      </div>

      <!-- Evidence Box -->
      ${res.evidence && res.evidence.length > 0 ? `
        <div class="brm-section-title">Verified Evidence</div>
        <div class="brm-evidence-box">
          ${res.evidence.map(ev => `
            <div class="brm-evidence-item">
              <div class="brm-evidence-loc">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                </svg>
                <span>${escapeHtml(ev.file)}</span>
                ${ev.lineStart ? `<span class="brm-line-no">Line ${ev.lineStart}</span>` : ""}
              </div>
              <pre class="brm-evidence-snippet"><code>${escapeHtml(ev.snippet || "")}</code></pre>
            </div>
          `).join("")}
        </div>
      ` : ""}

      <!-- Likely Causes -->
      ${res.likelyCauses && res.likelyCauses.length > 0 ? `
        <div class="brm-section-title">Likely Causes</div>
        <ul class="brm-bullet-list">
          ${res.likelyCauses.map(c => `<li>${escapeHtml(c)}</li>`).join("")}
        </ul>
      ` : ""}

      <!-- Verification Checks -->
      ${res.checks && res.checks.length > 0 ? `
        <div class="brm-section-title">Diagnostic Checks</div>
        <ul class="brm-checklist">
          ${res.checks.map((chk, idx) => `
            <li>
              <label class="brm-check-item">
                <input type="checkbox" id="chk_${idx}_${Date.now()}" />
                <span>${escapeHtml(chk)}</span>
              </label>
            </li>
          `).join("")}
        </ul>
      ` : ""}

      <!-- Resolution Steps -->
      ${res.resolution && res.resolution.length > 0 ? `
        <div class="brm-section-title">Recommended Resolution</div>
        <ol class="brm-num-list">
          ${res.resolution.map(r => `<li>${escapeHtml(r)}</li>`).join("")}
        </ol>
      ` : ""}

      <!-- Action Buttons -->
      ${res.actions && res.actions.length > 0 ? `
        <div class="brm-actions-row">
          ${res.actions.map(act => `
            <button class="brm-action-btn brm-action-${act.type}" data-action="${escapeHtml(act.type)}" data-target="${escapeHtml(act.target)}" data-line="${act.line || 1}">
              ${renderActionIcon(act.type)}
              <span>${escapeHtml(act.label)}</span>
            </button>
          `).join("")}
        </div>
      ` : ""}
    </div>
  `;

  timeline.appendChild(row);
  scrollToBottom();
}

function renderActionIcon(type) {
  switch (type) {
    case "open_log":
      return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>`;
    case "open_config":
      return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>`;
    case "open_sftp":
      return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`;
    case "copy":
      return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
    default:
      return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg>`;
  }
}

async function handleDiagnosticAction(type, target, line, btnEl) {
  try {
    switch (type) {
      case "open_log":
        openLogInExplorer(target);
        showToast(`Opened ${target} in Log Explorer`, "info");
        break;

      case "open_config":
        await openRemoteFileEditor(target);
        showToast(`Opened ${target} in Editor`, "info");
        break;

      case "open_sftp":
        switchSidebarView("sftp");
        await refreshSFTP(target);
        showToast(`Navigated SFTP to ${target}`, "info");
        break;

      case "copy": {
        const card = btnEl.closest(".brm-diagnosis-card");
        if (card) {
          const text = card.innerText;
          await navigator.clipboard.writeText(text);
          showToast("Diagnosis copied to clipboard", "success");
        }
        break;
      }

      default:
        console.log("Unhandled BRM action:", type, target);
    }
  } catch (err) {
    showToast(`Action error: ${err.message || String(err)}`, "error");
  }
}

function recordHistory(question, res) {
  const item = {
    id: Date.now(),
    time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    question: question,
    error: res.error || res.problem,
    component: res.component,
    status: res.status,
    confidence: res.confidence
  };
  diagnosticHistory.unshift(item);
  updateHistoryDropdown();
}

function updateHistoryDropdown() {
  const badge = document.getElementById("brmHistoryBadge");
  const list = document.getElementById("brmHistoryList");

  if (badge) badge.textContent = diagnosticHistory.length;
  if (!list) return;

  if (diagnosticHistory.length === 0) {
    list.innerHTML = `<div class="brm-history-empty">No diagnoses recorded in this session.</div>`;
    return;
  }

  list.innerHTML = diagnosticHistory.map(h => `
    <div class="brm-history-item" data-qid="${h.id}">
      <div class="brm-hist-time">${escapeHtml(h.time)}</div>
      <div class="brm-hist-q">${escapeHtml(h.question)}</div>
      <div class="brm-hist-meta">
        <span class="brm-tag brm-tag-comp">${escapeHtml(h.component || "BRM")}</span>
        ${h.error ? `<span class="brm-tag brm-tag-err">${escapeHtml(h.error)}</span>` : ""}
      </div>
    </div>
  `).join("");
}

function scrollToBottom() {
  const timeline = document.getElementById("brmChatTimeline");
  if (timeline) {
    timeline.scrollTop = timeline.scrollHeight;
  }
}
