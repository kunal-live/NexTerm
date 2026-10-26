package hostkey

import (
	"bufio"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"

	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/knownhosts"
)

// HostKeyStatus represents the verification state of a host key.
type HostKeyStatus string

const (
	StatusTrusted  HostKeyStatus = "trusted"
	StatusUnknown  HostKeyStatus = "unknown"
	StatusMismatch HostKeyStatus = "mismatch"
	StatusRevoked  HostKeyStatus = "revoked"
)

// CheckResult contains detailed host key verification metadata.
type CheckResult struct {
	Status            HostKeyStatus `json:"status"`
	Host              string        `json:"host"`
	Port              int           `json:"port"`
	NormalizedAddr    string        `json:"normalizedAddr"`
	KeyType           string        `json:"keyType"`
	FingerprintSHA256 string        `json:"fingerprintSha256"`
	FingerprintMD5    string        `json:"fingerprintMd5"`
	OldKeyType        string        `json:"oldKeyType,omitempty"`
	OldFingerprintSHA string        `json:"oldFingerprintSha,omitempty"`
	OldFingerprintMD5 string        `json:"oldFingerprintMd5,omitempty"`
	KnownHostsPath    string        `json:"knownHostsPath"`
	Message           string        `json:"message,omitempty"`
}

// HostKeyEntry represents a parsed entry from known_hosts.
type HostKeyEntry struct {
	Host        string `json:"host"`
	KeyType     string `json:"keyType"`
	Fingerprint string `json:"fingerprint"`
	SourceFile  string `json:"sourceFile"`
	LineNumber  int    `json:"lineNumber"`
}

// Manager coordinates reading, checking, and writing SSH known_hosts files.
type Manager struct {
	mu             sync.RWMutex
	appHostsPath   string
	systemHostPath string
	cachedCallback ssh.HostKeyCallback
}

var (
	defaultManager *Manager
	once           sync.Once
)

// DefaultKnownHostsPath returns the application-specific known_hosts path in AppData.
func DefaultKnownHostsPath() string {
	appData, err := os.UserConfigDir()
	if err != nil || appData == "" {
		appData = "."
	}
	return filepath.Join(appData, "Nexterm", "known_hosts")
}

// SystemKnownHostsPath returns the standard ~/.ssh/known_hosts path if it exists.
func SystemKnownHostsPath() string {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return ""
	}
	path := filepath.Join(home, ".ssh", "known_hosts")
	if _, err := os.Stat(path); err == nil {
		return path
	}
	return ""
}

// GetDefaultManager returns a shared singleton hostkey Manager.
func GetDefaultManager() *Manager {
	once.Do(func() {
		appPath := DefaultKnownHostsPath()
		sysPath := SystemKnownHostsPath()
		defaultManager = NewManager(appPath, sysPath)
	})
	return defaultManager
}

// NewManager creates a Manager targeting specific known_hosts files.
func NewManager(appHostsPath, systemHostPath string) *Manager {
	m := &Manager{
		appHostsPath:   appHostsPath,
		systemHostPath: systemHostPath,
	}
	_ = m.ensureFiles()
	_ = m.reload()
	return m
}

func (m *Manager) ensureFiles() error {
	dir := filepath.Dir(m.appHostsPath)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return fmt.Errorf("create known_hosts dir: %w", err)
	}
	f, err := os.OpenFile(m.appHostsPath, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return fmt.Errorf("open known_hosts file: %w", err)
	}
	_ = f.Close()
	return nil
}

func (m *Manager) reload() error {
	var files []string
	if m.appHostsPath != "" {
		if _, err := os.Stat(m.appHostsPath); err == nil {
			files = append(files, m.appHostsPath)
		}
	}
	if m.systemHostPath != "" {
		if _, err := os.Stat(m.systemHostPath); err == nil {
			files = append(files, m.systemHostPath)
		}
	}

	if len(files) == 0 {
		m.cachedCallback = nil
		return nil
	}

	cb, err := knownhosts.New(files...)
	if err != nil {
		return err
	}
	m.cachedCallback = cb
	return nil
}

// Check inspects whether the presented public key is known, trusted, or altered.
func (m *Manager) Check(hostname string, remote net.Addr, key ssh.PublicKey) (*CheckResult, error) {
	m.mu.Lock()
	if m.cachedCallback == nil {
		_ = m.reload()
	}
	cb := m.cachedCallback
	m.mu.Unlock()

	host, portStr, err := net.SplitHostPort(hostname)
	port := 22
	if err == nil {
		if p, convErr := strconv.Atoi(portStr); convErr == nil {
			port = p
		}
	} else {
		host = hostname
	}

	normalized := knownhosts.Normalize(hostname)
	sha256Fp := ssh.FingerprintSHA256(key)
	md5Fp := ssh.FingerprintLegacyMD5(key)

	res := &CheckResult{
		Host:              host,
		Port:              port,
		NormalizedAddr:    normalized,
		KeyType:           key.Type(),
		FingerprintSHA256: sha256Fp,
		FingerprintMD5:    md5Fp,
		KnownHostsPath:    m.appHostsPath,
	}

	if cb == nil {
		res.Status = StatusUnknown
		res.Message = "known_hosts file is uninitialized"
		return res, nil
	}

	chkErr := cb(hostname, remote, key)
	if chkErr == nil {
		res.Status = StatusTrusted
		return res, nil
	}

	var keyErr *knownhosts.KeyError
	if errors.As(chkErr, &keyErr) {
		if len(keyErr.Want) == 0 {
			res.Status = StatusUnknown
			res.Message = fmt.Sprintf("The authenticity of host '%s' can't be established.", hostname)
			return res, nil
		}

		// A true mismatch only occurs if a stored key of the SAME key type has changed
		var matchingOldKey ssh.PublicKey
		hasMatchingType := false
		for _, want := range keyErr.Want {
			if want.Key.Type() == key.Type() {
				hasMatchingType = true
				matchingOldKey = want.Key
				break
			}
		}

		if hasMatchingType && matchingOldKey != nil {
			// Host key mismatch for same key type - potential MITM attack!
			res.Status = StatusMismatch
			res.OldKeyType = matchingOldKey.Type()
			res.OldFingerprintSHA = ssh.FingerprintSHA256(matchingOldKey)
			res.OldFingerprintMD5 = ssh.FingerprintLegacyMD5(matchingOldKey)
			res.Message = fmt.Sprintf("WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED for '%s'!", hostname)
			return res, nil
		}

		// Different host key algorithm for an existing host
		res.Status = StatusUnknown
		res.Message = fmt.Sprintf("The authenticity of host '%s' (%s) can't be established.", hostname, key.Type())
		return res, nil
	}

	var revErr *knownhosts.RevokedError
	if errors.As(chkErr, &revErr) {
		res.Status = StatusRevoked
		res.Message = fmt.Sprintf("Host key for '%s' has been explicitly revoked.", hostname)
		return res, nil
	}

	// Any other error
	res.Status = StatusUnknown
	res.Message = chkErr.Error()
	return res, nil
}

// GetAlgorithmsForHost returns known public key algorithm types for the given host and port.
func (m *Manager) GetAlgorithmsForHost(hostname string, port int) []string {
	if port <= 0 {
		port = 22
	}
	addr := net.JoinHostPort(hostname, strconv.Itoa(port))
	normAddr := knownhosts.Normalize(addr)
	normHost := knownhosts.Normalize(hostname)

	entries, err := m.List()
	if err != nil {
		return nil
	}

	var algos []string
	seen := make(map[string]bool)
	for _, entry := range entries {
		hosts := strings.Split(entry.Host, ",")
		matched := false
		for _, h := range hosts {
			hTrim := strings.TrimSpace(h)
			if hTrim == normAddr || hTrim == normHost || hTrim == hostname || hTrim == addr {
				matched = true
				break
			}
		}
		if matched && entry.KeyType != "" && !seen[entry.KeyType] {
			algos = append(algos, entry.KeyType)
			seen[entry.KeyType] = true
		}
	}
	return algos
}

// Add persists the host and public key to the application-specific known_hosts file.
func (m *Manager) Add(hostname string, remote net.Addr, key ssh.PublicKey) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if err := m.ensureFiles(); err != nil {
		return err
	}

	// Use normalized address (e.g. "example.com" or "[example.com]:2222")
	normAddr := knownhosts.Normalize(hostname)
	addresses := []string{normAddr}
	if remote != nil {
		remoteNorm := knownhosts.Normalize(remote.String())
		if remoteNorm != normAddr && remoteNorm != "" {
			addresses = append(addresses, remoteNorm)
		}
	}

	line := knownhosts.Line(addresses, key)
	if !strings.HasSuffix(line, "\n") {
		line += "\n"
	}

	f, err := os.OpenFile(m.appHostsPath, os.O_APPEND|os.O_WRONLY|os.O_CREATE, 0600)
	if err != nil {
		return fmt.Errorf("open known_hosts for append: %w", err)
	}
	defer f.Close()

	if _, err := f.WriteString(line); err != nil {
		return fmt.Errorf("write host key: %w", err)
	}

	return m.reload()
}

// Remove removes any existing host key entry matching the normalized address from the app's known_hosts file.
func (m *Manager) Remove(hostname string, port int) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if port <= 0 {
		port = 22
	}
	addr := net.JoinHostPort(hostname, strconv.Itoa(port))
	normAddr := knownhosts.Normalize(addr)

	if _, err := os.Stat(m.appHostsPath); os.IsNotExist(err) {
		return nil
	}

	content, err := os.ReadFile(m.appHostsPath)
	if err != nil {
		return fmt.Errorf("read known_hosts: %w", err)
	}

	lines := strings.Split(string(content), "\n")
	var kept []string

	for _, l := range lines {
		trimmed := strings.TrimSpace(l)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			kept = append(kept, l)
			continue
		}
		parts := strings.Fields(trimmed)
		if len(parts) < 2 {
			kept = append(kept, l)
			continue
		}
		hostPart := parts[0]
		hostsInLine := strings.Split(hostPart, ",")
		matched := false
		for _, h := range hostsInLine {
			if h == normAddr || h == hostname || h == addr {
				matched = true
				break
			}
		}
		if !matched {
			kept = append(kept, l)
		}
	}

	newContent := strings.Join(kept, "\n")
	if err := os.WriteFile(m.appHostsPath, []byte(newContent), 0600); err != nil {
		return fmt.Errorf("write known_hosts: %w", err)
	}

	return m.reload()
}

// Replace removes old entries for the host and writes the new key.
func (m *Manager) Replace(hostname string, remote net.Addr, key ssh.PublicKey) error {
	host, portStr, err := net.SplitHostPort(hostname)
	port := 22
	if err == nil {
		if p, convErr := strconv.Atoi(portStr); convErr == nil {
			port = p
		}
	} else {
		host = hostname
	}

	_ = m.Remove(host, port)
	return m.Add(hostname, remote, key)
}

// List returns parsed known_hosts entries for display and management.
func (m *Manager) List() ([]HostKeyEntry, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var entries []HostKeyEntry
	files := []string{m.appHostsPath}
	if m.systemHostPath != "" {
		files = append(files, m.systemHostPath)
	}

	for _, filePath := range files {
		f, err := os.Open(filePath)
		if err != nil {
			continue
		}
		scanner := bufio.NewScanner(f)
		lineNum := 0
		for scanner.Scan() {
			lineNum++
			line := strings.TrimSpace(scanner.Text())
			if line == "" || strings.HasPrefix(line, "#") {
				continue
			}
			parts := strings.Fields(line)
			if len(parts) < 2 {
				continue
			}

			pubKeyBytes := []byte(strings.Join(parts[1:], " "))
			pubKey, _, _, _, err := ssh.ParseAuthorizedKey(pubKeyBytes)
			fp := ""
			kType := parts[1]
			if err == nil && pubKey != nil {
				fp = ssh.FingerprintSHA256(pubKey)
				kType = pubKey.Type()
			}

			entries = append(entries, HostKeyEntry{
				Host:        parts[0],
				KeyType:     kType,
				Fingerprint: fp,
				SourceFile:  filePath,
				LineNumber:  lineNum,
			})
		}
		if err := scanner.Err(); err != nil {
			// Scan encountered a read error; proceed with entries parsed so far
			_ = err
		}
		_ = f.Close()
	}

	return entries, nil
}
