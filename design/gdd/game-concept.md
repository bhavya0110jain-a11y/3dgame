# Last Lantern — One-Page Brief

**Genre:** 3D action roguelite / "survivors-like" (auto-attacking horde survival with build crafting)
**Platform:** Web (itch.io, Poki/CrazyGames), Desktop (Steam via Electron wrapper). Keyboard, gamepad, touch.
**Price target:** $4.99 desktop / free-to-play web demo (first biome).
**Session:** 15-minute runs; a boss at 15:00. Meta progression between runs.

## Hook
**Your light is your life.** You carry the last lantern through a night that wants it out. Taking damage dims the
lantern — your light radius shrinks, the Gloom closes in, and you see less of what's coming. Healing (lamp oil)
literally pushes the darkness back. Every hit is felt both as a number and as a world getting smaller.

## Pillars
1. **Light vs. Gloom readability** — warm lantern pool against a cool moonlit world; the edge of your light is the edge of safety.
2. **Juicy, legible chaos** — hundreds of enemies, every hit has flash, sound, particles; nothing is ever visually muddy.
3. **Builds that break the game** — weapons + relics combine; evolutions; by minute 12 a good build should feel absurd.
4. **One more run** — Ash meta-currency, unlockable bearers and nights, clear goals on every game-over screen.

## Art Direction (updated per owner request: "Fortnite-level graphics")
Target the *quality bar* of top-tier stylized AAA (clean silhouettes, vibrant saturated palette, soft real-time
shadows, ambient occlusion, rich lighting, animated foliage, polished VFX) in an **original** style:
**"Moonlit storybook."**
- The world is **not pitch black**: a saturated blue/teal/violet moonlit night, fully readable, with color.
- The lantern casts a **warm saturated amber pool** with real-time shadows; the Gloom beyond is a creeping
  violet fog/vignette that thickens as your light dims (mechanic preserved, readability kept).
- Chunky, rounded, beveled shapes; slightly exaggerated proportions; smooth shading (no flat-shaded low-poly look).
- Characters & enemies: modeled in Blender (bpy scripts in `tools/blender/`), exported as GLB, with
  procedural squash/stretch/bob/limb animation in engine.
- Environment: wind-animated instanced grass and flowers, rounded stylized trees with leaf clusters, glowing
  mushrooms, fireflies, rocks with moss, ruins. Sky dome with gradient, stars and big moon.
- Post: AO, bloom, color grading, subtle chromatic warmth around the lantern, vignette. Quality tiers must keep
  low-end laptops at 60 fps.

## Core loop
Move → weapons auto-fire → enemies drop embers → level up → pick 1 of 3 (weapons/relics) → survive escalating
waves, elites (drop reliquaries), swarm events → boss at 15:00 → victory/defeat → spend Ash at the Hearth.

## Content (v1.0 target)
- 3 nights (biomes) with unique boss each; 8+ enemy types.
- 7+ weapons with evolutions, 12 relics (passives), 5 bearers, 10 Hearth upgrades, achievements.
