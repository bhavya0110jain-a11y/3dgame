# Last Lantern — built with Claude Code Game Studios

3D action roguelite in Three.js + TypeScript (Vite). Concept: `design/gdd/game-concept.md`.

## Technology Stack

- **Engine**: Three.js 0.170 (custom engine layer in `src/`), WebGL2
- **Language**: TypeScript (strict)
- **Build System**: Vite (`npm run build` → `dist/`), typecheck `npm run typecheck`
- **Tests**: Vitest (`npm test`, files in `tests/`), visual smoke test `node tools/smoke.mjs <outDir>` (headless Chromium, screenshots)
- **Asset Pipeline**: Blender 5.2 as Python module (`/home/user/blender-venv/bin/python tools/blender/*.py`) → GLB in `public/models/`
- **Version Control**: Git, trunk-based

## Code layout
- `src/core` engine-agnostic utils (events, input, rng, save, spatial hash)
- `src/render` renderer, post-processing, FX, asset loading
- `src/world` ground, sky, foliage, props
- `src/entities` player, enemies (instanced), projectiles, pickups
- `src/game` game loop/state machine (`Game.ts`), director (spawning), upgrades, run state
- `src/data` data-driven content: weapons, passives, enemies, biomes, meta upgrades, characters
- `src/ui` DOM UI (screens + HUD), `src/audio` procedural WebAudio

## Project Structure

@.claude/docs/directory-structure.md

## Technical Preferences

`project.yaml` at the repo root is the primary config store. `modes.rigor: minimal`, `modes.automation: autonomous`
— the owner asked for full-speed autonomous development: agents decide, log decisions, and proceed without asking.

## Coordination Rules

@.claude/docs/coordination-rules.md

## Coding Standards

@.claude/docs/coding-standards.md

## Rules for every agent
- Run `npm run typecheck` and `npm run build` after changes; visual changes must be verified with
  `node tools/smoke.mjs <dir>` and by looking at the screenshots.
- Stay inside the files your task owns; other agents work in parallel in the same tree.
- Keep 60 fps with 300+ enemies: instancing, pooling, no per-frame allocations in hot loops.
- `production/session-state/active.md` is the session checkpoint.
