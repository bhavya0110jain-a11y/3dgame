# Art Review — Sprint 2 (Art Director)

**Status: PARTIAL — the required capture pass was NOT run.**

This agent had no shell or process tool in this session (only file read/write/search), so it could not
run `gen-model-manifest` / `vite build` or the Playwright probe. `scratchpad/s2-ad-shots/` does not exist.
**Nothing below is a review of the integrated sprint-2 build.** This review uses the newest captures already
in the scratchpad. Several are explicitly *pre-change* baselines (`s2-ui/base/*`, `s2-world-render/perf-before/*`)
or come from sprint-1 QA runs (`qa-shots/*`, `biomes/*`, `final/*`). Treat every finding as "verify against the new
build". Some may already be fixed by sprint 2, and sprint-2 regressions cannot be seen here.

**Still to capture (blocking a real sign-off):** a probe run at 1280x720 covering menu, early gameplay per night
(pines / marsh / ruins), a 250-enemy fight with 3+ evolved weapons, each boss (Stag / Mire / King), level-up,
chest reveal, dawn, game over, and **gameplay** at 390x844 portrait. The only portrait capture so far is the pause menu.

Evidence used (all under `/tmp/claude-0/-home-user-3dgame/eae0ed48-5b7a-5ab2-8a20-e8c9671eef35/scratchpad/`):
`qa-shots/playtest-2-904s.png`, `s2-world-render/perf-before/perf-high-300.png`, `final/boss.png`,
`biomes/biome_ruins-play.png`, `biomes/biome_marsh-play.png`, `s2-ui/base/{menu,levelup,chest,dawn}.png`,
`s2-characters/new3.png`, `qa/touch-portrait.png`.

**Ship verdict on available evidence: NOT YET.** Static shots (menu, character models, boss silhouette) are near
the bar. Moment-to-moment combat fails Pillar 1 (Light vs. Gloom readability) and Pillar 2 ("nothing is ever visually
muddy") once the screen fills up. A store trailer recorded at minute 12 would show a white-orange blob.

---

## P0 — blocks shipping

### P0-1 Late-game VFX whiteout: player and boss unreadable
- **Where:** `qa-shots/playtest-2-904s.png`. About 60% of the frame centre is a saturated orange-to-white blowout from
  stacked additive AoE / explosion VFX. The player cannot be located. The Hollow Stag (top-centre) shows only as a
  ghost silhouette behind the glare.
- **Owner:** `src/render/Fx.ts`, `src/render/vfx/*`, `src/render/post/PostPipeline.ts` (bloom `0.62, 0.55, 0.92`).
- **Fix:**
  1. Set a screen-energy budget for additive player FX. Scale each additive instance's intensity by
     `1/sqrt(max(1, overlapCountInCell))` (the spatial hash already exists), or clamp FX fragment output to `min(rgb, 1.15)`
     before bloom so stacks plateau instead of going white.
  2. Add a dynamic bloom: strength `0.62 → 0.40` when active FX instances exceed 150, lerped over 0.5 s.
  3. Draw a player "always-on-top" silhouette: after the scene, re-render the bearer with `depthTest:false` and a flat
     `#ffd27a` fill at 35% alpha plus a 2 px dark `#1a0f2e` outline. Also keep a persistent ground ring under the player
     (radius 1.1 m, `#ffd27a`, 2 px) that draws above FX.
  4. Weapon AoE fills should be **rings and edges**, not filled discs: interior alpha ≤ 0.15, edge alpha 0.8.

### P0-2 Tree canopies occlude the arena
- **Where:** `playtest-2-904s.png`. Large dark-navy canopy blobs (left third, and centre-right next to the boss bar)
  sit between the camera and the play space and cover about 25% of the frame.
- **Owner:** `src/world/Props.ts`, `src/world/WorldShading.ts`.
- **Fix:** add a screen-space dither fade on tall props. If a prop's screen position is within 35% of the screen height
  of the player, or the prop is above the camera-to-player ray, fade it to 25% opacity with a Bayer-dither discard (no
  transparency sort) over 0.25 s. Also lower the canopy height that can sit camera-side of the player. Cheapest
  alternative: no tall trees spawn within 8 m on the camera side of the player's current chunk.

### P0-3 Horde palette has no value hierarchy; enemies outshine the hero
- **Where:** `s2-world-render/perf-before/perf-high-300.png`. With 300 enemies, every hue is present at full saturation
  (magenta brutes, lime bogs, orange bloaters, purple shades, white knights). The player in the centre cannot be found.
  Enemy bodies are brighter than the lantern pool.
- **Owner:** enemy tints in `src/data/enemies.ts`, instanced enemy material in `src/entities/`, models from `tools/blender/`.
- **Fix (palette rule for the art bible):**
  - Enemy bodies: cool, mid-dark value, OKLCH L 0.35–0.55, chroma ≤ 0.12. Separate types by **silhouette and value
    step**, not by full-spectrum hue. Only eyes and weak points are emissive.
  - Warm amber/gold (hue 35–60°) is **reserved** for the player, the lantern, friendly projectiles, XP and pickups.
  - Hostile projectiles and hazards: magenta/violet `#ff3df0` core with a dark `#2a0830` 1.5 px rim, so they never share
    a hue with friendly fire.
  - Elites get a rim/outline colour (`setRim` in `materials.ts`, e.g. `#ff6a3d`, strength 1.0), not a new body hue.
  - Enemy rim strength in a horde: drop the default `0.6 → 0.35` once more than 120 enemies are on screen, so the
    crowd reads as a mass and the hero's rim wins.

---

## P1 — must fix before store capture

### P1-1 Ruins night is monochrome violet
- **Where:** `biomes/biome_ruins-play.png`. Floor, walls, gravestones, dead trees and sky all sit in one hue
  (~270°) and a narrow value band. The only accents are two braziers. It reads as a colour filter, not lighting.
- **Owner:** `src/data/biomes.ts` (ruins palette), `src/render/Lighting.ts`.
- **Fix:** add a second, complementary moonlight hue. Hemisphere sky `#8fa3c8` (cool blue-grey) on stone tops, ground
  bounce `#3a2450`. Raise floor albedo value about 15%. Add teal lichen/moss accents `#4fb3a0` on 20% of the stones.
  Move the sky gradient toward `#2b1d52 → #6a4fa8` with the moon halo kept at its current colour.

### P1-2 Marsh water glints read as noise
- **Where:** `biomes/biome_marsh-play.png`, bottom half. Hundreds of square white glints over the water look like
  square sprites, and they compete with XP gems for "bright small dot" meaning.
- **Owner:** `src/world/Ambient.ts` / water shading in `src/world/Ground.ts`.
- **Fix:** cut glint density to 30%, use round soft sprites (radial falloff, ≤ 4 px at 720p), tint `#9fe8ff` at
  ≤ 0.6 intensity, and twinkle them (sin-phase alpha) so they read as reflections, not pickups.

### P1-3 Lantern pool renders as a flat orange disc
- **Where:** `final/boss.png`, centre. A hard-edged saturated orange disc (~100 px) sits under the player and reads as
  a fire hazard. The player is about 25 px tall and half-covered by it.
- **Owner:** lantern pool decal (`src/render/Fx.ts` or `src/render/Lighting.ts`).
- **Fix:** use a radial gradient (alpha 0.35 at centre → 0 at r) in `#ffb347`. Let the real point light do the work,
  and keep the gold ring (it reads well). Push the gameplay camera in 10–15% so the bearer is ≥ 40 px tall at 720p.
- Positive: the Hollow Stag's silhouette, emissive antler tips and scale are on target. Add a soft contact shadow under
  the boss to ground it.

### P1-4 Chest reveal shows the same relic twice
- **Where:** `s2-ui/base/chest.png`. "Swift Quill Lv1→2" and "Swift Quill Lv2→3" appear as two cards, which reads as a
  bug. The reveal reuses the level-up sunburst and has no chest on screen.
- **Owner:** `src/ui/UI.ts` (~line 1152), chest reward assembly in `src/game/`.
- **Fix:** merge same-item rewards into one card "Lv 1 → 3" with 2 pips lighting up in sequence. Give the reveal its own
  identity: chest icon centre-top, gold coin/ember burst, cards flipping in staggered (120 ms each, 0.92→1.04→1.0
  scale), and a gold `#ffcc4d` sunburst instead of the white one.

### P1-5 Dawn screen does not feel like dawn
- **Where:** `s2-ui/base/dawn.png`. It uses the level-up template ("The master has fallen") over the same night-violet
  backdrop. The HUD timer reads "DAWN?" (`src/ui/UI.ts:965`).
- **Owner:** `src/ui/UI.ts`, `src/game/Game.ts:415`, grading in `PostPipeline.ts`.
- **Fix:** this should be the game's one warm full-screen moment. Over 2.0 s, grade from the night LUT to a sunrise
  (horizon `#ffb36b`, top `#ffd9a0`, exposure +0.3), dissolve remaining enemies to ash particles, then show the choice.
  Change the timer text to "DAWN" (drop the "?") or show a sun icon.

### P1-6 Level-up cards: dead space, badge clutter, generic mobile look
- **Where:** `s2-ui/base/levelup.png`. About 40% of each card is empty below the description. There are three competing
  badges per card (the "NEW!" sticker, the "NEW RELIC" tab and the number badge). The overall look is close to
  Brawl-Stars/mobile-gacha, not "storybook".
- **Owner:** `src/ui/UI.ts`, `src/ui/art.ts`.
- **Fix:** card height −25% (content-fit). Drop the "NEW!" sticker when the tab already says NEW. Move the hotkey
  number into the bottom edge. Add one storybook motif across all panels: an inner parchment-tone panel `#f3e6c8` at 8%
  over the navy, a deckled/ink-line border (1.5 px `#e9c98a`), and small corner flourishes. Selected card: lift 8 px
  plus a gold edge, not just glow.

---

## P2 — polish

- **P2-1 Bearer and enemy share pink.** The menu hero robe (`s2-ui/base/menu.png`) is the same magenta as the new
  blob enemy (`s2-characters/new3.png`) and the brutes. Either move the bearer robe to deep ember red `#b8432f` with a
  gold trim, or ban the 300–340° hue from enemy bodies. Owner: `tools/blender/` bearer and enemy scripts.
- **P2-2 Menu foreground grass is overexposed.** The bottom-left quarter is near-white yellow from lantern light plus
  bloom on near-camera grass. Clamp grass emissive/lantern contribution at camera distance < 3 m, or lower the menu
  lantern intensity about 30%. Owner: `src/world/Grass.ts`, menu scene setup.
- **P2-3 New enemy models (`s2-characters/new3.png`).** Blob eyes are faceted flat polygons, which contradicts
  "smooth, rounded" (use a subdivided ellipse with a glossy highlight). The bloater carapace shows a doubled-shell offset
  (two yellow rims), so merge the shells. The warden is on target.
- **P2-4 HUD micro-type.** At 960x540 the "MAX" badges under the weapon icons are about 7 px. Set the minimum to 10 px
  at 720p, or replace the text with a gold star pip.
- **P2-5 Portrait.** Only the pause menu was captured at 390x844 (`qa/touch-portrait.png`). It fits and the hierarchy
  is good. Portrait **gameplay** is unverified: weapon icon row width, boss bar and LIGHT bar overlap with the thumb zone.

## Positives to protect
- Menu composition: moon-backlit pines, a strong bearer silhouette, a clear CTA hierarchy (gold primary, violet
  secondary).
- Display typography (chunky rounded title with dark outline) is consistent across the menu and modals.
- The LIGHT bar with the lantern icon is an excellent diegetic tie to the hook.
- The boss silhouettes are strong.
