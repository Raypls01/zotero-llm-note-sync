/**
 * LLM Note Auto-Sync - Settings Dialog
 * 
 * Runs in the settings dialog window scope.
 * Has full access to Zotero, Services, Cc, Ci.
 */
"use strict";

// XUL dialog windows don't inherit Zotero/Services globals — import them
(function() {
if (typeof Services === 'undefined') {
  try { Components.utils.import("resource://gre/modules/Services.jsm"); }
  catch(e) {}
}
})();

var PREFIX = "extensions.zotero.llmnotesync.";

function dlog(msg) {
  try {
    var Cc_local = Components.classes;
    var Ci_local = Components.interfaces;
    var file = Cc_local["@mozilla.org/file/local;1"].createInstance(Ci_local.nsIFile);
    var desktopDir = OS.Constants.Path.desktopDir || "";
    var logPath = desktopDir ? desktopDir + "\\llm-note-sync.log" : "llm-note-sync.log";
    file.initWithPath(logPath);
    var stream = Cc_local["@mozilla.org/network/file-output-stream;1"].createInstance(Ci_local.nsIFileOutputStream);
    stream.init(file, 0x02 | 0x08 | 0x10, 0o644, 0);
    var data = new Date().toISOString() + " settings: " + msg + "\n";
    stream.write(data, data.length);
    stream.close();
  } catch (e) {}
}

// ── Prefs helpers ─────────────────────────────────────
function loadPref(name, def) {
  var key = PREFIX + name;
  try {
    if (typeof def === "boolean") return Services.prefs.getBoolPref(key, def);
    if (typeof def === "number") return Services.prefs.getIntPref(key, def);
    return Services.prefs.getStringPref(key, String(def));
  } catch (e) { return def; }
}

function savePref(name, val) {
  var key = PREFIX + name;
  try {
    if (typeof val === "boolean") Services.prefs.setBoolPref(key, val);
    else if (typeof val === "number") Services.prefs.setIntPref(key, val);
    else Services.prefs.setCharPref(key, String(val));
    Services.prefs.savePrefFile(null);
    dlog("saved " + name + "=" + val);
    return true;
  } catch (e) { dlog("save ERROR " + name + ": " + e); return false; }
}

// ── UI ────────────────────────────────────────────────
function $(id) { return document.getElementById(id); }

function loadUI() {
  $("pollIntervalInput").value = loadPref("pollInterval", 60);
  $("appendPositionMenu").value = loadPref("appendPosition", "bottom");
  $("includeModelCheck").checked = loadPref("includeModel", true);
  $("includeHeadingTimestampCheck").checked = loadPref("includeHeadingTimestamp", true);
  dlog("UI loaded");
}

function saveUI() {
  var ok = 0;

  var pollVal = parseInt($("pollIntervalInput").value);
  if (isNaN(pollVal) || pollVal < 10) pollVal = 10;
  if (pollVal > 3600) pollVal = 3600;
  $("pollIntervalInput").value = pollVal;
  if (savePref("pollInterval", pollVal)) ok++;

  if (savePref("appendPosition", $("appendPositionMenu").value)) ok++;
  if (savePref("includeModel", !!$("includeModelCheck").checked)) ok++;
  if (savePref("includeHeadingTimestamp", !!$("includeHeadingTimestampCheck").checked)) ok++;

  // Notify main window if possible (standalone dialog may not have access)
  try {
    if (window.opener && window.opener.Zotero && window.opener.Zotero.LLMNoteSync && window.opener.Zotero.LLMNoteSync._reschedule) {
      window.opener.Zotero.LLMNoteSync._reschedule();
    }
  } catch (e) { /* dialog opened standalone, no main window access */ }

  updateStatus();
  var msg = $("saveMsg");
  msg.value = "✓ 已保存 (" + ok + "/4)";
  msg.style.display = "inline";
  setTimeout(function(){ try { msg.style.display = "none"; } catch(e){} }, 3000);
  dlog("saved all (" + ok + "/4)");
}

function updateStatus() {
  var st = $("statusLabel");
  var hasMain = false;
  try { hasMain = !!(window.opener && window.opener.Zotero && window.opener.Zotero.LLMNoteSync); } catch(e) {}
  if (hasMain) {
    st.value = "运行中。每 " + loadPref("pollInterval", 60) + " 秒自动检查。";
    st.style.color = "green";
  } else {
    st.value = "已加载（设置保存在主窗口生效）";
    st.style.color = "orange";
  }
}

// ── Init ─────────────────────────────────────────────
function initSettings() {
  dlog("initSettings called");
  try {
    loadUI();
    $("saveBtn").addEventListener("command", function() { dlog("save clicked"); saveUI(); });
    $("closeBtn").addEventListener("command", function() { window.close(); });
    $("pollIntervalInput").addEventListener("keypress", function(e) { if (e.key === "Enter") saveUI(); });

    var runBtn = $("runNowBtn");
    var hasMain = false;
    try { hasMain = !!(window.opener && window.opener.Zotero && window.opener.Zotero.LLMNoteSync && window.opener.Zotero.LLMNoteSync._runNow); } catch(e) {}
    if (runBtn && hasMain) {
      runBtn.addEventListener("command", function() {
        runBtn.setAttribute("disabled", "true");
        runBtn.label = "运行中…";
        $("statusLabel").value = "正在处理…";
        window.opener.Zotero.LLMNoteSync._runNow().then(function(r) {
          $("statusLabel").value = r.total === 0 ? "无待处理的对话。" : "完成: 成功 " + r.ok + " / 总计 " + r.total;
          runBtn.removeAttribute("disabled");
          runBtn.label = "立即运行批量追加";
        })["catch"](function(e) {
          $("statusLabel").value = "错误: " + (e.message || e);
          runBtn.removeAttribute("disabled");
          runBtn.label = "立即运行批量追加";
        });
      });
    } else if (runBtn) {
      runBtn.setAttribute("disabled", "true");
      runBtn.label = "请从主菜单运行";
    }

    updateStatus();
    dlog("initSettings complete");
  } catch (e) {
    dlog("initSettings error: " + (e.message || e));
  }
}