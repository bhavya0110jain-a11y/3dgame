# Weapons & Evolutions

**Owner:** gameplay. **Code:** `src/data/weapons.ts` (launch 7), `src/data/weaponsNew.ts` (new 4), `src/data/evolutions.ts`, `src/game/Upgrades.ts`.

## Rules
- 6 weapon slots, 6 relic slots. Base weapons max at **Lv 8**.
- **Evolution** = base weapon at max level **+** its paired relic owned (any level) **→** the next reliquary (elite chest)
  is guaranteed to contain the evolution as its first item. The evolved weapon replaces the base one in the same slot,
  has no levels, and is announced with a big toast + flash (`weapon:evolved`).
- Discoverability: level-up cards say "Evolves with X"; a relic that would complete a recipe gets ×2.5 offer weight.
- Chests never give new weapons (level-ups widen a build, chests deepen it). Without an evolution: 1–3 upgrades of owned items.

## Recipes
| Base | Mechanic | Relic | Evolution | What changes |
|---|---|---|---|---|
| Ember Bolt | aimed bolts | Flint | Sunspear Volley | 6 piercing spears, burst on impact |
| Cinder Halo | orbit | Bellows | Solar Crown | two counter-rotating rings, ignite |
| Flare Nova | radial pulse | Long Wick | Dawnbreak | huge double pulse, heals per hit |
| Spark Chain | chain lightning | Clockwork | Tempest Choir | 3 storms, 12 jumps, stun |
| Wick Lance | piercing line | Swift Quill | Beacon Ray | 4-way infinite-pierce rays |
| Brazier | fire zones | Lamp Oil | Pyre Garden | wide gardens, standing in one heals |
| Rime Shards | slowing ring | Tallow Ward | Glacier Heart | frozen foes shatter (AoE) |
| Lantern Hook | boomerang, pierces both ways, return trip drags foes in | Lodestone | Moonhook Reaper | 6 hooks, reel embers in |
| Moth Lantern *(unlock)* | homing moths | Keeper's Tome | Lunar Monarchs | moths split into hunters on hit |
| Vesper Bell *(unlock)* | telegraphed toll on densest pack, stuns | Ashen Clover | Cathedral Toll | 3 bells, always crit, 2 aftershocks |
| Lighthouse Beam *(unlock)* | sweeping beams | Twin Flame | Eclipse Lighthouse | 4 scissoring beams that burn |

Pilgrim Boots, Moon Mirror and Dusk Hourglass are deliberately unpaired (pure stat relics).

## Tuning anchors (tools/balance-sim.ts)
Lv8 base weapon ≈ 150–250 effective DPS; an evolution ≈ 2–4× its Lv8 form. A two-evolution build at 15:00 ≈ 1.5–2k DPS.
