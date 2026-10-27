package service

import (
	"bytes"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/google/uuid"
)

// LogLevel denotes log severity.
type LogLevel string

const (
	LogLevelInfo  LogLevel = "INFO"
	LogLevelWarn  LogLevel = "WARN"
	LogLevelError LogLevel = "ERROR"
	LogLevelDebug LogLevel = "DEBUG"
)

// LogEntry represents a single diagnostic log event.
type LogEntry struct {
	Timestamp time.Time              `json:"timestamp"`
	Level     LogLevel               `json:"level"`
	Category  string                 `json:"category"`
	Message   string                 `json:"message"`
	Details   map[string]interface{} `json:"details,omitempty"`
}

// AuditEvent represents an immutable, high-security operational audit event (GAP-11).
type AuditEvent struct {
	ID        string    `json:"id"`
	Timestamp time.Time `json:"timestamp"`
	Action    string    `json:"action"` // e.g. SSH_CONNECTED, SSH_DISCONNECTED, AUTH_FAILED, FILE_UPLOADED, FILE_DOWNLOADED, FILE_DELETED, TUNNEL_STARTED, PASSWORD_SAVED, POLICY_DENIED
	Protocol  string    `json:"protocol,omitempty"`
	Host      string    `json:"host,omitempty"`
	Username  string    `json:"username,omitempty"`
	SessionID string    `json:"sessionId,omitempty"`
	Result    string    `json:"result"` // "SUCCESS", "FAILURE", "DENIED"
	Details   string    `json:"details,omitempty"`
}

// LoggingService manages session recording, audit logging, and in-memory diagnostic logs.
type LoggingService struct {
	mu            sync.RWMutex
	entries       []LogEntry
	maxEntries    int
	auditEvents   []AuditEvent
	maxAudit      int
	auditFilePath string
	sessionLogs   *SessionLogManager
	emitter       EventEmitter
}

// NewLoggingService creates a new LoggingService instance.
func NewLoggingService(emitter EventEmitter) *LoggingService {
	if emitter == nil {
		emitter = &NullEventEmitter{}
	}

	appData, err := os.UserConfigDir()
	if err != nil {
		appData = "."
	}
	dir := filepath.Join(appData, "Nexterm")
	_ = os.MkdirAll(dir, 0700)
	auditPath := filepath.Join(dir, "audit_log.jsonl")
	logDir := filepath.Join(dir, "session_logs")

	svc := &LoggingService{
		entries:       make([]LogEntry, 0, 500),
		maxEntries:    1000,
		auditEvents:   make([]AuditEvent, 0, 500),
		maxAudit:      2000,
		auditFilePath: auditPath,
		sessionLogs:   NewSessionLogManager(logDir),
		emitter:       emitter,
	}

	// Pre-load recent audit events from disk if present
	svc.loadAuditTrail()
	return svc
}

func (l *LoggingService) loadAuditTrail() {
	data, err := os.ReadFile(l.auditFilePath)
	if err != nil {
		return
	}
	_ = os.Chmod(l.auditFilePath, 0600)

	lines := bytes.Split(data, []byte("\n"))
	for _, line := range lines {
		trimmed := bytes.TrimSpace(line)
		if len(trimmed) == 0 {
			continue
		}
		var ev AuditEvent
		if err := json.Unmarshal(trimmed, &ev); err == nil {
			l.auditEvents = append(l.auditEvents, ev)
			if len(l.auditEvents) > l.maxAudit {
				l.auditEvents = l.auditEvents[1:]
			}
		}
	}
}

func (l *LoggingService) log(level LogLevel, category, message string, details map[string]interface{}) {
	entry := LogEntry{
		Timestamp: time.Now(),
		Level:     level,
		Category:  category,
		Message:   message,
		Details:   details,
	}

	l.mu.Lock()
	if len(l.entries) >= l.maxEntries {
		l.entries = l.entries[1:]
	}
	l.entries = append(l.entries, entry)
	l.mu.Unlock()

	l.emitter.Emit("app:log", entry)
}

func (l *LoggingService) LogInfo(category, message string) {
	l.log(LogLevelInfo, category, message, nil)
}

func (l *LoggingService) LogWarn(category, message string) {
	l.log(LogLevelWarn, category, message, nil)
}

func (l *LoggingService) LogDebug(category, message string) {
	l.log(LogLevelDebug, category, message, nil)
}

func (l *LoggingService) LogError(category, message string, err error) {
	var details map[string]interface{}
	if err != nil {
		details = map[string]interface{}{"error": err.Error()}
	}
	l.log(LogLevelError, category, message, details)
}

func (l *LoggingService) LogSessionEvent(tabID, event, message string) {
	details := map[string]interface{}{
		"tabId": tabID,
		"event": event,
	}
	l.log(LogLevelInfo, "session", fmt.Sprintf("[%s] %s: %s", tabID, event, message), details)
}

// LogAudit persists an immutable audit event to disk and in-memory cache (GAP-11).
func (l *LoggingService) LogAudit(action, protocol, host, username, sessionID, result, details string) {
	ev := AuditEvent{
		ID:        uuid.NewString(),
		Timestamp: time.Now(),
		Action:    action,
		Protocol:  protocol,
		Host:      host,
		Username:  username,
		SessionID: sessionID,
		Result:    result,
		Details:   details,
	}

	l.mu.Lock()
	if len(l.auditEvents) >= l.maxAudit {
		l.auditEvents = l.auditEvents[1:]
	}
	l.auditEvents = append(l.auditEvents, ev)

	// Append-only write to audit_log.jsonl with 0600 permissions
	if raw, err := json.Marshal(ev); err == nil {
		f, err := os.OpenFile(l.auditFilePath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0600)
		if err == nil {
			_, _ = f.Write(append(raw, '\n'))
			_ = f.Close()
			_ = os.Chmod(l.auditFilePath, 0600)
		}
	}
	l.mu.Unlock()

	l.emitter.Emit("app:audit", ev)
}

// GetAuditLogs returns the most recent N audit events.
func (l *LoggingService) GetAuditLogs(limit int) []AuditEvent {
	l.mu.RLock()
	defer l.mu.RUnlock()

	n := len(l.auditEvents)
	if limit <= 0 || limit > n {
		limit = n
	}
	start := n - limit
	res := make([]AuditEvent, limit)
	copy(res, l.auditEvents[start:])
	return res
}

// ExportAuditJSON returns all audit events formatted as pretty JSON.
func (l *LoggingService) ExportAuditJSON() (string, error) {
	l.mu.RLock()
	defer l.mu.RUnlock()

	data, err := json.MarshalIndent(l.auditEvents, "", "  ")
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// ExportAuditCSV returns all audit events formatted as RFC 4180 CSV.
func (l *LoggingService) ExportAuditCSV() (string, error) {
	l.mu.RLock()
	defer l.mu.RUnlock()

	var buf bytes.Buffer
	w := csv.NewWriter(&buf)

	// Write header
	_ = w.Write([]string{"ID", "Timestamp", "Action", "Protocol", "Host", "Username", "SessionID", "Result", "Details"})

	for _, ev := range l.auditEvents {
		_ = w.Write([]string{
			ev.ID,
			ev.Timestamp.Format(time.RFC3339),
			ev.Action,
			ev.Protocol,
			ev.Host,
			ev.Username,
			ev.SessionID,
			ev.Result,
			ev.Details,
		})
	}
	w.Flush()
	return buf.String(), w.Error()
}

// ClearAuditLogs empties the audit trail.
func (l *LoggingService) ClearAuditLogs() error {
	l.mu.Lock()
	defer l.mu.Unlock()

	l.auditEvents = l.auditEvents[:0]
	return os.WriteFile(l.auditFilePath, []byte{}, 0600)
}

// GetRecentLogs retrieves the most recent N log entries.
func (l *LoggingService) GetRecentLogs(count int) []LogEntry {
	l.mu.RLock()
	defer l.mu.RUnlock()

	n := len(l.entries)
	if count <= 0 || count > n {
		count = n
	}

	start := n - count
	result := make([]LogEntry, count)
	copy(result, l.entries[start:])
	return result
}

// ClearLogs clears all in-memory log entries.
func (l *LoggingService) ClearLogs() {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.entries = l.entries[:0]
}

// AppendSessionLog writes terminal output for tabID to its transcript file.
func (l *LoggingService) AppendSessionLog(tabID, serverName, data string) (string, error) {
	if l == nil || l.sessionLogs == nil {
		return "", fmt.Errorf("logging service uninitialized")
	}
	return l.sessionLogs.Append(tabID, serverName, data)
}

// StopSessionLog closes and forgets the transcript log file for tabID, preventing handle leaks.
func (l *LoggingService) StopSessionLog(tabID string) string {
	if l == nil || l.sessionLogs == nil {
		return ""
	}
	return l.sessionLogs.Stop(tabID)
}

// StopAllSessionLogs closes all active session transcript files.
func (l *LoggingService) StopAllSessionLogs() {
	if l != nil && l.sessionLogs != nil {
		l.sessionLogs.StopAll()
	}
}

// SessionLogDir returns the path to the session transcript directory.
func (l *LoggingService) SessionLogDir() string {
	if l == nil || l.sessionLogs == nil {
		return ""
	}
	return l.sessionLogs.LogDir()
}

// ActiveSessionLogCount returns the number of active session transcript files.
func (l *LoggingService) ActiveSessionLogCount() int {
	if l == nil || l.sessionLogs == nil {
		return 0
	}
	return l.sessionLogs.ActiveLogCount()
}

