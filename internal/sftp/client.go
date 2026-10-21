package sftpmanager

import (
	"fmt"
	"sync"

	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
)

// clientEntry pairs a cached SFTP client with the exact SSH connection it was
// built on. Tracking the SSH client lets us detect a reconnect (the tab keeps
// the same tabID but gets a brand-new *ssh.Client) and rebuild the SFTP session
// instead of handing back a stale one bound to a dead connection.
type clientEntry struct {
	sftp *sftp.Client
	ssh  *ssh.Client
}

// ClientManager handles caching and lifecycle of SFTP client sessions linked to SSH connections.
type ClientManager struct {
	mu      sync.Mutex
	clients map[string]*clientEntry
}

// NewClientManager initializes an empty ClientManager.
func NewClientManager() *ClientManager {
	return &ClientManager{
		clients: make(map[string]*clientEntry),
	}
}

// GetOrCreate returns a usable SFTP client for the given tabID.
//
// A cached client is reused only when it is still bound to the current SSH
// connection. If the tab has reconnected (a new *ssh.Client was passed in) the
// stale SFTP session is closed and a fresh one is created over the new
// connection. This is what makes the SFTP panel recover after a disconnect /
// reconnect instead of failing with "connection lost".
//
// SFTP sessions are tuned to MobaXterm-grade high-throughput specifications:
// - 32KB max packet payload (MaxPacketChecked: 32768)
// - Concurrent asynchronous writes (UseConcurrentWrites: true)
// - Concurrent asynchronous reads (UseConcurrentReads: true)
func (cm *ClientManager) GetOrCreate(tabID string, sshClient *ssh.Client) (*sftp.Client, error) {
	cm.mu.Lock()
	defer cm.mu.Unlock()

	if entry, ok := cm.clients[tabID]; ok && entry != nil && entry.sftp != nil {
		if entry.ssh == sshClient && sshClient != nil {
			// Same live connection - reuse the existing SFTP session.
			return entry.sftp, nil
		}
		// The underlying SSH connection changed (reconnect) or is gone.
		// Discard the stale SFTP client before building a new one.
		_ = entry.sftp.Close()
		delete(cm.clients, tabID)
	}

	if sshClient == nil {
		return nil, fmt.Errorf("underlying SSH client is disconnected")
	}

	// Initialize SFTP client with high-throughput options (MobaXterm parity)
	client, err := sftp.NewClient(
		sshClient,
		sftp.MaxPacketChecked(32768),
		sftp.UseConcurrentWrites(true),
		sftp.UseConcurrentReads(true),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create SFTP subsystem: %w", err)
	}

	cm.clients[tabID] = &clientEntry{sftp: client, ssh: sshClient}
	return client, nil
}

// Get retrieves an existing SFTP client for the given tabID if present.
func (cm *ClientManager) Get(tabID string) (*sftp.Client, bool) {
	cm.mu.Lock()
	defer cm.mu.Unlock()

	entry, ok := cm.clients[tabID]
	if !ok || entry == nil || entry.sftp == nil {
		return nil, false
	}
	return entry.sftp, true
}

// CloseTab terminates and removes the SFTP client associated with the given tabID.
func (cm *ClientManager) CloseTab(tabID string) {
	cm.mu.Lock()
	defer cm.mu.Unlock()

	if entry, ok := cm.clients[tabID]; ok && entry != nil {
		if entry.sftp != nil {
			_ = entry.sftp.Close()
		}
		delete(cm.clients, tabID)
	}
}

// CloseAll terminates all active SFTP sessions.
func (cm *ClientManager) CloseAll() {
	cm.mu.Lock()
	defer cm.mu.Unlock()

	for tabID, entry := range cm.clients {
		if entry != nil && entry.sftp != nil {
			_ = entry.sftp.Close()
		}
		delete(cm.clients, tabID)
	}
}
