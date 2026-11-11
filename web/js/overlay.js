// Renders the editable objects of each page and handles inline text editing.
import { S, emit, on, findObj, pageById, select, removeObj, commit } from './state.js';
import { views, updateImage } from './viewer.js';
import { cssFamily, runFontCss } from './fonts.js';
import { icon, NOTE_SVG } from './icons.js';

export const ANNOT = new Set(['highlight', 'underline', 'strike', 'ink', 'note']);
export const TEXT_LH = 1.25;
const CLS = {
  text: 'o-text', textedit: 'o-te', image: 'o-img', whiteout: 'o-white', rect: 'o-shape', ellipse: 'o-shape',
  line: 'o-line', arrow: 'o-line', ink: 'o-ink', highlight: 'o-marks', underline: 'o-marks', strike: 'o-marks', note: 'o-note',
};
const els = new Map();
const SVGNS = 'http://www.w3.org/2000/svg';

export const elFor = (id) => els.get(id);

const PLAINTEXT_OK = (() => {
  const d = document.createElement('div');
  try { d.contentEditable = 'plaintext-only'; } catch (e) { return false; }
  return d.contentEditable === 'plaintext-only';
})();

// ------------------------------------------------------------------ geometry
export function bbox(o) {
  switch (o.type) {
    case 'line': case 'arrow':
      return { x: Math.min(o.x1, o.x2), y: Math.min(o.y1, o.y2), w: Math.abs(o.x2 - o.x1), h: Math.abs(o.y2 - o.y1) };
    case 'ink': {
      let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
      for (const path of o.paths) for (const [x, y] of path) {
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      }
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    case 'highlight': case 'underline': case 'strike': {
      const r = o.rects;
      const x0 = Math.min(...r.map((q) => q[0])); const y0 = Math.min(...r.map((q) => q[1]));
      const x1 = Math.max(...r.map((q) => q[2])); const y1 = Math.max(...r.map((q) => q[3]));
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    case 'note': return { x: o.x, y: o.y, w: 22, h: 22 };
    case 'text': case 'textedit': {
      const el = els.get(o.id);
      const x = o.type === 'text' ? o.x : o.x + o.dx;
      const y = o.type === 'text' ? o.y : parseFloat(el?.style.top || o.y);
      return { x, y, w: el ? el.offsetWidth : 40, h: el ? el.offsetHeight : 16 };
    }
    default: return { x: o.x, y: o.y, w: o.w, h: o.h };
  }
}

// ------------------------------------------------------------------ rendering
export function renderPage(pageId) {
  const v = views.get(pageId);
  if (!v) return;
  const list = S.objects[pageId] || [];
  const seen = new Set();
  let ci = 0;
  let ai = 0;
  for (const o of list) {
    seen.add(o.id);
    let el = els.get(o.id);
    if (!el || el.dataset.type !== o.type) {
      if (el) el.remove();
      el = create(o);
      els.set(o.id, el);
    }
    const isA = ANNOT.has(o.type);
    const layer = isA ? v.L.annot : v.L.content;
    const idx = isA ? ai++ : ci++;
    if (el.parentNode !== layer || layer.children[idx] !== el) layer.insertBefore(el, layer.children[idx] || null);
    update(el, o, pageId);
  }
  for (const layer of [v.L.content, v.L.annot]) {
    for (const el of [...layer.children]) {
      if (!seen.has(el.dataset.oid)) { els.delete(el.dataset.oid); el.remove(); }
    }
  }
  positionTextEdits(pageId);
  updateImage(pageId);
}

export function renderAll() {
  for (const p of S.pages) renderPage(p.id);
  for (const [id, el] of els) if (!el.isConnected) els.delete(id);
}

export function renderObj(pageId, o) {
  const el = els.get(o.id);
  if (!el) { renderPage(pageId); return; }
  update(el, o, pageId);
  if (o.type === 'textedit') positionTextEdits(pageId);
}

function create(o) {
  const el = document.createElement('div');
  el.className = `obj ${CLS[o.type] || ''}`;
  el.dataset.oid = o.id;
  el.dataset.type = o.type;
  switch (o.type) {
    case 'text': case 'textedit':
      el.innerHTML = '<span class="bl"></span><span class="tx"></span>';
      break;
    case 'image': el.innerHTML = '<img alt="" draggable="false">'; break;
    case 'rect': case 'ellipse': case 'line': case 'arrow': case 'ink': {
      const svg = document.createElementNS(SVGNS, 'svg');
      el.appendChild(svg);
      break;
    }
    case 'highlight': case 'underline': case 'strike': el.classList.add(`k-${o.type}`); break;
    default: break;
  }
  return el;
}

function svgEl(tag, attrs) {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v);
  return e;
}

function update(el, o, pageId) {
  const st = el.style;
  switch (o.type) {
    case 'text': {
      st.left = `${o.x}px`;
      st.top = `${o.y}px`;
      st.transform = o.rot ? `rotate(${o.rot}deg)` : '';
      st.fontFamily = cssFamily(o.family);
      st.fontSize = `${o.size}px`;
      st.fontWeight = o.bold ? '700' : '400';
      st.fontStyle = o.italic ? 'italic' : 'normal';
      st.fontSynthesis = 'none';
      st.color = o.color;
      st.lineHeight = String(o.lh || TEXT_LH);
      st.textAlign = o.align || 'left';
      st.textDecoration = [o.underline && 'underline', o.strike && 'line-through'].filter(Boolean).join(' ') || 'none';
      st.opacity = o.opacity ?? 1;
      const tx = el.querySelector('.tx');
      if (!isEditing(o.id) && tx.textContent !== o.text) tx.textContent = o.text;
      break;
    }
    case 'textedit': {
      const p = pageById(pageId);
      const doc = p && p.doc;
      st.left = `${o.x + o.dx}px`;
      st.fontSynthesis = 'none';
      st.lineHeight = '1.2';
      const first = o.runs[0];
      if (first) { st.fontSize = `${first.size}px`; st.fontFamily = runFontCss(first, doc); }
      const tx = el.querySelector('.tx');
      if (!isEditing(o.id)) {
        tx.textContent = '';
        o.runs.forEach((r, i) => {
          const s = document.createElement('span');
          s.className = 'run';
          s.dataset.r = String(i);
          s.textContent = r.t;
          styleRun(s, r, doc);
          tx.appendChild(s);
        });
      } else {
        tx.querySelectorAll('.run').forEach((s) => {
          const r = o.runs[+s.dataset.r];
          if (r) styleRun(s, r, doc);
        });
      }
      break;
    }
    case 'image': {
      st.left = `${o.x}px`; st.top = `${o.y}px`; st.width = `${o.w}px`; st.height = `${o.h}px`;
      st.transform = o.rot ? `rotate(${o.rot}deg)` : '';
      st.opacity = o.opacity ?? 1;
      const img = el.querySelector('img');
      const src = S.images[o.img]?.url || '';
      if (img.getAttribute('src') !== src) img.src = src;
      break;
    }
    case 'whiteout':
      st.left = `${o.x}px`; st.top = `${o.y}px`; st.width = `${o.w}px`; st.height = `${o.h}px`;
      st.background = o.fill || '#ffffff';
      break;
    case 'rect': case 'ellipse': {
      st.left = `${o.x}px`; st.top = `${o.y}px`; st.width = `${o.w}px`; st.height = `${o.h}px`;
      const svg = el.querySelector('svg');
      svg.setAttribute('width', o.w);
      svg.setAttribute('height', o.h);
      svg.setAttribute('viewBox', `0 0 ${Math.max(o.w, 0.01)} ${Math.max(o.h, 0.01)}`);
      svg.textContent = '';
      const sw = o.stroke ? o.width : 0;
      const a = { fill: o.fill || 'none', stroke: o.stroke || 'none', 'stroke-width': sw, opacity: o.opacity ?? 1, 'stroke-linejoin': 'round' };
      const x = sw / 2; const y = sw / 2; const w = Math.max(o.w - sw, 0); const hh = Math.max(o.h - sw, 0);
      svg.appendChild(o.type === 'rect'
        ? svgEl('rect', { x, y, width: w, height: hh, ...a })
        : svgEl('ellipse', { cx: o.w / 2, cy: o.h / 2, rx: w / 2, ry: hh / 2, ...a }));
      break;
    }
    case 'line': case 'arrow': {
      const pad = o.width * 4 + 8;
      const x0 = Math.min(o.x1, o.x2) - pad; const y0 = Math.min(o.y1, o.y2) - pad;
      const w = Math.abs(o.x2 - o.x1) + pad * 2; const hh = Math.abs(o.y2 - o.y1) + pad * 2;
      st.left = `${x0}px`; st.top = `${y0}px`; st.width = `${w}px`; st.height = `${hh}px`;
      const svg = el.querySelector('svg');
      svg.setAttribute('width', w); svg.setAttribute('height', hh);
      svg.textContent = '';
      const p1 = [o.x1 - x0, o.y1 - y0]; const p2 = [o.x2 - x0, o.y2 - y0];
      const g = svgEl('g', { opacity: o.opacity ?? 1 });
      let end = p2;
      if (o.type === 'arrow') {
        const vx = p2[0] - p1[0]; const vy = p2[1] - p1[1];
        const len = Math.hypot(vx, vy) || 1; const ux = vx / len; const uy = vy / len;
        const head = Math.max(o.width * 4, 8);
        const bx = p2[0] - ux * head; const by = p2[1] - uy * head;
        end = [p2[0] - ux * head * 0.8, p2[1] - uy * head * 0.8];
        g.appendChild(svgEl('path', {
          d: `M${bx - uy * head * 0.5},${by + ux * head * 0.5} L${p2[0]},${p2[1]} L${bx + uy * head * 0.5},${by - ux * head * 0.5} Z`,
          fill: o.stroke, stroke: o.stroke, 'stroke-width': 0.5, 'stroke-linejoin': 'round',
        }));
      }
      g.insertBefore(svgEl('line', { x1: p1[0], y1: p1[1], x2: end[0], y2: end[1], stroke: o.stroke, 'stroke-width': o.width, 'stroke-linecap': 'round' }), g.firstChild);
      svg.appendChild(g);
      svg.appendChild(svgEl('line', { class: 'hitarea', x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1], 'stroke-width': Math.max(o.width + 10, 12), 'data-oid': o.id }));
      break;
    }
    case 'ink': {
      const b = bbox(o);
      const pad = o.width + 6;
      st.left = `${b.x - pad}px`; st.top = `${b.y - pad}px`; st.width = `${b.w + pad * 2}px`; st.height = `${b.h + pad * 2}px`;
      const svg = el.querySelector('svg');
      svg.setAttribute('width', b.w + pad * 2); svg.setAttribute('height', b.h + pad * 2);
      svg.textContent = '';
      const d = o.paths.map((path) => smoothPath(path.map(([x, y]) => [x - b.x + pad, y - b.y + pad]))).join(' ');
      svg.appendChild(svgEl('path', { d, fill: 'none', stroke: o.color, 'stroke-width': o.width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: o.opacity ?? 1 }));
      svg.appendChild(svgEl('path', { d, class: 'hitarea', 'stroke-width': o.width + 10, 'stroke-linecap': 'round' }));
      break;
    }
    case 'highlight': case 'underline': case 'strike': {
      st.opacity = o.opacity ?? 1;
      const want = o.rects.length;
      while (el.querySelectorAll(':scope > i').length > want) el.querySelector(':scope > i:last-of-type').remove();
      while (el.querySelectorAll(':scope > i').length < want) el.insertBefore(document.createElement('i'), el.querySelector(':scope > .sel'));
      el.querySelectorAll(':scope > i').forEach((i, n) => {
        const r = o.rects[n];
        const hh = r[3] - r[1];
        Object.assign(i.style, { left: `${r[0]}px`, top: `${r[1]}px`, width: `${r[2] - r[0]}px`, height: `${hh}px` });
        if (o.type === 'highlight') i.style.background = o.color;
        else {
          const t = Math.max(0.8, hh * 0.07);
          const at = o.type === 'underline' ? `${hh - t * 1.5}px` : `${hh * 0.55 - t / 2}px`;
          i.style.background = `linear-gradient(${o.color},${o.color}) 0 ${at}/100% ${t}px no-repeat`;
        }
      });
      break;
    }
    case 'note':
      st.left = `${o.x}px`; st.top = `${o.y}px`;
      st.transform = o.rot ? `rotate(${o.rot}deg)` : '';
      if (el.dataset.color !== o.color) { el.innerHTML = NOTE_SVG(o.color); el.dataset.color = o.color; }
      el.title = o.text || 'Empty note';
      break;
    default: break;
  }
  updSel(el, o);
}

function styleRun(s, r, doc) {
  s.style.fontFamily = runFontCss(r, doc);
  s.style.fontSize = `${r.size}px`;
  s.style.fontWeight = r.bold ? '700' : '400';
  s.style.fontStyle = r.italic ? 'italic' : 'normal';
  s.style.color = r.color;
}

function smoothPath(pts) {
  if (!pts.length) return '';
  if (pts.length < 3) return `M${pts.map((p) => p.join(',')).join(' L')}`;
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2;
    const my = (pts[i][1] + pts[i + 1][1]) / 2;
    d += ` Q${pts[i][0]},${pts[i][1]} ${mx},${my}`;
  }
  const l = pts[pts.length - 1];
  return `${d} L${l[0]},${l[1]}`;
}

/** Align edited original lines so their baseline sits exactly where the original was. */
export function positionTextEdits(pageId) {
  for (const o of S.objects[pageId] || []) {
    if (o.type !== 'textedit') continue;
    const el = els.get(o.id);
    if (!el) continue;
    const bl = el.querySelector('.bl');
    el.style.top = `${o.y + o.dy - bl.offsetTop}px`;
  }
}

export function positionAllTextEdits() {
  for (const p of S.pages) positionTextEdits(p.id);
}

// ------------------------------------------------------------------ selection
const HANDLES8 = { nw: [0, 0], n: [50, 0], ne: [100, 0], e: [100, 50], se: [100, 100], s: [50, 100], sw: [0, 100], w: [0, 50] };
const HANDLES4 = { nw: [0, 0], ne: [100, 0], se: [100, 100], sw: [0, 100] };

function updSel(el, o) {
  const selected = !!(S.sel && S.sel.id === o.id);
  el.classList.toggle('selected', selected);
  el.classList.toggle('editing', !!(S.editing && S.editing.id === o.id));
  let sel = el.querySelector(':scope > .sel');
  if (!selected) { if (sel) sel.remove(); return; }
  if (!sel || sel.dataset.kind !== o.type) {
    if (sel) sel.remove();
    sel = document.createElement('div');
    sel.className = 'sel';
    sel.dataset.kind = o.type;
    let hs = null;
    if (['image', 'whiteout', 'rect', 'ellipse'].includes(o.type)) hs = HANDLES8;
    else if (o.type === 'ink') hs = HANDLES4;
    if (hs) {
      for (const [k, [x, y]] of Object.entries(hs)) {
        const hd = document.createElement('i');
        hd.className = 'h';
        hd.dataset.h = k;
        hd.style.left = `${x}%`;
        hd.style.top = `${y}%`;
        sel.appendChild(hd);
      }
    }
    if (o.type === 'line' || o.type === 'arrow') {
      sel.style.border = '0';
      for (const k of ['p1', 'p2']) {
        const hd = document.createElement('i');
        hd.className = 'h';
        hd.dataset.h = k;
        sel.appendChild(hd);
      }
    }
    if (o.type === 'text' || o.type === 'textedit') {
      const g = document.createElement('i');
      g.className = 'drag-handle';
      g.dataset.h = 'move';
      g.innerHTML = icon('grip');
      g.title = 'Drag to move';
      sel.appendChild(g);
    }
    el.appendChild(sel);
  }
  if (o.type === 'line' || o.type === 'arrow') {
    const x0 = parseFloat(el.style.left); const y0 = parseFloat(el.style.top);
    sel.style.inset = '0';
    const [h1, h2] = sel.querySelectorAll('.h');
    Object.assign(h1.style, { left: `${o.x1 - x0}px`, top: `${o.y1 - y0}px` });
    Object.assign(h2.style, { left: `${o.x2 - x0}px`, top: `${o.y2 - y0}px` });
  } else if (['highlight', 'underline', 'strike'].includes(o.type)) {
    const b = bbox(o);
    Object.assign(sel.style, { inset: 'auto', left: `${b.x - 2}px`, top: `${b.y - 2}px`, width: `${b.w + 4}px`, height: `${b.h + 4}px` });
  } else if (o.type === 'ink') {
    sel.style.inset = `${o.width + 4}px`;
  }
}

export function refreshSelection() {
  for (const [id, el] of els) {
    const shouldSel = !!(S.sel && S.sel.id === id);
    if (shouldSel !== el.classList.contains('selected') || el.querySelector(':scope > .sel')) {
      const pageId = el.closest('.page-wrap')?.dataset.pageId;
      const o = pageId && findObj(pageId, id);
      if (o) updSel(el, o);
    }
  }
}

// ------------------------------------------------------------------ text editing
export const isEditing = (id) => !!(S.editing && S.editing.id === id);

export function beginEdit(pageId, id, opt = {}) {
  if (S.editing && S.editing.id === id) return;
  if (S.editing) endEdit();
  const el = els.get(id);
  const o = findObj(pageId, id);
  if (!el || !o) return;
  S.editing = { pageId, id };
  select(pageId, id);
  updSel(el, o);
  const tx = el.querySelector('.tx');
  tx.contentEditable = PLAINTEXT_OK ? 'plaintext-only' : 'true';
  tx.spellcheck = false;
  tx.focus({ preventScroll: true });
  const sel = window.getSelection();
  let placed = false;
  if (opt.point && document.caretRangeFromPoint) {
    const r = document.caretRangeFromPoint(opt.point.x, opt.point.y);
    if (r && tx.contains(r.startContainer)) { sel.removeAllRanges(); sel.addRange(r); placed = true; }
  }
  if (!placed) {
    const r = document.createRange();
    r.selectNodeContents(tx);
    if (!opt.selectAll) r.collapse(false);
    sel.removeAllRanges();
    sel.addRange(r);
  }
  tx.addEventListener('keydown', onEditKey);
  tx.addEventListener('input', onEditInput);
  tx.addEventListener('blur', onEditBlur);
  tx.addEventListener('paste', onPaste);
  emit('editing');
}

function onPaste(e) {
  if (PLAINTEXT_OK) return;
  e.preventDefault();
  const t = e.clipboardData.getData('text/plain');
  document.execCommand('insertText', false, t);
}

function onEditKey(e) {
  e.stopPropagation();
  const o = S.editing && findObj(S.editing.pageId, S.editing.id);
  if (e.key === 'Escape') { e.preventDefault(); e.currentTarget.blur(); }
  else if (e.key === 'Enter' && o && o.type === 'textedit') { e.preventDefault(); e.currentTarget.blur(); }
  else if (e.key === 'Tab') { e.preventDefault(); document.execCommand('insertText', false, '    '); }
  else if ((e.ctrlKey || e.metaKey) && ['b', 'i', 'u'].includes(e.key.toLowerCase())) {
    e.preventDefault();
    emit('format-key', e.key.toLowerCase());
  }
}

function onEditInput() {
  if (S.editing) {
    const o = findObj(S.editing.pageId, S.editing.id);
    if (o && o.type === 'textedit') positionTextEdits(S.editing.pageId);
  }
}

function onEditBlur(e) {
  const tx = e.currentTarget;
  setTimeout(() => { if (document.activeElement !== tx) endEdit(); }, 0);
}

function readRuns(tx, base) {
  const out = [];
  let cur = 0;
  const push = (text) => {
    if (!text) return;
    const b = base[cur] || base[0];
    const last = out[out.length - 1];
    if (last && last._r === cur) last.t += text;
    else out.push({ ...b, t: text, _r: cur });
  };
  const walk = (node) => {
    for (const n of node.childNodes) {
      if (n.nodeType === 3) push(n.nodeValue);
      else if (n.nodeType === 1) {
        if (n.tagName === 'BR') { push(' '); continue; }
        if (n.dataset && n.dataset.r != null) cur = +n.dataset.r;
        walk(n);
      }
    }
  };
  walk(tx);
  return out.map(({ _r, ...r }) => ({ ...r, t: r.t.replace(/[\n\r ]/g, ' ') })).filter((r) => r.t.length);
}

export function endEdit() {
  const ed = S.editing;
  if (!ed) return;
  S.editing = null;
  const el = els.get(ed.id);
  const o = findObj(ed.pageId, ed.id);
  let tx = null;
  if (el) {
    tx = el.querySelector('.tx');
    tx.removeEventListener('keydown', onEditKey);
    tx.removeEventListener('input', onEditInput);
    tx.removeEventListener('blur', onEditBlur);
    tx.removeEventListener('paste', onPaste);
    tx.contentEditable = 'false';
    el.classList.remove('editing');
    window.getSelection()?.removeAllRanges();
  }
  if (o && tx) {
    if (o.type === 'text') {
      let text = tx.innerText.replace(/ /g, ' ');
      if (text.endsWith('\n') && !o.text.endsWith('\n')) text = text.slice(0, -1);
      if (!text.trim()) { removeObj(ed.pageId, o.id); commit(); emit('editing'); return; }
      o.text = text;
    } else if (o.type === 'textedit') {
      o.runs = readRuns(tx, o.runs);
      const txt = o.runs.map((r) => r.t).join('');
      if (!o.styled && !o.dx && !o.dy && txt === o.orig) {
        emit('noop-line', { pageId: ed.pageId, obj: { ...o } });
        removeObj(ed.pageId, o.id);
        commit();
        emit('editing');
        return;
      }
    }
    renderPage(ed.pageId);
    commit();
  }
  emit('editing');
}

on('selection', refreshSelection);
