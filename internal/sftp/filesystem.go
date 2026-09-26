package sftpmanager

import (
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"

	"github.com/pkg/sftp"
)

// SFTPItem represents one remote or local file or folder.
type SFTPItem struct {
	Name          string `json:"name"`
	Path          string `json:"path"`
	Size          int64  `json:"size"`
	FormattedSize string `json:"formattedSize"`
	IsDir         bool   `json:"isDir"`
	ModTime       string `json:"modTime"`
	Permissions   string `json:"permissions"`
	OctalPerm     string `json:"octalPerm"`
	Extension     string `json:"extension"`
}

// Format bytes into human-readable representation.
func formatBytes(bytes int64, isDir bool) string {
	if isDir {
		return "<DIR>"
	}
	const unit = 1024
	if bytes < unit {
		return fmt.Sprintf("%d B", bytes)
	}
	div, exp := int64(unit), 0
	for n := bytes / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(bytes)/float64(div), "KMGTPE"[exp])
}

func formatOctal(mode os.FileMode) string {
	return fmt.Sprintf("%04o", mode.Perm())
}

func parseOctal(octalStr string) (os.FileMode, error) {
	octalStr = strings.TrimSpace(octalStr)
	val, err := strconv.ParseUint(octalStr, 8, 32)
	if err != nil {
		return 0, fmt.Errorf("invalid octal permission %q: %w", octalStr, err)
	}
	return os.FileMode(val), nil
}

// =========================================================================
// Remote Filesystem Operations
// =========================================================================

// ListRemote retrieves directory contents from the remote SFTP server.
func ListRemote(client *sftp.Client, remotePath string) ([]SFTPItem, string, error) {
	if client == nil {
		return nil, "", fmt.Errorf("sftp client is nil")
	}

	if remotePath == "" || remotePath == "~" || strings.HasPrefix(remotePath, "~/") {
		wd, err := client.Getwd()
		if err != nil || wd == "" || wd == "." {
			if rp, rperr := client.RealPath("."); rperr == nil && rp != "" && rp != "." {
				wd = rp
			}
		}
		if wd != "" && wd != "." {
			if remotePath == "" || remotePath == "~" {
				remotePath = wd
			} else {
				remotePath = path.Join(wd, strings.TrimPrefix(remotePath, "~/"))
			}
		} else {
			if remotePath == "" || remotePath == "~" {
				remotePath = "/"
			} else {
				remotePath = "/" + strings.TrimPrefix(remotePath, "~/")
			}
		}
	}

	remotePath = path.Clean(remotePath)
	if !strings.HasPrefix(remotePath, "/") {
		remotePath = "/" + remotePath
	}

	entries, err := client.ReadDir(remotePath)
	if err != nil {
		return nil, remotePath, fmt.Errorf("read remote directory %s failed: %w", remotePath, err)
	}

	var items []SFTPItem
	for _, e := range entries {
		itemPath := path.Join(remotePath, e.Name())
		ext := strings.ToLower(filepath.Ext(e.Name()))
		items = append(items, SFTPItem{
			Name:          e.Name(),
			Path:          itemPath,
			Size:          e.Size(),
			FormattedSize: formatBytes(e.Size(), e.IsDir()),
			IsDir:         e.IsDir(),
			ModTime:       e.ModTime().Format("2006-01-02 15:04"),
			Permissions:   e.Mode().String(),
			OctalPerm:     formatOctal(e.Mode()),
			Extension:     ext,
		})
	}

	sort.Slice(items, func(i, j int) bool {
		if items[i].IsDir != items[j].IsDir {
			return items[i].IsDir
		}
		return strings.ToLower(items[i].Name) < strings.ToLower(items[j].Name)
	})

	return items, remotePath, nil
}

// MkdirRemote creates a new directory on the remote SFTP host.
func MkdirRemote(client *sftp.Client, remotePath string) error {
	if client == nil {
		return fmt.Errorf("sftp client is nil")
	}
	return client.MkdirAll(remotePath)
}

// CreateFileRemote creates a new empty file on the remote host.
func CreateFileRemote(client *sftp.Client, remotePath string) error {
	if client == nil {
		return fmt.Errorf("sftp client is nil")
	}
	f, err := client.Create(remotePath)
	if err != nil {
		return err
	}
	return f.Close()
}

// RenameRemote moves or renames a file or folder on the remote host.
func RenameRemote(client *sftp.Client, oldPath, newPath string) error {
	if client == nil {
		return fmt.Errorf("sftp client is nil")
	}
	return client.Rename(oldPath, newPath)
}

// DeleteRemote removes a file or directory recursively on the remote host.
func DeleteRemote(client *sftp.Client, remotePath string) error {
	if client == nil {
		return fmt.Errorf("sftp client is nil")
	}
	stat, err := client.Stat(remotePath)
	if err != nil {
		return err
	}
	if stat.IsDir() {
		return client.RemoveAll(remotePath)
	}
	return client.Remove(remotePath)
}

// ChmodRemote modifies permissions of a file or directory on the remote host.
func ChmodRemote(client *sftp.Client, remotePath, octalMode string) error {
	if client == nil {
		return fmt.Errorf("sftp client is nil")
	}
	mode, err := parseOctal(octalMode)
	if err != nil {
		return err
	}
	return client.Chmod(remotePath, mode)
}

// ReadFileRemote loads text file content from the remote host.
func ReadFileRemote(client *sftp.Client, remotePath string) (string, error) {
	if client == nil {
		return "", fmt.Errorf("sftp client is nil")
	}
	file, err := client.Open(remotePath)
	if err != nil {
		return "", fmt.Errorf("open remote file: %w", err)
	}
	defer file.Close()

	limitReader := io.LimitReader(file, 2*1024*1024)
	data, err := io.ReadAll(limitReader)
	if err != nil {
		return "", fmt.Errorf("read remote file: %w", err)
	}
	return string(data), nil
}

// WriteFileRemote writes text content to a remote file.
func WriteFileRemote(client *sftp.Client, remotePath, content string) error {
	if client == nil {
		return fmt.Errorf("sftp client is nil")
	}
	file, err := client.Create(remotePath)
	if err != nil {
		return fmt.Errorf("create remote file: %w", err)
	}
	defer file.Close()

	_, err = file.Write([]byte(content))
	return err
}

// StatRemote returns metadata for a remote path.
func StatRemote(client *sftp.Client, remotePath string) (*SFTPItem, error) {
	if client == nil {
		return nil, fmt.Errorf("sftp client is nil")
	}
	fi, err := client.Stat(remotePath)
	if err != nil {
		return nil, err
	}
	ext := strings.ToLower(filepath.Ext(fi.Name()))
	return &SFTPItem{
		Name:          fi.Name(),
		Path:          remotePath,
		Size:          fi.Size(),
		FormattedSize: formatBytes(fi.Size(), fi.IsDir()),
		IsDir:         fi.IsDir(),
		ModTime:       fi.ModTime().Format("2006-01-02 15:04:05"),
		Permissions:   fi.Mode().String(),
		OctalPerm:     formatOctal(fi.Mode()),
		Extension:     ext,
	}, nil
}

// =========================================================================
// Local Filesystem Operations
// =========================================================================

// ListLocal reads files and folders from the local machine.
func ListLocal(localPath string) ([]SFTPItem, string, error) {
	if localPath == "" {
		home, err := os.UserHomeDir()
		if err == nil && home != "" {
			localPath = home
		} else if runtime.GOOS == "windows" {
			localPath = "C:\\"
		} else {
			localPath = "/"
		}
	}

	cleanPath := filepath.Clean(localPath)
	entries, err := os.ReadDir(cleanPath)
	if err != nil {
		return nil, cleanPath, fmt.Errorf("read local directory %s failed: %w", cleanPath, err)
	}

	var items []SFTPItem
	for _, e := range entries {
		info, err := e.Info()
		if err != nil {
			continue
		}
		itemPath := filepath.Join(cleanPath, e.Name())
		ext := strings.ToLower(filepath.Ext(e.Name()))
		items = append(items, SFTPItem{
			Name:          e.Name(),
			Path:          itemPath,
			Size:          info.Size(),
			FormattedSize: formatBytes(info.Size(), e.IsDir()),
			IsDir:         e.IsDir(),
			ModTime:       info.ModTime().Format("2006-01-02 15:04"),
			Permissions:   info.Mode().String(),
			OctalPerm:     formatOctal(info.Mode()),
			Extension:     ext,
		})
	}

	sort.Slice(items, func(i, j int) bool {
		if items[i].IsDir != items[j].IsDir {
			return items[i].IsDir
		}
		return strings.ToLower(items[i].Name) < strings.ToLower(items[j].Name)
	})

	return items, cleanPath, nil
}

// GetLocalDrives scans logical roots on Windows (e.g. C:\, D:\) or Unix root paths (/, ~).
func GetLocalDrives() ([]string, error) {
	if runtime.GOOS != "windows" {
		var roots []string
		home, err := os.UserHomeDir()
		if err == nil && home != "" {
			roots = append(roots, home)
		}
		roots = append(roots, "/")
		switch runtime.GOOS {
		case "darwin":
			if _, err := os.Stat("/Volumes"); err == nil {
				roots = append(roots, "/Volumes")
			}
		case "linux":
			if _, err := os.Stat("/media"); err == nil {
				roots = append(roots, "/media")
			}
		}
		return roots, nil
	}

	var drives []string
	for _, drive := range "ABCDEFGHIJKLMNOPQRSTUVWXYZ" {
		root := string(drive) + ":\\"
		if _, err := os.Stat(root); err == nil {
			drives = append(drives, root)
		}
	}
	if len(drives) == 0 {
		home, err := os.UserHomeDir()
		if err == nil && home != "" {
			drives = append(drives, home)
		} else {
			drives = append(drives, "C:\\")
		}
	}
	return drives, nil
}

// MkdirLocal creates a directory on the local machine.
func MkdirLocal(localPath string) error {
	return os.MkdirAll(localPath, 0755)
}

// CreateFileLocal creates an empty file on the local machine.
func CreateFileLocal(localPath string) error {
	if err := os.MkdirAll(filepath.Dir(localPath), 0755); err != nil {
		return err
	}
	f, err := os.Create(localPath)
	if err != nil {
		return err
	}
	return f.Close()
}

// RenameLocal moves or renames a local file or directory.
func RenameLocal(oldPath, newPath string) error {
	return os.Rename(oldPath, newPath)
}

// DeleteLocal recursively removes a local file or directory.
func DeleteLocal(localPath string) error {
	return os.RemoveAll(localPath)
}

// ChmodLocal updates permissions on a local file.
func ChmodLocal(localPath, octalMode string) error {
	mode, err := parseOctal(octalMode)
	if err != nil {
		return err
	}
	return os.Chmod(localPath, mode)
}
