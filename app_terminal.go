package main

import (
	"errors"
	"fmt"
	"net"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"time"

	"github.com/google/uuid"
	"golang.org/x/crypto/ssh"
	"nexterm/internal/protocol"
	"nexterm/internal/service"
	"nexterm/internal/sshsession"
)

// =========================================================================
// Terminal I/O & Sizing
// =========================================================================

func (a *App) WriteToTerminal(tabID, data string) error {
	if a.terminalService.Has(tabID) {
		return a.terminalService.Write(tabID, []byte(data))
	}
	return a.connectionManager.Write(tabID, []byte(data))
}

func (a *App) ResizeTerminal(tabID string, cols, rows int) error {
	if a.terminalService.Has(tabID) {
		return a.terminalService.Resize(tabID, cols, rows)
	}
	return a.connectionManager.Resize(tabID, cols, rows)
}

func (a *App) ClassifyConnectionError(errString string) sshsession.ClassifiedError {
	return a.connectionManager.ClassifyConnectionError(errString)
}

// =========================================================================
// Command Broadcasting & Multi-Execution (with Policy Enforcement)
// =========================================================================

// BroadcastCommand dispatches a command across target sessions or all currently connected sessions.
// Matches NexTerm Broadcast Architecture: UI -> App Facade -> ConnectionManager -> ProtocolSession targets.
// Enforces SSH protocol availability and dangerous command security policies.
func (a *App) BroadcastCommand(tabIDs []string, command, mode string) (*service.BroadcastResult, error) {
	if err := a.settingsService.CheckProtocol("ssh"); err != nil {
		a.loggingService.LogAudit("POLICY_DENIED", "broadcast", "", "", "", "DENIED", err.Error())
		return nil, err
	}
	if err := a.settingsService.CheckCommand(command); err != nil {
		a.loggingService.LogAudit("POLICY_DENIED", "broadcast", "", "", "", "DENIED", err.Error())
		return nil, err
	}

	// If no tabIDs specified, collect all connected remote and local sessions
	if len(tabIDs) == 0 {
		seen := make(map[string]bool)
		for id := range a.connectionManager.ActiveSessions() {
			if !seen[id] {
				tabIDs = append(tabIDs, id)
				seen[id] = true
			}
		}
		for _, id := range a.terminalService.ActiveTabIDs() {
			if !seen[id] {
				tabIDs = append(tabIDs, id)
				seen[id] = true
			}
		}
	}

	fallbackResolver := func(tabID string) (func([]byte) error, bool) {
		if a.terminalService.Has(tabID) {
			return func(payload []byte) error {
				return a.terminalService.Write(tabID, payload)
			}, true
		}
		return nil, false
	}

	reqID := "bcast-" + uuid.NewString()[:8]
	return a.connectionManager.BroadcastCommandToTargets(a.ctx, reqID, tabIDs, command, mode, nil, fallbackResolver)
}

// CancelBroadcast cancels an in-flight broadcast dispatch by its request ID.
func (a *App) CancelBroadcast(requestID string) error {
	return a.connectionManager.CancelBroadcast(requestID)
}

// BroadcastRaw sends raw bytes to all connected sessions (kept for direct terminal piping).
func (a *App) BroadcastRaw(data string) error {
	if err := a.settingsService.CheckCommand(data); err != nil {
		a.loggingService.LogAudit("POLICY_DENIED", "broadcast_raw", "", "", "", "DENIED", err.Error())
		return err
	}
	err1 := a.connectionManager.BroadcastCommand(data)
	a.terminalService.Broadcast([]byte(data))
	return err1
}

// ExecuteMulti dispatches a command simultaneously to a selected list of active session or terminal tab IDs.
// Enforces dangerous command security policies.
func (a *App) ExecuteMulti(targetTabIDs []string, command string) error {
	if err := a.settingsService.CheckCommand(command); err != nil {
		a.loggingService.LogAudit("POLICY_DENIED", "multi_exec", "", "", "", "DENIED", err.Error())
		return err
	}

	if !strings.HasSuffix(command, "\n") && !strings.HasSuffix(command, "\r") {
		command += "\r"
	}

	var errs []string
	var remoteTabIDs []string
	payload := []byte(command)

	for _, tabID := range targetTabIDs {
		if a.terminalService.Has(tabID) {
			if err := a.terminalService.Write(tabID, payload); err != nil {
				errs = append(errs, fmt.Sprintf("local %s: %v", tabID, err))
			}
		} else {
			remoteTabIDs = append(remoteTabIDs, tabID)
		}
	}

	if len(remoteTabIDs) > 0 {
		if err := a.connectionManager.ExecuteMulti(remoteTabIDs, command); err != nil {
			errs = append(errs, err.Error())
		}
	}

	if a.loggingService != nil {
		a.loggingService.LogInfo("multi_exec", fmt.Sprintf("Multi-execution dispatched across %d target tabs: %s", len(targetTabIDs), strings.TrimSpace(command)))
	}

	if len(errs) > 0 {
		return errors.New(strings.Join(errs, "; "))
	}
	return nil
}

// RunSSHCommand runs a one-shot command on the SSH connection bound to tabID and
// returns its combined stdout+stderr. Used by the Server Monitoring dashboard to
// poll live metrics without disturbing the interactive shell.
// Enforces SSH protocol availability and dangerous command security policies.
func (a *App) RunSSHCommand(tabID, command string) (string, error) {
	if err := a.settingsService.CheckProtocol("ssh"); err != nil {
		a.loggingService.LogAudit("POLICY_DENIED", "ssh_command", "", "", tabID, "DENIED", err.Error())
		return "", err
	}
	if err := a.settingsService.CheckCommand(command); err != nil {
		a.loggingService.LogAudit("POLICY_DENIED", "ssh_command", "", "", tabID, "DENIED", err.Error())
		return "", err
	}

	sess, ok := a.connectionManager.GetSession(tabID)
	if !ok || sess == nil {
		return "", fmt.Errorf("no active session for tab %s", tabID)
	}
	sshSess, ok := sess.(*protocol.SSHSession)
	if !ok {
		return "", fmt.Errorf("monitoring is only available for SSH sessions")
	}
	client := sshSess.Client()
	if client == nil {
		return "", fmt.Errorf("SSH client is not connected")
	}
	s, err := client.NewSession()
	if err != nil {
		return "", err
	}
	defer s.Close()

	type result struct {
		out []byte
		err error
	}
	done := make(chan result, 1)
	go func() {
		out, err := s.CombinedOutput(command)
		done <- result{out, err}
	}()
	select {
	case r := <-done:
		return string(r.out), r.err
	case <-time.After(runSSHCommandTimeout):
		_ = s.Signal(ssh.SIGKILL)
		return "", fmt.Errorf("RunSSHCommand timed out after %s", runSSHCommandTimeout)
	}
}

// =========================================================================
// System Tools & Local X Server
// =========================================================================

func (a *App) LaunchSystemTool(toolKey string) error {
	if runtime.GOOS == "darwin" {
		switch toolKey {
		case "taskmgr", "resmon":
			return exec.Command("open", "-a", "Activity Monitor").Start()
		case "devmgmt":
			return exec.Command("open", "-a", "System Information").Start()
		case "cmd_admin", "powershell_admin":
			// Request root elevation in a new Terminal window
			script := `tell application "Terminal" to do script "echo '=== NexTerm Admin Shell ==='; sudo -i"`
			return exec.Command("osascript", "-e", script).Start()
		case "terminal":
			return exec.Command("open", "-a", "Terminal").Start()
		}
		return fmt.Errorf("system tool not available on macOS: %s", toolKey)
	}

	if runtime.GOOS == "linux" {
		switch toolKey {
		case "taskmgr":
			return exec.Command("gnome-system-monitor").Start()
		case "resmon":
			return exec.Command("top").Start()
		case "devmgmt":
			return exec.Command("hardinfo").Start()
		case "cmd_admin", "powershell_admin":
			if _, err := exec.LookPath("pkexec"); err == nil {
				return exec.Command("x-terminal-emulator", "-e", "pkexec", "bash").Start()
			}
			return exec.Command("x-terminal-emulator", "-e", "sudo", "-i").Start()
		case "terminal":
			return exec.Command("x-terminal-emulator").Start()
		}
		return fmt.Errorf("system tool not available on Linux: %s", toolKey)
	}

	// Windows implementation
	cmdMap := map[string]string{
		"devmgmt":          "devmgmt.msc",
		"taskmgr":          "taskmgr.exe",
		"cmd_admin":        "cmd.exe",
		"powershell_admin": "powershell.exe",
		"resmon":           "resmon.exe",
	}

	executable, exists := cmdMap[toolKey]
	if !exists {
		return fmt.Errorf("unknown system tool: %s", toolKey)
	}

	if toolKey == "cmd_admin" || toolKey == "powershell_admin" {
		return exec.Command("powershell", "-Command", fmt.Sprintf("Start-Process %s -Verb RunAs", executable)).Start()
	}
	return exec.Command(executable).Start()
}

func (a *App) IsXServerRunning() bool {
	if runtime.GOOS != "windows" {
		return os.Getenv("DISPLAY") != ""
	}
	conn, err := net.DialTimeout("tcp", "127.0.0.1:6000", 250*time.Millisecond)
	if err == nil {
		_ = conn.Close()
		return true
	}
	return false
}

// LaunchXServer starts a local X server with xauth access control (strictly no -ac).
func (a *App) LaunchXServer() (string, error) {
	if a.IsXServerRunning() {
		return "An X server is already running/available on this system. Enable 'X11 Forwarding' on a session and run a GUI app like 'xclock'.", nil
	}

	switch runtime.GOOS {
	case "windows":
		type candidate struct {
			path string
			args []string
		}
		candidates := []candidate{
			{`C:\Program Files\VcXsrv\vcxsrv.exe`, []string{":0", "-multiwindow", "-clipboard", "-wgl"}},
			{`C:\Program Files (x86)\VcXsrv\vcxsrv.exe`, []string{":0", "-multiwindow", "-clipboard", "-wgl"}},
			{`C:\Program Files\Xming\Xming.exe`, []string{":0", "-clipboard", "-multiwindow"}},
			{`C:\Program Files (x86)\Xming\Xming.exe`, []string{":0", "-clipboard", "-multiwindow"}},
		}
		for _, c := range candidates {
			if _, err := os.Stat(c.path); err == nil {
				// Keep X access control on (strictly NO "-ac"): the server only accepts
				// clients presenting a valid MIT-MAGIC-COOKIE-1.
				authFile, err := sshsession.PrepareLocalXAuthority(0)
				if err != nil {
					return "", fmt.Errorf("prepare X server cookie: %w", err)
				}
				args := append(append([]string{}, c.args...), "-auth", authFile)
				if err := exec.Command(c.path, args...).Start(); err != nil {
					return "", fmt.Errorf("found %s but failed to start it: %w", c.path, err)
				}
				a.loggingService.LogAudit("XSERVER_STARTED", "xserver", "", "", "", "SUCCESS", c.path)
				return "Started X server: " + c.path + " (display :0). Enable 'X11 Forwarding' on a session, then run a GUI app like 'xclock'.", nil
			}
		}
		return "", fmt.Errorf("no X server found. Install VcXsrv (recommended, free) from sourceforge.net/projects/vcxsrv and try again")

	case "darwin":
		for _, p := range []string{"/Applications/Utilities/XQuartz.app", "/Applications/XQuartz.app"} {
			if _, err := os.Stat(p); err == nil {
				if err := exec.Command("open", "-a", "XQuartz").Start(); err != nil {
					return "", fmt.Errorf("found XQuartz but failed to start it: %w", err)
				}
				a.loggingService.LogAudit("XSERVER_STARTED", "xserver", "", "", "", "SUCCESS", p)
				return "Started XQuartz. Then enable 'X11 Forwarding' on a session and run e.g. 'xclock'.", nil
			}
		}
		if err := exec.Command("open", "-a", "XQuartz").Start(); err == nil {
			return "Attempting to start XQuartz. If nothing appears, install XQuartz (free) from xquartz.org.", nil
		}
		return "", fmt.Errorf("XQuartz not found. Install it (free) from xquartz.org, then try again")

	default: // linux and others
		if d := os.Getenv("DISPLAY"); d != "" {
			return "Linux provides a native X server (DISPLAY=" + d + "). No separate X server is needed — just enable 'X11 Forwarding' on a session and run a GUI app.", nil
		}
		return "", fmt.Errorf("no DISPLAY detected. On Linux the desktop session is the X server — start a graphical session (or set DISPLAY), then enable X11 Forwarding")
	}
}
