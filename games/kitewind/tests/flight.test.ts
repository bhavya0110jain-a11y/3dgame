import { describe, it, expect } from 'vitest';
import { KiteFlight } from '../src/game/Flight';
import { baseMods } from '../src/game/Mods';
import { FLIGHT } from '../src/data/tuning';

const DT = 1 / 60;
const run = (f: KiteFlight, secs: number, steerX = 0, steerY = 0, dive = false): void => {
  for (let i = 0; i < Math.round(secs / DT); i++) f.step(DT, { steerX, steerY, dive });
};

describe('KiteFlight', () => {
  it('holds altitude and cruise speed with neutral input', () => {
    const f = new KiteFlight(baseMods());
    run(f, 3);
    expect(Math.abs(f.y - FLIGHT.startAltitude)).toBeLessThan(0.5);
    expect(f.speed).toBeCloseTo(FLIGHT.cruiseSpeed, 0);
    expect(f.z).toBeGreaterThan(70);
  });

  it('diving gains speed and loses altitude; releasing pulls back up', () => {
    const f = new KiteFlight(baseMods());
    const y0 = f.y;
    run(f, 1.5, 0, 0, true);
    expect(f.speed).toBeGreaterThan(FLIGHT.cruiseSpeed + 10);
    expect(f.y).toBeLessThan(y0 - 8);
    const yLow = f.y;
    run(f, 1.5, 0, 1, false);
    expect(f.pitch).toBeGreaterThan(0);
    expect(f.y).toBeGreaterThan(yLow);
  });

  it('climbing costs speed and extra lift', () => {
    const a = new KiteFlight(baseMods());
    const b = new KiteFlight(baseMods());
    run(a, 3, 0, 0);
    run(b, 3, 0, 1);
    expect(b.y).toBeGreaterThan(a.y + 10);
    expect(b.speed).toBeLessThan(a.speed);
    expect(b.lift).toBeLessThan(a.lift);
  });

  it('banking turns the kite toward the steer direction', () => {
    const f = new KiteFlight(baseMods());
    run(f, 1, 1, 0);
    expect(f.bank).toBeGreaterThan(0.5);
    expect(f.yaw).toBeGreaterThan(0.2);
    expect(f.x).toBeLessThan(-1); // right = -X (camera looks down +Z)
    run(f, 2, -1, 0);
    expect(f.bank).toBeLessThan(0);
  });

  it('heading stays inside the corridor limit', () => {
    const f = new KiteFlight(baseMods());
    run(f, 10, 1, 0);
    expect(f.yaw).toBeLessThan((FLIGHT.maxHeading + 3) * (Math.PI / 180));
  });

  it('lift drains over time; once empty the kite sinks and cannot climb', () => {
    const f = new KiteFlight(baseMods());
    const l0 = f.lift;
    run(f, 2);
    expect(f.lift).toBeLessThan(l0);
    f.lift = 0;
    const y0 = f.y;
    run(f, 2, 0, 1);
    expect(f.pitch).toBeLessThan(0);
    expect(f.y).toBeLessThan(y0 - 5);
  });

  it('lift capacity and drain follow the mods', () => {
    const m = baseMods();
    m.liftCapMul = 1.5;
    m.drainMul = 0.5;
    const f = new KiteFlight(m);
    expect(f.maxLift).toBe(150);
    const base = new KiteFlight(baseMods());
    run(f, 5);
    run(base, 5);
    expect(f.maxLift - f.lift).toBeLessThan(base.maxLift - base.lift);
  });

  it('is deterministic for the same input sequence', () => {
    const a = new KiteFlight(baseMods());
    const b = new KiteFlight(baseMods());
    for (let i = 0; i < 300; i++) {
      const inp = { steerX: Math.sin(i * 0.05), steerY: Math.cos(i * 0.03), dive: i % 90 < 30 };
      a.step(DT, inp);
      b.step(DT, inp);
    }
    expect(a.x).toBe(b.x);
    expect(a.y).toBe(b.y);
    expect(a.z).toBe(b.z);
  });
});
