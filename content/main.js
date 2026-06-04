/**
 * LLM Note Auto-Sync - Main Plugin Script
 *
 * Polls zotero-llm conversations and APPENDS them to the
 * paper's existing note. NEVER touches zotero-llm's
 * assistantNoteMap — uses its own tracking pref.
 * fileLog comes from bootstrap.js via loadSubScript context.
 */

"use strict";

if (typeof Zotero === "undefined") {
  throw new Error("LLM Note Auto-Sync: Zotero is not available");
}

var LLMNoteSync = (function() {
  var NS = "extensions.zotero.llmnotesync.";
  var PREF_KEYS = NS + "processedKeys";  // JSON array of conversation_key strings

  var processedKeys = null;
  var pollTimer = null;
  var pollStopped = false;

  function log(m) { Zotero.log("LLM Note Auto-Sync: " + m, "info"); }
  function warn(m) { Zotero.log("LLM Note Auto-Sync: " + m, "warn"); }
  function err(m, e) { Zotero.log("LLM Note Auto-Sync: " + m + ": " + (e && (e.message || e)), "error"); }

  // ─── Preferences ──────────────────────────────
  var PREFS = [
    ["pollInterval", "int", 60],
    ["appendPosition", "str", "bottom"],
    ["includeModel", "bool", true],
    ["includeHeadingTimestamp", "bool", true],
  ];

  function getPref(name) {
    try {
      var key = NS + name;
      var v = Zotero.Prefs.get(key, true);
      if (v === undefined || v === null) {
        // Find default
        for (var i = 0; i < PREFS.length; i++) {
          if (PREFS[i][0] === name) return PREFS[i][2];
        }
        return null;
      }
      return v;
    } catch (e) { return null; }
  }

  // ─── Processed conversation tracking ─────────
  var PROCESSED_VER = "v2";
  var _needsMigration = false;
  var _migrationKeys = null;

  function loadProcessedKeys() {
    if (processedKeys) return processedKeys;
    try {
      var raw = Zotero.Prefs.get(PREF_KEYS, true);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          // Old array format → migrate
          _needsMigration = true;
          _migrationKeys = parsed;
          processedKeys = {};
        } else if (typeof parsed === "object") {
          processedKeys = parsed;
          // Check for old-format 999999 phantom values
          var hasPhantom = false;
          for (var kk in parsed) {
            if (parsed.hasOwnProperty(kk) && parsed[kk] >= 999999) {
              hasPhantom = true;
              break;
            }
          }
          if (hasPhantom) {
            _needsMigration = true;
            _migrationKeys = Object.keys(parsed);
          }
        } else {
          processedKeys = {};
        }
      } else {
        processedKeys = {};
      }
    } catch (e) { processedKeys = {}; }
    return processedKeys;
  }

  async function migrateOldKeys() {
    if (!_needsMigration || !_migrationKeys || !_migrationKeys.length) return;
    try {
      var keys = _migrationKeys;
      _migrationKeys = null;
      _needsMigration = false;
      fileLog("migrating " + keys.length + " old-format keys...");
      // Query actual message count for each conversation
      var rows = await q(
        "SELECT conversation_key, COUNT(*) as cnt FROM llm_for_zotero_chat_messages " +
        "WHERE conversation_key IN (" + keys.map(function(k) { return "?"; }).join(",") + ") " +
        "GROUP BY conversation_key",
        keys
      );
      var obj = {};
      for (var i = 0; i < rows.length; i++) {
        obj[String(rows[i].conversation_key)] = rows[i].cnt;
        fileLog("migrate: conv " + rows[i].conversation_key + " -> " + rows[i].cnt + " msgs");
      }
      // Keys not found in DB: mark as fully processed
      for (var j = 0; j < keys.length; j++) {
        if (!obj.hasOwnProperty(String(keys[j]))) {
          obj[String(keys[j])] = 999999;
        }
      }
      processedKeys = obj;
      saveProcessedKeys();
      fileLog("migration complete");
    } catch (e) {
      fileLog("migration error: " + (e.message || e));
    }
  }

  function saveProcessedKeys() {
    try {
      Zotero.Prefs.set(PREF_KEYS, JSON.stringify(processedKeys || {}), true);
    } catch (e) { err("saveProcessedKeys", e); }
  }

  function isProcessed(key) {
    return loadProcessedKeys().hasOwnProperty(String(key));
  }

  function getProcessedCount(key) {
    var pk = loadProcessedKeys();
    var k = String(key);
    return pk.hasOwnProperty(k) ? pk[k] : 0;
  }

  function markProcessed(key, count) {
    var k = String(key);
    var cur = getProcessedCount(k);
    if (count > cur) {
      loadProcessedKeys()[k] = count;
      saveProcessedKeys();
    }
  }

  // ─── HTML formatting ─────────────────────────
  function esc(t) {
    return String(t).replace(/&/g,"&amp;").replace(/</g,"&lt;")
      .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }

  function textToHtml(t) {
    var h = esc(t);
    h = h.replace(/```(\w*)\n([\s\S]*?)```/g,
      '<pre style="background:#1e1e1e;color:#d4d4d4;padding:10px;border-radius:6px"><code>$2</code></pre>');
    h = h.replace(/`([^`]+)`/g,
      '<code style="background:#e0e0e0;padding:2px 6px;border-radius:3px">$1</code>');
    h = h.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    h = h.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    return h.replace(/\n/g, "<br/>");
  }

  function formatBlock(msgs) {
    var showTS = getPref("includeHeadingTimestamp");
    var showModel = getPref("includeModel");
    var d = new Date().toISOString().split("T")[0];
    var lines = [
      '<hr style="border:none;border-top:2px solid #2d6a9f"/>',
      '<div style="margin:10px 0;padding:10px;border-radius:8px;background:#f0f7ff">',
      '<p style="color:#2d6a9f;font-size:0.85em;margin:0">' +
        '<strong>zotero-llm 对话' +
        (showTS ? ' (' + d + ')' : '') +
        '</strong></p>',
    ];
    for (var j = 0; j < msgs.length; j++) {
      var m = msgs[j];
      var label = m.role === "user" ? "\u6211\u7684\u63D0\u95EE" : "AI \u56DE\u7B54";
      var bg = m.role === "user" ? "#e8f4fd" : "#f8f8f8";
      lines.push(
        '<div style="margin:10px 0;padding:8px 12px;border-radius:6px;background:' + bg + '">',
        '<strong style="font-size:0.9em">' + label + '</strong>',
        '<div style="margin-top:5px;font-size:0.95em">' + textToHtml(m.text || "") + "</div>",
        showModel && m.model_name
          ? '<p style="color:#999;font-size:0.8em;margin:4px 0 0">\u6A21\u578B: ' + esc(m.model_name) + "</p>"
          : "",
        "</div>"
      );
    }
    lines.push("</div>");
    return lines.join("\n");
  }

  // ─── Database helpers ────────────────────────
  function q(sql, params) { return Zotero.DB.queryAsync(sql, params); }

  async function getUnprocessedConversations() {
    try {
      var convs = await q(
        "SELECT p.conversation_key, p.paper_item_id, " +
        "COALESCE(p.title, p.first_user_title, '') as title, " +
        "COUNT(m.id) as msg_count " +
        "FROM llm_for_zotero_paper_conversations p " +
        "JOIN llm_for_zotero_chat_messages m ON m.conversation_key = p.conversation_key " +
        "GROUP BY p.conversation_key " +
        "HAVING msg_count >= 2 " +
        "ORDER BY MAX(m.timestamp) DESC"
      );
      var result = [];
      for (var i = 0; i < convs.length; i++) {
        var c = convs[i];
        var processedCount = getProcessedCount(c.conversation_key);
        // Include: not processed at all, OR has more messages than last synced
        if (!isProcessed(c.conversation_key) || c.msg_count > processedCount) {
          result.push(c);
        }
      }
      return result;
    } catch (e) {
      err("getUnprocessed", e);
      return [];
    }
  }

  async function getMessages(key) {
    return q(
      "SELECT role, COALESCE(text,'') as text, model_name, timestamp " +
      "FROM llm_for_zotero_chat_messages WHERE conversation_key = ? ORDER BY timestamp ASC",
      [key]
    );
  }

  // ─── Find paper's note for appending ─────────
  function findOrCreatePaperNote(paperId) {
    return (async function() {
      try {
        var parent = Zotero.Items.get(parseInt(paperId));
        if (!parent || parent.deleted) return null;

        var rows = await q(
          "SELECT itemID FROM itemNotes WHERE parentItemID = ? ORDER BY itemID ASC LIMIT 1",
          [paperId]
        );

        if (rows && rows.length > 0) {
          var noteId = rows[0].itemID;
          var note = Zotero.Items.get(noteId);
          if (note && !note.deleted) {
            try { fileLog("found existing note #" + noteId + " for paper " + paperId); } catch (e) {}
            return note;
          }
        }
      } catch (e) { err("findNote", e); }

      // No existing note — create one
      try {
        var parent2 = Zotero.Items.get(parseInt(paperId));
        if (!parent2 || parent2.deleted) return null;
        var note = new Zotero.Item("note");
        note.libraryID = parent2.libraryID;
        note.parentID = parseInt(paperId);
        note.setNote(
          '<div class="zotero-note znv1"><h1>zotero-llm \u5BF9\u8BDD\u8BB0\u5F55</h1></div>'
        );
        var sr = await note.saveTx();
        var newId = (typeof sr === "number" && sr > 0) ? sr : note.id;
        if (newId && newId > 0) {
          try { fileLog("created new note #" + newId + " for paper " + paperId); } catch (e) {}
          return Zotero.Items.get(newId);
        }
      } catch (e) { err("createNote", e); }
      return null;
    })();
  }

  // ─── Process one conversation ────────────────
  async function processConversation(conv) {
    var key = conv.conversation_key;
    var paperId = conv.paper_item_id;
    var title = conv.title || "";
    try {
      var allMsgs = await getMessages(key);
      if (allMsgs.length < 2) return false;

      var processedCount = getProcessedCount(key);
      // Only get new messages (beyond last synced count)
      var newMsgs = allMsgs;
      if (processedCount > 0 && processedCount < allMsgs.length) {
        newMsgs = allMsgs.slice(processedCount);
      }
      var totalMsgs = allMsgs.length;

      // If we already have all messages, skip
      if (newMsgs.length === 0) {
        try { fileLog("conv " + key + ": no new messages (" + totalMsgs + " total, " + processedCount + " synced)"); } catch (e) {}
        return false;
      }

      var note = await findOrCreatePaperNote(paperId);
      if (!note) {
        log("skip " + key + ": paper " + paperId + " not found");
        return false;
      }

      var block = formatBlock(newMsgs);
      var html = note.getNote();
      var position = getPref("appendPosition");

      if (position === "top") {
        // Insert after the opening <div class="zotero-note"> heading
        if (html.indexOf("zotero-note") >= 0 && html.indexOf("zotero-llm") >= 0) {
          // Newly created note — insert after the <h1>
          html = html.replace(
            '<h1>zotero-llm \u5BF9\u8BDD\u8BB0\u5F55</h1>',
            '<h1>zotero-llm \u5BF9\u8BDD\u8BB0\u5F55</h1>' + block
          );
        } else {
          // Existing note — insert right after opening <div> tag
          var idx = html.indexOf(">");
          if (idx > 0) {
            html = html.slice(0, idx + 1) + block + html.slice(idx + 1);
          } else {
            html = block + html;
          }
        }
      } else {
        // "bottom" (default) — append at end
        if (html.indexOf("zotero-note") >= 0 && html.indexOf("zotero-llm \u5BF9\u8BDD\u8BB0\u5F55") >= 0) {
          // Our own fresh note — insert after heading
          html = html.replace(
            '<h1>zotero-llm \u5BF9\u8BDD\u8BB0\u5F55</h1>',
            '<h1>zotero-llm \u5BF9\u8BDD\u8BB0\u5F55</h1>' + block
          );
        } else {
          // Existing note — append at end
          html = html + block;
        }
      }

      note.setNote(html);
      await note.saveTx();

      markProcessed(key, totalMsgs);
      try {
        fileLog("appended conv " + key + " -> note #" + note.id + " (paper " + paperId + ")");
      } catch (e) {}
      return true;
    } catch (e) {
      err("process(" + key + ")", e);
      return false;
    }
  }

  // ─── Batch ───────────────────────────────────
  async function batch() {
    try { fileLog("batch start"); } catch (e) {}
    var convs = await getUnprocessedConversations();
    if (!convs.length) {
      log("nothing to process");
      try { fileLog("batch: none"); } catch (e) {}
      return { ok: 0, total: 0 };
    }
    log("found " + convs.length + " conversations");
    try { fileLog("batch: " + convs.length + " convs"); } catch (e) {}
    var ok = 0;
    for (var i = 0; i < convs.length; i++) {
      if (await processConversation(convs[i])) ok++;
      if (i > 0 && i % 5 === 0) await Zotero.Promise.delay(50);
    }
    log("batch done: " + ok + "/" + convs.length);
    try { fileLog("batch done: " + ok + "/" + convs.length); } catch (e) {}
    return { ok: ok, total: convs.length };
  }

  // ─── Poll ────────────────────────────────────
  async function poll() {
    try {
      var convs = await getUnprocessedConversations();
      for (var i = 0; i < convs.length; i++) {
        if (pollStopped) break;
        await processConversation(convs[i]);
      }
    } catch (e) { err("poll", e); }
  }

  function startPoll() {
    if (pollTimer) return;
    pollStopped = false;
    function tick() {
      if (pollStopped) return;
      poll()["catch"](function(e) { err("poll tick", e); })
        ["finally"](function() {
          if (!pollStopped) {
            var ms = (getPref("pollInterval") || 60) * 1000;
            pollTimer = Zotero.Promise.delay(ms).then(tick);
          }
        });
    }
    var ms = (getPref("pollInterval") || 60) * 1000;
    pollTimer = Zotero.Promise.delay(ms).then(tick);
    log("poll started (" + (ms / 1000) + "s)");
  }

  function stopPoll() { pollStopped = true; pollTimer = null; }

  // ─── Menu ────────────────────────────────────
  function xulEl(win, tag) {
    try { return win.document.createXULElement(tag); } catch (e) {}
    return win.document.createElementNS(
      "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul", tag);
  }

  var _addMenuTries = {};

  function addMenu(win) {
    fileLog("addMenu called, win=" + (win ? "OK" : "NULL") + " doc=" + (win && win.document ? "OK" : "NULL"));
    try {
      if (!win || !win.document) return;
      // Verify this is actually the zoteroPane window
      var url = win.location && win.location.href;
      if (!url || !url.includes("zoteroPane.xhtml")) {
        fileLog("addMenu: wrong window (url=" + url + "), skipping");
        return;
      }
      if (win.document.getElementById("llm-note-sync-menu")) { fileLog("addMenu: already exists"); return; }
      fileLog("addMenu: doc URL=" + url);
      
      var popup = win.document.querySelector("#menu-tools-popup");
      fileLog("addMenu: #menu-tools-popup=" + (popup ? popup.id || popup.localName : "null"));
      if (!popup) popup = win.document.querySelector("menupopup[id*='tools']");
      if (!popup) popup = win.document.querySelector("menupopup[id*='Tools']");
      if (!popup) popup = win.document.querySelector("menupopup[id*='menu']");
      fileLog("addMenu: after fallbacks popup=" + (popup ? (popup.id || popup.localName) : "null"));
      
      // Dump all menupopups if still not found
      if (!popup) {
        var retryKey = "win_" + (win.docShell ? win.docShell.outerWindowID : 0);
        _addMenuTries[retryKey] = (_addMenuTries[retryKey] || 0) + 1;
        if (_addMenuTries[retryKey] > 15) {
          fileLog("addMenu: giving up after " + _addMenuTries[retryKey] + " tries");
          return;
        }
        var allMenus = win.document.querySelectorAll("menupopup, menu, [role='menu'], nav");
        var info = [];
        for (var mi = 0; mi < allMenus.length && mi < 20; mi++) {
          var m = allMenus[mi];
          info.push((m.id || "?") + " (" + (m.localName || m.tagName) + ")");
        }
        fileLog("menus found: " + (info.length ? info.join(", ") : "NONE"));
        var htmlMenu = win.document.querySelector("#menu-tools-popup, #tools-menu, .menu-tools");
        if (htmlMenu) fileLog("found html-style menu: " + htmlMenu.id);
        Zotero.Promise.delay(2000).then(function() { addMenu(win); });
        return;
      }

      fileLog("addMenu: popup.nodeName=" + popup.nodeName + " localName=" + popup.localName + " ns=" + popup.namespaceURI);

      // Create XUL elements for the existing batch-run menu item
      var sep = xulEl(win, "menuseparator"); sep.id = "llm-note-sync-sep";
      var item = xulEl(win, "menuitem");
      item.id = "llm-note-sync-menu";
      item.setAttribute("label", "zotero-llm 对话 → 追加到笔记");
      item.addEventListener("command", function() {
        item.setAttribute("disabled", "true");
        item.setAttribute("label", "处理中…");
        batch().then(function(r) {
          win.Services.prompt.alert(null, "LLM Note Auto-Sync",
            "完成\n成功: " + r.ok + "\n总计: " + r.total);
        })["catch"](function(e) {
          win.Services.prompt.alert(null, "LLM Note Auto-Sync", "错误: " + e.message);
        })["finally"](function() {
          item.removeAttribute("disabled");
          item.setAttribute("label", "zotero-llm 对话 → 追加到笔记");
        });
      });

      // Settings menu item
      var settingsItem = xulEl(win, "menuitem");
      settingsItem.id = "llm-note-sync-settings";
      settingsItem.setAttribute("label", "LLM Sync 设置…");
      settingsItem.addEventListener("command", function() {
        win.openDialog("chrome://llmnotesync/content/settings.xhtml",
          "_blank", "chrome,titlebar,toolbar,centerscreen,modal", null);
      });

      // Append items via popupshowing event (survives menu rebuild)
      popup.setAttribute("llmnotesync-attached", "true");
      var attachItems = function() {
        if (popup.querySelector("#llm-note-sync-sep")) return; // already attached
        try { fileLog("addMenu: popupshowing - attaching items"); } catch (e) {}
        // Clone the items to avoid duplicate ID issues
        var sep2 = xulEl(win, "menuseparator"); sep2.id = "llm-note-sync-sep";
        var item2 = xulEl(win, "menuitem");
        item2.id = "llm-note-sync-menu";
        item2.setAttribute("label", "zotero-llm 对话 → 追加到笔记");
        item2.addEventListener("command", function() {
          item2.setAttribute("disabled", "true");
          item2.setAttribute("label", "处理中…");
          batch().then(function(r) {
            if (win.Services && win.Services.prompt)
              win.Services.prompt.alert(null, "LLM Note Auto-Sync",
                "完成\n成功: " + r.ok + "\n总计: " + r.total);
          })["catch"](function(e) {
            if (win.Services && win.Services.prompt)
              win.Services.prompt.alert(null, "LLM Note Auto-Sync", "错误: " + e.message);
          })["finally"](function() {
            item2.removeAttribute("disabled");
            item2.setAttribute("label", "zotero-llm 对话 → 追加到笔记");
          });
        });

        var settingsItem2 = xulEl(win, "menuitem");
        settingsItem2.id = "llm-note-sync-settings";
        settingsItem2.setAttribute("label", "LLM Sync 设置…");
        settingsItem2.addEventListener("command", function() {
          win.openDialog("chrome://llmnotesync/content/settings.xhtml",
            "_blank", "chrome,titlebar,toolbar,centerscreen,modal", null);
        });

        try { popup.appendChild(sep2); popup.appendChild(item2); popup.appendChild(settingsItem2);
          fileLog("addMenu: attached 3 items on popupshowing"); } catch (ae) { fileLog("addMenu: attach error: " + ae.message); }
      };
      popup.addEventListener("popupshowing", attachItems);
      // Also attach immediately for initial population
      attachItems();
    } catch (e) { err("addMenu", e); }
  }

  // ─── Reschedule poll (called from prefs.js) ────
  function reschedulePoll() {
    stopPoll();
    startPoll();
    log("poll rescheduled (" + (getPref("pollInterval") || 60) + "s)");
  }

  // ─── Lifecycle ───────────────────────────────
  return {
    _runNow: batch,
    _reschedule: reschedulePoll,
    migrateOldKeys: migrateOldKeys,
    hooks: {
      async onStartup() {
        try { fileLog("onStartup"); } catch (e) {}
        log("starting...");
        try { 
  var pkLen = Object.keys(loadProcessedKeys()).length;
  fileLog("loaded " + pkLen + " processed keys");
} catch (e) {}
        Zotero.Promise.delay(3000).then(async function() {
          try {
            // Migrate old-format tracking keys if needed
            if (typeof Zotero.LLMNoteSync.migrateOldKeys === "function") {
              await Zotero.LLMNoteSync.migrateOldKeys();
            }
            fileLog("3s done");
          } catch (mx) { fileLog("migrate error: " + mx.message); }
          batch().then(function(r) {
            try { fileLog("batch result: " + r.ok + "/" + r.total); } catch (e) {}
            if (r.total > 0) log("first run: " + r.ok + "/" + r.total);
            startPoll();
          })["catch"](function(e) {
            try { fileLog("batch ERROR: " + (e && (e.message || e))); } catch (ex) {}
            err("delayed start", e);
          });
        });
        log("startup queued");
      },
      onMainWindowLoad(win) {
        try { fileLog("onMainWindowLoad"); } catch (e) {}
        Zotero.Promise.delay(500).then(function() { addMenu(win); });
      },
      onMainWindowUnload() {},
      onShutdown() {
        stopPoll();
        log("shutdown");
      },
    },
  };
})();

Zotero.LLMNoteSync = LLMNoteSync;