/** Playable kites. Stats are multipliers on src/data/tuning.ts FLIGHT values (1 = baseline). */
export interface KiteDef {
  id: string;
  name: string;
  blurb: string;
  /** Glimmer cost to unlock (0 = starter). */
  cost: number;
  /** Max lift multiplier. */
  lift: number;
  /** Lift drain multiplier (lower = better). */
  drain: number;
  /** Turn-rate multiplier. */
  turn: number;
  /** Cruise-speed multiplier. */
  speed: number;
  /** Dive acceleration multiplier. */
  dive: number;
  /** Glimmer magnet radius (m). */
  magnet: number;
  /** Starting shield charms. */
  shields: number;
  /** Sail colours [main, accent, trim] and pattern id for the procedural model (src/entities/KiteView.ts). */
  colors: [number, number, number];
  pattern: 'stripes' | 'scales' | 'eyes' | 'flame' | 'feather';
  /** Tail ribbon colours (head -> tip). */
  tail: [number, number];
  /** Shape id: wing span / length proportions. */
  shape: 'diamond' | 'fish' | 'moth' | 'dragon' | 'crane';
}

export const KITES: readonly KiteDef[] = [
  {
    id: 'swallow', name: 'Swallow', blurb: 'Balanced and forgiving. The first wind you learn.', cost: 0,
    lift: 1, drain: 1, turn: 1, speed: 1, dive: 1, magnet: 2.2, shields: 0,
    colors: [0xf4efe4, 0xe2574c, 0x2c3e66], pattern: 'stripes', tail: [0xe2574c, 0xffd36e], shape: 'diamond',
  },
  {
    id: 'koi', name: 'Koi', blurb: 'Deep lift reserves, a little slower. Lazy, golden glides.', cost: 180,
    lift: 1.25, drain: 0.9, turn: 0.92, speed: 0.94, dive: 0.95, magnet: 2.4, shields: 0,
    colors: [0xffffff, 0xff8a3d, 0xd9342b], pattern: 'scales', tail: [0xff8a3d, 0xfff2d6], shape: 'fish',
  },
  {
    id: 'moth', name: 'Moth', blurb: 'Drawn to light: a huge glimmer magnet, but thin wings.', cost: 320,
    lift: 0.88, drain: 1.05, turn: 1.08, speed: 1, dive: 1, magnet: 6.5, shields: 0,
    colors: [0xe9dcc0, 0x8a6bb8, 0x3a2d52], pattern: 'eyes', tail: [0xbca6ff, 0xfff5d0], shape: 'moth',
  },
  {
    id: 'dragon', name: 'Dragon-tail', blurb: 'Fast and fierce dives. Burns through lift.', cost: 520,
    lift: 1, drain: 1.18, turn: 1.12, speed: 1.12, dive: 1.35, magnet: 2.2, shields: 0,
    colors: [0x2fa37a, 0xffc94a, 0xb3261e], pattern: 'flame', tail: [0xffc94a, 0xff4d3d], shape: 'dragon',
  },
  {
    id: 'crane', name: 'Crane', blurb: 'Wide, calm wings and a charm of good fortune.', cost: 800,
    lift: 1.4, drain: 0.85, turn: 0.85, speed: 0.97, dive: 0.9, magnet: 3, shields: 1,
    colors: [0xfbfbf6, 0x1d1d26, 0xd8322a], pattern: 'feather', tail: [0xffffff, 0xd8322a], shape: 'crane',
  },
];

export const kiteById = (id: string): KiteDef => KITES.find((k) => k.id === id) ?? KITES[0];
