//go:build windows

package vault

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"unsafe"

	"golang.org/x/sys/windows"
)

// Vault stores secrets (passwords, key passphrases) encrypted with Windows
// DPAPI, scoped to the current Windows user profile (CryptProtectData).
// Credentials are bound to the hardware and user account and never written in plaintext.
type Vault struct {
	dir string
}

// NewVaultAt creates a DPAPI vault at the specified directory path.
func NewVaultAt(dir string) (*Vault, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, fmt.Errorf("create vault dir: %w", err)
	}
	return &Vault{dir: dir}, nil
}

// NewVault initializes the DPAPI vault at %AppData%\Nexterm\vault.
func NewVault() (*Vault, error) {
	appData, err := os.UserConfigDir()
	if err != nil {
		return nil, err
	}
	dir := filepath.Join(appData, "Nexterm", "vault")
	v, err := NewVaultAt(dir)
	if err != nil {
		return nil, err
	}

	// Check if legacy MobaCloneGo vault exists and copy missing credential files
	oldDir := filepath.Join(appData, "MobaCloneGo", "vault")
	if entries, err := os.ReadDir(oldDir); err == nil {
		for _, e := range entries {
			if !e.IsDir() {
				src := filepath.Join(oldDir, e.Name())
				dst := filepath.Join(dir, e.Name())
				if _, err := os.Stat(dst); os.IsNotExist(err) {
					if data, err := os.ReadFile(src); err == nil {
						_ = os.WriteFile(dst, data, 0o600)
					}
				}
			}
		}
	}

	return v, nil
}

func (v *Vault) path(key string) string {
	safeKey := url.QueryEscape(key)
	return filepath.Join(v.dir, safeKey+".bin")
}

func (v *Vault) Save(key, secret string) error {
	if key == "" {
		return errors.New("vault: key cannot be empty")
	}
	encrypted, err := protect([]byte(secret))
	if err != nil {
		return fmt.Errorf("dpapi protect: %w", err)
	}
	return os.WriteFile(v.path(key), encrypted, 0o600)
}

func (v *Vault) Load(key string) (string, bool, error) {
	if key == "" {
		return "", false, nil
	}
	data, err := os.ReadFile(v.path(key))
	if os.IsNotExist(err) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	plain, err := unprotect(data)
	if err != nil {
		return "", false, fmt.Errorf("dpapi unprotect: %w", err)
	}
	return string(plain), true, nil
}

func (v *Vault) Delete(key string) error {
	if key == "" {
		return nil
	}
	err := os.Remove(v.path(key))
	if os.IsNotExist(err) {
		return nil
	}
	return err
}

// ClearAll removes all stored secrets from the vault.
func (v *Vault) ClearAll() error {
	if v.dir == "" {
		return nil
	}
	entries, err := os.ReadDir(v.dir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	for _, e := range entries {
		if !e.IsDir() {
			_ = os.Remove(filepath.Join(v.dir, e.Name()))
		}
	}
	return nil
}

// --- thin wrappers around CryptProtectData / CryptUnprotectData ---

type dataBlob struct {
	cbData uint32
	pbData *byte
}

func newBlob(data []byte) *dataBlob {
	if len(data) == 0 {
		return &dataBlob{}
	}
	return &dataBlob{cbData: uint32(len(data)), pbData: &data[0]}
}

func (b *dataBlob) bytes() []byte {
	if b.pbData == nil || b.cbData == 0 {
		return nil
	}
	return unsafe.Slice(b.pbData, b.cbData)
}

var (
	modcrypt32             = windows.NewLazySystemDLL("crypt32.dll")
	modkernel32            = windows.NewLazySystemDLL("kernel32.dll")
	procCryptProtectData   = modcrypt32.NewProc("CryptProtectData")
	procCryptUnprotectData = modcrypt32.NewProc("CryptUnprotectData")
	procLocalFree          = modkernel32.NewProc("LocalFree")
)

func protect(plain []byte) ([]byte, error) {
	in := newBlob(plain)
	var out dataBlob

	r, _, err := procCryptProtectData.Call(
		uintptr(unsafe.Pointer(in)),
		0, 0, 0, 0, 0,
		uintptr(unsafe.Pointer(&out)),
	)
	if r == 0 {
		return nil, err
	}
	defer procLocalFree.Call(uintptr(unsafe.Pointer(out.pbData)))

	result := make([]byte, out.cbData)
	copy(result, out.bytes())
	return result, nil
}

func unprotect(encrypted []byte) ([]byte, error) {
	in := newBlob(encrypted)
	var out dataBlob

	r, _, err := procCryptUnprotectData.Call(
		uintptr(unsafe.Pointer(in)),
		0, 0, 0, 0, 0,
		uintptr(unsafe.Pointer(&out)),
	)
	if r == 0 {
		return nil, err
	}
	defer procLocalFree.Call(uintptr(unsafe.Pointer(out.pbData)))

	result := make([]byte, out.cbData)
	copy(result, out.bytes())
	return result, nil
}
