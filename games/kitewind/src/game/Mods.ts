import type { KiteDef } from '../data/kites';

/**
 * Effective run modifiers: kite stats x meta upgrades x boons. Pure data — the flight model,
 * scoring and world sim read these, never the source tables.
 */
export interface Mods {
  liftCapMul: number;
  drainMul: number;
  turnMul: number;
  speedMul: number;
  diveMul: number;
  pullUpMul: number;
  magnet: number;
  ringRadiusMul: number;
  /** Ring centre pull strength (m/s of lateral correction near a ring). */
  ringPull: number;
  comboWindowAdd: number;
  glimmerMul: number;
  updraftMul: number;
  whiskerRangeMul: number;
  whiskerPointsMul: number;
  ringBoostMul: number;
  ringLiftAdd: number;
  secondWind: number;
  shields: number;
}

export function baseMods(): Mods {
  return {
    liftCapMul: 1, drainMul: 1, turnMul: 1, speedMul: 1, diveMul: 1, pullUpMul: 1, magnet: 2.2,
    ringRadiusMul: 1, ringPull: 0, comboWindowAdd: 0, glimmerMul: 1, updraftMul: 1,
    whiskerRangeMul: 1, whiskerPointsMul: 1, ringBoostMul: 1, ringLiftAdd: 0, secondWind: 0, shields: 0,
  };
}

/** Builds run-start mods from the chosen kite and purchased meta ranks. */
export function buildMods(kite: KiteDef, meta: Record<string, number>): Mods {
  const m = baseMods();
  const r = (id: string): number => Math.max(0, Math.floor(meta[id] ?? 0));
  m.liftCapMul = kite.lift * (1 + 0.1 * r('lift_capacity'));
  m.drainMul = kite.drain * Math.pow(0.94, r('lift_drain'));
  m.turnMul = kite.turn;
  m.speedMul = kite.speed;
  m.diveMul = kite.dive * (1 + 0.12 * r('dive_control'));
  m.pullUpMul = 1 + 0.15 * r('dive_control');
  m.magnet = kite.magnet + r('glimmer_sense');
  m.ringPull = 2.2 * r('ring_pull');
  m.shields = kite.shields + r('start_shield');
  return m;
}

/** Applies one stack of a boon to the mods (mutates). Returns the extra shields granted (for HUD feedback). */
export function applyBoon(m: Mods, id: string): void {
  switch (id) {
    case 'magnet': m.magnet += 6; break;
    case 'wide_rings': m.ringRadiusMul *= 1.3; break;
    case 'long_combo': m.comboWindowAdd += 1.6; break;
    case 'shield': m.shields += 1; break;
    case 'slow_drain': m.drainMul *= 0.75; break;
    case 'glimmer_x2': m.glimmerMul *= 2; break;
    case 'updraft': m.updraftMul *= 1.6; break;
    case 'whisker': m.whiskerRangeMul *= 1.6; m.whiskerPointsMul *= 2; break;
    case 'surge': m.ringBoostMul *= 1.5; m.ringLiftAdd += 4; break;
    case 'second_wind': m.secondWind += 1; break;
  }
}
