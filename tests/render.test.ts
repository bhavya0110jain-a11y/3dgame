import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CameraRig } from '../src/render/CameraRig';
import { Lighting } from '../src/render/Lighting';
import { tintMultiplier } from '../src/render/post/GradeShader';
import { applyRim, applyToonRamp, setRim } from '../src/render/materials';

describe('CameraRig', () => {
  it('follow_idlePlayer_settlesOnPlayerAtCalmZoomWithoutNaN', () => {
    const cam = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 200);
    const rig = new CameraRig(cam);
    rig.menu(0.016, 0, 0);
    for (let i = 0; i < 600; i++) rig.follow(1 / 60, 5, -3, 0, 0, 0, 0, NaN, NaN);
    expect(rig.focus.x).toBeCloseTo(5, 2);
    expect(rig.focus.z).toBeCloseTo(-3, 2);
    expect(rig.zoom).toBeCloseTo(0.9, 2); // empty field: 10% closer (bearer presence, art review s2 P2)
    expect(Number.isFinite(cam.position.x + cam.position.y + cam.position.z)).toBe(true);
    expect(cam.position.y).toBeGreaterThan(10);
  });

  it('follow_maxPressureWhileMoving_zoomsOutBoundedAndLeadsMovement', () => {
    const cam = new THREE.PerspectiveCamera();
    const rig = new CameraRig(cam);
    for (let i = 0; i < 1200; i++) rig.follow(1 / 60, 0, 0, 6, 0, 5, 0, NaN, NaN);
    expect(rig.zoom).toBeGreaterThan(1.25);
    expect(rig.zoom).toBeLessThanOrEqual(1.3001);
    expect(rig.focus.x).toBeGreaterThan(1); // look-ahead towards +x
    expect(rig.focus.x).toBeLessThanOrEqual(2.41);
  });

  it('follow_bossWithin14m_biasesFocusTowardBossAndZoomsOut', () => {
    const cam = new THREE.PerspectiveCamera();
    const near = new CameraRig(cam);
    for (let i = 0; i < 1200; i++) near.follow(1 / 60, 0, 0, 0, 0, 0, 0, 0, -10);
    expect(near.focus.z).toBeCloseTo(-4, 1); // 40% of the 10 m offset
    expect(near.zoom).toBeCloseTo(1.008, 2); // +12% zoom-out
    const far = new CameraRig(new THREE.PerspectiveCamera());
    for (let i = 0; i < 1200; i++) far.follow(1 / 60, 0, 0, 0, 0, 0, 0, 0, -30);
    expect(far.focus.z).toBeCloseTo(0, 2); // a distant boss leaves the framing alone
    expect(far.zoom).toBeCloseTo(0.9, 2);
  });

  it('menu_portrait_framesBearerNearCentre', () => {
    const cam = new THREE.PerspectiveCamera(62, 390 / 844, 0.1, 200);
    const rig = new CameraRig(cam);
    rig.menu(0.016, 0, 0);
    const p = new THREE.Vector3(0, 1.0, 0).project(cam);
    expect(Math.abs(p.x)).toBeLessThan(0.3); // bearer near the horizontal centre (NDC)
    expect(p.y).toBeLessThan(0.1); // and at or below the middle (menu title above)
  });

  it('follow_fullTrauma_shakeStaysBounded', () => {
    const cam = new THREE.PerspectiveCamera();
    const rig = new CameraRig(cam);
    for (let i = 0; i < 120; i++) rig.follow(1 / 60, 0, 0, 0, 0, 0, 0, NaN, NaN);
    for (let i = 0; i < 120; i++) {
      rig.follow(1 / 60, 0, 0, 0, 0, 0, 1, NaN, NaN);
      expect(Math.abs(cam.position.x)).toBeLessThan(0.7);
    }
  });
});

describe('Lighting', () => {
  it('follow_subTexelMoves_snapsLightSpaceXYToWholeTexels', () => {
    // Arrange
    const l = new Lighting(new THREE.Scene());
    l.setQuality({ moonShadow: 2048, lanternShadow: 0 });
    l.setExtent(22);
    const texel = 44 / 2048;
    const bx = new THREE.Vector3().crossVectors(l.keyDir, THREE.Object3D.DEFAULT_UP).normalize();
    const by = new THREE.Vector3().crossVectors(bx, l.keyDir).normalize();
    for (const [x, z] of [[10, 4], [10.0013, 4.0007], [-3.333, 17.77]]) {
      // Act
      l.follow(x, z);
      // Assert: light-space X/Y of the frustum centre are whole texels (depth along the light is free)
      const t = l.moon.target.position;
      const a = t.dot(bx) / texel;
      const b = t.dot(by) / texel;
      expect(Math.abs(a - Math.round(a))).toBeLessThan(1e-6);
      expect(Math.abs(b - Math.round(b))).toBeLessThan(1e-6);
    }
  });

  it('follow_farMove_centresFrustumNearFocusWithLightAbove', () => {
    // Arrange
    const l = new Lighting(new THREE.Scene());
    l.setExtent(22);
    // Act
    l.follow(30, -12);
    // Assert (snapping moves the centre by under a texel in light space)
    const t = l.moon.target.position;
    const d = new THREE.Vector3(30, 0, -12).sub(t);
    d.addScaledVector(l.keyDir, -d.dot(l.keyDir));
    expect(d.length()).toBeLessThan(0.05);
    expect(l.moon.position.y).toBeGreaterThan(t.y + 30);
  });
});

describe('grade + materials', () => {
  it('tintMultiplier_navyAndWhite_isLuminanceNormalisedAndClamped', () => {
    const v = tintMultiplier(0x2a2f6e, new THREE.Vector3());
    expect(v.z).toBeGreaterThan(v.x);
    expect(v.z).toBeLessThanOrEqual(2.2);
    const w = tintMultiplier(0xffffff, new THREE.Vector3());
    expect(w.x).toBeCloseTo(1, 3);
  });

  it('applyRim_chainedPatches_getDistinctProgramKeysAndAdjustableUniforms', () => {
    const a = new THREE.MeshStandardMaterial();
    a.onBeforeCompile = () => undefined;
    const b = new THREE.MeshStandardMaterial();
    applyRim(a, 0xffffff, 0.5);
    applyToonRamp(applyRim(b, 0xffffff, 0.5));
    expect(a.customProgramCacheKey()).not.toEqual(b.customProgramCacheKey());
    setRim(a, 0xff0000, 1.2);
    expect((a.userData.rim.strength as { value: number }).value).toBe(1.2);
  });
});
