// Fillable PDF form fields (AcroForm): text boxes, check boxes, radio buttons, lists.
import { S, on, commit, pageById } from './state.js';
import { api } from './api.js';
import { views } from './viewer.js';
import { h } from './ui.js';

const cache = new Map();
const CHECK = '<svg viewBox="0 0 24 24"><path d="M5 12.5 9.5 17 19 7"/></svg>';
const DOT = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="6"/></svg>';

function fieldsOf(p) {
  const key = `${p.doc}:${p.index}`;
  if (!cache.has(key)) cache.set(key, api.fields(p.doc, p.index).then((r) => r.fields).catch(() => []));
  return cache.get(key);
}

const valueOf = (pageId, f) => {
  const v = S.fields[pageId];
  return v && f.key in v ? v[f.key] : f.value;
};

function setValue(pageId, f, value) {
  (S.fields[pageId] ||= {})[f.key] = value;
}

export async function renderFields(pageId) {
  const p = pageById(pageId);
  const v = views.get(pageId);
  if (!p || !p.doc || !v) return;
  if (!S.docs[p.doc]?.pages[p.index]?.fields) return;
  const fields = await fieldsOf(p);
  const layer = v.L.fields;
  if (layer.dataset.built !== '1') {
    layer.dataset.built = '1';
    for (const f of fields) layer.append(build(pageId, f));
  }
  syncValues(pageId, fields);
}

function place(el, f) {
  const [x0, y0, x1, y1] = f.rect;
  Object.assign(el.style, { left: `${x0}px`, top: `${y0}px`, width: `${x1 - x0}px`, height: `${y1 - y0}px` });
  el.dataset.key = f.key;
  if (f.readonly) el.setAttribute('disabled', '');
  return el;
}

function build(pageId, f) {
  const hgt = f.rect[3] - f.rect[1];
  const fs = f.fontsize > 0 ? f.fontsize : Math.max(6, Math.min(12, hgt * 0.68));
  if (f.type === 'text') {
    const el = f.multiline ? h('textarea', { class: 'field' }) : h('input', { class: 'field', type: f.password ? 'password' : 'text' });
    el.style.fontSize = `${f.multiline && !f.fontsize ? Math.min(fs, 11) : fs}px`;
    if (f.maxlen) el.maxLength = f.maxlen;
    if (f.comb && f.maxlen) el.style.letterSpacing = `${((f.rect[2] - f.rect[0]) / f.maxlen) - fs * 0.6}px`;
    el.title = f.label || f.name;
    el.addEventListener('change', () => { setValue(pageId, f, el.value); commit(); });
    el.addEventListener('keydown', (e) => e.stopPropagation());
    return place(el, f);
  }
  if (f.type === 'checkbox' || f.type === 'radio') {
    const el = h('button', { class: `field field-check${f.type === 'radio' ? ' radio' : ''}`, html: f.type === 'radio' ? DOT : CHECK, title: f.label || f.name });
    el.addEventListener('click', () => {
      const now = !valueOf(pageId, f);
      if (f.type === 'radio') {
        if (!now) return;
        for (const p of S.pages) {
          const vv = views.get(p.id);
          vv?.L.fields.querySelectorAll('.field-check.radio').forEach((other) => {
            const of = other._f;
            if (of && of.name === f.name && of.key !== f.key) setValue(p.id, of, false);
          });
        }
      }
      setValue(pageId, f, now);
      commit();
      for (const p of S.pages) syncValuesFromCache(p.id);
    });
    el._f = f;
    return place(el, f);
  }
  const sel = h('select', { class: 'field', title: f.label || f.name });
  if (f.type === 'list') sel.size = Math.max(2, Math.floor(hgt / (fs * 1.25)));
  const opts = [...(f.options || [])];
  if (f.value && !opts.includes(f.value)) opts.unshift(f.value);
  if (f.type === 'combo' && !opts.includes('')) opts.unshift('');
  for (const o of opts) sel.append(h('option', { value: o, text: o }));
  sel.style.fontSize = `${fs}px`;
  sel.addEventListener('change', () => { setValue(pageId, f, sel.value); commit(); });
  return place(sel, f);
}

function syncValues(pageId, fields) {
  const v = views.get(pageId);
  if (!v) return;
  const byKey = new Map(fields.map((f) => [f.key, f]));
  v.L.fields.querySelectorAll('[data-key]').forEach((el) => {
    const f = byKey.get(el.dataset.key);
    if (!f) return;
    const val = valueOf(pageId, f);
    if (f.type === 'checkbox' || f.type === 'radio') el.classList.toggle('on', !!val);
    else if (document.activeElement !== el && el.value !== (val ?? '')) el.value = val ?? '';
  });
}

async function syncValuesFromCache(pageId) {
  const p = pageById(pageId);
  if (!p || !p.doc || !S.docs[p.doc]?.pages[p.index]?.fields) return;
  const fields = await fieldsOf(p);
  syncValues(pageId, fields);
}

on('pagevisible', (id) => renderFields(id));
on('restore', () => { for (const p of S.pages) syncValuesFromCache(p.id); });
