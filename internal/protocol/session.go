package protocol

import (
	"context"
	"nexterm/internal/model"
	"nexterm/internal/sshsession"
	"strings"
	"sync"
)

// ProtocolSession defines the unified lifecycle contract for any remote or local session.
type ProtocolSession interface {
	// ID returns the unique session tab ID.
	ID() string

	// Protocol returns the protocol identifier ("ssh", "telnet", "serial", "rdp", "vnc", "local").
	Protocol() string

	// Profile returns the session profile configuration.
	Profile() model.SessionProfile

	// Connect initiates the connection to the remote endpoint.
	Connect(ctx context.Context) error

	// Disconnect closes the session connection and cleans up resources.
	Disconnect() error

	// IsConnected returns true if the session is currently active.
	IsConnected() bool

	// Write sends raw input bytes to the remote shell or terminal.
	Write(data []byte) error

	// Resize updates the terminal dimensions (cols, rows).
	Resize(cols, rows int) error

	// SetDataHandler registers a callback for incoming raw terminal data.
	SetDataHandler(handler func(data []byte))

	// SetDisconnectHandler registers a callback triggered when connection drops or is closed.
	SetDisconnectHandler(handler func(reason string, err error))

	// SetStateChangeHandler registers a callback for connection state transitions.
	SetStateChangeHandler(handler func(state string, message string))
}

// BaseSession provides a reusable implementation of common session state and callback routing.
type BaseSession struct {
	Mu                sync.RWMutex
	SessionID         string
	Proto             string
	SessionProfile    model.SessionProfile
	Connected         bool
	DataHandler       func(data []byte)
	DisconnectHandler func(reason string, err error)
	StateChangeHandle func(state string, message string)
}

func NewBaseSession(id, proto string, profile model.SessionProfile) *BaseSession {
	return &BaseSession{
		SessionID:      id,
		Proto:          proto,
		SessionProfile: profile,
	}
}

func (b *BaseSession) ID() string {
	return b.SessionID
}

func (b *BaseSession) Protocol() string {
	return b.Proto
}

func (b *BaseSession) Profile() model.SessionProfile {
	return b.SessionProfile
}

func (b *BaseSession) IsConnected() bool {
	b.Mu.RLock()
	defer b.Mu.RUnlock()
	return b.Connected
}

func (b *BaseSession) SetConnected(c bool) {
	b.Mu.Lock()
	b.Connected = c
	b.Mu.Unlock()
}

func (b *BaseSession) SetDataHandler(handler func(data []byte)) {
	b.Mu.Lock()
	b.DataHandler = handler
	b.Mu.Unlock()
}

func (b *BaseSession) SetDisconnectHandler(handler func(reason string, err error)) {
	b.Mu.Lock()
	b.DisconnectHandler = handler
	b.Mu.Unlock()
}

func (b *BaseSession) SetStateChangeHandler(handler func(state string, message string)) {
	b.Mu.Lock()
	b.StateChangeHandle = handler
	b.Mu.Unlock()
}

func (b *BaseSession) EmitData(data []byte) {
	b.Mu.RLock()
	h := b.DataHandler
	b.Mu.RUnlock()
	if h != nil {
		h(data)
	}
}

func (b *BaseSession) EmitDisconnect(reason string, err error) {
	b.Mu.RLock()
	h := b.DisconnectHandler
	b.Mu.RUnlock()
	if h != nil {
		h(reason, err)
	}
}

func (b *BaseSession) EmitStateChange(state, message string) {
	b.Mu.RLock()
	h := b.StateChangeHandle
	b.Mu.RUnlock()
	if h != nil {
		h(CanonicalState(state), message)
	}
}

// CanonicalState maps a protocol's state name onto the single vocabulary the UI
// understands (sshsession.ConnectionState: "Connecting", "Connected", "Failed",
// ...). RDP/VNC/Telnet/Serial historically reported lowercase names, which the
// UI never matched, so their tabs never showed the right state.
func CanonicalState(state string) string {
	switch strings.ToLower(strings.TrimSpace(state)) {
	case "disconnected":
		return string(sshsession.StateDisconnected)
	case "connecting":
		return string(sshsession.StateConnecting)
	case "authenticating":
		return string(sshsession.StateAuthenticating)
	case "connected":
		return string(sshsession.StateConnected)
	case "reconnecting":
		return string(sshsession.StateReconnecting)
	case "closing":
		return string(sshsession.StateClosing)
	case "closed":
		return string(sshsession.StateClosed)
	case "failed":
		return string(sshsession.StateFailed)
	}
	return state
}
