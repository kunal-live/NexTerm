// ==========================================================================
// Nexterm — helpers for building remote shell commands safely.
//
// Names that come back from a server (process ids, service units, container
// ids, file names, tty names) are controlled by whoever can create them on that
// server — not necessarily the administrator who clicks "Restart". Interpolating
// them into a command line, especially one with a `sudo` fallback, would let a
// low-privilege user on the box run commands as the admin. Validate identifiers
// against a strict pattern and single-quote everything else.
// ==========================================================================

// Single-quote a string for POSIX sh/bash/zsh. Safe for any content.
export function shQuote(value) {
  return "'" + String(value).replace(/'/g, "'\\''") + "'";
}

export const isPid = (v) => /^\d{1,10}$/.test(String(v));
// systemd unit: letters, digits and  : _ . @ \ -   (never starting with '-')
export const isUnitName = (v) => /^[A-Za-z0-9:_.@\\][A-Za-z0-9:_.@\\-]{0,255}$/.test(String(v));
// docker container/image reference or id
export const isDockerRef = (v) => /^[A-Za-z0-9][A-Za-z0-9_.\-/:@]{0,255}$/.test(String(v));
// tty/pts name such as pts/0, tty1, :0
export const isTtyName = (v) => /^[A-Za-z0-9][A-Za-z0-9_./:-]{0,63}$/.test(String(v));
export const isServiceOp = (v) => ["start", "stop", "restart"].includes(String(v));
export const isSignal = (v) => /^(?:[A-Z]{3,10}|\d{1,2})$/.test(String(v));
