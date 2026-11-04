import { WEAPONS, getWeapon } from '../data/weapons';
import { PASSIVES } from '../data/passives';
import type { GameContext, WeaponDef, WeaponInstance } from './types';

export type UpgradeKind = 'weapon-new' | 'weapon-up' | 'passive' | 'heal' | 'ash' | 'evolution' | 'special';

export interface UpgradeChoice {
  kind: UpgradeKind;
  id: string;
  name: string;
  description: string;
  icon: string;
  level: number;
  /** Evolution: the base weapon id being replaced. */
  from?: string;
}

const passiveName = (id: string) => PASSIVES.find((p) => p.id === id)?.name ?? id;
const weaponName = (id: string) => getWeapon(id)?.name ?? id;

function isUnlocked(ctx: GameContext, unlock: string | undefined): boolean {
  return !unlock || ctx.save.unlocked.includes(unlock);
}

/** Weapons in this run that are max level AND have their paired relic: ready to evolve in the next reliquary. */
export function evolutionCandidates(ctx: GameContext): { weapon: WeaponInstance; into: WeaponDef }[] {
  const out: { weapon: WeaponInstance; into: WeaponDef }[] = [];
  for (const w of ctx.run.weapons) {
    const d = w.def;
    if (!d.evolvesInto || !d.evolvesWith) continue;
    if (w.level < d.maxLevel) continue;
    if (!ctx.run.passives.has(d.evolvesWith)) continue;
    const into = getWeapon(d.evolvesInto);
    if (into && !ctx.run.weapons.some((x) => x.def.id === into.id)) out.push({ weapon: w, into });
  }
  return out;
}

/** Replaces a weapon with its evolution in the same slot. Returns the new instance. */
export function evolveWeapon(ctx: GameContext, w: WeaponInstance, into: WeaponDef): WeaponInstance {
  const run = ctx.run;
  const i = run.weapons.indexOf(w);
  w.dispose(ctx);
  const inst = into.create(ctx);
  if (i >= 0) run.weapons[i] = inst;
  else run.weapons.push(inst);
  run.evolutions.push(into.id);
  // keep damage credit readable: the base weapon's damage stays under its own id; evolution gets a new line
  ctx.events.emit('weapon:evolved', { from: w.def.id, to: into.id, name: into.name });
  return inst;
}

function evolutionHint(def: WeaponDef): string {
  return def.evolvesWith && def.evolvesInto ? ` <i class="evo-hint">Evolves with ${passiveName(def.evolvesWith)}.</i>` : '';
}

/**
 * Rolls `n` level-up choices. Weights: owned weapon upgrades 10, owned relic upgrades 8, new relics 6, new weapons 7.
 * A relic that would complete an evolution recipe (paired weapon at max level) gets ×2.5 weight so recipes surface.
 */
export function rollChoices(ctx: GameContext, n = 3, banned: Set<string> = new Set()): UpgradeChoice[] {
  const run = ctx.run;
  const pool: { c: UpgradeChoice; w: number }[] = [];
  const isBanned = (id: string) => banned.has(id) || run.banished.has(id);

  for (const w of run.weapons) {
    if (w.level < w.def.maxLevel && !isBanned(w.def.id)) {
      const last = w.level + 1 === w.def.maxLevel;
      pool.push({
        c: {
          kind: 'weapon-up', id: w.def.id, name: w.def.name, icon: w.def.icon, level: w.level + 1,
          description: (w.def.levelText[w.level - 1] ?? 'Upgrade') + (last ? evolutionHint(w.def).replace('Evolves', 'MAX — evolves') : ''),
        },
        // early game: favour levelling what you have so builds come online
        w: 10 + (run.weapons.length <= 2 ? 3 : 0),
      });
    }
  }
  if (run.weapons.length < run.maxWeapons) {
    for (const def of WEAPONS) {
      if (def.hidden || isBanned(def.id)) continue;
      if (!isUnlocked(ctx, def.unlock)) continue;
      if (run.weapons.some((w) => w.def.id === def.id || w.def.id === def.evolvesInto)) continue;
      // first two minutes: new weapons come up more so the first build decision is exciting
      const w = run.elapsed < 120 && run.weapons.length < 3 ? 11 : 7;
      pool.push({ c: { kind: 'weapon-new', id: def.id, name: def.name, description: def.description + evolutionHint(def), icon: def.icon, level: 1 }, w });
    }
  }
  const passiveCount = run.passives.size;
  for (const p of PASSIVES) {
    if (isBanned(p.id)) continue;
    if (!isUnlocked(ctx, p.unlock)) continue;
    const lvl = run.passives.get(p.id) ?? 0;
    if (lvl >= p.maxLevel) continue;
    if (lvl === 0 && passiveCount >= run.maxPassives) continue;
    let w = lvl > 0 ? 8 : 6;
    let desc = p.description;
    const pairs = run.weapons.filter((x) => x.def.evolvesWith === p.id);
    if (pairs.length) {
      if (lvl === 0) desc += ` <i class="evo-hint">Evolves ${pairs.map((x) => x.def.name).join(', ')}.</i>`;
      if (lvl === 0 && pairs.some((x) => x.level >= x.def.maxLevel)) w *= 2.5;
    }
    pool.push({ c: { kind: 'passive', id: p.id, name: p.name, description: desc, icon: p.icon, level: lvl + 1 }, w });
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

/**
 * Reliquary contents. If any weapon can evolve, the evolution is ALWAYS the first item (that is the chest's job).
 * Then 0-2 extra upgrades of things you already own (never new weapons — chests deepen builds, level-ups widen them).
 */
export function rollChest(ctx: GameContext): UpgradeChoice[] {
  const run = ctx.run;
  const out: UpgradeChoice[] = [];
  const evo = evolutionCandidates(ctx);
  if (evo.length) {
    const pick = evo[Math.floor(ctx.rng.next() * evo.length)];
    out.push({ kind: 'evolution', id: pick.into.id, from: pick.weapon.def.id, name: pick.into.name, description: pick.into.description, icon: pick.into.icon, level: 1 });
  }
  const luck = run.stats.luck;
  const extra = evo.length ? (ctx.rng.chance(0.25 * luck) ? 1 : 0) : ctx.rng.chance(0.15 * luck) ? 3 : ctx.rng.chance(0.45) ? 2 : 1;
  // simulate sequential picks so the same weapon can be levelled twice in one chest
  const taken = new Map<string, number>();
  for (let i = 0; i < extra; i++) {
    const owned: UpgradeChoice[] = [];
    for (const w of run.weapons) {
      const lvl = w.level + (taken.get(w.def.id) ?? 0);
      if (lvl < w.def.maxLevel) owned.push({ kind: 'weapon-up', id: w.def.id, name: w.def.name, description: w.def.levelText[lvl - 1] ?? 'Upgrade', icon: w.def.icon, level: lvl + 1 });
    }
    for (const [id, lv0] of run.passives) {
      const p = PASSIVES.find((x) => x.id === id);
      const lvl = lv0 + (taken.get(id) ?? 0);
      if (p && lvl < p.maxLevel) owned.push({ kind: 'passive', id, name: p.name, description: p.description, icon: p.icon, level: lvl + 1 });
    }
    if (!owned.length) break;
    const c = ctx.rng.pick(owned);
    taken.set(c.id, (taken.get(c.id) ?? 0) + 1);
    out.push(c);
  }
  if (!out.length) out.push({ kind: 'ash', id: 'ash', name: 'Ash Cache', description: '+25 Ash.', icon: 'ash', level: 0 });
  return out;
}

export function applyChoice(ctx: GameContext, c: UpgradeChoice): void {
  const run = ctx.run;
  switch (c.kind) {
    case 'weapon-new': {
      const def = getWeapon(c.id);
      if (!def || run.weapons.length >= run.maxWeapons) return;
      run.weapons.push(def.create(ctx));
      break;
    }
    case 'weapon-up': {
      const w = run.weapons.find((x) => x.def.id === c.id);
      if (w && w.level < w.def.maxLevel) {
        w.level++;
        w.onLevelUp?.(ctx);
      }
      break;
    }
    case 'passive': {
      const p = PASSIVES.find((x) => x.id === c.id);
      if (!p) return;
      const lvl = run.passives.get(p.id) ?? 0;
      if (lvl >= p.maxLevel) return;
      run.passives.set(p.id, lvl + 1);
      const before = run.stats.maxLight;
      p.apply(run.stats);
      // extra max light also fills the lantern
      if (run.stats.maxLight > before) ctx.player.lightValue += run.stats.maxLight - before;
      break;
    }
    case 'evolution': {
      const w = run.weapons.find((x) => x.def.id === c.from);
      const into = getWeapon(c.id);
      if (w && into) evolveWeapon(ctx, w, into);
      break;
    }
    case 'heal':
      ctx.player.heal(run.stats.maxLight * 0.5, ctx);
      break;
    case 'ash':
      run.ashEarned += 25;
      break;
    case 'special':
      break; // handled by Game (dawn / endless choice)
  }
}

export { weaponName };
