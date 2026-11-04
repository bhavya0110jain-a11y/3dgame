import type { RunState } from '../game/RunState';
import type { SaveData } from '../core/Save';

/** Everything an achievement condition may read. Built by src/game/Achievements.ts. */
export interface AchievementContext {
  run: RunState;
  save: SaveData;
  /** Lifetime counters INCLUDING the current run (e.g. life('kills')). */
  life: (key: string) => number;
  /** Tracker flags raised by events this run (e.g. 'close_call'). */
  flags: ReadonlySet<string>;
  /** True only on the end-of-run evaluation. */
  ended: boolean;
}

export interface AchievementReward {
  /** Pushed to save.unlocked (weapon `w_*`, relic `r_*`, character `char_*` ids). */
  unlock?: string;
  /** Ash granted once. */
  ash?: number;
  /** Player-facing text, e.g. "Unlocks the Moth Lantern". */
  label: string;
}

export interface AchievementDef {
  id: string;
  name: string;
  description: string;
  icon: string;
  reward?: AchievementReward;
  /** Hidden until earned (shown as ??? in the list). */
  secret?: boolean;
  check: (c: AchievementContext) => boolean;
}

const k = (c: AchievementContext, src: string) => c.run.killsBySource.get(src) ?? 0;
const metaRanks = (s: SaveData) => Object.values(s.meta).reduce((a, b) => a + b, 0);

/**
 * Ordered roughly by when a typical player earns them: rewards are paced so something new unlocks on each of the
 * first ~6 runs, then every few runs after (see design/gdd/progression.md).
 */
export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'ach_first_vigil', name: 'First Vigil', icon: 'wick', description: 'Finish your first vigil.',
    reward: { ash: 40, label: '+40 Ash' }, check: (c) => c.ended },
  { id: 'ach_survive_5', name: 'Five Minutes of Light', icon: 'timer', description: 'Survive 5:00 in a single vigil.',
    reward: { unlock: 'w_moth', label: 'Unlocks the Moth Lantern weapon' }, check: (c) => c.run.elapsed >= 300 },
  { id: 'ach_kills_500', name: 'Shadowbane', icon: 'skull', description: 'Banish 500 shadows in a single vigil.',
    reward: { ash: 60, label: '+60 Ash' }, check: (c) => c.run.kills >= 500 },
  { id: 'ach_level_20', name: 'Kindled Soul', icon: 'star', description: 'Reach level 20 in a single vigil.',
    reward: { unlock: 'r_hourglass', label: 'Unlocks the Dusk Hourglass relic' }, check: (c) => c.run.level >= 20 },
  { id: 'ach_survive_10', name: 'Deep Night', icon: 'timer', description: 'Survive 10:00 in a single vigil.',
    reward: { unlock: 'char_warden', label: 'Osric the Warden joins for free' }, check: (c) => c.run.elapsed >= 600 },
  { id: 'ach_kills_1000', name: 'Thousand Shadows', icon: 'skull', description: 'Banish 1,000 shadows in a single vigil.',
    reward: { unlock: 'w_bell', label: 'Unlocks the Vesper Bell weapon' }, check: (c) => c.run.kills >= 1000 },
  { id: 'ach_evolve', name: 'Transmutation', icon: 'nova', description: 'Evolve a weapon in a reliquary.',
    reward: { unlock: 'w_beam', label: 'Unlocks the Lighthouse Beam weapon' }, check: (c) => c.run.evolutions.length >= 1 },
  { id: 'ach_elites', name: 'Elite Hunter', icon: 'armor', description: 'Defeat 4 elites in a single vigil.',
    reward: { ash: 80, label: '+80 Ash' }, check: (c) => c.run.elitesKilled >= 4 },
  { id: 'ach_full_kit', name: 'Full Lantern', icon: 'halo', description: 'Carry 6 weapons at once.',
    reward: { ash: 80, label: '+80 Ash' }, check: (c) => c.run.weapons.length >= 6 },
  { id: 'ach_relics', name: 'Reliquarian', icon: 'tome', description: 'Carry 6 relics at once.',
    reward: { ash: 80, label: '+80 Ash' }, check: (c) => c.run.passives.size >= 6 },
  { id: 'ach_close_call', name: "Ember's Breath", icon: 'oil', description: 'Fall below 10% light, then refill your lantern completely.',
    reward: { ash: 60, label: '+60 Ash' }, check: (c) => c.flags.has('close_call') },
  { id: 'ach_untouched', name: 'Unscathed', icon: 'boots', description: 'Reach 3:00 without taking any damage.',
    reward: { ash: 100, label: '+100 Ash' }, check: (c) => c.run.elapsed >= 180 && c.run.damageTaken <= 0 },
  { id: 'ach_chain', name: 'Chain Reaction', icon: 'fire', description: 'Kill 25 shadows with Cinder Tick blasts in one vigil.',
    reward: { ash: 80, label: '+80 Ash' }, check: (c) => k(c, 'blast') >= 25 },
  { id: 'ach_toll', name: 'Bellringer', icon: 'bell', description: 'Banish 300 shadows with the Vesper Bell in one vigil.',
    reward: { unlock: 'char_bell', label: 'Pell the Bellwright joins for free' }, check: (c) => k(c, 'vesper_bell') + k(c, 'cathedral_toll') >= 300 },
  { id: 'ach_dawn', name: 'Dawn Keeper', icon: 'star', description: 'Defeat the Hollow Stag.',
    reward: { unlock: 'r_mirror', label: 'Unlocks the Moon Mirror relic' }, check: (c) => (c.run.killsByEnemy.get('boss_hollow_stag') ?? 0) > 0 },
  { id: 'ach_evolve_2', name: 'Twin Miracles', icon: 'twin', description: 'Evolve two weapons in a single vigil.',
    reward: { ash: 200, label: '+200 Ash' }, check: (c) => c.run.evolutions.length >= 2 },
  { id: 'ach_wardbreaker', name: 'Wardbreaker', icon: 'armor', description: 'Banish 50 Hollow Wardens across all vigils.',
    reward: { ash: 120, label: '+120 Ash' }, check: (c) => c.life('kill:hollow_warden') >= 50 },
  { id: 'ach_marsh', name: 'Mire Drainer', icon: 'frost', description: 'Defeat the Mire Mother.',
    reward: { ash: 300, label: '+300 Ash' }, check: (c) => (c.run.killsByEnemy.get('boss_mire_mother') ?? 0) > 0 },
  { id: 'ach_endless', name: 'Endless Night', icon: 'timer', description: 'Survive 5:00 of the endless night after a boss falls.',
    reward: { ash: 250, label: '+250 Ash' }, check: (c) => c.run.endlessTime >= 300 },
  { id: 'ach_legend', name: "Lamplighter's Legend", icon: 'skull', description: 'Banish 25,000 shadows across all vigils.',
    reward: { ash: 300, label: '+300 Ash' }, check: (c) => c.life('kills') >= 25000 },
  { id: 'ach_hearth', name: 'Hearthkeeper', icon: 'ash', description: 'Buy 20 ranks at the Hearth.',
    check: (c) => metaRanks(c.save) >= 20 },
  { id: 'ach_faithful', name: 'Faithful', icon: 'revive', description: 'Finish 15 vigils.',
    reward: { ash: 150, label: '+150 Ash' }, check: (c) => c.ended && c.save.runs >= 15 },
  { id: 'ach_ruins', name: 'Kingslayer', icon: 'flint', description: 'Defeat the Ashen King.', secret: true,
    reward: { ash: 500, label: '+500 Ash' }, check: (c) => (c.run.killsByEnemy.get('boss_ashen_king') ?? 0) > 0 },
  { id: 'ach_absurd', name: 'Absurd Light', icon: 'nova', description: 'Face 330 shadows at once and survive to 12:00.', secret: true,
    reward: { ash: 150, label: '+150 Ash' }, check: (c) => c.run.peakEnemies >= 330 && c.run.elapsed >= 720 },
];

export function getAchievement(id: string): AchievementDef | undefined {
  return ACHIEVEMENTS.find((a) => a.id === id);
}
