package tunnel

import (
	"net"
	"path/filepath"
	"testing"
)

func newTestManager(t *testing.T) *TunnelManager {
	return &TunnelManager{
		tunnels:  map[string]TunnelConfig{},
		running:  map[string]*runningTunnel{},
		lastErr:  map[string]string{},
		filePath: filepath.Join(t.TempDir(), "tunnels.json"),
	}
}

func statusOf(tm *TunnelManager, id string) (string, string) {
	for _, t := range tm.GetTunnels() {
		if t.ID == id {
			return t.Status, t.ErrorMsg
		}
	}
	return "", ""
}

// Status is derived from running/lastErr only; it can't drift.
func TestTunnelStatusIsDerived(t *testing.T) {
	tm := newTestManager(t)
	if err := tm.SaveTunnel(TunnelConfig{ID: "t1", Name: "x", Type: TunnelLocal, LocalPort: 1}); err != nil {
		t.Fatal(err)
	}
	if s, _ := statusOf(tm, "t1"); s != "stopped" {
		t.Fatalf("new tunnel: want stopped, got %q", s)
	}

	tm.mu.Lock()
	tm.lastErr["t1"] = "bind failed"
	tm.mu.Unlock()
	if s, e := statusOf(tm, "t1"); s != "error" || e != "bind failed" {
		t.Fatalf("want error/bind failed, got %q/%q", s, e)
	}

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	tm.mu.Lock()
	tm.running["t1"] = &runningTunnel{listener: ln, stopChan: make(chan struct{})}
	delete(tm.lastErr, "t1")
	tm.mu.Unlock()
	if s, _ := statusOf(tm, "t1"); s != "running" {
		t.Fatalf("want running, got %q", s)
	}

	_ = tm.StopTunnel("t1")
	if s, e := statusOf(tm, "t1"); s != "stopped" || e != "" {
		t.Fatalf("after stop: want stopped, got %q/%q", s, e)
	}
}
