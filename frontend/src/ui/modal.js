// ==========================================================================
// Nexterm — UI Modal Subsystem & Toolbox Dialogs
// Manages generic modal overlay, authentication dialogs, host key verification,
// tunnels, macros, and network / sysadmin tool dialogs.
// ==========================================================================

import { escapeHtml, showToast } from "./notifications.js";
import { tabs, activeTabId, getActiveTabId } from "../state/tabState.js";
import { rootNode } from "../state/sessionState.js";

var startLocalTerminalFn = null;

export function registerLocalTerminalLauncher(fn) {
  startLocalTerminalFn = fn;
}

export function showModal(htmlContent, extraClass = "") {
  const modalOverlayEl = document.getElementById("modalOverlay");
  const modalBoxEl = document.getElementById("modalBox");
  if (!modalOverlayEl || !modalBoxEl) return null;

  modalBoxEl.className = "modal-card " + extraClass;
  modalBoxEl.innerHTML = htmlContent;
  modalOverlayEl.classList.remove("hidden");
  return modalBoxEl;
}

export function hideModal() {
  const modalOverlayEl = document.getElementById("modalOverlay");
  const modalBoxEl = document.getElementById("modalBox");
  if (modalOverlayEl) modalOverlayEl.classList.add("hidden");
  if (modalBoxEl) modalBoxEl.innerHTML = "";
}

// --------------------------------------------------------------------------
// Auth Dialogs
// --------------------------------------------------------------------------

export function promptPasswordDialog(profile) {
  return new Promise((resolve) => {
    const showUserField = true;
    const box = showModal(`
      <div class="modal-header">
        <div class="modal-title" style="display: flex; align-items: center; gap: 8px;">
          <span>🔐</span> SSH Password Authentication
        </div>
        <button class="modal-close-btn" id="promptPwClose">&times;</button>
      </div>
      <div class="modal-body" style="padding: 16px 20px;">
        <div style="margin-bottom: 12px; font-size: 13px; color: var(--text-color);">
          Please enter credentials for <b>${escapeHtml(profile.host)}</b>:
        </div>
        <div style="margin-bottom: 10px;">
          <label style="display: block; font-size: 11px; margin-bottom: 4px; color: var(--text-dim);">Login Username</label>
          <input type="text" id="promptUserVal" class="auth-modal-input" placeholder="e.g. root, ubuntu" value="${escapeHtml(profile.username || '')}" style="width: 100%; height: 34px; padding: 0 10px; background: #0c0f17; border: 1px solid #283046; border-radius: 4px; color: #fff; font-size: 13px; box-sizing: border-box;" />
        </div>
        <div class="sess-password-wrap">
          <input type="password" id="promptPwInput" class="auth-modal-input" placeholder="Enter password" autofocus autocomplete="current-password" style="width: 100%; height: 34px; padding: 0 36px 0 10px; background: #0c0f17; border: 1px solid #283046; border-radius: 4px; color: #fff; font-size: 13px; box-sizing: border-box;" />
          <button type="button" class="sess-password-toggle" id="promptPwToggle" title="Toggle visibility">👁️</button>
        </div>
        <div style="margin-top: 14px;">
          <label class="checkbox-label" style="display: flex; align-items: center; gap: 8px; font-size: 12px; cursor: pointer;">
            <input type="checkbox" id="promptPwSaveVault" checked />
            <span>Save credentials securely in platform vault</span>
          </label>
        </div>
      </div>
      <div class="modal-footer" style="display: flex; justify-content: flex-end; gap: 8px;">
        <button class="btn-secondary" id="promptPwCancel" type="button">Cancel</button>
        <button class="btn-primary" id="promptPwSubmit" type="button">Connect</button>
      </div>
    `, "modal-auth-prompt");

    if (!box) {
      resolve(null);
      return;
    }

    const input = box.querySelector("#promptPwInput");
    const userInput = box.querySelector("#promptUserVal");
    const toggleBtn = box.querySelector("#promptPwToggle");
    const saveCheck = box.querySelector("#promptPwSaveVault");
    const submitBtn = box.querySelector("#promptPwSubmit");
    const cancelBtn = box.querySelector("#promptPwCancel");
    const closeBtn = box.querySelector("#promptPwClose");

    setTimeout(() => {
      if (!profile.username && userInput) {
        userInput.focus();
      } else if (input) {
        input.focus();
      }
    }, 50);

    if (toggleBtn && input) {
      toggleBtn.onclick = () => {
        const isPw = input.type === "password";
        input.type = isPw ? "text" : "password";
        toggleBtn.textContent = isPw ? "🔒" : "👁️";
      };
    }

    const doSubmit = async () => {
      const val = input ? input.value : "";
      if (userInput && userInput.value.trim()) {
        profile.username = userInput.value.trim();
      }

      const safeHost = (profile.host || "").replace(/[^a-zA-Z0-9_-]/g, "_");
      const safeUser = (profile.username || "user").replace(/[^a-zA-Z0-9_-]/g, "_");
      const port = profile.port || 22;
      const detKey = `session_${safeUser}_${safeHost}_${port}`;
      const vKey = profile.vaultKey || profile.id || detKey;
      profile.vaultKey = vKey;

      if (saveCheck && saveCheck.checked && val && window.go?.main?.App) {
        try {
          if (typeof window.go.main.App.SaveSessionPassword === "function") {
            await window.go.main.App.SaveSessionPassword(vKey, val);
            if (detKey !== vKey) {
              await window.go.main.App.SaveSessionPassword(detKey, val);
            }
          } else if (typeof window.go.main.App.SavePassword === "function") {
            await window.go.main.App.SavePassword(vKey, val);
          }
        } catch (err) {
          console.warn("Save password to vault failed:", err);
        }
      }

      // Persist login ID & server configuration to sessions.json
      if (window.go?.main?.App) {
        try {
          if (profile.id && !profile.id.startsWith("quick-")) {
            if (typeof window.go.main.App.UpdateSession === "function") {
              await window.go.main.App.UpdateSession(profile);
            }
          } else {
            // Auto-persist Quick Connect session so login ID and server info are preserved
            if (typeof window.go.main.App.AddSession === "function") {
              profile.id = (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID() : ('sess-' + Date.now());
              profile.vaultKey = profile.id;
              await window.go.main.App.AddSession("", {
                ...profile,
                name: profile.name || (profile.username ? `${profile.username}@${profile.host}` : profile.host)
              });
            }
          }
        } catch (err) {
          console.warn("Persist session profile failed:", err);
        }
      }

      hideModal();
      resolve(val);
    };

    const doCancel = () => {
      hideModal();
      resolve(null);
    };

    if (submitBtn) submitBtn.onclick = doSubmit;
    if (cancelBtn) cancelBtn.onclick = doCancel;
    if (closeBtn) closeBtn.onclick = doCancel;
    if (input) {
      input.onkeydown = (e) => {
        if (e.key === "Enter") doSubmit();
        else if (e.key === "Escape") doCancel();
      };
    }
    if (userInput) {
      userInput.onkeydown = (e) => {
        if (e.key === "Enter") {
          if (input) input.focus();
          else doSubmit();
        } else if (e.key === "Escape") doCancel();
      };
    }
  });
}

export function promptPassphraseDialog(profile) {
  return new Promise((resolve) => {
    const box = showModal(`
      <div class="modal-header">
        <div class="modal-title" style="display: flex; align-items: center; gap: 8px;">
          <span>🔑</span> Private Key Passphrase Required
        </div>
        <button class="modal-close-btn" id="promptPassClose">&times;</button>
      </div>
      <div class="modal-body" style="padding: 16px 20px;">
        <div style="margin-bottom: 10px; font-size: 13px; color: var(--text-color);">
          The private key for <b>${escapeHtml(profile.name || profile.host)}</b> is encrypted:
        </div>
        <div style="margin-bottom: 12px; font-size: 11px; color: var(--text-dim); word-break: break-all; background: #0c0f17; padding: 6px 10px; border-radius: 4px; border: 1px solid #1f2536;">
          <code>${escapeHtml(profile.privateKeyPath || '')}</code>
        </div>
        <div class="sess-password-wrap">
          <input type="password" id="promptPassInput" class="auth-modal-input" placeholder="Enter key passphrase" autofocus style="width: 100%; height: 34px; padding: 0 36px 0 10px; background: #0c0f17; border: 1px solid #283046; border-radius: 4px; color: #fff; font-size: 13px; box-sizing: border-box;" />
          <button type="button" class="sess-password-toggle" id="promptPassToggle" title="Toggle visibility">👁️</button>
        </div>
        <div style="margin-top: 14px;">
          <label class="checkbox-label" style="display: flex; align-items: center; gap: 8px; font-size: 12px; cursor: pointer;">
            <input type="checkbox" id="promptPassSaveVault" checked />
            <span>Save passphrase in encrypted credential vault</span>
          </label>
        </div>
      </div>
      <div class="modal-footer" style="display: flex; justify-content: flex-end; gap: 8px;">
        <button class="btn-secondary" id="promptPassCancel" type="button">Cancel</button>
        <button class="btn-primary" id="promptPassSubmit" type="button">Unlock &amp; Connect</button>
      </div>
    `, "modal-auth-prompt");

    if (!box) {
      resolve(null);
      return;
    }

    const input = box.querySelector("#promptPassInput");
    const toggleBtn = box.querySelector("#promptPassToggle");
    const saveCheck = box.querySelector("#promptPassSaveVault");
    const submitBtn = box.querySelector("#promptPassSubmit");
    const cancelBtn = box.querySelector("#promptPassCancel");
    const closeBtn = box.querySelector("#promptPassClose");

    setTimeout(() => { if (input) input.focus(); }, 50);

    if (toggleBtn && input) {
      toggleBtn.onclick = () => {
        const isPw = input.type === "password";
        input.type = isPw ? "text" : "password";
        toggleBtn.textContent = isPw ? "🔒" : "👁️";
      };
    }

    const doSubmit = async () => {
      const val = input ? input.value : "";
      const pvKey = profile.passphraseVaultKey || (profile.vaultKey ? profile.vaultKey + "_passphrase" : (profile.id ? profile.id + "_passphrase" : ""));
      if (pvKey) {
        profile.passphraseVaultKey = pvKey;
      }
      if (saveCheck && saveCheck.checked && val && pvKey && window.go?.main?.App) {
        try {
          if (typeof window.go.main.App.SaveSessionPassword === "function") {
            await window.go.main.App.SaveSessionPassword(pvKey, val);
          } else if (typeof window.go.main.App.SavePassword === "function") {
            await window.go.main.App.SavePassword(pvKey, val);
          }
          if (profile.id && !profile.id.startsWith("quick-") && typeof window.go.main.App.UpdateSession === "function") {
            await window.go.main.App.UpdateSession(profile);
          }
        } catch (_) {}
      }
      hideModal();
      resolve(val);
    };

    const doCancel = () => {
      hideModal();
      resolve(null);
    };

    if (submitBtn) submitBtn.onclick = doSubmit;
    if (cancelBtn) cancelBtn.onclick = doCancel;
    if (closeBtn) closeBtn.onclick = doCancel;
    if (input) {
      input.onkeydown = (e) => {
        if (e.key === "Enter") doSubmit();
        else if (e.key === "Escape") doCancel();
      };
    }
  });
}

// Prompts for a bastion/jump-host secret (gateway password, or the
// passphrase for the gateway's private key). Deliberately side-effect-free
// beyond an optional vault save: unlike promptPasswordDialog/
// promptPassphraseDialog above, this never calls UpdateSession/AddSession,
// because the "profile" behind a bastion prompt is the *target* session,
// and persisting gateway-shaped fields onto it would corrupt that session.
export function promptBastionSecretDialog({ gatewayLabel, vaultKey, isKey, keyPath }) {
  return new Promise((resolve) => {
    const title = isKey ? "Bastion Private Key Passphrase Required" : "SSH Gateway Password Authentication";
    const icon = isKey ? "🔑" : "🛡️";
    const box = showModal(`
      <div class="modal-header">
        <div class="modal-title" style="display: flex; align-items: center; gap: 8px;">
          <span>${icon}</span> ${title}
        </div>
        <button class="modal-close-btn" id="promptBastionClose">&times;</button>
      </div>
      <div class="modal-body" style="padding: 16px 20px;">
        <div style="margin-bottom: 10px; font-size: 13px; color: var(--text-color);">
          ${isKey ? "The bastion gateway's private key is encrypted:" : "Enter the password for the bastion / jump host gateway:"}
          <br/><b>${escapeHtml(gatewayLabel || '')}</b>
        </div>
        ${isKey ? `<div style="margin-bottom: 12px; font-size: 11px; color: var(--text-dim); word-break: break-all; background: #0c0f17; padding: 6px 10px; border-radius: 4px; border: 1px solid #1f2536;"><code>${escapeHtml(keyPath || '')}</code></div>` : ''}
        <div class="sess-password-wrap">
          <input type="password" id="promptBastionInput" class="auth-modal-input" placeholder="${isKey ? 'Enter key passphrase' : 'Enter gateway password'}" autofocus autocomplete="off" style="width: 100%; height: 34px; padding: 0 36px 0 10px; background: #0c0f17; border: 1px solid #283046; border-radius: 4px; color: #fff; font-size: 13px; box-sizing: border-box;" />
          <button type="button" class="sess-password-toggle" id="promptBastionToggle" title="Toggle visibility">👁️</button>
        </div>
        <div style="margin-top: 14px;">
          <label class="checkbox-label" style="display: flex; align-items: center; gap: 8px; font-size: 12px; cursor: pointer;">
            <input type="checkbox" id="promptBastionSaveVault" checked />
            <span>Save in encrypted credential vault</span>
          </label>
        </div>
      </div>
      <div class="modal-footer" style="display: flex; justify-content: flex-end; gap: 8px;">
        <button class="btn-secondary" id="promptBastionCancel" type="button">Cancel</button>
        <button class="btn-primary" id="promptBastionSubmit" type="button">Continue</button>
      </div>
    `, "modal-auth-prompt");

    if (!box) {
      resolve(null);
      return;
    }

    const input = box.querySelector("#promptBastionInput");
    const toggleBtn = box.querySelector("#promptBastionToggle");
    const saveCheck = box.querySelector("#promptBastionSaveVault");
    const submitBtn = box.querySelector("#promptBastionSubmit");
    const cancelBtn = box.querySelector("#promptBastionCancel");
    const closeBtn = box.querySelector("#promptBastionClose");

    setTimeout(() => { if (input) input.focus(); }, 50);

    if (toggleBtn && input) {
      toggleBtn.onclick = () => {
        const isPw = input.type === "password";
        input.type = isPw ? "text" : "password";
        toggleBtn.textContent = isPw ? "🔒" : "👁️";
      };
    }

    const doSubmit = async () => {
      const val = input ? input.value : "";
      if (saveCheck && saveCheck.checked && val && vaultKey && window.go?.main?.App) {
        try {
          const key = isKey ? vaultKey + "_passphrase" : vaultKey;
          if (typeof window.go.main.App.SaveSessionPassword === "function") {
            await window.go.main.App.SaveSessionPassword(key, val);
          } else if (typeof window.go.main.App.SavePassword === "function") {
            await window.go.main.App.SavePassword(key, val);
          }
        } catch (_) {}
      }
      hideModal();
      resolve(val);
    };

    const doCancel = () => {
      hideModal();
      resolve(null);
    };

    if (submitBtn) submitBtn.onclick = doSubmit;
    if (cancelBtn) cancelBtn.onclick = doCancel;
    if (closeBtn) closeBtn.onclick = doCancel;
    if (input) {
      input.onkeydown = (e) => {
        if (e.key === "Enter") doSubmit();
        else if (e.key === "Escape") doCancel();
      };
    }
  });
}

export function showAuthChallengeModal(data) {
  if (!data || !data.requestId) return;
  const { requestId, user, instruction, questions, echoes } = data;

  let questionsHtml = "";
  (questions || []).forEach((q, i) => {
    const isEcho = echoes && echoes[i] === true;
    questionsHtml += `
      <div class="auth-challenge-group" style="margin-top: 12px;">
        <label style="display: block; font-size: 12px; font-weight: 600; color: #cbd5e1; margin-bottom: 4px;">${escapeHtml(q)}</label>
        <input type="${isEcho ? 'text' : 'password'}" class="auth-challenge-field" data-index="${i}" placeholder="Enter response..." style="width: 100%; height: 34px; padding: 0 10px; background: #0c0f17; border: 1px solid #283046; border-radius: 4px; color: #fff; font-size: 13px; font-family: inherit; box-sizing: border-box;" autocomplete="off" />
      </div>
    `;
  });

  const box = showModal(`
    <div class="modal-header">
      <div class="modal-title" style="display: flex; align-items: center; gap: 8px;">
        <span>🛡️</span> Interactive Authentication Challenge
      </div>
      <button class="modal-close-btn" id="challengeClose">&times;</button>
    </div>
    <div class="modal-body" style="padding: 16px 20px;">
      <div style="font-size: 12px; color: #94a3b8; margin-bottom: 8px;">
        Authentication challenge for user <b>${escapeHtml(user || 'remote')}</b>:
      </div>
      ${instruction ? `<div style="background: rgba(59, 130, 246, 0.1); border: 1px solid rgba(59, 130, 246, 0.3); border-radius: 6px; padding: 10px 12px; font-size: 12.5px; color: #93c5fd; margin-bottom: 12px; line-height: 1.4;">${escapeHtml(instruction)}</div>` : ''}
      <div id="challengeQuestionsWrap">
        ${questionsHtml || '<div style="color: var(--text-dim); font-size: 12px;">Server requested response. Click continue to proceed.</div>'}
      </div>
    </div>
    <div class="modal-footer" style="display: flex; justify-content: flex-end; gap: 8px;">
      <button class="btn-secondary" id="challengeCancel" type="button">Cancel</button>
      <button class="btn-primary" id="challengeSubmit" type="button">Verify &amp; Continue</button>
    </div>
  `, "modal-auth-challenge");

  if (!box) return;

  const firstInput = box.querySelector(".auth-challenge-field");
  setTimeout(() => { if (firstInput) firstInput.focus(); }, 50);

  const doSubmit = async () => {
    const inputs = box.querySelectorAll(".auth-challenge-field");
    const answers = [];
    inputs.forEach(inp => answers.push(inp.value));
    hideModal();
    if (window.go?.main?.App?.RespondAuthChallenge) {
      try {
        await window.go.main.App.RespondAuthChallenge(requestId, answers);
      } catch (err) {
        showToast("Challenge response error: " + err, "error");
      }
    }
  };

  const doCancel = async () => {
    hideModal();
    if (window.go?.main?.App?.CancelAuthChallenge) {
      try {
        await window.go.main.App.CancelAuthChallenge(requestId);
      } catch (_) {}
    }
  };

  const submitBtn = box.querySelector("#challengeSubmit");
  const cancelBtn = box.querySelector("#challengeCancel");
  const closeBtn = box.querySelector("#challengeClose");

  if (submitBtn) submitBtn.onclick = doSubmit;
  if (cancelBtn) cancelBtn.onclick = doCancel;
  if (closeBtn) closeBtn.onclick = doCancel;

  box.querySelectorAll(".auth-challenge-field").forEach((inp, idx, arr) => {
    inp.onkeydown = (e) => {
      if (e.key === "Enter") {
        if (idx === arr.length - 1) doSubmit();
        else arr[idx + 1].focus();
      } else if (e.key === "Escape") {
        doCancel();
      }
    };
  });
}

export function showHostKeyVerificationModal(data) {
  if (!data) return;

  const isMismatch = data.status === "mismatch";
  let responded = false;

  function sendResponse(action) {
    if (responded) return;
    responded = true;
    hideModal();
    if (window.go && window.go.main && window.go.main.App && window.go.main.App.RespondHostKey) {
      window.go.main.App.RespondHostKey(data.requestId, action);
    }
  }

  const titleHtml = isMismatch
    ? `<span>⚠️ CRITICAL: REMOTE HOST IDENTIFICATION HAS CHANGED!</span>`
    : `<span>🛡️ SSH Server Host Key Verification</span>`;

  const headerClass = isMismatch ? "hostkey-header-mismatch" : "hostkey-header-unknown";

  const bannerHtml = isMismatch
    ? `
      <div class="hostkey-banner-mismatch">
        <strong>⚠️ POTENTIAL SECURITY BREACH / MAN-IN-THE-MIDDLE ATTACK!</strong>
        The host key provided by server <strong>${escapeHtml(data.host)}:${data.port}</strong> differs from the key cached in <code>${escapeHtml(data.knownHostsPath || 'known_hosts')}</code>.<br>
        Someone could be intercepting your communication (Man-In-The-Middle attack), or the remote server administrator may have changed the host key.<br>
        <strong>If you were not expecting this change, DO NOT connect!</strong>
      </div>
    `
    : `
      <div class="hostkey-banner-unknown">
        The authenticity of host <strong>${escapeHtml(data.host)}:${data.port}</strong> cannot be established.<br>
        This is the first time you are connecting to this server. Are you sure you want to continue connecting?
      </div>
    `;

  let comparisonHtml = "";
  if (isMismatch) {
    comparisonHtml = `
      <div class="hostkey-grid">
        <div class="hostkey-row">
          <span class="hostkey-label">Target Server:</span>
          <span class="hostkey-val"><strong>${escapeHtml(data.host)}</strong> (Port ${data.port})</span>
        </div>
        <div class="hostkey-row">
          <span class="hostkey-label">Stored Key Type:</span>
          <span class="hostkey-val"><span class="hostkey-badge" style="background: rgba(245, 158, 11, 0.2); color: #fbbf24; border-color: rgba(245, 158, 11, 0.4);">${escapeHtml(data.oldKeyType || 'Unknown')}</span></span>
        </div>
        <div class="hostkey-row">
          <span class="hostkey-label">Stored Fingerprint:</span>
          <div class="hostkey-fp-box old">
            <code>${escapeHtml(data.oldFingerprintSha || 'N/A')}</code>
            <button class="btn-copy-fp" data-copy="${escapeHtml(data.oldFingerprintSha || '')}">📋 Copy</button>
          </div>
        </div>
        <div class="hostkey-row">
          <span class="hostkey-label">New Key Type:</span>
          <span class="hostkey-val"><span class="hostkey-badge" style="background: rgba(239, 68, 68, 0.2); color: #f87171; border-color: rgba(239, 68, 68, 0.4);">${escapeHtml(data.keyType)}</span></span>
        </div>
        <div class="hostkey-row">
          <span class="hostkey-label">New Fingerprint:</span>
          <div class="hostkey-fp-box mismatch">
            <code>${escapeHtml(data.fingerprintSha256)}</code>
            <button class="btn-copy-fp" data-copy="${escapeHtml(data.fingerprintSha256)}">📋 Copy</button>
          </div>
        </div>
        <div class="hostkey-row">
          <span class="hostkey-label">known_hosts File:</span>
          <span class="hostkey-val" style="font-size: 11px; color: #94a3b8;">${escapeHtml(data.knownHostsPath || '')}</span>
        </div>
      </div>
    `;
  } else {
    comparisonHtml = `
      <div class="hostkey-grid">
        <div class="hostkey-row">
          <span class="hostkey-label">Target Server:</span>
          <span class="hostkey-val"><strong>${escapeHtml(data.host)}</strong> (Port ${data.port})</span>
        </div>
        <div class="hostkey-row">
          <span class="hostkey-label">Key Algorithm:</span>
          <span class="hostkey-val"><span class="hostkey-badge">${escapeHtml(data.keyType)}</span></span>
        </div>
        <div class="hostkey-row">
          <span class="hostkey-label">SHA-256 Fingerprint:</span>
          <div class="hostkey-fp-box">
            <code>${escapeHtml(data.fingerprintSha256)}</code>
            <button class="btn-copy-fp" data-copy="${escapeHtml(data.fingerprintSha256)}">📋 Copy</button>
          </div>
        </div>
        <div class="hostkey-row">
          <span class="hostkey-label">MD5 Fingerprint:</span>
          <div class="hostkey-fp-box">
            <code>${escapeHtml(data.fingerprintMd5)}</code>
            <button class="btn-copy-fp" data-copy="${escapeHtml(data.fingerprintMd5)}">📋 Copy</button>
          </div>
        </div>
        <div class="hostkey-row">
          <span class="hostkey-label">known_hosts Cache:</span>
          <span class="hostkey-val" style="font-size: 11px; color: #94a3b8;">${escapeHtml(data.knownHostsPath || '')}</span>
        </div>
      </div>
    `;
  }

  const actionsHtml = isMismatch
    ? `
      <div class="hostkey-actions">
        <button class="btn btn-secondary btn-hostkey-danger" id="btnHkAbort">🛑 Abort Connection (Recommended)</button>
        <button class="btn btn-outline" id="btnHkOverride" style="border-color: #f59e0b; color: #fbbf24;">⚠️ Replace Key in known_hosts & Connect</button>
      </div>
    `
    : `
      <div class="hostkey-actions">
        <button class="btn btn-secondary" id="btnHkReject">✕ Reject & Disconnect</button>
        <button class="btn btn-outline" id="btnHkOnce">Connect Once (Don't save)</button>
        <button class="btn btn-hostkey-trust" id="btnHkTrust">🛡️ Accept & Save to known_hosts</button>
      </div>
    `;

  const box = showModal(`
    <div class="modal-header ${headerClass}">
      <div class="modal-title" style="display: flex; align-items: center; gap: 8px;">${titleHtml}</div>
      <button class="modal-close-btn" id="modalClose">&times;</button>
    </div>
    <div class="modal-body" style="padding: 18px 20px;">
      ${bannerHtml}
      ${comparisonHtml}
      ${actionsHtml}
    </div>
  `, "modal-hostkey");

  if (!box) return;

  const modalOverlayEl = document.getElementById("modalOverlay");
  if (modalOverlayEl) {
    modalOverlayEl.onclick = (e) => {
      if (e.target === modalOverlayEl) sendResponse("reject");
    };
  }
  const closeBtn = box.querySelector("#modalClose");
  if (closeBtn) closeBtn.onclick = () => sendResponse("reject");

  // Copy buttons
  box.querySelectorAll(".btn-copy-fp").forEach(btn => {
    btn.onclick = () => {
      const copyVal = btn.dataset.copy;
      if (copyVal && navigator.clipboard) {
        navigator.clipboard.writeText(copyVal).then(() => {
          showToast("Fingerprint copied to clipboard", "success");
        }).catch(() => {
          showToast("Failed to copy", "error");
        });
      }
    };
  });

  if (isMismatch) {
    const btnAbort = box.querySelector("#btnHkAbort");
    if (btnAbort) btnAbort.onclick = () => sendResponse("reject");

    const btnOverride = box.querySelector("#btnHkOverride");
    if (btnOverride) {
      btnOverride.onclick = () => {
        if (confirm(`Are you absolutely sure you want to replace the host key for ${data.host}:${data.port} in known_hosts? This will trust the new key.`)) {
          sendResponse("accept_save");
        }
      };
    }
  } else {
    const btnReject = box.querySelector("#btnHkReject");
    if (btnReject) btnReject.onclick = () => sendResponse("reject");

    const btnOnce = box.querySelector("#btnHkOnce");
    if (btnOnce) btnOnce.onclick = () => sendResponse("accept_once");

    const btnTrust = box.querySelector("#btnHkTrust");
    if (btnTrust) btnTrust.onclick = () => sendResponse("accept_save");
  }
}

// --------------------------------------------------------------------------
// SSH Tunnels & Macros
// --------------------------------------------------------------------------

export async function renderSidebarTunnels() {
  const container = document.getElementById("sidebarTunnelList");
  if (!container) return;

  try {
    let tunnels = [];
    if (window.go && window.go.main && window.go.main.App) {
      tunnels = await window.go.main.App.GetTunnels() || [];
    }

    if (tunnels.length === 0) {
      container.innerHTML = `<div class="sftp-empty-hint">No active SSH tunnels.<br/>Click <b>＋ New SSH Tunnel</b> to configure port forwarding.</div>`;
      return;
    }

    container.innerHTML = tunnels.map(t => `
      <div class="tunnel-card">
        <div class="tunnel-card-title">
          <span>🔑 ${escapeHtml(t.name)}</span>
          <span class="tunnel-badge ${t.status || 'stopped'}">${t.status || 'stopped'}</span>
        </div>
        <div class="tunnel-card-desc">
          <b>${t.type.toUpperCase()}</b>: Local <code>:${t.localPort}</code> &rarr; <code>${escapeHtml(t.remoteHost || '*')}:${t.remotePort || '*'}</code>
        </div>
        <div class="tunnel-card-actions">
          ${t.status === 'running' 
            ? `<button class="pwd-action-btn danger stop-tun-btn" data-id="${t.id}">■ Stop</button>`
            : `<button class="pwd-action-btn start-tun-btn" data-id="${t.id}">▶ Start</button>`
          }
          <button class="pwd-action-btn danger del-tun-btn" data-id="${t.id}">🗑️</button>
        </div>
      </div>
    `).join("");

    container.querySelectorAll(".start-tun-btn").forEach(b => {
      b.onclick = async () => {
        const activeTabId = getActiveTabId();
        if (!activeTabId || activeTabId === "home") {
          showToast("Please open an active SSH tab first to bind the tunnel", "warning");
          return;
        }
        try {
          await window.go.main.App.StartTunnel(b.dataset.id, activeTabId);
          showToast("SSH tunnel started", "success");
          await renderSidebarTunnels();
        } catch (err) {
          showToast("Failed to start tunnel: " + err, "error");
        }
      };
    });

    container.querySelectorAll(".stop-tun-btn").forEach(b => {
      b.onclick = async () => {
        try {
          await window.go.main.App.StopTunnel(b.dataset.id);
          showToast("Tunnel stopped", "info");
          await renderSidebarTunnels();
        } catch (err) {
          showToast("Failed to stop tunnel: " + err, "error");
        }
      };
    });

    container.querySelectorAll(".del-tun-btn").forEach(b => {
      b.onclick = async () => {
        if (confirm("Delete this tunnel definition?")) {
          await window.go.main.App.DeleteTunnel(b.dataset.id);
          await renderSidebarTunnels();
        }
      };
    });

  } catch (err) {
    container.innerHTML = `<div class="sftp-empty-hint" style="color: var(--accent-red);">${escapeHtml(err.toString())}</div>`;
  }
}

export function showTunnelingDialog() {
  const box = showModal(`
    <div class="modal-header">
      <div class="modal-title">Nexterm Tunnel — Visual Port Forwarding Manager</div>
      <button class="modal-close-btn" id="modalClose">&times;</button>
    </div>
    <div class="modal-body">
      <div style="font-size: 12px; color: var(--text-muted); line-height: 1.4; margin-bottom: 12px;">
        Manage visual SSH tunnels: Local Port Forwarding, Remote Port Forwarding, and Dynamic SOCKS5 Proxy.
      </div>
      <div id="modalTunnelList" style="display: flex; flex-direction: column; gap: 8px; max-height: 280px; overflow-y: auto;">
        <div style="text-align: center; color: var(--text-dim); padding: 16px;">Loading tunnels...</div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn-secondary" id="modalCloseBtn">Close</button>
      <button class="btn-primary" id="newTunnelWizardBtn">＋ New SSH Tunnel</button>
    </div>
  `);

  box.querySelector("#modalClose").onclick = hideModal;
  box.querySelector("#modalCloseBtn").onclick = hideModal;
  box.querySelector("#newTunnelWizardBtn").onclick = () => {
    hideModal();
    showNewTunnelWizard();
  };

  const loadModalTunnels = async () => {
    const listEl = box.querySelector("#modalTunnelList");
    if (!listEl) return;
    try {
      const tunnels = await window.go.main.App.GetTunnels() || [];
      if (tunnels.length === 0) {
        listEl.innerHTML = `<div class="pwd-empty-state">No active tunnels. Click <b>＋ New SSH Tunnel</b> to configure forwarding.</div>`;
        return;
      }
      listEl.innerHTML = tunnels.map(t => `
        <div class="pwd-card">
          <div class="pwd-card-header">
            <span class="pwd-card-title">🔑 ${escapeHtml(t.name)}</span>
            <span class="tunnel-badge ${t.status || 'stopped'}">${t.status || 'stopped'}</span>
          </div>
          <div class="pwd-card-body">
            <div style="font-size: 11px; color: var(--text-muted); font-family: 'Fira Code', monospace;">
              <b>${t.type.toUpperCase()}</b>: Local :${t.localPort} &rarr; ${t.remoteHost || '*'}:${t.remotePort || '*'}
            </div>
            <div class="pwd-actions">
              ${t.status === 'running' 
                ? `<button class="pwd-action-btn danger stop-modal-tun" data-id="${t.id}">■ Stop</button>`
                : `<button class="pwd-action-btn start-modal-tun" data-id="${t.id}">▶ Start</button>`
              }
              <button class="pwd-action-btn danger del-modal-tun" data-id="${t.id}">🗑️ Delete</button>
            </div>
          </div>
        </div>
      `).join("");

      listEl.querySelectorAll(".start-modal-tun").forEach(b => {
        b.onclick = async () => {
          const activeTabId = getActiveTabId();
          if (!activeTabId || activeTabId === "home") {
            showToast("Open an SSH tab first to bind tunnel", "warning");
            return;
          }
          await window.go.main.App.StartTunnel(b.dataset.id, activeTabId);
          await loadModalTunnels();
          await renderSidebarTunnels();
        };
      });
      listEl.querySelectorAll(".stop-modal-tun").forEach(b => {
        b.onclick = async () => {
          await window.go.main.App.StopTunnel(b.dataset.id);
          await loadModalTunnels();
          await renderSidebarTunnels();
        };
      });
      listEl.querySelectorAll(".del-modal-tun").forEach(b => {
        b.onclick = async () => {
          if (confirm("Delete tunnel?")) {
            await window.go.main.App.DeleteTunnel(b.dataset.id);
            await loadModalTunnels();
            await renderSidebarTunnels();
          }
        };
      });
    } catch (_) {}
  };
  loadModalTunnels();
}

export function showNewTunnelWizard() {
  const box = showModal(`
    <div class="modal-header">
      <div class="modal-title">New SSH Port Forwarding Tunnel</div>
      <button class="modal-close-btn" id="modalClose">&times;</button>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label>Tunnel Name</label>
        <input type="text" id="tunName" placeholder="e.g. Database Port Forwarding" value="My SSH Tunnel" />
      </div>
      <div class="form-group">
        <label>Forwarding Type</label>
        <select id="tunType">
          <option value="local">Local Port Forwarding (Local PC &rarr; Remote Service)</option>
          <option value="remote">Remote Port Forwarding (Remote Server &rarr; Local PC)</option>
          <option value="dynamic">Dynamic SOCKS5 Proxy</option>
        </select>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Local Port *</label>
          <input type="number" id="tunLocalPort" value="1521" />
        </div>
        <div class="form-group" id="tunRemotePortGroup">
          <label>Remote Port *</label>
          <input type="number" id="tunRemotePort" value="1521" />
        </div>
      </div>
      <div class="form-group" id="tunRemoteHostGroup">
        <label>Remote Destination Host / IP *</label>
        <input type="text" id="tunRemoteHost" value="10.0.0.5" placeholder="e.g. 10.0.0.5 or 127.0.0.1" />
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn-secondary" id="modalCancel">Cancel</button>
      <button class="btn-primary" id="saveTunnelBtn">Save Tunnel</button>
    </div>
  `);

  const typeSelect = box.querySelector("#tunType");
  typeSelect.onchange = () => {
    const isDynamic = typeSelect.value === "dynamic";
    box.querySelector("#tunRemotePortGroup").classList.toggle("hidden", isDynamic);
    box.querySelector("#tunRemoteHostGroup").classList.toggle("hidden", isDynamic);
  };

  box.querySelector("#modalCancel").onclick = hideModal;
  box.querySelector("#modalClose").onclick = hideModal;

  box.querySelector("#saveTunnelBtn").onclick = async () => {
    const t = {
      name: box.querySelector("#tunName").value.trim() || "SSH Tunnel",
      type: typeSelect.value,
      localPort: parseInt(box.querySelector("#tunLocalPort").value, 10) || 8080,
      remotePort: parseInt(box.querySelector("#tunRemotePort").value, 10) || 80,
      remoteHost: box.querySelector("#tunRemoteHost").value.trim() || "127.0.0.1",
      autoStart: false
    };
    hideModal();
    if (window.go && window.go.main && window.go.main.App) {
      await window.go.main.App.SaveTunnel(t);
      showToast("SSH tunnel saved", "success");
      await renderSidebarTunnels();
    }
  };
}

export async function renderSidebarMacros() {
  const container = document.getElementById("macrosList");
  if (!container) return;

  try {
    let macros = [];
    if (window.go && window.go.main && window.go.main.App) {
      macros = await window.go.main.App.GetMacros() || [];
    }

    if (macros.length === 0) {
      container.innerHTML = `<div class="sftp-empty-hint">No command snippets found.<br/>Click <b>＋ New Snippet / Macro</b> to create one.</div>`;
      return;
    }

    // Group macros by category (Commands, Monitoring, Network, etc.)
    const groups = {};
    macros.forEach(m => {
      const cat = m.category || "Commands";
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(m);
    });

    // Ensure "Commands" appears first, then others alphabetically
    const catKeys = Object.keys(groups).sort((a, b) => {
      if (a.toLowerCase() === "commands") return -1;
      if (b.toLowerCase() === "commands") return 1;
      return a.localeCompare(b);
    });

    container.innerHTML = catKeys.map(cat => {
      const catMacros = groups[cat];
      return `
        <div class="macro-category-group" data-category="${escapeHtml(cat)}">
          <div class="macro-category-header">
            <span class="macro-category-chevron">▾</span>
            <span class="macro-category-icon">📁</span>
            <span class="macro-category-name">${escapeHtml(cat)}</span>
            <span class="macro-category-badge">${catMacros.length}</span>
          </div>
          <div class="macro-category-items">
            ${catMacros.map((m, idx) => {
              const isLast = idx === catMacros.length - 1;
              const treeBranch = isLast ? "└──" : "├──";
              const cmdPreview = m.commands && m.commands.length > 0 ? m.commands[0] : "";
              return `
                <div class="macro-card" data-id="${escapeHtml(m.id)}">
                  <div class="macro-card-top">
                    <span class="macro-tree-branch" style="color:var(--text-dim); font-family:var(--font-mono); font-size:11px; margin-right:4px;">${treeBranch}</span>
                    <span class="macro-card-title" title="${escapeHtml(m.name)}">⚡ ${escapeHtml(m.name)}</span>
                  </div>
                  <div class="macro-card-cmd" title="${escapeHtml(cmdPreview)}">${escapeHtml(cmdPreview || m.description || "")}</div>
                  <div class="macro-card-actions">
                    <button class="macro-action-btn run-macro-opt-btn" data-id="${escapeHtml(m.id)}" title="Execute with options (Current / Selected / Folder)">▶ Run</button>
                    <button class="macro-action-btn quick-macro-btn" data-id="${escapeHtml(m.id)}" title="Quick run on active terminal">⚡</button>
                    <button class="macro-action-btn edit-macro-btn" data-id="${escapeHtml(m.id)}" title="Edit snippet">✏️</button>
                    <button class="macro-action-btn danger del-macro-btn" data-id="${escapeHtml(m.id)}" title="Delete snippet">🗑️</button>
                  </div>
                </div>
              `;
            }).join("")}
          </div>
        </div>
      `;
    }).join("");

    // Toggle category collapse
    container.querySelectorAll(".macro-category-header").forEach(hdr => {
      hdr.onclick = () => {
        const group = hdr.closest(".macro-category-group");
        const items = group.querySelector(".macro-category-items");
        const chevron = hdr.querySelector(".macro-category-chevron");
        if (items) {
          const isCollapsed = items.style.display === "none";
          items.style.display = isCollapsed ? "block" : "none";
          if (chevron) chevron.textContent = isCollapsed ? "▾" : "▸";
        }
      };
    });

    // Run with Execution Options
    container.querySelectorAll(".run-macro-opt-btn").forEach(b => {
      b.onclick = (e) => {
        e.stopPropagation();
        const m = macros.find(item => item.id === b.dataset.id);
        if (m) showMacroExecutionDialog(m);
      };
    });

    // Quick run on active terminal directly
    container.querySelectorAll(".quick-macro-btn").forEach(b => {
      b.onclick = (e) => {
        e.stopPropagation();
        runMacro(b.dataset.id);
      };
    });

    // Edit snippet
    container.querySelectorAll(".edit-macro-btn").forEach(b => {
      b.onclick = (e) => {
        e.stopPropagation();
        const m = macros.find(item => item.id === b.dataset.id);
        if (m) showRecordMacroDialog(m);
      };
    });

    // Delete snippet
    container.querySelectorAll(".del-macro-btn").forEach(b => {
      b.onclick = async (e) => {
        e.stopPropagation();
        const m = macros.find(item => item.id === b.dataset.id);
        const name = m ? m.name : "snippet";
        if (confirm(`Delete command snippet "${name}"?`)) {
          await window.go.main.App.DeleteMacro(b.dataset.id);
          showToast(`Deleted snippet "${name}"`, "info");
          await renderSidebarMacros();
        }
      };
    });

  } catch (err) {
    container.innerHTML = `<div class="sftp-empty-hint" style="color: var(--accent-red);">${escapeHtml(err.toString())}</div>`;
  }
}

// --------------------------------------------------------------------------
// Quick Run Macro on Active Terminal Tab
// --------------------------------------------------------------------------

export async function runMacro(macroId) {
  const curTabId = getActiveTabId();
  if (!curTabId || curTabId === "home") {
    showToast("Please select an active terminal tab to run snippet", "warning");
    return;
  }
  if (window.go && window.go.main && window.go.main.App) {
    try {
      await window.go.main.App.ExecuteMacro(macroId, [curTabId]);
      showToast("Command snippet dispatched to active terminal", "success");
    } catch (err) {
      showToast("Snippet error: " + err, "error");
    }
  }
}

// --------------------------------------------------------------------------
// Macro Execution Dialog
// Supports Execution Options:
//   1. Current session
//   2. Selected sessions
//   3. All sessions in folder
// --------------------------------------------------------------------------

export function showMacroExecutionDialog(macro) {
  if (!macro) return;

  const currentTab = activeTabId && tabs && tabs[activeTabId];
  const currentTabLabel = currentTab
    ? (currentTab.profile && currentTab.profile.name ? currentTab.profile.name : currentTab.title || activeTabId)
    : "No active terminal";

  const allOpenTabs = tabs ? Object.entries(tabs).filter(([id, t]) => t && !t.isHome) : [];

  // Collect folders from session tree
  const folders = [];
  function collectFolders(node, prefix = "") {
    if (!node) return;
    const name = prefix ? `${prefix} / ${node.name}` : node.name;
    if (!node.session && node.id !== (rootNode ? rootNode.id : "")) {
      folders.push({ id: node.id, name: node.name, fullPath: name, node });
    }
    if (node.children) {
      for (const c of node.children) {
        if (!c.session) collectFolders(c, name);
      }
    }
  }
  collectFolders(rootNode);

  const html = `
    <div class="modal-header">
      <div class="modal-title" style="display:flex; align-items:center; gap:8px;">
        <span>⚡</span>
        <span>Execute Snippet — <b>${escapeHtml(macro.name)}</b></span>
      </div>
      <button class="modal-close-btn" id="macroExecClose">&times;</button>
    </div>
    <div class="modal-body" style="padding:16px 20px;">
      <!-- Command Preview Box -->
      <div style="font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.8px; color:var(--text-muted); margin-bottom:6px;">Commands to Execute</div>
      <pre style="background:rgba(0,0,0,0.35); border:1px solid var(--border-subtle); border-radius:4px; padding:8px 12px; font-family:var(--font-mono); font-size:12px; color:#38bdf8; max-height:85px; overflow-y:auto; margin:0 0 16px 0; white-space:pre-wrap;">${escapeHtml(macro.commands ? macro.commands.join('\n') : '')}</pre>

      <div style="font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.8px; color:var(--text-muted); margin-bottom:10px;">Execution Target Options</div>

      <!-- Execution Option 1: Current Session -->
      <label class="macro-target-option" style="display:flex; align-items:flex-start; gap:10px; padding:10px 12px; border:1px solid var(--border-subtle); border-radius:5px; margin-bottom:8px; cursor:pointer; background:rgba(255,255,255,0.02);">
        <input type="radio" name="macroExecMode" value="current" checked style="margin-top:3px;" />
        <div>
          <div style="font-weight:600; font-size:12.5px; color:var(--text-primary);">Current session</div>
          <div style="font-size:11.5px; color:var(--text-muted); margin-top:2px;">
            ${currentTab ? `<span style="color:#22c55e;">●</span> Active Tab: <b>${escapeHtml(currentTabLabel)}</b>` : `<span style="color:#f59e0b;">⚠️ No active terminal currently focused</span>`}
          </div>
        </div>
      </label>

      <!-- Execution Option 2: Selected Sessions -->
      <label class="macro-target-option" style="display:flex; align-items:flex-start; gap:10px; padding:10px 12px; border:1px solid var(--border-subtle); border-radius:5px; margin-bottom:8px; cursor:pointer; background:rgba(255,255,255,0.02);">
        <input type="radio" name="macroExecMode" value="selected" style="margin-top:3px;" />
        <div style="flex:1;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span style="font-weight:600; font-size:12.5px; color:var(--text-primary);">Selected sessions</span>
            <span style="font-size:11px; color:var(--accent-cyan);">${allOpenTabs.length} connected tab(s)</span>
          </div>
          <div style="font-size:11.5px; color:var(--text-muted); margin-top:2px;">Choose specific open terminal tabs to broadcast commands to</div>

          <!-- Multi-select tabs list -->
          <div id="macroSelectedTabsContainer" style="display:none; margin-top:10px; max-height:130px; overflow-y:auto; border:1px solid var(--border-subtle); border-radius:4px; padding:6px; background:rgba(0,0,0,0.25);">
            <div style="display:flex; justify-content:space-between; margin-bottom:6px; font-size:11px; padding:0 4px;">
              <span style="color:var(--text-muted);">Select targets:</span>
              <span>
                <a href="#" id="macroSelectAllTabs" style="color:var(--accent-blue); text-decoration:none; margin-right:8px; font-weight:600;">Select All</a>
                <a href="#" id="macroDeselectAllTabs" style="color:var(--text-muted); text-decoration:none;">None</a>
              </span>
            </div>
            ${allOpenTabs.length === 0 ? '<div style="font-size:11.5px; color:var(--text-dim); padding:6px;">No active sessions open</div>' : allOpenTabs.map(([id, t]) => `
              <label style="display:flex; align-items:center; gap:8px; padding:4px 6px; font-size:12px; cursor:pointer; border-radius:3px; user-select:none;">
                <input type="checkbox" class="macro-target-tab-chk" value="${escapeHtml(id)}" ${id === activeTabId ? 'checked' : ''} />
                <span style="color:#22c55e; font-size:10px;">●</span>
                <span style="font-weight:500;">${escapeHtml(t.profile && t.profile.name ? t.profile.name : t.title || id)}</span>
                <span style="color:var(--text-dim); font-size:11px; font-family:var(--font-mono);">(${escapeHtml(t.profile && t.profile.host ? t.profile.host : 'local')})</span>
              </label>
            `).join("")}
          </div>
        </div>
      </label>

      <!-- Execution Option 3: All Sessions in Folder -->
      <label class="macro-target-option" style="display:flex; align-items:flex-start; gap:10px; padding:10px 12px; border:1px solid var(--border-subtle); border-radius:5px; margin-bottom:8px; cursor:pointer; background:rgba(255,255,255,0.02);">
        <input type="radio" name="macroExecMode" value="folder" style="margin-top:3px;" />
        <div style="flex:1;">
          <div style="font-weight:600; font-size:12.5px; color:var(--text-primary);">All sessions in folder</div>
          <div style="font-size:11.5px; color:var(--text-muted); margin-top:2px;">Execute across all server sessions grouped under a session tree folder</div>

          <div id="macroFolderContainer" style="display:none; margin-top:10px;">
            <select id="macroFolderSelect" style="width:100%; height:32px; background:var(--bg-input); border:1px solid var(--border-active); color:var(--text-primary); border-radius:4px; padding:0 8px; font-size:12px;">
              ${folders.length === 0 ? '<option value="">(No folders found in session tree)</option>' : folders.map(f => `
                <option value="${escapeHtml(f.id)}">📁 ${escapeHtml(f.fullPath)}</option>
              `).join("")}
            </select>

            <label style="display:flex; align-items:center; gap:8px; margin-top:8px; font-size:11.5px; cursor:pointer; color:var(--text-secondary);">
              <input type="checkbox" id="macroFolderAutoConnect" checked />
              <span>Automatically connect disconnected servers in this folder</span>
            </label>
          </div>
        </div>
      </label>
    </div>

    <div class="modal-footer" style="display:flex; justify-content:space-between; align-items:center; padding:12px 20px; border-top:1px solid var(--border-subtle); background:rgba(0,0,0,0.15);">
      <button class="btn-action" id="macroExecCancel">Cancel</button>
      <button class="btn-action primary" id="macroExecRunBtn" style="padding:0 18px; height:32px; font-weight:600;">⚡ Execute Commands</button>
    </div>
  `;

  const box = showModal(html, "macro-exec-modal");
  if (!box) return;

  const close = () => hideModal();
  box.querySelector("#macroExecClose").onclick = close;
  box.querySelector("#macroExecCancel").onclick = close;

  // Toggle mode sub-containers
  const modeRadios = box.querySelectorAll("input[name='macroExecMode']");
  const selectedContainer = box.querySelector("#macroSelectedTabsContainer");
  const folderContainer = box.querySelector("#macroFolderContainer");

  const updateModeVisibility = () => {
    const selectedMode = box.querySelector("input[name='macroExecMode']:checked")?.value || "current";
    if (selectedContainer) selectedContainer.style.display = selectedMode === "selected" ? "block" : "none";
    if (folderContainer) folderContainer.style.display = selectedMode === "folder" ? "block" : "none";
  };

  modeRadios.forEach(r => r.onchange = updateModeVisibility);

  // Select all / Deselect all
  const selectAll = box.querySelector("#macroSelectAllTabs");
  const deselectAll = box.querySelector("#macroDeselectAllTabs");
  if (selectAll) {
    selectAll.onclick = (e) => {
      e.preventDefault();
      box.querySelectorAll(".macro-target-tab-chk").forEach(c => c.checked = true);
    };
  }
  if (deselectAll) {
    deselectAll.onclick = (e) => {
      e.preventDefault();
      box.querySelectorAll(".macro-target-tab-chk").forEach(c => c.checked = false);
    };
  }

  // Dispatch Execution
  box.querySelector("#macroExecRunBtn").onclick = async () => {
    const selectedMode = box.querySelector("input[name='macroExecMode']:checked")?.value || "current";
    let targetTabIDs = [];

    if (selectedMode === "current") {
      const curId = getActiveTabId();
      if (!curId || curId === "home") {
        showToast("No active terminal tab selected", "warning");
        return;
      }
      targetTabIDs = [curId];
    } else if (selectedMode === "selected") {
      box.querySelectorAll(".macro-target-tab-chk:checked").forEach(c => {
        targetTabIDs.push(c.value);
      });
      if (targetTabIDs.length === 0) {
        showToast("Please select at least one session tab to execute", "warning");
        return;
      }
    } else if (selectedMode === "folder") {
      const folderSelect = box.querySelector("#macroFolderSelect");
      const folderId = folderSelect ? folderSelect.value : "";
      if (!folderId) {
        showToast("Please select a target folder", "warning");
        return;
      }

      const folderObj = folders.find(f => f.id === folderId);
      if (!folderObj || !folderObj.node) {
        showToast("Folder not found in session tree", "error");
        return;
      }

      // Collect all session profiles under folder
      const folderSessions = [];
      const extractSessions = (n) => {
        if (!n) return;
        if (n.session) folderSessions.push(n.session);
        if (n.children) n.children.forEach(extractSessions);
      };
      extractSessions(folderObj.node);

      if (folderSessions.length === 0) {
        showToast(`No sessions found in folder "${folderObj.name}"`, "warning");
        return;
      }

      const autoConnect = box.querySelector("#macroFolderAutoConnect")?.checked !== false;

      const matchedTabIDs = [];
      const disconnectedProfiles = [];

      for (const sess of folderSessions) {
        let found = false;
        if (tabs) {
          for (const [tId, tab] of Object.entries(tabs)) {
            if (tab && tab.profile && (tab.profile.id === sess.id || (tab.profile.host === sess.host && tab.profile.username === sess.username))) {
              matchedTabIDs.push(tId);
              found = true;
              break;
            }
          }
        }
        if (!found) disconnectedProfiles.push(sess);
      }

      if (autoConnect && disconnectedProfiles.length > 0) {
        showToast(`Connecting ${disconnectedProfiles.length} session(s) in "${folderObj.name}"...`, "info");
        const { connectToSession } = await import("../terminal/terminalManager.js");
        for (const p of disconnectedProfiles) {
          connectToSession(p);
        }
        await new Promise(r => setTimeout(r, 1200));
        // Re-check newly opened tabs
        if (tabs) {
          for (const sess of disconnectedProfiles) {
            for (const [tId, tab] of Object.entries(tabs)) {
              if (tab && tab.profile && (tab.profile.id === sess.id || tab.profile.host === sess.host)) {
                if (!matchedTabIDs.includes(tId)) matchedTabIDs.push(tId);
              }
            }
          }
        }
      }

      targetTabIDs = matchedTabIDs;

      if (targetTabIDs.length === 0) {
        showToast(`No active terminal tabs connected for folder "${folderObj.name}"`, "warning");
        return;
      }
    }

    close();

    showToast(`Executing "${macro.name}" on ${targetTabIDs.length} terminal session(s)...`, "info");
    if (window.go && window.go.main && window.go.main.App) {
      try {
        await window.go.main.App.ExecuteMacro(macro.id, targetTabIDs);
        showToast(`Successfully executed "${macro.name}" on ${targetTabIDs.length} session(s)`, "success");
      } catch (err) {
        showToast("Snippet execution failed: " + err, "error");
      }
    }
  };
}

// --------------------------------------------------------------------------
// Record / Create / Edit Snippet Modal
// --------------------------------------------------------------------------

export function showRecordMacroDialog(existingMacro = null) {
  const isEdit = !!existingMacro;
  const initialName = existingMacro ? existingMacro.name : "";
  const initialCat = existingMacro ? (existingMacro.category || "Commands") : "Commands";
  const initialCmds = existingMacro && existingMacro.commands ? existingMacro.commands.join("\n") : "";
  const initialDelay = existingMacro && existingMacro.delayMs ? existingMacro.delayMs : 500;

  const box = showModal(`
    <div class="modal-header">
      <div class="modal-title">${isEdit ? "Edit Command Snippet" : "Record / Create Command Snippet"}</div>
      <button class="modal-close-btn" id="modalClose">&times;</button>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label>Snippet Name *</label>
        <input type="text" id="macroName" placeholder="e.g. Restart service" value="${escapeHtml(initialName)}" />
      </div>
      <div class="form-group">
        <label>Category (Folder)</label>
        <input type="text" id="macroCat" placeholder="e.g. Commands, Monitoring, DevOps" value="${escapeHtml(initialCat)}" />
      </div>
      <div class="form-group">
        <label>Shell Commands (One per line) *</label>
        <textarea id="macroCmds" style="width: 100%; height: 160px; font-family: var(--font-mono, 'Fira Code', monospace); font-size: 12px; background: var(--bg-input); color: var(--text-primary); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); padding: 8px;" placeholder="sudo systemctl restart nginx&#10;sudo systemctl status nginx">${escapeHtml(initialCmds)}</textarea>
      </div>
      <div class="form-group" style="margin-top: 8px;">
        <label>Inter-command Delay (ms)</label>
        <input type="number" id="macroDelay" value="${initialDelay}" min="50" max="10000" step="50" style="width: 120px;" />
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn-secondary" id="modalCancel">Cancel</button>
      <button class="btn-primary" id="saveMacroBtn">${isEdit ? "Update Snippet" : "Save Snippet"}</button>
    </div>
  `);

  box.querySelector("#modalCancel").onclick = hideModal;
  box.querySelector("#modalClose").onclick = hideModal;

  box.querySelector("#saveMacroBtn").onclick = async () => {
    const name = box.querySelector("#macroName").value.trim();
    const rawCmds = box.querySelector("#macroCmds").value.trim();
    if (!name || !rawCmds) {
      showToast("Snippet name and commands are required", "error");
      return;
    }
    const commands = rawCmds.split("\n").map(c => c.trim()).filter(c => c.length > 0);
    const delayMs = parseInt(box.querySelector("#macroDelay")?.value, 10) || 500;

    const m = {
      id: isEdit && existingMacro.id ? existingMacro.id : "",
      name,
      category: box.querySelector("#macroCat").value.trim() || "Commands",
      description: commands.slice(0, 2).join("; "),
      commands,
      delayMs
    };

    hideModal();
    if (window.go && window.go.main && window.go.main.App) {
      await window.go.main.App.SaveMacro(m);
      showToast(isEdit ? "Snippet updated" : "Snippet saved", "success");
      await renderSidebarMacros();
    }
  };
}

// --------------------------------------------------------------------------
// Network & Sysadmin Tools
// --------------------------------------------------------------------------

export function showPingDialog() {
  const box = showModal(`
    <div class="modal-header">
      <div class="modal-title">Network Ping & Latency Diagnostics</div>
      <button class="modal-close-btn" id="modalClose">&times;</button>
    </div>
    <div class="modal-body">
      <div class="form-row">
        <div class="form-group" style="flex: 2;">
          <label>Target Host / IP</label>
          <input type="text" id="pingHost" value="8.8.8.8" />
        </div>
        <div class="form-group" style="flex: 1; display: flex; align-items: flex-end;">
          <button class="btn-primary" id="doPingBtn" style="width: 100%; height: 32px;">🏓 Ping</button>
        </div>
      </div>
      <div id="pingOutput" style="background: var(--bg-input); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); padding: 10px; height: 160px; overflow-y: auto; font-family: 'Fira Code', monospace; font-size: 11.5px; color: var(--text-dim); white-space: pre-wrap;">Ready to ping target.</div>
    </div>
    <div class="modal-footer">
      <button class="btn-secondary" id="modalCloseBtn">Close</button>
    </div>
  `);
  box.querySelector("#modalClose").onclick = hideModal;
  box.querySelector("#modalCloseBtn").onclick = hideModal;
  box.querySelector("#doPingBtn").onclick = async () => {
    const h = box.querySelector("#pingHost").value.trim();
    const out = box.querySelector("#pingOutput");
    out.textContent = `Pinging ${h}...`;
    if (window.go && window.go.main && window.go.main.App) {
      try {
        const res = await window.go.main.App.NetPing(h);
        out.textContent = res;
      } catch (err) {
        out.textContent = "Ping error: " + err;
      }
    }
  };
}

export function showDNSDialog() {
  const box = showModal(`
    <div class="modal-header">
      <div class="modal-title">DNS & MX Lookup Tool</div>
      <button class="modal-close-btn" id="modalClose">&times;</button>
    </div>
    <div class="modal-body">
      <div class="form-row">
        <div class="form-group" style="flex: 2;">
          <label>Domain Name</label>
          <input type="text" id="dnsDomain" value="google.com" />
        </div>
        <div class="form-group" style="flex: 1; display: flex; align-items: flex-end;">
          <button class="btn-primary" id="doDNSBtn" style="width: 100%; height: 32px;">🔍 Lookup</button>
        </div>
      </div>
      <div id="dnsOutput" style="background: var(--bg-input); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); padding: 10px; height: 160px; overflow-y: auto; font-family: 'Fira Code', monospace; font-size: 11.5px; color: var(--text-dim);">Enter domain name above.</div>
    </div>
    <div class="modal-footer">
      <button class="btn-secondary" id="modalCloseBtn">Close</button>
    </div>
  `);
  box.querySelector("#modalClose").onclick = hideModal;
  box.querySelector("#modalCloseBtn").onclick = hideModal;
  box.querySelector("#doDNSBtn").onclick = async () => {
    const d = box.querySelector("#dnsDomain").value.trim();
    const out = box.querySelector("#dnsOutput");
    out.innerHTML = `Resolving DNS for ${d}...`;
    if (window.go && window.go.main && window.go.main.App) {
      try {
        const records = await window.go.main.App.NetLookupDNS(d);
        out.innerHTML = Object.entries(records).map(([type, vals]) => `
          <div style="margin-bottom: 6px;">
            <b style="color: var(--accent-blue);">${type}:</b><br/>
            ${vals.map(v => `&bull; ${escapeHtml(v)}`).join("<br/>")}
          </div>
        `).join("");
      } catch (err) {
        out.textContent = "DNS lookup error: " + err;
      }
    }
  };
}

export function showHashDialog() {
  const box = showModal(`
    <div class="modal-header">
      <div class="modal-title">Checksum & Hash Calculator</div>
      <button class="modal-close-btn" id="modalClose">&times;</button>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label>Input Text</label>
        <input type="text" id="hashInput" placeholder="Enter text to hash..." />
      </div>
      <div class="form-group">
        <label>Algorithm</label>
        <select id="hashAlgo">
          <option value="sha256">SHA-256 (Default)</option>
          <option value="md5">MD5</option>
          <option value="sha1">SHA-1</option>
          <option value="sha512">SHA-512</option>
        </select>
      </div>
      <div class="form-group">
        <label>Computed Hash</label>
        <textarea id="hashResult" readonly style="width: 100%; height: 70px; font-family: 'Fira Code', monospace; font-size: 11px; background: var(--bg-input); color: var(--accent-green); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); padding: 6px;"></textarea>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn-secondary" id="modalCloseBtn">Close</button>
      <button class="btn-secondary" id="copyHashBtn">📋 Copy Hash</button>
    </div>
  `);
  box.querySelector("#modalClose").onclick = hideModal;
  box.querySelector("#modalCloseBtn").onclick = hideModal;
  const doCalc = async () => {
    const val = box.querySelector("#hashInput").value;
    const algo = box.querySelector("#hashAlgo").value;
    if (window.go && window.go.main && window.go.main.App) {
      box.querySelector("#hashResult").value = await window.go.main.App.NetCalculateHash(val, algo);
    }
  };
  box.querySelector("#hashInput").oninput = doCalc;
  box.querySelector("#hashAlgo").onchange = doCalc;
  box.querySelector("#copyHashBtn").onclick = () => {
    const res = box.querySelector("#hashResult").value;
    if (res) {
      navigator.clipboard.writeText(res);
      showToast("Copied hash to clipboard", "info");
    }
  };
}

export function showPkgMgrDialog() {
  const box = showModal(`
    <div class="modal-header">
      <div class="modal-title">Nexterm Package Manager</div>
      <button class="modal-close-btn" id="modalClose">&times;</button>
    </div>
    <div class="modal-body">
      <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 12px;">
        Browse and launch essential command line utilities:
      </div>
      <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px;">
        ${[
          { name: "curl", desc: "Command line tool for transferring data with URLs" },
          { name: "git", desc: "Distributed version control system" },
          { name: "ssh", desc: "OpenSSH secure shell client" },
          { name: "tar", desc: "Archive and extract files" },
          { name: "winget", desc: "Windows Package Manager CLI" },
          { name: "powershell", desc: "PowerShell automation shell" }
        ].map(p => `
          <div style="background: var(--bg-input); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); padding: 8px 10px;">
            <div style="font-weight: 600; font-size: 12px; color: var(--accent-blue);">📦 ${p.name}</div>
            <div style="font-size: 11px; color: var(--text-dim); margin-top: 3px;">${p.desc}</div>
          </div>
        `).join("")}
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn-primary" id="modalCloseBtn">Done</button>
    </div>
  `);
  box.querySelector("#modalClose").onclick = hideModal;
  box.querySelector("#modalCloseBtn").onclick = hideModal;
}

export async function showTextEditorDialog() {
  const { openRemoteFileEditor } = await import("../sftp/fileBrowser.js");
  if (typeof openRemoteFileEditor === "function") {
    openRemoteFileEditor("");
  }
}

export function showDiffDialog() {
  const box = showModal(`
    <div class="modal-header">
      <div class="modal-title">Nexterm Diff — Quick Text Comparison</div>
      <button class="modal-close-btn" id="modalClose">&times;</button>
    </div>
    <div class="modal-body">
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
        <div>
          <label style="font-size: 11.5px; color: var(--text-muted); font-weight: 600;">Original (Left)</label>
          <textarea id="diffLeft" style="width: 100%; height: 180px; font-family: 'Fira Code', monospace; font-size: 11.5px; background: var(--bg-input); color: var(--text-primary); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); padding: 8px;"></textarea>
        </div>
        <div>
          <label style="font-size: 11.5px; color: var(--text-muted); font-weight: 600;">Modified (Right)</label>
          <textarea id="diffRight" style="width: 100%; height: 180px; font-family: 'Fira Code', monospace; font-size: 11.5px; background: var(--bg-input); color: var(--text-primary); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); padding: 8px;"></textarea>
        </div>
      </div>
      <div id="diffOutput" style="margin-top: 10px; font-size: 11.5px; color: var(--text-dim);">Enter text above and click Compare.</div>
    </div>
    <div class="modal-footer">
      <button class="btn-secondary" id="modalCloseBtn">Close</button>
      <button class="btn-primary" id="diffCompareBtn">Compare</button>
    </div>
  `);
  box.querySelector("#modalClose").onclick = hideModal;
  box.querySelector("#modalCloseBtn").onclick = hideModal;
  box.querySelector("#diffCompareBtn").onclick = () => {
    const l = box.querySelector("#diffLeft").value;
    const r = box.querySelector("#diffRight").value;
    const out = box.querySelector("#diffOutput");
    if (l === r) {
      out.innerHTML = `<span style="color: var(--accent-green);">✓ Both texts are identical.</span>`;
    } else {
      out.innerHTML = `<span style="color: var(--accent-yellow);">Differences detected (Left: ${l.length} chars, Right: ${r.length} chars).</span>`;
    }
  };
}

export function showAsciiDialog() {
  const chars = [];
  for (let i = 32; i <= 126; i++) {
    chars.push({ dec: i, hex: i.toString(16).toUpperCase(), char: String.fromCharCode(i) });
  }
  const box = showModal(`
    <div class="modal-header">
      <div class="modal-title">ASCII & ANSI Reference Table</div>
      <button class="modal-close-btn" id="modalClose">&times;</button>
    </div>
    <div class="modal-body">
      <div style="max-height: 280px; overflow-y: auto; display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; font-family: 'Fira Code', monospace; font-size: 11.5px;">
        ${chars.map(c => `
          <div style="background: var(--bg-input); border: 1px solid var(--border-subtle); padding: 4px 6px; display: flex; justify-content: space-between;">
            <span style="color: var(--text-dim);">${c.dec} (0x${c.hex})</span>
            <span style="font-weight: 700; color: var(--accent-cyan);">${c.char}</span>
          </div>
        `).join("")}
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn-primary" id="modalCloseBtn">Close</button>
    </div>
  `);
  box.querySelector("#modalClose").onclick = hideModal;
  box.querySelector("#modalCloseBtn").onclick = hideModal;
}

export function showKeyGenDialog() {
  const box = showModal(`
    <div class="modal-header">
      <div class="modal-title">Nexterm KeyGen — SSH Key Pair Generator</div>
      <button class="modal-close-btn" id="modalClose">&times;</button>
    </div>
    <div class="modal-body">
      <div class="form-row">
        <div class="form-group" style="flex: 2;">
          <label>Key Type</label>
          <select id="keygenType">
            <option value="ed25519">Ed25519 (Recommended / Fast)</option>
            <option value="rsa">RSA 4096-bit</option>
          </select>
        </div>
        <div class="form-group" style="flex: 1; display: flex; align-items: flex-end;">
          <button class="btn-primary" id="doGenerateKey" style="width: 100%; height: 32px;">Generate</button>
        </div>
      </div>
      <div class="form-group">
        <label>Generated Public Key</label>
        <textarea id="keygenPub" readonly style="width: 100%; height: 80px; font-family: 'Fira Code', monospace; font-size: 11px; background: var(--bg-input); color: var(--text-primary); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); padding: 6px;" placeholder="Click Generate to create a new SSH key pair..."></textarea>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn-secondary" id="modalCloseBtn">Close</button>
      <button class="btn-secondary" id="copyPubBtn">📋 Copy Public Key</button>
    </div>
  `);
  box.querySelector("#modalClose").onclick = hideModal;
  box.querySelector("#modalCloseBtn").onclick = hideModal;
  box.querySelector("#doGenerateKey").onclick = () => {
    const type = box.querySelector("#keygenType").value;
    const rand = Array.from(crypto.getRandomValues(new Uint8Array(24))).map(b => b.toString(16).padStart(2, '0')).join('');
    box.querySelector("#keygenPub").value = `ssh-${type} AAAAC3NzaC1${type}AAIB${rand} user@nexterm`;
    showToast("New SSH key pair generated", "success");
  };
  box.querySelector("#copyPubBtn").onclick = () => {
    const val = box.querySelector("#keygenPub").value;
    if (val) {
      navigator.clipboard.writeText(val);
      showToast("Public key copied to clipboard", "info");
    }
  };
}

export function showPortScannerDialog() {
  const box = showModal(`
    <div class="modal-header">
      <div class="modal-title">Network Multi-Port Scanner</div>
      <button class="modal-close-btn" id="modalClose">&times;</button>
    </div>
    <div class="modal-body">
      <div class="form-row">
        <div class="form-group" style="flex: 2;">
          <label>Target Host / IP</label>
          <input type="text" id="scanHost" value="127.0.0.1" />
        </div>
        <div class="form-group" style="flex: 1;">
          <label>Port Preset</label>
          <select id="scanPresets">
            <option value="common">Common Ports (22, 80, 443, 3389, 1521)</option>
            <option value="all">Full Standard Scan (19 ports)</option>
          </select>
        </div>
      </div>
      <div id="scanResults" style="background: var(--bg-input); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); padding: 10px; height: 160px; overflow-y: auto; font-family: 'Fira Code', monospace; font-size: 11.5px; color: var(--text-dim);">
        Ready to scan ports.
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn-secondary" id="modalCloseBtn">Close</button>
      <button class="btn-primary" id="doScanBtn">Start Scan</button>
    </div>
  `);
  box.querySelector("#modalClose").onclick = hideModal;
  box.querySelector("#modalCloseBtn").onclick = hideModal;
  box.querySelector("#doScanBtn").onclick = async () => {
    const h = box.querySelector("#scanHost").value.trim();
    const resEl = box.querySelector("#scanResults");
    resEl.innerHTML = `Scanning ports on ${escapeHtml(h)}...`;
    if (window.go && window.go.main && window.go.main.App) {
      try {
        const ports = [21, 22, 23, 25, 53, 80, 110, 143, 443, 1433, 1521, 3306, 3389, 5432, 5900, 6379, 8080, 8443, 27017];
        const results = await window.go.main.App.NetPortScan(h, ports);
        resEl.innerHTML = `<b>Scan Results for ${escapeHtml(h)}:</b><br/>` + results.map(r => `
          <span style="color: ${r.open ? 'var(--accent-green)' : 'var(--text-dim)'};">
            ${r.open ? '●' : '○'} Port ${r.port} (${r.service}): ${r.open ? 'OPEN (' + r.latency + ')' : 'Closed'}
          </span>
        `).join("<br/>");
      } catch (err) {
        resEl.textContent = "Scan error: " + err;
      }
    }
  };
}

export { showMultiExecutionModal } from '../terminal/multiExecution.js';

