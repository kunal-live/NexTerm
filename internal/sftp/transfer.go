package sftpmanager

import (
	"fmt"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/pkg/sftp"
)

// Upload transfers a local file or directory recursively to the remote host.
func Upload(client *sftp.Client, localPath, remotePath string) error {
	if client == nil {
		return fmt.Errorf("sftp client is nil")
	}

	lStat, err := os.Stat(localPath)
	if err != nil {
		return fmt.Errorf("stat local path %s: %w", localPath, err)
	}

	// Case 1: Upload a single file
	if !lStat.IsDir() {
		destPath := remotePath
		// If remotePath is an existing directory or ends with '/', put file inside
		rStat, rErr := client.Stat(remotePath)
		if (rErr == nil && rStat.IsDir()) || strings.HasSuffix(remotePath, "/") {
			destPath = path.Join(remotePath, filepath.Base(localPath))
		}

		if err := client.MkdirAll(path.Dir(destPath)); err != nil {
			return fmt.Errorf("create remote parent dir: %w", err)
		}

		return uploadSingleFile(client, localPath, destPath)
	}

	// Case 2: Upload directory recursively
	targetBaseDir := path.Join(remotePath, filepath.Base(localPath))
	if err := client.MkdirAll(targetBaseDir); err != nil {
		return fmt.Errorf("create remote root dir: %w", err)
	}

	return filepath.Walk(localPath, func(curPath string, info os.FileInfo, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}

		rel, err := filepath.Rel(localPath, curPath)
		if err != nil {
			return err
		}
		if rel == "." {
			return nil
		}

		// Convert local backslashes to remote forward slashes
		remoteRel := filepath.ToSlash(rel)
		remoteTarget := path.Join(targetBaseDir, remoteRel)

		if info.IsDir() {
			return client.MkdirAll(remoteTarget)
		}

		return uploadSingleFile(client, curPath, remoteTarget)
	})
}

func uploadSingleFile(client *sftp.Client, localFile, remoteFile string) error {
	src, err := os.Open(localFile)
	if err != nil {
		return fmt.Errorf("open local file: %w", err)
	}
	defer src.Close()

	dst, err := client.Create(remoteFile)
	if err != nil {
		return fmt.Errorf("create remote file %s: %w", remoteFile, err)
	}
	defer dst.Close()

	// High-throughput concurrent pipeline: ReadFrom triggers parallel SFTP write chunks
	_, err = dst.ReadFrom(src)
	return err
}

// Download transfers a remote file or directory recursively to the local machine.
func Download(client *sftp.Client, remotePath, localPath string) error {
	if client == nil {
		return fmt.Errorf("sftp client is nil")
	}

	rStat, err := client.Stat(remotePath)
	if err != nil {
		return fmt.Errorf("stat remote path %s: %w", remotePath, err)
	}

	// Case 1: Download a single file
	if !rStat.IsDir() {
		destPath := localPath
		lStat, lErr := os.Stat(localPath)
		if (lErr == nil && lStat.IsDir()) || strings.HasSuffix(localPath, "\\") || strings.HasSuffix(localPath, "/") {
			destPath = filepath.Join(localPath, path.Base(remotePath))
		}

		if err := os.MkdirAll(filepath.Dir(destPath), 0755); err != nil {
			return fmt.Errorf("create local parent dir: %w", err)
		}

		return downloadSingleFile(client, remotePath, destPath)
	}

	// Case 2: Download directory recursively
	targetBaseDir := filepath.Join(localPath, path.Base(remotePath))
	if err := os.MkdirAll(targetBaseDir, 0755); err != nil {
		return fmt.Errorf("create local root dir: %w", err)
	}

	walker := client.Walk(remotePath)
	for walker.Step() {
		if walker.Err() != nil {
			return walker.Err()
		}

		curRemote := walker.Path()
		rel, err := filepath.Rel(remotePath, curRemote)
		if err != nil {
			// fallback using path
			rel = strings.TrimPrefix(curRemote, remotePath)
			rel = strings.TrimPrefix(rel, "/")
		}
		if rel == "." || rel == "" {
			continue
		}

		localTarget := filepath.Join(targetBaseDir, filepath.FromSlash(rel))
		stat := walker.Stat()

		if stat.IsDir() {
			if err := os.MkdirAll(localTarget, 0755); err != nil {
				return err
			}
			continue
		}

		if err := os.MkdirAll(filepath.Dir(localTarget), 0755); err != nil {
			return err
		}

		if err := downloadSingleFile(client, curRemote, localTarget); err != nil {
			return err
		}
	}

	return nil
}

func downloadSingleFile(client *sftp.Client, remoteFile, localFile string) error {
	src, err := client.Open(remoteFile)
	if err != nil {
		return fmt.Errorf("open remote file %s: %w", remoteFile, err)
	}
	defer src.Close()

	dst, err := os.Create(localFile)
	if err != nil {
		return fmt.Errorf("create local file %s: %w", localFile, err)
	}
	defer dst.Close()

	// High-throughput concurrent pipeline: WriteTo triggers parallel SFTP read chunks
	_, err = src.WriteTo(dst)
	return err
}
