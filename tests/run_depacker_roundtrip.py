#!/usr/bin/env python3
"""
Regression test: every Z80 depacker vs its JS packer, over real ZX screens.

For each test screen and every compressor that ships a Z80 depacker, this:
  1. packs the screen with the JS packer (in a headless browser),
  2. assembles the matching Z80 depacker with ZX-M8XXX's sjasmplus-js,
  3. executes it on ZX-M8XXX's Z80 CPU core, and
  4. compares the decompressed $4000-$5AFF against the original screen.

A pass means the real Z80 depacker correctly decodes what the JS packer emits.

Prerequisites
-------------
  * Python 3.8+
  * A Chromium-based browser (Chrome / Edge / Chromium) for --headless --dump-dom.
    Auto-detected from PATH and common install locations; override with $BROWSER.
  * A ZX-M8XXX checkout (https://github.com/Bedazzle/ZX-M8XXX) providing the Z80
    core + assembler. Expected as a sibling of this repo; override with $ZX_M8XXX_DIR.
  * Test screens: tests/fixtures/*.scr (see tests/fixtures/manifest.json).

Usage
-----
  python tests/run_depacker_roundtrip.py
  BROWSER=/path/to/chrome ZX_M8XXX_DIR=/path/to/ZX-M8XXX python tests/run_depacker_roundtrip.py

Exit code 0 = all OK, 1 = at least one failure, 2 = setup/harness error.
"""
import http.server, socketserver, threading, subprocess, sys, os, re, json, tempfile, shutil, time, shlex
from pathlib import Path

REPO   = Path(__file__).resolve().parents[1]          # the Compressors-JS checkout
PARENT = REPO.parent                                   # served root (repo + siblings)
M8XXX  = Path(os.environ.get("ZX_M8XXX_DIR", PARENT / "ZX-M8XXX")).resolve()
PORT   = int(os.environ.get("PORT", "8124"))

def find_browser():
    if os.environ.get("BROWSER"):
        return os.environ["BROWSER"]
    # PATH names across platforms
    for name in ("chrome", "google-chrome", "google-chrome-stable", "chromium",
                 "chromium-browser", "msedge", "microsoft-edge", "brave"):
        p = shutil.which(name)
        if p:
            return p
    # Common install locations (Windows / macOS / Linux)
    candidates = [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
    ]
    for p in candidates:
        if os.path.exists(p):
            return p
    sys.exit("No Chromium-based browser found. Set $BROWSER to a Chrome/Edge/Chromium binary.")

def url_rel(path: Path) -> str:
    """URL path (relative to the served PARENT root) for a file/dir under PARENT."""
    try:
        rel = path.resolve().relative_to(PARENT)
    except ValueError:
        sys.exit(f"{path} is not under the served root {PARENT}. Put ZX-M8XXX beside this "
                 f"repo, or set $ZX_M8XXX_DIR to a path under {PARENT}.")
    return "/" + rel.as_posix()

def serve():
    handler = lambda *a, **k: http.server.SimpleHTTPRequestHandler(*a, directory=str(PARENT), **k)
    httpd = socketserver.ThreadingTCPServer(("127.0.0.1", PORT), handler)
    httpd.daemon_threads = True
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd

def main():
    if not (M8XXX / "core" / "z80.js").exists():
        sys.exit(f"ZX-M8XXX not found at {M8XXX}. Clone https://github.com/Bedazzle/ZX-M8XXX "
                 f"beside this repo, or set $ZX_M8XXX_DIR.")

    browser = find_browser()
    harness = (f"http://localhost:{PORT}{url_rel(REPO)}/tests/depacker-roundtrip.html"
               f"?m8xxx={url_rel(M8XXX)}")

    httpd = serve()
    time.sleep(0.4)
    profile = tempfile.mkdtemp(prefix="depack_browser_")
    try:
        cmd = [browser, "--headless=new", "--disable-gpu", "--no-first-run", "--mute-audio",
               f"--user-data-dir={profile}", "--virtual-time-budget=600000", "--dump-dom", harness]
        dom = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8",
                             errors="replace", timeout=900).stdout
    finally:
        httpd.shutdown()
        shutil.rmtree(profile, ignore_errors=True)

    m = re.search(r"RESULT_START\s*(.*?)\s*RESULT_END", dom, re.S)
    if not m:
        print("No RESULT block produced. First 2k of DOM:\n", dom[:2000]); return 2
    results = json.loads(m.group(1))
    if isinstance(results, dict) and results.get("error"):
        print("Harness error:", results["error"]); return 2

    screens = {}
    for r in results:
        screens.setdefault(r.get("screen", "?"), []).append(r)

    ok = bad = 0
    for sname, rows in screens.items():
        print(f"\n=== {sname} ===")
        for r in rows:
            st = r.get("status", "?")
            passed = st in ("OK", "OK-ATTRS")
            if passed: ok += 1
            elif r.get("id"): bad += 1
            extra = []
            if r.get("packed") is not None: extra.append(f"packed={r['packed']}")
            if r.get("diffAt", -1) is not None and r.get("diffAt", -1) >= 0: extra.append(f"diff@{r['diffAt']}")
            if r.get("steps"): extra.append(f"steps={r['steps']}")
            if r.get("detail"): extra.append(r["detail"])
            print(f"  {'OK ' if passed else '!! '}{str(r.get('id','')):10} {st:14} {'  '.join(extra)}")

    print(f"\nTOTAL: {ok} OK, {bad} failed")
    return 0 if bad == 0 else 1

if __name__ == "__main__":
    sys.exit(main())
