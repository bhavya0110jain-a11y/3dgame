import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ParticleSystem, PF_UNSCALED } from '../src/render/vfx/Particles';
import { GroundFx, GM_SHOCK } from '../src/render/vfx/GroundFx';
import { Lightning, Ribbons, Strips } from '../src/render/vfx/Strips';

describe('ParticleSystem', () => {
  it('respects capacity and reports pressure', () => {
    const ps = new ParticleSystem(new THREE.Scene(), 10);
    let ok = 0;
    for (let i = 0; i < 25; i++) if (ps.emit(0, 0, 0, 0, 0, 0, 1, 1, 1, 0xffffff, 0xffffff, 1, 0)) ok++;
    expect(ok).toBe(10);
    expect(ps.count).toBe(10);
    expect(ps.pressure).toBe(1);
  });

  it('swap-removes dead particles and keeps the live set dense', () => {
    const ps = new ParticleSystem(new THREE.Scene(), 16);
    for (let i = 0; i < 8; i++) ps.emit(i, 0, 0, 0, 0, 0, i % 2 ? 0.05 : 1, 1, 1, 0xffffff, 0xffffff, 1, 0);
    ps.update(0.1, 0.1);
    expect(ps.count).toBe(4);
    ps.update(1, 1);
    expect(ps.count).toBe(0);
  });

  it('delayed particles occupy a slot but live for their full life after the delay', () => {
    const ps = new ParticleSystem(new THREE.Scene(), 4);
    ps.emit(0, 0, 0, 0, 0, 0, 0.5, 1, 1, 0xffffff, 0xffffff, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0.3);
    ps.update(0.4, 0.4); // 0.1 into its life
    expect(ps.count).toBe(1);
    ps.update(0.3, 0.3); // 0.4 into its life
    expect(ps.count).toBe(1);
    ps.update(0.2, 0.2);
    expect(ps.count).toBe(0);
  });

  it('unscaled particles tick on real time while the game is paused', () => {
    const ps = new ParticleSystem(new THREE.Scene(), 4);
    ps.emit(0, 0, 0, 0, 0, 0, 0.5, 1, 1, 0xffffff, 0xffffff, 1, 0, 1, 0, 0, 0, PF_UNSCALED);
    ps.emit(0, 0, 0, 0, 0, 0, 0.5, 1, 1, 0xffffff, 0xffffff, 1, 0);
    ps.update(0, 0.6);
    expect(ps.count).toBe(1);
  });
});

describe('GroundFx / strips', () => {
  it('ground decals expire', () => {
    const g = new GroundFx(new THREE.Scene(), 4);
    expect(g.add(GM_SHOCK, 0, 0, 0.5, 3, 0.3, 0xffffff)).toBe(true);
    g.update(0.1, 0.1);
    g.update(0.3, 0.3);
    // a fresh add still fits (slot was recycled)
    for (let i = 0; i < 4; i++) expect(g.add(GM_SHOCK, 0, 0, 0.5, 3, 0.3, 0xffffff)).toBe(true);
    expect(g.add(GM_SHOCK, 0, 0, 0.5, 3, 0.3, 0xffffff)).toBe(false);
  });

  it('lightning and ribbons build into the strip buffer without throwing', () => {
    const scene = new THREE.Scene();
    const strips = new Strips(scene, 2000);
    const cam = new THREE.PerspectiveCamera();
    cam.position.set(0, 20, 15);
    const bolts = new Lightning(4);
    const ribbons = new Ribbons(2);
    bolts.add(0, 1, 0, 5, 1, 2, 0x9ad8ff);
    const id = ribbons.alloc(0xff6a2a, 0.5);
    for (let i = 0; i < 30; i++) ribbons.push(id, Math.cos(i * 0.2), 1, Math.sin(i * 0.2));
    strips.begin(cam);
    bolts.update(0.016, strips);
    ribbons.update(0.016, strips);
    strips.end();
    const mesh = scene.children.find((o) => o.name === 'vfx-strips') as THREE.Mesh;
    expect(mesh.geometry.drawRange.count).toBeGreaterThan(0);
    expect(ribbons.alloc(0xffffff, 1)).toBe(1);
    expect(ribbons.alloc(0xffffff, 1)).toBe(-1);
  });
});

describe('FxManager immediate glows', () => {
  it('glows stop drawing once their owner stops calling glow() (regression: stale halo orbs)', async () => {
    // Arrange
    const { FxManager } = await import('../src/render/Fx');
    const fx = new FxManager(new THREE.Scene(), new THREE.PerspectiveCamera(), {} as HTMLElement);
    const boards = (fx as unknown as { boards: { mesh: THREE.Mesh } }).boards;
    const count = () => (boards.mesh.geometry as THREE.InstancedBufferGeometry).instanceCount;
    fx.glow(0, 1, 0, 1, 0xff6a2a);
    fx.update(0.016);
    expect(count()).toBe(1);
    // Act: owner (e.g. a removed weapon) no longer queues glows
    fx.update(0.016);
    // Assert
    expect(count()).toBe(0);
  });

  it('glows persist while the simulation is paused (dt = 0)', async () => {
    const { FxManager } = await import('../src/render/Fx');
    const fx = new FxManager(new THREE.Scene(), new THREE.PerspectiveCamera(), {} as HTMLElement);
    const boards = (fx as unknown as { boards: { mesh: THREE.Mesh } }).boards;
    fx.glow(0, 1, 0, 1, 0xff6a2a);
    fx.update(0.016);
    fx.update(0);
    fx.update(0);
    expect((boards.mesh.geometry as THREE.InstancedBufferGeometry).instanceCount).toBe(1);
  });
});
