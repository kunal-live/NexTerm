package main

import (
	"fmt"
	"net"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"golang.org/x/crypto/ssh"
	"nexterm/internal/model"
	"nexterm/internal/nettools"
	"nexterm/internal/protocol"
)

// =========================================================================
// Session Tree Management
// =========================================================================

func (a *App) GetSessionTree() *model.TreeNode {
	return a.sessionService.GetSessionTree()
}

func (a *App) AddFolder(parentID, name string) (*model.TreeNode, error) {
	return a.sessionService.AddFolder(parentID, name)
}

func (a *App) AddFolderWithOptions(parentID, name, defaultUsername, environment, color string, defaultPort int) (*model.TreeNode, error) {
	return a.sessionService.AddFolderWithOptions(parentID, name, defaultUsername, environment, color, defaultPort)
}

func (a *App) ConfigureFolder(id, name, defaultUsername, environment, color string, defaultPort int) (*model.TreeNode, error) {
	return a.sessionService.ConfigureFolder(id, name, defaultUsername, environment, color, defaultPort)
}

func (a *App) RenameNode(id, newName string) (*model.TreeNode, error) {
	return a.sessionService.RenameNode(id, newName)
}

func (a *App) UpdateFolder(id, name string) (*model.TreeNode, error) {
	return a.sessionService.UpdateFolder(id, name)
}

func (a *App) ToggleFolder(id string, expanded bool) (*model.TreeNode, error) {
	return a.sessionService.ToggleFolder(id, expanded)
}

func (a *App) DeleteNode(id string) (*model.TreeNode, error) {
	return a.sessionService.DeleteNode(id)
}

func (a *App) AddSession(parentID string, profile model.SessionProfile) (*model.TreeNode, error) {
	return a.sessionService.AddSession(parentID, profile)
}

func (a *App) UpdateSession(profile model.SessionProfile) (*model.TreeNode, error) {
	return a.sessionService.UpdateSession(profile)
}

func (a *App) DuplicateSession(id string) (*model.TreeNode, error) {
	return a.sessionService.DuplicateSession(id)
}

func (a *App) DuplicateFolder(folderID string) (*model.TreeNode, error) {
	return a.sessionService.DuplicateFolder(folderID)
}

func (a *App) ExpandAllFolders(expanded bool) (*model.TreeNode, error) {
	return a.sessionService.ExpandAllFolders(expanded)
}

func (a *App) MoveNode(sourceID, targetParentID string, targetIndex int) (*model.TreeNode, error) {
	return a.sessionService.MoveNode(sourceID, targetParentID, targetIndex)
}

func (a *App) MoveSession(nodeID, targetFolderID string) (*model.TreeNode, error) {
	return a.sessionService.MoveSession(nodeID, targetFolderID)
}

func (a *App) ExportSessions() (string, error) {
	return a.sessionService.ExportSessions()
}

func (a *App) ImportSessions(jsonContent string) (*model.TreeNode, error) {
	return a.sessionService.ImportSessions(jsonContent)
}

// ExportSessionsToFile serializes all saved sessions/folders and writes them to
// a JSON file chosen via a native Save dialog with 0600 (owner-only) permissions.
func (a *App) ExportSessionsToFile() (string, error) {
	data, err := a.sessionService.ExportSessions()
	if err != nil {
		return "", err
	}
	suggested := fmt.Sprintf("nexterm_sessions_%s.json", time.Now().Format("20060102_150405"))
	savePath, err := a.sftpService.SelectDownloadDest(a.ctx, suggested)
	if err != nil || savePath == "" {
		return "", err
	}
	// The export lists hosts, users, key paths and jump-host details: owner-only (0600).
	if err := os.WriteFile(savePath, []byte(data), 0600); err != nil {
		return "", fmt.Errorf("failed to save sessions export: %w", err)
	}
	a.loggingService.LogAudit("SESSIONS_EXPORTED", "sessions", "", "", "", "SUCCESS", savePath)
	return savePath, nil
}

// ImportSessionsFromFile lets the user pick a JSON file via a native Open dialog
// and merges its sessions/folders into the current tree. Returns the new tree.
func (a *App) ImportSessionsFromFile() (*model.TreeNode, error) {
	path, err := a.sftpService.SelectUploadFile(a.ctx)
	if err != nil || path == "" {
		return a.sessionService.GetSessionTree(), err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("failed to read import file: %w", err)
	}
	newTree, err := a.sessionService.ImportSessions(string(data))
	if err != nil {
		return nil, err
	}
	a.loggingService.LogAudit("SESSIONS_IMPORTED", "sessions", "", "", "", "SUCCESS", path)
	return newTree, nil
}

// =========================================================================
// Session Connections & Lifecycle
// =========================================================================

func (a *App) OpenSession(profile model.SessionProfile, password string) (string, error) {
	tabID := uuid.NewString()
	err := a.OpenSessionWithTabID(tabID, profile, password)
	return tabID, err
}

func (a *App) OpenSessionWithTabID(tabID string, profile model.SessionProfile, password string) error {
	return a.OpenSessionWithTabIDAndJumpSecret(tabID, profile, password, "")
}

func (a *App) OpenSessionWithTabIDAndJumpSecret(tabID string, profile model.SessionProfile, password string, jumpSecret string) error {
	if tabID == "" {
		tabID = uuid.NewString()
	}

	proto := profile.Protocol
	if proto == "" {
		proto = "ssh"
	}

	// Security Policy Check (GAP-12)
	if err := a.settingsService.CheckProtocol(proto); err != nil {
		a.loggingService.LogAudit("POLICY_DENIED", proto, profile.Host, profile.Username, tabID, "DENIED", err.Error())
		return err
	}

	if err := a.connectionManager.OpenSession(a.ctx, tabID, profile, password, jumpSecret); err != nil {
		a.loggingService.LogAudit("AUTH_FAILED", proto, profile.Host, profile.Username, tabID, "FAILURE", err.Error())
		return err
	}

	a.loggingService.LogAudit("CONNECTED", proto, profile.Host, profile.Username, tabID, "SUCCESS", fmt.Sprintf("Connected to %s (%s)", profile.Name, profile.Host))

	if _, err := a.settingsService.AddTabToPane("", &model.TabSession{
		ID:          tabID,
		Title:       profile.Name,
		Profile:     profile,
		IsConnected: true,
		IsLocal:     false,
		CreatedAt:   time.Now().Format(time.RFC3339),
	}); err != nil && a.loggingService != nil {
		a.loggingService.LogDebug("App", fmt.Sprintf("AddTabToPane failed: %v", err))
	}

	return nil
}

func (a *App) QuickConnect(host string, port int, username, password, privateKeyPath string) (string, error) {
	tabID := uuid.NewString()
	name := fmt.Sprintf("%s@%s:%d", username, host, port)
	profile := model.SessionProfile{
		ID:             tabID,
		Name:           name,
		Host:           host,
		Port:           port,
		Username:       username,
		PrivateKeyPath: privateKeyPath,
		Protocol:       "ssh",
	}
	if privateKeyPath != "" {
		profile.AuthType = "key"
	} else if password != "" {
		profile.AuthType = "password"
	}
	err := a.OpenSessionWithTabID(tabID, profile, password)
	return tabID, err
}

func (a *App) OpenLocalTerminal(shell string) (string, error) {
	tabID, title, err := a.terminalService.OpenLocalTerminal(shell, 120, 30)
	if err != nil {
		return "", err
	}

	if _, err := a.settingsService.AddTabToPane("", &model.TabSession{
		ID:          tabID,
		Title:       title,
		Profile:     model.SessionProfile{Name: title, Protocol: "local"},
		IsConnected: true,
		IsLocal:     true,
		CreatedAt:   time.Now().Format(time.RFC3339),
	}); err != nil && a.loggingService != nil {
		a.loggingService.LogDebug("App", fmt.Sprintf("AddTabToPane local failed: %v", err))
	}

	return tabID, nil
}

func (a *App) CloseTab(tabID string) error {
	_ = a.terminalService.Close(tabID)
	_ = a.connectionManager.CloseSession(tabID)
	if _, err := a.settingsService.RemoveTab(tabID); err != nil && a.loggingService != nil {
		a.loggingService.LogDebug("App", fmt.Sprintf("RemoveTab failed: %v", err))
	}
	a.sftpService.CloseTab(tabID)
	// Stop session transcript log to close the file handle and avoid leaks.
	a.StopSessionLog(tabID)
	return nil
}

func (a *App) LaunchRDPSession(profile model.SessionProfile, password string) error {
	profile.Protocol = "rdp"
	return a.OpenSessionWithTabID(profile.ID, profile, password)
}

func (a *App) GetAvailableSerialPorts() []string {
	return protocol.ListSerialPorts()
}

func (a *App) RespondAuthChallenge(requestID string, answers []string) error {
	return a.connectionManager.RespondAuthChallenge(requestID, answers)
}

func (a *App) CancelAuthChallenge(requestID string) error {
	return a.connectionManager.CancelAuthChallenge(requestID)
}

type ConnectionTestResult struct {
	Success       bool   `json:"success"`
	Reachable     bool   `json:"reachable"`
	Authenticated bool   `json:"authenticated"`
	LatencyMs     int64  `json:"latencyMs"`
	Banner        string `json:"banner,omitempty"`
	Message       string `json:"message"`
	Error         string `json:"error,omitempty"`
}

func (a *App) TestSessionConnection(profile model.SessionProfile, password string) (ConnectionTestResult, error) {
	proto := strings.ToLower(profile.Protocol)
	if proto == "" {
		proto = "ssh"
	}

	if proto == "local" {
		return ConnectionTestResult{
			Success:   true,
			Reachable: true,
			Message:   "Local shell environment is available and ready.",
		}, nil
	}

	if proto == "serial" {
		if profile.SerialPort == "" {
			return ConnectionTestResult{
				Success: false,
				Message: "Serial port is empty. Please select a valid COM port.",
			}, nil
		}
		available := a.GetAvailableSerialPorts()
		found := false
		for _, p := range available {
			if strings.EqualFold(p, profile.SerialPort) {
				found = true
				break
			}
		}
		if found {
			return ConnectionTestResult{
				Success:   true,
				Reachable: true,
				Message:   fmt.Sprintf("Serial port %s is detected on this system.", profile.SerialPort),
			}, nil
		}
		return ConnectionTestResult{
			Success: false,
			Message: fmt.Sprintf("Serial port %s is not detected or currently in use.", profile.SerialPort),
		}, nil
	}

	if strings.TrimSpace(profile.Host) == "" {
		return ConnectionTestResult{
			Success: false,
			Message: "Remote Host / IP cannot be empty.",
		}, fmt.Errorf("remote host cannot be empty")
	}

	port := profile.Port
	if port <= 0 {
		switch proto {
		case "rdp":
			port = 3389
		case "vnc":
			port = 5900
		case "telnet":
			port = 23
		default:
			port = 22
		}
	}

	// 1. Probe TCP port reachability
	pingRes := nettools.PingTarget(profile.Host, port, 3500)
	if !pingRes.Online {
		errMsg := pingRes.Error
		if errMsg == "" {
			errMsg = "Connection timed out"
		}
		return ConnectionTestResult{
			Success:   false,
			Reachable: false,
			LatencyMs: -1,
			Message:   fmt.Sprintf("Cannot reach %s:%d (Port closed or %s).", profile.Host, port, errMsg),
			Error:     errMsg,
		}, nil
	}

	// Target port is reachable!
	if proto != "ssh" && proto != "sftp" {
		return ConnectionTestResult{
			Success:   true,
			Reachable: true,
			LatencyMs: pingRes.LatencyMs,
			Message:   fmt.Sprintf("Port %d is open on %s and reachable (%d ms latency)!", port, profile.Host, pingRes.LatencyMs),
		}, nil
	}

	// For SSH/SFTP: If no username is provided, verify port reachability
	if strings.TrimSpace(profile.Username) == "" {
		return ConnectionTestResult{
			Success:   true,
			Reachable: true,
			LatencyMs: pingRes.LatencyMs,
			Message:   fmt.Sprintf("SSH port %d on %s is open and responsive (%d ms latency)! Enter username to test credentials.", port, profile.Host, pingRes.LatencyMs),
		}, nil
	}

	// Username provided: test SSH authentication handshake
	if password == "" && a.credentialService != nil {
		vKey := profile.VaultKey
		if vKey == "" {
			vKey = profile.ID
		}
		if vKey != "" {
			if saved, err := a.credentialService.GetSessionPassword(vKey); err == nil && saved != "" {
				password = saved
			}
		}
	}

	var authMethods []ssh.AuthMethod
	if password != "" {
		authMethods = append(authMethods, ssh.Password(password), ssh.KeyboardInteractive(func(user, instruction string, questions []string, echos []bool) ([]string, error) {
			answers := make([]string, len(questions))
			for i := range questions {
				answers[i] = password
			}
			return answers, nil
		}))
	}

	if profile.PrivateKeyPath != "" {
		keyBytes, err := os.ReadFile(profile.PrivateKeyPath)
		if err == nil {
			var signer ssh.Signer
			if profile.KeyPassphrase != "" {
				signer, err = ssh.ParsePrivateKeyWithPassphrase(keyBytes, []byte(profile.KeyPassphrase))
			} else {
				signer, err = ssh.ParsePrivateKey(keyBytes)
			}
			if err == nil && signer != nil {
				authMethods = append(authMethods, ssh.PublicKeys(signer))
			}
		}
	}

	if len(authMethods) == 0 {
		return ConnectionTestResult{
			Success:   true,
			Reachable: true,
			LatencyMs: pingRes.LatencyMs,
			Message:   fmt.Sprintf("SSH port %d on %s is open (%d ms latency). No password or private key provided yet.", port, profile.Host, pingRes.LatencyMs),
		}, nil
	}

	clientConfig := &ssh.ClientConfig{
		User:              profile.Username,
		Auth:              authMethods,
		HostKeyCallback:   a.hostKeyService.BuildHostKeyCallback(),
		HostKeyAlgorithms: a.hostKeyService.GetAlgorithmsForHost(profile.Host, port),
		Timeout:           5 * time.Second,
	}

	targetAddr := net.JoinHostPort(profile.Host, strconv.Itoa(port))
	client, err := ssh.Dial("tcp", targetAddr, clientConfig)
	if err != nil {
		errStr := err.Error()
		low := strings.ToLower(errStr)
		if strings.Contains(low, "host key") {
			return ConnectionTestResult{
				Success:   false,
				Reachable: true,
				LatencyMs: pingRes.LatencyMs,
				Message:   fmt.Sprintf("Server reachable (%d ms), but its host key was not trusted, so no credentials were sent.", pingRes.LatencyMs),
				Error:     errStr,
			}, nil
		}
		if strings.Contains(low, "unable to authenticate") ||
			strings.Contains(low, "handshake failed") ||
			strings.Contains(low, "permission denied") {
			return ConnectionTestResult{
				Success:       false,
				Reachable:     true,
				Authenticated: false,
				LatencyMs:     pingRes.LatencyMs,
				Message:       fmt.Sprintf("Server reachable (%d ms), but authentication failed! Please verify username or password.", pingRes.LatencyMs),
				Error:         errStr,
			}, nil
		}
		return ConnectionTestResult{
			Success:       false,
			Reachable:     true,
			Authenticated: false,
			LatencyMs:     pingRes.LatencyMs,
			Message:       fmt.Sprintf("SSH handshake error on %s:%d: %v", profile.Host, port, err),
			Error:         errStr,
		}, nil
	}
	defer client.Close()

	serverVer := string(client.ServerVersion())
	return ConnectionTestResult{
		Success:       true,
		Reachable:     true,
		Authenticated: true,
		LatencyMs:     pingRes.LatencyMs,
		Banner:        serverVer,
		Message:       fmt.Sprintf("Connected & Authenticated to %s:%d! (%s, %d ms)", profile.Host, port, serverVer, pingRes.LatencyMs),
	}, nil
}
