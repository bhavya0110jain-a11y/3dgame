import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { getBiome } from '../src/data/biomes';
import { Lighting } from '../src/render/Lighting';
import { GroundMask, MASK_SIZE } from '../src/world/GroundMask';
import { Props } from '../src/world/Props';

/** Props placed around the origin chunk for one biome / seed / decor fraction (procedural fallback models). */
function placeProps(decor: number, seed = 4242) {
  const mask = new GroundMask();
  mask.generate(seed);
  const biome = getBiome('biome_pines');
  const props = new Props(mask);
  props.setQuality({ decor, shadows: 'all', lantern: true });
  props.setBiome(biome);
  props.rebuild(0, 0, seed, biome.ground.waterLevel, biome.propDensity);
  return props;
}

describe('GroundMask', () => {
  it('generate_sameSeedTwiceAndAfterOtherSeeds_yieldsIdenticalBytes', () => {
    // Arrange
    const m = new GroundMask();
    m.generate(77);
    const first = m.data.slice();
    // Act: evict through other seeds, then come back (cache hit or rebuild must agree)
    m.generate(78);
    m.generate(79);
    m.generate(80);
    m.generate(81);
    m.generate(77);
    // Assert
    expect(m.data.length).toBe(MASK_SIZE * MASK_SIZE * 4);
    expect(Buffer.compare(Buffer.from(m.data), Buffer.from(first))).toBe(0);
  });

  it('generate_differentSeeds_produceDifferentFieldsWithFullRange', () => {
    const a = new GroundMask();
    const b = new GroundMask();
    a.generate(1);
    b.generate(2);
    let diff = 0;
    let lo = 255;
    let hi = 0;
    for (let i = 0; i < a.data.length; i += 4) {
      if (a.data[i] !== b.data[i]) diff++;
      lo = Math.min(lo, a.data[i + 1]);
      hi = Math.max(hi, a.data[i + 1]);
    }
    expect(diff).toBeGreaterThan(a.data.length / 8);
    // the path channel must straddle 0.5 (paths exist) — guards the half-res upsample against flattening
    expect(lo).toBeLessThan(100);
    expect(hi).toBeGreaterThan(155);
  });
});

describe('Props quality tiers', () => {
  it('rebuild_lowerDecorDensity_keepsEveryColliderIdentical', () => {
    // Arrange / Act
    const high = placeProps(1);
    const low = placeProps(0.5);
    // Assert: solid props (gameplay) never depend on the render tier
    expect(high.colliders.length).toBeGreaterThan(0);
    expect(low.colliders).toEqual(high.colliders);
  });
});

describe('Lighting shadow gate', () => {
  it('attachLantern_gate_skipsNonCastersInLanternPassAndCastersInMoonPass', () => {
    // Arrange
    const lighting = new Lighting(new THREE.Scene());
    const lantern = new THREE.PointLight(0xffa64d, 40, 14, 1.4);
    lighting.attachLantern(lantern);
    const enemy = new THREE.Mesh(new THREE.BoxGeometry());
    const proxy = new THREE.Mesh(new THREE.BoxGeometry());
    proxy.userData.lanternCaster = true;
    const r = {} as THREE.WebGLRenderer;
    const cam = new THREE.PerspectiveCamera();
    const run = (m: THREE.Mesh, shadowCam: THREE.Camera) => {
      const g = m.geometry;
      m.onBeforeShadow(r, m as unknown as THREE.Scene, cam, shadowCam, g, new THREE.MeshDepthMaterial(), {} as THREE.Group);
      const during = g.drawRange.count;
      m.onAfterShadow(r, m as unknown as THREE.Scene, cam, shadowCam, g, new THREE.MeshDepthMaterial(), {} as THREE.Group);
      return { during, after: g.drawRange.count };
    };
    // Act
    const enemyLantern = run(enemy, lantern.shadow.camera);
    const enemyMoon = run(enemy, lighting.moon.shadow.camera);
    const proxyLantern = run(proxy, lantern.shadow.camera);
    const proxyMoon = run(proxy, lighting.moon.shadow.camera);
    // Assert: a negative draw range makes renderBufferDirect skip the draw; it is always restored afterwards
    expect(enemyLantern.during).toBeLessThan(0);
    expect(enemyMoon.during).toBe(Infinity);
    expect(proxyLantern.during).toBe(Infinity);
    expect(proxyMoon.during).toBeLessThan(0);
    for (const x of [enemyLantern, enemyMoon, proxyLantern, proxyMoon]) expect(x.after).toBe(Infinity);
  });
});

describe('CameraRig view footprint', () => {
  it('follow_gameplayCamera_publishesFootprintAroundFocus_menuInvalidates', async () => {
    // Arrange
    const { CameraRig } = await import('../src/render/CameraRig');
    const { renderView } = await import('../src/render/Quality');
    const cam = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 220);
    cam.updateProjectionMatrix();
    const rig = new CameraRig(cam);
    // Act: settle the gameplay camera on (10, -20)
    rig.menu(0.016, 0, 0);
    const menuValid = renderView.valid;
    for (let i = 0; i < 120; i++) rig.follow(1 / 60, 10, -20, 0, 0, 0, 0, NaN, NaN);
    // Assert: the hero shot sees the horizon (no finite footprint); gameplay sees a bounded box around the focus
    expect(menuValid).toBe(false);
    expect(renderView.valid).toBe(true);
    expect(renderView.minX).toBeLessThan(10 - 10);
    expect(renderView.maxX).toBeGreaterThan(10 + 10);
    expect(renderView.minZ).toBeLessThan(-20 - 15);
    expect(renderView.maxZ).toBeGreaterThan(-20 + 5);
    expect(renderView.maxX - renderView.minX).toBeLessThan(160);
  });
});
