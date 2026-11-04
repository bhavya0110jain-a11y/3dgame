# Balance report: playtest bot, Whispering Pines (for the gameplay designer)

**Source:** 5 full runs of the production build driven by `tools/playtest-bot.mjs`. Raw data is in
`production/qa/playtest-1..5.json`, with per-30 s curves in `production/qa/playtest-summary.md`.
**Bot:** skill 0.8 ("decent but not great" player). It kites away from the local crowd, dodges telegraphed hazards,
sweeps ember trails and grabs chests and oil. It picks upgrades with a simple heuristic: level owned weapons, take new
weapons until 4, then prefer relics that pair with an evolution. Simulation uses fixed 1/30 s steps, the same as
`Game.updateRun`, so there's no timeScale tunnelling.
**Caveats:** n = 5 on one night, and the bot is not a human. It is weaker than a skilled player at dodging fast melee,
and it never deliberately picks fights with elites. Treat these as **directional** signals, and re-run after each tuning
pass (`node tools/playtest-bot.mjs --runs 5`) to compare.

## Results at a glance

| Run | Meta | Outcome | Time | Level | Kills | Peak alive | Damage taken | Main damage source | Evolutions | Chests |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | fresh | death | **5:59** | 20 | 1,450 | 211 | 295 | stalker 61, wisp 59, brute 42 (+brute elite 23) | 0 | 0 (1 elite killed) |
| 2 | fresh | death | **15:42** (boss) | 45 | 9,190 | 94 | 261 | **boss 80 + boss hazard 42**, brute 63 | 3 | 9 |
| 3 | fresh | death | **2:39** | 11 | 485 | 94 | 206 | crawler 61, **jellyling 47, gloam_jelly 37** | 0 | 0 |
| 4 | full Hearth | **victory** | 16:03 | 48 | 9,087 | 91 | 451 | **boss 299 + hazards 100** | 3 | 9 |
| 5 | full Hearth | death | **15:32** (boss, after revival) | 47 | 8,489 | 334 | 1,508 | **brute 748 (33 hits)**, boss 344, jellyling 121 | 0 | **0 (7 elites killed)** |

Fresh saves: 0/3 reach dawn, and deaths come at 2:39, 5:59 and 15:42. Full Hearth: 1/2 victories, and both runs ended in the
boss fight. Level pacing is on target: about 5–6 level-ups in the first minute, L20 at about 5:00, and L45–48 at 15:00.

## Findings (ranked)

### 1. The boss is a difficulty cliff after a 9-minute plateau (High)
- Runs 2 and 4 took **zero damage from about 6:00 to 15:00**. Every 30 s sample in that window reads `dmg 0`, and alive
  enemies stayed at 20–45 while the Director's caps were 230–380. Strong builds kill 10–20 enemies/s, faster than the
  Director spawns them (10–14/s), so the "pressure" phases 12–15 apply no pressure.
- Then the Hollow Stag does 80–344 damage in 30–60 s. Its melee is `30 × damageScale(15) ≈ 55` per hit, and the ground
  hazards do 25–42. All three runs that reached 15:00 were decided in the boss fight, and two of them died. Run 4's light
  fell to 16 %. Boss time-to-kill in run 4 was **58 s**, and the boss enraged at 15:44.
- **Suggestions** (Director/enemies owner):
  - Make the mid-late game push back. Use an adaptive spawn rate: if `activeCount < 0.3 × maxAlive` for 20 s, ramp `rateMul`
    up to ×2. Also make HP scaling steeper after minute 8, e.g. add `+ Math.pow(Math.max(0, m - 8) / 7, 3) * 3` to `hpScale`.
    The goal is light that dips and recovers during minutes 8–15, not a flat 100 %.
  - Make the boss a test, not a cliff. Don't scale boss contact damage with `damageScale(minutes)` (use the def damage, or
    cap the multiplier at 1.3). Consider refilling the lantern when the boss spawns ("the lantern flares as the master
    arrives") so every boss fight starts at full light.

### 2. Spike at 5:00–6:00: four threats stacked in about 70 s (High)
- The worst 30 s window falls here in runs 1 and 2, and damage starts here in run 5. These events land together:
  - The rush at 4:20 (crawlers or ticks).
  - The stalker or brute elite at 4:35.
  - The phase change at 5:00, which brings in brutes, gloam jellies and spitters.
  - The second swarm at 5:30 (36 encircling enemies).
- Run 1 died at 5:59 with only 4 weapons at L16–17. Damage taken went from 15 → 93 in one window.
- **Brutes are the biggest damage dealer outside the boss.** In run 5 they did 748 damage in 33 hits, about 22.7 per hit
  at 5–13 min. For a 100-light fresh save, that's 5 hits to death.
- **Suggestions**:
  - De-stack the events. Move the swarm cadence from `+180` to `+210`, so the second swarm lands at 6:00, or delay the
    third elite.
  - Ease brutes in: brute weight 0.5 in the 300–420 phase, and/or contact damage 16 → 12 with a slightly longer
    hit cooldown. Their 90 HP × hpMul already makes them the "tank".

### 3. First swarm at 2:30 can roll gloam jellies (Medium-High)
- `Director.update` picks the swarm type from `['shade', 'wisp', 'crawler', 'gloam_jelly']` with no time gate. In run 3 the
  2:30 swarm was 36 gloam jellies (each about 48 HP at hpMul 1.4). They split into about 108 fast jellylings that a
  level-10 build can't clear. That window caused 84 of 206 damage, and the run died at 2:39.
- **Suggestion:** restrict the first swarm to `['shade', 'wisp']`, and allow splitters from the second swarm (5:30+) onward.

### 4. Reliquaries dropped inside dense hordes never get opened (Medium)
- Run 5 killed 7 elites and opened **0** chests. Run 1 killed 1 elite and opened 0. When peak alive is above 200, chests
  drop under the horde and the kiting player never gets back to them. As a result, run 5 had no evolutions at all.
  Runs 2 and 4 had low enemy counts, opened 9/9 chests and got 3 evolutions each.
- **Suggestions**: let chests drift toward the bearer after about 5 s (like magnetized embers, but slower), or give them a
  2–3 unit auto-pickup radius. Also add an off-screen arrow while a chest is on the ground. The bot now records
  `chestsOnGround` in every 30 s sample, so this can be confirmed after the change.

### 5. High early variance for fresh saves (Medium)
- Fresh runs ended at 2:39, 5:59 and 15:42. The difference is mostly the first 2 minutes. The early-dying builds spread
  picks across 4 weapons at L1–2. The surviving run focused one weapon (spark_chain → tempest_choir at 8:09) and took
  `twin` early.
- Crawlers (3.3 speed, 7 damage) are the main early damage source (run 3: 9 hits, 61 damage by 2:00).
- **Suggestions**: a slightly gentler first 3 minutes for new players would protect retention without touching late-game
  tuning. Options: crawler contact damage 7 → 5 before 3:00, or a 1 s post-hit invulnerability instead of 0.35 s in the
  first 3 minutes. A first-run hint ("Level one weapon to MAX to evolve it") would also help.

### 6. Readability notes from bot screenshots (for VFX/Art, not balance)
- At 10:00–15:00 the large bright fire patches (brazier / pyre_garden) and explosions cover most of the play area. The bearer
  is often hard to find, which works against the "legible chaos" pillar. Consider capping the alpha and bloom of persistent
  ground-fire VFX, or dimming them with distance from the player.
- Foreground pines sometimes occlude the bearer at the bottom-right of the frame. Consider fading trees that lie between
  the camera and the player.
- Achievement toasts appear at the bottom center, over the action around the player. Consider top-center or a side position.

## How to re-run
```bash
node tools/gen-model-manifest.mjs && npx vite build --outDir /tmp/build
DIST=/tmp/build node tools/playtest-bot.mjs --runs 3 --meta none --start 1
DIST=/tmp/build node tools/playtest-bot.mjs --runs 2 --meta full --start 4 --shots /tmp/shots
# other nights: --biome biome_marsh / biome_ruins ; post-boss: --endless
```
Each run takes about 6–10 minutes of wall time under SwiftShader on a loaded 4-core machine. The summary aggregates every
`playtest-<n>.json` in the output folder.
