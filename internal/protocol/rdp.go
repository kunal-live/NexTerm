package protocol

import (
	"context"
	"fmt"
	"net"
	"net/url"
	"nexterm/internal/model"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

// RDPSession implements ProtocolSession for Microsoft Remote Desktop connections.
type RDPSession struct {
	*BaseSession
	cmd       *exec.Cmd
	tempPath  string
	closeOnce sync.Once
	mu        sync.Mutex
}

// NewRDPSession constructs a new RDP protocol session.
func NewRDPSession(id string, profile model.SessionProfile) *RDPSession {
	base := NewBaseSession(id, "rdp", profile)
	return &RDPSession{
		BaseSession: base,
	}
}

// GenerateRDPProfileContent builds the content of an .rdp configuration file with
// advanced device redirection, audio, display, and performance flags.
func GenerateRDPProfileContent(p model.SessionProfile, port int) string {
	// Host, user and domain may come from an imported session file; strip line
	// breaks so they cannot inject extra .rdp settings (e.g. drive redirection).
	host := rdpField(p.Host)
	if strings.Contains(host, ":") {
		host = "[" + host + "]" // IPv6 literal
	}
	content := fmt.Sprintf("full address:s:%s:%d\r\nprompt for credentials:i:1\r\n", host, port)
	if p.Username != "" {
		content += fmt.Sprintf("username:s:%s\r\n", rdpField(p.Username))
	}
	if p.RDPDomain != "" {
		content += fmt.Sprintf("domain:s:%s\r\n", rdpField(p.RDPDomain))
	}
	if p.RDPFullScreen {
		content += "screen mode id:i:2\r\n"
	} else if p.RDPWidth > 0 && p.RDPHeight > 0 {
		content += fmt.Sprintf("desktopwidth:i:%d\r\ndesktopheight:i:%d\r\nscreen mode id:i:1\r\n", p.RDPWidth, p.RDPHeight)
	}

	// Advanced Redirections (MobaXterm parity)
	if p.RDPRedirectDrives {
		content += "drivestoredirect:s:*\r\n"
	}
	// Clipboard redirection: enabled by default unless explicitly disabled
	if p.RDPRedirectClipboard == nil || *p.RDPRedirectClipboard {
		content += "redirectclipboard:i:1\r\n"
	} else {
		content += "redirectclipboard:i:0\r\n"
	}
	if p.RDPRedirectPrinters {
		content += "redirectprinters:i:1\r\n"
	}
	if p.RDPRedirectPorts {
		content += "redirectcomports:i:1\r\n"
	}
	if p.RDPRedirectSmartCards {
		content += "redirectsmartcards:i:1\r\n"
	}

	// Audio Redirection: 0 = play on client, 1 = play on remote, 2 = do not play
	content += fmt.Sprintf("audiomode:i:%d\r\n", p.RDPAudioMode)
	if p.RDPAudioCapture {
		content += "audiocapturemode:i:1\r\n"
	}

	// Network Performance Auto-detection & Experience Flags
	perf := p.RDPPerformanceFlags
	if perf <= 0 {
		perf = 7 // Default LAN experience for high responsiveness
	}
	content += fmt.Sprintf("connection type:i:%d\r\nnetworkautodetect:i:1\r\nbandwidthautodetect:i:1\r\n", perf)

	return content
}

// rdpField removes characters that would end an .rdp "key:type:value" line.
func rdpField(s string) string {
	return strings.NewReplacer("\r", "", "\n", "", "\x00", "").Replace(strings.TrimSpace(s))
}

// Connect generates the RDP configuration file and launches mstsc.exe or xfreerdp.
func (r *RDPSession) Connect(ctx context.Context) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	p := r.Profile()
	if p.Host == "" {
		return fmt.Errorf("remote host is required for RDP")
	}

	port := p.Port
	if port <= 0 {
		port = 3389
	}

	r.EmitStateChange("connecting", fmt.Sprintf("Launching Remote Desktop to %s:%d...", p.Host, port))

	// Generate .rdp file content in a private, unpredictably named temp file
	// (CreateTemp opens it 0600 and never follows a pre-planted symlink).
	rdpContent := GenerateRDPProfileContent(p, port)
	tmp, err := os.CreateTemp("", "nexterm_*.rdp")
	if err != nil {
		r.SetConnected(false)
		r.EmitStateChange("failed", err.Error())
		return fmt.Errorf("failed to generate RDP profile: %w", err)
	}
	tempRDP := tmp.Name()
	if _, err := tmp.WriteString(rdpContent); err != nil {
		_ = tmp.Close()
		_ = os.Remove(tempRDP)
		r.SetConnected(false)
		r.EmitStateChange("failed", err.Error())
		return fmt.Errorf("failed to generate RDP profile: %w", err)
	}
	if err := tmp.Close(); err != nil {
		_ = os.Remove(tempRDP)
		r.SetConnected(false)
		r.EmitStateChange("failed", err.Error())
		return fmt.Errorf("failed to generate RDP profile: %w", err)
	}

	r.tempPath = tempRDP

	// detached launchers (open, xdg-open) hand the file to another application and
	// exit at once, so their exit says nothing about the RDP window's lifetime.
	var cmd *exec.Cmd
	detached := false
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("mstsc.exe", tempRDP)
	case "darwin":
		cmd = exec.Command("open", tempRDP)
		detached = true
	default:
		if freerdp := firstOnPath("xfreerdp3", "xfreerdp", "wlfreerdp3", "wlfreerdp"); freerdp != "" {
			args := []string{"/v:" + net.JoinHostPort(p.Host, strconv.Itoa(port)), "/cert:tofu", "/dynamic-resolution"}
			if p.Username != "" {
				args = append(args, "/u:"+p.Username)
			}
			if p.RDPDomain != "" {
				args = append(args, "/d:"+p.RDPDomain)
			}
			if p.RDPFullScreen {
				args = append(args, "/f")
			} else if p.RDPWidth > 0 && p.RDPHeight > 0 {
				args = append(args, fmt.Sprintf("/size:%dx%d", p.RDPWidth, p.RDPHeight))
			}
			if p.RDPRedirectDrives {
				args = append(args, "/drive:hotplug,*")
			}
			if p.RDPRedirectClipboard == nil || *p.RDPRedirectClipboard {
				args = append(args, "+clipboard")
			}
			if p.RDPAudioMode == 0 {
				args = append(args, "/sound")
			}
			if p.RDPAudioCapture {
				args = append(args, "/microphone")
			}
			cmd = exec.Command(freerdp, args...)
		} else if remmina := firstOnPath("remmina"); remmina != "" {
			target := &url.URL{Scheme: "rdp", Host: net.JoinHostPort(p.Host, strconv.Itoa(port))}
			if p.Username != "" {
				target.User = url.User(p.Username)
			}
			cmd = exec.Command(remmina, "-c", target.String())
		} else {
			cmd = exec.Command("xdg-open", tempRDP)
			detached = true
		}
	}

	if err := cmd.Start(); err != nil {
		r.SetConnected(false)
		r.EmitStateChange("failed", err.Error())
		_ = os.Remove(tempRDP)
		switch runtime.GOOS {
		case "darwin":
			return fmt.Errorf("launch RDP client failed: %w (install Microsoft Remote Desktop from the Mac App Store)", err)
		case "windows":
			return fmt.Errorf("launch RDP client failed: %w", err)
		default:
			return fmt.Errorf("launch RDP client failed: %w (install FreeRDP (xfreerdp) or Remmina)", err)
		}
	}

	r.cmd = cmd
	r.SetConnected(true)
	r.EmitStateChange("connected", fmt.Sprintf("Remote Desktop active (%s:%d)", p.Host, port))

	banner := fmt.Sprintf("\r\n======================================================\r\n"+
		"  Remote Desktop Session Active\r\n"+
		"  Target: %s:%d\r\n"+
		"  User:   %s\r\n"+
		"======================================================\r\n\r\n"+
		"Native RDP window opened. Close window to end session.\r\n",
		p.Host, port, p.Username)
	r.EmitData([]byte(banner))

	// Pass cmd explicitly: Disconnect clears r.cmd concurrently.
	if detached {
		go r.waitLauncher(cmd)
	} else {
		go r.waitProcess(cmd)
	}

	return nil
}

func (r *RDPSession) waitProcess(cmd *exec.Cmd) {
	_ = cmd.Wait()

	r.SetConnected(false)
	r.EmitDisconnect("RDP window closed by user", nil)
	_ = r.Disconnect()
}

// waitLauncher handles `open` / `xdg-open`: a failure means no application could
// open the .rdp file; success only means the file was handed over, so the session
// stays open (until the tab is closed) and the profile file is removed a little
// later, once the RDP client has had time to read it.
func (r *RDPSession) waitLauncher(cmd *exec.Cmd) {
	if err := cmd.Wait(); err != nil {
		r.SetConnected(false)
		r.EmitDisconnect("No application could open the RDP connection ("+err.Error()+"). Install Microsoft Remote Desktop (macOS) or FreeRDP/Remmina (Linux).", err)
		_ = r.Disconnect()
		return
	}
	time.AfterFunc(2*time.Minute, func() {
		r.mu.Lock()
		defer r.mu.Unlock()
		if r.tempPath != "" {
			_ = os.Remove(r.tempPath)
			r.tempPath = ""
		}
	})
}

// firstOnPath returns the full path of the first named program found on PATH.
func firstOnPath(names ...string) string {
	for _, n := range names {
		if p, err := exec.LookPath(n); err == nil {
			return p
		}
	}
	return ""
}

// Disconnect terminates the RDP process and cleans up temporary config files.
func (r *RDPSession) Disconnect() error {
	r.mu.Lock()
	defer r.mu.Unlock()

	r.closeOnce.Do(func() {
		r.SetConnected(false)
		if r.cmd != nil && r.cmd.Process != nil {
			_ = r.cmd.Process.Kill()
			r.cmd = nil
		}
		if r.tempPath != "" {
			_ = os.Remove(r.tempPath)
			r.tempPath = ""
		}
	})
	return nil
}

// Write outputs command notifications.
func (r *RDPSession) Write(data []byte) error {
	return nil
}

// Resize is handled natively by mstsc.
func (r *RDPSession) Resize(cols, rows int) error {
	return nil
}
