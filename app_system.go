package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"nexterm/internal/model"
	"nexterm/internal/security"
	"nexterm/internal/service"
	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// =========================================================================
// System Security Reset & Application Restart
// =========================================================================

// ResetAllData purges all credentials from the vault and resets session configurations.
// Returns an error if any component fails to clear, preventing a false sense of security.
func (a *App) ResetAllData() error {
	var errs []string
	if err := a.credentialService.ClearAll(); err != nil {
		a.logRuntimeError("vault clear failed: %v", err)
		errs = append(errs, fmt.Sprintf("vault clear failed: %v", err))
	}
	if _, err := a.sessionService.ResetToDefault(); err != nil {
		a.logRuntimeError("session reset failed: %v", err)
		errs = append(errs, fmt.Sprintf("session reset failed: %v", err))
	}
	if len(errs) > 0 {
		errMsg := strings.Join(errs, "; ")
		a.loggingService.LogAudit("FACTORY_RESET", "system", "", "", "admin", "FAILURE", errMsg)
		return errors.New(errMsg)
	}
	a.loggingService.LogAudit("FACTORY_RESET", "system", "", "", "admin", "SUCCESS", "All server credentials and sessions reset to clean state")
	return nil
}

// RestartApp attempts to spawn a fresh instance of the application and terminates the current process.
func (a *App) RestartApp() error {
	exe, err := os.Executable()
	if err != nil {
		return fmt.Errorf("failed to get executable path: %w", err)
	}
	cmd := exec.Command(exe)
	cmd.Dir = filepath.Dir(exe)
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to restart application: %w", err)
	}
	go func() {
		time.Sleep(300 * time.Millisecond)
		if a.ctx != nil {
			wailsruntime.Quit(a.ctx)
		} else {
			os.Exit(0)
		}
	}()
	return nil
}

// WipeAllDataAndRestart wipes all sensitive data and restarts.
// If the security wipe fails, it returns the error immediately and does NOT restart.
func (a *App) WipeAllDataAndRestart() error {
	if err := a.ResetAllData(); err != nil {
		return fmt.Errorf("security wipe failed: %w", err)
	}
	return a.RestartApp()
}

// =========================================================================
// Security Policy & Customizer
// =========================================================================

func (a *App) GetSecurityPolicy() security.SecurityPolicy {
	return a.settingsService.GetSecurityPolicy()
}

func (a *App) SaveSecurityPolicy(p security.SecurityPolicy) error {
	return a.settingsService.SaveSecurityPolicy(p)
}

func (a *App) GetCustomizerConfig() security.CustomizerConfig {
	return a.settingsService.GetCustomizerConfig()
}

func (a *App) SaveCustomizerConfig(c security.CustomizerConfig) error {
	return a.settingsService.SaveCustomizerConfig(c)
}

// =========================================================================
// Workspace & Layout
// =========================================================================

func (a *App) GetWorkspace() model.Workspace {
	return a.settingsService.GetWorkspace()
}

func (a *App) SetWorkspaceLayout(layout string) (model.Workspace, error) {
	return a.settingsService.SetWorkspaceLayout(layout)
}

func (a *App) AddWorkspacePane(direction string) (*model.Pane, error) {
	return a.settingsService.AddWorkspacePane(direction)
}

func (a *App) CloseWorkspacePane(paneID string) (model.Workspace, error) {
	return a.settingsService.CloseWorkspacePane(paneID)
}

func (a *App) MoveWorkspaceTab(tabID, targetPaneID string, targetIndex int) (model.Workspace, error) {
	return a.settingsService.MoveWorkspaceTab(tabID, targetPaneID, targetIndex)
}

func (a *App) FocusWorkspacePane(paneID string) error {
	return a.settingsService.FocusWorkspacePane(paneID)
}

func (a *App) SetWorkspaceActiveTab(paneID, tabID string) error {
	return a.settingsService.SetWorkspaceActiveTab(paneID, tabID)
}

// =========================================================================
// Assistant Diagnostic API (Oracle BRM Diagnostics & Troubleshooting)
// =========================================================================

func (a *App) BRMDetectInstallation(tabID string) (*service.BRMInstallation, error) {
	return a.brmService.DetectInstallation(tabID)
}

func (a *App) BRMDiscoverLogs(tabID, rootPath string) ([]service.BRMLogFile, error) {
	return a.brmService.DiscoverLogs(tabID, rootPath)
}

func (a *App) BRMInspectSource(tabID, sourcePath, filterQuery string, maxLines int) (*service.BRMSourceInspection, error) {
	return a.brmService.InspectSource(tabID, sourcePath, filterQuery, maxLines)
}

func (a *App) BRMDiagnose(req service.BRMDiagnosisRequest) (*service.BRMDiagnosisResult, error) {
	return a.brmService.Diagnose(req)
}

func (a *App) BRMClassifyQuestion(question string) string {
	return a.brmService.ClassifyQuestion(question)
}

func (a *App) BRMGetOpcodeKnowledge(op string) service.OpcodeInfo {
	return a.brmService.GetOpcodeKnowledge(op)
}

func (a *App) BRMGetErrorKnowledge(code string) service.ErrorKnowledge {
	return a.brmService.GetErrorKnowledge(code)
}

// =========================================================================
// In-App Auto-Update System
// =========================================================================

func (a *App) CheckForUpdates() (*service.UpdateInfo, error) {
	ctx := context.Background()
	if a.ctx != nil {
		ctx = a.ctx
	}
	info, err := a.updateService.CheckForUpdates(ctx)
	if err != nil {
		a.loggingService.LogAudit("CHECK_UPDATE_FAILED", "system", "", "", "", "FAILURE", err.Error())
		return nil, err
	}
	return info, nil
}

func (a *App) ApplyUpdate(downloadURL string) error {
	ctx := context.Background()
	if a.ctx != nil {
		ctx = a.ctx
	}
	a.loggingService.LogAudit("APPLY_UPDATE_INITIATED", "system", "", "", "", "SUCCESS", downloadURL)
	return a.updateService.DownloadAndApplyUpdate(ctx, downloadURL)
}

func (a *App) GetAppVersion() string {
	return a.updateService.CurrentVersion()
}
