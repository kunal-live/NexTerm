//go:build linux

package vault

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"strings"
)

const linuxServiceName = "Nexterm"

// ErrSecretServiceUnavailable indicates that the Linux Secret Service / libsecret tool is missing.
var ErrSecretServiceUnavailable = errors.New("vault: Linux Secret Service / libsecret is unavailable (secret-tool not found)")

// Vault stores credentials securely using the Linux Secret Service API (via secret-tool / GNOME Keyring / KWallet).
// Passwords are sent over standard input to avoid leaking secrets in process arguments.
// Unencrypted fake fallback is strictly forbidden.
type Vault struct {
	service string
}

func NewVault() (*Vault, error) {
	if _, err := exec.LookPath("secret-tool"); err != nil {
		return nil, ErrSecretServiceUnavailable
	}
	return &Vault{service: linuxServiceName}, nil
}

// NewVaultAt returns a Vault instance (directory path is ignored on Linux as credentials reside in Secret Service).
func NewVaultAt(dir string) (*Vault, error) {
	return NewVault()
}

func (v *Vault) Save(key, secret string) error {
	if key == "" {
		return errors.New("vault: key cannot be empty")
	}

	// secret-tool store --label="Nexterm" service Nexterm account <key>
	// The secret is passed via standard input so it is never exposed in `/proc/<pid>/cmdline`.
	cmd := exec.Command("secret-tool", "store", "--label=Nexterm", "service", v.service, "account", key)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return fmt.Errorf("secret-tool stdin: %w", err)
	}
	var stderr bytes.Buffer
	cmd.Stderr = &stderr

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("secret-tool start: %w", err)
	}

	if _, err := io.WriteString(stdin, secret); err != nil {
		_ = stdin.Close()
		return fmt.Errorf("secret-tool write secret: %w", err)
	}
	_ = stdin.Close()

	if err := cmd.Wait(); err != nil {
		return fmt.Errorf("secret-tool store failed: %w (%s)", err, strings.TrimSpace(stderr.String()))
	}
	return nil
}

func (v *Vault) Load(key string) (string, bool, error) {
	if key == "" {
		return "", false, nil
	}
	// secret-tool lookup service Nexterm account <key>
	cmd := exec.Command("secret-tool", "lookup", "service", v.service, "account", key)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		// Non-zero exit code means secret was not found
		return "", false, nil
	}
	val := strings.TrimRight(stdout.String(), "\r\n")
	if val == "" {
		return "", false, nil
	}
	return val, true, nil
}

func (v *Vault) Delete(key string) error {
	if key == "" {
		return nil
	}
	// secret-tool clear service Nexterm account <key>
	cmd := exec.Command("secret-tool", "clear", "service", v.service, "account", key)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		// If key was not found or already deleted, treat as non-fatal
		return nil
	}
	return nil
}

// ClearAll removes all stored secrets from the vault.
func (v *Vault) ClearAll() error {
	cmd := exec.Command("secret-tool", "clear", "service", v.service)
	_ = cmd.Run()
	return nil
}
