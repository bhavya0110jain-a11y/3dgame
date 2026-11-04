import * as THREE from 'three';
import type { GameContext, WeaponDef, WeaponInstance } from '../game/types';
import type { Enemy } from '../entities/Enemies';
import type { Projectile } from '../entities/Projectiles';
import { TimedWeapon, MeshPool, glowMaterial, densestTarget, telegraph } from './weaponKit';

/*
 * New base weapons (each with an `evolved` variant used by its evolution):
 *   lantern_hook  – boomerang: flies out, returns, pierces both ways          → moonhook_reaper (+ Lodestone)
 *   moth_lantern  – homing moths that seek their own targets                   → lunar_monarchs  (+ Keeper's Tome)
 *   vesper_bell   – telegraphed ground toll on the densest pack, stuns        → cathedral_toll  (+ Ashen Clover)
 *   gloam_beam    – lighthouse beams sweeping around you                       → eclipse_beam    (+ Twin Flame)
 */

// ---------------------------------------------------------------- Lantern Hook (boomerang)
interface Hook {
  active: boolean;
  x: number;
  z: number;
  dx: number;
  dz: number;
  dist: number;
  max: number;
  speed: number;
  dmg: number;
  back: boolean;
  spin: number;
  hit: Set<number>;
}

export class LanternHook extends TimedWeapon {
  private hooks: Hook[] = [];
  private pool: MeshPool;
  private cur!: Hook;
  private pullTimer = 0;
  private readonly onTouch = (e: Enemy) => this.touch(e);
  private ctxRef!: GameContext;
  constructor(def: WeaponDef, ctx: GameContext, private evolved = false) {
    super(def);
    const geom = new THREE.TorusGeometry(evolved ? 0.5 : 0.36, evolved ? 0.1 : 0.08, 6, 14, Math.PI * 1.35).rotateX(-Math.PI / 2);
    this.pool = new MeshPool(ctx.scene, geom, glowMaterial(evolved ? 0xc8b0ff : 0xffcf6a, 2.8));
  }
  baseCooldown() {
    return this.evolved ? 1.05 : this.lv([1.9, 1.8, 1.7, 1.6, 1.5, 1.4, 1.3, 1.1]);
  }
  fire(ctx: GameContext): void {
    const s = ctx.run.stats;
    const count = (this.evolved ? 6 : this.lv([1, 1, 2, 2, 2, 3, 3, 4])) + s.amount;
    const dmg = (this.evolved ? 46 : this.lv([14, 17, 19, 22, 26, 30, 34, 40])) * s.might;
    const p = ctx.player;
    const t = ctx.enemies.nearest(p.x, p.z, 14);
    const a0 = t ? Math.atan2(t.z - p.z, t.x - p.x) : Math.atan2(p.aimZ, p.aimX);
    const fan = this.evolved ? (Math.PI * 2) / count : 0.35;
    for (let i = 0; i < count; i++) {
      const a = this.evolved ? a0 + i * fan : a0 + (i - (count - 1) / 2) * fan;
      let h = this.hooks.find((q) => !q.active);
      if (!h) {
        h = { active: false, x: 0, z: 0, dx: 0, dz: 0, dist: 0, max: 0, speed: 0, dmg: 0, back: false, spin: 0, hit: new Set() };
        this.hooks.push(h);
      }
      h.active = true;
      h.x = p.x;
      h.z = p.z;
      h.dx = Math.cos(a);
      h.dz = Math.sin(a);
      h.dist = 0;
      h.max = (this.evolved ? 10 : this.lv([7, 7.5, 7.5, 8, 8.5, 8.5, 9, 10])) * Math.sqrt(s.area) * s.duration;
      h.speed = (this.evolved ? 18 : 15) * s.projectileSpeed;
      h.dmg = dmg;
      h.back = false;
      h.hit.clear();
    }
    ctx.events.emit('weapon:fired', { weaponId: this.def.id });
  }
  private touch(e: Enemy): void {
    const h = this.cur;
    if (h.hit.has(e.id)) return;
    h.hit.add(e.id);
    const ctx = this.ctxRef;
    const p = ctx.player;
    // outbound shoves away; the return trip drags shadows toward you (reaper drags harder)
    if (h.back) ctx.enemies.damage(e, h.dmg, ctx, { knockback: this.evolved ? -9 : -4, fromX: p.x, fromZ: p.z, source: this.def.id });
    else ctx.enemies.damage(e, h.dmg, ctx, { knockback: 5, fromX: h.x - h.dx, fromZ: h.z - h.dz, source: this.def.id });
    ctx.fx.burst(e.x, 0.9, e.z, this.evolved ? 0xc8b0ff : 0xffcf6a, 4, 3, 0.25, 0.25);
  }
  update(dt: number, ctx: GameContext): void {
    super.update(dt, ctx);
    this.ctxRef = ctx;
    const s = ctx.run.stats;
    const p = ctx.player;
    const r = (this.evolved ? 0.75 : 0.55) * Math.sqrt(s.area);
    this.pullTimer -= dt;
    const pull = this.evolved && this.pullTimer <= 0;
    if (pull) this.pullTimer = 0.12;
    this.pool.begin();
    for (const h of this.hooks) {
      if (!h.active) continue;
      if (!h.back) {
        const step = h.speed * dt * (1 - 0.55 * (h.dist / h.max));
        h.x += h.dx * step;
        h.z += h.dz * step;
        h.dist += step;
        if (h.dist >= h.max) {
          h.back = true;
          h.hit.clear();
        }
      } else {
        const dx = p.x - h.x;
        const dz = p.z - h.z;
        const d = Math.hypot(dx, dz) || 1;
        const step = h.speed * 1.35 * dt;
        if (d < Math.max(0.8, step)) {
          h.active = false;
          continue;
        }
        h.x += (dx / d) * step;
        h.z += (dz / d) * step;
        if (pull) {
          for (const pk of ctx.pickups.list) {
            if (pk.active && (pk.kind === 'ember' || pk.kind === 'ash') && (pk.x - h.x) ** 2 + (pk.z - h.z) ** 2 < 9) pk.magnetized = true;
          }
        }
      }
      h.spin += dt * 18;
      this.cur = h;
      ctx.enemies.forEachInRadius(h.x, h.z, r, this.onTouch);
      const m = this.pool.next();
      m.position.set(h.x, 1.0, h.z);
      m.rotation.set(0, h.spin, 0);
      m.scale.setScalar(Math.sqrt(s.area));
      if (Math.random() < 0.7) ctx.fx.spark(h.x, 1, h.z, 0, 0.4, 0, this.evolved ? 0xb090ff : 0xffb347, 0.35, 0.3);
    }
    this.pool.end();
  }
  dispose(): void {
    this.pool.dispose();
    this.hooks.length = 0;
  }
}

// ---------------------------------------------------------------- Moth Lantern (homing)
export class MothLantern extends TimedWeapon {
  private readonly onMothHit = (p: Projectile, e: Enemy, ctx: GameContext) => {
    // monarchs: a full-size moth splits into two smaller moths on hit (one generation)
    if (!this.evolved || p.scale < 0.8) return;
    for (let k = 0; k < 2; k++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 9 * ctx.run.stats.projectileSpeed;
      ctx.projectiles.spawn({
        x: e.x, z: e.z, y: 1.3, vx: Math.cos(a) * sp, vz: Math.sin(a) * sp,
        damage: p.damage * 0.5, pierce: 0, life: 1.6 * ctx.run.stats.duration, radius: 0.3, scale: 0.6,
        color: 0xffe6a0, source: this.def.id, knockback: 1, homing: 10, trail: 0.4,
      });
    }
  };
  constructor(def: WeaponDef, private evolved = false) {
    super(def);
  }
  baseCooldown() {
    return this.evolved ? 0.7 : this.lv([1.5, 1.4, 1.35, 1.25, 1.15, 1.05, 0.95, 0.85]);
  }
  fire(ctx: GameContext): void {
    const s = ctx.run.stats;
    const count = (this.evolved ? 6 : this.lv([2, 2, 3, 3, 4, 4, 5, 6])) + s.amount;
    const dmg = (this.evolved ? 26 : this.lv([7, 8, 9, 11, 12, 14, 16, 19])) * s.might;
    const p = ctx.player;
    for (let i = 0; i < count; i++) {
      // flutter out in a loose fan behind the lantern, then home in
      const a = Math.atan2(p.aimZ, p.aimX) + Math.PI + (Math.random() - 0.5) * 2.6;
      const sp = (this.evolved ? 10 : 8.5) * s.projectileSpeed;
      ctx.projectiles.spawn({
        x: p.x, z: p.z, y: 1.5, vx: Math.cos(a) * sp, vz: Math.sin(a) * sp,
        damage: dmg, pierce: this.evolved ? 1 : this.level >= 6 ? 1 : 0, life: 3 * s.duration,
        radius: 0.32 * s.area, scale: (this.evolved ? 1.1 : 0.9) * Math.sqrt(s.area),
        color: this.evolved ? 0xa0c8ff : 0xfff0c0, source: this.def.id, knockback: 1.5,
        homing: this.evolved ? 9 : this.lv([4.5, 5, 5, 5.5, 6, 6, 6.5, 7]), trail: 0.6,
        onHit: this.evolved ? this.onMothHit : undefined,
      });
    }
    ctx.events.emit('weapon:fired', { weaponId: this.def.id });
  }
}

// ---------------------------------------------------------------- Vesper Bell (telegraphed ground toll)
interface Toll {
  active: boolean;
  x: number;
  z: number;
  t: number;
  r: number;
  dmg: number;
  after: number; // aftershocks remaining (evolved)
}

export class VesperBell extends TimedWeapon {
  private tolls: Toll[] = [];
  private cur!: Toll;
  private ctxRef!: GameContext;
  private readonly onHitEnemy = (e: Enemy) => {
    const ctx = this.ctxRef;
    const t = this.cur;
    const s = ctx.run.stats;
    // Cathedral Toll: every toll is a guaranteed critical
    const dmg = this.evolved ? t.dmg * s.critMult : t.dmg;
    ctx.enemies.damage(e, dmg, ctx, { knockback: 10, fromX: t.x, fromZ: t.z, source: this.def.id, canCrit: !this.evolved, color: this.evolved ? 'ft-crit' : undefined });
    e.slowTimer = Math.max(e.slowTimer, 1.1 * s.duration);
  };
  constructor(def: WeaponDef, private evolved = false) {
    super(def);
  }
  baseCooldown() {
    return this.evolved ? 1.6 : this.lv([2.9, 2.7, 2.6, 2.4, 2.3, 2.1, 2.0, 1.8]);
  }
  fire(ctx: GameContext): void {
    const s = ctx.run.stats;
    const count = (this.evolved ? 3 : this.lv([1, 1, 1, 2, 2, 2, 3, 3])) + Math.floor(s.amount / 2 + 0.5);
    const r = (this.evolved ? 4 : this.lv([2.4, 2.6, 2.8, 2.8, 3.0, 3.2, 3.2, 3.6])) * s.area;
    const dmg = (this.evolved ? 70 : this.lv([30, 36, 42, 46, 54, 62, 70, 84])) * s.might;
    const p = ctx.player;
    for (let i = 0; i < count; i++) {
      const tgt = densestTarget(ctx, p.x, p.z, 10, r);
      const x = tgt ? tgt.x : p.x + ctx.rng.range(-4, 4);
      const z = tgt ? tgt.z : p.z + ctx.rng.range(-4, 4);
      let t = this.tolls.find((q) => !q.active);
      if (!t) {
        t = { active: false, x: 0, z: 0, t: 0, r: 0, dmg: 0, after: 0 };
        this.tolls.push(t);
      }
      t.active = true;
      t.x = x;
      t.z = z;
      t.t = 0.4 + i * 0.12;
      t.r = r;
      t.dmg = dmg;
      t.after = this.evolved ? 2 : 0;
      telegraph(ctx, x, z, r, t.t, this.evolved ? 0xfff0a0 : 0xffd27a);
    }
  }
  update(dt: number, ctx: GameContext): void {
    super.update(dt, ctx);
    this.ctxRef = ctx;
    for (const t of this.tolls) {
      if (!t.active) continue;
      t.t -= dt;
      if (t.t > 0) continue;
      this.cur = t;
      ctx.fx.ring(t.x, t.z, 0xffe0a0, 0.3, t.r * 1.1, 0.35);
      ctx.fx.ring(t.x, t.z, 0xffffff, 0.2, t.r * 0.6, 0.2);
      ctx.fx.burst(t.x, 0.3, t.z, 0xffd27a, 26, 8, 0.45, 0.4);
      ctx.enemies.forEachInRadius(t.x, t.z, t.r, this.onHitEnemy);
      ctx.events.emit('weapon:fired', { weaponId: this.def.id });
      ctx.shake(0.06);
      if (t.after > 0) {
        t.after--;
        t.t = 0.28;
        t.r *= 1.35;
        t.dmg *= 0.5;
      } else t.active = false;
    }
  }
  dispose(): void {
    this.tolls.length = 0;
  }
}

// ---------------------------------------------------------------- Gloam Beam (sweeping lighthouse)
export class GloamBeam implements WeaponInstance {
  level = 1;
  private angle = 0;
  private pool: MeshPool;
  private ctxRef!: GameContext;
  private bx = 0;
  private bz = 0;
  private cx = 1;
  private cz = 0;
  private len = 5;
  private width = 0.5;
  private dmg = 0;
  private readonly onEnemy = (e: Enemy) => {
    if (e.hitCd.has('beam')) return;
    const dx = e.x - this.bx;
    const dz = e.z - this.bz;
    const along = dx * this.cx + dz * this.cz;
    if (along < 0 || along > this.len + e.radius) return;
    const perp = Math.abs(-dx * this.cz + dz * this.cx);
    if (perp > this.width + e.radius) return;
    const ctx = this.ctxRef;
    e.hitCd.set('beam', 0.35);
    ctx.enemies.damage(e, this.dmg, ctx, { knockback: 1.5, fromX: this.bx, fromZ: this.bz, source: this.def.id, color: 'ft-blue' });
    if (this.evolved) {
      e.burnTimer = Math.max(e.burnTimer, 1.2);
      e.burnDps = Math.max(e.burnDps, this.dmg * 0.6);
      e.burnSource = this.def.id;
    }
  };
  constructor(readonly def: WeaponDef, ctx: GameContext, private evolved = false) {
    const geom = new THREE.BoxGeometry(1, 0.16, 0.5).translate(0.5, 0, 0);
    this.pool = new MeshPool(ctx.scene, geom, glowMaterial(evolved ? 0xffb0e0 : 0x9ad8ff, 2.2, 0.75));
  }
  update(dt: number, ctx: GameContext): void {
    this.ctxRef = ctx;
    const s = ctx.run.stats;
    const p = ctx.player;
    const n = (this.evolved ? 4 : this.lv([1, 1, 1, 2, 2, 2, 3, 3])) + s.amount;
    this.len = (this.evolved ? 11 : this.lv([5, 5.5, 6, 6.5, 7, 7.5, 8, 9])) * Math.sqrt(s.area);
    this.width = (this.evolved ? 0.75 : 0.45) * Math.sqrt(s.area);
    this.dmg = (this.evolved ? 32 : this.lv([8, 9, 11, 12, 14, 16, 18, 22])) * s.might;
    const speed = (this.evolved ? 2.6 : 1.7 + this.level * 0.08) / Math.max(0.4, s.cooldown);
    this.angle += speed * dt;
    this.bx = p.x;
    this.bz = p.z;
    this.pool.begin();
    for (let i = 0; i < n; i++) {
      // evolved: alternate beams sweep in opposite directions (eclipse scissor)
      const dir = this.evolved && i % 2 === 1 ? -1 : 1;
      const a = this.angle * dir + (i / n) * Math.PI * 2;
      this.cx = Math.cos(a);
      this.cz = Math.sin(a);
      ctx.enemies.forEachInRadius(p.x, p.z, this.len, this.onEnemy);
      const m = this.pool.next();
      m.position.set(p.x, 1.0, p.z);
      m.rotation.set(0, -a, 0);
      m.scale.set(this.len, 1, this.width * 2);
      if (Math.random() < 0.5) {
        const k = Math.random() * this.len;
        ctx.fx.spark(p.x + this.cx * k, 1.0, p.z + this.cz * k, 0, 0.6, 0, this.evolved ? 0xffb0e0 : 0x9ad8ff, 0.3, 0.3);
      }
    }
    this.pool.end();
  }
  private lv<T>(t: readonly T[]): T {
    return t[Math.min(t.length, this.level) - 1];
  }
  dispose(): void {
    this.pool.dispose();
  }
}

// ---------------------------------------------------------------- defs
type Def = Omit<WeaponDef, 'create'>;
function def(d: Def, create: (self: WeaponDef, ctx: GameContext) => WeaponInstance): WeaponDef {
  const w = d as WeaponDef;
  w.create = (ctx) => create(w, ctx);
  return w;
}

export const NEW_WEAPONS: WeaponDef[] = [
  def({
    id: 'lantern_hook', name: 'Lantern Hook', icon: 'hook', color: 0xffcf6a, maxLevel: 8,
    description: 'A hooked lamp-chain that flies out and swings back, cutting both ways.',
    levelText: ['+damage', '+1 hook', '+range, +damage', 'Faster', '+1 hook, +damage', '+range, faster', '+1 hook, +damage'],
    evolvesWith: 'lodestone', evolvesInto: 'moonhook_reaper',
  }, (self, ctx) => new LanternHook(self, ctx)),
  def({
    id: 'moth_lantern', name: 'Moth Lantern', icon: 'moth', color: 0xfff0c0, maxLevel: 8, unlock: 'w_moth',
    description: 'Releases glowing moths that hunt shadows on their own.',
    levelText: ['+damage', '+1 moth', '+damage, keener', '+1 moth', 'Moths pierce once', '+1 moth, +damage', '+1 moth, +damage'],
    evolvesWith: 'tome', evolvesInto: 'lunar_monarchs',
  }, (self) => new MothLantern(self)),
  def({
    id: 'vesper_bell', name: 'Vesper Bell', icon: 'bell', color: 0xffd27a, maxLevel: 8, unlock: 'w_bell',
    description: 'A phantom bell tolls down on the thickest pack, stunning all beneath it.',
    levelText: ['+damage', '+radius', '+1 bell', '+damage, +radius', '+radius, faster', '+1 bell', 'Great Toll: +damage, +radius'],
    evolvesWith: 'clover', evolvesInto: 'cathedral_toll',
  }, (self) => new VesperBell(self)),
  def({
    id: 'gloam_beam', name: 'Lighthouse Beam', icon: 'beam', color: 0x9ad8ff, maxLevel: 8, unlock: 'w_beam',
    description: 'A beam of lantern-light sweeps around you like a lighthouse.',
    levelText: ['+length', '+damage', '+1 beam', '+length, +damage', '+damage', '+1 beam', '+length, +damage'],
    evolvesWith: 'twin', evolvesInto: 'eclipse_beam',
  }, (self, ctx) => new GloamBeam(self, ctx)),
];

/** Evolved forms of the new weapons (hidden from the random pool; granted by reliquaries). */
export const NEW_EVOLUTIONS: WeaponDef[] = [
  def({
    id: 'moonhook_reaper', name: 'Moonhook Reaper', icon: 'hook', color: 0xc8b0ff, maxLevel: 1, hidden: true, levelText: [],
    description: 'EVOLVED · Six moon-hooks scythe outward and reel the night — and every ember — back to you.',
  }, (self, ctx) => new LanternHook(self, ctx, true)),
  def({
    id: 'lunar_monarchs', name: 'Lunar Monarchs', icon: 'moth', color: 0xa0c8ff, maxLevel: 1, hidden: true, levelText: [],
    description: 'EVOLVED · Great moon-moths that burst into hunting swarms on every hit.',
  }, (self) => new MothLantern(self, true)),
  def({
    id: 'cathedral_toll', name: 'Cathedral Toll', icon: 'bell', color: 0xfff0a0, maxLevel: 1, hidden: true, levelText: [],
    description: 'EVOLVED · Three great bells; every toll is a critical hit and rings out twice more.',
  }, (self) => new VesperBell(self, true)),
  def({
    id: 'eclipse_beam', name: 'Eclipse Lighthouse', icon: 'beam', color: 0xffb0e0, maxLevel: 1, hidden: true, levelText: [],
    description: 'EVOLVED · Four scissoring beams of eclipse-light that set the dark ablaze.',
  }, (self, ctx) => new GloamBeam(self, ctx, true)),
];
