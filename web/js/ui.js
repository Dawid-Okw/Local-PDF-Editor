// Generic UI building blocks: toasts, modals, popovers, menus, pickers, tooltips.
import { icon, hydrateIcons } from './icons.js';
import { fontList, cssFamily } from './fonts.js';

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

// ------------------------------------------------------------------ toasts
export function toast(msg, kind = 'info', ms = 2800) {
  const el = h('div', { class: `toast ${kind}` });
  el.innerHTML = kind === 'busy' ? '<span class="spinner"></span>'
    : icon(kind === 'ok' ? 'check' : kind === 'err' ? 'alert' : 'info');
  el.append(h('span', { text: msg }));
  $('#toasts').appendChild(el);
  const close = () => { el.classList.add('out'); setTimeout(() => el.remove(), 260); };
  if (ms) setTimeout(close, ms);
  return close;
}

export function busy(msg) {
  const el = h('div', { class: 'busy-back' },
    h('div', { class: 'busy-card' }, h('span', { class: 'spinner' }), h('span', { text: msg })));
  document.body.appendChild(el);
  return () => el.remove();
}

// ------------------------------------------------------------------ modal
const modalStack = [];
export function openModal({ title, content, actions = [], wide = false, onOpen, dismissible = true }) {
  closePopover();
  return new Promise((resolve) => {
    const back = h('div', { class: 'modal-back' });
    const box = h('div', { class: `modal${wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true' });
    const head = h('div', { class: 'modal-head' }, h('h2', { text: title }));
    const closeBtn = h('button', { class: 'icon-btn sm', 'aria-label': 'Close', html: icon('x') });
    head.append(closeBtn);
    const body = h('div', { class: 'modal-body' });
    if (typeof content === 'string') body.innerHTML = content; else if (content) body.append(content);
    const foot = h('div', { class: 'modal-foot' });
    let done = false;
    const finish = (val) => {
      if (done) return;
      done = true;
      back.remove();
      modalStack.pop();
      document.removeEventListener('keydown', onKey, true);
      resolve(val);
    };
    const run = async (a) => {
      if (a.handler) {
        const r = await a.handler(box);
        if (r === false) return;
        finish(r === undefined ? a.value : r);
      } else finish(a.value);
    };
    for (const a of actions) {
      const b = h('button', { class: `btn ${a.cls || 'btn-ghost'}`, html: (a.icon ? icon(a.icon) : '') });
      b.append(a.label);
      b.addEventListener('click', () => run(a));
      foot.append(b);
      a.el = b;
    }
    const onKey = (e) => {
      if (modalStack[modalStack.length - 1] !== box) return;
      if (e.key === 'Escape' && dismissible) { e.stopPropagation(); e.preventDefault(); finish(null); }
      if (e.key === 'Enter' && !e.shiftKey && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON') {
        const primary = actions.find((a) => a.primary);
        if (primary) { e.preventDefault(); e.stopPropagation(); run(primary); }
      }
    };
    closeBtn.addEventListener('click', () => finish(null));
    back.addEventListener('pointerdown', (e) => { if (e.target === back && dismissible) finish(null); });
    document.addEventListener('keydown', onKey, true);
    box.append(head, body);
    if (actions.length) box.append(foot);
    back.append(box);
    document.body.append(back);
    modalStack.push(box);
    hydrateIcons(box);
    box.close = finish;
    if (onOpen) onOpen(box, finish);
    const first = box.querySelector('input, textarea, [autofocus]');
    if (first) setTimeout(() => first.focus(), 30);
  });
}

export async function confirmDialog(title, message, okLabel = 'OK', danger = false) {
  const r = await openModal({
    title, content: h('p', { text: message }),
    actions: [
      { label: 'Cancel', value: false },
      { label: okLabel, value: true, cls: danger ? 'btn-danger' : 'btn-primary', primary: true },
    ],
  });
  return r === true;
}

export async function passwordDialog(fileName, message) {
  const input = h('input', { class: 'text-input', type: 'password', placeholder: 'Password', autocomplete: 'off' });
  const err = h('div', { class: 'input-error', text: message || '' });
  const content = h('div', {},
    h('p', { text: `“${fileName}” is password protected. Enter the password to open it.` }),
    input, err);
  const r = await openModal({
    title: 'Password required', content,
    actions: [{ label: 'Cancel', value: null }, { label: 'Unlock', cls: 'btn-primary', primary: true, icon: 'lock', handler: () => input.value || false }],
  });
  return r;
}

// ------------------------------------------------------------------ popovers
let currentPop = null;
export function closePopover() {
  if (currentPop) { const p = currentPop; currentPop = null; p.close(); }
}

export function popover(anchor, content, { align = 'start', cls = '', onClose, offset = 6 } = {}) {
  closePopover();
  const el = h('div', { class: `popover ${cls}` });
  el.append(content);
  document.body.append(el);
  hydrateIcons(el);
  const r = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : anchor;
  const pw = el.offsetWidth;
  const ph = el.offsetHeight;
  let x = align === 'end' ? r.right - pw : align === 'center' ? r.left + r.width / 2 - pw / 2 : r.left;
  let y = r.bottom + offset;
  if (y + ph > window.innerHeight - 8) y = Math.max(8, r.top - ph - offset);
  x = Math.max(8, Math.min(x, window.innerWidth - pw - 8));
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  const outside = (e) => {
    if (!el.contains(e.target) && !(anchor.contains && anchor.contains(e.target))) closePopover();
  };
  const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closePopover(); } };
  setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
  document.addEventListener('keydown', key, true);
  const pop = {
    el,
    close() {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', key, true);
      el.remove();
      if (onClose) onClose();
    },
  };
  currentPop = pop;
  return pop;
}

export function menu(anchor, items, opts = {}) {
  const box = h('div', { class: 'menu' });
  for (const it of items) {
    if (it === 'sep') { box.append(h('div', { class: 'menu-sep' })); continue; }
    if (it.title) { box.append(h('div', { class: 'menu-title', text: it.title })); continue; }
    const b = h('button', {
      class: `menu-item${it.danger ? ' danger' : ''}${it.checked ? ' checked' : ''}`,
      disabled: it.disabled, html: it.icon ? icon(it.icon) : '<span style="width:17px"></span>',
    });
    b.append(h('span', { text: it.label }));
    if (it.kbd) b.append(h('span', { class: 'kbd', text: it.kbd }));
    b.addEventListener('click', () => { closePopover(); it.onClick && it.onClick(); });
    box.append(b);
  }
  return popover(anchor, box, opts);
}

// ------------------------------------------------------------------ colour picker
export const PALETTE = ['#111827', '#4b5563', '#9ca3af', '#ffffff', '#dc2626', '#ea580c', '#f59e0b', '#facc15',
  '#16a34a', '#0d9488', '#0ea5e9', '#2563eb', '#4f46e5', '#9333ea', '#db2777', '#7c2d12'];
export const HIGHLIGHTS = ['#fde047', '#fcd34d', '#86efac', '#5eead4', '#7dd3fc', '#c4b5fd', '#f9a8d4', '#fdba74'];

export function colorPicker(anchor, value, { allowNone = false, palette = PALETTE, onChange } = {}) {
  const box = h('div');
  const grid = h('div', { class: 'swatches' });
  const hex = h('input', { type: 'text', maxlength: 7, value: value || '' });
  const native = h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(value || '') ? value : '#000000' });
  const set = (v) => { onChange(v); paint(v); };
  const paint = (v) => {
    grid.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.c === v));
    hex.value = v || '';
    if (v) native.value = v;
  };
  for (const c of palette) {
    grid.append(h('button', { dataset: { c }, style: { background: c }, title: c, onclick: () => set(c) }));
  }
  native.addEventListener('input', () => set(native.value));
  hex.addEventListener('change', () => {
    let v = hex.value.trim();
    if (!v.startsWith('#')) v = `#${v}`;
    if (/^#[0-9a-f]{6}$/i.test(v)) set(v.toLowerCase());
  });
  box.append(grid, h('div', { class: 'color-custom' }, native, hex));
  if (allowNone) {
    box.append(h('button', { class: 'btn btn-soft sm color-none', text: 'No fill', onclick: () => { set(null); closePopover(); } }));
  }
  paint(value);
  return popover(anchor, box, { cls: 'color-pop' });
}

// ------------------------------------------------------------------ font picker
export function fontPicker(anchor, value, onPick) {
  const box = h('div', { style: { display: 'flex', flexDirection: 'column', minHeight: 0 } });
  const input = h('input', { placeholder: 'Search fonts', spellcheck: 'false' });
  const list = h('div', { class: 'fp-list' });
  box.append(h('div', { class: 'fp-search', html: icon('search') }, input), list);
  let items = [];
  let focus = -1;
  const render = () => {
    const q = input.value.trim().toLowerCase();
    list.innerHTML = '';
    items = [];
    const all = fontList();
    const pop = all.filter((f) => f.popular && (!q || f.family.toLowerCase().includes(q)));
    const rest = all.filter((f) => !f.popular && (!q || f.family.toLowerCase().includes(q)));
    const add = (title, arr) => {
      if (!arr.length) return;
      list.append(h('div', { class: 'fp-group', text: title }));
      for (const f of arr) {
        const b = h('button', {
          class: `fp-item${f.family === value ? ' on' : ''}`, text: f.family,
          style: { fontFamily: cssFamily(f.family) },
          onclick: () => { closePopover(); onPick(f.family); },
        });
        list.append(b);
        items.push(b);
      }
    };
    add(q ? 'Matches' : 'Popular', q ? [...pop, ...rest] : pop);
    if (!q) add('All fonts', rest);
    focus = -1;
  };
  input.addEventListener('input', render);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      focus = Math.max(0, Math.min(items.length - 1, focus + (e.key === 'ArrowDown' ? 1 : -1)));
      items.forEach((b, i) => b.classList.toggle('focus', i === focus));
      items[focus]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      const b = items[Math.max(focus, 0)];
      if (b) b.click();
    }
  });
  render();
  const pop = popover(anchor, box, { cls: 'font-pop' });
  setTimeout(() => {
    input.focus();
    list.querySelector('.on')?.scrollIntoView({ block: 'center' });
  }, 0);
  return pop;
}

// ------------------------------------------------------------------ tooltips
export function initTooltips() {
  const tip = $('#tooltip');
  let timer = 0;
  let cur = null;
  const hide = () => { clearTimeout(timer); tip.classList.remove('show'); cur = null; };
  document.addEventListener('pointerover', (e) => {
    const t = e.target.closest?.('[data-tip]');
    if (t === cur) return;
    hide();
    if (!t || e.pointerType === 'touch') return;
    cur = t;
    timer = setTimeout(() => {
      if (!document.body.contains(t)) return;
      tip.textContent = t.dataset.tip;
      const r = t.getBoundingClientRect();
      tip.style.left = '0px';
      tip.style.top = '0px';
      tip.classList.add('show');
      const w = tip.offsetWidth;
      let x = r.left + r.width / 2 - w / 2;
      x = Math.max(6, Math.min(x, window.innerWidth - w - 6));
      let y = r.bottom + 8;
      if (y + 30 > window.innerHeight) y = r.top - 34;
      tip.style.left = `${x}px`;
      tip.style.top = `${y}px`;
    }, 450);
  });
  document.addEventListener('pointerdown', hide, true);
  document.addEventListener('keydown', hide, true);
}

export function isTyping() {
  const a = document.activeElement;
  if (!a) return false;
  return a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable;
}
