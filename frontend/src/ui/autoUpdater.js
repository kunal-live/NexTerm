// ==========================================================================
// NexTerm — In-App Auto-Update Subsystem
// Checks GitHub releases for updates, downloads the new payload,
// and initiates a hot-swap and automatic restart.
// ==========================================================================

import { showModal, hideModal } from "./modal.js";
import { showToast, escapeHtml } from "./notifications.js";

let isChecking = false;
let updateModalOpen = false;

/**
 * Checks for updates against GitHub Releases.
 * @param {boolean} interactive - True if triggered by user click, false if background startup check.
 */
export async function checkForUpdates(interactive = false) {
  if (isChecking) return;
  if (!window.go || !window.go.main || !window.go.main.App || !window.go.main.App.CheckForUpdates) {
    if (interactive) showToast("Update service requires running the compiled desktop app", "info");
    return;
  }

  isChecking = true;
  if (interactive) showToast("Checking for updates...", "info");

  try {
    const info = await window.go.main.App.CheckForUpdates();
    if (info && info.hasUpdate) {
      showUpdateDialog(info);
    } else {
      if (interactive) {
        const curVer = info ? info.currentVersion : "1.3.0";
        showToast(`NexTerm is up to date (v${curVer})`, "success");
      }
    }
  } catch (err) {
    console.warn("[AutoUpdater] Check failed:", err);
    if (interactive) {
      showToast("Could not check for updates: " + (err.message || err), "warning");
    }
  } finally {
    isChecking = false;
  }
}

/**
 * Displays the modal for an available update.
 * @param {object} info - Update details from Go backend.
 */
export function showUpdateDialog(info) {
  if (updateModalOpen) return;
  updateModalOpen = true;

  const notesHtml = info.releaseNotes
    ? escapeHtml(info.releaseNotes).replace(/\n/g, "<br/>")
    : "Bug fixes, security patches, and performance optimizations.";

  const sizeText = info.assetSize > 0
    ? ` (${(info.assetSize / (1024 * 1024)).toFixed(1)} MB)`
    : "";

  const modalHtml = `
    <div class="modal-header update-modal-header" style="background: linear-gradient(135deg, rgba(56, 189, 248, 0.12), rgba(99, 102, 241, 0.12)); padding: 16px 20px; border-bottom: 1px solid rgba(255,255,255,0.08);">
      <div class="modal-title" style="display:flex; align-items:center; gap:10px;">
        <span style="font-size:22px;">⚡</span>
        <div>
          <div style="font-size:15px; font-weight:700; color:#38bdf8; letter-spacing:0.3px;">NexTerm Update Available</div>
          <div style="font-size:11.5px; color:#94a3b8;">A new version is ready to install</div>
        </div>
      </div>
      <button class="modal-close-btn" id="updateCloseBtn" style="color:#94a3b8; font-size:20px; background:none; border:none; cursor:pointer;">&times;</button>
    </div>
    <div class="modal-body" style="padding: 20px;">
      <div style="display:flex; align-items:center; justify-content:space-between; background: rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); border-radius:8px; padding:12px 18px; margin-bottom:16px;">
        <div>
          <span style="font-size:10.5px; text-transform:uppercase; color:#64748b; font-weight:600; letter-spacing:0.5px;">Current Version</span>
          <div style="font-size:13px; font-weight:600; color:#cbd5e1; margin-top:2px;">v${escapeHtml(info.currentVersion)}</div>
        </div>
        <div style="color:#38bdf8; font-size:18px;">➔</div>
        <div>
          <span style="font-size:10.5px; text-transform:uppercase; color:#38bdf8; font-weight:600; letter-spacing:0.5px;">Latest Version</span>
          <div style="font-size:14px; font-weight:700; color:#38bdf8; margin-top:2px;">${escapeHtml(info.latestVersion)}</div>
        </div>
      </div>

      <div style="margin-bottom:14px;">
        <div style="font-size:12px; font-weight:600; color:#f1f5f9; margin-bottom:6px;">Release Notes &amp; Fixes:</div>
        <div style="background:#090d16; border:1px solid #1e293b; border-radius:6px; padding:12px; max-height:140px; overflow-y:auto; font-size:12px; color:#cbd5e1; line-height:1.6; font-family:var(--font-mono, monospace);">
          ${notesHtml}
        </div>
      </div>

      <div id="updateProgressArea" class="hidden" style="margin-top:14px;">
        <div style="display:flex; justify-content:space-between; font-size:11px; color:#38bdf8; margin-bottom:4px;">
          <span id="updateProgressText">Downloading update package...</span>
          <span id="updateProgressPct">Please wait</span>
        </div>
        <div style="height:6px; width:100%; background:#1e293b; border-radius:4px; overflow:hidden;">
          <div id="updateProgressBar" style="height:100%; width:100%; background:linear-gradient(90deg, #38bdf8, #818cf8); border-radius:4px;"></div>
        </div>
      </div>
    </div>
    <div class="modal-footer" style="display:flex; justify-content:space-between; align-items:center; padding:14px 20px; border-top:1px solid rgba(255,255,255,0.06); background: rgba(0,0,0,0.2);">
      <div>
        ${info.htmlURL ? `<a href="${escapeHtml(info.htmlURL)}" target="_blank" style="font-size:11.5px; color:#64748b; text-decoration:none;">View on GitHub ↗</a>` : ''}
      </div>
      <div style="display:flex; gap:10px;">
        <button type="button" class="btn" id="updateLaterBtn" style="background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); color:#cbd5e1; border-radius:6px; padding:7px 14px; font-size:12px; cursor:pointer;">Remind Later</button>
        <button type="button" class="btn btn-primary" id="updateNowBtn" style="background:#0284c7; border:none; color:#fff; border-radius:6px; padding:7px 16px; font-weight:600; font-size:12px; display:inline-flex; align-items:center; gap:6px; cursor:pointer;">
          <span>⚡ Update &amp; Restart${escapeHtml(sizeText)}</span>
        </button>
      </div>
    </div>
  `;

  const box = showModal(modalHtml, "update-modal");

  const cleanup = () => {
    updateModalOpen = false;
    hideModal();
  };

  box.querySelector("#updateCloseBtn")?.addEventListener("click", cleanup);
  box.querySelector("#updateLaterBtn")?.addEventListener("click", cleanup);

  box.querySelector("#updateNowBtn")?.addEventListener("click", async () => {
    const nowBtn = box.querySelector("#updateNowBtn");
    const laterBtn = box.querySelector("#updateLaterBtn");
    const progressArea = box.querySelector("#updateProgressArea");
    const progressText = box.querySelector("#updateProgressText");

    if (nowBtn) nowBtn.disabled = true;
    if (laterBtn) laterBtn.disabled = true;
    if (progressArea) progressArea.classList.remove("hidden");

    try {
      if (progressText) progressText.textContent = "Downloading & staging update binary...";
      showToast("Downloading update... Please wait.", "info");
      await window.go.main.App.ApplyUpdate(info.downloadURL);
      if (progressText) progressText.textContent = "✓ Update applied! Restarting NexTerm...";
      showToast("NexTerm is restarting with the updated version...", "success");
    } catch (err) {
      if (progressText) progressText.textContent = "Update failed: " + (err.message || err);
      showToast("Update failed: " + (err.message || err), "error");
      if (nowBtn) nowBtn.disabled = false;
      if (laterBtn) laterBtn.disabled = false;
    }
  });
}

/**
 * Initializes the background update checker.
 */
export function initAutoUpdater() {
  // Silent check 4.5 seconds after launch
  setTimeout(() => {
    checkForUpdates(false);
  }, 4500);
}
