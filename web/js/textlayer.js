// Original-text layer: fetches line/segment geometry from the server, shows the
// clickable boxes in "Edit text" mode and provides character-level selection
// for highlight / underline / strikethrough.
import { S, on, pageById, uid } from './state.js';
import { api } from './api.js';
import { views } from './viewer.js';

const cache = new Map(); // "doc:index" -> Promise<data>

export function getText(pageOrId) {
  const p = typeof pageOrId === 'string' ? pageById(pageOrId) : pageOrId;
  if (!p || !p.doc) return Promise.resolve(null);
  const key = `${p.doc}:${p.index}`;
  if (!cache.has(key)) {
    cache.set(key, api.text(p.doc, p.index).then(prepare).catch(() => { cache.delete(key); return null; }));
  }
  return cache.get(key);
}

function prepare(data) {
  // flatten characters in reading order for selection / search
  const chars = [];
  data.segments.forEach((s, si) => {
    s.start = chars.length;
    for (const r of s.runs) {
      for (let i = 0; i < r.t.length; i++) {
        chars.push({ s: si, c: r.t[i], x0: r.x[i], x1: r.x[i + 1] ?? r.x[i] });
      }
    }
    s.end = chars.length;
    s.text = s.runs.map((r) => r.t).join('');
  });
  data.chars = chars;
  return data;
}

// keep a synchronous handle on resolved data
const resolved = new Map();
export async function loadText(p) {
  const d = await getText(p);
  if (d && p) resolved.set(`${p.doc}:${p.index}`, d);
  return d;
}
export function textNow(p) {
  return p && p.doc ? resolved.get(`${p.doc}:${p.index}`) || null : null;
}

// ------------------------------------------------------------------ hit boxes
export async function renderHits(pageId) {
  const p = pageById(pageId);
  const v = views.get(pageId);
  if (!p || !v) return;
  if (S.tool !== 'edittext') { v.L.hit.textContent = ''; v.L.hit.dataset.k = ''; return; }
  const data = await loadText(p);
  if (!data) return;
  const used = new Set((S.objects[pageId] || []).filter((o) => o.type === 'textedit').map((o) => o.seg));
  const key = [...used].join('|');
  if (v.L.hit.dataset.k === key && v.L.hit.childElementCount) return;
  v.L.hit.dataset.k = key;
  const frag = document.createDocumentFragment();
  data.segments.forEach((s) => {
    if (used.has(s.id)) return;
    const d = document.createElement('div');
    d.className = 'tseg';
    d.dataset.seg = s.id;
    const [x0, y0, x1, y1] = s.bbox;
    d.style.cssText = `left:${x0}px;top:${y0}px;width:${x1 - x0}px;height:${y1 - y0}px`;
    frag.appendChild(d);
  });
  v.L.hit.textContent = '';
  v.L.hit.appendChild(frag);
}

export function renderAllHits() {
  for (const [id, v] of views) {
    if (S.tool === 'edittext') { if (v.visible) renderHits(id); else v.L.hit.dataset.k = '#'; }
    else if (v.L.hit.childElementCount) { v.L.hit.textContent = ''; v.L.hit.dataset.k = ''; }
  }
}

on('pagevisible', (id) => { if (S.tool === 'edittext') renderHits(id); });
on('objects', (id) => { if (S.tool === 'edittext') renderHits(id); });
on('restore', () => renderAllHits());

/** Build a textedit object from an original text segment. */
export function makeTextEdit(data, seg) {
  const runs = seg.runs.map((r) => {
    const f = data.fonts[r.f] || {};
    return {
      t: r.t, fid: f.fid ?? null, pf: f.browser ? f.fid : null,
      family: f.family || 'Arial', bold: !!r.b, italic: !!r.i, size: r.s, color: r.c,
    };
  });
  return {
    id: uid('te'), type: 'textedit', seg: seg.id, hide: seg.bbox.slice(),
    x: seg.runs[0].o[0], y: seg.runs[0].o[1], dx: 0, dy: 0,
    runs, orig: runs.map((r) => r.t).join(''),
  };
}

export function segById(data, id) {
  return data.segments.find((s) => s.id === id);
}

// ------------------------------------------------------------------ selection
/** Character index at a point; strict = only when actually over text. */
export function charAt(data, pt, strict) {
  if (!data || !data.chars.length) return -1;
  let best = null;
  let bestD = Infinity;
  for (const s of data.segments) {
    const [x0, y0, x1, y1] = s.bbox;
    const dy = pt.y < y0 ? y0 - pt.y : pt.y > y1 ? pt.y - y1 : 0;
    const dx = pt.x < x0 ? x0 - pt.x : pt.x > x1 ? pt.x - x1 : 0;
    const d = dy * 3 + dx;
    if (d < bestD) { bestD = d; best = s; }
  }
  if (!best || (strict && bestD > 2)) return -1;
  for (let i = best.start; i < best.end; i++) {
    const c = data.chars[i];
    if (pt.x < (c.x0 + c.x1) / 2) return i;
  }
  return best.end; // after last char of segment
}

/** Rectangles covering characters [a, b) grouped per segment. */
export function rangeRects(data, a, b) {
  if (a > b) [a, b] = [b, a];
  const rects = [];
  for (const s of data.segments) {
    const lo = Math.max(a, s.start);
    const hi = Math.min(b, s.end);
    if (hi <= lo) continue;
    const c0 = data.chars[lo];
    const c1 = data.chars[hi - 1];
    rects.push([c0.x0, s.bbox[1], c1.x1, s.bbox[3]]);
  }
  return rects;
}

export function rangeText(data, a, b) {
  if (a > b) [a, b] = [b, a];
  return data.chars.slice(a, b).map((c) => c.c).join('');
}
