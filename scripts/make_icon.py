"""Builds assets/icon.ico (multi-resolution) for the desktop shortcut."""
import os
import struct

import pymupdf as fitz

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "icon.ico")


def draw(size: int) -> bytes:
    doc = fitz.open()
    page = doc.new_page(width=64, height=64)
    # rounded square with a vertical-ish gradient made of thin bands
    top, bottom = (0x7b, 0x6c, 0xff), (0x46, 0x36, 0xd6)
    clip = page.new_shape()
    steps = 48
    for i in range(steps):
        t = i / (steps - 1)
        col = tuple((top[k] + (bottom[k] - top[k]) * t) / 255 for k in range(3))
        y0 = 2 + 60 * i / steps
        clip.draw_rect(fitz.Rect(2, y0, 62, y0 + 60 / steps + 0.4))
        clip.finish(fill=col, color=None, width=0)
    clip.commit()
    # document glyph (rounded corners of the tile are applied via alpha below)
    s = page.new_shape()
    s.draw_polyline([(21, 15), (37.5, 15), (47, 24.5), (47, 46), (44, 49.5), (21, 49.5), (17.5, 46), (17.5, 18.5), (21, 15)])
    s.finish(fill=(1, 1, 1), color=(1, 1, 1), width=1.2, closePath=True, lineJoin=1)
    s.draw_polyline([(37, 15), (37, 22.5), (39, 24.5), (47, 24.5)])
    s.finish(color=(0.79, 0.76, 1), width=2.4, lineJoin=1)
    s.draw_polyline([(25, 39.5), (28.8, 38.6), (38.6, 28.8), (35.7, 25.9), (25.9, 35.7), (25, 39.5)])
    s.finish(fill=(0.357, 0.298, 0.94), color=(0.357, 0.298, 0.94), width=0.6, closePath=True, lineJoin=1)
    s.commit()
    pix = page.get_pixmap(matrix=fitz.Matrix(size / 64, size / 64), alpha=True)
    # round the tile's corners through the alpha channel
    w, h = pix.width, pix.height
    samples = bytearray(pix.samples)
    n = pix.n
    rad = 15 * size / 64
    for y in range(h):
        for x in range(w):
            dx = max(rad - x - 0.5 + 2 * size / 64, x + 0.5 - (w - rad - 2 * size / 64), 0)
            dy = max(rad - y - 0.5 + 2 * size / 64, y + 0.5 - (h - rad - 2 * size / 64), 0)
            inset = 2 * size / 64
            outside = x < inset or y < inset or x >= w - inset or y >= h - inset
            d = (dx * dx + dy * dy) ** 0.5
            a = 0 if outside else max(0.0, min(1.0, rad - d + 0.5)) if (dx and dy) else 1.0
            i = (y * w + x) * n
            samples[i + 3] = int(samples[i + 3] * a)
    pix = fitz.Pixmap(fitz.csRGB, w, h, bytes(samples), True)
    return pix.tobytes("png")


def main() -> None:
    sizes = [16, 24, 32, 48, 64, 128, 256]
    images = [draw(s) for s in sizes]
    header = struct.pack("<HHH", 0, 1, len(sizes))
    offset = 6 + 16 * len(sizes)
    entries = b""
    for s, data in zip(sizes, images):
        entries += struct.pack("<BBBBHHII", s % 256, s % 256, 0, 0, 1, 32, len(data), offset)
        offset += len(data)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "wb") as fh:
        fh.write(header + entries + b"".join(images))
    with open(os.path.join(os.path.dirname(OUT), "icon-256.png"), "wb") as fh:
        fh.write(images[-1])
    print("wrote", OUT)


if __name__ == "__main__":
    main()
