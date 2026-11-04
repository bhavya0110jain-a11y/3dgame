import { ENEMIES } from '../data/enemies';
import { BIOMES } from '../data/biomes';
import type { GameContext } from './types';

export const RUN_LENGTH = 15 * 60; // seconds until the boss arrives
/** Endless night: a returning boss every N seconds after the first boss falls. */
export const ENDLESS_BOSS_EVERY = 180;

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
  { until: 300, rate: 4.5, maxAlive: 140, weights: { shade: 2, crawler: 3, stalker: 1, spitter: 1, bog_lurker: 2, gloam_jelly: 1 } },
  { until: 420, rate: 5.5, maxAlive: 180, weights: { crawler: 3, wisp: 3, stalker: 2, brute: 1, spitter: 1, bog_lurker: 2, cinder_tick: 2, gloam_jelly: 1 } },
  { until: 540, rate: 7.5, maxAlive: 230, weights: { shade: 3, crawler: 2, stalker: 2, brute: 1, spitter: 2, knight: 1, bog_lurker: 2, hollow_warden: 1, gloam_jelly: 2 } },
  { until: 660, rate: 10, maxAlive: 290, weights: { wisp: 4, stalker: 2, brute: 2, spitter: 2, knight: 1, bog_lurker: 2, cinder_tick: 3, hollow_warden: 1 } },
  { until: 780, rate: 12.5, maxAlive: 340, weights: { shade: 3, crawler: 3, brute: 2, spitter: 2, knight: 2, stalker: 2, gloam_jelly: 2, hollow_warden: 2 } },
  { until: RUN_LENGTH, rate: 14, maxAlive: 380, weights: { crawler: 3, wisp: 3, brute: 3, knight: 2, stalker: 2, spitter: 2, bog_lurker: 2, cinder_tick: 3, hollow_warden: 2 } },
];

/** HP multiplier for regular enemies at minute m (before biome difficulty). Tuned with tests/sim/balance.test.ts. */
export function hpScale(minutes: number): number {
  return 1 + minutes * 0.16 + Math.pow(minutes / 10, 2) * 0.9;
}
export function damageScale(minutes: number): number {
  return 1 + minutes * 0.055;
}

export class Director {
  private acc = 0;
  private nextElite = 75;
  private nextSwarm = 150;
  private nextRush = 260;
  private warned = false;
  private nextEndlessBoss = 0;
  private endlessBosses = 0;
  bossSpawned = false;
  /** Allowed enemy ids for the current biome (pool + EnemyDef.biomes), cached per run. */
  private allowed = new Set<string>();
  private allowedFor = '';
  private poolScratch: [string, number][] = [];

  reset(): void {
    this.acc = 0;
    this.nextElite = 75;
    this.nextSwarm = 150;
    this.nextRush = 260;
    this.warned = false;
    this.bossSpawned = false;
    this.nextEndlessBoss = 0;
    this.endlessBosses = 0;
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
    ctx.enemies.hpMul = biome.difficulty * hpScale(minutes) * (run.endless ? 1 + run.endlessTime / 240 : 1);
    ctx.enemies.damageMul = biome.difficulty * damageScale(minutes);
    ctx.enemies.speedMul = 1 + Math.min(0.25, minutes * 0.02);

    if (!this.warned && t >= RUN_LENGTH - 20) {
      this.warned = true;
      ctx.fx.text(ctx.player.x, 3.5, ctx.player.z, 'The master of this night stirs…', 'ft-big');
    }

    if (run.endless) {
      this.updateEndless(dt, ctx);
      return;
    }

    if (t >= RUN_LENGTH) {
      if (!this.bossSpawned) this.spawnBoss(ctx, biome.bossId, 1);
      // trickle of adds during boss
      this.acc += dt * 1.6;
      while (this.acc >= 1) {
        this.acc -= 1;
        if (ctx.enemies.activeCount < 80) this.spawnAtEdge(ctx, ctx.rng.pick(biome.enemyPool));
      }
      return;
    }

    const phase = PHASES.find((p) => t < p.until) ?? PHASES[PHASES.length - 1];
    this.spawnPhase(dt, ctx, phase, 1);

    if (t >= this.nextElite) {
      this.nextElite += 100;
      this.spawnElite(ctx);
    }

    if (t >= this.nextSwarm) {
      this.nextSwarm += 180;
      const ids = ['shade', 'wisp', 'crawler', 'gloam_jelly'].filter((id) => this.allowed.has(id));
      this.encircle(ctx, ctx.rng.pick(ids.length ? ids : ['shade']), t > 600 ? 44 : 36);
    }

    if (t >= this.nextRush) {
      this.nextRush += 210;
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

  private updateEndless(dt: number, ctx: GameContext): void {
    const run = ctx.run;
    run.endlessTime += dt;
    const last = PHASES[PHASES.length - 1];
    this.spawnPhase(dt, ctx, last, 1 + run.endlessTime / 300);
    if (this.nextEndlessBoss === 0) this.nextEndlessBoss = run.endlessTime + ENDLESS_BOSS_EVERY;
    if (run.endlessTime >= this.nextEndlessBoss && !ctx.enemies.boss) {
      this.nextEndlessBoss = run.endlessTime + ENDLESS_BOSS_EVERY;
      this.endlessBosses++;
      const bosses = BIOMES.map((b) => b.bossId);
      const id = bosses[this.endlessBosses % bosses.length];
      this.spawnBoss(ctx, id, 1 + this.endlessBosses * 0.6);
    }
    if (run.elapsed >= this.nextElite) {
      this.nextElite = run.elapsed + 60;
      this.spawnElite(ctx);
    }
  }

  private spawnElite(ctx: GameContext): void {
    const candidates = ['brute', 'knight', 'bog_lurker', 'stalker', 'hollow_warden', 'gloam_jelly'].filter((id) => this.allowed.has(id));
    // first elite is always a beatable one so the first reliquary arrives early
    const id = ctx.run.elapsed < 120 ? (this.allowed.has('bog_lurker') ? 'bog_lurker' : 'stalker') : ctx.rng.pick(candidates.length ? candidates : ['brute']);
    const e = this.spawnAtEdge(ctx, id, true);
    if (e) ctx.fx.text(ctx.player.x, 3.5, ctx.player.z, 'An elite approaches…', 'ft-big');
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
    ctx.fx.text(p.x, 3.5, p.z, 'The dark closes in!', 'ft-big');
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
    ctx.fx.text(p.x, 3.5, p.z, 'Cinders on the wind!', 'ft-big');
  }

  private spawnBoss(ctx: GameContext, id: string, hpMul: number): void {
    this.bossSpawned = true;
    const p = ctx.player;
    ctx.enemies.spawn(id, p.x, p.z - 18, { hpMul });
    ctx.events.emit('boss:spawned', { defId: id });
    ctx.shake(0.8);
  }
}
