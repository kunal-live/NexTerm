//go:build darwin

package vault

import (
	"bytes"
	"encoding/base64"
	"errors"
	"fmt"
	"os/exec"
	"regexp"
	"strings"
)

const keychainServiceName = "Nexterm"

// keychainEncodedPrefix marks secrets stored base64-encoded. Values without it
// were written by older versions and are returned as-is.
const keychainEncodedPrefix = "nexterm-b64:"

// securityMaxCommandLen is the line limit of `security -i`.
const securityMaxCommandLen = 4096

var securitySafeArg = regexp.MustCompile(`^[\w@%+=:,./-]+$`)

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

// quoteSecurityArg quotes s for the `security -i` command-line parser.
func quoteSecurityArg(s string) string {
	if s == "" {
		return "''"
	}
	if securitySafeArg.MatchString(s) {
		return s
	}
	return "'" + strings.ReplaceAll(s, "'", `'"'"'`) + "'"
}

func (v *Vault) Save(key, secret string) error {
	if key == "" {
		return errors.New("vault: key cannot be empty")
	}

	// `security add-generic-password -w <secret>` would expose the secret in the
	// process list (ps), so the command is fed to `security -i` over stdin
	// instead. Base64 keeps the line free of quoting issues and stops
	// `find-generic-password -w` from hex-encoding non-ASCII secrets.
	encoded := keychainEncodedPrefix + base64.StdEncoding.EncodeToString([]byte(secret))
	command := fmt.Sprintf("add-generic-password -U -s %s -a %s -w %s\n",
		quoteSecurityArg(v.service), quoteSecurityArg(key), encoded)
	if len(command) > securityMaxCommandLen {
		return errors.New("vault: secret is too large for the macOS Keychain CLI")
	}

	cmd := exec.Command("/usr/bin/security", "-i")
	cmd.Stdin = strings.NewReader(command)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("keychain save failed: %w (output: %s)", err, strings.TrimSpace(string(out)))
	}

	// Interactive mode does not reflect a failed sub-command in its exit code,
	// so confirm the item was written.
	got, ok, err := v.Load(key)
	if err != nil {
		return fmt.Errorf("keychain save could not be verified: %w", err)
	}
	if !ok || got != secret {
		return fmt.Errorf("keychain save failed (output: %s)", strings.TrimSpace(string(out)))
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
	if strings.HasPrefix(secret, keychainEncodedPrefix) {
		decoded, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(secret, keychainEncodedPrefix))
		if err != nil {
			return "", false, fmt.Errorf("keychain load failed: corrupt encoded secret: %w", err)
		}
		secret = string(decoded)
	}
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
	// delete-generic-password removes one matching item per call; repeat until
	// nothing is left for this service (bounded in case of a stuck item).
	for i := 0; i < 10000; i++ {
		cmd := exec.Command("/usr/bin/security", "delete-generic-password", "-s", v.service)
		if err := cmd.Run(); err != nil {
			break
		}
	}
	return nil
}
