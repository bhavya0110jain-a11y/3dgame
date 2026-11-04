/** Player stats. Multipliers are 1-based (1 = +0%). Upgrades and meta progression mutate these. */
export interface PlayerStats {
  maxLight: number; // health pool AND light radius driver
  lightRegen: number; // light per second
  moveSpeed: number; // units per second
  might: number; // damage multiplier
  area: number; // area multiplier
  cooldown: number; // cooldown multiplier (lower = faster)
  projectileSpeed: number; // multiplier
  amount: number; // extra projectiles
  duration: number; // effect duration multiplier
  magnet: number; // pickup radius in units
  armor: number; // flat damage reduction
  luck: number; // multiplier for crits / rare drops
  growth: number; // xp multiplier
  greed: number; // ash multiplier
  revival: number; // extra lives
  critChance: number; // 0..1
  critMult: number;
}

export function baseStats(): PlayerStats {
  return {
    maxLight: 100,
    lightRegen: 0.25,
    moveSpeed: 6,
    might: 1,
    area: 1,
    cooldown: 1,
    projectileSpeed: 1,
    amount: 0,
    duration: 1,
    magnet: 2.5,
    armor: 0,
    luck: 1,
    growth: 1,
    greed: 1,
    revival: 0,
    critChance: 0.05,
    critMult: 2,
  };
}

/** XP needed to go from `level` to `level+1`. */
export function xpForLevel(level: number): number {
  if (level < 20) return Math.round(5 + level * 10 * Math.pow(1.08, level));
  return Math.round(5 + level * 13 * Math.pow(1.06, level));
}
