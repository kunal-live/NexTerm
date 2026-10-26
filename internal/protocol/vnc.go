package protocol

import (
	"context"
	"fmt"
	"io"
	"net"
	"nexterm/internal/model"
	"os/exec"
	"runtime"
	"strconv"
	"sync"
	"time"
)

// VNCSession implements ProtocolSession for Virtual Network Computing (RFB) connections.
// It verifies the server speaks RFB and then hands the display to a native viewer;
// the session lives as long as that viewer process.
type VNCSession struct {
	*BaseSession
	viewerCmd *exec.Cmd
	closeOnce sync.Once
	mu        sync.Mutex
}

// NewVNCSession constructs a new VNC protocol session.
func NewVNCSession(id string, profile model.SessionProfile) *VNCSession {
	base := NewBaseSession(id, "vnc", profile)
	return &VNCSession{
		BaseSession: base,
	}
}

// Connect probes the VNC server's RFB version banner and launches a native viewer.
func (v *VNCSession) Connect(ctx context.Context) error {
	v.mu.Lock()
	defer v.mu.Unlock()

	p := v.Profile()
	if p.Host == "" {
		return fmt.Errorf("remote host is required for VNC")
	}

	port := p.Port
	if port <= 0 {
		port = 5900
	}

	v.EmitStateChange("connecting", fmt.Sprintf("Connecting to VNC server at %s:%d...", p.Host, port))

	addr := net.JoinHostPort(p.Host, strconv.Itoa(port))
	dialer := net.Dialer{Timeout: 10 * time.Second}
	conn, err := dialer.DialContext(ctx, "tcp", addr)
	if err != nil {
		v.SetConnected(false)
		v.EmitStateChange("failed", err.Error())
		return fmt.Errorf("vnc dial %s failed: %w", addr, err)
	}

	// RFB Protocol Version Handshake (RFC 6143 §7.1.1). Only the server banner is
	// read; the probe connection is closed right away so it neither holds a
	// server slot nor counts as a stalled authentication attempt.
	_ = conn.SetDeadline(time.Now().Add(10 * time.Second))
	serverVer := make([]byte, 12)
	_, err = io.ReadFull(conn, serverVer)
	_ = conn.Close()
	if err != nil {
		v.SetConnected(false)
		v.EmitStateChange("failed", "failed to read RFB version handshake")
		return fmt.Errorf("read RFB handshake: %w", err)
	}

	v.SetConnected(true)
	v.EmitStateChange("connected", fmt.Sprintf("VNC server reachable at %s (%s)", addr, string(serverVer[:11])))

	banner := fmt.Sprintf("\r\n======================================================\r\n"+
		"  Virtual Network Computing (VNC) Active\r\n"+
		"  Target: %s:%d\r\n"+
		"  Server Protocol: %s"+
		"======================================================\r\n\r\n",
		p.Host, port, string(serverVer))
	v.EmitData([]byte(banner))

	// Launch native viewer (macOS Screen Sharing, or vncviewer on PATH).
	// "host::port" means a TCP port to TigerVNC/RealVNC; "host:N" would be display N.
	viewerTarget := fmt.Sprintf("%s::%d", p.Host, port)
	var viewerCmd *exec.Cmd
	if runtime.GOOS == "darwin" {
		vncURL := fmt.Sprintf("vnc://%s", addr)
		if p.Username != "" {
			vncURL = fmt.Sprintf("vnc://%s@%s", p.Username, addr)
		}
		viewerCmd = exec.Command("open", vncURL)
	} else if viewerPath, err := exec.LookPath("vncviewer"); err == nil {
		viewerCmd = exec.Command(viewerPath, viewerTarget)
	} else if viewerPath, err := exec.LookPath("vncviewer.exe"); err == nil {
		viewerCmd = exec.Command(viewerPath, viewerTarget)
	}

	if viewerCmd == nil {
		v.EmitData([]byte("No VNC viewer found on PATH. Install TigerVNC or RealVNC Viewer (vncviewer) and reconnect.\r\n"))
		return nil
	}
	if err := viewerCmd.Start(); err != nil {
		v.EmitData([]byte(fmt.Sprintf("Failed to launch VNC viewer: %v\r\n", err)))
		return nil
	}
	v.viewerCmd = viewerCmd
	v.EmitData([]byte("Native VNC viewer opened. Close the viewer window to end the session.\r\n"))

	// `open` on macOS returns immediately, so only track real viewer processes.
	if runtime.GOOS != "darwin" {
		go func() {
			_ = viewerCmd.Wait()
			v.SetConnected(false)
			v.EmitDisconnect("VNC viewer closed", nil)
			_ = v.Disconnect()
		}()
	}

	return nil
}

// Disconnect terminates the viewer process.
func (v *VNCSession) Disconnect() error {
	v.mu.Lock()
	defer v.mu.Unlock()

	v.closeOnce.Do(func() {
		v.SetConnected(false)
		if v.viewerCmd != nil && v.viewerCmd.Process != nil && runtime.GOOS != "darwin" {
			_ = v.viewerCmd.Process.Kill()
		}
		v.viewerCmd = nil
	})
	return nil
}

// Write is a no-op: input goes to the native viewer window.
func (v *VNCSession) Write(data []byte) error {
	return nil
}

// Resize handles display reconfiguration.
func (v *VNCSession) Resize(cols, rows int) error {
	return nil
}
