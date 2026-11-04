# Progression: XP, Ash economy, Hearth, Achievements

**Owner:** gameplay. **Code:** `src/game/Stats.ts`, `src/game/Game.ts` (`ashForRun`), `src/data/meta.ts`,
`src/data/achievements.ts`, `src/game/Achievements.ts`. **Validation:** `npx vite-node tools/balance-sim.ts [meta]`, `tests/sim`.

## XP
`xp(L) = 2 + 3L·1.09^L` (L<20), then `4L·1.07^19·1.04^(L−19)`. Sim (fresh save): first level-ups ≈ 8 / 17 / 30 / 45 s;
Lv 20 ≈ 7–8 min; Lv 40+ at 15:00 with a strong build.

## Ash
`ash = (pickups + kills/20 + 5·minutes + 150·difficulty·victory + 12·endlessMinutes) × greed`.
Sim: fresh-save run ≈ 100–250 Ash (dies 5–9 min); half-Hearth ≈ 600–800; full-Hearth victory ≈ 1.4k.
Achievements add ≈ 2.5k Ash over a career.

## Hearth (13 upgrades, 18,970 Ash) + bearers (3,550 Ash)
Costs `ramp(base, step) = base + step·r·(1 + r/2)` — first rank 50–120 Ash (bought after run 1), later ranks escalate.
QoL ranks: **Restless Embers** (+1 reroll ×3), **Rite of Banishing** (+1 banish ×3), **Wider Vision** (4 choices).
Projection (greedy buyer, sim anchors): first purchase after run 1, Hearth complete ≈ run 22, everything incl. bearers ≈ run 26–30.

## Level-up QoL
Reroll (1 + ranks), Skip (+5 Ash), **Banish** (1 + ranks; Shift+1..4 or `game.banishUpgrade(i)`): removes that offer for the run.
Reliquary: brief pause showing contents (2.8 s, 4.5 s for an evolution; any key/click closes).

## Achievements (24)
Data-driven list in `src/data/achievements.ts`; checked every second in-run and at run end; persisted in
`save.achievements`, lifetime counters in `save.lifetime`. Unlock rewards pace new content across the first ~10 runs:
Moth Lantern (survive 5:00) → Dusk Hourglass (Lv 20) → Osric free (10:00) → Vesper Bell (1,000 kills) →
Lighthouse Beam (first evolution) → Moon Mirror (kill the Stag) → Pell the Bellwright (300 bell kills).
