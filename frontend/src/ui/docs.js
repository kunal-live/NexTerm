// ==========================================================================
// Nexterm — In-app Documentation view
// Opens a full-screen, scrollable documentation page (as a new in-app view)
// explaining the app flow, every feature, shortcuts, and the repo link.
// ==========================================================================

import { showToast } from "./notifications.js";

const REPO_URL = "https://github.com/kunal-live/NexTerm";

function openExternal(url) {
  const rt = window.runtime || (window.wails && window.wails.runtime) || null;
  if (rt && rt.BrowserOpenURL) { try { rt.BrowserOpenURL(url); return true; } catch (_) {} }
  try { navigator.clipboard.writeText(url); showToast("Link copied to clipboard: " + url, "info"); return true; } catch (_) {}
  showToast(url, "info");
  return false;
}

const feature = (icon, title, body) => `
  <div class="doc-feature">
    <div class="doc-feature-ico">${icon}</div>
    <div class="doc-feature-body"><div class="doc-feature-title">${title}</div><div class="doc-feature-text">${body}</div></div>
  </div>`;

const sc = (keys, what) => `<tr><td><span class="doc-kbd">${keys}</span></td><td>${what}</td></tr>`;

export function showDocumentation() {
  let el = document.getElementById("docOverlay");
  if (el) el.remove();
  el = document.createElement("div");
  el.id = "docOverlay";
  el.className = "doc-overlay";
  el.innerHTML = `
    <div class="doc-topbar">
      <div class="doc-brand"><span class="doc-brand-mark">N</span> NexTerm <span class="doc-brand-sub">Documentation</span></div>
      <div class="doc-top-actions">
        <button class="doc-btn" id="docGithubTop">★ GitHub Repo</button>
        <button class="doc-close" id="docClose" title="Close (Esc)">&times;</button>
      </div>
    </div>
    <div class="doc-scroll">
      <div class="doc-content">

        <div class="doc-hero">
          <h1>NexTerm — User Guide</h1>
          <p class="doc-lead">A modern SSH &amp; terminal workspace: connect to servers, manage files, monitor systems, automate command procedures, and keep everything organized in one place.</p>
        </div>

        <h2>1 · How the app is laid out</h2>
        <div class="doc-flow">
          <div class="doc-flow-step"><b>Top bar</b><span>Menu (☰), global search / command palette (Ctrl+K), X Server, notifications, settings.</span></div>
          <div class="doc-flow-arrow">→</div>
          <div class="doc-flow-step"><b>Left sidebar</b><span>Your Saved Sessions tree (folders by environment) + Quick Connect + the SFTP dual file manager.</span></div>
          <div class="doc-flow-arrow">→</div>
          <div class="doc-flow-step"><b>Tabs</b><span>Home tab + one tab per open session. The <b>+</b> after the tabs opens a new Home tab.</span></div>
          <div class="doc-flow-arrow">→</div>
          <div class="doc-flow-step"><b>Workspace</b><span>The Home dashboard, or the live terminal for the active session (with SFTP below).</span></div>
        </div>

        <h2>2 · Getting connected</h2>
        <div class="doc-feature-grid">
          ${feature("🖥️", "Local Terminal", "Open a local PowerShell / CMD / WSL shell instantly from the Home card or the ☰ → Terminal.")}
          ${feature("🔐", "New SSH Session", "Click <b>New Session</b> (or Ctrl+N). Enter host, user, and a password / key / certificate. It's saved into the tree so you can reconnect with one click.")}
          ${feature("⚡", "Quick Connect", "Type <span class='doc-mono'>user@host</span> in the sidebar Quick Connect box and hit Enter for a throwaway connection.")}
          ${feature("📁", "Saved Sessions", "Servers are grouped in folders (Production, UAT, Testing, …). Click any saved server to connect; it opens in a new tab and the sidebar tree stays visible.")}
        </div>

        <h2>3 · Files &amp; transfers</h2>
        <div class="doc-feature-grid">
          ${feature("📂", "SFTP Dual File Manager", "Opens automatically on SSH connect. Browse the remote filesystem, navigate paths, and transfer files. Enable <b>Follow terminal folder</b> so SFTP tracks your <span class='doc-mono'>cd</span> in the terminal.")}
        </div>

        <h2>4 · Run commands across servers</h2>
        <div class="doc-feature-grid">
          ${feature("📡", "Broadcast", "Send one command to all (or selected) connected servers at once — great for fleet-wide changes.")}
          ${feature("⌨️", "MultiExec", "A live keystroke bar that streams what you type to every open terminal simultaneously (Alt+M).")}
        </div>

        <h2>5 · Monitor &amp; inspect a server</h2>
        <div class="doc-feature-grid">
          ${feature("📊", "Server Monitoring", "Live dashboard for a connected server: CPU, memory, load, network, users, ports, disk, plus Processes / Services / Docker tabs and threshold alerts.")}
          ${feature("🧩", "Process Explorer", "Live process list (sort by CPU / MEM / PID). Click a process for details — user, memory, working dir, open files, listening ports — and Kill it.")}
          ${feature("🔌", "Ports &amp; Services", "See every listening port, the service, and the owning process/PID. Click a port for details or to kill its process.")}
          ${feature("📜", "Log Explorer", "Live-tail any remote log with instant search, regex, an errors-only filter, colour-coded severity and live error/warn counts.")}
        </div>

        <h2>6 · Automate your work</h2>
        <div class="doc-feature-grid">
          ${feature("⏺", "Session Recorder", "Record the commands you run, save them (fully editable), then replay the whole procedure with one click — on the active terminal or on all connected servers (⇉ All).")}
          ${feature("⏱️", "Command Scheduler", "Auto-run a command or a saved recording once after a delay, or on a repeating interval (health checks, keep-alives).")}
          ${feature("✨", "Command Intelligence", "Type an intent like <span class='doc-mono'>find which process uses port 8080</span> or <span class='doc-mono'>restart nginx</span> and it turns it into the exact command. Read-only queries show output; actions need an explicit Run, and destructive ones confirm first — nothing runs silently.")}
          ${feature("🗂️", "Server Tools", "Per-server <b>Notes</b>, one-click <b>Quick Commands</b>, and <b>Startup Commands</b> that run automatically the moment you connect to that server.")}
          ${feature("🕘", "Command History", "Every SSH command you run is logged and searchable across sessions — click any past command to re-run or copy it.")}
        </div>

        <h2>7 · Organize &amp; extend</h2>
        <div class="doc-feature-grid">
          ${feature("🗄️", "Workspaces / Groups", "Save a set of open tabs as a named group and reopen (or auto-start) them together.")}
          ${feature("🔀", "Tunneling", "Set up SSH local / remote / dynamic port forwarding.")}
          ${feature("🎬", "Macros &amp; Snippets", "Reusable command snippets with <span class='doc-mono'>{{variables}}</span>, and record/replay macros.")}
          ${feature("🎨", "Themes", "Pick from developer and solar system dark themes in Settings or the Themes palette.")}
          ${feature("🖼️", "X Server", "Start a local X server (top-bar icon) so remote Linux GUI apps display on your machine via X11 forwarding.")}
        </div>

        <h2>8 · Keyboard shortcuts</h2>
        <table class="doc-shortcuts">
          <tbody>
            ${sc("Ctrl + N", "New SSH session")}
            ${sc("Ctrl + K", "Command palette / global search")}
            ${sc("Ctrl + Shift + E", "Split pane — right")}
            ${sc("Ctrl + Shift + O", "Split pane — down")}
            ${sc("Alt + M", "Toggle MultiExec bar")}
            ${sc("Ctrl + Alt + B", "Broadcast a command")}
            ${sc("Ctrl + Shift + F", "Find in terminal")}
            ${sc("F1  /  Shift + ?", "Open the shortcuts cheat-sheet")}
            ${sc("Esc", "Close a dialog / cancel reconnect")}
          </tbody>
        </table>

        <h2>9 · Source &amp; contributions</h2>
        <div class="doc-repo">
          <div>NexTerm is open source. Report issues, request features, or contribute here:</div>
          <button class="doc-btn doc-btn-primary" id="docGithub">${REPO_URL}</button>
        </div>

        <div class="doc-footer">NexTerm — Connect Beyond Limits</div>
      </div>
    </div>`;
  document.body.appendChild(el);

  const close = () => { el.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  el.querySelector("#docClose").onclick = close;
  el.querySelector("#docGithub").onclick = () => openExternal(REPO_URL);
  el.querySelector("#docGithubTop").onclick = () => openExternal(REPO_URL);
}
