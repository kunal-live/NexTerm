package sshsession

import (
	"bytes"
	"crypto/rsa"
	"errors"
	"fmt"
	"os"
	"strings"

	"golang.org/x/crypto/ssh"
)

// KeyInfo holds inspection details for an SSH private key.
type KeyInfo struct {
	Valid            bool   `json:"valid"`
	Path             string `json:"path,omitempty"`
	KeyType          string `json:"keyType"`     // e.g. "RSA 2048-bit", "ED25519", "ECDSA P-256"
	Fingerprint      string `json:"fingerprint"` // e.g. "SHA256:..."
	Encrypted        bool   `json:"encrypted"`   // requires passphrase
	Comment          string `json:"comment,omitempty"`
	HasCertificate   bool   `json:"hasCertificate,omitempty"`
	CertificateType  string `json:"certificateType,omitempty"`
	CertificateKeyID string `json:"certificateKeyId,omitempty"`
	Error            string `json:"error,omitempty"`
}

// ValidatePrivateKey reads a key file from disk and inspects its validity, type, and encryption.
func ValidatePrivateKey(keyPath string, passphrase string) (*KeyInfo, error) {
	if keyPath == "" {
		return &KeyInfo{Valid: false, Error: "private key path is empty"}, errors.New("empty key path")
	}

	keyPath = ExpandUserPath(keyPath)
	data, err := os.ReadFile(keyPath)
	if err != nil {
		info := &KeyInfo{
			Valid: false,
			Path:  keyPath,
			Error: fmt.Sprintf("cannot read file: %v", err),
		}
		return info, err
	}

	info, err := InspectPrivateKeyData(data, passphrase)
	info.Path = keyPath

	// Check if an associated OpenSSH Certificate (<keyPath>-cert.pub) exists
	certPath := keyPath + "-cert.pub"
	if cData, cErr := os.ReadFile(certPath); cErr == nil {
		if pubKey, _, _, _, pErr := ssh.ParseAuthorizedKey(cData); pErr == nil {
			if cert, ok := pubKey.(*ssh.Certificate); ok {
				info.HasCertificate = true
				info.CertificateType = cert.Type()
				info.CertificateKeyID = cert.KeyId
			}
		}
	}

	return info, err
}

// InspectPrivateKeyData inspects raw private key bytes.
func InspectPrivateKeyData(data []byte, passphrase string) (*KeyInfo, error) {
	info := &KeyInfo{
		Valid: false,
	}

	trimmed := bytes.TrimSpace(data)
	if len(trimmed) == 0 {
		info.Error = "private key data is empty"
		return info, errors.New(info.Error)
	}

	// Detect PuTTY PPK format
	if bytes.HasPrefix(trimmed, []byte("PuTTY-User-Key-File-")) {
		info.KeyType = "PuTTY PPK"
		info.Encrypted = bytes.Contains(trimmed, []byte("Encryption: aes"))
		info.Error = "PuTTY PPK format detected: please convert to OpenSSH format using PuTTYgen or export OpenSSH key"
		return info, errors.New(info.Error)
	}

	// Detect encryption markers in PEM/OpenSSH headers
	isEncrypted := bytes.Contains(trimmed, []byte("Proc-Type: 4,ENCRYPTED")) ||
		bytes.Contains(trimmed, []byte("BEGIN ENCRYPTED PRIVATE KEY"))

	if bytes.Contains(trimmed, []byte("BEGIN OPENSSH PRIVATE KEY")) {
		// OpenSSH v1 format: if cipher != "none", it's encrypted
		if !bytes.Contains(trimmed, []byte("none")) {
			isEncrypted = true
		}
	}
	info.Encrypted = isEncrypted

	var signer ssh.Signer
	var parseErr error

	if passphrase != "" {
		signer, parseErr = ssh.ParsePrivateKeyWithPassphrase(trimmed, []byte(passphrase))
	} else {
		signer, parseErr = ssh.ParsePrivateKey(trimmed)
	}

	if parseErr != nil {
		if errors.Is(parseErr, &ssh.PassphraseMissingError{}) ||
			strings.Contains(parseErr.Error(), "passphrase") ||
			strings.Contains(parseErr.Error(), "encrypted") {
			info.Encrypted = true
			info.Error = "private key is encrypted (passphrase required)"
			return info, nil
		}
		if passphrase != "" && (strings.Contains(parseErr.Error(), "decryption") || strings.Contains(parseErr.Error(), "incorrect")) {
			info.Encrypted = true
			info.Error = "incorrect passphrase for encrypted private key"
			return info, nil
		}
		info.Error = parseErr.Error()
		return info, parseErr
	}

	pubKey := signer.PublicKey()
	info.Valid = true
	info.Fingerprint = ssh.FingerprintSHA256(pubKey)
	info.KeyType = formatKeyType(pubKey)

	return info, nil
}

func formatKeyType(pubKey ssh.PublicKey) string {
	rawType := pubKey.Type()
	switch rawType {
	case "ssh-rsa":
		if cryptoKey, ok := pubKey.(ssh.CryptoPublicKey); ok {
			if rsaPub, ok := cryptoKey.CryptoPublicKey().(*rsa.PublicKey); ok {
				return fmt.Sprintf("RSA %d-bit", rsaPub.N.BitLen())
			}
		}
		return "RSA"
	case "ssh-ed25519":
		return "ED25519 (256-bit)"
	case "ecdsa-sha2-nistp256":
		return "ECDSA P-256"
	case "ecdsa-sha2-nistp384":
		return "ECDSA P-384"
	case "ecdsa-sha2-nistp521":
		return "ECDSA P-521"
	case "ssh-dss":
		return "DSA 1024-bit"
	default:
		return rawType
	}
}
