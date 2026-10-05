# Changelog

All notable changes to the **NexTerm** project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [v1.3.0] — 2026-10-04

### 🌟 Release Overview: Enterprise Security, Custom Themes & Dynamic Workspaces
NexTerm **v1.3.0** is a major release introducing enterprise-grade credential security with Master Password protection, automated session log redaction, real in-app SSH key generation, an overhauled Theme Gallery with dynamic celestial animations, full WCAG 2.1 accessibility, and 1-click zero-dependency release packaging.

### 🔒 Enterprise Security & Credential Vault
- **Master Password Protection**: Added an optional Master Password encryption layer to protect all saved server credentials, SSH keys, and passwords.
- **App Lock & Idle Inactivity Auto-Lock**: Added a master toggle in Settings to instantly lock NexTerm or automatically lock the workspace after a configurable period of inactivity.
- **Password Hint Recovery**: Built-in encrypted hint recovery workflow for forgotten master passwords with clear status indicators.
- **Secure Password Generator**: In-app cryptographic password generator supporting customizable character length, special symbols, uppercase, and lowercase characters.
- **Bento-Grid Vault UI**: Modernized the Passwords & Vault interface with responsive bento cards, category pill filter tabs, and real-time live search.
- **Proxy Password Vaulting**: Encrypted storage for HTTP/SOCKS5 proxy authentication credentials using platform-native DPAPI.
- **Session Log Redaction**: Automatic real-time redaction and masking of passwords, bearer tokens, and private keys from terminal buffers and session logs.
- **Built-in SSH KeyGen**: Native RSA 2048-bit and 4096-bit SSH key pair generator exporting directly to PEM and OpenSSH formats.

### 🎨 Custom Themes & Visual Experience
- **Theme Gallery with Category Filters**: Overhauled the Theme Gallery with interactive category tabs (Cyberpunk, Matrix, Dracula, Solarized, Nord, Celestial).
- **Dynamic Celestial Universe Canvas**: Added a smooth, interactive celestial universe particle animation on the application welcome screen.
- **Planetary Viewport & Panoramic Backgrounds**: Support for widescreen panoramic backgrounds and custom viewport styling.
- **Linux Console Theme**: Added a classic, pure pitch black terminal theme with crisp white console text and Linux VGA ANSI colors.
- **5 New Developer Color Themes**: Added pre-calibrated color palettes with high-contrast text rendering for both dark and light modes.
- **High-Contrast Light Mode Optimization**: Fixed contrast and visibility on action buttons (such as "View Documentation") in bright ambient environments.

### 🤖 Universal AI DevOps Assistant
- **Generalized AI Assistant**: Expanded the built-in Assistant into a universal DevOps/SysAdmin companion for troubleshooting Linux errors, analyzing shell logs, and generating automated bash/PowerShell scripts.
- **Toolbar & Statusbar Quick Launch**: 1-click launchers for the AI Assistant integrated into the main header toolbar and status bar.

### ♿ Accessibility (WCAG 2.1) & Compliance
- **Full WCAG ARIA Support**: Comprehensive `aria-label`, `role`, and keyboard focus indicators across all modals, split panes, and dropdown navigation menus.
- **Interactive Consent Banner**: Added a transparent privacy and cookie preferences banner with instant user preference persistence.
- **Legal Compliance Documentation**: Complete enterprise documentation published for [PRIVACY.md](PRIVACY.md), [TERMS.md](TERMS.md), and [COOKIE_POLICY.md](COOKIE_POLICY.md).

### 🚀 Packaging & Distribution
- **Direct 1-Click Zero-Dependency Downloads**: Direct download links for pre-built, self-contained Windows Installers, Portable ZIPs, macOS App bundles, and Linux packages.
- **Predictable Asset Naming**: GitHub Release workflow configured with clean permanent download URLs (`Nexterm-windows-x64-installer.exe`, `Nexterm-windows-x64-portable.zip`, `Nexterm-macos-arm64.zip`, `Nexterm-linux-x64.tar.gz`).
- **Manual Workflow Dispatch**: Enabled manual 1-click release builds directly from the GitHub Actions dashboard.

---

## [v1.2.0] — 2026-09-18

### Added
- **Wails v2.15.0 Core Engine Upgrade**: Upgraded underlying desktop runtime for faster window rendering and reduced memory footprint.
- **Adaptive Maximized Startup**: Application launches directly into an optimized maximized desktop state.
- **Multi-Protocol Session Wizards**: Dedicated connection wizards for SSH, SFTP, Serial (COM), RDP (`mstsc.exe`), and ConPTY Local Shells.
- **X11 Forwarding & Local X Server Manager**: Automated detection and tunneling for local Windows X servers (VcXsrv, Xming, GWSL).
- **Portable Session Tree Backup**: Native JSON session tree backup, export, and import with merge capabilities.

---

## [v1.1.0] — 2026-08-10

### Added
- **Graphical SFTP Browser & Embedded Editor**: File tree navigation, drag-and-drop remote uploads, and in-app code editor for remote file editing.
- **Split Terminals**: 2-Way Vertical, 2-Way Horizontal, and 4-Way 2x2 terminal layouts with dynamic `xterm-addon-fit` recalculation.
- **MultiExec Command Broadcasting**: Real-time simultaneous command broadcasting across connected sessions.
- **Terminal Macro Automation Engine**: Keystroke recording and replay playbooks for system diagnostics.
- **Live Server Performance Dashboard**: Visual sparklines for CPU utilization, RAM usage, and network RX/TX bandwidth.

---

## [v1.0.0] — 2026-07-01

### Added
- **Initial Open Source Release**: Native cross-platform SSH client built with Go, Wails v2, and xterm.js.
- **Platform Credential Vault**: Native Windows DPAPI encryption for zero plain-text storage.
- **Visual SSH Port Forwarding**: Local, Remote, and SOCKS5 dynamic proxy tunneling manager.
- **SSH Bastion / Jump Host**: Multi-stage jump proxy authentication.
- **Network Toolbox**: Integrated ICMP Ping, DNS Resolver, TCP Port Scanner, and SHA/MD5 hash calculator.
