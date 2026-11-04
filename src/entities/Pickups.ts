import * as THREE from 'three';
import type { GameContext } from '../game/types';
import { Billboards } from '../render/vfx/Billboards';
import { Frame } from '../render/vfx/atlas';
import { PF_BOUNCE, PF_FLICKER } from '../render/vfx/Particles';
import { ashGeometry, beaconGeometry, chestGeometry, emberGeometry, oilGeometry } from '../render/vfx/pickupModels';
import { applyRim } from '../render/materials';

export type PickupKind = 'ember' | 'oil' | 'chest' | 'beacon' | 'ash';

export interface Pickup {
  active: boolean;
  kind: PickupKind;
  x: number;
  z: number;
  value: number;
  magnetized: boolean;
  speed: number;
  phase: number;
}

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();
const tmpC = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

/** Ember color by value tier. */
function emberColor(v: number): number {
  if (v >= 50) return 0xff3a6a;
  if (v >= 10) return 0x6ab0ff;
  if (v >= 3) return 0x6aff8a;
  return 0xffb347;
}

export class PickupManager {
  readonly list: Pickup[] = [];
  private free: Pickup[] = [];
  private emberMesh: THREE.InstancedMesh;
  private oilMesh: THREE.InstancedMesh;
  private chestMesh: THREE.InstancedMesh;
  private beaconMesh: THREE.InstancedMesh;
  private ashMesh: THREE.InstancedMesh;
  private readonly cap = 1200;

  /** Halos, glints, ground sigils and light shafts for every pickup — one instanced draw call. */
  private glows: Billboards;
  private streakBudget = 0;
  /** player position (for the far-pickup guide motes) */
  private px = 0;
  private pz = 0;

  constructor(scene: THREE.Scene) {
    // ember: cut gem, unlit with baked facets; tinted + boosted per instance so it blooms
    const emberMat = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true });
    this.emberMesh = new THREE.InstancedMesh(emberGeometry(), emberMat, this.cap);
    this.emberMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.cap * 3), 3);
    // oil flask: glowing oil in glass (unlit — it's a light source)
    this.oilMesh = new THREE.InstancedMesh(oilGeometry(), new THREE.MeshBasicMaterial({ vertexColors: true }), 64);
    // reliquary chest: lit wood + gold, rim-lit so it pops out of the night
    const chestMat = applyRim(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.25, emissive: 0x3a1a00, emissiveIntensity: 0.6 }), 0xffd27a, 0.9, 2.2);
    this.chestMesh = new THREE.InstancedMesh(chestGeometry(), chestMat, 16);
    this.chestMesh.castShadow = true;
    // beacon: emissive cut crystal
    const beaconMat = new THREE.MeshStandardMaterial({ vertexColors: true, emissive: 0x3aa8ff, emissiveIntensity: 1.8, roughness: 0.15, metalness: 0.1, flatShading: true });
    this.beaconMesh = new THREE.InstancedMesh(beaconGeometry(), beaconMat, 16);
    this.beaconMesh.castShadow = true;
    const ashMat = new THREE.MeshBasicMaterial({ vertexColors: true });
    this.ashMesh = new THREE.InstancedMesh(ashGeometry(), ashMat, 128);
    for (const m of [this.emberMesh, this.oilMesh, this.chestMesh, this.beaconMesh, this.ashMesh]) {
      m.count = 0;
      m.frustumCulled = false;
      scene.add(m);
    }
    this.glows = new Billboards(scene, this.cap * 2 + 400, 19);
    this.glows.mesh.name = 'pickup-glows';
  }

  spawn(kind: PickupKind, x: number, z: number, value = 1): void {
    if (kind === 'ember') {
      // merge with a nearby ember if too many exist
      if (this.list.length > 600) {
        for (const p of this.list) {
          if (p.active && p.kind === 'ember' && !p.magnetized && (p.x - x) ** 2 + (p.z - z) ** 2 < 25) {
            p.value += value;
            return;
          }
        }
      }
    }
    const p = this.free.pop() ?? ({} as Pickup);
    // field-by-field (BUG-QA-016: no per-spawn object literal)
    p.active = true;
    p.kind = kind;
    p.x = x;
    p.z = z;
    p.value = value;
    p.magnetized = false;
    p.speed = 0;
    p.phase = Math.random() * 10;
    this.list.push(p);
  }

  /** Pull every ember toward the player (beacon pickup). */
  magnetizeAll(): void {
    for (const p of this.list) if (p.kind === 'ember' || p.kind === 'ash') p.magnetized = true;
  }

  clear(): void {
    for (const p of this.list) this.free.push(p);
    this.list.length = 0;
  }

  update(dt: number, ctx: GameContext, time: number): void {
    const pl = ctx.player;
    this.px = pl.x;
    this.pz = pl.z;
    const magnet = ctx.run.stats.magnet;
    this.streakBudget = 60;
    for (const p of this.list) {
      if (!p.active) continue;
      p.phase += dt;
      const dx = pl.x - p.x;
      const dz = pl.z - p.z;
      const d = Math.hypot(dx, dz);
      const autoKinds = p.kind === 'ember' || p.kind === 'ash' || p.kind === 'oil' || p.kind === 'beacon';
      if (!p.magnetized && autoKinds && d < magnet) p.magnetized = true;
      if (p.magnetized) {
        p.speed = Math.min(30, p.speed + dt * 40);
        const k = Math.min(d, p.speed * dt) / (d || 1);
        p.x += dx * k;
        p.z += dz * k;
        // visual: speeding embers leave light streaks (budgeted per frame)
        if (p.speed > 7 && this.streakBudget-- > 0 && d > 0.8) {
          const inv = p.speed / (d || 1);
          ctx.fx.streak(p.x, 0.45, p.z, dx * inv, 0, dz * inv, p.kind === 'ash' ? 0xb8a0ff : emberColor(p.value), p.value >= 10 ? 0.26 : 0.18, 0.16);
        }
      }
      if (d < 0.7) this.collect(p, ctx);
      // despawn very distant embers by merging into a big one near the player edge
    }
    let w = 0;
    for (const p of this.list) {
      if (p.active) this.list[w++] = p;
      else this.free.push(p);
    }
    this.list.length = w;
    this.writeInstances(time);
  }

  private collect(p: Pickup, ctx: GameContext): void {
    p.active = false;
    this.collectFx(p, ctx);
    switch (p.kind) {
      case 'ember':
        ctx.run.addXp(p.value);
        break;
      case 'oil':
        ctx.player.heal(ctx.run.stats.maxLight * 0.3, ctx);
        ctx.fx.ring(ctx.player.x, ctx.player.z, 0xffcf6a, 0.5, 3, 0.4);
        break;
      case 'chest':
        ctx.events.emit('chest:opened', {});
        break;
      case 'beacon':
        this.magnetizeAll();
        ctx.fx.ring(ctx.player.x, ctx.player.z, 0x9ad8ff, 0.5, 20, 0.8);
        break;
      case 'ash':
        ctx.run.ashEarned += p.value;
        break;
    }
    ctx.events.emit('pickup:collected', { kind: p.kind, value: p.value });
  }

  /** Visual-only flourish when a pickup is collected. */
  private collectFx(p: Pickup, ctx: GameContext): void {
    const fx = ctx.fx;
    const ps = fx.particles;
    switch (p.kind) {
      case 'ember':
      case 'ash': {
        if (ps.pressure > 0.85) break;
        const c = p.kind === 'ash' ? 0xc8b0ff : emberColor(p.value);
        const big = p.value >= 10;
        // pop: a sparkle that jumps up into the lantern + two motes drifting up
        ps.emit(p.x, 0.7, p.z, 0, 1.8, 0, 0.2, big ? 0.8 : 0.45, big ? 2.2 : 1.3, 0xffffff, c, 2.6, Frame.SPARKLE, 1, 0, 0, 0, 0, ps.rand() * 6);
        if (ps.pressure < 0.6) {
          for (let i = 0; i < 2; i++) ps.emit(p.x, 0.6, p.z, (ps.rand() - 0.5) * 1.5, 2.5 + ps.rand() * 2, (ps.rand() - 0.5) * 1.5, 0.35, 0.18, 0.04, 0xffffff, c, 2.8, Frame.DOT, 1, -3, 1);
        }
        if (big) {
          fx.ring(p.x, p.z, c, 0.2, 1.6, 0.3);
          ps.emit(p.x, 0.8, p.z, 0, 0, 0, 0.18, 0.6, 2, 0xffffff, c, 2.2, Frame.STAR, 1, 0, 0, 0, 0, ps.rand());
        }
        break;
      }
      case 'oil':
        fx.flash(p.x, 0.8, p.z, 0xffb040, 2.6, 3, true);
        for (let i = 0; i < 18; i++) {
          const a = ps.rand() * Math.PI * 2;
          ps.emit(p.x + Math.cos(a) * 0.6, 0.3, p.z + Math.sin(a) * 0.6, Math.cos(a) * 0.5, 2 + ps.rand() * 3, Math.sin(a) * 0.5, 0.8 + ps.rand() * 0.4, 0.3, 0.08, 0xfff0b0, 0xff9a30, 3, Frame.GLOW, 1, -1, 0.8, 0.02, PF_FLICKER);
        }
        break;
      case 'chest':
        fx.column(p.x, 0, p.z, 2.6, 15, 0xffd27a, 3, 1.1);
        fx.flash(p.x, 1, p.z, 0xffd27a, 4, 3.5, true);
        fx.ring(p.x, p.z, 0xffd27a, 0.5, 5, 0.6);
        // a fountain of golden glints thrown out of the opened lid
        for (let i = 0; i < 28; i++) {
          const a = ps.rand() * Math.PI * 2;
          const sp = 1.5 + ps.rand() * 3;
          ps.emit(p.x, 0.9, p.z, Math.cos(a) * sp, 5 + ps.rand() * 5, Math.sin(a) * sp, 0.9 + ps.rand() * 0.5, 0.3, 0.1, 0xfff6d0, 0xffb030, 3, i % 3 === 0 ? Frame.STAR : Frame.DOT, 1, -12, 0.4, 0.02, PF_BOUNCE | PF_FLICKER, ps.rand() * 6, (ps.rand() - 0.5) * 6);
        }
        break;
      case 'beacon':
        fx.column(p.x, 0, p.z, 2.2, 18, 0x9ad8ff, 3, 1.1);
        fx.flash(p.x, 1, p.z, 0x9ad8ff, 4, 3.5, true);
        for (let i = 0; i < 20; i++) {
          const a = (i / 20) * Math.PI * 2;
          ps.emit(p.x, 0.6, p.z, Math.cos(a) * 9, 0.5, Math.sin(a) * 9, 0.5, 0.4, 0.1, 0xffffff, 0x9ad8ff, 2.8, Frame.STREAK, 1, 0, 2, 0.06);
        }
        break;
    }
  }

  /**
   * Far-away reliquary / beacon (likely off-screen): three ground motes run out from the bearer's feet toward it,
   * like light leaking through a door — a diegetic pointer that needs no HUD arrow.
   */
  private guide(p: Pickup, color: number): void {
    const dx = p.x - this.px, dz = p.z - this.pz;
    const d = Math.hypot(dx, dz);
    if (d < 11) return;
    const ux = dx / d, uz = dz / d;
    const fade = Math.min(1, (d - 11) / 4);
    for (let k = 0; k < 3; k++) {
      const t = (p.phase * 0.9 + k / 3) % 1;
      const r = 1.6 + t * 2.4;
      const a = Math.sin(t * Math.PI) * fade;
      this.glows.ground(this.px + ux * r, 0.08, this.pz + uz * r, 1.3 - 0.4 * t, Frame.GLOW, color, 2, a);
      this.glows.ground(this.px + ux * r, 0.09, this.pz + uz * r, 0.7, Frame.SPARKLE, 0xffffff, 1.2, a * 0.8, Math.atan2(uz, ux));
    }
  }

  private writeInstances(time: number): void {
    let ne = 0, no = 0, nc = 0, nb = 0, na = 0;
    const g = this.glows;
    g.begin(time);
    // a late-game field of hundreds of gems must not read as confetti over the fight: past ~120 pickups every gem
    // and halo dims (down to 55%) and glints stop
    const crowd = 1 - 0.45 * Math.min(1, Math.max(0, (this.list.length - 120) / 280));
    const glints = this.list.length < 200;
    for (const p of this.list) {
      const bob = Math.sin(p.phase * 3) * 0.1;
      const pulse = Math.sin(p.phase * 5);
      tmpQ.setFromAxisAngle(UP, p.phase * 2);
      switch (p.kind) {
        case 'ember': {
          if (ne >= this.cap) break;
          const s = p.value >= 50 ? 2.2 : p.value >= 10 ? 1.6 : p.value >= 3 ? 1.25 : 1;
          const col = emberColor(p.value);
          const y = 0.45 + bob;
          tmpP.set(p.x, y, p.z);
          tmpS.setScalar(s * (1 + 0.08 * pulse));
          tmpM.compose(tmpP, tmpQ, tmpS);
          this.emberMesh.setMatrixAt(ne, tmpM);
          tmpC.setHex(col).multiplyScalar((1.9 + 0.5 * pulse) * crowd);
          this.emberMesh.setColorAt(ne, tmpC);
          ne++;
          g.add(p.x, y, p.z, 0.8 * s, Frame.GLOW, col, (0.42 + 0.14 * pulse) * crowd);
          // periodic glint (each ember on its own phase)
          const gl = glints ? Math.sin(p.phase * 1.9 + p.x * 0.7 + p.z * 0.3) : 0;
          if (gl > 0.9) {
            const k = (gl - 0.9) / 0.1;
            g.add(p.x + 0.05 * s, y + 0.14 * s, p.z, 1.4 * s * k, Frame.STAR, 0xffffff, 2.6 * k, 1, p.phase * 0.7);
          }
          break;
        }
        case 'oil': {
          const y = 0.12 + bob;
          tmpP.set(p.x, y, p.z);
          tmpQ.setFromAxisAngle(UP, Math.sin(p.phase * 1.3) * 0.5);
          tmpS.setScalar(1.3);
          tmpM.compose(tmpP, tmpQ, tmpS);
          this.oilMesh.setMatrixAt(no++, tmpM);
          g.add(p.x, y + 0.3, p.z, 2.2, Frame.GLOW, 0xffa030, 1.0 + 0.25 * pulse);
          g.ground(p.x, 0.06, p.z, 2.6, Frame.RING, 0xffb040, 1.5, 0.75 + 0.25 * pulse, p.phase * 0.8);
          g.column(p.x, 0, p.z, 1.1, 3.6, 0xffc060, 0.9, 0.6);
          break;
        }
        case 'chest': {
          tmpP.set(p.x, 0, p.z);
          tmpQ.setFromAxisAngle(UP, Math.sin(p.phase) * 0.2);
          tmpS.setScalar(1.15 + Math.sin(p.phase * 4) * 0.04);
          tmpM.compose(tmpP, tmpQ, tmpS);
          this.chestMesh.setMatrixAt(nc++, tmpM);
          g.column(p.x, 0, p.z, 2.0, 10, 0xffd27a, 1.4, 0.75 + 0.15 * Math.sin(p.phase * 3));
          g.ground(p.x, 0.06, p.z, 3.6, Frame.RING, 0xffc040, 1.8, 0.9, p.phase * 0.6);
          g.ground(p.x, 0.05, p.z, 3.2, Frame.GLOW, 0xffa030, 0.9, 0.8);
          for (let k = 0; k < 3; k++) {
            const a = p.phase * 1.6 + k * 2.094;
            g.add(p.x + Math.cos(a) * 0.85, 0.55 + 0.3 * Math.sin(p.phase * 2 + k), p.z + Math.sin(a) * 0.85, 0.6, Frame.STAR, 0xfff0c0, 2.4, 0.8 + 0.2 * Math.sin(p.phase * 7 + k), p.phase);
          }
          this.guide(p, 0xffc040);
          break;
        }
        case 'beacon': {
          const y = 0.95 + bob * 1.5;
          tmpP.set(p.x, y, p.z);
          tmpS.setScalar(1.25);
          tmpM.compose(tmpP, tmpQ, tmpS);
          this.beaconMesh.setMatrixAt(nb++, tmpM);
          g.column(p.x, 0, p.z, 1.8, 14, 0x9ad8ff, 1.5, 0.8);
          g.add(p.x, y, p.z, 2.6, Frame.GLOW, 0x6ac0ff, 1.3 + 0.3 * pulse);
          g.ground(p.x, 0.06, p.z, 3.2, Frame.RING, 0x8ad0ff, 1.8, 0.9, p.phase);
          g.ground(p.x, 0.07, p.z, 2.2, Frame.RING, 0xd0f0ff, 1.4, 0.7, -p.phase * 1.4);
          this.guide(p, 0x8ad0ff);
          break;
        }
        case 'ash': {
          const y = 0.42 + bob;
          tmpP.set(p.x, y, p.z);
          tmpS.setScalar(p.value >= 10 ? 1.6 : 1);
          tmpM.compose(tmpP, tmpQ, tmpS);
          this.ashMesh.setMatrixAt(na++, tmpM);
          g.add(p.x, y, p.z, p.value >= 10 ? 1.3 : 0.85, Frame.GLOW, 0xa080ff, 0.5 + 0.15 * pulse);
          break;
        }
      }
    }
    g.end();
    const set = (m: THREE.InstancedMesh, n: number) => {
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    };
    set(this.emberMesh, ne);
    set(this.oilMesh, no);
    set(this.chestMesh, nc);
    set(this.beaconMesh, nb);
    set(this.ashMesh, na);
  }
}
