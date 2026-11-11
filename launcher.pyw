"""Folio PDF Editor launcher (no console window).

Starts the local server in the background if it isn't running yet, then
opens the editor in its own browser window. A PDF path may be passed as an
argument (e.g. by dropping a file onto the desktop shortcut) to open it
directly.
"""
import json
import os
import socket
import subprocess
import sys
import time
import urllib.parse
import urllib.request
import webbrowser

ROOT = os.path.dirname(os.path.abspath(__file__))
APP_ID = "folio-pdf-editor"
CONFIG_FILE = os.path.join(ROOT, "config.json")
LOG_FILE = os.path.join(ROOT, "logs", "server.log")
DEFAULTS = {"port": 8765, "app_window": True, "browser": "auto"}

BROWSERS = [
    r"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe",
    r"%ProgramFiles%\Microsoft\Edge\Application\msedge.exe",
    r"%ProgramFiles%\Google\Chrome\Application\chrome.exe",
    r"%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe",
    r"%LocalAppData%\Google\Chrome\Application\chrome.exe",
    r"%ProgramFiles%\BraveSoftware\Brave-Browser\Application\brave.exe",
]


def config() -> dict:
    cfg = dict(DEFAULTS)
    try:
        with open(CONFIG_FILE, encoding="utf-8") as fh:
            cfg.update(json.load(fh))
    except (OSError, ValueError):
        pass
    return cfg


def message(text: str, error: bool = True) -> None:
    try:
        import ctypes
        ctypes.windll.user32.MessageBoxW(0, text, "Folio PDF Editor", 0x10 if error else 0x40)
    except Exception:  # noqa: BLE001
        print(text)


def healthy(port: int) -> bool:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=0.8) as r:
            return json.load(r).get("app") == APP_ID
    except Exception:  # noqa: BLE001
        return False


def port_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind(("127.0.0.1", port))
            return True
        except OSError:
            return False


def python_exe() -> str:
    for name in ("pythonw.exe", "python.exe"):
        p = os.path.join(ROOT, ".venv", "Scripts", name)
        if os.path.isfile(p):
            return p
    exe = sys.executable
    w = os.path.join(os.path.dirname(exe), "pythonw.exe")
    return w if os.path.isfile(w) else exe


def start_server(port: int) -> None:
    flags = 0
    if os.name == "nt":
        flags = 0x00000008 | 0x00000200 | 0x08000000  # DETACHED | NEW_GROUP | NO_WINDOW
    subprocess.Popen(
        [python_exe(), os.path.join(ROOT, "backend", "server.py"), "--port", str(port), "--log"],
        cwd=ROOT, creationflags=flags, close_fds=True,
        stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )


def ensure_server(base_port: int) -> int:
    ports = [base_port] + [p for p in range(8765, 8790) if p != base_port]
    # Only probe ports something is listening on: on Windows, connecting to a
    # closed localhost port stalls for about a second.
    for p in ports:
        if not port_free(p) and healthy(p):
            return p
    port = next((p for p in ports if port_free(p)), None)
    if port is None:
        raise RuntimeError("No free local port found (8765-8789).")
    start_server(port)
    deadline = time.time() + 30
    while time.time() < deadline:
        if not port_free(port) and healthy(port):
            return port
        time.sleep(0.1)
    raise RuntimeError(f"The editor did not start. Details may be in:\n{LOG_FILE}")


def upload(port: int, path: str):
    with open(path, "rb") as fh:
        data = fh.read()
    name = urllib.parse.quote(os.path.basename(path))
    req = urllib.request.Request(f"http://127.0.0.1:{port}/api/docs?name={name}", data=data,
                                 method="POST", headers={"Content-Type": "application/octet-stream"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.load(r).get("id")
    except Exception:  # noqa: BLE001  (password protected files are opened in the browser instead)
        return None


def find_browser(pref: str):
    if pref and pref != "auto" and os.path.isfile(os.path.expandvars(pref)):
        return os.path.expandvars(pref)
    for b in BROWSERS:
        p = os.path.expandvars(b)
        if os.path.isfile(p):
            return p
    return None


def open_ui(url: str, cfg: dict) -> None:
    exe = find_browser(cfg.get("browser", "auto")) if cfg.get("app_window", True) else None
    if exe:
        subprocess.Popen([exe, f"--app={url}", "--window-size=1440,920"], close_fds=True)
    else:
        webbrowser.open(url)


def main() -> None:
    cfg = config()
    try:
        port = ensure_server(int(cfg.get("port", 8765)))
    except Exception as exc:  # noqa: BLE001
        message(f"Folio PDF Editor could not be started.\n\n{exc}")
        return
    url = f"http://127.0.0.1:{port}/"
    files = [a for a in sys.argv[1:] if os.path.isfile(a)]
    if files:
        doc = upload(port, files[0])
        if doc:
            url += f"?doc={doc}"
    open_ui(url, cfg)


if __name__ == "__main__":
    main()
