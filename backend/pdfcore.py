"""PDF engine: loading, rendering, text extraction, form fields and export.

All coordinates exchanged with the browser are in PDF points in the page's
*displayed* coordinate space (origin top-left). Source pages are normalised
on load (`remove_rotation`) so displayed space == unrotated space.
"""
from __future__ import annotations

import base64
import math
import re
import threading
import time
import uuid

import pymupdf as fitz

import fonts as sysfonts

LOCK = threading.RLock()  # MuPDF is not thread safe
DOCS: dict[str, "Source"] = {}
PENDING: dict[str, tuple[bytes, str, float]] = {}  # password protected uploads

FILLABLE = {
    fitz.PDF_WIDGET_TYPE_TEXT: "text",
    fitz.PDF_WIDGET_TYPE_CHECKBOX: "checkbox",
    fitz.PDF_WIDGET_TYPE_RADIOBUTTON: "radio",
    fitz.PDF_WIDGET_TYPE_COMBOBOX: "combo",
    fitz.PDF_WIDGET_TYPE_LISTBOX: "list",
}


class NeedPassword(Exception):
    pass


class BadPassword(Exception):
    pass


class Source:
    def __init__(self, sid: str, name: str, data: bytes, doc: fitz.Document):
        self.id = sid
        self.name = name
        self.data = data
        self.doc = doc
        self.text_cache: dict[int, dict] = {}
        self.fonts: dict[int, dict] = {}

    def info(self) -> dict:
        pages = []
        for p in self.doc:
            r = p.rect
            pages.append({"w": round(r.width, 3), "h": round(r.height, 3),
                          "fields": p.first_widget is not None})
        meta = self.doc.metadata or {}
        return {"id": self.id, "name": self.name, "pages": pages,
                "title": meta.get("title") or ""}


# --------------------------------------------------------------------------- #
#  Loading
# --------------------------------------------------------------------------- #
IMAGE_EXT = (".png", ".jpg", ".jpeg", ".gif", ".bmp", ".tif", ".tiff", ".webp")


def _new_id() -> str:
    return uuid.uuid4().hex[:12]


def open_document(data: bytes, name: str, password: str | None = None,
                  pending_id: str | None = None) -> dict:
    with LOCK:
        if not data:
            raise ValueError("The file is empty.")
        if not data.lstrip()[:5].startswith(b"%PDF") and name.lower().endswith(IMAGE_EXT):
            img = fitz.open(stream=data, filetype=name.rsplit(".", 1)[-1].lower())
            data = img.convert_to_pdf()
            name = name.rsplit(".", 1)[0] + ".pdf"
        try:
            doc = fitz.open("pdf", data)
        except Exception as exc:  # noqa: BLE001
            raise ValueError("This file is not a valid PDF document.") from exc
        if doc.needs_pass:
            if not password:
                pid = pending_id or _new_id()
                PENDING[pid] = (data, name, time.time())
                raise NeedPassword(pid)
            if not doc.authenticate(password):
                raise BadPassword()
        changed = bool((doc.metadata or {}).get("encryption")) or doc.is_repaired
        for page in doc:
            if page.rotation:
                page.remove_rotation()
                changed = True
        if changed:
            data = doc.tobytes(encryption=fitz.PDF_ENCRYPT_NONE, garbage=1)
            doc = fitz.open("pdf", data)
        if doc.page_count == 0:
            raise ValueError("The PDF has no pages.")
        sid = _new_id()
        src = Source(sid, name, data, doc)
        DOCS[sid] = src
        if pending_id:
            PENDING.pop(pending_id, None)
        return src.info()


def unlock(pending_id: str, password: str) -> dict:
    item = PENDING.get(pending_id)
    if not item:
        raise KeyError(pending_id)
    data, name, _ = item
    return open_document(data, name, password, pending_id)


def get(sid: str) -> Source:
    src = DOCS.get(sid)
    if not src:
        raise KeyError(sid)
    return src


def cleanup_pending(max_age: float = 900) -> None:
    now = time.time()
    for k, (_, _, t) in list(PENDING.items()):
        if now - t > max_age:
            PENDING.pop(k, None)


# --------------------------------------------------------------------------- #
#  Rendering
# --------------------------------------------------------------------------- #
def _shrunk(r: fitz.Rect) -> fitz.Rect:
    """Shrink a text line box so redaction never touches neighbouring lines."""
    h = r.height
    dx = 0.4 if r.width > 2 else 0
    return fitz.Rect(r.x0 + dx, r.y0 + h * 0.28, r.x1 - dx, r.y1 - h * 0.28)


def remove_text(page: fitz.Page, rects) -> None:
    n = 0
    for r in rects:
        rr = _shrunk(fitz.Rect(r))
        if rr.is_empty:
            continue
        page.add_redact_annot(rr, fill=False, cross_out=False)
        n += 1
    if n:
        page.apply_redactions(images=fitz.PDF_REDACT_IMAGE_NONE,
                              graphics=fitz.PDF_REDACT_LINE_ART_NONE,
                              text=fitz.PDF_REDACT_TEXT_REMOVE)


def render(sid: str, index: int, scale: float, hide=None, hide_widgets=False,
           fmt: str = "png") -> bytes:
    with LOCK:
        src = get(sid)
        scale = max(0.05, min(scale, 8.0))
        page = src.doc[index]
        tmp = None
        if hide or hide_widgets:
            tmp = fitz.open()
            tmp.insert_pdf(src.doc, from_page=index, to_page=index)
            page = tmp[0]
            if hide_widgets:
                for w in list(page.widgets()):
                    if w.field_type in FILLABLE:
                        try:
                            page.delete_widget(w)
                        except Exception:  # noqa: BLE001
                            pass
            if hide:
                remove_text(page, hide)
        # keep huge pages within a sane pixel budget
        r = page.rect
        max_px = 5000
        if max(r.width, r.height) * scale > max_px:
            scale = max_px / max(r.width, r.height)
        pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
        out = pix.tobytes("jpeg", jpg_quality=88) if fmt == "jpeg" else pix.tobytes("png")
        if tmp is not None:
            tmp.close()
        return out


# --------------------------------------------------------------------------- #
#  Text extraction
# --------------------------------------------------------------------------- #
def _hex(color: int) -> str:
    return "#%06x" % (color & 0xFFFFFF)


def _font_info(src: Source, xref: int) -> dict:
    info = src.fonts.get(xref)
    if info is not None:
        return info
    info = {"xref": xref, "font": None, "ext": "n/a", "buffer": b""}
    try:
        basename, ext, _ftype, buf = src.doc.extract_font(xref)
        info["ext"] = ext
        if buf and ext != "n/a":
            info["buffer"] = buf
            info["font"] = fitz.Font(fontbuffer=buf)
    except Exception:  # noqa: BLE001
        info["font"] = None
    src.fonts[xref] = info
    return info


def _covers(font: fitz.Font | None, text: str) -> bool:
    if font is None:
        return False
    try:
        return all(font.has_glyph(ord(ch)) for ch in set(text) if not ch.isspace())
    except Exception:  # noqa: BLE001
        return False


def page_text(sid: str, index: int) -> dict:
    with LOCK:
        src = get(sid)
        if index in src.text_cache:
            return src.text_cache[index]
        page = src.doc[index]
        fontmap: dict[str, list[int]] = {}
        for f in page.get_fonts(full=True):
            fontmap.setdefault(sysfonts.strip_subset(f[3]), []).append(f[0])
        d = page.get_text("rawdict", flags=fitz.TEXT_PRESERVE_WHITESPACE | fitz.TEXT_MEDIABOX_CLIP)

        segs = []
        font_text: dict[str, list[str]] = {}
        font_flags: dict[str, int] = {}
        for bi, block in enumerate(d.get("blocks", [])):
            if block.get("type") != 0:
                continue
            for li, line in enumerate(block.get("lines", [])):
                ddx, ddy = line["dir"]
                if abs(ddy) > 0.02 or ddx <= 0:
                    continue  # only horizontal, left-to-right lines are editable
                chars = []
                for span in line["spans"]:
                    if span["size"] < 1:
                        continue
                    for c in span["chars"]:
                        chars.append((c, span))
                groups: list[list] = [[]]
                prev = None
                for c, span in chars:
                    bb = c["bbox"]
                    size = span["size"]
                    if c["c"] in (" ", "\xa0", "\t") and (bb[2] - bb[0]) > size * 1.6:
                        groups.append([])  # wide space = column gap
                        prev = None
                        continue
                    if prev is not None and bb[0] - prev[2] > max(size * 0.9, 4):
                        groups.append([])
                    groups[-1].append((c, span))
                    prev = bb
                for si, g in enumerate(groups):
                    text = "".join(c["c"] for c, _ in g)
                    if not text.strip():
                        continue
                    # trim surrounding whitespace characters
                    while g and g[0][0]["c"].isspace():
                        g = g[1:]
                    while g and g[-1][0]["c"].isspace():
                        g = g[:-1]
                    runs = []
                    x0 = min(c["bbox"][0] for c, _ in g)
                    x1 = max(c["bbox"][2] for c, _ in g)
                    y0 = min(min(c["bbox"][1], s["bbox"][1]) for c, s in g)
                    y1 = max(max(c["bbox"][3], s["bbox"][3]) for c, s in g)
                    cur_span = None
                    for c, span in g:
                        ch = c["c"].replace("\xa0", " ").replace("\t", " ")
                        if span is not cur_span:
                            cur_span = span
                            fname = span["font"]
                            runs.append({
                                "t": "", "f": fname, "s": round(span["size"], 2),
                                "c": _hex(span["color"]),
                                "o": [round(c["origin"][0], 2), round(c["origin"][1], 2)],
                                "x": [],
                                "fl": span["flags"],
                            })
                            font_flags[fname] = span["flags"]
                        run = runs[-1]
                        run["t"] += ch
                        run["x"].append(round(c["bbox"][0], 2))
                        run["xe"] = round(c["bbox"][2], 2)
                        font_text.setdefault(run["f"], []).append(ch)
                    for run in runs:
                        run["x"].append(run.pop("xe"))
                    segs.append({
                        "id": f"{bi}-{li}-{si}",
                        "bbox": [round(x0, 2), round(y0, 2), round(x1, 2), round(y1, 2)],
                        "runs": runs,
                    })

        fonts_out = {}
        for fname, chars in font_text.items():
            sample = "".join(chars)
            flags = font_flags.get(fname, 0)
            fid = None
            usable = False
            browser = False
            for xref in fontmap.get(fname, []):
                info = _font_info(src, xref)
                if _covers(info["font"], sample):
                    fid, usable = xref, True
                    browser = info["ext"] in ("ttf", "otf")
                    break
            fb = sysfonts.match_pdf_font(fname, flags)
            fonts_out[fname] = {
                "fid": fid if usable else None,
                "browser": browser,
                "family": fb["family"],
                "bold": fb["bold"],
                "italic": fb["italic"],
            }
        for s in segs:
            for run in s["runs"]:
                fl = run.pop("fl")
                fo = fonts_out[run["f"]]
                run["b"] = fo["bold"] or bool(fl & 16)
                run["i"] = fo["italic"] or bool(fl & 2)
        result = {"segments": segs, "fonts": fonts_out}
        src.text_cache[index] = result
        return result


def font_for_browser(sid: str, xref: int) -> tuple[bytes, str] | None:
    with LOCK:
        src = get(sid)
        info = _font_info(src, xref)
        if not info["buffer"] or info["ext"] not in ("ttf", "otf"):
            return None
        return info["buffer"], ("font/otf" if info["ext"] == "otf" else "font/ttf")


# --------------------------------------------------------------------------- #
#  Form fields
# --------------------------------------------------------------------------- #
def _field_key(w) -> str:
    r = w.rect
    return f"{w.field_name}|{r.x0:.1f},{r.y0:.1f}"


def page_fields(sid: str, index: int) -> list[dict]:
    with LOCK:
        src = get(sid)
        page = src.doc[index]
        out = []
        for w in page.widgets():
            kind = FILLABLE.get(w.field_type)
            if not kind:
                continue
            flags = w.field_flags or 0
            item = {
                "key": _field_key(w), "name": w.field_name, "type": kind,
                "rect": [round(v, 2) for v in w.rect], "label": w.field_label or "",
                "readonly": bool(flags & 1), "fontsize": w.text_fontsize or 0,
            }
            if kind == "text":
                item["value"] = w.field_value or ""
                item["multiline"] = bool(flags & (1 << 12))
                item["password"] = bool(flags & (1 << 13))
                item["maxlen"] = w.text_maxlen or 0
                item["comb"] = bool(flags & (1 << 24))
            elif kind in ("checkbox", "radio"):
                on = w.on_state()
                item["on"] = on if isinstance(on, str) else "Yes"
                v = w.field_value
                item["value"] = v not in (None, False, "", "Off") and (v is True or v == item["on"])
            else:
                item["options"] = [o if isinstance(o, str) else (o[1] if len(o) > 1 else o[0])
                                   for o in (w.choice_values or [])]
                item["value"] = w.field_value or ""
            out.append(item)
        return out


def _apply_fields(page: fitz.Page, values: list[dict]) -> None:
    if not values:
        return
    by_key = {v["key"]: v for v in values}
    for w in page.widgets():
        spec = by_key.get(_field_key(w))
        if spec is None:
            continue
        try:
            kind = FILLABLE.get(w.field_type)
            val = spec.get("value")
            if kind in ("checkbox", "radio"):
                on = w.on_state()
                on = on if isinstance(on, str) else "Yes"
                w.field_value = on if val else "Off"
            elif kind == "text":
                w.field_value = str(val or "")
            else:
                w.field_value = val or ""
            w.update()
        except Exception:  # noqa: BLE001
            pass


# --------------------------------------------------------------------------- #
#  Export helpers
# --------------------------------------------------------------------------- #
def _rgb(col, default=(0, 0, 0)):
    if not col or not isinstance(col, str) or not col.startswith("#") or len(col) < 7:
        return default
    return tuple(int(col[i:i + 2], 16) / 255 for i in (1, 3, 5))


def _rot_pt(ax: float, ay: float, dx: float, dy: float, deg: float) -> fitz.Point:
    """Rotate offset (dx,dy) clockwise (screen sense) about anchor (ax,ay)."""
    a = math.radians(deg)
    c, s = round(math.cos(a), 10), round(math.sin(a), 10)
    return fitz.Point(ax + dx * c - dy * s, ay + dx * s + dy * c)


def _segments(text: str, chain: list[fitz.Font]) -> list[tuple[str, fitz.Font]]:
    """Split text into pieces, each rendered by the first font that has the glyphs."""
    out: list[tuple[str, fitz.Font]] = []
    for ch in text:
        font = chain[-1] if len(chain) == 1 else None
        if font is None:
            if ch.isspace():
                font = out[-1][1] if out else chain[0]
                if not font.has_glyph(32) and ch == " ":
                    font = next((f for f in chain if f.has_glyph(32)), chain[0])
            else:
                font = next((f for f in chain if f.has_glyph(ord(ch))), chain[0])
        if out and out[-1][1] is font:
            out[-1] = (out[-1][0] + ch, font)
        else:
            out.append((ch, font))
    return out


class Writers:
    """One TextWriter per colour (TextWriter supports a single colour)."""

    def __init__(self, page: fitz.Page):
        self.page = page
        self.w: dict[tuple, fitz.TextWriter] = {}

    def get(self, color) -> fitz.TextWriter:
        if color not in self.w:
            self.w[color] = fitz.TextWriter(self.page.rect, color=color)
        return self.w[color]

    def flush(self, morph=None, opacity=1.0):
        for color, tw in self.w.items():
            tw.write_text(self.page, color=color, morph=morph,
                          opacity=opacity if opacity < 1 else -1)
        self.w.clear()


class Ctx:
    def __init__(self, out: fitz.Document, images: dict):
        self.out = out
        self.images = images
        self.image_xrefs: dict[str, int] = {}


def _font_chain(src: Source | None, run: dict) -> list[fitz.Font]:
    chain = []
    fid = run.get("fid")
    if src is not None and fid:
        try:
            info = _font_info(src, int(fid))
            if info["font"] is not None:
                chain.append(info["font"])
        except Exception:  # noqa: BLE001
            pass
    bold, italic = bool(run.get("bold")), bool(run.get("italic"))
    chain.append(sysfonts.get_font(run.get("family"), bold, italic))
    chain.extend(sysfonts.fallback_fonts(bold, italic))
    return chain


def _text_width(pieces, size) -> float:
    return sum(f.text_length(t, fontsize=size) for t, f in pieces)


def draw_text_box(page: fitz.Page, o: dict) -> None:
    """A text box added by the user (single style, one or more lines)."""
    size = float(o.get("size", 12))
    lh = float(o.get("lh", 1.25)) * size
    base = float(o.get("base", size * 0.9))
    x, y = float(o["x"]), float(o["y"])
    rot = float(o.get("rot", 0)) % 360
    run = {"family": o.get("family"), "bold": o.get("bold"), "italic": o.get("italic")}
    chain = _font_chain(None, run)
    color = _rgb(o.get("color"))
    lines = str(o.get("text", "")).split("\n")
    pieces = [_segments(ln, chain) for ln in lines]
    widths = [_text_width(p, size) for p in pieces]
    box_w = max(widths) if widths else 0
    align = o.get("align", "left")
    wr = Writers(page)
    tw = wr.get(color)
    deco = []
    for i, (pcs, w) in enumerate(zip(pieces, widths)):
        lx = 0.0 if align == "left" else (box_w - w) / 2 if align == "center" else box_w - w
        pen = fitz.Point(x + lx, y + base + i * lh)
        start = fitz.Point(pen)
        for t, f in pcs:
            _, pen = tw.append(pen, t, font=f, fontsize=size)
        if o.get("underline") and w > 0:
            deco.append((start.x - x, start.y - y + size * 0.12, w))
        if o.get("strike") and w > 0:
            deco.append((start.x - x, start.y - y - size * 0.28, w))
    morph = (fitz.Point(x, y), fitz.Matrix(-rot)) if rot else None
    wr.flush(morph=morph, opacity=float(o.get("opacity", 1)))
    for dx, dy, w in deco:
        p1 = _rot_pt(x, y, dx, dy, rot)
        p2 = _rot_pt(x, y, dx + w, dy, rot)
        page.draw_line(p1, p2, color=color, width=max(size * 0.06, 0.5),
                       stroke_opacity=float(o.get("opacity", 1)))


def draw_text_edit(page: fitz.Page, o: dict, src: Source | None) -> None:
    """Re-typeset an edited line of original text (runs keep their own styles)."""
    pen = fitz.Point(float(o["x"]), float(o["y"]))
    wr = Writers(page)
    for run in o.get("runs", []):
        text = str(run.get("t", ""))
        if not text:
            continue
        size = float(run.get("size", 12))
        tw = wr.get(_rgb(run.get("color")))
        for t, f in _segments(text, _font_chain(src, run)):
            _, pen = tw.append(pen, t, font=f, fontsize=size)
    wr.flush()


def _image_bytes(ctx: Ctx, key: str) -> bytes | None:
    data = ctx.images.get(key)
    if not data:
        return None
    if isinstance(data, str):
        if data.startswith("data:"):
            data = data.split(",", 1)[1]
        data = base64.b64decode(data)
        ctx.images[key] = data
    return data


def draw_image(page: fitz.Page, o: dict, ctx: Ctx) -> None:
    key = o.get("img")
    data = _image_bytes(ctx, key)
    if not data:
        return
    x, y, w, h = (float(o[k]) for k in ("x", "y", "w", "h"))
    rot = int(round(float(o.get("rot", 0)))) % 360
    pts = [_rot_pt(x, y, dx, dy, rot) for dx, dy in ((0, 0), (w, 0), (0, h), (w, h))]
    rect = fitz.Rect(min(p.x for p in pts), min(p.y for p in pts),
                     max(p.x for p in pts), max(p.y for p in pts))
    rotate = (360 - rot) % 360
    xref = ctx.image_xrefs.get(key)
    if xref:
        page.insert_image(rect, xref=xref, rotate=rotate, keep_proportion=False)
    else:
        ctx.image_xrefs[key] = page.insert_image(rect, stream=data, rotate=rotate,
                                                 keep_proportion=False)


def draw_shape(page: fitz.Page, o: dict) -> None:
    t = o["type"]
    op = float(o.get("opacity", 1))
    sh = page.new_shape()
    if t == "whiteout":
        r = fitz.Rect(o["x"], o["y"], o["x"] + o["w"], o["y"] + o["h"])
        sh.draw_rect(r)
        sh.finish(color=None, fill=_rgb(o.get("fill") or o.get("color"), (1, 1, 1)), width=0)
        sh.commit()
        return
    stroke = _rgb(o["stroke"]) if o.get("stroke") else None
    fill = _rgb(o["fill"]) if o.get("fill") else None
    width = float(o.get("width", 2))
    if t in ("rect", "ellipse"):
        r = fitz.Rect(o["x"], o["y"], o["x"] + o["w"], o["y"] + o["h"])
        if stroke and width:  # keep the stroke inside the box like the on-screen preview
            r = r + (width / 2, width / 2, -width / 2, -width / 2)
        if t == "rect":
            sh.draw_rect(r)
        else:
            sh.draw_oval(r)
        sh.finish(color=stroke if width else None, fill=fill, width=width,
                  stroke_opacity=op, fill_opacity=op, lineJoin=1)
    elif t in ("line", "arrow"):
        p1 = fitz.Point(o["x1"], o["y1"])
        p2 = fitz.Point(o["x2"], o["y2"])
        if t == "arrow":
            vx, vy = p2.x - p1.x, p2.y - p1.y
            ln = math.hypot(vx, vy) or 1
            ux, uy = vx / ln, vy / ln
            head = max(width * 4, 8)
            base = fitz.Point(p2.x - ux * head, p2.y - uy * head)
            left = fitz.Point(base.x - uy * head * 0.5, base.y + ux * head * 0.5)
            right = fitz.Point(base.x + uy * head * 0.5, base.y - ux * head * 0.5)
            sh.draw_line(p1, fitz.Point(p2.x - ux * head * 0.8, p2.y - uy * head * 0.8))
            sh.finish(color=stroke, width=width, stroke_opacity=op, lineCap=1)
            sh.draw_polyline([left, p2, right, left])
            sh.finish(color=stroke, fill=stroke, width=0.5, stroke_opacity=op, fill_opacity=op,
                      closePath=True, lineJoin=1)
        else:
            sh.draw_line(p1, p2)
            sh.finish(color=stroke, width=width, stroke_opacity=op, lineCap=1)
    sh.commit()


def add_annotation(page: fitz.Page, o: dict) -> None:
    t = o["type"]
    color = _rgb(o.get("color"), (1, 0.85, 0))
    op = float(o.get("opacity", 1))
    annot = None
    if t in ("highlight", "underline", "strike"):
        rects = [fitz.Rect(r) for r in o.get("rects", []) if r]
        if not rects:
            return
        fn = {"highlight": page.add_highlight_annot, "underline": page.add_underline_annot,
              "strike": page.add_strikeout_annot}[t]
        annot = fn(quads=rects)
        annot.set_colors(stroke=color)
    elif t == "ink":
        paths = [[(float(x), float(y)) for x, y in p] for p in o.get("paths", []) if len(p) > 1]
        if not paths:
            return
        annot = page.add_ink_annot(paths)
        annot.set_colors(stroke=color)
        annot.set_border(width=float(o.get("width", 2)))
    elif t == "note":
        annot = page.add_text_annot((float(o["x"]), float(o["y"])), str(o.get("text", "")),
                                    icon="Comment")
        annot.set_colors(stroke=color)
        annot.set_info(title=o.get("author") or "")
    if annot is not None:
        if op < 1:
            annot.set_opacity(op)
        annot.update()


CONTENT = {"textedit", "text", "image", "whiteout", "rect", "ellipse", "line", "arrow"}
ANNOTS = {"highlight", "underline", "strike", "ink", "note"}


def _apply_page(page: fitz.Page, spec: dict, src: Source | None, ctx: Ctx) -> None:
    objs = spec.get("objects") or []
    hide = [o["hide"] for o in objs if o.get("type") == "textedit" and o.get("hide")]
    if any(o.get("type") in CONTENT for o in objs):
        # isolate the original content (q ... Q) so a transformation matrix
        # left open by the producing app can't distort what we draw on top
        try:
            page.wrap_contents()
        except Exception:  # noqa: BLE001
            pass
    if spec.get("fields"):
        _apply_fields(page, spec["fields"])
    if hide:
        remove_text(page, hide)
    for o in objs:
        t = o.get("type")
        try:
            if t == "textedit":
                draw_text_edit(page, o, src)
            elif t == "text":
                draw_text_box(page, o)
            elif t == "image":
                draw_image(page, o, ctx)
            elif t in ("whiteout", "rect", "ellipse", "line", "arrow"):
                draw_shape(page, o)
        except Exception as exc:  # noqa: BLE001
            print("object failed:", t, exc)
    for o in objs:
        if o.get("type") in ANNOTS:
            try:
                add_annotation(page, o)
            except Exception as exc:  # noqa: BLE001
                print("annotation failed:", o.get("type"), exc)


def export(spec: dict) -> bytes:
    with LOCK:
        pages = spec.get("pages") or []
        if not pages:
            raise ValueError("Nothing to export: the document has no pages.")
        ctx_images = dict(spec.get("images") or {})
        base_id = next((p["doc"] for p in pages if p.get("doc")), None)
        if base_id:
            base = get(base_id)
            out = fitz.open("pdf", base.data)
            order, seen = [], set()
            for p in pages:
                if p.get("doc") == base_id and p["index"] not in seen:
                    seen.add(p["index"])
                    order.append(p["index"])
            out.select(order)
        else:
            out = fitz.open()

        placed: dict[int, int] = {}
        for k, p in enumerate(pages):
            at = k if k < out.page_count else -1
            if not p.get("doc"):
                out.new_page(pno=at, width=float(p.get("w", 595)), height=float(p.get("h", 842)))
            elif p["doc"] == base_id:
                idx = p["index"]
                if idx in placed:
                    out.fullcopy_page(placed[idx], at)
                else:
                    placed[idx] = k
            else:
                other = get(p["doc"])
                out.insert_pdf(other.doc, from_page=p["index"], to_page=p["index"], start_at=at)

        ctx = Ctx(out, ctx_images)
        for k, p in enumerate(pages):
            page = out[k]
            src = DOCS.get(p["doc"]) if p.get("doc") else None
            _apply_page(page, p, src, ctx)
            rot = int(p.get("rot", 0)) % 360
            if rot:
                page.set_rotation(rot)

        try:
            out.subset_fonts()
        except Exception as exc:  # noqa: BLE001
            print("font subsetting skipped:", exc)
        meta = dict(out.metadata or {})
        meta["producer"] = "Folio PDF Editor"
        meta["modDate"] = fitz.get_pdf_now()
        try:
            out.set_metadata({k: v for k, v in meta.items()
                              if k in ("title", "author", "subject", "keywords", "creator",
                                       "producer", "creationDate", "modDate")})
        except Exception:  # noqa: BLE001
            pass
        opts = spec.get("options") or {}
        kwargs = {"garbage": 3, "deflate": True}
        pw = opts.get("password")
        if pw:
            kwargs.update(encryption=fitz.PDF_ENCRYPT_AES_256, user_pw=pw,
                          owner_pw=opts.get("ownerPassword") or pw,
                          permissions=int(fitz.PDF_PERM_ACCESSIBILITY | fitz.PDF_PERM_PRINT
                                          | fitz.PDF_PERM_COPY | fitz.PDF_PERM_ANNOTATE))
        data = out.tobytes(**kwargs)
        out.close()
        return data
