//go:build darwin || linux

package pty

import (
	"fmt"
	"io"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"sync"

	"github.com/creack/pty"
)

// Terminal represents a running POSIX pseudo-terminal (PTY) session.
type Terminal struct {
	ptmx   *os.File
	cmd    *exec.Cmd
	pid    int
	mu     sync.Mutex
	closed bool
}

// Start launches a command line attached to a native POSIX PTY.
func Start(commandLine string, cols, rows int) (*Terminal, error) {
	if cols <= 0 {
		cols = 120
	}
	if rows <= 0 {
		rows = 30
	}

	var cmd *exec.Cmd
	trimmed := strings.TrimSpace(commandLine)
	parts := strings.Fields(trimmed)
	if len(parts) > 1 && !strings.ContainsAny(trimmed, ";&|><") {
		cmd = exec.Command(parts[0], parts[1:]...)
	} else if strings.ContainsAny(trimmed, ";&|><") {
		cmd = exec.Command("sh", "-c", trimmed)
	} else {
		cmd = exec.Command(trimmed)
	}

	// Ensure essential environment variables for interactive terminal emulation
	env := os.Environ()
	hasTerm := false
	for _, e := range env {
		if strings.HasPrefix(e, "TERM=") {
			hasTerm = true
			break
		}
	}
	if !hasTerm {
		env = append(env, "TERM=xterm-256color", "COLORTERM=truecolor")
	}

	// On macOS GUI bundles, launchd provides a minimal PATH (/usr/bin:/bin:/usr/sbin:/sbin).
	// Prepend standard Homebrew paths so user CLI utilities (brew, git, node, docker, etc.) are available.
	if runtime.GOOS == "darwin" {
		currentPath := os.Getenv("PATH")
		commonPaths := []string{"/opt/homebrew/bin", "/opt/homebrew/sbin", "/usr/local/bin"}
		for _, cp := range commonPaths {
			if !strings.Contains(currentPath, cp) {
				currentPath = cp + ":" + currentPath
			}
		}
		pathFound := false
		for i, e := range env {
			if strings.HasPrefix(e, "PATH=") {
				env[i] = "PATH=" + currentPath
				pathFound = true
				break
			}
		}
		if !pathFound {
			env = append(env, "PATH=" + currentPath)
		}
	}
	cmd.Env = env

	ws := &pty.Winsize{
		Cols: uint16(cols),
		Rows: uint16(rows),
		X:    0,
		Y:    0,
	}

	f, err := pty.StartWithSize(cmd, ws)
	if err != nil {
		return nil, fmt.Errorf("pty StartWithSize failed: %w", err)
	}

	term := &Terminal{
		ptmx: f,
		cmd:  cmd,
		pid:  cmd.Process.Pid,
	}

	// Reap the shell when it exits so it doesn't linger as a zombie.
	go func() { _ = cmd.Wait() }()

	return term, nil
}

// Write sends data to the PTY input stream.
func (t *Terminal) Write(p []byte) (n int, err error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.closed || t.ptmx == nil {
		return 0, io.ErrClosedPipe
	}
	return t.ptmx.Write(p)
}

// Read reads output from the PTY output stream.
func (t *Terminal) Read(p []byte) (n int, err error) {
	if t.ptmx == nil {
		return 0, io.ErrClosedPipe
	}
	return t.ptmx.Read(p)
}

// Pid returns the process ID of the child process.
func (t *Terminal) Pid() int {
	return t.pid
}

// Resize resizes the PTY window dimensions.
func (t *Terminal) Resize(cols, rows int) error {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.closed || t.ptmx == nil {
		return nil
	}
	if cols <= 0 {
		cols = 120
	}
	if rows <= 0 {
		rows = 30
	}
	ws := &pty.Winsize{
		Cols: uint16(cols),
		Rows: uint16(rows),
	}
	return pty.Setsize(t.ptmx, ws)
}

// Close terminates the pseudo terminal and cleans up resources.
func (t *Terminal) Close() error {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.closed {
		return nil
	}
	t.closed = true

	var lastErr error
	if t.ptmx != nil {
		if err := t.ptmx.Close(); err != nil {
			lastErr = err
		}
	}
	if t.cmd != nil && t.cmd.Process != nil {
		_ = t.cmd.Process.Kill()
	}
	return lastErr
}
