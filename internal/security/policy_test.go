package security

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSecurityPolicyEnforcement(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "nexterm_sec_test_*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	sm := &SecurityManager{
		policy: SecurityPolicy{
			AllowSSH:              true,
			AllowSFTP:             true,
			AllowRDP:              false,
			AllowSerial:           false,
			AllowVNC:              false,
			AllowTelnet:           false,
			AllowPasswordSaving:   false,
			AllowClipboardSharing: true,
			AllowFileTransfers:    false,
			RequireAuditLog:       true,
		},
		filePath: filepath.Join(tempDir, "policy.json"),
	}

	// 1. Allowed protocol: SSH
	if err := sm.CheckProtocol("ssh"); err != nil {
		t.Fatalf("expected ssh to be allowed, got: %v", err)
	}
	if err := sm.CheckProtocol(""); err != nil {
		t.Fatalf("expected default '' to be allowed (defaults to ssh), got: %v", err)
	}

	// 2. Disallowed protocol: Telnet
	if err := sm.CheckProtocol("telnet"); err == nil {
		t.Fatalf("expected telnet to be blocked by policy")
	}

	// 3. Disallowed protocol: RDP
	if err := sm.CheckProtocol("rdp"); err == nil {
		t.Fatalf("expected rdp to be blocked by policy")
	}

	// 4. Password saving blocked
	if err := sm.CheckPasswordSaving(); err == nil {
		t.Fatalf("expected password saving to be blocked")
	}

	// 5. File transfers blocked
	if err := sm.CheckFileTransfers(); err == nil {
		t.Fatalf("expected file transfers to be blocked")
	}

	// 6. Clipboard sharing allowed
	if err := sm.CheckClipboard(); err != nil {
		t.Fatalf("expected clipboard sharing to be allowed, got: %v", err)
	}

	// 7. Audit log required
	if !sm.IsAuditRequired() {
		t.Fatalf("expected audit log to be required")
	}

	// Enable password saving and verify
	p := sm.GetPolicy()
	p.AllowPasswordSaving = true
	if err := sm.SavePolicy(p); err != nil {
		t.Fatalf("SavePolicy failed: %v", err)
	}
	if err := sm.CheckPasswordSaving(); err != nil {
		t.Fatalf("expected password saving to now be allowed, got: %v", err)
	}
}

func TestCheckCommandBlocksDangerousVariants(t *testing.T) {
	sm := &SecurityManager{policy: SecurityPolicy{DisableDangerousCommands: true}}

	blocked := []string{
		"rm -rf /",
		"rm -fr /",
		"rm -r -f /",
		"rm -rf /*",
		"sudo rm -rf --no-preserve-root /",
		"rm --recursive --force /",
		"ls && rm -rf ~",
		"echo hi; rm -rf $HOME",
		"dd of=/dev/sda if=/dev/zero",
		"dd if=/dev/zero of=/dev/nvme0n1",
		"mkfs.ext4 /dev/sdb1",
		"reboot",
		"shutdown -h now",
		"cat x > /dev/nvme0n1",
	}
	for _, c := range blocked {
		if err := sm.CheckCommand(c); err == nil {
			t.Errorf("expected %q to be blocked", c)
		}
	}

	allowed := []string{
		"ls -la /",
		"rm -rf ./build",
		"rm file.txt",
		"rm -rf /tmp/cache",
		"mkdir -p /var/app",
		"df -h",
	}
	for _, c := range allowed {
		if err := sm.CheckCommand(c); err != nil {
			t.Errorf("expected %q to be allowed, got %v", c, err)
		}
	}

	// With the policy off nothing is blocked.
	off := &SecurityManager{policy: SecurityPolicy{DisableDangerousCommands: false}}
	if err := off.CheckCommand("rm -rf /"); err != nil {
		t.Errorf("policy disabled should allow everything, got %v", err)
	}
}
