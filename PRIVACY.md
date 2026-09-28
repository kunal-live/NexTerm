# Privacy Policy for NexTerm

**Last Updated:** September 28, 2026  
**Effective Date:** September 28, 2026

At **NexTerm**, privacy, security, and digital sovereignty are foundational principles. NexTerm is designed and built as a **local-first, offline-capable desktop application**. We do not operate tracking servers, telemetry pipelines, or data collection services.

This Privacy Policy explains clearly and transparently what data is handled by NexTerm, where it is stored, and how your privacy is protected.

---

## 1. Summary of Core Principles

- **Zero Telemetry**: NexTerm does not collect, log, or transmit telemetry, usage analytics, crash reports, or device identifiers.
- **No Third-Party Embeds**: NexTerm does not load third-party trackers, external fonts, remote analytics scripts, or advertising widgets.
- **Hardware-Backed Credential Security**: Authentication secrets (passwords, private key passphrases) are encrypted using native operating system vaults (Windows DPAPI, macOS Keychain, Linux Secret Service).
- **Local Data Sovereignty**: All your connection profiles, server trees, and session logs reside solely on your local device.

---

## 2. What User Data Does NexTerm Handle?

Because NexTerm is a desktop client for managing remote systems (SSH, SFTP, Tunnels, Serial, RDP), it manages configuration and authentication data locally on your computer:

### A. Server & Session Configuration Metadata
- **What is handled:** Hostnames/IP addresses, port numbers, usernames, connection labels, folder structures, terminal color schemes, and custom port forward definitions.
- **Where it is stored:** Saved locally in plain JSON format within your user profile directory:
  - **Windows:** `%APPDATA%\Nexterm\sessions.json` and `%APPDATA%\Nexterm\tunnels.json`
  - **macOS / Linux:** `~/.config/nexterm/sessions.json` and `~/.config/nexterm/tunnels.json`
- **Purpose:** Enables you to quickly reconnect to your servers without re-entering configuration parameters.

### B. Authentication Credentials & Secrets
- **What is handled:** SSH passwords, private key passphrases, and Jump Host credentials.
- **Where it is stored:** Credentials are **never** stored in plain text. They are encrypted using your operating system's native hardware-bound encryption:
  - **Windows:** Windows Data Protection API (DPAPI via `CryptProtectData`), tied directly to your Windows user account.
  - **macOS:** Native macOS Keychain Services.
  - **Linux:** Freedesktop Secret Service API / system Keyring.
- **Transmission:** Credentials are transmitted **exclusively and directly** over encrypted SSH channels to the specific remote host you have instructed NexTerm to connect to. They are never sent to NexTerm developers or any third party.

### C. Terminal Logs & Session Output
- **What is handled:** Keystrokes, terminal outputs, and command history.
- **Default State:** **Disabled by default**. NexTerm does not record your terminal output unless you explicitly enable session logging (via the Terminal menu or settings).
- **Where it is stored:** If enabled, logs are written strictly to your local machine at `%APPDATA%\Nexterm\logs` (or `~/.config/nexterm/logs`).

### D. Application Preferences
- **What is handled:** Active theme (e.g. Dark Modern, Tokyo Night), terminal font size, cursor styles, and UI layout dimensions.
- **Where it is stored:** Saved locally in your desktop WebView's `localStorage`.

### E. AI Assistant & Knowledge Base Documents
- **What is handled:** Diagnostic questions, system queries, and user-uploaded reference documents (e.g. PDFs, PPTX architecture slides, JSON configuration schemas).
- **Where it is stored:** Knowledge documents and chat states are kept locally in client-side storage (`localStorage` / IndexedDB).
- **Zero Cloud AI Transmission:** NexTerm does NOT send your diagnostic queries, commands, or uploaded files to external LLM providers (such as OpenAI, Anthropic, or remote cloud servers). The embedded assistant runs strictly on-device using local rule logic and local knowledge indexing.

---

## 3. What User Data We DO NOT Collect

To be unequivocal:
- We **DO NOT** collect your personal identity (name, email address, physical address, or phone number).
- We **DO NOT** track your remote server destinations, IP addresses, or hostnames.
- We **DO NOT** inspect or record commands executed inside your terminals (unless you enable local logging).
- We **DO NOT** use Google Analytics, PostHog, Mixpanel, Sentry, or any third-party analytics provider.
- We **DO NOT** sell, rent, monetize, or disclose any user data to third parties.

---

## 4. Third-Party Embeds and Network Connections

NexTerm is engineered to minimize unsolicited network access:
- **Zero Third-Party Scripts**: No CDNs, tracking pixels, or remote JavaScript libraries are embedded in the application. All core libraries (`xterm.js`, UI styling) are bundled locally inside the compiled application binary.
- **Offline System Typography**: Fonts are sourced strictly from local system font stacks (`Segoe UI`, `SF Pro Display`, `Inter`, `Cascadia Code`, `Consolas`, `SF Mono`). No external font servers (such as Google Fonts) are contacted.
- **User-Directed Outbound Connections**: The only outbound network connections initiated by NexTerm are those explicitly requested by you (e.g., establishing an SSH session to `your-server.com`, opening an SFTP session, running a network ping/port scan in the Network Toolbox, or connecting through a configured Bastion host).

---

## 5. Security & Encryption Standards

NexTerm employs standard security best practices:
- **SSH Transport**: Utilizes Go's production-proven `golang.org/x/crypto/ssh` cryptographic library supporting modern cipher suites (ChaCha20-Poly1305, AES-GCM, Curve25519, Ed25519).
- **Known Hosts Verification**: Manages known host keys locally in `%APPDATA%\Nexterm\known_hosts` to protect against Machine-in-the-Middle (MITM) attacks.
- **Audit Logging**: An optional append-only local audit log (`audit_log.jsonl` with restricted file permissions `0600`) records administrative configuration changes solely on your workstation.

---

## 6. Managing, Exporting, and Deleting Your Data

You have complete control over all data generated by NexTerm:
- **Exporting Data**: You can export your session catalog at any time via **Sessions → Export Sessions to JSON...** to create an encrypted or portable backup.
- **Deleting Data**: To completely erase all data stored by NexTerm from your system, simply delete the local application data folder:
  - **Windows:** Delete `%APPDATA%\Nexterm`
  - **macOS / Linux:** Delete `~/.config/nexterm`
  Once deleted, all cached host configurations, logs, and encrypted vault entries are permanently removed.

---

## 7. Changes to This Privacy Policy

If we update this Privacy Policy (for example, to reflect new features or security enhancements), the revised document will be published directly in the repository with an updated "Last Updated" timestamp. Because NexTerm does not collect email addresses, we encourage users to review the repository's documentation periodically.

---

## 8. Contact & Inquiries

For questions regarding this Privacy Policy or NexTerm's security architecture:
- **GitHub Issues:** [https://github.com/kunal-live/NexTerm/issues](https://github.com/kunal-live/NexTerm/issues)
- **Repository:** [https://github.com/kunal-live/NexTerm](https://github.com/kunal-live/NexTerm)
