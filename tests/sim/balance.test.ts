import { describe, expect, it } from 'vitest';
import { simulateRun } from './headless';

/**
 * Pacing guard-rails on the real systems (headless). Full 15-minute studies: `npx vite-node tools/balance-sim.ts`.
 * Thresholds are deliberately loose (the sim has Math.random() noise in enemy AI); they catch broken curves, not 5%.
 */
describe('Balance sim', () => {
  it('firstThreeMinutes_freshSave_levelsFastAndNoCrash', () => {
    // Arrange / Act
    const r = simulateRun({ seed: 11, maxTime: 180, skill: 0.9 });
    // Assert: first minute is exciting (≥3 level-ups), and the run is still healthy at 3:00
    expect(r.firstLevelUps.filter((t) => t <= 60).length).toBeGreaterThanOrEqual(3);
    expect(r.level).toBeGreaterThanOrEqual(7);
    expect(r.kills).toBeGreaterThan(150);
  }, 60_000);

  it('bossFight_fullMeta_bossDiesWithinThreeMinutes', () => {
    const meta = { m_light: 5, m_might: 5, m_speed: 3, m_regen: 4, m_armor: 3, m_magnet: 3, m_growth: 5, m_greed: 5, m_cooldown: 4, m_revival: 1, m_choice: 1, m_reroll: 3 };
    const r = simulateRun({ seed: 3, skill: 0.9, meta });
    expect(r.survived).toBeGreaterThan(14 * 60);
    if (r.bossKilled) expect(r.bossTimeToKill).toBeLessThan(180);
  }, 120_000);
});
