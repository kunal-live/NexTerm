package service

import (
	"nexterm/internal/model"
	"nexterm/internal/security"
	"sync"
)

// SettingsService manages multi-pane workspace layout, security policies, and customizer configuration.
type SettingsService struct {
	mu        sync.RWMutex
	workspace *model.Workspace
	secMgr    *security.SecurityManager
}

// NewSettingsService constructs a new SettingsService.
func NewSettingsService(secMgr *security.SecurityManager) *SettingsService {
	if secMgr == nil {
		secMgr = security.NewSecurityManager()
	}
	return &SettingsService{
		workspace: model.NewWorkspace("default", "Default Workspace"),
		secMgr:    secMgr,
	}
}

// Workspace Management

func (s *SettingsService) GetWorkspace() model.Workspace {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.workspace.GetState()
}

func (s *SettingsService) SetWorkspaceLayout(layout string) (model.Workspace, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	err := s.workspace.SetLayout(layout)
	return s.workspace.GetState(), err
}

func (s *SettingsService) AddWorkspacePane(direction string) (*model.Pane, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.workspace.SplitPane(s.workspace.ActivePaneID, direction)
}

func (s *SettingsService) CloseWorkspacePane(paneID string) (model.Workspace, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	err := s.workspace.ClosePane(paneID)
	return s.workspace.GetState(), err
}

func (s *SettingsService) MoveWorkspaceTab(tabID, targetPaneID string, targetIndex int) (model.Workspace, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	err := s.workspace.MoveTab(tabID, targetPaneID, targetIndex)
	return s.workspace.GetState(), err
}

func (s *SettingsService) FocusWorkspacePane(paneID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.workspace.FocusPane(paneID)
}

func (s *SettingsService) SetWorkspaceActiveTab(paneID, tabID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.workspace.SetActiveTab(paneID, tabID)
}

func (s *SettingsService) AddTabToPane(paneID string, tab *model.TabSession) (*model.Pane, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.workspace.AddTabToPane(paneID, tab)
}

func (s *SettingsService) RemoveTab(tabID string) (*model.Pane, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.workspace.RemoveTab(tabID)
}

// Security Policies & Customizer

func (s *SettingsService) GetSecurityPolicy() security.SecurityPolicy {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.secMgr.GetPolicy()
}

func (s *SettingsService) SaveSecurityPolicy(p security.SecurityPolicy) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.secMgr.SavePolicy(p)
}

func (s *SettingsService) GetCustomizerConfig() security.CustomizerConfig {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.secMgr.GetCustomizer()
}

func (s *SettingsService) SaveCustomizerConfig(c security.CustomizerConfig) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.secMgr.SaveCustomizer(c)
}

func (s *SettingsService) CheckProtocol(proto string) error {
	return s.secMgr.CheckProtocol(proto)
}

func (s *SettingsService) CheckPasswordSaving() error {
	return s.secMgr.CheckPasswordSaving()
}

func (s *SettingsService) CheckFileTransfers() error {
	return s.secMgr.CheckFileTransfers()
}

func (s *SettingsService) CheckClipboard() error {
	return s.secMgr.CheckClipboard()
}

func (s *SettingsService) IsAuditRequired() bool {
	return s.secMgr.IsAuditRequired()
}

func (s *SettingsService) CheckCommand(cmd string) error {
	if s == nil || s.secMgr == nil {
		return nil
	}
	return s.secMgr.CheckCommand(cmd)
}

