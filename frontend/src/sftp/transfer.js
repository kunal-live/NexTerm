// ==========================================================================
// Nexterm — SFTP Transfer Subsystem
// Handles file and folder upload/download operations, native file selection,
// and transfer notifications.
// ==========================================================================

import { showToast } from "../ui/notifications.js";
import { getActiveTabId } from "../state/tabState.js";

export async function triggerUpload(tabId, srcPath, destRemotePath, onComplete) {
  const activeTab = tabId || getActiveTabId();
  if (!activeTab || activeTab === "home") {
    showToast("Please open an active SSH tab to upload files", "warning");
    return;
  }
  if (!srcPath) {
    showToast("Please select a local file or folder to upload", "warning");
    return;
  }

  showToast(`Uploading ${srcPath} ➔ ${destRemotePath}...`, "info");
  try {
    if (window.go && window.go.main && window.go.main.App) {
      await window.go.main.App.SFTPUpload(activeTab, srcPath, destRemotePath);
      showToast("Upload completed successfully", "success");
      if (typeof onComplete === "function") onComplete();
    }
  } catch (err) {
    showToast(`Upload failed: ${err}`, "error");
  }
}

export async function triggerDownload(tabId, remotePath, destLocalPath, onComplete) {
  const activeTab = tabId || getActiveTabId();
  if (!activeTab || activeTab === "home") {
    showToast("Please open an active SSH tab to download files", "warning");
    return;
  }
  if (!remotePath) {
    showToast("Please select a remote file or folder to download", "warning");
    return;
  }

  showToast(`Downloading ${remotePath} ➔ ${destLocalPath}...`, "info");
  try {
    if (window.go && window.go.main && window.go.main.App) {
      await window.go.main.App.SFTPDownload(activeTab, remotePath, destLocalPath);
      showToast("Download completed successfully", "success");
      if (typeof onComplete === "function") onComplete();
    }
  } catch (err) {
    showToast(`Download failed: ${err}`, "error");
  }
}
