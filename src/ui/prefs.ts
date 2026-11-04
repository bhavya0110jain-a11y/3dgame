import type { SaveData } from '../core/Save';

/**
 * UI / accessibility preferences. Stored inside `save.settings` (Save.loadSave() spreads unknown keys through, so
 * these persist without a Save schema change). Other systems may read them via `game.save.settings`:
 *   reducedFlashing  – suppress strobing / pulsing effects (renderer damage pulse may honour it too)
 *   colorBlind       – colour-blind friendly highlight palette (UI)
 *   reducedMotion    – minimise UI motion (card fly-ins, embers, bounces)
 *   uiScale          – 0.85..1.3 multiplier on all UI sizes
 *   prompts          – which button glyphs to show
 *   confirmAbandon   – ask before abandoning a vigil
 */
export interface UiPrefs {
  uiScale: number;
  reducedFlashing: boolean;
  colorBlind: boolean;
  reducedMotion: boolean;
  prompts: 'auto' | 'keyboard' | 'gamepad' | 'touch';
  confirmAbandon: boolean;
}

export type FullSettings = SaveData['settings'] & UiPrefs;

const DEFAULTS: UiPrefs = {
  uiScale: 1,
  reducedFlashing: false,
  colorBlind: false,
  reducedMotion: false,
  prompts: 'auto',
  confirmAbandon: true,
};

/** Returns save.settings with every UI pref filled in (mutates in place so later writes persist). */
export function uiSettings(save: SaveData): FullSettings {
  const s = save.settings as FullSettings;
  for (const k of Object.keys(DEFAULTS) as (keyof UiPrefs)[]) {
    if (s[k] === undefined) (s as unknown as Record<string, unknown>)[k] = DEFAULTS[k];
  }
  return s;
}

/** Pushes prefs to the document (CSS variables + classes on <html>). */
export function applyUiPrefs(save: SaveData): void {
  const s = uiSettings(save);
  const html = document.documentElement;
  const sysReduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  html.style.setProperty('--ui-scale', String(Math.max(0.75, Math.min(1.4, s.uiScale))));
  html.classList.toggle('a11y-cb', s.colorBlind);
  html.classList.toggle('a11y-noflash', s.reducedFlashing);
  html.classList.toggle('a11y-calm', s.reducedMotion || sysReduce);
}

export function motionReduced(save: SaveData): boolean {
  const s = uiSettings(save);
  return s.reducedMotion || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
}
