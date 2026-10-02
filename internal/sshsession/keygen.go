package sshsession

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/rsa"
	"encoding/pem"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"golang.org/x/crypto/ssh"
)

// GeneratedKey describes a freshly created SSH key pair written to disk.
type GeneratedKey struct {
	PrivateKeyPath string `json:"privateKeyPath"`
	PublicKeyPath  string `json:"publicKeyPath"`
	PublicKey      string `json:"publicKey"`
	Fingerprint    string `json:"fingerprint"`
	KeyType        string `json:"keyType"`
}

// GenerateKeyPair creates a REAL SSH key pair (ed25519 or rsa-4096), marshals the
// private key in OpenSSH format (optionally passphrase-encrypted), writes it to
// ~/.ssh with 0600 permissions and the public key with 0644, and returns the
// public key plus its SHA256 fingerprint. It never overwrites an existing key.
func GenerateKeyPair(keyType, comment, passphrase, outName string) (*GeneratedKey, error) {
	keyType = strings.ToLower(strings.TrimSpace(keyType))
	if keyType == "" {
		keyType = "ed25519"
	}
	comment = strings.TrimSpace(comment)
	if comment == "" {
		comment = "nexterm"
	}

	var privForMarshal interface{}
	var sshPub ssh.PublicKey

	switch keyType {
	case "ed25519":
		pub, priv, err := ed25519.GenerateKey(rand.Reader)
		if err != nil {
			return nil, fmt.Errorf("generate ed25519 key: %w", err)
		}
		privForMarshal = priv
		sshPub, err = ssh.NewPublicKey(pub)
		if err != nil {
			return nil, fmt.Errorf("derive public key: %w", err)
		}
	case "rsa":
		priv, err := rsa.GenerateKey(rand.Reader, 4096)
		if err != nil {
			return nil, fmt.Errorf("generate rsa key: %w", err)
		}
		privForMarshal = priv
		sshPub, err = ssh.NewPublicKey(&priv.PublicKey)
		if err != nil {
			return nil, fmt.Errorf("derive public key: %w", err)
		}
	default:
		return nil, fmt.Errorf("unsupported key type %q (use ed25519 or rsa)", keyType)
	}

	var block *pem.Block
	var err error
	if strings.TrimSpace(passphrase) != "" {
		block, err = ssh.MarshalPrivateKeyWithPassphrase(privForMarshal, comment, []byte(passphrase))
	} else {
		block, err = ssh.MarshalPrivateKey(privForMarshal, comment)
	}
	if err != nil {
		return nil, fmt.Errorf("marshal private key: %w", err)
	}
	privPEM := pem.EncodeToMemory(block)

	pubLine := strings.TrimSpace(string(ssh.MarshalAuthorizedKey(sshPub))) + " " + comment + "\n"

	home, err := os.UserHomeDir()
	if err != nil {
		return nil, fmt.Errorf("resolve home directory: %w", err)
	}
	sshDir := filepath.Join(home, ".ssh")
	if err := os.MkdirAll(sshDir, 0o700); err != nil {
		return nil, fmt.Errorf("create .ssh directory: %w", err)
	}

	base := sanitizeKeyName(outName)
	if base == "" {
		base = "id_" + keyType + "_nexterm"
	}
	privPath := filepath.Join(sshDir, base)
	pubPath := privPath + ".pub"

	// Never clobber an existing key.
	if _, statErr := os.Stat(privPath); statErr == nil {
		return nil, fmt.Errorf("a key already exists at %s — choose a different name", privPath)
	}

	if err := os.WriteFile(privPath, privPEM, 0o600); err != nil {
		return nil, fmt.Errorf("write private key: %w", err)
	}
	if err := os.WriteFile(pubPath, []byte(pubLine), 0o644); err != nil {
		return nil, fmt.Errorf("write public key: %w", err)
	}

	return &GeneratedKey{
		PrivateKeyPath: privPath,
		PublicKeyPath:  pubPath,
		PublicKey:      strings.TrimSpace(pubLine),
		Fingerprint:    ssh.FingerprintSHA256(sshPub),
		KeyType:        keyType,
	}, nil
}

// sanitizeKeyName reduces a user-supplied filename to a safe basename so a key
// cannot be written outside ~/.ssh via path traversal.
func sanitizeKeyName(s string) string {
	s = filepath.Base(strings.TrimSpace(s))
	var b strings.Builder
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '_', r == '-', r == '.':
			b.WriteRune(r)
		}
	}
	out := strings.TrimSpace(b.String())
	if out == "." || out == ".." {
		return ""
	}
	return strings.TrimSuffix(out, ".pub")
}
