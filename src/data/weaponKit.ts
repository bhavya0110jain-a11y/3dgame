import * as THREE from 'three';
import type { GameContext, WeaponDef, WeaponInstance } from '../game/types';
import type { Enemy } from '../entities/Enemies';

/**
 * Shared building blocks for weapons in weaponsNew.ts / evolutions.ts (weapons.ts keeps its own private copy so the
 * VFX agent can edit those classes independently).
 */
export abstract class TimedWeapon implements WeaponInstance {
  level = 1;
  protected cd = 0.25;
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
  /** Per-level table lookup (clamped). */
  protected lv<T>(table: readonly T[]): T {
    return table[Math.max(0, Math.min(table.length, this.level) - 1)];
  }
}

/** Additive glowing material (bloom-friendly), shared per colour. */
const glowMats = new Map<number, THREE.MeshBasicMaterial>();
export function glowMaterial(color: number, intensity = 2.6, opacity = 1): THREE.MeshBasicMaterial {
  const key = color * 1000 + Math.round(intensity * 10) + opacity;
  let m = glowMats.get(key);
  if (!m) {
    m = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color).multiplyScalar(intensity),
      transparent: opacity < 1,
      opacity,
      blending: opacity < 1 ? THREE.AdditiveBlending : THREE.NormalBlending,
      depthWrite: opacity >= 1,
      side: THREE.DoubleSide,
    });
    glowMats.set(key, m);
  }
  return m;
}

/** Simple fixed-size mesh pool for weapon visuals (no allocation once warmed). */
export class MeshPool {
  private items: THREE.Mesh[] = [];
  private used = 0;
  constructor(private scene: THREE.Scene, private geom: THREE.BufferGeometry, private mat: THREE.Material) {}
  begin(): void {
    this.used = 0;
  }
  next(): THREE.Mesh {
    let m = this.items[this.used];
    if (!m) {
      m = new THREE.Mesh(this.geom, this.mat);
      m.frustumCulled = false;
      this.scene.add(m);
      this.items.push(m);
    }
    m.visible = true;
    this.used++;
    return m;
  }
  end(): void {
    for (let i = this.used; i < this.items.length; i++) this.items[i].visible = false;
  }
  dispose(): void {
    for (const m of this.items) this.scene.remove(m);
    this.items.length = 0;
  }
}

/** Picks the enemy within `range` that has the most neighbours within `r` (samples a few candidates). */
export function densestTarget(ctx: GameContext, x: number, z: number, range: number, r: number, samples = 5): Enemy | null {
  let best: Enemy | null = null;
  let bestN = -1;
  for (let i = 0; i < samples; i++) {
    const c = ctx.enemies.randomInRange(x, z, range, () => ctx.rng.next());
    if (!c) break;
    let n = 0;
    ctx.enemies.forEachInRadius(c.x, c.z, r, () => n++);
    if (n > bestN) {
      bestN = n;
      best = c;
    }
  }
  return best;
}

/** Shows an area telegraph using fx.telegraph when the VFX agent provides it, rings otherwise. */
export function telegraph(ctx: GameContext, x: number, z: number, r: number, dur: number, color: number): void {
  const fx = ctx.fx as unknown as { telegraph?: (x: number, z: number, r: number, dur: number, color: number) => void };
  if (typeof fx.telegraph === 'function') fx.telegraph(x, z, r, dur, color);
  else ctx.fx.ring(x, z, color, r * 0.15, r, dur);
}
