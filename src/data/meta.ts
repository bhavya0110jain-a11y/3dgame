import type { PlayerStats } from '../game/Stats';

/** Permanent upgrades bought with Ash at the Hearth (main menu). */
export interface MetaUpgradeDef {
  id: string;
  name: string;
  description: string;
  icon: string;
  maxRank: number;
  cost: (rank: number) => number; // cost to buy rank+1
  apply: (s: PlayerStats, rank: number) => void;
}

const linear = (base: number, step: number) => (rank: number) => Math.round(base + step * rank);

export const META_UPGRADES: MetaUpgradeDef[] = [
  { id: 'm_light', name: 'Deeper Reservoir', description: '+10 max light per rank.', icon: 'wick', maxRank: 5, cost: linear(60, 60), apply: (s, r) => (s.maxLight += 10 * r) },
  { id: 'm_might', name: 'Hotter Flame', description: '+5% damage per rank.', icon: 'flint', maxRank: 5, cost: linear(80, 80), apply: (s, r) => (s.might += 0.05 * r) },
  { id: 'm_speed', name: 'Light Feet', description: '+4% move speed per rank.', icon: 'boots', maxRank: 3, cost: linear(60, 70), apply: (s, r) => (s.moveSpeed *= 1 + 0.04 * r) },
  { id: 'm_regen', name: 'Steady Wick', description: '+0.15 light regen per rank.', icon: 'oil', maxRank: 4, cost: linear(70, 70), apply: (s, r) => (s.lightRegen += 0.15 * r) },
  { id: 'm_armor', name: 'Tempered Glass', description: '+1 armor per rank.', icon: 'armor', maxRank: 3, cost: linear(120, 120), apply: (s, r) => (s.armor += r) },
  { id: 'm_magnet', name: 'Ember Call', description: '+15% pickup radius per rank.', icon: 'magnet', maxRank: 3, cost: linear(50, 50), apply: (s, r) => (s.magnet *= 1 + 0.15 * r) },
  { id: 'm_growth', name: 'Old Wisdom', description: '+5% experience per rank.', icon: 'tome', maxRank: 5, cost: linear(90, 90), apply: (s, r) => (s.growth += 0.05 * r) },
  { id: 'm_greed', name: 'Ash Sifter', description: '+10% Ash earned per rank.', icon: 'ash', maxRank: 5, cost: linear(100, 100), apply: (s, r) => (s.greed += 0.1 * r) },
  { id: 'm_cooldown', name: 'Quickened Oil', description: '-3% cooldowns per rank.', icon: 'clock', maxRank: 4, cost: linear(120, 110), apply: (s, r) => (s.cooldown *= 1 - 0.03 * r) },
  { id: 'm_revival', name: 'Second Spark', description: 'Rekindle once on death.', icon: 'revive', maxRank: 1, cost: () => 600, apply: (s, r) => (s.revival += r) },
];

/** Playable lantern-bearers. */
export interface CharacterDef {
  id: string;
  name: string;
  title: string;
  description: string;
  startWeapon: string;
  lightColor: number;
  robeColor: number;
  unlockCost: number; // ash; 0 = free
  apply: (s: PlayerStats) => void;
}

export const CHARACTERS: CharacterDef[] = [
  {
    id: 'char_keeper', name: 'Wren', title: 'The Lamplighter', description: 'Balanced. Starts with Ember Bolt.',
    startWeapon: 'ember_bolt', lightColor: 0xffa64d, robeColor: 0x3b3550, unlockCost: 0, apply: () => {},
  },
  {
    id: 'char_warden', name: 'Osric', title: 'The Warden', description: '+30 max light, +1 armor, -10% speed. Starts with Cinder Halo.',
    startWeapon: 'cinder_halo', lightColor: 0xff7a3a, robeColor: 0x4a3328, unlockCost: 250,
    apply: (s) => { s.maxLight += 30; s.armor += 1; s.moveSpeed *= 0.9; },
  },
  {
    id: 'char_seer', name: 'Isolde', title: 'The Storm Seer', description: '+15% cooldown speed, -20 max light. Starts with Spark Chain.',
    startWeapon: 'spark_chain', lightColor: 0x8ad0ff, robeColor: 0x283a4a, unlockCost: 400,
    apply: (s) => { s.cooldown *= 0.85; s.maxLight -= 20; },
  },
  {
    id: 'char_pyre', name: 'Brannoc', title: 'The Pyre Monk', description: '+20% area, +10% damage, no light regen. Starts with Brazier.',
    startWeapon: 'brazier', lightColor: 0xff4a2a, robeColor: 0x4a2222, unlockCost: 600,
    apply: (s) => { s.area += 0.2; s.might += 0.1; s.lightRegen = 0; },
  },
  {
    id: 'char_frost', name: 'Maelis', title: 'The Rime Pilgrim', description: '+15% speed, +20% pickup radius. Starts with Rime Shards.',
    startWeapon: 'frost_shards', lightColor: 0xa0f0ff, robeColor: 0x2a3a48, unlockCost: 800,
    apply: (s) => { s.moveSpeed *= 1.15; s.magnet *= 1.2; },
  },
];
