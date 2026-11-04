import type { WeaponInstance } from './types';
import { baseStats, xpForLevel, type PlayerStats } from './Stats';

/** Per-run mutable state. Reset each run. */
export class RunState {
  elapsed = 0;
  level = 1;
  xp = 0;
  xpToNext = xpForLevel(1);
  kills = 0;
  ashEarned = 0;
  stats: PlayerStats = baseStats();
  weapons: WeaponInstance[] = [];
  passives = new Map<string, number>();
  pendingLevelUps = 0;
  bossesKilled = 0;
  damageDealt = 0;
  damageTaken = 0;
  biomeId = 'biome_pines';
  victory = false;
  rerolls = 1;
  banishes = 0;
  skips = 1;
  readonly maxWeapons = 6;
  readonly maxPassives = 6;

  addXp(amount: number): void {
    this.xp += amount * this.stats.growth;
    while (this.xp >= this.xpToNext) {
      this.xp -= this.xpToNext;
      this.level++;
      this.xpToNext = xpForLevel(this.level);
      this.pendingLevelUps++;
    }
  }
}
