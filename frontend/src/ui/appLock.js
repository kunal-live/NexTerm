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

async function hasMaster() {
  try {
    if (window.go && window.go.main && window.go.main.App && window.go.main.App.HasMasterPassword) {
      return await window.go.main.App.HasMasterPassword();
    }
  } catch (_) {}
  return false;
}

function idleMinutes() {
  const n = parseInt(lsGet(IDLE_KEY, String(DEFAULT_IDLE_MIN)), 10);
  return isNaN(n) || n < 0 ? 0 : n;
}

function injectStyles() {
  if (document.getElementById("nxLockStyles")) return;
  const s = document.createElement("style");
  s.id = "nxLockStyles";
  s.textContent = `
    #nxLockOverlay { position: fixed; inset: 0; z-index: 2147483600; display: flex;
      align-items: center; justify-content: center; background: rgba(6,9,16,0.86);
      backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); }
    #nxLockOverlay .nx-lock-card { width: min(380px, 92vw); background: #0f141f;
      border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; padding: 28px 26px;
      box-shadow: 0 30px 90px rgba(0,0,0,0.6); text-align: center; color: #e2e8f0;
      font-family: var(--font-ui, 'Segoe UI', system-ui, sans-serif); }
    #nxLockOverlay .nx-lock-logo { width: 52px; height: 52px; border-radius: 13px; margin: 0 auto 14px;
      display: flex; align-items: center; justify-content: center; font-size: 26px;
      background: linear-gradient(135deg, #1e293b, #0b1220); border: 1px solid rgba(56,189,248,0.4); }
    #nxLockOverlay h2 { margin: 0 0 4px; font-size: 18px; font-weight: 700; }
    #nxLockOverlay p { margin: 0 0 18px; font-size: 12px; color: #94a3b8; }
    #nxLockOverlay input[type=password] { width: 100%; box-sizing: border-box; padding: 11px 12px;
      border-radius: 9px; border: 1px solid rgba(255,255,255,0.12); background: #0a0f18; color: #fff;
      font-size: 14px; outline: none; }
    #nxLockOverlay input[type=password]:focus { border-color: #38bdf8; }
    #nxLockOverlay .nx-lock-btn { width: 100%; margin-top: 12px; padding: 11px; border: none; cursor: pointer;
      border-radius: 9px; font-size: 14px; font-weight: 600; color: #06121f;
      background: linear-gradient(135deg, #38bdf8, #6366f1); }
    #nxLockOverlay .nx-lock-hint { margin-top: 12px; font-size: 11px; color: #64748b; min-height: 14px; }
    #nxLockOverlay .nx-lock-foot { margin-top: 16px; font-size: 11px; color: #475569; }
    #nxLockOverlay .nx-lock-foot a { color: #64748b; cursor: pointer; text-decoration: underline; }
    #nxLockOverlay .nx-lock-shake { animation: nxLockShake .3s; }
    @keyframes nxLockShake { 0%,100%{transform:translateX(0)} 25%{transform:translateX(-7px)} 75%{transform:translateX(7px)} }
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
    // Immediately tear down any running idle timer
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

export async function lockNow() {
  if (locked) return;
  if (!isAppLockEnabled()) {
    showToast("App Lock is disabled. Enable it in Settings → Security Policies.", "info");
    return;
  }
  if (!(await hasMaster())) {
    showToast("Set a master password first (Settings → Passwords & Vault) to enable locking.", "warning");
    return;
  }
  injectStyles();
  locked = true;
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }

  const el = document.createElement("div");
  el.id = "nxLockOverlay";
  el.innerHTML = `
    <div class="nx-lock-card" role="dialog" aria-modal="true" aria-label="Application locked">
      <div class="nx-lock-logo">🔒</div>
      <h2>NexTerm is locked</h2>
      <p>Enter your master password to continue.</p>
      <input type="password" id="nxLockInput" placeholder="Master password" autocomplete="current-password" aria-label="Master password" />
      <button class="nx-lock-btn" id="nxLockBtn">Unlock</button>
      <div class="nx-lock-hint" id="nxLockHint"></div>
      <div class="nx-lock-foot"><a id="nxLockHintLink">Show hint</a> &nbsp;·&nbsp; <a id="nxLockSettingsLink">Auto-lock settings</a></div>
    </div>`;
  document.body.appendChild(el);

  const input = el.querySelector("#nxLockInput");
  const hint = el.querySelector("#nxLockHint");
  const card = el.querySelector(".nx-lock-card");
  setTimeout(() => input && input.focus(), 50);

  const attempt = async () => {
    const pwd = (input.value || "").trim();
    if (!pwd) { input.focus(); return; }
    try {
      const ok = window.go && window.go.main && window.go.main.App && window.go.main.App.VerifyMasterPassword
        ? await window.go.main.App.VerifyMasterPassword(pwd) : false;
      if (ok) {
        el.remove();
        locked = false;
        startIdleWatch();
        showToast("Unlocked", "success");
      } else {
        hint.textContent = "Incorrect master password.";
        card.classList.remove("nx-lock-shake"); void card.offsetWidth; card.classList.add("nx-lock-shake");
        input.select();
      }
    } catch (err) {
      hint.textContent = "Unlock error: " + (err && err.message ? err.message : err);
    }
  };

  el.querySelector("#nxLockBtn").onclick = attempt;
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") attempt(); });
  el.querySelector("#nxLockHintLink").onclick = async () => {
    try {
      const h = window.go && window.go.main && window.go.main.App && window.go.main.App.GetMasterPasswordHint
        ? await window.go.main.App.GetMasterPasswordHint() : "";
      hint.textContent = h ? ("Hint: " + h) : "No hint was set.";
    } catch (_) { hint.textContent = "No hint available."; }
  };
  el.querySelector("#nxLockSettingsLink").onclick = () => showAutoLockSettings();
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
      <p style="text-align:center;">Lock NexTerm automatically to protect saved servers.</p>
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
  wrap.querySelector("#nxLockSave").onclick = () => {
    const on = enabledCb.checked;
    setAppLockEnabled(on);
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
  if (!isAppLockEnabled()) return; // feature turned off in Settings
  const has = await hasMaster();
  if (!has) return; // nothing to lock behind
  bindActivityListeners();
  if (lsGet(ONSTART_KEY, "1") !== "0") {
    await lockNow();
  } else {
    startIdleWatch();
  }
}
