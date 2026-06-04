import zipfile, os

base = os.path.dirname(os.path.abspath(__file__))
files = [
    "manifest.json",
    "bootstrap.js",
    "content/icon.svg",
    "content/main.js",
    "content/settings.xhtml",
    "content/settings.js",
    "content/prefs.xhtml",
    "content/prefs.js",
]
xpi_path = os.path.join(base, "..", "llm-note-sync.xpi")
with zipfile.ZipFile(xpi_path, "w", zipfile.ZIP_DEFLATED) as z:
    for f in files:
        fp = os.path.join(base, f)
        if os.path.exists(fp):
            z.write(fp, f)
            print(f"  added: {f}  ({os.path.getsize(fp)} bytes)")
        else:
            print(f"  SKIP: {f}  (not found)")
print(f"\nXPI built: {xpi_path} ({os.path.getsize(xpi_path)} bytes)")
