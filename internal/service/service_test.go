package service

import (
	"context"
	"nexterm/internal/model"
	"nexterm/internal/protocol"
	"nexterm/internal/security"
	"nexterm/internal/vault"
	"strings"
	"testing"
)

type testEmitter struct {
	events []string
}

func (t *testEmitter) Emit(event string, optionalData ...interface{}) {
	t.events = append(t.events, event)
}

func TestSessionServiceTree(t *testing.T) {
	svc := NewSessionService(nil)
	root, err := svc.LoadRoot()
	if err != nil {
		t.Fatalf("LoadRoot failed: %v", err)
	}
	if root == nil || root.Name != "All Sessions" {
		t.Fatalf("expected root All Sessions, got %+v", root)
	}

	// Add Folder
	root, err = svc.AddFolder("", "Production")
	if err != nil {
		t.Fatalf("AddFolder failed: %v", err)
	}
	if len(root.Children) != 1 || root.Children[0].Name != "Production" {
		t.Fatalf("expected 1 folder named Production, got %+v", root.Children)
	}

	folderID := root.Children[0].ID

	// Add Session
	root, err = svc.AddSession(folderID, model.SessionProfile{
		Name:     "Web 01",
		Host:     "10.0.0.1",
		Port:     22,
		Protocol: "ssh",
	})
	if err != nil {
		t.Fatalf("AddSession failed: %v", err)
	}

	folder := svc.FindNode(folderID)
	if folder == nil || len(folder.Children) != 1 {
		t.Fatalf("expected 1 session in folder, got %+v", folder)
	}

	sessNode := folder.Children[0]
	if sessNode.Name != "Web 01" {
		t.Fatalf("expected session Web 01, got %s", sessNode.Name)
	}

	// Rename Node
	root, err = svc.RenameNode(sessNode.ID, "Web 01 Renamed")
	if err != nil {
		t.Fatalf("RenameNode failed: %v", err)
	}
	renamedNode := svc.FindNode(sessNode.ID)
	if renamedNode.Name != "Web 01 Renamed" {
		t.Fatalf("expected Web 01 Renamed, got %s", renamedNode.Name)
	}

	// Export and Import
	jsonStr, err := svc.ExportSessions()
	if err != nil {
		t.Fatalf("ExportSessions failed: %v", err)
	}
	if len(jsonStr) == 0 {
		t.Fatalf("expected non-empty json export")
	}

	svc2 := NewSessionService(nil)
	_, err = svc2.ImportSessions(jsonStr)
	if err != nil {
		t.Fatalf("ImportSessions failed: %v", err)
	}
	if svc2.GetSessionTree().Name != "All Sessions" {
		t.Fatalf("imported root mismatch")
	}
}

func TestLoggingService(t *testing.T) {
	emitter := &testEmitter{}
	logger := NewLoggingService(emitter)

	logger.LogInfo("test", "hello world")
	logger.LogWarn("test", "a warning")
	logger.LogSessionEvent("tab-1", "connect", "connected to server")

	logs := logger.GetRecentLogs(10)
	if len(logs) != 3 {
		t.Fatalf("expected 3 log entries, got %d", len(logs))
	}
	if logs[0].Message != "hello world" {
		t.Fatalf("expected first log 'hello world', got '%s'", logs[0].Message)
	}
	if len(emitter.events) != 3 {
		t.Fatalf("expected 3 emitted events, got %d", len(emitter.events))
	}

	logger.ClearLogs()
	if len(logger.GetRecentLogs(10)) != 0 {
		t.Fatalf("expected 0 logs after clear")
	}
}

func TestSettingsService(t *testing.T) {
	secMgr := security.NewSecurityManager()
	svc := NewSettingsService(secMgr)

	ws := svc.GetWorkspace()
	if ws.Layout != "single" {
		t.Fatalf("expected initial single layout, got %s", ws.Layout)
	}

	ws, err := svc.SetWorkspaceLayout("split-v")
	if err != nil {
		t.Fatalf("SetWorkspaceLayout failed: %v", err)
	}
	if ws.Layout != "split-v" {
		t.Fatalf("expected split-v, got %s", ws.Layout)
	}
}

type mockMultiSession struct {
	*protocol.BaseSession
	written []byte
}

func newMockMultiSession(id string) *mockMultiSession {
	return &mockMultiSession{
		BaseSession: protocol.NewBaseSession(id, "ssh", model.SessionProfile{Name: id}),
	}
}

func (m *mockMultiSession) Connect(ctx context.Context) error { return nil }
func (m *mockMultiSession) Disconnect() error                 { return nil }
func (m *mockMultiSession) Resize(cols, rows int) error       { return nil }
func (m *mockMultiSession) Write(data []byte) error {
	m.written = append(m.written, data...)
	return nil
}

func TestConnectionManagerExecuteMulti(t *testing.T) {
	cm := NewConnectionManager(nil, nil, nil, nil)

	s1 := newMockMultiSession("billing-01")
	s2 := newMockMultiSession("billing-02")
	s3 := newMockMultiSession("billing-03")
	s4 := newMockMultiSession("billing-04")

	cm.RegisterSession("billing-01", s1)
	cm.RegisterSession("billing-02", s2)
	cm.RegisterSession("billing-03", s3)
	cm.RegisterSession("billing-04", s4)

	// Execute command across billing-01, billing-02, billing-03 (as in user spec)
	targets := []string{"billing-01", "billing-02", "billing-03"}
	cmd := "systemctl status billing\r"

	err := cm.ExecuteMulti(targets, cmd)
	if err != nil {
		t.Fatalf("ExecuteMulti failed: %v", err)
	}

	if string(s1.written) != cmd {
		t.Fatalf("expected s1 to receive %q, got %q", cmd, string(s1.written))
	}
	if string(s2.written) != cmd {
		t.Fatalf("expected s2 to receive %q, got %q", cmd, string(s2.written))
	}
	if string(s3.written) != cmd {
		t.Fatalf("expected s3 to receive %q, got %q", cmd, string(s3.written))
	}
	if len(s4.written) != 0 {
		t.Fatalf("expected s4 not to receive command, got %q", string(s4.written))
	}
}

func TestAuditLoggingAndExport(t *testing.T) {
	emitter := &testEmitter{}
	logger := NewLoggingService(emitter)

	// Clean any previous audit records for isolation
	_ = logger.ClearAuditLogs()

	logger.LogAudit("SSH_CONNECT", "ssh", "10.0.0.1", "root", "tab-1", "SUCCESS", "Connected successfully")
	logger.LogAudit("POLICY_DENIED", "telnet", "10.0.0.2", "admin", "tab-2", "DENIED", "Protocol disabled by policy")

	logs := logger.GetAuditLogs(10)
	if len(logs) < 2 {
		t.Fatalf("expected at least 2 audit log records, got %d", len(logs))
	}

	foundConnect := false
	foundDenied := false
	for _, l := range logs {
		if l.Action == "SSH_CONNECT" && l.Result == "SUCCESS" {
			foundConnect = true
		}
		if l.Action == "POLICY_DENIED" && l.Result == "DENIED" {
			foundDenied = true
		}
	}
	if !foundConnect || !foundDenied {
		t.Fatalf("expected both SSH_CONNECT and POLICY_DENIED in logs, foundConnect=%v, foundDenied=%v", foundConnect, foundDenied)
	}

	// Test CSV Export
	csvData, err := logger.ExportAuditCSV()
	if err != nil {
		t.Fatalf("ExportAuditCSV failed: %v", err)
	}
	if !strings.Contains(csvData, "Action,Protocol,Host,Username") {
		t.Fatalf("expected CSV header, got: %s", csvData)
	}
	if !strings.Contains(csvData, "SSH_CONNECT") || !strings.Contains(csvData, "POLICY_DENIED") {
		t.Fatalf("expected CSV to contain actions, got: %s", csvData)
	}

	// Test JSON Export
	jsonData, err := logger.ExportAuditJSON()
	if err != nil {
		t.Fatalf("ExportAuditJSON failed: %v", err)
	}
	if !strings.Contains(jsonData, "10.0.0.1") || !strings.Contains(jsonData, "10.0.0.2") {
		t.Fatalf("expected JSON to contain hosts, got: %s", jsonData)
	}

	// Test Clear
	if err := logger.ClearAuditLogs(); err != nil {
		t.Fatalf("ClearAuditLogs failed: %v", err)
	}
	if len(logger.GetAuditLogs(10)) != 0 {
		t.Fatalf("expected 0 audit records after ClearAuditLogs")
	}
}

func TestValidateAndNormalizeTree(t *testing.T) {
	svc := NewSessionService(nil)

	// 1. Valid tree with missing ID and invalid port/protocol -> normalized
	imported := &model.TreeNode{
		Name: "Imported Root",
		Children: []*model.TreeNode{
			{
				Name: "Out-of-range port session",
				Session: &model.SessionProfile{
					Name:     "Invalid Port",
					Host:     "192.168.1.100",
					Port:     999999,          // invalid port -> should normalize to 22
					Protocol: "CUSTOM_UNKNOWN", // invalid proto -> should normalize to "ssh"
				},
			},
		},
	}

	normalized, err := svc.ValidateAndNormalizeTree(imported)
	if err != nil {
		t.Fatalf("ValidateAndNormalizeTree failed on valid tree: %v", err)
	}
	if normalized.ID == "" {
		t.Fatalf("expected normalized node to have an ID")
	}
	if len(normalized.Children) != 1 {
		t.Fatalf("expected 1 child")
	}
	child := normalized.Children[0]
	if child.ID == "" {
		t.Fatalf("expected child to have an auto-generated UUID")
	}
	if child.Session.Port != 22 {
		t.Fatalf("expected port to be normalized to 22, got %d", child.Session.Port)
	}
	if child.Session.Protocol != "ssh" {
		t.Fatalf("expected protocol to be normalized to ssh, got %s", child.Session.Protocol)
	}

	// 2. Cyclic tree detection
	cyclicRoot := &model.TreeNode{
		ID:   "cycle-root",
		Name: "Cycle Root",
	}
	cyclicChild := &model.TreeNode{
		ID:       "cycle-child",
		Name:     "Cycle Child",
		Children: []*model.TreeNode{cyclicRoot}, // circular reference
	}
	cyclicRoot.Children = []*model.TreeNode{cyclicChild}

	_, err = svc.ValidateAndNormalizeTree(cyclicRoot)
	if err == nil {
		t.Fatalf("expected cyclic tree to be rejected, but got no error")
	}
	if !strings.Contains(err.Error(), "exceeds maximum supported hierarchy depth") && !strings.Contains(err.Error(), "cyclic reference") {
		t.Fatalf("expected cycle error, got: %v", err)
	}
}

func TestFindSessionPassword(t *testing.T) {
	vDir := t.TempDir()
	v, err := vault.NewVaultAt(vDir)
	if err != nil {
		t.Fatalf("failed to init test vault: %v", err)
	}
	credSvc := NewCredentialService(v)

	// Save credential under key "orig-key"
	_ = credSvc.SaveSessionPassword("orig-key", "secret123")

	// 1. Direct lookup
	pwd, err := credSvc.FindSessionPassword("orig-key", "", 0, "")
	if err != nil || pwd != "secret123" {
		t.Fatalf("expected secret123 from direct lookup, got %s (err: %v)", pwd, err)
	}

	// 2. Deterministic lookup
	_ = credSvc.SaveSessionPassword("session_pin_192.168.1.7_22", "det-secret")
	pwd, err = credSvc.FindSessionPassword("", "192.168.1.7", 22, "pin")
	if err != nil || pwd != "det-secret" {
		t.Fatalf("expected det-secret from deterministic lookup, got %s (err: %v)", pwd, err)
	}

	// 3. Cross-session tree lookup
	credSvc.SetTreeProvider(func() *model.TreeNode {
		return &model.TreeNode{
			ID:   "root",
			Name: "Root",
			Children: []*model.TreeNode{
				{
					ID:   "node-1",
					Name: "Old Server",
					Session: &model.SessionProfile{
						ID:       "sess-1",
						Host:     "10.0.0.50",
						Port:     22,
						Username: "admin",
						VaultKey: "orig-key",
					},
				},
			},
		}
	})

	// Lookup for new session pointing to same host/user with different or empty vaultKey
	pwd, err = credSvc.FindSessionPassword("new-key", "10.0.0.50", 22, "admin")
	if err != nil || pwd != "secret123" {
		t.Fatalf("expected secret123 from tree cross-session lookup, got %s (err: %v)", pwd, err)
	}

	// Verify it auto-cached under "new-key"
	cachedPwd, err := credSvc.GetSessionPassword("new-key")
	if err != nil || cachedPwd != "secret123" {
		t.Fatalf("expected secret123 auto-cached under new-key, got %s (err: %v)", cachedPwd, err)
	}

	// 4. Test Passphrase lookup with and without _passphrase suffix
	_ = credSvc.SaveSessionPassword("key1_passphrase", "passphrase-secret")
	pp1, err := credSvc.GetSessionPassphrase("key1")
	if err != nil || pp1 != "passphrase-secret" {
		t.Fatalf("expected passphrase-secret from key1, got %s (err: %v)", pp1, err)
	}
	pp2, err := credSvc.GetSessionPassphrase("key1_passphrase")
	if err != nil || pp2 != "passphrase-secret" {
		t.Fatalf("expected passphrase-secret from key1_passphrase, got %s (err: %v)", pp2, err)
	}
}

func TestBuildSSHConnectOptions_BastionCredentials(t *testing.T) {
	vDir := t.TempDir()
	v, err := vault.NewVaultAt(vDir)
	if err != nil {
		t.Fatalf("failed to init test vault: %v", err)
	}
	credSvc := NewCredentialService(v)
	_ = credSvc.SaveSessionPassword("vault_jump_key", "saved-jump-password")
	_ = credSvc.SaveSessionPassword("vault_jump_key_passphrase", "saved-jump-passphrase")

	cm := NewConnectionManager(credSvc, nil, nil, nil)

	// Case 1: Password jump host with explicit runtime jumpSecret (should override vault)
	profile1 := model.SessionProfile{
		Host:         "10.0.0.1",
		Port:         22,
		Username:     "targetuser",
		UseJumpHost:  true,
		JumpHost:     "jump.corp.com",
		JumpPort:     2222,
		JumpUsername: "jumpuser",
		JumpAuthType: "password",
		JumpVaultKey: "vault_jump_key",
	}

	opts1, err := cm.buildSSHConnectOptions("tab-1", profile1, "targetpw", "explicit-runtime-jump-pw")
	if err != nil {
		t.Fatalf("buildSSHConnectOptions failed: %v", err)
	}
	if !opts1.UseJumpHost {
		t.Errorf("expected UseJumpHost true")
	}
	if opts1.JumpPassword != "explicit-runtime-jump-pw" {
		t.Errorf("expected JumpPassword 'explicit-runtime-jump-pw', got '%s'", opts1.JumpPassword)
	}

	// Case 2: Password jump host with empty jumpSecret (should fall back to vault)
	opts2, err := cm.buildSSHConnectOptions("tab-2", profile1, "targetpw", "")
	if err != nil {
		t.Fatalf("buildSSHConnectOptions failed: %v", err)
	}
	if opts2.JumpPassword != "saved-jump-password" {
		t.Errorf("expected JumpPassword fallback 'saved-jump-password', got '%s'", opts2.JumpPassword)
	}

	// Case 3: Private key jump host with explicit runtime jumpSecret (passphrase)
	profileKey := model.SessionProfile{
		Host:         "10.0.0.1",
		Port:         22,
		Username:     "targetuser",
		UseJumpHost:  true,
		JumpHost:     "jump.corp.com",
		JumpPort:     22,
		JumpUsername: "jumpuser",
		JumpAuthType: "key",
		JumpVaultKey: "vault_jump_key",
	}

	opts3, err := cm.buildSSHConnectOptions("tab-3", profileKey, "targetpw", "runtime-passphrase")
	if err != nil {
		t.Fatalf("buildSSHConnectOptions failed: %v", err)
	}
	if opts3.JumpKeyPassphrase != "runtime-passphrase" {
		t.Errorf("expected JumpKeyPassphrase 'runtime-passphrase', got '%s'", opts3.JumpKeyPassphrase)
	}

	// Case 4: Private key jump host with empty jumpSecret (fallback to vault passphrase)
	opts4, err := cm.buildSSHConnectOptions("tab-4", profileKey, "targetpw", "")
	if err != nil {
		t.Fatalf("buildSSHConnectOptions failed: %v", err)
	}
	if opts4.JumpKeyPassphrase != "saved-jump-passphrase" {
		t.Errorf("expected JumpKeyPassphrase fallback 'saved-jump-passphrase', got '%s'", opts4.JumpKeyPassphrase)
	}
}

func TestCredentialService_FindSessionPasswordFallback(t *testing.T) {
	tempVaultDir := t.TempDir()
	v, err := vault.NewVaultAt(tempVaultDir)
	if err != nil {
		t.Fatalf("failed to create temp vault: %v", err)
	}
	credSvc := NewCredentialService(v)

	// Save password under a session UUID vault key
	sessionVaultKey := "test-sess-uuid-1234"
	if err := credSvc.SaveSessionPassword(sessionVaultKey, "secret123"); err != nil {
		t.Fatalf("SaveSessionPassword failed: %v", err)
	}

	// Mock tree with that session
	mockTree := &model.TreeNode{
		ID:   "root",
		Name: "Root",
		Children: []*model.TreeNode{
			{
				ID:   "node-1",
				Name: "Web Server",
				Session: &model.SessionProfile{
					ID:       "test-sess-uuid-1234",
					Name:     "Web Server",
					Host:     "192.168.1.100",
					Port:     22,
					Username: "ubuntu",
					VaultKey: sessionVaultKey,
				},
			},
		},
	}
	credSvc.SetTreeProvider(func() *model.TreeNode {
		return mockTree
	})

	// 1. Direct lookup by vaultKey
	p1, err := credSvc.FindSessionPassword(sessionVaultKey, "192.168.1.100", 22, "ubuntu")
	if err != nil || p1 != "secret123" {
		t.Errorf("expected 'secret123', got '%s', err: %v", p1, err)
	}

	// 2. Cross-session resolution without vaultKey (matching host & username)
	p2, err := credSvc.FindSessionPassword("", "192.168.1.100", 22, "ubuntu")
	if err != nil || p2 != "secret123" {
		t.Errorf("expected fallback 'secret123', got '%s', err: %v", p2, err)
	}

	// 3. Resolution using a new deterministic key (e.g. from Quick Connect)
	quickKey := "session_ubuntu_192_168_1_100_22"
	p3, err := credSvc.FindSessionPassword(quickKey, "192.168.1.100", 22, "ubuntu")
	if err != nil || p3 != "secret123" {
		t.Errorf("expected resolved 'secret123' for quickKey, got '%s', err: %v", p3, err)
	}

	// Verify quickKey was populated in vault
	p4, err := credSvc.GetSessionPassword(quickKey)
	if err != nil || p4 != "secret123" {
		t.Errorf("expected quickKey in vault 'secret123', got '%s', err: %v", p4, err)
	}
}

type mockResizeSession struct {
	protocol.BaseSession
	lastCols int
	lastRows int
}

func (m *mockResizeSession) Connect(ctx context.Context) error { return nil }
func (m *mockResizeSession) Disconnect() error                 { return nil }
func (m *mockResizeSession) Write(data []byte) error          { return nil }
func (m *mockResizeSession) Resize(cols, rows int) error {
	m.lastCols = cols
	m.lastRows = rows
	return nil
}

func TestConnectionManager_ResizePendingWhenConnecting(t *testing.T) {
	cm := NewConnectionManager(nil, nil, nil, nil)
	tabID := "test-tab-connecting"

	// 1. Unknown tab ID returns error
	if err := cm.Resize(tabID, 140, 40); err == nil {
		t.Fatal("expected error for non-connecting unknown tab ID, got nil")
	}

	// 2. Mark tab connecting
	cm.mu.Lock()
	cm.connecting[tabID] = true
	cm.mu.Unlock()

	// 3. Resize during connection buffers dimensions and returns nil
	if err := cm.Resize(tabID, 148, 42); err != nil {
		t.Fatalf("expected nil error while connecting, got: %v", err)
	}

	// 4. Emulate session connect completion
	mockSess := &mockResizeSession{}
	cm.mu.Lock()
	cm.sessions[tabID] = mockSess
	var pending [2]int
	hasPending := false
	if p, ok := cm.pendingSizes[tabID]; ok {
		pending = p
		hasPending = true
		delete(cm.pendingSizes, tabID)
	}
	delete(cm.connecting, tabID)
	cm.mu.Unlock()

	if hasPending {
		_ = mockSess.Resize(pending[0], pending[1])
	}

	if mockSess.lastCols != 148 || mockSess.lastRows != 42 {
		t.Fatalf("expected pending size 148x42 applied to session, got %dx%d", mockSess.lastCols, mockSess.lastRows)
	}
}


