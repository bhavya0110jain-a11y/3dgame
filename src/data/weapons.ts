import * as THREE from 'three';
import type { GameContext, WeaponDef, WeaponInstance } from '../game/types';
import type { Enemy } from '../entities/Enemies';

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
    return [1.1, 1.0, 0.95, 0.85, 0.8, 0.72, 0.65, 0.6][this.level - 1];
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
    ctx.events.emit('weapon:fired', { weaponId: 'ember_bolt' });
  }
}

// ---------------------------------------------------------------- Halo of Cinders (orbit)
class CinderHalo implements WeaponInstance {
  level = 1;
  private angle = 0;
  private group = new THREE.Group();
  private orbs: THREE.Mesh[] = [];
  private mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff6a2a).multiplyScalar(3) });
  private geom = new THREE.IcosahedronGeometry(0.28, 1);
  constructor(readonly def: WeaponDef, ctx: GameContext) {
    ctx.scene.add(this.group);
  }
  private count(ctx: GameContext) {
    return [2, 3, 3, 4, 4, 5, 6, 7][this.level - 1] + ctx.run.stats.amount;
  }
  update(dt: number, ctx: GameContext): void {
    const s = ctx.run.stats;
    const n = this.count(ctx);
    while (this.orbs.length < n) {
      const m = new THREE.Mesh(this.geom, this.mat);
      this.group.add(m);
      this.orbs.push(m);
    }
    while (this.orbs.length > n) this.group.remove(this.orbs.pop()!);
    const radius = (2.2 + this.level * 0.12) * s.area;
    const speed = (2.6 + this.level * 0.2) / Math.max(0.4, s.cooldown);
    const dmg = [7, 8, 10, 11, 13, 15, 17, 20][this.level - 1] * s.might;
    this.angle += speed * dt;
    const p = ctx.player;
    for (let i = 0; i < n; i++) {
      const a = this.angle + (i / n) * Math.PI * 2;
      const x = p.x + Math.cos(a) * radius;
      const z = p.z + Math.sin(a) * radius;
      const m = this.orbs[i];
      m.position.set(x, 1.0 + Math.sin(a * 2) * 0.15, z);
      m.scale.setScalar(Math.sqrt(s.area));
      if (Math.random() < 0.3) ctx.fx.spark(x, 1, z, 0, 0.5, 0, 0xff6a2a, 0.35, 0.3);
      ctx.enemies.forEachInRadius(x, z, 0.45 * s.area, (e) => {
        if (e.hitCd.has('halo')) return;
        e.hitCd.set('halo', 0.5);
        ctx.enemies.damage(e, dmg, ctx, { knockback: 5, fromX: p.x, fromZ: p.z, source: 'cinder_halo' });
      });
    }
  }
  dispose(ctx: GameContext): void {
    ctx.scene.remove(this.group);
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
    ctx.fx.ring(p.x, p.z, 0xffd27a, 0.5, r, 0.35);
    ctx.fx.burst(p.x, 0.5, p.z, 0xffd27a, 20, r * 2, 0.35, 0.3, 0);
    ctx.enemies.forEachInRadius(p.x, p.z, r, (e) => {
      ctx.enemies.damage(e, dmg, ctx, { knockback: 9, fromX: p.x, fromZ: p.z, source: 'flare_nova' });
    });
    ctx.events.emit('weapon:fired', { weaponId: 'flare_nova' });
  }
}

// ---------------------------------------------------------------- Spark Chain (lightning)
class SparkChain extends CooldownWeapon {
  private lines: { line: THREE.Line; life: number }[] = [];
  private mat = new THREE.LineBasicMaterial({ color: new THREE.Color(0x9ad8ff).multiplyScalar(3), transparent: true });
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
      const pts: THREE.Vector3[] = [new THREE.Vector3(p.x, 1.8, p.z)];
      for (let i = 0; i < jumps && cur; i++) {
        hit.add(cur.id);
        pts.push(new THREE.Vector3(cur.x, 0.9, cur.z));
        const c: Enemy = cur;
        ctx.enemies.damage(c, dmg, ctx, { knockback: 1, fromX: p.x, fromZ: p.z, source: 'spark_chain', color: 'ft-blue' });
        ctx.fx.burst(c.x, 0.9, c.z, 0x9ad8ff, 5, 4, 0.25, 0.25);
        cur = ctx.enemies.nearest(c.x, c.z, 5 * s.area, hit);
      }
      this.addLightning(pts, ctx);
    }
    ctx.events.emit('weapon:fired', { weaponId: 'spark_chain' });
  }
  private addLightning(pts: THREE.Vector3[], ctx: GameContext): void {
    const jag: THREE.Vector3[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      for (let j = 0; j < 4; j++) {
        const t = j / 4;
        const v = a.clone().lerp(b, t);
        if (j > 0) v.add(new THREE.Vector3((Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.6));
        jag.push(v);
      }
    }
    jag.push(pts[pts.length - 1]);
    const g = new THREE.BufferGeometry().setFromPoints(jag);
    const line = new THREE.Line(g, this.mat.clone());
    ctx.scene.add(line);
    this.lines.push({ line, life: 0.18 });
  }
  update(dt: number, ctx: GameContext): void {
    super.update(dt, ctx);
    for (let i = this.lines.length - 1; i >= 0; i--) {
      const l = this.lines[i];
      l.life -= dt;
      (l.line.material as THREE.LineBasicMaterial).opacity = Math.max(0, l.life / 0.18);
      if (l.life <= 0) {
        ctx.scene.remove(l.line);
        l.line.geometry.dispose();
        (l.line.material as THREE.Material).dispose();
        this.lines.splice(i, 1);
      }
    }
  }
  dispose(ctx: GameContext): void {
    for (const l of this.lines) ctx.scene.remove(l.line);
    this.lines.length = 0;
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
    ctx.events.emit('weapon:fired', { weaponId: 'wick_lance' });
  }
}

// ---------------------------------------------------------------- Brazier (ground fire zones)
class Brazier extends CooldownWeapon {
  private zones: { x: number; z: number; r: number; life: number; dps: number; mesh: THREE.Mesh }[] = [];
  private mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff5a1a).multiplyScalar(1.6), transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false });
  private geom = new THREE.CircleGeometry(1, 32);
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
      const mesh = new THREE.Mesh(this.geom, this.mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(x, 0.06, z);
      mesh.scale.setScalar(r);
      ctx.scene.add(mesh);
      this.zones.push({ x, z, r, life: 3 * s.duration, dps, mesh });
      ctx.fx.burst(x, 0.3, z, 0xff6a1a, 14, 5, 0.5, 0.4);
    }
  }
  update(dt: number, ctx: GameContext): void {
    super.update(dt, ctx);
    for (let i = this.zones.length - 1; i >= 0; i--) {
      const zn = this.zones[i];
      zn.life -= dt;
      if (Math.random() < 0.6) ctx.fx.spark(zn.x + (Math.random() - 0.5) * zn.r * 1.6, 0.2, zn.z + (Math.random() - 0.5) * zn.r * 1.6, 0, 2 + Math.random() * 2, 0, 0xff7a2a, 0.5, 0.35);
      ctx.enemies.forEachInRadius(zn.x, zn.z, zn.r, (e) => {
        e.burnTimer = Math.max(e.burnTimer, 0.6);
        e.burnDps = Math.max(e.burnDps, zn.dps);
      });
      zn.mesh.scale.setScalar(zn.r * (0.95 + Math.sin(zn.life * 10) * 0.05));
      if (zn.life <= 0) {
        ctx.scene.remove(zn.mesh);
        this.zones.splice(i, 1);
      }
    }
  }
  dispose(ctx: GameContext): void {
    for (const z of this.zones) ctx.scene.remove(z.mesh);
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
    id: 'ember_bolt', name: 'Ember Bolt', icon: 'bolt', color: 0xffa040, maxLevel: 8,
    description: 'Hurls a burning ember at the nearest shadow.',
    levelText: ['+3 damage', '+1 bolt', '+3 damage, pierce 1', '+1 bolt', '+4 damage', '+1 bolt, +2 damage', '+1 bolt, +4 damage'],
    create: (ctx) => new EmberBolt(WEAPONS[0]),
  },
  {
    id: 'cinder_halo', name: 'Cinder Halo', icon: 'halo', color: 0xff6a2a, maxLevel: 8,
    description: 'Burning cinders orbit you, scorching anything they touch.',
    levelText: ['+1 cinder', 'Wider orbit, +damage', '+1 cinder', '+damage', '+1 cinder', '+1 cinder', '+1 cinder, +damage'],
    create: (ctx) => new CinderHalo(WEAPONS[1], ctx),
  },
  {
    id: 'flare_nova', name: 'Flare Nova', icon: 'nova', color: 0xffd27a, maxLevel: 8,
    description: 'Periodically erupts in a ring of light, hurling shadows back.',
    levelText: ['+radius, +damage', '+radius, +damage', 'Faster pulses', '+damage', '+radius', 'Faster pulses', 'Massive flare'],
    create: () => new FlareNova(WEAPONS[2]),
  },
  {
    id: 'spark_chain', name: 'Spark Chain', icon: 'spark', color: 0x9ad8ff, maxLevel: 8,
    description: 'Lightning leaps between nearby shadows.',
    levelText: ['+1 jump', '+damage', '+1 jump', 'Double strike', '+damage', '+1 jump', '+2 jumps, +damage'],
    create: () => new SparkChain(WEAPONS[3]),
  },
  {
    id: 'wick_lance', name: 'Wick Lance', icon: 'lance', color: 0xfff0b0, maxLevel: 8,
    description: 'A piercing beam of light fired in the direction you move.',
    levelText: ['+damage', 'Also fires behind you', '+damage', 'Faster', '+1 lance', '+damage', '+1 lance, +damage'],
    create: () => new WickLance(WEAPONS[4]),
  },
  {
    id: 'brazier', name: 'Brazier', icon: 'fire', color: 0xff5a1a, maxLevel: 8,
    description: 'Ignites the ground beneath shadows. Burning persists.',
    levelText: ['+burn', '+1 fire', '+radius', '+1 fire', '+radius, +burn', '+1 fire', 'Inferno'],
    create: () => new Brazier(WEAPONS[5]),
  },
  {
    id: 'frost_shards', name: 'Rime Shards', icon: 'frost', color: 0x7ad8ff, maxLevel: 8,
    description: 'A ring of frozen shards that slows what they pierce.',
    levelText: ['+1 shard', '+1 shard', '+damage', '+1 shard', '+1 shard', '+2 shards', '+2 shards, +damage'],
    create: () => new FrostShards(WEAPONS[6]),
  },
];

export function getWeapon(id: string): WeaponDef | undefined {
  return WEAPONS.find((w) => w.id === id);
}
