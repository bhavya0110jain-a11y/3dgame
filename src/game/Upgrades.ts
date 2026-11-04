import { WEAPONS, getWeapon } from '../data/weapons';
import { PASSIVES } from '../data/passives';
import type { GameContext } from './types';

export type UpgradeChoice =
  | { kind: 'weapon-new'; id: string; name: string; description: string; icon: string; level: number }
  | { kind: 'weapon-up'; id: string; name: string; description: string; icon: string; level: number }
  | { kind: 'passive'; id: string; name: string; description: string; icon: string; level: number }
  | { kind: 'heal'; id: string; name: string; description: string; icon: string; level: number }
  | { kind: 'ash'; id: string; name: string; description: string; icon: string; level: number };

export function rollChoices(ctx: GameContext, n = 3, banned: Set<string> = new Set()): UpgradeChoice[] {
  const run = ctx.run;
  const pool: { c: UpgradeChoice; w: number }[] = [];
  const unlocked = new Set(ctx.save.unlocked);

  for (const w of run.weapons) {
    if (w.level < w.def.maxLevel && !banned.has(w.def.id)) {
      pool.push({
        c: { kind: 'weapon-up', id: w.def.id, name: w.def.name, description: w.def.levelText[w.level - 1] ?? 'Upgrade', icon: w.def.icon, level: w.level + 1 },
        w: 10,
      });
    }
  }
  if (run.weapons.length < run.maxWeapons) {
    for (const def of WEAPONS) {
      if (def.hidden || banned.has(def.id)) continue;
      if (def.unlock && !unlocked.has(def.unlock)) continue;
      if (run.weapons.some((w) => w.def.id === def.id)) continue;
      pool.push({ c: { kind: 'weapon-new', id: def.id, name: def.name, description: def.description, icon: def.icon, level: 1 }, w: 7 });
    }
  }
  const passiveCount = run.passives.size;
  for (const p of PASSIVES) {
    if (banned.has(p.id)) continue;
    if (p.unlock && !unlocked.has(p.unlock)) continue;
    const lvl = run.passives.get(p.id) ?? 0;
    if (lvl >= p.maxLevel) continue;
    if (lvl === 0 && passiveCount >= run.maxPassives) continue;
    pool.push({ c: { kind: 'passive', id: p.id, name: p.name, description: p.description, icon: p.icon, level: lvl + 1 }, w: lvl > 0 ? 8 : 6 });
  }

  const out: UpgradeChoice[] = [];
  while (out.length < n && pool.length) {
    const pick = ctx.rng.weighted(pool, (x) => x.w);
    out.push(pick.c);
    pool.splice(pool.indexOf(pick), 1);
  }
  // Fallbacks when everything is maxed
  if (out.length === 0) {
    out.push({ kind: 'heal', id: 'heal', name: 'Kindling', description: 'Restore 50% of your light.', icon: 'oil', level: 0 });
    out.push({ kind: 'ash', id: 'ash', name: 'Ash Cache', description: '+25 Ash.', icon: 'ash', level: 0 });
  }
  return out;
}

export function applyChoice(ctx: GameContext, c: UpgradeChoice): void {
  const run = ctx.run;
  switch (c.kind) {
    case 'weapon-new': {
      const def = getWeapon(c.id);
      if (!def) return;
      run.weapons.push(def.create(ctx));
      break;
    }
    case 'weapon-up': {
      const w = run.weapons.find((x) => x.def.id === c.id);
      if (w) {
        w.level++;
        w.onLevelUp?.(ctx);
      }
      break;
    }
    case 'passive': {
      const p = PASSIVES.find((x) => x.id === c.id);
      if (!p) return;
      run.passives.set(p.id, (run.passives.get(p.id) ?? 0) + 1);
      const before = run.stats.maxLight;
      p.apply(run.stats);
      // extra max light also fills the lantern
      if (run.stats.maxLight > before) ctx.player.lightValue += run.stats.maxLight - before;
      break;
    }
    case 'heal':
      ctx.player.heal(run.stats.maxLight * 0.5, ctx);
      break;
    case 'ash':
      run.ashEarned += 25;
      break;
  }
}
