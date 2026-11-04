# Art Review: Sprint 2 (uncommitted tree, 2026-11-04)

**Reviewer:** art director (review only; no source edits)
**Build:** working tree with all six sprint-2 agents' changes. `node tools/gen-model-manifest.mjs && vite build`, high tier forced, adaptive quality off, headless Chromium + SwiftShader.
**Probe:** `/tmp/claude-0/-home-user-3dgame/eae0ed48-5b7a-5ab2-8a20-e8c9671eef35/scratchpad/ad-probe.mjs`
**Shots:** `/tmp/claude-0/-home-user-3dgame/eae0ed48-5b7a-5ab2-8a20-e8c9671eef35/scratchpad/s2-ad-shots/*.png`. These are scratch files. QA should re-shoot into `production/qa/evidence/` after fixes.
**Bar:** would this sit next to the best stylized indies on a Steam front page? The pillars I judged against are "Light vs Gloom readability" and "Juicy, legible chaos" (game-concept.md).

## Verdict: NOT SHIP-READY

The menu, key art and every UI screen are at or near the bar. Gameplay frames are not. In 5 of the 11 gameplay frames you cannot find the bearer:

| Shot | Why the bearer can't be found |
|---|---|
| 03b | The model is stuck at the origin |
| 03c, 04-pines | Hidden by pine crowns |
| 05-horde-ruins, 05-horde-ruins-b | Whited out by evolved-weapon light |
| 04-ruins | Red robe on a red pool |

Late-game frames also break pillar 2. The screen goes to milky white, every boss renders as a pale ghost, and the screen fills with damage numbers. Fix the P0 items below before regenerating any store art.

### Measured
| Shot | Mean luma | Centre 40% of frame: share of pixels with luma > 0.85 |
|---|---|---|
| 03a pines start | 0.21 | 0.4% |
| 04 pines / marsh / ruins early | 0.25 / 0.29 / 0.19 | 2.9% / 1.9% / 1.6% |
| **05 horde pines (6 evolutions, 250 enemies)** | 0.46 | **46.6%** |
| **05 horde pines-b** | 0.53 | **65.2%** |
| 05 horde ruins-b (Dawnbreak pulse) | (visually full white) | bearer not visible |

Sampled colours (average over a box):

| Shot / region | Hex | Hue | Sat | Luma |
|---|---|---|---|---|
| Ruins ground outside the pool | #5c1239 | 328° | 0.80 | — |
| Ruins lantern pool | #c74943 | 3° | — | — |
| Ruins bearer (char_pyre) | #c97b75 | 4° | — | — |
| Marsh water | — | — | — | **0.52** |
| Marsh lantern pool | — | — | — | 0.50 |
| Pines pool | — | 31–35° | — | 0.43–0.51 |
| Pines outside the pool | — | 190–213° | — | 0.19–0.23 |

- **Ruins:** the bearer's hue is 1° away from the pool's.
- **Marsh:** the water is brighter than the lantern pool, so the value hierarchy is inverted.
- **Pines:** the reference that works.

---

## P0: blocks ship / store art

### 1. The bearer model and lantern light never leave the origin (still unfixed)
- **Evidence:** 03b. After 6 s of walking, `player.x = 15.72` but `group.position.x = 0.00`. The lantern pool sits at bottom-left and there is no bearer on screen.
- **Status:** three agents reported this, and Player.ts was edited this sprint, but the sync is still missing (only `reset()` sets the position).
- **Owner:** `src/entities/Player.ts`, `update()`.
- **Fix:** add `this.group.position.set(this.x, 0, this.z);` just before `this.animate(dt, time, speed);`. This is the line eb9cca8 removed.
- **Also:** add a vitest that calls update with moveX = 1 and asserts that `group.position.x === player.x`.
- **Workaround in use:** every other shot in this review uses a probe-side copy of the sync.

### 2. Pine and oak crowns hide the bearer
- **Evidence:**
  - 03c: walked into a grove; only a dithered smear of the bearer is left.
  - 04-pines-early: the bearer is behind a pine at screen centre.
  - 05-horde-pines: foreground crowns cover about 30% of the bottom-left.
- **Why the current dither fails:**
  - It only clears fragments 1.6–3.4 m from the camera→player line (`smoothstep(1.6, 3.4, dist)`).
  - It never discards more than 80% (`fade * 0.8`).
  - Pine crowns are 4–6 m wide, so the outer half of the crown stays solid.
  - The 20% that remains is an IGN screen-door pattern that reads as noise.
- **Fix, part 1 (owner `src/world/WorldShading.ts` DITHER_FRAGMENT):**
  - Radius `smoothstep(2.8, 5.5, dist)`, scaled by camera zoom (pass `uOccR`).
  - Full discard: `if (fade > bayer4x4(floor(gl_FragCoord.xy * 0.5)))`.
  - Use a 4×4 ordered Bayer pattern at a 2-px cell instead of IGN, so the cut-away looks like a clean halftone instead of static.
  - Lower the height gate to `smoothstep(0.4, 1.2, y)`, so low crowns fade too.
- **Fix, part 2 (owner `src/entities/Player.ts` plus Renderer, characters agent):**
  - Add a guaranteed x-ray silhouette.
  - Draw the bearer's meshes a second time with `depthFunc = THREE.GreaterDepth`, `depthWrite = false`, flat colour `#ffd9a0` at opacity 0.55, and `renderOrder` 10.
  - This shows the bearer wherever she is occluded (trees, walls, boss bodies), and it is the standard genre answer.
- **Acceptance:** the bearer is identifiable in 100% of frames in a 15-minute Pines bot run.

### 3. Late-game white-out (pillar 2)
- **Evidence:**
  - 05-horde-pines and pines-b: the centre 600×500 px is cream-white and enemies can't be read.
  - 05-horde-ruins: a Beacon Ray / Eclipse starburst over a milky pastel veil.
  - 05-horde-ruins-b: the Dawnbreak pulse whites out the frame and the bearer is invisible. The report said "centre flash is capped"; it is not, at max level with relics.
- **Photosensitivity:** this is also a risk. It is a near-full-screen white flash that repeats on the Dawnbreak cooldown.
- **Fixes (owners `src/render/Fx.ts`, `src/data/evolutions.ts`, `src/render/post/PostPipeline.ts` + `Renderer.ts`):**
  1. **Governor (`Fx.ts` ~l.954):**
     - Lower the floor from 0.6 to 0.3: `gainT = 1 - 0.7 * …`.
     - Feed it the immediate-draw evolution visuals and ground FX coverage, not only particle pressure.
     - Today the beams, rings and pools that cause the white-out are invisible to it.
  2. **Focus protection:** every additive layer (particles, strips, ground FX, beams) gets `uFocus` (the player's xz) and multiplies its output by `mix(0.3, 1.0, smoothstep(1.2, 3.0, distToFocus))`. Fire pools already do this; generalise it.
  3. **Dawnbreak (`evolutions.ts` / `Fx.dawnPulse`):**
     - Peak additive intensity ≤ 0.5 inside 3 m.
     - Ring width ≤ 1.2 m.
     - No full-disc fill; keep the sun-rays as thin strokes.
     - Under `reducedFlashing`, rings only.
  4. **Bloom:** `UnrealBloomPass(…, 0.62, 0.55, 0.92)`. Drive strength with the governor gain, from 0.62 down to 0.35 at full load, and raise the threshold from 0.92 to 1.15 at full load.
- **Acceptance:** with 6 maxed evolutions and 250 enemies, the centre region has ≤ 10% of pixels above 0.85 luma, and the bearer is visible in every frame of a 10 s capture.

### 4. Bosses and hit enemies render as pale ghosts
- **Evidence:**
  - 06-boss-pines/marsh/ruins: the Hollow Stag, Mire Mother and Ashen King all read as cream/white silhouettes with no material identity.
  - 11b-portrait: crawlers and wisps under fire are white.
  - The release agent had to force `hitFlash = 0` for its store boss shot. This is the same issue the vfx agent raised.
- **Cause:** `src/entities/enemyModels.ts` mixes albedo 60% toward near-white and adds 0.3 white emissive per unit of flash. `Enemies.ts:385` resets hitFlash to 1 on every hit, and it decays at only 6/s. Under Cinder Halo ticks a boss is effectively permanently white.
- **Fix (characters agent):**
  - Albedo mix 0.6 → 0.25.
  - Move the flash to the rim: `totalEmissiveRadiance += vec3(1.0, 0.94, 0.85) * fxFlash * (0.12 + fxRim * 1.4)`.
  - Decay `dt * 6` → `dt * 12`.
  - Refractory: only re-trigger when `hitFlash < 0.3`.
  - Multiply the flash by 0.35 for bosses and 0.6 for elites.
  - Scale the flash by `1 - 0.5 * smoothstep(80, 200, flashingCount)` when many enemies flash at once.
- **Acceptance:** a boss under Cinder Halo keeps its body hue in 9 of 10 sampled frames.

---

## P1: needed for the "top-tier stylized" bar

### 5. The Ashen Ruins palette collapses into magenta-red
- **Evidence:** 04-ruins-early and 06-boss-ruins.
  - The ground outside the pool is hue 328°, sat 0.80. That is saturated magenta, not "violet plaza".
  - The pool is hue 3°, which is red, not amber.
  - The char_pyre bearer is hue 4°, so she is invisible on her own pool.
  - Red ticks and magenta shades sit on magenta ground.
  - Pillar 1 (warm pool vs cool world) does not read at all.
- **Fix (owner `src/data/biomes.ts`, ruins entry; world-render):**

| Field | Now | Proposed |
|---|---|---|
| moon | 0xd8b8ff | 0xa8b4ff |
| renderAmbientSky | 0x8a6ab8 | 0x5e64a8 |
| renderAmbientGround | 0x3a2a2a | 0x262838 |
| renderGradeShadow | 0x3a2050 | 0x24224a |
| renderGradeHighlight | 0xffc890 | 0xffd49a |
| renderLantern | 0xffa040 | 0xffb45a |
| gloom | 0x5a1f8a | 0x3f2a8a |
| ground.base | 0x5a5264 | 0x4c4a5c |
| ground.patch | 0x7a6a6c | 0x5e5a6e |
| ground.path | 0x9a8a84 | 0x8a8494 |

- **Targets:**
  - Outside the pool: hue 235–265°, sat ≤ 0.45, luma 0.15–0.22.
  - Pool: hue 30–40°.
  - Also check WorldShading's gold-amber push for mauve/red inputs; it is landing at 3° here.

### 6. Ruins props read as fire hazards
- **Problem:** crystal props glow `0xff7a3a`, with flame-shaped orange spikes. Next to Brazier pools and enemy fire patches, the player can't tell decor from danger (04-ruins: four of them read as burning hazards).
- **Fix:** crystal `glow` → `0xb08aff` (violet) or `0x7ad8ff`. Keep the orange for the ember particles only.
- **Owner:** biomes.ts / Props.ts.

### 7. Marsh value hierarchy is inverted, and spore bokeh covers the frame
- **Evidence:** 04-marsh-early, 06-boss-marsh.
  - The water is brighter (luma 0.52) than the lantern pool (0.50).
  - The water has a high-frequency glitter that reads as noise.
  - The `spore` ambient (count 120, 0xa8ffe8) draws as dozens of 20–30 px soft discs, which look like dirt on the lens.
- **Fixes:**
  - Water albedo and sparkle −40%, target luma ≤ 0.30.
  - Sparkle density ×0.3.
  - Spores 120 → 50, size ×0.4, alpha 0.35, and fade out within 4 m of the camera.
- **Owner:** world-render (Ground/WorldShading water term, biomes ambient, `vfx/Particles` ambient sizing).

### 8. Pines decor glows use enemy signal colours
- **Evidence:** 03a, 03b, 04-pines, 06-boss-pines.
  - Bush berries (`glow 0xff8ad0`) on dark round bushes look like pairs of eyes, so they read as lurking enemies.
  - Mushrooms (`glow 0xa070f0`, sampled hue 259°) match the shade eyes (`0xb06cff`) and the jelly eyes (`0xff8af0`).
- **Rule:** saturated violet, magenta and red emissives belong to enemies only. Decor glows are pale gold or cool cyan, with emissive ≤ 0.6.
- **Fix:** pines bush glow → `0xffe2a0`, mushroom glow → `0x8fd0ff`, flower tint unchanged.
- **Also (characters):** the Gloam Jelly body is pastel pink with a higher value than the ground and the bearer. It is the brightest object in 11b-portrait. Darken the body toward `0x4a2f7a` and keep the pink in the inner glow, bubbles and eyes, so it stays in the same family as the other gloom creatures (dark body, glowing features).

### 9. World banners land on the bearer
- **Evidence:** 04-pines, 04-marsh, 04-ruins, 05-horde.
  - "An elite approaches…" and "The dark closes in!" render at screen centre, right over the player.
  - In 05-horde two of them stack.
- **Fix (owner Fx `fxt-big` text or UI):**
  - Place banners at 20–24% of screen height, just under the dawn bar.
  - 26–28 px, one at a time (queue), 1.2 s.
  - Under 2 runs, a hint card replaces the banner instead of both showing.

### 10. Damage-number clutter
- **Evidence:** 05-horde-pines has about 45 numbers on screen ("105!", "210!", "53!"). The gold crit numbers share their hue with the gold evolution VFX, so neither reads. 04-pines has about 20 at 1:15.
- **Fixes (owner `src/render/Fx.ts` numbers, plus a UI setting):**
  - Merge hits per enemy per 0.25 s.
  - Hard cap of 24 on screen, dropping non-crits first.
  - Non-crits at 70% scale and 80% alpha.
  - Crits in white with an amber outline, not gold fill.
  - Suppress non-crits when more than 150 enemies are alive.
  - Add a Settings option "Damage numbers: All / Crits only / Off".

### 11. Grass reads as "TV static" inside the pool
- **Evidence:** 03a. The amber pool is covered in short dark strokes.
- **Cause:** `grass.root 0x24543f` is darker than `ground.base 0x356a48`, so from the top-down camera every blade draws a dark streak.
- **Fix (`src/world/Grass.ts` / biomes):**
  - Make the root colour equal to the ground colour under the blade: sample the groundMask base/patch in the vertex shader, or set the root to `ground.base`.
  - Make the tip 25% lighter than the root.
  - The pines pool then reads as soft gold fur instead of noise.
- **Menu (01):** the foreground grass is flat straw-yellow triangles. It reads as low-poly and competes with the CTA. Darken the lower 60% of the menu grass (×0.55) and let the moon-sheen tip tone show.

### 12. Portrait menu crops the bearer out
- **Evidence:** 11a-portrait-menu. Only the lantern is visible, at x ≈ 10 px.
- **Fix (owner `src/render/CameraRig.ts` `menu()`):** when `aspect < 1`, shift the look-at so the bearer lands at x ≈ 50%, y ≈ 58%, and pull the camera back about 1.4×. The menu buttons already occupy the lower 35%.

### 13. Boss framing
- **Evidence:** 06-boss-*. The boss enters from the top of the screen, and the boss bar (y ≈ 130–200 px) sits over the boss's head and antlers.
- **Fix:**
  - Camera (Game.updateCamera / CameraRig): while a boss is within 14 m, bias the look-at 25% toward the boss and add +10% zoom-out.
  - Optionally move the boss bar to the bottom centre, above the light gauge.

---

## P2: polish

14. **Level-up and chest icons (UI):**
    - Every weapon tile is the same orange square (07-levelup: Brazier, Hook and Lance are indistinguishable at a glance). Tint each tile from `def.color` (for example Spark Chain 0x9ad8ff, Rime 0x7ad8ff, Brazier 0xff5a1a).
    - Sunspear Volley uses the same `bolt` glyph as Ember Bolt; evolved weapons need their own glyph or a crown overlay.
    - Drop the redundant "NEW!" sticker; the "NEW WEAPON" ribbon already says it.
15. **Evolution screen copy (08a/08b):** "Evolved" appears four times (title, ribbon caption, tag, description). Remove the `EVOLVED · ` prefix from the descriptions in `src/data/evolutions.ts`, and drop "Your weapon has evolved".
16. **Modal scrim:** behind level-up, chest and dawn, world damage numbers and rings show through ("20!" at right in 08a–c). Raise the scrim to about 70% with a 6 px backdrop blur, or hide the FX text layer while `state === 'levelup'`.
17. **Dawn (09):** the "Greet the Dawn" card is mauve-pink, close to the "Endless Night" card. Give it a warm gold gradient (`#ffd27a` → `#ff9a5a` → `#6a3a7a`) so the sun-versus-moon choice contrasts in hue, not just in border. The rising sun disc isn't visible at this moment; make sure it has cleared the hills by about 1.5 s.
18. **Game over (10):** the "Damage by weapon" panel is 60% empty with two weapons. Size it to its content, or fill it with a light-over-time sparkline.
19. **HUD at run start (03a):** 12 dashed empty slots read as a grid of holes. Show owned slots plus one empty slot per row until the row fills.
20. **Bearer value:** in Pines the bearer is darker than the pool (luma 0.31 vs 0.51) and only about 45 px tall. Readable, but she is the smallest hero in the genre. Add the warm `#ffd9a0` rim from finding 2 at 0.35 even when unoccluded, so she pops on any ground.

---

## What already meets the bar (keep it)
- **Menu (01):** strong composition. The bearer on the left third, the moon behind, the logo and the CTA stack are excellent. The logo is store-ready.
- **UI system:** the Fredoka display type, chunky beveled buttons and gold/indigo palette are consistent across level-up, chest, dawn, game over and the first-run card. Portrait level-up (11c) stacks cleanly.
- **Pines at the run start (03a):** amber pool against a blue night is exactly pillar 1.
- **Enemy reads in Pines:** red/black crawler beetles and violet shades contrast well with the teal ground (06-boss-pines). The Ruins cobblestone path and the dead-tree silhouettes are good.
- **Chest reveal:** the chest art (indigo, gold straps, moon clasp) and the rays are charming.

## Re-review checklist (QA / lead)
1. Fix P0 items 1–4, rebuild, re-run this probe, and copy the shots to `production/qa/evidence/s2-art-*`.
2. Re-measure the centre white-out (target ≤ 10%), the Ruins ground hue, and the marsh water/pool luma.
3. Only then regenerate the store art (`tools/package-screens.mjs`); the current screens were captured with the bugs above masked by staging.
