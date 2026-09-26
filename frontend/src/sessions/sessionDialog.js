// ==========================================================================
// Nexterm - Session & Folder Configuration Dialogs
// ==========================================================================

import { showModal, hideModal } from '../ui/modal.js';
import { escapeHtml, showToast } from '../ui/notifications.js';
import { userSettings, THEMES } from '../settings/settings.js';
import { rootNode, isDescendantInTree } from '../state/sessionState.js';
import { connectToSession } from '../terminal/terminalManager.js';
import { ENVIRONMENTS, getEnvironmentInfo, getEnvironmentFromFolderName } from '../state/tabState.js';

let refreshTreeCallback = null;
export function registerDialogRefreshTree(fn) {
  refreshTreeCallback = fn;
}

async function triggerRefreshTree() {
  if (refreshTreeCallback) {
    await refreshTreeCallback();
  }
}

// --------------------------------------------------------------------------
// Multi-Protocol New Session Dialog (SSH, SFTP, RDP, VNC, Telnet, Serial, Local)
// --------------------------------------------------------------------------

export function showEditSessionDialog(profile) {
  return showNewSessionDialog("", profile);
}

export async function showNewSessionDialog(parentFolderId = "", editProfile = null) {
  const isEdit = !!editProfile;
  let savedPassword = "";
  let savedPassphrase = "";
  const vKey = editProfile ? (editProfile.vaultKey || editProfile.id) : "";
  if (isEdit && vKey && window.go && window.go.main && window.go.main.App) {
    if (window.go.main.App.GetSessionPassword) {
      try {
        savedPassword = await window.go.main.App.GetSessionPassword(vKey);
      } catch (_) {}
    }
    if (!savedPassword && window.go.main.App.GetSavedPassword) {
      try {
        savedPassword = await window.go.main.App.GetSavedPassword(vKey);
      } catch (_) {}
    }
    if (!savedPassword && window.go.main.App.FindSessionPassword && editProfile.host && editProfile.username) {
      try {
        savedPassword = await window.go.main.App.FindSessionPassword(vKey, editProfile.host, editProfile.port || 22, editProfile.username);
      } catch (_) {}
    }
    if (window.go.main.App.GetSessionPassphrase) {
      try {
        savedPassphrase = await window.go.main.App.GetSessionPassphrase(vKey);
      } catch (_) {}
    }
  }

  const p = editProfile || {
    id: "",
    name: "",
    protocol: "ssh",
    host: "",
    port: 22,
    username: "",
    authType: "password",
    privateKeyPath: "",
    keyPassphrase: "",
    useAgent: false,
    terminalType: "xterm-256color",
    fontFamily: userSettings.fontFamily || "Cascadia Mono, Consolas, monospace",
    fontSize: userSettings.fontSize || 13,
    rows: 24,
    cols: 80,
    cursorStyle: userSettings.cursorStyle || "block",
    cursorBlink: userSettings.cursorBlink !== undefined ? userSettings.cursorBlink : true,
    encoding: "utf-8",
    scrollback: userSettings.scrollback || 10000,
    startupCommand: "",
    workingDirectory: "",
    keepAliveInterval: 15,
    connectionTimeout: 10,
    compression: false,
    x11Forwarding: false,
    proxyType: "none",
    proxyHost: "",
    proxyPort: 1080,
    proxyUsername: "",
    proxyPassword: "",
    useJumpHost: editProfile?.useJumpHost || false,
    jumpHost: editProfile?.jumpHost || "",
    jumpPort: editProfile?.jumpPort || 22,
    jumpUsername: editProfile?.jumpUsername || "bastion",
    jumpAuthType: editProfile?.jumpAuthType || "password",
    jumpPrivateKeyPath: editProfile?.jumpPrivateKeyPath || "",
    jumpVaultKey: editProfile?.jumpVaultKey || "",
    theme: userSettings.theme || "dark-modern",
    foreground: "",
    background: "",
    cursorColor: "",
    selectionColor: "",
    ansiColors: {},
    serialPort: "COM1",
    baudRate: 115200,
    dataBits: 8,
    stopBits: 1,
    parity: "none",
    rdpDomain: "",
    rdpFullScreen: false,
    autoReconnect: editProfile?.autoReconnect !== undefined ? editProfile.autoReconnect : (userSettings.autoReconnect || false),
    reconnectAttempts: editProfile?.reconnectAttempts || userSettings.reconnectAttempts || 5,
    reconnectDelay: editProfile?.reconnectDelay || userSettings.reconnectDelay || 2,
    environment: editProfile?.environment || "",
    color: editProfile?.color || ""
  };

  const currentThemeData = THEMES[p.theme] || THEMES["dark-modern"];
  const fgVal = p.foreground || currentThemeData.foreground;
  const bgVal = p.background || currentThemeData.background;
  const curVal = p.cursorColor || currentThemeData.cursor;
  const ansi = p.ansiColors || {};

  const availableFolders = [];
  function gatherFolderNodes(node, prefix = "") {
    if (!node) return;
    if (node.isFolder || node.children) {
      if (node !== rootNode && node.id && node.name) {
        availableFolders.push({
          id: node.id,
          name: prefix + node.name,
          rawName: node.name,
          defaultUsername: node.defaultUsername || "",
          defaultPort: node.defaultPort || 22,
          environment: node.environment || "",
          color: node.color || ""
        });
      }
      if (node.children) {
        node.children.forEach(c => gatherFolderNodes(c, (node !== rootNode ? prefix + node.name + " / " : "")));
      }
    }
  }
  gatherFolderNodes(rootNode);

  let detectedFolderId = parentFolderId;
  if (!detectedFolderId && editProfile && rootNode) {
    function findParentFolder(node, targetId) {
      if (!node || !node.children) return null;
      for (const c of node.children) {
        if (!c.isFolder && c.session && c.session.id === targetId) return node.id;
        if (c.isFolder || c.children) {
          const res = findParentFolder(c, targetId);
          if (res) return res;
        }
      }
      return null;
    }
    const found = findParentFolder(rootNode, editProfile.id);
    if (found && found !== rootNode.id) detectedFolderId = found;
  }

  const initialFolderObj = availableFolders.find(f => f.id === detectedFolderId);
  if (initialFolderObj && !isEdit) {
    if (!p.username && initialFolderObj.defaultUsername) {
      p.username = initialFolderObj.defaultUsername;
    }
    if ((!p.port || p.port === 22) && initialFolderObj.defaultPort) {
      p.port = initialFolderObj.defaultPort;
    }
    if (!p.environment && initialFolderObj.environment) {
      p.environment = initialFolderObj.environment;
    }
    if (!p.color && initialFolderObj.color) {
      p.color = initialFolderObj.color;
    }
  }

  const box = showModal(`
    <div class="modal-header">
      <div class="modal-title">${isEdit ? "⚙️ Edit Session — " + escapeHtml(p.name) : "✨ New Session Configuration"}</div>
      <button class="modal-close-btn" id="modalClose">&times;</button>
    </div>

    <!-- Top Protocol Chips Bar -->
    <div class="sess-proto-bar">
      ${[
        { id: "ssh", label: "SSH", icon: "🔒", port: 22 },
        { id: "sftp", label: "SFTP", icon: "📁", port: 22 },
        { id: "rdp", label: "RDP", icon: "🖥️", port: 3389 },
        { id: "vnc", label: "VNC", icon: "📺", port: 5900 },
        { id: "telnet", label: "Telnet", icon: "📡", port: 23 },
        { id: "serial", label: "Serial", icon: "🔌", port: 0 },
        { id: "local", label: "Local Terminal", icon: "💻", port: 0 }
      ].map(pr => `
        <div class="sess-proto-chip ${p.protocol === pr.id ? 'active' : ''}" data-proto="${pr.id}" data-default-port="${pr.port}">
          <span>${pr.icon}</span>
          <span>${pr.label}</span>
        </div>
      `).join('')}
    </div>

    <!-- Main Two-Column Body -->
    <div class="sess-modal-layout sess-editor-body">
      <!-- Left Navigation Sidebar -->
      <div class="sess-nav-sidebar">
        <div class="sess-nav-item active" data-tab="tab-sess-gen">
          <span class="nav-icon">🌐</span>
          <span>General</span>
        </div>
        <div class="sess-nav-item" data-tab="tab-sess-auth" id="navItemAuth">
          <span class="nav-icon">🔐</span>
          <span>Authentication</span>
        </div>
        <div class="sess-nav-item" data-tab="tab-sess-term">
          <span class="nav-icon">💻</span>
          <span>Terminal</span>
        </div>
        <div class="sess-nav-item" data-tab="tab-sess-start">
          <span class="nav-icon">🚀</span>
          <span>Startup</span>
        </div>
        <div class="sess-nav-item" data-tab="tab-sess-ssh" id="navItemSSH">
          <span class="nav-icon">🛡️</span>
          <span>SSH Settings</span>
        </div>
        <div class="sess-nav-item" data-tab="tab-sess-app">
          <span class="nav-icon">🎨</span>
          <span>Appearance</span>
        </div>
      </div>

      <!-- Right Content Pane -->
      <div class="sess-content-pane">

        <!-- 1. GENERAL TAB -->
        <div id="tab-sess-gen" class="sess-tab-content">
          <div class="sess-section-heading">🌐 General Session Settings</div>

          <div class="sess-form-group">
            <label>Session Name *</label>
            <div style="display: flex; gap: 8px;">
              <input type="text" id="sName" value="${escapeHtml(p.name)}" placeholder="e.g. Ubuntu Production Server 01" autocomplete="off" style="flex: 1;" />
              <button type="button" id="sAutoNameBtn" class="btn-action" title="Auto-generate name from user@host:port" style="padding: 0 12px; font-size: 11px; white-space: nowrap; font-weight: 600; display: flex; align-items: center; gap: 4px;">⚡ Auto-Name</button>
            </div>
          </div>

          <!-- Server Environment & Folder Options -->
          <div class="sess-form-group" style="background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 6px; padding: 12px; margin-bottom: 14px;">
            <div style="font-size: 12px; font-weight: 700; color: var(--text-primary); margin-bottom: 8px; display: flex; align-items: center; justify-content: space-between;">
              <span style="display: flex; align-items: center; gap: 6px;">📁 Folder & Environment Options</span>
              <div id="sEnvPreviewWrap" style="display: flex; align-items: center; gap: 8px;">
                <span id="sInheritedEnvBadge" class="tab-env-badge">DEFAULT</span>
                <span id="sInheritedColorHex" style="font-size: 11px; font-family: monospace; color: var(--text-dim);">#64748b</span>
              </div>
            </div>
            <div class="sess-form-row" style="align-items: flex-end; gap: 10px;">
              <div class="sess-form-group" style="flex: 1.6;">
                <label>Folder *</label>
                <div style="display: flex; gap: 6px;">
                  <select id="sFolderSelect" style="flex: 1;">
                    <option value="">(Root / Unassigned)</option>
                    ${availableFolders.map(f => `
                      <option value="${f.id}" data-name="${escapeHtml(f.rawName)}" ${f.id === detectedFolderId ? 'selected' : ''}>${escapeHtml(f.name)}</option>
                    `).join('')}
                  </select>
                  <button type="button" id="sNewFolderQuickBtn" class="btn-action" title="Create New Folder" style="padding: 0 10px; font-weight: 700; font-size: 14px;">＋</button>
                </div>
              </div>
              <div class="sess-form-group" style="flex: 1.4;">
                <label>Environment</label>
                <select id="sEnvSelect">
                  <option value="inherit">⚡ Auto (Inherit from Folder)</option>
                  <option value="prod" ${p.environment === 'prod' ? 'selected' : ''}>🔴 Production (PROD)</option>
                  <option value="uat" ${p.environment === 'uat' ? 'selected' : ''}>🟠 UAT (User Acceptance)</option>
                  <option value="testing" ${p.environment === 'testing' || p.environment === 'test' ? 'selected' : ''}>🟢 Testing (TEST)</option>
                  <option value="dev" ${p.environment === 'dev' ? 'selected' : ''}>🔵 Development (DEV)</option>
                  <option value="staging" ${p.environment === 'staging' ? 'selected' : ''}>🟣 Staging (STAGE)</option>
                  <option value="dr" ${p.environment === 'dr' ? 'selected' : ''}>🌸 Disaster Recovery (DR)</option>
                  <option value="custom">🎨 Custom Environment...</option>
                  <option value="none">⚪ None / Default</option>
                </select>
              </div>
              <div class="sess-form-group" id="sCustomTagGroup" style="flex: 1.1; display: none;">
                <label>Custom Tag</label>
                <input type="text" id="sEnvCustomTag" value="${escapeHtml((p.environment && !['prod','uat','test','testing','dev','staging','dr','inherit','none'].includes(p.environment.toLowerCase())) ? p.environment : '')}" placeholder="e.g. DMZ, LAB" style="height: 32px; padding: 0 8px; font-size: 11px; text-transform: uppercase; font-weight: 700;" />
              </div>
              <div class="sess-form-group" style="flex: 0.5; min-width: 50px;">
                <label>Color</label>
                <div style="display: flex; align-items: center; gap: 6px; height: 32px;">
                  <input type="color" id="sColorPicker" value="${p.color && p.color.startsWith('#') ? p.color : '#10b981'}" style="width: 32px; height: 32px; padding: 0; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; cursor: pointer; background: transparent;" title="Pick Accent Color" />
                  <span id="sInheritedDot" style="display: none; width: 12px; height: 12px; border-radius: 50%; background: #64748b;"></span>
                </div>
              </div>
            </div>
            <div style="font-size: 10.5px; color: var(--text-muted); margin-top: 6px;">
              💡 Customize folder grouping and color-coded environment tags (PROD, UAT, TEST, DEV, etc.).
            </div>
            <input type="hidden" id="sEnv" value="${escapeHtml(p.environment || '')}" />
            <input type="hidden" id="sColor" value="${escapeHtml(p.color || '')}" />
          </div>

          <!-- Network & Credentials Section -->
          <div id="generalNetworkFields">
            <div class="sess-form-row" style="gap: 10px;">
              <div class="sess-form-group" style="flex: 2.2;">
                <label>Remote Host / IP *</label>
                <input type="text" id="sHost" value="${escapeHtml(p.host)}" placeholder="192.168.1.100 or server.company.com" autocomplete="off" />
              </div>
              <div class="sess-form-group" style="flex: 0.8;">
                <label>Port</label>
                <input type="number" id="sPort" value="${p.port || 22}" />
              </div>
              <div class="sess-form-group" style="flex: 1.6;">
                <label>Username *</label>
                <input type="text" id="sUser" value="${escapeHtml(p.username)}" placeholder="e.g. root, pin, admin" autocomplete="off" />
              </div>
            </div>

            <!-- Row 2: Auth Method & Password / Key on General Tab -->
            <div class="sess-form-row" style="gap: 10px; align-items: flex-end; margin-top: 2px;">
              <div class="sess-form-group" style="flex: 1.4;">
                <label>Authentication Mode</label>
                <select id="sAuthTypeQuick">
                  <option value="password" ${p.authType === 'password' || (!p.privateKeyPath && p.authType !== 'key' && p.authType !== 'agent') ? 'selected' : ''}>🔑 Password (Vault)</option>
                  <option value="key" ${p.authType === 'key' || (p.privateKeyPath) ? 'selected' : ''}>📜 Private Key</option>
                  <option value="keyboard-interactive" ${p.authType === 'keyboard-interactive' ? 'selected' : ''}>💬 Prompt on Connect</option>
                  <option value="agent" ${p.authType === 'agent' ? 'selected' : ''}>🛡️ SSH Agent</option>
                </select>
              </div>
              <div class="sess-form-group" id="sPasswordGenWrap" style="flex: 2.2;">
                <label>Password</label>
                <div class="sess-password-wrap">
                  <input type="password" id="sPasswordGen" value="${escapeHtml(savedPassword)}" placeholder="Enter password (stored encrypted in Vault)" autocomplete="current-password" />
                  <button type="button" class="sess-password-toggle" id="togglePwBtnGen" title="Toggle password visibility">👁️</button>
                </div>
              </div>
              <div class="sess-form-group hidden" id="sQuickKeyWrap" style="flex: 2.2;">
                <label>Private Key File</label>
                <div class="file-input-group" style="display: flex; gap: 6px;">
                  <input type="text" id="sQuickKeyPath" value="${escapeHtml(p.privateKeyPath || '')}" placeholder="C:\\path\\to\\id_rsa" style="font-size: 11.5px;" />
                  <button class="btn-secondary" id="sQuickBrowseKeyBtn" type="button" style="padding: 0 10px; font-size: 11px;">Browse...</button>
                </div>
              </div>
            </div>

            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px; font-size: 11px; color: var(--text-dim);">
              <label class="checkbox-label" style="display: inline-flex; align-items: center; gap: 6px; cursor: pointer;">
                <input type="checkbox" id="sSavePasswordCheck" checked />
                <span>Remember credentials in Secure Vault</span>
              </label>
              <span style="color: var(--text-muted);">
                For SSH Keys, 2FA, or Proxy, see <a href="#" id="linkToAuthTab" style="color: #38bdf8; text-decoration: none;">🔐 Authentication</a>
              </span>
            </div>
          </div>

          <div class="sess-form-group" style="margin-top: 10px;">
            <label>Protocol</label>
            <select id="sProtoSelect">
              <option value="ssh" ${p.protocol === 'ssh' ? 'selected' : ''}>SSH — Secure Shell</option>
              <option value="sftp" ${p.protocol === 'sftp' ? 'selected' : ''}>SFTP — Secure File Transfer</option>
              <option value="rdp" ${p.protocol === 'rdp' ? 'selected' : ''}>RDP — Remote Desktop</option>
              <option value="vnc" ${p.protocol === 'vnc' ? 'selected' : ''}>VNC — Virtual Network Computing</option>
              <option value="telnet" ${p.protocol === 'telnet' ? 'selected' : ''}>Telnet — Unencrypted Terminal</option>
              <option value="serial" ${p.protocol === 'serial' ? 'selected' : ''}>Serial — COM Port</option>
              <option value="local" ${p.protocol === 'local' ? 'selected' : ''}>Local — PowerShell / CMD</option>
            </select>
          </div>

          <!-- Serial Specific Section -->
          <div id="generalSerialFields" class="${p.protocol === 'serial' ? '' : 'hidden'}">
            <div class="sess-form-row">
              <div class="sess-form-group">
                <label>Serial Port (COM)</label>
                <select id="sSerialPort">
                  ${["COM1","COM2","COM3","COM4","COM5","COM6","COM7","COM8"].map(c => `
                    <option value="${c}" ${p.serialPort === c ? 'selected' : ''}>${c}</option>
                  `).join('')}
                </select>
              </div>
              <div class="sess-form-group">
                <label>Baud Rate</label>
                <select id="sBaudRate">
                  ${[9600, 19200, 38400, 57600, 115200, 230400].map(b => `
                    <option value="${b}" ${p.baudRate === b ? 'selected' : ''}>${b}</option>
                  `).join('')}
                </select>
              </div>
            </div>
            <div class="sess-form-row">
              <div class="sess-form-group">
                <label>Data Bits</label>
                <select id="sDataBits">
                  <option value="8" ${p.dataBits === 8 ? 'selected' : ''}>8</option>
                  <option value="7" ${p.dataBits === 7 ? 'selected' : ''}>7</option>
                </select>
              </div>
              <div class="sess-form-group">
                <label>Stop Bits</label>
                <select id="sStopBits">
                  <option value="1" ${p.stopBits === 1 ? 'selected' : ''}>1</option>
                  <option value="2" ${p.stopBits === 2 ? 'selected' : ''}>2</option>
                </select>
              </div>
              <div class="sess-form-group">
                <label>Parity</label>
                <select id="sParity">
                  <option value="none" ${p.parity === 'none' ? 'selected' : ''}>None</option>
                  <option value="odd" ${p.parity === 'odd' ? 'selected' : ''}>Odd</option>
                  <option value="even" ${p.parity === 'even' ? 'selected' : ''}>Even</option>
                </select>
              </div>
            </div>
          </div>

          <!-- RDP Specific Section -->
          <div id="generalRdpFields" class="${p.protocol === 'rdp' ? '' : 'hidden'}">
            <div class="sess-form-group">
              <label>Windows Domain (Optional)</label>
              <input type="text" id="sRDPDomain" value="${escapeHtml(p.rdpDomain || '')}" placeholder="e.g. CORP" />
            </div>
            <div class="sess-form-group">
              <label class="checkbox-label" style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                <input type="checkbox" id="sRDPFullScreen" ${p.rdpFullScreen ? 'checked' : ''} />
                <span>Open in Fullscreen Mode</span>
              </label>
            </div>
          </div>
        </div>

        <!-- 2. AUTHENTICATION TAB -->
        <div id="tab-sess-auth" class="sess-tab-content hidden">
          <div class="sess-section-heading">🔐 Authentication Credentials</div>

          <div class="sess-form-group">
            <label>Authentication Method</label>
            <select id="sAuthType">
              <option value="password" ${p.authType === 'password' || (!p.privateKeyPath && p.authType !== 'agent' && p.authType !== 'keyboard-interactive' && p.authType !== 'auto') ? 'selected' : ''}>Password (Encrypted in Vault)</option>
              <option value="key" ${p.authType === 'key' || (!p.authType && p.privateKeyPath) ? 'selected' : ''}>Public Key / Private Key (RSA / Ed25519 / OpenSSH Cert)</option>
              <option value="agent" ${p.authType === 'agent' ? 'selected' : ''}>SSH Agent / Pageant (Local Key Agent)</option>
              <option value="keyboard-interactive" ${p.authType === 'keyboard-interactive' ? 'selected' : ''}>Keyboard-Interactive (MFA / 2FA / PAM Challenge)</option>
              <option value="auto" ${p.authType === 'auto' ? 'selected' : ''}>Auto (Smart Priority Chain: Key → Agent → 2FA → Password)</option>
            </select>
          </div>

          <div id="sessPassFields" class="${p.authType === 'key' || p.authType === 'agent' ? 'hidden' : ''}">
            <div class="sess-form-group">
              <label>Password</label>
              <div class="sess-password-wrap">
                <input type="password" id="sPassword" value="${escapeHtml(savedPassword)}" placeholder="Enter password (stored encrypted in Vault)" autocomplete="off" />
                <button type="button" class="sess-password-toggle" id="togglePwBtn" title="Toggle visibility">👁️</button>
              </div>
              <div style="font-size: 10.5px; color: var(--text-dim); margin-top: 4px;">
                🔐 Encrypted using platform credential vault. Leave blank to prompt on connection.
              </div>
            </div>
          </div>

          <div id="sessKeyFields" class="${p.authType === 'password' || p.authType === 'agent' || p.authType === 'keyboard-interactive' ? 'hidden' : ''}">
            <div class="sess-form-group">
              <label>Private Key File</label>
              <div class="file-input-group" style="display: flex; gap: 8px;">
                <input type="text" id="sKeyPath" value="${escapeHtml(p.privateKeyPath || '')}" placeholder="C:\\Users\\...\\.ssh\\id_rsa" />
                <button class="btn-secondary" id="browseKeyBtn" type="button">Browse...</button>
              </div>
              <div id="keyInfoBadge" style="margin-top: 6px; font-size: 11px; min-height: 18px;">
                ${p.keyType ? `<span style="color: #4ade80;">🔑 ${escapeHtml(p.keyType)} ${p.keyFingerprint ? '• ' + escapeHtml(p.keyFingerprint) : ''}</span>` : ''}
              </div>
            </div>
            <div class="sess-form-group">
              <label>Key Passphrase</label>
              <div class="sess-password-wrap">
                <input type="password" id="sKeyPassphrase" value="${escapeHtml(savedPassphrase)}" placeholder="Passphrase if key is encrypted (stored in Vault)" />
                <button type="button" class="sess-password-toggle" id="toggleKeyPassBtn" title="Toggle visibility">👁️</button>
              </div>
              <div style="font-size: 10.5px; color: var(--text-dim); margin-top: 4px;">
                🔐 Encrypted in platform credential vault. Never stored in plaintext.
              </div>
            </div>
            <div class="sess-form-group" style="margin-top: 8px;">
              <label>OpenSSH Certificate (Optional, auto-detected if &lt;key&gt;-cert.pub)</label>
              <div class="file-input-group" style="display: flex; gap: 8px;">
                <input type="text" id="sCertPath" value="${escapeHtml(p.certificatePath || '')}" placeholder="Optional: C:\\Users\\...\\.ssh\\id_rsa-cert.pub" />
                <button class="btn-secondary" id="browseCertBtn" type="button">Browse...</button>
              </div>
            </div>
          </div>

          <div class="sess-form-group" style="margin-top: 14px; padding-top: 10px; border-top: 1px solid #232838;">
            <label class="checkbox-label" style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
              <input type="checkbox" id="sUseAgent" ${p.useAgent ? 'checked' : ''} />
              <span><b>Enable SSH Agent / Pageant authentication forwarding</b></span>
            </label>
            <div style="display: flex; align-items: center; gap: 8px; margin-top: 6px; margin-left: 26px;">
              <div id="sessAgentStatus" style="font-size: 11px; min-height: 16px; flex: 1;"></div>
              <button class="btn-secondary" id="refreshAgentBtn" type="button" style="padding: 2px 8px; font-size: 11px; height: 24px;">🔄 Refresh Agent</button>
            </div>
          </div>
        </div>

        <!-- 3. TERMINAL TAB -->
        <div id="tab-sess-term" class="sess-tab-content hidden">
          <div class="sess-section-heading">💻 Terminal & Display Options</div>

          <div class="sess-form-row">
            <div class="sess-form-group">
              <label>Terminal Type (TERM)</label>
              <select id="sTermType">
                <option value="xterm-256color" ${p.terminalType === 'xterm-256color' ? 'selected' : ''}>xterm-256color (Recommended)</option>
                <option value="xterm" ${p.terminalType === 'xterm' ? 'selected' : ''}>xterm</option>
                <option value="vt100" ${p.terminalType === 'vt100' ? 'selected' : ''}>vt100</option>
                <option value="linux" ${p.terminalType === 'linux' ? 'selected' : ''}>linux</option>
                <option value="ansi" ${p.terminalType === 'ansi' ? 'selected' : ''}>ansi</option>
              </select>
            </div>
            <div class="sess-form-group">
              <label>Encoding</label>
              <select id="sEncoding">
                <option value="utf-8" ${p.encoding === 'utf-8' || !p.encoding ? 'selected' : ''}>UTF-8 (Universal)</option>
                <option value="iso-8859-1" ${p.encoding === 'iso-8859-1' ? 'selected' : ''}>ISO-8859-1 (Latin-1)</option>
                <option value="windows-1252" ${p.encoding === 'windows-1252' ? 'selected' : ''}>Windows-1252</option>
                <option value="gbk" ${p.encoding === 'gbk' ? 'selected' : ''}>GBK (Chinese)</option>
                <option value="shift-jis" ${p.encoding === 'shift-jis' ? 'selected' : ''}>Shift-JIS (Japanese)</option>
              </select>
            </div>
          </div>

          <div class="sess-form-row">
            <div class="sess-form-group" style="flex: 2;">
              <label>Font Family</label>
              <select id="sFontFamily">
                <option value="Cascadia Mono, Consolas, monospace" ${p.fontFamily?.includes('Cascadia') ? 'selected' : ''}>Cascadia Mono (Modern)</option>
                <option value="Fira Code, Consolas, monospace" ${p.fontFamily?.includes('Fira') ? 'selected' : ''}>Fira Code (Ligatures)</option>
                <option value="JetBrains Mono, monospace" ${p.fontFamily?.includes('JetBrains') ? 'selected' : ''}>JetBrains Mono</option>
                <option value="Consolas, monospace" ${p.fontFamily === 'Consolas, monospace' ? 'selected' : ''}>Consolas</option>
                <option value="Courier New, monospace" ${p.fontFamily?.includes('Courier') ? 'selected' : ''}>Courier New</option>
                <option value="monospace" ${p.fontFamily === 'monospace' ? 'selected' : ''}>System Monospace</option>
              </select>
            </div>
            <div class="sess-form-group" style="flex: 1;">
              <label>Font Size (px)</label>
              <input type="number" id="sFontSize" value="${p.fontSize || 13}" min="9" max="28" />
            </div>
          </div>

          <div class="sess-form-row">
            <div class="sess-form-group">
              <label>Columns (0 = Auto-fit)</label>
              <input type="number" id="sCols" value="${p.cols || 80}" min="0" max="400" />
            </div>
            <div class="sess-form-group">
              <label>Rows (0 = Auto-fit)</label>
              <input type="number" id="sRows" value="${p.rows || 24}" min="0" max="200" />
            </div>
            <div class="sess-form-group">
              <label>Scrollback (lines)</label>
              <select id="sScrollback">
                <option value="5000" ${p.scrollback === 5000 ? 'selected' : ''}>5,000</option>
                <option value="10000" ${p.scrollback === 10000 || !p.scrollback ? 'selected' : ''}>10,000</option>
                <option value="25000" ${p.scrollback === 25000 ? 'selected' : ''}>25,000</option>
                <option value="50000" ${p.scrollback === 50000 ? 'selected' : ''}>50,000</option>
              </select>
            </div>
          </div>

          <div class="sess-form-row" style="align-items: center; margin-top: 6px;">
            <div class="sess-form-group">
              <label>Cursor Style</label>
              <select id="sCursorStyle">
                <option value="block" ${p.cursorStyle === 'block' ? 'selected' : ''}>Block (█)</option>
                <option value="underline" ${p.cursorStyle === 'underline' ? 'selected' : ''}>Underline (_)</option>
                <option value="bar" ${p.cursorStyle === 'bar' ? 'selected' : ''}>Vertical Bar (|)</option>
              </select>
            </div>
            <div class="sess-form-group" style="display: flex; align-items: flex-end; padding-bottom: 8px;">
              <label class="checkbox-label" style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                <input type="checkbox" id="sCursorBlink" ${p.cursorBlink !== false ? 'checked' : ''} />
                <span>Cursor Blink</span>
              </label>
            </div>
          </div>
        </div>

        <!-- 4. STARTUP TAB -->
        <div id="tab-sess-start" class="sess-tab-content hidden">
          <div class="sess-section-heading">🚀 Startup Automation & Environment</div>

          <div class="sess-form-group">
            <label>Startup Command (Automatically executed upon connection)</label>
            <input type="text" id="sStartup" value="${escapeHtml(p.startupCommand || '')}" placeholder="e.g. uptime && free -m" />
            <div style="font-size: 10.5px; color: var(--text-dim); margin-top: 4px;">
              Command will be transmitted directly to the remote shell session once connected.
            </div>
          </div>

          <div class="sess-form-group" style="margin-top: 14px;">
            <label>Working Directory (Initial directory upon login)</label>
            <input type="text" id="sWorkDir" value="${escapeHtml(p.workingDirectory || '')}" placeholder="e.g. /home/kunal/projects or ~" />
            <div style="font-size: 10.5px; color: var(--text-dim); margin-top: 4px;">
              Remote working directory to navigate into immediately after shell startup.
            </div>
          </div>
        </div>

        <!-- 5. SSH SETTINGS TAB -->
        <div id="tab-sess-ssh" class="sess-tab-content hidden">
          <div class="sess-section-heading">🛡️ Advanced SSH, Tunneling & Proxies</div>

          <div class="sess-form-row">
            <div class="sess-form-group">
              <label>Keep-Alive Heartbeat (seconds)</label>
              <input type="number" id="sKeepAlive" value="${p.keepAliveInterval || 15}" min="0" max="300" />
            </div>
            <div class="sess-form-group">
              <label>Connection Timeout (seconds)</label>
              <input type="number" id="sTimeout" value="${p.connectionTimeout || 10}" min="3" max="120" />
            </div>
          </div>

          <div class="sess-form-group">
            <label class="checkbox-label" style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
              <input type="checkbox" id="sCompression" ${p.compression ? 'checked' : ''} />
              <span><b>Enable SSH payload compression (zlib)</b> — improves speed over slow links</span>
            </label>
          </div>

          <div class="sess-form-group">
            <label class="checkbox-label" style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
              <input type="checkbox" id="sX11Forwarding" ${p.x11Forwarding ? 'checked' : ''} />
              <span><b>Enable X11 Forwarding</b> — run remote Linux GUI apps on your desktop (needs a local X server; use Tools → Start X Server)</span>
            </label>
          </div>

          <!-- Jump Host Box -->
          <div style="background: #11141d; border: 1px solid #252b3b; border-radius: 6px; padding: 12px; margin-top: 12px;">
            <label class="checkbox-label" style="display: flex; align-items: center; gap: 8px; cursor: pointer; margin-bottom: 8px;">
              <input type="checkbox" id="sUseJump" ${p.useJumpHost ? 'checked' : ''} />
              <span><b>Connect via SSH Jump Host (Bastion Gateway Proxy)</b></span>
            </label>
            <div id="jumpFields" class="${p.useJumpHost ? '' : 'hidden'}">
              <div class="sess-form-row">
                <div class="sess-form-group" style="flex: 2;">
                  <label>Gateway Host / IP</label>
                  <input type="text" id="sJumpHost" value="${escapeHtml(p.jumpHost || '')}" placeholder="bastion.company.com" />
                </div>
                <div class="sess-form-group" style="flex: 1;">
                  <label>Gateway Port</label>
                  <input type="number" id="sJumpPort" value="${p.jumpPort || 22}" />
                </div>
              </div>
              <div class="sess-form-row">
                <div class="sess-form-group">
                  <label>Gateway Username</label>
                  <input type="text" id="sJumpUser" value="${escapeHtml(p.jumpUsername || 'bastion')}" />
                </div>
                <div class="sess-form-group">
                  <label>Gateway Auth Method</label>
                  <select id="sJumpAuthType">
                    <option value="password" ${p.jumpAuthType !== 'key' ? 'selected' : ''}>Password</option>
                    <option value="key" ${p.jumpAuthType === 'key' ? 'selected' : ''}>Private Key</option>
                  </select>
                </div>
              </div>
              <div id="jumpPassFields" class="${p.jumpAuthType === 'key' ? 'hidden' : ''}">
                <div class="sess-form-group">
                  <label>Gateway Password</label>
                  <input type="password" id="sJumpPassword" placeholder="Stored encrypted in Vault; leave blank to prompt on connect" autocomplete="off" />
                </div>
              </div>
              <div id="jumpKeyFields" class="${p.jumpAuthType === 'key' ? '' : 'hidden'}">
                <div class="sess-form-group">
                  <label>Gateway Private Key File</label>
                  <div class="file-input-group" style="display: flex; gap: 8px;">
                    <input type="text" id="sJumpKeyPath" value="${escapeHtml(p.jumpPrivateKeyPath || '')}" placeholder="C:\\Users\\...\\.ssh\\bastion_key" />
                    <button class="btn-secondary" id="browseJumpKeyBtn" type="button">Browse...</button>
                  </div>
                </div>
                <div class="sess-form-group">
                  <label>Gateway Key Passphrase</label>
                  <input type="password" id="sJumpKeyPassphrase" placeholder="Passphrase if key is encrypted (stored in Vault)" />
                </div>
              </div>
              <div style="font-size: 10.5px; color: var(--text-dim); margin-top: 4px;">
                🛡️ NexTerm opens the SSH connection to this gateway first, authenticates, then tunnels a second SSH handshake to the target host through it — the target never sees a direct connection from your machine.
              </div>
            </div>
          </div>

          <!-- Proxy Configuration Box -->
          <div style="background: #11141d; border: 1px solid #252b3b; border-radius: 6px; padding: 12px; margin-top: 12px;">
            <div class="sess-form-group">
              <label>Network Proxy Type</label>
              <select id="sProxyType">
                <option value="none" ${p.proxyType === 'none' || !p.proxyType ? 'selected' : ''}>Direct Connection (No Proxy)</option>
                <option value="socks5" ${p.proxyType === 'socks5' ? 'selected' : ''}>SOCKS5 Proxy</option>
                <option value="http" ${p.proxyType === 'http' ? 'selected' : ''}>HTTP CONNECT Proxy</option>
              </select>
            </div>
            <div id="proxyFields" class="${p.proxyType && p.proxyType !== 'none' ? '' : 'hidden'}">
              <div class="sess-form-row">
                <div class="sess-form-group" style="flex: 2;">
                  <label>Proxy Host</label>
                  <input type="text" id="sProxyHost" value="${escapeHtml(p.proxyHost || '')}" placeholder="127.0.0.1" />
                </div>
                <div class="sess-form-group" style="flex: 1;">
                  <label>Proxy Port</label>
                  <input type="number" id="sProxyPort" value="${p.proxyPort || 1080}" />
                </div>
              </div>
            </div>
          </div>

          <!-- Automatic Reconnection Box -->
          <div style="background: #11141d; border: 1px solid #252b3b; border-radius: 6px; padding: 12px; margin-top: 12px;">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
              <label class="checkbox-label" style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                <input type="checkbox" id="sAutoReconnect" ${p.autoReconnect ? 'checked' : ''} />
                <span><b>Auto reconnect on connection lost</b></span>
              </label>
              <span style="font-size: 11px; color: var(--accent-cyan);">Exponential Backoff (1s, 2s, 4s...)</span>
            </div>
            <div class="sess-form-row" id="reconnectConfigRow" style="margin-top: 8px;">
              <div class="sess-form-group">
                <label>Retry attempts</label>
                <input type="number" id="sReconnectAttempts" value="${p.reconnectAttempts || 5}" min="1" max="50" />
              </div>
              <div class="sess-form-group">
                <label>Retry initial delay (seconds)</label>
                <input type="number" id="sReconnectDelay" value="${p.reconnectDelay || 2}" min="1" max="60" />
              </div>
            </div>
          </div>
        </div>

        <!-- 6. APPEARANCE TAB -->
        <div id="tab-sess-app" class="sess-tab-content hidden">
          <div class="sess-section-heading">🎨 Terminal Color Palette & Theme</div>

          <div class="sess-form-row">
            <div class="sess-form-group" style="flex: 2;">
              <label>Preset Color Theme</label>
              <select id="sTheme">
                ${Object.keys(THEMES).map(th => `
                  <option value="${th}" ${p.theme === th ? 'selected' : ''}>${th.replace(/-/g, ' ').toUpperCase()}</option>
                `).join('')}
              </select>
            </div>
            <div class="sess-form-group" style="flex: 1; display: flex; align-items: flex-end;">
              <button class="btn-secondary" id="resetColorsBtn" type="button" style="width: 100%; height: 32px;">Reset to Defaults</button>
            </div>
          </div>

          <div class="sess-color-grid">
            <div class="sess-color-item">
              <input type="color" id="sFgColor" value="${fgVal.startsWith('#') ? fgVal : '#d9e0ea'}" />
              <span>Foreground</span>
            </div>
            <div class="sess-color-item">
              <input type="color" id="sBgColor" value="${bgVal.startsWith('#') ? bgVal : '#090c11'}" />
              <span>Background</span>
            </div>
            <div class="sess-color-item">
              <input type="color" id="sCursorColor" value="${curVal.startsWith('#') ? curVal : '#60a5fa'}" />
              <span>Cursor</span>
            </div>
            <div class="sess-color-item">
              <input type="color" id="sSelColor" value="#3b82f6" />
              <span>Selection</span>
            </div>
          </div>

          <div style="font-size: 11px; font-weight: 600; color: #94a3b8; margin-top: 14px; text-transform: uppercase;">
            Standard ANSI Colors (8 Regular + 8 Bright)
          </div>
          <div class="sess-color-grid" style="grid-template-columns: repeat(8, 1fr); gap: 4px; margin-top: 6px;">
            ${[
              { name: "black", def: currentThemeData.black || "#1e2233" },
              { name: "red", def: currentThemeData.red || "#f43f5e" },
              { name: "green", def: currentThemeData.green || "#10b981" },
              { name: "yellow", def: currentThemeData.yellow || "#f59e0b" },
              { name: "blue", def: currentThemeData.blue || "#3b82f6" },
              { name: "magenta", def: currentThemeData.magenta || "#8b5cf6" },
              { name: "cyan", def: currentThemeData.cyan || "#06b6d4" },
              { name: "white", def: currentThemeData.white || "#f8fafc" },
              { name: "brightBlack", def: currentThemeData.brightBlack || "#475569" },
              { name: "brightRed", def: currentThemeData.brightRed || "#fb7185" },
              { name: "brightGreen", def: currentThemeData.brightGreen || "#34d399" },
              { name: "brightYellow", def: currentThemeData.brightYellow || "#fbbf24" },
              { name: "brightBlue", def: currentThemeData.brightBlue || "#60a5fa" },
              { name: "brightMagenta", def: currentThemeData.brightMagenta || "#a78bfa" },
              { name: "brightCyan", def: currentThemeData.brightCyan || "#22d3ee" },
              { name: "brightWhite", def: currentThemeData.brightWhite || "#ffffff" },
            ].map(c => `
              <div style="display: flex; flex-direction: column; align-items: center; gap: 2px;">
                <input type="color" class="ansi-color-picker" data-ansi="${c.name}" value="${(ansi[c.name] && ansi[c.name].startsWith('#')) ? ansi[c.name] : (c.def.startsWith('#') ? c.def : '#ffffff')}" style="width: 24px; height: 24px; border: none; cursor: pointer; border-radius: 3px; background: transparent;" title="${c.name}" />
                <span style="font-size: 8px; color: #64748b; text-transform: uppercase;">${c.name.slice(0, 4)}</span>
              </div>
            `).join('')}
          </div>

          <!-- Live Terminal Preview -->
          <div class="sess-terminal-preview" id="sessTermPreview" style="background: ${bgVal}; color: ${fgVal};">
            <div><span style="color: #10b981; font-weight: bold;">root@server</span>:<span style="color: #60a5fa;">~</span># ls -la --color=auto</div>
            <div style="color: #94a3b8;">total 48</div>
            <div>drwxr-xr-x  6 root root  4096 Sep  8 12:00 <span style="color: #60a5fa; font-weight: bold;">.</span></div>
            <div>drwxr-xr-x 19 root root  4096 Aug 15 08:30 <span style="color: #3b82f6; font-weight: bold;">..</span></div>
            <div>-rw-------  1 root root  1420 Sep  8 11:20 .bash_history</div>
            <div>-rwxr-xr-x  1 root root 18432 Sep  8 14:45 <span style="color: #10b981; font-weight: bold;">nexterm-daemon</span></div>
            <div>-rw-r--r--  1 root root   852 Sep  8 10:15 <span style="color: #f59e0b;">config.json</span></div>
          </div>
        </div>

      </div>
    </div>

    <!-- Modal Footer Actions -->
    <div class="modal-footer" style="display: flex; justify-content: space-between; align-items: center;">
      <div style="display: flex; gap: 8px; align-items: center;">
        <button class="btn-secondary" id="modalCancel" type="button">Cancel</button>
        <button class="btn-secondary" id="modalTestConnect" type="button" title="Test Connection without saving permanently">🧪 Test Connection</button>
      </div>
      <div style="display: flex; gap: 8px;">
        <button class="btn-secondary" id="modalSaveOnly" type="button">${isEdit ? "Save Changes" : "Save Only"}</button>
        <button class="btn-primary" id="modalSaveConnect" type="button">⚡ ${isEdit ? "Save & Reconnect" : "Save & Connect"}</button>
      </div>
    </div>
  `, "modal-session-editor");

  // Navigation tabs switching
  box.querySelectorAll(".sess-nav-item").forEach(item => {
    item.onclick = () => {
      box.querySelectorAll(".sess-nav-item").forEach(i => i.classList.remove("active"));
      box.querySelectorAll(".sess-tab-content").forEach(c => c.classList.add("hidden"));
      item.classList.add("active");
      const target = box.querySelector(`#${item.dataset.tab}`);
      if (target) target.classList.remove("hidden");
    };
  });

  // Top Protocol Chips
  let currentProto = p.protocol || "ssh";
  const protoSelect = box.querySelector("#sProtoSelect");

  const syncProtoUI = (proto) => {
    currentProto = proto;
    if (protoSelect) protoSelect.value = proto;

    box.querySelectorAll(".sess-proto-chip").forEach(chip => {
      chip.classList.toggle("active", chip.dataset.proto === proto);
    });

    const isSerial = proto === "serial";
    const isRDP = proto === "rdp";
    const isLocal = proto === "local";

    const serialFields = box.querySelector("#generalSerialFields");
    if (serialFields) serialFields.classList.toggle("hidden", !isSerial);

    const rdpFields = box.querySelector("#generalRdpFields");
    if (rdpFields) rdpFields.classList.toggle("hidden", !isRDP);

    const netFields = box.querySelector("#generalNetworkFields");
    if (netFields) netFields.classList.toggle("hidden", isSerial || isLocal);

    const navSSH = box.querySelector("#navItemSSH");
    if (navSSH) navSSH.classList.toggle("hidden", isSerial || isRDP || isLocal);

    const navAuth = box.querySelector("#navItemAuth");
    if (navAuth) navAuth.classList.toggle("hidden", isLocal);

    const portInput = box.querySelector("#sPort");
    if (portInput) {
      if (proto === "rdp" && portInput.value === "22") portInput.value = "3389";
      else if (proto === "vnc" && portInput.value === "22") portInput.value = "5900";
      else if (proto === "telnet" && portInput.value === "22") portInput.value = "23";
      else if ((proto === "ssh" || proto === "sftp") && (portInput.value === "3389" || portInput.value === "5900")) portInput.value = "22";
    }
  };

  box.querySelectorAll(".sess-proto-chip").forEach(chip => {
    chip.onclick = () => syncProtoUI(chip.dataset.proto);
  });

  if (protoSelect) {
    protoSelect.onchange = () => syncProtoUI(protoSelect.value);
  }

  // Auto-generate session name from user@host:port
  const autoNameBtn = box.querySelector("#sAutoNameBtn");
  if (autoNameBtn) {
    autoNameBtn.onclick = () => {
      const host = box.querySelector("#sHost")?.value.trim() || "";
      const user = box.querySelector("#sUser")?.value.trim() || "";
      const port = parseInt(box.querySelector("#sPort")?.value, 10) || 22;
      let generated = "";
      if (user && host) {
        generated = `${user}@${host}`;
      } else if (host) {
        generated = host;
      } else {
        generated = host || "Server";
      }
      if (port && port !== 22 && port !== 0) {
        generated += `:${port}`;
      }
      const sNameInput = box.querySelector("#sName");
      if (sNameInput) {
        sNameInput.value = generated;
        sNameInput.focus();
      }
    };
  }

  // Password visibility eye toggles
  const togglePwBtnAuth = box.querySelector("#togglePwBtn");
  const pwAuthInput = box.querySelector("#sPassword");
  if (togglePwBtnAuth && pwAuthInput) {
    togglePwBtnAuth.onclick = () => {
      const isPw = pwAuthInput.type === "password";
      pwAuthInput.type = isPw ? "text" : "password";
      togglePwBtnAuth.textContent = isPw ? "🔒" : "👁️";
    };
  }

  const togglePwBtnGen = box.querySelector("#togglePwBtnGen");
  const pwGenInput = box.querySelector("#sPasswordGen");
  if (togglePwBtnGen && pwGenInput) {
    togglePwBtnGen.onclick = () => {
      const isPw = pwGenInput.type === "password";
      pwGenInput.type = isPw ? "text" : "password";
      togglePwBtnGen.textContent = isPw ? "🔒" : "👁️";
    };
  }

  // Bi-directional password synchronization between General and Auth tabs
  if (pwGenInput && pwAuthInput) {
    pwGenInput.oninput = () => { pwAuthInput.value = pwGenInput.value; };
    pwAuthInput.oninput = () => { pwGenInput.value = pwAuthInput.value; };
  }

  // Quick Auth Mode Switcher on General tab
  const authQuick = box.querySelector("#sAuthTypeQuick");
  const authSelect = box.querySelector("#sAuthType");
  const pwWrapGen = box.querySelector("#sPasswordGenWrap");
  const keyWrapGen = box.querySelector("#sQuickKeyWrap");

  const syncAuthQuickUI = (val) => {
    if (pwWrapGen) pwWrapGen.classList.toggle("hidden", val === "key" || val === "agent" || val === "keyboard-interactive");
    if (keyWrapGen) keyWrapGen.classList.toggle("hidden", val !== "key");
  };

  if (authQuick && authSelect) {
    authQuick.onchange = () => {
      authSelect.value = authQuick.value;
      if (typeof authSelect.onchange === "function") authSelect.onchange();
      syncAuthQuickUI(authQuick.value);
    };
    syncAuthQuickUI(authQuick.value);
  }

  // Quick Key Path sync
  const quickKeyPath = box.querySelector("#sQuickKeyPath");
  const fullKeyPath = box.querySelector("#sKeyPath");
  if (quickKeyPath && fullKeyPath) {
    quickKeyPath.oninput = () => {
      fullKeyPath.value = quickKeyPath.value;
      fullKeyPath.dispatchEvent(new Event("input"));
    };
    fullKeyPath.oninput = () => {
      quickKeyPath.value = fullKeyPath.value;
    };
  }
  const quickBrowse = box.querySelector("#sQuickBrowseKeyBtn");
  const fullBrowse = box.querySelector("#browseKeyBtn");
  if (quickBrowse && fullBrowse) {
    quickBrowse.onclick = () => fullBrowse.click();
  }

  // Auto-detect existing saved credentials on Host / Username entry
  const hostInput = box.querySelector("#sHost");
  const userInput = box.querySelector("#sUser");
  const portInput = box.querySelector("#sPort");

  const tryLookupSavedCredential = async () => {
    const h = hostInput ? hostInput.value.trim() : "";
    const u = userInput ? userInput.value.trim() : "";
    const p = (portInput ? parseInt(portInput.value, 10) : 22) || 22;
    if (h && u && window.go?.main?.App?.FindSessionPassword) {
      if (pwGenInput && !pwGenInput.value) {
        try {
          const found = await window.go.main.App.FindSessionPassword("", h, p, u);
          if (found && !pwGenInput.value) {
            pwGenInput.value = found;
            if (pwAuthInput) pwAuthInput.value = found;
            const saveCheck = box.querySelector("#sSavePasswordCheck");
            if (saveCheck) saveCheck.checked = true;
          }
        } catch (_) {}
      }
    }
  };

  if (hostInput) hostInput.addEventListener("blur", tryLookupSavedCredential);
  if (userInput) userInput.addEventListener("blur", tryLookupSavedCredential);

  // Link to Auth Tab
  const linkToAuth = box.querySelector("#linkToAuthTab");
  if (linkToAuth) {
    linkToAuth.onclick = (e) => {
      e.preventDefault();
      const authNavItem = box.querySelector('.sess-nav-item[data-tab="tab-sess-auth"]');
      if (authNavItem) authNavItem.click();
    };
  }

  // Key passphrase visibility toggle
  const toggleKeyPassBtn = box.querySelector("#toggleKeyPassBtn");
  const keyPassInput = box.querySelector("#sKeyPassphrase");
  if (toggleKeyPassBtn && keyPassInput) {
    toggleKeyPassBtn.onclick = () => {
      const isPw = keyPassInput.type === "password";
      keyPassInput.type = isPw ? "text" : "password";
      toggleKeyPassBtn.textContent = isPw ? "🔒" : "👁️";
    };
  }

  // Real-time private key inspection & validation
  const updateKeyInfo = async () => {
    const keyPathInput = box.querySelector("#sKeyPath");
    const keyPassInput = box.querySelector("#sKeyPassphrase");
    const badge = box.querySelector("#keyInfoBadge");
    if (!badge) return;

    const path = keyPathInput ? keyPathInput.value.trim() : "";
    const passphrase = keyPassInput ? keyPassInput.value : "";
    if (!path) {
      badge.innerHTML = "";
      return;
    }

    badge.innerHTML = `<span style="color: var(--text-dim);">⏳ Inspecting private key...</span>`;
    if (window.go && window.go.main && window.go.main.App && window.go.main.App.ValidatePrivateKeyFile) {
      try {
        const info = await window.go.main.App.ValidatePrivateKeyFile(path, passphrase);
        if (info && info.valid) {
          let certHtml = "";
          if (info.hasCertificate) {
            certHtml = ` • 📜 <span style="color: #67e8f9;">OpenSSH Certificate (${escapeHtml(info.certificateKeyId || 'Active')})</span>`;
          }
          badge.innerHTML = `<span style="color: #4ade80;">🟢 Valid <b>${escapeHtml(info.keyType || 'Key')}</b>${certHtml} • Fingerprint: <code>${escapeHtml(info.fingerprint || '')}</code></span>`;
        } else if (info && info.encrypted && !passphrase) {
          badge.innerHTML = `<span style="color: #fbbf24;">🔒 Encrypted private key (${escapeHtml(info.keyType || 'Key')}) • Passphrase required</span>`;
        } else if (info && info.error) {
          badge.innerHTML = `<span style="color: #f87171;">⚠️ ${escapeHtml(info.error)}</span>`;
        }
      } catch (err) {
        badge.innerHTML = `<span style="color: #f87171;">⚠️ ${escapeHtml(err.message || String(err))}</span>`;
      }
    }
  };

  // Folder & Environment Options Handlers
  const folderSelect = box.querySelector("#sFolderSelect");
  const envSelect = box.querySelector("#sEnvSelect");
  const customTagGroup = box.querySelector("#sCustomTagGroup");
  const envCustomTag = box.querySelector("#sEnvCustomTag");
  const colorPicker = box.querySelector("#sColorPicker");
  const badge = box.querySelector("#sInheritedEnvBadge");
  const hex = box.querySelector("#sInheritedColorHex");
  const dot = box.querySelector("#sInheritedDot");
  const envIn = box.querySelector("#sEnv");
  const colIn = box.querySelector("#sColor");

  const applyEnvStyle = (key, label, color, bg, border) => {
    if (badge) {
      badge.textContent = label || "DEFAULT";
      badge.className = `tab-env-badge ${key ? 'env-' + key : ''}`;
      badge.style.color = color || "#94a3b8";
      badge.style.background = bg || "rgba(255,255,255,0.08)";
      badge.style.borderColor = border || "rgba(255,255,255,0.15)";
    }
    if (hex) hex.textContent = color || "#64748b";
    if (dot) dot.style.background = color || "#64748b";
    if (colorPicker && color && color.startsWith("#")) colorPicker.value = color;
    if (envIn) envIn.value = key || "";
    if (colIn) colIn.value = color || "";
  };

  const updateEnvironmentUI = () => {
    if (!envSelect) return;
    const mode = envSelect.value;
    if (customTagGroup) {
      customTagGroup.style.display = mode === "custom" ? "block" : "none";
    }

    if (mode === "inherit") {
      const opt = folderSelect ? folderSelect.selectedOptions[0] : null;
      const rawName = opt ? opt.getAttribute("data-name") : "";
      const fEnv = getEnvironmentFromFolderName(rawName);
      if (fEnv) {
        applyEnvStyle(fEnv.key, fEnv.label, fEnv.color, fEnv.bg, fEnv.border);
      } else {
        applyEnvStyle("", "DEFAULT", "#64748b", "rgba(255,255,255,0.08)", "rgba(255,255,255,0.15)");
      }
    } else if (mode === "custom") {
      const customTag = (envCustomTag?.value || "CUSTOM").trim().toUpperCase() || "CUSTOM";
      const customCol = colorPicker?.value || "#10b981";
      applyEnvStyle("custom", customTag, customCol, `${customCol}28`, `${customCol}60`);
      if (envIn) envIn.value = customTag;
    } else if (mode === "none") {
      applyEnvStyle("", "NONE", "#64748b", "rgba(255,255,255,0.08)", "rgba(255,255,255,0.15)");
    } else {
      const info = ENVIRONMENTS[mode] || getEnvironmentInfo(mode);
      if (info) {
        applyEnvStyle(info.key, info.label, info.color, info.bg, info.border);
      } else {
        applyEnvStyle(mode, mode.toUpperCase(), colorPicker?.value || "#3b82f6", "rgba(59,130,246,0.18)", "rgba(59,130,246,0.45)");
      }
    }
  };

  if (envSelect) {
    envSelect.onchange = updateEnvironmentUI;
  }
  if (folderSelect) {
    folderSelect.onchange = () => {
      const selected = availableFolders.find(f => f.id === folderSelect.value);
      if (selected) {
        const userInp = box.querySelector("#sUser");
        if (userInp && !userInp.value.trim() && selected.defaultUsername) {
          userInp.value = selected.defaultUsername;
        }
        if (selected.defaultPort && box.querySelector("#sPort")) {
          const curP = parseInt(box.querySelector("#sPort").value, 10);
          if (!curP || curP === 22) {
            box.querySelector("#sPort").value = selected.defaultPort;
          }
        }
        if (selected.environment && envSelect && envSelect.value === "inherit") {
          updateEnvironmentUI();
        }
      }
      if (envSelect && envSelect.value === "inherit") {
        updateEnvironmentUI();
      }
    };
  }
  if (colorPicker) {
    colorPicker.oninput = () => {
      const c = colorPicker.value;
      if (colIn) colIn.value = c;
      if (hex) hex.textContent = c;
      if (dot) dot.style.background = c;
      if (badge) {
        badge.style.color = c;
        badge.style.background = `${c}28`;
        badge.style.borderColor = `${c}60`;
      }
    };
  }
  if (envCustomTag) {
    envCustomTag.oninput = () => {
      if (envSelect && envSelect.value === "custom") {
        updateEnvironmentUI();
      }
    };
  }

  // Initial environment setup
  if (p.environment) {
    const knownKeys = ['prod', 'uat', 'test', 'testing', 'dev', 'staging', 'dr', 'none'];
    const lowerEnv = p.environment.toLowerCase();
    if (knownKeys.includes(lowerEnv)) {
      if (envSelect) envSelect.value = lowerEnv === 'test' ? 'testing' : lowerEnv;
    } else {
      if (envSelect) envSelect.value = "custom";
      if (envCustomTag) envCustomTag.value = p.environment;
      if (customTagGroup) customTagGroup.style.display = "block";
    }
  } else {
    if (envSelect) envSelect.value = "inherit";
  }
  if (p.color && colorPicker && p.color.startsWith("#")) {
    colorPicker.value = p.color;
  }
  updateEnvironmentUI();

  // Quick Folder Creation Button
  const quickFolderBtn = box.querySelector("#sNewFolderQuickBtn");
  if (quickFolderBtn) {
    quickFolderBtn.onclick = () => {
      const folderName = prompt("Enter new folder name (e.g. Staging, Production, Databases):");
      if (!folderName || !folderName.trim()) return;
      if (window.go && window.go.main && window.go.main.App && window.go.main.App.AddFolder) {
        window.go.main.App.AddFolder("", folderName.trim()).then((updatedTree) => {
          showToast(`Folder "${folderName.trim()}" created`, "success");
          if (folderSelect && updatedTree) {
            const folders = [];
            const scan = (node, depth = 0) => {
              if (node.isDir && node.id !== "root") {
                folders.push({ id: node.id, name: `${"  ".repeat(depth)}${depth > 0 ? "└─ " : "📁 "}${node.name}`, rawName: node.name });
              }
              if (node.children) node.children.forEach(c => scan(c, depth + (node.id === "root" ? 0 : 1)));
            };
            scan(updatedTree);
            folderSelect.innerHTML = `<option value="">(Root / Unassigned)</option>` + folders.map(f => `<option value="${f.id}" data-name="${escapeHtml(f.rawName)}">${escapeHtml(f.name)}</option>`).join("");
            const created = folders.find(f => f.rawName.toLowerCase() === folderName.trim().toLowerCase());
            if (created) {
              folderSelect.value = created.id;
              if (envSelect && envSelect.value === "inherit") {
                updateEnvironmentUI();
              }
            }
          }
        }).catch(err => {
          showToast("Failed to create folder: " + err, "error");
        });
      }
    };
  }

  // SSH Agent status checker
  const updateAgentStatus = async () => {
    const statusDiv = box.querySelector("#sessAgentStatus");
    if (!statusDiv) return;
    statusDiv.innerHTML = `<span style="color: var(--text-dim);">Checking SSH Agent...</span>`;
    if (window.go && window.go.main && window.go.main.App && window.go.main.App.CheckSSHAgent) {
      try {
        const res = await window.go.main.App.CheckSSHAgent();
        if (res && res.available) {
          statusDiv.innerHTML = `<span style="color: #4ade80;">🟢 SSH Agent active (${res.keyCount} key${res.keyCount === 1 ? '' : 's'} loaded)</span>`;
        } else {
          statusDiv.innerHTML = `<span style="color: #94a3b8;">⚠️ SSH Agent not detected (${escapeHtml(res.error || 'Agent service not running')})</span>`;
        }
      } catch (_) {
        statusDiv.innerHTML = `<span style="color: #94a3b8;">⚠️ SSH Agent unreachable</span>`;
      }
    }
  };

  const refreshAgentBtn = box.querySelector("#refreshAgentBtn");
  if (refreshAgentBtn) {
    refreshAgentBtn.onclick = () => updateAgentStatus();
  }

  // Auth type dropdown
  const passFields = box.querySelector("#sessPassFields");
  const keyFields = box.querySelector("#sessKeyFields");
  if (authSelect) {
    authSelect.onchange = () => {
      const isKey = authSelect.value === "key";
      const isAgent = authSelect.value === "agent";
      const isAuto = authSelect.value === "auto";
      const isKI = authSelect.value === "keyboard-interactive";
      const isPass = authSelect.value === "password";

      if (passFields) passFields.classList.toggle("hidden", isKey || isAgent);
      if (keyFields) keyFields.classList.toggle("hidden", isPass || isAgent || isKI);
      if (isAgent || isAuto) updateAgentStatus();
      if (isKey || isAuto) updateKeyInfo();
      if (authQuick) authQuick.value = authSelect.value;
      syncAuthQuickUI(authSelect.value);
    };
  }

  // Live password synchronization between the General and Auth tabs is already
  // wired earlier in this function (pwGenInput / pwAuthInput). Re-declaring them
  // here previously caused a fatal "Identifier 'pwGenInput' has already been
  // declared" SyntaxError, which prevented this entire module from loading and
  // broke session creation plus every feature that imports it.

  // Automatic credential detection: if password empty, check if vault already has credentials for this host/user
  const checkSavedCreds = async () => {
    const h = box.querySelector("#sHost")?.value?.trim();
    const u = box.querySelector("#sUser")?.value?.trim();
    const p = parseInt(box.querySelector("#sPort")?.value, 10) || 22;
    if (h && u && (!pwGenInput || !pwGenInput.value) && window.go?.main?.App?.FindSessionPassword) {
      try {
        const found = await window.go.main.App.FindSessionPassword("", h, p, u);
        if (found && pwGenInput && !pwGenInput.value) {
          pwGenInput.value = found;
          if (pwAuthInput) pwAuthInput.value = found;
          showToast(`⚡ Auto-loaded saved credentials for ${u}@${h}`, "info");
        }
      } catch (_) {}
    }
  };
  box.querySelector("#sHost")?.addEventListener("change", checkSavedCreds);
  box.querySelector("#sUser")?.addEventListener("change", checkSavedCreds);

  // Key inputs live change
  const keyPathInput = box.querySelector("#sKeyPath");
  if (keyPathInput) {
    keyPathInput.oninput = () => updateKeyInfo();
  }
  if (keyPassInput) {
    keyPassInput.oninput = () => updateKeyInfo();
  }

  // Agent forwarding checkbox
  const useAgentCheck = box.querySelector("#sUseAgent");
  if (useAgentCheck) {
    useAgentCheck.onchange = () => {
      if (useAgentCheck.checked) updateAgentStatus();
      else {
        const statusDiv = box.querySelector("#sessAgentStatus");
        if (statusDiv && authSelect?.value !== "agent") statusDiv.innerHTML = "";
      }
    };
  }

  // Browse key button
  const browseKeyBtn = box.querySelector("#browseKeyBtn");
  if (browseKeyBtn) {
    browseKeyBtn.onclick = async () => {
      if (window.go && window.go.main && window.go.main.App && window.go.main.App.SelectPrivateKeyFile) {
        try {
          const path = await window.go.main.App.SelectPrivateKeyFile();
          if (path) {
            box.querySelector("#sKeyPath").value = path;
            await updateKeyInfo();
          }
        } catch (_) {}
      }
    };
  }

  // Browse cert button
  const browseCertBtn = box.querySelector("#browseCertBtn");
  if (browseCertBtn) {
    browseCertBtn.onclick = async () => {
      if (window.go && window.go.main && window.go.main.App && window.go.main.App.SelectPrivateKeyFile) {
        try {
          const path = await window.go.main.App.SelectPrivateKeyFile();
          if (path && box.querySelector("#sCertPath")) {
            box.querySelector("#sCertPath").value = path;
          }
        } catch (_) {}
      }
    };
  }

  // Initial key and agent checks
  if (p.privateKeyPath) {
    updateKeyInfo();
  }
  if (p.useAgent || p.authType === "agent") {
    updateAgentStatus();
  }

  // Jump Host checkbox toggle
  const jumpCheck = box.querySelector("#sUseJump");
  const jumpFields = box.querySelector("#jumpFields");
  if (jumpCheck && jumpFields) {
    jumpCheck.onchange = () => jumpFields.classList.toggle("hidden", !jumpCheck.checked);
  }

  // Jump Host auth-method toggle (password vs private key)
  const jumpAuthSelect = box.querySelector("#sJumpAuthType");
  const jumpPassFields = box.querySelector("#jumpPassFields");
  const jumpKeyFields = box.querySelector("#jumpKeyFields");
  if (jumpAuthSelect && jumpPassFields && jumpKeyFields) {
    jumpAuthSelect.onchange = () => {
      const isKey = jumpAuthSelect.value === "key";
      jumpPassFields.classList.toggle("hidden", isKey);
      jumpKeyFields.classList.toggle("hidden", !isKey);
    };
  }

  // Jump Host private key file browser
  const browseJumpKeyBtn = box.querySelector("#browseJumpKeyBtn");
  if (browseJumpKeyBtn) {
    browseJumpKeyBtn.onclick = async () => {
      if (window.go && window.go.main && window.go.main.App && window.go.main.App.SelectPrivateKeyFile) {
        try {
          const path = await window.go.main.App.SelectPrivateKeyFile();
          if (path) {
            const jumpKeyInput = box.querySelector("#sJumpKeyPath");
            if (jumpKeyInput) jumpKeyInput.value = path;
          }
        } catch (_) {}
      }
    };
  }

  // Proxy type dropdown toggle
  const proxySelect = box.querySelector("#sProxyType");
  const proxyFields = box.querySelector("#proxyFields");
  if (proxySelect && proxyFields) {
    proxySelect.onchange = () => proxyFields.classList.toggle("hidden", proxySelect.value === "none");
  }

  // Theme & Appearance live preview synchronization
  const themeSelect = box.querySelector("#sTheme");
  const fgPicker = box.querySelector("#sFgColor");
  const bgPicker = box.querySelector("#sBgColor");
  const termPreview = box.querySelector("#sessTermPreview");

  const updatePreview = () => {
    if (!termPreview) return;
    termPreview.style.background = bgPicker ? bgPicker.value : "#090c11";
    termPreview.style.color = fgPicker ? fgPicker.value : "#d9e0ea";
    const fontVal = box.querySelector("#sFontFamily") ? box.querySelector("#sFontFamily").value : "Cascadia Mono, monospace";
    termPreview.style.fontFamily = fontVal;
  };

  if (fgPicker) fgPicker.oninput = updatePreview;
  if (bgPicker) bgPicker.oninput = updatePreview;

  if (themeSelect) {
    themeSelect.onchange = () => {
      const th = THEMES[themeSelect.value];
      if (th) {
        if (fgPicker && th.foreground) fgPicker.value = th.foreground.startsWith('#') ? th.foreground : '#d9e0ea';
        if (bgPicker && th.background) bgPicker.value = th.background.startsWith('#') ? th.background : '#090c11';
        box.querySelectorAll(".ansi-color-picker").forEach(inp => {
          const name = inp.dataset.ansi;
          if (th[name] && th[name].startsWith('#')) inp.value = th[name];
        });
        updatePreview();
      }
    };
  }

  const resetColorsBtn = box.querySelector("#resetColorsBtn");
  if (resetColorsBtn) {
    resetColorsBtn.onclick = () => {
      const th = THEMES["dark-modern"];
      if (fgPicker) fgPicker.value = th.foreground;
      if (bgPicker) bgPicker.value = th.background;
      box.querySelectorAll(".ansi-color-picker").forEach(inp => {
        const name = inp.dataset.ansi;
        if (th[name]) inp.value = th[name];
      });
      updatePreview();
    };
  }

  box.querySelector("#modalClose").onclick = hideModal;
  box.querySelector("#modalCancel").onclick = hideModal;

  // Save handler
  const handleSaveSession = async (andConnect = false) => {
    const host = box.querySelector("#sHost") ? box.querySelector("#sHost").value.trim() : "";
    const username = box.querySelector("#sUser") ? box.querySelector("#sUser").value.trim() : "";
    const authQuick = box.querySelector("#sAuthTypeQuick");
    const authSelect = box.querySelector("#sAuthType");
    const folderSelect = box.querySelector("#sFolderSelect");

    if (currentProto !== "serial" && currentProto !== "local" && !host) {
      showToast("Remote Host / IP is required", "error");
      return;
    }

    const ansiColorsObj = {};
    box.querySelectorAll(".ansi-color-picker").forEach(inp => {
      ansiColorsObj[inp.dataset.ansi] = inp.value;
    });

    const profileId = (isEdit && editProfile?.id) ? editProfile.id : (window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID() : ('sess-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9)));
    const vaultKey = (isEdit && editProfile?.vaultKey) ? editProfile.vaultKey : profileId;

    const rawName = box.querySelector("#sName") ? box.querySelector("#sName").value.trim() : "";
    const finalName = (rawName && rawName !== "New Server" && rawName !== "New Session")
      ? rawName
      : (host ? (username ? `${username}@${host}` : host) : "Server");

    const profile = {
      id: profileId,
      vaultKey: vaultKey,
      name: finalName,
      protocol: currentProto,
      host,
      port: parseInt(box.querySelector("#sPort").value, 10) || (currentProto === "rdp" ? 3389 : 22),
      username,
      authType: authQuick ? authQuick.value : (authSelect ? authSelect.value : "password"),
      environment: box.querySelector("#sEnv") ? box.querySelector("#sEnv").value : "",
      color: box.querySelector("#sColor") ? box.querySelector("#sColor").value : "",
      privateKeyPath: (authSelect && (authSelect.value === "key" || authSelect.value === "auto")) ? box.querySelector("#sKeyPath").value.trim() : "",
      certificatePath: box.querySelector("#sCertPath") ? box.querySelector("#sCertPath").value.trim() : "",
      keyPassphrase: box.querySelector("#sKeyPassphrase") ? box.querySelector("#sKeyPassphrase").value : "",
      useAgent: box.querySelector("#sUseAgent") ? box.querySelector("#sUseAgent").checked : (authSelect?.value === "agent"),

      // Terminal
      terminalType: box.querySelector("#sTermType") ? box.querySelector("#sTermType").value : "xterm-256color",
      fontFamily: box.querySelector("#sFontFamily") ? box.querySelector("#sFontFamily").value : "Cascadia Mono, Consolas, monospace",
      fontSize: parseInt(box.querySelector("#sFontSize").value, 10) || 13,
      rows: parseInt(box.querySelector("#sRows").value, 10) || 24,
      cols: parseInt(box.querySelector("#sCols").value, 10) || 80,
      cursorStyle: box.querySelector("#sCursorStyle") ? box.querySelector("#sCursorStyle").value : "block",
      cursorBlink: box.querySelector("#sCursorBlink") ? box.querySelector("#sCursorBlink").checked : true,
      encoding: box.querySelector("#sEncoding") ? box.querySelector("#sEncoding").value : "utf-8",
      scrollback: parseInt(box.querySelector("#sScrollback").value, 10) || 10000,

      // Startup
      startupCommand: box.querySelector("#sStartup") ? box.querySelector("#sStartup").value.trim() : "",
      workingDirectory: box.querySelector("#sWorkDir") ? box.querySelector("#sWorkDir").value.trim() : "",

      // SSH Advanced
      keepAliveInterval: parseInt(box.querySelector("#sKeepAlive").value, 10) || 15,
      connectionTimeout: parseInt(box.querySelector("#sTimeout").value, 10) || 10,
      compression: box.querySelector("#sCompression") ? box.querySelector("#sCompression").checked : false,
      x11Forwarding: box.querySelector("#sX11Forwarding") ? box.querySelector("#sX11Forwarding").checked : false,
      autoReconnect: box.querySelector("#sAutoReconnect") ? box.querySelector("#sAutoReconnect").checked : false,
      reconnectAttempts: parseInt(box.querySelector("#sReconnectAttempts")?.value, 10) || 5,
      reconnectDelay: parseInt(box.querySelector("#sReconnectDelay")?.value, 10) || 2,
      proxyType: box.querySelector("#sProxyType") ? box.querySelector("#sProxyType").value : "none",
      proxyHost: box.querySelector("#sProxyHost") ? box.querySelector("#sProxyHost").value.trim() : "",
      proxyPort: parseInt(box.querySelector("#sProxyPort")?.value, 10) || 1080,

      // Jump Host
      useJumpHost: box.querySelector("#sUseJump") ? box.querySelector("#sUseJump").checked : false,
      jumpHost: box.querySelector("#sJumpHost") ? box.querySelector("#sJumpHost").value.trim() : "",
      jumpPort: parseInt(box.querySelector("#sJumpPort")?.value, 10) || 22,
      jumpUsername: box.querySelector("#sJumpUser") ? box.querySelector("#sJumpUser").value.trim() : "bastion",
      jumpAuthType: box.querySelector("#sJumpAuthType") ? box.querySelector("#sJumpAuthType").value : "password",
      jumpPrivateKeyPath: (box.querySelector("#sJumpAuthType") && box.querySelector("#sJumpAuthType").value === "key" && box.querySelector("#sJumpKeyPath"))
        ? box.querySelector("#sJumpKeyPath").value.trim()
        : "",
      // Deterministic per-session vault key so the bastion secret survives a
      // reload the same way the main vaultKey does. Reusing vaultKey (rather
      // than jumpHost/jumpUser) keeps two sessions that share one bastion but
      // use different bastion accounts from colliding in the vault.
      jumpVaultKey: (isEdit && editProfile?.jumpVaultKey) ? editProfile.jumpVaultKey : (vaultKey + "_jump"),

      // Appearance
      theme: themeSelect ? themeSelect.value : "dark-modern",
      foreground: fgPicker ? fgPicker.value : "",
      background: bgPicker ? bgPicker.value : "",
      cursorColor: box.querySelector("#sCursorColor") ? box.querySelector("#sCursorColor").value : "",
      selectionColor: box.querySelector("#sSelColor") ? box.querySelector("#sSelColor").value : "",
      ansiColors: ansiColorsObj,

      // Serial
      serialPort: box.querySelector("#sSerialPort") ? box.querySelector("#sSerialPort").value : "COM1",
      baudRate: parseInt(box.querySelector("#sBaudRate")?.value, 10) || 115200,
      dataBits: parseInt(box.querySelector("#sDataBits")?.value, 10) || 8,
      stopBits: parseInt(box.querySelector("#sStopBits")?.value, 10) || 1,
      parity: box.querySelector("#sParity") ? box.querySelector("#sParity").value : "none",

      // RDP
      rdpDomain: box.querySelector("#sRDPDomain") ? box.querySelector("#sRDPDomain").value.trim() : "",
      rdpFullScreen: box.querySelector("#sRDPFullScreen") ? box.querySelector("#sRDPFullScreen").checked : false
    };

    const enteredPw = (box.querySelector("#sPasswordGen")?.value || box.querySelector("#sPassword")?.value || "");
    const shouldSavePw = box.querySelector("#sSavePasswordCheck") ? box.querySelector("#sSavePasswordCheck").checked : true;
    const jumpPw = box.querySelector("#sJumpPassword") ? box.querySelector("#sJumpPassword").value : "";
    const jumpKeyPass = box.querySelector("#sJumpKeyPassphrase") ? box.querySelector("#sJumpKeyPassphrase").value : "";
    if (enteredPw) {
      profile.password = enteredPw;
    }
    hideModal();

    if (window.go && window.go.main && window.go.main.App) {
      const selectedFolderId = folderSelect ? folderSelect.value : "";
      if (isEdit) {
        await window.go.main.App.UpdateSession(profile);
        if (selectedFolderId !== detectedFolderId && detectedFolderId !== undefined) {
          const nodeToMove = (function findNodeBySessionId(n, id) {
            if (!n) return null;
            if (n.session && n.session.id === id) return n;
            if (n.children) {
              for (const c of n.children) {
                const found = findNodeBySessionId(c, id);
                if (found) return found;
              }
            }
            return null;
          })(rootNode, profile.id);
          if (nodeToMove) {
            await window.go.main.App.MoveNode(nodeToMove.id, selectedFolderId || rootNode.id, -1);
          }
        }
        showToast(`Updated "${profile.name}"`, "success");
      } else {
        const targetFolder = selectedFolderId || parentFolderId || "";
        await window.go.main.App.AddSession(targetFolder, profile);
        if (targetFolder && window.go.main.App.ToggleFolder) {
          try {
            await window.go.main.App.ToggleFolder(targetFolder, true);
          } catch (_) {}
        }
        showToast(`Saved session "${profile.name}"`, "success");
      }
      if (enteredPw && profile.vaultKey && shouldSavePw) {
        await window.go.main.App.SaveSessionPassword(profile.vaultKey, enteredPw);
        if (profile.host && profile.username) {
          const safeHost = profile.host.replace(/[^a-zA-Z0-9_-]/g, "_");
          const safeUser = profile.username.replace(/[^a-zA-Z0-9_-]/g, "_");
          const port = profile.port || 22;
          const detKey = `session_${safeUser}_${safeHost}_${port}`;
          if (detKey !== profile.vaultKey && typeof window.go.main.App.SaveSessionPassword === "function") {
            await window.go.main.App.SaveSessionPassword(detKey, enteredPw);
          }
        }
      }
      const enteredPass = box.querySelector("#sKeyPassphrase") ? box.querySelector("#sKeyPassphrase").value : "";
      if (enteredPass && profile.vaultKey) {
        await window.go.main.App.SaveSessionPassword(profile.vaultKey + "_passphrase", enteredPass);
      }
      if (jumpPw && profile.jumpVaultKey && profile.jumpAuthType !== "key") {
        await window.go.main.App.SaveSessionPassword(profile.jumpVaultKey, jumpPw);
      }
      if (jumpKeyPass && profile.jumpVaultKey && profile.jumpAuthType === "key") {
        await window.go.main.App.SaveSessionPassword(profile.jumpVaultKey + "_passphrase", jumpKeyPass);
      }
    }
    await triggerRefreshTree();

    if (andConnect) {
      if (currentProto === "rdp") {
        showToast(`Launching native RDP session to ${profile.host}...`, "info");
        if (window.go && window.go.main && window.go.main.App) {
          await window.go.main.App.LaunchRDPSession(profile, enteredPw);
        }
      } else {
        connectToSession(profile);
      }
    }
  };

  // Test Connection Action
  const testConnBtn = box.querySelector("#modalTestConnect");
  if (testConnBtn) {
    testConnBtn.onclick = async () => {
      const host = box.querySelector("#sHost")?.value.trim();
      if (currentProto !== "serial" && currentProto !== "local" && !host) {
        showToast("Enter Remote Host / IP to test connection", "error");
        return;
      }
      const port = parseInt(box.querySelector("#sPort")?.value, 10) || (currentProto === "rdp" ? 3389 : 22);
      testConnBtn.disabled = true;
      testConnBtn.textContent = "⏳ Testing...";
      try {
        if (window.go && window.go.main && window.go.main.App && window.go.main.App.ScanPorts) {
          const res = await window.go.main.App.ScanPorts(host, String(port), 4000);
          if (res && res.length > 0 && res[0].open) {
            showToast(`✅ Port ${port} reachable on ${host}!`, "success");
          } else {
            showToast(`⚠️ Cannot reach ${host}:${port} (Port closed or timed out)`, "warning");
          }
        } else {
          showToast(`Configuration for ${host}:${port} is valid!`, "success");
        }
      } catch (err) {
        showToast("Test connection failed: " + err, "error");
      } finally {
        testConnBtn.disabled = false;
        testConnBtn.textContent = "🧪 Test Connection";
      }
    };
  }

  box.querySelector("#modalSaveOnly").onclick = () => handleSaveSession(false);
  box.querySelector("#modalSaveConnect").onclick = () => handleSaveSession(true);
}

// --------------------------------------------------------------------------
// Folder Creation / Rename Dialog
// --------------------------------------------------------------------------

export function showFolderDialog(parentFolderId = "", editNode = null) {
  const isEdit = !!editNode;
  const currentEnv = editNode?.environment || "";
  const currentColor = editNode?.color || "#3b82f6";
  const currentUsername = editNode?.defaultUsername || "";
  const currentPort = editNode?.defaultPort || 22;

  const box = showModal(`
    <div class="modal-header">
      <div class="modal-title">📁 ${isEdit ? "Folder Properties & Options" : "New Folder"}</div>
      <button class="modal-close-btn" id="modalClose">&times;</button>
    </div>
    <div class="modal-body" style="display: flex; flex-direction: column; gap: 14px;">
      <div class="form-group">
        <label>Folder Name *</label>
        <input type="text" id="fNameInput" value="${escapeHtml(isEdit ? editNode.name : '')}" placeholder="e.g. Production Cluster, Database Servers, AWS" autocomplete="off" />
      </div>

      <div style="background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 6px; padding: 12px; display: flex; flex-direction: column; gap: 10px;">
        <div style="font-size: 11.5px; font-weight: 700; color: var(--text-primary); display: flex; align-items: center; justify-content: space-between;">
          <span>⚡ Default Credentials & Connection Options</span>
          <span style="font-size: 10.5px; color: var(--text-dim); font-weight: normal;">Inherited by sessions in this folder</span>
        </div>

        <div style="display: flex; gap: 10px;">
          <div class="form-group" style="flex: 2;">
            <label>Default Username</label>
            <input type="text" id="fUsernameInput" value="${escapeHtml(currentUsername)}" placeholder="e.g. root, admin, ubuntu" autocomplete="off" />
          </div>
          <div class="form-group" style="flex: 1;">
            <label>Default Port</label>
            <input type="number" id="fPortInput" value="${currentPort || 22}" min="1" max="65535" />
          </div>
        </div>

        <div style="display: flex; gap: 10px; align-items: flex-end;">
          <div class="form-group" style="flex: 2;">
            <label>Environment Tag</label>
            <select id="fEnvSelect">
              <option value="" ${!currentEnv ? 'selected' : ''}>None / Auto from Name</option>
              <option value="prod" ${currentEnv === 'prod' ? 'selected' : ''}>🔴 Production (PROD)</option>
              <option value="uat" ${currentEnv === 'uat' ? 'selected' : ''}>🟠 UAT (Staging)</option>
              <option value="testing" ${currentEnv === 'testing' || currentEnv === 'test' ? 'selected' : ''}>🟢 Testing (TEST)</option>
              <option value="dev" ${currentEnv === 'dev' ? 'selected' : ''}>🔵 Development (DEV)</option>
              <option value="staging" ${currentEnv === 'staging' ? 'selected' : ''}>🟣 Staging (STAGE)</option>
              <option value="dr" ${currentEnv === 'dr' ? 'selected' : ''}>🌸 Disaster Recovery (DR)</option>
            </select>
          </div>
          <div class="form-group" style="flex: 1;">
            <label>Folder Color</label>
            <div style="display: flex; align-items: center; gap: 6px; height: 32px;">
              <input type="color" id="fColorPicker" value="${currentColor.startsWith('#') ? currentColor : '#3b82f6'}" style="width: 32px; height: 32px; padding: 0; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; cursor: pointer; background: transparent;" />
              <span id="fColorHex" style="font-size: 11px; font-family: monospace; color: var(--text-dim);">${currentColor}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn-secondary" id="modalCancel">Cancel</button>
      <button class="btn-primary" id="modalSave">${isEdit ? 'Save Changes' : 'Create Folder'}</button>
    </div>
  `);

  const input = box.querySelector("#fNameInput");
  const colorPicker = box.querySelector("#fColorPicker");
  const colorHex = box.querySelector("#fColorHex");
  if (colorPicker && colorHex) {
    colorPicker.oninput = () => {
      colorHex.textContent = colorPicker.value;
    };
  }
  input.focus();

  const doSave = async () => {
    const name = input.value.trim();
    if (!name) return;
    const defaultUser = (box.querySelector("#fUsernameInput")?.value || "").trim();
    const defaultPort = parseInt(box.querySelector("#fPortInput")?.value, 10) || 22;
    const env = box.querySelector("#fEnvSelect")?.value || "";
    const col = box.querySelector("#fColorPicker")?.value || "";

    hideModal();
    if (window.go && window.go.main && window.go.main.App) {
      if (isEdit) {
        if (typeof window.go.main.App.ConfigureFolder === "function") {
          await window.go.main.App.ConfigureFolder(editNode.id, name, defaultUser, env, col, defaultPort);
        } else {
          await window.go.main.App.UpdateFolder(editNode.id, name);
        }
        showToast(`Folder "${name}" updated`, "success");
      } else {
        if (typeof window.go.main.App.AddFolderWithOptions === "function") {
          await window.go.main.App.AddFolderWithOptions(parentFolderId, name, defaultUser, env, col, defaultPort);
        } else {
          await window.go.main.App.AddFolder(parentFolderId, name);
        }
        showToast(`Folder "${name}" created`, "success");
      }
    }
    await triggerRefreshTree();
  };

  box.querySelector("#modalSave").onclick = doSave;
  box.querySelector("#modalCancel").onclick = hideModal;
  box.querySelector("#modalClose").onclick = hideModal;
  input.onkeydown = (e) => { if (e.key === "Enter") doSave(); };
}

// --------------------------------------------------------------------------
// Rename Node Dialog
// --------------------------------------------------------------------------

export function showRenameNodeDialog(nodeId, currentName, isFolder = false) {
  const box = showModal(`
    <div class="modal-header">
      <div class="modal-title">✏️ Rename ${isFolder ? 'Folder' : 'Session'}</div>
      <button class="modal-close-btn" id="modalClose">&times;</button>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label>Name</label>
        <input type="text" id="renameNodeInput" value="${escapeHtml(currentName)}" autocomplete="off" />
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn-secondary" id="modalCancel">Cancel</button>
      <button class="btn-primary" id="modalSave">Save</button>
    </div>
  `);

  const input = box.querySelector("#renameNodeInput");
  input.focus();
  input.select();

  const doSave = async () => {
    const name = input.value.trim();
    if (!name || name === currentName) {
      hideModal();
      return;
    }
    hideModal();
    try {
      if (window.go && window.go.main && window.go.main.App) {
        await window.go.main.App.RenameNode(nodeId, name);
      }
      await triggerRefreshTree();
      showToast(`Renamed to "${name}"`, "success");
    } catch (err) {
      showToast("Rename failed: " + err, "error");
    }
  };

  box.querySelector("#modalSave").onclick = doSave;
  box.querySelector("#modalCancel").onclick = hideModal;
  box.querySelector("#modalClose").onclick = hideModal;
  input.onkeydown = (e) => { if (e.key === "Enter") doSave(); };
}

// --------------------------------------------------------------------------
// Move Node Dialog
// --------------------------------------------------------------------------

export function showMoveNodeDialog(nodeId, nodeName, isFolder = false) {
  const folders = [];
  function collectFolders(n, path = "") {
    if (!n || n.session) return;
    if (isFolder && (n.id === nodeId || isDescendantInTree(nodeId, n.id))) return;
    const curPath = path ? `${path} / ${n.name}` : n.name;
    folders.push({ id: n.id, name: n.name, path: curPath });
    if (n.children) {
      n.children.forEach(c => collectFolders(c, curPath));
    }
  }
  collectFolders(rootNode);

  const box = showModal(`
    <div class="modal-header">
      <div class="modal-title">📦 Move "${escapeHtml(nodeName)}" to Folder</div>
      <button class="modal-close-btn" id="modalClose">&times;</button>
    </div>
    <div class="modal-body">
      <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 10px;">
        Select destination folder:
      </div>
      <div class="folder-picker-list" style="max-height: 240px; overflow-y: auto; display: flex; flex-direction: column; gap: 4px;">
        ${folders.map(f => `
          <div class="folder-picker-item" data-id="${f.id}" style="padding: 8px 12px; background: rgba(255,255,255,0.03); border: 1px solid var(--border-subtle); border-radius: 4px; cursor: pointer; display: flex; align-items: center; gap: 8px; font-size: 12px; transition: background 0.12s;">
            <span>📁</span>
            <span style="font-weight: 500;">${escapeHtml(f.path)}</span>
          </div>
        `).join('')}
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn-secondary" id="modalCancel">Cancel</button>
    </div>
  `);

  box.querySelectorAll(".folder-picker-item").forEach(el => {
    el.onmouseover = () => el.style.background = "rgba(59, 130, 246, 0.15)";
    el.onmouseout = () => el.style.background = "rgba(255,255,255,0.03)";
    el.onclick = async () => {
      const targetId = el.dataset.id;
      hideModal();
      try {
        if (window.go && window.go.main && window.go.main.App) {
          await window.go.main.App.MoveNode(nodeId, targetId, -1);
        }
        await triggerRefreshTree();
        showToast(`Moved "${nodeName}"`, "success");
      } catch (err) {
        showToast("Move failed: " + err, "error");
      }
    };
  });

  box.querySelector("#modalCancel").onclick = hideModal;
  box.querySelector("#modalClose").onclick = hideModal;
}
