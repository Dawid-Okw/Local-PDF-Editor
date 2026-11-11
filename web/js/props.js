// Contextual property bar under the toolbar.
import { S, on, commit, saveOpts, selectedObj, emit } from './state.js';
import { renderObj } from './overlay.js';
import { h, $, colorPicker, fontPicker, HIGHLIGHTS } from './ui.js';
import { icon, hydrateIcons } from './icons.js';
import { cssFamily, hasVariant, getFamily } from './fonts.js';
import { deleteSelected, duplicateSelected, arrange, setTool, openNote } from './tools.js';

const bar = $('#propbar');

function context() {
  const o = selectedObj();
  if (o) {
    if (o.type === 'text' || o.type === 'textedit') return { kind: 'text', o, opt: 'text' };
    if (['highlight', 'underline', 'strike'].includes(o.type)) return { kind: 'mark', o, opt: o.type };
    if (o.type === 'ink') return { kind: 'draw', o, opt: 'draw' };
    if (['rect', 'ellipse', 'line', 'arrow'].includes(o.type)) return { kind: 'shape', o, opt: 'shape' };
    if (o.type === 'whiteout') return { kind: 'whiteout', o, opt: 'whiteout' };
    if (o.type === 'note') return { kind: 'note', o, opt: 'note' };
    return { kind: o.type, o, opt: null };
  }
  if (S.placing) return { kind: 'placing' };
  switch (S.tool) {
    case 'text': return { kind: 'text', opt: 'text' };
    case 'highlight': case 'underline': case 'strike': return { kind: 'mark', opt: S.tool };
    case 'draw': return { kind: 'draw', opt: 'draw' };
    case 'shape': return { kind: 'shape', opt: 'shape' };
    case 'whiteout': return { kind: 'whiteout', opt: 'whiteout' };
    case 'note': return { kind: 'note', opt: 'note' };
    case 'edittext': return { kind: 'hint-edittext' };
    default: return { kind: 'hint-select' };
  }
}

/** Current values for the context (object values win over tool defaults). */
function values(c) {
  const base = c.opt ? { ...S.opts[c.opt] } : {};
  const o = c.o;
  if (!o) return base;
  if (o.type === 'textedit') {
    const r = o.runs[0] || {};
    return { family: r.family, size: r.size, color: r.color, bold: o.runs.length && o.runs.every((x) => x.bold), italic: o.runs.length && o.runs.every((x) => x.italic) };
  }
  return { ...base, ...o };
}

function apply(changes, live = false) {
  const c = context();
  if (c.opt) {
    const target = S.opts[c.opt];
    for (const [k, v] of Object.entries(changes)) if (k in target || ['fill', 'stroke'].includes(k)) target[k] = v;
    saveOpts();
  }
  const o = c.o;
  if (o) {
    if (o.type === 'textedit') {
      for (const r of o.runs) {
        if ('family' in changes) { r.family = changes.family; r.fid = null; r.pf = null; }
        if ('bold' in changes) { r.bold = changes.bold; r.fid = null; r.pf = null; }
        if ('italic' in changes) { r.italic = changes.italic; r.fid = null; r.pf = null; }
        if ('size' in changes) r.size = changes.size;
        if ('color' in changes) r.color = changes.color;
      }
      o.styled = true;
    } else {
      Object.assign(o, changes);
      if (o.type === 'note' && 'color' in changes) renderObj(S.sel.pageId, o);
    }
    renderObj(S.sel.pageId, o);
    if (!live) commit();
    emit('objchange');
  }
}

// ------------------------------------------------------------------ controls
function keepFocus(el) {
  // don't steal focus from a text box being edited
  el.addEventListener('mousedown', (e) => { if (e.target.tagName !== 'INPUT') e.preventDefault(); });
  return el;
}

function iconBtn(name, tip, active, onClick, disabled) {
  const b = h('button', { class: `icon-btn${active ? ' active' : ''}`, 'data-tip': tip, html: icon(name), disabled: !!disabled });
  b.addEventListener('click', onClick);
  return keepFocus(b);
}

function group(...kids) { return h('div', { class: 'pb-group' }, ...kids); }
const sep = () => h('span', { class: 'pb-sep' });
const label = (t) => h('span', { class: 'pb-label', text: t });

function colorCtl(value, onPick, opts = {}) {
  const sw = h('span', { class: `sw${value ? '' : ' none'}`, style: { background: value || 'transparent' } });
  const b = h('button', { class: `color-btn${opts.label ? ' with-label' : ''}`, 'data-tip': opts.tip || 'Colour' }, sw);
  if (opts.label) b.append(opts.label);
  keepFocus(b);
  b.addEventListener('click', () => {
    colorPicker(b, value, {
      allowNone: opts.allowNone, palette: opts.palette,
      onChange: (v) => {
        value = v;
        sw.style.background = v || 'transparent';
        sw.classList.toggle('none', !v);
        onPick(v);
      },
    });
  });
  return b;
}

function numCtl(value, { min, max, step, tip, unit, onSet }) {
  const input = h('input', { value: String(value), 'aria-label': tip });
  const set = (v) => {
    v = Math.max(min, Math.min(max, Math.round(v * 10) / 10));
    input.value = String(v);
    onSet(v);
  };
  const dec = keepFocus(h('button', { html: icon('minus'), 'aria-label': 'Decrease', onclick: () => set((parseFloat(input.value) || value) - step) }));
  const inc = keepFocus(h('button', { html: icon('plus'), 'aria-label': 'Increase', onclick: () => set((parseFloat(input.value) || value) + step) }));
  input.addEventListener('change', () => { const v = parseFloat(input.value); if (!Number.isNaN(v)) set(v); else input.value = String(value); });
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { input.blur(); }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); set((parseFloat(input.value) || value) + (e.key === 'ArrowUp' ? step : -step)); }
  });
  const wrap = h('div', { class: 'num-input', 'data-tip': tip }, dec, input, inc);
  if (unit) wrap.title = unit;
  return wrap;
}

function rangeCtl(text, value, min, max, step, fmt, onInput) {
  const out = h('output', { text: fmt(value) });
  const r = h('input', { type: 'range', min, max, step, value });
  r.addEventListener('input', () => { out.textContent = fmt(+r.value); onInput(+r.value, true); });
  r.addEventListener('change', () => onInput(+r.value, false));
  return h('label', { class: 'range' }, text, r, out);
}

function hint(html) { return h('div', { class: 'hint', html }); }

function objectActions(o) {
  const out = [sep()];
  if (o.type !== 'textedit') {
    out.push(group(
      iconBtn('bring-front', 'Bring to front', false, () => arrange('front')),
      iconBtn('send-back', 'Send to back', false, () => arrange('back')),
      iconBtn('copy', 'Duplicate  Ctrl+D', false, () => duplicateSelected()),
    ));
  }
  out.push(h('span', { style: { width: '4px' } }), group(iconBtn('trash', o.type === 'textedit' ? 'Delete this text  Del' : 'Delete  Del', false, () => deleteSelected())));
  return out;
}

// ------------------------------------------------------------------ render
export function renderProps() {
  const c = context();
  const v = values(c);
  const kids = [];
  switch (c.kind) {
    case 'hint-select':
      kids.push(hint(`${icon('info')}<span><b>Select</b> an object to change it · <b>double-click</b> text to edit · <kbd>Del</kbd> removes · pick a tool above to add content</span>`));
      break;
    case 'hint-edittext':
      kids.push(hint(`${icon('edit-text')}<span><b>Click</b> any text in the document to edit it · <b>drag</b> a line to move it · click a line, press <kbd>Esc</kbd> then <kbd>Del</kbd> to remove it</span>`));
      break;
    case 'placing':
      kids.push(hint(`${icon('image')}<span><b>Click</b> on a page to place it · <kbd>Esc</kbd> to cancel</span>`));
      break;
    case 'text': {
      const fam = getFamily(v.family)?.family || v.family || 'Arial';
      const fb = h('button', { class: 'select-btn font-btn', 'data-tip': 'Font' }, h('span', { text: fam, style: { fontFamily: cssFamily(fam) } }), h('span', { html: icon('chevron-down') }));
      fb.addEventListener('click', () => fontPicker(fb, fam, (f) => { apply({ family: f }); renderProps(); }));
      kids.push(fb);
      kids.push(numCtl(v.size || 12, { min: 4, max: 400, step: 1, tip: 'Font size (pt)', onSet: (n) => apply({ size: n }) }));
      kids.push(sep());
      const boldOk = hasVariant(fam, 'b') || hasVariant(fam, 'bi');
      const italOk = hasVariant(fam, 'i') || hasVariant(fam, 'bi');
      const fmt = [
        iconBtn('bold', boldOk ? 'Bold  Ctrl+B' : 'This font has no bold style', v.bold, () => { apply({ bold: !v.bold }); renderProps(); }, !boldOk && !v.bold),
        iconBtn('italic', italOk ? 'Italic  Ctrl+I' : 'This font has no italic style', v.italic, () => { apply({ italic: !v.italic }); renderProps(); }, !italOk && !v.italic),
      ];
      if (!c.o || c.o.type === 'text') {
        fmt.push(iconBtn('underline-t', 'Underline  Ctrl+U', v.underline, () => { apply({ underline: !v.underline }); renderProps(); }));
      }
      kids.push(group(...fmt));
      kids.push(colorCtl(v.color || '#111827', (col) => apply({ color: col }), { tip: 'Text colour' }));
      if (!c.o || c.o.type === 'text') {
        kids.push(sep());
        kids.push(group(
          iconBtn('align-left', 'Align left', (v.align || 'left') === 'left', () => { apply({ align: 'left' }); renderProps(); }),
          iconBtn('align-center', 'Align centre', v.align === 'center', () => { apply({ align: 'center' }); renderProps(); }),
          iconBtn('align-right', 'Align right', v.align === 'right', () => { apply({ align: 'right' }); renderProps(); }),
        ));
      }
      if (c.o) kids.push(...objectActions(c.o));
      else kids.push(sep(), hint('<span><b>Click</b> anywhere on a page to add text</span>'));
      break;
    }
    case 'mark': {
      const t = c.o ? c.o.type : c.opt;
      kids.push(colorCtl(v.color, (col) => apply({ color: col }), { palette: t === 'highlight' ? HIGHLIGHTS : undefined, label: 'Colour' }));
      kids.push(rangeCtl('Opacity', Math.round((v.opacity ?? 1) * 100), 10, 100, 5, (n) => `${n}%`, (n, live) => apply({ opacity: n / 100 }, live)));
      if (c.o) kids.push(...objectActions(c.o));
      else kids.push(sep(), hint(`<span><b>Drag across text</b> to ${t === 'highlight' ? 'highlight it (or drag a box anywhere)' : t === 'strike' ? 'strike it through' : 'underline it'}</span>`));
      break;
    }
    case 'draw':
      kids.push(colorCtl(v.color, (col) => apply({ color: col }), { label: 'Colour' }));
      kids.push(rangeCtl('Thickness', v.width, 0.5, 20, 0.5, (n) => `${n} pt`, (n, live) => apply({ width: n }, live)));
      kids.push(rangeCtl('Opacity', Math.round((v.opacity ?? 1) * 100), 10, 100, 5, (n) => `${n}%`, (n, live) => apply({ opacity: n / 100 }, live)));
      if (c.o) kids.push(...objectActions(c.o));
      else kids.push(sep(), hint('<span><b>Draw</b> freehand on any page</span>'));
      break;
    case 'shape': {
      if (!c.o) {
        const cur = S.shape;
        kids.push(group(
          iconBtn('rect', 'Rectangle', cur === 'rect', () => { setTool('shape', 'rect'); }),
          iconBtn('ellipse', 'Ellipse', cur === 'ellipse', () => { setTool('shape', 'ellipse'); }),
          iconBtn('line', 'Line', cur === 'line', () => { setTool('shape', 'line'); }),
          iconBtn('arrow', 'Arrow', cur === 'arrow', () => { setTool('shape', 'arrow'); }),
        ), sep());
      }
      const lineLike = c.o ? ['line', 'arrow'].includes(c.o.type) : ['line', 'arrow'].includes(S.shape);
      kids.push(colorCtl(v.stroke, (col) => apply({ stroke: col }), { label: 'Stroke', allowNone: !lineLike }));
      if (!lineLike) kids.push(colorCtl(v.fill, (col) => apply({ fill: col }), { label: 'Fill', allowNone: true }));
      kids.push(rangeCtl('Width', v.width, 0.5, 20, 0.5, (n) => `${n} pt`, (n, live) => apply({ width: n }, live)));
      kids.push(rangeCtl('Opacity', Math.round((v.opacity ?? 1) * 100), 10, 100, 5, (n) => `${n}%`, (n, live) => apply({ opacity: n / 100 }, live)));
      if (c.o) kids.push(...objectActions(c.o));
      break;
    }
    case 'whiteout':
      kids.push(colorCtl(v.fill || '#ffffff', (col) => apply({ fill: col }), { label: 'Fill' }));
      if (c.o) kids.push(...objectActions(c.o));
      else kids.push(sep(), hint('<span><b>Drag</b> over anything to cover it up (text, images, signatures…)</span>'));
      break;
    case 'note':
      kids.push(colorCtl(v.color, (col) => apply({ color: col }), { label: 'Colour', palette: HIGHLIGHTS }));
      if (c.o) {
        const o = c.o;
        const b = h('button', { class: 'btn btn-soft sm', html: icon('note') }, 'Edit comment');
        b.addEventListener('click', () => openNote(S.sel.pageId, o));
        kids.push(sep(), b, ...objectActions(o));
      } else kids.push(sep(), hint('<span><b>Click</b> on a page to add a sticky-note comment</span>'));
      break;
    case 'image':
      kids.push(hint(`${icon('image')}<span>Drag to move · drag corners to resize (hold <kbd>Shift</kbd> to stretch)</span>`));
      kids.push(...objectActions(c.o));
      break;
    default:
      if (c.o) kids.push(...objectActions(c.o));
  }
  bar.textContent = '';
  bar.append(...kids);
  hydrateIcons(bar);
}

on('selection', renderProps);
on('tool', renderProps);
on('restore', renderProps);
on('editing', renderProps);
on('format-key', (k) => {
  const c = context();
  if (c.kind !== 'text') return;
  const v = values(c);
  if (k === 'b') apply({ bold: !v.bold }, true);
  if (k === 'i') apply({ italic: !v.italic }, true);
  if (k === 'u' && (!c.o || c.o.type === 'text')) apply({ underline: !v.underline }, true);
  renderProps();
});
