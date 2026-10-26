package service

import (
	"testing"

	"nexterm/internal/model"
)

func TestImportSessionsMergesIntoExistingTree(t *testing.T) {
	svc := NewSessionService(nil)
	if _, err := svc.LoadRoot(); err != nil {
		t.Fatal(err)
	}
	root, _ := svc.AddFolder("", "Production")
	prodID := root.Children[0].ID
	if _, err := svc.AddSession(prodID, model.SessionProfile{ID: "existing", Name: "web-1", Host: "10.0.0.1", Protocol: "ssh"}); err != nil {
		t.Fatal(err)
	}

	export, err := svc.ExportSessions()
	if err != nil {
		t.Fatal(err)
	}

	// Re-importing our own export must not duplicate anything.
	if _, err := svc.ImportSessions(export); err != nil {
		t.Fatalf("ImportSessions: %v", err)
	}
	if n := len(svc.FindNode(prodID).Children); n != 1 {
		t.Fatalf("re-import duplicated sessions: Production has %d children", n)
	}

	// Importing a different file adds its sessions without dropping ours.
	other := `{"id":"r","name":"Sessions","children":[
		{"id":"f","name":"production","children":[{"id":"n2","name":"db-1","session":{"id":"s2","name":"db-1","host":"10.0.0.2"}}]},
		{"id":"g","name":"Lab","children":[{"id":"n3","name":"lab-1","session":{"id":"s3","name":"lab-1","host":"10.0.0.3"}}]}
	]}`
	tree, err := svc.ImportSessions(other)
	if err != nil {
		t.Fatalf("ImportSessions: %v", err)
	}
	if n := len(svc.FindNode(prodID).Children); n != 2 {
		t.Fatalf("expected Production to hold the existing and the imported session, got %d", n)
	}
	foundLab := false
	for _, c := range tree.Children {
		if c.Name == "Lab" {
			foundLab = true
		}
	}
	if !foundLab {
		t.Fatal("expected the imported Lab folder to be added")
	}
}

func TestDuplicateSessionGetsOwnVaultEntries(t *testing.T) {
	vault := map[string]string{
		"orig":            "pw",
		"orig_passphrase": "pp",
		"orig_proxy":      "px",
	}
	svc := NewSessionService(nil)
	svc.SetVaultHooks(
		func(key string) { delete(vault, key) },
		func(key, val string) error { vault[key] = val; return nil },
		func(key string) (string, bool, error) { v, ok := vault[key]; return v, ok, nil },
	)
	if _, err := svc.LoadRoot(); err != nil {
		t.Fatal(err)
	}
	root, err := svc.AddSession("", model.SessionProfile{
		ID: "orig", VaultKey: "orig", Name: "web", Host: "10.0.0.1",
		PassphraseVaultKey: "orig_passphrase", ProxyVaultKey: "orig_proxy",
	})
	if err != nil {
		t.Fatal(err)
	}
	origNode := root.Children[len(root.Children)-1]

	root, err = svc.DuplicateSession(origNode.ID)
	if err != nil {
		t.Fatal(err)
	}
	dup := root.Children[len(root.Children)-1].Session
	if dup.PassphraseVaultKey == "orig_passphrase" || dup.ProxyVaultKey == "orig_proxy" {
		t.Fatalf("duplicate still shares the original's vault keys: %+v", dup)
	}

	// Deleting the original must leave the copy's credentials intact.
	if _, err := svc.DeleteNode(origNode.ID); err != nil {
		t.Fatal(err)
	}
	for _, k := range []string{dup.VaultKey, dup.PassphraseVaultKey, dup.ProxyVaultKey} {
		if vault[k] == "" {
			t.Errorf("copy lost vault entry %q after deleting the original", k)
		}
	}
}
