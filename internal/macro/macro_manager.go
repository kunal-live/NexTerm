package macro

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

type Macro struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Commands    []string `json:"commands"`
	DelayMs     int      `json:"delayMs"`
	Category    string   `json:"category"`
}

type MacroManager struct {
	mu       sync.Mutex
	macros   map[string]Macro
	removed  map[string]bool // built-in snippet IDs the user deleted
	filePath string
}

func NewMacroManager() *MacroManager {
	appData, err := os.UserConfigDir()
	if err != nil {
		appData = "."
	}
	dir := filepath.Join(appData, "Nexterm")
	_ = os.MkdirAll(dir, 0700)

	mm := &MacroManager{
		macros:   make(map[string]Macro),
		removed:  make(map[string]bool),
		filePath: filepath.Join(dir, "macros.json"),
	}
	if err := mm.load(); err != nil {
		if os.IsNotExist(err) {
			mm.seedDefaults()
		} else {
			// Unreadable file: offer the built-ins without overwriting it yet.
			for _, d := range mm.defaultSnippets() {
				mm.macros[d.ID] = d
			}
		}
	}
	return mm
}

// removedFilePath stores which built-in snippets were deleted, so load() does
// not restore them on the next start.
func (mm *MacroManager) removedFilePath() string {
	return filepath.Join(filepath.Dir(mm.filePath), "macros_removed.json")
}

func (mm *MacroManager) isDefaultID(id string) bool {
	for _, d := range mm.defaultSnippets() {
		if d.ID == id {
			return true
		}
	}
	return false
}

func (mm *MacroManager) defaultSnippets() []Macro {
	return []Macro{
		{
			ID:          "m-restart-svc",
			Name:        "Restart service",
			Description: "Restart system service (e.g. nginx, apache2, systemd)",
			Commands:    []string{"sudo systemctl restart nginx || sudo service nginx restart"},
			DelayMs:     500,
			Category:    "Commands",
		},
		{
			ID:          "m-check-logs",
			Name:        "Check logs",
			Description: "Follow recent service and syslog messages in real-time",
			Commands:    []string{"sudo journalctl -n 50 -f || tail -n 50 -f /var/log/syslog"},
			DelayMs:     500,
			Category:    "Commands",
		},
		{
			ID:          "m-disk-usage",
			Name:        "Disk usage",
			Description: "Inspect partition capacity and top storage-consuming directories",
			Commands:    []string{"df -h && du -sh * 2>/dev/null | sort -hr | head -n 10"},
			DelayMs:     500,
			Category:    "Commands",
		},
		{
			ID:          "m-restart-app",
			Name:        "Restart application",
			Description: "Restart Docker compose containers or PM2 process clusters",
			Commands:    []string{"docker compose restart || pm2 restart all"},
			DelayMs:     500,
			Category:    "Commands",
		},
		{
			ID:          "m-git-pull",
			Name:        "Git pull",
			Description: "Fetch and fast-forward latest upstream git commits",
			Commands:    []string{"git pull && git status"},
			DelayMs:     500,
			Category:    "Commands",
		},
		{
			ID:          "m-sys-check",
			Name:        "System Health & Resources",
			Description: "Check uptime, CPU load, free memory, and disk space",
			Commands:    []string{"uptime", "free -h", "df -h"},
			DelayMs:     500,
			Category:    "Monitoring",
		},
		{
			ID:          "m-net-check",
			Name:        "Network & Open Ports",
			Description: "Inspect IP configuration, routing table, and open listening ports",
			Commands:    []string{"ip addr show || ifconfig", "ss -tuln || netstat -tuln"},
			DelayMs:     500,
			Category:    "Network",
		},
		{
			ID:          "m-proc-check",
			Name:        "Top Resource Processes",
			Description: "List top 10 memory-consuming processes and failed systemd units",
			Commands:    []string{"ps aux --sort=-%mem | head -n 10", "systemctl --failed --no-pager || true"},
			DelayMs:     500,
			Category:    "Processes",
		},
		{
			ID:          "m-docker-check",
			Name:        "Docker Containers & Stats",
			Description: "View running container list and quick resource snapshot",
			Commands:    []string{"docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'", "docker stats --no-stream || true"},
			DelayMs:     500,
			Category:    "DevOps",
		},
	}
}

func (mm *MacroManager) seedDefaults() {
	for _, d := range mm.defaultSnippets() {
		mm.macros[d.ID] = d
	}
	_ = mm.save()
}

func (mm *MacroManager) load() error {
	data, err := os.ReadFile(mm.filePath)
	if err != nil {
		return err
	}
	_ = os.Chmod(mm.filePath, 0600)
	var list []Macro
	if err := json.Unmarshal(data, &list); err != nil {
		return err
	}
	for _, m := range list {
		mm.macros[m.ID] = m
	}
	if raw, err := os.ReadFile(mm.removedFilePath()); err == nil {
		var ids []string
		if json.Unmarshal(raw, &ids) == nil {
			for _, id := range ids {
				mm.removed[id] = true
			}
		}
	}
	// Ensure standard snippets are present, except ones the user deleted
	hasNew := false
	for _, d := range mm.defaultSnippets() {
		if _, exists := mm.macros[d.ID]; !exists && !mm.removed[d.ID] {
			mm.macros[d.ID] = d
			hasNew = true
		}
	}
	if hasNew {
		_ = mm.save()
	}
	return nil
}

func (mm *MacroManager) save() error {
	var list []Macro
	for _, m := range mm.macros {
		list = append(list, m)
	}
	data, err := json.MarshalIndent(list, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(mm.filePath, data, 0600); err != nil {
		return err
	}
	_ = os.Chmod(mm.filePath, 0600)
	return nil
}

func (mm *MacroManager) GetMacros() []Macro {
	mm.mu.Lock()
	defer mm.mu.Unlock()

	var list []Macro
	for _, m := range mm.macros {
		list = append(list, m)
	}
	// Map iteration order is random; keep the UI list stable.
	sort.Slice(list, func(i, j int) bool {
		if list[i].Name != list[j].Name {
			return list[i].Name < list[j].Name
		}
		return list[i].ID < list[j].ID
	})
	return list
}

func (mm *MacroManager) SaveMacro(m Macro) error {
	mm.mu.Lock()
	defer mm.mu.Unlock()

	if m.ID == "" {
		m.ID = fmt.Sprintf("macro-%d", time.Now().UnixNano())
	}
	if m.DelayMs <= 0 {
		m.DelayMs = 500
	}
	mm.macros[m.ID] = m
	return mm.save()
}

func (mm *MacroManager) DeleteMacro(id string) error {
	mm.mu.Lock()
	defer mm.mu.Unlock()

	delete(mm.macros, id)
	if mm.isDefaultID(id) && !mm.removed[id] {
		mm.removed[id] = true
		ids := make([]string, 0, len(mm.removed))
		for rid := range mm.removed {
			ids = append(ids, rid)
		}
		sort.Strings(ids)
		if data, err := json.Marshal(ids); err == nil {
			_ = os.WriteFile(mm.removedFilePath(), data, 0600)
		}
	}
	return mm.save()
}
