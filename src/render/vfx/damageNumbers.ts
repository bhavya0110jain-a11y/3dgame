/**
 * Damage-number setting (art review s3 #12). Saves from before sprint 3 store a boolean; the settings screen now
 * offers 'all' | 'crits' | 'off'. Both forms are accepted everywhere.
 */
export type DamageNumbersSetting = boolean | 'all' | 'crits' | 'off';

/** Normalises a stored setting: true/unknown → 'all', false → 'off'. */
export function damageNumbersMode(s: DamageNumbersSetting | string | null | undefined): 'all' | 'crits' | 'off' {
  if (s === false || s === 'off') return 'off';
  if (s === 'crits') return 'crits';
  return 'all';
}

/**
 * Whether a hit shows a number: crits whenever numbers are not off; other hits only with 'all' and while the crowd
 * is at most `crowdMax` live enemies.
 */
export function showDamageNumber(s: DamageNumbersSetting | string | null | undefined, crit: boolean, activeCount: number, crowdMax: number): boolean {
  const m = damageNumbersMode(s);
  if (m === 'off') return false;
  return crit || (m === 'all' && activeCount <= crowdMax);
}
