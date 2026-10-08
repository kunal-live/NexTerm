package service

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"sync"

	"nexterm/internal/model"
	"nexterm/internal/sshsession"
	"nexterm/internal/store"

	"github.com/google/uuid"
)

// SessionService manages the saved sessions tree, folders, and profile configurations.
type SessionService struct {
	mu           sync.RWMutex
	store        *store.SessionStore
	root         *model.TreeNode
	vaultCleanup func(key string)
	vaultSave    func(key, value string) error
	vaultLoad    func(key string) (string, bool, error)
}

// NewSessionService constructs a new SessionService.
func NewSessionService(s *store.SessionStore) *SessionService {
	return &SessionService{
		store: s,
	}
}

// HasStore returns true if the service has a configured session store.
func (s *SessionService) HasStore() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.store != nil
}

// SetVaultHooks registers hooks for credential cleanup, saving, and loading during tree operations.
func (s *SessionService) SetVaultHooks(cleanup func(key string), save func(key, value string) error, load func(key string) (string, bool, error)) {
	s.mu.Lock()
	s.vaultCleanup = cleanup
	s.vaultSave = save
	s.vaultLoad = load
	s.mu.Unlock()
}

// LoadRoot initializes the tree from disk store or sets up the default root.
func (s *SessionService) LoadRoot() (*model.TreeNode, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.store == nil {
		s.root = &model.TreeNode{
			ID:       uuid.NewString(),
			Name:     "All Sessions",
			Expanded: true,
			Children: []*model.TreeNode{},
		}
		return s.root, nil
	}

	root, err := s.store.LoadRoot()
	if err != nil {
		s.root = &model.TreeNode{
			ID:       uuid.NewString(),
			Name:     "All Sessions",
			Expanded: true,
			Children: []*model.TreeNode{},
		}
		return s.root, err
	}
	s.root = root
	return s.root, nil
}

// SetRoot directly assigns the root node.
func (s *SessionService) SetRoot(root *model.TreeNode) {
	s.mu.Lock()
	s.root = root
	s.mu.Unlock()
}

// GetSessionTree returns the full saved-sessions tree for the sidebar.
func (s *SessionService) GetSessionTree() *model.TreeNode {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.root
}

// ResetToDefault resets the session tree back to the default empty folder categories,
// persisting the fresh tree to disk and removing any backup file.
func (s *SessionService) ResetToDefault() (*model.TreeNode, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	cleanRoot := store.SeedDefaultTree()
	s.root = cleanRoot

	if s.store != nil {
		if err := s.store.Save(cleanRoot); err != nil {
			return cleanRoot, err
		}
		bakPath := s.store.FilePath() + ".bak"
		_ = os.Remove(bakPath)
	}
	return cleanRoot, nil
}

// AddFolder adds a new subfolder under parentID.
func (s *SessionService) AddFolder(parentID, name string) (*model.TreeNode, error) {
	return s.AddFolderWithOptions(parentID, name, "", "", "", 0)
}

// AddFolderWithOptions adds a new subfolder under parentID with custom default options.
func (s *SessionService) AddFolderWithOptions(parentID, name, defaultUsername, environment, color string, defaultPort int) (*model.TreeNode, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if name == "" {
		name = "New Folder"
	}
	parent := findNode(s.root, parentID)
	if parent == nil {
		parent = s.root
	}
	node := &model.TreeNode{
		ID:              uuid.NewString(),
		Name:            name,
		Expanded:        true,
		Children:        []*model.TreeNode{},
		DefaultUsername: defaultUsername,
		DefaultPort:     defaultPort,
		Environment:     environment,
		Color:           color,
	}
	parent.Children = append(parent.Children, node)
	return s.root, s.saveTree()
}

// ConfigureFolder updates an existing folder's name and default options.
func (s *SessionService) ConfigureFolder(id, name, defaultUsername, environment, color string, defaultPort int) (*model.TreeNode, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	node := findNode(s.root, id)
	if node == nil {
		return s.root, fmt.Errorf("folder not found: %s", id)
	}
	if name != "" {
		node.Name = name
	}
	node.DefaultUsername = defaultUsername
	node.DefaultPort = defaultPort
	node.Environment = environment
	node.Color = color
	return s.root, s.saveTree()
}

// RenameNode renames either a folder or a session node.
func (s *SessionService) RenameNode(id, newName string) (*model.TreeNode, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if newName == "" {
		return s.root, fmt.Errorf("name cannot be empty")
	}
	node := findNode(s.root, id)
	if node == nil {
		return s.root, fmt.Errorf("node not found: %s", id)
	}
	node.Name = newName
	if node.Session != nil {
		node.Session.Name = newName
	}
	return s.root, s.saveTree()
}

// UpdateFolder renames an existing folder node.
func (s *SessionService) UpdateFolder(id, name string) (*model.TreeNode, error) {
	return s.RenameNode(id, name)
}

// ToggleFolder sets the expanded state of a folder node.
func (s *SessionService) ToggleFolder(id string, expanded bool) (*model.TreeNode, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	node := findNode(s.root, id)
	if node != nil && node.IsFolder() {
		node.Expanded = expanded
		_ = s.saveTree()
	}
	return s.root, nil
}

// DeleteNode removes a folder or session node by ID, cleaning up any vault credentials.
func (s *SessionService) DeleteNode(id string) (*model.TreeNode, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.root == nil || id == s.root.ID {
		return s.root, fmt.Errorf("cannot delete root node")
	}

	node := findNode(s.root, id)
	if node != nil && s.vaultCleanup != nil {
		s.cleanupVaultKeysRecursive(node)
	}

	deleted := deleteNodeRecursive(s.root, id)
	if !deleted {
		return s.root, fmt.Errorf("node not found: %s", id)
	}
	return s.root, s.saveTree()
}

func (s *SessionService) cleanupVaultKeysRecursive(n *model.TreeNode) {
	if n == nil {
		return
	}
	if n.Session != nil {
		if n.Session.VaultKey != "" {
			s.vaultCleanup(n.Session.VaultKey)
			s.vaultCleanup(n.Session.VaultKey + "_passphrase")
		}
		if n.Session.PassphraseVaultKey != "" {
			s.vaultCleanup(n.Session.PassphraseVaultKey)
		}
		if n.Session.ProxyVaultKey != "" {
			s.vaultCleanup(n.Session.ProxyVaultKey)
		}
		if n.Session.VaultKey != "" {
			s.vaultCleanup(n.Session.VaultKey + "_proxy")
		}
	}
	for _, c := range n.Children {
		s.cleanupVaultKeysRecursive(c)
	}
}

// AddSession creates a new session in the given parent folder.
func (s *SessionService) AddSession(parentID string, profile model.SessionProfile) (*model.TreeNode, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	parent := findNode(s.root, parentID)
	if parent == nil {
		parent = s.root
	}
	if profile.ID == "" {
		profile.ID = uuid.NewString()
	}
	if profile.VaultKey == "" {
		profile.VaultKey = profile.ID
	}
	if profile.Port <= 0 {
		profile.Port = 22
	}
	if profile.Name == "" {
		profile.Name = profile.Host
	}

	// Inspect key and extract metadata before save
	if profile.PrivateKeyPath != "" && (profile.KeyType == "" || profile.KeyFingerprint == "") {
		if info, err := sshsession.ValidatePrivateKey(profile.PrivateKeyPath, profile.KeyPassphrase); err == nil && info.Valid {
			profile.KeyType = info.KeyType
			profile.KeyFingerprint = info.Fingerprint
		}
	}

	// Securely persist key passphrase to vault, never in sessions.json
	if profile.KeyPassphrase != "" && s.vaultSave != nil {
		pvKey := profile.VaultKey + "_passphrase"
		_ = s.vaultSave(pvKey, profile.KeyPassphrase)
		profile.PassphraseVaultKey = pvKey
		profile.KeyPassphrase = ""
	}

	// Securely persist proxy password to vault, never in sessions.json
	if profile.ProxyPassword != "" && s.vaultSave != nil {
		pxKey := profile.VaultKey + "_proxy"
		_ = s.vaultSave(pxKey, profile.ProxyPassword)
		profile.ProxyVaultKey = pxKey
		profile.ProxyPassword = ""
	}

	// Deduplicate: if an existing session under this parent matches the exact host, port, and username,
	// update it in place so multiple duplicate nodes are not created repeatedly.
	for _, c := range parent.Children {
		if c.Session != nil && strings.EqualFold(c.Session.Host, profile.Host) &&
			c.Session.Port == profile.Port && strings.EqualFold(c.Session.Username, profile.Username) &&
			strings.EqualFold(c.Session.Protocol, profile.Protocol) {
			c.Name = profile.Name
			c.Session.Name = profile.Name
			c.Session.Environment = profile.Environment
			c.Session.Color = profile.Color
			c.Session.AuthType = profile.AuthType
			if profile.VaultKey != "" {
				c.Session.VaultKey = profile.VaultKey
			}
			if profile.PrivateKeyPath != "" {
				c.Session.PrivateKeyPath = profile.PrivateKeyPath
				c.Session.KeyType = profile.KeyType
				c.Session.KeyFingerprint = profile.KeyFingerprint
			}
			return s.root, s.saveTree()
		}
	}

	node := &model.TreeNode{
		ID:      uuid.NewString(),
		Name:    profile.Name,
		Session: &profile,
	}
	parent.Children = append(parent.Children, node)
	return s.root, s.saveTree()
}

// UpdateSession updates an existing session's configuration.
func (s *SessionService) UpdateSession(profile model.SessionProfile) (*model.TreeNode, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	node := findNodeBySessionID(s.root, profile.ID)
	if node == nil {
		return s.root, fmt.Errorf("session not found: %s", profile.ID)
	}
	if profile.Port <= 0 {
		profile.Port = 22
	}
	if profile.VaultKey == "" {
		profile.VaultKey = profile.ID
	}

	// Inspect key and extract metadata
	if profile.PrivateKeyPath != "" {
		pass := profile.KeyPassphrase
		if pass == "" && s.vaultLoad != nil {
			if saved, ok, _ := s.vaultLoad(profile.VaultKey + "_passphrase"); ok {
				pass = saved
			}
		}
		if info, err := sshsession.ValidatePrivateKey(profile.PrivateKeyPath, pass); err == nil && info.Valid {
			profile.KeyType = info.KeyType
			profile.KeyFingerprint = info.Fingerprint
		}
	}

	// Securely persist key passphrase to vault, never in sessions.json
	if profile.KeyPassphrase != "" && s.vaultSave != nil {
		pvKey := profile.VaultKey + "_passphrase"
		_ = s.vaultSave(pvKey, profile.KeyPassphrase)
		profile.PassphraseVaultKey = pvKey
		profile.KeyPassphrase = ""
	}

	// Securely persist proxy password to vault, never in sessions.json
	if profile.ProxyPassword != "" && s.vaultSave != nil {
		pxKey := profile.VaultKey + "_proxy"
		_ = s.vaultSave(pxKey, profile.ProxyPassword)
		profile.ProxyVaultKey = pxKey
		profile.ProxyPassword = ""
	}

	node.Name = profile.Name
	node.Session = &profile
	return s.root, s.saveTree()
}

// DuplicateSession creates a copy of an existing session profile.
func (s *SessionService) DuplicateSession(id string) (*model.TreeNode, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	node := findNode(s.root, id)
	if node == nil || node.Session == nil {
		return s.root, fmt.Errorf("session node not found: %s", id)
	}
	parent := findParentNode(s.root, id)
	if parent == nil {
		parent = s.root
	}
	cloneProfile := *node.Session
	oldVaultKey := cloneProfile.VaultKey
	cloneProfile.ID = uuid.NewString()
	cloneProfile.VaultKey = cloneProfile.ID
	cloneProfile.Name = cloneProfile.Name + " (Copy)"

	// Duplicate password & passphrase in vault if present
	if oldVaultKey != "" && s.vaultLoad != nil && s.vaultSave != nil {
		if pwd, ok, err := s.vaultLoad(oldVaultKey); err == nil && ok && pwd != "" {
			_ = s.vaultSave(cloneProfile.VaultKey, pwd)
		}
		if pass, ok, err := s.vaultLoad(oldVaultKey + "_passphrase"); err == nil && ok && pass != "" {
			_ = s.vaultSave(cloneProfile.VaultKey+"_passphrase", pass)
			cloneProfile.PassphraseVaultKey = cloneProfile.VaultKey + "_passphrase"
		}
	}

	newNode := &model.TreeNode{
		ID:      uuid.NewString(),
		Name:    cloneProfile.Name,
		Session: &cloneProfile,
	}
	parent.Children = append(parent.Children, newNode)
	return s.root, s.saveTree()
}

// DuplicateFolder creates a deep recursive copy of a folder, its subfolders, and sessions.
func (s *SessionService) DuplicateFolder(folderID string) (*model.TreeNode, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	node := findNode(s.root, folderID)
	if node == nil || !node.IsFolder() {
		return s.root, fmt.Errorf("folder not found: %s", folderID)
	}
	parent := findParentNode(s.root, folderID)
	if parent == nil {
		parent = s.root
	}

	cloned := s.cloneFolderRecursive(node)
	cloned.Name = node.Name + " (Copy)"
	parent.Children = append(parent.Children, cloned)
	return s.root, s.saveTree()
}

func (s *SessionService) cloneFolderRecursive(src *model.TreeNode) *model.TreeNode {
	if src == nil {
		return nil
	}
	clone := &model.TreeNode{
		ID:       uuid.NewString(),
		Name:     src.Name,
		Expanded: src.Expanded,
		Children: make([]*model.TreeNode, 0, len(src.Children)),
	}

	if src.Session != nil {
		profCopy := *src.Session
		oldVaultKey := profCopy.VaultKey
		profCopy.ID = uuid.NewString()
		profCopy.VaultKey = profCopy.ID
		clone.Session = &profCopy

		if oldVaultKey != "" && s.vaultLoad != nil && s.vaultSave != nil {
			if pwd, ok, err := s.vaultLoad(oldVaultKey); err == nil && ok && pwd != "" {
				_ = s.vaultSave(profCopy.VaultKey, pwd)
			}
		}
	}

	for _, child := range src.Children {
		clonedChild := s.cloneFolderRecursive(child)
		if clonedChild != nil {
			clone.Children = append(clone.Children, clonedChild)
		}
	}
	return clone
}

// ExpandAllFolders expands or collapses all folders in the session tree.
func (s *SessionService) ExpandAllFolders(expanded bool) (*model.TreeNode, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	var walk func(n *model.TreeNode)
	walk = func(n *model.TreeNode) {
		if n == nil {
			return
		}
		if n.IsFolder() {
			n.Expanded = expanded
		}
		for _, c := range n.Children {
			walk(c)
		}
	}
	walk(s.root)
	_ = s.saveTree()
	return s.root, nil
}

// MoveNode moves any node to targetParentID at targetIndex, preventing cycles.
func (s *SessionService) MoveNode(sourceID, targetParentID string, targetIndex int) (*model.TreeNode, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.root == nil || sourceID == s.root.ID {
		return s.root, fmt.Errorf("cannot move root node")
	}
	sourceNode := findNode(s.root, sourceID)
	if sourceNode == nil {
		return s.root, fmt.Errorf("source node not found: %s", sourceID)
	}

	// Resolve target parent node
	var targetParent *model.TreeNode
	if targetParentID == "" || targetParentID == s.root.ID {
		targetParent = s.root
	} else {
		targetParent = findNode(s.root, targetParentID)
		if targetParent == nil {
			targetParent = s.root
		}
	}

	// If target parent is a session leaf, place alongside it in its parent folder
	if targetParent.Session != nil {
		actualParent := findParentNode(s.root, targetParent.ID)
		if actualParent != nil {
			targetParent = actualParent
		} else {
			targetParent = s.root
		}
	}

	// Cycle detection: cannot move a folder into itself or its own descendants
	if sourceNode.IsFolder() {
		if sourceNode.ID == targetParent.ID || isDescendantNode(sourceNode, targetParent) {
			return s.root, fmt.Errorf("cannot move folder '%s' into itself or its subfolder", sourceNode.Name)
		}
	}

	// Detach sourceNode from its current parent
	currentParent := findParentNode(s.root, sourceID)
	if currentParent == nil {
		return s.root, fmt.Errorf("current parent not found for node: %s", sourceID)
	}

	currentIndex := -1
	for i, c := range currentParent.Children {
		if c.ID == sourceID {
			currentIndex = i
			break
		}
	}

	if currentIndex >= 0 {
		currentParent.Children = append(currentParent.Children[:currentIndex], currentParent.Children[currentIndex+1:]...)
	}

	// Insert into target parent
	if targetParent.Children == nil {
		targetParent.Children = make([]*model.TreeNode, 0)
	}

	if targetIndex < 0 || targetIndex >= len(targetParent.Children) {
		targetParent.Children = append(targetParent.Children, sourceNode)
	} else {
		targetParent.Children = append(targetParent.Children[:targetIndex], append([]*model.TreeNode{sourceNode}, targetParent.Children[targetIndex:]...)...)
	}

	return s.root, s.saveTree()
}

// MoveSession moves a session node to a new parent folder.
func (s *SessionService) MoveSession(nodeID, targetFolderID string) (*model.TreeNode, error) {
	return s.MoveNode(nodeID, targetFolderID, -1)
}

// ExportSessions returns the serialized JSON of the entire session tree.
func (s *SessionService) ExportSessions() (string, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	data, err := json.MarshalIndent(s.root, "", "  ")
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// ValidateAndNormalizeTree validates and sanitizes an imported session tree before committing (GAP-15).
func (s *SessionService) ValidateAndNormalizeTree(imported *model.TreeNode) (*model.TreeNode, error) {
	return ValidateAndNormalizeTree(imported)
}

// ValidateAndNormalizeTree validates and sanitizes an imported session tree before committing (GAP-15).
func ValidateAndNormalizeTree(imported *model.TreeNode) (*model.TreeNode, error) {
	if imported == nil {
		return nil, fmt.Errorf("import rejected: root node is null")
	}

	seenIDs := make(map[string]bool)
	visitedNodes := make(map[*model.TreeNode]bool)

	var walk func(node *model.TreeNode, depth int) error
	walk = func(node *model.TreeNode, depth int) error {
		if node == nil {
			return nil
		}
		if depth > 50 {
			return fmt.Errorf("import rejected: tree exceeds maximum supported hierarchy depth (possible cycle)")
		}
		if visitedNodes[node] {
			return fmt.Errorf("import rejected: cyclic reference detected in session tree")
		}
		visitedNodes[node] = true

		// Ensure node has a valid, non-empty ID
		if node.ID == "" || seenIDs[node.ID] {
			node.ID = uuid.NewString()
		}
		seenIDs[node.ID] = true

		if node.Name == "" {
			if node.Session != nil {
				node.Name = "Imported Session"
			} else {
				node.Name = "Imported Folder"
			}
		}

		if node.Session != nil {
			sess := node.Session
			if sess.ID == "" || seenIDs[sess.ID] {
				sess.ID = uuid.NewString()
			}
			seenIDs[sess.ID] = true

			if sess.Name == "" {
				sess.Name = node.Name
			}

			// Validate and normalize protocol
			proto := strings.ToLower(strings.TrimSpace(sess.Protocol))
			validProtos := map[string]bool{
				"ssh": true, "sftp": true, "rdp": true, "vnc": true,
				"telnet": true, "serial": true, "local": true,
			}
			if proto == "" || !validProtos[proto] {
				proto = "ssh"
			}
			sess.Protocol = proto

			// Validate and normalize port
			if sess.Port <= 0 || sess.Port > 65535 {
				switch proto {
				case "rdp":
					sess.Port = 3389
				case "vnc":
					sess.Port = 5900
				case "telnet":
					sess.Port = 23
				default:
					sess.Port = 22
				}
			}

			// Ensure vault key exists
			if sess.VaultKey == "" {
				sess.VaultKey = sess.ID
			}

			// SECURITY: never auto-run a startup command that arrived via import.
			// Quarantine it so it cannot execute on first connect (RCE vector); the
			// user must open the session and Save to deliberately re-enable it.
			if sess.StartupCommand != "" {
				sess.QuarantinedStartupCommand = sess.StartupCommand
				sess.StartupCommand = ""
			}
		}

		for _, child := range node.Children {
			if err := walk(child, depth+1); err != nil {
				return err
			}
		}
		return nil
	}

	if imported.ID == "" {
		imported.ID = "root"
	}
	if imported.Name == "" {
		imported.Name = "Sessions"
	}

	if err := walk(imported, 0); err != nil {
		return nil, err
	}
	return imported, nil
}

// ImportSessions validates, normalizes and restores session tree from a JSON string (GAP-15).
func (s *SessionService) ImportSessions(jsonContent string) (*model.TreeNode, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	var imported model.TreeNode
	if err := json.Unmarshal([]byte(jsonContent), &imported); err != nil {
		return s.root, fmt.Errorf("invalid session JSON: %w", err)
	}

	validated, err := ValidateAndNormalizeTree(&imported)
	if err != nil {
		return s.root, fmt.Errorf("session validation failed: %w", err)
	}

	s.root = validated
	return s.root, s.saveTree()
}

// FindNode locates a node by ID.
func (s *SessionService) FindNode(id string) *model.TreeNode {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return findNode(s.root, id)
}

func (s *SessionService) saveTree() error {
	if s.store == nil || s.root == nil {
		return nil
	}
	return s.store.Save(s.root)
}

// Internal tree traversal helpers

func findNode(n *model.TreeNode, id string) *model.TreeNode {
	if n == nil {
		return nil
	}
	if n.ID == id {
		return n
	}
	for _, c := range n.Children {
		if found := findNode(c, id); found != nil {
			return found
		}
	}
	return nil
}

func findNodeBySessionID(n *model.TreeNode, sessionID string) *model.TreeNode {
	if n == nil {
		return nil
	}
	if (n.Session != nil && n.Session.ID == sessionID) || n.ID == sessionID {
		return n
	}
	for _, c := range n.Children {
		if found := findNodeBySessionID(c, sessionID); found != nil {
			return found
		}
	}
	return nil
}

func findParentNode(root *model.TreeNode, childID string) *model.TreeNode {
	if root == nil {
		return nil
	}
	for _, c := range root.Children {
		if c.ID == childID {
			return root
		}
		if found := findParentNode(c, childID); found != nil {
			return found
		}
	}
	return nil
}

func deleteNodeRecursive(parent *model.TreeNode, id string) bool {
	if parent == nil {
		return false
	}
	for i, c := range parent.Children {
		if c.ID == id {
			parent.Children = append(parent.Children[:i], parent.Children[i+1:]...)
			return true
		}
		if deleteNodeRecursive(c, id) {
			return true
		}
	}
	return false
}

func isDescendantNode(ancestor, candidateChild *model.TreeNode) bool {
	if ancestor == nil || candidateChild == nil {
		return false
	}
	if ancestor.ID == candidateChild.ID {
		return true
	}
	for _, c := range ancestor.Children {
		if isDescendantNode(c, candidateChild) {
			return true
		}
	}
	return false
}
