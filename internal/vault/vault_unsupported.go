//go:build !windows && !darwin && !linux

package vault

import "errors"

// ErrUnsupportedPlatform is returned when running on an OS that lacks a supported secure credential store.
var ErrUnsupportedPlatform = errors.New("vault: secure credential storage is not supported on this platform (plain-text/fake fallback is strictly disabled)")

// Vault stub that unconditionally fails on unsupported platforms.
// Insecure base64 or plaintext fallbacks are explicitly forbidden.
type Vault struct{}

func NewVault() (*Vault, error) {
	return nil, ErrUnsupportedPlatform
}

func NewVaultAt(dir string) (*Vault, error) {
	return nil, ErrUnsupportedPlatform
}

func (v *Vault) Save(key, secret string) error {
	return ErrUnsupportedPlatform
}

func (v *Vault) Load(key string) (string, bool, error) {
	return "", false, ErrUnsupportedPlatform
}

func (v *Vault) Delete(key string) error {
	return ErrUnsupportedPlatform
}

func (v *Vault) ClearAll() error {
	return ErrUnsupportedPlatform
}
