//go:build darwin

package vault

import (
	"bytes"
	"errors"
	"fmt"
	"os/exec"
	"strings"
)

const keychainServiceName = "Nexterm"

// Vault stores credentials directly in the native macOS Keychain via /usr/bin/security.
// No plaintext or fake files are written to disk.
type Vault struct {
	service string
}

func NewVault() (*Vault, error) {
	if _, err := exec.LookPath("/usr/bin/security"); err != nil {
		return nil, fmt.Errorf("macOS Keychain CLI (/usr/bin/security) not found: %w", err)
	}
	return &Vault{service: keychainServiceName}, nil
}

// NewVaultAt returns a Vault instance (directory path is ignored on macOS as credentials reside in native Keychain).
func NewVaultAt(dir string) (*Vault, error) {
	return NewVault()
}

func (v *Vault) Save(key, secret string) error {
	if key == "" {
		return errors.New("vault: key cannot be empty")
	}
	// /usr/bin/security add-generic-password -U -s <service> -a <account> -w <password>
	cmd := exec.Command("/usr/bin/security", "add-generic-password", "-U", "-s", v.service, "-a", key, "-w", secret)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("keychain save failed: %w (output: %s)", err, strings.TrimSpace(string(out)))
	}
	return nil
}

func (v *Vault) Load(key string) (string, bool, error) {
	if key == "" {
		return "", false, nil
	}
	// /usr/bin/security find-generic-password -s <service> -a <account> -w
	cmd := exec.Command("/usr/bin/security", "find-generic-password", "-s", v.service, "-a", key, "-w")
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	if err != nil {
		errStr := stderr.String()
		// Item does not exist in keychain
		if strings.Contains(errStr, "could not be found") || strings.Contains(errStr, "The specified item could not be found in the keychain") {
			return "", false, nil
		}
		return "", false, fmt.Errorf("keychain load failed: %w (%s)", err, strings.TrimSpace(errStr))
	}
	secret := strings.TrimRight(stdout.String(), "\r\n")
	return secret, true, nil
}

func (v *Vault) Delete(key string) error {
	if key == "" {
		return nil
	}
	// /usr/bin/security delete-generic-password -s <service> -a <account>
	cmd := exec.Command("/usr/bin/security", "delete-generic-password", "-s", v.service, "-a", key)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	err := cmd.Run()
	if err != nil {
		errStr := stderr.String()
		if strings.Contains(errStr, "could not be found") {
			return nil
		}
		return fmt.Errorf("keychain delete failed: %w (%s)", err, strings.TrimSpace(errStr))
	}
	return nil
}

// ClearAll removes all stored secrets from the vault.
func (v *Vault) ClearAll() error {
	cmd := exec.Command("/usr/bin/security", "delete-generic-password", "-s", v.service)
	_ = cmd.Run()
	return nil
}
