package protocol

import (
	"context"
	"fmt"
	"nexterm/internal/model"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sync"
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
	content := fmt.Sprintf("full address:s:%s:%d\r\nprompt for credentials:i:1\r\n", p.Host, port)
	if p.Username != "" {
		content += fmt.Sprintf("username:s:%s\r\n", p.Username)
	}
	if p.RDPDomain != "" {
		content += fmt.Sprintf("domain:s:%s\r\n", p.RDPDomain)
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

	// Generate .rdp file content
	tempRDP := filepath.Join(os.TempDir(), fmt.Sprintf("nexterm_%s.rdp", r.ID()))
	rdpContent := GenerateRDPProfileContent(p, port)

	if err := os.WriteFile(tempRDP, []byte(rdpContent), 0600); err != nil {
		r.SetConnected(false)
		r.EmitStateChange("failed", err.Error())
		return fmt.Errorf("failed to generate RDP profile: %w", err)
	}

	r.tempPath = tempRDP

	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("mstsc.exe", tempRDP)
	case "darwin":
		cmd = exec.Command("open", tempRDP)
	default:
		if _, err := exec.LookPath("xfreerdp"); err == nil {
			args := []string{fmt.Sprintf("/v:%s:%d", p.Host, port)}
			if p.Username != "" {
				args = append(args, fmt.Sprintf("/u:%s", p.Username))
			}
			if p.RDPRedirectDrives {
				args = append(args, "/drive:hotplug,*")
			}
			if p.RDPRedirectClipboard == nil || *p.RDPRedirectClipboard {
				args = append(args, "+clipboard")
			}
			if p.RDPAudioMode == 0 {
				args = append(args, "/sound:sys:alsa")
			}
			if p.RDPAudioCapture {
				args = append(args, "/microphone:sys:alsa")
			}
			cmd = exec.Command("xfreerdp", args...)
		} else if _, err := exec.LookPath("remmina"); err == nil {
			cmd = exec.Command("remmina", "-c", tempRDP)
		} else {
			cmd = exec.Command("xdg-open", tempRDP)
		}
	}

	if err := cmd.Start(); err != nil {
		r.SetConnected(false)
		r.EmitStateChange("failed", err.Error())
		_ = os.Remove(tempRDP)
		if runtime.GOOS == "darwin" {
			return fmt.Errorf("launch RDP client failed: %w (install Microsoft Remote Desktop from Mac App Store)", err)
		}
		return fmt.Errorf("launch RDP client failed: %w", err)
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

	go r.waitProcess()

	return nil
}

func (r *RDPSession) waitProcess() {
	if r.cmd == nil {
		return
	}
	_ = r.cmd.Wait()

	r.SetConnected(false)
	r.EmitDisconnect("RDP window closed by user", nil)
	_ = r.Disconnect()
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
