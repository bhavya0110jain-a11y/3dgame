/** Inline SVG icons (24x24 viewBox, currentColor). */
const P: Record<string, string> = {
  bolt: '<path d="M13 2 4 14h6l-1 8 9-12h-6z"/>',
  halo: '<circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="5" r="2.5"/><circle cx="18" cy="15.5" r="2.5"/><circle cx="6" cy="15.5" r="2.5"/>',
  nova: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="3 2"/>',
  spark: '<path d="M4 4l6 6-3 1 7 9-2-6 3-1z"/><path d="M14 3l3 4-2 1 4 4" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  lance: '<path d="M2 12h16l4-3v6l-4-3" stroke="currentColor" stroke-width="2.5" fill="currentColor"/>',
  fire: '<path d="M12 2c1 4 6 6 6 12a6 6 0 0 1-12 0c0-3 2-4 2-7 2 1 2 3 2 3s2-3 2-8z"/>',
  frost: '<path d="M12 2v20M3 7l18 10M21 7 3 17" stroke="currentColor" stroke-width="2" fill="none"/><circle cx="12" cy="12" r="2"/>',
  wick: '<path d="M10 9h4v12h-4z"/><path d="M12 2c1 2 2 3 2 4.5a2 2 0 0 1-4 0C10 5 11 4 12 2z"/>',
  oil: '<path d="M9 3h6v3l3 4v10a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V10l3-4z"/>',
  boots: '<path d="M7 3h5v10l7 3v4H5V3z"/>',
  flint: '<path d="M12 2 20 9l-4 13H8L4 9z"/>',
  bellows: '<path d="M4 6l10-3 2 18-12-3z"/><path d="M16 11h6" stroke="currentColor" stroke-width="2"/>',
  clock: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 6v6l4 3" stroke="currentColor" stroke-width="2" fill="none"/>',
  magnet: '<path d="M5 3h4v9a3 3 0 0 0 6 0V3h4v9a7 7 0 0 1-14 0z"/>',
  armor: '<path d="M12 2 4 5v6c0 5 3.5 9 8 11 4.5-2 8-6 8-11V5z"/>',
  quill: '<path d="M20 2C10 4 6 10 5 19l-2 3 3-1c9-1 14-6 14-19z"/>',
  twin: '<path d="M8 4c1 3 4 4 4 8a4 4 0 0 1-8 0c0-2 1-3 1-5 1 1 1 2 1 2s1-2 2-5z"/><path d="M16 6c1 3 4 4 4 8a4 4 0 0 1-8 0c0-2 1-3 1-5 1 1 1 2 1 2s1-2 2-5z" opacity=".7"/>',
  luck: '<circle cx="8" cy="8" r="4"/><circle cx="16" cy="8" r="4"/><circle cx="8" cy="16" r="4"/><circle cx="16" cy="16" r="4"/>',
  tome: '<path d="M4 3h12a3 3 0 0 1 3 3v15H7a3 3 0 0 1-3-3z"/>',
  ash: '<path d="M12 3 20 12 12 21 4 12z"/>',
  revive: '<path d="M12 21s-8-5-8-11a5 5 0 0 1 8-3 5 5 0 0 1 8 3c0 6-8 11-8 11z"/>',
  skull: '<path d="M12 2a8 8 0 0 0-8 8c0 3 2 5 3 6v3h10v-3c1-1 3-3 3-6a8 8 0 0 0-8-8z"/><circle cx="9" cy="10" r="2" fill="#000"/><circle cx="15" cy="10" r="2" fill="#000"/>',
  timer: '<circle cx="12" cy="13" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 9v4h3M9 2h6" stroke="currentColor" stroke-width="2" fill="none"/>',
  pause: '<path d="M6 4h4v16H6zM14 4h4v16h-4z"/>',
  star: '<path d="M12 2l3 7 7 .6-5.4 4.6L18 22l-6-3.8L6 22l1.4-7.8L2 9.6 9 9z"/>',
  lock: '<path d="M7 10V7a5 5 0 0 1 10 0v3h1v12H6V10zm2 0h6V7a3 3 0 0 0-6 0z"/>',
};

export function icon(name: string, cls = ''): string {
  const body = P[name] ?? P.star;
  return `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${body}</svg>`;
}
