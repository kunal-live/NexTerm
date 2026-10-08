package service

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"math/big"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"nexterm/internal/model"
	"nexterm/internal/sshsession"
	"nexterm/internal/vault"

	"golang.org/x/crypto/bcrypt"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// SavedCredential represents a decrypted credential item for the UI Password Manager.
type SavedCredential struct {
	SessionID   string `json:"sessionId"`
	SessionName string `json:"sessionName"`
	Host        string `json:"host"`
	Port        int    `json:"port"`
	Username    string `json:"username"`
	VaultKey    string `json:"vaultKey"`
	Password    string `json:"password"`
}

// LockoutStatus describes the current authentication and lockout state for master and app lock passwords.
type LockoutStatus struct {
	IsLockedOut       bool `json:"isLockedOut"`
	RemainingSeconds  int  `json:"remainingSeconds"`
	CurrentStage      int  `json:"currentStage"`
	FailedAttempts    int  `json:"failedAttempts"`
	MaxAttempts       int  `json:"maxAttempts"`
	AttemptsRemaining int  `json:"attemptsRemaining"`
	HasMasterPassword bool `json:"hasMasterPassword"`
	HasAppPassword    bool `json:"hasAppPassword"`
	IsAppLockEnabled  bool `json:"isAppLockEnabled"`
	HasHistory        bool `json:"hasHistory"`
	HistoryCount      int  `json:"historyCount"`
	IsFinalStage      bool `json:"isFinalStage"`
}

type persistedLockout struct {
	Stage                 int       `json:"stage"`
	FailedAttempts        int       `json:"failedAttempts"`
	LockoutUntil          time.Time `json:"lockoutUntil"`
	AppLockStage          int       `json:"appLockStage,omitempty"`
	AppLockFailedAttempts int       `json:"appLockFailedAttempts,omitempty"`
	AppLockLockoutUntil   time.Time `json:"appLockLockoutUntil,omitempty"`
}

// CredentialService encapsulates DPAPI / OS Keychain credentials, key inspection, and agent checks.
type CredentialService struct {
	mu              sync.RWMutex
	vault           *vault.Vault
	treeProvider    func() *model.TreeNode
	lockoutFilePath string

	// Master password lockout
	stage          int
	failedAttempts int
	lockoutUntil   time.Time

	// App lock password lockout
	appLockStage          int
	appLockFailedAttempts int
	appLockLockoutUntil   time.Time

	onSecurityWipe func() error
}

// NewCredentialService constructs a new CredentialService.
func NewCredentialService(v *vault.Vault) *CredentialService {
	cs := &CredentialService{
		vault:        v,
		stage:        1,
		appLockStage: 1,
	}
	cs.loadLockoutStateLocked()
	return cs
}

// Vault returns the underlying vault instance.
func (c *CredentialService) Vault() *vault.Vault {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.vault
}

// SetVault assigns or updates the active Vault.
func (c *CredentialService) SetVault(v *vault.Vault) {
	c.mu.Lock()
	c.vault = v
	c.mu.Unlock()
}

// SetTreeProvider configures a callback to fetch the live session tree for cross-referencing credentials.
func (c *CredentialService) SetTreeProvider(fn func() *model.TreeNode) {
	c.mu.Lock()
	c.treeProvider = fn
	c.mu.Unlock()
}

// SetLockoutFilePath overrides the storage path for lockout tracking (used for testing and custom storage).
func (c *CredentialService) SetLockoutFilePath(path string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.lockoutFilePath = path
	c.loadLockoutStateLocked()
}

// SetOnSecurityWipe registers a callback triggered when the 4th failed authentication stage is reached.
func (c *CredentialService) SetOnSecurityWipe(fn func() error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.onSecurityWipe = fn
}

func (c *CredentialService) getLockoutFilePathLocked() string {
	if c.lockoutFilePath != "" {
		return c.lockoutFilePath
	}
	appData, err := os.UserConfigDir()
	if err == nil {
		c.lockoutFilePath = filepath.Join(appData, "Nexterm", "lockout.json")
		return c.lockoutFilePath
	}
	return ""
}

func (c *CredentialService) loadLockoutStateLocked() {
	p := c.getLockoutFilePathLocked()
	if p == "" {
		if c.stage < 1 {
			c.stage = 1
		}
		return
	}
	data, err := os.ReadFile(p)
	if err != nil {
		if c.stage < 1 {
			c.stage = 1
		}
		return
	}
	var pl persistedLockout
	if err := json.Unmarshal(data, &pl); err == nil {
		c.stage = pl.Stage
		c.failedAttempts = pl.FailedAttempts
		c.lockoutUntil = pl.LockoutUntil
		if pl.AppLockStage > 0 {
			c.appLockStage = pl.AppLockStage
			c.appLockFailedAttempts = pl.AppLockFailedAttempts
			c.appLockLockoutUntil = pl.AppLockLockoutUntil
		}
	}
	if c.stage < 1 {
		c.stage = 1
	}
	if c.appLockStage < 1 {
		c.appLockStage = 1
	}
}

func (c *CredentialService) saveLockoutStateLocked() {
	p := c.getLockoutFilePathLocked()
	if p == "" {
		return
	}
	dir := filepath.Dir(p)
	_ = os.MkdirAll(dir, 0o700)
	pl := persistedLockout{
		Stage:                 c.stage,
		FailedAttempts:        c.failedAttempts,
		LockoutUntil:          c.lockoutUntil,
		AppLockStage:          c.appLockStage,
		AppLockFailedAttempts: c.appLockFailedAttempts,
		AppLockLockoutUntil:   c.appLockLockoutUntil,
	}
	data, err := json.Marshal(pl)
	if err == nil {
		_ = os.WriteFile(p, data, 0o600)
	}
}

func (c *CredentialService) resetLockoutLocked() {
	c.stage = 1
	c.failedAttempts = 0
	c.lockoutUntil = time.Time{}
	c.saveLockoutStateLocked()
}

func (c *CredentialService) resetAppLockoutLocked() {
	c.appLockStage = 1
	c.appLockFailedAttempts = 0
	c.appLockLockoutUntil = time.Time{}
	c.saveLockoutStateLocked()
}

func (c *CredentialService) clearAllLocked() error {
	if c.vault != nil {
		_ = c.vault.ClearAll()
		_ = c.vault.Delete(vaultMasterHashKey)
		_ = c.vault.Delete(vaultMasterHintKey)
		_ = c.vault.Delete(vaultMasterHistoryKey)
		_ = c.vault.Delete(vaultAppLockHashKey)
		_ = c.vault.Delete(vaultAppLockHintKey)
		_ = c.vault.Delete(vaultAppLockHistoryKey)
		_ = c.vault.Delete(vaultAppLockEnabledKey)
	}
	return nil
}

// ClearAll permanently wipes all stored passwords, master keys, app lock, history, and resets lockout state.
func (c *CredentialService) ClearAll() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	err := c.clearAllLocked()
	c.resetLockoutLocked()
	c.resetAppLockoutLocked()
	return err
}

// GetLockoutStatus evaluates and returns the current authentication stage and cooldown timer.
func (c *CredentialService) GetLockoutStatus() (*LockoutStatus, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	now := time.Now()
	isLockedOut := false
	remainingSeconds := 0

	if !c.lockoutUntil.IsZero() {
		if now.Before(c.lockoutUntil) {
			isLockedOut = true
			remainingSeconds = int(time.Until(c.lockoutUntil).Seconds()) + 1
		} else {
			c.lockoutUntil = time.Time{}
			c.saveLockoutStateLocked()
		}
	}

	if c.stage < 1 {
		c.stage = 1
	}

	maxAttempts := 5
	switch c.stage {
	case 1:
		maxAttempts = 5
	case 2:
		maxAttempts = 5
	case 3:
		maxAttempts = 3
	default:
		maxAttempts = 1
	}

	attemptsRemaining := maxAttempts - c.failedAttempts
	if attemptsRemaining < 0 {
		attemptsRemaining = 0
	}

	hasMaster := false
	hasHistory := false
	historyCount := 0
	hasAppPwd := false
	isAppLockEn := false

	if c.vault != nil {
		hash, ok, _ := c.vault.Load(vaultMasterHashKey)
		hasMaster = ok && hash != ""

		histData, hOk, _ := c.vault.Load(vaultMasterHistoryKey)
		if hOk && strings.TrimSpace(histData) != "" {
			var hist []string
			if err := json.Unmarshal([]byte(histData), &hist); err == nil {
				hasHistory = len(hist) > 0
				historyCount = len(hist)
			}
		}

		appHash, aOk, _ := c.vault.Load(vaultAppLockHashKey)
		hasAppPwd = aOk && appHash != ""

		enVal, eOk, _ := c.vault.Load(vaultAppLockEnabledKey)
		if eOk {
			isAppLockEn = enVal == "true"
		} else {
			isAppLockEn = hasAppPwd
		}
	}

	return &LockoutStatus{
		IsLockedOut:       isLockedOut,
		RemainingSeconds:  remainingSeconds,
		CurrentStage:      c.stage,
		FailedAttempts:    c.failedAttempts,
		MaxAttempts:       maxAttempts,
		AttemptsRemaining: attemptsRemaining,
		HasMasterPassword: hasMaster,
		HasAppPassword:    hasAppPwd,
		IsAppLockEnabled:  isAppLockEn,
		HasHistory:        hasHistory,
		HistoryCount:      historyCount,
		IsFinalStage:      c.stage >= 4,
	}, nil
}

// GetSavedPasswords returns all stored credentials decrypted for Password Management.
func (c *CredentialService) GetSavedPasswords(root *model.TreeNode) ([]SavedCredential, error) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	var list []SavedCredential
	if c.vault == nil || root == nil {
		return list, nil
	}

	var collect func(n *model.TreeNode)
	collect = func(n *model.TreeNode) {
		if n == nil {
			return
		}
		if n.Session != nil && n.Session.VaultKey != "" {
			pwd, ok, err := c.vault.Load(n.Session.VaultKey)
			if err == nil && ok && pwd != "" {
				list = append(list, SavedCredential{
					SessionID:   n.Session.ID,
					SessionName: n.Session.Name,
					Host:        n.Session.Host,
					Port:        n.Session.Port,
					Username:    n.Session.Username,
					VaultKey:    n.Session.VaultKey,
					Password:    pwd,
				})
			}
		}
		for _, ch := range n.Children {
			collect(ch)
		}
	}
	collect(root)
	return list, nil
}

// SaveSessionPassword stores a password encrypted in the DPAPI vault.
func (c *CredentialService) SaveSessionPassword(vaultKey, password string) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.vault == nil {
		return fmt.Errorf("vault is not initialized")
	}
	return c.vault.Save(vaultKey, password)
}

// HasSavedPassword returns true if a password is encrypted in the vault.
func (c *CredentialService) HasSavedPassword(vaultKey string) (bool, error) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	if c.vault == nil || vaultKey == "" {
		return false, nil
	}
	_, ok, err := c.vault.Load(vaultKey)
	return ok, err
}

// DeleteSavedPassword removes a stored password from the DPAPI vault.
func (c *CredentialService) DeleteSavedPassword(vaultKey string) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.vault == nil || vaultKey == "" {
		return nil
	}
	return c.vault.Delete(vaultKey)
}

// GetSessionPassword retrieves a stored password from the DPAPI vault for editing.
func (c *CredentialService) GetSessionPassword(vaultKey string) (string, error) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	if c.vault == nil || vaultKey == "" {
		return "", nil
	}
	pwd, ok, err := c.vault.Load(vaultKey)
	if err != nil || !ok {
		return "", nil
	}
	return pwd, nil
}

// GetSessionPassphrase retrieves a stored key passphrase from the vault for editing.
func (c *CredentialService) GetSessionPassphrase(vaultKey string) (string, error) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	if c.vault == nil || vaultKey == "" {
		return "", nil
	}
	key := vaultKey
	if !strings.HasSuffix(key, "_passphrase") {
		key = key + "_passphrase"
	}
	pass, ok, err := c.vault.Load(key)
	if err != nil || !ok || pass == "" {
		pass, ok, err = c.vault.Load(vaultKey)
		if err != nil || !ok {
			return "", nil
		}
	}
	return pass, nil
}

// FindSessionPassword searches for a stored password by vaultKey, or falls back to
// host, port, and username matching across saved sessions and deterministic vault keys.
func (c *CredentialService) FindSessionPassword(vaultKey, host string, port int, username string) (string, error) {
	c.mu.RLock()
	treeFn := c.treeProvider
	c.mu.RUnlock()

	// 1. Direct VaultKey lookup
	if vaultKey != "" {
		if pwd, err := c.GetSessionPassword(vaultKey); err == nil && pwd != "" {
			return pwd, nil
		}
	}

	// 2. Deterministic key lookup based on server coordinates (check both dot and underscore formats)
	if host != "" && username != "" {
		p := port
		if p <= 0 {
			p = 22
		}
		cleanUser := sanitizeVaultKey(username)
		cleanHost := sanitizeVaultKey(host)
		underHost := strings.ReplaceAll(cleanHost, ".", "_")

		detKeys := []string{
			fmt.Sprintf("session_%s_%s_%d", cleanUser, cleanHost, p),
			fmt.Sprintf("session_%s_%s_%d", cleanUser, underHost, p),
			fmt.Sprintf("session_%s_%s", cleanUser, cleanHost),
			fmt.Sprintf("session_%s_%s", cleanUser, underHost),
		}
		for _, detKey := range detKeys {
			if pwd, err := c.GetSessionPassword(detKey); err == nil && pwd != "" {
				if vaultKey != "" && vaultKey != detKey {
					_ = c.SaveSessionPassword(vaultKey, pwd)
				}
				return pwd, nil
			}
		}
	}

	// 3. Search across all saved sessions in tree
	if treeFn != nil && host != "" && username != "" {
		root := treeFn()
		if root != nil {
			var foundPwd string
			var search func(n *model.TreeNode)
			search = func(n *model.TreeNode) {
				if n == nil || foundPwd != "" {
					return
				}
				if n.Session != nil {
					s := n.Session
					if strings.EqualFold(s.Host, host) && strings.EqualFold(s.Username, username) {
						if s.VaultKey != "" {
							if p, err := c.GetSessionPassword(s.VaultKey); err == nil && p != "" {
								foundPwd = p
								return
							}
						}
					}
				}
				for _, ch := range n.Children {
					search(ch)
					if foundPwd != "" {
						return
					}
				}
			}
			search(root)

			if foundPwd != "" {
				if vaultKey != "" {
					_ = c.SaveSessionPassword(vaultKey, foundPwd)
				}
				return foundPwd, nil
			}
		}
	}

	return "", nil
}

func sanitizeVaultKey(s string) string {
	var sb strings.Builder
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' || r == '.' {
			sb.WriteRune(r)
		} else {
			sb.WriteRune('_')
		}
	}
	return sb.String()
}

// SelectPrivateKeyFile opens a native OS file dialog to select a private key file.
func (c *CredentialService) SelectPrivateKeyFile(ctx context.Context) (string, error) {
	return wailsruntime.OpenFileDialog(ctx, wailsruntime.OpenDialogOptions{
		Title: "Select SSH Private Key",
		Filters: []wailsruntime.FileFilter{
			{DisplayName: "Private Key Files (*.pem, *.key, id_*, *.id, *.pk, *.ppk)", Pattern: "*.pem;*.key;id_*;*.id;*.pk;*.ppk"},
			{DisplayName: "All Files (*.*)", Pattern: "*.*"},
		},
	})
}

// ValidatePrivateKeyFile checks a private key file and returns metadata (type, fingerprint, encryption).
func (c *CredentialService) ValidatePrivateKeyFile(path, passphrase string) (*sshsession.KeyInfo, error) {
	return sshsession.ValidatePrivateKey(path, passphrase)
}

// CheckSSHAgent returns the status of the local SSH agent (OpenSSH agent / Pageant).
func (c *CredentialService) CheckSSHAgent() (map[string]interface{}, error) {
	avail, count, err := sshsession.CheckAgentStatus()
	errMsg := ""
	if err != nil {
		errMsg = err.Error()
	}
	return map[string]interface{}{
		"available": avail,
		"keyCount":  count,
		"error":     errMsg,
	}, nil
}

// Master password and App Lock internal vault keys
const (
	vaultMasterHashKey    = "__vault_master_hash__"
	vaultMasterHintKey    = "__vault_master_hint__"
	vaultMasterHistoryKey = "__vault_master_history__"

	vaultAppLockHashKey    = "__app_lock_hash__"
	vaultAppLockHintKey    = "__app_lock_hint__"
	vaultAppLockHistoryKey = "__app_lock_history__"
	vaultAppLockEnabledKey = "__app_lock_enabled__"
)

// HasMasterPassword reports whether the vault is secured with a user-defined master password.
func (c *CredentialService) HasMasterPassword() (bool, error) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	if c.vault == nil {
		return false, nil
	}
	hash, ok, err := c.vault.Load(vaultMasterHashKey)
	if err != nil {
		return false, err
	}
	return ok && hash != "", nil
}

// SetMasterPassword hashes and stores a user-defined master password and optional hint.
func (c *CredentialService) SetMasterPassword(password, hint string) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.vault == nil {
		return fmt.Errorf("vault is not initialized")
	}
	trimmed := strings.TrimSpace(password)
	if len(trimmed) < 4 {
		return fmt.Errorf("master password must be at least 4 characters")
	}

	hashBytes, err := bcrypt.GenerateFromPassword([]byte(trimmed), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("failed to hash master password: %w", err)
	}

	// If no master password was configured, this is a fresh setup -> clear history (new user has 0 history)
	currHash, hasCurr, _ := c.vault.Load(vaultMasterHashKey)
	if !hasCurr || currHash == "" {
		_ = c.vault.Delete(vaultMasterHistoryKey)
	} else {
		// Existing password being replaced -> save old to history
		var history []string
		if histData, ok, _ := c.vault.Load(vaultMasterHistoryKey); ok && strings.TrimSpace(histData) != "" {
			_ = json.Unmarshal([]byte(histData), &history)
		}
		history = append([]string{currHash}, history...)
		if len(history) > 3 {
			history = history[:3]
		}
		if histJSON, err := json.Marshal(history); err == nil {
			_ = c.vault.Save(vaultMasterHistoryKey, string(histJSON))
		}
	}

	if err := c.vault.Save(vaultMasterHashKey, string(hashBytes)); err != nil {
		return fmt.Errorf("failed to save master password: %w", err)
	}
	if err := c.vault.Save(vaultMasterHintKey, strings.TrimSpace(hint)); err != nil {
		return fmt.Errorf("failed to save master password hint: %w", err)
	}

	c.resetLockoutLocked()
	return nil
}

// VerifyMasterPassword checks if the provided password matches the stored master password hash,
// enforcing strict multi-stage rate limiting, lockouts, and automatic security wipe on stage 4.
func (c *CredentialService) VerifyMasterPassword(password string) (bool, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.vault == nil {
		return true, nil
	}
	storedHash, ok, err := c.vault.Load(vaultMasterHashKey)
	if err != nil {
		return false, err
	}
	if !ok || storedHash == "" {
		return true, nil // No master password configured
	}

	now := time.Now()
	// Check if currently locked out
	if !c.lockoutUntil.IsZero() {
		if now.Before(c.lockoutUntil) {
			remaining := int(time.Until(c.lockoutUntil).Seconds()) + 1
			return false, fmt.Errorf("account locked: please wait %d seconds before trying again", remaining)
		}
		// Lockout timer expired
		c.lockoutUntil = time.Time{}
		c.saveLockoutStateLocked()
	}

	if c.stage < 1 {
		c.stage = 1
	}

	err = bcrypt.CompareHashAndPassword([]byte(storedHash), []byte(strings.TrimSpace(password)))
	if err == nil {
		// Password correct -> reset lockout state completely
		c.resetLockoutLocked()
		return true, nil
	}

	// Incorrect password -> increment failure count
	c.failedAttempts++

	switch c.stage {
	case 1:
		if c.failedAttempts >= 5 {
			c.lockoutUntil = time.Now().Add(30 * time.Second)
			c.stage = 2
			c.failedAttempts = 0
			c.saveLockoutStateLocked()
			return false, fmt.Errorf("incorrect master password: 5 failed attempts reached, locked out for 30 seconds")
		}
		c.saveLockoutStateLocked()
		return false, nil

	case 2:
		if c.failedAttempts >= 5 {
			c.lockoutUntil = time.Now().Add(2 * time.Minute)
			c.stage = 3
			c.failedAttempts = 0
			c.saveLockoutStateLocked()
			return false, fmt.Errorf("incorrect master password: 5 failed attempts reached, locked out for 2 minutes")
		}
		c.saveLockoutStateLocked()
		return false, nil

	case 3:
		if c.failedAttempts >= 3 {
			c.lockoutUntil = time.Now().Add(30 * time.Minute)
			c.stage = 4
			c.failedAttempts = 0
			c.saveLockoutStateLocked()
			return false, fmt.Errorf("incorrect master password: 3 failed attempts reached, locked out for 30 minutes")
		}
		c.saveLockoutStateLocked()
		return false, nil

	default: // Stage 4: final attempt round after 30-min lockout
		if c.failedAttempts >= 1 {
			// Trigger automatic security wipe
			_ = c.clearAllLocked()
			c.resetLockoutLocked()
			if c.onSecurityWipe != nil {
				go func() {
					_ = c.onSecurityWipe()
				}()
			}
			return false, fmt.Errorf("SECURITY_WIPE: 4th authentication stage failed, all server credentials deleted and application restarting")
		}
		c.saveLockoutStateLocked()
		return false, nil
	}
}

// GetMasterPasswordHint returns the password hint configured by the user.
func (c *CredentialService) GetMasterPasswordHint() (string, error) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	if c.vault == nil {
		return "", nil
	}
	hint, ok, err := c.vault.Load(vaultMasterHintKey)
	if err != nil || !ok {
		return "", nil
	}
	return hint, nil
}

// HasPreviousMasterPasswords reports whether previous master passwords are saved for recovery.
func (c *CredentialService) HasPreviousMasterPasswords() (bool, int, error) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	if c.vault == nil {
		return false, 0, nil
	}
	data, ok, err := c.vault.Load(vaultMasterHistoryKey)
	if err != nil || !ok || strings.TrimSpace(data) == "" {
		return false, 0, nil
	}
	var history []string
	if err := json.Unmarshal([]byte(data), &history); err != nil {
		return false, 0, nil
	}
	return len(history) > 0, len(history), nil
}

// ResetMasterPasswordWithPrevious allows resetting the master password if the user knows any of their last 3 master passwords.
// If the user is new (no history exists), this method returns an error.
func (c *CredentialService) ResetMasterPasswordWithPrevious(previousPassword, newPassword, newHint string) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.vault == nil {
		return fmt.Errorf("vault is not initialized")
	}

	trimmedNew := strings.TrimSpace(newPassword)
	if len(trimmedNew) < 4 {
		return fmt.Errorf("new master password must be at least 4 characters")
	}

	data, ok, err := c.vault.Load(vaultMasterHistoryKey)
	if err != nil || !ok || strings.TrimSpace(data) == "" {
		return fmt.Errorf("no master password history found; new users cannot use this recovery method")
	}

	var history []string
	if err := json.Unmarshal([]byte(data), &history); err != nil || len(history) == 0 {
		return fmt.Errorf("no master password history found; new users cannot use this recovery method")
	}

	trimmedPrev := strings.TrimSpace(previousPassword)
	matched := false
	for _, h := range history {
		if err := bcrypt.CompareHashAndPassword([]byte(h), []byte(trimmedPrev)); err == nil {
			matched = true
			break
		}
	}
	if !matched {
		return fmt.Errorf("entered password does not match any of your last 3 master passwords")
	}

	// Matched! Add current active master password to history (if present), keeping last 3
	currHash, hasCurr, _ := c.vault.Load(vaultMasterHashKey)
	if hasCurr && currHash != "" {
		history = append([]string{currHash}, history...)
		if len(history) > 3 {
			history = history[:3]
		}
		if histJSON, err := json.Marshal(history); err == nil {
			_ = c.vault.Save(vaultMasterHistoryKey, string(histJSON))
		}
	}

	newHashBytes, err := bcrypt.GenerateFromPassword([]byte(trimmedNew), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("failed to hash new master password: %w", err)
	}

	if err := c.vault.Save(vaultMasterHashKey, string(newHashBytes)); err != nil {
		return fmt.Errorf("failed to save new master password: %w", err)
	}
	if err := c.vault.Save(vaultMasterHintKey, strings.TrimSpace(newHint)); err != nil {
		return fmt.Errorf("failed to save new master password hint: %w", err)
	}

	c.resetLockoutLocked()
	return nil
}

// RemoveMasterPassword removes the master password protection after verifying the current password.
func (c *CredentialService) RemoveMasterPassword(currentPassword string) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.vault == nil {
		return fmt.Errorf("vault is not initialized")
	}
	storedHash, ok, err := c.vault.Load(vaultMasterHashKey)
	if err != nil {
		return err
	}
	if ok && storedHash != "" {
		if err := bcrypt.CompareHashAndPassword([]byte(storedHash), []byte(strings.TrimSpace(currentPassword))); err != nil {
			return fmt.Errorf("incorrect master password")
		}
	}

	_ = c.vault.Delete(vaultMasterHashKey)
	_ = c.vault.Delete(vaultMasterHintKey)
	_ = c.vault.Delete(vaultMasterHistoryKey)
	c.resetLockoutLocked()
	return nil
}

// ResetMasterPassword removes the master password protection without requiring the current password.
// This is used for recovery when the user has forgotten their master password.
func (c *CredentialService) ResetMasterPassword() error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.vault == nil {
		return fmt.Errorf("vault is not initialized")
	}
	_ = c.vault.Delete(vaultMasterHashKey)
	_ = c.vault.Delete(vaultMasterHintKey)
	_ = c.vault.Delete(vaultMasterHistoryKey)
	c.resetLockoutLocked()
	return nil
}

// ChangeMasterPassword updates the master password and hint after verifying the current password,
// storing the previous master password in the history list (up to 3 previous passwords).
func (c *CredentialService) ChangeMasterPassword(currentPassword, newPassword, newHint string) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.vault == nil {
		return fmt.Errorf("vault is not initialized")
	}
	storedHash, ok, err := c.vault.Load(vaultMasterHashKey)
	if err != nil {
		return err
	}
	if ok && storedHash != "" {
		if err := bcrypt.CompareHashAndPassword([]byte(storedHash), []byte(strings.TrimSpace(currentPassword))); err != nil {
			return fmt.Errorf("incorrect current master password")
		}
	}

	trimmedNew := strings.TrimSpace(newPassword)
	if len(trimmedNew) < 4 {
		return fmt.Errorf("new master password must be at least 4 characters")
	}

	hashBytes, err := bcrypt.GenerateFromPassword([]byte(trimmedNew), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("failed to hash new master password: %w", err)
	}

	// Push old verified hash into history, keeping last 3
	if ok && storedHash != "" {
		var history []string
		if histData, hOk, _ := c.vault.Load(vaultMasterHistoryKey); hOk && strings.TrimSpace(histData) != "" {
			_ = json.Unmarshal([]byte(histData), &history)
		}
		history = append([]string{storedHash}, history...)
		if len(history) > 3 {
			history = history[:3]
		}
		if histJSON, err := json.Marshal(history); err == nil {
			_ = c.vault.Save(vaultMasterHistoryKey, string(histJSON))
		}
	}

	if err := c.vault.Save(vaultMasterHashKey, string(hashBytes)); err != nil {
		return fmt.Errorf("failed to save new master password: %w", err)
	}
	if err := c.vault.Save(vaultMasterHintKey, strings.TrimSpace(newHint)); err != nil {
		return fmt.Errorf("failed to save new master password hint: %w", err)
	}

	c.resetLockoutLocked()
	return nil
}

// HasAppPassword reports whether an application lock password has been configured.
func (c *CredentialService) HasAppPassword() (bool, error) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	if c.vault == nil {
		return false, nil
	}
	hash, ok, err := c.vault.Load(vaultAppLockHashKey)
	if err != nil {
		return false, err
	}
	return ok && hash != "", nil
}

// IsAppLockEnabled reports whether the application lock gate is currently turned on.
func (c *CredentialService) IsAppLockEnabled() (bool, error) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	if c.vault == nil {
		return false, nil
	}
	val, ok, err := c.vault.Load(vaultAppLockEnabledKey)
	if err != nil || !ok {
		// If not explicitly set, default to whether an app password exists
		hash, hOk, _ := c.vault.Load(vaultAppLockHashKey)
		return hOk && hash != "", nil
	}
	return val == "true", nil
}

// SetAppLockEnabled toggles whether the application lock gate is active.
func (c *CredentialService) SetAppLockEnabled(enabled bool) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.vault == nil {
		return fmt.Errorf("vault is not initialized")
	}
	val := "false"
	if enabled {
		val = "true"
	}
	return c.vault.Save(vaultAppLockEnabledKey, val)
}

// SetAppPassword hashes and stores an independent application lock password and optional hint.
func (c *CredentialService) SetAppPassword(password, hint string) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.vault == nil {
		return fmt.Errorf("vault is not initialized")
	}
	trimmed := strings.TrimSpace(password)
	if len(trimmed) < 4 {
		return fmt.Errorf("app password must be at least 4 characters")
	}

	hashBytes, err := bcrypt.GenerateFromPassword([]byte(trimmed), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("failed to hash app password: %w", err)
	}

	currHash, hasCurr, _ := c.vault.Load(vaultAppLockHashKey)
	if !hasCurr || currHash == "" {
		_ = c.vault.Delete(vaultAppLockHistoryKey)
	} else {
		var history []string
		if histData, ok, _ := c.vault.Load(vaultAppLockHistoryKey); ok && strings.TrimSpace(histData) != "" {
			_ = json.Unmarshal([]byte(histData), &history)
		}
		history = append([]string{currHash}, history...)
		if len(history) > 3 {
			history = history[:3]
		}
		if histJSON, err := json.Marshal(history); err == nil {
			_ = c.vault.Save(vaultAppLockHistoryKey, string(histJSON))
		}
	}

	if err := c.vault.Save(vaultAppLockHashKey, string(hashBytes)); err != nil {
		return fmt.Errorf("failed to save app password: %w", err)
	}
	if err := c.vault.Save(vaultAppLockHintKey, strings.TrimSpace(hint)); err != nil {
		return fmt.Errorf("failed to save app password hint: %w", err)
	}
	_ = c.vault.Save(vaultAppLockEnabledKey, "true")

	c.resetAppLockoutLocked()
	return nil
}

// VerifyAppPassword checks if the provided password matches the stored app lock password,
// enforcing strict multi-stage rate limiting and cooldowns.
func (c *CredentialService) VerifyAppPassword(password string) (bool, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.vault == nil {
		return true, nil
	}
	storedHash, ok, err := c.vault.Load(vaultAppLockHashKey)
	if err != nil {
		return false, err
	}
	if !ok || storedHash == "" {
		return true, nil
	}

	now := time.Now()
	if !c.appLockLockoutUntil.IsZero() && now.Before(c.appLockLockoutUntil) {
		rem := int(time.Until(c.appLockLockoutUntil).Seconds()) + 1
		return false, fmt.Errorf("authentication locked out: cooldown active (%d seconds remaining)", rem)
	}

	err = bcrypt.CompareHashAndPassword([]byte(storedHash), []byte(strings.TrimSpace(password)))
	if err == nil {
		c.resetAppLockoutLocked()
		return true, nil
	}

	c.appLockFailedAttempts++
	switch c.appLockStage {
	case 1:
		if c.appLockFailedAttempts >= 5 {
			c.appLockLockoutUntil = time.Now().Add(30 * time.Second)
			c.appLockStage = 2
			c.appLockFailedAttempts = 0
			c.saveLockoutStateLocked()
			return false, fmt.Errorf("incorrect app password: 5 failed attempts reached, locked out for 30 seconds")
		}
		c.saveLockoutStateLocked()
		return false, nil

	case 2:
		if c.appLockFailedAttempts >= 5 {
			c.appLockLockoutUntil = time.Now().Add(2 * time.Minute)
			c.appLockStage = 3
			c.appLockFailedAttempts = 0
			c.saveLockoutStateLocked()
			return false, fmt.Errorf("incorrect app password: 5 failed attempts reached, locked out for 2 minutes")
		}
		c.saveLockoutStateLocked()
		return false, nil

	case 3:
		if c.appLockFailedAttempts >= 3 {
			c.appLockLockoutUntil = time.Now().Add(30 * time.Minute)
			c.appLockStage = 4
			c.appLockFailedAttempts = 0
			c.saveLockoutStateLocked()
			return false, fmt.Errorf("incorrect app password: 3 failed attempts reached, locked out for 30 minutes")
		}
		c.saveLockoutStateLocked()
		return false, nil

	default: // Stage 4: final attempt
		if c.appLockFailedAttempts >= 1 {
			_ = c.clearAllLocked()
			c.resetAppLockoutLocked()
			if c.onSecurityWipe != nil {
				go func() {
					_ = c.onSecurityWipe()
				}()
			}
			return false, fmt.Errorf("SECURITY_WIPE: 4th authentication stage failed, all server credentials deleted and application restarting")
		}
		c.saveLockoutStateLocked()
		return false, nil
	}
}

// GetAppPasswordHint returns the reminder hint configured for the app lock password.
func (c *CredentialService) GetAppPasswordHint() (string, error) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	if c.vault == nil {
		return "", nil
	}
	hint, ok, err := c.vault.Load(vaultAppLockHintKey)
	if err != nil || !ok {
		return "", nil
	}
	return hint, nil
}

// ChangeAppPassword updates the application lock password after verifying the current one.
func (c *CredentialService) ChangeAppPassword(currentPassword, newPassword, newHint string) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.vault == nil {
		return fmt.Errorf("vault is not initialized")
	}
	storedHash, ok, err := c.vault.Load(vaultAppLockHashKey)
	if err != nil {
		return err
	}
	if ok && storedHash != "" {
		if err := bcrypt.CompareHashAndPassword([]byte(storedHash), []byte(strings.TrimSpace(currentPassword))); err != nil {
			return fmt.Errorf("incorrect current app password")
		}
	}

	trimmedNew := strings.TrimSpace(newPassword)
	if len(trimmedNew) < 4 {
		return fmt.Errorf("new app password must be at least 4 characters")
	}

	hashBytes, err := bcrypt.GenerateFromPassword([]byte(trimmedNew), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("failed to hash new app password: %w", err)
	}

	if ok && storedHash != "" {
		var history []string
		if histData, hOk, _ := c.vault.Load(vaultAppLockHistoryKey); hOk && strings.TrimSpace(histData) != "" {
			_ = json.Unmarshal([]byte(histData), &history)
		}
		history = append([]string{storedHash}, history...)
		if len(history) > 3 {
			history = history[:3]
		}
		if histJSON, err := json.Marshal(history); err == nil {
			_ = c.vault.Save(vaultAppLockHistoryKey, string(histJSON))
		}
	}

	if err := c.vault.Save(vaultAppLockHashKey, string(hashBytes)); err != nil {
		return fmt.Errorf("failed to save new app password: %w", err)
	}
	if err := c.vault.Save(vaultAppLockHintKey, strings.TrimSpace(newHint)); err != nil {
		return fmt.Errorf("failed to save new app password hint: %w", err)
	}
	_ = c.vault.Save(vaultAppLockEnabledKey, "true")

	c.resetAppLockoutLocked()
	return nil
}

// RemoveAppPassword deletes the app password after verifying the current password and disables app lock.
func (c *CredentialService) RemoveAppPassword(currentPassword string) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.vault == nil {
		return fmt.Errorf("vault is not initialized")
	}
	storedHash, ok, err := c.vault.Load(vaultAppLockHashKey)
	if err != nil {
		return err
	}
	if ok && storedHash != "" {
		if err := bcrypt.CompareHashAndPassword([]byte(storedHash), []byte(strings.TrimSpace(currentPassword))); err != nil {
			return fmt.Errorf("incorrect app password")
		}
	}

	_ = c.vault.Delete(vaultAppLockHashKey)
	_ = c.vault.Delete(vaultAppLockHintKey)
	_ = c.vault.Delete(vaultAppLockHistoryKey)
	_ = c.vault.Save(vaultAppLockEnabledKey, "false")
	c.resetAppLockoutLocked()
	return nil
}

// ResetAppPasswordWithPrevious allows resetting the app password if the user knows any of their last 3 app passwords.
func (c *CredentialService) ResetAppPasswordWithPrevious(previousPassword, newPassword, newHint string) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.vault == nil {
		return fmt.Errorf("vault is not initialized")
	}

	trimmedNew := strings.TrimSpace(newPassword)
	if len(trimmedNew) < 4 {
		return fmt.Errorf("new app password must be at least 4 characters")
	}

	data, ok, err := c.vault.Load(vaultAppLockHistoryKey)
	if err != nil || !ok || strings.TrimSpace(data) == "" {
		return fmt.Errorf("no app password history found; new users cannot use this recovery method")
	}

	var history []string
	if err := json.Unmarshal([]byte(data), &history); err != nil || len(history) == 0 {
		return fmt.Errorf("no app password history found; new users cannot use this recovery method")
	}

	trimmedPrev := strings.TrimSpace(previousPassword)
	matched := false
	for _, h := range history {
		if err := bcrypt.CompareHashAndPassword([]byte(h), []byte(trimmedPrev)); err == nil {
			matched = true
			break
		}
	}
	if !matched {
		return fmt.Errorf("entered password does not match any of your last 3 app passwords")
	}

	currHash, hasCurr, _ := c.vault.Load(vaultAppLockHashKey)
	if hasCurr && currHash != "" {
		history = append([]string{currHash}, history...)
		if len(history) > 3 {
			history = history[:3]
		}
		if histJSON, err := json.Marshal(history); err == nil {
			_ = c.vault.Save(vaultAppLockHistoryKey, string(histJSON))
		}
	}

	newHashBytes, err := bcrypt.GenerateFromPassword([]byte(trimmedNew), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("failed to hash new app password: %w", err)
	}

	if err := c.vault.Save(vaultAppLockHashKey, string(newHashBytes)); err != nil {
		return fmt.Errorf("failed to save new app password: %w", err)
	}
	if err := c.vault.Save(vaultAppLockHintKey, strings.TrimSpace(newHint)); err != nil {
		return fmt.Errorf("failed to save new app password hint: %w", err)
	}
	_ = c.vault.Save(vaultAppLockEnabledKey, "true")

	c.resetAppLockoutLocked()
	return nil
}

// GetAppLockoutStatus evaluates and returns the lockout stage and cooldown timer for app lock.
func (c *CredentialService) GetAppLockoutStatus() (*LockoutStatus, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	now := time.Now()
	isLockedOut := false
	remainingSeconds := 0

	if !c.appLockLockoutUntil.IsZero() {
		if now.Before(c.appLockLockoutUntil) {
			isLockedOut = true
			remainingSeconds = int(time.Until(c.appLockLockoutUntil).Seconds()) + 1
		} else {
			c.appLockLockoutUntil = time.Time{}
			c.saveLockoutStateLocked()
		}
	}

	if c.appLockStage < 1 {
		c.appLockStage = 1
	}

	maxAttempts := 5
	switch c.appLockStage {
	case 1:
		maxAttempts = 5
	case 2:
		maxAttempts = 5
	case 3:
		maxAttempts = 3
	default:
		maxAttempts = 1
	}

	attemptsRemaining := maxAttempts - c.appLockFailedAttempts
	if attemptsRemaining < 0 {
		attemptsRemaining = 0
	}

	hasAppPwd := false
	hasHistory := false
	historyCount := 0
	isEnabled := false

	if c.vault != nil {
		hash, ok, _ := c.vault.Load(vaultAppLockHashKey)
		hasAppPwd = ok && hash != ""

		histData, hOk, _ := c.vault.Load(vaultAppLockHistoryKey)
		if hOk && strings.TrimSpace(histData) != "" {
			var hist []string
			if err := json.Unmarshal([]byte(histData), &hist); err == nil {
				hasHistory = len(hist) > 0
				historyCount = len(hist)
			}
		}

		enVal, eOk, _ := c.vault.Load(vaultAppLockEnabledKey)
		if eOk {
			isEnabled = enVal == "true"
		} else {
			isEnabled = hasAppPwd
		}
	}

	return &LockoutStatus{
		IsLockedOut:       isLockedOut,
		RemainingSeconds:  remainingSeconds,
		CurrentStage:      c.appLockStage,
		FailedAttempts:    c.appLockFailedAttempts,
		MaxAttempts:       maxAttempts,
		AttemptsRemaining: attemptsRemaining,
		HasAppPassword:    hasAppPwd,
		IsAppLockEnabled:  isEnabled,
		HasHistory:        hasHistory,
		HistoryCount:      historyCount,
		IsFinalStage:      c.appLockStage >= 4,
	}, nil
}

// GenerateSecurePassword generates a high-entropy cryptographically secure password.
func GenerateSecurePassword(length int, includeSymbols bool) string {
	if length < 8 {
		length = 16
	} else if length > 128 {
		length = 128
	}

	const (
		lowerChars  = "abcdefghijkmnopqrstuvwxyz"
		upperChars  = "ABCDEFGHJKLMNPQRSTUVWXYZ"
		numberChars = "23456789"
		symbolChars = "!@#$%^&*()-_=+[]{}<>"
	)

	// Guarantee at least one character from each required category
	var chars strings.Builder
	chars.WriteString(lowerChars)
	chars.WriteString(upperChars)
	chars.WriteString(numberChars)
	if includeSymbols {
		chars.WriteString(symbolChars)
	}
	allChars := chars.String()

	randomChar := func(source string) byte {
		n, err := rand.Int(rand.Reader, big.NewInt(int64(len(source))))
		if err != nil {
			return source[0]
		}
		return source[n.Int64()]
	}

	buf := make([]byte, length)
	buf[0] = randomChar(lowerChars)
	buf[1] = randomChar(upperChars)
	buf[2] = randomChar(numberChars)
	idx := 3
	if includeSymbols {
		buf[3] = randomChar(symbolChars)
		idx = 4
	}

	for i := idx; i < length; i++ {
		buf[i] = randomChar(allChars)
	}

	// Fisher-Yates shuffle with crypto/rand
	for i := length - 1; i > 0; i-- {
		jBig, err := rand.Int(rand.Reader, big.NewInt(int64(i+1)))
		if err != nil {
			continue
		}
		j := int(jBig.Int64())
		buf[i], buf[j] = buf[j], buf[i]
	}

	return string(buf)
}
