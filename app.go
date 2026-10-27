package main

import (
	"context"
	"fmt"
	"sync/atomic"
	"time"

	"nexterm/internal/macro"
	"nexterm/internal/model"
	"nexterm/internal/service"
	"nexterm/internal/store"
	"nexterm/internal/tunnel"
	"nexterm/internal/vault"
	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

const runSSHCommandTimeout = 10 * time.Second

// wailsEventEmitter adapts Wails runtime.EventsEmit to service.EventEmitter.
type wailsEventEmitter struct {
	app *App
}

func (w *wailsEventEmitter) Emit(event string, optionalData ...interface{}) {
	if w.app != nil && w.app.ctx != nil && w.app.wailsReady.Load() {
		wailsruntime.EventsEmit(w.app.ctx, event, optionalData...)
	}
}

func (a *App) logRuntimeError(format string, args ...interface{}) {
	msg := fmt.Sprintf(format, args...)
	if a.loggingService != nil {
		a.loggingService.LogError("App", msg, nil)
	}
	if a.ctx != nil && a.wailsReady.Load() {
		wailsruntime.LogError(a.ctx, msg)
	}
}

func (a *App) logRuntimeDebug(format string, args ...interface{}) {
	msg := fmt.Sprintf(format, args...)
	if a.loggingService != nil {
		a.loggingService.LogInfo("App", msg)
	}
	if a.ctx != nil && a.wailsReady.Load() {
		wailsruntime.LogDebug(a.ctx, msg)
	}
}

func (a *App) logRuntimeInfo(format string, args ...interface{}) {
	msg := fmt.Sprintf(format, args...)
	if a.loggingService != nil {
		a.loggingService.LogInfo("App", msg)
	}
	if a.ctx != nil && a.wailsReady.Load() {
		wailsruntime.LogInfo(a.ctx, msg)
	}
}

// App struct manages the core services and desktop lifecycle for NexTerm.
type App struct {
	ctx               context.Context
	wailsReady        atomic.Bool
	sessionService    *service.SessionService
	connectionManager *service.ConnectionManager
	credentialService *service.CredentialService
	loggingService    *service.LoggingService
	terminalService   *service.TerminalService
	sftpService       *service.SFTPService
	settingsService   *service.SettingsService
	hostKeyService    *service.HostKeyService
	brmService        *service.BRMAssistantService
	updateService     *service.UpdateService
	tunnelMgr         *tunnel.TunnelManager
	macroMgr          *macro.MacroManager
}

// NewApp instantiates the App facade and initializes all domain services.
func NewApp() *App {
	a := &App{
		tunnelMgr: tunnel.NewTunnelManager(),
		macroMgr:  macro.NewMacroManager(),
	}

	emitter := &wailsEventEmitter{app: a}
	a.loggingService = service.NewLoggingService(emitter)
	a.hostKeyService = service.NewHostKeyService(emitter)
	a.credentialService = service.NewCredentialService(nil)
	a.connectionManager = service.NewConnectionManager(a.credentialService, a.hostKeyService, a.loggingService, emitter)
	a.terminalService = service.NewTerminalService(a.loggingService, emitter)
	a.sftpService = service.NewSFTPService(a.connectionManager, emitter)
	a.settingsService = service.NewSettingsService(nil)
	a.sessionService = service.NewSessionService(nil)
	a.brmService = service.NewBRMAssistantService(a.connectionManager, a.loggingService)
	a.updateService = service.NewUpdateService(emitter)

	// Clean up workspace tabs, SFTP watchers, and transcript log handles on disconnect
	a.connectionManager.SetOnSessionClosed(func(tabID string) {
		if _, err := a.settingsService.RemoveTab(tabID); err != nil && a.loggingService != nil {
			a.loggingService.LogDebug("App", fmt.Sprintf("RemoveTab on session closed: %v", err))
		}
		a.sftpService.CloseTab(tabID)
		// Close transcript log file so handles don't leak on session disconnect
		a.StopSessionLog(tabID)
	})

	a.terminalService.SetOnTerminalClosed(func(tabID string, title string) {
		if _, err := a.settingsService.RemoveTab(tabID); err != nil && a.loggingService != nil {
			a.loggingService.LogDebug("App", fmt.Sprintf("RemoveTab on terminal closed: %v", err))
		}
		// Close transcript log file on terminal tab close
		a.StopSessionLog(tabID)
	})

	return a
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.loggingService.LogInfo("App", "NexTerm application started")

	// 1. Session Store
	if a.sessionService == nil || !a.sessionService.HasStore() {
		s, err := store.NewSessionStore()
		if err != nil {
			a.logRuntimeError("session store init failed: %v", err)
		} else {
			a.sessionService = service.NewSessionService(s)
		}
	}

	// 2. Vault
	if a.credentialService.Vault() == nil {
		v, err := vault.NewVault()
		if err != nil {
			a.logRuntimeError("vault init failed: %v", err)
		} else {
			a.credentialService.SetVault(v)
		}
	}
	if a.sessionService != nil {
		a.credentialService.SetTreeProvider(func() *model.TreeNode {
			return a.sessionService.GetSessionTree()
		})
	}

	// Wire vault hooks into session service
	a.sessionService.SetVaultHooks(
		func(key string) { _ = a.credentialService.DeleteSavedPassword(key) },
		func(key, val string) error { return a.credentialService.SaveSessionPassword(key, val) },
		func(key string) (string, bool, error) {
			p, err := a.credentialService.GetSessionPassword(key)
			return p, p != "", err
		},
	)

	// Load session tree
	if _, err := a.sessionService.LoadRoot(); err != nil {
		a.logRuntimeError("load session tree failed: %v", err)
	}

	// Wire security wipe callback
	a.credentialService.SetOnSecurityWipe(func() error {
		return a.WipeAllDataAndRestart()
	})
}

func (a *App) onWailsStartup(ctx context.Context) {
	a.wailsReady.Store(true)
	a.startup(ctx)
}

func (a *App) shutdown(ctx context.Context) {
	a.wailsReady.Store(false)
	if a.loggingService != nil {
		a.loggingService.StopAllSessionLogs()
	}
}
