/**
 * LLM Note Auto-Sync - Bootstrap
 * 
 * Zotero 9 bootstrap plugin that automatically saves
 * zotero-llm conversations as Zotero notes.
 */

"use strict";

var chromeHandle;

function fileLog(msg) {
  try {
    var desktopDir = "";
    try {
      // Dynamically resolve desktop path for cross-user compatibility
      desktopDir = OS.Constants.Path.desktopDir;
    } catch (e2) {
      try {
        // Fallback: use profile dir
        desktopDir = OS.Constants.Path.profileDir;
      } catch (e3) {
        desktopDir = "";
      }
    }
    var logPath = desktopDir ? desktopDir + "\\llm-note-sync.log" : "llm-note-sync.log";
    var file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    file.initWithPath(logPath);
    var stream = Cc["@mozilla.org/network/file-output-stream;1"].createInstance(Ci.nsIFileOutputStream);
    stream.init(file, 0x02 | 0x08 | 0x10, 0o644, 0);
    var data = new Date().toISOString() + " " + msg + "\n";
    stream.write(data, data.length);
    stream.close();
  } catch (e) {}
}

function install(data, reason) {
  fileLog("install() reason=" + reason);
}
function uninstall(data, reason) {
  fileLog("uninstall() reason=" + reason);
}

async function startup({ rootURI }, reason) {
  fileLog("startup() reason=" + reason);
  try {
    var aomStartup = Cc["@mozilla.org/addons/addon-manager-startup;1"]
      .getService(Ci.amIAddonManagerStartup);
    var manifestURI = Services.io.newURI(rootURI + "manifest.json");
    chromeHandle = aomStartup.registerChrome(manifestURI, [
      ["content", "llmnotesync", rootURI + "content/"],
    ]);
    fileLog("chrome registered OK");

    Services.scriptloader.loadSubScript(
      rootURI + "content/main.js",
      { Zotero, Services, ChromeUtils, fileLog }
    );
    fileLog("main.js loaded, Zotero.LLMNoteSync=" + (typeof Zotero.LLMNoteSync));

    if (Zotero.LLMNoteSync && Zotero.LLMNoteSync.hooks.onStartup) {
      await Zotero.LLMNoteSync.hooks.onStartup();
      fileLog("onStartup() completed");
    }

    // ── Watch for main window to add menu ──────────────
    // onMainWindowLoad() is not called in Zotero 9 bootstrap plugins,
    // so we use a window listener to detect the main window.
    try {
      var winListener = {
        onOpenWindow: function(xulWin) {
          try {
            var domWin = xulWin.QueryInterface(Ci.nsIInterfaceRequestor)
                               .getInterface(Ci.nsIDOMWindow);
            domWin.addEventListener("load", function onLoad() {
              try {
                var href = domWin.location && domWin.location.href;
                if (href && href.includes("zoteroPane.xhtml")) {
                  fileLog("main window detected: adding menu");
                  if (Zotero.LLMNoteSync && Zotero.LLMNoteSync.hooks.onMainWindowLoad) {
                    Zotero.LLMNoteSync.hooks.onMainWindowLoad(domWin);
                  }
                }
              } catch (e) {
                fileLog("main window load error: " + (e.message || e));
              }
            }, { once: true });
          } catch (e) {
            fileLog("onOpenWindow error: " + (e.message || e));
          }
        },
        onCloseWindow: function() {},
        onWindowTitleChange: function() {},
      };
      Services.wm.addListener(winListener);
      fileLog("main window listener registered");

      // Also check already-open windows (Zotero may start before plugin)
      try {
        var enumerator = Services.wm.getEnumerator(null);
        while (enumerator.hasMoreElements()) {
          try {
            var win = enumerator.getNext(); // This is already a DOM window
            if (win.document && win.document.readyState === "complete") {
              var href = win.location && win.location.href;
              if (href && href.includes("zoteroPane.xhtml")) {
                fileLog("main window already open: adding menu to existing window");
                if (Zotero.LLMNoteSync && Zotero.LLMNoteSync.hooks.onMainWindowLoad) {
                  Zotero.LLMNoteSync.hooks.onMainWindowLoad(win);
                }
              }
            }
          } catch (ew) {
            fileLog("existing window iter error: " + (ew.message || ew));
          }
        }
      } catch (ee) {
        fileLog("existing windows check: " + (ee.message || ee));
      }
    } catch (we) {
      fileLog("window listener error: " + (we.message || we));
    }
  } catch (e) {
    fileLog("FATAL startup: " + (e.message || e));
    Zotero.log("LLM Note Auto-Sync [startup]: " + (e.message || e), "error");
  }
}

async function onMainWindowLoad({ window }, reason) {
  try {
    if (Zotero.LLMNoteSync && Zotero.LLMNoteSync.hooks.onMainWindowLoad) {
      await Zotero.LLMNoteSync.hooks.onMainWindowLoad(window);
    }
  } catch (e) {
    fileLog("onMainWindowLoad error: " + (e.message || e));
  }
}

async function onMainWindowUnload({ window }, reason) {
  try {
    if (Zotero.LLMNoteSync && Zotero.LLMNoteSync.hooks.onMainWindowUnload) {
      await Zotero.LLMNoteSync.hooks.onMainWindowUnload();
    }
  } catch (e) {}
}

async function shutdown({ rootURI }, reason) {
  if (reason === APP_SHUTDOWN) return;
  try {
    if (Zotero.LLMNoteSync && Zotero.LLMNoteSync.hooks.onShutdown) {
      await Zotero.LLMNoteSync.hooks.onShutdown();
    }
  } catch (e) {}
  if (chromeHandle) {
    chromeHandle.destruct();
    chromeHandle = null;
    fileLog("chrome unregistered");
  }
}