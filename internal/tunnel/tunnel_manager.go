package tunnel

import (
	"encoding/json"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"sync"
	"time"

	"golang.org/x/crypto/ssh"
)

type TunnelType string

const (
	TunnelLocal   TunnelType = "local"
	TunnelRemote  TunnelType = "remote"
	TunnelDynamic TunnelType = "dynamic"
)

type TunnelConfig struct {
	ID                string     `json:"id"`
	Name              string     `json:"name"`
	Type              TunnelType `json:"type"` // "local", "remote", "dynamic"
	SSHHost           string     `json:"sshHost"`
	SSHPort           int        `json:"sshPort"`
	SSHUsername       string     `json:"sshUsername"`
	SSHVaultKey       string     `json:"sshVaultKey,omitempty"`
	SSHPrivateKeyPath string     `json:"sshPrivateKeyPath,omitempty"`
	LocalPort         int        `json:"localPort"`
	RemoteHost        string     `json:"remoteHost,omitempty"`
	RemotePort        int        `json:"remotePort,omitempty"`
	AutoStart         bool       `json:"autoStart"`
	Status            string     `json:"status"` // "running", "stopped", "error"
	ErrorMsg          string     `json:"errorMsg,omitempty"`
}

type runningTunnel struct {
	config   TunnelConfig
	listener net.Listener
	stopChan chan struct{}
}

type TunnelManager struct {
	mu       sync.Mutex
	tunnels  map[string]TunnelConfig
	running  map[string]*runningTunnel
	filePath string
}

func NewTunnelManager() *TunnelManager {
	appData, err := os.UserConfigDir()
	if err != nil {
		appData = "."
	}
	dir := filepath.Join(appData, "Nexterm")
	_ = os.MkdirAll(dir, 0700)

	tm := &TunnelManager{
		tunnels:  make(map[string]TunnelConfig),
		running:  make(map[string]*runningTunnel),
		filePath: filepath.Join(dir, "tunnels.json"),
	}
	_ = tm.load()
	return tm
}

func (tm *TunnelManager) load() error {
	data, err := os.ReadFile(tm.filePath)
	if err != nil {
		return err
	}
	_ = os.Chmod(tm.filePath, 0600)
	var list []TunnelConfig
	if err := json.Unmarshal(data, &list); err != nil {
		return err
	}
	for _, t := range list {
		t.Status = "stopped"
		t.ErrorMsg = ""
		tm.tunnels[t.ID] = t
	}
	return nil
}

func (tm *TunnelManager) save() error {
	var list []TunnelConfig
	for _, t := range tm.tunnels {
		copyT := t
		if _, ok := tm.running[t.ID]; ok {
			copyT.Status = "running"
		} else {
			copyT.Status = "stopped"
		}
		list = append(list, copyT)
	}
	data, err := json.MarshalIndent(list, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(tm.filePath, data, 0600); err != nil {
		return err
	}
	_ = os.Chmod(tm.filePath, 0600)
	return nil
}

func (tm *TunnelManager) GetTunnels() []TunnelConfig {
	tm.mu.Lock()
	defer tm.mu.Unlock()

	var list []TunnelConfig
	for _, t := range tm.tunnels {
		if _, ok := tm.running[t.ID]; ok {
			t.Status = "running"
		} else if t.Status != "error" {
			t.Status = "stopped"
		}
		list = append(list, t)
	}
	return list
}

func (tm *TunnelManager) SaveTunnel(t TunnelConfig) error {
	tm.mu.Lock()
	defer tm.mu.Unlock()

	if t.ID == "" {
		t.ID = fmt.Sprintf("tun-%d", time.Now().UnixNano())
	}
	t.Status = "stopped"
	tm.tunnels[t.ID] = t
	return tm.save()
}

func (tm *TunnelManager) DeleteTunnel(id string) error {
	_ = tm.StopTunnel(id)

	tm.mu.Lock()
	defer tm.mu.Unlock()
	delete(tm.tunnels, id)
	return tm.save()
}

func (tm *TunnelManager) StartTunnel(id string, sshClient *ssh.Client) error {
	tm.mu.Lock()
	t, ok := tm.tunnels[id]
	if !ok {
		tm.mu.Unlock()
		return fmt.Errorf("tunnel not found: %s", id)
	}

	if _, already := tm.running[id]; already {
		tm.mu.Unlock()
		return nil // already running
	}

	if sshClient == nil {
		tm.mu.Unlock()
		return fmt.Errorf("SSH client is not connected")
	}

	var listener net.Listener
	var err error

	if t.Type == TunnelRemote {
		// Remote port forwarding: SSH server listens, forwards to local
		remoteAddr := fmt.Sprintf("0.0.0.0:%d", t.RemotePort)
		listener, err = sshClient.Listen("tcp", remoteAddr)
	} else {
		// Local or Dynamic SOCKS5: Local PC listens
		localAddr := fmt.Sprintf("127.0.0.1:%d", t.LocalPort)
		listener, err = net.Listen("tcp", localAddr)
	}

	if err != nil {
		t.Status = "error"
		t.ErrorMsg = err.Error()
		tm.tunnels[id] = t
		tm.mu.Unlock()
		return err
	}

	rt := &runningTunnel{
		config:   t,
		listener: listener,
		stopChan: make(chan struct{}),
	}
	tm.running[id] = rt
	t.Status = "running"
	t.ErrorMsg = ""
	tm.tunnels[id] = t
	tm.mu.Unlock()

	go tm.handleConnections(rt, sshClient)
	return nil
}

func (tm *TunnelManager) handleConnections(rt *runningTunnel, client *ssh.Client) {
	for {
		conn, err := rt.listener.Accept()
		if err != nil {
			select {
			case <-rt.stopChan:
				return
			default:
				return
			}
		}

		go func(c net.Conn) {
			defer c.Close()
			switch rt.config.Type {
			case TunnelRemote:
				// Forward to local target
				localTarget := fmt.Sprintf("127.0.0.1:%d", rt.config.LocalPort)
				target, err := net.Dial("tcp", localTarget)
				if err != nil {
					return
				}
				defer target.Close()
				pipe(c, target)
			case TunnelLocal:
				// Forward to remote target via SSH
				remoteTarget := fmt.Sprintf("%s:%d", rt.config.RemoteHost, rt.config.RemotePort)
				target, err := client.Dial("tcp", remoteTarget)
				if err != nil {
					return
				}
				defer target.Close()
				pipe(c, target)
			}
		}(conn)
	}
}

func pipe(c1, c2 net.Conn) {
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		_, _ = io.Copy(c1, c2)
	}()
	go func() {
		defer wg.Done()
		_, _ = io.Copy(c2, c1)
	}()
	wg.Wait()
}

func (tm *TunnelManager) StopTunnel(id string) error {
	tm.mu.Lock()
	defer tm.mu.Unlock()

	if rt, ok := tm.running[id]; ok {
		close(rt.stopChan)
		_ = rt.listener.Close()
		delete(tm.running, id)
	}

	if t, ok := tm.tunnels[id]; ok {
		t.Status = "stopped"
		t.ErrorMsg = ""
		tm.tunnels[id] = t
	}
	return nil
}

func (tm *TunnelManager) StopAll() {
	tm.mu.Lock()
	defer tm.mu.Unlock()

	for id, rt := range tm.running {
		close(rt.stopChan)
		_ = rt.listener.Close()
		delete(tm.running, id)
	}
}
