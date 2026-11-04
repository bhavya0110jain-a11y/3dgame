import * as THREE from 'three';
import type { GameContext, WeaponDef, WeaponInstance } from '../game/types';
import type { Enemy } from '../entities/Enemies';
import { NEW_WEAPONS, NEW_EVOLUTIONS } from './weaponsNew';
import { EVOLUTIONS } from './evolutions';

/** Helper base: cooldown-driven weapon. */
abstract class CooldownWeapon implements WeaponInstance {
  level = 1;
  protected cd = 0;
  constructor(readonly def: WeaponDef) {}
  abstract baseCooldown(): number;
  abstract fire(ctx: GameContext): void;
  update(dt: number, ctx: GameContext): void {
    this.cd -= dt;
    if (this.cd <= 0) {
      this.cd = this.baseCooldown() * ctx.run.stats.cooldown;
      this.fire(ctx);
    }
  }
  dispose(_ctx: GameContext): void {}
}

// ---------------------------------------------------------------- Ember Bolt
class EmberBolt extends CooldownWeapon {
  baseCooldown() {
    return [0.9, 0.85, 0.8, 0.75, 0.7, 0.65, 0.6, 0.55][this.level - 1];
  }
  fire(ctx: GameContext): void {
    const s = ctx.run.stats;
    const count = [1, 1, 2, 2, 3, 3, 4, 5][this.level - 1] + s.amount;
    const dmg = [10, 13, 13, 16, 16, 20, 22, 26][this.level - 1] * s.might;
    const pierce = this.level >= 4 ? 1 : 0;
    const p = ctx.player;
    const target = ctx.enemies.nearest(p.x, p.z, 18);
    let baseA = target ? Math.atan2(target.z - p.z, target.x - p.x) : Math.atan2(p.aimZ, p.aimX);
    for (let i = 0; i < count; i++) {
      const spread = count > 1 ? (i - (count - 1) / 2) * 0.18 : 0;
      const a = baseA + spread;
      const speed = 16 * s.projectileSpeed;
      ctx.projectiles.spawn({
        x: p.x + Math.cos(a) * 0.5,
        z: p.z + Math.sin(a) * 0.5,
        y: 1.4,
        vx: Math.cos(a) * speed,
        vz: Math.sin(a) * speed,
        damage: dmg,
        pierce,
        life: 1.3 * s.duration,
        radius: 0.3 * s.area,
        scale: 1 * Math.sqrt(s.area),
        color: 0xffa040,
        source: 'ember_bolt',
        knockback: 3,
      });
    }
    ctx.fx.muzzle(p.x + Math.cos(baseA) * 0.6, 1.4, p.z + Math.sin(baseA) * 0.6, Math.cos(baseA), Math.sin(baseA), 0xffa040);
    ctx.events.emit('weapon:fired', { weaponId: 'ember_bolt' });
  }
}

// ---------------------------------------------------------------- Halo of Cinders (orbit)
class CinderHalo implements WeaponInstance {
  level = 1;
  private angle = 0;
  /** Ribbon-trail ids (visuals live in FxManager: fire-orb glows + flame licks + ribbon trails). */
  private trails: number[] = [];
  constructor(readonly def: WeaponDef, _ctx: GameContext) {}
  private count(ctx: GameContext) {
    return [2, 3, 3, 4, 4, 5, 6, 7][this.level - 1] + ctx.run.stats.amount;
  }
  update(dt: number, ctx: GameContext): void {
    const s = ctx.run.stats;
    const n = this.count(ctx);
    if (this.trails.length !== n) {
      while (this.trails.length < n) this.trails.push(ctx.fx.ribbons.alloc(0xff6a2a, 0.5 * Math.sqrt(ctx.run.stats.area), 1.4)); // s3: 2.2 → 1.4
      while (this.trails.length > n) ctx.fx.ribbons.release(this.trails.pop()!);
      for (const t of this.trails) ctx.fx.ribbons.reset(t);
    }
    const radius = (2.2 + this.level * 0.12) * s.area;
    const speed = (2.6 + this.level * 0.2) / Math.max(0.4, s.cooldown);
    const dmg = [7, 8, 10, 11, 13, 15, 17, 20][this.level - 1] * s.might;
    this.angle += speed * dt;
    const p = ctx.player;
    for (let i = 0; i < n; i++) {
      const a = this.angle + (i / n) * Math.PI * 2;
      const x = p.x + Math.cos(a) * radius;
      const z = p.z + Math.sin(a) * radius;
      const y = 1.0 + Math.sin(a * 2) * 0.15;
      ctx.fx.fireOrb(x, y, z, Math.sqrt(s.area), dt);
      ctx.fx.ribbons.push(this.trails[i], x, y, z);
      ctx.enemies.forEachInRadius(x, z, 0.45 * s.area, (e) => {
        if (e.hitCd.has('halo')) return;
        e.hitCd.set('halo', 0.5);
        ctx.enemies.damage(e, dmg, ctx, { knockback: 5, fromX: p.x, fromZ: p.z, source: 'cinder_halo' });
      });
    }
  }
  dispose(ctx: GameContext): void {
    for (const t of this.trails) ctx.fx.ribbons.release(t);
    this.trails.length = 0;
  }
}

// ---------------------------------------------------------------- Flare Nova (radial pulse)
class FlareNova extends CooldownWeapon {
  baseCooldown() {
    return [3.2, 3.0, 2.8, 2.6, 2.4, 2.2, 2.0, 1.8][this.level - 1];
  }
  fire(ctx: GameContext): void {
    const s = ctx.run.stats;
    const r = [3.2, 3.5, 3.8, 4.1, 4.4, 4.8, 5.2, 5.8][this.level - 1] * s.area;
    const dmg = [14, 18, 22, 26, 30, 36, 42, 50][this.level - 1] * s.might;
    const p = ctx.player;
    ctx.fx.shockwave(p.x, p.z, r, 0xffd27a);
    ctx.enemies.forEachInRadius(p.x, p.z, r, (e) => {
      ctx.enemies.damage(e, dmg, ctx, { knockback: 9, fromX: p.x, fromZ: p.z, source: 'flare_nova' });
    });
    ctx.events.emit('weapon:fired', { weaponId: 'flare_nova' });
  }
}

// ---------------------------------------------------------------- Spark Chain (lightning)
class SparkChain extends CooldownWeapon {
  baseCooldown() {
    return [2.0, 1.85, 1.7, 1.6, 1.45, 1.3, 1.2, 1.0][this.level - 1];
  }
  fire(ctx: GameContext): void {
    const s = ctx.run.stats;
    const jumps = [3, 4, 4, 5, 6, 6, 7, 9][this.level - 1] + s.amount;
    const dmg = [12, 14, 17, 19, 22, 26, 30, 36][this.level - 1] * s.might;
    const strikes = this.level >= 5 ? 2 : 1;
    for (let k = 0; k < strikes; k++) {
      const p = ctx.player;
      let cur = ctx.enemies.randomInRange(p.x, p.z, 12, () => ctx.rng.next());
      if (!cur) return;
      const hit = new Set<number>();
      let lx = p.x, ly = 1.8, lz = p.z;
      ctx.fx.flash(p.x, 1.8, p.z, 0x9ad8ff, 1.6, 3);
      for (let i = 0; i < jumps && cur; i++) {
        hit.add(cur.id);
        ctx.fx.lightning(lx, ly, lz, cur.x, 0.9, cur.z, 0x9ad8ff);
        lx = cur.x; ly = 0.9; lz = cur.z;
        const c: Enemy = cur;
        ctx.enemies.damage(c, dmg, ctx, { knockback: 1, fromX: p.x, fromZ: p.z, source: 'spark_chain', color: 'ft-blue' });
        cur = ctx.enemies.nearest(c.x, c.z, 5 * s.area, hit);
      }
    }
    ctx.events.emit('weapon:fired', { weaponId: 'spark_chain' });
  }
}

// ---------------------------------------------------------------- Wick Lance (piercing line in move dir)
class WickLance extends CooldownWeapon {
  baseCooldown() {
    return [1.6, 1.5, 1.4, 1.3, 1.2, 1.1, 1.0, 0.9][this.level - 1];
  }
  fire(ctx: GameContext): void {
    const s = ctx.run.stats;
    const count = [1, 1, 2, 2, 2, 3, 3, 4][this.level - 1] + s.amount;
    const dmg = [18, 22, 24, 28, 34, 38, 44, 52][this.level - 1] * s.might;
    const p = ctx.player;
    const a0 = Math.atan2(p.aimZ, p.aimX);
    for (let i = 0; i < count; i++) {
      const back = i % 2 === 1;
      const a = a0 + (back ? Math.PI : 0) + (Math.floor(i / 2) * 0.12);
      const speed = 22 * s.projectileSpeed;
      ctx.projectiles.spawn({
        x: p.x, z: p.z, y: 1.1,
        vx: Math.cos(a) * speed, vz: Math.sin(a) * speed,
        damage: dmg, pierce: -1, life: 0.6 * s.duration,
        radius: 0.45 * s.area, scale: 1.3 * Math.sqrt(s.area),
        color: 0xfff0b0, source: 'wick_lance', knockback: 6, trail: 1,
      });
    }
    ctx.fx.muzzle(p.x + Math.cos(a0) * 0.6, 1.1, p.z + Math.sin(a0) * 0.6, Math.cos(a0), Math.sin(a0), 0xfff0b0, 1.4);
    ctx.events.emit('weapon:fired', { weaponId: 'wick_lance' });
  }
}

// ---------------------------------------------------------------- Brazier (ground fire zones)
class Brazier extends CooldownWeapon {
  /** Gameplay zones; the animated fire-pool visuals live in FxManager (fx.firePool). */
  private zones: { x: number; z: number; r: number; life: number; dps: number }[] = [];
  baseCooldown() {
    return [3.5, 3.3, 3.1, 2.9, 2.7, 2.5, 2.3, 2.0][this.level - 1];
  }
  fire(ctx: GameContext): void {
    const s = ctx.run.stats;
    const count = [1, 1, 2, 2, 3, 3, 4, 4][this.level - 1] + s.amount;
    const r = [1.6, 1.8, 1.8, 2.0, 2.0, 2.3, 2.3, 2.7][this.level - 1] * s.area;
    const dps = [10, 13, 14, 17, 18, 22, 24, 30][this.level - 1] * s.might;
    for (let i = 0; i < count; i++) {
      const t = ctx.enemies.randomInRange(ctx.player.x, ctx.player.z, 10, () => ctx.rng.next());
      const x = t ? t.x : ctx.player.x + ctx.rng.range(-5, 5);
      const z = t ? t.z : ctx.player.z + ctx.rng.range(-5, 5);
      this.zones.push({ x, z, r, life: 3 * s.duration, dps });
      ctx.fx.firePool(x, z, r, 3 * s.duration);
    }
  }
  update(dt: number, ctx: GameContext): void {
    super.update(dt, ctx);
    for (let i = this.zones.length - 1; i >= 0; i--) {
      const zn = this.zones[i];
      zn.life -= dt;
      ctx.enemies.forEachInRadius(zn.x, zn.z, zn.r, (e) => {
        e.burnTimer = Math.max(e.burnTimer, 0.6);
        e.burnDps = Math.max(e.burnDps, zn.dps);
        e.burnSource = 'brazier';
      });
      if (zn.life <= 0) this.zones.splice(i, 1);
    }
  }
  dispose(_ctx: GameContext): void {
    this.zones.length = 0;
  }
}

// ---------------------------------------------------------------- Frost Lantern (slowing shards)
class FrostShards extends CooldownWeapon {
  baseCooldown() {
    return [2.2, 2.0, 1.9, 1.8, 1.6, 1.5, 1.4, 1.2][this.level - 1];
  }
  fire(ctx: GameContext): void {
    const s = ctx.run.stats;
    const count = [5, 6, 7, 8, 9, 10, 12, 14][this.level - 1] + s.amount * 2;
    const dmg = [6, 7, 8, 9, 11, 12, 14, 16][this.level - 1] * s.might;
    const p = ctx.player;
    const off = ctx.rng.next() * Math.PI;
    ctx.fx.ring(p.x, p.z, 0x9ae8ff, 0.3, 2.2, 0.3);
    ctx.fx.frostPuff(p.x, 0.9, p.z, 6, 0.7);
    for (let i = 0; i < count; i++) {
      const a = off + (i / count) * Math.PI * 2;
      const speed = 11 * s.projectileSpeed;
      ctx.projectiles.spawn({
        x: p.x, z: p.z, y: 0.9,
        vx: Math.cos(a) * speed, vz: Math.sin(a) * speed,
        damage: dmg, pierce: 1, life: 0.7 * s.duration,
        radius: 0.3 * s.area, scale: 0.9 * Math.sqrt(s.area),
        color: 0x7ad8ff, source: 'frost_shards', knockback: 1, trail: 0.4,
        onHit: (_p, e) => {
          e.slowTimer = Math.max(e.slowTimer, 1.5 * s.duration);
        },
      });
    }
    ctx.events.emit('weapon:fired', { weaponId: 'frost_shards' });
  }
}

export const WEAPONS: WeaponDef[] = [
  {
    id: 'ember_bolt', evolvesWith: 'flint', evolvesInto: 'sunspear_volley', name: 'Ember Bolt', icon: 'bolt', color: 0xffa040, maxLevel: 8,
    description: 'Hurls a burning ember at the nearest shadow.',
    levelText: ['+3 damage', '+1 bolt', '+3 damage, pierce 1', '+1 bolt', '+4 damage', '+1 bolt, +2 damage', '+1 bolt, +4 damage'],
    create: (ctx) => new EmberBolt(WEAPONS[0]),
  },
  {
    id: 'cinder_halo', evolvesWith: 'bellows', evolvesInto: 'solar_crown', name: 'Cinder Halo', icon: 'halo', color: 0xff6a2a, maxLevel: 8,
    description: 'Burning cinders orbit you, scorching anything they touch.',
    levelText: ['+1 cinder', 'Wider orbit, +damage', '+1 cinder', '+damage', '+1 cinder', '+1 cinder', '+1 cinder, +damage'],
    create: (ctx) => new CinderHalo(WEAPONS[1], ctx),
  },
  {
    id: 'flare_nova', evolvesWith: 'wick', evolvesInto: 'dawnbreak', name: 'Flare Nova', icon: 'nova', color: 0xffd27a, maxLevel: 8,
    description: 'Periodically erupts in a ring of light, hurling shadows back.',
    levelText: ['+radius, +damage', '+radius, +damage', 'Faster pulses', '+damage', '+radius', 'Faster pulses', 'Massive flare'],
    create: () => new FlareNova(WEAPONS[2]),
  },
  {
    id: 'spark_chain', evolvesWith: 'clockwork', evolvesInto: 'tempest_choir', name: 'Spark Chain', icon: 'spark', color: 0x9ad8ff, maxLevel: 8,
    description: 'Lightning leaps between nearby shadows.',
    levelText: ['+1 jump', '+damage', '+1 jump', 'Double strike', '+damage', '+1 jump', '+2 jumps, +damage'],
    create: () => new SparkChain(WEAPONS[3]),
  },
  {
    id: 'wick_lance', evolvesWith: 'quill', evolvesInto: 'beacon_ray', name: 'Wick Lance', icon: 'lance', color: 0xfff0b0, maxLevel: 8,
    description: 'A piercing beam of light fired in the direction you move.',
    levelText: ['+damage', 'Also fires behind you', '+damage', 'Faster', '+1 lance', '+damage', '+1 lance, +damage'],
    create: () => new WickLance(WEAPONS[4]),
  },
  {
    id: 'brazier', evolvesWith: 'oil', evolvesInto: 'pyre_garden', name: 'Brazier', icon: 'fire', color: 0xff5a1a, maxLevel: 8,
    description: 'Ignites the ground beneath shadows. Burning persists.',
    levelText: ['+burn', '+1 fire', '+radius', '+1 fire', '+radius, +burn', '+1 fire', 'Inferno'],
    create: () => new Brazier(WEAPONS[5]),
  },
  {
    id: 'frost_shards', evolvesWith: 'tallow', evolvesInto: 'glacier_heart', name: 'Rime Shards', icon: 'frost', color: 0x7ad8ff, maxLevel: 8,
    description: 'A ring of frozen shards that slows what they pierce.',
    levelText: ['+1 shard', '+1 shard', '+damage', '+1 shard', '+1 shard', '+2 shards', '+2 shards, +damage'],
    create: () => new FrostShards(WEAPONS[6]),
  },
];

// New base weapons + all evolutions (gameplay agent; classes live in weaponsNew.ts / evolutions.ts).
WEAPONS.push(...NEW_WEAPONS, ...EVOLUTIONS, ...NEW_EVOLUTIONS);

export function getWeapon(id: string): WeaponDef | undefined {
  return WEAPONS.find((w) => w.id === id);
}
