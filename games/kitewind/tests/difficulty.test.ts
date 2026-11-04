import { describe, it, expect } from 'vitest';
import { SKILLS, flyRun, median, type BotResult } from '../tools/balance/bot';

/**
 * Difficulty-curve guard (feel/balance pass). A human-like bot (tools/balance/bot.ts) flies fixed seeds with a fresh
 * save; the target is that a first-time player (`novice`) reaches ~1500–2500 m, and better play goes clearly further.
 * BOT_REPORT=1 npx vitest run tests/difficulty.test.ts prints the per-run table.
 */
const SEEDS = [11, 202, 3003, 40004, 505, 6606, 77, 8128, 919, 1010, 31337, 4242];

function fly(skill: keyof typeof SKILLS, seeds = SEEDS): BotResult[] {
  return seeds.map((s) => flyRun(SKILLS[skill], s, 480));
}

function report(name: string, rs: BotResult[]): void {
  if (!process.env.BOT_REPORT) return;
  const causes: Record<string, number> = {};
  for (const r of rs) causes[r.cause] = (causes[r.cause] ?? 0) + 1;
  console.log(`\n== ${name}: median ${median(rs.map((r) => r.distance))} m, median time ${median(rs.map((r) => r.time))} s, median glimmers ${median(rs.map((r) => r.glimmers))}`);
  console.log('   causes', JSON.stringify(causes));
  for (const r of rs) console.log(`   seed ${String(r.seed).padStart(6)}  ${String(r.distance).padStart(5)} m  ${String(r.time).padStart(4)} s  score ${String(r.score).padStart(6)}  rings ${String(r.rings).padStart(3)}  combo ${String(r.bestCombo).padStart(3)}  minLift ${r.minLift}  ${r.cause}`);
}

describe('difficulty curve (human-like bot)', () => {
  it('a novice reaches roughly 1500–2500 m on a first run (median over seeds)', () => {
    const rs = fly('novice');
    report('novice', rs);
    const med = median(rs.map((r) => r.distance));
    expect(med).toBeGreaterThan(1200);
    expect(med).toBeLessThan(3000);
    // nobody should die in the calm onboarding stretch
    expect(Math.min(...rs.map((r) => r.distance))).toBeGreaterThan(350);
  }, 120_000);

  it('skill is rewarded: average and skilled bots fly further than the novice', () => {
    const seeds = SEEDS.slice(0, 8);
    const nov = median(fly('novice', seeds).map((r) => r.distance));
    const avgR = fly('average', seeds);
    const sk = fly('skilled', seeds);
    report('average', avgR);
    report('skilled', sk);
    const avg = median(avgR.map((r) => r.distance));
    expect(avg).toBeGreaterThan(nov);
    expect(median(sk.map((r) => r.distance))).toBeGreaterThan(avg);
  }, 180_000);
});
