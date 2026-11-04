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

  // ---- run summary / achievements data (read by UI + Achievements) ----
  /** Damage dealt per source (weapon id, 'burn:<weapon>' folded into the weapon, 'blast' for exploder chain kills). */
  readonly damageBySource = new Map<string, number>();
  /** Kills per source weapon id. */
  readonly killsBySource = new Map<string, number>();
  /** Kills per enemy def id. */
  readonly killsByEnemy = new Map<string, number>();
  /** Upgrade ids removed from the pool this run (banish). */
  readonly banished = new Set<string>();
  /** Evolved weapon ids obtained this run, in order. */
  readonly evolutions: string[] = [];
  elitesKilled = 0;
  chestsOpened = 0;
  /** Lowest light fraction reached (for "close call" achievements). */
  lowestLightFrac = 1;
  /** True once the boss has been defeated and the player chose to keep going. */
  endless = false;
  /** Seconds survived after the boss died (endless mode). */
  endlessTime = 0;
  /** Highest number of enemies alive at once. */
  peakEnemies = 0;

  addXp(amount: number): void {
    this.xp += amount * this.stats.growth;
    while (this.xp >= this.xpToNext) {
      this.xp -= this.xpToNext;
      this.level++;
      this.xpToNext = xpForLevel(this.level);
      this.pendingLevelUps++;
    }
  }

  /** Records damage for the run summary (hot path: no allocation besides first-time Map keys). */
  addDamage(source: string, amount: number): void {
    this.damageDealt += amount;
    this.damageBySource.set(source, (this.damageBySource.get(source) ?? 0) + amount);
  }

  /** Damage-by-source sorted high→low, for the game-over screen. */
  damageSummary(): { source: string; damage: number; share: number }[] {
    const total = Math.max(1, this.damageDealt);
    return [...this.damageBySource.entries()]
      .map(([source, damage]) => ({ source, damage, share: damage / total }))
      .sort((a, b) => b.damage - a.damage);
  }
}
