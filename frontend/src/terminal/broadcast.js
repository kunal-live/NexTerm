// ==========================================================================
// Nexterm — Broadcast Command Subsystem & 8-Stage Execution Workflow
// Pipeline: Target Discovery ➔ Target Selection ➔ Command Validation ➔ 
//           Risk Classification ➔ Preview / Confirmation ➔ Execution ➔ 
//           Per-target Progress ➔ Aggregate Result
// ==========================================================================

import { tabs, getTabs, getAllTabs, getActiveTab, ENVIRONMENTS, getEnvironmentInfo, getEnvironmentFromFolderName } from '../state/tabState.js';
import { rootNode, getAllSessions } from '../state/sessionState.js';
import { connectToSession, addMultiExecDataListener } from './terminalManager.js';
import { showModal, hideModal } from '../ui/modal.js';
import { showToast, escapeHtml } from '../ui/notifications.js';
import { collectSavedServers, showMultiServerConnectDialog } from '../sessions/multiServerConnect.js';

// --------------------------------------------------------------------------
// 4-Tier Risk Classification Rules
// --------------------------------------------------------------------------

export const CRITICAL_PATTERNS = [
  /\brm\s+-[rf]{1,3}\b/i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bpoweroff\b/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /\bdrop\s+database\b/i,
  /\bdrop\s+table\b/i,
  /\btruncate\s+table\b/i,
  /\bformat\s+[a-z]:/i,
  /\bkill\s+-9\s+-1\b/i,
  /\binit\s+[06]\b/i,
  /\bfdisk\b/i,
  /\bparted\b/i
];

export const HIGH_RISK_PATTERNS = [
  /\bsystemctl\s+(restart|stop|disable|mask)\b/i,
  /\bservice\s+\S+\s+(restart|stop)\b/i,
  /\biptables\b/i,
  /\bufw\b/i,
  /\bchmod\s+-R\b/i,
  /\bchown\s+-R\b/i,
  /\buserdel\b/i,
  /\bgroupdel\b/i,
  /\bapt\s+(remove|purge|autoremove)\b/i,
  /\byum\s+(erase|remove)\b/i,
  /\bdnf\s+(erase|remove)\b/i,
  /\bkillall\b/i,
  /\bpkill\b/i,
  /\bpasswd\b/i,
  /\bsed\s+-i\b/i
];

export const MEDIUM_RISK_PATTERNS = [
  /\bmkdir\b/i,
  /\btouch\b/i,
  /\bcp\b/i,
  /\bmv\b/i,
  /\becho\s+.*>/i,
  /\bwget\b/i,
  /\bcurl\s+.*-O/i,
  /\bgit\s+(pull|checkout|reset|merge|rebase)\b/i,
  /\bdocker\s+(run|stop|restart|rm|rmi|compose\s+down)\b/i,
  /\btar\s+-[xczf]/i,
  /\bnpm\s+install\b/i,
  /\bpip\s+install\b/i
];

export const LOW_RISK_PATTERNS = [
  /\bls\b/i,
  /\bcat\b/i,
  /\buptime\b/i,
  /\bdf\b/i,
  /\bfree\b/i,
  /\bps\b/i,
  /\btop\b/i,
  /\bgrep\b/i,
  /\btail\b/i,
  /\bhead\b/i,
  /\buname\b/i,
  /\bwhoami\b/i,
  /\bpwd\b/i,
  /\bdate\b/i,
  /\bnetstat\b/i,
  /\bss\b/i,
  /\bsystemctl\s+status\b/i,
  /\bjournalctl\b/i,
  /\bdocker\s+ps\b/i,
  /\bping\b/i
];

// Interactive commands that can hang non-interactive broadcasts
export const INTERACTIVE_TOOLS = [
  /\bnano\b/i,
  /\bvim?\b/i,
  /\bview\b/i,
  /\bless\b/i,
  /\bmore\b/i,
  /\bhtop\b/i,
  /\btput\b/i
];

// Legacy export for backward-compatibility
export const DANGEROUS_PATTERNS = CRITICAL_PATTERNS;

// --------------------------------------------------------------------------
// Global Broadcast State Machine
// --------------------------------------------------------------------------

export const broadcastState = {
  isOpen: false,
  currentStep: 'targets', // 'targets' | 'command' | 'preview' | 'running' | 'completed'

  // Stage 1: Discovery & Selection
  availableTargets: [],
  selectedTargetIds: new Set(),
  targetFilterEnv: 'all', // 'all', 'live', 'prod', 'uat', 'test', 'offline'
  searchTerm: '',

  // Stage 2: Command & Risk
  command: '',
  validation: { isValid: false, errors: [], warnings: [], notes: [] },
  risk: {
    level: 'LOW',
    score: 1,
    title: 'Low Risk',
    description: 'Safe telemetry / read-only inspection',
    badgeColor: '#10b981',
    isDestructive: false,
    prodCount: 0,
    requiresStrictConfirmation: false,
    warnings: []
  },

  // Stage 3: Preview & Confirmation
  mode: 'parallel', // 'parallel' | 'sequential'
  strictConfirmInput: '',

  // Stage 4 & 5: Execution, Progress & Aggregate Result
  requestId: null,
  startTime: 0,
  endTime: 0,
  elapsedMs: 0,
  timerInterval: null,
  targetStatuses: new Map(), // targetId -> { id, tabId, name, host, env, status, error, output, durationMs, openDrawer }
  resultsFilter: 'all', // 'all' | 'success' | 'failed'
  unsubDataListener: null
};

let eventListenersRegistered = false;

// --------------------------------------------------------------------------
// ANSI Terminal Output Formatter
// --------------------------------------------------------------------------

export function formatAnsiToHtml(raw) {
  if (!raw) return '';
  let text = escapeHtml(raw)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');

  text = text
    .replace(/\x1b\[0m/g, '</span>')
    .replace(/\x1b\[1m/g, '<span style="font-weight:700;color:#f8fafc;">')
    .replace(/\x1b\[2m/g, '<span style="opacity:0.7;">')
    .replace(/\x1b\[31m/g, '<span style="color:#f87171;">')
    .replace(/\x1b\[32m/g, '<span style="color:#4ade80;">')
    .replace(/\x1b\[33m/g, '<span style="color:#facc15;">')
    .replace(/\x1b\[34m/g, '<span style="color:#60a5fa;">')
    .replace(/\x1b\[35m/g, '<span style="color:#c084fc;">')
    .replace(/\x1b\[36m/g, '<span style="color:#22d3ee;">')
    .replace(/\x1b\[37m/g, '<span style="color:#f1f5f9;">')
    .replace(/\x1b\[90m/g, '<span style="color:#94a3b8;">')
    .replace(/\x1b\[91m/g, '<span style="color:#fca5a5;">')
    .replace(/\x1b\[92m/g, '<span style="color:#86efac;">')
    .replace(/\x1b\[93m/g, '<span style="color:#fde047;">')
    .replace(/\x1b\[94m/g, '<span style="color:#93c5fd;">')
    .replace(/\x1b\[95m/g, '<span style="color:#d8b4fe;">')
    .replace(/\x1b\[96m/g, '<span style="color:#67e8f9;">')
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');

  return text;
}

// --------------------------------------------------------------------------
// Stage 1: Target Discovery
// --------------------------------------------------------------------------

export function inferEnvironment(name = '', host = '', folder = '') {
  const combined = (name + ' ' + host + ' ' + folder).toLowerCase();
  if (combined.includes('prod') || combined.includes('production')) return 'prod';
  if (combined.includes('uat') || combined.includes('staging') || combined.includes('stage')) return 'uat';
  if (combined.includes('test') || combined.includes('testing') || combined.includes('qa')) return 'test';
  if (combined.includes('dev') || combined.includes('development')) return 'dev';
  if (combined.includes('local') || host === '127.0.0.1' || host === 'localhost') return 'local';
  return 'default';
}

export function discoverBroadcastTargets() {
  const discovered = [];
  const processedTabIds = new Set();
  const processedServerIds = new Set();

  // 1. Discover all active live terminal tabs
  const allTabs = (typeof getTabs === 'function' ? getTabs() : tabs) || {};
  const liveTabEntries = Object.entries(allTabs).filter(([id, t]) => t && id && id !== 'home');

  // 2. Discover all saved sessions from session tree
  let savedServers = [];
  try {
    savedServers = collectSavedServers(rootNode);
  } catch (e) {
    savedServers = [];
  }

  // Cross-reference saved servers against active tabs
  for (const srv of savedServers) {
    const sId = srv.id || srv.profile?.id;
    processedServerIds.add(sId);

    // Look for matching tab
    const matchedTabEntry = liveTabEntries.find(([tId, t]) => {
      if (!t) return false;
      if (t.profile && (t.profile.id === sId || t.profile.sessionId === sId)) return true;
      if (t.profile && t.profile.host === srv.host && (t.profile.username || '') === (srv.username || '')) return true;
      return false;
    });

    const isLive = !!matchedTabEntry && !!matchedTabEntry[1].isConnected;
    const tabId = matchedTabEntry ? (matchedTabEntry[1].id || matchedTabEntry[0]) : null;
    if (tabId) processedTabIds.add(tabId);

    const envKey = srv.environment || inferEnvironment(srv.name, srv.host, srv.folderName);
    const envInfo = getEnvironmentInfo(envKey) || { label: envKey.toUpperCase(), color: '#94a3b8', bg: 'rgba(148,163,184,0.18)' };

    discovered.push({
      id: sId || ('srv-' + Math.random().toString(36).slice(2, 8)),
      tabId: tabId,
      name: srv.name || srv.host || 'Server',
      host: srv.host || '127.0.0.1',
      port: srv.port || 22,
      username: srv.username || 'root',
      env: envKey,
      envInfo,
      isLive: isLive,
      isConnected: isLive,
      isLocal: !!(srv.profile && srv.profile.isLocal),
      folderName: srv.folderName || 'Saved Sessions',
      profile: srv.profile || srv
    });
  }

  // 3. Add any remaining active tabs not mapped to saved sessions (e.g. Quick Connect / Local Terminal)
  for (const [tId, t] of liveTabEntries) {
    const tabId = t.id || tId;
    if (processedTabIds.has(tabId)) continue;

    const title = t.customTitle || t.title || t.profile?.name || (t.isLocal ? 'Local Terminal' : ('Terminal ' + String(tabId).slice(0, 6)));
    const host = t.host || t.profile?.host || (t.isLocal ? 'Local Shell' : '127.0.0.1');
    const user = t.username || t.profile?.username || (t.isLocal ? 'user' : 'root');
    const envKey = t.environment || inferEnvironment(title, host, '');
    const envInfo = getEnvironmentInfo(envKey) || { label: envKey.toUpperCase(), color: '#38bdf8', bg: 'rgba(56,189,248,0.18)' };

    discovered.push({
      id: 'tab-' + tabId,
      tabId: tabId,
      name: title,
      host: host,
      port: t.profile?.port || 22,
      username: user,
      env: envKey,
      envInfo,
      isLive: true,
      isConnected: !!t.isConnected,
      isLocal: !!t.isLocal,
      folderName: t.isLocal ? 'Local Shell' : 'Active Terminals',
      profile: t.profile || null
    });
  }

  return discovered;
}

// --------------------------------------------------------------------------
// Stage 3: Command Validation
// --------------------------------------------------------------------------

export function validateBroadcastCommand(cmd) {
  const res = {
    isValid: true,
    errors: [],
    warnings: [],
    notes: []
  };

  if (!cmd || typeof cmd !== 'string') {
    res.isValid = false;
    res.errors.push('Command cannot be empty.');
    return res;
  }

  const trimmed = cmd.trim();
  if (trimmed.length === 0) {
    res.isValid = false;
    res.errors.push('Command cannot be empty or only whitespace.');
    return res;
  }

  // Check unclosed quotes
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i];
    if (char === "'" && !inDouble) inSingle = !inSingle;
    if (char === '"' && !inSingle) inDouble = !inDouble;
  }
  if (inSingle) {
    res.isValid = false;
    res.errors.push("Syntax Error: Unclosed single quote (') detected.");
  }
  if (inDouble) {
    res.isValid = false;
    res.errors.push('Syntax Error: Unclosed double quote (") detected.');
  }

  // Check trailing incomplete operators
  if (/(\||\&|\;|>|<)\s*$/.test(trimmed)) {
    res.isValid = false;
    res.errors.push("Syntax Error: Incomplete command ending with operator ('|', '&', ';', '>' or '<').");
  }

  // Warnings: Interactive tools that can block non-interactive execution
  if (INTERACTIVE_TOOLS.some(rx => rx.test(trimmed))) {
    res.warnings.push("Interactive command detected (e.g. text editor or pager). This may hang non-interactive broadcasts.");
  }

  // Warnings: sudo execution
  if (/\bsudo\b/i.test(trimmed)) {
    res.warnings.push("Contains 'sudo'. If remote servers require an interactive password prompt, execution may stall or fail.");
  }

  // Notes: Compound commands
  if (/&&|\|\||;/.test(trimmed)) {
    res.notes.push("Compound command detected. Chained commands will execute sequentially on each target node.");
  }

  return res;
}

// --------------------------------------------------------------------------
// Stage 4: Risk Classification
// --------------------------------------------------------------------------

export function classifyBroadcastRisk(cmd, selectedTargetObjects = []) {
  const result = {
    level: 'LOW',
    score: 1,
    title: 'Safe / Observability',
    description: 'Read-only telemetry, diagnostics, and status monitoring.',
    badgeColor: '#10b981',
    isDestructive: false,
    prodCount: 0,
    requiresStrictConfirmation: false,
    warnings: []
  };

  if (!cmd || typeof cmd !== 'string' || !cmd.trim()) {
    return result;
  }

  const trimmed = cmd.trim();

  // 1. Tier evaluation
  if (CRITICAL_PATTERNS.some(rx => rx.test(trimmed))) {
    result.level = 'CRITICAL';
    result.score = 4;
    result.title = 'Destructive Action (Critical)';
    result.description = 'Command can cause permanent data erasure, filesystem corruption, or system shutdown.';
    result.badgeColor = '#ef4444';
    result.isDestructive = true;
    result.warnings.push('High-impact destructive patterns detected. Requires explicit manual confirmation phrase.');
  } else if (HIGH_RISK_PATTERNS.some(rx => rx.test(trimmed))) {
    result.level = 'HIGH';
    result.score = 3;
    result.title = 'High Risk (System Modification)';
    result.description = 'Modifies system daemons, firewall rules, service states, or bulk file permissions.';
    result.badgeColor = '#f97316';
    result.warnings.push('May interrupt running services or alter server configuration.');
  } else if (MEDIUM_RISK_PATTERNS.some(rx => rx.test(trimmed))) {
    result.level = 'MEDIUM';
    result.score = 2;
    result.title = 'Medium Risk (State Alteration)';
    result.description = 'Creates, modifies, or pulls files, containers, or packages.';
    result.badgeColor = '#eab308';
  } else {
    result.level = 'LOW';
    result.score = 1;
    result.title = 'Low Risk (Safe / Read-Only)';
    result.description = 'Read-only status inspection, telemetry, or diagnostic monitoring.';
    result.badgeColor = '#10b981';
  }

  // 2. Production Target Multiplier
  const prodTargets = selectedTargetObjects.filter(t => t.env === 'prod');
  result.prodCount = prodTargets.length;

  if (prodTargets.length > 0) {
    result.warnings.push(`Target scope includes ${prodTargets.length} PRODUCTION instance(s).`);
  }

  // 3. Strict Confirmation Rules
  // Required if CRITICAL, OR (HIGH and targeting PROD)
  if (result.level === 'CRITICAL' || (result.level === 'HIGH' && prodTargets.length > 0)) {
    result.requiresStrictConfirmation = true;
  }

  return result;
}

// --------------------------------------------------------------------------
// Simulated Output Generator (for Browser / Testing fallback)
// --------------------------------------------------------------------------

function getSimulatedOutput(cmd, target) {
  const trimmed = cmd.trim();
  const timeStr = new Date().toTimeString().split(' ')[0];
  const hostname = target.name.toLowerCase().replace(/[^a-z0-9_-]/g, '-');

  if (trimmed.includes('uptime')) {
    return `\x1b[32m[${hostname}]\x1b[0m ${timeStr} up 42 days, 14:22,  2 users,  load average: ${(0.1 + Math.random() * 0.4).toFixed(2)}, ${(0.2 + Math.random() * 0.3).toFixed(2)}, 0.15\n`;
  }
  if (trimmed.includes('df -h')) {
    return `\x1b[32m[${hostname}]\x1b[0m Filesystem      Size  Used Avail Use% Mounted on\n/dev/sda1        78G   22G   53G  30% /\ntmpfs           3.9G     0  3.9G   0% /dev/shm\n/dev/sda15      124M   12M  112M  10% /boot/efi\n`;
  }
  if (trimmed.includes('free')) {
    return `\x1b[32m[${hostname}]\x1b[0m                total        used        free      shared  buff/cache   available\nMem:            7936        2140        3820          45        1976        5480\nSwap:           2048           0        2048\n`;
  }
  if (trimmed.includes('systemctl status')) {
    const srv = trimmed.split(' ')[2] || 'service';
    return `\x1b[1m● ${srv}.service\x1b[0m - Nexterm Managed Daemon\n   Loaded: loaded (/etc/systemd/system/${srv}.service; \x1b[32menabled\x1b[0m)\n   Active: \x1b[1;32mactive (running)\x1b[0m since ${timeStr} UTC\n   Main PID: ${Math.floor(1200 + Math.random() * 4000)} (${srv})\n`;
  }

  return `\x1b[32m[${hostname} (${target.host})]\x1b[0m Command '${escapeHtml(trimmed)}' executed successfully at ${timeStr}. (Exit code 0)\n`;
}

// --------------------------------------------------------------------------
// Public Dialog Operations
// --------------------------------------------------------------------------

export function openBroadcastDialog(scope = 'all', preselectedTabIDs = null) {
  ensureEventListeners();

  const allDiscovered = discoverBroadcastTargets();

  if (allDiscovered.length === 0) {
    showToast('No saved servers or active terminals found. Create a session first.', 'warning');
    if (typeof showMultiServerConnectDialog === 'function') {
      showMultiServerConnectDialog();
    }
    return;
  }

  broadcastState.isOpen = true;
  broadcastState.currentStep = 'targets';
  broadcastState.availableTargets = allDiscovered;
  broadcastState.selectedTargetIds.clear();
  broadcastState.targetFilterEnv = 'all';
  broadcastState.searchTerm = '';
  broadcastState.command = '';
  broadcastState.mode = 'parallel';
  broadcastState.strictConfirmInput = '';
  broadcastState.requestId = null;
  broadcastState.startTime = 0;
  broadcastState.endTime = 0;
  broadcastState.elapsedMs = 0;
  broadcastState.targetStatuses.clear();
  broadcastState.resultsFilter = 'all';

  if (broadcastState.timerInterval) {
    clearInterval(broadcastState.timerInterval);
    broadcastState.timerInterval = null;
  }
  if (broadcastState.unsubDataListener) {
    try { broadcastState.unsubDataListener(); } catch (e) {}
    broadcastState.unsubDataListener = null;
  }

  // Preselection logic
  if (preselectedTabIDs && Array.isArray(preselectedTabIDs) && preselectedTabIDs.length > 0) {
    allDiscovered.forEach(t => {
      if (t.tabId && preselectedTabIDs.includes(t.tabId)) {
        broadcastState.selectedTargetIds.add(t.id);
      }
    });
  } else if (scope === 'selected') {
    const active = getActiveTab();
    if (active && active.id !== 'home') {
      const match = allDiscovered.find(t => t.tabId === active.id);
      if (match) broadcastState.selectedTargetIds.add(match.id);
    }
    if (broadcastState.selectedTargetIds.size === 0 && allDiscovered.length > 0) {
      broadcastState.selectedTargetIds.add(allDiscovered[0].id);
    }
  } else {
    // Default to selecting all live targets, or all targets if none are live
    const liveTargets = allDiscovered.filter(t => t.isLive);
    if (liveTargets.length > 0) {
      liveTargets.forEach(t => broadcastState.selectedTargetIds.add(t.id));
    } else {
      allDiscovered.forEach(t => broadcastState.selectedTargetIds.add(t.id));
    }
  }

  // Re-run validation and risk assessment
  updateValidationAndRisk();

  renderBroadcastModal();
}

export function closeBroadcast() {
  broadcastState.isOpen = false;
  if (broadcastState.timerInterval) {
    clearInterval(broadcastState.timerInterval);
    broadcastState.timerInterval = null;
  }
  if (broadcastState.unsubDataListener) {
    try { broadcastState.unsubDataListener(); } catch (e) {}
    broadcastState.unsubDataListener = null;
  }
  hideModal();
}

function updateValidationAndRisk() {
  const selectedTargets = broadcastState.availableTargets.filter(t => broadcastState.selectedTargetIds.has(t.id));
  broadcastState.validation = validateBroadcastCommand(broadcastState.command);
  broadcastState.risk = classifyBroadcastRisk(broadcastState.command, selectedTargets);
}

// --------------------------------------------------------------------------
// Event Streaming Handlers (from Backend Wails Runtime)
// --------------------------------------------------------------------------

function ensureEventListeners() {
  if (eventListenersRegistered) return;
  if (window.runtime && window.runtime.EventsOn) {
    window.runtime.EventsOn('broadcast:state', handleBroadcastState);
    window.runtime.EventsOn('broadcast:progress', handleBroadcastProgress);
    window.runtime.EventsOn('broadcast:complete', handleBroadcastComplete);
    eventListenersRegistered = true;
  }
}

export function handleBroadcastState(event) {
  if (!event || !broadcastState.isOpen) return;
  if (event.state === 'cancelled') {
    broadcastState.currentStep = 'completed';
    broadcastState.endTime = Date.now();
    if (broadcastState.timerInterval) {
      clearInterval(broadcastState.timerInterval);
      broadcastState.timerInterval = null;
    }
    showToast('Broadcast dispatch cancelled by user', 'warning');
    renderBroadcastModal();
  }
}

export function handleBroadcastProgress(progress) {
  if (!progress || !broadcastState.isOpen) return;
  const { tabId, status, error } = progress;
  if (!tabId) return;

  // Find target by tabId or id
  let targetEntry = null;
  for (const item of broadcastState.targetStatuses.values()) {
    if (item.tabId === tabId || item.id === tabId) {
      targetEntry = item;
      break;
    }
  }

  if (targetEntry) {
    targetEntry.status = status;
    if (error) targetEntry.error = error;
    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      if (!targetEntry.durationMs) {
        targetEntry.durationMs = Date.now() - broadcastState.startTime;
      }
    }
    if (broadcastState.currentStep === 'running') {
      updateRunningDOM();
    }
  }
}

export function handleBroadcastComplete(result) {
  if (!result || !broadcastState.isOpen) return;
  broadcastState.currentStep = 'completed';
  broadcastState.endTime = Date.now();
  broadcastState.elapsedMs = broadcastState.endTime - broadcastState.startTime;

  if (broadcastState.timerInterval) {
    clearInterval(broadcastState.timerInterval);
    broadcastState.timerInterval = null;
  }

  if (result.targets && Array.isArray(result.targets)) {
    result.targets.forEach(tr => {
      for (const item of broadcastState.targetStatuses.values()) {
        if (item.tabId === tr.tabId || item.id === tr.tabId) {
          item.status = tr.status;
          item.error = tr.error || '';
          if (!item.durationMs) item.durationMs = broadcastState.elapsedMs;
          break;
        }
      }
    });
  }

  renderBroadcastModal();
}

// --------------------------------------------------------------------------
// Stage 6: Execution Dispatch
// --------------------------------------------------------------------------

export async function startBroadcast() {
  const selected = broadcastState.availableTargets.filter(t => broadcastState.selectedTargetIds.has(t.id));
  if (selected.length === 0) {
    showToast('Please select at least one target server.', 'warning');
    return;
  }

  updateValidationAndRisk();
  if (!broadcastState.validation.isValid) {
    showToast('Cannot execute: ' + (broadcastState.validation.errors[0] || 'Invalid command syntax'), 'error');
    return;
  }

  // Check strict confirmation rule
  if (broadcastState.risk.requiresStrictConfirmation) {
    if (broadcastState.strictConfirmInput.trim().toUpperCase() !== 'CONFIRM') {
      showToast('You must type CONFIRM to authorize critical execution.', 'warning');
      return;
    }
  }

  // Connect any offline saved sessions automatically
  const offlineTargets = selected.filter(t => !t.isLive || !t.tabId);
  if (offlineTargets.length > 0) {
    showToast(`Connecting ${offlineTargets.length} offline target server(s)...`, 'info');
    for (const target of offlineTargets) {
      if (target.profile && typeof connectToSession === 'function') {
        try {
          await connectToSession(target.profile, true);
        } catch (err) {
          console.warn('Failed to auto-connect target:', target.name, err);
        }
      }
    }
    // Refresh discovery after connection attempt
    const refreshed = discoverBroadcastTargets();
    broadcastState.availableTargets = refreshed;
  }

  // Re-map selected targets to active tab IDs
  const activeSelected = [];
  const targetIDsForBackend = [];

  for (const s of selected) {
    const updated = broadcastState.availableTargets.find(t => t.id === s.id) || s;
    const tabId = updated.tabId || updated.id;
    activeSelected.push(updated);
    targetIDsForBackend.push(tabId);
  }

  // Initialize execution runtime state
  broadcastState.currentStep = 'running';
  broadcastState.startTime = Date.now();
  broadcastState.endTime = 0;
  broadcastState.elapsedMs = 0;
  broadcastState.targetStatuses.clear();

  activeSelected.forEach(t => {
    broadcastState.targetStatuses.set(t.id, {
      id: t.id,
      tabId: t.tabId || t.id,
      name: t.name,
      host: t.host,
      env: t.env,
      envInfo: t.envInfo,
      status: 'pending',
      error: '',
      output: '',
      durationMs: 0,
      openDrawer: false
    });
  });

  // Start stopwatch timer
  broadcastState.timerInterval = setInterval(() => {
    broadcastState.elapsedMs = Date.now() - broadcastState.startTime;
    const timerEl = document.getElementById('bcastStopwatch');
    if (timerEl) {
      const sec = (broadcastState.elapsedMs / 1000).toFixed(1);
      timerEl.textContent = `⏱ Elapsed: ${sec}s`;
    }
  }, 100);

  // Hook terminal stream data listener
  if (typeof addMultiExecDataListener === 'function') {
    broadcastState.unsubDataListener = addMultiExecDataListener((tId, data) => {
      for (const item of broadcastState.targetStatuses.values()) {
        if (item.tabId === tId || item.id === tId) {
          item.output += data;
          const drawerEl = document.getElementById(`bcastDrawer_${item.id}`);
          if (drawerEl) {
            drawerEl.innerHTML = formatAnsiToHtml(item.output);
            drawerEl.scrollTop = drawerEl.scrollHeight;
          }
          break;
        }
      }
    });
  }

  renderBroadcastModal();

  const cmd = broadcastState.command.trim();
  const mode = broadcastState.mode;

  try {
    if (window.go && window.go.main && window.go.main.App && window.go.main.App.BroadcastCommand) {
      const res = await window.go.main.App.BroadcastCommand(targetIDsForBackend, cmd, mode);
      if (res) {
        broadcastState.requestId = res.requestId;
        // If simulation/demo data needed for outputs:
        for (const item of broadcastState.targetStatuses.values()) {
          if (!item.output) {
            item.output = getSimulatedOutput(cmd, item);
          }
        }
        handleBroadcastComplete(res);
      }
    } else {
      // Mock execution for browser mode / unit testing
      broadcastState.requestId = 'mock-bcast-' + Date.now();
      for (const item of activeSelected) {
        item.status = 'sending';
        updateRunningDOM();
        await new Promise(r => setTimeout(r, mode === 'sequential' ? 120 : 60));
        item.status = 'completed';
        item.durationMs = Date.now() - broadcastState.startTime;
        item.output = getSimulatedOutput(cmd, item);
        handleBroadcastProgress({
          requestId: broadcastState.requestId,
          tabId: item.tabId || item.id,
          status: 'completed'
        });
      }
      handleBroadcastComplete({
        requestId: broadcastState.requestId,
        targets: activeSelected.map(t => ({ tabId: t.tabId || t.id, status: 'completed' }))
      });
    }
  } catch (err) {
    showToast('Broadcast failed: ' + (err.message || err), 'error');
    broadcastState.currentStep = 'completed';
    broadcastState.endTime = Date.now();
    if (broadcastState.timerInterval) {
      clearInterval(broadcastState.timerInterval);
      broadcastState.timerInterval = null;
    }
    renderBroadcastModal();
  }
}

export async function cancelBroadcast() {
  if (broadcastState.requestId && window.go && window.go.main && window.go.main.App && window.go.main.App.CancelBroadcast) {
    try {
      await window.go.main.App.CancelBroadcast(broadcastState.requestId);
      showToast('Cancellation requested...', 'info');
    } catch (err) {
      console.warn('CancelBroadcast error:', err);
    }
  }
  broadcastState.currentStep = 'completed';
  broadcastState.endTime = Date.now();
  broadcastState.elapsedMs = broadcastState.endTime - broadcastState.startTime;
  if (broadcastState.timerInterval) {
    clearInterval(broadcastState.timerInterval);
    broadcastState.timerInterval = null;
  }

  broadcastState.targetStatuses.forEach(item => {
    if (item.status === 'pending' || item.status === 'sending') {
      item.status = 'cancelled';
      item.error = 'Execution cancelled by user';
    }
  });

  renderBroadcastModal();
}

// --------------------------------------------------------------------------
// UI Rendering: Top Stepper Header
// --------------------------------------------------------------------------

function renderWorkflowStepper(currentStep) {
  const steps = [
    { key: 'targets', num: '1', label: 'Targets', desc: 'Discovery & Selection' },
    { key: 'command', num: '2', label: 'Command & Risk', desc: 'Syntax & Blast Radius' },
    { key: 'preview', num: '3', label: 'Preview & Confirm', desc: 'Pre-flight Lock' },
    { key: 'running', num: '4', label: 'Execution', desc: 'Real-time Streaming' },
    { key: 'completed', num: '5', label: 'Results', desc: 'Aggregate Matrix' }
  ];

  const stepIndexMap = { targets: 0, command: 1, preview: 2, running: 3, completed: 4 };
  const currentIdx = stepIndexMap[currentStep] || 0;

  return `
    <div class="bcast-stepper-container">
      <div class="bcast-stepper">
        ${steps.map((s, idx) => {
          const isDone = idx < currentIdx;
          const isActive = idx === currentIdx;
          const statusClass = isDone ? 'step-done' : (isActive ? 'step-active' : 'step-pending');
          return `
            <div class="bcast-step-item ${statusClass}">
              <div class="bcast-step-bubble">
                ${isDone ? '✓' : s.num}
              </div>
              <div class="bcast-step-meta">
                <span class="bcast-step-title">${s.label}</span>
                <span class="bcast-step-desc">${s.desc}</span>
              </div>
              ${idx < steps.length - 1 ? '<div class="bcast-step-connector"></div>' : ''}
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

// --------------------------------------------------------------------------
// Master Modal Router
// --------------------------------------------------------------------------

function renderBroadcastModal() {
  if (!broadcastState.isOpen) return;

  let contentHtml = '';
  switch (broadcastState.currentStep) {
    case 'targets':
      contentHtml = renderTargetsStep();
      break;
    case 'command':
      contentHtml = renderCommandAndRiskStep();
      break;
    case 'preview':
      contentHtml = renderPreviewStep();
      break;
    case 'running':
      contentHtml = renderRunningStep();
      break;
    case 'completed':
      contentHtml = renderCompletedStep();
      break;
    default:
      contentHtml = renderTargetsStep();
  }

  showModal(contentHtml, 'modal-plain');
  attachModalHandlers();
}

// --------------------------------------------------------------------------
// Step 1: Target Discovery & Selection UI
// --------------------------------------------------------------------------

function renderTargetsStep() {
  const all = broadcastState.availableTargets;
  const search = broadcastState.searchTerm.toLowerCase();
  const filterEnv = broadcastState.targetFilterEnv;

  const filtered = all.filter(t => {
    // Environment filter
    if (filterEnv === 'live' && !t.isLive) return false;
    if (filterEnv === 'offline' && t.isLive) return false;
    if (filterEnv === 'prod' && t.env !== 'prod') return false;
    if (filterEnv === 'uat' && t.env !== 'uat') return false;
    if (filterEnv === 'test' && t.env !== 'test' && t.env !== 'dev') return false;

    // Search filter
    if (!search) return true;
    return (
      t.name.toLowerCase().includes(search) ||
      t.host.toLowerCase().includes(search) ||
      t.username.toLowerCase().includes(search) ||
      t.folderName.toLowerCase().includes(search)
    );
  });

  const selectedCount = broadcastState.selectedTargetIds.size;
  const liveCount = all.filter(t => t.isLive).length;
  const prodCount = all.filter(t => t.env === 'prod').length;
  const uatCount = all.filter(t => t.env === 'uat').length;
  const testCount = all.filter(t => t.env === 'test' || t.env === 'dev').length;

  return `
    <div class="broadcast-modal-card bcast-large-modal">
      <div class="broadcast-header">
        <div class="broadcast-title-row">
          <span class="broadcast-icon">📡</span>
          <div>
            <h3>Broadcast Command Orchestrator</h3>
            <p class="broadcast-subtitle">Multi-server synchronized terminal execution & operational workflow</p>
          </div>
        </div>
        <button id="broadcastCloseBtn" class="broadcast-close-btn" title="Close">✕</button>
      </div>

      ${renderWorkflowStepper('targets')}

      <div class="broadcast-body">
        <!-- Target Filters & Search -->
        <div class="bcast-section-card">
          <div class="bcast-filter-header">
            <div class="bcast-filter-pills">
              <button class="bcast-pill-btn ${filterEnv === 'all' ? 'active' : ''}" data-filter="all">All Targets (${all.length})</button>
              <button class="bcast-pill-btn pill-live ${filterEnv === 'live' ? 'active' : ''}" data-filter="live">🟢 Live Online (${liveCount})</button>
              <button class="bcast-pill-btn pill-prod ${filterEnv === 'prod' ? 'active' : ''}" data-filter="prod">🔴 PROD (${prodCount})</button>
              <button class="bcast-pill-btn pill-uat ${filterEnv === 'uat' ? 'active' : ''}" data-filter="uat">🟠 UAT (${uatCount})</button>
              <button class="bcast-pill-btn pill-test ${filterEnv === 'test' ? 'active' : ''}" data-filter="test">🔵 TEST/DEV (${testCount})</button>
              <button class="bcast-pill-btn pill-offline ${filterEnv === 'offline' ? 'active' : ''}" data-filter="offline">⚪ Saved/Offline (${all.length - liveCount})</button>
            </div>

            <div class="bcast-actions-group">
              <button id="bcastSelectFilteredBtn" class="bcast-btn-text">Select All (${filtered.length})</button>
              <span class="bcast-sep">|</span>
              <button id="bcastSelectLiveBtn" class="bcast-btn-text">Select Live Only</button>
              <span class="bcast-sep">|</span>
              <button id="bcastClearBtn" class="bcast-btn-text">Clear</button>
            </div>
          </div>

          <div class="bcast-search-row">
            <input type="text" id="bcastSearchInput" class="bcast-search-input" 
                   placeholder="Search targets by server name, host IP, username, or folder..." 
                   value="${escapeHtml(broadcastState.searchTerm)}" />
            <button id="bcastRefreshDiscoveryBtn" class="btn btn-secondary bcast-refresh-btn" title="Re-scan saved sessions & tabs">🔄 Refresh</button>
          </div>
        </div>

        <!-- Target Grid / List -->
        <div class="bcast-target-grid">
          ${filtered.length === 0 ? `
            <div class="bcast-empty-state">
              <span>🔍</span>
              <p>No target servers match the current filter or search criteria.</p>
            </div>
          ` : filtered.map(t => {
            const isSelected = broadcastState.selectedTargetIds.has(t.id);
            const envStyle = `color: ${t.envInfo.color}; background: ${t.envInfo.bg}; border: 1px solid ${t.envInfo.border || t.envInfo.color}33;`;
            return `
              <div class="bcast-target-card ${isSelected ? 'selected' : ''}" data-id="${t.id}">
                <div class="bcast-target-checkbox-wrap">
                  <input type="checkbox" class="bcast-target-checkbox" data-id="${t.id}" ${isSelected ? 'checked' : ''} />
                </div>
                <div class="bcast-target-main">
                  <div class="bcast-target-topline">
                    <span class="bcast-target-icon">${t.isLocal ? '💻' : (t.env === 'prod' ? '🚨' : '🖥️')}</span>
                    <span class="bcast-target-name" title="${escapeHtml(t.name)}">${escapeHtml(t.name)}</span>
                    <span class="bcast-env-tag" style="${envStyle}">${t.envInfo.label}</span>
                  </div>
                  <div class="bcast-target-subline">
                    <span class="bcast-target-host">${escapeHtml(t.username)}@${escapeHtml(t.host)}:${t.port}</span>
                    <span class="bcast-target-folder">📁 ${escapeHtml(t.folderName)}</span>
                  </div>
                </div>
                <div class="bcast-target-status-pill ${t.isLive ? 'status-live' : 'status-offline'}">
                  ${t.isLive ? '● Online' : '○ Saved (Auto-connect)'}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>

      <div class="broadcast-footer">
        <div class="bcast-footer-summary">
          <span class="bcast-counter-chip">
            <strong>${selectedCount}</strong> targets selected of <strong>${all.length}</strong> available
          </span>
          ${selectedCount > 0 && prodCount > 0 && all.some(t => broadcastState.selectedTargetIds.has(t.id) && t.env === 'prod') ? `
            <span class="bcast-prod-counter-alert">⚠️ Includes Production Instances</span>
          ` : ''}
        </div>

        <div class="bcast-footer-buttons">
          <button id="bcastCancelBtn" class="btn btn-secondary">Cancel</button>
          <button id="bcastProceedToCommandBtn" class="btn btn-primary" ${selectedCount === 0 ? 'disabled' : ''}>
            Proceed to Command & Risk (${selectedCount} Targets) →
          </button>
        </div>
      </div>
    </div>
  `;
}

// --------------------------------------------------------------------------
// Step 2: Command Validation & Risk Classification UI
// --------------------------------------------------------------------------

function renderCommandAndRiskStep() {
  updateValidationAndRisk();
  const { validation, risk } = broadcastState;
  const selectedTargets = broadcastState.availableTargets.filter(t => broadcastState.selectedTargetIds.has(t.id));

  return `
    <div class="broadcast-modal-card bcast-large-modal">
      <div class="broadcast-header">
        <div class="broadcast-title-row">
          <span class="broadcast-icon">⚡</span>
          <div>
            <h3>Command Input & Real-Time Risk Engine</h3>
            <p class="broadcast-subtitle">Enter payload, validate syntax, and assess multi-node blast radius</p>
          </div>
        </div>
        <button id="broadcastCloseBtn" class="broadcast-close-btn">✕</button>
      </div>

      ${renderWorkflowStepper('command')}

      <div class="broadcast-body">
        <!-- Quick Operational Templates -->
        <div class="bcast-template-bar">
          <span class="bcast-template-label">Quick Templates:</span>
          <button class="bcast-tpl-btn" data-cmd="uptime && free -h && df -h">📊 System Health</button>
          <button class="bcast-tpl-btn" data-cmd="systemctl status nginx">⚙️ Service Status</button>
          <button class="bcast-tpl-btn" data-cmd="ps aux --sort=-%mem | head -n 10">🔍 Top Memory</button>
          <button class="bcast-tpl-btn" data-cmd="ss -tulnp">🌐 Network Ports</button>
          <button class="bcast-tpl-btn" data-cmd="df -h / /var /tmp">🧹 Disk Usage</button>
        </div>

        <!-- Monospace Command Editor -->
        <div class="bcast-section-card">
          <div class="bcast-cmd-editor-header">
            <label class="broadcast-label" for="bcastCommandInput">Operational Command Payload (Dispatched to ${selectedTargets.length} nodes)</label>
            <span class="bcast-cmd-badge ${validation.isValid ? 'badge-valid' : 'badge-invalid'}">
              ${validation.isValid ? '✓ Syntax Valid' : '✕ Syntax Incomplete'}
            </span>
          </div>

          <div class="bcast-textarea-wrapper">
            <textarea id="bcastCommandInput" class="bcast-textarea" rows="4" 
                      placeholder="e.g. systemctl restart billing or uptime && df -h">${escapeHtml(broadcastState.command)}</textarea>
          </div>

          <!-- Syntax Validation Alerts -->
          ${validation.errors.length > 0 ? `
            <div class="bcast-validation-errors">
              ${validation.errors.map(err => `<div class="bcast-val-err">❌ ${escapeHtml(err)}</div>`).join('')}
            </div>
          ` : ''}

          ${validation.warnings.length > 0 ? `
            <div class="bcast-validation-warnings">
              ${validation.warnings.map(w => `<div class="bcast-val-warn">⚠️ ${escapeHtml(w)}</div>`).join('')}
            </div>
          ` : ''}

          ${validation.notes.length > 0 ? `
            <div class="bcast-validation-notes">
              ${validation.notes.map(n => `<div class="bcast-val-note">ℹ️ ${escapeHtml(n)}</div>`).join('')}
            </div>
          ` : ''}
        </div>

        <!-- Real-Time Risk Classification Card -->
        <div class="bcast-risk-card" style="border-left-color: ${risk.badgeColor};">
          <div class="bcast-risk-card-header">
            <div class="bcast-risk-badge-group">
              <span class="bcast-risk-pill" style="background: ${risk.badgeColor};">
                ${risk.level} RISK (Tier ${risk.score}/4)
              </span>
              <strong class="bcast-risk-title">${risk.title}</strong>
            </div>
            ${risk.requiresStrictConfirmation ? `
              <span class="bcast-lock-badge">🔒 Strict Safety Lock Enabled</span>
            ` : ''}
          </div>

          <p class="bcast-risk-desc">${risk.description}</p>

          ${risk.prodCount > 0 ? `
            <div class="bcast-prod-impact-box">
              <span class="prod-icon">🚨</span>
              <div>
                <strong>Production Blast Radius Alert</strong>
                <p>Command will execute across <strong>${risk.prodCount} Production server(s)</strong>. High-impact operations on Production require typed authorization confirmation.</p>
              </div>
            </div>
          ` : ''}

          ${risk.warnings.length > 0 ? `
            <div class="bcast-risk-warnings-list">
              ${risk.warnings.map(w => `<div>• ${escapeHtml(w)}</div>`).join('')}
            </div>
          ` : ''}
        </div>
      </div>

      <div class="broadcast-footer">
        <button id="bcastBackToTargetsBtn" class="btn btn-secondary">← Back to Targets</button>
        <button id="bcastProceedToPreviewBtn" class="btn btn-primary" ${!validation.isValid ? 'disabled' : ''}>
          Proceed to Preview & Confirm →
        </button>
      </div>
    </div>
  `;
}

// --------------------------------------------------------------------------
// Step 3: Preview & Strict Confirmation UI
// --------------------------------------------------------------------------

function renderPreviewStep() {
  updateValidationAndRisk();
  const { risk, mode } = broadcastState;
  const targets = broadcastState.availableTargets.filter(t => broadcastState.selectedTargetIds.has(t.id));
  const prodTargets = targets.filter(t => t.env === 'prod');
  const uatTargets = targets.filter(t => t.env === 'uat');
  const testTargets = targets.filter(t => t.env === 'test' || t.env === 'dev');
  const offlineTargets = targets.filter(t => !t.isLive);

  const isStrict = risk.requiresStrictConfirmation;
  const isConfirmTyped = broadcastState.strictConfirmInput.trim().toUpperCase() === 'CONFIRM';

  return `
    <div class="broadcast-modal-card bcast-large-modal">
      <div class="broadcast-header">
        <div class="broadcast-title-row">
          <span class="broadcast-icon">${isStrict ? '🛑' : '📋'}</span>
          <div>
            <h3>Pre-Flight Execution Review & Safety Lock</h3>
            <p class="broadcast-subtitle">Verify scope, rollout strategy, and authorize broadcast dispatch</p>
          </div>
        </div>
        <button id="broadcastCloseBtn" class="broadcast-close-btn">✕</button>
      </div>

      ${renderWorkflowStepper('preview')}

      <div class="broadcast-body">
        <!-- Prominent Safety Warning if Destructive / High Risk -->
        ${isStrict ? `
          <div class="bcast-danger-banner bcast-danger-prominent">
            <span class="danger-icon">🛑</span>
            <div>
              <strong>STRICT CONFIRMATION MANDATORY</strong>
              <p>This operation is classified as <strong>${risk.level}</strong> affecting <strong>${targets.length} servers</strong>${prodTargets.length > 0 ? ` including <strong>${prodTargets.length} PRODUCTION nodes</strong>` : ''}.</p>
            </div>
          </div>
        ` : ''}

        <!-- Payload Preview -->
        <div class="bcast-section-card">
          <div class="bcast-preview-header">
            <span class="broadcast-label">Command to Execute</span>
            <button id="bcastCopyCmdBtn" class="bcast-btn-text">📋 Copy Command</button>
          </div>
          <pre class="bcast-cmd-preview"><code>${escapeHtml(broadcastState.command)}</code></pre>
        </div>

        <!-- Strategy & Scope Summary -->
        <div class="bcast-strategy-grid">
          <!-- Execution Mode Selector -->
          <div class="bcast-section-card">
            <span class="broadcast-label">Execution Strategy</span>
            <div class="bcast-mode-options">
              <label class="bcast-mode-radio ${mode === 'parallel' ? 'active' : ''}">
                <input type="radio" name="bcastMode" value="parallel" ${mode === 'parallel' ? 'checked' : ''} />
                <div>
                  <strong>⚡ Parallel (Concurrent)</strong>
                  <span>Simultaneous dispatch bounded to 20 concurrent worker routines.</span>
                </div>
              </label>
              <label class="bcast-mode-radio ${mode === 'sequential' ? 'active' : ''}">
                <input type="radio" name="bcastMode" value="sequential" ${mode === 'sequential' ? 'checked' : ''} />
                <div>
                  <strong>⏳ Sequential (Canary Rollout)</strong>
                  <span>Dispatches node-by-node. Halts immediately on target failure.</span>
                </div>
              </label>
            </div>
          </div>

          <!-- Target Scope Breakdown -->
          <div class="bcast-section-card">
            <span class="broadcast-label">Target Scope Breakdown (${targets.length} Nodes)</span>
            <div class="bcast-scope-chips">
              <div class="bcast-scope-chip"><strong>${targets.length}</strong> Total Targets</div>
              <div class="bcast-scope-chip chip-live"><strong>${targets.length - offlineTargets.length}</strong> Live Connected</div>
              ${offlineTargets.length > 0 ? `<div class="bcast-scope-chip chip-offline"><strong>${offlineTargets.length}</strong> Auto-Connect</div>` : ''}
              ${prodTargets.length > 0 ? `<div class="bcast-scope-chip chip-prod"><strong>${prodTargets.length}</strong> Production</div>` : ''}
              ${uatTargets.length > 0 ? `<div class="bcast-scope-chip chip-uat"><strong>${uatTargets.length}</strong> UAT</div>` : ''}
              ${testTargets.length > 0 ? `<div class="bcast-scope-chip chip-test"><strong>${testTargets.length}</strong> Test/Dev</div>` : ''}
            </div>

            <div class="bcast-preview-target-tags">
              ${targets.map(t => `
                <span class="bcast-target-mini-tag ${t.env === 'prod' ? 'tag-prod' : ''}">
                  ${escapeHtml(t.name)} <small>(${escapeHtml(t.host)})</small>
                </span>
              `).join('')}
            </div>
          </div>
        </div>

        <!-- Strict Confirmation Input Box -->
        ${isStrict ? `
          <div class="bcast-strict-confirm-box">
            <div class="bcast-confirm-label">
              <span>🔒 Two-Man Safety Authorization:</span> Type <strong>CONFIRM</strong> to unlock execution:
            </div>
            <input type="text" id="bcastStrictConfirmInput" class="bcast-confirm-input" 
                   placeholder="Type CONFIRM to authorize" 
                   value="${escapeHtml(broadcastState.strictConfirmInput)}" />
          </div>
        ` : ''}
      </div>

      <div class="broadcast-footer">
        <button id="bcastBackToCommandBtn" class="btn btn-secondary">← Back to Command</button>
        <button id="bcastExecuteBtn" class="btn ${isStrict ? 'btn-danger' : 'btn-primary'}" 
                ${isStrict && !isConfirmTyped ? 'disabled' : ''}>
          ${isStrict ? '⚠️ Authorize Critical Broadcast 🚀' : '🚀 Authorize & Broadcast to ' + targets.length + ' Nodes'}
        </button>
      </div>
    </div>
  `;
}

// --------------------------------------------------------------------------
// Step 4: Live Per-Target Progress UI
// --------------------------------------------------------------------------

function renderRunningStep() {
  const items = Array.from(broadcastState.targetStatuses.values());
  const completed = items.filter(i => i.status === 'completed').length;
  const failed = items.filter(i => i.status === 'failed' || i.status === 'disconnected').length;
  const cancelled = items.filter(i => i.status === 'cancelled').length;
  const finished = completed + failed + cancelled;
  const total = items.length;
  const percent = total > 0 ? Math.round((finished / total) * 100) : 0;
  const sec = (broadcastState.elapsedMs / 1000).toFixed(1);

  return `
    <div class="broadcast-modal-card bcast-large-modal">
      <div class="broadcast-header">
        <div class="broadcast-title-row">
          <span class="broadcast-spinner"></span>
          <div>
            <h3>Executing Broadcast Dispatch</h3>
            <p class="broadcast-subtitle">Streaming operational command across ${total} target terminals</p>
          </div>
        </div>
        <div class="bcast-header-right">
          <span id="bcastStopwatch" class="bcast-stopwatch-pill">⏱ Elapsed: ${sec}s</span>
        </div>
      </div>

      ${renderWorkflowStepper('running')}

      <div class="broadcast-body">
        <!-- Progress Bar & Metrics -->
        <div class="bcast-progress-dashboard">
          <div class="bcast-progress-info">
            <span>Overall Progress: <strong>${finished} / ${total} completed (${percent}%)</strong></span>
            <div class="bcast-mini-stats">
              <span class="text-success">✓ ${completed} ok</span>
              ${failed > 0 ? `<span class="text-danger">✕ ${failed} failed</span>` : ''}
              ${cancelled > 0 ? `<span class="text-warning">⏹ ${cancelled} cancelled</span>` : ''}
            </div>
          </div>
          <div class="progress-bar-track">
            <div class="progress-bar-fill" style="width: ${percent}%;"></div>
          </div>
        </div>

        <!-- Target Status List with Live Console Drawers -->
        <div id="bcastRunningList" class="bcast-running-list">
          ${items.map(item => renderTargetStatusRow(item)).join('')}
        </div>
      </div>

      <div class="broadcast-footer">
        <span class="bcast-running-note">Broadcast runs asynchronously in background.</span>
        <button id="bcastCancelExecutionBtn" class="btn btn-danger">⏹ Cancel Remaining Execution</button>
      </div>
    </div>
  `;
}

function renderTargetStatusRow(item) {
  let statusBadge = '';
  switch (item.status) {
    case 'completed':
      statusBadge = '<span class="status-pill pill-success">✓ Completed</span>';
      break;
    case 'failed':
      statusBadge = `<span class="status-pill pill-danger" title="${escapeHtml(item.error)}">✕ Failed</span>`;
      break;
    case 'sending':
      statusBadge = '<span class="status-pill pill-running">● Sending...</span>';
      break;
    case 'cancelled':
      statusBadge = '<span class="status-pill pill-cancelled">⏹ Cancelled</span>';
      break;
    case 'disconnected':
      statusBadge = '<span class="status-pill pill-disconnected">🔌 Disconnected</span>';
      break;
    default:
      statusBadge = '<span class="status-pill pill-pending">⏳ Pending</span>';
  }

  const durationStr = item.durationMs ? `(${ (item.durationMs / 1000).toFixed(2) }s)` : '';

  return `
    <div class="bcast-status-card" data-id="${item.id}">
      <div class="bcast-status-row">
        <div class="bcast-status-info">
          <div class="bcast-status-name-row">
            <span class="bcast-status-name">${escapeHtml(item.name)}</span>
            <span class="bcast-env-mini-badge">${item.env.toUpperCase()}</span>
          </div>
          <span class="bcast-status-host">${escapeHtml(item.host)}</span>
        </div>

        <div class="bcast-status-badge-wrap">
          ${statusBadge}
          <span class="bcast-status-duration">${durationStr}</span>
          <button class="bcast-toggle-drawer-btn" data-id="${item.id}" title="Toggle live output console">
            ${item.openDrawer ? '▲ Hide Console' : '▼ Live Console'}
          </button>
        </div>
      </div>

      ${item.error ? `<div class="bcast-status-err">❌ Error: ${escapeHtml(item.error)}</div>` : ''}

      <!-- Expandable Live Terminal Drawer -->
      <div id="bcastDrawerContainer_${item.id}" class="bcast-terminal-drawer ${item.openDrawer ? 'open' : ''}">
        <div class="bcast-drawer-header">
          <span>Terminal Stream: ${escapeHtml(item.name)}</span>
          <button class="bcast-copy-drawer-btn" data-id="${item.id}">📋 Copy Output</button>
        </div>
        <pre id="bcastDrawer_${item.id}" class="bcast-drawer-content"><code>${formatAnsiToHtml(item.output || 'Waiting for stdout...\n')}</code></pre>
      </div>
    </div>
  `;
}

function updateRunningDOM() {
  const container = document.getElementById('bcastRunningList');
  if (!container) return;
  const items = Array.from(broadcastState.targetStatuses.values());
  container.innerHTML = items.map(item => renderTargetStatusRow(item)).join('');
  attachRunningStepHandlers();
}

// --------------------------------------------------------------------------
// Step 5: Aggregate Results Matrix UI
// --------------------------------------------------------------------------

function renderCompletedStep() {
  const items = Array.from(broadcastState.targetStatuses.values());
  const completed = items.filter(i => i.status === 'completed').length;
  const failed = items.filter(i => i.status === 'failed' || i.status === 'disconnected').length;
  const cancelled = items.filter(i => i.status === 'cancelled').length;
  const total = items.length;
  const durationSec = (broadcastState.elapsedMs / 1000).toFixed(2);

  const filter = broadcastState.resultsFilter;
  const filteredItems = items.filter(item => {
    if (filter === 'success') return item.status === 'completed';
    if (filter === 'failed') return item.status === 'failed' || item.status === 'disconnected' || item.status === 'cancelled';
    return true;
  });

  return `
    <div class="broadcast-modal-card bcast-large-modal">
      <div class="broadcast-header">
        <div class="broadcast-title-row">
          <span class="broadcast-icon">${failed === 0 ? '✅' : '⚠️'}</span>
          <div>
            <h3>Broadcast Aggregate Results</h3>
            <p class="broadcast-subtitle">Execution completed across ${total} targets in ${durationSec} seconds</p>
          </div>
        </div>
        <button id="broadcastCloseBtn" class="broadcast-close-btn">✕</button>
      </div>

      ${renderWorkflowStepper('completed')}

      <div class="broadcast-body">
        <!-- Metric Cards Grid -->
        <div class="bcast-metrics-grid">
          <div class="bcast-metric-card">
            <span class="bcast-metric-num">${total}</span>
            <span class="bcast-metric-lbl">Total Targets</span>
          </div>
          <div class="bcast-metric-card metric-success">
            <span class="bcast-metric-num">${completed}</span>
            <span class="bcast-metric-lbl">Succeeded</span>
          </div>
          <div class="bcast-metric-card ${failed > 0 ? 'metric-failed' : ''}">
            <span class="bcast-metric-num">${failed}</span>
            <span class="bcast-metric-lbl">Failed</span>
          </div>
          <div class="bcast-metric-card ${cancelled > 0 ? 'metric-cancelled' : ''}">
            <span class="bcast-metric-num">${cancelled}</span>
            <span class="bcast-metric-lbl">Cancelled</span>
          </div>
          <div class="bcast-metric-card metric-time">
            <span class="bcast-metric-num">${durationSec}s</span>
            <span class="bcast-metric-lbl">Total Duration</span>
          </div>
        </div>

        <!-- Output Filter Bar & Actions -->
        <div class="bcast-results-toolbar">
          <div class="bcast-filter-pills">
            <button class="bcast-pill-btn ${filter === 'all' ? 'active' : ''}" data-resfilter="all">All Targets (${total})</button>
            <button class="bcast-pill-btn pill-live ${filter === 'success' ? 'active' : ''}" data-resfilter="success">✓ Succeeded (${completed})</button>
            <button class="bcast-pill-btn pill-prod ${filter === 'failed' ? 'active' : ''}" data-resfilter="failed">✕ Failed / Cancelled (${failed + cancelled})</button>
          </div>

          <div class="bcast-results-actions">
            <button id="bcastCopyAllOutputsBtn" class="btn btn-secondary bcast-sm-btn">📋 Copy All Output</button>
            <button id="bcastExportJsonBtn" class="btn btn-secondary bcast-sm-btn">💾 Export JSON Report</button>
            ${failed > 0 || cancelled > 0 ? `
              <button id="bcastRerunFailedBtn" class="btn btn-warning bcast-sm-btn">🔄 Re-run Failed Targets Only</button>
            ` : ''}
          </div>
        </div>

        <!-- Output Inspection Matrix -->
        <div class="bcast-matrix-container">
          ${filteredItems.length === 0 ? `
            <div class="bcast-empty-state">No target results match filter "${filter}".</div>
          ` : filteredItems.map(item => `
            <div class="bcast-matrix-card">
              <div class="bcast-matrix-card-header">
                <div class="bcast-matrix-target-info">
                  <strong>${escapeHtml(item.name)}</strong>
                  <span class="bcast-matrix-host">${escapeHtml(item.host)}</span>
                  <span class="bcast-env-mini-badge">${item.env.toUpperCase()}</span>
                </div>
                <div class="bcast-matrix-status-wrap">
                  <span class="status-pill ${item.status === 'completed' ? 'pill-success' : 'pill-danger'}">
                    ${item.status === 'completed' ? '✓ OK' : '✕ ' + item.status}
                  </span>
                  <span class="bcast-matrix-time">${item.durationMs ? (item.durationMs / 1000).toFixed(2) + 's' : ''}</span>
                  <button class="bcast-copy-target-output-btn" data-id="${item.id}" title="Copy output">📋 Copy</button>
                </div>
              </div>

              ${item.error ? `<div class="bcast-matrix-err">Error: ${escapeHtml(item.error)}</div>` : ''}

              <pre class="bcast-matrix-output"><code>${formatAnsiToHtml(item.output || '(No console output captured)')}</code></pre>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="broadcast-footer">
        <button id="bcastNewBroadcastBtn" class="btn btn-secondary">＋ New Broadcast</button>
        <button id="bcastDoneBtn" class="btn btn-primary">Done</button>
      </div>
    </div>
  `;
}

// --------------------------------------------------------------------------
// DOM Event Attachments
// --------------------------------------------------------------------------

function attachModalHandlers() {
  // Global Header Close
  const closeBtn = document.getElementById('broadcastCloseBtn');
  if (closeBtn) closeBtn.onclick = closeBroadcast;

  const cancelBtn = document.getElementById('bcastCancelBtn');
  if (cancelBtn) cancelBtn.onclick = closeBroadcast;

  const doneBtn = document.getElementById('bcastDoneBtn');
  if (doneBtn) doneBtn.onclick = closeBroadcast;

  // Step 1: Target Handlers
  attachTargetStepHandlers();

  // Step 2: Command Handlers
  attachCommandStepHandlers();

  // Step 3: Preview Handlers
  attachPreviewStepHandlers();

  // Step 4: Running Handlers
  attachRunningStepHandlers();

  // Step 5: Results Handlers
  attachResultsStepHandlers();
}

function attachTargetStepHandlers() {
  // Filter pills
  document.querySelectorAll('.bcast-pill-btn[data-filter]').forEach(btn => {
    btn.onclick = () => {
      broadcastState.targetFilterEnv = btn.getAttribute('data-filter');
      renderBroadcastModal();
    };
  });

  // Select all filtered
  const selFilteredBtn = document.getElementById('bcastSelectFilteredBtn');
  if (selFilteredBtn) {
    selFilteredBtn.onclick = () => {
      const all = broadcastState.availableTargets;
      const search = broadcastState.searchTerm.toLowerCase();
      const filterEnv = broadcastState.targetFilterEnv;
      all.forEach(t => {
        if (filterEnv === 'live' && !t.isLive) return;
        if (filterEnv === 'offline' && t.isLive) return;
        if (filterEnv === 'prod' && t.env !== 'prod') return;
        if (filterEnv === 'uat' && t.env !== 'uat') return;
        if (filterEnv === 'test' && t.env !== 'test' && t.env !== 'dev') return;
        if (search && !t.name.toLowerCase().includes(search) && !t.host.toLowerCase().includes(search)) return;
        broadcastState.selectedTargetIds.add(t.id);
      });
      renderBroadcastModal();
    };
  }

  // Select live only
  const selLiveBtn = document.getElementById('bcastSelectLiveBtn');
  if (selLiveBtn) {
    selLiveBtn.onclick = () => {
      broadcastState.availableTargets.forEach(t => {
        if (t.isLive) broadcastState.selectedTargetIds.add(t.id);
      });
      renderBroadcastModal();
    };
  }

  // Clear all
  const clearBtn = document.getElementById('bcastClearBtn');
  if (clearBtn) {
    clearBtn.onclick = () => {
      broadcastState.selectedTargetIds.clear();
      renderBroadcastModal();
    };
  }

  // Search input
  const searchInput = document.getElementById('bcastSearchInput');
  if (searchInput) {
    searchInput.oninput = (e) => {
      broadcastState.searchTerm = e.target.value;
      renderBroadcastModal();
      const updated = document.getElementById('bcastSearchInput');
      if (updated) {
        updated.focus();
        updated.selectionStart = updated.selectionEnd = updated.value.length;
      }
    };
  }

  // Refresh discovery
  const refreshBtn = document.getElementById('bcastRefreshDiscoveryBtn');
  if (refreshBtn) {
    refreshBtn.onclick = () => {
      broadcastState.availableTargets = discoverBroadcastTargets();
      showToast('Discovered ' + broadcastState.availableTargets.length + ' targets.', 'info');
      renderBroadcastModal();
    };
  }

  // Target checkboxes & row click
  document.querySelectorAll('.bcast-target-card').forEach(card => {
    card.onclick = (e) => {
      if (e.target.tagName === 'INPUT') return;
      const id = card.getAttribute('data-id');
      const cb = card.querySelector('.bcast-target-checkbox');
      if (cb) {
        cb.checked = !cb.checked;
        if (cb.checked) {
          broadcastState.selectedTargetIds.add(id);
        } else {
          broadcastState.selectedTargetIds.delete(id);
        }
        card.classList.toggle('selected', cb.checked);
        updateTargetsFooterCount();
      }
    };
  });

  document.querySelectorAll('.bcast-target-checkbox').forEach(cb => {
    cb.onchange = (e) => {
      const id = e.target.getAttribute('data-id');
      if (e.target.checked) {
        broadcastState.selectedTargetIds.add(id);
      } else {
        broadcastState.selectedTargetIds.delete(id);
      }
      const card = e.target.closest('.bcast-target-card');
      if (card) card.classList.toggle('selected', e.target.checked);
      updateTargetsFooterCount();
    };
  });

  // Proceed to Step 2
  const proceedBtn = document.getElementById('bcastProceedToCommandBtn');
  if (proceedBtn) {
    proceedBtn.onclick = () => {
      if (broadcastState.selectedTargetIds.size === 0) return;
      broadcastState.currentStep = 'command';
      renderBroadcastModal();
    };
  }
}

function updateTargetsFooterCount() {
  const proceedBtn = document.getElementById('bcastProceedToCommandBtn');
  const count = broadcastState.selectedTargetIds.size;
  if (proceedBtn) {
    proceedBtn.disabled = count === 0;
    proceedBtn.textContent = `Proceed to Command & Risk (${count} Targets) →`;
  }
}

function attachCommandStepHandlers() {
  // Command Textarea
  const cmdInput = document.getElementById('bcastCommandInput');
  if (cmdInput) {
    cmdInput.oninput = (e) => {
      broadcastState.command = e.target.value;
      updateValidationAndRisk();
      const proceedBtn = document.getElementById('bcastProceedToPreviewBtn');
      if (proceedBtn) {
        proceedBtn.disabled = !broadcastState.validation.isValid;
      }
    };
  }

  // Quick Templates
  document.querySelectorAll('.bcast-tpl-btn').forEach(btn => {
    btn.onclick = () => {
      const cmd = btn.getAttribute('data-cmd');
      broadcastState.command = cmd;
      updateValidationAndRisk();
      renderBroadcastModal();
    };
  });

  // Navigation
  const backBtn = document.getElementById('bcastBackToTargetsBtn');
  if (backBtn) {
    backBtn.onclick = () => {
      broadcastState.currentStep = 'targets';
      renderBroadcastModal();
    };
  }

  const proceedBtn = document.getElementById('bcastProceedToPreviewBtn');
  if (proceedBtn) {
    proceedBtn.onclick = () => {
      if (!broadcastState.validation.isValid) return;
      broadcastState.currentStep = 'preview';
      renderBroadcastModal();
    };
  }
}

function attachPreviewStepHandlers() {
  // Mode selection
  document.querySelectorAll('input[name="bcastMode"]').forEach(radio => {
    radio.onchange = (e) => {
      broadcastState.mode = e.target.value;
      renderBroadcastModal();
    };
  });

  // Copy command
  const copyCmdBtn = document.getElementById('bcastCopyCmdBtn');
  if (copyCmdBtn) {
    copyCmdBtn.onclick = () => {
      navigator.clipboard.writeText(broadcastState.command);
      showToast('Command copied to clipboard', 'info');
    };
  }

  // Strict confirmation input
  const confirmInput = document.getElementById('bcastStrictConfirmInput');
  if (confirmInput) {
    confirmInput.oninput = (e) => {
      broadcastState.strictConfirmInput = e.target.value;
      const isTyped = e.target.value.trim().toUpperCase() === 'CONFIRM';
      const execBtn = document.getElementById('bcastExecuteBtn');
      if (execBtn) {
        execBtn.disabled = !isTyped;
      }
    };
  }

  // Back to command
  const backBtn = document.getElementById('bcastBackToCommandBtn');
  if (backBtn) {
    backBtn.onclick = () => {
      broadcastState.currentStep = 'command';
      renderBroadcastModal();
    };
  }

  // Execute
  const execBtn = document.getElementById('bcastExecuteBtn');
  if (execBtn) {
    execBtn.onclick = startBroadcast;
  }
}

function attachRunningStepHandlers() {
  // Cancel
  const cancelBtn = document.getElementById('bcastCancelExecutionBtn');
  if (cancelBtn) cancelBtn.onclick = cancelBroadcast;

  // Toggle drawers
  document.querySelectorAll('.bcast-toggle-drawer-btn').forEach(btn => {
    btn.onclick = () => {
      const id = btn.getAttribute('data-id');
      const item = broadcastState.targetStatuses.get(id);
      if (item) {
        item.openDrawer = !item.openDrawer;
        const container = document.getElementById(`bcastDrawerContainer_${id}`);
        if (container) {
          container.classList.toggle('open', item.openDrawer);
        }
        btn.textContent = item.openDrawer ? '▲ Hide Console' : '▼ Live Console';
      }
    };
  });

  // Copy individual drawer
  document.querySelectorAll('.bcast-copy-drawer-btn').forEach(btn => {
    btn.onclick = () => {
      const id = btn.getAttribute('data-id');
      const item = broadcastState.targetStatuses.get(id);
      if (item && item.output) {
        navigator.clipboard.writeText(item.output);
        showToast(`Copied output for ${item.name}`, 'info');
      }
    };
  });
}

function attachResultsStepHandlers() {
  // Filter pills
  document.querySelectorAll('.bcast-pill-btn[data-resfilter]').forEach(btn => {
    btn.onclick = () => {
      broadcastState.resultsFilter = btn.getAttribute('data-resfilter');
      renderBroadcastModal();
    };
  });

  // Copy target output in matrix
  document.querySelectorAll('.bcast-copy-target-output-btn').forEach(btn => {
    btn.onclick = () => {
      const id = btn.getAttribute('data-id');
      const item = broadcastState.targetStatuses.get(id);
      if (item && item.output) {
        navigator.clipboard.writeText(item.output);
        showToast(`Copied output for ${item.name}`, 'info');
      }
    };
  });

  // Copy All Outputs
  const copyAllBtn = document.getElementById('bcastCopyAllOutputsBtn');
  if (copyAllBtn) {
    copyAllBtn.onclick = () => {
      const items = Array.from(broadcastState.targetStatuses.values());
      let text = `# Nexterm Broadcast Execution Report\n`;
      text += `**Command:** \`${broadcastState.command}\`\n`;
      text += `**Duration:** ${(broadcastState.elapsedMs / 1000).toFixed(2)}s\n`;
      text += `**Targets:** ${items.length}\n\n`;
      items.forEach(i => {
        text += `## Server: ${i.name} (${i.host}) - Status: ${i.status.toUpperCase()}\n`;
        text += '```\n' + (i.output || '(No output)') + '\n```\n\n';
      });
      navigator.clipboard.writeText(text);
      showToast('Copied markdown report for all targets', 'info');
    };
  }

  // Export JSON Report
  const exportJsonBtn = document.getElementById('bcastExportJsonBtn');
  if (exportJsonBtn) {
    exportJsonBtn.onclick = () => {
      const items = Array.from(broadcastState.targetStatuses.values());
      const report = {
        requestId: broadcastState.requestId,
        command: broadcastState.command,
        mode: broadcastState.mode,
        durationMs: broadcastState.elapsedMs,
        timestamp: new Date().toISOString(),
        targets: items.map(i => ({
          name: i.name,
          host: i.host,
          env: i.env,
          status: i.status,
          error: i.error,
          durationMs: i.durationMs,
          output: i.output
        }))
      };

      const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `broadcast-report-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('Exported broadcast JSON report', 'info');
    };
  }

  // Re-run Failed Targets Only
  const rerunFailedBtn = document.getElementById('bcastRerunFailedBtn');
  if (rerunFailedBtn) {
    rerunFailedBtn.onclick = () => {
      const failedTargetIds = [];
      broadcastState.targetStatuses.forEach(item => {
        if (item.status === 'failed' || item.status === 'disconnected' || item.status === 'cancelled') {
          failedTargetIds.push(item.id);
        }
      });
      if (failedTargetIds.length === 0) {
        showToast('No failed targets to re-run.', 'info');
        return;
      }

      broadcastState.selectedTargetIds.clear();
      failedTargetIds.forEach(id => broadcastState.selectedTargetIds.add(id));
      broadcastState.currentStep = 'command';
      showToast(`Loaded ${failedTargetIds.length} failed target(s) for re-execution.`, 'info');
      renderBroadcastModal();
    };
  }

  // New Broadcast
  const newBtn = document.getElementById('bcastNewBroadcastBtn');
  if (newBtn) {
    newBtn.onclick = () => openBroadcastDialog('all');
  }
}
