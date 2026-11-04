/** Mid-run boons offered at wind shrines (pick one of three). Effects are applied in src/game/Mods.ts. */
export interface BoonDef {
  id: string;
  name: string;
  desc: string;
  icon: string;
  /** Offer weight. */
  weight: number;
  /** How many times it may be taken in one run. */
  maxStacks: number;
  /** Card tint. */
  color: string;
}

export const BOONS: readonly BoonDef[] = [
  { id: 'magnet', name: 'Lodestar', desc: 'Glimmers drift to you from far away (+6 m magnet).', icon: '✧', weight: 10, maxStacks: 2, color: '#ffd36e' },
  { id: 'wide_rings', name: 'Wide Rings', desc: 'Wind rings are 30% larger.', icon: '◯', weight: 10, maxStacks: 2, color: '#7fe0ff' },
  { id: 'long_combo', name: 'Lingering Song', desc: 'Combo window +1.6 s.', icon: '♪', weight: 10, maxStacks: 3, color: '#ff9ad5' },
  { id: 'shield', name: 'Shield Charm', desc: 'Absorbs one crash or strike.', icon: '✦', weight: 8, maxStacks: 3, color: '#b7f7a8' },
  { id: 'slow_drain', name: 'Still Air', desc: 'Lift drains 25% slower.', icon: '❖', weight: 10, maxStacks: 2, color: '#a8c7ff' },
  { id: 'glimmer_x2', name: 'Twin Sparks', desc: 'Glimmers are worth double.', icon: '✶', weight: 6, maxStacks: 1, color: '#ffe9a8' },
  { id: 'updraft', name: 'Thermal Kin', desc: 'Updrafts lift and refill 60% more.', icon: '⇡', weight: 7, maxStacks: 2, color: '#ffb48a' },
  { id: 'whisker', name: 'Whisker Dancer', desc: 'Near-miss range +60% and whiskers pay double.', icon: '〰', weight: 7, maxStacks: 1, color: '#e2b6ff' },
  { id: 'surge', name: 'Tailwind', desc: 'Rings give a bigger speed surge and +4 lift.', icon: '➶', weight: 8, maxStacks: 2, color: '#9ff0d0' },
  { id: 'second_wind', name: 'Second Wind', desc: 'When lift runs dry, refill half of it once.', icon: '❀', weight: 6, maxStacks: 1, color: '#fff3c4' },
];

export const boonById = (id: string): BoonDef | undefined => BOONS.find((b) => b.id === id);
