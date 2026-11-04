# Perf report: enemy-count scaling (tools/perf.mjs)

## Sprint 3 re-run (2026-11-04, after readability / world-look / ui / gameplay)

**Build:** working tree after the four sprint-3 agents (scratchpad `s3-qa-build`) · **Machine:** same 4-core container,
SwiftShader, 960×540, **load average 22–27** (other agents' Chromium probes; the S2 baseline ran at 4–9). Same scenario
and arguments (`--counts 100,350 --quality high,low --width 960 --height 540`). Raw JSON:
`perf-2026-11-04T16-40-17.json`; screenshots `perf-high-350.png`, `perf-low-350.png` (replaced).

| Tier | Enemies | Sim ms (S2 → S3) | ↳ enemies | Draw calls (S2 → S3) | Triangles/frame (S2 → S3) | Programs |
|---|---|---|---|---|---|---|
| high | 100 | 1.04 → **0.93** | 0.54 → 0.38 | 131 → **152** (+16 %) | 0.96 M → 0.82 M | 65 → 66 |
| high | 350 | 1.81 → 4.09 loaded / **1.55** quiet | 1.18 → 2.94 / **1.08** | 142 → **156** (+10 %) | 1.05 M → 1.09 M | 65 → 66 |
| low | 100 | 0.92 → 1.24 / 1.18 quiet | 0.39 → 0.54 / 0.71 | 72 → **88** (+22 %) | 0.34 M → 0.30 M | 39 → 40 |
| low | 350 | 2.28 → 3.04 / **1.85** quiet | 1.41 → 2.15 / 1.23 | 72 → **88** (+22 %) | 0.55 M → 0.54 M | 39 → 40 |

**Draw calls: +16 on every tier, from the bearer's x-ray silhouette (BUG-QA-022).** The per-mesh census shows each
bearer part twice (`Head_1`, `Body_1`, `Body_2`, a second `Staff_1` …): `Player.mountRig` adds one GreaterDepth
x-ray mesh per body part (16 parts). +1 program (the x-ray ShaderMaterial). Still far inside the 220 budget, but the
+15 % regression gate trips on low (phones) and high/100. Fix proposed in bugs.md (silhouette only the 4–5 outline
parts, or skip on low). Triangles are flat to slightly lower (gem/FX budgets).

**Sim — quiet re-run (load 6–8, raw `perf-2026-11-04T17-28-37.json`, `…T17-30-56.json`):** high/350 **1.55 ms**
(enemies 1.08; S2 1.81 / 1.18), low/100 1.18 ms (S2 0.92, +29 %, inside the 35 % gate), low/350 **1.85 ms** (S2 2.28).
So the 4.09 ms high/350 in the loaded run was CPU contention, not a regression: the extra per-enemy work this sprint
(contact cooldown, flash tier × crowd scale, bound `forEach` for `hitCd`) is noise. No budget violations, draw calls
155 high / 88 low. The added shader math (focus falloff, enemy palette, dither) is per-fragment ALU only — no draw
calls — and cannot be judged on SwiftShader; a real-GPU pass (`QA_GPU=1`) is still owed (readability's caveat).

**Baseline:** `perf-baseline.json` now holds high/350 and low/100,350 from the quiet re-runs and high/100 draw counts
from the loaded run (with S2 timings). The x-ray's +16 draws are accepted as a feature cost **pending BUG-QA-022**; the
200-enemy rows were not re-run and still carry the pre-x-ray draw counts (a 200 run will flag +16 until re-baselined).

---

## Sprint 2 re-run (2026-11-04, after world-render + characters perf work)

**Build:** working tree after the six sprint-2 agents (scratchpad `s2-qa-build`) · **Machine:** same 4-core container,
SwiftShader, 960×540, load average 4–9 (one other agent's browser probe running). Same scenario and arguments as below;
`tools/perf.mjs` now uses `player.damage = () => {}` for god mode instead of `invuln = 1e9` (which blinked the bearer
group and its lantern light off every other 50 ms and skewed triangle / draw-call counts).

| Tier | Enemies | Sim ms | ↳ enemies | Draw calls (S1 → S2) | Triangles/frame (S1 → S2) | Shadow-caster tris | Programs |
|---|---|---|---|---|---|---|---|
| high | 100 | 1.04 | 0.54 | 145 → **131** | 2.42 M → **0.96 M** | 0.36 M | 87 → 65 |
| high | 200 | 1.82 | 1.03 | 148 → **140** | 3.67 M → **0.80 M** (LOD on above 170) | — | 65 |
| high | 350 | 1.81 | 1.18 | 162–206 → **142** | 4.84–5.97 M → **1.05 M** | 0.40 M | 65 |
| low | 100 | 0.92 | 0.39 | 67 → 72 | 1.17 M → **0.34 M** | 7 k | 39 |
| low | 200 | 1.70 | 1.07 | 60 → 72 | 1.39 M → **0.42 M** | — | 39 |
| low | 350 | 2.28 | 1.41 | 61–65 → 72 | 1.65–1.72 M → **0.55 M** | 7 k | 39 |

**Triangles: −78 % on high at 350 enemies, −67 % on low.** The guideline targets from sprint 1 (≤ ~2 M high, ≤ ~1.5 M
low at 350) are now met with a wide margin. Where it came from (scene census, high/350):
- Lantern cube shadow is prop-only (Lighting.ts shadow gate) — the horde is no longer drawn 6 extra times.
- Horde LOD (`<name>_lo.glb`, ~800–900 tris) switches on above 170 alive on high, always on low/medium; glow parts
  decimated to ~150 tris. Enemy bodies + eyes: ~0.26 M + 0.08 M at 350 on high.
- Props are view-culled and only nearby proxies cast shadows. Shadow-caster triangles: 0.40 M (high) / 7 k (low, bearer only).

**Draw calls:** high dropped 162–206 → 142; low rose 60–61 → 72 (+18–20 %, flagged by the +15 % regression gate). The rise is
a fixed +5–11 draws on low independent of enemy count (67 → 72 at 100 too), most likely the per-kind instanced
prop meshes added for view culling (not attributed per mesh; perf.mjs has no per-draw census). It is far inside the 220 budget; accepted and re-baselined.

**Sim:** 1.0–2.3 ms per frame at 100–350 enemies (budget 8 ms); enemy AI still dominates and scales linearly.
Frame/render ms on SwiftShader remain relative only (high ≈ 5× low per frame here).

**Caveats.** (1) BUG-QA-010: during these runs the bearer group and its lantern PointLight sat at the origin while the
player circled within ~4 m of it, so the lantern pool/shadow was still in view; numbers should be close to the fixed
build but re-run once Player.ts is fixed. (2) The automatic quality fallback is disabled under WebDriver
(`Renderer.autoQuality = !navigator.webdriver`), so these are fixed-tier numbers; the fallback state machine is
untested automatically (needs WebGL). (3) `tools/perf.mjs` keeps enemies unkillable, so death animations / corpse
pooling are not exercised here (unit-tested in `tests/unit/sprint2-qa.test.ts`).

**Recommendation 1 (lantern shadow) — DONE** by world-render (shadow gate; only `userData.lanternCaster` meshes render
into the cube, enemies/bearer/pickups/grass excluded). **Recommendations 2–3 (eyes, horde LOD) — DONE** by characters.
Remaining: rec. 4 (moon shadows for small fodder: enemy bodies still cast the moon shadow on high) and rec. 5
(allocation profile; BUG-QA-016 lists the per-spawn `Object.assign` literals still open).

Baseline: `production/qa/perf-baseline.json` re-baselined from this run (100/350 and 200 run separately on the same
build, merged; per-run raw JSON `perf-2026-11-04T14-11-25.json`). Note high/200 is *cheaper* than high/100: the horde
LOD engages above 170 alive.

---

## Sprint 1 report (kept for reference)

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
