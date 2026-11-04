import { ENEMIES } from '../data/enemies';
import { BIOMES } from '../data/biomes';
import type { GameContext } from './types';

export const RUN_LENGTH = 15 * 60; // seconds until the boss arrives
/** Endless night: a returning boss every N seconds after the first boss falls. */
export const ENDLESS_BOSS_EVERY = 180;

/**
 * Adaptive pressure (Sprint 2, design/gdd/director.md § Adaptive pressure). From PRESSURE_FROM seconds on, when the
 * arena is "starved" (alive < PRESSURE_STARVED × phase cap) the spawn-rate multiplier climbs toward PRESSURE_MAX;
 * when the arena is crowded (alive > PRESSURE_CROWDED × cap) it relaxes back to 1. It only climbs while the bearer's
 * light is above PRESSURE_SAFE_LIGHT and falls fast below PRESSURE_HURT_LIGHT. Strong builds that out-kill the
 * Director get pushed; struggling players are never pushed (their arena is full).
 */
export const PRESSURE_FROM = 360;
export const PRESSURE_MAX = 2.4;
export const PRESSURE_STARVED = 0.3;
export const PRESSURE_CROWDED = 0.6;
/** Pressure gained per second while starved / lost per second while crowded. */
export const PRESSURE_RISE = 0.04;
export const PRESSURE_FALL = 0.15;
/** Pressure only rises while light ≥ this fraction (a hurting player is never pushed)… */
export const PRESSURE_SAFE_LIGHT = 0.7;
/** …and falls whenever light drops below this fraction. */
export const PRESSURE_HURT_LIGHT = 0.4;
/** Boss fight: enemy damage scaling is capped here (×biome difficulty) so the master is a test, not a cliff. */
export const BOSS_DAMAGE_CAP = 1.3;
/** Elite pools: light elites before HEAVY_ELITES_FROM seconds, everything after. */
export const HEAVY_ELITES_FROM = 300;
const LIGHT_ELITES = ['bog_lurker', 'stalker', 'gloam_jelly', 'hollow_warden'];
const ALL_ELITES = ['brute', 'knight', 'bog_lurker', 'stalker', 'hollow_warden', 'gloam_jelly'];
/** The night's master spawns with this HP multiplier (36k → 54k for the Stag): a longer test with capped damage. */
export const BOSS_HP_MUL = 1.5;
/** Reliquary drift: a chest left on the ground this long starts gliding toward the bearer. */
export const CHEST_DRIFT_AFTER = 4;
export const CHEST_DRIFT_SPEED = 2.2;
export const CHEST_DRIFT_MAX = 7;

interface Phase {
  until: number; // seconds
  rate: number; // spawns per second
  maxAlive: number;
  weights: Record<string, number>;
}

/**
 * Spawn curve for a 15 minute run (see design/gdd/director.md). Ids not allowed in the biome are skipped.
 * Shape: hot start (0-1 min) → build-up (1-5) → mid-game variety (5-8) → power fantasy density (8-12) → pressure (12-15).
 */
export const PHASES: Phase[] = [
  { until: 30, rate: 2.2, maxAlive: 45, weights: { shade: 1 } },
  { until: 60, rate: 3.0, maxAlive: 60, weights: { shade: 3, wisp: 2 } },
  { until: 120, rate: 3.2, maxAlive: 80, weights: { shade: 3, wisp: 2, bog_lurker: 1, crawler: 1 } },
  { until: 210, rate: 3.8, maxAlive: 110, weights: { shade: 3, crawler: 3, wisp: 2, bog_lurker: 1, cinder_tick: 1 } },
  { until: 300, rate: 4.5, maxAlive: 140, weights: { shade: 3, crawler: 2, stalker: 1, spitter: 1, bog_lurker: 2, gloam_jelly: 1 } },
  // brutes ease in at half weight (balance-report S1 #2: they were the top non-boss damage source)
  { until: 420, rate: 5.2, maxAlive: 165, weights: { crawler: 3, wisp: 3, stalker: 2, brute: 0.5, spitter: 1, bog_lurker: 2, cinder_tick: 2, gloam_jelly: 1 } },
  { until: 540, rate: 7.5, maxAlive: 230, weights: { shade: 3, crawler: 2, stalker: 2, brute: 1, spitter: 2, knight: 1, bog_lurker: 2, hollow_warden: 1, gloam_jelly: 2 } },
  { until: 660, rate: 10, maxAlive: 290, weights: { wisp: 4, stalker: 2, brute: 2, spitter: 2, knight: 1, bog_lurker: 2, cinder_tick: 3, hollow_warden: 1 } },
  { until: 780, rate: 12.5, maxAlive: 340, weights: { shade: 3, crawler: 3, brute: 2, spitter: 2, knight: 2, stalker: 2, gloam_jelly: 2, hollow_warden: 2 } },
  { until: RUN_LENGTH, rate: 14, maxAlive: 380, weights: { crawler: 3, wisp: 3, brute: 3, knight: 2, stalker: 2, spitter: 2, bog_lurker: 2, cinder_tick: 3, hollow_warden: 2 } },
];

/**
 * HP multiplier for regular enemies at minute m (before biome difficulty). Tuned with tests/sim/balance.test.ts and
 * tools/balance-sim.ts. Sprint 2: slightly softer before 6:00, plus a cubic late term from 8:00 (capped at the run
 * length — endless adds its own factor) so the 8–15 min plateau pushes back on strong builds.
 */
export function hpScale(minutes: number): number {
  const late = Math.max(0, Math.min(minutes, RUN_LENGTH / 60) - LATE_FROM) / (RUN_LENGTH / 60 - LATE_FROM);
  return (1 + minutes * 0.15 + Math.pow(minutes / 10, 2) * 0.9) * (1 + late * late * LATE_HP);
}
/** Late-game HP factor at 15:00 (hpScale × (1 + LATE_HP) at the boss; quadratic from 8:00). */
export const LATE_HP = 2.5;
/** Minute the late HP ramp starts. */
export const LATE_FROM = 7;
/**
 * Contact/projectile damage multiplier at minute m: gentle until LATE_DMG_FROM (first-run survival), steeper afterwards.
 * Sprint 3: LATE_DMG 0.08 → 0.11 to win back the damage the per-enemy contact cooldown (Enemies CONTACT_COOLDOWN 0.8 s)
 * removed (production/qa/balance-report.md § Sprint 3).
 */
export function damageScale(minutes: number): number {
  return 1 + minutes * 0.04 + Math.max(0, minutes - LATE_DMG_FROM) * LATE_DMG;
}
/** Minute the steeper damage slope starts, and its extra multiplier per minute. */
export const LATE_DMG_FROM = 6;
export const LATE_DMG = 0.11;
/** Extra enemy HP per point of adaptive pressure above 1 (so pressure is not pure XP for strong builds). */
export const PRESSURE_HP = 0.5;

/** Minimal UI surface the Director may use for world banners (feature-detected; tests/sim contexts have none). */
interface Announcer { announce?: (text: string, kind?: string) => void }

/**
 * Routes a world announcement through the UI banner queue (UI.announce: one at a time, under the dawn bar, never
 * over the bearer — BUG-QA-019 / art review #9). Falls back to the Fx 'ft-big' banner when no UI is attached.
 */
export function announce(ctx: GameContext, text: string, kind: 'info' | 'elite' | 'boss' | 'danger' | 'buff'): void {
  const ui = (ctx as GameContext & { ui?: Announcer }).ui;
  if (ui && typeof ui.announce === 'function') ui.announce(text, kind);
  else ctx.fx.text(ctx.player.x, 3.5, ctx.player.z, text, 'ft-big');
}

/**
 * Endless night: the n-th returning master (n ≥ 1). The first is the night's own master (biome.bossId), then the
 * other biomes' masters in BIOMES order, cycling.
 */
export function endlessBossId(biomeBossId: string, n: number): string {
  const bosses = BIOMES.map((b) => b.bossId);
  const start = Math.max(0, bosses.indexOf(biomeBossId));
  return bosses[(start + Math.max(0, n - 1)) % bosses.length] ?? biomeBossId;
}

export class Director {
  private acc = 0;
  private nextElite = 75;
  private nextSwarm = 150;
  private nextRush = 230;
  private swarmsDone = 0;
  private warned = false;
  private nextEndlessBoss = 0;
  private endlessBosses = 0;
  bossSpawned = false;
  /** Adaptive spawn-rate multiplier (1..PRESSURE_MAX). Read-only outside the Director (HUD/debug/playtest bot). */
  pressure = 1;
  /** Chest pickup → seconds it has been lying on the ground (≤16 chests; entries pruned every frame). */
  private chestAge = new Map<object, number>();
  /** Allowed enemy ids for the current biome (pool + EnemyDef.biomes), cached per run. */
  private allowed = new Set<string>();
  private allowedFor = '';
  private poolScratch: [string, number][] = [];

  reset(): void {
    this.acc = 0;
    this.nextElite = 75;
    this.nextSwarm = 150;
    this.nextRush = 230;
    this.swarmsDone = 0;
    this.warned = false;
    this.bossSpawned = false;
    this.nextEndlessBoss = 0;
    this.endlessBosses = 0;
    this.pressure = 1;
    this.chestAge.clear();
    this.allowedFor = '';
  }

  private refreshAllowed(ctx: GameContext): void {
    const biome = ctx.world.biome;
    if (this.allowedFor === biome.id) return;
    this.allowedFor = biome.id;
    this.allowed = new Set(biome.enemyPool);
    for (const d of Object.values(ENEMIES)) if (d.biomes?.includes(biome.id)) this.allowed.add(d.id);
  }

  allowedIds(ctx: GameContext): ReadonlySet<string> {
    this.refreshAllowed(ctx);
    return this.allowed;
  }

  update(dt: number, ctx: GameContext): void {
    this.refreshAllowed(ctx);
    const run = ctx.run;
    const t = run.elapsed;
    const biome = ctx.world.biome;
    // continuous difficulty scaling (endless keeps climbing past 15:00)
    const minutes = t / 60;
    ctx.enemies.hpMul = biome.difficulty * hpScale(minutes) * (run.endless ? 1 + run.endlessTime / 240 : 1) *
      (1 + (this.pressure - 1) * PRESSURE_HP);
    const ds = damageScale(minutes);
    // the master's fight: damage scaling is capped so the boss is a test, not a cliff (balance-report #1)
    const bossFight = t >= RUN_LENGTH && !run.endless;
    ctx.enemies.damageMul = biome.difficulty * (bossFight ? Math.min(BOSS_DAMAGE_CAP, ds) : ds);
    ctx.enemies.speedMul = 1 + Math.min(0.25, minutes * 0.02);
    this.updateChestDrift(dt, ctx);

    if (!this.warned && t >= RUN_LENGTH - 20) {
      this.warned = true;
      announce(ctx, 'The master of this night stirs…', 'boss');
      ctx.events.emit('boss:warning', {});
    }

    if (run.endless) {
      this.updateEndless(dt, ctx);
      return;
    }

    if (t >= RUN_LENGTH) {
      if (!this.bossSpawned) this.spawnBoss(ctx, biome.bossId, BOSS_HP_MUL);
      // trickle of adds during boss
      this.acc += dt * 1.6;
      while (this.acc >= 1) {
        this.acc -= 1;
        if (ctx.enemies.activeCount < 80) this.spawnAtEdge(ctx, ctx.rng.pick(biome.enemyPool));
      }
      return;
    }

    const phase = PHASES.find((p) => t < p.until) ?? PHASES[PHASES.length - 1];
    if (t >= PRESSURE_FROM) this.updatePressure(dt, ctx, phase.maxAlive);
    this.spawnPhase(dt, ctx, phase, this.pressure);

    if (t >= this.nextElite) {
      // never queue a burst of catch-up events after a time jump (debug fast-forward, long hitch)
      this.nextElite = Math.max(this.nextElite + 100, t + 30);
      this.spawnElite(ctx);
    }

    if (t >= this.nextSwarm) {
      // +210 (was +180): the 2nd swarm lands at 6:00, clear of the 4:35 elite and the 5:00 phase change
      this.nextSwarm = Math.max(this.nextSwarm + 210, t + 60);
      // the first encirclement (2:30) is never splitters — 36 jellies → ~108 jellylings overwhelmed level-10 builds
      const kinds = this.swarmsDone === 0 ? ['shade', 'wisp'] : ['shade', 'wisp', 'crawler', 'gloam_jelly'];
      this.swarmsDone++;
      const ids = kinds.filter((id) => this.allowed.has(id));
      this.encircle(ctx, ctx.rng.pick(ids.length ? ids : ['shade']), t > 600 ? 44 : t > 400 ? 36 : t > 200 ? 30 : 24);
    }

    if (t >= this.nextRush) {
      this.nextRush = Math.max(this.nextRush + 210, t + 60);
      this.rush(ctx, this.allowed.has('cinder_tick') ? 'cinder_tick' : 'crawler', 10 + Math.floor(t / 90));
    }
  }

  private spawnPhase(dt: number, ctx: GameContext, phase: Phase, rateMul: number): void {
    this.acc += dt * phase.rate * rateMul;
    const pool = this.poolScratch;
    pool.length = 0;
    for (const id in phase.weights) if (this.allowed.has(id)) pool.push([id, phase.weights[id]]);
    if (!pool.length) pool.push(['shade', 1]);
    while (this.acc >= 1) {
      this.acc -= 1;
      if (ctx.enemies.activeCount >= phase.maxAlive) continue;
      const [id] = ctx.rng.weighted(pool, (x) => x[1]);
      this.spawnAtEdge(ctx, id);
    }
  }

  /** Adaptive pressure: climbs while the arena is starved, relaxes while it is crowded (see PRESSURE_*). */
  private updatePressure(dt: number, ctx: GameContext, maxAlive: number): void {
    const fill = ctx.enemies.activeCount / maxAlive;
    const light = ctx.player.lightValue / Math.max(1, ctx.run.stats.maxLight);
    if (fill > PRESSURE_CROWDED || light < PRESSURE_HURT_LIGHT) this.pressure = Math.max(1, this.pressure - dt * PRESSURE_FALL);
    else if (fill < PRESSURE_STARVED && light >= PRESSURE_SAFE_LIGHT) this.pressure = Math.min(PRESSURE_MAX, this.pressure + dt * PRESSURE_RISE);
  }

  /**
   * Reliquaries that drop inside a dense horde used to be lost (balance-report #4: 7 elites, 0 chests opened). After
   * CHEST_DRIFT_AFTER seconds on the ground a chest glides toward the bearer, accelerating up to CHEST_DRIFT_MAX.
   */
  private updateChestDrift(dt: number, ctx: GameContext): void {
    const list = ctx.pickups?.list;
    const ages = this.chestAge;
    if (!list) return;
    if (ages.size) for (const k of ages.keys()) {
      const p = k as { active: boolean; kind: string };
      if (!p.active || p.kind !== 'chest') ages.delete(k);
    }
    const pl = ctx.player;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (!p.active || p.kind !== 'chest') continue;
      const age = (ages.get(p) ?? 0) + dt;
      ages.set(p, age);
      if (age < CHEST_DRIFT_AFTER) continue;
      const dx = pl.x - p.x;
      const dz = pl.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.3) continue;
      const sp = Math.min(CHEST_DRIFT_MAX, CHEST_DRIFT_SPEED + (age - CHEST_DRIFT_AFTER) * 0.6);
      const k = Math.min(d, sp * dt) / d;
      p.x += dx * k;
      p.z += dz * k;
    }
  }

  private updateEndless(dt: number, ctx: GameContext): void {
    const run = ctx.run;
    run.endlessTime += dt;
    const last = PHASES[PHASES.length - 1];
    this.updatePressure(dt, ctx, last.maxAlive);
    this.spawnPhase(dt, ctx, last, (1 + run.endlessTime / 300) * this.pressure);
    if (this.nextEndlessBoss === 0) this.nextEndlessBoss = run.endlessTime + ENDLESS_BOSS_EVERY;
    if (run.endlessTime >= this.nextEndlessBoss && !ctx.enemies.boss) {
      this.nextEndlessBoss = run.endlessTime + ENDLESS_BOSS_EVERY;
      this.endlessBosses++;
      const id = endlessBossId(ctx.world.biome.bossId, this.endlessBosses);
      this.spawnBoss(ctx, id, 1 + this.endlessBosses * 0.6);
    }
    if (run.elapsed >= this.nextElite) {
      this.nextElite = run.elapsed + 60;
      this.spawnElite(ctx);
    }
  }

  private spawnElite(ctx: GameContext): void {
    // heavy elites (brute ×8 hp, knight) only from HEAVY_ELITES_FROM: an elite brute at 2:55 killed fresh builds (bot S2)
    const pool = ctx.run.elapsed < HEAVY_ELITES_FROM ? LIGHT_ELITES : ALL_ELITES;
    const candidates = pool.filter((id) => this.allowed.has(id));
    // first elite is always a beatable one so the first reliquary arrives early
    const id = ctx.run.elapsed < 120 ? (this.allowed.has('bog_lurker') ? 'bog_lurker' : 'stalker') : ctx.rng.pick(candidates.length ? candidates : ['brute']);
    const e = this.spawnAtEdge(ctx, id, true);
    if (e) {
      announce(ctx, 'An elite approaches…', 'elite');
      ctx.events.emit('elite:spawned', { defId: id, x: e.x, z: e.z });
    }
  }

  private spawnAtEdge(ctx: GameContext, id: string, elite = false) {
    if (!ENEMIES[id]) return null;
    const p = ctx.player;
    // bias spawns toward movement direction so the player runs into enemies
    const moveA = Math.atan2(p.vz, p.vx);
    const moving = Math.hypot(p.vx, p.vz) > 1;
    const a = moving && ctx.rng.chance(0.4) ? moveA + ctx.rng.range(-0.8, 0.8) : ctx.rng.range(0, Math.PI * 2);
    const r = ctx.rng.range(20, 26);
    return ctx.enemies.spawn(id, p.x + Math.cos(a) * r, p.z + Math.sin(a) * r, { elite });
  }

  private encircle(ctx: GameContext, id: string, n: number): void {
    const p = ctx.player;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      ctx.enemies.spawn(id, p.x + Math.cos(a) * 16, p.z + Math.sin(a) * 16);
    }
    announce(ctx, 'The dark closes in!', 'danger');
  }

  /** A tight pack charging in from one side — readable, dodgeable, and great for chain reactions. */
  private rush(ctx: GameContext, id: string, n: number): void {
    const p = ctx.player;
    const a = ctx.rng.range(0, Math.PI * 2);
    const cx = p.x + Math.cos(a) * 22;
    const cz = p.z + Math.sin(a) * 22;
    for (let i = 0; i < n; i++) {
      ctx.enemies.spawn(id, cx + ctx.rng.range(-2.5, 2.5), cz + ctx.rng.range(-2.5, 2.5));
    }
    announce(ctx, 'Cinders on the wind!', 'danger');
  }

  private spawnBoss(ctx: GameContext, id: string, hpMul: number): void {
    this.bossSpawned = true;
    const p = ctx.player;
    ctx.enemies.spawn(id, p.x, p.z - 18, { hpMul });
    ctx.events.emit('boss:spawned', { defId: id });
    ctx.shake(0.8);
    this.flareLantern(ctx);
  }

  /**
   * "The lantern flares as the master arrives": refills the bearer's light and shoves the horde back, so every boss
   * fight starts at full light (balance-report #1). Emits 'lantern:flare' for the VFX/UI layer.
   */
  private flareLantern(ctx: GameContext): void {
    const p = ctx.player;
    const max = ctx.run.stats.maxLight;
    const amount = Math.max(0, max - p.lightValue);
    p.heal(max, ctx);
    ctx.enemies.knockbackAll(p.x, p.z, 9, 14);
    ctx.events.emit('lantern:flare', { amount });
  }
}
