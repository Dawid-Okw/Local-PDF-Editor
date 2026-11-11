// "Fill & Sign": draw, type or upload a signature; saved signatures are reusable.
import { h, openModal, toast } from './ui.js';
import { icon, hydrateIcons } from './icons.js';
import { getFamily, cssFamily } from './fonts.js';

const KEY = 'folio.signatures';
const SCRIPT_FONTS = ['Segoe Script', 'Ink Free', 'Lucida Handwriting', 'Segoe Print', 'Brush Script MT',
  'Freestyle Script', 'Mistral', 'Bradley Hand ITC', 'Monotype Corsiva', 'Gabriola', 'Vladimir Script', 'Kunstler Script'];
const INKS = ['#111827', '#1d3fb8', '#0b5e2b'];

function loadSaved() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { return []; }
}
function storeSaved(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, 8))); } catch (e) { toast('Could not save the signature for later', 'err'); }
}

/** Crop a canvas to its non-transparent pixels (plus padding) and return a PNG data URL. */
function trimCanvas(c, pad = 6) {
  const ctx = c.getContext('2d');
  const { width: w, height: hgt } = c;
  const data = ctx.getImageData(0, 0, w, hgt).data;
  let x0 = w; let y0 = hgt; let x1 = -1; let y1 = -1;
  for (let y = 0; y < hgt; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
  x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(hgt - 1, y1 + pad);
  const out = document.createElement('canvas');
  out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
  out.getContext('2d').drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out.toDataURL('image/png');
}

function drawPane(state) {
  const canvas = h('canvas');
  const pad = h('div', { class: 'sig-pad' }, canvas, h('div', { class: 'sig-line' }), h('div', { class: 'sig-hint', text: 'Sign above the line' }));
  let ctx = null;
  let drawing = false;
  let pts = [];
  let empty = true;
  const setup = () => {
    const r = pad.getBoundingClientRect();
    const s = 3;
    canvas.width = Math.round(r.width * s);
    canvas.height = Math.round(r.height * s);
    ctx = canvas.getContext('2d');
    ctx.scale(s, s);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  };
  const pos = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top, e.pressure || 0.5]; };
  canvas.addEventListener('pointerdown', (e) => {
    if (!ctx) setup();
    canvas.setPointerCapture(e.pointerId);
    drawing = true;
    pts = [pos(e)];
    pad.querySelector('.sig-hint').style.display = 'none';
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ce of evs) {
      const p = pos(ce);
      pts.push(p);
      const n = pts.length;
      if (n < 3) continue;
      const [a, b, c] = [pts[n - 3], pts[n - 2], pts[n - 1]];
      const m1 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const m2 = [(b[0] + c[0]) / 2, (b[1] + c[1]) / 2];
      const speed = Math.hypot(c[0] - a[0], c[1] - a[1]);
      ctx.strokeStyle = state.ink;
      ctx.lineWidth = Math.max(1.4, Math.min(3.6, 3.4 - speed * 0.06)) * (e.pointerType === 'pen' ? 0.6 + c[2] : 1);
      ctx.beginPath();
      ctx.moveTo(m1[0], m1[1]);
      ctx.quadraticCurveTo(b[0], b[1], m2[0], m2[1]);
      ctx.stroke();
      empty = false;
    }
  });
  const stop = () => {
    if (drawing && pts.length < 3 && pts.length) {
      ctx.fillStyle = state.ink;
      ctx.beginPath(); ctx.arc(pts[0][0], pts[0][1], 1.6, 0, Math.PI * 2); ctx.fill();
      empty = false;
    }
    drawing = false;
  };
  canvas.addEventListener('pointerup', stop);
  canvas.addEventListener('pointercancel', stop);
  const clear = h('button', { class: 'btn btn-soft sm', html: icon('rotate-ccw') }, 'Clear');
  clear.addEventListener('click', () => { if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height); empty = true; pad.querySelector('.sig-hint').style.display = ''; });
  const inks = INKS.map((c) => {
    const b = h('button', { class: `ink-dot${c === state.ink ? ' on' : ''}`, style: { background: c }, title: 'Ink colour' });
    b.addEventListener('click', () => { state.ink = c; inks.forEach((x) => x.classList.toggle('on', x === b)); });
    return b;
  });
  const el = h('div', {}, pad, h('div', { class: 'sig-tools' }, ...inks, h('div', { class: 'spacer' }), clear));
  return { el, result: () => (empty ? null : trimCanvas(canvas, 8)), onShow: () => { if (!ctx) setup(); } };
}

function typePane(state) {
  const fonts = SCRIPT_FONTS.filter((f) => getFamily(f)).slice(0, 6);
  if (!fonts.length) fonts.push('Times New Roman');
  let font = fonts[0];
  const input = h('input', { class: 'text-input', placeholder: 'Type your name', spellcheck: 'false' });
  const preview = h('div', { class: 'sig-type-preview', style: { fontFamily: cssFamily(font), color: state.ink } });
  const grid = h('div', { class: 'sig-fonts' });
  const btns = fonts.map((f) => {
    const b = h('button', { class: f === font ? 'on' : '', style: { fontFamily: cssFamily(f) }, text: 'Signature', title: f });
    b.addEventListener('click', () => { font = f; preview.style.fontFamily = cssFamily(f); btns.forEach((x) => x.classList.toggle('on', x === b)); });
    return b;
  });
  grid.append(...btns);
  input.addEventListener('input', () => { preview.textContent = input.value; btns.forEach((b) => { b.textContent = input.value || 'Signature'; }); });
  input.addEventListener('keydown', (e) => e.stopPropagation());
  const inks = INKS.map((c) => {
    const b = h('button', { class: `ink-dot${c === state.ink ? ' on' : ''}`, style: { background: c } });
    b.addEventListener('click', () => { state.ink = c; preview.style.color = c; inks.forEach((x) => x.classList.toggle('on', x === b)); });
    return b;
  });
  const el = h('div', {}, input, preview, grid, h('div', { class: 'sig-tools' }, ...inks));
  const result = async () => {
    const text = input.value.trim();
    if (!text) return null;
    const css = cssFamily(font);
    try { await document.fonts.load(`120px ${css}`); } catch (e) { /* ignore */ }
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d');
    ctx.font = `120px ${css}`;
    const w = Math.ceil(ctx.measureText(text).width) + 120;
    c.width = Math.min(w, 4000);
    c.height = 260;
    const ctx2 = c.getContext('2d');
    ctx2.font = `120px ${css}`;
    ctx2.fillStyle = state.ink;
    ctx2.textBaseline = 'middle';
    ctx2.fillText(text, 60, 130);
    return trimCanvas(c, 10);
  };
  return { el, result, onShow: () => setTimeout(() => input.focus(), 10) };
}

function uploadPane() {
  let url = null;
  const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', hidden: true });
  const zone = h('div', { class: 'sig-upload', html: `${icon('upload')}<span>Choose an image of your signature</span>` });
  const clean = h('input', { type: 'checkbox', checked: true });
  zone.addEventListener('click', () => file.click());
  file.addEventListener('change', () => {
    const f = file.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => { url = r.result; zone.innerHTML = ''; zone.append(h('img', { src: url, alt: '' })); };
    r.readAsDataURL(f);
  });
  const result = async () => {
    if (!url) return null;
    const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const c = document.createElement('canvas');
    c.width = im.naturalWidth; c.height = im.naturalHeight;
    const ctx = c.getContext('2d');
    ctx.drawImage(im, 0, 0);
    if (clean.checked) {
      const d = ctx.getImageData(0, 0, c.width, c.height);
      for (let i = 0; i < d.data.length; i += 4) {
        const l = (d.data[i] + d.data[i + 1] + d.data[i + 2]) / 3;
        if (l > 215) d.data[i + 3] = 0; else if (l > 160) d.data[i + 3] = Math.round(d.data[i + 3] * (215 - l) / 55);
      }
      ctx.putImageData(d, 0, 0);
    }
    return trimCanvas(c, 4) || url;
  };
  const el = h('div', {}, zone, file, h('label', { class: 'check-row', style: { marginTop: '10px' } }, clean, 'Remove white background'));
  return { el, result };
}

/** Opens the signature dialog. Resolves with a PNG data URL or null. */
export async function openSignature() {
  const state = { ink: INKS[0] };
  const saved = loadSaved();
  const panes = { draw: drawPane(state), type: typePane(state), upload: uploadPane() };
  let tab = 'draw';
  const tabs = h('div', { class: 'tabs' });
  const body = h('div');
  const show = (t) => {
    tab = t;
    tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.t === t));
    body.textContent = '';
    body.append(panes[t].el);
    if (panes[t].onShow) requestAnimationFrame(panes[t].onShow);
  };
  for (const [t, l] of [['draw', 'Draw'], ['type', 'Type'], ['upload', 'Upload image']]) {
    const b = h('button', { text: l, dataset: { t } });
    b.addEventListener('click', () => show(t));
    tabs.append(b);
  }
  const keep = h('input', { type: 'checkbox', checked: true });
  const content = h('div');
  let pickSaved = null;
  if (saved.length) {
    const list = h('div', { class: 'sig-saved' });
    saved.forEach((url, i) => {
      const del = h('button', { class: 'del', html: icon('x'), title: 'Remove' });
      const sv = h('div', { class: 'sv', title: 'Use this signature' }, h('img', { src: url, alt: 'Saved signature' }), del);
      sv.addEventListener('click', (e) => {
        if (e.target.closest('.del')) {
          saved.splice(i, 1); storeSaved(saved); sv.remove();
          return;
        }
        pickSaved(url);
      });
      list.append(sv);
    });
    content.append(h('div', { class: 'field-row' }, h('label', { text: 'Your saved signatures' }), list));
    content.append(h('div', { class: 'field-row', style: { marginBottom: '6px' } }, h('label', { text: 'Or create a new one' })));
  }
  content.append(tabs, body, h('label', { class: 'check-row', style: { marginTop: '14px' } }, keep, 'Save this signature for next time'));
  show(tab);
  const res = await openModal({
    title: 'Add signature', content, wide: true,
    onOpen: (box, finish) => { pickSaved = (url) => finish({ url, saved: true }); hydrateIcons(box); },
    actions: [
      { label: 'Cancel', value: null },
      {
        label: 'Place signature', cls: 'btn-primary', icon: 'signature', primary: true,
        handler: async () => {
          const url = await panes[tab].result();
          if (!url) { toast(tab === 'type' ? 'Type your name first' : tab === 'upload' ? 'Choose an image first' : 'Draw your signature first', 'info'); return false; }
          return { url, saved: false };
        },
      },
    ],
  });
  if (!res) return null;
  if (!res.saved && keep.checked) { saved.unshift(res.url); storeSaved(saved); }
  return res.url;
}
