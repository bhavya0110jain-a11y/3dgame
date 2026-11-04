/**
 * Procedural SVG art for the DOM UI (original "moonlit storybook" style): bearer portraits, night vignettes,
 * the lantern health gauge, the title emblem and input glyphs. Pure string builders — no DOM, no state.
 */

export const hex = (n: number): string => '#' + (n >>> 0).toString(16).padStart(6, '0').slice(-6);

/** Mixes two 0xRRGGBB colours (t = 0 → a, 1 → b). */
export function mix(a: number, b: number, t: number): string {
  const ch = (s: number) => [(s >> 16) & 255, (s >> 8) & 255, s & 255];
  const [r1, g1, b1] = ch(a);
  const [r2, g2, b2] = ch(b);
  const m = (x: number, y: number) => Math.round(x + (y - x) * t);
  return `rgb(${m(r1, r2)},${m(g1, g2)},${m(b1, b2)})`;
}

let uid = 0;

/** Hooded lantern-bearer bust tinted by robe + lantern colour. */
export function portrait(robe: number, light: number, locked = false): string {
  const id = `p${++uid}`;
  const robeHi = mix(robe, 0xffffff, 0.5);
  const robeLo = mix(robe, 0x1a1040, 0.1);
  const lightHex = hex(light);
  const lightSoft = mix(light, 0xffffff, 0.55);
  return `<svg class="portrait ${locked ? 'is-locked' : ''}" viewBox="0 0 120 120" aria-hidden="true">
  <defs>
    <radialGradient id="${id}bg" cx="70%" cy="72%" r="85%">
      <stop offset="0" stop-color="${lightHex}" stop-opacity=".95"/>
      <stop offset=".35" stop-color="${mix(light, 0x2a1e6e, 0.55)}"/>
      <stop offset="1" stop-color="#120e36"/>
    </radialGradient>
    <linearGradient id="${id}robe" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${robeHi}"/><stop offset="1" stop-color="${robeLo}"/>
    </linearGradient>
    <radialGradient id="${id}glow"><stop offset="0" stop-color="${lightSoft}"/><stop offset=".4" stop-color="${lightHex}" stop-opacity=".8"/><stop offset="1" stop-color="${lightHex}" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="120" height="120" fill="url(#${id}bg)"/>
  <circle cx="30" cy="28" r="13" fill="#eef0ff" opacity=".85"/>
  <circle cx="35" cy="25" r="11" fill="${mix(light, 0x2a1e6e, 0.55)}" opacity=".35"/>
  <path d="M14 120c2-26 12-40 22-46-4-10-5-20-1-31 5-14 17-22 27-22s22 8 27 22c4 11 3 21-1 31 10 6 20 20 22 46z" fill="url(#${id}robe)" stroke="#120a2a" stroke-width="3.5" stroke-linejoin="round"/>
  <path d="M44 66c-3-9-3-19 2-27 4-7 10-10 16-10s12 3 16 10c5 8 5 18 2 27-5 5-11 7-18 7s-13-2-18-7z" fill="#160d30"/>
  <ellipse cx="55" cy="54" rx="4" ry="5" fill="${lightSoft}"/><ellipse cx="69" cy="54" rx="4" ry="5" fill="${lightSoft}"/>
  <path d="M40 92c8 5 36 5 44 0" fill="none" stroke="${robeHi}" stroke-width="3" stroke-linecap="round" opacity=".7"/>
  <circle cx="94" cy="88" r="24" fill="url(#${id}glow)"/>
  <path d="M88 80h12l2 6v10l-2 5H88l-2-5V86z" fill="${lightSoft}" stroke="#2a1606" stroke-width="2.5" stroke-linejoin="round"/>
  <path d="M87 79h14M90 75h8" stroke="#2a1606" stroke-width="2.5" stroke-linecap="round"/>
  <path d="M94 84c2 3 3 5 3 7a3 3 0 0 1-6 0c0-2 1-4 3-7z" fill="#fff6d0"/>
  ${locked ? `<rect width="120" height="120" fill="#0b0820" opacity=".55"/>` : ''}
</svg>`;
}

/** Night vignette for biome cards: sky gradient, moon, distant skyline, ground. */
export function nightArt(sky: { zenith: number; mid: number; horizon: number; moonColor: number; moonGlow: number; skyline: string; skylineColor: number }, ground: number, glow: number): string {
  const id = `n${++uid}`;
  const sil = hex(sky.skylineColor);
  const near = mix(sky.skylineColor, 0x000000, 0.35);
  let skyline = '';
  if (sky.skyline === 'pines') {
    const trees = [[18, 58, 1], [40, 52, 1.3], [64, 60, 0.9], [150, 54, 1.25], [178, 60, 0.95], [205, 50, 1.4], [236, 58, 1]];
    skyline = trees.map(([x, y, s]) => `<path d="M${x} ${y - 30 * s}l${11 * s} ${18 * s}h-${5 * s}l${9 * s} ${14 * s}h-${30 * s}l${9 * s}-${14 * s}h-${5 * s}z" fill="${sil}"/>`).join('');
  } else if (sky.skyline === 'willows') {
    skyline = [[30, 1.1], [92, 0.8], [190, 1.3], [240, 0.9]].map(([x, s]) =>
      `<path d="M${x} ${70 - 38 * s}c${-22 * s} 0 ${-28 * s} ${16 * s} ${-26 * s} ${34 * s}l${6 * s}-${10 * s}l${4 * s} ${14 * s} ${6 * s}-${12 * s} ${6 * s} ${12 * s} ${4 * s}-${8 * s} ${4 * s} ${8 * s} ${6 * s}-${12 * s} ${6 * s} ${12 * s} ${4 * s}-${14 * s} ${6 * s} ${10 * s}c${2 * s}-${18 * s} ${-4 * s}-${34 * s} ${-26 * s}-${34 * s}z" fill="${sil}"/>`).join('');
  } else {
    skyline = `<path d="M0 70V50h14v-8h8v8h10V34l6-6 6 6v36h16V46h22v-6h6v6h8v24h30V30l8-10 8 10v40h16V52h10v-8h6v8h12v18h18V40h8l4-6 4 6h8v30h28V54h10v16z" fill="${sil}"/>`;
  }
  return `<svg class="night-art" viewBox="0 0 260 110" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
  <defs>
    <linearGradient id="${id}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${hex(sky.zenith)}"/><stop offset=".55" stop-color="${hex(sky.mid)}"/><stop offset="1" stop-color="${mix(sky.horizon, sky.moonGlow, 0.25)}"/></linearGradient>
    <radialGradient id="${id}m"><stop offset=".45" stop-color="${hex(sky.moonGlow)}" stop-opacity=".55"/><stop offset="1" stop-color="${hex(sky.moonGlow)}" stop-opacity="0"/></radialGradient>
    <radialGradient id="${id}g" cx="50%" cy="100%" r="60%"><stop offset="0" stop-color="${hex(glow)}" stop-opacity=".75"/><stop offset="1" stop-color="${hex(glow)}" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="260" height="110" fill="url(#${id}s)"/>
  <g fill="#fff" opacity=".8"><circle cx="20" cy="14" r="1"/><circle cx="62" cy="24" r=".8"/><circle cx="110" cy="10" r="1.2"/><circle cx="230" cy="18" r="1"/><circle cx="246" cy="40" r=".7"/><circle cx="140" cy="30" r=".8"/></g>
  <circle cx="196" cy="32" r="34" fill="url(#${id}m)"/>
  <circle cx="196" cy="32" r="15" fill="${hex(sky.moonColor)}"/>
  ${skyline}
  <path d="M0 86c50-10 90-6 130-2s90 2 130-6v32H0z" fill="${near}"/>
  <path d="M0 96c60-8 110-2 150 0s80-2 110-6v20H0z" fill="${hex(ground)}"/>
  <rect y="60" width="260" height="50" fill="url(#${id}g)"/>
</svg>`;
}

/** Lantern health gauge. `.lg-fill` is scaled on Y (transform-origin bottom) by the HUD; `.lg-flame` scales too. */
export function lanternGauge(): string {
  return `<svg class="lantern-svg" viewBox="0 0 64 84" aria-hidden="true">
  <defs>
    <linearGradient id="lgFill" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#ff6a14"/><stop offset=".55" stop-color="#ffb43a"/><stop offset="1" stop-color="#fff0b0"/></linearGradient>
    <radialGradient id="lgHalo"><stop offset="0" stop-color="#ffd27a" stop-opacity=".9"/><stop offset="1" stop-color="#ff8a2a" stop-opacity="0"/></radialGradient>
    <clipPath id="lgGlass"><path d="M17 30h30l4 8v26l-4 7H17l-4-7V38z"/></clipPath>
  </defs>
  <circle class="lg-halo" cx="32" cy="52" r="32" fill="url(#lgHalo)"/>
  <path d="M24 12a8 8 0 0 1 16 0" fill="none" stroke="#1a0d2e" stroke-width="7" stroke-linecap="round"/>
  <path d="M24 12a8 8 0 0 1 16 0" fill="none" stroke="#d9a548" stroke-width="3.5" stroke-linecap="round"/>
  <path d="M16 20h32l3 10H13z" fill="#d9a548" stroke="#1a0d2e" stroke-width="3" stroke-linejoin="round"/>
  <path d="M17 30h30l4 8v26l-4 7H17l-4-7V38z" fill="#1d1640" stroke="#1a0d2e" stroke-width="3" stroke-linejoin="round"/>
  <g clip-path="url(#lgGlass)">
    <rect class="lg-fill" x="10" y="30" width="44" height="41" fill="url(#lgFill)"/>
    <path class="lg-flame" d="M32 40c4 6 7 10 7 15a7 7 0 0 1-14 0c0-5 3-9 7-15z" fill="#fff8dc"/>
    <path d="M19 33h6v36h-6z" fill="#fff" opacity=".22"/>
  </g>
  <path d="M17 30h30l4 8v26l-4 7H17l-4-7V38z" fill="none" stroke="#1a0d2e" stroke-width="3" stroke-linejoin="round"/>
  <path d="M32 30v41" stroke="#1a0d2e" stroke-width="2.5" opacity=".5"/>
  <path d="M14 71h36l-3 8H17z" fill="#d9a548" stroke="#1a0d2e" stroke-width="3" stroke-linejoin="round"/>
  <path d="M18 22h28" stroke="#fff6c8" stroke-width="2" stroke-linecap="round" opacity=".7"/>
</svg>`;
}

/** Title emblem: moon disc with a hanging lantern. */
export function emblem(): string {
  return `<svg class="emblem" viewBox="0 0 160 160" aria-hidden="true">
  <defs>
    <radialGradient id="emMoon" cx="40%" cy="35%"><stop offset="0" stop-color="#ffffff"/><stop offset=".7" stop-color="#dfe6ff"/><stop offset="1" stop-color="#aab6ff"/></radialGradient>
    <radialGradient id="emGlow"><stop offset="0" stop-color="#ffe7a0"/><stop offset=".35" stop-color="#ffb13a" stop-opacity=".9"/><stop offset="1" stop-color="#ff7a1a" stop-opacity="0"/></radialGradient>
  </defs>
  <circle cx="80" cy="74" r="62" fill="#8fa2ff" opacity=".18"/>
  <circle cx="80" cy="74" r="50" fill="url(#emMoon)" stroke="#1a1040" stroke-width="5"/>
  <circle cx="62" cy="60" r="7" fill="#b9c3ff" opacity=".6"/><circle cx="98" cy="88" r="10" fill="#b9c3ff" opacity=".5"/><circle cx="96" cy="54" r="4" fill="#b9c3ff" opacity=".6"/>
  <circle class="em-glow" cx="80" cy="104" r="44" fill="url(#emGlow)"/>
  <path d="M80 30v34" stroke="#1a1040" stroke-width="5" stroke-linecap="round"/>
  <path d="M71 66a9 9 0 0 1 18 0" fill="none" stroke="#1a1040" stroke-width="5"/>
  <path d="M66 72h28l4 10H62z" fill="#ffc84a" stroke="#1a1040" stroke-width="4" stroke-linejoin="round"/>
  <path d="M66 82h28l4 8v22l-4 6H66l-4-6V90z" fill="#ffe28a" stroke="#1a1040" stroke-width="4" stroke-linejoin="round"/>
  <path class="em-flame" d="M80 88c5 7 8 11 8 16a8 8 0 0 1-16 0c0-5 3-9 8-16z" fill="#ff8a1f"/>
  <path d="M80 96c2 3 3 5 3 7a3 3 0 0 1-6 0c0-2 1-4 3-7z" fill="#fff6d6"/>
  <path d="M60 118h40l-4 8H64z" fill="#ffc84a" stroke="#1a1040" stroke-width="4" stroke-linejoin="round"/>
</svg>`;
}

/** Input glyphs. Face buttons are drawn as a position diamond so they read on any pad. */
export function kbd(label: string): string {
  return `<kbd class="glyph key">${label}</kbd>`;
}

const PAD_POS: Record<string, [number, number]> = { A: [12, 19], B: [19, 12], X: [5, 12], Y: [12, 5] };
export function pad(btn: 'A' | 'B' | 'X' | 'Y' | 'LB' | 'RB' | 'Start' | 'D-pad' | 'L-stick'): string {
  if (btn in PAD_POS) {
    const [cx, cy] = PAD_POS[btn];
    const dots = Object.values(PAD_POS).map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3.6" ${x === cx && y === cy ? 'class="on"' : ''}/>`).join('');
    return `<span class="glyph padbtn" title="${btn}"><svg viewBox="0 0 24 24" aria-hidden="true">${dots}</svg><b>${btn}</b></span>`;
  }
  return `<kbd class="glyph key pad-word">${btn}</kbd>`;
}

/**
 * Reliquary chest (front view) for the chest reveal. The lid, the inner light and the moon clasp are separate groups
 * (`.rq-lid`, `.rq-beam`, `.rq-clasp`) so CSS can open it. Original design: domed indigo lid, gold straps, crescent clasp.
 */
export function reliquary(): string {
  const id = `rq${++uid}`;
  return `<svg class="reliquary" viewBox="0 0 220 200" aria-hidden="true">
  <defs>
    <linearGradient id="${id}body" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6f52d6"/><stop offset=".55" stop-color="#4a33a6"/><stop offset="1" stop-color="#2c1d72"/></linearGradient>
    <linearGradient id="${id}lid" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8b72ee"/><stop offset="1" stop-color="#4a33a6"/></linearGradient>
    <linearGradient id="${id}gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff2a8"/><stop offset=".5" stop-color="#ffcf3a"/><stop offset="1" stop-color="#d98a00"/></linearGradient>
    <linearGradient id="${id}beam" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#fffbe0" stop-opacity=".95"/><stop offset=".45" stop-color="#ffe27a" stop-opacity=".5"/><stop offset="1" stop-color="#ffb13a" stop-opacity="0"/></linearGradient>
    <radialGradient id="${id}mouth" cx="50%" cy="100%" r="80%"><stop offset="0" stop-color="#fffbe6"/><stop offset=".5" stop-color="#ffd25a"/><stop offset="1" stop-color="#ff9a2a"/></radialGradient>
  </defs>
  <ellipse cx="110" cy="188" rx="86" ry="9" fill="#05031a" opacity=".55"/>
  <path class="rq-beam" d="M58 112 L162 112 L214 -10 L6 -10 Z" fill="url(#${id}beam)"/>
  <g class="rq-body">
    <path d="M40 104h140v68a12 12 0 0 1-12 12H52a12 12 0 0 1-12-12z" fill="url(#${id}body)" stroke="#120b2e" stroke-width="6" stroke-linejoin="round"/>
    <path d="M48 112h124" stroke="#fff" stroke-width="3" opacity=".22" stroke-linecap="round"/>
    <path class="rq-mouth" d="M44 104h132l-6 10H50z" fill="url(#${id}mouth)"/>
    <path d="M66 104v80M154 104v80" stroke="#120b2e" stroke-width="16"/>
    <path d="M66 104v80M154 104v80" stroke="url(#${id}gold)" stroke-width="10"/>
    <path d="M40 160h140" stroke="#120b2e" stroke-width="5" opacity=".35"/>
  </g>
  <g class="rq-lid">
    <path d="M36 104V86a30 30 0 0 1 30-30h88a30 30 0 0 1 30 30v18z" fill="url(#${id}lid)" stroke="#120b2e" stroke-width="6" stroke-linejoin="round"/>
    <path d="M52 76a20 20 0 0 1 16-11h84" fill="none" stroke="#fff" stroke-width="4" opacity=".3" stroke-linecap="round"/>
    <path d="M66 58v46M154 58v46" stroke="#120b2e" stroke-width="16"/>
    <path d="M66 58v46M154 58v46" stroke="url(#${id}gold)" stroke-width="10"/>
    <path d="M32 98h156v12H32z" fill="url(#${id}gold)" stroke="#120b2e" stroke-width="5" stroke-linejoin="round"/>
  </g>
  <g class="rq-clasp">
    <circle cx="110" cy="122" r="17" fill="url(#${id}gold)" stroke="#120b2e" stroke-width="5"/>
    <path d="M115 112a10.5 10.5 0 1 0 0 20 8 8 0 0 1 0-20z" fill="#2c1d72"/>
  </g>
  <g class="rq-sparks" fill="#fff6c8">
    <path d="M30 40l3 7 7 3-7 3-3 7-3-7-7-3 7-3z"/><path d="M188 30l2.4 5.6 5.6 2.4-5.6 2.4-2.4 5.6-2.4-5.6-5.6-2.4 5.6-2.4z"/><path d="M172 80l2 4.5 4.5 2-4.5 2-2 4.5-2-4.5-4.5-2 4.5-2z"/>
  </g>
</svg>`;
}

/** Layered moonlit hills silhouette for the dawn screen (fills its box; preserveAspectRatio none). */
export function dawnHills(): string {
  return `<svg class="dawn-hills" viewBox="0 0 1200 260" preserveAspectRatio="none" aria-hidden="true">
  <path d="M0 150 C120 110 220 120 320 140 S520 90 640 112 S860 150 980 110 S1140 96 1200 120 V260 H0Z" fill="#4a2f6e" opacity=".75"/>
  <path d="M0 190 C140 160 260 150 380 176 S600 200 720 170 S960 140 1080 172 S1170 190 1200 180 V260 H0Z" fill="#2c1b4e"/>
  <path d="M60 176 l14 -40 14 40z M96 182 l10 -28 10 28z M1040 170 l16 -46 16 46z M1084 178 l11 -30 11 30z M900 168 l9 -26 9 26z" fill="#22143e"/>
  <path d="M0 226 C200 206 380 214 560 228 S900 236 1200 214 V260 H0Z" fill="#150c2c"/>
</svg>`;
}
