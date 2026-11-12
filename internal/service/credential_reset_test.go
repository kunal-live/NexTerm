package service

import (
	"path/filepath"
	"strings"
	"testing"

	"nexterm/internal/vault"
)

func newResetTestService(t *testing.T) *CredentialService {
	t.Helper()
	v, err := vault.NewVaultAt(t.TempDir())
	if err != nil {
		t.Fatalf("failed to create vault: %v", err)
	}
	svc := NewCredentialService(v)
	svc.SetLockoutFilePath(filepath.Join(t.TempDir(), "lockout.json"))
	t.Cleanup(func() { _ = svc.ClearAll() })
	return svc
}

// "Forgot master password" must not hand back the saved credentials.
func TestResetMasterPasswordWipesCredentialsButKeepsAppLock(t *testing.T) {
	svc := newResetTestService(t)

	if err := svc.SaveSessionPassword("srv-1", "s3cret"); err != nil {
		t.Fatal(err)
	}
	if err := svc.SetMasterPassword("master-pass", "hint"); err != nil {
		t.Fatal(err)
	}
	if err := svc.SetAppPassword("app-pass", ""); err != nil {
		t.Fatal(err)
	}
	svc.Lock()

	if err := svc.ResetMasterPassword(); err != nil {
		t.Fatalf("reset failed: %v", err)
	}

	if ok, _ := svc.HasSavedPassword("srv-1"); ok {
		t.Error("saved credential survived a master password reset")
	}
	if has, _ := svc.HasMasterPassword(); has {
		t.Error("master password still set after reset")
	}
	if has, _ := svc.HasAppPassword(); !has {
		t.Error("reset must not remove the separate app lock")
	}
}

// Every path that checks a master password must feed the same lockout counter.
func TestPreviousPasswordGuessesAreRateLimited(t *testing.T) {
	svc := newResetTestService(t)

	if err := svc.SetMasterPassword("first-pass", ""); err != nil {
		t.Fatal(err)
	}
	if err := svc.ChangeMasterPassword("first-pass", "second-pass", ""); err != nil {
		t.Fatal(err)
	}

	var lockErr error
	for i := 0; i < 5; i++ {
		lockErr = svc.ResetMasterPasswordWithPrevious("wrong-guess", "new-pass", "")
		if lockErr == nil {
			t.Fatal("a wrong previous password must never succeed")
		}
	}
	if !strings.Contains(lockErr.Error(), "locked out") {
		t.Fatalf("5th failed guess should start a lockout, got: %v", lockErr)
	}

	// While locked out even the right previous password is refused.
	err := svc.ResetMasterPasswordWithPrevious("first-pass", "new-pass", "")
	if err == nil || !strings.Contains(err.Error(), "locked out") {
		t.Fatalf("expected lockout error, got: %v", err)
	}
	// ...and so are ChangeMasterPassword / RemoveMasterPassword guesses.
	if err := svc.RemoveMasterPassword("second-pass"); err == nil || !strings.Contains(err.Error(), "locked out") {
		t.Fatalf("RemoveMasterPassword must honour the lockout, got: %v", err)
	}
	if err := svc.ChangeMasterPassword("second-pass", "x-new-pass", ""); err == nil || !strings.Contains(err.Error(), "locked out") {
		t.Fatalf("ChangeMasterPassword must honour the lockout, got: %v", err)
	}
}
