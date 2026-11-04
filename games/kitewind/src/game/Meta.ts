import type { SaveData } from '../core/Save';
import { ACHIEVEMENTS } from '../data/achievements';
import { KITES, kiteById } from '../data/kites';
import { UPGRADES, upgradeById, upgradeCost } from '../data/upgrades';

/** Pure meta-progression rules (shop, unlocks, run rewards, achievements) over SaveData. */

/** Buys the next rank of an upgrade. Returns true on success. */
export function buyUpgrade(save: SaveData, id: string): boolean {
  const def = upgradeById(id);
  if (!def) return false;
  const rank = save.meta[id] ?? 0;
  const cost = upgradeCost(def, rank);
  if (!Number.isFinite(cost) || save.glimmers < cost) return false;
  save.glimmers -= cost;
  save.meta[id] = rank + 1;
  return true;
}

/** Unlocks (buys) a kite. Returns true on success. */
export function buyKite(save: SaveData, id: string): boolean {
  const k = KITES.find((x) => x.id === id);
  if (!k || save.kites.includes(id) || save.glimmers < k.cost) return false;
  save.glimmers -= k.cost;
  save.kites.push(id);
  return true;
}

export function selectKite(save: SaveData, id: string): boolean {
  if (!save.kites.includes(id)) return false;
  save.selectedKite = kiteById(id).id;
  return true;
}

export interface RunSummary {
  distance: number;
  score: number;
  bestCombo: number;
  perfects: number;
  whiskers: number;
  arches: number;
  boons: number;
  earned: number;
  daily: string | null;
}

export interface RunResult {
  newBestDistance: boolean;
  newBestScore: boolean;
  achievements: { id: string; name: string; reward: number }[];
  totalEarned: number;
}

/** Applies a finished run to the save: currency, bests, achievements (with their rewards). */
export function applyRun(save: SaveData, r: RunSummary): RunResult {
  const res: RunResult = { newBestDistance: false, newBestScore: false, achievements: [], totalEarned: r.earned };
  save.runs++;
  if (r.distance > save.bestDistance) {
    save.bestDistance = r.distance;
    res.newBestDistance = true;
  }
  if (r.score > save.bestScore) {
    save.bestScore = r.score;
    res.newBestScore = true;
  }
  save.bestCombo = Math.max(save.bestCombo, r.bestCombo);
  if (r.daily) save.daily[r.daily] = Math.max(save.daily[r.daily] ?? 0, r.score);
  save.glimmers += r.earned;
  save.totalGlimmers += r.earned;
  const cond: Record<string, boolean> = {
    first_flight: true,
    dist_1000: r.distance >= 1000,
    dist_3000: r.distance >= 3000,
    dist_6000: r.distance >= 6000,
    combo_10: r.bestCombo >= 10,
    combo_25: r.bestCombo >= 25,
    perfect_5: r.perfects >= 5,
    whisker_5: r.whiskers >= 5,
    arch_1: r.arches >= 1,
    boons_3: r.boons >= 3,
    daily: !!r.daily,
    collector: KITES.every((k) => save.kites.includes(k.id)),
  };
  for (const a of ACHIEVEMENTS) {
    if (!save.achievements.includes(a.id) && cond[a.id]) {
      save.achievements.push(a.id);
      save.glimmers += a.reward;
      save.totalGlimmers += a.reward;
      res.totalEarned += a.reward;
      res.achievements.push({ id: a.id, name: a.name, reward: a.reward });
    }
  }
  return res;
}

export { UPGRADES };
