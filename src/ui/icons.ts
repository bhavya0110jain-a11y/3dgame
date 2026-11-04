/** Inline SVG icons (24x24 viewBox, currentColor). */
const P: Record<string, string> = {
  bolt: '<path d="M13 2 4 14h6l-1 8 9-12h-6z"/>',
  halo: '<circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="5" r="2.5"/><circle cx="18" cy="15.5" r="2.5"/><circle cx="6" cy="15.5" r="2.5"/>',
  nova: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="3 2"/>',
  spark: '<path d="M4 4l6 6-3 1 7 9-2-6 3-1z"/><path d="M14 3l3 4-2 1 4 4" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  lance: '<path d="M2 12h16l4-3v6l-4-3" stroke="currentColor" stroke-width="2.5" fill="currentColor"/>',
  fire: '<path d="M12 2c1 4 6 6 6 12a6 6 0 0 1-12 0c0-3 2-4 2-7 2 1 2 3 2 3s2-3 2-8z"/>',
  frost: '<path d="M12 2v20M3 7l18 10M21 7 3 17" stroke="currentColor" stroke-width="2" fill="none"/><circle cx="12" cy="12" r="2"/>',
  wick: '<path d="M12 1.5c1.7 2.4 3.2 4 3.2 6.1a3.2 3.2 0 0 1-6.4 0c0-2.1 1.5-3.7 3.2-6.1z"/><path d="M8.3 11.5h7.4v8.5H8.3z"/><path d="M4.5 20h15v2.5h-15z"/>',
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
  // gameplay-agent additions: new weapons / relics
  hook: '<path d="M14 3a6 6 0 0 1 0 12h-2v-3l-5 4.5L12 21v-3h2a9 9 0 0 0 0-18z"/><circle cx="7" cy="6" r="2.5"/>',
  moth: '<path d="M12 6c-1.2 0-1.6 1.2-1.6 3v8c0 1.5.7 3 1.6 3s1.6-1.5 1.6-3V9c0-1.8-.4-3-1.6-3z"/><path d="M10.5 10C7 4 2 5 3 10s5 4 7.5 3zM13.5 10C17 4 22 5 21 10s-5 4-7.5 3zM10.5 14C7 15 5 19 7.5 20s3-3 3-5zM13.5 14c3.5 1 5.5 5 3 6s-3-3-3-5z"/>',
  bell: '<path d="M12 2a1.5 1.5 0 0 1 1.5 1.5v.7A6 6 0 0 1 18 10v4l2 3H4l2-3v-4a6 6 0 0 1 4.5-5.8v-.7A1.5 1.5 0 0 1 12 2z"/><circle cx="12" cy="20" r="2"/>',
  beam: '<circle cx="5" cy="19" r="3"/><path d="M7 16 21 3l-2 6-9 9z"/>',
  mirror: '<circle cx="12" cy="9" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M9 7a4 4 0 0 1 4-2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M11 16h2v6h-2z"/>',
  hourglass: '<path d="M6 2h12v2l-4.5 8L18 20v2H6v-2l4.5-8L6 4z"/>',
};

// UI chrome icons (ui-programmer)
Object.assign(P, {
  trophy: '<path d="M7 3h10v2h3.5v2.5A4.5 4.5 0 0 1 16.4 12a5 5 0 0 1-3.4 2.8V18h3v3H8v-3h3v-3.2A5 5 0 0 1 7.6 12 4.5 4.5 0 0 1 3.5 7.5V5H7zm0 4H5.5v.5A2.5 2.5 0 0 0 7.2 9.9 7 7 0 0 1 7 8.5zm10 0v1.5a7 7 0 0 1-.2 1.4 2.5 2.5 0 0 0 1.7-2.4V7z"/>',
  gear: '<path d="M10.3 2h3.4l.5 2.6 1.7.8 2.2-1.5 2.4 2.4-1.5 2.2.8 1.7 2.6.5v3.4l-2.6.5-.8 1.7 1.5 2.2-2.4 2.4-2.2-1.5-1.7.8-.5 2.6h-3.4l-.5-2.6-1.7-.8-2.2 1.5-2.4-2.4 1.5-2.2-.8-1.7L2 13.7v-3.4l2.6-.5.8-1.7-1.5-2.2 2.4-2.4 2.2 1.5 1.7-.8zM12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z"/>',
  gamepad: '<path d="M7 6.5h10a5 5 0 0 1 4.9 5.9l-.9 4.7a2.4 2.4 0 0 1-4.1 1.2L14.6 16H9.4l-2.3 2.3A2.4 2.4 0 0 1 3 17.1l-.9-4.7A5 5 0 0 1 7 6.5zm.5 3v1.8H5.7v1.4h1.8v1.8h1.4v-1.8h1.8v-1.4H8.9V9.5zm8.6.2a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 0 0 0-2.2zm2.2 2.3a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 0 0 0-2.2z"/>',
  keyboard: '<path d="M4 5.5h16A2.5 2.5 0 0 1 22.5 8v8a2.5 2.5 0 0 1-2.5 2.5H4A2.5 2.5 0 0 1 1.5 16V8A2.5 2.5 0 0 1 4 5.5zM5 8.5v2h2v-2zm3.5 0v2h2v-2zm3.5 0v2h2v-2zm3.5 0v2h2v-2zM5 12v2h2v-2zm3.5 0v2h2v-2zm3.5 0v2h2v-2zm3.5 0v2h2v-2zM7.5 15.3v1.4h9v-1.4z"/>',
  back: '<path d="M15 4.5 7.5 12l7.5 7.5" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>',
  next: '<path d="M9 4.5 16.5 12 9 19.5" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>',
  play: '<path d="M7 4.6v14.8a1.2 1.2 0 0 0 1.8 1l11.8-7.4a1.2 1.2 0 0 0 0-2L8.8 3.6A1.2 1.2 0 0 0 7 4.6z"/>',
  check: '<path d="M4 12.5 9.5 18 20 6.5" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>',
  cross: '<path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round"/>',
  moon: '<path d="M15.5 2.5A9.6 9.6 0 1 0 21.5 15a7.6 7.6 0 0 1-6-12.5z"/>',
  sparkle: '<path d="M11 2c.6 4.6 2.4 6.9 7 8-4.6 1.1-6.4 3.4-7 8-.6-4.6-2.4-6.9-7-8 4.6-1.1 6.4-3.4 7-8z"/><path d="M19 14c.3 2 1 3 3 3.5-2 .5-2.7 1.5-3 3.5-.3-2-1-3-3-3.5 2-.5 2.7-1.5 3-3.5z"/>',
  reroll: '<path d="M20 11A8 8 0 0 0 5.7 6.1L3.5 4v6.5H10L7.6 8.1A5.2 5.2 0 0 1 17.2 11zM4 13a8 8 0 0 0 14.3 4.9l2.2 2.1v-6.5H14l2.4 2.4A5.2 5.2 0 0 1 6.8 13z"/>',
  skip: '<path d="M3.5 5.5v13l8.5-6.5zM12 5.5v13l8.5-6.5z"/>',
  banish: '<path d="M12 2.5a9.5 9.5 0 1 0 0 19 9.5 9.5 0 0 0 0-19zm0 3a6.5 6.5 0 0 1 5.2 10.4L8.1 6.8A6.5 6.5 0 0 1 12 5.5zm-5.2 2.6 9.1 9.1A6.5 6.5 0 0 1 6.8 8.1z"/>',
  sound: '<path d="M3 9h4l5-4.5v15L7 15H3z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.2 5.8a8.8 8.8 0 0 1 0 12.4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  display: '<path d="M4 3.5h16A2 2 0 0 1 22 5.5v10a2 2 0 0 1-2 2h-6.5V19H17v2H7v-2h3.5v-1.5H4a2 2 0 0 1-2-2v-10a2 2 0 0 1 2-2zm.5 3v8.5h15V6.5z"/>',
  access: '<circle cx="12" cy="4.3" r="2.4"/><path d="M4 8.3l8 1.6 8-1.6M12 9.9v5.3l-3.2 6.3M12 15.2l3.2 6.3" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>',
  touch: '<path d="M9 11V4.6a1.6 1.6 0 0 1 3.2 0V10h.4V8.6a1.6 1.6 0 0 1 3.2 0V11h.3V9.9a1.6 1.6 0 0 1 3.2 0V15a7 7 0 0 1-7 7h-.7a6 6 0 0 1-4.6-2.2L3.4 16a1.6 1.6 0 0 1 2.4-2.1L9 16.4z"/>',
  crown: '<path d="M2.5 7.5 7.2 11 12 3.5 16.8 11l4.7-3.5L19.5 19h-15zM5 20.5h14V22H5z"/>',
  scroll: '<path d="M6.5 3H18a3 3 0 0 1 3 3v1.5h-3.5V18a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3v-1.5h3.5V5A2 2 0 0 1 6.5 3zM8 8v1.6h7V8zm0 3.4V13h7v-1.6z"/>',
  warning: '<path d="M12 2.5 23 21.5H1zM10.8 9v6.5h2.4V9zm0 8v2.3h2.4V17z"/>',
  fullscreen: '<path d="M3 3h7v2.6H5.6V10H3zM14 3h7v7h-2.6V5.6H14zM3 14h2.6v4.4H10V21H3zM18.4 14H21v7h-7v-2.6h4.4z"/>',
  home: '<path d="M12 3 2.5 11.5h2.8V21h5v-6h3.4v6h5v-9.5h2.8z"/>',
  hearth: '<path fill-rule="evenodd" d="M2 21.5V10.2L12 2.5l10 7.7v11.3zM6.5 21.5v-5.2a5.5 5.5 0 0 1 11 0v5.2z"/><path d="M12 12.6c1.4 1.8 2.6 3.2 2.6 5a2.6 2.6 0 0 1-5.2 0c0-1.8 1.2-3.2 2.6-5z"/>',
});

// Sprint 2 UI icons (reliquary, dawn, rarity shapes for colour-blind-safe cues)
Object.assign(P, {
  sun: '<circle cx="12" cy="12" r="4.6"/><path d="M12 1.5v3.2M12 19.3v3.2M1.5 12h3.2M19.3 12h3.2M4.6 4.6l2.3 2.3M17.1 17.1l2.3 2.3M4.6 19.4l2.3-2.3M17.1 6.9l2.3-2.3" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" fill="none"/>',
  chest: '<path d="M3 10.5V8a5 5 0 0 1 5-5h8a5 5 0 0 1 5 5v2.5z"/><path d="M3 12h18v7.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 19.5zm7 1.5v3.2h4v-3.2z"/>',
  'rar-weapon': '<path d="M12 2.5 21.5 12 12 21.5 2.5 12z"/>',
  'rar-relic': '<circle cx="12" cy="12" r="8.5"/>',
  'rar-evo': '<path d="M12 1.5l3.1 7.1 7.4.6-5.6 4.9 1.7 7.4L12 17.6l-6.6 3.9 1.7-7.4-5.6-4.9 7.4-.6z"/>',
  'rar-boon': '<path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"/>',
  'rar-ash': '<path d="M12 2 20.7 7v10L12 22l-8.7-5V7z"/>',
  stick: '<circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="5"/><path d="M12 .8 9.8 3.2h4.4zM12 23.2l-2.2-2.4h4.4zM.8 12l2.4-2.2v4.4zM23.2 12l-2.4-2.2v4.4z"/>',
});

// Sprint 3: evolved weapons get their own glyphs (data keeps the base weapon's icon; the UI maps evolution id → glyph)
Object.assign(P, {
  // three sun-forged spears fanned out under a small sun
  'evo-sunspear': '<path d="M4 20 15.5 8.5M2.5 13.5l7-7M10.5 21.5l7-7" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" fill="none"/><path d="M21.5 2.5l-8.2 3.4 4.8 4.8zM14 2.2 7.8 4.6l3.4 3.4zM21.8 10l-2.4 6.2-3.4-3.4z"/>',
  // a sun ringed by a crown of smaller suns
  'evo-crown': '<circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="8.2" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="3.4" r="2.1"/><circle cx="19.4" cy="7.7" r="2.1"/><circle cx="19.4" cy="16.3" r="2.1"/><circle cx="12" cy="20.6" r="2.1"/><circle cx="4.6" cy="16.3" r="2.1"/><circle cx="4.6" cy="7.7" r="2.1"/>',
  // half sun breaking over the horizon, with rays
  'evo-dawn': '<path d="M5.5 17a6.5 6.5 0 0 1 13 0z"/><path d="M1.5 18.5h21V21h-21z"/><path d="M12 3v4M4.2 6.6l2.6 2.8M19.8 6.6l-2.6 2.8M1.8 12.6l3.4 1M22.2 12.6l-3.4 1" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" fill="none"/>',
  // three lightning forks
  'evo-tempest': '<path d="M12.5 1.5 7 11.5h4l-2 11 7.5-12.5h-4.2z"/><path d="M5.5 3 2 9.5h2.6L3.4 15l4.4-7H5.3z" opacity=".8"/><path d="M19.5 3 16 9.5h2.6L17.4 15l4.4-7h-2.5z" opacity=".8"/>',
  // four rays of light from a bright core
  'evo-beacon': '<path d="M12 .8l1.9 8.3 8.3 2.9-8.3 2.9L12 23.2l-1.9-8.3L1.8 12l8.3-2.9z"/><circle cx="12" cy="12" r="2.4" fill="#fff" opacity=".7"/>',
  // a garden of three flames
  'evo-pyre': '<path d="M12 3c.8 3 4.6 4.6 4.6 9.2a4.6 4.6 0 0 1-9.2 0c0-2.3 1.5-3 1.5-5.3 1.5.8 1.5 2.3 1.5 2.3S12 7 12 3z"/><path d="M5 10c.5 2 3 3 3 6a3 3 0 0 1-6 0c0-1.5 1-2 1-3.5 1 .5 1 1.5 1 1.5S5 12.5 5 10zM19 10c.5 2 3 3 3 6a3 3 0 0 1-6 0c0-1.5 1-2 1-3.5 1 .5 1 1.5 1 1.5s1-1.5 1-4z" opacity=".8"/><path d="M2 21h20v1.8H2z"/>',
  // a crystal heart of rime
  'evo-glacier': '<path d="M12 21.5 3.2 12.4A5.1 5.1 0 0 1 12 6.3a5.1 5.1 0 0 1 8.8 6.1z"/><path d="M12 8.5v10M8 11.5l8 4M16 11.5l-8 4" stroke="#fff" stroke-width="1.3" opacity=".75" fill="none"/>',
});

export function icon(name: string, cls = ''): string {
  const body = P[name] ?? P.star;
  return `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${body}</svg>`;
}
