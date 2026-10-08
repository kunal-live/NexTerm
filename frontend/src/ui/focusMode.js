// ==========================================================================
// NexTerm — Focus Mode (Zen Workspace) Subsystem
// Maximizes workspace, hides upper navigation/toolbars, restores on Esc
// ==========================================================================

import { refitAllTerminals } from '../state/workspaceState.js';

let isFocusModeActive = false;

export function isFocusMode() {
  return isFocusModeActive;
}

export function setFocusMode(enable) {
  if (isFocusModeActive === enable) return;
  isFocusModeActive = !!enable;

  if (isFocusModeActive) {
    document.body.classList.add("focus-mode");
    updateButtons(true);
    showFocusModeToast();
  } else {
    document.body.classList.remove("focus-mode");
    updateButtons(false);
  }

  // Refit terminal panes with smooth adjustment
  requestAnimationFrame(() => {
    refitAllTerminals();
    setTimeout(refitAllTerminals, 80);
    setTimeout(refitAllTerminals, 200);
  });
}

export function toggleFocusMode() {
  setFocusMode(!isFocusModeActive);
}

function updateButtons(active) {
  const tabBtn = document.getElementById("focusModeToggleBtn");
  const topBtn = document.getElementById("tbFocusModeBtn");
  const menuOpt = document.getElementById("mToggleFocus");

  const title = active ? "Exit Focus Mode (Esc)" : "Focus Mode — Maximize workspace (Esc to exit)";
  const icon = active ? getExitFocusIcon() : getEnterFocusIcon();

  if (tabBtn) {
    tabBtn.title = title;
    tabBtn.classList.toggle("active", active);
    tabBtn.innerHTML = icon;
  }
  if (topBtn) {
    topBtn.title = title;
    topBtn.classList.toggle("active", active);
    topBtn.innerHTML = icon;
  }
  if (menuOpt) {
    menuOpt.textContent = active ? "✓ Exit Focus Mode (Esc)" : "🎯 Focus Mode (Esc to exit)";
  }
}

function getEnterFocusIcon() {
  return `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M4 8V4h4"></path>
    <path d="M20 8V4h-4"></path>
    <path d="M4 16v4h4"></path>
    <path d="M20 16v4h-4"></path>
  </svg>`;
}

function getExitFocusIcon() {
  return `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M8 4v4H4"></path>
    <path d="M16 4v4h4"></path>
    <path d="M8 20v-4H4"></path>
    <path d="M16 20v-4h4"></path>
  </svg>`;
}

function showFocusModeToast() {
  const existing = document.querySelector(".focus-mode-pill");
  if (existing) existing.remove();

  const pill = document.createElement("div");
  pill.className = "focus-mode-pill";
  pill.innerHTML = `<span>🎯 Focus Mode Active</span> · <span>Press <kbd>Esc</kbd> to return</span>`;
  document.body.appendChild(pill);

  setTimeout(() => {
    pill.remove();
  }, 2800);
}

export function initFocusMode() {
  const tabBtn = document.getElementById("focusModeToggleBtn");
  if (tabBtn) {
    tabBtn.addEventListener("click", () => toggleFocusMode());
  }

  const topBtn = document.getElementById("tbFocusModeBtn");
  if (topBtn) {
    topBtn.addEventListener("click", () => toggleFocusMode());
  }

  const menuOpt = document.getElementById("mToggleFocus");
  if (menuOpt) {
    menuOpt.addEventListener("click", () => toggleFocusMode());
  }
}
