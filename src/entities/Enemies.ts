import * as THREE from 'three';
import { ENEMIES, type EnemyDef } from '../data/enemies';
import { SpatialHash } from '../core/SpatialHash';
import {
  buildEnemyModel,
  buildEnemyLodModel,
  makeEnemyBodyMaterial,
  makeEnemyGlowMaterial,
  withEnemyFx,
  poseEnemy,
  poseQuaternion,
  POSE_SCRATCH,
  DEATH_TIME,
  BOSS_DEATH_TIME,
  type EnemyModel,
} from './enemyModels';
import type { GameContext } from '../game/types';

export interface Enemy {
  id: number;
  active: boolean;
  def: EnemyDef;
  x: number;
  z: number;
  vx: number;
  vz: number;
  kbx: number;
  kbz: number;
  hp: number;
  maxHp: number;
  radius: number;
  scale: number;
  damage: number;
  speedMul: number;
  hitFlash: number;
  slowTimer: number;
  burnTimer: number;
  burnDps: number;
  phase: number;
  timer: number;
  state: number; // behavior-specific
  stateTime: number;
  elite: boolean;
  /** Arbitrary per-weapon hit cooldowns: weaponKey -> time remaining */
  hitCd: Map<string, number>;
  facing: number;
  /** Weapon id credited for burn damage ticks (run summary). */
  burnSource: string;
  /** Shielded enemies: ward points absorbed before hp, and seconds since last hit (regen gate). */
  shield: number;
  maxShield: number;
  sinceHit: number;
  /** Behaviour scratch (boss: chained charges / channel ticks; exploder: primed flag). */
  aux: number;
  aux2: number;
  enraged: boolean;
  lastPattern: number;
  /** Seconds since spawn (drives the rise-from-the-ground spawn animation). */
  age: number;
  /** Seconds into the death animation; -1 while alive. Dying enemies are already inactive (no collision,
   *  targeting or damage) and are only kept around for rendering until the animation ends. */
  dying: number;
}

/** Render quality tier (matches Renderer's Quality / save.settings.quality). */
export type EnemyRenderQuality = 'low' | 'medium' | 'high';

/** Delayed area attack (boss eruptions, slams, rain; exploder blasts). Pooled, no per-frame allocation. */
interface Hazard {
  active: boolean;
  x: number;
  z: number;
  r: number;
  t: number; // seconds until it lands
  damage: number;
  color: number;
}

type TelegraphFx = { telegraph?: (x: number, z: number, r: number, dur: number, color: number) => void };

/** One drawable LOD of an enemy type: lit body + unlit glow, sharing one per-instance FX attribute. */
interface BatchPart {
  body: THREE.InstancedMesh;
  eyes: THREE.InstancedMesh;
  fx: THREE.InstancedBufferAttribute;
}

interface Batch {
  def: EnemyDef;
  /** Base instance tint: white when the model carries its own vertex colours. */
  tint: number;
  hi: BatchPart;
  /** Horde LOD (~800 triangles); null for bosses / procedural fallbacks. */
  lo: BatchPart | null;
  /** The part written this frame (the other one is drawn with count 0). */
  cur: BatchPart;
  capacity: number;
  /** Write cursor for this frame. */
  n: number;
}

/**
 * Horde LOD policy. Regular enemies draw their ~800-triangle `_lo` model on the low/medium tiers, and on high
 * once the horde is big (with hysteresis so the swap doesn't flicker around the threshold). Bosses always
 * draw the full model. Enemy bodies cast the moon shadow on the high tier only and never cast into the
 * lantern's cube shadow (Lighting.LANTERN_SHADOW_LAYER; enemies stay on layer 0).
 */
export const HORDE_LOD_ON = 170;
export const HORDE_LOD_OFF = 130;

export interface DamageOpts {
  knockback?: number; // impulse strength
  fromX?: number;
  fromZ?: number;
  source?: string; // weapon id (for stats)
  canCrit?: boolean;
  color?: string; // css class for text
}

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const tmpC = new THREE.Color();

export class EnemyManager {
  readonly list: Enemy[] = [];
  private free: Enemy[] = [];
  private batches = new Map<string, Batch>();
  readonly hash = new SpatialHash<Enemy>(2.5);
  private nextId = 1;
  activeCount = 0;
  /** Global multipliers set by the director (difficulty scaling over time). */
  hpMul = 1;
  damageMul = 1;
  speedMul = 1;
  boss: Enemy | null = null;
  private lastWardCallout = -10;
  private hazards: Hazard[] = Array.from({ length: 64 }, () => ({ active: false, x: 0, z: 0, r: 0, t: 0, damage: 0, color: 0 }));
  /** Enemies playing their death animation (inactive; returned to the pool when it ends). */
  private dyingList: Enemy[] = [];
  /** Render tier override (Game can feed renderer.effectiveQuality here); null = save.settings.quality. */
  renderQuality: EnemyRenderQuality | null = null;
  private appliedQuality: EnemyRenderQuality | null = null;
  private hordeLod = false;

  constructor(private scene: THREE.Scene) {
    for (const def of Object.values(ENEMIES)) this.ensureBatch(def);
  }

  private makePart(def: EnemyDef, model: EnemyModel, capacity: number): BatchPart {
    // Body: vertex-coloured lit material with moonlit rim + per-instance FX (hit flash, elite, slow, burn).
    const bodyMat = makeEnemyBodyMaterial(model.vertexColors);
    const eyeMat = model.vertexColors ? makeEnemyGlowMaterial(true) : makeEnemyGlowMaterial(false, def.eyeColor);
    if (!model.vertexColors) eyeMat.color.multiplyScalar(2.5);
    const bodyGeo = withEnemyFx(model.body, capacity);
    const fx = bodyGeo.getAttribute('aFx') as THREE.InstancedBufferAttribute;
    const body = new THREE.InstancedMesh(bodyGeo, bodyMat, capacity);
    body.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    body.count = 0;
    body.frustumCulled = false;
    body.castShadow = false;
    body.receiveShadow = false;
    const eyes = new THREE.InstancedMesh(withEnemyFx(model.eyes, capacity, fx), eyeMat, capacity);
    eyes.count = 0;
    eyes.frustumCulled = false;
    eyes.castShadow = false;
    this.scene.add(body, eyes);
    return { body, eyes, fx };
  }

  /** Total triangles the enemy batches will draw this frame (main pass only) - perf probes. */
  drawnTriangles(): number {
    let n = 0;
    const tri = (m: THREE.InstancedMesh) => {
      const g = m.geometry;
      const c = g.index ? g.index.count : g.attributes.position?.count ?? 0;
      return (c / 3) * m.count;
    };
    for (const b of this.batches.values()) for (const p of [b.hi, b.lo]) if (p) n += tri(p.body) + tri(p.eyes);
    return n;
  }

  /** True while regular enemies are drawn with their horde LOD. */
  get usingHordeLod(): boolean {
    return this.hordeLod;
  }

  private updateLod(ctx: GameContext): void {
    const q: EnemyRenderQuality = this.renderQuality ?? (ctx.save?.settings?.quality as EnemyRenderQuality | undefined) ?? 'high';
    const n = this.activeCount + this.dyingList.length;
    if (q !== 'high') this.hordeLod = true;
    else this.hordeLod = this.hordeLod ? n > HORDE_LOD_OFF : n > HORDE_LOD_ON;
    if (q !== this.appliedQuality) {
      this.appliedQuality = q;
      const cast = q === 'high';
      for (const b of this.batches.values()) {
        b.hi.body.castShadow = cast;
        if (b.lo) b.lo.body.castShadow = cast;
      }
    }
    for (const b of this.batches.values()) {
      const want = this.hordeLod && b.lo ? b.lo : b.hi;
      if (want !== b.cur) {
        b.cur.body.count = 0;
        b.cur.eyes.count = 0;
        b.cur = want;
      }
    }
  }

  private ensureBatch(def: EnemyDef): Batch {
    let b = this.batches.get(def.id);
    if (b) return b;
    const model = buildEnemyModel(def.shape);
    // + headroom for corpses still playing their death animation
    const capacity = (def.boss ? 4 : def.id === 'shade' || def.id === 'wisp' || def.id === 'crawler' ? 700 : 300) + (def.boss ? 2 : 48);
    const hi = this.makePart(def, model, capacity);
    const loModel = def.boss ? null : buildEnemyLodModel(def.shape);
    const lo = loModel ? this.makePart(def, loModel, capacity) : null;
    b = { def, tint: model.vertexColors ? 0xffffff : def.color, hi, lo, cur: hi, capacity, n: 0 };
    this.batches.set(def.id, b);
    return b;
  }

  spawn(defId: string, x: number, z: number, opts: { elite?: boolean; hpMul?: number } = {}): Enemy | null {
    const def = ENEMIES[defId];
    if (!def) return null;
    const batch = this.ensureBatch(def);
    let countOfType = 0;
    for (const e of this.list) if (e.active && e.def === def) countOfType++;
    if (countOfType >= batch.capacity - (def.boss ? 2 : 48)) return null;
    const e: Enemy =
      this.free.pop() ??
      ({ hitCd: new Map() } as unknown as Enemy);
    const elite = !!opts.elite;
    const hpMul = (opts.hpMul ?? 1) * (def.boss ? 1 : this.hpMul) * (elite ? 8 : 1);
    Object.assign(e, {
      id: this.nextId++,
      active: true,
      def,
      x,
      z,
      vx: 0,
      vz: 0,
      kbx: 0,
      kbz: 0,
      hp: def.hp * hpMul,
      maxHp: def.hp * hpMul,
      radius: def.radius * (elite ? 1.5 : 1),
      scale: def.scale * (elite ? 1.5 : 1),
      damage: def.damage * this.damageMul * (elite ? 1.5 : 1),
      speedMul: 0.9 + Math.random() * 0.2,
      hitFlash: 0,
      slowTimer: 0,
      burnTimer: 0,
      burnDps: 0,
      phase: Math.random() * 10,
      timer: (def.attackInterval ?? 3) * (0.5 + Math.random()),
      state: 0,
      stateTime: 0,
      elite,
      facing: 0,
      burnSource: 'brazier',
      shield: (def.shield ?? 0) * hpMul,
      maxShield: (def.shield ?? 0) * hpMul,
      sinceHit: 0,
      aux: 0,
      aux2: 0,
      enraged: false,
      lastPattern: -1,
      age: 0,
      dying: -1,
    });
    if (def.boss) e.timer = 2.5;
    e.hitCd.clear();
    this.list.push(e);
    if (def.boss) {
      this.boss = e;
    }
    return e;
  }

  clear(): void {
    for (const e of this.list) {
      e.active = false;
      e.dying = -1;
      this.free.push(e);
    }
    for (const e of this.dyingList) {
      e.dying = -1;
      this.free.push(e);
    }
    this.list.length = 0;
    this.dyingList.length = 0;
    this.boss = null;
    for (const h of this.hazards) h.active = false;
    this.lastWardCallout = -10;
    for (const b of this.batches.values()) {
      for (const p of [b.hi, b.lo]) {
        if (!p) continue;
        p.body.count = 0;
        p.eyes.count = 0;
      }
    }
  }

  nearest(x: number, z: number, maxDist = 30, exclude?: Set<number>): Enemy | null {
    let best: Enemy | null = null;
    let bestD = maxDist * maxDist;
    for (const e of this.list) {
      if (!e.active) continue;
      if (exclude && exclude.has(e.id)) continue;
      const dx = e.x - x;
      const dz = e.z - z;
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  /** Random active enemy within dist (used by weapons that pick random targets). */
  randomInRange(x: number, z: number, dist: number, rand: () => number): Enemy | null {
    const cands: Enemy[] = [];
    this.hash.query(x, z, dist, (e) => {
      if (e.active && (e.x - x) ** 2 + (e.z - z) ** 2 <= dist * dist) cands.push(e);
    });
    if (!cands.length) return null;
    return cands[Math.floor(rand() * cands.length)];
  }

  forEachInRadius(x: number, z: number, r: number, fn: (e: Enemy) => void): void {
    this.hash.query(x, z, r + 2.5, (e) => {
      if (!e.active) return;
      const rr = r + e.radius;
      if ((e.x - x) ** 2 + (e.z - z) ** 2 <= rr * rr) fn(e);
    });
  }

  knockbackAll(x: number, z: number, radius: number, force: number): void {
    this.forEachInRadius(x, z, radius, (e) => {
      const dx = e.x - x;
      const dz = e.z - z;
      const d = Math.hypot(dx, dz) || 1;
      const k = force * (1 - e.def.knockbackResist);
      e.kbx += (dx / d) * k;
      e.kbz += (dz / d) * k;
    });
  }

  /** Applies damage. Returns true if the enemy died. Damage is credited to `opts.source` in the run summary. */
  damage(e: Enemy, amount: number, ctx: GameContext, opts: DamageOpts = {}): boolean {
    if (!e.active) return false;
    const stats = ctx.run.stats;
    let dmg = amount;
    let crit = false;
    if (opts.canCrit !== false && ctx.rng.next() < stats.critChance * stats.luck) {
      dmg *= stats.critMult;
      crit = true;
    }
    e.sinceHit = 0;
    let warded = false;
    if (e.shield > 0) {
      // the ward soaks damage first; crits chew through it twice as fast
      const absorb = Math.min(e.shield, crit ? dmg * 2 : dmg);
      e.shield -= absorb;
      dmg = Math.max(0, dmg - (crit ? absorb / 2 : absorb));
      warded = true;
      if (e.shield <= 0) {
        ctx.fx.ring(e.x, e.z, 0x7af0ff, 0.4, 2.2 * e.scale, 0.35);
        ctx.fx.burst(e.x, 1.0 * e.scale, e.z, 0x9af4ff, 18, 5, 0.45, 0.3);
        // throttled callout so a pack of wardens doesn't bury the screen in text
        if (ctx.run.elapsed - this.lastWardCallout > 1.2) {
          this.lastWardCallout = ctx.run.elapsed;
          ctx.fx.text(e.x, 1.8 * e.scale + 0.4, e.z, 'WARD BROKEN', 'ft-blue');
        }
      }
    }
    const dealt = Math.min(dmg, Math.max(0, e.hp));
    e.hp -= dmg;
    e.hitFlash = 1;
    const src = opts.source ?? 'other';
    if (dealt > 0) ctx.run.addDamage(src, dealt);
    if (opts.knockback && opts.fromX !== undefined && opts.fromZ !== undefined) {
      const dx = e.x - opts.fromX;
      const dz = e.z - opts.fromZ;
      const d = Math.hypot(dx, dz) || 1;
      const k = opts.knockback * (1 - (e.shield > 0 ? 1 : e.def.knockbackResist));
      e.kbx += (dx / d) * k;
      e.kbz += (dz / d) * k;
    }
    // VFX: directional impact sparks (also tags the next damage number with the source's colour)
    ctx.fx.hit(e.x, 0.9 * e.scale, e.z, opts.fromX !== undefined ? e.x - opts.fromX : 0, opts.fromZ !== undefined ? e.z - opts.fromZ : 0, src, crit, e.scale);
    if (ctx.save.settings.damageNumbers) {
      const shown = warded && dmg <= 0 ? amount : dmg;
      ctx.fx.text(e.x, 1.4 * e.scale + 0.4, e.z, Math.round(shown).toString(), crit ? 'ft-crit' : warded ? 'ft-blue' : opts.color ?? '');
    }
    ctx.events.emit('enemy:hit', { x: e.x, z: e.z, damage: dmg, crit });
    if (e.hp <= 0) {
      this.kill(e, ctx, src);
      return true;
    }
    return false;
  }

  kill(e: Enemy, ctx: GameContext, source = 'other'): void {
    if (!e.active) return;
    e.active = false;
    e.dying = 0; // death animation (render only; see writeInstances)
    const run = ctx.run;
    run.kills++;
    run.killsBySource.set(source, (run.killsBySource.get(source) ?? 0) + 1);
    run.killsByEnemy.set(e.def.id, (run.killsByEnemy.get(e.def.id) ?? 0) + 1);
    if (e.elite) run.elitesKilled++;
    ctx.fx.enemyDeath(e.x, e.z, e.scale, e.def.eyeColor, e.def.boss ? 2 : e.elite ? 1 : 0);
    ctx.events.emit('enemy:killed', { x: e.x, z: e.z, defId: e.def.id, xp: e.def.xp * (e.elite ? 4 : 1), elite: e.elite });
    const def = e.def;
    if (def.behavior === 'splitter' && def.splitInto) {
      const n = def.splitCount ?? 2;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + e.phase;
        const c = this.spawn(def.splitInto, e.x + Math.cos(a) * 0.5, e.z + Math.sin(a) * 0.5, { elite: false });
        if (c) {
          c.kbx = Math.cos(a) * 7;
          c.kbz = Math.sin(a) * 7;
          c.hitFlash = 1;
          c.age = 0.2; // pops out of the burst instead of rising from the ground
        }
      }
      ctx.fx.burst(e.x, 0.6, e.z, def.eyeColor, 16, 5, 0.5, 0.35);
    } else if (def.behavior === 'exploder') {
      // popped before its fuse ran out: it bursts on its own kind instead of you
      this.detonate(e, ctx, false);
    }
    if (def.boss) {
      ctx.events.emit('boss:killed', { defId: def.id });
      if (this.boss === e) this.boss = null;
      for (const h of this.hazards) h.active = false;
    }
  }

  /** Exploder blast. hostile=true hurts the player; false (killed early) hurts nearby enemies — chain reactions. */
  private detonate(e: Enemy, ctx: GameContext, hostile: boolean): void {
    const r = (e.def.blastRadius ?? 2.4) * (e.elite ? 1.4 : 1);
    ctx.fx.ring(e.x, e.z, 0xffb02a, 0.4, r, 0.35);
    ctx.fx.burst(e.x, 0.7, e.z, 0xffb02a, 36, 9, 0.55, 0.45);
    ctx.fx.burst(e.x, 0.5, e.z, 0xff5a1a, 18, 5, 0.7, 0.5, -1);
    ctx.events.emit('enemy:exploded', { x: e.x, z: e.z });
    if (hostile) {
      const p = ctx.player;
      if ((p.x - e.x) ** 2 + (p.z - e.z) ** 2 <= (r + p.radius) ** 2) p.damage((e.def.blastDamage ?? 16) * this.damageMul * (e.elite ? 1.5 : 1), ctx);
      ctx.shake(0.12);
    } else {
      const dmg = (e.def.blastDamage ?? 16) * 2 * ctx.run.stats.might;
      const x = e.x;
      const z = e.z;
      this.forEachInRadius(x, z, r, (o) => {
        if (o === e || o.def.boss) return;
        this.damage(o, dmg, ctx, { knockback: 8, fromX: x, fromZ: z, source: 'blast', canCrit: false });
      });
    }
  }

  /** Shows an area telegraph: VFX-agent fx.telegraph when available, rings otherwise. */
  telegraph(ctx: GameContext, x: number, z: number, r: number, dur: number, color: number): void {
    const fx = ctx.fx as unknown as TelegraphFx;
    if (typeof fx.telegraph === 'function') fx.telegraph(x, z, r, dur, color);
    else {
      ctx.fx.ring(x, z, color, r * 0.98, r, dur);
      ctx.fx.ring(x, z, color, r * 0.1, r, dur);
    }
  }

  /** Schedules a telegraphed area hit that lands after `delay` seconds. */
  addHazard(ctx: GameContext, x: number, z: number, r: number, delay: number, damage: number, color: number): void {
    const h = this.hazards.find((q) => !q.active);
    if (!h) return;
    h.active = true;
    h.x = x;
    h.z = z;
    h.r = r;
    h.t = delay;
    h.damage = damage;
    h.color = color;
    this.telegraph(ctx, x, z, r, delay, color);
  }

  private updateHazards(dt: number, ctx: GameContext): void {
    const p = ctx.player;
    for (const h of this.hazards) {
      if (!h.active) continue;
      h.t -= dt;
      if (h.t > 0) continue;
      h.active = false;
      ctx.fx.ring(h.x, h.z, h.color, h.r * 0.3, h.r * 1.15, 0.3);
      ctx.fx.burst(h.x, 0.4, h.z, h.color, 22, 7, 0.5, 0.4);
      if ((p.x - h.x) ** 2 + (p.z - h.z) ** 2 <= (h.r + p.radius) ** 2) p.damage(h.damage, ctx);
      if (h.r > 4) ctx.shake(0.35);
    }
  }

  update(dt: number, ctx: GameContext, time: number): void {
    const player = ctx.player;
    const px = player.x;
    const pz = player.z;

    // compact list & rebuild hash
    let w = 0;
    for (let i = 0; i < this.list.length; i++) {
      const e = this.list[i];
      if (e.active) this.list[w++] = e;
      else if (e.dying >= 0) this.dyingList.push(e);
      else this.free.push(e);
    }
    this.list.length = w;
    // advance death animations; finished corpses go back to the pool
    let dw = 0;
    for (let i = 0; i < this.dyingList.length; i++) {
      const e = this.dyingList[i];
      e.dying += dt;
      if (e.dying < (e.def.boss ? BOSS_DEATH_TIME : DEATH_TIME)) this.dyingList[dw++] = e;
      else {
        e.dying = -1;
        this.free.push(e);
      }
    }
    this.dyingList.length = dw;
    this.activeCount = w;
    if (w > ctx.run.peakEnemies) ctx.run.peakEnemies = w;
    this.hash.clear();
    for (const e of this.list) this.hash.insert(e);
    this.updateHazards(dt, ctx);

    for (const e of this.list) {
      if (!e.active) continue;
      const def = e.def;
      e.phase += dt;
      e.age += dt;
      e.stateTime += dt;
      e.sinceHit += dt;
      if (e.hitFlash > 0) e.hitFlash = Math.max(0, e.hitFlash - dt * 6);
      for (const [k, v] of e.hitCd) {
        if (v - dt <= 0) e.hitCd.delete(k);
        else e.hitCd.set(k, v - dt);
      }
      if (e.burnTimer > 0) {
        e.burnTimer -= dt;
        const b = Math.min(e.burnDps * dt, Math.max(0, e.hp));
        e.hp -= e.burnDps * dt;
        ctx.run.addDamage(e.burnSource, b);
        if (Math.random() < dt * 8) ctx.fx.spark(e.x, 0.8, e.z, 0, 1.5, 0, 0xff6a1a, 0.5, 0.35);
        if (e.hp <= 0) {
          this.kill(e, ctx, e.burnSource);
          continue;
        }
      }
      let slow = 1;
      if (e.slowTimer > 0) {
        e.slowTimer -= dt;
        slow = def.boss ? 0.75 : 0.45;
      }
      const dx = px - e.x;
      const dz = pz - e.z;
      const dist = Math.hypot(dx, dz) || 0.0001;
      const nx = dx / dist;
      const nz = dz / dist;
      let speed = def.speed * e.speedMul * this.speedMul * slow;
      let mvx = nx;
      let mvz = nz;

      switch (def.behavior) {
        case 'swarm': {
          // slight sinusoidal weave
          const s = Math.sin(e.phase * 3 + e.id) * 0.5;
          mvx = nx - nz * s;
          mvz = nz + nx * s;
          break;
        }
        case 'splitter': {
          // jelly lurch: surges forward in pulses
          speed *= 0.55 + Math.max(0, Math.sin(e.phase * 4 + e.id)) * 1.1;
          break;
        }
        case 'shielded': {
          if (e.shield > 0) speed *= 0.85;
          else if (e.maxShield > 0 && e.sinceHit > 3.5) {
            e.shield = Math.min(e.maxShield, e.shield + e.maxShield * 0.3 * dt);
            if (e.shield >= e.maxShield * 0.99) ctx.fx.ring(e.x, e.z, 0x7af0ff, 0.5, 1.6 * e.scale, 0.3);
          }
          if (e.shield > 0 && Math.random() < dt * 3) {
            const a = Math.random() * Math.PI * 2;
            ctx.fx.spark(e.x + Math.cos(a) * e.radius, 0.9 * e.scale, e.z + Math.sin(a) * e.radius, 0, 0.8, 0, 0x7af0ff, 0.4, 0.3);
          }
          break;
        }
        case 'exploder': {
          if (e.state === 0) {
            if (dist < 2.1) {
              e.state = 3; // primed
              e.stateTime = 0;
              this.telegraph(ctx, e.x, e.z, (def.blastRadius ?? 2.4) * (e.elite ? 1.4 : 1), def.fuse ?? 0.85, 0xffb02a);
            }
          } else {
            const fuse = def.fuse ?? 0.85;
            const k = Math.min(1, e.stateTime / fuse);
            speed *= 0.12;
            e.hitFlash = Math.max(e.hitFlash, 0.35 + 0.35 * Math.sin(e.stateTime * (12 + k * 30)));
            e.scale = def.scale * (e.elite ? 1.5 : 1) * (1 + 0.3 * k);
            if (e.stateTime >= fuse) {
              e.active = false; // self-destruct: no xp
              this.detonate(e, ctx, true);
              continue;
            }
          }
          break;
        }
        case 'dash': {
          if (e.state === 0) {
            e.timer -= dt;
            if (e.timer <= 0 && dist < 12) {
              e.state = 1; // windup
              e.stateTime = 0;
            }
          } else if (e.state === 1) {
            speed *= 0.1;
            if (e.stateTime > 0.6) {
              e.state = 2;
              e.stateTime = 0;
              e.vx = nx;
              e.vz = nz;
            }
          } else if (e.state === 2) {
            mvx = e.vx;
            mvz = e.vz;
            speed = def.speed * 4.2 * slow;
            if (e.stateTime > 0.45) {
              e.state = 0;
              e.timer = def.attackInterval ?? 3;
            }
          }
          break;
        }
        case 'ranged': {
          if (dist < 9) {
            // keep distance
            mvx = -nx * 0.6;
            mvz = -nz * 0.6;
          } else if (dist < 12) {
            speed *= 0.2;
          }
          e.timer -= dt;
          if (e.timer <= 0 && dist < 16) {
            e.timer = def.attackInterval ?? 2.5;
            ctx.projectiles.spawnHostile(e.x, e.z, nx, nz, def.projectileSpeed ?? 7, (def.projectileDamage ?? 8) * this.damageMul, def.eyeColor);
          }
          break;
        }
        case 'boss': {
          this.updateBoss(e, dt, ctx, nx, nz, dist);
          if (e.state === 2) {
            mvx = e.vx;
            mvz = e.vz;
            speed = def.speed * (e.enraged ? 5.2 : 4.4);
          } else if (e.state === 1) {
            speed *= 0.05;
          } else if (e.state >= 3) {
            speed *= 0.3;
          }
          break;
        }
      }

      // separation from neighbours
      let sx = 0;
      let sz = 0;
      if (!def.boss) {
        let n = 0;
        this.hash.query(e.x, e.z, e.radius * 2, (o) => {
          if (o === e || !o.active) return;
          const ox = e.x - o.x;
          const oz = e.z - o.z;
          const min = e.radius + o.radius;
          const d2 = ox * ox + oz * oz;
          if (d2 < min * min && d2 > 1e-6) {
            const d = Math.sqrt(d2);
            const push = (min - d) / min;
            sx += (ox / d) * push;
            sz += (oz / d) * push;
            n++;
          }
          return n > 6;
        });
      }

      e.x += (mvx * speed + sx * 4 + e.kbx) * dt;
      e.z += (mvz * speed + sz * 4 + e.kbz) * dt;
      const kbDecay = Math.exp(-dt * 8);
      e.kbx *= kbDecay;
      e.kbz *= kbDecay;
      if (Math.abs(mvx) + Math.abs(mvz) > 0.01) {
        const target = Math.atan2(mvx, mvz);
        let d = target - e.facing;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        e.facing += d * Math.min(1, dt * 8);
      }

      // contact damage
      const cr = e.radius + player.radius;
      if (dist < cr && !player.dead) {
        player.damage(e.damage, ctx);
      }

      // despawn far-away stragglers by relocating them ahead of the player
      if (dist > 45 && !def.boss) {
        const a = Math.random() * Math.PI * 2;
        e.x = px + Math.cos(a) * 26;
        e.z = pz + Math.sin(a) * 26;
      }
    }

    this.updateLod(ctx);
    this.writeInstances(time);
  }

  /**
   * Boss brain. States: 0 stalk (timer → next attack), 1 charge windup, 2 charging, 3 cast (telegraph → resolve),
   * 4 channel (spiral stream / multi-wave). Patterns come from def.bossPatterns, never the same twice in a row.
   * Below def.enrageAt hp the boss enrages once: faster, shorter gaps, bigger patterns.
   */
  private updateBoss(e: Enemy, dt: number, ctx: GameContext, nx: number, nz: number, dist: number): void {
    const def = e.def;
    const patterns = def.bossPatterns ?? ['charge', 'volley', 'summon'];
    const projDmg = (def.projectileDamage ?? 12) * this.damageMul;
    const col = def.eyeColor;
    if (!e.enraged && e.hp < e.maxHp * (def.enrageAt ?? 0.35)) {
      e.enraged = true;
      e.speedMul = 1.3;
      ctx.events.emit('boss:enraged', { defId: def.id });
      ctx.fx.ring(e.x, e.z, 0xff3a3a, 1, 14, 0.9);
      ctx.fx.burst(e.x, 2, e.z, 0xff3a3a, 90, 10, 1);
      ctx.fx.text(e.x, 4.5, e.z, 'ENRAGED', 'ft-big');
      ctx.shake(0.8);
      this.knockbackAll(e.x, e.z, 8, 14);
      e.timer = Math.min(e.timer, 1);
    }
    const gap = (def.attackInterval ?? 4) * (e.enraged ? 0.65 : 1);

    switch (e.state) {
      case 0: {
        e.timer -= dt;
        if (e.timer > 0) return;
        let idx = Math.floor(ctx.rng.next() * patterns.length);
        if (idx === e.lastPattern && patterns.length > 1) idx = (idx + 1) % patterns.length;
        e.lastPattern = idx;
        const pat = patterns[idx];
        e.stateTime = 0;
        if (pat === 'charge') {
          e.state = 1;
          e.aux = e.enraged ? 3 : 1;
          this.aimCharge(e, ctx, nx, nz);
        } else {
          e.state = 3;
          e.aux2 = idx;
          this.beginCast(e, ctx, pat, projDmg, dist);
        }
        return;
      }
      case 1: {
        const windup = e.enraged ? 0.6 : 0.95;
        if (e.stateTime > windup) {
          e.state = 2;
          e.stateTime = 0;
          ctx.shake(0.35);
          ctx.fx.ring(e.x, e.z, col, 1, 4, 0.3);
        }
        return;
      }
      case 2: {
        if (Math.random() < 0.6) ctx.fx.spark(e.x, 0.3, e.z, -e.vx * 3, 1, -e.vz * 3, col, 0.5, 0.5);
        if (e.stateTime > 0.8) {
          e.aux--;
          if (e.aux > 0) {
            e.state = 1;
            e.stateTime = 0.25; // shorter re-aim between chained charges
            this.aimCharge(e, ctx, nx, nz);
          } else {
            e.state = 0;
            e.timer = gap;
          }
        }
        return;
      }
      case 3: {
        const pat = patterns[e.aux2];
        const castTime = pat === 'volley' ? 0.7 : pat === 'spiral' ? 0.6 : pat === 'summon' ? 0.8 : 1.3;
        if (e.stateTime < castTime) return;
        e.stateTime = 0;
        if (pat === 'volley') {
          this.radial(e, ctx, e.enraged ? 22 : 16, e.phase, projDmg);
          if (e.enraged) {
            e.state = 4;
            e.aux = 1; // one more staggered ring
            return;
          }
        } else if (pat === 'spiral') {
          e.state = 4;
          e.aux = e.enraged ? 40 : 28; // stream ticks
          return;
        } else if (pat === 'summon') {
          const pool = def.minions ?? ctx.world.biome.enemyPool;
          const n = e.enraged ? 12 : 8;
          for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2;
            const m = this.spawn(pool[i % pool.length], e.x + Math.cos(a) * 3.5, e.z + Math.sin(a) * 3.5, { elite: e.enraged && i === 0 });
            if (m) m.hitFlash = 1;
          }
          ctx.fx.ring(e.x, e.z, 0x8844ff, 1, 8, 0.6);
        }
        // eruptions / slam / rain already scheduled as hazards in beginCast
        e.state = 0;
        e.timer = gap;
        return;
      }
      case 4: {
        const pat = patterns[e.aux2];
        if (pat === 'spiral') {
          if (e.stateTime < 0.085) return;
          e.stateTime = 0;
          const arms = e.enraged ? 4 : 3;
          const base = e.aux * 0.32 * (e.enraged ? -1 : 1);
          for (let k = 0; k < arms; k++) {
            const a = base + (k / arms) * Math.PI * 2;
            ctx.projectiles.spawnHostile(e.x, e.z, Math.cos(a), Math.sin(a), (def.projectileSpeed ?? 8) * 0.85, projDmg * 0.8, col);
          }
          e.aux--;
        } else {
          // staggered second volley ring
          if (e.stateTime < 0.4) return;
          this.radial(e, ctx, 22, e.phase + Math.PI / 22, projDmg);
          e.aux = 0;
        }
        if (e.aux <= 0) {
          e.state = 0;
          e.timer = gap;
        }
        return;
      }
    }
  }

  private aimCharge(e: Enemy, ctx: GameContext, nx: number, nz: number): void {
    // lock direction now (leading the player slightly) and telegraph the lane
    const p = ctx.player;
    const tx = p.x + p.vx * 0.35 - e.x;
    const tz = p.z + p.vz * 0.35 - e.z;
    const d = Math.hypot(tx, tz) || 1;
    e.vx = d > 0.5 ? tx / d : nx;
    e.vz = d > 0.5 ? tz / d : nz;
    const len = e.def.speed * (e.enraged ? 5.2 : 4.4) * 0.8;
    for (let i = 1; i <= 5; i++) {
      const k = (i / 5) * len;
      this.telegraph(ctx, e.x + e.vx * k, e.z + e.vz * k, e.radius * 0.9, e.enraged ? 0.6 : 0.95, 0xff4a4a);
    }
  }

  private beginCast(e: Enemy, ctx: GameContext, pat: string, projDmg: number, _dist: number): void {
    const p = ctx.player;
    const col = e.def.eyeColor;
    switch (pat) {
      case 'volley':
      case 'spiral':
        this.telegraph(ctx, e.x, e.z, e.radius * 1.8, 0.7, col);
        break;
      case 'summon':
        this.telegraph(ctx, e.x, e.z, 3.5, 0.8, 0x8844ff);
        break;
      case 'eruptions': {
        // one under the player (leading), a ring around it; enraged: a second outer ring
        const lx = p.x + p.vx * 0.6;
        const lz = p.z + p.vz * 0.6;
        this.addHazard(ctx, lx, lz, 1.9, 1.15, projDmg * 1.6, col);
        const n = e.enraged ? 7 : 4;
        const off = ctx.rng.next() * Math.PI;
        for (let i = 0; i < n; i++) {
          const a = off + (i / n) * Math.PI * 2;
          this.addHazard(ctx, lx + Math.cos(a) * 3.6, lz + Math.sin(a) * 3.6, 1.7, 1.25, projDmg * 1.4, col);
          if (e.enraged) this.addHazard(ctx, lx + Math.cos(a + 0.45) * 6.5, lz + Math.sin(a + 0.45) * 6.5, 1.7, 1.6, projDmg * 1.4, col);
        }
        break;
      }
      case 'slam':
        this.addHazard(ctx, e.x, e.z, e.enraged ? 8.5 : 7, 1.3, projDmg * 2, 0xff5a5a);
        break;
      case 'rain': {
        const n = e.enraged ? 16 : 10;
        this.addHazard(ctx, p.x, p.z, 1.6, 1.0, projDmg * 1.3, col);
        for (let i = 1; i < n; i++) {
          const a = ctx.rng.next() * Math.PI * 2;
          const r = 1.5 + ctx.rng.next() * 8;
          this.addHazard(ctx, p.x + Math.cos(a) * r, p.z + Math.sin(a) * r, 1.6, 0.9 + ctx.rng.next() * 1.0, projDmg * 1.3, col);
        }
        break;
      }
    }
  }

  private radial(e: Enemy, ctx: GameContext, n: number, off: number, dmg: number): void {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + off;
      ctx.projectiles.spawnHostile(e.x, e.z, Math.cos(a), Math.sin(a), e.def.projectileSpeed ?? 8, dmg, e.def.eyeColor);
    }
    ctx.fx.ring(e.x, e.z, e.def.eyeColor, 1, 6, 0.5);
  }

  private writeInstances(time: number): void {
    // per-batch write cursor (no per-frame Map allocation)
    for (const b of this.batches.values()) b.n = 0;
    for (const e of this.list) if (e.active) this.writeOne(e, time);
    for (const e of this.dyingList) this.writeOne(e, time);
    for (const b of this.batches.values()) {
      const p = b.cur;
      p.body.count = b.n;
      p.eyes.count = b.n;
      p.body.instanceMatrix.needsUpdate = true;
      p.eyes.instanceMatrix.needsUpdate = true;
      if (p.body.instanceColor) p.body.instanceColor.needsUpdate = true;
      p.fx.needsUpdate = true;
    }
  }

  private writeOne(e: Enemy, time: number): void {
    const b = this.batches.get(e.def.id)!;
    const i = b.n;
    if (i >= b.capacity) return;
    b.n = i + 1;
    const p = b.cur;
    const pose = poseEnemy(e, POSE_SCRATCH);
    const s = e.scale;
    tmpP.set(e.x, pose.y * s, e.z);
    poseQuaternion(e.facing, pose, tmpQ);
    tmpS.set(s * pose.sx, s * pose.sy, s * pose.sz);
    tmpM.compose(tmpP, tmpQ, tmpS);
    p.body.setMatrixAt(i, tmpM);
    p.eyes.setMatrixAt(i, tmpM);
    // base tint (white for vertex-coloured GLB models); elites run slightly warmer
    tmpC.setHex(b.tint);
    if (e.elite) tmpC.multiplyScalar(1.08).offsetHSL(0.02, 0.05, 0);
    p.body.setColorAt(i, tmpC);
    const alive = e.dying < 0;
    const burn = alive && e.burnTimer > 0 ? 0.65 + 0.35 * Math.sin(time * 14 + e.id) : 0;
    p.fx.setXYZW(i, pose.flash, e.elite ? 0.75 + 0.25 * Math.sin(time * 4 + e.id) : 0, alive && e.slowTimer > 0 ? 1 : 0, burn);
  }
}
