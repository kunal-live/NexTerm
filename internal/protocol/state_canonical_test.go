package protocol

import "testing"

func TestCanonicalStateUsesOneVocabulary(t *testing.T) {
	cases := map[string]string{
		"connecting": "Connecting",
		"connected":  "Connected",
		"failed":     "Failed",
		"Closed":     "Closed",
		"CONNECTED":  "Connected",
		"custom":     "custom",
	}
	for in, want := range cases {
		if got := CanonicalState(in); got != want {
			t.Errorf("CanonicalState(%q) = %q, want %q", in, got, want)
		}
	}
}

// RDP/VNC/Telnet/Serial sessions report through BaseSession; the UI must receive
// the canonical names it matches on.
func TestBaseSessionEmitsCanonicalState(t *testing.T) {
	b := &BaseSession{}
	var got string
	b.SetStateChangeHandler(func(state, _ string) { got = state })
	b.EmitStateChange("connected", "")
	if got != "Connected" {
		t.Fatalf("expected Connected, got %q", got)
	}
}
