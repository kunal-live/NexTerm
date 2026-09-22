package service

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestBRMAssistant_ClassifyQuestion(t *testing.T) {
	svc := NewBRMAssistantService(nil, nil)

	tests := []struct {
		question string
		expected string
	}{
		{"Where is pin.conf located?", "LOCATION"},
		{"Find cm.log", "LOCATION"},
		{"What is the path of dm_oracle?", "LOCATION"},
		{"What does PCM_OP_BILL_MAKE_BILL_NOW do?", "OPCODE"},
		{"Why does PCM_OP_CUST_COMMIT_CUSTOMER fail?", "ERROR_EXPLANATION"},
		{"Show me the error in cm.log", "LOG_ANALYSIS"},
		{"How to configure dm_pointer in pin.conf?", "CONFIGURATION"},
		{"Why am I getting PIN_ERR_BAD_OPCODE?", "ERROR_EXPLANATION"},
		{"Explain ORA-00001 error", "ERROR_EXPLANATION"},
		{"How does BRM architecture handle billing flow?", "ARCHITECTURE"},
		{"Tell me about billing accounts", "GENERAL_BRM"},
	}

	for _, tc := range tests {
		res := svc.ClassifyQuestion(tc.question)
		if res != tc.expected {
			t.Errorf("ClassifyQuestion(%q) = %q; want %q", tc.question, res, tc.expected)
		}
	}
}

func TestBRMAssistant_GetOpcodeKnowledge(t *testing.T) {
	svc := NewBRMAssistantService(nil, nil)

	info := svc.GetOpcodeKnowledge("PCM_OP_BILL_MAKE_BILL_NOW")
	if info.Name != "PCM_OP_BILL_MAKE_BILL_NOW" {
		t.Errorf("expected PCM_OP_BILL_MAKE_BILL_NOW, got %s", info.Name)
	}
	if !strings.Contains(info.Description, "invoice") && !strings.Contains(info.Description, "bill") {
		t.Errorf("unexpected description: %s", info.Description)
	}
	if info.InputFlist == "" || info.OutputFlist == "" {
		t.Errorf("expected flist definitions, got empty")
	}

	unknown := svc.GetOpcodeKnowledge("PCM_OP_CUSTOM_TEST")
	if unknown.Name != "PCM_OP_CUSTOM_TEST" {
		t.Errorf("expected custom name returned, got %s", unknown.Name)
	}
}

func TestBRMAssistant_GetErrorKnowledge(t *testing.T) {
	svc := NewBRMAssistantService(nil, nil)

	tests := []string{
		"PIN_ERR_BAD_OPCODE",
		"PIN_ERR_NAP_CONNECT_FAILED",
		"PIN_ERR_STORAGE",
		"ORA-00001",
		"ORA-01017",
		"ORA-03113",
		"ORA-12154",
	}

	for _, code := range tests {
		k := svc.GetErrorKnowledge(code)
		if k.Code != code {
			t.Errorf("expected error code %s, got %s", code, k.Code)
		}
		if len(k.LikelyCauses) == 0 {
			t.Errorf("expected likely causes for %s", code)
		}
		if len(k.Checks) == 0 {
			t.Errorf("expected checks for %s", code)
		}
		if len(k.Resolutions) == 0 {
			t.Errorf("expected resolutions for %s", code)
		}
	}
}

func TestBRMAssistant_InspectSource_Local(t *testing.T) {
	svc := NewBRMAssistantService(nil, nil)

	tmpDir := t.TempDir()
	logFile := filepath.Join(tmpDir, "cm.log")
	logContent := `D 09/22 10:00:00:123 cm:1234 pcm_op.c:45 PCM_OP_BILL_MAKE_BILL_NOW started
E 09/22 10:00:01:456 cm:1234 pcm_op.c:99 PIN_ERR_BAD_OPCODE error occurred
D 09/22 10:00:02:789 cm:1234 pcm_op.c:120 cleanup completed
`
	if err := os.WriteFile(logFile, []byte(logContent), 0644); err != nil {
		t.Fatalf("failed to write test log file: %v", err)
	}

	inspection, err := svc.InspectSource("local", logFile, "", 100)
	if err != nil {
		t.Fatalf("InspectSource failed: %v", err)
	}

	if inspection.TotalLines != 3 {
		t.Errorf("expected 3 total lines, got %d", inspection.TotalLines)
	}
	if len(inspection.ErrorsFound) != 1 {
		t.Fatalf("expected 1 error found, got %d", len(inspection.ErrorsFound))
	}
	if inspection.ErrorsFound[0].ErrorCode != "PIN_ERR_BAD_OPCODE" {
		t.Errorf("expected PIN_ERR_BAD_OPCODE, got %s", inspection.ErrorsFound[0].ErrorCode)
	}
}

func TestBRMAssistant_Diagnose_Flows(t *testing.T) {
	svc := NewBRMAssistantService(nil, nil)

	// 1. Location diagnosis
	locReq := BRMDiagnosisRequest{
		Question: "Where is cm pin.conf located?",
	}
	locRes, err := svc.Diagnose(locReq)
	if err != nil {
		t.Fatalf("Diagnose failed for location: %v", err)
	}
	if locRes.QuestionType != "LOCATION" {
		t.Errorf("expected LOCATION question type, got %s", locRes.QuestionType)
	}
	if len(locRes.Actions) == 0 {
		t.Errorf("expected navigation actions for location")
	}

	// 2. Opcode info
	opReq := BRMDiagnosisRequest{
		Question: "What is PCM_OP_BILL_MAKE_BILL_NOW?",
	}
	opRes, err := svc.Diagnose(opReq)
	if err != nil {
		t.Fatalf("Diagnose failed for opcode: %v", err)
	}
	if opRes.QuestionType != "OPCODE" {
		t.Errorf("expected OPCODE, got %s", opRes.QuestionType)
	}

	// 3. Needs source flow when source is empty
	errReq := BRMDiagnosisRequest{
		Question: "Why is billing failing with PIN_ERR_BAD_OPCODE?",
	}
	errRes, err := svc.Diagnose(errReq)
	if err != nil {
		t.Fatalf("Diagnose failed: %v", err)
	}
	if errRes.Status != "needs_source" {
		t.Errorf("expected status 'needs_source', got %s", errRes.Status)
	}
	if len(errRes.SuggestedSources) == 0 {
		t.Errorf("expected suggested sources")
	}
}
