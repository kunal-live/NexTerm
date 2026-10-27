package main

import (
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"time"

	"nexterm/internal/service"
)

// AppendSessionLog appends terminal output for tabID to its log file, creating
// (and caching) the file on first write. Delegates to loggingService with per-tab
// locking so concurrent sessions don't block one another.
func (a *App) AppendSessionLog(tabID, serverName, data string) (string, error) {
	return a.loggingService.AppendSessionLog(tabID, serverName, data)
}

// redactLogData masks obvious inline secrets in terminal output before it is
// persisted to disk. Delegates to service.RedactLogData.
func redactLogData(data string) string {
	return service.RedactLogData(data)
}

// StopSessionLog closes and forgets the log file for tabID, returning its path.
func (a *App) StopSessionLog(tabID string) string {
	return a.loggingService.StopSessionLog(tabID)
}

// OpenSessionLogFolder opens the session-logs directory in the OS file manager.
func (a *App) OpenSessionLogFolder() error {
	dir := a.loggingService.SessionLogDir()
	_ = os.MkdirAll(dir, 0700)
	switch runtime.GOOS {
	case "windows":
		return exec.Command("explorer", dir).Start()
	case "darwin":
		return exec.Command("open", dir).Start()
	default:
		return exec.Command("xdg-open", dir).Start()
	}
}

// GetRecentLogs retrieves the most recent diagnostic log entries.
func (a *App) GetRecentLogs(count int) []service.LogEntry {
	return a.loggingService.GetRecentLogs(count)
}

// GetAuditLogs retrieves recent operational audit trail events.
func (a *App) GetAuditLogs(limit int) []service.AuditEvent {
	return a.loggingService.GetAuditLogs(limit)
}

// ExportAuditLogsJSON returns audit trail events serialized as JSON.
func (a *App) ExportAuditLogsJSON() (string, error) {
	return a.loggingService.ExportAuditJSON()
}

// ExportAuditLogsCSV returns audit trail events formatted as CSV.
func (a *App) ExportAuditLogsCSV() (string, error) {
	return a.loggingService.ExportAuditCSV()
}

// ClearAuditLogs empties the audit trail.
func (a *App) ClearAuditLogs() error {
	return a.loggingService.ClearAuditLogs()
}

// SaveTerminalOutput saves terminal scrollback buffer to a local text file.
func (a *App) SaveTerminalOutput(suggestedFilename, content string) (string, error) {
	if suggestedFilename == "" {
		suggestedFilename = fmt.Sprintf("terminal_transcript_%s.txt", time.Now().Format("20060102_150405"))
	}
	savePath, err := a.sftpService.SelectDownloadDest(a.ctx, suggestedFilename)
	if err != nil || savePath == "" {
		return "", err
	}

	if err := os.WriteFile(savePath, []byte(content), 0600); err != nil {
		return "", fmt.Errorf("failed to save terminal transcript: %w", err)
	}

	a.loggingService.LogAudit("TRANSCRIPT_SAVED", "terminal", "", "", "", "SUCCESS", savePath)
	return savePath, nil
}
