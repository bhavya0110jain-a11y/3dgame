/** Sprint 3 Director behaviour (gameplay agent): endless boss order, UI announcement routing (BUG-QA-019). */
import { describe, expect, it } from 'vitest';
import { announce, endlessBossId } from '../../src/game/Director';
import { BIOMES } from '../../src/data/biomes';
import type { GameContext } from '../../src/game/types';

describe('Director S3: endless returning masters', () => {
  it('endlessBossId_firstReturn_isTheNightsOwnMaster', () => {
    for (const b of BIOMES) expect(endlessBossId(b.bossId, 1)).toBe(b.bossId);
  });

  it('endlessBossId_laterReturns_cycleThroughAllMasters', () => {
    const own = BIOMES[1].bossId;
    const seen = [1, 2, 3].map((n) => endlessBossId(own, n));
    expect(new Set(seen).size).toBe(BIOMES.length);
    expect(endlessBossId(own, BIOMES.length + 1)).toBe(own);
  });
});

describe('Director S3: announcements', () => {
  const ctxWith = (ui: unknown) => {
    const texts: string[] = [];
    const ctx = { ui, player: { x: 0, z: 0 }, fx: { text: (_x: number, _y: number, _z: number, s: string) => texts.push(s) } };
    return { ctx: ctx as unknown as GameContext, texts };
  };

  it('announce_uiPresent_usesUiAnnounceWithKind', () => {
    const calls: [string, string | undefined][] = [];
    const { ctx, texts } = ctxWith({ announce: (t: string, k?: string) => calls.push([t, k]) });
    announce(ctx, 'An elite approaches…', 'elite');
    expect(calls).toEqual([['An elite approaches…', 'elite']]);
    expect(texts).toEqual([]);
  });

  it('announce_noUi_fallsBackToFxBanner', () => {
    const { ctx, texts } = ctxWith(undefined);
    announce(ctx, 'The dark closes in!', 'danger');
    expect(texts).toEqual(['The dark closes in!']);
  });
});
