# Art Review: Sprint 3 (uncommitted tree, 2026-11-04)

**Reviewer:** art director (review only; no source edits)
**Build:** working tree with the sprint-3 changes from the readability, world-look, ui and gameplay agents. Built with `node tools/gen-model-manifest.mjs && vite build`. High tier forced, adaptive quality off, headless Chromium + SwiftShader, 1280×720 plus 390×844 portrait.
**Probe:** `/tmp/claude-0/-home-user-3dgame/eae0ed48-5b7a-5ab2-8a20-e8c9671eef35/scratchpad/ad-probe-s3.mjs`. This is the sprint-2 probe with these changes:
- It no longer patches the bearer position.
- `fx.update` runs on every simulated step, so FX age as they do in play.
- The camera goes through the real `Game.updateCamera`, so boss bias and crowd zoom apply.
- Before each horde shot the crowd is topped back up to 250. The evolved kits kill about 60 enemies per second, so the live count at capture was 160–200.
- New sections `attrib` and `attrib2` freeze the world and toggle hit flash, slow tint, bloom and FX lights to find out what causes what.

**Shots:** `…/scratchpad/s3-ad-shots/*.png` (45 frames). 19 key frames are kept as `production/qa/evidence/s3-art-*.png`.
**Measurements:** `…/scratchpad/s3-ad-measure.txt`, made with `…/scratchpad/s3-measure.py`. "Centre" is the middle 40% of the frame; the number is the share of its pixels with luma above 0.85.

## Verdict: SHIP-WITH-NITS (early and mid game). Late-game store art and trailer capture stay blocked until findings 1–3 land.

Sprint 3 fixed every sprint-2 P0 at the level it was written. The early and mid game now meet the bar.

| Sprint-2 item | Status |
|---|---|
| **P0 #1** bearer stuck at the origin | **Fixed.** `group.x == player.x` in every frame without the workaround (03b). |
| **P0 #2** crowns hide the bearer | **Fixed.** The Bayer halftone cut-away is clean, not static (03c, 04-pines-early). |
| **P0 #4** pale bosses | **Fixed.** The Ashen King is red, the Mire Mother green, and the Hollow Stag violet bone (06-*). |
| **P0 #3** late-game white-out | **Improved, but not at target.** Details below. |
| #5 Ruins palette | **Fixed.** Outside the pool: hue 245–286°, sat 0.43. |
| #6 crystals | **Fixed.** Violet. |
| #7 Marsh water/pool | **Fixed.** Water luma 0.20 against pool 0.63. |
| #8 decor glows | **Fixed.** Pale gold and cyan. |
| #9 banners | **Fixed.** One at a time at 22%. |
| #11 pool grass | **Fixed.** No more TV static. |
| #12 portrait menu | **Fixed.** The bearer is centred. |
| #13 boss bar | **Fixed.** Moved to the bottom. |
| #14–#19 UI polish | **All landed.** |

On P0 #3: all nine running horde frames are still above the ≤10% target:

| Night | Centre share > 0.85 |
|---|---|
| Pines | 14.4 / 23.4 / 21.0% |
| Marsh | 11.7 / 19.2 / 12.7% |
| Ruins | 14.3 / **27.3** / 22.5% |

In 05-ruins-b the bearer cannot be found inside the beam starburst. Mean frame luma also doubles, from 0.20–0.27 in a normal night to 0.40–0.48 in a horde, so the late game stops reading as night (pillar 1). The S2 frames were cream-white and these are gold-and-lilac, which is real progress. But the acceptance test from sprint 2 still fails, and this is the frame the Steam trailer needs.

### Measured (running frames, FX aged)
| Shot | Mean luma | Centre share > 0.85 |
|---|---|---|
| 01 menu / 11a portrait menu | 0.29 / 0.33 | 2.4% / 14.1% (the moon disc) |
| 03a pines start / 03c walked | 0.27 / 0.24 | 4.8% / 0.5% |
| 04 early: pines / marsh / ruins | 0.22 / 0.26 / 0.20 | 0.6 / 0.6 / 4.0% |
| 04 mid (227–243 enemies): pines / marsh / ruins | 0.23 / 0.27 / 0.24 | 3.0 / 2.8 / 1.0% |
| 05 horde pines a/b/c | 0.48 / 0.45 / 0.43 | 14.4 / 23.4 / 21.0% |
| 05 horde marsh a/b/c | 0.40 / 0.40 / 0.41 | 11.7 / 19.2 / 12.7% |
| 05 horde ruins a/b/c (Dawnbreak, Beacon, Eclipse, Glacier) | 0.41 / 0.46 / 0.46 | 14.3 / 27.3 / 22.5% |
| 06 boss pines / marsh / ruins | 0.27 / 0.25 / 0.27 | 10.1 / 8.9 / 6.0% |

Frozen A/B on one pines horde frame (13a–d; `debug.timeScale = 0`, so only the toggle changes):

| Frame | Mean | Centre |
|---|---|---|
| As is (bloom 0.62/0.92 at governor 0.31) | 0.36 | 8.7% |
| Bloom off | 0.30 | 6.1% |
| Bloom governed as requested (0.35/1.15) | 0.32 | 6.5% |
| Also FX point lights off | 0.32 | 6.5% (no change: the governor already handles lights) |

The frozen frames drop the immediate-mode beams and rings, which are rebuilt every sim step, so they understate the white-out. The running numbers above are the ones that count.

Sampled colours:

| Region | Hex | Hue | Sat | Luma |
|---|---|---|---|---|
| Ruins ground outside the pool | #452b4c / #1e1a4f | 286° / 245° | 0.43 / 0.67 | 0.20 / 0.12 |
| Ruins pool (Pyre bearer) | #a76a53 | **16°** | 0.50 | 0.46 |
| Marsh pool / grass / water | #c29d64 / #223f2e / #024034 | 37° / 145° / 169° | — | 0.63 / 0.22 / 0.20 |
| Pines pool / hotspot under the lantern | #c78b44 / **#fcd895** | 32° / 39° | — | 0.58 / **0.86** |

---

## P1: blocks late-game store art and trailer

### 1. Late-game white-out is still 12–27% at the centre (P0 #3 acceptance not met)
- **Evidence:** 05-horde-* (9 frames, all over 10%). In 05-ruins-b the bearer is not visible.
- **Cause, Ruins kit:** the four evolved beam weapons all start at the bearer, so their additive cores stack on her even with the 0.3 focus floor.
- **Cause, Pines kit:** the Solar Crown and Cathedral Toll gold rings fill the middle 600×400 px.

Fixes:

a. **Beams emerge away from the bearer** (`src/render/Fx.ts` `lighthouseBeam` ~l.962, and the same in every beam/strip emitter whose origin is the player):
   - `const ax = px + cx * 0.65` → `px + cx * 1.4` (same for `az`).
   - Outer cone: `a0` 0.7 → 0.15.
   - Hot core: `a0` 0.95 → 0.25, `core` 0.9 → 0.5.
   - The beam then fades in along its length instead of starting at full white on her chest.

b. **Wire bloom to the governor** (Renderer/PostPipeline owner; the readability agent's request is still open; `PostPipeline.ts:70` is static):
   - Each frame: `k = (fx.brightness - 0.3) / 0.7`, `post.bloom.strength = 0.35 + 0.27*k`, `post.bloom.threshold = 1.15 - 0.23*k`.
   - Measured: frame mean −0.04 and centre −2.2 points on its own.

c. **Black ash confetti** (`Fx.ts` ~l.506, death flakes `0x2a2430 → 0x141018`, `PF_BOUNCE`):
   - Ten full deaths per frame × 3·k flakes × 1.2 s life leaves hundreds of near-black slivers on the lit pool. They read as dirt or static over the whole fight (05-pines-*, 13a).
   - Fix: `const flakes = ps.pressure > 0.5 ? 0 : Math.ceil(2 * k * room);` and lift the colours to `0x5a4c6a → 0x2e2838`.

d. **Ring trails at full load:**
   - Solar Crown's trails are ribbons at intensity 1.5 (`src/data/evolutions.ts:88`, `ribbons.alloc(0xffa830, …, 1.5)`). Change it to `1.0`.
   - In `src/render/vfx/Strips.ts`, multiply the ribbon pass by `uGain * uGain`, not `uGain`. Ribbons then fall to 0.09 at the 0.3 governor floor instead of 0.3.

**Acceptance:** re-run `ad-probe-s3.mjs horde`. All nine frames ≤ 10% at the centre, mean luma ≤ 0.36, and the bearer's hood is visible in 05-ruins-b.

### 2. Late-game crowd reads pale grey-lilac, and hit flash is not the cause
- **Evidence:** 05-horde-marsh-*, 05-horde-ruins-*, 05-pines right side. The S3 readability evidence `s3-readability-after-horde-ruins.png` shows the same thing.
- **Attribution test** (12a–c, marsh horde, world frozen):
  - Only 19 of 176 enemies were flashing and 22 slowed.
  - Forcing hitFlash = 0 and slowTimer = 0 on every enemy leaves the crowd just as pale (12c).
  - In the mid-game frames, without evolved kits, the same knight and warden models read correctly.
  - So the cause is the shading of steel and bone GLBs (knight, hollow_warden) under the brighter late-game pool and additive haze, not the FX flags.
- **Fix (`src/entities/enemyModels.ts`):**
  - `ENEMY_PALETTE` (0.75, 0.3, 0.88, 0.45) → **(0.75, 0.24, 0.85, 0.30)**. A white albedo then tops out at about 0.47 instead of 0.62.
  - Moon-rim term at l.318: `uRimColor * fxRim * 0.7 + 0.07` → `uRimColor * fxRim * 0.45 + 0.05`.
- **Acceptance:** in 05-horde-marsh-b, the median luma of knight and warden bodies is ≤ 0.45, and the lineup still separates all types.

### 3. The x-ray silhouette fails exactly when the crowd touches her
- **Evidence:**
  - 04-night-pines-mid (227 enemies): I could not find the bearer. A stalker and a crawler cover her screen position (640, 360), and there is no cream silhouette.
  - x1-crowd crop: only a fragment of her shows through a hug of 160 enemies.
- **Cause:** `Player.ts:90` `XRAY_PULL = 0.9`. The x-ray copy is pulled 0.9 m toward the camera, so any occluder closer than 0.9 m in front of her fails `GreaterDepth`. Contact-range enemies are exactly those occluders.
- **Fix (Player.ts + PostPipeline):** stencil silhouette instead of a depth offset.
  1. Bearer body materials: `stencilWrite = true`, `stencilRef = 1`, `stencilZPass = THREE.ReplaceStencilOp`.
  2. `xrayMaterial`: `depthTest = false`, `stencilWrite = true`, `stencilRef = 1`, `stencilFunc = THREE.NotEqualStencilFunc`, `stencilFail/ZFail/ZPass = KeepStencilOp`, and `XRAY_PULL = 0`.
  3. The composer's scene render target needs `stencilBuffer: true` (Renderer owner).
  - **Interim if stencil is not possible:** `XRAY_PULL` 0.9 → 0.3, and x-ray only the robe and hood meshes.
- **Also:**
  - The x-ray colour #ffd9a0 is nearly the hit-flash colour (1, 0.94, 0.85), so in a crowd she reads as a flashed enemy.
  - Change it to saturated amber `#ffb347`, with fill alpha 0.2 and rim alpha 0.85: `uOpacity * (0.2 + 0.8 * rim)`.

---

## P2: polish

4. **Banners sit on the boss** (`src/ui/UI.ts` `announce`).
   - **Evidence:** 06-boss-pines and 06-boss-ruins. "An elite approaches…" crosses the Hollow Stag's antlers and the Ashen King's crown.
   - **Cause:** the 40% boss bias in the camera puts the boss head at y ≈ 100–250 px, which is the banner line at 22%.
   - **Fix:** while a boss is alive, drop non-boss kinds. In `announce`: `if (bossUp && kind !== 'boss' && kind !== 'buff') return;`, where `bossUp` is the same flag that shows `.boss-bar`. The elite and swarm callouts during a boss fight add nothing; the boss is the event.
5. **Gloam Jelly body is still pastel pink** (sprint-2 #8 "Also", still open).
   - It is the brightest enemy in 04-pines-mid, 04-ruins-mid and 11b-portrait.
   - **Fix (characters agent, GLB vertex colours or a tint in enemyModels):** body toward `0x4a2f7a`. Keep the pink in the inner glow, bubbles and eyes.
6. **Pickup confetti** (`src/entities/Pickups.ts` ~l.250).
   - The ≥50 / ≥10 / ≥3 gems (`0xff3a6a` / `0x6ab0ff` / `0x6aff8a`) still cover the horde centre. The red-pink top gem also sits close to the hostile-signal family.
   - **Fix:**
     - Start the crowd dim at 60 pickups instead of 120, with a floor of 0.4: `1 - 0.6 * clamp((n - 60) / 240)`.
     - Emissive multiplier `1.9 + 0.5*pulse` → `1.4 + 0.3*pulse`.
     - Skip the GLOW halo entirely above 200 pickups.
     - Change the top gem `0xff3a6a` → `0xffd27a` (gold, the player's family).
7. **Pyre pool hue is 16°** on Ruins (04-ruins-early). Target is 30–40°; the 31° figure was measured with a non-Pyre bearer.
   - **Fix (Player.ts, Pyre ground-light remap):** hue 0.075 → 0.095, lightness ≥ 0.64 unchanged.
8. **Hot spot under the lantern** in Pines (03a): #fcd895, luma 0.86. The brightest ground in the game sits under her feet, and pool luma rose from 0.51 to 0.58 this sprint.
   - **Fix (`src/world/WorldShading.ts`, ground):** add the same soft knee the enemies use: `reflectedLight.directDiffuse /= 1.0 + max(reflectedLight.directDiffuse - 0.55, 0.0) * 1.5;`. Target ≤ 0.75 at the core.
9. **Lantern-lit pines turn mustard-olive** (04-pines-early, 03c).
   - **Fix (WorldShading, `soften` path for props/foliage):** mix the lantern contribution 40% toward its own luminance, so lit crowns read warm green rather than khaki.
10. **Cinder Halo ring is the brightest object in every boss frame** (06-*, about 130 px radius with a white-hot inner edge).
    - **Fix (`src/data/weapons.ts:76` CinderHalo):** ribbon intensity `ribbons.alloc(0xff6a2a, …, 2.2)` → `1.4`.
11. **Game-over columns are uneven** (10). With `.go-cols { align-items: start; }` (style.css:1228), the damage panel ends at y 515 and the achievements panel at y 620, which leaves a hole bottom-left.
    - **Fix:** `.go-cols { align-items: stretch; }` and make each panel `display: flex; flex-direction: column; justify-content: flex-start;`. Both panels then share the row height and their content stays top-aligned.
12. **Damage-number setting is still on/off.** Sprint-2 #10 asked for "All / Crits only / Off"; `UI.ts:1160` is still a boolean toggle.
    - **Fix (UI owner):** a 3-state `damageNumbers: 'all'|'crits'|'off'` in Save.ts, and in `Enemies.ts:438` `(setting === 'all' && activeCount <= NUMBERS_CROWD) || (crit && setting !== 'off')`.
13. **Two banner systems.**
    - `Fx.ts:409` still switches its own banner to 33% when a boss is up, which is obsolete now that the boss bar is at the bottom. It is masked only by the UI's `!important`.
    - **Fix (vfx owner):** delete the 33% branch and forward `Fx.banner()` through a `bannerSink` that Game sets to `ui.announce`.
14. **Menu foreground grass is still straw-gold triangles** (01, 11a). Carried over and accepted as a known nit. It would need the pool amber push disabled for grass on the menu.

## What now meets the bar (keep it)
- **Run start and mid game** (03a/c, 04-*-early/mid):
  - In all three nights the warm pool against the cool world reads instantly.
  - The Ruins plaza is finally violet-blue cobble.
  - Marsh water sits below the pool in value.
  - The halftone crown cut-away looks deliberate.
  - The enemy palette separates every type at 230+ enemies.
  - The mid-game Marsh and Ruins frames are store-screenshot quality.
- **Bosses:**
  - All three keep their body hue under Cinder Halo.
  - The boss bar at the bottom reads well and no longer covers the boss.
- **UI:**
  - Level-up and chest badges are tinted per weapon.
  - The evolution glyphs and crown are clear.
  - "Evolution!" appears once and the "Legendary" ribbon is clean.
  - The darker scrim with blur means nothing shows through.
  - The dawn sun-versus-moon choice now contrasts in hue.
  - On game over all the buttons are on screen.
  - The HUD slot rows are no longer a grid of holes.
- **Portrait:** the menu centres the bearer with the moon behind her (11a). The portrait level-up stacks cleanly (11c).

## Not an art finding, for QA to triage
- Every Marsh probe uses `char_frost` and stays at level 1–2 for minutes while killing plenty:
  - 04-marsh-early: Lv 1 at 1:15.
  - 04-marsh-mid: Lv 2 at 4:36 with 243 enemies.
  - 06-boss-marsh: Lv 1 at 2:00 with Cinder Halo 6 and Spark Chain 5.
- With the same kit, Pines reaches Lv 4 and Ruins Lv 9.
- Either the Marsh pickups are not being collected, or Maelis's XP is not credited. Please reproduce it with a normal run.
- The plain-chest frame 08c, where the chest was missing, was a capture-timing artifact. A DOM probe confirms the reliquary SVG renders with opacity 1 (x2-chest-plain).

## Re-review checklist
1. Land findings 1–3, then re-run `node …/ad-probe-s3.mjs <dist> <out> horde,attrib2,nights`.
2. Acceptance:
   - All 05 frames ≤ 10% at the centre and mean ≤ 0.36.
   - The bearer is visible in 05-ruins-b and 04-pines-mid.
   - Median knight and warden body luma ≤ 0.45.
3. Then capture the late-game store and trailer frames (`tools/package-screens.mjs`) into `production/qa/evidence/`.
