package protocol

import (
	"nexterm/internal/model"
	"strings"
	"testing"
)

func TestGenerateRDPProfileContent_Defaults(t *testing.T) {
	profile := model.SessionProfile{
		ID:       "rdp-test-1",
		Name:     "Windows Lab",
		Host:     "192.168.1.100",
		Username: "admin",
		Protocol: "rdp",
	}

	content := GenerateRDPProfileContent(profile, 3389)

	expectedDirectives := []string{
		"full address:s:192.168.1.100:3389",
		"prompt for credentials:i:1",
		"username:s:admin",
		"redirectclipboard:i:1",
		"audiomode:i:0",
		"connection type:i:7",
		"networkautodetect:i:1",
		"bandwidthautodetect:i:1",
	}

	for _, dir := range expectedDirectives {
		if !strings.Contains(content, dir) {
			t.Errorf("expected directive %q not found in generated profile: %s", dir, content)
		}
	}

	// Verify drivestoredirect is NOT present when not requested
	if strings.Contains(content, "drivestoredirect:s:*") {
		t.Errorf("drivestoredirect should not be present when disabled")
	}
}

func TestGenerateRDPProfileContent_AdvancedOptions(t *testing.T) {
	clipboardDisabled := false
	profile := model.SessionProfile{
		ID:                    "rdp-test-2",
		Name:                  "Dev Machine",
		Host:                  "rdp.example.com",
		Username:              "developer",
		RDPDomain:             "CORP",
		RDPFullScreen:         false,
		RDPWidth:              1920,
		RDPHeight:             1080,
		RDPRedirectDrives:     true,
		RDPRedirectClipboard:  &clipboardDisabled,
		RDPRedirectPrinters:   true,
		RDPRedirectPorts:      true,
		RDPRedirectSmartCards: true,
		RDPAudioMode:          1, // remote playback
		RDPAudioCapture:       true,
		RDPPerformanceFlags:   6, // high speed broadband
	}

	content := GenerateRDPProfileContent(profile, 3390)

	expectedDirectives := []string{
		"full address:s:rdp.example.com:3390",
		"username:s:developer",
		"domain:s:CORP",
		"desktopwidth:i:1920",
		"desktopheight:i:1080",
		"screen mode id:i:1",
		"drivestoredirect:s:*",
		"redirectclipboard:i:0",
		"redirectprinters:i:1",
		"redirectcomports:i:1",
		"redirectsmartcards:i:1",
		"audiomode:i:1",
		"audiocapturemode:i:1",
		"connection type:i:6",
		"networkautodetect:i:1",
		"bandwidthautodetect:i:1",
	}

	for _, dir := range expectedDirectives {
		if !strings.Contains(content, dir) {
			t.Errorf("expected directive %q not found in generated profile: %s", dir, content)
		}
	}
}

func TestGenerateRDPProfileContent_FullScreen(t *testing.T) {
	profile := model.SessionProfile{
		Host:          "10.0.0.50",
		RDPFullScreen: true,
	}

	content := GenerateRDPProfileContent(profile, 3389)

	if !strings.Contains(content, "screen mode id:i:2") {
		t.Errorf("expected fullscreen directive screen mode id:i:2 not found")
	}
}