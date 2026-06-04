/**
 * LLM Note Auto-Sync - Preferences Pane Script
 *
 * Runs in the Zotero preferences window context.
 * Injected by bootstrap.js window listener.
 */
"use strict";

(function() {
  var PREFIX = "extensions.zotero.llmnotesync.";

  function llog(msg) {
    try {
      var desktopDir = OS.Constants.Path.desktopDir || "";
      var logPath = desktopDir ? desktopDir + "\\llm-note-sync.log" : "llm-note-sync.log";
      var file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
      file.initWithPath(logPath);
      var stream = Cc["@mozilla.org/network/file-output-stream;1"].createInstance(Ci.nsIFileOutputStream);
      stream.init(file, 0x02 | 0x08 | 0x10, 0o644, 0);
      var data = new Date().toISOString() + " prefs: " + msg + "\n";
      stream.write(data, data.length);
      stream.close();
    } catch (e) {}
  }

  function loadPref(name, def) {
    var key = PREFIX + name;
    try {
      if (typeof def === "boolean") return Zotero.Prefs.get(key, true);
      if (typeof def === "number") return Zotero.Prefs.get(key, true);
      return Zotero.Prefs.get(key, true);
    } catch (e) { return def; }
  }

  function savePrefs() {
    var el = document.getElementById("pref-pollIntervalInput");
    if (el) {
      var val = parseInt(el.value);
      if (isNaN(val) || val < 10) val = 10;
      if (val > 3600) val = 3600;
      el.value = val;
      Zotero.Prefs.set(PREFIX + "pollInterval", val, true);
    }

    var posEl = document.getElementById("pref-appendPosition");
    if (posEl) Zotero.Prefs.set(PREFIX + "appendPosition", posEl.value, true);

    var modelEl = document.getElementById("pref-includeModel");
    if (modelEl) Zotero.Prefs.set(PREFIX + "includeModel", !!modelEl.checked, true);

    var tsEl = document.getElementById("pref-includeHeadingTimestamp");
    if (tsEl) Zotero.Prefs.set(PREFIX + "includeHeadingTimestamp", !!tsEl.checked, true);

    var msg = document.getElementById("llm-notesync-save-msg");
    if (msg) { msg.style.display = "inline"; setTimeout(function(){msg.style.display="none";}, 3000); }
    llog("prefs saved");
  }

  function loadUI() {
    var el = document.getElementById("pref-pollIntervalInput");
    if (el) el.value = loadPref("pollInterval", 60);
    var posEl = document.getElementById("pref-appendPosition");
    if (posEl) posEl.value = loadPref("appendPosition", "bottom");
    var modelEl = document.getElementById("pref-includeModel");
    if (modelEl) modelEl.checked = loadPref("includeModel", true);
    var tsEl = document.getElementById("pref-includeHeadingTimestamp");
    if (tsEl) tsEl.checked = loadPref("includeHeadingTimestamp", true);
    llog("UI loaded");
  }

  function runNow() {
    var btn = document.getElementById("llm-notesync-run-now");
    var st = document.getElementById("llm-notesync-status");
    if (btn) btn.setAttribute("disabled", "true");
    if (st) st.textContent = "处理中…";
    Zotero.LLMNoteSync._runNow().then(function(r) {
      if (st) st.textContent = r.total === 0 ? "无待处理对话" : "完成: " + r.ok + "/" + r.total;
    })["catch"](function(e) {
      if (st) st.textContent = "错误: " + (e.message || e);
    })["finally"](function() {
      if (btn) btn.removeAttribute("disabled");
    });
  }

  function init() {
    llog("prefs init");
    loadUI();

    var saveBtn = document.getElementById("llm-notesync-save-btn");
    if (saveBtn) saveBtn.addEventListener("command", savePrefs);

    var runBtn = document.getElementById("llm-notesync-run-now");
    if (runBtn) runBtn.addEventListener("command", runNow);

    var st = document.getElementById("llm-notesync-status");
    if (st) st.textContent = "运行中（每 " + loadPref("pollInterval", 60) + " 秒）";
  }

  // Wait for pane to be loaded into DOM
  function waitForPane() {
    if (document.getElementById("llm-notesync-prefs")) {
      init();
    } else {
      Zotero.Promise.delay(200).then(waitForPane);
    }
  }
  waitForPane();
})();
