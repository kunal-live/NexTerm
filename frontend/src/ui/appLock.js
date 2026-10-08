// ==========================================================================
// NexTerm — Application Lock & Idle Auto-Lock
// --------------------------------------------------------------------------
// A UI lock gate on top of the existing master-password mechanism. When a
// master password is set, the app locks on startup and after a period of
// inactivity; unlocking requires App.VerifyMasterPassword.
//
// NOTE: this is a defense-in-depth UI gate for "someone walks up to your
// unlocked desktop" — saved secrets are still protected at rest by the OS
// vault (DPAPI/Keychain). It is not a substitute for OS-level login security.
// ==========================================================================

import { showToast } from "./notifications.js";

const ENABLED_KEY = "nexterm_app_lock_enabled"; // "0" = entire feature off
const IDLE_KEY = "nexterm_idle_lock_min";   // minutes; 0 = disabled
const ONSTART_KEY = "nexterm_lock_on_start"; // "0" to disable lock on startup
const DEFAULT_IDLE_MIN = 15;

let idleTimer = null;
let locked = false;
let listenersBound = false;

function lsGet(k, def) { try { const v = localStorage.getItem(k); return v === null ? def : v; } catch (_) { return def; } }
function lsSet(k, v) { try { localStorage.setItem(k, String(v)); } catch (_) {} }

async function hasAppPassword() {
  try {
    if (window.go && window.go.main && window.go.main.App && window.go.main.App.HasAppPassword) {
      return await window.go.main.App.HasAppPassword();
    }
    // Fallback if backend method not available
    if (window.go && window.go.main && window.go.main.App && window.go.main.App.HasMasterPassword) {
      return await window.go.main.App.HasMasterPassword();
    }
  } catch (_) {}
  return false;
}

async function isAppLockActive() {
  if (!isAppLockEnabled()) return false;
  try {
    if (window.go && window.go.main && window.go.main.App && window.go.main.App.IsAppLockEnabled) {
      const en = await window.go.main.App.IsAppLockEnabled();
      if (!en) return false;
    }
  } catch (_) {}
  return await hasAppPassword();
}

function idleMinutes() {
  const n = parseInt(lsGet(IDLE_KEY, String(DEFAULT_IDLE_MIN)), 10);
  return isNaN(n) || n < 0 ? 0 : n;
}

function formatCooldown(seconds) {
  if (seconds <= 0) return "0s";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s < 10 ? '0' : ''}${s}s`;
}

function injectStyles() {
  if (document.getElementById("nxLockStyles")) return;
  const s = document.createElement("style");
  s.id = "nxLockStyles";
  s.textContent = `
    #nxLockOverlay { position: fixed; inset: 0; z-index: 2147483600; display: flex;
      align-items: center; justify-content: center; background: rgba(6,9,16,0.88);
      backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); }
    #nxLockOverlay .nx-lock-card { width: min(420px, 94vw); background: #0f141f;
      border: 1px solid rgba(255,255,255,0.08); border-radius: 18px; padding: 30px 28px;
      box-shadow: 0 30px 90px rgba(0,0,0,0.65); text-align: center; color: #e2e8f0;
      font-family: var(--font-ui, 'Segoe UI', system-ui, sans-serif); position: relative; }
    #nxLockOverlay .nx-lock-logo { width: 54px; height: 54px; border-radius: 14px; margin: 0 auto 12px;
      display: flex; align-items: center; justify-content: center; font-size: 26px;
      background: linear-gradient(135deg, #1e293b, #0b1220); border: 1px solid rgba(56,189,248,0.4); }
    #nxLockOverlay h2 { margin: 0 0 4px; font-size: 20px; font-weight: 700; color: #f8fafc; }
    #nxLockOverlay p.nx-lock-desc { margin: 0 0 14px; font-size: 13px; color: #94a3b8; }

    .nx-stage-pill { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px;
      border-radius: 20px; font-size: 11px; font-weight: 600; margin-bottom: 14px; }
    .nx-stage-pill.stage-1 { background: rgba(56,189,248,0.12); color: #38bdf8; border: 1px solid rgba(56,189,248,0.25); }
    .nx-stage-pill.stage-2 { background: rgba(245,158,11,0.12); color: #fbbf24; border: 1px solid rgba(245,158,11,0.3); }
    .nx-stage-pill.stage-3 { background: rgba(249,115,22,0.15); color: #fb923c; border: 1px solid rgba(249,115,22,0.35); }
    .nx-stage-pill.stage-4 { background: rgba(239,68,68,0.18); color: #f87171; border: 1px solid rgba(239,68,68,0.45); animation: nxPulseDanger 1.5s infinite; }
    @keyframes nxPulseDanger { 0%,100%{box-shadow:0 0 0 0 rgba(239,68,68,0.3)} 50%{box-shadow:0 0 0 6px rgba(239,68,68,0)} }

    .nx-cooldown-box { background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3);
      border-radius: 10px; padding: 12px; margin-bottom: 16px; color: #fca5a5; font-size: 13px; text-align: center; }
    .nx-cooldown-timer { font-size: 18px; font-weight: 700; font-family: monospace; color: #f87171; margin-top: 4px; }

    #nxLockOverlay input[type=password], #nxLockOverlay input[type=text] {
      width: 100%; box-sizing: border-box; padding: 12px 14px; border-radius: 10px;
      border: 1px solid rgba(255,255,255,0.12); background: #0a0f18; color: #fff;
      font-size: 14px; outline: none; transition: border-color .2s; }
    #nxLockOverlay input[type=password]:focus, #nxLockOverlay input[type=text]:focus { border-color: #38bdf8; }
    #nxLockOverlay input:disabled { opacity: 0.55; cursor: not-allowed; }

    #nxLockOverlay .nx-lock-btn { width: 100%; margin-top: 12px; padding: 12px; border: none; cursor: pointer;
      border-radius: 10px; font-size: 14px; font-weight: 600; color: #06121f;
      background: linear-gradient(135deg, #38bdf8, #6366f1); transition: opacity .2s; }
    #nxLockOverlay .nx-lock-btn:disabled { opacity: 0.5; cursor: not-allowed; filter: grayscale(0.5); }

    #nxLockOverlay .nx-lock-hint { margin-top: 10px; font-size: 12px; color: #64748b; min-height: 16px; }
    #nxLockOverlay .nx-lock-hint.error { color: #f87171; font-weight: 500; }

    #nxLockOverlay .nx-lock-reset-banner { margin-top: 14px; padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.06); }
    #nxLockOverlay .nx-lock-reset-link { color: #fb7185; cursor: pointer; font-size: 12px; font-weight: 600; text-decoration: underline; text-underline-offset: 3px; }
    #nxLockOverlay .nx-lock-reset-link:hover { color: #f43f5e; }

    #nxLockOverlay .nx-lock-foot { margin-top: 12px; font-size: 11px; color: #475569; display: flex; justify-content: center; gap: 12px; }
    #nxLockOverlay .nx-lock-foot a { color: #64748b; cursor: pointer; text-decoration: underline; }
    #nxLockOverlay .nx-lock-shake { animation: nxLockShake .3s; }
    @keyframes nxLockShake { 0%,100%{transform:translateX(0)} 25%{transform:translateX(-8px)} 75%{transform:translateX(8px)} }

    /* Reset & Recovery Modal */
    #nxResetModal { position: fixed; inset: 0; z-index: 2147483620; display: flex; align-items: center; justify-content: center;
      background: rgba(3,7,18,0.88); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); }
    #nxResetModal .nx-reset-card { width: min(480px, 94vw); max-height: 90vh; overflow-y: auto; background: #0f141f;
      border: 1px solid rgba(255,255,255,0.1); border-radius: 18px; padding: 26px; box-shadow: 0 35px 95px rgba(0,0,0,0.7);
      color: #e2e8f0; font-family: var(--font-ui, 'Segoe UI', system-ui, sans-serif); text-align: left; }
    #nxResetModal h2 { margin: 0 0 6px; font-size: 19px; font-weight: 700; color: #fff; text-align: center; }
    #nxResetModal p.nx-sub { margin: 0 0 18px; font-size: 12px; color: #94a3b8; text-align: center; }
    .nx-reset-section { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07);
      border-radius: 12px; padding: 16px; margin-bottom: 16px; }
    .nx-reset-section.danger-border { border-color: rgba(239,68,68,0.3); background: rgba(239,68,68,0.04); }
    .nx-reset-section.info-border { border-color: rgba(56,189,248,0.3); background: rgba(56,189,248,0.04); }
    .nx-reset-title { font-size: 14px; font-weight: 700; margin-bottom: 4px; display: flex; align-items: center; gap: 6px; }
    .nx-reset-desc { font-size: 12px; color: #94a3b8; margin-bottom: 12px; line-height: 1.45; }
    .nx-reset-btn-danger { width: 100%; padding: 10px; border-radius: 8px; border: 1px solid #ef4444; background: #dc2626;
      color: #fff; font-weight: 600; font-size: 13px; cursor: pointer; transition: background .15s; }
    .nx-reset-btn-danger:hover { background: #b91c1c; }
    .nx-reset-btn-primary { width: 100%; padding: 10px; border-radius: 8px; border: none; background: linear-gradient(135deg, #0284c7, #38bdf8);
      color: #031525; font-weight: 600; font-size: 13px; cursor: pointer; margin-top: 10px; }
    .nx-reset-btn-primary:hover { opacity: 0.92; }
    .nx-field-label { display: block; font-size: 11px; font-weight: 600; color: #cbd5e1; margin: 8px 0 3px; }
    .nx-field-input { width: 100%; box-sizing: border-box; padding: 8px 10px; border-radius: 7px;
      border: 1px solid rgba(255,255,255,0.12); background: #070b12; color: #fff; font-size: 13px; outline: none; }
    .nx-field-input:focus { border-color: #38bdf8; }
    .nx-notice-box { padding: 10px 12px; border-radius: 8px; font-size: 12px; line-height: 1.4; margin-top: 6px; }
    .nx-notice-warn { background: rgba(245,158,11,0.12); border: 1px solid rgba(245,158,11,0.3); color: #fde68a; }
    .nx-reset-close { display: block; text-align: center; margin-top: 14px; font-size: 12px; color: #64748b; cursor: pointer; text-decoration: underline; }
  `;
  document.head.appendChild(s);
}

export function isLocked() { return locked; }

/** Returns true when the app-lock feature is turned on in Settings. */
export function isAppLockEnabled() { return lsGet(ENABLED_KEY, "1") !== "0"; }

/** Toggle the entire app-lock feature on or off. */
export function setAppLockEnabled(on) {
  lsSet(ENABLED_KEY, on ? "1" : "0");
  if (!on) {
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  }
}

/** Read current idle-timeout minutes (for settings UI). */
export function getIdleMinutes() { return idleMinutes(); }

/** Read lock-on-startup flag (for settings UI). */
export function isLockOnStartup() { return lsGet(ONSTART_KEY, "1") !== "0"; }

/** Persist idle timeout (for settings UI). */
export function setIdleMinutes(m) { lsSet(IDLE_KEY, m); startIdleWatch(); }

/** Persist lock-on-startup (for settings UI). */
export function setLockOnStartup(on) { lsSet(ONSTART_KEY, on ? "1" : "0"); }

async function getStatus() {
  try {
    if (window.go && window.go.main && window.go.main.App && window.go.main.App.GetAppLockoutStatus) {
      return await window.go.main.App.GetAppLockoutStatus();
    }
    if (window.go && window.go.main && window.go.main.App && window.go.main.App.GetLockoutStatus) {
      return await window.go.main.App.GetLockoutStatus();
    }
  } catch (_) {}
  return {
    isLockedOut: false,
    remainingSeconds: 0,
    currentStage: 1,
    failedAttempts: 0,
    maxAttempts: 5,
    attemptsRemaining: 5,
    hasMasterPassword: true,
    hasAppPassword: true,
    hasHistory: false,
    historyCount: 0,
    isFinalStage: false,
  };
}

export async function lockNow() {
  if (locked) return;
  const active = await isAppLockActive();
  if (!active) {
    const hasPwd = await hasAppPassword();
    if (!hasPwd) {
      showToast("Set an App Password first (Settings → 🔒 App Lock) to enable locking.", "warning");
    } else {
      showToast("App Lock is disabled. Enable it in Settings → 🔒 App Lock.", "info");
    }
    return;
  }
  injectStyles();
  locked = true;
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }

  let countdownInterval = null;

  const el = document.createElement("div");
  el.id = "nxLockOverlay";
  el.innerHTML = `
    <div class="nx-lock-card" role="dialog" aria-modal="true" aria-label="Application locked">
      <div class="nx-lock-logo">🔒</div>
      <h2>NexTerm is locked</h2>
      <p class="nx-lock-desc">Enter your App Password to continue.</p>
      
      <div id="nxLockStageBadge" class="nx-stage-pill stage-1">Loading status...</div>
      
      <div id="nxLockCooldown" class="nx-cooldown-box" style="display:none;">
        <div>Account temporarily locked due to failed attempts</div>
        <div class="nx-cooldown-timer" id="nxLockTimer">00:00</div>
      </div>

      <input type="password" id="nxLockInput" placeholder="App Password" autocomplete="current-password" aria-label="App Password" />
      <button class="nx-lock-btn" id="nxLockBtn">Unlock</button>
      <div class="nx-lock-hint" id="nxLockHint"></div>
      
      <div class="nx-lock-reset-banner">
        <a class="nx-lock-reset-link" id="nxLockResetBtn">Forgot Password? Reset Data / Recover</a>
      </div>

      <div class="nx-lock-foot">
        <a id="nxLockHintLink">Show hint</a>
        <span>·</span>
        <a id="nxLockSettingsLink">Auto-lock settings</a>
      </div>
    </div>`;
  document.body.appendChild(el);

  const input = el.querySelector("#nxLockInput");
  const btn = el.querySelector("#nxLockBtn");
  const hint = el.querySelector("#nxLockHint");
  const badge = el.querySelector("#nxLockStageBadge");
  const cooldownBox = el.querySelector("#nxLockCooldown");
  const timerText = el.querySelector("#nxLockTimer");
  const card = el.querySelector(".nx-lock-card");

  const updateUIFromStatus = (status) => {
    if (!status) return;
    const stage = status.currentStage || 1;
    const remaining = typeof status.attemptsRemaining === "number" ? status.attemptsRemaining : 5;
    const max = status.maxAttempts || 5;

    badge.className = `nx-stage-pill stage-${Math.min(stage, 4)}`;

    if (stage === 1) {
      badge.textContent = `Stage 1 · ${remaining} of ${max} attempts remaining (30s sleep on 5 fails)`;
    } else if (stage === 2) {
      badge.textContent = `Stage 2 · ${remaining} of ${max} attempts remaining (2m sleep on 5 fails)`;
    } else if (stage === 3) {
      badge.textContent = `Stage 3 · ${remaining} of ${max} attempts remaining (30m sleep on 3 fails)`;
    } else {
      badge.textContent = `⚠️ Stage 4 / Final Attempt · 1 attempt left before automatic data wipe & restart`;
    }

    if (status.isLockedOut && status.remainingSeconds > 0) {
      input.disabled = true;
      btn.disabled = true;
      cooldownBox.style.display = "block";
      startCooldownTimer(status.remainingSeconds);
    } else {
      if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
      cooldownBox.style.display = "none";
      input.disabled = false;
      btn.disabled = false;
      setTimeout(() => input && input.focus(), 50);
    }
  };

  const startCooldownTimer = (secondsLeft) => {
    if (countdownInterval) clearInterval(countdownInterval);
    let s = secondsLeft;
    timerText.textContent = formatCooldown(s);

    countdownInterval = setInterval(async () => {
      s--;
      if (s <= 0) {
        clearInterval(countdownInterval);
        countdownInterval = null;
        timerText.textContent = "0s";
        const fresh = await getStatus();
        updateUIFromStatus(fresh);
        hint.textContent = "Cooldown expired. You can try again.";
        hint.classList.remove("error");
      } else {
        timerText.textContent = formatCooldown(s);
      }
    }, 1000);
  };

  // Initial load
  getStatus().then((status) => {
    updateUIFromStatus(status);
  });

  const attempt = async () => {
    const pwd = (input.value || "").trim();
    if (!pwd) { input.focus(); return; }

    try {
      let ok = false;
      if (window.go && window.go.main && window.go.main.App && window.go.main.App.VerifyAppPassword) {
        ok = await window.go.main.App.VerifyAppPassword(pwd);
      } else if (window.go && window.go.main && window.go.main.App && window.go.main.App.VerifyMasterPassword) {
        ok = await window.go.main.App.VerifyMasterPassword(pwd);
      }

      if (ok) {
        if (countdownInterval) clearInterval(countdownInterval);
        el.remove();
        locked = false;
        startIdleWatch();
        showToast("Unlocked", "success");
      } else {
        card.classList.remove("nx-lock-shake"); void card.offsetWidth; card.classList.add("nx-lock-shake");
        input.select();
        const fresh = await getStatus();
        updateUIFromStatus(fresh);
        hint.classList.add("error");
        if (fresh.isLockedOut) {
          hint.textContent = `Too many failed attempts. Cooldown active.`;
        } else if (fresh.currentStage >= 4) {
          hint.textContent = `⚠️ Warning: Last attempt! Wrong password will permanently wipe all server credentials and restart the app.`;
        } else {
          hint.textContent = `Incorrect App Password. ${fresh.attemptsRemaining} attempt(s) remaining in this stage.`;
        }
      }
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      if (msg.includes("SECURITY_WIPE")) {
        // Automatic security wipe triggered on 4th attempt
        if (countdownInterval) clearInterval(countdownInterval);
        card.innerHTML = `
          <div style="font-size:36px;margin-bottom:12px;">🚨</div>
          <h2 style="color:#f87171;">SECURITY WIPE INITIATED</h2>
          <p style="color:#cbd5e1;font-size:13px;line-height:1.5;margin:12px 0 16px;">
            4 failed authentication stages reached.<br>All server credentials, sessions, and keys have been permanently wiped from disk.
          </p>
          <div style="font-size:12px;color:#94a3b8;">Restarting NexTerm...</div>
        `;
        if (window.go && window.go.main && window.go.main.App && window.go.main.App.RestartApp) {
          window.go.main.App.RestartApp().catch(() => {});
        }
        setTimeout(() => window.location.reload(), 1500);
        return;
      }

      card.classList.remove("nx-lock-shake"); void card.offsetWidth; card.classList.add("nx-lock-shake");
      const fresh = await getStatus();
      updateUIFromStatus(fresh);
      hint.classList.add("error");
      hint.textContent = msg;
    }
  };

  btn.onclick = attempt;
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") attempt(); });

  el.querySelector("#nxLockHintLink").onclick = async () => {
    try {
      let h = "";
      if (window.go && window.go.main && window.go.main.App && window.go.main.App.GetAppPasswordHint) {
        h = await window.go.main.App.GetAppPasswordHint();
      } else if (window.go && window.go.main && window.go.main.App && window.go.main.App.GetMasterPasswordHint) {
        h = await window.go.main.App.GetMasterPasswordHint();
      }
      hint.textContent = h ? ("Hint: " + h) : "No hint was set.";
      hint.classList.remove("error");
    } catch (_) { hint.textContent = "No hint available."; }
  };

  el.querySelector("#nxLockSettingsLink").onclick = () => showAutoLockSettings();

  el.querySelector("#nxLockResetBtn").onclick = async () => {
    const status = await getStatus();
    showResetModal(status, () => {
      // Callback on successful unlock or reset
      if (countdownInterval) clearInterval(countdownInterval);
      el.remove();
      locked = false;
      startIdleWatch();
    });
  };
}

function showResetModal(lockoutStatus, onSuccess) {
  injectStyles();
  const existing = document.getElementById("nxResetModal");
  if (existing) existing.remove();

  const wrap = document.createElement("div");
  wrap.id = "nxResetModal";

  const hasHist = !!(lockoutStatus && lockoutStatus.hasHistory && lockoutStatus.historyCount > 0);
  const histCount = lockoutStatus ? (lockoutStatus.historyCount || 0) : 0;

  wrap.innerHTML = `
    <div class="nx-reset-card" role="dialog" aria-modal="true" aria-label="Reset or Recover Master Password">
      <h2>Emergency Reset & Recovery</h2>
      <p class="nx-sub">Choose a recovery or reset option below.</p>

      <!-- Section 1: Factory Reset Fresh Start -->
      <div class="nx-reset-section danger-border">
        <div class="nx-reset-title" style="color:#f87171;">
          <span>🗑️</span> Option 1: Reset All Data & Start Fresh
        </div>
        <div class="nx-reset-desc">
          Permanently delete all server credentials, saved sessions, and master password. NexTerm will be completely restored to a clean, fresh state.
        </div>
        <button class="nx-reset-btn-danger" id="nxBtnWipeAll">Wipe All Data & Give Fresh Page</button>
      </div>

      <!-- Section 2: Recover via Previous Password -->
      <div class="nx-reset-section info-border">
        <div class="nx-reset-title" style="color:#38bdf8;">
          <span>🔑</span> Option 2: Recover via Previous App Password
        </div>
        <div class="nx-reset-desc">
          If you know any of your last 3 App Passwords, you can set a new App Password without losing your saved servers.
        </div>

        ${!hasHist ? `
          <div class="nx-notice-box nx-notice-warn">
            <strong>⚠️ Not Available for New Users</strong><br>
            You have never changed your App Password on this machine (0 previous passwords in history). Recovery with previous passwords is only available if you have previously changed passwords. Please use <strong>Option 1</strong> to wipe and start fresh.
          </div>
        ` : `
          <div style="margin-bottom:8px;font-size:11px;color:#94a3b8;">
            ✓ Password history detected (${histCount} previous password${histCount > 1 ? 's' : ''} saved)
          </div>
          <label class="nx-field-label">Previous App Password (any of last 3):</label>
          <input type="password" class="nx-field-input" id="nxPrevPwd" placeholder="Enter a previous App Password" autocomplete="off" />

          <label class="nx-field-label">New App Password (min 4 characters):</label>
          <input type="password" class="nx-field-input" id="nxNewPwd" placeholder="New App Password" autocomplete="new-password" />

          <label class="nx-field-label">Confirm New App Password:</label>
          <input type="password" class="nx-field-input" id="nxConfirmPwd" placeholder="Confirm new App Password" autocomplete="new-password" />

          <label class="nx-field-label">New Password Hint (optional):</label>
          <input type="text" class="nx-field-input" id="nxNewHint" placeholder="Optional reminder hint" />

          <div id="nxRecoverMsg" style="min-height:16px;margin-top:8px;font-size:12px;"></div>
          <button class="nx-reset-btn-primary" id="nxBtnRecover">Verify & Update App Password</button>
        `}
      </div>

      <a class="nx-reset-close" id="nxBtnCloseReset">Cancel / Back to Lock Screen</a>
    </div>
  `;

  document.body.appendChild(wrap);

  // Close cancel button
  wrap.querySelector("#nxBtnCloseReset").onclick = () => wrap.remove();

  // Option 1: Factory Reset
  wrap.querySelector("#nxBtnWipeAll").onclick = async () => {
    const confirmed = window.confirm(
      "⚠️ ARE YOU SURE?\n\nThis will permanently DELETE all saved server sessions, stored passwords, keys, and master password, returning NexTerm to a clean fresh install.\n\nThis action CANNOT be undone. Proceed?"
    );
    if (!confirmed) return;

    try {
      if (window.go && window.go.main && window.go.main.App && window.go.main.App.ResetAllData) {
        await window.go.main.App.ResetAllData();
      }
      setAppLockEnabled(false);
      showToast("All server credentials and data have been wiped. Resetting...", "info");
      wrap.remove();
      if (onSuccess) onSuccess();
      setTimeout(() => {
        window.location.reload();
      }, 350);
    } catch (err) {
      alert("Reset error: " + (err && err.message ? err.message : err));
    }
  };

  // Option 2: Recover via Previous Password
  if (hasHist) {
    const btnRecover = wrap.querySelector("#nxBtnRecover");
    const prevInput = wrap.querySelector("#nxPrevPwd");
    const newInput = wrap.querySelector("#nxNewPwd");
    const confirmInput = wrap.querySelector("#nxConfirmPwd");
    const hintInput = wrap.querySelector("#nxNewHint");
    const msg = wrap.querySelector("#nxRecoverMsg");

    btnRecover.onclick = async () => {
      const prev = (prevInput.value || "").trim();
      const next = (newInput.value || "").trim();
      const conf = (confirmInput.value || "").trim();
      const h = (hintInput.value || "").trim();

      if (!prev) {
        msg.style.color = "#f87171";
        msg.textContent = "Please enter your previous App Password.";
        prevInput.focus();
        return;
      }
      if (next.length < 4) {
        msg.style.color = "#f87171";
        msg.textContent = "New App Password must be at least 4 characters.";
        newInput.focus();
        return;
      }
      if (next !== conf) {
        msg.style.color = "#f87171";
        msg.textContent = "New password and confirmation do not match.";
        confirmInput.focus();
        return;
      }

      try {
        btnRecover.disabled = true;
        btnRecover.textContent = "Verifying...";
        if (window.go && window.go.main && window.go.main.App && window.go.main.App.ResetAppPasswordWithPrevious) {
          await window.go.main.App.ResetAppPasswordWithPrevious(prev, next, h);
          wrap.remove();
          showToast("App Password updated successfully! App unlocked.", "success");
          if (onSuccess) onSuccess();
        } else if (window.go && window.go.main && window.go.main.App && window.go.main.App.ResetMasterPasswordWithPrevious) {
          await window.go.main.App.ResetMasterPasswordWithPrevious(prev, next, h);
          wrap.remove();
          showToast("Password updated successfully! App unlocked.", "success");
          if (onSuccess) onSuccess();
        } else {
          throw new Error("Password recovery API unavailable.");
        }
      } catch (err) {
        btnRecover.disabled = false;
        btnRecover.textContent = "Verify & Update App Password";
        msg.style.color = "#f87171";
        msg.textContent = err && err.message ? err.message : String(err);
      }
    };
  }
}

function startIdleWatch() {
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  if (!isAppLockEnabled()) return; // feature disabled
  const mins = idleMinutes();
  if (mins <= 0 || locked) return;
  idleTimer = setTimeout(() => { lockNow(); }, mins * 60 * 1000);
}

function resetIdle() {
  if (locked) return;
  if (idleMinutes() <= 0) return;
  startIdleWatch();
}

function bindActivityListeners() {
  if (listenersBound) return;
  listenersBound = true;
  ["mousemove", "mousedown", "keydown", "wheel", "touchstart"].forEach((ev) =>
    window.addEventListener(ev, resetIdle, { passive: true }));
}

export function showAutoLockSettings() {
  injectStyles();
  const existing = document.getElementById("nxLockSettings");
  if (existing) existing.remove();
  const wrap = document.createElement("div");
  wrap.id = "nxLockSettings";
  wrap.style.cssText = "position:fixed;inset:0;z-index:2147483610;display:flex;align-items:center;justify-content:center;background:rgba(2,6,16,0.6);backdrop-filter:blur(4px);";
  const featureOn = isAppLockEnabled();
  const curMin = idleMinutes();
  const onStart = lsGet(ONSTART_KEY, "1") !== "0";
  wrap.innerHTML = `
    <div class="nx-lock-card" style="text-align:left;">
      <h2 style="text-align:center;">Auto-Lock Settings</h2>
      <p style="text-align:center;">Lock NexTerm automatically to protect active terminals and sessions.</p>
      <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:#cbd5e1;margin:8px 0 10px;cursor:pointer;">
        <input type="checkbox" id="nxLockEnabled" ${featureOn ? "checked" : ""} /> <strong>Enable App Lock</strong>
      </label>
      <label style="display:block;font-size:12px;color:#cbd5e1;margin:8px 0 4px;">Idle timeout (minutes, 0 = off)</label>
      <input type="number" id="nxLockIdle" min="0" max="240" value="${curMin}" ${featureOn ? "" : "disabled"} style="width:100%;box-sizing:border-box;padding:9px 11px;border-radius:8px;border:1px solid rgba(255,255,255,0.12);background:#0a0f18;color:#fff;" />
      <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:#cbd5e1;margin-top:12px;cursor:pointer;">
        <input type="checkbox" id="nxLockOnStart" ${onStart ? "checked" : ""} ${featureOn ? "" : "disabled"} /> Lock on startup
      </label>
      <button class="nx-lock-btn" id="nxLockSave" style="margin-top:16px;">Save</button>
      <div class="nx-lock-foot" style="text-align:center;"><a id="nxLockCancel">Cancel</a></div>
    </div>`;
  document.body.appendChild(wrap);
  wrap.querySelector("#nxLockCancel").onclick = () => wrap.remove();
  // Toggle sub-controls when master checkbox changes
  const enabledCb = wrap.querySelector("#nxLockEnabled");
  const idleInput = wrap.querySelector("#nxLockIdle");
  const startCb = wrap.querySelector("#nxLockOnStart");
  enabledCb.onchange = () => {
    idleInput.disabled = !enabledCb.checked;
    startCb.disabled = !enabledCb.checked;
  };
  wrap.querySelector("#nxLockSave").onclick = async () => {
    const on = enabledCb.checked;
    setAppLockEnabled(on);
    if (window.go && window.go.main && window.go.main.App && window.go.main.App.SetAppLockEnabled) {
      try { await window.go.main.App.SetAppLockEnabled(on); } catch (_) {}
    }
    let m = parseInt(idleInput.value, 10);
    if (isNaN(m) || m < 0) m = 0;
    if (m > 240) m = 240;
    lsSet(IDLE_KEY, m);
    lsSet(ONSTART_KEY, startCb.checked ? "1" : "0");
    wrap.remove();
    if (on) {
      startIdleWatch();
      showToast(m > 0 ? `App Lock enabled — auto-lock in ${m} min` : "App Lock enabled (no idle timeout)", "success");
    } else {
      showToast("App Lock & Idle Auto-Lock disabled", "success");
    }
  };
}

// initAppLock wires idle watching and (optionally) locks on startup.
export async function initAppLock() {
  const active = await isAppLockActive();
  if (!active) return; // not enabled or no app password set
  bindActivityListeners();
  if (lsGet(ONSTART_KEY, "1") !== "0") {
    await lockNow();
  } else {
    startIdleWatch();
  }
}
