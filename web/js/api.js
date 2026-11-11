// Thin client for the local server API.

async function req(url, opts = {}) {
  const res = await fetch(url, opts);
  if (!res.ok) {
    let body = {};
    try { body = await res.json(); } catch (e) { /* not json */ }
    const err = new Error(body.error || `Request failed (${res.status})`);
    Object.assign(err, body, { status: res.status });
    throw err;
  }
  return res;
}

export const api = {
  async upload(file, name) {
    const res = await req(`/api/docs?name=${encodeURIComponent(name || file.name || 'document.pdf')}`, {
      method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream' },
    });
    return res.json();
  },
  async unlock(pending, password) {
    const res = await req(`/api/unlock/${pending}`, {
      method: 'POST', body: JSON.stringify({ password }), headers: { 'Content-Type': 'application/json' },
    });
    return res.json();
  },
  async doc(id) { return (await req(`/api/docs/${id}`)).json(); },
  async fonts() { return (await req('/api/fonts')).json(); },
  async text(doc, index) { return (await req(`/api/docs/${doc}/pages/${index}/text`)).json(); },
  async fields(doc, index) { return (await req(`/api/docs/${doc}/pages/${index}/fields`)).json(); },
  async exportPdf(spec) {
    const res = await req('/api/export', {
      method: 'POST', body: JSON.stringify(spec), headers: { 'Content-Type': 'application/json' },
    });
    return res.blob();
  },
  renderUrl(doc, index, scale, hide, noWidgets, fmt) {
    let u = `/api/docs/${doc}/pages/${index}/render?s=${scale}`;
    if (hide) u += `&h=${hide}`;
    if (noWidgets) u += '&nw=1';
    if (fmt) u += `&f=${fmt}`;
    return u;
  },
  heartbeat() { return fetch('/api/heartbeat', { method: 'POST' }).catch(() => {}); },
  bye() { try { navigator.sendBeacon('/api/bye', ''); } catch (e) { /* ignore */ } },
};
