import * as THREE from 'three';
import { ENEMIES, type EnemyDef } from '../data/enemies';
import { SpatialHash } from '../core/SpatialHash';
import { buildEnemyModel } from './enemyModels';
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
}

interface Batch {
  def: EnemyDef;
  body: THREE.InstancedMesh;
  eyes: THREE.InstancedMesh;
  capacity: number;
}

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
  private sharedBodyMat = new Map<string, THREE.MeshStandardMaterial>();

  constructor(private scene: THREE.Scene) {
    for (const def of Object.values(ENEMIES)) this.ensureBatch(def);
  }

  private ensureBatch(def: EnemyDef): Batch {
    let b = this.batches.get(def.id);
    if (b) return b;
    const model = buildEnemyModel(def.shape);
    const capacity = def.boss ? 4 : def.id === 'shade' || def.id === 'wisp' || def.id === 'crawler' ? 700 : 300;
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75, metalness: 0.1, flatShading: true });
    const eyeMat = new THREE.MeshBasicMaterial({ color: def.eyeColor });
    eyeMat.color.multiplyScalar(2.5);
    const body = new THREE.InstancedMesh(model.body, bodyMat, capacity);
    body.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    body.count = 0;
    body.frustumCulled = false;
    const eyes = new THREE.InstancedMesh(model.eyes, eyeMat, capacity);
    eyes.count = 0;
    eyes.frustumCulled = false;
    this.scene.add(body, eyes);
    b = { def, body, eyes, capacity };
    this.batches.set(def.id, b);
    return b;
  }

  spawn(defId: string, x: number, z: number, opts: { elite?: boolean; hpMul?: number } = {}): Enemy | null {
    const def = ENEMIES[defId];
    if (!def) return null;
    const batch = this.ensureBatch(def);
    let countOfType = 0;
    for (const e of this.list) if (e.active && e.def === def) countOfType++;
    if (countOfType >= batch.capacity) return null;
    const e: Enemy =
      this.free.pop() ??
      ({ hitCd: new Map() } as unknown as Enemy);
    const elite = !!opts.elite;
    const hpMul = (opts.hpMul ?? 1) * (def.boss ? 1 : this.hpMul) * (elite ? 12 : 1);
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
    });
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
      this.free.push(e);
    }
    this.list.length = 0;
    this.boss = null;
    for (const b of this.batches.values()) {
      b.body.count = 0;
      b.eyes.count = 0;
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

  /** Applies damage. Returns true if the enemy died. */
  damage(e: Enemy, amount: number, ctx: GameContext, opts: DamageOpts = {}): boolean {
    if (!e.active) return false;
    const stats = ctx.run.stats;
    let dmg = amount;
    let crit = false;
    if (opts.canCrit !== false && ctx.rng.next() < stats.critChance * stats.luck) {
      dmg *= stats.critMult;
      crit = true;
    }
    e.hp -= dmg;
    e.hitFlash = 1;
    ctx.run.damageDealt += dmg;
    if (opts.knockback && opts.fromX !== undefined && opts.fromZ !== undefined) {
      const dx = e.x - opts.fromX;
      const dz = e.z - opts.fromZ;
      const d = Math.hypot(dx, dz) || 1;
      const k = opts.knockback * (1 - e.def.knockbackResist);
      e.kbx += (dx / d) * k;
      e.kbz += (dz / d) * k;
    }
    if (ctx.save.settings.damageNumbers) {
      ctx.fx.text(e.x, 1.4 * e.scale + 0.4, e.z, Math.round(dmg).toString(), crit ? 'ft-crit' : opts.color ?? '');
    }
    ctx.events.emit('enemy:hit', { x: e.x, z: e.z, damage: dmg, crit });
    if (e.hp <= 0) {
      this.kill(e, ctx);
      return true;
    }
    return false;
  }

  kill(e: Enemy, ctx: GameContext): void {
    if (!e.active) return;
    e.active = false;
    ctx.run.kills++;
    ctx.fx.burst(e.x, 0.8 * e.scale, e.z, e.def.eyeColor, e.def.boss ? 160 : e.elite ? 50 : 10, e.def.boss ? 12 : 5, 0.7, 0.4);
    ctx.fx.burst(e.x, 0.6 * e.scale, e.z, 0x111111, e.def.boss ? 60 : 6, 3, 0.9, 0.6, -1);
    ctx.events.emit('enemy:killed', { x: e.x, z: e.z, defId: e.def.id, xp: e.def.xp, elite: e.elite });
    if (e.def.boss) {
      ctx.events.emit('boss:killed', { defId: e.def.id });
      if (this.boss === e) this.boss = null;
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
      else this.free.push(e);
    }
    this.list.length = w;
    this.activeCount = w;
    this.hash.clear();
    for (const e of this.list) this.hash.insert(e);

    for (const e of this.list) {
      const def = e.def;
      e.phase += dt;
      e.stateTime += dt;
      if (e.hitFlash > 0) e.hitFlash = Math.max(0, e.hitFlash - dt * 6);
      for (const [k, v] of e.hitCd) {
        if (v - dt <= 0) e.hitCd.delete(k);
        else e.hitCd.set(k, v - dt);
      }
      if (e.burnTimer > 0) {
        e.burnTimer -= dt;
        e.hp -= e.burnDps * dt;
        ctx.run.damageDealt += e.burnDps * dt;
        if (Math.random() < dt * 8) ctx.fx.spark(e.x, 0.8, e.z, 0, 1.5, 0, 0xff6a1a, 0.5, 0.35);
        if (e.hp <= 0) {
          this.kill(e, ctx);
          continue;
        }
      }
      let slow = 1;
      if (e.slowTimer > 0) {
        e.slowTimer -= dt;
        slow = 0.45;
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
            speed = def.speed * 4;
          } else if (e.state === 1) {
            speed *= 0.05;
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

    this.writeInstances(time);
  }

  private updateBoss(e: Enemy, dt: number, ctx: GameContext, nx: number, nz: number, dist: number): void {
    const def = e.def;
    // states: 0 chase, 1 windup, 2 charge, 3 volley
    if (e.state === 0) {
      e.timer -= dt;
      if (e.timer <= 0) {
        const roll = ctx.rng.next();
        if (roll < 0.45) {
          e.state = 1;
          e.stateTime = 0;
        } else if (roll < 0.8) {
          // radial volley
          const n = 16;
          for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2 + e.phase;
            ctx.projectiles.spawnHostile(e.x, e.z, Math.cos(a), Math.sin(a), def.projectileSpeed ?? 8, (def.projectileDamage ?? 12) * this.damageMul, def.eyeColor);
          }
          ctx.fx.ring(e.x, e.z, def.eyeColor, 1, 6, 0.5);
          e.timer = def.attackInterval ?? 5;
        } else {
          // summon minions
          const pool = ctx.world.biome.enemyPool;
          for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2;
            this.spawn(pool[i % 2], e.x + Math.cos(a) * 3, e.z + Math.sin(a) * 3);
          }
          ctx.fx.ring(e.x, e.z, 0x8844ff, 1, 8, 0.6);
          e.timer = def.attackInterval ?? 5;
        }
      }
    } else if (e.state === 1) {
      if (e.stateTime > 0.9) {
        e.state = 2;
        e.stateTime = 0;
        e.vx = nx;
        e.vz = nz;
        ctx.shake(0.4);
      }
    } else if (e.state === 2) {
      if (Math.random() < 0.5) ctx.fx.spark(e.x, 0.3, e.z, -e.vx * 3, 1, -e.vz * 3, def.eyeColor, 0.5, 0.5);
      if (e.stateTime > 0.9) {
        e.state = 0;
        e.timer = def.attackInterval ?? 5;
      }
    }
    // enrage below 30%
    if (e.hp < e.maxHp * 0.3) e.speedMul = 1.3;
  }

  private writeInstances(time: number): void {
    const counts = new Map<Batch, number>();
    for (const b of this.batches.values()) counts.set(b, 0);
    for (const e of this.list) {
      if (!e.active) continue;
      const b = this.batches.get(e.def.id)!;
      const i = counts.get(b)!;
      if (i >= b.capacity) continue;
      counts.set(b, i + 1);
      let bobY = 0;
      let sy = 1;
      let sxz = 1;
      switch (e.def.shape) {
        case 'wisp':
        case 'shade':
          bobY = Math.sin(e.phase * 4) * 0.12 + 0.1;
          break;
        case 'crawler':
          sy = 1 + Math.sin(e.phase * 18) * 0.08;
          break;
        default:
          sy = 1 + Math.sin(e.phase * 6) * 0.04;
      }
      if (e.def.behavior === 'dash' || e.def.behavior === 'boss') {
        if (e.state === 1) {
          sxz = 1 + Math.sin(e.stateTime * 40) * 0.08;
          sy *= 0.9;
        }
      }
      const s = e.scale;
      tmpP.set(e.x, bobY, e.z);
      tmpQ.setFromAxisAngle(UP, e.facing);
      tmpS.set(s * sxz, s * sy, s * sxz);
      tmpM.compose(tmpP, tmpQ, tmpS);
      b.body.setMatrixAt(i, tmpM);
      b.eyes.setMatrixAt(i, tmpM);
      tmpC.setHex(e.def.color);
      if (e.elite) tmpC.lerp(new THREE.Color(0x6a3a10), 0.5);
      if (e.hitFlash > 0) {
        const f = e.hitFlash;
        tmpC.r += f * 4;
        tmpC.g += f * 3;
        tmpC.b += f * 2.5;
      }
      if (e.slowTimer > 0) tmpC.b += 0.25;
      b.body.setColorAt(i, tmpC);
    }
    for (const [b, n] of counts) {
      b.body.count = n;
      b.eyes.count = n;
      b.body.instanceMatrix.needsUpdate = true;
      b.eyes.instanceMatrix.needsUpdate = true;
      if (b.body.instanceColor) b.body.instanceColor.needsUpdate = true;
    }
  }
}
