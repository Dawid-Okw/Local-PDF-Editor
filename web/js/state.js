// Central application state, events and undo history.

export const S = {
  docs: {},        // docId -> {id, name, pages:[{w,h,fields}]}
  pages: [],       // [{id, doc, index, w, h, rot}]  (doc === null => blank page)
  objects: {},     // pageId -> [object]
  fields: {},      // pageId -> {fieldKey: value}
  images: {},      // imageId -> {url, w, h}
  fileName: '',
  tool: 'select',
  shape: 'rect',
  sel: null,       // {pageId, id}
  editing: null,   // {pageId, id}
  zoom: 1,
  current: 0,
  dirty: false,
  placing: null,   // {imgId, w, h}
  pageSel: new Set(),
  opts: loadOpts(),
};

function loadOpts() {
  const def = {
    text: { family: 'Arial', size: 14, color: '#111827', bold: false, italic: false, underline: false, align: 'left' },
    highlight: { color: '#fde047', opacity: 0.5 },
    underline: { color: '#2563eb', opacity: 1 },
    strike: { color: '#dc2626', opacity: 1 },
    draw: { color: '#2563eb', width: 2.5, opacity: 1 },
    shape: { stroke: '#dc2626', fill: null, width: 2, opacity: 1 },
    whiteout: { fill: '#ffffff' },
    note: { color: '#facc15' },
  };
  try {
    const saved = JSON.parse(localStorage.getItem('folio.opts') || '{}');
    for (const k of Object.keys(def)) Object.assign(def[k], saved[k] || {});
  } catch (e) { /* ignore */ }
  return def;
}
let saveTimer = 0;
export function saveOpts() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem('folio.opts', JSON.stringify(S.opts)); } catch (e) { /* ignore */ }
  }, 300);
}

// ------------------------------------------------------------------ events
const listeners = {};
export function on(evt, fn) { (listeners[evt] ||= []).push(fn); }
export function emit(evt, data) { (listeners[evt] || []).forEach((fn) => fn(data)); }

// ------------------------------------------------------------------ helpers
let counter = 0;
export function uid(prefix = 'o') {
  counter += 1;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}
export const pageById = (id) => S.pages.find((p) => p.id === id);
export const pageIndex = (id) => S.pages.findIndex((p) => p.id === id);
export const objs = (pageId) => (S.objects[pageId] ||= []);
export const findObj = (pageId, id) => (S.objects[pageId] || []).find((o) => o.id === id);
export function selectedObj() {
  return S.sel ? findObj(S.sel.pageId, S.sel.id) : null;
}
export function addObj(pageId, o) {
  objs(pageId).push(o);
  emit('objects', pageId);
  return o;
}
export function removeObj(pageId, id) {
  const list = objs(pageId);
  const i = list.findIndex((o) => o.id === id);
  if (i >= 0) list.splice(i, 1);
  if (S.sel && S.sel.id === id) S.sel = null;
  if (S.editing && S.editing.id === id) S.editing = null;
  emit('objects', pageId);
  emit('selection');
}
export function select(pageId, id) {
  const changed = !S.sel || S.sel.id !== id;
  S.sel = id ? { pageId, id } : null;
  if (changed) emit('selection');
}

// ------------------------------------------------------------------ history
const H = { stack: [], i: -1 };
function snapshot() {
  return JSON.stringify({ pages: S.pages, objects: S.objects, fields: S.fields });
}
export function resetHistory() {
  H.stack = [snapshot()];
  H.i = 0;
  setDirty(false);
  emit('history');
}
export function commit() {
  const s = snapshot();
  if (s === H.stack[H.i]) return;
  H.stack.length = H.i + 1;
  H.stack.push(s);
  if (H.stack.length > 150) H.stack.shift();
  H.i = H.stack.length - 1;
  setDirty(true);
  emit('history');
}
function restore(s) {
  const o = JSON.parse(s);
  S.pages = o.pages;
  S.objects = o.objects;
  S.fields = o.fields;
  S.sel = null;
  S.editing = null;
  setDirty(true);
  emit('restore');
  emit('history');
}
export function undo() { if (H.i > 0) { H.i -= 1; restore(H.stack[H.i]); } }
export function redo() { if (H.i < H.stack.length - 1) { H.i += 1; restore(H.stack[H.i]); } }
export const canUndo = () => H.i > 0;
export const canRedo = () => H.i < H.stack.length - 1;
export function setDirty(v) {
  S.dirty = v;
  document.getElementById('app')?.classList.toggle('is-dirty', v);
}
