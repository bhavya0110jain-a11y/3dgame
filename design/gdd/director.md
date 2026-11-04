# Director, Enemies & Bosses

**Owner:** gameplay. **Code:** `src/game/Director.ts`, `src/entities/Enemies.ts`, `src/data/enemies.ts`.

## Pacing (15:00 run)
| Time | Feel | Spawn rate/s · cap | Notes |
|---|---|---|---|
| 0:00–1:00 | hot start | 2.2–3 · 45–60 | shades/wisps only; ≈4 level-ups in the first minute |
| 1:15 | first elite | — | always a beatable one (Bog Lurker/Stalker) → first reliquary early |
| 1–5 | build-up | 3.2–4.5 · 80–140 | crawlers, first Cinder Ticks and Gloam Jellies |
| 5–8 | variety | 5.5–7.5 · 180–230 | brutes, knights, Hollow Wardens |
| 8–12 | power fantasy | 10–12.5 · 290–340 | density spikes; good builds shred |
| 12–15 | pressure | 14 · 380 | everything |
| 15:00 | boss | adds trickle | 3 telegraphed patterns + enrage |
Events: elite every 100 s (chest), encirclement every **210 s** from 2:30 (the first one is shades/wisps only — never
splitters; 24 / 30 / 36 / 44 enemies), "Cinders on the wind" tick rush every 210 s from **3:50**. Sprint 2 de-stacking: the
4:35 elite, 5:00 phase change and 6:00 swarm no longer land inside one 70 s window (balance-report #2/#3).

### Formulas (Sprint 2)
- `hpScale(m) = (1 + 0.15m + 0.9(m/10)²) × (1 + LATE_HP·L²)`, `L = clamp(min(m,15) − LATE_FROM, 0, 8) / 8`,
  `LATE_HP = 2.5`, `LATE_FROM = 7` → 1.0 @0, 1.98 @5, 2.88 @8, 4.6 @10, 8.1 @12, 18.5 @15 (×biome difficulty,
  ×pressure hp). Endless multiplies by `1 + endlessTime/240`. (Sprint 1 was 5.4 @15 — strong builds out-scaled it.)
- `damageScale(m) = 1 + 0.04m + 0.08·max(0, m − 6)` → 1.2 @5, 1.48 @8, 1.72 @10, 2.32 @15 (Sprint 1: 1.275 @5,
  1.825 @15). During the boss fight (t ≥ 15:00, not endless) the multiplier is capped at `BOSS_DAMAGE_CAP = 1.3`
  (×difficulty) — Stag contact 30 → 39 instead of 55+.
- Speed `1 + min(0.25, 0.02m)`.
- **Adaptive pressure** (from 6:00, `PRESSURE_FROM = 360`): `fill = alive / phase.maxAlive`, `light = lightValue / maxLight`.
  If `fill > 0.6` or `light < 0.4` → pressure −= 0.15/s (min 1). Else if `fill < 0.3` and `light ≥ 0.7` → pressure
  += 0.04/s (max `PRESSURE_MAX = 2.4`, reached in ~35 s). Spawn rate × pressure; enemy hp × `1 + 0.5·(pressure − 1)`
  (so extra spawns are not free XP). A struggling player (full arena or low light) is never pushed; a strong build that
  clears faster than the Director spawns gets up to 2.4× the spawns. Bot runs: light now dips to ~30 % and recovers
  during 10–14 min instead of reading 100 % flat (balance-report § Sprint 2).
- **Boss**: spawns with `BOSS_HP_MUL = 1.5` (Stag 54k). On arrival the lantern **flares**: light refilled to max, horde
  knocked back (r 9), `lantern:flare {amount}` emitted. Every endless boss flares too.
- **Reliquary drift**: a chest on the ground for 4 s glides to the bearer at 2.2 u/s (+0.6 u/s per second, max 7) so
  chests dropped inside a horde are not lost (balance-report #4).

Scaling (Sprint 1, superseded): `hpScale(m) = 1 + 0.16m + 0.9(m/10)²`, damage `1 + 0.055m`.
Elites: ×8 hp, ×1.5 size/damage, ×4 XP, drop a reliquary + 10 Ash. Sprint 2: before 5:00 only light elites
(Bog Lurker, Stalker, Gloam Jelly, Hollow Warden); Brutes and Knights from `HEAVY_ELITES_FROM = 300` s.

Data changes (Sprint 2): stalker damage 12 → 10 (top early damage source in bot runs); brute damage 16 → 13 and weight 0.5 in 5:00–7:00; crawler damage 7 → 6; jellyling damage 4 → 3,
speed 3.6 → 3.4; 5:00–7:00 phase 5.5/s·180 → 5.2/s·165. Evolution outliers trimmed: Tempest Choir jumps 12 → 9,
Glacier Heart shatter 30 → 22.

## New behaviours
- **Splitter — Gloam Jelly:** lurches in pulses; dies into 3 fast Jellylings.
- **Exploder — Cinder Tick:** sprints in, primes at 2.1 m (telegraph ring, 0.85 s fuse, swells + flashes), blasts 2.4 m.
  Killed before the fuse: it bursts on *other enemies* (2× blast dmg) — deliberate chain-reaction payoff.
- **Shielded — Hollow Warden:** a ward (= hp) soaks damage first (crits chew it 2× faster), ward up = knockback immune;
  regrows at 30%/s after 3.5 s without being hit. "WARD BROKEN" callout.

## Bosses (every attack telegraphed; never the same pattern twice in a row)
| Boss | HP | Patterns | Enrage |
|---|---|---|---|
| Hollow Stag | 36k | charge (lane telegraph), volley (16-ring), eruptions (5 circles on/around you) | <35%: chained triple charge, double volley, 15 eruptions |
| Mire Mother | 55k | rain (10 impact zones), slam (7 m self ring), summon (jellies/lurkers) | <40%: 16 zones, 8.5 m slam, 12 adds + elite |
| Ashen King | 80k | spiral (3-arm stream), charge, eruptions | <40%: 4-arm reversed spiral, triple charge |
Enrage also: +30% speed, attack gap ×0.65, shockwave knockback, "ENRAGED" callout + toast.
Telegraphs use `fx.telegraph(x,z,r,dur,color)` when the VFX layer provides it, otherwise two rings.

## Endless night
After the boss: choose **Greet the Dawn** (end, victory) or **Endless Night** (victory locked in; spawn rate grows +1×/5 min,
enemy hp ×(1 + t/4 min), a boss returns every 3:00 cycling all three at +60% hp each, elites every 60 s, +12 Ash/min).
