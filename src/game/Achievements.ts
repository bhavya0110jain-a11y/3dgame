/**
 * Achievement tracking.
 *
 * PUBLIC API (for the UI agent):
 *   game.achievements: AchievementTracker
 *     .list(): { def: AchievementDef; earned: boolean }[]   – full list for an achievements screen (secret+unearned
 *                                                            entries should be shown as "???")
 *     .takeNewlyEarned(): AchievementDef[]                  – achievements earned since the last call (Game calls it
 *                                                            in endRun and stores the result in game.lastRunAchievements)
 *     .earnedThisRun: AchievementDef[]                      – everything earned during the current/last run
 *   game.lastRunAchievements: AchievementDef[]              – what the game-over screen should celebrate
 *   events: 'achievement:unlocked' { id, name } fires the moment one is earned (Game shows a toast).
 *   Data: ACHIEVEMENTS in src/data/achievements.ts ({ id, name, description, icon, reward?: { unlock?, ash?, label } }).
 *   Persistence: save.achievements (ids) and save.lifetime (counters). Rewards are applied on grant: `unlock` is pushed to
 *   save.unlocked (WeaponDef.unlock / PassiveDef.unlock / character ids), `ash` is added to save.ash.
 *
 * Checks run once per second during a run (cheap) and once more at run end (with `ended = true`).
 */
import { ACHIEVEMENTS, type AchievementContext, type AchievementDef } from '../data/achievements';
import type { SaveData } from '../core/Save';
import type { EventBus } from '../core/EventBus';
import type { RunState } from './RunState';

export function grantAchievement(save: SaveData, def: AchievementDef): void {
  if (save.achievements.includes(def.id)) return;
  save.achievements.push(def.id);
  const r = def.reward;
  if (r?.unlock && !save.unlocked.includes(r.unlock)) save.unlocked.push(r.unlock);
  if (r?.ash) {
    save.ash += r.ash;
    save.totalAsh += r.ash;
  }
}

/** Pure evaluation: returns achievements whose condition holds and that are not yet in save.achievements. */
export function evaluateAchievements(ctx: AchievementContext): AchievementDef[] {
  const have = new Set(ctx.save.achievements);
  return ACHIEVEMENTS.filter((a) => !have.has(a.id) && a.check(ctx));
}

export class AchievementTracker {
  earnedThisRun: AchievementDef[] = [];
  private pending: AchievementDef[] = [];
  private flags = new Set<string>();
  private acc = 0;
  private wasLow = false;
  private ctx: AchievementContext;

  constructor(
    private getSave: () => SaveData,
    private getRun: () => RunState,
    private events: EventBus,
  ) {
    this.ctx = {
      run: getRun(),
      save: getSave(),
      flags: this.flags,
      ended: false,
      life: (key) => this.lifetime(key),
    };
  }

  /** Lifetime counter including the live run (kills and per-enemy kills). */
  private lifetime(key: string): number {
    const save = this.getSave();
    const base = save.lifetime?.[key] ?? 0;
    const run = this.getRun();
    if (key === 'kills') return base + run.kills;
    if (key.startsWith('kill:')) return base + (run.killsByEnemy.get(key.slice(5)) ?? 0);
    return base;
  }

  onRunStart(): void {
    this.earnedThisRun = [];
    this.pending = [];
    this.flags.clear();
    this.wasLow = false;
    this.acc = 0;
  }

  /** Call every frame while playing with the player's light fraction. */
  update(dt: number, lightFrac: number): void {
    if (lightFrac < 0.1) this.wasLow = true;
    else if (this.wasLow && lightFrac >= 0.995) this.flags.add('close_call');
    this.acc += dt;
    if (this.acc < 1) return;
    this.acc = 0;
    this.check(false);
  }

  /** Folds the run into lifetime counters, runs the final check and returns everything earned this run. */
  onRunEnd(): AchievementDef[] {
    const save = this.getSave();
    const run = this.getRun();
    const life = (save.lifetime ??= {});
    life.kills = (life.kills ?? 0) + run.kills;
    for (const [id, n] of run.killsByEnemy) life[`kill:${id}`] = (life[`kill:${id}`] ?? 0) + n;
    life.evolutions = (life.evolutions ?? 0) + run.evolutions.length;
    life.playSeconds = (life.playSeconds ?? 0) + run.elapsed;
    // the run is folded into the stored totals now, so lifetime checks read them directly (no double count)
    this.check(true, true);
    return this.earnedThisRun.slice();
  }

  /** Also usable from menus (e.g. after Hearth purchases) — pass ended=false. */
  check(ended: boolean, folded = false): AchievementDef[] {
    const c = this.ctx;
    c.run = this.getRun();
    c.save = this.getSave();
    c.ended = ended;
    c.life = folded ? (key) => this.getSave().lifetime?.[key] ?? 0 : (key) => this.lifetime(key);
    const got = evaluateAchievements(c);
    for (const a of got) {
      grantAchievement(c.save, a);
      this.earnedThisRun.push(a);
      this.pending.push(a);
      this.events.emit('achievement:unlocked', { id: a.id, name: a.name });
    }
    return got;
  }

  takeNewlyEarned(): AchievementDef[] {
    const out = this.pending;
    this.pending = [];
    return out;
  }

  list(): { def: AchievementDef; earned: boolean }[] {
    const have = new Set(this.getSave().achievements);
    return ACHIEVEMENTS.map((def) => ({ def, earned: have.has(def.id) }));
  }
}
