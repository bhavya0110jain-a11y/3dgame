/** Permanent meta upgrades bought with glimmers between runs. Effects are applied in src/game/Mods.ts. */
export interface UpgradeDef {
  id: string;
  name: string;
  desc: string;
  icon: string;
  maxRank: number;
  /** Cost of rank n+1 = round(base * growth^n). */
  base: number;
  growth: number;
}

export const UPGRADES: readonly UpgradeDef[] = [
  { id: 'lift_capacity', name: 'Deep Breath', desc: '+10% lift capacity per rank', icon: '◈', maxRank: 5, base: 40, growth: 1.7 },
  { id: 'lift_drain', name: 'Patient Wings', desc: '-6% lift drain per rank', icon: '❖', maxRank: 5, base: 50, growth: 1.7 },
  { id: 'ring_pull', name: 'Ring Pull', desc: 'Rings gently pull you to their centre', icon: '◎', maxRank: 4, base: 60, growth: 1.8 },
  { id: 'start_shield', name: 'Paper Charm', desc: 'Start each run with +1 shield charm', icon: '✦', maxRank: 2, base: 150, growth: 2.4 },
  { id: 'dive_control', name: 'Dive Control', desc: '+12% dive power and faster pull-up', icon: '➹', maxRank: 4, base: 45, growth: 1.75 },
  { id: 'glimmer_sense', name: 'Glimmer Sense', desc: '+1 m glimmer magnet radius', icon: '✧', maxRank: 4, base: 35, growth: 1.65 },
];

export const upgradeById = (id: string): UpgradeDef | undefined => UPGRADES.find((u) => u.id === id);

/** Glimmer cost of the next rank, or Infinity at max rank. */
export function upgradeCost(def: UpgradeDef, rank: number): number {
  if (rank >= def.maxRank) return Infinity;
  return Math.round(def.base * Math.pow(def.growth, rank));
}
