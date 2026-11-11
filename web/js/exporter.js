// Serialises the editing state and asks the server to produce the final PDF.
import { S, setDirty } from './state.js';
import { api } from './api.js';
import { TEXT_LH } from './overlay.js';
import { cssFamily, measureBaseline, ensureLoaded } from './fonts.js';
import { toast, busy, openModal, h } from './ui.js';

function ser(o, images) {
  switch (o.type) {
    case 'text': {
      if (!o.text || !o.text.trim()) return null;
      const css = cssFamily(o.family);
      const lh = o.lh || TEXT_LH;
      return {
        type: 'text', x: o.x, y: o.y, rot: o.rot || 0, text: o.text, family: o.family,
        bold: !!o.bold, italic: !!o.italic, size: o.size, color: o.color, align: o.align || 'left',
        lh, underline: !!o.underline, strike: !!o.strike, opacity: o.opacity ?? 1,
        base: measureBaseline(css, o.bold, o.italic, o.size, lh),
      };
    }
    case 'textedit':
      return {
        type: 'textedit', hide: o.hide, x: o.x + o.dx, y: o.y + o.dy,
        runs: o.runs.map((r) => ({ t: r.t, fid: r.fid, family: r.family, bold: !!r.bold, italic: !!r.italic, size: r.size, color: r.color })),
      };
    case 'image':
      if (!S.images[o.img]) return null;
      images[o.img] = S.images[o.img].url;
      return { ...o };
    default:
      return { ...o };
  }
}

export async function buildSpec(pageIds) {
  const pages = pageIds ? S.pages.filter((p) => pageIds.includes(p.id)) : S.pages;
  const texts = pages.flatMap((p) => (S.objects[p.id] || []).filter((o) => o.type === 'text'));
  await Promise.all(texts.map((o) => ensureLoaded(cssFamily(o.family), o.bold, o.italic)));
  const images = {};
  const out = pages.map((p) => {
    const fields = S.fields[p.id] ? Object.entries(S.fields[p.id]).map(([key, value]) => ({ key, value })) : null;
    return {
      doc: p.doc, index: p.index, w: p.w, h: p.h, rot: p.rot,
      objects: (S.objects[p.id] || []).map((o) => ser(o, images)).filter(Boolean),
      fields,
    };
  });
  return { pages: out, images };
}

export function pdfName(name) {
  let n = (name || S.fileName || 'document').trim() || 'document';
  n = n.replace(/[\\/:*?"<>|]+/g, '-');
  if (!/\.pdf$/i.test(n)) n += '.pdf';
  return n;
}

function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}

export const canSaveAs = () => typeof window.showSaveFilePicker === 'function';

/**
 * mode: 'download' | 'saveas'
 */
export async function savePdf({ mode = 'download', password = null, pageIds = null, name = null } = {}) {
  if (!S.pages.length) return false;
  const fname = pdfName(name);
  let handle = null;
  if (mode === 'saveas' && canSaveAs()) {
    try {
      handle = await window.showSaveFilePicker({
        suggestedName: fname,
        types: [{ description: 'PDF document', accept: { 'application/pdf': ['.pdf'] } }],
      });
    } catch (e) {
      if (e.name === 'AbortError') return false;
      handle = null;
    }
  }
  const done = busy(pageIds ? 'Extracting pages…' : 'Preparing your PDF…');
  try {
    const spec = await buildSpec(pageIds);
    spec.options = { password: password || null };
    const blob = await api.exportPdf(spec);
    if (handle) {
      const w = await handle.createWritable();
      await w.write(blob);
      await w.close();
      toast(`Saved “${handle.name}”`, 'ok');
    } else {
      downloadBlob(blob, fname);
      toast(`Downloaded “${fname}”`, 'ok');
    }
    if (!pageIds) setDirty(false);
    return true;
  } catch (e) {
    toast(e.message || 'Could not create the PDF', 'err', 6000);
    return false;
  } finally {
    done();
  }
}

export async function protectDialog() {
  const pw = h('input', { class: 'text-input', type: 'password', placeholder: 'Password', autocomplete: 'new-password' });
  const pw2 = h('input', { class: 'text-input', type: 'password', placeholder: 'Repeat password', autocomplete: 'new-password' });
  const err = h('div', { class: 'input-error' });
  const content = h('div', {},
    h('p', { text: 'Anyone opening the downloaded PDF will need this password. Encryption: AES-256.' }),
    h('div', { class: 'field-row' }, h('label', { text: 'Password' }), pw),
    h('div', { class: 'field-row' }, h('label', { text: 'Confirm password' }), pw2), err);
  const res = await openModal({
    title: 'Protect with password', content,
    actions: [
      { label: 'Cancel', value: null },
      {
        label: 'Download protected PDF', cls: 'btn-primary', icon: 'lock', primary: true,
        handler: () => {
          if (pw.value.length < 1) { err.textContent = 'Please enter a password.'; return false; }
          if (pw.value !== pw2.value) { err.textContent = 'The passwords do not match.'; return false; }
          return pw.value;
        },
      },
    ],
  });
  if (res) await savePdf({ mode: canSaveAs() ? 'saveas' : 'download', password: res });
}

export async function extractPages(ids) {
  if (!ids || !ids.length) { toast('Select pages in the sidebar first', 'info'); return; }
  const base = pdfName().replace(/\.pdf$/i, '');
  const nums = ids.map((id) => S.pages.findIndex((p) => p.id === id) + 1).sort((a, b) => a - b);
  const label = nums.length === 1 ? `page ${nums[0]}` : `pages ${nums[0]}-${nums[nums.length - 1]}`;
  await savePdf({ mode: canSaveAs() ? 'saveas' : 'download', pageIds: ids, name: `${base} (${label}).pdf` });
}
