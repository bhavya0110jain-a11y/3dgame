import * as THREE from 'three';
import type { GameContext } from '../game/types';
import type { Enemy } from './Enemies';
import { Frame } from '../render/vfx/atlas';
import { PF_BOUNCE, PF_FLICKER, PF_SOFTFADE } from '../render/vfx/Particles';
import { createProjectileBillboards, createShardGeometry, PS_BEAM, PS_COMET, PS_FROST, PS_MARKER, PS_MOTH, PS_VOID } from '../render/vfx/projectileVisuals';

export interface Projectile {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  damage: number;
  pierce: number; // remaining enemies it can pass through (-1 = infinite)
  life: number;
  radius: number;
  color: number;
  scale: number;
  hostile: boolean;
  source: string;
  knockback: number;
  homing: number; // turn rate (rad/s), 0 = none
  hit: Set<number>;
  trail: number; // trail emission strength (0..1)
  bounces: number;
  onHit?: (p: Projectile, e: Enemy, ctx: GameContext) => void;
  onExpire?: (p: Projectile, ctx: GameContext) => void;
  /** Visual style (derived from source at spawn; see render/vfx/projectileVisuals). Optional override. */
  vfx?: VfxKind;
  /** Per-projectile random seed for shader variation (set at spawn). */
  seed?: number;
  /** Resolved visual style index (internal, set at spawn). */
  styleIdx?: number;
}

/** Visual kinds. 'auto' (default) picks from `source`. */
export type VfxKind = 'auto' | 'ember' | 'comet' | 'beam' | 'shard' | 'hostile' | 'moth' | 'spear';

export type ProjectileSpawn = Partial<Projectile> & Pick<Projectile, 'x' | 'z' | 'vx' | 'vz' | 'damage'>;

const V_EMBER = 0, V_COMET = 1, V_BEAM = 2, V_SHARD = 3, V_HOSTILE = 4, V_MOTH = 5, V_SPEAR = 6;
const kindIndex: Record<VfxKind, number> = { auto: -1, ember: V_EMBER, comet: V_COMET, beam: V_BEAM, shard: V_SHARD, hostile: V_HOSTILE, moth: V_MOTH, spear: V_SPEAR };

function styleFor(p: Projectile): number {
  if (p.hostile) return V_HOSTILE;
  const k = p.vfx ? kindIndex[p.vfx] : -1;
  if (k >= 0) return k;
  switch (p.source) {
    case 'ember_bolt':
      return V_EMBER;
    case 'sunspear_volley':
      return V_SPEAR;
    case 'moth_lantern':
    case 'lunar_monarchs':
      return V_MOTH;
    case 'wick_lance':
    case 'beacon_ray':
      return V_BEAM;
    case 'frost_shards':
    case 'glacier_heart':
      return V_SHARD;
    default:
      return V_COMET;
  }
}

/**
 * Hostile palette: every enemy shot is the same hot magenta with a dark rim (see projectileVisuals VOID), a hue no
 * friendly projectile uses (theirs are warm amber/gold, ice blue or moon violet), so "dodge this" reads instantly.
 * The caster's own colour survives only as a faint tint (cool casters lean violet, warm ones lean rose).
 */
export const HOSTILE_COLOR = 0xff3df0;
function hostileColor(c: number): number {
  tmpC.setHex(c).getHSL(hsl);
  const h = hsl.h * 360;
  // ±8° of hue around #ff3df0 (≈ 304°) — still unmistakably the hostile magenta
  const lean = h > 180 && h < 300 ? -0.022 : 0.012;
  tmpC.setHex(HOSTILE_COLOR).offsetHSL(lean, 0, 0);
  return tmpC.getHex();
}

/** Squared distance from the bearer inside which friendly projectiles emit no trail particles. */
const TRAIL_CLEAR2 = 1.6 * 1.6;
const tmpM = new THREE.Matrix4();
const tmpC = new THREE.Color();
const hsl = { h: 0, s: 0, l: 0 };
const tmpQ = new THREE.Quaternion();
const tmpQ2 = new THREE.Quaternion();
const tmpV = new THREE.Vector3();
const tmpS = new THREE.Vector3();
const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Y = new THREE.Vector3(0, 1, 0);

export class ProjectileManager {
  private list: Projectile[] = [];
  private free: Projectile[] = [];
  private readonly capacity = 1500;
  private bb: ReturnType<typeof createProjectileBillboards>;
  private shards: THREE.InstancedMesh;
  private attrs: THREE.InstancedBufferAttribute[];
  private time = 0;

  constructor(scene: THREE.Scene) {
    this.bb = createProjectileBillboards(this.capacity * 2);
    this.attrs = [this.bb.aPos, this.bb.aDir, this.bb.aCol, this.bb.aSty];
    scene.add(this.bb.mesh);
    const shardMat = new THREE.MeshStandardMaterial({
      color: 0x7fd8ff,
      emissive: 0x1e7cff,
      emissiveIntensity: 1.6,
      roughness: 0.12,
      metalness: 0.05,
      flatShading: true,
      side: THREE.DoubleSide,
    });
    this.shards = new THREE.InstancedMesh(createShardGeometry(), shardMat, this.capacity);
    this.shards.count = 0;
    this.shards.frustumCulled = false;
    this.shards.name = 'vfx-shards';
    scene.add(this.shards);
  }

  spawn(s: ProjectileSpawn): Projectile | null {
    if (this.list.length >= this.capacity) return null;
    const p = this.free.pop() ?? ({ hit: new Set<number>() } as Projectile);
    p.hit.clear();
    // defaults field-by-field, then the caller's fields (no merged temporary object per shot)
    p.active = true;
    p.y = 1.0;
    p.pierce = 0;
    p.life = 2;
    p.radius = 0.25;
    p.color = 0xffb347;
    p.scale = 1;
    p.hostile = false;
    p.source = 'unknown';
    p.knockback = 2;
    p.homing = 0;
    p.trail = 0.5;
    p.bounces = 0;
    p.onHit = undefined;
    p.onExpire = undefined;
    p.vfx = 'auto';
    Object.assign(p, s);
    p.seed = Math.random();
    p.styleIdx = styleFor(p);
    this.list.push(p);
    return p;
  }

  spawnHostile(x: number, z: number, dx: number, dz: number, speed: number, damage: number, color: number): void {
    const c = hostileColor(color);
    const p = this.spawn({ x, z, vx: dx * speed, vz: dz * speed, damage, hostile: true, life: 4, radius: 0.3, color: c, scale: 1.4, source: 'enemy', trail: 0.3, y: 0.9 });
    if (!p) return;
    // brief charge flash at the caster so the shot's origin reads
    this.fxRef?.flash(x + dx * 0.4, 0.9, z + dz * 0.4, c, 1.4, 2.2);
  }

  private fxRef: GameContext['fx'] | null = null;

  clear(): void {
    for (const p of this.list) this.free.push(p);
    this.list.length = 0;
    this.bb.geo.instanceCount = 0;
    this.shards.count = 0;
  }

  update(dt: number, ctx: GameContext): void {
    const enemies = ctx.enemies;
    const player = ctx.player;
    const fx = ctx.fx;
    this.fxRef = fx;
    fx.setFocus(player.x, player.z);
    const gain = fx.brightness ?? 1;
    this.bb.uniforms.uGain.value = gain;
    (this.shards.material as THREE.MeshStandardMaterial).emissiveIntensity = 1.6 * gain;
    this.time += dt;
    const ps = fx.particles;
    const room = 1 - ps.pressure;
    for (const p of this.list) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        this.fizzle(p, ctx);
        p.onExpire?.(p, ctx);
        continue;
      }
      if (p.homing > 0 && !p.hostile) {
        const t = enemies.nearest(p.x, p.z, 10, p.hit);
        if (t) {
          const speed = Math.hypot(p.vx, p.vz);
          const cur = Math.atan2(p.vz, p.vx);
          const want = Math.atan2(t.z - p.z, t.x - p.x);
          let d = want - cur;
          while (d > Math.PI) d -= Math.PI * 2;
          while (d < -Math.PI) d += Math.PI * 2;
          const turn = Math.sign(d) * Math.min(Math.abs(d), p.homing * dt);
          const a = cur + turn;
          p.vx = Math.cos(a) * speed;
          p.vz = Math.sin(a) * speed;
        }
      }
      p.x += p.vx * dt;
      p.z += p.vz * dt;
      // friendly trails start ~1.6 m out: dozens of shots leaving the lantern at once must not pile their trails
      // (frost puffs, embers, sparkles) into a bright blot on the bearer
      if (dt > 0 && (p.hostile || (p.x - player.x) ** 2 + (p.z - player.z) ** 2 > TRAIL_CLEAR2)) this.emitTrail(p, dt, ctx, room);

      if (p.hostile) {
        const dx = player.x - p.x;
        const dz = player.z - p.z;
        if (dx * dx + dz * dz < (p.radius + player.radius) ** 2) {
          player.damage(p.damage, ctx);
          p.active = false;
          this.hostileImpact(p, ctx);
        }
        continue;
      }

      enemies.forEachInRadius(p.x, p.z, p.radius, (e) => {
        if (!p.active || p.hit.has(e.id)) return;
        p.hit.add(e.id);
        // Enemies.damage → fx.hit draws the directional impact sparks; add per-style flavour here
        enemies.damage(e, p.damage, ctx, { knockback: p.knockback, fromX: p.x - p.vx, fromZ: p.z - p.vz, source: p.source });
        this.impact(p, ctx);
        p.onHit?.(p, e, ctx);
        if (p.pierce === 0) {
          if (p.bounces > 0) {
            p.bounces--;
            const next = enemies.nearest(p.x, p.z, 8, p.hit);
            if (next) {
              const speed = Math.hypot(p.vx, p.vz);
              const d = Math.hypot(next.x - p.x, next.z - p.z) || 1;
              p.vx = ((next.x - p.x) / d) * speed;
              p.vz = ((next.z - p.z) / d) * speed;
              return;
            }
          }
          p.active = false;
          p.onExpire?.(p, ctx);
        } else if (p.pierce > 0) p.pierce--;
      });
    }

    this.writeInstances();
  }

  // ------------------------------------------------------------------ visuals
  private emitTrail(p: Projectile, dt: number, ctx: GameContext, room: number): void {
    const fx = ctx.fx;
    const ps = fx.particles;
    const style = p.styleIdx ?? V_COMET;
    // rate: particles per second scaled by p.trail and pressure
    const rate = (style === V_BEAM ? 70 : style === V_SPEAR ? 42 : style === V_HOSTILE ? 26 : style === V_MOTH ? 22 : 40) * Math.max(0.15, p.trail) * room;
    let n = rate * dt;
    const sc = p.scale;
    while (n > 0) {
      if (n < 1 && ps.rand() > n) break;
      n -= 1;
      const back = ps.rand() * 0.25;
      const x = p.x - p.vx * back * dt * 4, z = p.z - p.vz * back * dt * 4;
      switch (style) {
        case V_EMBER:
          if (ps.rand() < 0.75) ps.emit(x + (ps.rand() - 0.5) * 0.15, p.y + (ps.rand() - 0.5) * 0.15, z + (ps.rand() - 0.5) * 0.15, -p.vx * 0.08 + (ps.rand() - 0.5), 0.6 + ps.rand() * 1.2, -p.vz * 0.08 + (ps.rand() - 0.5), 0.25 + ps.rand() * 0.2, 0.28 * sc, 0.06, 0xfff0b0, 0xff4a10, 3, Frame.GLOW, 1, 1.5, 2);
          else ps.emit(x, p.y, z, -p.vx * 0.05, 0.8, -p.vz * 0.05, 0.6, 0.3 * sc, 0.9 * sc, 0x3a2a2a, 0x18141a, 1, Frame.SMOKE, 0, 0.5, 1, 0, PF_SOFTFADE, ps.rand() * 6, 0, 0, 0.2);
          break;
        case V_SPEAR:
          if (ps.rand() < 0.8) ps.emit(x + (ps.rand() - 0.5) * 0.15, p.y + (ps.rand() - 0.5) * 0.15, z + (ps.rand() - 0.5) * 0.15, -p.vx * 0.06 + (ps.rand() - 0.5), 0.6 + ps.rand() * 1.4, -p.vz * 0.06 + (ps.rand() - 0.5), 0.3 + ps.rand() * 0.2, 0.26 * sc, 0.06, 0xfff6c0, 0xff8a10, 2.4, ps.rand() < 0.3 ? Frame.SPARKLE : Frame.GLOW, 1, 1.5, 2, 0, PF_FLICKER, ps.rand() * 6);
          else ps.emit(x, p.y, z, -p.vx * 0.04, 1, -p.vz * 0.04, 0.4, 0.5 * sc, 0.1, 0xffe08a, 0xff5a10, 2.4, Frame.FLAME, 1, 1, 1, 0, PF_FLICKER, ps.rand() - 0.5);
          break;
        case V_MOTH:
          // wing-dust: sparkles that drift down behind the moth
          ps.emit(x + (ps.rand() - 0.5) * 0.3, p.y + (ps.rand() - 0.5) * 0.2, z + (ps.rand() - 0.5) * 0.3, (ps.rand() - 0.5) * 0.6, -0.3 - ps.rand() * 0.4, (ps.rand() - 0.5) * 0.6, 0.45 + ps.rand() * 0.3, 0.16 * sc, 0.04, 0xffffff, p.color, 2.4, Frame.SPARKLE, 1, -0.5, 1, 0, PF_FLICKER, ps.rand() * 6);
          break;
        case V_BEAM:
          ps.emit(x + (ps.rand() - 0.5) * 0.2, p.y + (ps.rand() - 0.5) * 0.2, z + (ps.rand() - 0.5) * 0.2, (ps.rand() - 0.5) * 2, 0.5 + ps.rand() * 2, (ps.rand() - 0.5) * 2, 0.18 + ps.rand() * 0.15, 0.2 * Math.min(sc, 1.3), 0.04, 0xffffff, p.color, 2.6, Frame.SPARKLE, 1, -2, 2, 0, PF_FLICKER, ps.rand() * 6);
          break;
        case V_SHARD:
          if (ps.rand() < 0.3) fx.frostPuff(x, p.y, z, 1, 0.3 * sc);
          else ps.emit(x, p.y, z, (ps.rand() - 0.5), (ps.rand() - 0.5), (ps.rand() - 0.5), 0.3, 0.22, 0.05, 0xffffff, 0x9ae8ff, 3, Frame.SPARKLE, 1, -2, 1, 0, PF_FLICKER, ps.rand() * 6);
          break;
        case V_HOSTILE:
          if (ps.rand() < 0.6) ps.emit(x, p.y, z, (ps.rand() - 0.5) * 0.6, 0.4 + ps.rand() * 0.5, (ps.rand() - 0.5) * 0.6, 0.55, 0.35 * sc, 0.9 * sc, 0x2a1438, 0x0c0612, 1, Frame.SMOKE2, 0, 0, 1.5, 0, PF_SOFTFADE, ps.rand() * 6, (ps.rand() - 0.5) * 3, 0, 0.15);
          else ps.emit(x, p.y, z, (ps.rand() - 0.5) * 1.5, 0.5 + ps.rand(), (ps.rand() - 0.5) * 1.5, 0.35, 0.2, 0.05, p.color, p.color, 2.6, Frame.DOT, 1, -1, 1, 0, PF_FLICKER);
          break;
        default:
          ps.emit(x, p.y, z, -p.vx * 0.06 + (ps.rand() - 0.5) * 0.6, 0.3 + ps.rand() * 0.6, -p.vz * 0.06 + (ps.rand() - 0.5) * 0.6, 0.28, 0.24 * sc, 0.05, 0xffffff, p.color, 2.6, Frame.GLOW, 1, 0, 1.5);
      }
    }
  }

  private impact(p: Projectile, ctx: GameContext): void {
    const fx = ctx.fx;
    const style = p.styleIdx ?? V_COMET;
    if (style === V_SHARD) fx.frostPuff(p.x, p.y, p.z, 3, 0.5);
    else if (style === V_EMBER || style === V_SPEAR) {
      const ps = fx.particles;
      for (let i = 0; i < 3; i++) ps.emit(p.x, p.y, p.z, (ps.rand() - 0.5) * 3, 1 + ps.rand() * 2, (ps.rand() - 0.5) * 3, 0.3, 0.45, 0.1, 0xffe0a0, 0xff4a10, 2.6, Frame.FLAME, 1, 1, 2, 0, PF_FLICKER, ps.rand() - 0.5);
    }
  }

  private fizzle(p: Projectile, ctx: GameContext): void {
    const ps = ctx.fx.particles;
    if (ps.pressure > 0.7) return;
    const style = p.styleIdx ?? V_COMET;
    if (style === V_SHARD) {
      ctx.fx.frostPuff(p.x, p.y, p.z, 2, 0.4);
      return;
    }
    ps.emit(p.x, p.y, p.z, 0, 0.3, 0, 0.2, 0.4 * p.scale, 0.9 * p.scale, 0xffffff, p.color, p.hostile ? 1.6 : 2, Frame.GLOW, 1);
    for (let i = 0; i < 3; i++) ps.emit(p.x, p.y, p.z, (ps.rand() - 0.5) * 3, 1 + ps.rand() * 2, (ps.rand() - 0.5) * 3, 0.25, 0.14, 0.04, 0xffffff, p.color, 2.6, Frame.STREAK, 1, -8, 2, 0.04, PF_BOUNCE);
  }

  private hostileImpact(p: Projectile, ctx: GameContext): void {
    const fx = ctx.fx;
    const ps = fx.particles;
    ps.emit(p.x, p.y, p.z, 0, 0, 0, 0.18, 0.8, 2.6, 0xffffff, p.color, 3, Frame.BURST, 1, 0, 0, 0, 0, ps.rand() * 6);
    fx.ring(p.x, p.z, p.color, 0.2, 1.8, 0.3);
    for (let i = 0; i < 10; i++) {
      const a = ps.rand() * Math.PI * 2;
      const sp = 3 + ps.rand() * 5;
      ps.emit(p.x, p.y, p.z, Math.cos(a) * sp, 1 + ps.rand() * 3, Math.sin(a) * sp, 0.3, 0.2, 0.06, 0xffffff, p.color, 3, Frame.STREAK, 1, -12, 2, 0.04, PF_BOUNCE);
    }
    for (let i = 0; i < 4; i++) ps.emit(p.x, p.y, p.z, (ps.rand() - 0.5) * 2, 0.6 + ps.rand(), (ps.rand() - 0.5) * 2, 0.7, 0.5, 1.6, 0x2a1438, 0x0c0612, 1, Frame.SMOKE, 0, 0, 1.5, 0, PF_SOFTFADE, ps.rand() * 6, 0, 0, 0.1);
  }

  private writeInstances(): void {
    let w = 0;
    let n = 0;
    let ns = 0;
    const P = this.bb.aPos.array as Float32Array;
    const D = this.bb.aDir.array as Float32Array;
    const C = this.bb.aCol.array as Float32Array;
    const S = this.bb.aSty.array as Float32Array;
    this.bb.uniforms.uTime.value = this.time;
    for (let i = 0; i < this.list.length; i++) {
      const p = this.list[i];
      if (!p.active) {
        this.free.push(p);
        continue;
      }
      this.list[w++] = p;
      const style = p.styleIdx ?? V_COMET;
      const sc = p.scale;
      const speed = Math.hypot(p.vx, p.vz);
      // fade in over the first few frames of a long-lived shot (no pop at the muzzle), out at end of life
      const alpha = Math.min(1, p.life * 6);
      tmpC.setHex(p.color);
      let size = 0.22 * sc;
      let tail = 0;
      let st = PS_COMET;
      let inten = 2.4;
      switch (style) {
        case V_EMBER: size = 0.26 * sc; tail = Math.min(2.4, speed * 0.11) * sc; st = PS_COMET; inten = 2.8; break;
        case V_BEAM: size = 0.24 * sc; tail = Math.min(5.5, speed * 0.24) * sc; st = PS_BEAM; inten = 2.4 / Math.max(1, sc * 0.75); break;
        case V_SPEAR: size = 0.24 * sc; tail = Math.min(2.6, speed * 0.12) * sc; st = PS_BEAM; inten = 1.9; break;
        case V_MOTH: size = 0.6 * sc; tail = Math.min(0.9, speed * 0.06) * sc; st = PS_MOTH; inten = 1.6; break;
        case V_SHARD: size = 0.34 * sc; tail = Math.min(1.8, speed * 0.12) * sc; st = PS_FROST; inten = 2.6; tmpC.setHex(0x4ab8ff); break;
        case V_HOSTILE: size = 0.32 * sc; tail = Math.min(1.2, speed * 0.12); st = PS_VOID; inten = 2.2; break;
        default: size = 0.24 * sc; tail = Math.min(1.8, speed * 0.1) * sc; st = PS_COMET; inten = 2.4;
      }
      let j = n * 4;
      P[j] = p.x; P[j + 1] = p.y; P[j + 2] = p.z; P[j + 3] = size;
      D[j] = p.vx; D[j + 1] = 0; D[j + 2] = p.vz; D[j + 3] = tail;
      C[j] = tmpC.r * inten; C[j + 1] = tmpC.g * inten; C[j + 2] = tmpC.b * inten; C[j + 3] = alpha;
      S[j] = st; S[j + 1] = p.seed ?? 0; S[j + 2] = 0; S[j + 3] = 0;
      n++;
      if (style === V_HOSTILE) {
        j = n * 4;
        P[j] = p.x; P[j + 1] = 0.07; P[j + 2] = p.z; P[j + 3] = 0.42 * sc;
        D[j] = 0; D[j + 1] = 0; D[j + 2] = 0; D[j + 3] = 0;
        C[j] = tmpC.r * 1.6; C[j + 1] = tmpC.g * 1.6; C[j + 2] = tmpC.b * 1.6; C[j + 3] = alpha;
        S[j] = PS_MARKER; S[j + 1] = p.seed ?? 0; S[j + 2] = 0; S[j + 3] = 0;
        n++;
      } else if (style === V_SHARD) {
        // crystal body: long axis along velocity, spinning around it
        const yaw = Math.atan2(-p.vz, p.vx);
        tmpQ.setFromAxisAngle(AXIS_Y, yaw);
        tmpQ2.setFromAxisAngle(AXIS_X, this.time * 9 + (p.seed ?? 0) * 6.28);
        tmpQ.multiply(tmpQ2);
        tmpV.set(p.x, p.y, p.z);
        tmpS.set(1.25 * sc, 1.1 * sc, 1.1 * sc);
        tmpM.compose(tmpV, tmpQ, tmpS);
        this.shards.setMatrixAt(ns++, tmpM);
      }
    }
    this.list.length = w;
    const geo = this.bb.geo;
    geo.instanceCount = n;
    if (n > 0) {
      for (const a of this.attrs) {
        a.clearUpdateRanges();
        a.addUpdateRange(0, n * 4);
        a.needsUpdate = true;
      }
    }
    this.shards.count = ns;
    if (ns > 0) this.shards.instanceMatrix.needsUpdate = true;
  }
}
