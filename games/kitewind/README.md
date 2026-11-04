# Kitewind

Original 3D arcade sky-glider roguelite (Three.js 0.170 + TypeScript strict + Vite). You are a paper kite-spirit
riding warm winds over an endless sunset archipelago: rings refill LIFT, the sea and the islands end the run.

```
npm install
npm run dev         # http://localhost:5174
npm run build       # typecheck + dist/
npm test            # vitest: flight model, scoring, generator/RNG determinism, headless runs, save/meta
npm run smoke       # node tools/smoke.mjs [outDir] — headless Chromium (SwiftShader) screenshots of every screen
```

## Architecture

| Folder | What lives there | Pure (no three/DOM)? |
|---|---|---|
| `src/core` | `Rng` (mulberry32, `hash2`, daily seed), `EventBus` (typed events), `Input` (kb/mouse/touch/pad → steer), `Save`, `math` | yes (Input uses DOM) |
| `src/data` | **all tuning + content**: `tuning.ts` (FLIGHT/SCORING/WORLD/UPDRAFT/HAZARD), `kites`, `upgrades`, `boons`, `biomes`, `achievements` | yes |
| `src/game` | `Flight` (kite flight model), `Scoring`, `Mods` (kite × meta × boons), `Run` (headless run: flight + world + interactions), `Meta` (shop/rewards), `Autopilot`, `Game` (state machine + render wiring) | all but `Game` |
| `src/world` | `Generator` (deterministic chunks from seed), `WorldSim` (streaming), `types`, `islandShapes`; views: `Sky`, `Ocean`, `Clouds`, `WorldView`, `Environment` (biome blend), `props` (procedural geometry) | Generator/WorldSim/types yes |
| `src/entities` | `KiteView` (+ ribbon tail), `RingsView` (rings, shrines, glimmers), `HazardsView` (lightning, gusts, flocks, thunderclouds) | no |
| `src/render` | `Renderer` (bloom → ACES → finish pass: grade/vignette/speed lines → FXAA), `CameraRig`, `Fx` (pooled particles), `Models` (GLB manifest), `materials` (shared uniforms, palette + rim shaders) | no |
| `src/ui` | `UI.ts` (DOM screens, data-act buttons), `style.css` | no |
| `src/audio` | `Audio.ts` — fully procedural WebAudio (chimes with a pentatonic combo ladder, wind bed, generative music) | no |

Coordinates: +Z is the flight corridor (distance), +Y up, sea at y = 0. The chase camera looks down +Z, so
**screen-right is -X** (positive steer/bank/yaw moves toward -X).

Frame loop: `Game.frame` → fixed 1/60 s `Run.step` (time-scaled for whisker slow-mo) → `renderFrame` pushes the
sim state into the views. Views rebuild static instance buffers only when `WorldSim.version` changes; dynamic ones
(rings, glimmers, birds, bolts, trails, particles) rewrite preallocated buffers per frame without allocating.

## Art pipeline

`public/models/manifest.json` → `{ "models": { "<id>": "<file>.glb" } }`. Every id has a procedural fallback, so
partial art drops are safe. Ids and unit conventions are documented at the top of `src/render/Models.ts`
(`island_0..5`, `spire`, `arch`, `shrine`, `bird`, `lantern`, `kite_<kiteId>`). GLB materials are used as authored
(the procedural palette material re-tints per biome; a GLB keeps its own colours).

## Automation (`window.__game`)

See the header of `src/main.ts`. Typical probe:
```js
const G = window.__game; G.manual = true;          // frame loop renders only
G.startRun({ seed: 1234 }); G.simulate(5, 'auto', true); G.renderFrame(1/60);
G.run.flight / G.run.scoring / G.run.world.active   // inspect
```
