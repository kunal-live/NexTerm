package main

import (
	"fmt"

	"nexterm/internal/service"
	sftpmanager "nexterm/internal/sftp"
)

// =========================================================================
// SFTP Remote & Local File Management
// =========================================================================

func (a *App) SFTPList(tabID, remotePath string) (*service.SFTPListResult, error) {
	return a.sftpService.List(tabID, remotePath)
}

func (a *App) SFTPDownload(tabID, remotePath, localDest string) error {
	if err := a.settingsService.CheckFileTransfers(); err != nil {
		a.loggingService.LogAudit("POLICY_DENIED", "sftp", "", "", tabID, "DENIED", err.Error())
		return err
	}
	err := a.sftpService.Download(tabID, remotePath, localDest)
	if err == nil {
		a.loggingService.LogAudit("FILE_DOWNLOADED", "sftp", "", "", tabID, "SUCCESS", fmt.Sprintf("%s -> %s", remotePath, localDest))
	} else {
		a.loggingService.LogAudit("FILE_DOWNLOAD_FAILED", "sftp", "", "", tabID, "FAILURE", err.Error())
	}
	return err
}

func (a *App) SFTPUpload(tabID, localSrc, remoteDest string) error {
	if err := a.settingsService.CheckFileTransfers(); err != nil {
		a.loggingService.LogAudit("POLICY_DENIED", "sftp", "", "", tabID, "DENIED", err.Error())
		return err
	}
	err := a.sftpService.Upload(tabID, localSrc, remoteDest)
	if err == nil {
		a.loggingService.LogAudit("FILE_UPLOADED", "sftp", "", "", tabID, "SUCCESS", fmt.Sprintf("%s -> %s", localSrc, remoteDest))
	} else {
		a.loggingService.LogAudit("FILE_UPLOAD_FAILED", "sftp", "", "", tabID, "FAILURE", err.Error())
	}
	return err
}

func (a *App) SFTPDelete(tabID, remotePath string) error {
	err := a.sftpService.Delete(tabID, remotePath)
	if err == nil {
		a.loggingService.LogAudit("FILE_DELETED", "sftp", "", "", tabID, "SUCCESS", remotePath)
	}
	return err
}

func (a *App) SFTPRename(tabID, oldPath, newPath string) error {
	return a.sftpService.Rename(tabID, oldPath, newPath)
}

func (a *App) SFTPMkdir(tabID, remotePath string) error {
	return a.sftpService.Mkdir(tabID, remotePath)
}

func (a *App) SFTPCreateFile(tabID, remotePath string) error {
	return a.sftpService.CreateFile(tabID, remotePath)
}

func (a *App) SFTPReadFile(tabID, remotePath string) (string, error) {
	return a.sftpService.ReadFile(tabID, remotePath)
}

func (a *App) SFTPWriteFile(tabID, remotePath, content string) error {
	return a.sftpService.WriteFile(tabID, remotePath, content)
}

func (a *App) SelectDownloadDest(defaultName string) (string, error) {
	return a.sftpService.SelectDownloadDest(a.ctx, defaultName)
}

func (a *App) SelectUploadFile() (string, error) {
	return a.sftpService.SelectUploadFile(a.ctx)
}

func (a *App) SFTPListLocal(localPath string) (*service.SFTPListResult, error) {
	return a.sftpService.ListLocal(localPath)
}

func (a *App) SFTPGetLocalDrives() ([]string, error) {
	return a.sftpService.GetLocalDrives()
}

func (a *App) SFTPMkdirLocal(localPath string) error {
	return a.sftpService.MkdirLocal(localPath)
}

func (a *App) SFTPCreateFileLocal(localPath string) error {
	return a.sftpService.CreateFileLocal(localPath)
}

func (a *App) SFTPRenameLocal(oldPath, newPath string) error {
	return a.sftpService.RenameLocal(oldPath, newPath)
}

func (a *App) SFTPDeleteLocal(localPath string) error {
	return a.sftpService.DeleteLocal(localPath)
}

func (a *App) SFTPChmodLocal(localPath, octalMode string) error {
	return a.sftpService.ChmodLocal(localPath, octalMode)
}

func (a *App) SFTPChmodRemote(tabID, remotePath, octalMode string) error {
	return a.sftpService.ChmodRemote(tabID, remotePath, octalMode)
}

func (a *App) SFTPOpenExternal(tabID, remotePath string, chooseApp bool) error {
	return a.sftpService.OpenExternal(tabID, remotePath, chooseApp)
}

func (a *App) SFTPCommitExternalChange(tabID, remotePath, localPath string) error {
	return a.sftpService.CommitExternalChange(tabID, remotePath, localPath)
}

func (a *App) SFTPGetFileProperties(tabID, remotePath string) (*sftpmanager.SFTPItem, error) {
	return a.sftpService.GetFileProperties(tabID, remotePath)
}
