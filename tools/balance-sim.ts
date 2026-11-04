/**
 * Balance simulation. Usage:
 *   npx vite-node tools/balance-sim.ts              # 3 seeds, fresh save, Wren, Pines
 *   npx vite-node tools/balance-sim.ts meta         # + Ash economy: greedy Hearth buyer over many runs (analytic)
 *   SEEDS=5 SKILL=0.9 META=full npx vite-node tools/balance-sim.ts
 */
import { simulateRun, type SimResult } from '../tests/sim/headless';
import { META_UPGRADES, CHARACTERS } from '../src/data/meta';

const seeds = Number(process.env.SEEDS ?? 3);
const skill = Number(process.env.SKILL ?? 0.8);
const biome = process.env.BIOME ?? 'biome_pines';
const character = process.env.CHAR ?? 'char_keeper';
const fullMeta: Record<string, number> = {};
for (const m of META_UPGRADES) fullMeta[m.id] = m.maxRank;
const halfMeta: Record<string, number> = {};
for (const m of META_UPGRADES) halfMeta[m.id] = Math.floor(m.maxRank / 2);
const meta = process.env.META === 'full' ? fullMeta : process.env.META === 'half' ? halfMeta : {};
const unlocked = ['w_moth', 'w_bell', 'w_beam', 'r_mirror', 'r_hourglass'].filter(() => process.env.UNLOCK === 'all');

function fmt(r: SimResult): string {
  const lines = [
    `survived ${Math.floor(r.survived / 60)}:${String(r.survived % 60).padStart(2, '0')} ${r.died ? 'DIED' : ''}${r.bossKilled ? ` BOSS KILLED in ${r.bossTimeToKill}s` : ''}`,
    `level ${r.level} kills ${r.kills} chests ${r.chests} evolutions [${r.evolutions.join(', ')}] ash ${r.ash} (pickups ${r.ashEarned})`,
    `first level-ups at: ${r.firstLevelUps.join(', ')}s  | damage taken: melee/blast/hazard ${r.taken.melee}, projectiles ${r.taken.projectiles}`,
    `weapons: ${r.weapons.join(' ')}`,
    `dmg: ${r.damageBySource.slice(0, 8).map(([k, v]) => `${k}=${v}`).join(' ')}`,
    `achievements: ${r.achievements.join(', ')}`,
    'min | lvl | kills | alive | light | dps    | hpMul',
    ...r.samples.map((s) => `${String(s.minute).padStart(3)} | ${String(s.level).padStart(3)} | ${String(s.kills).padStart(5)} | ${String(s.alive).padStart(5)} | ${String(s.light).padStart(5)} | ${String(s.dps).padStart(6)} | ${s.hpMul}`),
  ];
  return lines.join('\n');
}

const t0 = Date.now();
const results: SimResult[] = [];
for (let i = 0; i < seeds; i++) {
  const r = simulateRun({ seed: 1000 + i * 7919, biome, character, meta, skill, unlocked });
  results.push(r);
  console.log(`\n=== seed ${i} (${biome}, ${character}, meta=${process.env.META ?? 'none'}, skill=${skill}) ===`);
  console.log(fmt(r));
}
const avg = (f: (r: SimResult) => number) => (results.reduce((a, r) => a + f(r), 0) / results.length).toFixed(1);
console.log(`\nAVG survived ${avg((r) => r.survived)}s level ${avg((r) => r.level)} kills ${avg((r) => r.kills)} ash ${avg((r) => r.ash)} bossKills ${results.filter((r) => r.bossKilled).length}/${results.length}  (${((Date.now() - t0) / 1000).toFixed(1)}s wall)`);

if (process.argv.includes('meta')) {
  // Economy: survival time grows with meta power. Model run ash from the fresh/half/full sim anchors and buy greedily.
  const anchors: { power: number; ash: number }[] = [];
  for (const [label, m] of [['none', {}], ['half', halfMeta], ['full', fullMeta]] as const) {
    const rs = [0, 1, 2, 3, 4].map((i) => simulateRun({ seed: 50 + i * 31, biome, meta: m as Record<string, number>, skill }));
    const a = rs.reduce((s, r) => s + r.ash, 0) / rs.length;
    anchors.push({ power: label === 'none' ? 0 : label === 'half' ? 0.5 : 1, ash: a });
    console.log(`meta=${label}: avg ash/run ${a.toFixed(0)}, survived ${rs.map((r) => r.survived).join('/')}s, boss ${rs.filter((r) => r.bossKilled).length}/${rs.length}`);
  }
  const totalCost = META_UPGRADES.reduce((s, m) => s + Array.from({ length: m.maxRank }, (_, r) => m.cost(r)).reduce((a, b) => a + b, 0), 0);
  const charCost = CHARACTERS.reduce((s, c) => s + c.unlockCost, 0);
  const ranks: Record<string, number> = {};
  let bank = 0;
  let spent = 0;
  let firstBuy = -1;
  let fullAt = -1;
  const maxRanks = META_UPGRADES.reduce((s, m) => s + m.maxRank, 0);
  for (let run = 1; run <= 80; run++) {
    const power = Object.values(ranks).reduce((a, b) => a + b, 0) / maxRanks;
    const ash = power < 0.5 ? anchors[0].ash + (anchors[1].ash - anchors[0].ash) * (power / 0.5) : anchors[1].ash + (anchors[2].ash - anchors[1].ash) * ((power - 0.5) / 0.5);
    bank += ash;
    for (;;) {
      const opts = META_UPGRADES.filter((m) => (ranks[m.id] ?? 0) < m.maxRank).map((m) => ({ m, cost: m.cost(ranks[m.id] ?? 0) })).sort((a, b) => a.cost - b.cost);
      if (!opts.length || opts[0].cost > bank) break;
      bank -= opts[0].cost;
      spent += opts[0].cost;
      ranks[opts[0].m.id] = (ranks[opts[0].m.id] ?? 0) + 1;
      if (firstBuy < 0) firstBuy = run;
    }
    if (fullAt < 0 && spent >= totalCost) fullAt = run;
  }
  console.log(`Hearth total ${totalCost} Ash (+ bearers ${charCost}). First purchase after run ${firstBuy}. Hearth complete after run ${fullAt} (target 25-40).`);
}
