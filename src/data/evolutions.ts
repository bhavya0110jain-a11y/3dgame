import * as THREE from 'three';
import type { GameContext, WeaponDef, WeaponInstance } from '../game/types';
import type { Enemy } from '../entities/Enemies';
import type { Projectile } from '../entities/Projectiles';
import { TimedWeapon, MeshPool, glowMaterial } from './weaponKit';

/*
 * Evolved forms of the seven launch weapons. Granted by a reliquary when the base weapon is max level and the paired
 * relic is owned (see Upgrades.evolutionCandidates). Each is a clear power spike AND a new behaviour, not just numbers.
 *   ember_bolt   + flint     → sunspear_volley   piercing spears that burst on impact
 *   cinder_halo  + bellows   → solar_crown       two counter-rotating rings that ignite
 *   flare_nova   + wick      → dawnbreak         huge double pulse that feeds your light
 *   spark_chain  + clockwork → tempest_choir     triple storm, long chains, stuns
 *   wick_lance   + quill     → beacon_ray        four-way infinite-pierce rays
 *   brazier      + oil       → pyre_garden       wide fire gardens that warm (heal) you
 *   frost_shards + tallow    → glacier_heart     shards that shatter frozen foes
 */

// ---------------------------------------------------------------- Sunspear Volley
class SunspearVolley extends TimedWeapon {
  private readonly burstAt = (p: Projectile, e: Enemy, ctx: GameContext) => {
    if (e.hitCd.has('sunspear')) return;
    e.hitCd.set('sunspear', 0.25);
    const r = 1.4 * Math.sqrt(ctx.run.stats.area);
    const x = e.x;
    const z = e.z;
    ctx.fx.ring(x, z, 0xfff0a0, 0.2, r, 0.22);
    ctx.fx.burst(x, 1, z, 0xffd27a, 8, 5, 0.3, 0.3);
    ctx.enemies.forEachInRadius(x, z, r, (o) => {
      if (o !== e) ctx.enemies.damage(o, p.damage * 0.4, ctx, { knockback: 3, fromX: x, fromZ: z, source: this.def.id, canCrit: false });
    });
  };
  baseCooldown() {
    return 0.6;
  }
  fire(ctx: GameContext): void {
    const s = ctx.run.stats;
    const count = 6 + s.amount;
    const dmg = 34 * s.might;
    const p = ctx.player;
    const t = ctx.enemies.nearest(p.x, p.z, 20);
    const base = t ? Math.atan2(t.z - p.z, t.x - p.x) : Math.atan2(p.aimZ, p.aimX);
    for (let i = 0; i < count; i++) {
      const a = base + (i - (count - 1) / 2) * 0.14;
      const sp = 21 * s.projectileSpeed;
      ctx.projectiles.spawn({
        x: p.x + Math.cos(a) * 0.5, z: p.z + Math.sin(a) * 0.5, y: 1.4,
        vx: Math.cos(a) * sp, vz: Math.sin(a) * sp, damage: dmg, pierce: 3, life: 1.2 * s.duration,
        radius: 0.4 * s.area, scale: 1.5 * Math.sqrt(s.area), color: 0xffe08a, source: this.def.id, knockback: 4,
        trail: 1, onHit: this.burstAt,
      });
    }
    ctx.events.emit('weapon:fired', { weaponId: 'ember_bolt' });
  }
}

// ---------------------------------------------------------------- Solar Crown
class SolarCrown implements WeaponInstance {
  level = 1;
  private angle = 0;
  private pool: MeshPool;
  private ctxRef!: GameContext;
  private ox = 0;
  private oz = 0;
  private dmg = 0;
  private readonly onTouch = (e: Enemy) => {
    if (e.hitCd.has('crown')) return;
    e.hitCd.set('crown', 0.4);
    const ctx = this.ctxRef;
    ctx.enemies.damage(e, this.dmg, ctx, { knockback: 6, fromX: ctx.player.x, fromZ: ctx.player.z, source: this.def.id });
    e.burnTimer = Math.max(e.burnTimer, 2);
    e.burnDps = Math.max(e.burnDps, this.dmg * 0.5);
    e.burnSource = this.def.id;
  };
  constructor(readonly def: WeaponDef, ctx: GameContext) {
    this.pool = new MeshPool(ctx.scene, new THREE.IcosahedronGeometry(0.36, 2), glowMaterial(0xffc04a, 3.2));
  }
  update(dt: number, ctx: GameContext): void {
    this.ctxRef = ctx;
    const s = ctx.run.stats;
    const p = ctx.player;
    this.dmg = 28 * s.might;
    this.angle += (3.2 / Math.max(0.4, s.cooldown)) * dt;
    const rings: [number, number, number][] = RINGS;
    const hitR = 0.6 * s.area;
    this.pool.begin();
    for (let r = 0; r < rings.length; r++) {
      const [n0, radius0, dir] = rings[r];
      const n = n0 + s.amount;
      const radius = radius0 * s.area;
      for (let i = 0; i < n; i++) {
        const a = this.angle * dir + (i / n) * Math.PI * 2;
        this.ox = p.x + Math.cos(a) * radius;
        this.oz = p.z + Math.sin(a) * radius;
        const m = this.pool.next();
        m.position.set(this.ox, 1.0 + Math.sin(a * 3) * 0.12, this.oz);
        m.scale.setScalar(Math.sqrt(s.area));
        if (Math.random() < 0.25) ctx.fx.spark(this.ox, 1, this.oz, 0, 0.8, 0, 0xffa030, 0.35, 0.35);
        ctx.enemies.forEachInRadius(this.ox, this.oz, hitR, this.onTouch);
      }
    }
    this.pool.end();
  }
  dispose(): void {
    this.pool.dispose();
  }
}
const RINGS: [number, number, number][] = [
  [5, 2.2, 1],
  [7, 3.8, -0.8],
];

// ---------------------------------------------------------------- Dawnbreak
class Dawnbreak extends TimedWeapon {
  private echo = -1;
  private healed = 0;
  private dmg = 0;
  private ctxRef!: GameContext;
  private readonly onHit = (e: Enemy) => {
    const ctx = this.ctxRef;
    const p = ctx.player;
    ctx.enemies.damage(e, this.dmg, ctx, { knockback: 12, fromX: p.x, fromZ: p.z, source: this.def.id });
    if (this.healed < 6) {
      this.healed++;
      p.heal(0.5, ctx);
    }
  };
  baseCooldown() {
    return 1.6;
  }
  private pulse(ctx: GameContext, mul: number): void {
    const s = ctx.run.stats;
    const r = 7 * s.area * (mul < 1 ? 1.25 : 1);
    const p = ctx.player;
    this.dmg = 70 * s.might * mul;
    this.healed = 0;
    this.ctxRef = ctx;
    ctx.fx.ring(p.x, p.z, 0xfff4c0, 0.5, r, 0.45);
    ctx.fx.ring(p.x, p.z, 0xffb04a, 0.3, r * 0.7, 0.35);
    ctx.fx.burst(p.x, 0.6, p.z, 0xfff0a0, 34, r * 2, 0.4, 0.35, 0);
    ctx.enemies.forEachInRadius(p.x, p.z, r, this.onHit);
    ctx.events.emit('weapon:fired', { weaponId: 'flare_nova' });
  }
  fire(ctx: GameContext): void {
    this.pulse(ctx, 1);
    this.echo = 0.35;
  }
  update(dt: number, ctx: GameContext): void {
    super.update(dt, ctx);
    if (this.echo > 0) {
      this.echo -= dt;
      if (this.echo <= 0) this.pulse(ctx, 0.6);
    }
  }
}

// ---------------------------------------------------------------- Tempest Choir
class TempestChoir extends TimedWeapon {
  private lines: { line: THREE.Line; life: number; pts: Float32Array }[] = [];
  private hit = new Set<number>();
  private mat = new THREE.LineBasicMaterial({ color: new THREE.Color(0xc0e8ff).multiplyScalar(3.5), transparent: true });
  baseCooldown() {
    return 0.85;
  }
  fire(ctx: GameContext): void {
    const s = ctx.run.stats;
    const jumps = 12 + s.amount;
    const dmg = 40 * s.might;
    const p = ctx.player;
    for (let k = 0; k < 3; k++) {
      let cur = ctx.enemies.randomInRange(p.x, p.z, 14, () => ctx.rng.next());
      if (!cur) break;
      this.hit.clear();
      const L = this.getLine(ctx);
      let n = 0;
      let lx = p.x;
      let lz = p.z;
      L.pts[n++] = lx; L.pts[n++] = 2; L.pts[n++] = lz;
      for (let i = 0; i < jumps && cur; i++) {
        this.hit.add(cur.id);
        const c: Enemy = cur;
        if (n <= L.pts.length - 6) {
          // jagged midpoint, then the strike point
          L.pts[n++] = (lx + c.x) / 2 + (Math.random() - 0.5) * 0.8;
          L.pts[n++] = 1.4 + Math.random() * 0.5;
          L.pts[n++] = (lz + c.z) / 2 + (Math.random() - 0.5) * 0.8;
          L.pts[n++] = c.x; L.pts[n++] = 0.9; L.pts[n++] = c.z;
          lx = c.x;
          lz = c.z;
        }
        ctx.enemies.damage(c, dmg, ctx, { knockback: 1, fromX: p.x, fromZ: p.z, source: this.def.id, color: 'ft-blue' });
        c.slowTimer = Math.max(c.slowTimer, 0.8);
        ctx.fx.burst(c.x, 0.9, c.z, 0xc0e8ff, 6, 5, 0.25, 0.3);
        cur = ctx.enemies.nearest(c.x, c.z, 6 * s.area, this.hit);
      }
      const g = L.line.geometry as THREE.BufferGeometry;
      (g.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      g.setDrawRange(0, n / 3);
      L.life = 0.2;
      L.line.visible = true;
    }
    ctx.events.emit('weapon:fired', { weaponId: 'spark_chain' });
  }
  private getLine(ctx: GameContext) {
    let L = this.lines.find((l) => l.life <= 0);
    if (!L) {
      const pts = new Float32Array(3 * 2 * 40);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pts, 3).setUsage(THREE.DynamicDrawUsage));
      const line = new THREE.Line(g, this.mat);
      line.frustumCulled = false;
      ctx.scene.add(line);
      L = { line, life: 0, pts };
      this.lines.push(L);
    }
    return L;
  }
  update(dt: number, ctx: GameContext): void {
    super.update(dt, ctx);
    for (const l of this.lines) {
      if (l.life <= 0) continue;
      l.life -= dt;
      if (l.life <= 0) l.line.visible = false;
    }
  }
  dispose(ctx: GameContext): void {
    for (const l of this.lines) {
      ctx.scene.remove(l.line);
      l.line.geometry.dispose();
    }
    this.lines.length = 0;
  }
}

// ---------------------------------------------------------------- Beacon Ray
class BeaconRay extends TimedWeapon {
  baseCooldown() {
    return 0.75;
  }
  fire(ctx: GameContext): void {
    const s = ctx.run.stats;
    const p = ctx.player;
    const a0 = Math.atan2(p.aimZ, p.aimX);
    const n = 4 + s.amount;
    for (let i = 0; i < n; i++) {
      const a = a0 + (i / n) * Math.PI * 2;
      const sp = 26 * s.projectileSpeed;
      ctx.projectiles.spawn({
        x: p.x, z: p.z, y: 1.1, vx: Math.cos(a) * sp, vz: Math.sin(a) * sp,
        damage: 62 * s.might, pierce: -1, life: 0.7 * s.duration, radius: 0.7 * s.area, scale: 2.1 * Math.sqrt(s.area),
        color: 0xffffff, source: this.def.id, knockback: 8, trail: 1,
      });
    }
    ctx.events.emit('weapon:fired', { weaponId: 'wick_lance' });
  }
}

// ---------------------------------------------------------------- Pyre Garden
class PyreGarden extends TimedWeapon {
  private zones: { x: number; z: number; r: number; life: number; dps: number }[] = [];
  private pool: MeshPool;
  private warmTick = 0;
  private cur!: { dps: number };
  private readonly onBurn = (e: Enemy) => {
    e.burnTimer = Math.max(e.burnTimer, 0.8);
    e.burnDps = Math.max(e.burnDps, this.cur.dps);
    e.burnSource = this.def.id;
  };
  constructor(def: WeaponDef, ctx: GameContext) {
    super(def);
    this.pool = new MeshPool(ctx.scene, new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2), glowMaterial(0xff7a2a, 1.8, 0.5));
  }
  baseCooldown() {
    return 1.9;
  }
  fire(ctx: GameContext): void {
    const s = ctx.run.stats;
    const count = 4 + s.amount;
    for (let i = 0; i < count; i++) {
      const t = ctx.enemies.randomInRange(ctx.player.x, ctx.player.z, 11, () => ctx.rng.next());
      const x = i === 0 ? ctx.player.x : t ? t.x : ctx.player.x + ctx.rng.range(-6, 6);
      const z = i === 0 ? ctx.player.z : t ? t.z : ctx.player.z + ctx.rng.range(-6, 6);
      this.zones.push({ x, z, r: 3 * s.area, life: 4.5 * s.duration, dps: 42 * s.might });
      ctx.fx.burst(x, 0.3, z, 0xff8a2a, 18, 6, 0.5, 0.45);
    }
  }
  update(dt: number, ctx: GameContext): void {
    super.update(dt, ctx);
    const p = ctx.player;
    let warm = false;
    this.warmTick -= dt;
    this.pool.begin();
    for (let i = this.zones.length - 1; i >= 0; i--) {
      const zn = this.zones[i];
      zn.life -= dt;
      if (zn.life <= 0) {
        this.zones.splice(i, 1);
        continue;
      }
      this.cur = zn;
      if (Math.random() < 0.7) ctx.fx.spark(zn.x + (Math.random() - 0.5) * zn.r * 1.6, 0.2, zn.z + (Math.random() - 0.5) * zn.r * 1.6, 0, 2.5 + Math.random() * 2, 0, 0xffa040, 0.55, 0.4);
      ctx.enemies.forEachInRadius(zn.x, zn.z, zn.r, this.onBurn);
      if ((p.x - zn.x) ** 2 + (p.z - zn.z) ** 2 < zn.r * zn.r) warm = true;
      const m = this.pool.next();
      m.position.set(zn.x, 0.07, zn.z);
      m.scale.setScalar(zn.r * (0.95 + Math.sin(zn.life * 9) * 0.05) * Math.min(1, zn.life * 3));
    }
    this.pool.end();
    // standing in your own garden warms the lantern
    if (warm && this.warmTick <= 0) {
      this.warmTick = 0.5;
      p.heal(0.6, ctx);
    }
  }
  dispose(): void {
    this.pool.dispose();
    this.zones.length = 0;
  }
}

// ---------------------------------------------------------------- Glacier Heart
class GlacierHeart extends TimedWeapon {
  private readonly shatter = (_p: Projectile, e: Enemy, ctx: GameContext) => {
    const s = ctx.run.stats;
    if (e.slowTimer > 0.2 && !e.hitCd.has('shatter')) {
      e.hitCd.set('shatter', 0.6);
      const x = e.x;
      const z = e.z;
      const r = 1.6 * Math.sqrt(s.area);
      ctx.fx.burst(x, 0.8, z, 0xd0f4ff, 14, 6, 0.4, 0.35);
      ctx.fx.ring(x, z, 0xa0e8ff, 0.2, r, 0.25);
      ctx.enemies.forEachInRadius(x, z, r, (o) => ctx.enemies.damage(o, 30 * s.might, ctx, { knockback: 4, fromX: x, fromZ: z, source: this.def.id, color: 'ft-blue', canCrit: false }));
    }
    e.slowTimer = Math.max(e.slowTimer, 2.5 * s.duration);
  };
  baseCooldown() {
    return 1.0;
  }
  fire(ctx: GameContext): void {
    const s = ctx.run.stats;
    const count = 20 + s.amount * 2;
    const p = ctx.player;
    const off = ctx.rng.next() * Math.PI;
    for (let i = 0; i < count; i++) {
      const a = off + (i / count) * Math.PI * 2;
      const sp = 13 * s.projectileSpeed;
      ctx.projectiles.spawn({
        x: p.x, z: p.z, y: 0.9, vx: Math.cos(a) * sp, vz: Math.sin(a) * sp,
        damage: 20 * s.might, pierce: 3, life: 0.85 * s.duration, radius: 0.38 * s.area, scale: 1.2 * Math.sqrt(s.area),
        color: 0xb8f0ff, source: this.def.id, knockback: 1.5, trail: 0.6, onHit: this.shatter,
      });
    }
    ctx.events.emit('weapon:fired', { weaponId: 'frost_shards' });
  }
}

// ---------------------------------------------------------------- defs
type Def = Omit<WeaponDef, 'create' | 'maxLevel' | 'hidden' | 'levelText'>;
function evo(d: Def, create: (self: WeaponDef, ctx: GameContext) => WeaponInstance): WeaponDef {
  const w = { ...d, maxLevel: 1, hidden: true, levelText: [] } as unknown as WeaponDef;
  w.create = (ctx) => create(w, ctx);
  return w;
}

export const EVOLUTIONS: WeaponDef[] = [
  evo({ id: 'sunspear_volley', name: 'Sunspear Volley', icon: 'bolt', color: 0xffe08a,
    description: 'EVOLVED · A volley of sun-forged spears that pierce and burst on impact.' }, (w) => new SunspearVolley(w)),
  evo({ id: 'solar_crown', name: 'Solar Crown', icon: 'halo', color: 0xffc04a,
    description: 'EVOLVED · Two counter-turning rings of suns that set everything alight.' }, (w, ctx) => new SolarCrown(w, ctx)),
  evo({ id: 'dawnbreak', name: 'Dawnbreak', icon: 'nova', color: 0xfff4c0,
    description: 'EVOLVED · A double sunrise of a pulse. Each shadow it touches feeds your light.' }, (w) => new Dawnbreak(w)),
  evo({ id: 'tempest_choir', name: 'Tempest Choir', icon: 'spark', color: 0xc0e8ff,
    description: 'EVOLVED · Three storms at once; long chains that stun what they strike.' }, (w) => new TempestChoir(w)),
  evo({ id: 'beacon_ray', name: 'Beacon Ray', icon: 'lance', color: 0xffffff,
    description: 'EVOLVED · Four rays of pure light that pierce everything, in every direction.' }, (w) => new BeaconRay(w)),
  evo({ id: 'pyre_garden', name: 'Pyre Garden', icon: 'fire', color: 0xff7a2a,
    description: 'EVOLVED · Wide gardens of fire bloom around you. Standing in them warms your lantern.' }, (w, ctx) => new PyreGarden(w, ctx)),
  evo({ id: 'glacier_heart', name: 'Glacier Heart', icon: 'frost', color: 0xb8f0ff,
    description: 'EVOLVED · A storm of rime that shatters frozen shadows in icy bursts.' }, (w) => new GlacierHeart(w)),
];
