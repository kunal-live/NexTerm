package service

import (
	"context"
	"fmt"
	sftpmanager "nexterm/internal/sftp"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

type externalFileWatch struct {
	tabID       string
	remotePath  string
	localPath   string
	lastModTime time.Time
	stopChan    chan struct{}
}

// SFTPListResult wraps directory listing results.
type SFTPListResult struct {
	Path  string                 `json:"path"`
	Items []sftpmanager.SFTPItem `json:"items"`
}

// SFTPService handles local and remote SFTP file operations, file watchers, and external app editing.
type SFTPService struct {
	connMgr      *ConnectionManager
	sftpMgr      *sftpmanager.SFTPManager
	emitter      EventEmitter
	watcherMu    sync.Mutex
	fileWatchers map[string]*externalFileWatch
}

// NewSFTPService constructs a new SFTPService.
func NewSFTPService(connMgr *ConnectionManager, emitter EventEmitter) *SFTPService {
	if emitter == nil {
		emitter = &NullEventEmitter{}
	}
	return &SFTPService{
		connMgr:      connMgr,
		sftpMgr:      sftpmanager.NewSFTPManager(),
		emitter:      emitter,
		fileWatchers: make(map[string]*externalFileWatch),
	}
}

// SFTPManager returns the raw SFTPManager instance.
func (s *SFTPService) SFTPManager() *sftpmanager.SFTPManager {
	return s.sftpMgr
}

// List lists files in the given remote directory.
func (s *SFTPService) List(tabID, remotePath string) (*SFTPListResult, error) {
	client := s.connMgr.GetSSHClient(tabID)
	if client == nil {
		return nil, fmt.Errorf("active SSH session not found for tab %s", tabID)
	}
	items, resolved, err := s.sftpMgr.List(tabID, client, remotePath)
	if err != nil {
		return nil, err
	}
	return &SFTPListResult{
		Path:  resolved,
		Items: items,
	}, nil
}

// Download downloads a remote file to a local destination.
func (s *SFTPService) Download(tabID, remotePath, localDest string) error {
	client := s.connMgr.GetSSHClient(tabID)
	if client == nil {
		return fmt.Errorf("active SSH session not found")
	}
	return s.sftpMgr.Download(tabID, client, remotePath, localDest)
}

// Upload uploads a local file to a remote destination.
func (s *SFTPService) Upload(tabID, localSrc, remoteDest string) error {
	client := s.connMgr.GetSSHClient(tabID)
	if client == nil {
		return fmt.Errorf("active SSH session not found")
	}
	return s.sftpMgr.Upload(tabID, client, localSrc, remoteDest)
}

// Delete removes a remote file or empty directory.
func (s *SFTPService) Delete(tabID, remotePath string) error {
	client := s.connMgr.GetSSHClient(tabID)
	if client == nil {
		return fmt.Errorf("active SSH session not found")
	}
	return s.sftpMgr.Delete(tabID, client, remotePath)
}

// Rename moves or renames a remote file/directory.
func (s *SFTPService) Rename(tabID, oldPath, newPath string) error {
	client := s.connMgr.GetSSHClient(tabID)
	if client == nil {
		return fmt.Errorf("active SSH session not found")
	}
	return s.sftpMgr.Rename(tabID, client, oldPath, newPath)
}

// Mkdir creates a directory on the remote server.
func (s *SFTPService) Mkdir(tabID, remotePath string) error {
	client := s.connMgr.GetSSHClient(tabID)
	if client == nil {
		return fmt.Errorf("active SSH session not found")
	}
	return s.sftpMgr.Mkdir(tabID, client, remotePath)
}

// CreateFile creates an empty remote file.
func (s *SFTPService) CreateFile(tabID, remotePath string) error {
	client := s.connMgr.GetSSHClient(tabID)
	if client == nil {
		return fmt.Errorf("active SSH session not found")
	}
	return s.sftpMgr.CreateFile(tabID, client, remotePath)
}

// ReadFile reads contents of a remote text file into a string.
func (s *SFTPService) ReadFile(tabID, remotePath string) (string, error) {
	client := s.connMgr.GetSSHClient(tabID)
	if client == nil {
		return "", fmt.Errorf("active SSH session not found")
	}
	return s.sftpMgr.ReadFile(tabID, client, remotePath)
}

// WriteFile writes string content into a remote file.
func (s *SFTPService) WriteFile(tabID, remotePath, content string) error {
	client := s.connMgr.GetSSHClient(tabID)
	if client == nil {
		return fmt.Errorf("active SSH session not found")
	}
	return s.sftpMgr.WriteFile(tabID, client, remotePath, content)
}

// ChmodRemote modifies remote file permissions.
func (s *SFTPService) ChmodRemote(tabID, remotePath, octalMode string) error {
	client := s.connMgr.GetSSHClient(tabID)
	if client == nil {
		return fmt.Errorf("active SSH session not found")
	}
	return s.sftpMgr.Chmod(tabID, client, remotePath, octalMode)
}

// GetFileProperties retrieves detailed metadata of a remote file.
func (s *SFTPService) GetFileProperties(tabID, remotePath string) (*sftpmanager.SFTPItem, error) {
	client := s.connMgr.GetSSHClient(tabID)
	if client == nil {
		return nil, fmt.Errorf("active SSH session not found")
	}
	return s.sftpMgr.Stat(tabID, client, remotePath)
}

// SelectDownloadDest opens a native save file dialog.
func (s *SFTPService) SelectDownloadDest(ctx context.Context, defaultName string) (string, error) {
	return wailsruntime.SaveFileDialog(ctx, wailsruntime.SaveDialogOptions{
		DefaultFilename: defaultName,
		Title:           "Save Downloaded File As",
	})
}

// SelectUploadFile opens a native open file dialog.
func (s *SFTPService) SelectUploadFile(ctx context.Context) (string, error) {
	return wailsruntime.OpenFileDialog(ctx, wailsruntime.OpenDialogOptions{
		Title: "Select File to Upload via SFTP",
	})
}

// Local File Operations

func (s *SFTPService) ListLocal(localPath string) (*SFTPListResult, error) {
	items, cleanPath, err := sftpmanager.ListLocal(localPath)
	if err != nil {
		return nil, err
	}
	return &SFTPListResult{
		Path:  cleanPath,
		Items: items,
	}, nil
}

func (s *SFTPService) GetLocalDrives() ([]string, error) {
	return sftpmanager.GetLocalDrives()
}

func (s *SFTPService) MkdirLocal(localPath string) error {
	return sftpmanager.MkdirLocal(localPath)
}

func (s *SFTPService) CreateFileLocal(localPath string) error {
	return sftpmanager.CreateFileLocal(localPath)
}

func (s *SFTPService) RenameLocal(oldPath, newPath string) error {
	return sftpmanager.RenameLocal(oldPath, newPath)
}

func (s *SFTPService) DeleteLocal(localPath string) error {
	return sftpmanager.DeleteLocal(localPath)
}

func (s *SFTPService) ChmodLocal(localPath, octalMode string) error {
	return sftpmanager.ChmodLocal(localPath, octalMode)
}

// OpenExternal downloads remote file to temp cache and opens in system default editor.
func (s *SFTPService) OpenExternal(tabID, remotePath string, chooseApp bool) error {
	client := s.connMgr.GetSSHClient(tabID)
	if client == nil {
		return fmt.Errorf("active SSH session not found for tab %s", tabID)
	}

	cacheDir := filepath.Join(os.TempDir(), "nexterm_cache", tabID)
	if err := os.MkdirAll(cacheDir, 0700); err != nil {
		return fmt.Errorf("create local cache dir: %w", err)
	}
	if runtime.GOOS != "windows" {
		if err := os.Chmod(cacheDir, 0700); err != nil {
			return fmt.Errorf("secure local cache dir: %w", err)
		}
	}

	baseName := path.Base(filepath.ToSlash(remotePath))
	invalid := baseName == "/" || baseName == "." || baseName == ".."
	if runtime.GOOS == "windows" {
		// ':' would address an NTFS alternate data stream; the rest are illegal.
		invalid = invalid || strings.ContainsAny(baseName, `\:*?"<>|`)
	}
	if invalid {
		return fmt.Errorf("cannot open %q externally: file name is not valid on this system", remotePath)
	}
	localPath := filepath.Join(cacheDir, baseName)

	if err := s.sftpMgr.Download(tabID, client, remotePath, localPath); err != nil {
		return fmt.Errorf("download remote file: %w", err)
	}
	if runtime.GOOS != "windows" {
		if err := os.Chmod(localPath, 0600); err != nil {
			return fmt.Errorf("secure local cache file: %w", err)
		}
	}

	stat, err := os.Stat(localPath)
	if err != nil {
		return fmt.Errorf("stat local cache file: %w", err)
	}
	initialModTime := stat.ModTime()

	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		// Never route the server-controlled file name through cmd.exe: characters
		// such as & or | in it would be run as commands.
		if chooseApp {
			cmd = exec.Command("rundll32.exe", "shell32.dll,OpenAs_RunDLL", localPath)
		} else {
			cmd = exec.Command("rundll32.exe", "url.dll,FileProtocolHandler", localPath)
		}
	case "darwin":
		if chooseApp {
			cmd = exec.Command("open", "-R", localPath)
		} else {
			cmd = exec.Command("open", localPath)
		}
	default:
		cmd = exec.Command("xdg-open", localPath)
	}

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("launch external program failed: %w", err)
	}

	key := tabID + ":" + remotePath
	s.watcherMu.Lock()
	if existing, found := s.fileWatchers[key]; found && existing != nil {
		close(existing.stopChan)
	}

	stopChan := make(chan struct{})
	watch := &externalFileWatch{
		tabID:       tabID,
		remotePath:  remotePath,
		localPath:   localPath,
		lastModTime: initialModTime,
		stopChan:    stopChan,
	}
	s.fileWatchers[key] = watch
	s.watcherMu.Unlock()

	go func() {
		ticker := time.NewTicker(800 * time.Millisecond)
		defer ticker.Stop()

		for {
			select {
			case <-stopChan:
				return
			case <-ticker.C:
				st, err := os.Stat(localPath)
				if err != nil {
					continue
				}

				s.watcherMu.Lock()
				currentWatch := s.fileWatchers[key]
				if currentWatch == nil {
					s.watcherMu.Unlock()
					return
				}

				if st.ModTime().After(currentWatch.lastModTime) {
					currentWatch.lastModTime = st.ModTime()
					s.watcherMu.Unlock()

					s.emitter.Emit("sftp:file:modified", map[string]interface{}{
						"tabId":      tabID,
						"remotePath": remotePath,
						"localPath":  localPath,
						"fileName":   baseName,
						"modTime":    st.ModTime().Format("15:04:05"),
						"size":       st.Size(),
					})
				} else {
					s.watcherMu.Unlock()
				}
			}
		}
	}()

	return nil
}

// CommitExternalChange uploads the locally edited cached file back to remote server.
func (s *SFTPService) CommitExternalChange(tabID, remotePath, localPath string) error {
	client := s.connMgr.GetSSHClient(tabID)
	if client == nil {
		return fmt.Errorf("active SSH session not found")
	}

	key := tabID + ":" + remotePath
	if stat, err := os.Stat(localPath); err == nil {
		s.watcherMu.Lock()
		if w, ok := s.fileWatchers[key]; ok && w != nil {
			w.lastModTime = stat.ModTime()
		}
		s.watcherMu.Unlock()
	}

	return s.sftpMgr.Upload(tabID, client, localPath, remotePath)
}

// CloseTab tears down the cached SFTP client and any file watchers for a tab.
// Call this whenever a session ends (disconnect or tab close) so a later
// reconnect on the same tab builds a fresh SFTP session over the new SSH
// connection instead of reusing a dead one.
func (s *SFTPService) CloseTab(tabID string) {
	if s.sftpMgr != nil {
		s.sftpMgr.CloseTab(tabID)
	}
	s.CloseWatchersForTab(tabID)
}

// CloseWatchersForTab terminates file watchers associated with a disconnected tab.
func (s *SFTPService) CloseWatchersForTab(tabID string) {
	s.watcherMu.Lock()
	defer s.watcherMu.Unlock()

	prefix := tabID + ":"
	for k, w := range s.fileWatchers {
		if len(k) >= len(prefix) && k[:len(prefix)] == prefix {
			close(w.stopChan)
			delete(s.fileWatchers, k)
		}
	}
}
