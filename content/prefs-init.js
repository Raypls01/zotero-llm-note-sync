/**
 * LLM Note Auto-Sync - DIAGNOSTIC prefs-init
 * 
 * Minimal test to check if the injected script executes in the preferences window.
 */

// First line: write to Zotero's error console (should always work in chrome windows)
try { Zotero.log("LLM Sync DIAG: prefs-init executed via loadSubScript", "info"); } catch (e) {}

// Write to desktop log (if Cc/Ci available)
try {
    var desktopDir = OS.Constants.Path.desktopDir || "";
    var logPath = desktopDir ? desktopDir + "\\llm-note-sync.log" : "llm-note-sync.log";
    var f = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    f.initWithPath(logPath);
  var s = Cc["@mozilla.org/network/file-output-stream;1"].createInstance(Ci.nsIFileOutputStream);
  s.init(f, 0x02 | 0x08 | 0x10, 0o644, 0);
  s.write(new Date().toISOString() + " DIAG: prefs-init EXECUTED\n");
  s.close();
} catch (e) {
  try { Zotero.log("LLM Sync DIAG: file log failed: " + e, "error"); } catch (ex) {}
}

// Check Zotero availability
try {
  Zotero.log("LLM Sync DIAG: Zotero available, version=" + Zotero.version, "info");
} catch (e) {}

// Try to find the pane
try {
  var pane = document.getElementById("llm-notesync-prefs");
  if (pane) {
    var status = document.getElementById("llm-notesync-status");
    if (status) status.textContent = "√ INJECTED";
    Zotero.log("LLM Sync DIAG: pane FOUND, status element: " + (!!status), "info");
  } else {
    Zotero.log("LLM Sync DIAG: pane NOT FOUND yet", "info");
  }
} catch (e) {
  Zotero.log("LLM Sync DIAG: pane check error: " + e, "error");
}