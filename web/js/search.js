// Find text across the document.
import { S, on } from './state.js';
import { views, scrollToRect } from './viewer.js';
import { loadText, rangeRects } from './textlayer.js';
import { $ } from './ui.js';

const box = $('#searchbox');
const input = $('#searchInput');
const countEl = $('#searchCount');
let results = [];
let cur = -1;
let token = 0;
let timer = 0;

export function initSearch() {
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => run(input.value), 220); });
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); go(cur + (e.shiftKey ? -1 : 1)); }
    if (e.key === 'Escape') { e.preventDefault(); closeSearch(); }
  });
  $('#searchNext').addEventListener('click', () => go(cur + 1));
  $('#searchPrev').addEventListener('click', () => go(cur - 1));
  $('#searchClose').addEventListener('click', closeSearch);
}

export function openSearch() {
  box.hidden = false;
  const sel = window.getSelection()?.toString();
  if (sel && sel.length < 80 && !sel.includes('\n')) input.value = sel;
  input.focus();
  input.select();
  if (input.value) run(input.value);
}

export function closeSearch() {
  box.hidden = true;
  token += 1;
  results = [];
  cur = -1;
  paint();
}

export const searchOpen = () => !box.hidden;

async function run(q) {
  const my = ++token;
  results = [];
  cur = -1;
  paint();
  q = q.trim().toLowerCase();
  if (!q) { countEl.textContent = ''; return; }
  countEl.textContent = '…';
  for (const p of S.pages) {
    if (!p.doc) continue;
    const data = await loadText(p);
    if (my !== token) return;
    if (!data) continue;
    let str = '';
    const map = [];
    data.segments.forEach((s, si) => {
      if (si) { str += ' '; map.push(-1); }
      for (let i = s.start; i < s.end; i++) { str += data.chars[i].c.toLowerCase(); map.push(i); }
    });
    let at = str.indexOf(q);
    while (at >= 0) {
      let a = at; while (a < at + q.length && map[a] < 0) a += 1;
      let b = at + q.length - 1; while (b > a && map[b] < 0) b -= 1;
      if (map[a] >= 0 && map[b] >= 0) results.push({ pageId: p.id, rects: rangeRects(data, map[a], map[b] + 1) });
      at = str.indexOf(q, at + Math.max(1, q.length));
    }
    if (results.length && cur < 0) { cur = 0; go(0); }
    countEl.textContent = `${results.length}…`;
  }
  if (my !== token) return;
  countEl.textContent = results.length ? `${cur + 1} / ${results.length}` : 'No results';
  paint();
}

function go(i) {
  if (!results.length) return;
  cur = ((i % results.length) + results.length) % results.length;
  countEl.textContent = `${cur + 1} / ${results.length}`;
  const r = results[cur];
  scrollToRect(r.pageId, r.rects[0]);
  paint();
}

function paint() {
  for (const v of views.values()) v.L.search.textContent = '';
  results.forEach((r, i) => {
    const v = views.get(r.pageId);
    if (!v) return;
    for (const q of r.rects) {
      const d = document.createElement('div');
      d.className = `search-hit${i === cur ? ' current' : ''}`;
      d.style.cssText = `left:${q[0] - 1}px;top:${q[1]}px;width:${q[2] - q[0] + 2}px;height:${q[3] - q[1]}px`;
      v.L.search.appendChild(d);
    }
  });
}

on('pages', () => { if (searchOpen() && input.value) run(input.value); });
on('restore', () => { if (searchOpen() && input.value) run(input.value); });
