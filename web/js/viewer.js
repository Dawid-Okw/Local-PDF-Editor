// Page layout, zoom, lazy page rendering and coordinate conversion.
import { S, emit, pageById } from './state.js';
import { api } from './api.js';
import { $, h } from './ui.js';

export const PX = 96 / 72;             // CSS px per PDF point at 100 %
export const K = () => S.zoom * PX;     // CSS px per point at current zoom
export const views = new Map();          // pageId -> view

const viewer = $('#viewer');
const pagesEl = $('#pages');
let io = null;
let imgTimer = 0;
let scrollRaf = 0;

export function initViewer() {
  io = new IntersectionObserver(onIntersect, { root: viewer, rootMargin: '900px 0px' });
  viewer.addEventListener('scroll', () => {
    if (!scrollRaf) scrollRaf = requestAnimationFrame(() => { scrollRaf = 0; updateCurrent(); });
  }, { passive: true });
  viewer.addEventListener('wheel', (e) => {
    if (!e.ctrlKey || !S.pages.length) return;
    e.preventDefault();
    const f = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0022));
    setZoom(S.zoom * f, { x: e.clientX, y: e.clientY });
  }, { passive: false });
}

// --------------------------------------------------------------- page DOM
function createView(p) {
  const wrap = h('div', { class: 'page-wrap', dataset: { pageId: p.id } });
  const page = h('div', { class: 'page' });
  const img = h('img', { class: 'page-img', alt: '', draggable: 'false' });
  const L = {};
  for (const n of ['hit', 'content', 'annot', 'fields', 'search', 'ui']) L[n] = h('div', { class: `layer layer-${n}` });
  page.append(img, L.hit, L.content, L.annot, L.fields, L.search, L.ui);
  if (!p.doc) img.style.display = 'none';
  wrap.append(page);
  const v = { id: p.id, wrap, page, img, L, visible: false, want: null, has: false };
  views.set(p.id, v);
  io.observe(wrap);
  return v;
}

/** Reconcile page DOM with S.pages (order, additions, removals). */
export function syncPages() {
  const ids = new Set(S.pages.map((p) => p.id));
  for (const [id, v] of views) {
    if (!ids.has(id)) { io.unobserve(v.wrap); v.wrap.remove(); views.delete(id); }
  }
  S.pages.forEach((p, i) => {
    const v = views.get(p.id) || createView(p);
    v.wrap.dataset.label = `${i + 1}`;
    if (pagesEl.children[i] !== v.wrap) pagesEl.insertBefore(v.wrap, pagesEl.children[i] || null);
    layoutPage(p, v);
  });
  pagesEl.style.setProperty('--ik', String(1 / K()));
  if (S.current >= S.pages.length) S.current = Math.max(0, S.pages.length - 1);
  requestAnimationFrame(updateCurrent);
}

export function clearPages() {
  for (const v of views.values()) { io.unobserve(v.wrap); v.wrap.remove(); }
  views.clear();
}

function layoutPage(p, v) {
  const k = K();
  const r = ((p.rot % 360) + 360) % 360;
  const W = p.w;
  const H = p.h;
  const side = r === 90 || r === 270;
  v.wrap.style.width = `${(side ? H : W) * k}px`;
  v.wrap.style.height = `${(side ? W : H) * k}px`;
  v.page.style.width = `${W}px`;
  v.page.style.height = `${H}px`;
  let t;
  if (r === 90) t = `translate(${H * k}px,0) rotate(90deg) scale(${k})`;
  else if (r === 180) t = `translate(${W * k}px,${H * k}px) rotate(180deg) scale(${k})`;
  else if (r === 270) t = `translate(0,${W * k}px) rotate(270deg) scale(${k})`;
  else t = `scale(${k})`;
  v.page.style.transform = t;
}

export function layoutAll() {
  for (const p of S.pages) { const v = views.get(p.id); if (v) layoutPage(p, v); }
  pagesEl.style.setProperty('--ik', String(1 / K()));
}

// --------------------------------------------------------------- page images
function hideRects(pageId) {
  return (S.objects[pageId] || [])
    .filter((o) => o.type === 'textedit' && o.hide)
    .map((o) => o.hide.map((n) => n.toFixed(2)).join(','))
    .join(';');
}

function imageUrl(p) {
  const dpr = window.devicePixelRatio || 1;
  let s = K() * dpr;
  s = Math.min(6, Math.max(0.5, Math.ceil(s * 4) / 4));
  const info = S.docs[p.doc]?.pages[p.index];
  return api.renderUrl(p.doc, p.index, s, hideRects(p.id), info?.fields);
}

export function updateImage(pageId) {
  const v = views.get(pageId);
  const p = pageById(pageId);
  if (!v || !p || !p.doc) return;
  if (!v.visible) { v.stale = true; return; }
  const url = imageUrl(p);
  if (url === v.want) return;
  v.want = url;
  if (!v.has) v.wrap.classList.add('loading');
  const im = new Image();
  im.onload = () => {
    if (v.want !== url) return;
    v.img.src = url;
    v.has = true;
    v.wrap.classList.remove('loading');
  };
  im.onerror = () => { if (v.want === url) { v.want = null; v.wrap.classList.remove('loading'); } };
  im.src = url;
}

function scheduleImages() {
  clearTimeout(imgTimer);
  imgTimer = setTimeout(() => {
    for (const [id, v] of views) if (v.visible) updateImage(id);
  }, 220);
}

function onIntersect(entries) {
  for (const e of entries) {
    const v = views.get(e.target.dataset.pageId);
    if (!v) continue;
    v.visible = e.isIntersecting;
    if (v.visible) {
      updateImage(v.id);
      emit('pagevisible', v.id);
    }
  }
}

// --------------------------------------------------------------- navigation
function updateCurrent() {
  if (!S.pages.length) return;
  const line = viewer.scrollTop + viewer.clientHeight * 0.33;
  let cur = 0;
  for (let i = 0; i < S.pages.length; i++) {
    const v = views.get(S.pages[i].id);
    if (!v) continue;
    if (v.wrap.offsetTop <= line) cur = i; else break;
  }
  if (viewer.scrollTop + viewer.clientHeight >= viewer.scrollHeight - 4) cur = S.pages.length - 1;
  if (cur !== S.current) { S.current = cur; emit('current'); }
}

export function scrollToPage(i, smooth = true) {
  const p = S.pages[Math.max(0, Math.min(i, S.pages.length - 1))];
  const v = p && views.get(p.id);
  if (!v) return;
  viewer.scrollTo({ top: v.wrap.offsetTop - 18, behavior: smooth ? 'smooth' : 'auto' });
  S.current = S.pages.indexOf(p);
  emit('current');
}

/** Scroll so a rect (page points) on a page is comfortably visible. */
export function scrollToRect(pageId, rect, smooth = true) {
  const v = views.get(pageId);
  const p = pageById(pageId);
  if (!v || !p) return;
  const a = pageToWrap(p, rect[0], rect[1]);
  const b = pageToWrap(p, rect[2], rect[3]);
  const top = v.wrap.offsetTop + Math.min(a.y, b.y);
  const bottom = v.wrap.offsetTop + Math.max(a.y, b.y);
  const left = v.wrap.offsetLeft + Math.min(a.x, b.x);
  const vt = viewer.scrollTop;
  const vb = vt + viewer.clientHeight;
  let y = vt;
  if (top < vt + 60 || bottom > vb - 90) y = top - viewer.clientHeight * 0.35;
  let x = viewer.scrollLeft;
  if (left < x || left > x + viewer.clientWidth - 60) x = left - 60;
  viewer.scrollTo({ top: y, left: x, behavior: smooth ? 'smooth' : 'auto' });
}

// --------------------------------------------------------------- zoom
export function setZoom(z, anchor) {
  z = Math.max(0.1, Math.min(6, z));
  if (Math.abs(z - S.zoom) < 1e-4) return;
  const vr = viewer.getBoundingClientRect();
  const ax = anchor ? anchor.x - vr.left : viewer.clientWidth / 2;
  const ay = anchor ? anchor.y - vr.top : viewer.clientHeight / 2;
  const cy = viewer.scrollTop + ay;
  const cx = viewer.scrollLeft + ax;
  let ref = null;
  for (const p of S.pages) {
    const v = views.get(p.id);
    if (v && v.wrap.offsetTop + v.wrap.offsetHeight >= cy) { ref = v; break; }
  }
  let ry = 0;
  let rx = 0;
  if (ref) {
    ry = (cy - ref.wrap.offsetTop) / ref.wrap.offsetHeight;
    rx = (cx - ref.wrap.offsetLeft) / ref.wrap.offsetWidth;
  }
  S.zoom = z;
  layoutAll();
  if (ref) {
    viewer.scrollTop = ref.wrap.offsetTop + ry * ref.wrap.offsetHeight - ay;
    viewer.scrollLeft = ref.wrap.offsetLeft + rx * ref.wrap.offsetWidth - ax;
  }
  emit('zoom');
  scheduleImages();
}

function dispSize(p) {
  const side = p.rot % 180 !== 0;
  return side ? [p.h, p.w] : [p.w, p.h];
}

export function fitWidth() {
  if (!S.pages.length) return;
  const avail = viewer.clientWidth - 80;
  const maxW = Math.max(...S.pages.map((p) => dispSize(p)[0]));
  setZoom(avail / (maxW * PX));
}

export function fitPage() {
  const p = S.pages[S.current] || S.pages[0];
  if (!p) return;
  const [w, hgt] = dispSize(p);
  setZoom(Math.min((viewer.clientWidth - 80) / (w * PX), (viewer.clientHeight - 60) / (hgt * PX)));
  requestAnimationFrame(() => scrollToPage(S.current, false));
}

/** Initial zoom: fit width but never larger than 125 %. */
export function initialZoom() {
  if (!S.pages.length) return;
  const avail = viewer.clientWidth - 80;
  const maxW = Math.max(...S.pages.map((p) => dispSize(p)[0]));
  S.zoom = Math.max(0.25, Math.min(1.25, avail / (maxW * PX)));
  layoutAll();
  emit('zoom');
}

// --------------------------------------------------------------- coordinates
export function pageToWrap(p, x, y) {
  const k = K();
  switch (((p.rot % 360) + 360) % 360) {
    case 90: return { x: (p.h - y) * k, y: x * k };
    case 180: return { x: (p.w - x) * k, y: (p.h - y) * k };
    case 270: return { x: y * k, y: (p.w - x) * k };
    default: return { x: x * k, y: y * k };
  }
}

export function clientToPage(pageId, cx, cy) {
  const v = views.get(pageId);
  const p = pageById(pageId);
  const r = v.wrap.getBoundingClientRect();
  const k = K();
  const U = (cx - r.left) / k;
  const V = (cy - r.top) / k;
  switch (((p.rot % 360) + 360) % 360) {
    case 90: return { x: V, y: p.h - U };
    case 180: return { x: p.w - U, y: p.h - V };
    case 270: return { x: p.w - V, y: U };
    default: return { x: U, y: V };
  }
}

export function pageAtPoint(cx, cy) {
  for (const [id, v] of views) {
    const r = v.wrap.getBoundingClientRect();
    if (cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom) return id;
  }
  return null;
}

/** The page currently most in view (for inserting images, pasting, ...). */
export function currentPageId() {
  return S.pages[S.current]?.id || S.pages[0]?.id;
}

/** Centre of the visible part of a page, in page points. */
export function visibleCenter(pageId) {
  const v = views.get(pageId);
  const p = pageById(pageId);
  const vr = viewer.getBoundingClientRect();
  const r = v.wrap.getBoundingClientRect();
  const cx = Math.max(r.left, Math.min(vr.left + vr.width / 2, r.right));
  const top = Math.max(r.top, vr.top);
  const bottom = Math.min(r.bottom, vr.bottom);
  const cy = bottom > top ? (top + bottom) / 2 : r.top + r.height / 2;
  const pt = clientToPage(pageId, cx, cy);
  return { x: Math.max(0, Math.min(p.w, pt.x)), y: Math.max(0, Math.min(p.h, pt.y)) };
}

export const viewerEl = viewer;
