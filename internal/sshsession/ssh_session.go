package sshsession

import (
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"nexterm/internal/hostkey"

	"golang.org/x/crypto/ssh"
)

// Session wraps one live SSH connection + PTY. This is the "protocol
// adapter" — Telnet/RDP/VNC adapters later expose the same shape
// (Connect happens in the constructor, then Write/Resize/Close) so the frontend
// and App layer don't care which protocol is underneath.
type Session struct {
	client         *ssh.Client
	bastion        *ssh.Client // jump host connection, closed together with client
	sshSess        *ssh.Session
	stdin          io.WriteCloser
	closeOnce      sync.Once
	disconnectOnce sync.Once
	stopChan       chan struct{}

	OnData         func(data []byte)
	OnDisconnected func(reason string, classified ClassifiedError)
}

type ConnectOptions struct {
	OnData            func(data []byte)
	OnDisconnected    func(reason string, classified ClassifiedError)
	OnStateChange     func(state ConnectionState, message string)
	Host              string
	Port              int
	Username                  string
	AuthType                  AuthType // "password", "key", "agent", "keyboard-interactive", "auto"
	Password                  string   // empty if using a key
	PrivateKeyPath            string   // path to private key on disk
	PrivateKeyPEM             []byte   // raw private key data
	KeyPassphrase             string
	CertificatePath           string                               // path to OpenSSH certificate file
	CertificatePEM            []byte                               // raw certificate data
	UseAgent                  bool                                 // enable SSH Agent forwarding/auth
	AgentSocket               string                               // optional custom SSH_AUTH_SOCK path
	KeyboardInteractivePrompt KeyboardInteractiveChallengeHandler // callback for challenge-response (2FA/OTP/PAM)
	StartupCommand            string
	TerminalType              string
	KeepAliveInterval int // in seconds
	Cols              int
	Rows              int

	// Terminal & Startup
	WorkingDirectory string

	// X11 forwarding: when true, request X11 on the session and forward remote
	// GUI apps to the local X server on 127.0.0.1:(6000+X11Display).
	X11Forwarding bool
	X11Display    int

	// SSH Advanced
	ConnectionTimeout int // in seconds
	Compression       bool
	ProxyType         string
	ProxyHost         string
	ProxyPort         int
	ProxyUsername     string
	ProxyPassword     string

	// HostKeyCallback for verifying server identities against known_hosts.
	HostKeyCallback   ssh.HostKeyCallback
	HostKeyAlgorithms []string

	// Jump Host / Bastion Proxy Configuration
	UseJumpHost        bool
	JumpHost           string
	JumpPort           int
	JumpUsername       string
	JumpAuthType       AuthType
	JumpPassword       string
	JumpPrivateKeyPath string
	JumpPrivateKeyPEM  []byte
	JumpKeyPassphrase  string
}

func Connect(opts ConnectOptions) (*Session, error) {
	if opts.Port <= 0 {
		opts.Port = 22
	}
	if opts.TerminalType == "" {
		opts.TerminalType = "xterm-256color"
	}
	if opts.Cols <= 0 {
		opts.Cols = 80
	}
	if opts.Rows <= 0 {
		opts.Rows = 24
	}
	if opts.KeepAliveInterval <= 0 {
		opts.KeepAliveInterval = 15
	}

	if opts.OnStateChange != nil {
		opts.OnStateChange(StateConnecting, fmt.Sprintf("Connecting to %s:%d...", opts.Host, opts.Port))
	}

	authMethods, err := buildAuthMethods(opts)
	if err != nil {
		return nil, err
	}

	hkcb := opts.HostKeyCallback
	if hkcb == nil {
		mgr := hostkey.GetDefaultManager()
		hkcb = func(hostname string, remote net.Addr, key ssh.PublicKey) error {
			res, err := mgr.Check(hostname, remote, key)
			if err != nil {
				return err
			}
			if res.Status == hostkey.StatusTrusted {
				return nil
			}
			return fmt.Errorf("host key verification failed for %s: %s (fingerprint: %s)", hostname, res.Status, res.FingerprintSHA256)
		}
	}

	timeout := 15 * time.Second
	if opts.ConnectionTimeout > 0 {
		timeout = time.Duration(opts.ConnectionTimeout) * time.Second
	}

	config := &ssh.ClientConfig{
		User:            opts.Username,
		Auth:            authMethods,
		HostKeyCallback: hkcb,
		Timeout:         timeout,
	}

	if len(opts.HostKeyAlgorithms) > 0 {
		var keyAlgos []string
		seen := make(map[string]bool)
		for _, algo := range opts.HostKeyAlgorithms {
			if !seen[algo] && algo != "" {
				keyAlgos = append(keyAlgos, algo)
				seen[algo] = true
			}
		}
		defaultAlgos := []string{
			ssh.KeyAlgoED25519,
			ssh.KeyAlgoECDSA256,
			ssh.KeyAlgoECDSA384,
			ssh.KeyAlgoECDSA521,
			ssh.KeyAlgoRSASHA256,
			ssh.KeyAlgoRSASHA512,
			ssh.KeyAlgoRSA,
		}
		for _, algo := range defaultAlgos {
			if !seen[algo] {
				keyAlgos = append(keyAlgos, algo)
				seen[algo] = true
			}
		}
		config.HostKeyAlgorithms = keyAlgos
	}

	addr := net.JoinHostPort(opts.Host, strconv.Itoa(opts.Port))
	var conn net.Conn

	// The bastion connection must outlive the handshake (the target connection is
	// tunnelled through it) but be closed if anything below fails.
	var bastion *ssh.Client
	connected := false
	defer func() {
		if !connected && bastion != nil {
			_ = bastion.Close()
		}
	}()

	if opts.UseJumpHost && opts.JumpHost != "" {
		if opts.JumpPort <= 0 {
			opts.JumpPort = 22
		}
		jumpOpts := ConnectOptions{
			Host:           opts.JumpHost,
			Port:           opts.JumpPort,
			Username:       opts.JumpUsername,
			Password:       opts.JumpPassword,
			PrivateKeyPath: opts.JumpPrivateKeyPath,
			PrivateKeyPEM:  opts.JumpPrivateKeyPEM,
			KeyPassphrase:  opts.JumpKeyPassphrase,
			AuthType:       opts.JumpAuthType,
			UseAgent:       opts.UseAgent,
		}
		jumpAuth, jErr := buildAuthMethods(jumpOpts)
		if jErr != nil {
			return nil, fmt.Errorf("bastion auth failed: %w", jErr)
		}
		jumpConfig := &ssh.ClientConfig{
			User:            opts.JumpUsername,
			Auth:            jumpAuth,
			HostKeyCallback: hkcb,
			Timeout:         15 * time.Second,
		}
		jumpAddr := net.JoinHostPort(opts.JumpHost, strconv.Itoa(opts.JumpPort))
		bastionDirectConn, bErr := dialEndpoint(jumpAddr, opts, timeout)
		if bErr != nil {
			return nil, fmt.Errorf("bastion connection failed to %s: %w", jumpAddr, bErr)
		}
		bastionSSHConn, bastionChans, bastionReqs, bErr := ssh.NewClientConn(bastionDirectConn, jumpAddr, jumpConfig)
		if bErr != nil {
			_ = bastionDirectConn.Close()
			return nil, fmt.Errorf("bastion handshake failed: %w", bErr)
		}
		bastion = ssh.NewClient(bastionSSHConn, bastionChans, bastionReqs)

		// Tunnel through bastion to target
		proxiedConn, pErr := bastion.Dial("tcp", addr)
		if pErr != nil {
			return nil, fmt.Errorf("bastion failed to dial target %s: %w", addr, pErr)
		}
		conn = proxiedConn
	} else {
		directConn, dErr := dialEndpoint(addr, opts, timeout)
		if dErr != nil {
			return nil, fmt.Errorf("connection failed to %s: %w", addr, dErr)
		}
		conn = directConn
	}

	if opts.OnStateChange != nil {
		opts.OnStateChange(StateAuthenticating, fmt.Sprintf("Authenticating user '%s'...", opts.Username))
	}

	sshConn, chans, reqs, err := ssh.NewClientConn(conn, addr, config)
	if err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("ssh handshake failed: %w", err)
	}

	client := ssh.NewClient(sshConn, chans, reqs)
	sshSess, err := client.NewSession()
	if err != nil {
		_ = client.Close()
		return nil, fmt.Errorf("failed to create session: %w", err)
	}

	stdin, err := sshSess.StdinPipe()
	if err != nil {
		_ = sshSess.Close()
		_ = client.Close()
		return nil, fmt.Errorf("failed to open stdin pipe: %w", err)
	}

	stdout, err := sshSess.StdoutPipe()
	if err != nil {
		_ = sshSess.Close()
		_ = client.Close()
		return nil, fmt.Errorf("failed to open stdout pipe: %w", err)
	}

	stderr, err := sshSess.StderrPipe()
	if err != nil {
		_ = sshSess.Close()
		_ = client.Close()
		return nil, fmt.Errorf("failed to open stderr pipe: %w", err)
	}

	modes := ssh.TerminalModes{
		ssh.ECHO:          1,
		ssh.TTY_OP_ISPEED: 115200,
		ssh.TTY_OP_OSPEED: 115200,
	}

	if err := sshSess.RequestPty(opts.TerminalType, opts.Rows, opts.Cols, modes); err != nil {
		_ = sshSess.Close()
		_ = client.Close()
		return nil, fmt.Errorf("failed to request pty: %w", err)
	}

	// X11 forwarding (best-effort): request X11 before the shell starts and
	// forward incoming x11 channels to the local X server. A failure here must
	// not break the interactive session, so errors are non-fatal.
	if opts.X11Forwarding {
		_ = setupX11Forwarding(sshSess, client, opts.X11Display)
	}

	cdCommand := ""
	if dir := strings.TrimSpace(opts.WorkingDirectory); dir != "" {
		cdCommand = "cd " + shellQuote(dir)
	}

	if opts.StartupCommand != "" {
		cmd := opts.StartupCommand
		if cdCommand != "" {
			cmd = cdCommand + " && " + cmd
		}
		if err := sshSess.Start(cmd); err != nil {
			_ = sshSess.Close()
			_ = client.Close()
			return nil, fmt.Errorf("failed to start startup command: %w", err)
		}
	} else {
		if err := sshSess.Shell(); err != nil {
			_ = sshSess.Close()
			_ = client.Close()
			return nil, fmt.Errorf("failed to start shell: %w", err)
		}
	}

	// Setting PWD via env is ignored by most servers, so type the cd into the
	// freshly started interactive shell instead.
	if cdCommand != "" && opts.StartupCommand == "" {
		_, _ = stdin.Write([]byte(cdCommand + "\n"))
	}

	s := &Session{
		client:         client,
		bastion:        bastion,
		sshSess:        sshSess,
		stdin:          stdin,
		stopChan:       make(chan struct{}),
		OnData:         opts.OnData,
		OnDisconnected: opts.OnDisconnected,
	}
	connected = true

	go s.readLoop(stdout)
	go s.readLoop(stderr)

	if opts.OnStateChange != nil {
		opts.OnStateChange(StateConnected, fmt.Sprintf("Connected to %s:%d", opts.Host, opts.Port))
	}

	// Start keepalive heartbeat
	go s.keepAliveLoop(time.Duration(opts.KeepAliveInterval) * time.Second)

	return s, nil
}

func buildAuthMethods(opts ConnectOptions) ([]ssh.AuthMethod, error) {
	var methods []ssh.AuthMethod

	switch opts.AuthType {
	case AuthTypePassword:
		if opts.KeyboardInteractivePrompt != nil {
			// Route keyboard-interactive through the prompt handler so MFA/OTP
			// questions reach the user instead of being answered with the password.
			ki := &KeyboardInteractiveAuthProvider{Password: opts.Password, Prompt: opts.KeyboardInteractivePrompt}
			kiMethods, err := ki.BuildAuthMethods()
			if err != nil {
				return nil, err
			}
			return append([]ssh.AuthMethod{ssh.Password(opts.Password)}, kiMethods...), nil
		}
		p := &PasswordAuthProvider{Password: opts.Password}
		return p.BuildAuthMethods()

	case AuthTypePrivateKey:
		p := &PrivateKeyAuthProvider{
			KeyPath:         opts.PrivateKeyPath,
			KeyPEM:          opts.PrivateKeyPEM,
			KeyPassphrase:   opts.KeyPassphrase,
			CertificatePath: opts.CertificatePath,
			CertificatePEM:  opts.CertificatePEM,
		}
		m, err := p.BuildAuthMethods()
		if err != nil {
			return nil, err
		}
		methods = append(methods, m...)
		// Secondary dynamic challenge support for MFA servers
		if opts.KeyboardInteractivePrompt != nil {
			ki := &KeyboardInteractiveAuthProvider{Password: opts.Password, Prompt: opts.KeyboardInteractivePrompt}
			if km, err := ki.BuildAuthMethods(); err == nil {
				methods = append(methods, km...)
			}
		}
		return methods, nil

	case AuthTypeAgent:
		p := &SSHAgentAuthProvider{
			CustomSocket: opts.AgentSocket,
		}
		m, err := p.BuildAuthMethods()
		if err != nil {
			return nil, err
		}
		methods = append(methods, m...)
		// Secondary dynamic challenge support for MFA
		if opts.KeyboardInteractivePrompt != nil {
			ki := &KeyboardInteractiveAuthProvider{Password: opts.Password, Prompt: opts.KeyboardInteractivePrompt}
			if km, err := ki.BuildAuthMethods(); err == nil {
				methods = append(methods, km...)
			}
		}
		return methods, nil

	case AuthTypeKeyboardInteractive:
		p := &KeyboardInteractiveAuthProvider{
			Password: opts.Password,
			Prompt:   opts.KeyboardInteractivePrompt,
		}
		return p.BuildAuthMethods()

	case AuthTypeAuto, "":
		// Fallback priority chain:
		// 1. Private Key & Certificates
		if len(opts.PrivateKeyPEM) > 0 || opts.PrivateKeyPath != "" {
			p := &PrivateKeyAuthProvider{
				KeyPath:         opts.PrivateKeyPath,
				KeyPEM:          opts.PrivateKeyPEM,
				KeyPassphrase:   opts.KeyPassphrase,
				CertificatePath: opts.CertificatePath,
				CertificatePEM:  opts.CertificatePEM,
			}
			if m, err := p.BuildAuthMethods(); err == nil && len(m) > 0 {
				methods = append(methods, m...)
			}
		}

		// 2. SSH Agent
		if opts.UseAgent {
			agentProv := &SSHAgentAuthProvider{CustomSocket: opts.AgentSocket}
			if m, err := agentProv.BuildAuthMethods(); err == nil && len(m) > 0 {
				methods = append(methods, m...)
			}
		}

		// 3. Keyboard-Interactive Challenge
		if opts.KeyboardInteractivePrompt != nil {
			kiProv := &KeyboardInteractiveAuthProvider{
				Password: opts.Password,
				Prompt:   opts.KeyboardInteractivePrompt,
			}
			if m, err := kiProv.BuildAuthMethods(); err == nil && len(m) > 0 {
				methods = append(methods, m...)
			}
		}

		// 4. Password
		if opts.Password != "" {
			pwProv := &PasswordAuthProvider{Password: opts.Password}
			if m, err := pwProv.BuildAuthMethods(); err == nil && len(m) > 0 {
				methods = append(methods, m...)
			}
		}
	}

	if len(methods) == 0 {
		return nil, errors.New("no SSH authentication method available: please provide password, private key, or activate ssh-agent")
	}

	return methods, nil
}

func (s *Session) readLoop(reader io.Reader) {
	buf := make([]byte, 4096)
	for {
		n, err := reader.Read(buf)
		if n > 0 && s.OnData != nil {
			chunk := make([]byte, n)
			copy(chunk, buf[:n])
			s.OnData(chunk)
		}
		if err != nil {
			select {
			case <-s.stopChan:
				return
			default:
				// stdout and stderr both hit EOF when the channel closes;
				// report the disconnect only once.
				s.disconnectOnce.Do(func() {
					if s.OnDisconnected != nil {
						classified := ClassifyError(err)
						s.OnDisconnected(classified.Message, classified)
					}
				})
				s.Close()
				return
			}
		}
	}
}

func (s *Session) keepAliveLoop(interval time.Duration) {
	if interval <= 0 {
		interval = 15 * time.Second
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-s.stopChan:
			return
		case <-ticker.C:
			_, _, _ = s.client.SendRequest("keepalive@openssh.com", true, nil)
		}
	}
}

// Write sends raw bytes typed/pasted in the frontend terminal straight to
// the remote shell — no local line-editing, matching real terminal behavior.
func (s *Session) Write(data []byte) error {
	_, err := s.stdin.Write(data)
	return err
}

func (s *Session) Resize(cols, rows int) error {
	if s.sshSess == nil {
		return nil
	}
	return s.sshSess.WindowChange(rows, cols)
}

func (s *Session) Close() {
	s.closeOnce.Do(func() {
		close(s.stopChan)
		if s.stdin != nil {
			_ = s.stdin.Close()
		}
		if s.sshSess != nil {
			_ = s.sshSess.Close()
		}
		if s.client != nil {
			_ = s.client.Close()
		}
		if s.bastion != nil {
			_ = s.bastion.Close()
		}
	})
}

// shellQuote single-quotes s for a POSIX shell.
func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}

func (s *Session) Client() *ssh.Client {
	return s.client
}

// ReadPrivateKeyFile is a helper the App layer calls before Connect
// when the profile specifies a key file path instead of a password.
func ReadPrivateKeyFile(path string) ([]byte, error) {
	return os.ReadFile(path)
}

