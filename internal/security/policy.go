package security

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
)

type SecurityPolicy struct {
	AllowSSH                 bool `json:"allowSSH"`
	AllowSFTP                bool `json:"allowSFTP"`
	AllowRDP                 bool `json:"allowRDP"`
	AllowVNC                 bool `json:"allowVNC"`
	AllowTelnet              bool `json:"allowTelnet"`
	AllowSerial              bool `json:"allowSerial"`
	AllowPasswordSaving      bool `json:"allowPasswordSaving"`
	AllowClipboardSharing    bool `json:"allowClipboardSharing"`
	AllowFileTransfers       bool `json:"allowFileTransfers"`
	RequireAuditLog          bool `json:"requireAuditLog"`
	DisableDangerousCommands bool `json:"disableDangerousCommands"`
}

type CustomizerConfig struct {
	AppName         string         `json:"appName"`
	CompanyName     string         `json:"companyName"`
	CompanyLogoText string         `json:"companyLogoText"`
	SplashMessage   string         `json:"splashMessage"`
	DefaultSSHPort  int            `json:"defaultSSHPort"`
	DefaultTheme    string         `json:"defaultTheme"`
	DefaultFontSize int            `json:"defaultFontSize"`
	Security        SecurityPolicy `json:"security"`
}

type SecurityManager struct {
	mu       sync.Mutex
	policy   SecurityPolicy
	custom   CustomizerConfig
	filePath string
}

func NewSecurityManagerAt(filePath string) *SecurityManager {
	dir := filepath.Dir(filePath)
	_ = os.MkdirAll(dir, 0700)

	sm := &SecurityManager{
		policy: SecurityPolicy{
			AllowSSH:              true,
			AllowSFTP:             true,
			AllowRDP:              true,
			AllowVNC:              true,
			AllowTelnet:           false,
			AllowSerial:           true,
			AllowPasswordSaving:   true,
			AllowClipboardSharing: true,
			AllowFileTransfers:    true,
			RequireAuditLog:       false,
		},
		custom: CustomizerConfig{
			AppName:         "Nexterm Professional",
			CompanyName:     "Enterprise IT",
			CompanyLogoText: "Nexterm",
			SplashMessage:   "Empowering Enterprise Infrastructure & Cloud Engineering",
			DefaultSSHPort:  22,
			DefaultTheme:    "dark-modern",
			DefaultFontSize: 13,
		},
		filePath: filePath,
	}
	_ = sm.load()
	return sm
}

func NewSecurityManager() *SecurityManager {
	appData, err := os.UserConfigDir()
	if err != nil {
		appData = "."
	}
	dir := filepath.Join(appData, "Nexterm")
	return NewSecurityManagerAt(filepath.Join(dir, "security_policy.json"))
}

func (sm *SecurityManager) load() error {
	data, err := os.ReadFile(sm.filePath)
	if err != nil {
		return err
	}
	_ = os.Chmod(sm.filePath, 0600)
	var cfg struct {
		Policy SecurityPolicy   `json:"policy"`
		Custom CustomizerConfig `json:"custom"`
	}
	if err := json.Unmarshal(data, &cfg); err != nil {
		return err
	}
	sm.policy = cfg.Policy
	sm.custom = cfg.Custom
	return nil
}

func (sm *SecurityManager) save() error {
	cfg := struct {
		Policy SecurityPolicy   `json:"policy"`
		Custom CustomizerConfig `json:"custom"`
	}{
		Policy: sm.policy,
		Custom: sm.custom,
	}
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(sm.filePath, data, 0600); err != nil {
		return err
	}
	_ = os.Chmod(sm.filePath, 0600)
	return nil
}

func (sm *SecurityManager) GetPolicy() SecurityPolicy {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	return sm.policy
}

func (sm *SecurityManager) SavePolicy(p SecurityPolicy) error {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	sm.policy = p
	return sm.save()
}

func (sm *SecurityManager) GetCustomizer() CustomizerConfig {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	return sm.custom
}

func (sm *SecurityManager) SaveCustomizer(c CustomizerConfig) error {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	sm.custom = c
	return sm.save()
}

// CheckProtocol validates if connecting via the specified protocol is permitted by administrator policy.
func (sm *SecurityManager) CheckProtocol(proto string) error {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	p := sm.policy
	switch strings.ToLower(proto) {
	case "ssh", "":
		if !p.AllowSSH {
			return fmt.Errorf("security policy denied: SSH protocol is disabled by administrator policy")
		}
	case "sftp":
		if !p.AllowSFTP {
			return fmt.Errorf("security policy denied: SFTP protocol is disabled by administrator policy")
		}
	case "rdp":
		if !p.AllowRDP {
			return fmt.Errorf("security policy denied: RDP protocol is disabled by administrator policy")
		}
	case "vnc":
		if !p.AllowVNC {
			return fmt.Errorf("security policy denied: VNC protocol is disabled by administrator policy")
		}
	case "telnet":
		if !p.AllowTelnet {
			return fmt.Errorf("security policy denied: Telnet protocol is disabled by administrator policy (unencrypted traffic prohibited)")
		}
	case "serial":
		if !p.AllowSerial {
			return fmt.Errorf("security policy denied: Serial COM protocol is disabled by administrator policy")
		}
	}
	return nil
}

// CheckPasswordSaving validates if saving passwords in the credential vault is allowed.
func (sm *SecurityManager) CheckPasswordSaving() error {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	if !sm.policy.AllowPasswordSaving {
		return fmt.Errorf("security policy denied: password saving is disabled by administrator policy")
	}
	return nil
}

// CheckFileTransfers validates if uploading or downloading files via SFTP is allowed.
func (sm *SecurityManager) CheckFileTransfers() error {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	if !sm.policy.AllowFileTransfers {
		return fmt.Errorf("security policy denied: file transfers are disabled by administrator policy")
	}
	return nil
}

// CheckClipboard validates if clipboard sharing is allowed.
func (sm *SecurityManager) CheckClipboard() error {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	if !sm.policy.AllowClipboardSharing {
		return fmt.Errorf("security policy denied: clipboard sharing is disabled by administrator policy")
	}
	return nil
}

// IsAuditRequired returns whether audit logging is mandatory by policy.
func (sm *SecurityManager) IsAuditRequired() bool {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	return sm.policy.RequireAuditLog
}

// DangerousCommandPatterns matches commands with catastrophic or destructive impact.
var DangerousCommandPatterns = []*regexp.Regexp{
	regexp.MustCompile(`(?i)\bmkfs(?:\.[a-z0-9]+)?\b`),                                  // mkfs, mkfs.ext4
	regexp.MustCompile(`(?i)\bdd\b[^\n;|&]*\bof=/dev/[a-z0-9]+`),                         // dd to raw block device (any argument order)
	regexp.MustCompile(`:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:`),                      // shell fork bomb
	regexp.MustCompile(`(?i)\b(?:shutdown|poweroff|halt|reboot|init\s+[06])\b`),          // system power down / restart
	regexp.MustCompile(`(?i)>\s*/dev/(?:sd[a-z]|nvme\d|hd[a-z]|vd[a-z]|xvd[a-z]|mmcblk)`), // disk overwrite
}

// commandSeparators splits a command line into the simple commands a shell would
// run one after another.
var commandSeparators = regexp.MustCompile(`&&|\|\||[;|&\n\r]`)

// rmWipeTargets are arguments that make a recursive rm catastrophic.
var rmWipeTargets = map[string]bool{
	"/": true, "/*": true, "~": true, "~/": true, "~/*": true,
	"$home": true, "${home}": true, "$home/": true, "$home/*": true, "${home}/*": true,
	"/home": true, "/etc": true, "/usr": true, "/var": true, "/boot": true, "/bin": true, "/lib": true,
}

// isDangerousRm reports whether one simple command is a recursive rm aimed at the
// filesystem root or a home/system directory, whichever way the flags are spelled
// (-rf, -fr, -r -f, --recursive, --no-preserve-root, sudo/env prefixes).
func isDangerousRm(segment string) bool {
	fields := strings.Fields(strings.ToLower(segment))
	start := -1
	for i, f := range fields {
		base := f
		if idx := strings.LastIndex(base, "/"); idx >= 0 {
			base = base[idx+1:]
		}
		if base == "rm" {
			start = i
			break
		}
	}
	if start < 0 {
		return false
	}
	recursive, noPreserve := false, false
	var targets []string
	for _, f := range fields[start+1:] {
		switch {
		case f == "--recursive":
			recursive = true
		case f == "--no-preserve-root":
			noPreserve = true
		case strings.HasPrefix(f, "--"):
		case strings.HasPrefix(f, "-") && len(f) > 1:
			if strings.ContainsAny(f[1:], "r") {
				recursive = true
			}
		default:
			targets = append(targets, strings.Trim(f, `"'`))
		}
	}
	if !recursive {
		return false
	}
	if noPreserve {
		return true
	}
	for _, t := range targets {
		if rmWipeTargets[t] {
			return true
		}
	}
	return false
}

// CheckCommand evaluates a command string against security policy rules.
func (sm *SecurityManager) CheckCommand(cmd string) error {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	if !sm.policy.DisableDangerousCommands {
		return nil
	}
	trimmed := strings.TrimSpace(cmd)
	denied := fmt.Errorf("security policy denied: dangerous command '%s' is prohibited by administrator policy", trimmed)
	for _, pattern := range DangerousCommandPatterns {
		if pattern.MatchString(trimmed) {
			return denied
		}
	}
	for _, segment := range commandSeparators.Split(trimmed, -1) {
		if isDangerousRm(segment) {
			return denied
		}
	}
	return nil
}

