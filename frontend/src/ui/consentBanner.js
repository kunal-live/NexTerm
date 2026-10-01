// ==========================================================================
// NexTerm — Cookie & Local Storage Consent Banner Component
// ==========================================================================

import { showSettingsDialog } from '../settings/settings.js';

const STORAGE_KEY = 'nexterm_consent_acknowledged';

/**
 * Initializes and displays the local storage and privacy consent banner
 * if the user has not yet acknowledged it on this workstation.
 */
export function initConsentBanner() {
  try {
    if (localStorage.getItem(STORAGE_KEY) === 'true') {
      return; // Already acknowledged
    }
  } catch (_) {
    return;
  }

  // Check if banner already injected
  if (document.getElementById('nxConsentBanner')) return;

  const banner = document.createElement('aside');
  banner.id = 'nxConsentBanner';
  banner.setAttribute('role', 'region');
  banner.setAttribute('aria-label', 'Privacy and Local Storage Consent Notice');
  banner.className = 'nx-consent-banner';

  banner.innerHTML = `
    <div class="nx-consent-inner">
      <div class="nx-consent-icon" aria-hidden="true">🛡️</div>
      <div class="nx-consent-body">
        <div class="nx-consent-title">Privacy & Local Storage Transparency</div>
        <p class="nx-consent-text">
          NexTerm is built offline-first with <strong>zero telemetry</strong>, <strong>zero tracking cookies</strong>, and <strong>no third-party embeds</strong>.
          We use local browser storage strictly to retain your UI layout, themes, and workspace settings on this computer.
        </p>
      </div>
      <div class="nx-consent-actions">
        <button type="button" class="nx-consent-btn-secondary" id="nxConsentReviewBtn" aria-label="Review Privacy and Cookie Policies">
          Review Policies
        </button>
        <button type="button" class="nx-consent-btn-primary" id="nxConsentAcceptBtn" aria-label="Acknowledge and Accept Local Storage">
          Accept & Continue
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(banner);

  // Trigger smooth slide-in animation
  requestAnimationFrame(() => {
    banner.classList.add('nx-consent-visible');
  });

  const dismiss = () => {
    try {
      localStorage.setItem(STORAGE_KEY, 'true');
    } catch (_) {}
    banner.classList.remove('nx-consent-visible');
    banner.classList.add('nx-consent-hiding');
    setTimeout(() => {
      if (banner.parentNode) banner.parentNode.removeChild(banner);
    }, 350);
  };

  const acceptBtn = document.getElementById('nxConsentAcceptBtn');
  if (acceptBtn) {
    acceptBtn.onclick = dismiss;
  }

  const reviewBtn = document.getElementById('nxConsentReviewBtn');
  if (reviewBtn) {
    reviewBtn.onclick = () => {
      dismiss();
      showSettingsDialog('tab-settings-privacy');
    };
  }
}