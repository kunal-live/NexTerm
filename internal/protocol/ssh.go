package protocol

import (
	"context"
	"fmt"
	"nexterm/internal/model"
	"nexterm/internal/sshsession"
	"sync"

	"golang.org/x/crypto/ssh"
)

// SSHSession implements ProtocolSession for SSH connections.
type SSHSession struct {
	*BaseSession
	opts    sshsession.ConnectOptions
	session *sshsession.Session
	mu      sync.Mutex
}

// NewSSHSession constructs an SSHSession with the specified connection options.
func NewSSHSession(id string, profile model.SessionProfile, opts sshsession.ConnectOptions) *SSHSession {
	base := NewBaseSession(id, "ssh", profile)
	return &SSHSession{
		BaseSession: base,
		opts:        opts,
	}
}

// Connect establishes the SSH connection and launches the remote shell.
func (s *SSHSession) Connect(ctx context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Forward state change callbacks
	s.opts.OnStateChange = func(state sshsession.ConnectionState, message string) {
		s.EmitStateChange(string(state), message)
	}

	// Wire data and disconnect events before connecting: the read loops start
	// inside sshsession.Connect, so handlers assigned afterwards would race with
	// them and drop the login banner / first prompt.
	s.opts.OnData = func(data []byte) {
		s.EmitData(data)
	}
	s.opts.OnDisconnected = func(reason string, classified sshsession.ClassifiedError) {
		s.SetConnected(false)
		s.EmitDisconnect(reason, fmt.Errorf("[%s] %s: %s", classified.Category, classified.Message, classified.Description))
	}

	// Connect via sshsession engine
	sess, err := sshsession.Connect(s.opts)
	if err != nil {
		s.SetConnected(false)
		return err
	}

	s.session = sess
	s.SetConnected(true)

	return nil
}

// Disconnect closes the SSH session and connection.
func (s *SSHSession) Disconnect() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.SetConnected(false)
	if s.session != nil {
		s.session.Close()
		s.session = nil
	}
	return nil
}

// Write transmits raw keystrokes/data to the remote shell.
func (s *SSHSession) Write(data []byte) error {
	s.mu.Lock()
	sess := s.session
	s.mu.Unlock()

	if sess == nil {
		return fmt.Errorf("session is not connected")
	}
	return sess.Write(data)
}

// Resize informs the remote PTY of terminal window size changes.
func (s *SSHSession) Resize(cols, rows int) error {
	s.mu.Lock()
	sess := s.session
	s.mu.Unlock()

	if sess == nil {
		return nil
	}
	return sess.Resize(cols, rows)
}

// Client returns the underlying *ssh.Client for SFTP or port tunneling.
func (s *SSHSession) Client() *ssh.Client {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.session != nil {
		return s.session.Client()
	}
	return nil
}

// UnderlyingSession returns the raw sshsession.Session.
func (s *SSHSession) UnderlyingSession() *sshsession.Session {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.session
}
