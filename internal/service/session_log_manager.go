package service

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

var (
	// mysqlPasswordPattern matches mysql or mysqldump with inline -p<pass> flag.
	mysqlPasswordPattern = regexp.MustCompile(`(?i)\b(mysql(?:dump)?\b[^\r\n]*?\s+-p)(\S+)`)
	// sshpassPasswordPattern matches sshpass with -p <pass> flag.
	sshpassPasswordPattern = regexp.MustCompile(`(?i)\b(sshpass\b[^\r\n]*?\s+-p\s*)(\S+)`)
	// generalSecretPattern matches explicit flag, assignment, or header patterns.
	// Requires an explicit ':' or '=' for keywords to avoid redacting natural prose.
	// Bare '-p' is excluded to prevent mangling mkdir -p, ls -print, grep -pattern, etc.
	generalSecretPattern = regexp.MustCompile(`(?i)(--password[=\s]+|--passwd[=\s]+|(?:password|passwd|secret|api[_-]?key|(?:access|auth|refresh|bearer)?[_-]?token)\s*[:=]\s*|bearer\s+)(\S+)`)
)

// RedactLogData masks obvious inline secrets in terminal output before it is
// persisted to disk. It is best-effort but protects credentials typed on command lines.
func RedactLogData(data string) string {
	if data == "" {
		return data
	}
	out := mysqlPasswordPattern.ReplaceAllString(data, "${1}[REDACTED]")
	out = sshpassPasswordPattern.ReplaceAllString(out, "${1}[REDACTED]")
	out = generalSecretPattern.ReplaceAllString(out, "${1}[REDACTED]")
	return out
}

func sanitizeLogName(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		s = "session"
	}
	var b strings.Builder
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' || r == '.' {
			b.WriteRune(r)
		} else {
			b.WriteRune('_')
		}
	}
	return b.String()
}

// sessionLogHandle encapsulates a single open log file with its own mutex,
// eliminating global lock contention across busy sessions.
type sessionLogHandle struct {
	mu   sync.Mutex
	file *os.File
	path string
}

// SessionLogManager manages active session transcript files per tab with fine-grained synchronization.
type SessionLogManager struct {
	mu    sync.RWMutex
	files map[string]*sessionLogHandle
	dir   string
}

// NewSessionLogManager creates a new SessionLogManager.
func NewSessionLogManager(logDir string) *SessionLogManager {
	if logDir == "" {
		appData, err := os.UserConfigDir()
		if err != nil {
			appData = "."
		}
		logDir = filepath.Join(appData, "Nexterm", "session_logs")
	}
	return &SessionLogManager{
		files: make(map[string]*sessionLogHandle),
		dir:   logDir,
	}
}

// LogDir returns the active session log directory path.
func (m *SessionLogManager) LogDir() string {
	return m.dir
}

// Append writes terminal output for tabID to its log file.
// Creating the file occurs under a manager write lock; writing output
// holds only the tab's handle lock, so busy tabs do not block one another.
func (m *SessionLogManager) Append(tabID, serverName, data string) (string, error) {
	m.mu.RLock()
	handle, ok := m.files[tabID]
	m.mu.RUnlock()

	if !ok {
		m.mu.Lock()
		// Double-check under lock
		handle, ok = m.files[tabID]
		if !ok {
			if err := os.MkdirAll(m.dir, 0o700); err != nil {
				m.mu.Unlock()
				return "", err
			}
			ts := time.Now().Format("20060102_150405")
			path := filepath.Join(m.dir, fmt.Sprintf("%s_%s.log", sanitizeLogName(serverName), ts))
			nf, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
			if err != nil {
				m.mu.Unlock()
				return "", err
			}
			_, _ = nf.WriteString(fmt.Sprintf("===== NexTerm session log: %s — started %s =====\n", serverName, time.Now().Format(time.RFC1123)))
			handle = &sessionLogHandle{file: nf, path: path}
			m.files[tabID] = handle
		}
		m.mu.Unlock()
	}

	handle.mu.Lock()
	defer handle.mu.Unlock()

	if _, err := handle.file.WriteString(RedactLogData(data)); err != nil {
		return handle.path, err
	}
	return handle.path, nil
}

// Stop closes and cleans up the transcript log file for tabID, preventing file handle leaks.
func (m *SessionLogManager) Stop(tabID string) string {
	m.mu.Lock()
	handle, ok := m.files[tabID]
	if ok {
		delete(m.files, tabID)
	}
	m.mu.Unlock()

	if !ok || handle == nil {
		return ""
	}

	handle.mu.Lock()
	defer handle.mu.Unlock()

	if handle.file != nil {
		_, _ = handle.file.WriteString(fmt.Sprintf("\n===== NexTerm log closed %s =====\n", time.Now().Format(time.RFC1123)))
		_ = handle.file.Close()
	}
	return handle.path
}

// StopAll closes all currently open session log files, ensuring no handle leaks on shutdown.
func (m *SessionLogManager) StopAll() {
	m.mu.Lock()
	handles := make([]*sessionLogHandle, 0, len(m.files))
	for k, h := range m.files {
		handles = append(handles, h)
		delete(m.files, k)
	}
	m.mu.Unlock()

	for _, h := range handles {
		h.mu.Lock()
		if h.file != nil {
			_, _ = h.file.WriteString(fmt.Sprintf("\n===== NexTerm log closed %s =====\n", time.Now().Format(time.RFC1123)))
			_ = h.file.Close()
		}
		h.mu.Unlock()
	}
}

// ActiveLogCount returns the number of currently open session log files.
func (m *SessionLogManager) ActiveLogCount() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return len(m.files)
}
