// Pointer interaction for every tool.
import { S, on, emit, findObj, addObj, removeObj, select, commit, uid, pageById, objs, selectedObj } from './state.js';
import { views, clientToPage, pageAtPoint, currentPageId, visibleCenter, K } from './viewer.js';
import { renderPage, renderObj, beginEdit, endEdit, elFor, bbox, TEXT_LH } from './overlay.js';
import { loadText, textNow, makeTextEdit, segById, charAt, rangeRects } from './textlayer.js';
import { getFamily, defaultFamily } from './fonts.js';
import { h, popover, closePopover, toast } from './ui.js';
import { icon } from './icons.js';

const pagesEl = document.getElementById('pages');
const app = document.getElementById('app');
const TOOL_CLASS = ['select', 'edittext', 'text', 'highlight', 'underline', 'strike', 'draw', 'shape', 'whiteout', 'note'];

export function initTools() {
  pagesEl.addEventListener('pointerdown', onDown);
  pagesEl.addEventListener('dblclick', onDbl);
  pagesEl.addEventListener('pointermove', onHover);
  pagesEl.addEventListener('pointerleave', () => clearGhost());
  applyToolClass();
}

export function setTool(t, shape) {
  if (S.editing) endEdit();
  closePopover();
  S.tool = t;
  if (shape) S.shape = shape;
  if (S.placing) { S.placing = null; clearGhost(); }
  if (t !== 'select' && S.sel) select(null);
  applyToolClass();
  emit('tool');
}

function applyToolClass() {
  for (const c of TOOL_CLASS) app.classList.toggle(`t-${c}`, S.tool === c);
  app.classList.toggle('placing', !!S.placing);
}

// ------------------------------------------------------------------ helpers
function track(e, move, up) {
  const id = e.pointerId;
  const mm = (ev) => {
    if (ev.pointerId !== id) return;
    const evs = ev.getCoalescedEvents ? ev.getCoalescedEvents() : [];
    move(ev, evs.length ? evs : [ev]);
  };
  const uu = (ev) => {
    if (ev.pointerId !== id) return;
    window.removeEventListener('pointermove', mm);
    window.removeEventListener('pointerup', uu);
    window.removeEventListener('pointercancel', uu);
    up(ev);
  };
  window.addEventListener('pointermove', mm);
  window.addEventListener('pointerup', uu);
  window.addEventListener('pointercancel', uu);
}

const dist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
const clone = (o) => JSON.parse(JSON.stringify(o));

function rotOf(pageId) {
  const p = pageById(pageId);
  return p ? (360 - (p.rot % 360)) % 360 : 0;
}

function rotVec(x, y, deg) {
  const a = (deg * Math.PI) / 180;
  const c = Math.round(Math.cos(a) * 1e9) / 1e9;
  const s = Math.round(Math.sin(a) * 1e9) / 1e9;
  return { x: x * c - y * s, y: x * s + y * c };
}

function moveObj(o, orig, dx, dy) {
  switch (o.type) {
    case 'textedit': o.dx = orig.dx + dx; o.dy = orig.dy + dy; break;
    case 'line': case 'arrow':
      o.x1 = orig.x1 + dx; o.y1 = orig.y1 + dy; o.x2 = orig.x2 + dx; o.y2 = orig.y2 + dy; break;
    case 'ink': o.paths = orig.paths.map((p) => p.map(([x, y]) => [x + dx, y + dy])); break;
    case 'highlight': case 'underline': case 'strike':
      o.rects = orig.rects.map((r) => [r[0] + dx, r[1] + dy, r[2] + dx, r[3] + dy]); break;
    default: o.x = orig.x + dx; o.y = orig.y + dy;
  }
}

function startMove(e, pageId, o, onClick) {
  const start = clientToPage(pageId, e.clientX, e.clientY);
  const orig = clone(o);
  let moved = false;
  track(e, (ev) => {
    if (!moved && dist(ev, e) < 4) return;
    if (!moved && S.editing && S.editing.id === o.id) endEdit();
    moved = true;
    const cur = clientToPage(pageId, ev.clientX, ev.clientY);
    let dx = cur.x - start.x;
    let dy = cur.y - start.y;
    if (ev.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
    moveObj(o, orig, dx, dy);
    renderObj(pageId, o);
  }, (ev) => {
    if (moved) { commit(); emit('objchange'); } else if (onClick) onClick(ev);
  });
}

function startResize(e, pageId, o, hd) {
  const start = clientToPage(pageId, e.clientX, e.clientY);
  const orig = clone(o);
  const ob = bbox(orig);
  track(e, (ev) => {
    const cur = clientToPage(pageId, ev.clientX, ev.clientY);
    if (hd === 'p1' || hd === 'p2') {
      const fx = hd === 'p1' ? orig.x2 : orig.x1;
      const fy = hd === 'p1' ? orig.y2 : orig.y1;
      let { x, y } = cur;
      if (ev.shiftKey) {
        const ang = Math.round(Math.atan2(y - fy, x - fx) / (Math.PI / 4)) * (Math.PI / 4);
        const len = Math.hypot(x - fx, y - fy);
        x = fx + Math.cos(ang) * len;
        y = fy + Math.sin(ang) * len;
      }
      if (hd === 'p1') { o.x1 = x; o.y1 = y; } else { o.x2 = x; o.y2 = y; }
      renderObj(pageId, o);
      return;
    }
    const rot = o.type === 'ink' ? 0 : (orig.rot || 0);
    const d = rotVec(cur.x - start.x, cur.y - start.y, -rot);
    const W = o.type === 'ink' ? ob.w : orig.w;
    const H = o.type === 'ink' ? ob.h : orig.h;
    let x0 = 0; let y0 = 0; let x1 = W; let y1 = H;
    if (hd.includes('w')) x0 += d.x;
    if (hd.includes('e')) x1 += d.x;
    if (hd.includes('n')) y0 += d.y;
    if (hd.includes('s')) y1 += d.y;
    const keep = (o.type === 'image' || o.type === 'ink') !== ev.shiftKey;
    if (keep && hd.length === 2 && W > 0 && H > 0) {
      const ratio = W / H;
      const w = x1 - x0; const hh = y1 - y0;
      if (Math.abs(w / ratio) > Math.abs(hh)) {
        const nh = w / ratio;
        if (hd.includes('n')) y0 = y1 - nh; else y1 = y0 + nh;
      } else {
        const nw = hh * ratio;
        if (hd.includes('w')) x0 = x1 - nw; else x1 = x0 + nw;
      }
    }
    const min = 3;
    if (x1 - x0 < min) { if (hd.includes('w')) x0 = x1 - min; else x1 = x0 + min; }
    if (y1 - y0 < min) { if (hd.includes('n')) y0 = y1 - min; else y1 = y0 + min; }
    if (o.type === 'ink') {
      const sx = (x1 - x0) / (ob.w || 1);
      const sy = (y1 - y0) / (ob.h || 1);
      o.paths = orig.paths.map((p) => p.map(([x, y]) => [ob.x + x0 + (x - ob.x) * sx, ob.y + y0 + (y - ob.y) * sy]));
    } else {
      const a = rotVec(x0, y0, rot);
      o.x = orig.x + a.x;
      o.y = orig.y + a.y;
      o.w = x1 - x0;
      o.h = y1 - y0;
    }
    renderObj(pageId, o);
  }, () => { commit(); emit('objchange'); });
}

// ------------------------------------------------------------------ dispatch
function onDown(e) {
  if (e.button !== 0) return;
  const wrap = e.target.closest('.page-wrap');
  if (!wrap) return;
  const pageId = wrap.dataset.pageId;
  if (S.editing) {
    const ed = elFor(S.editing.id);
    if (ed && ed.contains(e.target) && !e.target.closest('[data-h]')) return; // caret / selection
  }
  if (e.target.closest('.field')) { if (S.sel) select(null); return; }
  const pt = clientToPage(pageId, e.clientX, e.clientY);
  lastLine = null;
  if (S.placing) { e.preventDefault(); placeImage(pageId, pt); return; }
  const handle = e.target.closest('[data-h]');
  const objEl = e.target.closest('[data-oid]');
  const o = objEl ? findObj(pageId, objEl.dataset.oid) : null;
  if (S.editing && (!o || o.id !== S.editing.id)) {
    const wasText = S.tool === 'text';
    endEdit();
    if (wasText && !o) { e.preventDefault(); return; }
  }
  switch (S.tool) {
    case 'select': return selectDown(e, pageId, pt, o, handle);
    case 'edittext': return editTextDown(e, pageId, pt, o, handle);
    case 'text': return textDown(e, pageId, pt, o, handle);
    case 'highlight': case 'underline': case 'strike': return markDown(e, pageId, pt);
    case 'draw': return drawDown(e, pageId, pt);
    case 'shape': return shapeDown(e, pageId, pt, S.shape);
    case 'whiteout': return shapeDown(e, pageId, pt, 'whiteout');
    case 'note': return noteDown(e, pageId, pt);
    default: return undefined;
  }
}

function onDbl(e) {
  const wrap = e.target.closest('.page-wrap');
  const objEl = e.target.closest('[data-oid]');
  if (!wrap || !objEl) return;
  const pageId = wrap.dataset.pageId;
  const o = findObj(pageId, objEl.dataset.oid);
  if (!o) return;
  if ((o.type === 'text' || o.type === 'textedit') && !S.editing) {
    beginEdit(pageId, o.id, { point: { x: e.clientX, y: e.clientY } });
  }
}

function selectDown(e, pageId, pt, o, handle) {
  if (!o) { select(null); return; }
  e.preventDefault();
  select(pageId, o.id);
  if (handle && handle.dataset.h !== 'move') { startResize(e, pageId, o, handle.dataset.h); return; }
  startMove(e, pageId, o, () => {
    if (o.type === 'note') openNote(pageId, o);
  });
}

function editableText(o) { return o && (o.type === 'text' || o.type === 'textedit'); }

function editTextDown(e, pageId, pt, o, handle) {
  if (editableText(o)) {
    e.preventDefault();
    select(pageId, o.id);
    startMove(e, pageId, o, (ev) => beginEdit(pageId, o.id, { point: { x: ev.clientX, y: ev.clientY } }));
    return;
  }
  const segEl = e.target.closest('.tseg');
  if (!segEl) { select(null); return; }
  e.preventDefault();
  const p = pageById(pageId);
  const data = textNow(p);
  const seg = data && segById(data, segEl.dataset.seg);
  if (!seg) return;
  const te = makeTextEdit(data, seg);
  let moved = false;
  const create = () => {
    if (findObj(pageId, te.id)) return;
    addObj(pageId, te);
    renderPage(pageId);
  };
  track(e, (ev) => {
    if (!moved && dist(ev, e) < 4) return;
    if (!moved) { create(); select(pageId, te.id); }
    moved = true;
    const cur = clientToPage(pageId, ev.clientX, ev.clientY);
    let dx = cur.x - pt.x; let dy = cur.y - pt.y;
    if (ev.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
    te.dx = dx; te.dy = dy;
    renderObj(pageId, te);
  }, () => {
    if (moved) { commit(); emit('objchange'); return; }
    create();
    requestAnimationFrame(() => beginEdit(pageId, te.id, { point: { x: e.clientX, y: e.clientY } }));
  });
}

function textDown(e, pageId, pt, o, handle) {
  if (editableText(o)) {
    e.preventDefault();
    select(pageId, o.id);
    startMove(e, pageId, o, (ev) => beginEdit(pageId, o.id, { point: { x: ev.clientX, y: ev.clientY } }));
    return;
  }
  e.preventDefault();
  const op = S.opts.text;
  const family = getFamily(op.family) ? op.family : defaultFamily();
  const rot = rotOf(pageId);
  const off = rotVec(-2, -op.size * TEXT_LH * 0.55, rot);
  const t = {
    id: uid('t'), type: 'text', x: pt.x + off.x, y: pt.y + off.y, rot, text: '',
    family, size: op.size, color: op.color, bold: op.bold, italic: op.italic,
    underline: op.underline, align: op.align, lh: TEXT_LH,
  };
  addObj(pageId, t);
  renderPage(pageId);
  requestAnimationFrame(() => beginEdit(pageId, t.id));
}

// ------------------------------------------------------------------ highlight / underline / strike
function markDown(e, pageId, pt) {
  e.preventDefault();
  select(null);
  const tool = S.tool;
  const p = pageById(pageId);
  const data = textNow(p);
  if (!data && p.doc) loadText(p);
  const ui = views.get(pageId).L.ui;
  const a = data ? charAt(data, pt, true) : -1;
  const op = S.opts[tool];
  if (a >= 0) {
    const prev = h('div', { class: 'preview-marks' });
    ui.append(prev);
    let b = a;
    const paint = () => {
      prev.textContent = '';
      for (const r of rangeRects(data, a, b)) {
        prev.append(h('i', { style: { left: `${r[0]}px`, top: `${r[1]}px`, width: `${r[2] - r[0]}px`, height: `${r[3] - r[1]}px` } }));
      }
    };
    track(e, (ev) => {
      const c = charAt(data, clientToPage(pageId, ev.clientX, ev.clientY), false);
      if (c >= 0) { b = c; paint(); }
    }, () => {
      prev.remove();
      const rects = rangeRects(data, a, b);
      if (!rects.length) return;
      addObj(pageId, { id: uid('m'), type: tool, rects, color: op.color, opacity: op.opacity });
      renderPage(pageId);
      commit();
    });
    return;
  }
  if (tool !== 'highlight') {
    toast(`Drag across text to ${tool === 'strike' ? 'strike it through' : 'underline it'}`, 'info', 2200);
    return;
  }
  dragBox(e, pageId, pt, (r) => {
    if (r.w < 3 || r.h < 3) return;
    addObj(pageId, { id: uid('m'), type: 'highlight', rects: [[r.x, r.y, r.x + r.w, r.y + r.h]], color: op.color, opacity: op.opacity });
    renderPage(pageId);
    commit();
  });
}

function dragBox(e, pageId, pt, done, mk) {
  const ui = views.get(pageId).L.ui;
  const box = h('div', { class: 'preview-box' });
  ui.append(box);
  let r = { x: pt.x, y: pt.y, w: 0, h: 0 };
  track(e, (ev) => {
    const c = clientToPage(pageId, ev.clientX, ev.clientY);
    let w = c.x - pt.x; let hh = c.y - pt.y;
    if (ev.shiftKey) { const m = Math.max(Math.abs(w), Math.abs(hh)); w = Math.sign(w || 1) * m; hh = Math.sign(hh || 1) * m; }
    r = { x: Math.min(pt.x, pt.x + w), y: Math.min(pt.y, pt.y + hh), w: Math.abs(w), h: Math.abs(hh) };
    if (mk) mk(box, r, pt, { x: pt.x + w, y: pt.y + hh });
    else Object.assign(box.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
  }, () => { box.remove(); done(r); });
}

// ------------------------------------------------------------------ freehand
function simplify(pts, eps) {
  if (pts.length < 3) return pts;
  const sq = (p, a, b) => {
    const dx = b[0] - a[0]; const dy = b[1] - a[1];
    const l = dx * dx + dy * dy;
    let t = l ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l : 0;
    t = Math.max(0, Math.min(1, t));
    const x = a[0] + t * dx - p[0]; const y = a[1] + t * dy - p[1];
    return x * x + y * y;
  };
  const keep = new Uint8Array(pts.length);
  keep[0] = 1; keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    let md = 0; let mi = -1;
    for (let k = i + 1; k < j; k++) { const d = sq(pts[k], pts[i], pts[j]); if (d > md) { md = d; mi = k; } }
    if (md > eps * eps && mi > 0) { keep[mi] = 1; stack.push([i, mi], [mi, j]); }
  }
  return pts.filter((_, i) => keep[i]).map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100]);
}

function drawDown(e, pageId, pt) {
  e.preventDefault();
  select(null);
  const op = S.opts.draw;
  const ui = views.get(pageId).L.ui;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const p = pageById(pageId);
  svg.setAttribute('width', p.w); svg.setAttribute('height', p.h);
  svg.style.cssText = 'position:absolute;left:0;top:0;overflow:visible';
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  Object.entries({ fill: 'none', stroke: op.color, 'stroke-width': op.width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: op.opacity })
    .forEach(([k, v]) => path.setAttribute(k, v));
  svg.append(path);
  ui.append(svg);
  const pts = [[pt.x, pt.y]];
  let d = `M${pt.x},${pt.y}`;
  track(e, (ev, evs) => {
    for (const ce of evs) {
      const c = clientToPage(pageId, ce.clientX, ce.clientY);
      pts.push([c.x, c.y]);
      d += ` L${c.x},${c.y}`;
    }
    path.setAttribute('d', d);
  }, () => {
    svg.remove();
    if (pts.length < 2) pts.push([pt.x + 0.6, pt.y + 0.6]);
    const simple = simplify(pts, 0.35);
    addObj(pageId, { id: uid('i'), type: 'ink', paths: [simple], color: op.color, width: op.width, opacity: op.opacity });
    renderPage(pageId);
    commit();
  });
}

// ------------------------------------------------------------------ shapes & whiteout
function shapeDown(e, pageId, pt, kind) {
  e.preventDefault();
  select(null);
  const op = kind === 'whiteout' ? S.opts.whiteout : S.opts.shape;
  const isLine = kind === 'line' || kind === 'arrow';
  const mk = isLine ? (box, r, a, b) => {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    Object.assign(box.style, { left: `${a.x}px`, top: `${a.y}px`, width: `${len}px`, height: '0px', transformOrigin: '0 0', transform: `rotate(${ang}rad)`, background: 'none' });
    box.dataset.end = JSON.stringify(b);
  } : null;
  let end = null;
  const done = (r) => {
    let o;
    const id = uid('s');
    if (isLine) {
      const tiny = Math.hypot(r.w, r.h) < 4;
      const b = end || { x: pt.x + 120, y: pt.y };
      o = { id, type: kind, x1: pt.x, y1: pt.y, x2: tiny ? pt.x + 120 : b.x, y2: tiny ? pt.y : b.y, stroke: op.stroke || '#dc2626', width: op.width, opacity: op.opacity };
    } else {
      if (r.w < 4 && r.h < 4) r = kind === 'whiteout' ? { x: pt.x - 40, y: pt.y - 9, w: 80, h: 18 } : { x: pt.x - 60, y: pt.y - 35, w: 120, h: 70 };
      o = kind === 'whiteout'
        ? { id, type: 'whiteout', ...r, fill: op.fill || '#ffffff' }
        : { id, type: kind, ...r, stroke: op.stroke, fill: op.fill, width: op.width, opacity: op.opacity };
    }
    addObj(pageId, o);
    renderPage(pageId);
    commit();
    if (kind !== 'whiteout') setTool('select');
    select(pageId, o.id);
  };
  if (isLine) {
    const ui = views.get(pageId).L.ui;
    const box = h('div', { class: 'preview-box' });
    ui.append(box);
    let w = 0; let hh = 0;
    track(e, (ev) => {
      let c = clientToPage(pageId, ev.clientX, ev.clientY);
      if (ev.shiftKey) {
        const ang = Math.round(Math.atan2(c.y - pt.y, c.x - pt.x) / (Math.PI / 4)) * (Math.PI / 4);
        const len = Math.hypot(c.x - pt.x, c.y - pt.y);
        c = { x: pt.x + Math.cos(ang) * len, y: pt.y + Math.sin(ang) * len };
      }
      end = c; w = c.x - pt.x; hh = c.y - pt.y;
      mk(box, null, pt, c);
    }, () => { box.remove(); done({ w: Math.abs(w), h: Math.abs(hh) }); });
  } else {
    dragBox(e, pageId, pt, done);
  }
}

// ------------------------------------------------------------------ notes
function noteDown(e, pageId, pt) {
  e.preventDefault();
  select(null);
  const o = { id: uid('n'), type: 'note', x: pt.x - 4, y: pt.y - 4, rot: rotOf(pageId), text: '', color: S.opts.note.color };
  addObj(pageId, o);
  renderPage(pageId);
  commit();
  setTool('select');
  select(pageId, o.id);
  requestAnimationFrame(() => openNote(pageId, o, true));
}

export function openNote(pageId, o, isNew = false) {
  const el = elFor(o.id);
  if (!el) return;
  const ta = h('textarea', { placeholder: 'Write a comment…' });
  ta.value = o.text || '';
  const del = h('button', { class: 'btn btn-soft sm', html: icon('trash') }, 'Delete');
  const ok = h('button', { class: 'btn btn-primary sm' }, 'Done');
  const box = h('div', {}, ta, h('div', { class: 'row' }, del, h('div', { class: 'spacer' }), ok));
  let removed = false;
  el.classList.add('has-pop');
  const pop = popover(el, box, {
    cls: 'note-pop',
    onClose: () => {
      el.classList.remove('has-pop');
      if (removed) return;
      if (o.text !== ta.value) { o.text = ta.value; renderObj(pageId, o); commit(); }
    },
  });
  del.addEventListener('click', () => { removed = true; closePopover(); removeObj(pageId, o.id); renderPage(pageId); commit(); });
  ok.addEventListener('click', () => closePopover());
  ta.addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) closePopover();
  });
  setTimeout(() => ta.focus(), 20);
  return pop;
}

// ------------------------------------------------------------------ images & placement
let ghost = null;
function clearGhost() { if (ghost) { ghost.remove(); ghost = null; } }

export function startPlacing(imgId, w, hgt) {
  if (S.editing) endEdit();
  select(null);
  S.placing = { img: imgId, w, h: hgt };
  applyToolClass();
  toast('Click on a page to place it  ·  Esc to cancel', 'info', 3000);
}

export function cancelPlacing() {
  S.placing = null;
  clearGhost();
  applyToolClass();
}

function onHover(e) {
  if (!S.placing) return;
  const pageId = pageAtPoint(e.clientX, e.clientY);
  if (!pageId) { clearGhost(); return; }
  const pt = clientToPage(pageId, e.clientX, e.clientY);
  const ui = views.get(pageId).L.ui;
  if (!ghost || ghost.parentNode !== ui) {
    clearGhost();
    ghost = h('div', { class: 'ghost' }, h('img', { src: S.images[S.placing.img]?.url, alt: '' }));
    ui.append(ghost);
  }
  const rot = rotOf(pageId);
  const { w, h: hh } = S.placing;
  const c = rotVec(w / 2, hh / 2, rot);
  Object.assign(ghost.style, { left: `${pt.x - c.x}px`, top: `${pt.y - c.y}px`, width: `${w}px`, height: `${hh}px`, transform: rot ? `rotate(${rot}deg)` : '' });
}

function placeImage(pageId, pt) {
  const { img, w, h: hh } = S.placing;
  const rot = rotOf(pageId);
  const c = rotVec(w / 2, hh / 2, rot);
  const o = { id: uid('img'), type: 'image', x: pt.x - c.x, y: pt.y - c.y, w, h: hh, rot, img };
  cancelPlacing();
  addObj(pageId, o);
  renderPage(pageId);
  commit();
  if (S.tool !== 'select') setTool('select');
  select(pageId, o.id);
}

/** Register an image (data URL) and return {id, w, h} natural size in pt. */
export function registerImage(url) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => {
      const id = uid('im');
      S.images[id] = { url, w: im.naturalWidth, h: im.naturalHeight };
      resolve({ id, w: im.naturalWidth, h: im.naturalHeight });
    };
    im.onerror = () => reject(new Error('Unsupported image'));
    im.src = url;
  });
}

export async function insertImageFile(file) {
  if (!S.pages.length) return;
  const url = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
  let pngUrl = url;
  if (!/^data:image\/(png|jpe?g)/i.test(url)) pngUrl = await toPng(url);
  const info = await registerImage(pngUrl);
  const p = pageById(currentPageId());
  const maxW = (p.rot % 180 ? p.h : p.w) * 0.5;
  let w = info.w * 0.75;
  let hh = info.h * 0.75;
  if (w > maxW) { hh *= maxW / w; w = maxW; }
  startPlacing(info.id, w, hh);
}

function toPng(url) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => {
      const c = document.createElement('canvas');
      c.width = im.naturalWidth; c.height = im.naturalHeight;
      c.getContext('2d').drawImage(im, 0, 0);
      res(c.toDataURL('image/png'));
    };
    im.onerror = rej;
    im.src = url;
  });
}

// ------------------------------------------------------------------ object commands
export function deleteSelected() {
  const o = selectedObj();
  if (!o) {
    // a line of original text that was clicked (and left unchanged) just before
    const last = lastLine;
    if (!last || S.tool !== 'edittext') return false;
    lastLine = null;
    addObj(last.pageId, { ...last.obj, runs: [], styled: true });
    renderPage(last.pageId);
    commit();
    return true;
  }
  const pageId = S.sel.pageId;
  if (o.type === 'textedit') {
    if (S.editing && S.editing.id === o.id) {
      elFor(o.id).querySelector('.tx').textContent = '';
      endEdit();
    }
    o.runs = [];
    o.styled = true;
    if (!findObj(pageId, o.id)) addObj(pageId, o);
    renderPage(pageId);
    select(null);
  } else {
    if (S.editing) endEdit();
    removeObj(pageId, o.id);
    renderPage(pageId);
  }
  commit();
  return true;
}

export function nudgeSelected(dx, dy) {
  const o = selectedObj();
  if (!o || S.editing) return false;
  moveObj(o, clone(o), dx, dy);
  renderObj(S.sel.pageId, o);
  commit();
  return true;
}

let clipboard = null;
export function copySelected() {
  const o = selectedObj();
  if (!o || o.type === 'textedit') return false;
  clipboard = clone(o);
  return true;
}

export function pasteObject() {
  if (!clipboard) return false;
  const pageId = S.sel ? S.sel.pageId : currentPageId();
  const o = clone(clipboard);
  o.id = uid('c');
  moveObj(o, clone(o), 12, 12);
  clipboard = clone(o);
  addObj(pageId, o);
  renderPage(pageId);
  commit();
  if (S.tool !== 'select') setTool('select');
  select(pageId, o.id);
  return true;
}

export function duplicateSelected() {
  if (!copySelected()) return false;
  return pasteObject();
}

export function arrange(dir) {
  const o = selectedObj();
  if (!o) return;
  const list = objs(S.sel.pageId);
  const i = list.indexOf(o);
  list.splice(i, 1);
  if (dir === 'front') list.push(o); else list.unshift(o);
  renderPage(S.sel.pageId);
  commit();
}

// remember the last original line that was clicked without changes, so that
// pressing Delete right after Esc removes it
let lastLine = null;
on('noop-line', (v) => { lastLine = v; });
on('tool', () => { lastLine = null; });
on('restore', () => { cancelPlacing(); lastLine = null; });
