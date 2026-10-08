package store

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"nexterm/internal/model"

	"github.com/google/uuid"
)

// CurrentStoreVersion is the current schema version for persisted sessions.
const CurrentStoreVersion = 1

// PersistedSessions defines the versioned container for sessions.json.
// This allows future schema migrations without breaking backward compatibility.
type PersistedSessions struct {
	Version int             `json:"version"`
	Root    *model.TreeNode `json:"root"`
}

// Default session folder categories as specified by user
var DefaultFolderNames = []string{
	"Production",
	"UAT",
	"Testing",
	"Local",
	"Client",
	"User",
}

// SessionStore loads/saves the saved-sessions tree to a JSON file
// using transactional writes (sessions.json.tmp -> write -> flush -> close -> rename -> sessions.json).
type SessionStore struct {
	mu       sync.Mutex
	filePath string
}

// NewSessionStoreAt creates a SessionStore targeting a specific file path,
// ensuring parent directories are created.
func NewSessionStoreAt(filePath string) (*SessionStore, error) {
	dir := filepath.Dir(filePath)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, fmt.Errorf("create store dir: %w", err)
	}
	return &SessionStore{filePath: filePath}, nil
}

// NewSessionStore initializes the store targeting %AppData%\Nexterm\sessions.json.
func NewSessionStore() (*SessionStore, error) {
	appData, err := os.UserConfigDir()
	if err != nil {
		return nil, err
	}
	dir := filepath.Join(appData, "Nexterm")
	targetPath := filepath.Join(dir, "sessions.json")
	store, err := NewSessionStoreAt(targetPath)
	if err != nil {
		return nil, err
	}

	// Check if legacy MobaCloneGo session file exists and migrate it if new one doesn't
	if _, err := os.Stat(store.filePath); os.IsNotExist(err) {
		oldDir := filepath.Join(appData, "MobaCloneGo")
		oldFile := filepath.Join(oldDir, "sessions.json")
		if oldData, err := os.ReadFile(oldFile); err == nil {
			_ = os.WriteFile(store.filePath, oldData, 0o600)
		}
	}

	return store, nil
}

// FilePath returns the underlying storage file path.
func (s *SessionStore) FilePath() string {
	return s.filePath
}

// LoadRoot reads and unmarshals the sessions tree from disk.
// It supports both the new versioned envelope ({"version": 1, "root": {...}})
// and legacy unversioned TreeNode JSON, automatically migrating legacy files.
func (s *SessionStore) LoadRoot() (*model.TreeNode, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	data, err := os.ReadFile(s.filePath)
	if os.IsNotExist(err) {
		root := seedDefaultTree()
		_ = s.saveLocked(root)
		return root, nil
	}
	if err != nil {
		return nil, err
	}

	// Tighten permissions on existing sessions file
	_ = os.Chmod(s.filePath, 0o600)

	// 1. Try parsing versioned envelope: {"version": 1, "root": {...}}
	var envelope PersistedSessions
	if err := json.Unmarshal(data, &envelope); err == nil && envelope.Version > 0 && envelope.Root != nil && envelope.Root.ID != "" {
		root := envelope.Root
		modified := ensureDefaultFolders(root)
		if modified {
			_ = s.saveLocked(root)
		}
		return root, nil
	}

	// 2. Fall back to legacy raw TreeNode format
	var legacyRoot model.TreeNode
	if err := json.Unmarshal(data, &legacyRoot); err == nil && legacyRoot.ID != "" {
		_ = ensureDefaultFolders(&legacyRoot)
		// Auto-migrate to versioned schema
		_ = s.saveLocked(&legacyRoot)
		return &legacyRoot, nil
	}

	// 2.5 Try recovering from backup file if available (GAP-16)
	bakPath := s.filePath + ".bak"
	if bakData, err := os.ReadFile(bakPath); err == nil && len(bakData) > 0 {
		var bakEnvelope PersistedSessions
		if err := json.Unmarshal(bakData, &bakEnvelope); err == nil && bakEnvelope.Root != nil && bakEnvelope.Root.ID != "" {
			root := bakEnvelope.Root
			_ = ensureDefaultFolders(root)
			_ = s.saveLocked(root)
			return root, nil
		}
	}

	// 3. If file is empty or corrupted and no valid backup exists, recover with seed default tree
	root := seedDefaultTree()
	_ = s.saveLocked(root)
	return root, nil
}

// Save writes the session tree to disk using an atomic transactional write pattern:
// 1. Marshal to versioned structure: {"version": 1, "root": {...}}
// 2. Write to sessions.json.tmp
// 3. Flush to disk (Sync)
// 4. Close file handle
// 5. Atomic rename (sessions.json.tmp -> sessions.json)
// 6. Enforce 0600 file permissions
// 7. Clean up temporary file on failure
func (s *SessionStore) Save(root *model.TreeNode) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.saveLocked(root)
}

func (s *SessionStore) saveLocked(root *model.TreeNode) error {
	if root == nil {
		return fmt.Errorf("cannot save nil root")
	}

	envelope := PersistedSessions{
		Version: CurrentStoreVersion,
		Root:    root,
	}

	data, err := json.MarshalIndent(envelope, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal session store: %w", err)
	}

	dir := filepath.Dir(s.filePath)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("create store dir: %w", err)
	}

	tmpPath := s.filePath + ".tmp"

	tmpFile, err := os.OpenFile(tmpPath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o600)
	if err != nil {
		return fmt.Errorf("create tmp session file: %w", err)
	}

	success := false
	defer func() {
		if !success {
			_ = os.Remove(tmpPath)
		}
	}()

	// Write
	if _, err := tmpFile.Write(data); err != nil {
		_ = tmpFile.Close()
		return fmt.Errorf("write tmp session file: %w", err)
	}

	// Flush to disk
	if err := tmpFile.Sync(); err != nil {
		_ = tmpFile.Close()
		return fmt.Errorf("sync tmp session file: %w", err)
	}

	// Close before renaming (critical on Windows to avoid file sharing/locking errors)
	if err := tmpFile.Close(); err != nil {
		return fmt.Errorf("close tmp session file: %w", err)
	}

	// Maintain backup of previous valid session store (GAP-16)
	bakPath := s.filePath + ".bak"
	if curData, err := os.ReadFile(s.filePath); err == nil && len(curData) > 0 {
		_ = os.WriteFile(bakPath, curData, 0o600)
	}

	// Atomic rename to target file
	if err := os.Rename(tmpPath, s.filePath); err != nil {
		return fmt.Errorf("rename tmp session file to target: %w", err)
	}

	// Tighten permissions on target file
	_ = os.Chmod(s.filePath, 0o600)

	success = true
	return nil
}

func ensureDefaultFolders(root *model.TreeNode) bool {
	if root == nil {
		return false
	}
	if root.Children == nil {
		root.Children = make([]*model.TreeNode, 0)
	}

	// Filter out old empty generic placeholder folders if they have 0 sessions
	var cleanedChildren []*model.TreeNode
	for _, child := range root.Children {
		if child == nil {
			continue
		}
		// If it's the old empty default placeholders with no sessions, replace them cleanly
		if (child.Name == "Production Servers" || child.Name == "Development & Staging") && len(child.Children) == 0 {
			continue
		}
		cleanedChildren = append(cleanedChildren, child)
	}
	if len(cleanedChildren) != len(root.Children) {
		root.Children = cleanedChildren
	}

	existingFolders := make(map[string]bool)
	for _, child := range root.Children {
		if child != nil && child.Session == nil {
			existingFolders[child.Name] = true
		}
	}

	modified := false
	for _, name := range DefaultFolderNames {
		if !existingFolders[name] {
			root.Children = append(root.Children, &model.TreeNode{
				ID:       uuid.NewString(),
				Name:     name,
				Expanded: true,
				Children: []*model.TreeNode{},
			})
			modified = true
		}
	}
	return modified
}

// SeedDefaultTree constructs a clean default session tree.
func SeedDefaultTree() *model.TreeNode {
	return seedDefaultTree()
}

func seedDefaultTree() *model.TreeNode {
	children := make([]*model.TreeNode, 0, len(DefaultFolderNames))
	for _, name := range DefaultFolderNames {
		children = append(children, &model.TreeNode{
			ID:       uuid.NewString(),
			Name:     name,
			Expanded: true,
			Children: []*model.TreeNode{},
		})
	}

	return &model.TreeNode{
		ID:       uuid.NewString(),
		Name:     "SAVED SESSIONS",
		Expanded: true,
		Children: children,
	}
}
