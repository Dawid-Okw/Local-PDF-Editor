// Small hand-drawn icon set (24×24, stroke based).
const P = {
  'select': '<path d="M5.5 3.5v15l4-4 3 6.5 2.6-1.2-3-6.3h5.6z"/>',
  'edit-text': '<path d="M3.5 7V5h11v2"/><path d="M9 5v14"/><path d="M7 19h4"/><path d="M18 9v11"/><path d="M16 9h4M16 20h4"/>',
  'text': '<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="M8 8.5h8M12 8.5V17"/>',
  'highlight': '<path d="M14.6 4.4a1.9 1.9 0 0 1 2.7 0l2.3 2.3a1.9 1.9 0 0 1 0 2.7L11 18H7.5L6 16.5V13z"/><path d="M6 13l5 5"/><path d="M4 21h8"/><path d="M6.5 16.5 4.2 19"/>',
  'underline': '<path d="M7 4v6a5 5 0 0 0 10 0V4"/><path d="M5 20h14"/>',
  'strike': '<path d="M16.5 6.5C15.8 5 14.1 4 12 4 9.5 4 7.5 5.4 7.5 7.5c0 1.5.9 2.5 2.6 3.2"/><path d="M4 12h16"/><path d="M7.6 16.8C8.2 18.7 10 20 12.3 20c2.6 0 4.4-1.4 4.4-3.5 0-.6-.1-1.1-.4-1.6"/>',
  'draw': '<path d="M4.5 19.5l1.2-4.4L15.4 5.4a2.1 2.1 0 0 1 3 3L8.7 18.2z"/><path d="M13.6 7.2l3.1 3.1"/>',
  'shapes': '<rect x="3.5" y="3.5" width="10" height="10" rx="1.6"/><circle cx="15.5" cy="15.5" r="5"/>',
  'rect': '<rect x="4" y="5.5" width="16" height="13" rx="1.8"/>',
  'ellipse': '<ellipse cx="12" cy="12" rx="8.5" ry="6.5"/>',
  'line': '<path d="M5 19 19 5"/>',
  'arrow': '<path d="M5 19 19 5"/><path d="M10 5h9v9"/>',
  'note': '<path d="M5 4h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-7.5L7 21v-4H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/><path d="M7.5 9h9M7.5 12.5h5.5"/>',
  'image': '<rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="m21 16-5-5-9.5 9"/>',
  'signature': '<path d="M3 16.5c2.4 0 3.6-9 6-9 2.1 0 .2 9.5 2.6 9.5 1.8 0 2.1-3.3 3.6-3.3 1.4 0 1.5 2.3 3 2.3H21"/><path d="M3 20.5h18"/>',
  'whiteout': '<path d="M20 20H10"/><path d="M4.7 15.3 14.5 5.5a2 2 0 0 1 2.8 0l2.2 2.2a2 2 0 0 1 0 2.8L11 19H8.3a2 2 0 0 1-1.4-.6l-2.2-2.2a.9.9 0 0 1 0-.9z"/><path d="m9.2 10.8 5 5"/>',
  'search': '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  'undo': '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  'redo': '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  'download': '<path d="M12 4v11"/><path d="m7 10.5 5 5 5-5"/><path d="M5 20h14"/>',
  'upload': '<path d="M12 16V5"/><path d="m7 9.5 5-5 5 5"/><path d="M5 20h14"/>',
  'folder': '<path d="M3.5 7.5a2 2 0 0 1 2-2h3.8l2 2h7.2a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  'file': '<path d="M7 3.5h7l4.5 4.5v11a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5z"/><path d="M13.5 3.5V8h5"/>',
  'file-plus': '<path d="M7 3.5h7l4.5 4.5v11a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5z"/><path d="M13.5 3.5V8h5"/><path d="M12 11v6M9 14h6"/>',
  'file-out': '<path d="M14 20.5H7A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5h7l4.5 4.5v4"/><path d="M13.5 3.5V8h5"/><path d="M15 17.5h6M18.5 15l2.5 2.5-2.5 2.5"/>',
  'pages': '<rect x="7" y="3.5" width="12" height="15" rx="2"/><path d="M4.5 7v11.5a2 2 0 0 0 2 2H15"/>',
  'form': '<rect x="3.5" y="4" width="17" height="16" rx="2.5"/><path d="M7 9h6M7 14.5h3.5"/><rect x="13.5" y="12.5" width="4" height="4" rx=".8"/>',
  'lock': '<rect x="5" y="10.5" width="14" height="10" rx="2.2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/><path d="M12 14.5v2.5"/>',
  'plus': '<path d="M12 5v14M5 12h14"/>',
  'minus': '<path d="M5 12h14"/>',
  'x': '<path d="M6 6l12 12M18 6 6 18"/>',
  'check': '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  'chevron-down': '<path d="m6 9.5 6 6 6-6"/>',
  'chevron-up': '<path d="m6 14.5 6-6 6 6"/>',
  'chevron-right': '<path d="m9.5 6 6 6-6 6"/>',
  'trash': '<path d="M4 7h16"/><path d="M9.5 7V4.8c0-.7.5-1.3 1.2-1.3h2.6c.7 0 1.2.6 1.2 1.3V7"/><path d="M6.5 7l.9 12a1.8 1.8 0 0 0 1.8 1.6h5.6a1.8 1.8 0 0 0 1.8-1.6l.9-12"/><path d="M10 11v5.5M14 11v5.5"/>',
  'copy': '<rect x="8.5" y="8.5" width="12" height="12" rx="2.2"/><path d="M15.5 8.5V6a2.2 2.2 0 0 0-2.2-2.2H6A2.2 2.2 0 0 0 3.8 6v7.3A2.2 2.2 0 0 0 6 15.5h2.5"/>',
  'rotate-cw': '<path d="M20 4.5v5h-5"/><path d="M19.4 9.5A8 8 0 1 0 20 14"/>',
  'rotate-ccw': '<path d="M4 4.5v5h5"/><path d="M4.6 9.5A8 8 0 1 1 4 14"/>',
  'bold': '<path d="M7.5 5h5.8a3.6 3.6 0 0 1 0 7.2H7.5z"/><path d="M7.5 12.2h6.6a3.6 3.6 0 0 1 0 7.3H7.5z"/>',
  'italic': '<path d="M10.5 5h7.5M6 19h7.5M14.3 5 9.7 19"/>',
  'underline-t': '<path d="M7 4.5v6a5 5 0 0 0 10 0v-6"/><path d="M5.5 20h13"/>',
  'strike-t': '<path d="M4.5 12h15"/><path d="M16 7.2C15.2 5.7 13.7 5 12 5c-2.4 0-4.2 1.2-4.2 3.2 0 1 .4 1.8 1.2 2.4"/><path d="M8 16.6c.7 1.5 2.3 2.4 4.3 2.4 2.5 0 4.2-1.2 4.2-3.2 0-.6-.1-1.1-.4-1.5"/>',
  'align-left': '<path d="M4 6h16M4 10h10M4 14h16M4 18h10"/>',
  'align-center': '<path d="M4 6h16M7 10h10M4 14h16M7 18h10"/>',
  'align-right': '<path d="M4 6h16M10 10h10M4 14h16M10 18h10"/>',
  'sidebar': '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M9.5 4.5v15"/>',
  'moon': '<path d="M19.5 14.8A8 8 0 0 1 9.2 4.5a8 8 0 1 0 10.3 10.3z"/>',
  'sun': '<circle cx="12" cy="12" r="4"/><path d="M12 2.8v2M12 19.2v2M2.8 12h2M19.2 12h2M5.5 5.5l1.4 1.4M17.1 17.1l1.4 1.4M5.5 18.5l1.4-1.4M17.1 6.9l1.4-1.4"/>',
  'keyboard': '<rect x="2.5" y="6" width="19" height="12.5" rx="2.5"/><path d="M6.5 10h.01M10 10h.01M14 10h.01M17.5 10h.01M8 14.5h8"/>',
  'help': '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.5a2.5 2.5 0 0 1 4.8 1c0 1.7-2.4 2-2.4 3.5"/><path d="M12 17h.01"/>',
  'more': '<circle cx="5.5" cy="12" r="1.1"/><circle cx="12" cy="12" r="1.1"/><circle cx="18.5" cy="12" r="1.1"/>',
  'fit-width': '<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M7 12h10M9 9.5 6.5 12 9 14.5M15 9.5l2.5 2.5-2.5 2.5"/>',
  'fit-page': '<rect x="6" y="3.5" width="12" height="17" rx="2"/><path d="M12 7v10M9.5 9 12 6.5 14.5 9M9.5 15l2.5 2.5 2.5-2.5"/>',
  'bring-front': '<path d="m12 3.5 8 4.3-8 4.3-8-4.3z" fill="currentColor" fill-opacity=".3"/><path d="m4 12.2 8 4.3 8-4.3" opacity=".55"/><path d="m4 16.4 8 4.3 8-4.3" opacity=".55"/>',
  'send-back': '<path d="m12 3.5 8 4.3-8 4.3-8-4.3z" opacity=".55"/><path d="m4 12.2 8 4.3 8-4.3" opacity=".55"/><path d="m4 16.4 8 4.3 8-4.3z" fill="currentColor" fill-opacity=".3"/>',
  'grip': '<path d="M12 4v16M4 12h16M12 4l-2.5 2.5M12 4l2.5 2.5M12 20l-2.5-2.5M12 20l2.5-2.5M4 12l2.5-2.5M4 12l2.5 2.5M20 12l-2.5-2.5M20 12l-2.5 2.5"/>',
  'info': '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8h.01"/>',
  'alert': '<path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4.5M12 17.3h.01"/>',
  'blank': '<rect x="5.5" y="3.5" width="13" height="17" rx="2"/>',
  'opacity': '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17" /><path d="M12 6h5M12 9h7.5M12 12h8.5M12 15h7.5M12 18h5"/>',
  'pen-width': '<path d="M4 7h16" stroke-width="1.2"/><path d="M4 12h16" stroke-width="2.4"/><path d="M4 17.5h16" stroke-width="3.6"/>',
};

export function icon(name, cls = '') {
  const body = P[name] || P['info'];
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
}

/** Replace every [data-icon] element inside root with its SVG. */
export function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => {
    if (el.dataset.iconDone === el.dataset.icon) return;
    const svg = icon(el.dataset.icon);
    if (el.tagName === 'I') {
      el.outerHTML = svg;
    } else {
      el.insertAdjacentHTML('afterbegin', svg);
      el.dataset.iconDone = el.dataset.icon;
    }
  });
}

export const NOTE_SVG = (color) => `<svg viewBox="0 0 24 24"><path d="M3 4.5A2.5 2.5 0 0 1 5.5 2h13A2.5 2.5 0 0 1 21 4.5v10a2.5 2.5 0 0 1-2.5 2.5H12l-5 4.5V17H5.5A2.5 2.5 0 0 1 3 14.5z" fill="${color}" stroke="rgba(0,0,0,.45)" stroke-width="1"/><path d="M7 7.5h10M7 11h7" stroke="rgba(0,0,0,.55)" stroke-width="1.5" stroke-linecap="round" fill="none"/></svg>`;
