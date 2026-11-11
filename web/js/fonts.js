// Installed-font registry. Every family is exposed to CSS as "ff<id>" using
// local() (no download) with the server's copy of the very same file as fallback,
// so on-screen text and exported text use identical font files.
import { api } from './api.js';

let families = [];
const byName = new Map();
const pdfFaces = new Set();
let styleEl = null;

const esc = (s) => String(s).replace(/["\\]/g, '');

export async function loadFonts() {
  try {
    const res = await api.fonts();
    families = res.families || [];
  } catch (e) {
    families = [];
  }
  let css = '';
  for (const f of families) {
    byName.set(f.family.toLowerCase(), f);
    for (const [v, info] of Object.entries(f.variants)) {
      const weight = v.includes('b') ? 700 : 400;
      const style = v.includes('i') ? 'italic' : 'normal';
      const src = [info.full, info.ps].filter(Boolean).map((n) => `local("${esc(n)}")`);
      src.push(`url("/api/fontfile/${f.id}/${v}")`);
      css += `@font-face{font-family:"ff${f.id}";font-weight:${weight};font-style:${style};src:${src.join(',')};font-display:block}\n`;
    }
  }
  styleEl = document.createElement('style');
  styleEl.textContent = css;
  document.head.appendChild(styleEl);
}

export const fontList = () => families;
export const getFamily = (name) => byName.get(String(name || '').toLowerCase()) || null;
export function hasVariant(name, v) {
  const f = getFamily(name);
  return !!(f && f.variants[v]);
}
export function defaultFamily() {
  return getFamily('Arial')?.family || families[0]?.family || 'Arial';
}

/** CSS font-family stack for an installed family name. */
export function cssFamily(name) {
  const f = getFamily(name) || getFamily('Arial') || families[0];
  return f ? `"ff${f.id}", "${esc(f.family)}", sans-serif` : `"${esc(name)}", sans-serif`;
}

/** Register (once) a font embedded in a PDF so the browser can preview with it. */
export function pdfFontCss(doc, fid) {
  const key = `pf_${doc}_${fid}`;
  if (!pdfFaces.has(key)) {
    pdfFaces.add(key);
    try {
      styleEl.sheet.insertRule(`@font-face{font-family:"${key}";src:url("/api/docs/${doc}/fonts/${fid}");font-display:block}`, styleEl.sheet.cssRules.length);
    } catch (e) { /* ignore */ }
  }
  return `"${key}"`;
}

export function runFontCss(run, doc) {
  const fam = cssFamily(run.family);
  return run.pf && doc ? `${pdfFontCss(doc, run.pf)}, ${fam}` : fam;
}

// --------------------------------------------------------------- measuring
let meas = null;
function measurer() {
  if (!meas) {
    meas = document.createElement('div');
    meas.style.cssText = 'position:absolute;left:-10000px;top:0;visibility:hidden;white-space:pre;'
      + 'font-kerning:none;font-synthesis:none;font-variant-ligatures:none;padding:0;margin:0;border:0';
    meas.innerHTML = '<span style="display:inline-block;width:0;height:0;vertical-align:baseline"></span><span>Hg</span>';
    document.body.appendChild(meas);
  }
  return meas;
}

/** Distance (pt) from the top of a text box to the first baseline. */
export function measureBaseline(fontCss, bold, italic, size, lh) {
  const m = measurer();
  m.style.fontFamily = fontCss;
  m.style.fontWeight = bold ? '700' : '400';
  m.style.fontStyle = italic ? 'italic' : 'normal';
  m.style.fontSize = `${size}px`;
  m.style.lineHeight = String(lh);
  const r0 = m.getBoundingClientRect();
  const r1 = m.firstChild.getBoundingClientRect();
  return r1.top - r0.top;
}

export async function ensureLoaded(fontCss, bold, italic) {
  try {
    await document.fonts.load(`${italic ? 'italic ' : ''}${bold ? '700 ' : '400 '}16px ${fontCss}`);
  } catch (e) { /* ignore */ }
}
