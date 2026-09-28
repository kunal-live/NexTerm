# Cookie Policy for NexTerm

**Last Updated:** September 28, 2026  
**Effective Date:** September 28, 2026

This Cookie Policy explains how **NexTerm** treats cookies and similar local storage technologies.

---

## 1. Zero HTTP / Tracking Cookies

**NexTerm does NOT use HTTP cookies, advertising cookies, tracking beacons, or third-party tracking technologies.**

NexTerm is a desktop application written in Go and HTML/CSS/JavaScript running inside a native desktop WebView window (via Wails v2). Because NexTerm does not connect to web advertising networks, user profiling services, or tracking servers, it never drops, reads, or transmits HTTP cookies over the internet.

---

## 2. Local Storage Technologies Used

To deliver a responsive, personalized desktop user experience, NexTerm uses standard client-side browser **`localStorage`** and in-memory variables strictly on your local machine:

| Storage Type | Key / Identifier | Purpose | Lifetime | Stored On |
| :--- | :--- | :--- | :--- | :--- |
| **`localStorage`** | `nexterm_settings` | Stores your UI layout choices, selected theme (e.g. Dark Modern, Tokyo Night), terminal font size, cursor styles, and notification level. | Persistent until manually cleared | Local machine only |
| **`localStorage`** | `nexterm_ui_state` | Stores sidebar collapsed state, split pane positions, and recent view preferences. | Persistent until manually cleared | Local machine only |
| **`localStorage`** | `nexterm_consent_acknowledged` | Records user acknowledgment of local storage and privacy disclosures. | Persistent until manually cleared | Local machine only |
| **In-Memory** | Tab & Terminal State | Holds active PTY buffers, current tab titles, and active process pointers. | Duration of application run | RAM only |

**Important:** None of the data saved in `localStorage` is ever transmitted over the network or shared with any external entity.

---

## 3. Technical Protocol Clarification: X11 "Magic Cookie"

In the context of Unix/Linux and SSH X11 forwarding, you may encounter the term **`MIT-MAGIC-COOKIE-1`**. 

Please note:
- An X11 "Magic Cookie" is **NOT** a web or browser cookie.
- It is a 128-bit cryptographic authentication token generated locally when an SSH X11 forwarding channel (`x11-req`) is established.
- Its sole purpose is to allow the local X server (such as VcXsrv or Xming) to authenticate incoming graphical connections from your remote Linux applications, preventing unauthorized local processes from intercepting display contents.
- It is never used for tracking, analytics, or profiling.

---

## 4. How to Inspect or Clear Local Storage

Because NexTerm is completely transparent:
- You can reset your application preferences at any time by navigating to **Settings (⚙️) → Terminal & UI** and selecting default settings.
- To purge all local storage data, you can delete the desktop WebView cache directory or reset the application data folder:
  - **Windows:** `%APPDATA%\Nexterm`
  - **macOS / Linux:** `~/.config/nexterm`

---

## 5. Contact & Questions

If you have questions about our local storage practices:
- **GitHub Issues:** [https://github.com/kunal-live/NexTerm/issues](https://github.com/kunal-live/NexTerm/issues)
- **Repository:** [https://github.com/kunal-live/NexTerm](https://github.com/kunal-live/NexTerm)
