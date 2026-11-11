// Page thumbnails + page organisation (reorder, rotate, delete, duplicate, insert).
import { S, on, emit, commit, uid } from './state.js';
import { api } from './api.js';
import { h, $, menu, toast, confirmDialog } from './ui.js';
import { icon, hydrateIcons } from './icons.js';
import { scrollToPage, syncPages } from './viewer.js';
import { renderAll } from './overlay.js';

const thumbsEl = $('#thumbs');
const thumbs = new Map();
let tio = null;
let anchorId = null;
let dragIds = null;
let handlers = {};
const TW = 150;
const TH = 190;

export function initSidebar(opts) {
  handlers = opts;
  tio = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const t = thumbs.get(e.target.dataset.pageId);
      if (t) { t.visible = e.isIntersecting; if (t.visible) loadThumb(t); }
    }
  }, { root: thumbsEl, rootMargin: '300px 0px' });

  thumbsEl.tabIndex = 0;
  thumbsEl.addEventListener('keydown', (e) => {
    if ((e.key === 'Delete' || e.key === 'Backspace') && S.pageSel.size) { e.preventDefault(); e.stopPropagation(); deletePages([...S.pageSel]); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); e.stopPropagation(); S.pageSel = new Set(S.pages.map((p) => p.id)); syncThumbs(); }
  });
  thumbsEl.addEventListener('dragover', onDragOver);
  thumbsEl.addEventListener('dragleave', (e) => { if (!thumbsEl.contains(e.relatedTarget)) clearDrop(); });
  thumbsEl.addEventListener('drop', onDrop);

  $('#sbSelbar').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const ids = [...S.pageSel];
    if (b.dataset.act === 'rotl') rotatePages(ids, -90);
    if (b.dataset.act === 'rotr') rotatePages(ids, 90);
    if (b.dataset.act === 'delete') deletePages(ids);
    if (b.dataset.act === 'extract') handlers.extract(ids);
  });
  $('#sbMenuBtn').addEventListener('click', (e) => {
    const sel = [...S.pageSel];
    menu(e.currentTarget, [
      { label: 'Rotate all pages right', icon: 'rotate-cw', onClick: () => rotatePages(S.pages.map((p) => p.id), 90) },
      { label: 'Rotate all pages left', icon: 'rotate-ccw', onClick: () => rotatePages(S.pages.map((p) => p.id), -90) },
      'sep',
      { label: 'Add blank page at end', icon: 'blank', onClick: () => insertBlank(S.pages.length) },
      { label: 'Insert PDF or image…', icon: 'file-plus', onClick: () => handlers.pickInsert(S.pages.length) },
      'sep',
      { label: 'Select all pages', icon: 'check', kbd: 'Ctrl+A', onClick: () => { S.pageSel = new Set(S.pages.map((p) => p.id)); syncThumbs(); } },
      { label: `Extract ${sel.length > 1 ? `${sel.length} selected pages` : 'selected page'}…`, icon: 'file-out', disabled: !sel.length, onClick: () => handlers.extract(sel) },
      { label: 'Delete selected pages', icon: 'trash', danger: true, disabled: !sel.length, onClick: () => deletePages(sel) },
    ], { align: 'end' });
  });
  $('#addBlankBtn').addEventListener('click', () => insertBlank(S.current + 1));
  $('#insertPdfBtn').addEventListener('click', () => handlers.pickInsert(S.current + 1));
}

// ------------------------------------------------------------------ rendering
function createThumb(p) {
  const img = h('img', { alt: '', draggable: 'false' });
  const pageBox = h('div', { class: 'th-page' }, img);
  const actions = h('div', { class: 'th-actions' },
    h('button', { class: 'icon-btn', 'data-tip': 'Rotate left', 'data-a': 'rotl', html: icon('rotate-ccw') }),
    h('button', { class: 'icon-btn', 'data-tip': 'Rotate right', 'data-a': 'rotr', html: icon('rotate-cw') }),
    h('button', { class: 'icon-btn', 'data-tip': 'More', 'data-a': 'more', html: icon('more') }),
    h('button', { class: 'icon-btn danger', 'data-tip': 'Delete page', 'data-a': 'del', html: icon('trash') }));
  const num = h('div', { class: 'th-num' });
  const el = h('div', { class: 'thumb', draggable: 'true', dataset: { pageId: p.id } }, h('div', { class: 'th-box' }, pageBox), actions, num);
  const t = { id: p.id, el, img, pageBox, num, visible: false, want: null };
  el.addEventListener('click', (e) => onThumbClick(e, t));
  el.addEventListener('contextmenu', (e) => { e.preventDefault(); thumbMenu(e, t); });
  actions.addEventListener('click', (e) => {
    const b = e.target.closest('[data-a]');
    if (!b) return;
    e.stopPropagation();
    const a = b.dataset.a;
    if (a === 'rotl') rotatePages([t.id], -90);
    if (a === 'rotr') rotatePages([t.id], 90);
    if (a === 'del') deletePages([t.id]);
    if (a === 'more') thumbMenu(b, t);
  });
  el.addEventListener('dragstart', (e) => {
    dragIds = S.pageSel.has(t.id) && S.pageSel.size > 1 ? S.pages.filter((p) => S.pageSel.has(p.id)).map((p) => p.id) : [t.id];
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/x-folio-pages', dragIds.join(','));
    requestAnimationFrame(() => dragIds.forEach((id) => thumbs.get(id)?.el.classList.add('dragging')));
  });
  el.addEventListener('dragend', () => {
    dragIds = null;
    thumbsEl.querySelectorAll('.dragging').forEach((x) => x.classList.remove('dragging'));
    clearDrop();
  });
  thumbs.set(p.id, t);
  tio.observe(el);
  return t;
}

function layoutThumb(p, t) {
  const side = p.rot % 180 !== 0;
  const dw = side ? p.h : p.w;
  const dh = side ? p.w : p.h;
  const s = Math.min(TW / dw, TH / dh);
  t.scale = s;
  Object.assign(t.pageBox.style, { width: `${dw * s}px`, height: `${dh * s}px` });
  Object.assign(t.img.style, {
    width: `${p.w * s}px`, height: `${p.h * s}px`,
    transform: `translate(-50%,-50%) rotate(${p.rot}deg)`,
    display: p.doc ? '' : 'none',
  });
}

function loadThumb(t) {
  const p = S.pages.find((x) => x.id === t.id);
  if (!p || !p.doc) return;
  const s = Math.min(2, Math.ceil(t.scale * (window.devicePixelRatio || 1) * 8) / 8);
  const url = api.renderUrl(p.doc, p.index, s, null, false, 'jpeg');
  if (t.want === url) return;
  t.want = url;
  t.img.src = url;
}

export function syncThumbs() {
  const ids = new Set(S.pages.map((p) => p.id));
  for (const [id, t] of thumbs) if (!ids.has(id)) { tio.unobserve(t.el); t.el.remove(); thumbs.delete(id); }
  for (const id of [...S.pageSel]) if (!ids.has(id)) S.pageSel.delete(id);
  S.pages.forEach((p, i) => {
    const t = thumbs.get(p.id) || createThumb(p);
    t.num.textContent = String(i + 1);
    t.el.classList.toggle('current', i === S.current);
    t.el.classList.toggle('selected', S.pageSel.has(p.id));
    if (thumbsEl.children[i] !== t.el) thumbsEl.insertBefore(t.el, thumbsEl.children[i] || null);
    layoutThumb(p, t);
    if (t.visible) loadThumb(t);
  });
  hydrateIcons(thumbsEl);
  $('#pageCount').textContent = `${S.pages.length}`;
  const n = S.pageSel.size;
  $('#sbSelbar').hidden = n < 2;
  $('#sbSelCount').textContent = `${n} selected`;
}

export function clearThumbs() {
  for (const t of thumbs.values()) { tio.unobserve(t.el); t.el.remove(); }
  thumbs.clear();
  S.pageSel.clear();
}

function onThumbClick(e, t) {
  const idx = S.pages.findIndex((p) => p.id === t.id);
  if (e.shiftKey && anchorId) {
    const a = S.pages.findIndex((p) => p.id === anchorId);
    const [lo, hi] = a < idx ? [a, idx] : [idx, a];
    S.pageSel = new Set(S.pages.slice(lo, hi + 1).map((p) => p.id));
  } else if (e.ctrlKey || e.metaKey) {
    if (S.pageSel.has(t.id)) S.pageSel.delete(t.id); else S.pageSel.add(t.id);
    anchorId = t.id;
  } else {
    S.pageSel = new Set([t.id]);
    anchorId = t.id;
    scrollToPage(idx);
  }
  thumbsEl.focus({ preventScroll: true });
  syncThumbs();
}

function thumbMenu(anchor, t) {
  const idx = S.pages.findIndex((p) => p.id === t.id);
  const target = anchor instanceof Event ? { left: anchor.clientX, right: anchor.clientX, top: anchor.clientY, bottom: anchor.clientY, width: 0, height: 0 } : anchor;
  const ids = S.pageSel.has(t.id) && S.pageSel.size > 1 ? [...S.pageSel] : [t.id];
  const many = ids.length > 1;
  menu(target, [
    { label: many ? `Rotate ${ids.length} pages right` : 'Rotate right', icon: 'rotate-cw', onClick: () => rotatePages(ids, 90) },
    { label: many ? `Rotate ${ids.length} pages left` : 'Rotate left', icon: 'rotate-ccw', onClick: () => rotatePages(ids, -90) },
    { label: many ? 'Duplicate pages' : 'Duplicate page', icon: 'copy', onClick: () => duplicatePages(ids) },
    'sep',
    { label: 'Insert blank page before', icon: 'blank', onClick: () => insertBlank(idx) },
    { label: 'Insert blank page after', icon: 'blank', onClick: () => insertBlank(idx + 1) },
    { label: 'Insert PDF or image after…', icon: 'file-plus', onClick: () => handlers.pickInsert(idx + 1) },
    'sep',
    { label: many ? `Extract ${ids.length} pages…` : 'Extract page…', icon: 'file-out', onClick: () => handlers.extract(ids) },
    { label: many ? `Delete ${ids.length} pages` : 'Delete page', icon: 'trash', danger: true, onClick: () => deletePages(ids) },
  ]);
}

// ------------------------------------------------------------------ drag & drop
let dropIndex = -1;
function clearDrop() {
  thumbsEl.querySelectorAll('.drop-before,.drop-after').forEach((x) => x.classList.remove('drop-before', 'drop-after'));
  dropIndex = -1;
}

function onDragOver(e) {
  const isPages = !!dragIds;
  const isFiles = [...(e.dataTransfer?.types || [])].includes('Files');
  if (!isPages && !isFiles) return;
  e.preventDefault();
  e.stopPropagation();
  e.dataTransfer.dropEffect = isPages ? 'move' : 'copy';
  clearDrop();
  const els = [...thumbsEl.children];
  if (!els.length) { dropIndex = 0; return; }
  let idx = els.length;
  for (let i = 0; i < els.length; i++) {
    const r = els[i].getBoundingClientRect();
    if (e.clientY < r.top + r.height / 2) { idx = i; break; }
  }
  dropIndex = idx;
  if (idx < els.length) els[idx].classList.add('drop-before'); else els[els.length - 1].classList.add('drop-after');
}

function onDrop(e) {
  const idx = dropIndex;
  clearDrop();
  if (dragIds) {
    e.preventDefault();
    e.stopPropagation();
    movePages(dragIds, idx);
    return;
  }
  const files = [...(e.dataTransfer?.files || [])];
  if (files.length) {
    e.preventDefault();
    e.stopPropagation();
    handlers.insertFiles(files, idx < 0 ? S.pages.length : idx);
  }
}

// ------------------------------------------------------------------ page operations
function afterPagesChanged() {
  syncPages();
  renderAll();
  syncThumbs();
  commit();
  emit('pages');
}

export function rotatePages(ids, delta) {
  if (!ids.length) return;
  for (const p of S.pages) if (ids.includes(p.id)) p.rot = (((p.rot + delta) % 360) + 360) % 360;
  afterPagesChanged();
}

export async function deletePages(ids) {
  if (!ids.length) return;
  if (ids.length >= S.pages.length) { toast('A document needs at least one page', 'err'); return; }
  if (ids.length > 1 && !(await confirmDialog('Delete pages', `Delete ${ids.length} pages from this document? You can undo this.`, 'Delete', true))) return;
  S.pages = S.pages.filter((p) => !ids.includes(p.id));
  ids.forEach((id) => { delete S.objects[id]; delete S.fields[id]; S.pageSel.delete(id); });
  afterPagesChanged();
  toast(ids.length > 1 ? `${ids.length} pages deleted` : 'Page deleted', 'ok', 1800);
}

export function movePages(ids, toIndex) {
  const moving = S.pages.filter((p) => ids.includes(p.id));
  let idx = toIndex;
  for (const p of moving) if (S.pages.indexOf(p) < toIndex) idx -= 1;
  const rest = S.pages.filter((p) => !ids.includes(p.id));
  rest.splice(Math.max(0, Math.min(idx, rest.length)), 0, ...moving);
  if (rest.every((p, i) => p === S.pages[i])) return;
  S.pages = rest;
  afterPagesChanged();
}

export function duplicatePages(ids) {
  const out = [];
  for (const p of S.pages) {
    out.push(p);
    if (ids.includes(p.id)) {
      const np = { ...p, id: uid('p') };
      S.objects[np.id] = (S.objects[p.id] || []).map((o) => ({ ...JSON.parse(JSON.stringify(o)), id: uid('d') }));
      if (S.fields[p.id]) S.fields[np.id] = { ...S.fields[p.id] };
      out.push(np);
    }
  }
  S.pages = out;
  afterPagesChanged();
}

export function insertBlank(at) {
  const ref = S.pages[Math.min(at, S.pages.length - 1)] || S.pages[0];
  const w = ref ? (ref.rot % 180 ? ref.h : ref.w) : 595.28;
  const hgt = ref ? (ref.rot % 180 ? ref.w : ref.h) : 841.89;
  const p = { id: uid('p'), doc: null, index: 0, w, h: hgt, rot: 0 };
  S.pages.splice(at, 0, p);
  afterPagesChanged();
  requestAnimationFrame(() => scrollToPage(at));
}

export function insertPages(info, at) {
  const add = info.pages.map((pg, i) => ({ id: uid('p'), doc: info.id, index: i, w: pg.w, h: pg.h, rot: 0 }));
  S.pages.splice(at, 0, ...add);
  afterPagesChanged();
  requestAnimationFrame(() => scrollToPage(at));
}

on('current', () => {
  S.pages.forEach((p, i) => thumbs.get(p.id)?.el.classList.toggle('current', i === S.current));
  const t = S.pages[S.current] && thumbs.get(S.pages[S.current].id);
  if (t) {
    const r = t.el.getBoundingClientRect();
    const sr = thumbsEl.getBoundingClientRect();
    if (r.top < sr.top || r.bottom > sr.bottom) t.el.scrollIntoView({ block: 'nearest' });
  }
});
