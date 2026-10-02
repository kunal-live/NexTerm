package model

// SessionProfile is one saved connection. Credentials (passwords/passphrases)
// are stored encrypted in the secure vault via VaultKey, never in plaintext.
type SessionProfile struct {
	ID                string `json:"id"`
	Name              string `json:"name"`
	Host              string `json:"host"`
	Port              int    `json:"port"`
	Username           string `json:"username"`
	AuthType           string `json:"authType,omitempty"` // "password", "key", "agent", "keyboard-interactive", "auto"
	VaultKey           string `json:"vaultKey,omitempty"`
	PassphraseVaultKey string `json:"passphraseVaultKey,omitempty"`
	PrivateKeyPath     string `json:"privateKeyPath,omitempty"`
	CertificatePath    string `json:"certificatePath,omitempty"`
	KeyPassphrase      string `json:"keyPassphrase,omitempty"`
	KeyType            string `json:"keyType,omitempty"`
	KeyFingerprint     string `json:"keyFingerprint,omitempty"`
	StartupCommand    string `json:"startupCommand,omitempty"`
	// QuarantinedStartupCommand holds a startup command that arrived via Import. It is
	// NOT executed on connect; the user must open the session and Save to re-enable it
	// (prevents an imported profile from auto-running arbitrary commands on first connect).
	QuarantinedStartupCommand string `json:"quarantinedStartupCommand,omitempty"`
	TerminalType      string `json:"terminalType,omitempty"`      // e.g. "xterm-256color"
	Theme             string `json:"theme,omitempty"`             // e.g. "dark-modern", "monokai", "dracula", "nord"
	FontSize          int    `json:"fontSize,omitempty"`          // e.g. 14
	KeepAliveInterval int    `json:"keepAliveInterval,omitempty"` // in seconds, default 15
	Environment       string `json:"environment,omitempty"`       // "prod", "uat", "testing", "dev", "staging", "dr"
	Color             string `json:"color,omitempty"`             // Hex color, e.g. "#f59e0b" for UAT, "#ef4444" for Prod

	// Protocol: "ssh", "sftp", "rdp", "vnc", "telnet", "serial", "local"
	Protocol string `json:"protocol,omitempty"`

	// Terminal Configuration
	FontFamily   string `json:"fontFamily,omitempty"`   // e.g. "Cascadia Mono", "Fira Code"
	Rows         int    `json:"rows,omitempty"`         // default terminal rows
	Cols         int    `json:"cols,omitempty"`         // default terminal columns
	CursorStyle  string `json:"cursorStyle,omitempty"`  // "block", "underline", "bar"
	CursorBlink  bool   `json:"cursorBlink,omitempty"`
	Encoding     string `json:"encoding,omitempty"`     // "utf-8", "iso-8859-1", etc.
	Scrollback   int    `json:"scrollback,omitempty"`   // scrollback buffer size

	// Startup Configuration
	WorkingDirectory string `json:"workingDirectory,omitempty"`

	// SSH Advanced Configuration
	ConnectionTimeout int    `json:"connectionTimeout,omitempty"` // in seconds, default 10
	Compression       bool   `json:"compression,omitempty"`
	UseAgent          bool   `json:"useAgent,omitempty"`
	X11Forwarding     bool   `json:"x11Forwarding,omitempty"` // forward remote GUI apps to a local X server (VcXsrv/Xming)
	AutoReconnect     bool   `json:"autoReconnect,omitempty"`
	ReconnectAttempts int    `json:"reconnectAttempts,omitempty"` // default 5
	ReconnectDelay    int    `json:"reconnectDelay,omitempty"`    // in seconds, default 2
	ProxyType         string `json:"proxyType,omitempty"`         // "none", "socks5", "http"
	ProxyHost         string `json:"proxyHost,omitempty"`
	ProxyPort         int    `json:"proxyPort,omitempty"`
	ProxyUsername     string `json:"proxyUsername,omitempty"`
	ProxyPassword     string `json:"proxyPassword,omitempty"` // transient: moved into the OS vault on save, never persisted in plaintext
	ProxyVaultKey     string `json:"proxyVaultKey,omitempty"` // vault key under which the proxy password is encrypted

	// Terminal Appearance Customization
	Foreground     string            `json:"foreground,omitempty"`
	Background     string            `json:"background,omitempty"`
	CursorColor    string            `json:"cursorColor,omitempty"`
	SelectionColor string            `json:"selectionColor,omitempty"`
	AnsiColors     map[string]string `json:"ansiColors,omitempty"`

	// Jump Host / Bastion Gateway Configuration
	UseJumpHost        bool   `json:"useJumpHost,omitempty"`
	JumpHost           string `json:"jumpHost,omitempty"`
	JumpPort           int    `json:"jumpPort,omitempty"`
	JumpUsername       string `json:"jumpUsername,omitempty"`
	JumpAuthType       string `json:"jumpAuthType,omitempty"` // "password" or "key"
	JumpVaultKey       string `json:"jumpVaultKey,omitempty"`
	JumpPrivateKeyPath string `json:"jumpPrivateKeyPath,omitempty"`

	// Serial / COM Port Configuration
	SerialPort string `json:"serialPort,omitempty"` // e.g. "COM1", "COM3"
	BaudRate   int    `json:"baudRate,omitempty"`   // e.g. 9600, 115200
	DataBits   int    `json:"dataBits,omitempty"`   // e.g. 8
	StopBits   int    `json:"stopBits,omitempty"`   // e.g. 1
	Parity     string `json:"parity,omitempty"`     // "none", "odd", "even"

	// RDP Configuration
	RDPDomain     string `json:"rdpDomain,omitempty"`
	RDPWidth      int    `json:"rdpWidth,omitempty"`
	RDPHeight     int    `json:"rdpHeight,omitempty"`
	RDPFullScreen bool   `json:"rdpFullScreen,omitempty"`
}

// TreeNode is either a folder (Children populated, Session nil) or a leaf
// (Session populated). Mirrors the tree the frontend renders in the sidebar.
type TreeNode struct {
	ID              string          `json:"id"`
	Name            string          `json:"name"`
	Session         *SessionProfile `json:"session,omitempty"`
	Children        []*TreeNode     `json:"children,omitempty"`
	Expanded        bool            `json:"expanded,omitempty"`
	DefaultUsername string          `json:"defaultUsername,omitempty"`
	DefaultPort     int             `json:"defaultPort,omitempty"`
	Environment     string          `json:"environment,omitempty"`
	Color           string          `json:"color,omitempty"`
}

func (n *TreeNode) IsFolder() bool {
	return n.Session == nil
}

