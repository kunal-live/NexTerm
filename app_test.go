package main

import (
	"context"
	"nexterm/internal/model"
	"nexterm/internal/security"
	"nexterm/internal/service"
	"nexterm/internal/store"
	"nexterm/internal/vault"
	"path/filepath"
	"strings"
	"testing"
)

func createTestApp(t *testing.T) *App {
	t.Helper()
	app := NewApp()
	if app == nil {
		t.Fatalf("NewApp returned nil")
	}

	tempDir := t.TempDir()
	sessStore, err := store.NewSessionStoreAt(filepath.Join(tempDir, "sessions.json"))
	if err != nil {
		t.Fatalf("NewSessionStoreAt failed: %v", err)
	}
	app.sessionService = service.NewSessionService(sessStore)
	secMgr := security.NewSecurityManagerAt(filepath.Join(tempDir, "security_policy.json"))
	app.settingsService = service.NewSettingsService(secMgr)

	testVault, err := vault.NewVaultAt(filepath.Join(tempDir, "vault"))
	if err != nil {
		t.Fatalf("NewVaultAt failed: %v", err)
	}
	app.credentialService.SetVault(testVault)
	app.credentialService.SetLockoutFilePath(filepath.Join(tempDir, "lockout.json"))

	app.startup(context.Background())
	return app
}

func TestAppInitializationAndServices(t *testing.T) {
	app := createTestApp(t)

	if app.sessionService == nil {
		t.Fatalf("sessionService is nil")
	}
	if app.credentialService == nil {
		t.Fatalf("credentialService is nil")
	}
	if app.connectionManager == nil {
		t.Fatalf("connectionManager is nil")
	}
	if app.terminalService == nil {
		t.Fatalf("terminalService is nil")
	}
	if app.sftpService == nil {
		t.Fatalf("sftpService is nil")
	}
	if app.settingsService == nil {
		t.Fatalf("settingsService is nil")
	}
	if app.hostKeyService == nil {
		t.Fatalf("hostKeyService is nil")
	}
	if app.loggingService == nil {
		t.Fatalf("loggingService is nil")
	}

	// Workspace state via App facade
	ws := app.GetWorkspace()
	if ws.Layout != "single" {
		t.Fatalf("expected single layout, got %s", ws.Layout)
	}

	newWs, err := app.SetWorkspaceLayout("split-v")
	if err != nil {
		t.Fatalf("SetWorkspaceLayout failed: %v", err)
	}
	if newWs.Layout != "split-v" {
		t.Fatalf("expected split-v layout, got %s", newWs.Layout)
	}

	// Logging via App facade
	logs := app.GetRecentLogs(10)
	if len(logs) == 0 {
		t.Fatalf("expected log entries from session activity")
	}

	// Serial ports via App facade
	ports := app.GetAvailableSerialPorts()
	if len(ports) != 32 {
		t.Fatalf("expected 32 serial ports, got %d", len(ports))
	}
}

func TestAddFolder_AddsUnderRootWhenParentIDEmpty(t *testing.T) {
	app := createTestApp(t)

	newTree, err := app.AddFolder("", "Prod")
	if err != nil {
		t.Fatalf("AddFolder failed: %v", err)
	}

	var found bool
	for _, child := range newTree.Children {
		if child.Name == "Prod" && child.Session == nil {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected folder 'Prod' to be created under root")
	}
}

func TestAddFolder_AddsUnderSpecifiedParent(t *testing.T) {
	app := createTestApp(t)

	rootTree, err := app.AddFolder("", "Prod")
	if err != nil {
		t.Fatalf("AddFolder parent failed: %v", err)
	}

	var parentID string
	for _, child := range rootTree.Children {
		if child.Name == "Prod" {
			parentID = child.ID
			break
		}
	}
	if parentID == "" {
		t.Fatalf("could not find 'Prod' folder ID")
	}

	childTree, err := app.AddFolder(parentID, "Databases")
	if err != nil {
		t.Fatalf("AddFolder child failed: %v", err)
	}

	var foundChild bool
	for _, child := range childTree.Children {
		if child.ID == parentID {
			for _, sub := range child.Children {
				if sub.Name == "Databases" {
					foundChild = true
					break
				}
			}
		}
	}
	if !foundChild {
		t.Fatalf("expected folder 'Databases' nested under 'Prod'")
	}
}

func TestAddSession_AssignsIDAndVaultKey(t *testing.T) {
	app := createTestApp(t)

	profile := model.SessionProfile{
		Name:     "DB Master",
		Host:     "10.0.0.5",
		Port:     22,
		Username: "kunal",
		Protocol: "ssh",
	}

	newTree, err := app.AddSession("", profile)
	if err != nil {
		t.Fatalf("AddSession failed: %v", err)
	}

	var savedProfile *model.SessionProfile
	for _, child := range newTree.Children {
		if child.Session != nil && child.Session.Host == "10.0.0.5" {
			savedProfile = child.Session
			break
		}
	}

	if savedProfile == nil {
		t.Fatalf("expected session 'DB Master' to be found under root")
	}
	if savedProfile.ID == "" {
		t.Errorf("expected session ID to be populated, got empty")
	}
	if savedProfile.VaultKey == "" {
		t.Errorf("expected VaultKey to be populated, got empty")
	}
	if savedProfile.Username != "kunal" || savedProfile.Port != 22 {
		t.Errorf("expected username kunal and port 22, got %s:%d", savedProfile.Username, savedProfile.Port)
	}
}

func TestWriteToTerminal_UnknownTabID_ReturnsError(t *testing.T) {
	app := createTestApp(t)

	err := app.WriteToTerminal("unknown-tab-id-999", "echo hello\n")
	if err == nil {
		t.Fatalf("expected error when writing to unknown tab ID, got nil")
	}
}

func TestResizeTerminal_UnknownTabID_ReturnsError(t *testing.T) {
	app := createTestApp(t)

	err := app.ResizeTerminal("unknown-tab-id-999", 120, 40)
	if err == nil {
		t.Fatalf("expected error when resizing unknown tab ID, got nil")
	}
}

func TestCloseTab_UnknownTabID_IsANoOp(t *testing.T) {
	app := createTestApp(t)

	err := app.CloseTab("unknown-tab-id-999")
	if err != nil {
		t.Fatalf("expected CloseTab on unknown tab ID to be a safe no-op, got error: %v", err)
	}
}

func TestDeleteNode_RemovesServerOrFolder(t *testing.T) {
	app := createTestApp(t)

	tree, err := app.AddFolder("", "ToDelete")
	if err != nil {
		t.Fatalf("AddFolder failed: %v", err)
	}

	var nodeID string
	for _, child := range tree.Children {
		if child.Name == "ToDelete" {
			nodeID = child.ID
			break
		}
	}
	if nodeID == "" {
		t.Fatalf("node ToDelete not found")
	}

	newTree, err := app.DeleteNode(nodeID)
	if err != nil {
		t.Fatalf("DeleteNode failed: %v", err)
	}

	for _, child := range newTree.Children {
		if child.ID == nodeID {
			t.Fatalf("expected node %s to be deleted from tree", nodeID)
		}
	}
}

func TestExportSessions_ExcludesPlaintextPasswords(t *testing.T) {
	app := createTestApp(t)

	profile := model.SessionProfile{
		Name:     "Secret Server",
		Host:     "10.0.0.99",
		Port:     22,
		Username: "root",
		Protocol: "ssh",
	}
	_, err := app.AddSession("", profile)
	if err != nil {
		t.Fatalf("AddSession failed: %v", err)
	}

	exported, err := app.ExportSessions()
	if err != nil {
		t.Fatalf("ExportSessions failed: %v", err)
	}

	if strings.Contains(exported, "password") && strings.Contains(exported, "secret") {
		t.Errorf("exported session JSON may contain plaintext secrets")
	}
}

func TestBroadcastCommand_AppFacade(t *testing.T) {
	app := createTestApp(t)

	// Validation: Empty command
	_, err := app.BroadcastCommand([]string{"tab-1"}, "   ", "parallel")
	if err == nil {
		t.Fatalf("expected error for empty command")
	}

	// Execution against non-existent tab returns disconnected target
	res, err := app.BroadcastCommand([]string{"tab-none"}, "uptime", "parallel")
	if err != nil {
		t.Fatalf("BroadcastCommand returned error: %v", err)
	}
	if len(res.Targets) != 1 || res.Targets[0].Status != "disconnected" {
		t.Errorf("expected disconnected status, got %+v", res)
	}

	// CancelBroadcast
	err = app.CancelBroadcast("non-existent-request")
	if err == nil {
		t.Errorf("expected error when cancelling non-existent broadcast")
	}
}

func TestOpenSessionWithTabIDAndJumpSecret_PolicyGating(t *testing.T) {
	app := createTestApp(t)

	// Deny SSH in security policy
	policy := app.GetSecurityPolicy()
	policy.AllowSSH = false
	_ = app.SaveSecurityPolicy(policy)

	profile := model.SessionProfile{
		Host:         "10.0.0.1",
		Port:         22,
		Username:     "testuser",
		Protocol:     "ssh",
		UseJumpHost:  true,
		JumpHost:     "10.0.0.254",
		JumpPort:     22,
		JumpUsername: "bastion",
		JumpAuthType: "password",
	}

	err := app.OpenSessionWithTabIDAndJumpSecret("test-tab-bastion", profile, "password", "bastion-secret")
	if err == nil {
		t.Fatalf("expected error when SSH is disabled by security policy")
	}
	if !strings.Contains(err.Error(), "security policy denied") {
		t.Errorf("expected policy denial error, got: %v", err)
	}
}

func TestAppLockoutAndReset(t *testing.T) {
	app := createTestApp(t)

	// Isolate vault and lockout file in temporary folders
	tempVault, err := vault.NewVaultAt(filepath.Join(t.TempDir(), "vault"))
	if err != nil {
		t.Fatalf("failed to create temp vault: %v", err)
	}
	app.credentialService.SetVault(tempVault)

	tempLockoutFile := filepath.Join(t.TempDir(), "lockout.json")
	app.credentialService.SetLockoutFilePath(tempLockoutFile)

	// Check initial lockout status
	status, err := app.GetLockoutStatus()
	if err != nil {
		t.Fatalf("GetLockoutStatus failed: %v", err)
	}
	if status.IsLockedOut {
		t.Errorf("expected initially not locked out")
	}

	// Set master password
	pwd1 := "InitialPass#123"
	if err := app.SetMasterPassword(pwd1, "test hint"); err != nil {
		t.Fatalf("SetMasterPassword failed: %v", err)
	}

	// New user has no previous passwords
	hasHist, count, err := app.HasPreviousMasterPasswords()
	if err != nil || hasHist || count != 0 {
		t.Fatalf("expected new user to have no history, got has=%v, count=%d, err=%v", hasHist, count, err)
	}

	// Change password to create history
	pwd2 := "SecondPass#456"
	if err := app.ChangeMasterPassword(pwd1, pwd2, "second hint"); err != nil {
		t.Fatalf("ChangeMasterPassword failed: %v", err)
	}

	hasHist, count, _ = app.HasPreviousMasterPasswords()
	if !hasHist || count != 1 {
		t.Fatalf("expected 1 history item, got %d", count)
	}

	// Recovery with old password
	pwd3 := "ThirdPass#789"
	if err := app.ResetMasterPasswordWithPrevious(pwd1, pwd3, "third hint"); err != nil {
		t.Fatalf("ResetMasterPasswordWithPrevious failed: %v", err)
	}

	// Verify new password
	ok, err := app.VerifyMasterPassword(pwd3)
	if err != nil || !ok {
		t.Fatalf("expected verified password, got ok=%v, err=%v", ok, err)
	}

	// Reset all data
	if err := app.ResetAllData(); err != nil {
		t.Fatalf("ResetAllData failed: %v", err)
	}

	hasMaster, _ := app.HasMasterPassword()
	if hasMaster {
		t.Errorf("expected HasMasterPassword=false after ResetAllData")
	}
}


