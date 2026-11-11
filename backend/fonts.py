"""System font discovery and PDF font matching.

Scans the Windows font folders, reads each font's `name`/`OS/2`/`cmap`
tables (no third-party dependencies) and groups the files into families
with up to four styles: regular (r), bold (b), italic (i), bold italic (bi).

The browser preview and the PDF writer use the *same* font files, so text
looks identical on screen and in the exported document.
"""
from __future__ import annotations

import os
import re
import struct
import threading

import pymupdf as fitz

FONT_DIRS = [
    os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts"),
    os.path.join(os.environ.get("LOCALAPPDATA", ""), "Microsoft", "Windows", "Fonts"),
]

POPULAR = [
    "Arial", "Calibri", "Times New Roman", "Cambria", "Georgia", "Segoe UI",
    "Verdana", "Tahoma", "Trebuchet MS", "Courier New", "Consolas", "Garamond",
    "Palatino Linotype", "Book Antiqua", "Century Gothic", "Candara", "Constantia",
    "Corbel", "Franklin Gothic Medium", "Comic Sans MS", "Impact", "Arial Narrow",
    "Lucida Sans Unicode", "Segoe Script", "Segoe Print", "Ink Free",
]

SCRIPT_HINTS = ("script", "hand", "brush", "ink free", "print", "mistral", "kunstler",
                "vivaldi", "freestyle", "edwardian", "lucida calligraphy", "gabriola")

_lock = threading.Lock()
_families: list[dict] | None = None
_by_name: dict[str, dict] = {}
_by_id: dict[str, dict] = {}
_font_cache: dict[str, fitz.Font] = {}


# --------------------------------------------------------------------------- #
#  Minimal OpenType table parsing
# --------------------------------------------------------------------------- #
def _tables(f, offset: int):
    f.seek(offset)
    hdr = f.read(12)
    if len(hdr) < 12:
        return None
    sfnt, num = struct.unpack(">IH", hdr[:6])
    if sfnt not in (0x00010000, 0x4F54544F, 0x74727565):  # TrueType, 'OTTO', 'true'
        return None
    raw = f.read(16 * num)
    out = {}
    for i in range(num):
        tag, _chk, off, ln = struct.unpack(">4sIII", raw[i * 16:(i + 1) * 16])
        out[tag.decode("latin-1")] = (off, ln)
    return out


def _names(f, off: int, ln: int) -> dict[int, str]:
    f.seek(off)
    buf = f.read(ln)
    _fmt, count, so = struct.unpack(">HHH", buf[:6])
    best: dict[int, tuple[int, str]] = {}
    for i in range(count):
        rec = buf[6 + i * 12:18 + i * 12]
        if len(rec) < 12:
            break
        pid, eid, lid, nid, l, o = struct.unpack(">HHHHHH", rec)
        if nid not in (1, 2, 4, 6, 16, 17):
            continue
        raw = buf[so + o:so + o + l]
        try:
            if pid == 3 and eid in (0, 1, 10):
                s, score = raw.decode("utf-16-be"), (4 if lid == 0x409 else 2)
            elif pid == 0:
                s, score = raw.decode("utf-16-be"), 1
            elif pid == 1 and eid == 0:
                s, score = raw.decode("mac_roman"), (3 if lid == 0 else 0)
            else:
                continue
        except UnicodeDecodeError:
            continue
        if nid not in best or score > best[nid][0]:
            best[nid] = (score, s.strip("\x00 "))
    return {k: v[1] for k, v in best.items()}


def _is_symbol(f, off: int, ln: int) -> bool:
    f.seek(off)
    buf = f.read(min(ln, 4 + 8 * 64))
    if len(buf) < 4:
        return True
    _ver, n = struct.unpack(">HH", buf[:4])
    encs = set()
    for i in range(n):
        rec = buf[4 + i * 8:12 + i * 8]
        if len(rec) < 8:
            break
        pid, eid, _o = struct.unpack(">HHI", rec)
        encs.add((pid, eid))
    unicode = any(p == 0 for p, _ in encs) or (3, 1) in encs or (3, 10) in encs
    return not unicode


def _inspect(path: str) -> dict | None:
    try:
        with open(path, "rb") as f:
            head = f.read(12)
            offset = 0
            if head[:4] == b"ttcf":  # collection: use the first face only
                f.seek(12)
                offset = struct.unpack(">I", f.read(4))[0]
            t = _tables(f, offset)
            if not t or "name" not in t or "cmap" not in t:
                return None
            if "fvar" in t:  # variable fonts render inconsistently between engines
                return None
            if _is_symbol(f, *t["cmap"]):
                return None
            names = _names(f, *t["name"])
            fs_sel, weight, panose = 0, 400, bytes(10)
            if "OS/2" in t:
                f.seek(t["OS/2"][0])
                os2 = f.read(64)
                if len(os2) >= 64:
                    weight = struct.unpack(">H", os2[4:6])[0]
                    panose = os2[32:42]
                    fs_sel = struct.unpack(">H", os2[62:64])[0]
    except (OSError, struct.error):
        return None

    family = names.get(1)
    if not family or family.startswith("."):
        return None
    sub = (names.get(2) or "Regular").lower()
    bold = bool(fs_sel & 0x20) or "bold" in sub
    italic = bool(fs_sel & 0x01) or "italic" in sub or "oblique" in sub
    variant = ("b" if bold else "") + ("i" if italic else "")
    variant = variant or "r"

    lname = family.lower()
    fam_type, serif_style, proportion = panose[0], panose[1], panose[3]
    if proportion == 9 or any(k in lname for k in ("mono", "consol", "courier", "console")):
        cat = "mono"
    elif fam_type == 3 or any(k in lname for k in SCRIPT_HINTS):
        cat = "script"
    elif fam_type == 4:
        cat = "display"
    elif fam_type == 2 and 2 <= serif_style <= 10:
        cat = "serif"
    elif any(k in lname for k in ("times", "georgia", "garamond", "cambria", "serif", "roman",
                                     "palatino", "antiqua", "bodoni", "constantia", "baskerville")):
        cat = "serif"
    else:
        cat = "sans"
    return {
        "path": path, "family": family, "variant": variant, "cat": cat,
        "full": names.get(4) or family, "ps": names.get(6) or "", "weight": weight,
    }


def _scan() -> list[dict]:
    files = []
    for d in FONT_DIRS:
        if not d or not os.path.isdir(d):
            continue
        for name in sorted(os.listdir(d)):
            if name.lower().endswith((".ttf", ".otf", ".ttc")):
                files.append(os.path.join(d, name))
    fams: dict[str, dict] = {}
    for p in files:
        info = _inspect(p)
        if not info:
            continue
        fam = fams.setdefault(info["family"], {"family": info["family"], "cat": info["cat"],
                                               "variants": {}})
        if info["variant"] not in fam["variants"]:
            fam["variants"][info["variant"]] = {"path": info["path"], "full": info["full"],
                                                "ps": info["ps"]}
    result = [f for f in fams.values() if "r" in f["variants"]]
    pop = {n.lower(): i for i, n in enumerate(POPULAR)}
    result.sort(key=lambda f: (pop.get(f["family"].lower(), 999), f["family"].lower()))
    for i, f in enumerate(result):
        f["id"] = str(i)
        f["popular"] = f["family"].lower() in pop
    if not result:  # non-Windows fallback: PDF base-14 fonts
        result = [
            {"id": "b0", "family": "Helvetica", "cat": "sans", "popular": True, "base14": True,
             "variants": {"r": {"b14": "helv"}, "b": {"b14": "hebo"}, "i": {"b14": "heit"},
                          "bi": {"b14": "hebi"}}},
            {"id": "b1", "family": "Times", "cat": "serif", "popular": True, "base14": True,
             "variants": {"r": {"b14": "tiro"}, "b": {"b14": "tibo"}, "i": {"b14": "tiit"},
                          "bi": {"b14": "tibi"}}},
            {"id": "b2", "family": "Courier", "cat": "mono", "popular": True, "base14": True,
             "variants": {"r": {"b14": "cour"}, "b": {"b14": "cobo"}, "i": {"b14": "coit"},
                          "bi": {"b14": "cobi"}}},
        ]
    return result


def families() -> list[dict]:
    global _families
    with _lock:
        if _families is None:
            _families = _scan()
            for f in _families:
                _by_name[f["family"].lower()] = f
                _by_id[f["id"]] = f
        return _families


def public_list() -> list[dict]:
    out = []
    for f in families():
        out.append({
            "id": f["id"], "family": f["family"], "cat": f["cat"], "popular": f["popular"],
            "variants": {k: {"full": v.get("full", ""), "ps": v.get("ps", "")}
                         for k, v in f["variants"].items()},
        })
    return out


def font_file(fid: str, variant: str) -> tuple[bytes, str] | None:
    families()
    fam = _by_id.get(fid)
    if not fam:
        return None
    v = fam["variants"].get(variant) or fam["variants"].get("r")
    if not v or "path" not in v:
        return None
    with open(v["path"], "rb") as fh:
        data = fh.read()
    ext = os.path.splitext(v["path"])[1].lower()
    mime = {".otf": "font/otf", ".ttc": "font/collection"}.get(ext, "font/ttf")
    return data, mime


def get_family(name: str | None) -> dict | None:
    families()
    if not name:
        return None
    return _by_name.get(name.lower())


def _pick_variant(fam: dict, bold: bool, italic: bool) -> dict:
    want = ("b" if bold else "") + ("i" if italic else "") or "r"
    order = [want, "b" if bold else "r", "i" if italic else "r", "r"]
    for k in order:
        if k in fam["variants"]:
            return fam["variants"][k]
    return next(iter(fam["variants"].values()))


def get_font(name: str | None, bold: bool = False, italic: bool = False) -> fitz.Font:
    """Return a PyMuPDF Font for a family/style (falls back to Arial/Helvetica)."""
    fam = get_family(name) or get_family("Arial") or get_family("Helvetica") or families()[0]
    v = _pick_variant(fam, bold, italic)
    key = v.get("path") or v.get("b14")
    with _lock:
        f = _font_cache.get(key)
        if f is None:
            f = fitz.Font(fontfile=v["path"]) if "path" in v else fitz.Font(v["b14"])
            _font_cache[key] = f
        return f


def fallback_fonts(bold: bool = False, italic: bool = False) -> list[fitz.Font]:
    """Broad-coverage fonts used for characters missing from the chosen font."""
    out = []
    for n in ("Segoe UI", "Arial", "Segoe UI Symbol", "Nirmala UI", "Microsoft YaHei",
              "Yu Gothic", "Malgun Gothic"):
        fam = get_family(n)
        if fam:
            try:
                out.append(get_font(n, bold, italic))
            except Exception:  # noqa: BLE001
                pass
    with _lock:
        cjk = _font_cache.get("__cjk")
        if cjk is None:
            try:
                cjk = fitz.Font("cjk")
                _font_cache["__cjk"] = cjk
            except Exception:  # noqa: BLE001
                cjk = None
    if cjk:
        out.append(cjk)
    return out


# --------------------------------------------------------------------------- #
#  Mapping PDF font names to installed families
# --------------------------------------------------------------------------- #
ALIASES = {
    "helvetica": "Arial", "helveticaneue": "Arial", "arialmt": "Arial", "arial": "Arial",
    "times": "Times New Roman", "timesroman": "Times New Roman", "timesnewroman": "Times New Roman",
    "timesnewromanps": "Times New Roman", "nimbusromno9l": "Times New Roman",
    "nimbusroman": "Times New Roman", "liberationserif": "Times New Roman",
    "courier": "Courier New", "couriernew": "Courier New", "nimbusmono": "Courier New",
    "liberationsans": "Arial", "nimbussans": "Arial", "nimbussanl": "Arial",
    "liberationmono": "Courier New", "segoeui": "Segoe UI", "dejavusans": "Verdana",
    "calibrilight": "Calibri Light", "aptos": "Calibri", "symbol": "Segoe UI Symbol",
    "zapfdingbats": "Segoe UI Symbol", "minionpro": "Times New Roman", "myriadpro": "Arial",
}
_SUFFIXES = ("psmt", "mt", "ps", "std", "pro", "lt", "regular", "roman", "book", "normal")


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower())


def strip_subset(name: str) -> str:
    return name.split("+", 1)[1] if re.match(r"^[A-Z]{6}\+", name or "") else (name or "")


def match_pdf_font(name: str, flags: int = 0) -> dict:
    """Best installed family for a PDF font name. Returns {family, bold, italic}."""
    fams = families()
    n = strip_subset(name)
    low = n.lower()
    bold = bool(flags & 16) or bool(re.search(r"bold|black|heavy|semibold|demi", low))
    italic = bool(flags & 2) or bool(re.search(r"italic|oblique|-it$|-boldit$", low))
    base = re.split(r"[-,]", n, maxsplit=1)[0]
    cand = _norm(base)
    index = {_norm(f["family"]): f["family"] for f in fams}

    def lookup(key: str) -> str | None:
        if key in index:
            return index[key]
        if key in ALIASES and _norm(ALIASES[key]) in index:
            return index[_norm(ALIASES[key])]
        return None

    fam = lookup(cand) or lookup(_norm(n))
    if not fam:
        k = cand
        changed = True
        while k and changed and not fam:
            changed = False
            for suf in _SUFFIXES + ("bold", "italic", "oblique", "light", "medium", "semibold"):
                if k.endswith(suf) and len(k) > len(suf) + 2:
                    k = k[: -len(suf)]
                    changed = True
                    fam = lookup(k)
                    if fam:
                        break
    if not fam:  # longest installed family name that prefixes the PDF name
        best = ""
        for key, real in index.items():
            if len(key) >= 4 and cand.startswith(key) and len(key) > len(best):
                best = key
        if best:
            fam = index[best]
    if not fam:
        if flags & 8 or re.search(r"mono|courier|consol|code|cmtt|typewriter", low):
            pref = ["Courier New", "Consolas", "Courier"]
        elif flags & 4 or re.search(r"serif|roman|times|cmr|garamond|book|minion|georgia", low):
            pref = ["Times New Roman", "Georgia", "Cambria", "Times"]
        else:
            pref = ["Arial", "Calibri", "Segoe UI", "Helvetica"]
        for p in pref:
            if _norm(p) in index:
                fam = index[_norm(p)]
                break
        if not fam:
            fam = fams[0]["family"]
    return {"family": fam, "bold": bold, "italic": italic}
