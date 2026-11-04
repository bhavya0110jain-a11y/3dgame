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
Events: elite every 100 s (chest), encirclement every 180 s from 2:30, "Cinders on the wind" tick rush every 210 s from 4:20.
Scaling: `hpScale(m) = 1 + 0.16m + 0.9(m/10)²` (×biome difficulty), damage `1 + 0.055m`, speed +2%/min (cap +25%).
Elites: ×8 hp, ×1.5 size/damage, ×4 XP, drop a reliquary + 10 Ash.

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
