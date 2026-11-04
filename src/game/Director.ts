import { ENEMIES } from '../data/enemies';
import type { GameContext } from './types';

export const RUN_LENGTH = 15 * 60; // seconds until the boss arrives

interface Phase {
  until: number; // seconds
  rate: number; // spawns per second
  maxAlive: number;
  weights: Record<string, number>;
}

/** Spawn curve for a 15 minute run. Ids not in the biome pool are skipped. */
const PHASES: Phase[] = [
  { until: 45, rate: 1.4, maxAlive: 40, weights: { shade: 1 } },
  { until: 120, rate: 2.4, maxAlive: 70, weights: { shade: 3, wisp: 2, bog_lurker: 1 } },
  { until: 210, rate: 3.2, maxAlive: 100, weights: { shade: 3, crawler: 3, wisp: 2, bog_lurker: 1 } },
  { until: 300, rate: 4.0, maxAlive: 130, weights: { shade: 2, crawler: 3, stalker: 1, spitter: 1, bog_lurker: 2 } },
  { until: 420, rate: 5.0, maxAlive: 170, weights: { crawler: 3, wisp: 3, stalker: 2, brute: 1, spitter: 1, bog_lurker: 2 } },
  { until: 540, rate: 6.0, maxAlive: 210, weights: { shade: 3, crawler: 2, stalker: 2, brute: 1, spitter: 2, knight: 1, bog_lurker: 2 } },
  { until: 660, rate: 7.0, maxAlive: 250, weights: { wisp: 4, stalker: 2, brute: 2, spitter: 2, knight: 1, bog_lurker: 2 } },
  { until: 780, rate: 8.0, maxAlive: 290, weights: { shade: 3, crawler: 3, brute: 2, spitter: 2, knight: 2, stalker: 2 } },
  { until: RUN_LENGTH, rate: 9.5, maxAlive: 330, weights: { crawler: 3, wisp: 3, brute: 3, knight: 2, stalker: 2, spitter: 2, bog_lurker: 2 } },
];

export class Director {
  private acc = 0;
  private nextElite = 90;
  private nextSwarm = 150;
  private nextChestHint = 0;
  bossSpawned = false;

  reset(): void {
    this.acc = 0;
    this.nextElite = 90;
    this.nextSwarm = 150;
    this.bossSpawned = false;
  }

  update(dt: number, ctx: GameContext): void {
    const t = ctx.run.elapsed;
    const biome = ctx.world.biome;
    // continuous difficulty scaling
    const minutes = t / 60;
    ctx.enemies.hpMul = biome.difficulty * (1 + minutes * 0.12 + Math.pow(minutes / 10, 2) * 0.6);
    ctx.enemies.damageMul = biome.difficulty * (1 + minutes * 0.05);
    ctx.enemies.speedMul = 1 + Math.min(0.25, minutes * 0.02);

    if (t >= RUN_LENGTH) {
      if (!this.bossSpawned) this.spawnBoss(ctx);
      // trickle of adds during boss
      this.acc += dt * 1.5;
      while (this.acc >= 1) {
        this.acc -= 1;
        if (ctx.enemies.activeCount < 80) this.spawnAtEdge(ctx, ctx.rng.pick(biome.enemyPool));
      }
      return;
    }

    const phase = PHASES.find((p) => t < p.until) ?? PHASES[PHASES.length - 1];
    this.acc += dt * phase.rate;
    const pool = Object.entries(phase.weights).filter(([id]) => biome.enemyPool.includes(id));
    if (!pool.length) pool.push(['shade', 1]);
    while (this.acc >= 1) {
      this.acc -= 1;
      if (ctx.enemies.activeCount >= phase.maxAlive) continue;
      const [id] = ctx.rng.weighted(pool, ([, w]) => w);
      this.spawnAtEdge(ctx, id);
    }

    if (t >= this.nextElite) {
      this.nextElite += 120;
      const candidates = ['brute', 'knight', 'bog_lurker', 'stalker'].filter((id) => biome.enemyPool.includes(id));
      const id = ctx.rng.pick(candidates.length ? candidates : ['brute']);
      const e = this.spawnAtEdge(ctx, id, true);
      if (e) ctx.fx.text(ctx.player.x, 3.5, ctx.player.z, 'An elite approaches…', 'ft-big');
    }

    if (t >= this.nextSwarm) {
      this.nextSwarm += 180;
      this.encircle(ctx, ctx.rng.pick(['shade', 'wisp', 'crawler'].filter((id) => biome.enemyPool.includes(id))));
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

  private encircle(ctx: GameContext, id: string): void {
    const p = ctx.player;
    const n = 36;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      ctx.enemies.spawn(id, p.x + Math.cos(a) * 16, p.z + Math.sin(a) * 16);
    }
    ctx.fx.text(p.x, 3.5, p.z, 'The dark closes in!', 'ft-big');
  }

  private spawnBoss(ctx: GameContext): void {
    this.bossSpawned = true;
    const p = ctx.player;
    const id = ctx.world.biome.bossId;
    ctx.enemies.spawn(id, p.x, p.z - 18);
    ctx.events.emit('boss:spawned', { defId: id });
    ctx.shake(0.8);
  }
}
