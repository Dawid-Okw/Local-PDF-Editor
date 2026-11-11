// Folio PDF Editor - application entry point.
import { S, on, emit, uid, resetHistory, undo, redo, canUndo, canRedo, commit, select, selectedObj, setDirty } from './state.js';
import { api } from './api.js';
import { hydrateIcons, icon } from './icons.js';
import { $, h, toast, busy, openModal, confirmDialog, passwordDialog, menu, initTooltips, isTyping, closePopover } from './ui.js';
import { loadFonts } from './fonts.js';
import {
  initViewer, syncPages, clearPages, initialZoom, setZoom, fitWidth, fitPage, scrollToPage, currentPageId, viewerEl, layoutAll,
} from './viewer.js';
import { renderAll, renderPage, endEdit, positionAllTextEdits, refreshSelection } from './overlay.js';
import {
  initTools, setTool, insertImageFile, registerImage, startPlacing, cancelPlacing, deleteSelected, nudgeSelected,
  copySelected, pasteObject, duplicateSelected,
} from './tools.js';
import { renderProps } from './props.js';
import { renderAllHits, loadText } from './textlayer.js';
import { initSidebar, syncThumbs, clearThumbs, insertPages, rotatePages } from './sidebar.js';
import { savePdf, protectDialog, extractPages, canSaveAs, pdfName } from './exporter.js';
import { initSearch, openSearch, closeSearch, searchOpen } from './search.js';
import { openSignature } from './signature.js';
import './fields.js';

const app = $('#app');

// ------------------------------------------------------------------ toolbar
const TOOLS = [
  { id: 'select', icon: 'select', label: 'Select', key: 'V' },
  { id: 'edittext', icon: 'edit-text', label: 'Edit text', key: 'E' },
  { id: 'text', icon: 'text', label: 'Add text', key: 'T' },
  'sep',
  { id: 'highlight', icon: 'highlight', label: 'Highlight', key: 'H' },
  { id: 'underline', icon: 'underline', label: 'Underline', key: 'U' },
  { id: 'strike', icon: 'strike', label: 'Strikeout', key: 'K' },
  { id: 'note', icon: 'note', label: 'Comment', key: 'C' },
  'sep',
  { id: 'draw', icon: 'draw', label: 'Draw', key: 'D' },
  { id: 'shape', icon: 'shapes', label: 'Shapes', key: 'R' },
  { id: 'whiteout', icon: 'whiteout', label: 'Whiteout', key: 'W' },
  'sep',
  { id: 'image', icon: 'image', label: 'Image', key: 'I', action: true },
  { id: 'signature', icon: 'signature', label: 'Sign', key: 'S', action: true },
];

function buildToolbar() {
  const tb = $('#toolbar');
  for (const t of TOOLS) {
    if (t === 'sep') { tb.append(h('span', { class: 'tool-sep' })); continue; }
    const b = h('button', { class: 'tool', dataset: { tool: t.id }, 'data-tip': `${t.label}  ${t.key}`, html: icon(t.icon) }, h('span', { text: t.label }));
    if (t.id === 'shape') b.append(h('i', { class: 'caret' }));
    b.addEventListener('click', () => runTool(t.id, b));
    tb.append(b);
  }
}

function runTool(id, btn) {
  if (id === 'image') { $('#imageInput').click(); return; }
  if (id === 'signature') { addSignature(); return; }
  if (id === 'shape' && S.tool === 'shape' && btn) {
    menu(btn, ['rect', 'ellipse', 'line', 'arrow'].map((s) => ({
      label: { rect: 'Rectangle', ellipse: 'Ellipse', line: 'Line', arrow: 'Arrow' }[s], icon: s, checked: S.shape === s,
      onClick: () => setTool('shape', s),
    })), { align: 'center' });
    return;
  }
  setTool(id);
}

function syncToolbar() {
  document.querySelectorAll('.tool').forEach((b) => b.classList.toggle('active', b.dataset.tool === S.tool));
  const shapeBtn = document.querySelector('.tool[data-tool="shape"] svg');
  if (shapeBtn) shapeBtn.outerHTML = icon(S.tool === 'shape' ? S.shape : 'shapes');
}

async function addSignature() {
  if (!S.pages.length) return;
  if (S.editing) endEdit();
  const url = await openSignature();
  if (!url) return;
  const info = await registerImage(url);
  let w = 170;
  let hh = (info.h / info.w) * w;
  if (hh > 64) { w *= 64 / hh; hh = 64; }
  startPlacing(info.id, w, hh);
  renderProps();
}

// ------------------------------------------------------------------ documents
async function uploadWithPassword(file, name) {
  try {
    return await api.upload(file, name);
  } catch (e) {
    if (!e.needsPassword) throw e;
    let msg = '';
    for (;;) {
      const pw = await passwordDialog(name, msg);
      if (pw == null) return null;
      try {
        return await api.unlock(e.pending, pw);
      } catch (e2) {
        if (!e2.badPassword) throw e2;
        msg = 'That password is not correct. Please try again.';
      }
    }
  }
}

export async function openFile(file) {
  if (!file) return;
  if (S.dirty && !(await confirmDialog('Discard changes?', 'The current document has unsaved changes. Open another file anyway?', 'Discard & open', true))) return;
  const done = busy(`Opening ${file.name}…`);
  try {
    const info = await uploadWithPassword(file, file.name);
    if (info) loadDocument(info);
  } catch (e) {
    toast(e.message || 'Could not open this file', 'err', 6000);
  } finally {
    done();
  }
}

function loadDocument(info) {
  closeSearch();
  closePopover();
  if (S.editing) endEdit();
  cancelPlacing();
  clearPages();
  clearThumbs();
  S.docs = { [info.id]: info };
  S.pages = info.pages.map((pg, i) => ({ id: uid('p'), doc: info.id, index: i, w: pg.w, h: pg.h, rot: 0 }));
  S.objects = {};
  S.fields = {};
  S.sel = null;
  S.editing = null;
  S.current = 0;
  S.fileName = info.name || 'document.pdf';
  $('#fileName').value = S.fileName;
  document.title = `${S.fileName} · Folio`;
  app.classList.remove('no-doc');
  initialZoom();
  syncPages();
  renderAll();
  syncThumbs();
  setTool(S.tool === 'shape' || S.tool === 'select' || S.tool === 'edittext' || S.tool === 'text' ? S.tool : 'select');
  resetHistory();
  viewerEl.scrollTop = 0;
  viewerEl.focus({ preventScroll: true });
  emit('current');
  renderProps();
}

async function insertFiles(files, at) {
  if (!S.pages.length) { openFile(files[0]); return; }
  let pos = at;
  for (const f of files) {
    const done = busy(`Adding ${f.name}…`);
    try {
      const info = await uploadWithPassword(f, f.name);
      if (info) {
        S.docs[info.id] = info;
        insertPages(info, pos);
        pos += info.pages.length;
        toast(`Added ${info.pages.length} page${info.pages.length > 1 ? 's' : ''} from ${f.name}`, 'ok');
      }
    } catch (e) {
      toast(e.message || `Could not add ${f.name}`, 'err', 6000);
    } finally {
      done();
    }
  }
}

let insertAt = 0;
function pickInsert(at) {
  insertAt = at;
  $('#insertInput').click();
}

// ------------------------------------------------------------------ download menu
function downloadMenu(anchor) {
  const sel = [...S.pageSel];
  menu(anchor, [
    { label: 'Download', icon: 'download', kbd: 'Ctrl+S', onClick: () => savePdf() },
    canSaveAs() && { label: 'Save as…', icon: 'folder', kbd: 'Ctrl+Shift+S', onClick: () => savePdf({ mode: 'saveas' }) },
    { label: 'Protect with password…', icon: 'lock', onClick: () => protectDialog() },
    'sep',
    { label: sel.length ? `Extract ${sel.length} selected page${sel.length > 1 ? 's' : ''}…` : 'Extract current page…', icon: 'file-out', onClick: () => extractPages(sel.length ? sel : [currentPageId()]) },
  ].filter(Boolean), { align: 'end' });
}

// ------------------------------------------------------------------ zoom pill
const ZOOMS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5, 6];
function zoomStep(dir) {
  const z = S.zoom;
  const next = dir > 0 ? ZOOMS.find((v) => v > z + 0.001) : [...ZOOMS].reverse().find((v) => v < z - 0.001);
  if (next) setZoom(next);
}

function initPill() {
  $('#zoomIn').addEventListener('click', () => zoomStep(1));
  $('#zoomOut').addEventListener('click', () => zoomStep(-1));
  $('#fitWidth').addEventListener('click', fitWidth);
  $('#fitPage').addEventListener('click', fitPage);
  $('#zoomVal').addEventListener('click', (e) => menu(e.currentTarget, [
    { label: 'Fit width', icon: 'fit-width', onClick: fitWidth },
    { label: 'Fit page', icon: 'fit-page', onClick: fitPage },
    'sep',
    ...[0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4].map((z) => ({ label: `${Math.round(z * 100)}%`, checked: Math.abs(S.zoom - z) < 0.005, onClick: () => setZoom(z) })),
  ], { align: 'center' }));
  $('#prevPage').addEventListener('click', () => scrollToPage(S.current - 1));
  $('#nextPage').addEventListener('click', () => scrollToPage(S.current + 1));
  const pi = $('#pageInput');
  pi.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { const n = parseInt(pi.value, 10); if (n) scrollToPage(n - 1); pi.blur(); }
    if (e.key === 'Escape') pi.blur();
  });
  pi.addEventListener('blur', () => { pi.value = String(S.current + 1); });
  $('#sbToggle').addEventListener('click', () => {
    $('#sidebar').classList.toggle('collapsed');
    $('#sbToggle').classList.toggle('active', !$('#sidebar').classList.contains('collapsed'));
  });
  $('#sbToggle').classList.add('active');
}

// ------------------------------------------------------------------ help
function showShortcuts() {
  const rows = [
    ['Tools'],
    ['Select', 'V'], ['Edit text', 'E'], ['Add text', 'T'], ['Highlight', 'H'], ['Underline', 'U'], ['Strikeout', 'K'],
    ['Comment', 'C'], ['Draw', 'D'], ['Shapes', 'R'], ['Whiteout', 'W'], ['Insert image', 'I'], ['Sign', 'S'],
    ['Editing'],
    ['Undo / redo', 'Ctrl+Z', 'Ctrl+Y'], ['Delete selection', 'Del'], ['Duplicate', 'Ctrl+D'], ['Copy / paste', 'Ctrl+C', 'Ctrl+V'],
    ['Nudge (×10 with Shift)', '←', '↑', '→', '↓'], ['Bold / italic / underline', 'Ctrl+B', 'Ctrl+I', 'Ctrl+U'], ['Finish editing', 'Esc'],
    ['Document'],
    ['Open', 'Ctrl+O'], ['Download', 'Ctrl+S'], ['Save as / protect', 'Ctrl+Shift+S'], ['Find', 'Ctrl+F'],
    ['Zoom in / out / 100%', 'Ctrl+', 'Ctrl−', 'Ctrl+0'], ['Zoom with mouse', 'Ctrl+Wheel'], ['First / last page', 'Home', 'End'],
  ];
  const grid = h('div', { class: 'kbd-grid' });
  for (const [label, ...keys] of rows) {
    if (!keys.length) { grid.append(h('h4', { text: label })); continue; }
    grid.append(h('span', { text: label }), h('span', { class: 'k' }, ...keys.map((k) => h('kbd', { text: k }))));
  }
  openModal({ title: 'Keyboard shortcuts', content: grid, actions: [{ label: 'Close', value: null, cls: 'btn-primary', primary: true }] });
}

function toggleTheme() {
  const dark = document.documentElement.dataset.theme !== 'dark';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  try { localStorage.setItem('folio.theme', dark ? 'dark' : 'light'); } catch (e) { /* ignore */ }
  syncThemeIcon();
}
function syncThemeIcon() {
  const b = $('#themeBtn');
  b.innerHTML = icon(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon');
}

// ------------------------------------------------------------------ keyboard
function onKey(e) {
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (document.querySelector('.modal-back')) return;
  if (mod && k === 'o') { e.preventDefault(); $('#fileInput').click(); return; }
  if (!S.pages.length) return;
  if (mod && k === 's') { e.preventDefault(); if (S.editing) endEdit(); if (e.shiftKey) downloadMenu($('#downloadMenuBtn')); else savePdf(); return; }
  if (mod && k === 'f') { e.preventDefault(); openSearch(); return; }
  if (mod && (k === '=' || k === '+')) { e.preventDefault(); zoomStep(1); return; }
  if (mod && (k === '-' || k === '_')) { e.preventDefault(); zoomStep(-1); return; }
  if (mod && k === '0') { e.preventDefault(); setZoom(1); return; }
  if (isTyping()) return;
  if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
  if (mod && k === 'y') { e.preventDefault(); redo(); return; }
  if (mod && k === 'd') { e.preventDefault(); duplicateSelected(); return; }
  if (mod && k === 'c') { if (copySelected()) e.preventDefault(); return; }
  if (mod && k === 'a') { e.preventDefault(); return; }
  if (e.key === 'Delete' || e.key === 'Backspace') { if (deleteSelected()) e.preventDefault(); return; }
  if (e.key === 'Escape') {
    if (S.placing) { cancelPlacing(); renderProps(); return; }
    if (searchOpen()) { closeSearch(); return; }
    if (S.sel) { select(null); return; }
    if (S.tool !== 'select') setTool('select');
    return;
  }
  if (e.key.startsWith('Arrow') && S.sel) {
    e.preventDefault();
    const d = e.shiftKey ? 10 : 1;
    nudgeSelected(e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0, e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0);
    return;
  }
  if (e.key === 'Home') { e.preventDefault(); scrollToPage(0); return; }
  if (e.key === 'End') { e.preventDefault(); scrollToPage(S.pages.length - 1); return; }
  if (mod || e.altKey) return;
  const t = TOOLS.find((x) => x !== 'sep' && x.key.toLowerCase() === k);
  if (t) { e.preventDefault(); runTool(t.id); }
}

async function onPaste(e) {
  if (isTyping() || !S.pages.length || document.querySelector('.modal-back')) return;
  const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
  if (files.length) { e.preventDefault(); insertImageFile(files[0]); return; }
  if (pasteObject()) e.preventDefault();
}

// ------------------------------------------------------------------ drag & drop of files
function initDrop() {
  let depth = 0;
  const overlay = $('#dropOverlay');
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  window.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; depth += 1; overlay.classList.add('show'); $('#dropZone')?.classList.add('over'); });
  window.addEventListener('dragleave', (e) => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) { overlay.classList.remove('show'); $('#dropZone')?.classList.remove('over'); } });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', async (e) => {
    depth = 0;
    overlay.classList.remove('show');
    $('#dropZone')?.classList.remove('over');
    if (e.defaultPrevented || !hasFiles(e)) return;
    e.preventDefault();
    const files = [...e.dataTransfer.files];
    if (!files.length) return;
    const pdfs = files.filter((f) => /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name));
    const images = files.filter((f) => f.type.startsWith('image/'));
    if (!S.pages.length) { openFile(pdfs[0] || images[0]); return; }
    if (!pdfs.length && images.length) { insertImageFile(images[0]); return; }
    const choice = await openModal({
      title: 'Open or combine?',
      content: h('p', { text: `What would you like to do with “${pdfs[0].name}”${pdfs.length > 1 ? ` and ${pdfs.length - 1} more` : ''}?` }),
      actions: [
        { label: 'Open instead', value: 'open', icon: 'folder' },
        { label: 'Add pages to this PDF', value: 'merge', cls: 'btn-primary', icon: 'file-plus', primary: true },
      ],
    });
    if (choice === 'open') openFile(pdfs[0]);
    if (choice === 'merge') insertFiles(pdfs, S.pages.length);
  });
}

// ------------------------------------------------------------------ wiring
function wire() {
  $('#openBtn').addEventListener('click', () => $('#fileInput').click());
  $('#emptyOpenBtn').addEventListener('click', () => $('#fileInput').click());
  $('#dropZone').addEventListener('click', (e) => { if (e.target === e.currentTarget) $('#fileInput').click(); });
  $('#fileInput').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; openFile(f); });
  $('#insertInput').addEventListener('change', (e) => { const fs = [...e.target.files]; e.target.value = ''; if (fs.length) insertFiles(fs, insertAt); });
  $('#imageInput').addEventListener('change', (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (f) insertImageFile(f).then(renderProps).catch(() => toast('This image format is not supported', 'err'));
  });
  $('#downloadBtn').addEventListener('click', () => { if (S.editing) endEdit(); savePdf(); });
  $('#downloadMenuBtn').addEventListener('click', (e) => { if (S.editing) endEdit(); downloadMenu(e.currentTarget); });
  $('#undoBtn').addEventListener('click', undo);
  $('#redoBtn').addEventListener('click', redo);
  $('#themeBtn').addEventListener('click', toggleTheme);
  $('#helpBtn').addEventListener('click', showShortcuts);
  $('#searchBtn').addEventListener('click', () => (searchOpen() ? closeSearch() : openSearch()));
  const fn = $('#fileName');
  fn.addEventListener('change', () => { S.fileName = pdfName(fn.value); fn.value = S.fileName; document.title = `${S.fileName} · Folio`; });
  fn.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' || e.key === 'Escape') fn.blur(); });

  document.addEventListener('keydown', onKey);
  document.addEventListener('paste', onPaste);
  window.addEventListener('beforeunload', (e) => { if (S.dirty) { e.preventDefault(); e.returnValue = ''; } });
  window.addEventListener('pagehide', () => api.bye());
  setInterval(() => api.heartbeat(), 20000);
  document.fonts.addEventListener('loadingdone', () => positionAllTextEdits());
  window.addEventListener('resize', () => { layoutAll(); });

  on('tool', () => { syncToolbar(); renderAllHits(); });
  on('history', () => {
    $('#undoBtn').disabled = !canUndo();
    $('#redoBtn').disabled = !canRedo();
  });
  on('zoom', () => { $('#zoomVal').textContent = `${Math.round(S.zoom * 100)}%`; });
  on('current', () => {
    $('#pageInput').value = String(S.current + 1);
    $('#pageTotal').textContent = String(S.pages.length);
  });
  on('pages', () => { $('#pageTotal').textContent = String(S.pages.length); });
  on('restore', () => {
    syncPages();
    renderAll();
    syncThumbs();
    renderAllHits();
    $('#pageTotal').textContent = String(S.pages.length);
  });
  on('pagevisible', (id) => {
    const p = S.pages.find((x) => x.id === id);
    if (p && p.doc) loadText(p);
  });
}

async function boot() {
  hydrateIcons(document);
  syncThemeIcon();
  buildToolbar();
  initTooltips();
  initViewer();
  initTools();
  initPill();
  initSearch();
  initSidebar({ insertFiles, pickInsert, extract: extractPages });
  initDrop();
  wire();
  syncToolbar();
  renderProps();
  emit('history');
  await loadFonts();
  const id = new URLSearchParams(location.search).get('doc');
  if (id) {
    history.replaceState(null, '', '/');
    try {
      const info = await api.doc(id);
      loadDocument(info);
    } catch (e) {
      toast('That file is no longer open. Please open it again.', 'err', 5000);
    }
  }
  api.heartbeat();
}

boot();
