package macro

import (
	"path/filepath"
	"testing"
)

func newTestManager(dir string) *MacroManager {
	mm := &MacroManager{
		macros:   make(map[string]Macro),
		removed:  make(map[string]bool),
		filePath: filepath.Join(dir, "macros.json"),
	}
	if err := mm.load(); err != nil {
		mm.seedDefaults()
	}
	return mm
}

func TestDeletedBuiltInSnippetStaysDeleted(t *testing.T) {
	dir := t.TempDir()
	mm := newTestManager(dir)
	if err := mm.DeleteMacro("m-git-pull"); err != nil {
		t.Fatal(err)
	}

	reloaded := newTestManager(dir)
	for _, m := range reloaded.GetMacros() {
		if m.ID == "m-git-pull" {
			t.Fatal("deleted built-in snippet came back after reload")
		}
	}
	if len(reloaded.GetMacros()) != len(mm.defaultSnippets())-1 {
		t.Fatalf("expected the other built-ins to remain, got %d macros", len(reloaded.GetMacros()))
	}
}
