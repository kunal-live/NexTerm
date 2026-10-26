// ==========================================================================
// NexTerm — Command Palette Subsystem (Ctrl+K)
// Keyboard-first action launcher and session jumper per Modern UI/UX Plan
// ==========================================================================

import { tabs } from '../state/tabState.js';
import { escapeHtml } from '../ui/notifications.js';

let commandActions = [];
let isOpen = false;
let selectedIndex = 0;
let filteredItems = [];

export function registerCommandPaletteActions(actions) {
  commandActions = actions;
}

export function openCommandPalette() {
  if (isOpen) return;
  isOpen = true;
  selectedIndex = 0;

  let paletteEl = document.getElementById("commandPaletteModal");
  if (!paletteEl) {
    paletteEl = document.createElement("div");
    paletteEl.id = "commandPaletteModal";
    paletteEl.className = "command-palette-overlay";
    paletteEl.innerHTML = `
      <div class="command-palette-card" role="dialog" aria-modal="true" aria-label="Command Palette">
        <div class="command-palette-input-wrap">
          <span class="command-palette-search-icon">🔍</span>
          <input type="text" id="commandPaletteInput" class="command-palette-input" placeholder="Type a command or jump to session... (Esc to exit)" autocomplete="off" spellcheck="false" />
          <span class="command-palette-esc-badge">ESC</span>
        </div>
        <div class="command-palette-results" id="commandPaletteResults"></div>
        <div class="command-palette-footer">
          <span><kbd>↑</kbd> <kbd>↓</kbd> to navigate</span>
          <span><kbd>↵</kbd> to select</span>
          <span><kbd>esc</kbd> to dismiss</span>
        </div>
      </div>
    `;
    document.body.appendChild(paletteEl);

    paletteEl.addEventListener("click", (e) => {
      if (e.target === paletteEl) closeCommandPalette();
    });

    const input = paletteEl.querySelector("#commandPaletteInput");
    input.addEventListener("input", () => {
      selectedIndex = 0;
      renderPaletteResults();
    });

    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeCommandPalette();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        if (filteredItems.length > 0) {
          selectedIndex = (selectedIndex + 1) % filteredItems.length;
          updateSelectedResult();
        }
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (filteredItems.length > 0) {
          selectedIndex = (selectedIndex - 1 + filteredItems.length) % filteredItems.length;
          updateSelectedResult();
        }
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (filteredItems[selectedIndex]) {
          executePaletteItem(filteredItems[selectedIndex]);
        }
      }
    });
  }

  paletteEl.classList.remove("hidden");
  paletteEl.style.display = "flex";
  const input = paletteEl.querySelector("#commandPaletteInput");
  input.value = "";
  renderPaletteResults();
  setTimeout(() => input.focus(), 20);
}

export function closeCommandPalette() {
  isOpen = false;
  const paletteEl = document.getElementById("commandPaletteModal");
  if (paletteEl) {
    paletteEl.classList.add("hidden");
    paletteEl.style.display = "none";
  }
}

function renderPaletteResults() {
  const input = document.getElementById("commandPaletteInput");
  const resultsContainer = document.getElementById("commandPaletteResults");
  if (!resultsContainer) return;

  const query = (input ? input.value : "").trim().toLowerCase();

  // Combine standard actions with active/saved session jump targets
  const allCandidates = [...commandActions];

  // Also offer quick switching to open tabs
  Object.entries(tabs).forEach(([tabId, t]) => {
    if (t && t.profile) {
      allCandidates.push({
        id: `tab-jump-${tabId}`,
        category: "Open Tabs",
        title: `Switch to: ${t.profile.name || t.profile.host || "Terminal"}`,
        subtitle: `${t.profile.host || ''} (${t.isConnected ? 'Connected' : 'Disconnected'})`,
        icon: "⚡",
        action: () => {
          if (t.activateTabFn) t.activateTabFn(tabId);
        }
      });
    }
  });

  if (!query) {
    filteredItems = allCandidates;
  } else {
    filteredItems = allCandidates.filter(item => {
      const matchTitle = item.title && item.title.toLowerCase().includes(query);
      const matchSub = item.subtitle && item.subtitle.toLowerCase().includes(query);
      const matchCat = item.category && item.category.toLowerCase().includes(query);
      return matchTitle || matchSub || matchCat;
    });
  }

  if (filteredItems.length === 0) {
    resultsContainer.innerHTML = `
      <div class="command-palette-empty">No commands or sessions match "${escapeHtml(query)}"</div>
    `;
    return;
  }

  let html = "";
  let currentCategory = "";

  filteredItems.forEach((item, idx) => {
    if (item.category && item.category !== currentCategory) {
      currentCategory = item.category;
      html += `<div class="command-palette-category">${escapeHtml(currentCategory)}</div>`;
    }
    const isSelected = idx === selectedIndex;
    html += `
      <div class="command-palette-item ${isSelected ? 'selected' : ''}" data-index="${idx}">
        <span class="palette-item-icon">${item.icon || '▸'}</span>
        <div class="palette-item-info">
          <span class="palette-item-title">${escapeHtml(item.title)}</span>
          ${item.subtitle ? `<span class="palette-item-sub">${escapeHtml(item.subtitle)}</span>` : ''}
        </div>
        ${item.shortcut ? `<span class="palette-item-shortcut">${escapeHtml(item.shortcut)}</span>` : ''}
      </div>
    `;
  });

  resultsContainer.innerHTML = html;

  resultsContainer.querySelectorAll(".command-palette-item").forEach(itemEl => {
    itemEl.addEventListener("mouseenter", () => {
      selectedIndex = parseInt(itemEl.dataset.index, 10);
      updateSelectedResult();
    });
    itemEl.addEventListener("click", () => {
      const idx = parseInt(itemEl.dataset.index, 10);
      if (filteredItems[idx]) executePaletteItem(filteredItems[idx]);
    });
  });

  scrollSelectedItemIntoView();
}

function updateSelectedResult() {
  const container = document.getElementById("commandPaletteResults");
  if (!container) return;
  const items = container.querySelectorAll(".command-palette-item");
  items.forEach((item, idx) => {
    item.classList.toggle("selected", idx === selectedIndex);
  });
  scrollSelectedItemIntoView();
}

function scrollSelectedItemIntoView() {
  const container = document.getElementById("commandPaletteResults");
  if (!container) return;
  const selectedEl = container.querySelector(".command-palette-item.selected");
  if (selectedEl) {
    selectedEl.scrollIntoView({ block: "nearest" });
  }
}

function executePaletteItem(item) {
  closeCommandPalette();
  if (typeof item.action === "function") {
    try {
      item.action();
    } catch (err) {
      console.error("Error executing palette command:", err);
    }
  }
}
