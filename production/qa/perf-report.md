# Perf report: enemy-count scaling (tools/perf.mjs)

**Date:** 2026-11-04 · **Build:** working tree (v0.1.0) · **Machine:** 4-core container, **SwiftShader** software GL,
960×540, load average 8–13 (eight agents building in parallel). Frame and render milliseconds are **relative only**.
Sim (CPU) milliseconds are real but inflated by contention. Draw calls and triangles don't depend on the machine.

Scenario: a run with god mode and the Director disabled. N mixed enemies (11 types) are made unkillable so the count
stays fixed. The loadout is 6 max-level weapons (ember_bolt, cinder_halo, spark_chain, brazier, flare_nova, vesper_bell),
and the player circles so the horde keeps chasing. The simulation runs every frame; only every 4th frame is drawn
(`renderEvery`, needed on SwiftShader).

Re-run: `node tools/perf.mjs --counts 100,200,350 --quality high,low --frames 80 --warmup 30 --width 960 --height 540`.
Add `--update-baseline` to accept new numbers and `--strict` to fail on budget or regression flags. Use `QA_GPU=1` on a
machine with a GPU for absolute numbers.

## Results

| Tier | Enemies | Sim ms/frame | ↳ enemies | ↳ weapons | ↳ projectiles | ↳ fx | Draw calls | Triangles/frame |
|---|---|---|---|---|---|---|---|---|
| high | 100 | 1.48 | 0.48 | 0.39 | 0.09 | 0.23 | 145 | 2.42 M |
| high | 200 | 2.33 | 1.55 | 0.34 | 0.15 | 0.29 | 148 | 3.67 M |
| high | 350 | 4.14 – 4.51 | 2.83 – 2.86 | 0.66 – 1.13 | 0.21 – 0.43 | 0.56 – 1.00 | 162 – 206 | 4.84 – 5.97 M |
| low | 100 | 0.94 | 0.36 | 0.37 | 0.05 | 0.24 | 67 | 1.17 M |
| low | 200 | 1.79 | 0.74 | 0.45 | 0.11 | 0.26 | 60 | 1.39 M |
| low | 350 | 2.22 – 3.08 | 1.31 – 2.25 | 0.46 – 0.48 | 0.19 – 0.28 | 0.31 – 0.45 | 61 – 65 | 1.65 – 1.72 M |

Ranges come from two separate runs. The higher draw-call count at high/350 (206) is from VFX particles and strips
active in that capture.

## Budget check

| Budget | Target | Measured (worst) | Status |
|---|---|---|---|
| Draw calls (any tier, 350 enemies) | ≤ 220 | 206 (high) / 65 (low) | OK (high is near the limit) |
| Sim CPU at 350 enemies | ≤ 8 ms | 4.5 ms (contended) | OK |
| Sim scaling 100 → 350 | ~linear | 1.5 → 4.5 ms (×3 for ×3.5 enemies) | OK, spatial hash working |
| Triangles/frame, high, 350 | ≤ ~2 M for a mid-laptop iGPU at 60 fps (guideline) | **~6 M** | **OVER** |
| Triangles/frame, low, 350 | ≤ ~1.5 M | 1.7 M | Borderline |
| JS heap growth during measurement | ≈ 0 | −16 MB … +1.6 MB per 80 frames (GC noise) | Inconclusive, see recommendation 5 |

**CPU side is healthy.** Enemy AI dominates and scales linearly, with no O(n²) behaviour. Weapons are cheap.
**GPU side is the risk.** Triangle throughput, not draw calls, will cost frames on integrated GPUs on the high tier.

## Where the triangles go (high, 350 enemies, scene census)

| Group (visible meshes) | Static triangles | Instances | Notes |
|---|---|---|---|
| Shadow-casting `MeshStandardMaterial` (enemy bodies, props, player) | 864 k | 707 | Drawn in the main pass **+ the moon shadow map + all 6 faces of the lantern's point-light cube shadow** |
| Non-shadow `MeshStandardMaterial` (grass/foliage instancing) | 401 k | 37.9 k | One pass |
| `MeshBasicMaterial` (23 instanced meshes: **enemy eyes**, emissive bits) | 361 k | 996 | About **1,000 triangles per enemy just for the eyes** |
| VFX strips / particles / shader materials | ~12 k | ~1.4 k | Negligible |

Lights: 3 point lights (1 casting shadows: the lantern cube map, high only) and 1 directional light (moon, shadows).
At 350 enemies that's 87 shader programs, 88 geometries and 27 textures.

## Top optimisations (ranked by expected impact)

1. **Lantern point-light shadow renders every caster 6 more times (high tier).** Bodies are about 2.4 k triangles × 350
   = 0.86 M triangles × (1 main + 1 moon + 6 cube faces) ≈ 6.9 M triangles. *Fix (render owner, `src/render/Lighting.ts`):*
   keep enemies out of the lantern shadow. Put enemy InstancedMeshes on layer 1 and leave layer 1 off
   `lanternLight.shadow.camera.layers`; three's WebGLShadowMap respects the shadow camera's layers. Alternatively,
   replace the cube shadow with a single downward SpotLight shadow (1 pass instead of 6), since the lantern is held above the bearer.
   Expected: about −4 M triangles/frame at 350 enemies on high.
2. **Enemy eyes are about 1 k triangles per instance** (361 k at 350 enemies). Eyes read as glowing dots at gameplay
   zoom. *Fix (art/enemy models, `src/entities/enemyModels.ts` or the GLB export):* use low-poly eye geometry
   (≤ 60 triangles per pair) or billboard them. Expected: about −0.34 M triangles/frame, on every tier.
3. **Enemy bodies at about 2.4 k triangles per instance** are heavy for a 350+ horde. Add a horde LOD: a ≤ 800-triangle
   variant for regular enemies (keep full detail for elites and bosses), or decimate in the Blender export
   (`tools/blender/*`, Decimate modifier ratio 0.35 with smooth normals). It also multiplies through the shadow passes.
4. **Moon shadow casters:** small fodder (shade, wisp, crawler, jellyling) could skip `castShadow`, or use a cheap blob
   decal under each instance (they already have a ground contact shade). Tradeoff: slightly less grounded look on high.
5. **Allocation check:** heap deltas are dominated by GC timing. The next step is a Chrome DevTools allocation-sampling profile
   during a 350-enemy fight to confirm the per-frame paths are allocation-free. Known small offenders are in
   `production/qa/bugs.md` BUG-QA-008 (`Input.anyPressed(...codes)`, the gamepad `forEach` closure).

## Regression gate

- Baseline: `production/qa/perf-baseline.json` (this run). CI (`.github/workflows/game-ci.yml`, smoke job) runs
  `tools/perf.mjs` with the same arguments and flags **draw calls +15%** or **sim ms +35% (and > 0.5 ms)** against the
  baseline, plus the absolute budgets above. The step is `continue-on-error` because shared CI runners are noisy.
  Draw-call flags are reliable; sim-ms flags need a re-run before acting.
- Per-run JSON: `production/qa/perf-<timestamp>.json` and `perf-latest.json`. Each includes the triangle census (`topMeshes`),
  shadow-caster triangles and a light census.
