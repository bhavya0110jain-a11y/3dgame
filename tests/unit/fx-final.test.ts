/**
 * Sprint 3 final FX polish (production/qa/art-review-s3.md, BUG-QA-023 / BUG-QA-029):
 * damage-number setting (legacy boolean or 'all' | 'crits' | 'off'), Fx banners forwarded to a sink, one level-up
 * pillar at a time, and focus falloff on the bearer's own projectiles.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

// ------------------------------------------------------------------ minimal DOM shim (canvas atlases, fx text layer)
const noop = () => {};
const anyObj: object = new Proxy(function () {} as object, {
  get: (_t, k) => (k === Symbol.toPrimitive ? () => 0 : k === 'then' || k === Symbol.iterator ? undefined : anyObj),
  apply: () => anyObj,
  construct: () => anyObj,
  set: () => true,
});
const gl = globalThis as Record<string, unknown>;
const el = () => ({ width: 64, height: 64, style: {} as Record<string, string>, className: '', textContent: '', getContext: () => anyObj, appendChild: noop, addEventListener: noop, classList: { add: noop, remove: noop, toggle: noop } });
if (!gl.document) {
  gl.document = { createElement: el, body: el(), head: el(), getElementById: () => null, addEventListener: noop, documentElement: { classList: { contains: () => false } } };
}
if (!gl.window) gl.window = { addEventListener: noop, removeEventListener: noop, setTimeout, clearTimeout, devicePixelRatio: 1, innerWidth: 1280, innerHeight: 720 };

import { FxManager } from '../../src/render/Fx';
import { damageNumbersMode, showDamageNumber } from '../../src/render/vfx/damageNumbers';
import { focusFactor, FOCUS_MIN } from '../../src/render/vfx/focus';

const CROWD = 150;
const makeFx = () => new FxManager(new THREE.Scene(), new THREE.PerspectiveCamera(), el() as unknown as HTMLElement);

describe('damage-number setting', () => {
  it('damageNumbersMode_legacyBooleansAndStrings_normalised', () => {
    expect(damageNumbersMode(true)).toBe('all');
    expect(damageNumbersMode(false)).toBe('off');
    expect(damageNumbersMode('all')).toBe('all');
    expect(damageNumbersMode('crits')).toBe('crits');
    expect(damageNumbersMode('off')).toBe('off');
    expect(damageNumbersMode(undefined)).toBe('all');
  });

  it('showDamageNumber_eachMode_critsAndCrowdRule', () => {
    // all: non-crits only up to the crowd limit, crits always
    expect(showDamageNumber('all', false, CROWD, CROWD)).toBe(true);
    expect(showDamageNumber('all', false, CROWD + 1, CROWD)).toBe(false);
    expect(showDamageNumber(true, true, CROWD + 1, CROWD)).toBe(true);
    // crits only
    expect(showDamageNumber('crits', false, 1, CROWD)).toBe(false);
    expect(showDamageNumber('crits', true, CROWD + 1, CROWD)).toBe(true);
    // off (and legacy false): nothing
    expect(showDamageNumber('off', true, 1, CROWD)).toBe(false);
    expect(showDamageNumber(false, true, 1, CROWD)).toBe(false);
  });

  it('fxDamageNumber_settingOff_dropsNumber_crits_keepsFxSide', () => {
    const fx = makeFx();
    fx.damageNumbers = 'off';
    expect(fx.damageNumber(0, 1, 0, 10)).toBe(-1);
    fx.damageNumbers = 'crits'; // the crit filter is the caller's (EnemyManager); Fx still draws what it is given
    expect(fx.damageNumber(0, 1, 0, 10, 'ft-crit')).toBeGreaterThanOrEqual(0);
  });
});

describe('Fx banners (BUG-QA-023)', () => {
  it('banner_withSink_forwardsAndQueuesNothing', () => {
    const fx = makeFx();
    const got: string[] = [];
    fx.bannerSink = (s) => got.push(s);
    fx.text(0, 3, 0, 'REKINDLED', 'ft-big');
    fx.banner('Cinders on the wind!');
    expect(got).toEqual(['REKINDLED', 'Cinders on the wind!']);
    expect((fx as unknown as { bannerQ: string[] }).bannerQ).toEqual([]);
  });
});

describe('Fx level-up pillar', () => {
  it('levelUp_chainedTwice_onlyOnePillarSet', () => {
    const fx = makeFx();
    const cols = () => (fx as unknown as { colCount: number }).colCount;
    fx.levelUp(0, 0);
    const first = cols();
    fx.levelUp(0, 0);
    expect(first).toBeGreaterThan(0);
    expect(cols()).toBe(first);
  });
});

describe('focus falloff (bearer projectiles)', () => {
  it('focusFactor_atBearer_floor_farAway_full', () => {
    expect(focusFactor(0, 0)).toBeCloseTo(FOCUS_MIN, 5);
    expect(focusFactor(5, 0)).toBe(1);
  });
});
