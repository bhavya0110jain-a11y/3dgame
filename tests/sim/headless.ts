/**
 * Headless run simulator: drives the REAL Director, EnemyManager, weapons, projectiles, pickups, upgrades and
 * RunState with a scripted bot player and stubbed rendering/audio/UI. Used by tools/balance-sim.ts and tests/sim.
 * No DOM / WebGL needed (three.js objects are constructed but never rendered).
 */
import * as THREE from 'three';
import { EventBus } from '../../src/core/EventBus';
import { Rng } from '../../src/core/Rng';
import { defaultSave, type SaveData } from '../../src/core/Save';
import { EnemyManager } from '../../src/entities/Enemies';
import { ProjectileManager } from '../../src/entities/Projectiles';
import { PickupManager } from '../../src/entities/Pickups';
import { Director, RUN_LENGTH } from '../../src/game/Director';
import { RunState, ashForRun } from '../../src/game/RunState';
import { rollChoices, rollChest, applyChoice, type UpgradeChoice } from '../../src/game/Upgrades';
import { getBiome } from '../../src/data/biomes';
import { META_UPGRADES, CHARACTERS } from '../../src/data/meta';
import { getWeapon } from '../../src/data/weapons';
import { PASSIVES } from '../../src/data/passives';
import { AchievementTracker } from '../../src/game/Achievements';
import type { GameContext } from '../../src/game/types';

/** Minimal stand-in for entities/Player (same damage/heal/revival rules). */
class SimPlayer {
  x = 0;
  z = 0;
  vx = 0;
  vz = 0;
  aimX = 1;
  aimZ = 0;
  readonly radius = 0.5;
  lightValue = 100;
  invuln = 0;
  dead = false;
  group = { visible: true };
  damage(amount: number, ctx: GameContext): void {
    if (this.dead || this.invuln > 0) return;
    const dmg = Math.max(1, amount - ctx.run.stats.armor);
    this.lightValue -= dmg;
    ctx.run.damageTaken += dmg;
    this.invuln = 0.35;
    ctx.events.emit('player:damaged', { amount: dmg });
    if (this.lightValue <= 0) {
      if (ctx.run.stats.revival > 0) {
        ctx.run.stats.revival--;
        this.lightValue = ctx.run.stats.maxLight * 0.6;
        this.invuln = 2.5;
        ctx.enemies.knockbackAll(this.x, this.z, 10, 18);
      } else {
        this.lightValue = 0;
        this.dead = true;
      }
    }
  }
  heal(amount: number, ctx: GameContext): void {
    this.lightValue = Math.min(ctx.run.stats.maxLight, this.lightValue + amount);
  }
  lightFrac(max: number): number {
    return Math.max(0, Math.min(1, this.lightValue / max));
  }
}

const noop = () => {};
/** Recursive no-op: every property/call/construct returns itself; coerces to 0. Stands in for FxManager. */
const anyObj: object = new Proxy(function () {} as object, {
  get: (_t, k) => (k === Symbol.toPrimitive ? () => 0 : k === 'then' ? undefined : k === Symbol.iterator ? undefined : anyObj),
  apply: () => anyObj,
  construct: () => anyObj,
  set: () => true,
});
const fxStub = anyObj as unknown as GameContext['fx'];

/** Minimal DOM shim so render-side helpers (canvas atlases etc.) construct under Node. */
function installDomShim(): void {
  const g = globalThis as unknown as { document?: unknown; window?: unknown };
  if (g.document) return;
  const el = () => ({ width: 64, height: 64, style: {}, getContext: () => anyObj, appendChild: noop, addEventListener: noop, classList: { add: noop, remove: noop, toggle: noop } });
  g.document = { createElement: el, body: el(), addEventListener: noop };
  if (!g.window) g.window = { addEventListener: noop, setTimeout, clearTimeout, devicePixelRatio: 1 };
}
installDomShim();

export interface SimOptions {
  seed?: number;
  biome?: string;
  character?: string;
  /** Meta ranks (Hearth) — id → rank. */
  meta?: Record<string, number>;
  unlocked?: string[];
  /** Stop after this many seconds (default: boss + up to 3 minutes). */
  maxTime?: number;
  dt?: number;
  /** Bot skill 0..1: how well it kites (1 = good player). */
  skill?: number;
}

export interface MinuteSample {
  minute: number;
  level: number;
  kills: number;
  alive: number;
  light: number;
  dps: number;
  hpMul: number;
  weapons: string;
}

export interface SimResult {
  survived: number;
  died: boolean;
  bossKilled: boolean;
  bossTimeToKill: number;
  level: number;
  kills: number;
  ashEarned: number;
  ash: number;
  evolutions: string[];
  chests: number;
  firstLevelUps: number[]; // times of first 6 level-ups
  taken: { melee: number; projectiles: number };
  samples: MinuteSample[];
  damageBySource: [string, number][];
  achievements: string[];
  weapons: string[];
}

export function simulateRun(opts: SimOptions = {}): SimResult {
  const dt = opts.dt ?? 1 / 30;
  const rng = new Rng(opts.seed ?? 1);
  const scene = new THREE.Scene();
  const events = new EventBus();
  const save: SaveData = defaultSave();
  save.settings.damageNumbers = false;
  save.unlocked.push(...(opts.unlocked ?? []));
  save.meta = { ...(opts.meta ?? {}) };
  const player = new SimPlayer();
  const enemies = new EnemyManager(scene);
  const projectiles = new ProjectileManager(scene);
  const pickups = new PickupManager(scene);
  const biome = getBiome(opts.biome ?? 'biome_pines');
  const world = { biome, update: noop } as unknown as GameContext['world'];
  const run = new RunState();
  const director = new Director();
  const ctx = {
    scene, camera: new THREE.PerspectiveCamera(), events, rng, input: {} as GameContext['input'], save,
    audio: { play: noop } as unknown as GameContext['audio'], world, player: player as unknown as GameContext['player'],
    enemies, projectiles, pickups, fx: fxStub, run, shake: noop,
  } as GameContext;
  const skill = opts.skill ?? 0.8;

  for (const m of META_UPGRADES) {
    const r = save.meta[m.id] ?? 0;
    if (r > 0) m.apply(run.stats, r);
  }
  const char = CHARACTERS.find((c) => c.id === (opts.character ?? 'char_keeper')) ?? CHARACTERS[0];
  char.apply(run.stats);
  player.lightValue = run.stats.maxLight;
  run.rerolls = 1 + (save.meta.m_reroll ?? 0);
  run.weapons.push(getWeapon(char.startWeapon)!.create(ctx));
  const tracker = new AchievementTracker(() => save, () => run, events);
  tracker.onRunStart();

  let bossKilled = false;
  let bossSpawnAt = -1;
  let bossKillAt = -1;
  events.on('enemy:killed', ({ x, z, xp, elite }) => {
    pickups.spawn('ember', x, z, xp);
    if (rng.chance(0.012 * run.stats.luck)) pickups.spawn('oil', x, z);
    if (rng.chance(0.0025 * run.stats.luck)) pickups.spawn('beacon', x, z);
    if (rng.chance(0.02 * run.stats.luck)) pickups.spawn('ash', x, z, 1);
    if (elite) {
      pickups.spawn('chest', x, z);
      pickups.spawn('ash', x, z, 10);
    }
  });
  events.on('boss:spawned', () => (bossSpawnAt = run.elapsed));
  events.on('boss:killed', () => {
    bossKilled = true;
    bossKillAt = run.elapsed;
    run.victory = true;
  });
  events.on('chest:opened', () => {
    run.chestsOpened++;
    for (const c of rollChest(ctx)) applyChoice(ctx, c);
  });

  const choose = (choices: UpgradeChoice[]): UpgradeChoice => {
    let best = choices[0];
    let bestS = -1;
    for (const c of choices) {
      let s = 3;
      if (c.kind === 'weapon-up') s = 10 + (getWeapon(c.id)?.maxLevel === c.level ? 4 : 0);
      else if (c.kind === 'weapon-new') s = run.weapons.length < 4 ? 11 : run.weapons.length < 6 ? 6 : 0;
      else if (c.kind === 'passive') {
        const pairs = run.weapons.some((w) => w.def.evolvesWith === c.id);
        s = pairs ? 9.5 : ['flint', 'clockwork', 'bellows', 'wick', 'twin'].includes(c.id) ? 8 : 6;
      }
      s += rng.next() * 2 * (1 - skill + 0.2);
      if (s > bestS) {
        bestS = s;
        best = c;
      }
    }
    return best;
  };

  const firstLevelUps: number[] = [];
  const samples: MinuteSample[] = [];
  let lastDmg = 0;
  let nextSample = 60;
  const maxTime = opts.maxTime ?? RUN_LENGTH + 180;
  // bot steering state
  let orbit = 1;
  let takenMelee = 0;
  let takenProj = 0;

  while (run.elapsed < maxTime && !player.dead && !(bossKilled && run.elapsed > bossKillAt + 1)) {
    run.elapsed += dt;
    player.invuln = Math.max(0, player.invuln - dt);
    player.heal(run.stats.lightRegen * dt, ctx);
    // --- bot: flee weighted threats, orbit, drift toward embers when safe
    let fx = 0;
    let fz = 0;
    let threat = 0;
    enemies.forEachInRadius(player.x, player.z, 7, (e) => {
      const dx = player.x - e.x;
      const dz = player.z - e.z;
      const d2 = Math.max(0.2, dx * dx + dz * dz);
      const w = (e.def.boss ? 6 : e.def.behavior === 'exploder' && e.state === 3 ? 4 : 1) / d2;
      fx += dx * w;
      fz += dz * w;
      threat += w;
    });
    let mx = 0;
    let mz = 0;
    // attraction: nearest pickup (players weave through ember trails)
    let best = 1e9;
    let ax = 0;
    let az = 0;
    for (const p of pickups.list) {
      if (!p.active) continue;
      const d = (p.x - player.x) ** 2 + (p.z - player.z) ** 2;
      if (d < best) {
        best = d;
        ax = p.x - player.x;
        az = p.z - player.z;
      }
    }
    if (best < 1e9) {
      const n = Math.sqrt(best) || 1;
      const greed = 0.9 / (1 + threat * 10 * skill);
      mx += (ax / n) * greed;
      mz += (az / n) * greed;
    } else {
      mx += Math.cos(run.elapsed * 0.2) * 0.5;
      mz += Math.sin(run.elapsed * 0.2) * 0.5;
    }
    if (threat > 0) {
      const n = Math.hypot(fx, fz) || 1;
      const k = Math.min(3, threat * 4) * (0.6 + 0.6 * skill);
      const ux = fx / n;
      const uz = fz / n;
      // flee + orbit tangentially so we circle the horde instead of running off forever
      mx += (ux - uz * orbit * 0.7) * k;
      mz += (uz + ux * orbit * 0.7) * k;
      if (rng.chance(dt * 0.1)) orbit = -orbit;
    }
    const ml = Math.hypot(mx, mz);
    if (ml > 0.01) {
      // imperfect players don't move at full efficiency
      const sp = run.stats.moveSpeed * (0.55 + 0.45 * skill);
      player.vx = (mx / ml) * sp;
      player.vz = (mz / ml) * sp;
      player.aimX = mx / ml;
      player.aimZ = mz / ml;
    } else {
      player.vx = player.vz = 0;
    }
    player.x += player.vx * dt;
    player.z += player.vz * dt;

    director.update(dt, ctx);
    for (const w of run.weapons) w.update(dt, ctx);
    let dt0 = run.damageTaken;
    enemies.update(dt, ctx, run.elapsed);
    takenMelee += run.damageTaken - dt0;
    dt0 = run.damageTaken;
    projectiles.update(dt, ctx);
    takenProj += run.damageTaken - dt0;
    pickups.update(dt, ctx, run.elapsed);
    tracker.update(dt, player.lightFrac(run.stats.maxLight));
    while (run.pendingLevelUps > 0) {
      run.pendingLevelUps--;
      if (firstLevelUps.length < 6) firstLevelUps.push(+run.elapsed.toFixed(1));
      const n = 3 + (save.meta.m_choice ?? 0);
      const c = choose(rollChoices(ctx, n));
      applyChoice(ctx, c);
      player.heal(run.stats.maxLight * 0.05, ctx);
    }
    if (run.elapsed >= nextSample) {
      samples.push({
        minute: Math.round(run.elapsed / 60),
        level: run.level,
        kills: run.kills,
        alive: enemies.activeCount,
        light: Math.round(player.lightValue),
        dps: Math.round((run.damageDealt - lastDmg) / 60),
        hpMul: +enemies.hpMul.toFixed(2),
        weapons: run.weapons.map((w) => `${w.def.id}:${w.level}`).join(' '),
      });
      lastDmg = run.damageDealt;
      nextSample += 60;
    }
  }
  save.runs++;
  tracker.onRunEnd();
  const victory = bossKilled;
  const ash = ashForRun(run, victory, biome.difficulty); // shared with Game.endRun (src/game/RunState.ts)
  for (const w of run.weapons) w.dispose(ctx);
  return {
    survived: Math.round(run.elapsed),
    died: player.dead,
    bossKilled,
    bossTimeToKill: bossKillAt > 0 ? Math.round(bossKillAt - bossSpawnAt) : -1,
    level: run.level,
    kills: run.kills,
    ashEarned: Math.round(run.ashEarned),
    ash,
    evolutions: run.evolutions.slice(),
    chests: run.chestsOpened,
    firstLevelUps,
    taken: { melee: Math.round(takenMelee), projectiles: Math.round(takenProj) },
    samples,
    damageBySource: [...run.damageBySource.entries()].map(([k, v]) => [k, Math.round(v)] as [string, number]).sort((a, b) => b[1] - a[1]),
    achievements: save.achievements.slice(),
    weapons: run.weapons.map((w) => `${w.def.id}:${w.level}`),
  };
}

export { PASSIVES };
