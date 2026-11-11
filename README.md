# Folio PDF Editor

A free, local PDF editor that runs in your browser. Your files never leave this computer.

## Start it

Double-click **Folio PDF Editor** on the desktop (also in the Start menu). The editor opens in its own window within about a second. You can also **drop a PDF onto the shortcut** to open it straight away.

There is nothing to start or stop by hand: the shortcut starts a small background server, and that server shuts itself down a few minutes after you close the last editor window.

If you move this folder or set up a new PC, run `Setup.bat` once. It creates the Python environment, installs PyMuPDF and recreates the shortcuts. It needs Python 3.10 or newer.

## What it can do

| Area | Features |
|---|---|
| **Edit text** | Click any line of existing text to rewrite it. The original font is reused when the PDF embeds the needed letters; otherwise the closest installed font is used. Bold and italic words inside a line are kept. You can drag lines to move them, delete them, and change their font, size and colour. |
| **Add text** | Click anywhere to type. You can use **every font installed on Windows** (with search and live previews), any size, bold, italic, underline, colour, alignment and multiple lines. |
| **Comment** | Highlight, underline and strike out by dragging across text. Highlight can also cover any area. You can add sticky-note comments. These are saved as standard PDF annotations. |
| **Draw** | Freehand pen, rectangles, ellipses, lines and arrows, with adjustable stroke, fill, width and opacity. |
| **Whiteout** | Cover anything with a white (or any colour) box. |
| **Images & signatures** | Insert PNG/JPG images, or paste them with Ctrl+V. You can draw, type or upload a signature, and saved signatures can be reused. |
| **Forms** | Fill in existing PDF form fields: text, check boxes, radio buttons and drop-downs. |
| **Pages** | Thumbnails with drag-to-reorder. You can rotate, delete, duplicate and extract pages, insert blank pages, and merge other PDFs or images. |
| **Find** | Search the whole document with Ctrl+F. |
| **Save** | Download, use *Save as…* to pick a folder, or download a password-protected copy (AES-256). |
| **Comfort** | Undo/redo, zoom (Ctrl+wheel), fit width/page, dark mode, keyboard shortcuts (⌨ button in the top bar), and opening password-protected PDFs. |

Objects you add stay editable until you download. Select them with the **Select** tool (V) to move, resize, restyle, duplicate, layer or delete them.

## Settings

Optionally create `config.json` next to `launcher.pyw`:

```json
{ "port": 8765, "app_window": true, "browser": "auto" }
```

- `app_window: false` opens a normal browser tab instead of a standalone window.
- `browser` can be a full path to a Chromium-based browser (Edge, Chrome, Brave).

## Troubleshooting

- **Nothing opens:** look in `logs\server.log`, then run `Setup.bat` again.
- **Run it manually (for development):** `.venv\Scripts\python backend\server.py --no-idle-exit`, then open http://127.0.0.1:8765

## How it works

- `backend/`: Python standard-library HTTP server plus [PyMuPDF](https://pymupdf.readthedocs.io). It renders pages, extracts text with fonts and positions, fills forms, and builds the final PDF. Edited lines are removed with true redaction and re-typeset in the same place.
- `web/`: the editor UI, written in plain HTML/CSS/JavaScript modules with no build step.
- `launcher.pyw`: starts the server if needed and opens the window. The shortcut points to it.
