package service

import (
	"context"
	"errors"
	"fmt"
	"nexterm/internal/model"
	"nexterm/internal/protocol"
	"nexterm/internal/sshsession"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"golang.org/x/crypto/ssh"
)

type authChallengeResponse struct {
	answers []string
	err     error
}

// ConnectionManager manages active ProtocolSession instances and connection lifecycle.
type ConnectionManager struct {
	mu                  sync.Mutex
	sessions            map[string]protocol.ProtocolSession
	credService         *CredentialService
	hostKeyService      *HostKeyService
	logService          *LoggingService
	emitter             EventEmitter
	pendingChallengesMu sync.Mutex
	pendingChallenges   map[string]chan authChallengeResponse
	pendingSizes        map[string][2]int
	connecting          map[string]bool
	onSessionClosed     func(tabID string)
	activeBroadcastsMu  sync.Mutex
	activeBroadcasts    map[string]context.CancelFunc
}

// NewConnectionManager constructs a new ConnectionManager.
func NewConnectionManager(credService *CredentialService, hostKeyService *HostKeyService, logService *LoggingService, emitter EventEmitter) *ConnectionManager {
	if emitter == nil {
		emitter = &NullEventEmitter{}
	}
	return &ConnectionManager{
		sessions:          make(map[string]protocol.ProtocolSession),
		pendingSizes:      make(map[string][2]int),
		connecting:        make(map[string]bool),
		credService:       credService,
		hostKeyService:    hostKeyService,
		logService:        logService,
		emitter:           emitter,
		pendingChallenges: make(map[string]chan authChallengeResponse),
		activeBroadcasts:  make(map[string]context.CancelFunc),
	}
}

// SetOnSessionClosed registers a hook to be notified when a tab session disconnects.
func (cm *ConnectionManager) SetOnSessionClosed(fn func(tabID string)) {
	cm.mu.Lock()
	cm.onSessionClosed = fn
	cm.mu.Unlock()
}

// OpenSession creates, configures, and connects a ProtocolSession based on the profile's protocol.
func (cm *ConnectionManager) OpenSession(ctx context.Context, tabID string, profile model.SessionProfile, password string, jumpSecret string) error {
	if tabID == "" {
		tabID = uuid.NewString()
	}

	// Gracefully close any existing session on the same tab ID if present
	cm.mu.Lock()
	if old, exists := cm.sessions[tabID]; exists && old != nil {
		_ = old.Disconnect()
		delete(cm.sessions, tabID)
	}
	if cm.connecting == nil {
		cm.connecting = make(map[string]bool)
	}
	cm.connecting[tabID] = true
	cm.mu.Unlock()

	defer func() {
		cm.mu.Lock()
		delete(cm.connecting, tabID)
		cm.mu.Unlock()
	}()

	proto := strings.ToLower(profile.Protocol)
	if proto == "" {
		proto = "ssh"
	}

	var session protocol.ProtocolSession

	switch proto {
	case "telnet":
		session = protocol.NewTelnetSession(tabID, profile)

	case "serial":
		session = protocol.NewSerialSession(tabID, profile)

	case "rdp":
		session = protocol.NewRDPSession(tabID, profile)

	case "vnc":
		session = protocol.NewVNCSession(tabID, profile)

	default: // "ssh", "sftp", etc.
		opts, err := cm.buildSSHConnectOptions(tabID, profile, password, jumpSecret)
		if err != nil {
			return err
		}
		session = protocol.NewSSHSession(tabID, profile, opts)
	}

	// Wire session event handlers to Wails events
	session.SetDataHandler(func(data []byte) {
		cm.emitter.Emit("terminal:data:"+tabID, string(data))
	})

	session.SetStateChangeHandler(func(state string, message string) {
		cm.emitter.Emit("terminal:state:"+tabID, map[string]interface{}{
			"state":   state,
			"message": message,
		})
	})

	session.SetDisconnectHandler(func(reason string, err error) {
		classified := sshsession.ClassifyError(err)
		cm.emitter.Emit("terminal:closed:"+tabID, map[string]interface{}{
			"reason":      reason,
			"category":    string(classified.Category),
			"description": classified.Description,
			"rawError":    classified.RawError,
		})
		cm.emitter.Emit("terminal:state:"+tabID, map[string]interface{}{
			"state":   string(sshsession.StateClosed),
			"message": reason,
			"error":   classified,
		})

		cm.mu.Lock()
		delete(cm.sessions, tabID)
		if cm.pendingSizes != nil {
			delete(cm.pendingSizes, tabID)
		}
		hook := cm.onSessionClosed
		cm.mu.Unlock()

		if cm.logService != nil {
			cm.logService.LogSessionEvent(tabID, "disconnected", reason)
		}

		if hook != nil {
			hook(tabID)
		}
	})

	if cm.logService != nil {
		cm.logService.LogSessionEvent(tabID, "connecting", fmt.Sprintf("[%s] %s@%s:%d", proto, profile.Username, profile.Host, profile.Port))
	}

	// Connect session
	if err := session.Connect(ctx); err != nil {
		classified := sshsession.ClassifyError(err)
		cm.emitter.Emit("terminal:state:"+tabID, map[string]interface{}{
			"state":   string(sshsession.StateFailed),
			"message": classified.Message,
			"error":   classified,
		})
		if cm.logService != nil {
			cm.logService.LogError("connection", fmt.Sprintf("[%s] connect failed", tabID), err)
		}
		return fmt.Errorf("[%s] %s: %s", classified.Category, classified.Message, classified.Description)
	}

	cm.mu.Lock()
	cm.sessions[tabID] = session
	var pending [2]int
	hasPending := false
	if cm.pendingSizes != nil {
		if p, ok := cm.pendingSizes[tabID]; ok {
			pending = p
			hasPending = true
			delete(cm.pendingSizes, tabID)
		}
	}
	cm.mu.Unlock()

	if hasPending && pending[0] > 0 && pending[1] > 0 {
		_ = session.Resize(pending[0], pending[1])
	}

	if cm.logService != nil {
		cm.logService.LogSessionEvent(tabID, "connected", fmt.Sprintf("[%s] session active", proto))
	}

	return nil
}

func (cm *ConnectionManager) buildSSHConnectOptions(tabID string, profile model.SessionProfile, password string, jumpSecret string) (sshsession.ConnectOptions, error) {
	opts := sshsession.ConnectOptions{
		Host:              profile.Host,
		Port:              profile.Port,
		Username:          profile.Username,
		AuthType:          sshsession.AuthType(profile.AuthType),
		UseAgent:          profile.UseAgent || profile.AuthType == "agent",
		CertificatePath:   profile.CertificatePath,
		StartupCommand:    profile.StartupCommand,
		TerminalType:      profile.TerminalType,
		KeepAliveInterval: profile.KeepAliveInterval,
		WorkingDirectory:  profile.WorkingDirectory,
		ConnectionTimeout: profile.ConnectionTimeout,
		Compression:       profile.Compression,
		X11Forwarding:     profile.X11Forwarding,
		ProxyType:         profile.ProxyType,
		ProxyHost:         profile.ProxyHost,
		ProxyPort:         profile.ProxyPort,
		ProxyUsername:     profile.ProxyUsername,
		ProxyPassword:     profile.ProxyPassword,
		Cols:              profile.Cols,
		Rows:              profile.Rows,
	}

	// 1. Password from direct argument or credential vault (check VaultKey and ID)
	vKey := profile.VaultKey
	if vKey == "" {
		vKey = profile.ID
	}
	if password != "" {
		opts.Password = password
	} else if cm.credService != nil {
		if vKey != "" {
			saved, err := cm.credService.GetSessionPassword(vKey)
			if err == nil && saved != "" {
				opts.Password = saved
			}
		}
		if opts.Password == "" && profile.Host != "" && profile.Username != "" {
			if fallback, err := cm.credService.FindSessionPassword(vKey, profile.Host, profile.Port, profile.Username); err == nil && fallback != "" {
				opts.Password = fallback
			}
		}
	}

	// 2. Private Key & Key Passphrase
	if profile.PrivateKeyPath != "" && (profile.AuthType == "" || profile.AuthType == "key" || profile.AuthType == "auto") {
		opts.PrivateKeyPath = profile.PrivateKeyPath
		opts.CertificatePath = profile.CertificatePath
		keyBytes, err := sshsession.ReadPrivateKeyFile(profile.PrivateKeyPath)
		if err != nil && profile.AuthType == "key" {
			return opts, fmt.Errorf("read private key: %w", err)
		}
		opts.PrivateKeyPEM = keyBytes

		pvKey := profile.PassphraseVaultKey
		if pvKey == "" && vKey != "" {
			pvKey = vKey + "_passphrase"
		}
		if pvKey != "" && cm.credService != nil {
			if savedPass, err := cm.credService.GetSessionPassword(pvKey); err == nil && savedPass != "" {
				opts.KeyPassphrase = savedPass
			} else if savedPass, err := cm.credService.GetSessionPassphrase(vKey); err == nil && savedPass != "" {
				opts.KeyPassphrase = savedPass
			}
		}
		if profile.KeyPassphrase != "" {
			opts.KeyPassphrase = profile.KeyPassphrase
		}
	}

	// 3. Dynamic Keyboard-Interactive challenge callback
	opts.KeyboardInteractivePrompt = cm.BuildAuthChallengeCallback(tabID, opts.Password)

	// Jump Host / Bastion Proxy configuration
	if profile.UseJumpHost && profile.JumpHost != "" {
		opts.UseJumpHost = true
		opts.JumpHost = profile.JumpHost
		opts.JumpPort = profile.JumpPort
		opts.JumpUsername = profile.JumpUsername
		opts.JumpAuthType = sshsession.AuthType(profile.JumpAuthType)
		if profile.JumpPrivateKeyPath != "" {
			opts.JumpPrivateKeyPath = profile.JumpPrivateKeyPath
			if jKeyBytes, err := sshsession.ReadPrivateKeyFile(profile.JumpPrivateKeyPath); err == nil {
				opts.JumpPrivateKeyPEM = jKeyBytes
			}
		}
		// Resolve the bastion secret with the same precedence the target-host
		// password already uses elsewhere in this function: an explicit,
		// per-connect value (typed just now or resolved by the frontend) wins;
		// otherwise fall back to whatever was persisted in the vault.
		if jumpSecret != "" {
			if opts.JumpAuthType == sshsession.AuthTypePrivateKey {
				opts.JumpKeyPassphrase = jumpSecret
			} else {
				opts.JumpPassword = jumpSecret
			}
		} else if profile.JumpVaultKey != "" && cm.credService != nil {
			if opts.JumpAuthType == sshsession.AuthTypePrivateKey {
				if jPass, err := cm.credService.GetSessionPassphrase(profile.JumpVaultKey + "_passphrase"); err == nil && jPass != "" {
					opts.JumpKeyPassphrase = jPass
				}
			} else if jPw, err := cm.credService.GetSessionPassword(profile.JumpVaultKey); err == nil && jPw != "" {
				opts.JumpPassword = jPw
			}
		}
	}

	// Host key callback & preferred algorithms based on known_hosts
	if cm.hostKeyService != nil {
		opts.HostKeyCallback = cm.hostKeyService.BuildHostKeyCallback()
		opts.HostKeyAlgorithms = cm.hostKeyService.GetAlgorithmsForHost(profile.Host, profile.Port)
	}

	return opts, nil
}

// BuildAuthChallengeCallback creates a prompt handler for 2FA/PAM authentication challenges.
func (cm *ConnectionManager) BuildAuthChallengeCallback(tabID string, defaultPassword string) sshsession.KeyboardInteractiveChallengeHandler {
	return func(user, instruction string, questions []string, echos []bool) ([]string, error) {
		if len(questions) == 0 {
			return []string{}, nil
		}

		allPassword := true
		for _, q := range questions {
			lower := strings.ToLower(q)
			if !strings.Contains(lower, "password") && !strings.Contains(lower, "passphrase") {
				allPassword = false
				break
			}
		}
		if allPassword && defaultPassword != "" {
			ans := make([]string, len(questions))
			for i := range questions {
				ans[i] = defaultPassword
			}
			return ans, nil
		}

		reqID := uuid.NewString()
		respChan := make(chan authChallengeResponse, 1)

		cm.pendingChallengesMu.Lock()
		cm.pendingChallenges[reqID] = respChan
		cm.pendingChallengesMu.Unlock()

		defer func() {
			cm.pendingChallengesMu.Lock()
			delete(cm.pendingChallenges, reqID)
			cm.pendingChallengesMu.Unlock()
		}()

		cm.emitter.Emit("ssh:auth:challenge_request", map[string]interface{}{
			"requestId":   reqID,
			"tabId":       tabID,
			"user":        user,
			"instruction": instruction,
			"questions":   questions,
			"echoes":      echos,
		})

		select {
		case res := <-respChan:
			if res.err != nil {
				return nil, res.err
			}
			return res.answers, nil
		case <-time.After(120 * time.Second):
			return nil, errors.New("keyboard-interactive challenge timed out after 120 seconds")
		}
	}
}

// RespondAuthChallenge delivers answers to a pending challenge.
func (cm *ConnectionManager) RespondAuthChallenge(requestID string, answers []string) error {
	cm.pendingChallengesMu.Lock()
	ch, ok := cm.pendingChallenges[requestID]
	cm.pendingChallengesMu.Unlock()

	if !ok || ch == nil {
		return fmt.Errorf("challenge request not found or expired: %s", requestID)
	}

	select {
	case ch <- authChallengeResponse{answers: answers}:
		return nil
	default:
		return fmt.Errorf("challenge request already answered")
	}
}

// CancelAuthChallenge cancels a pending authentication challenge.
func (cm *ConnectionManager) CancelAuthChallenge(requestID string) error {
	cm.pendingChallengesMu.Lock()
	ch, ok := cm.pendingChallenges[requestID]
	cm.pendingChallengesMu.Unlock()

	if !ok || ch == nil {
		return nil
	}

	select {
	case ch <- authChallengeResponse{err: errors.New("authentication cancelled by user")}:
		return nil
	default:
		return nil
	}
}

// Write sends raw bytes to the active session.
func (cm *ConnectionManager) Write(tabID string, data []byte) error {
	cm.mu.Lock()
	sess, ok := cm.sessions[tabID]
	cm.mu.Unlock()

	if !ok || sess == nil {
		return fmt.Errorf("session not found: %s", tabID)
	}
	return sess.Write(data)
}

// Resize updates the terminal dimensions of a session.
func (cm *ConnectionManager) Resize(tabID string, cols, rows int) error {
	cm.mu.Lock()
	sess, ok := cm.sessions[tabID]
	if ok && sess != nil {
		cm.mu.Unlock()
		return sess.Resize(cols, rows)
	}

	if cm.connecting != nil && cm.connecting[tabID] {
		if cm.pendingSizes == nil {
			cm.pendingSizes = make(map[string][2]int)
		}
		cm.pendingSizes[tabID] = [2]int{cols, rows}
		cm.mu.Unlock()
		return nil
	}
	cm.mu.Unlock()

	return fmt.Errorf("session not found: %s", tabID)
}

// CloseSession terminates an active session.
func (cm *ConnectionManager) CloseSession(tabID string) error {
	cm.mu.Lock()
	sess, ok := cm.sessions[tabID]
	if ok && sess != nil {
		delete(cm.sessions, tabID)
	}
	if cm.connecting != nil {
		delete(cm.connecting, tabID)
	}
	if cm.pendingSizes != nil {
		delete(cm.pendingSizes, tabID)
	}
	cm.mu.Unlock()

	if ok && sess != nil {
		return sess.Disconnect()
	}
	return nil
}

// GetSession retrieves a ProtocolSession by tabID.
func (cm *ConnectionManager) GetSession(tabID string) (protocol.ProtocolSession, bool) {
	cm.mu.Lock()
	defer cm.mu.Unlock()
	sess, ok := cm.sessions[tabID]
	return sess, ok
}

// GetSSHClient extracts the underlying *ssh.Client for SFTP or tunnels.
func (cm *ConnectionManager) GetSSHClient(tabID string) *ssh.Client {
	cm.mu.Lock()
	defer cm.mu.Unlock()

	sess, ok := cm.sessions[tabID]
	if !ok || sess == nil {
		return nil
	}

	if sshSess, ok := sess.(*protocol.SSHSession); ok {
		return sshSess.Client()
	}
	return nil
}

// BroadcastCommand sends data to all currently active sessions.
func (cm *ConnectionManager) BroadcastCommand(data string) error {
	cm.mu.Lock()
	targets := make([]protocol.ProtocolSession, 0, len(cm.sessions))
	for _, s := range cm.sessions {
		targets = append(targets, s)
	}
	cm.mu.Unlock()

	var lastErr error
	payload := []byte(data)
	for _, s := range targets {
		if err := s.Write(payload); err != nil {
			lastErr = err
		}
	}
	return lastErr
}

// ExecuteMulti dispatches command bytes specifically to a selected subset of active session tab IDs.
// This fulfills the ConnectionManager multi-execution architecture:
// Command -> ConnectionManager -> [Server 1, Server 2, Server 3, ...]
func (cm *ConnectionManager) ExecuteMulti(tabIDs []string, command string) error {
	cm.mu.Lock()
	targets := make([]protocol.ProtocolSession, 0, len(tabIDs))
	for _, id := range tabIDs {
		if s, ok := cm.sessions[id]; ok && s != nil {
			targets = append(targets, s)
		}
	}
	cm.mu.Unlock()

	var errs []string
	payload := []byte(command)
	for _, s := range targets {
		if err := s.Write(payload); err != nil {
			errs = append(errs, fmt.Sprintf("%s: %v", s.ID(), err))
		}
	}

	if len(errs) > 0 {
		return errors.New(strings.Join(errs, "; "))
	}
	return nil
}

// RegisterSession registers an active session directly into the session registry.
func (cm *ConnectionManager) RegisterSession(tabID string, s protocol.ProtocolSession) {
	cm.mu.Lock()
	cm.sessions[tabID] = s
	cm.mu.Unlock()
}

// ClassifyConnectionError parses errors using the sshsession classifier.
func (cm *ConnectionManager) ClassifyConnectionError(errString string) sshsession.ClassifiedError {
	return sshsession.ClassifyError(errors.New(errString))
}

// ActiveSessions returns a snapshot copy of all active sessions.
func (cm *ConnectionManager) ActiveSessions() map[string]protocol.ProtocolSession {
	cm.mu.Lock()
	defer cm.mu.Unlock()

	res := make(map[string]protocol.ProtocolSession, len(cm.sessions))
	for k, v := range cm.sessions {
		res[k] = v
	}
	return res
}

// BroadcastResult represents the final aggregate outcome of a broadcast command.
type BroadcastResult struct {
	RequestID string                  `json:"requestId"`
	Targets   []BroadcastTargetResult `json:"targets"`
}

// BroadcastTargetResult represents the outcome for one specific session target.
type BroadcastTargetResult struct {
	TabID  string `json:"tabId"`
	Name   string `json:"name"`
	Status string `json:"status"` // "completed", "failed", "cancelled", "timed_out", "disconnected"
	Error  string `json:"error,omitempty"`
}

// BroadcastEvent represents lifecycle and progress events emitted during broadcast execution.
type BroadcastEvent struct {
	RequestID string `json:"requestId"`
	TabID     string `json:"tabId,omitempty"`
	State     string `json:"state"` // "started", "running", "completed", "cancelled", "failed"
	Status    string `json:"status,omitempty"`
	Error     string `json:"error,omitempty"`
}

func redactSensitiveCommand(cmd string) string {
	sensitiveKeywords := []string{"password", "passwd", "token", "secret", "bearer", "api_key", "apikey"}
	lower := strings.ToLower(cmd)
	for _, kw := range sensitiveKeywords {
		if strings.Contains(lower, kw) {
			return "[REDACTED COMMAND CONTAINING POTENTIAL SECRET]"
		}
	}
	return cmd
}

// BroadcastCommandToTargets dispatches a command to a selected subset of active terminal sessions.
// Supports "parallel" (bounded to 20 concurrent goroutines) and "sequential" modes,
// with per-target status tracking, context timeout/cancellation, and audit logging.
func (cm *ConnectionManager) BroadcastCommandToTargets(
	ctx context.Context,
	reqID string,
	tabIDs []string,
	command string,
	mode string,
	targetNames map[string]string,
	fallbackResolver func(tabID string) (func([]byte) error, bool),
) (*BroadcastResult, error) {
	trimmedCmd := strings.TrimSpace(command)
	if trimmedCmd == "" {
		return nil, errors.New("command cannot be empty")
	}
	if len(tabIDs) == 0 {
		return nil, errors.New("no target sessions specified")
	}

	mode = strings.ToLower(strings.TrimSpace(mode))
	if mode == "" {
		mode = "parallel"
	}
	if mode != "parallel" && mode != "sequential" {
		return nil, fmt.Errorf("unsupported execution mode: %s", mode)
	}

	if reqID == "" {
		reqID = "bcast-" + uuid.NewString()[:8]
	}

	// Normalization: Ensure single execution terminator (e.g. \r)
	normCmd := strings.TrimRight(command, "\r\n") + "\r"
	payload := []byte(normCmd)

	bcastCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	cm.activeBroadcastsMu.Lock()
	cm.activeBroadcasts[reqID] = cancel
	cm.activeBroadcastsMu.Unlock()
	defer func() {
		cm.activeBroadcastsMu.Lock()
		delete(cm.activeBroadcasts, reqID)
		cm.activeBroadcastsMu.Unlock()
		cancel()
	}()

	cm.emitter.Emit("broadcast:state", BroadcastEvent{
		RequestID: reqID,
		State:     "started",
	})

	result := &BroadcastResult{
		RequestID: reqID,
		Targets:   make([]BroadcastTargetResult, len(tabIDs)),
	}

	resolveWriter := func(tabID string) (func([]byte) error, bool) {
		cm.mu.Lock()
		s, ok := cm.sessions[tabID]
		cm.mu.Unlock()
		if ok && s != nil {
			return s.Write, true
		}
		if fallbackResolver != nil {
			return fallbackResolver(tabID)
		}
		return nil, false
	}

	if mode == "sequential" {
		for i, tabID := range tabIDs {
			name := tabID
			if targetNames != nil {
				if n, ok := targetNames[tabID]; ok && n != "" {
					name = n
				}
			}

			select {
			case <-bcastCtx.Done():
				status := "cancelled"
				errStr := "broadcast cancelled"
				if errors.Is(bcastCtx.Err(), context.DeadlineExceeded) {
					status = "timed_out"
					errStr = "broadcast timed out"
				}
				result.Targets[i] = BroadcastTargetResult{
					TabID:  tabID,
					Name:   name,
					Status: status,
					Error:  errStr,
				}
				cm.emitter.Emit("broadcast:progress", map[string]interface{}{
					"requestId": reqID,
					"tabId":     tabID,
					"status":    status,
					"error":     errStr,
				})
				continue
			default:
			}

			writer, ok := resolveWriter(tabID)
			if !ok {
				result.Targets[i] = BroadcastTargetResult{
					TabID:  tabID,
					Name:   name,
					Status: "disconnected",
					Error:  "session not connected",
				}
				cm.emitter.Emit("broadcast:progress", map[string]interface{}{
					"requestId": reqID,
					"tabId":     tabID,
					"status":    "disconnected",
					"error":     "session not connected",
				})
				continue
			}

			cm.emitter.Emit("broadcast:progress", map[string]interface{}{
				"requestId": reqID,
				"tabId":     tabID,
				"status":    "sending",
			})

			err := writer(payload)
			if err != nil {
				result.Targets[i] = BroadcastTargetResult{
					TabID:  tabID,
					Name:   name,
					Status: "failed",
					Error:  err.Error(),
				}
				cm.emitter.Emit("broadcast:progress", map[string]interface{}{
					"requestId": reqID,
					"tabId":     tabID,
					"status":    "failed",
					"error":     err.Error(),
				})
			} else {
				result.Targets[i] = BroadcastTargetResult{
					TabID:  tabID,
					Name:   name,
					Status: "completed",
				}
				cm.emitter.Emit("broadcast:progress", map[string]interface{}{
					"requestId": reqID,
					"tabId":     tabID,
					"status":    "completed",
				})
			}
		}
	} else {
		// Parallel mode with bounded concurrency (max 20)
		sem := make(chan struct{}, 20)
		var wg sync.WaitGroup

		for i, tabID := range tabIDs {
			wg.Add(1)
			go func(idx int, id string) {
				defer wg.Done()

				name := id
				if targetNames != nil {
					if n, ok := targetNames[id]; ok && n != "" {
						name = n
					}
				}

				select {
				case <-bcastCtx.Done():
					status := "cancelled"
					errStr := "broadcast cancelled"
					if errors.Is(bcastCtx.Err(), context.DeadlineExceeded) {
						status = "timed_out"
						errStr = "broadcast timed out"
					}
					result.Targets[idx] = BroadcastTargetResult{
						TabID:  id,
						Name:   name,
						Status: status,
						Error:  errStr,
					}
					cm.emitter.Emit("broadcast:progress", map[string]interface{}{
						"requestId": reqID,
						"tabId":     id,
						"status":    status,
						"error":     errStr,
					})
					return
				default:
				}

				writer, ok := resolveWriter(id)
				if !ok {
					result.Targets[idx] = BroadcastTargetResult{
						TabID:  id,
						Name:   name,
						Status: "disconnected",
						Error:  "session not connected",
					}
					cm.emitter.Emit("broadcast:progress", map[string]interface{}{
						"requestId": reqID,
						"tabId":     id,
						"status":    "disconnected",
						"error":     "session not connected",
					})
					return
				}

				cm.emitter.Emit("broadcast:progress", map[string]interface{}{
					"requestId": reqID,
					"tabId":     id,
					"status":    "sending",
				})

				select {
				case sem <- struct{}{}:
				case <-bcastCtx.Done():
					result.Targets[idx] = BroadcastTargetResult{
						TabID:  id,
						Name:   name,
						Status: "cancelled",
						Error:  "broadcast cancelled before dispatch",
					}
					cm.emitter.Emit("broadcast:progress", map[string]interface{}{
						"requestId": reqID,
						"tabId":     id,
						"status":    "cancelled",
						"error":     "broadcast cancelled before dispatch",
					})
					return
				}

				err := writer(payload)
				<-sem

				if err != nil {
					result.Targets[idx] = BroadcastTargetResult{
						TabID:  id,
						Name:   name,
						Status: "failed",
						Error:  err.Error(),
					}
					cm.emitter.Emit("broadcast:progress", map[string]interface{}{
						"requestId": reqID,
						"tabId":     id,
						"status":    "failed",
						"error":     err.Error(),
					})
				} else {
					result.Targets[idx] = BroadcastTargetResult{
						TabID:  id,
						Name:   name,
						Status: "completed",
					}
					cm.emitter.Emit("broadcast:progress", map[string]interface{}{
						"requestId": reqID,
						"tabId":     id,
						"status":    "completed",
					})
				}
			}(i, tabID)
		}
		wg.Wait()
	}

	cm.emitter.Emit("broadcast:complete", result)

	if cm.logService != nil {
		completedCount := 0
		failedCount := 0
		for _, t := range result.Targets {
			if t.Status == "completed" {
				completedCount++
			} else {
				failedCount++
			}
		}
		redacted := redactSensitiveCommand(trimmedCmd)
		cm.logService.LogInfo("broadcast", fmt.Sprintf("Broadcast %s to %d targets (mode: %s, completed: %d, failed: %d, command: %s)",
			reqID, len(tabIDs), mode, completedCount, failedCount, redacted))
	}

	return result, nil
}

// CancelBroadcast stops an in-flight broadcast command by its request ID.
func (cm *ConnectionManager) CancelBroadcast(reqID string) error {
	cm.activeBroadcastsMu.Lock()
	cancel, ok := cm.activeBroadcasts[reqID]
	cm.activeBroadcastsMu.Unlock()
	if !ok {
		return fmt.Errorf("broadcast request not found or already finished: %s", reqID)
	}
	cancel()
	cm.emitter.Emit("broadcast:state", BroadcastEvent{
		RequestID: reqID,
		State:     "cancelled",
	})
	return nil
}
