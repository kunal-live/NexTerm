package service

import (
	"testing"

	"nexterm/internal/model"
)

// With a master password set, saved passwords must stay hidden from the UI
// (Password Manager / edit dialog) until it is entered — but connecting must
// still use them without asking.
func TestMasterLockHidesPasswordsButConnectStillUsesThem(t *testing.T) {
	svc := newResetTestService(t)
	if err := svc.SaveSessionPassword("srv-key", "server-secret"); err != nil {
		t.Fatal(err)
	}
	if err := svc.SaveSessionPassword("srv-key_passphrase", "key-pass"); err != nil {
		t.Fatal(err)
	}
	if err := svc.SetMasterPassword("master-pass", ""); err != nil {
		t.Fatal(err)
	}
	// Fresh session: simulate an app restart picking up the configured master password.
	svc.SetVault(svc.Vault())

	tree := &model.TreeNode{ID: "root", Children: []*model.TreeNode{
		{ID: "n1", Session: &model.SessionProfile{ID: "s1", Host: "10.0.0.5", Username: "admin", VaultKey: "srv-key"}},
	}}

	// UI reveal paths are refused.
	if _, err := svc.GetSessionPassword("srv-key"); err == nil {
		t.Error("GetSessionPassword must be refused before the master password is entered")
	}
	if _, err := svc.GetSessionPassphrase("srv-key"); err == nil {
		t.Error("GetSessionPassphrase must be refused before the master password is entered")
	}
	if _, err := svc.GetSavedPasswords(tree); err == nil {
		t.Error("Password Manager listing must be refused before the master password is entered")
	}
	if _, err := svc.FindSessionPassword("", "10.0.0.5", 22, "admin"); err == nil {
		t.Error("FindSessionPassword must be refused before the master password is entered")
	}

	// Connection paths still work, without any prompt.
	if got := svc.LoadSecretForConnection("srv-key"); got != "server-secret" {
		t.Errorf("connect must use the saved password while locked, got %q", got)
	}
	if got := svc.LoadPassphraseForConnection("srv-key"); got != "key-pass" {
		t.Errorf("connect must use the saved passphrase while locked, got %q", got)
	}
	if !svc.HasConnectCredential("srv-key", "10.0.0.5", 22, "admin") {
		t.Error("UI must be told a saved credential exists so it does not prompt")
	}

	// After the master password, the Password Manager can show them.
	if ok, err := svc.VerifyMasterPassword("master-pass"); err != nil || !ok {
		t.Fatalf("VerifyMasterPassword: ok=%v err=%v", ok, err)
	}
	list, err := svc.GetSavedPasswords(tree)
	if err != nil || len(list) != 1 || list[0].Password != "server-secret" {
		t.Fatalf("expected the saved password after unlock, got %v, %v", list, err)
	}
}

// The app password opens the app; it must not also unlock the Password Manager,
// which stays behind the master password.
func TestAppUnlockDoesNotRevealPasswordsWithoutMaster(t *testing.T) {
	svc := newResetTestService(t)
	if err := svc.SaveSessionPassword("srv-key", "server-secret"); err != nil {
		t.Fatal(err)
	}
	if err := svc.SetMasterPassword("master-pass", ""); err != nil {
		t.Fatal(err)
	}
	if err := svc.SetAppPassword("app-pass", ""); err != nil {
		t.Fatal(err)
	}

	svc.Lock() // lock screen shown
	if !svc.IsLocked() {
		t.Fatal("expected locked after Lock()")
	}
	if err := svc.SetAppLockEnabled(false); err == nil {
		t.Error("app lock must not be switchable off while the app is locked")
	}
	if ok, err := svc.VerifyAppPassword("app-pass"); err != nil || !ok {
		t.Fatalf("VerifyAppPassword: ok=%v err=%v", ok, err)
	}
	if _, err := svc.GetSessionPassword("srv-key"); err == nil {
		t.Error("app password alone must not reveal saved passwords when a master password is set")
	}
	if got := svc.LoadSecretForConnection("srv-key"); got != "server-secret" {
		t.Errorf("connecting must still work, got %q", got)
	}
}

// With no app password and no master password, nothing is locked.
func TestNoPasswordsMeansNothingLocked(t *testing.T) {
	svc := newResetTestService(t)
	if err := svc.SaveSessionPassword("srv-key", "server-secret"); err != nil {
		t.Fatal(err)
	}
	svc.SetVault(svc.Vault())
	if svc.IsLocked() {
		t.Error("nothing configured: must not report locked")
	}
	if got, err := svc.GetSessionPassword("srv-key"); err != nil || got != "server-secret" {
		t.Errorf("expected open access, got %q, %v", got, err)
	}
}
