package service

import (
	"fmt"
	"nexterm/internal/pty"
	"os"
	"path/filepath"
	"runtime"
	"sync"

	"github.com/google/uuid"
)

// TerminalService manages native local pseudo-terminal shell sessions (ConPTY on Windows, POSIX PTY on macOS/Linux).
type TerminalService struct {
	mu              sync.Mutex
	localTabs       map[string]*pty.Terminal
	emitter         EventEmitter
	logService      *LoggingService
	onTerminalClose func(tabID string, title string)
}

// NewTerminalService constructs a new TerminalService.
func NewTerminalService(logService *LoggingService, emitter EventEmitter) *TerminalService {
	if emitter == nil {
		emitter = &NullEventEmitter{}
	}
	return &TerminalService{
		localTabs:  make(map[string]*pty.Terminal),
		emitter:    emitter,
		logService: logService,
	}
}

// SetOnTerminalClosed registers a callback for local terminal termination.
func (t *TerminalService) SetOnTerminalClosed(fn func(tabID string, title string)) {
	t.mu.Lock()
	t.onTerminalClose = fn
	t.mu.Unlock()
}

func defaultLocalShell() (string, string) {
	if runtime.GOOS == "windows" {
		return "powershell.exe", "Local PowerShell"
	}
	if userShell := os.Getenv("SHELL"); userShell != "" {
		base := filepath.Base(userShell)
		return userShell, fmt.Sprintf("Local Shell (%s)", base)
	}
	if runtime.GOOS == "darwin" {
		return "/bin/zsh", "Local Shell (zsh)"
	}
	return "/bin/bash", "Local Shell (bash)"
}

// OpenLocalTerminal launches a local shell via ConPTY (Windows) or POSIX PTY (macOS/Linux).
func (t *TerminalService) OpenLocalTerminal(shell string, cols, rows int) (string, string, error) {
	tabID := uuid.NewString()

	cmdLine, title := defaultLocalShell()
	if shell != "" && shell != "default" {
		if runtime.GOOS == "windows" {
			switch shell {
			case "cmd":
				cmdLine = "cmd.exe"
				title = "Local Command Prompt"
			case "bash":
				cmdLine = "bash.exe"
				title = "Local Bash"
			case "powershell":
				cmdLine = "powershell.exe"
				title = "Local PowerShell"
			default:
				cmdLine = shell
				title = fmt.Sprintf("Local Shell (%s)", filepath.Base(shell))
			}
		} else {
			switch shell {
			case "zsh":
				cmdLine = "/bin/zsh"
				title = "Local Shell (zsh)"
			case "bash":
				cmdLine = "/bin/bash"
				title = "Local Shell (bash)"
			case "sh":
				cmdLine = "/bin/sh"
				title = "Local Shell (sh)"
			default:
				cmdLine = shell
				title = fmt.Sprintf("Local Shell (%s)", filepath.Base(shell))
			}
		}
	}

	if cols <= 0 {
		cols = 120
	}
	if rows <= 0 {
		rows = 30
	}

	term, err := pty.Start(cmdLine, cols, rows)
	if err != nil {
		if t.logService != nil {
			t.logService.LogError("terminal", fmt.Sprintf("start local terminal failed: %s", shell), err)
		}
		return "", "", fmt.Errorf("start local pseudo terminal: %w", err)
	}

	// Register before the reader starts so a shell that exits immediately is
	// still removed from the map by the reader below.
	t.mu.Lock()
	t.localTabs[tabID] = term
	t.mu.Unlock()

	go func() {
		buf := make([]byte, 4096)
		for {
			n, err := term.Read(buf)
			if n > 0 {
				t.emitter.Emit("terminal:data:"+tabID, string(buf[:n]))
			}
			if err != nil {
				t.emitter.Emit("terminal:closed:"+tabID, "Local terminal exited")
				t.emitter.Emit("terminal:state:"+tabID, map[string]any{
					"state":   "Closed",
					"message": "Local terminal exited",
				})

				t.mu.Lock()
				delete(t.localTabs, tabID)
				hook := t.onTerminalClose
				t.mu.Unlock()

				// Release the pipes and process handles (no-op if Close already ran).
				_ = term.Close()

				if hook != nil {
					hook(tabID, title)
				}
				return
			}
		}
	}()

	if t.logService != nil {
		t.logService.LogSessionEvent(tabID, "started", fmt.Sprintf("Local terminal (%s)", title))
	}

	return tabID, title, nil
}

// Write transmits raw bytes to the local terminal process.
func (t *TerminalService) Write(tabID string, data []byte) error {
	t.mu.Lock()
	term, ok := t.localTabs[tabID]
	t.mu.Unlock()

	if !ok || term == nil {
		return fmt.Errorf("local terminal not found: %s", tabID)
	}
	_, err := term.Write(data)
	return err
}

// Resize updates the console dimensions of the ConPTY handle.
func (t *TerminalService) Resize(tabID string, cols, rows int) error {
	t.mu.Lock()
	term, ok := t.localTabs[tabID]
	t.mu.Unlock()

	if !ok || term == nil {
		return fmt.Errorf("terminal session not found: %s", tabID)
	}
	return term.Resize(cols, rows)
}

// Close terminates the local terminal process.
func (t *TerminalService) Close(tabID string) error {
	t.mu.Lock()
	term, ok := t.localTabs[tabID]
	if ok && term != nil {
		delete(t.localTabs, tabID)
	}
	t.mu.Unlock()

	if ok && term != nil {
		return term.Close()
	}
	return nil
}

// Has returns true if the tabID belongs to an active local terminal.
func (t *TerminalService) Has(tabID string) bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	_, ok := t.localTabs[tabID]
	return ok
}

// Broadcast sends input bytes to all active local terminals.
func (t *TerminalService) Broadcast(data []byte) {
	t.mu.Lock()
	defer t.mu.Unlock()
	for _, term := range t.localTabs {
		if term != nil {
			_, _ = term.Write(data)
		}
	}
}

// ActiveTabIDs returns a slice of currently open local terminal tab IDs.
func (t *TerminalService) ActiveTabIDs() []string {
	t.mu.Lock()
	defer t.mu.Unlock()
	ids := make([]string, 0, len(t.localTabs))
	for id := range t.localTabs {
		ids = append(ids, id)
	}
	return ids
}
