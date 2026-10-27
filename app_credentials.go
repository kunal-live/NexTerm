package main

import (
	"fmt"

	"nexterm/internal/service"
	"nexterm/internal/sshsession"
	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// =========================================================================
// Credential Vault & Saved Passwords
// =========================================================================

func (a *App) GetSavedPasswords() ([]service.SavedCredential, error) {
	return a.credentialService.GetSavedPasswords(a.sessionService.GetSessionTree())
}

func (a *App) SaveSessionPassword(vaultKey, password string) error {
	if err := a.settingsService.CheckPasswordSaving(); err != nil {
		a.loggingService.LogAudit("POLICY_DENIED", "vault", "", "", vaultKey, "DENIED", err.Error())
		return err
	}
	err := a.credentialService.SaveSessionPassword(vaultKey, password)
	if err == nil {
		a.loggingService.LogAudit("PASSWORD_SAVED", "vault", "", "", vaultKey, "SUCCESS", "Credentials saved securely to platform vault")
	}
	return err
}

func (a *App) HasSavedPassword(vaultKey string) (bool, error) {
	return a.credentialService.HasSavedPassword(vaultKey)
}

func (a *App) DeleteSavedPassword(vaultKey string) error {
	err := a.credentialService.DeleteSavedPassword(vaultKey)
	if err == nil {
		a.loggingService.LogAudit("PASSWORD_DELETED", "vault", "", "", vaultKey, "SUCCESS", "Credentials purged from platform vault")
	}
	return err
}

func (a *App) GetSessionPassword(vaultKey string) (string, error) {
	return a.credentialService.GetSessionPassword(vaultKey)
}

func (a *App) GetSessionPassphrase(vaultKey string) (string, error) {
	return a.credentialService.GetSessionPassphrase(vaultKey)
}

func (a *App) FindSessionPassword(vaultKey, host string, port int, username string) (string, error) {
	return a.credentialService.FindSessionPassword(vaultKey, host, port, username)
}

// =========================================================================
// Key Pair & SSH Agent Operations
// =========================================================================

func (a *App) SelectPrivateKeyFile() (string, error) {
	return wailsruntime.OpenFileDialog(a.ctx, wailsruntime.OpenDialogOptions{
		Title: "Select SSH Private Key",
		Filters: []wailsruntime.FileFilter{
			{DisplayName: "SSH Private Keys (*.pem;*.id_*;id_*)", Pattern: "*.pem;*.key;id_*;*.id_*;*"},
			{DisplayName: "All Files (*.*)", Pattern: "*.*"},
		},
	})
}

func (a *App) ValidatePrivateKeyFile(path, passphrase string) (*sshsession.KeyInfo, error) {
	return sshsession.ValidatePrivateKey(path, passphrase)
}

func (a *App) CheckSSHAgent() (map[string]interface{}, error) {
	return a.credentialService.CheckSSHAgent()
}

func (a *App) GenerateSecurePassword(length int, includeSymbols bool) string {
	return service.GenerateSecurePassword(length, includeSymbols)
}

func (a *App) GenerateSSHKey(keyType, comment, passphrase, outName string) (*sshsession.GeneratedKey, error) {
	res, err := sshsession.GenerateKeyPair(keyType, comment, passphrase, outName)
	if err != nil {
		if a.loggingService != nil {
			a.loggingService.LogError("keygen", "SSH key generation failed", err)
		}
		return nil, err
	}
	if a.loggingService != nil {
		a.loggingService.LogInfo("keygen", fmt.Sprintf("Generated %s SSH key: %s (fingerprint: %s)", res.KeyType, res.PrivateKeyPath, res.Fingerprint))
	}
	return res, nil
}

// =========================================================================
// Master Password Management
// =========================================================================

func (a *App) HasMasterPassword() (bool, error) {
	return a.credentialService.HasMasterPassword()
}

func (a *App) SetMasterPassword(password, hint string) error {
	err := a.credentialService.SetMasterPassword(password, hint)
	if err == nil {
		a.loggingService.LogAudit("MASTER_PASSWORD_SET", "vault", "", "", "master", "SUCCESS", "Master password protection configured")
	}
	return err
}

func (a *App) VerifyMasterPassword(password string) (bool, error) {
	valid, err := a.credentialService.VerifyMasterPassword(password)
	if err == nil {
		status := "DENIED"
		if valid {
			status = "SUCCESS"
		}
		a.loggingService.LogAudit("MASTER_PASSWORD_VERIFY", "vault", "", "", "master", status, "Master password authentication attempt")
	}
	return valid, err
}

func (a *App) GetMasterPasswordHint() (string, error) {
	return a.credentialService.GetMasterPasswordHint()
}

func (a *App) RemoveMasterPassword(currentPassword string) error {
	err := a.credentialService.RemoveMasterPassword(currentPassword)
	if err == nil {
		a.loggingService.LogAudit("MASTER_PASSWORD_REMOVED", "vault", "", "", "master", "SUCCESS", "Master password protection disabled")
	}
	return err
}

func (a *App) ResetMasterPassword() error {
	err := a.credentialService.ResetMasterPassword()
	if err == nil {
		a.loggingService.LogAudit("MASTER_PASSWORD_RESET", "vault", "", "", "master", "SUCCESS", "Master password reset after forgotten password")
	}
	return err
}

func (a *App) ChangeMasterPassword(currentPassword, newPassword, newHint string) error {
	err := a.credentialService.ChangeMasterPassword(currentPassword, newPassword, newHint)
	if err == nil {
		a.loggingService.LogAudit("MASTER_PASSWORD_CHANGED", "vault", "", "", "master", "SUCCESS", "Master password updated")
	}
	return err
}

func (a *App) GetLockoutStatus() (*service.LockoutStatus, error) {
	return a.credentialService.GetLockoutStatus()
}

func (a *App) HasPreviousMasterPasswords() (bool, int, error) {
	return a.credentialService.HasPreviousMasterPasswords()
}

func (a *App) ResetMasterPasswordWithPrevious(previousPassword, newPassword, newHint string) error {
	err := a.credentialService.ResetMasterPasswordWithPrevious(previousPassword, newPassword, newHint)
	if err == nil {
		a.loggingService.LogAudit("MASTER_PASSWORD_RECOVERED", "vault", "", "", "master", "SUCCESS", "Master password reset via previous password verification")
	}
	return err
}

// =========================================================================
// Workstation App Lock Management
// =========================================================================

func (a *App) HasAppPassword() (bool, error) {
	return a.credentialService.HasAppPassword()
}

func (a *App) IsAppLockEnabled() (bool, error) {
	return a.credentialService.IsAppLockEnabled()
}

func (a *App) SetAppLockEnabled(enabled bool) error {
	err := a.credentialService.SetAppLockEnabled(enabled)
	if err == nil {
		action := "APP_LOCK_DISABLED"
		if enabled {
			action = "APP_LOCK_ENABLED"
		}
		a.loggingService.LogAudit(action, "applock", "", "", "user", "SUCCESS", fmt.Sprintf("App lock enabled set to %v", enabled))
	}
	return err
}

func (a *App) SetAppPassword(password, hint string) error {
	err := a.credentialService.SetAppPassword(password, hint)
	if err == nil {
		a.loggingService.LogAudit("APP_PASSWORD_SET", "applock", "", "", "user", "SUCCESS", "App lock password set")
	}
	return err
}

func (a *App) VerifyAppPassword(password string) (bool, error) {
	valid, err := a.credentialService.VerifyAppPassword(password)
	if err == nil {
		status := "DENIED"
		if valid {
			status = "SUCCESS"
		}
		a.loggingService.LogAudit("APP_PASSWORD_VERIFY", "applock", "", "", "user", status, "App password authentication attempt")
	}
	return valid, err
}

func (a *App) GetAppPasswordHint() (string, error) {
	return a.credentialService.GetAppPasswordHint()
}

func (a *App) ChangeAppPassword(currentPassword, newPassword, newHint string) error {
	err := a.credentialService.ChangeAppPassword(currentPassword, newPassword, newHint)
	if err == nil {
		a.loggingService.LogAudit("APP_PASSWORD_CHANGED", "applock", "", "", "user", "SUCCESS", "App password changed")
	}
	return err
}

func (a *App) RemoveAppPassword(currentPassword string) error {
	err := a.credentialService.RemoveAppPassword(currentPassword)
	if err == nil {
		a.loggingService.LogAudit("APP_PASSWORD_REMOVED", "applock", "", "", "user", "SUCCESS", "App password removed and app lock disabled")
	}
	return err
}

func (a *App) ResetAppPasswordWithPrevious(previousPassword, newPassword, newHint string) error {
	err := a.credentialService.ResetAppPasswordWithPrevious(previousPassword, newPassword, newHint)
	if err == nil {
		a.loggingService.LogAudit("APP_PASSWORD_RECOVERED", "applock", "", "", "user", "SUCCESS", "App password reset via previous password verification")
	}
	return err
}

func (a *App) GetAppLockoutStatus() (*service.LockoutStatus, error) {
	return a.credentialService.GetAppLockoutStatus()
}

// LockApp explicitly locks the backend credential store and application state.
func (a *App) LockApp() error {
	a.credentialService.Lock()
	if a.loggingService != nil {
		a.loggingService.LogAudit("APP_LOCKED", "applock", "", "", "user", "SUCCESS", "Application locked by user or auto-idle timer")
	}
	return nil
}

// IsAppLocked reports whether the credential vault and application are currently locked.
func (a *App) IsAppLocked() bool {
	return a.credentialService.IsLocked()
}
