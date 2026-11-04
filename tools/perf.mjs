// Perf benchmark: production build in headless Chromium, N enemies + a full weapon loadout, per-frame timings
// and renderer.info draw calls / triangles, per system. Compares against a stored baseline and flags regressions.
//
// Usage:
//   node tools/perf.mjs [--counts 100,200,350] [--quality high] [--frames 90] [--warmup 40] [--width 1280 --height 720]
//                       [--out production/qa] [--baseline production/qa/perf-baseline.json] [--update-baseline] [--strict]
//                       [--renderEvery N]  (draw only every Nth frame; default 1 on GPU, 4 on SwiftShader — sim runs every frame)
//   env DIST=<build dir> (default dist), QA_GPU=1 to use the real GPU instead of SwiftShader.
//
// SwiftShader numbers are RELATIVE: frame/render ms are dominated by software rasterisation. Sim (CPU) ms and draw
// calls ARE meaningful and are what the regression gate looks at.
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { serveDist, launchBrowser, saveInitScript, qaSave, parseArgs, waitForGame } from './qa-lib.mjs';

const opts = parseArgs(process.argv.slice(2), {
  counts: '100,200,350', quality: 'high', frames: 90, warmup: 40, width: 1280, height: 720, out: 'production/qa',
  baseline: 'production/qa/perf-baseline.json', 'update-baseline': false, strict: false, renderEvery: process.env.QA_GPU ? 1 : 4,
});
const counts = String(opts.counts).split(',').map(Number).filter((n) => n > 0);
const qualities = String(opts.quality).split(',');
const outDir = resolve(opts.out);
mkdirSync(outDir, { recursive: true });

/**
 * Budgets (per frame, at the given enemy count). Sim budget is for the CPU-side game update on this class of
 * machine; drawCalls is engine-agnostic and the most stable signal. Exceeding a budget is reported; --strict fails.
 */
const BUDGET = { drawCalls: 220, simMs350: 8, regressDrawCalls: 0.15, regressSimMs: 0.35 };

/** In-page: sets up the scenario and measures. */
async function scenario(cfg) {
  const g = window.__game;
  const r = g.renderer.renderer;
  const raf = () => new Promise((res) => requestAnimationFrame(res));
  // --- run + god mode + no director (static enemy count)
  if (g.state !== 'playing') g.startRun();
  g.director.update = () => {};
  g.player.invuln = 1e9;
  g.debug.timeScale = 1;
  g.enemies.clear();
  g.pickups.clear();
  // --- full loadout: 6 base weapons, max level
  const defs = (window.__weapons ?? []).filter((w) => !w.hidden && !w.unlock);
  const want = ['ember_bolt', 'cinder_halo', 'spark_chain', 'brazier', 'flare_nova', 'vesper_bell'];
  const pickDefs = [...want.map((id) => defs.find((d) => d.id === id)).filter(Boolean), ...defs].filter((d, i, a) => a.indexOf(d) === i).slice(0, 6);
  for (const w of g.run.weapons) w.dispose(g);
  g.run.weapons.length = 0;
  for (const d of pickDefs) {
    const inst = d.create(g);
    while (inst.level < d.maxLevel) { inst.level++; inst.onLevelUp?.(g); }
    g.run.weapons.push(inst);
  }
  g.ui.refreshSlots?.();
  // --- enemies: mixed types in a ring, unkillable so the count stays fixed
  const ids = Object.keys(window.__enemyIds ?? {}).length ? Object.keys(window.__enemyIds) : ['shade', 'crawler', 'wisp', 'brute', 'stalker', 'spitter', 'bog_lurker', 'knight', 'gloam_jelly', 'cinder_tick', 'hollow_warden'];
  const spawnTo = (n) => {
    let guard = 0;
    while (g.enemies.activeCount < n && guard++ < n * 3) {
      const i = g.enemies.activeCount;
      const a = (i * 2.399) % (Math.PI * 2);
      const rr = 5 + (i % 17) * 0.9;
      const e = g.enemies.spawn(ids[i % ids.length], g.player.x + Math.cos(a) * rr, g.player.z + Math.sin(a) * rr);
      if (e) { e.hp = e.maxHp = 1e12; }
      g.enemies.activeCount = g.enemies.list.filter((x) => x.active).length;
    }
  };
  spawnTo(cfg.count);

  // --- instrumentation (instance-level wraps; frame() calls this.updateRun / this.renderer.render)
  const acc = { sim: 0, simN: 0, enemies: 0, projectiles: 0, weapons: 0, pickups: 0, fx: 0, render: 0, calls: 0, tris: 0, n: 0 };
  const wrap = (obj, key, slot) => {
    const orig = obj[key].bind(obj);
    obj[key] = (...a) => { const t0 = performance.now(); const v = orig(...a); acc[slot] += performance.now() - t0; return v; };
    return () => (obj[key] = orig);
  };
  const origRun = g.updateRun.bind(g);
  g.updateRun = (dt) => { acc.simN++; origRun(dt); };
  const undo = [
    () => (g.updateRun = origRun),
    wrap(g, 'updateRun', 'sim'), wrap(g.enemies, 'update', 'enemies'), wrap(g.projectiles, 'update', 'projectiles'),
    wrap(g.pickups, 'update', 'pickups'), wrap(g.fx, 'update', 'fx'),
  ];
  for (const w of g.run.weapons) undo.push(wrap(w, 'update', 'weapons'));
  r.info.autoReset = false;
  const origRender = g.renderer.render.bind(g.renderer);
  let rf = 0;
  g.renderer.render = (t, dt) => {
    if (cfg.renderEvery > 1 && ++rf % cfg.renderEvery !== 0) return;
    r.info.reset();
    const t0 = performance.now();
    origRender(t, dt);
    acc.render += performance.now() - t0;
    acc.calls += r.info.render.calls;
    acc.tris += r.info.render.triangles;
    acc.n++;
  };
  // --- player circles slowly so enemies keep chasing (realistic movement + spatial hash churn)
  let ang = 0;
  const origInput = g.input.update.bind(g.input);
  g.input.update = () => { origInput(); ang += 0.02; g.input.moveX = Math.cos(ang); g.input.moveZ = Math.sin(ang); };

  for (let i = 0; i < cfg.warmup; i++) { await raf(); spawnTo(cfg.count); if (g.state !== 'playing') { g.state = 'playing'; } }
  for (const k in acc) acc[k] = 0;
  const heap0 = performance.memory?.usedJSHeapSize ?? 0;
  const intervals = [];
  let last = performance.now();
  for (let i = 0; i < cfg.frames; i++) {
    await raf();
    const now = performance.now();
    intervals.push(now - last);
    last = now;
    if (g.state === 'levelup') g.chooseUpgrade(0);
  }
  const heap1 = performance.memory?.usedJSHeapSize ?? 0;
  const n = Math.max(1, acc.n);
  const simN = Math.max(1, acc.simN);
  intervals.sort((a, b) => a - b);
  const pct = (p) => intervals[Math.min(intervals.length - 1, Math.floor(p * intervals.length))];
  const res = {
    count: cfg.count, renderedFrames: acc.n, alive: g.enemies.activeCount, frames: intervals.length,
    frameMsAvg: +(intervals.reduce((s, x) => s + x, 0) / intervals.length).toFixed(2), frameMsP50: +pct(0.5).toFixed(2), frameMsP95: +pct(0.95).toFixed(2),
    simMs: +(acc.sim / simN).toFixed(3), enemiesMs: +(acc.enemies / simN).toFixed(3), weaponsMs: +(acc.weapons / simN).toFixed(3),
    projectilesMs: +(acc.projectiles / simN).toFixed(3), pickupsMs: +(acc.pickups / simN).toFixed(3), fxMs: +(acc.fx / simN).toFixed(3),
    renderMs: +(acc.render / n).toFixed(2), drawCalls: Math.round(acc.calls / n), triangles: Math.round(acc.tris / n),
    programs: r.info.programs?.length ?? 0, geometries: r.info.memory.geometries, textures: r.info.memory.textures,
    heapDeltaKB: Math.round((heap1 - heap0) / 1024), heapMB: Math.round(heap1 / 1048576),
    effectiveQuality: g.renderer.effectiveQuality, weapons: g.run.weapons.map((w) => `${w.def.id}:${w.level}`),
  };
  // static triangle budget per visible mesh (one main pass; shadow passes multiply casters)
  const groups = new Map();
  g.scene.traverseVisible((o) => {
    if (!o.isMesh && !o.isPoints && !o.isLine) return;
    const geo = o.geometry;
    if (!geo) return;
    const per = (geo.index ? geo.index.count : geo.attributes.position?.count ?? 0) / 3;
    const inst = o.isInstancedMesh ? o.count : geo.isInstancedBufferGeometry ? geo.instanceCount ?? 1 : 1;
    const key = (o.name || o.parent?.name || o.geometry.name || o.material?.type || o.type) + (o.castShadow ? ' [shadow]' : '');
    const cur = groups.get(key) ?? { key, tris: 0, meshes: 0, instances: 0 };
    cur.tris += per * inst;
    cur.meshes++;
    cur.instances += inst;
    groups.set(key, cur);
  });
  res.topMeshes = [...groups.values()].sort((a, b) => b.tris - a.tris).slice(0, 12).map((x) => ({ ...x, tris: Math.round(x.tris) }));
  res.shadowCasterTris = [...groups.values()].filter((x) => x.key.endsWith('[shadow]')).reduce((t, x) => t + x.tris, 0) | 0;
  res.lights = { point: 0, pointShadow: 0, dir: 0, dirShadow: 0 };
  g.scene.traverse((o) => {
    if (o.isPointLight) { res.lights.point++; if (o.castShadow) res.lights.pointShadow++; }
    if (o.isDirectionalLight) { res.lights.dir++; if (o.castShadow) res.lights.dirShadow++; }
  });
  for (const u of undo.reverse()) u();
  g.renderer.render = origRender;
  g.input.update = origInput;
  r.info.autoReset = true;
  return res;
}

const server = await serveDist(process.env.DIST ?? 'dist');
const browser = await launchBrowser();
const rows = [];
const errors = [];
try {
  for (const quality of qualities) {
    for (const count of counts) {
      const ctx = await browser.newContext({ viewport: { width: opts.width, height: opts.height } });
      await ctx.addInitScript(saveInitScript(qaSave({ settings: { ...qaSave().settings, quality } })));
      const page = await ctx.newPage();
      page.setDefaultTimeout(180_000);
  page.setDefaultTimeout(180_000);
      page.on('pageerror', (e) => errors.push(String(e)));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      await page.goto(server.url);
      await waitForGame(page);
      await page.waitForTimeout(600);
      const res = await page.evaluate(scenario, { count, frames: opts.frames, warmup: opts.warmup, renderEvery: opts.renderEvery });
      res.quality = quality;
      if (count === counts[counts.length - 1]) await page.screenshot({ path: join(outDir, `perf-${quality}-${count}.png`), timeout: 180_000 }).catch(() => console.log('  (screenshot timed out)'));
      rows.push(res);
      console.log(`${quality} ${String(count).padStart(3)} enemies: frame ${res.frameMsAvg} ms (p95 ${res.frameMsP95}) | sim ${res.simMs} ms [enemies ${res.enemiesMs}, weapons ${res.weaponsMs}, proj ${res.projectilesMs}, fx ${res.fxMs}] | render ${res.renderMs} ms | ${res.drawCalls} draws, ${(res.triangles / 1000).toFixed(0)}k tris | heap Δ ${res.heapDeltaKB} KB`);
      await ctx.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
}

// ------------------------------------------------------------------ regression check
const baselinePath = resolve(opts.baseline);
const baseline = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, 'utf8')) : null;
const flags = [];
for (const r of rows) {
  if (r.drawCalls > BUDGET.drawCalls) flags.push(`BUDGET ${r.quality}/${r.count}: ${r.drawCalls} draw calls > ${BUDGET.drawCalls}`);
  if (r.count >= 350 && r.simMs > BUDGET.simMs350) flags.push(`BUDGET ${r.quality}/${r.count}: sim ${r.simMs} ms > ${BUDGET.simMs350} ms`);
  const b = baseline?.rows?.find((x) => x.quality === r.quality && x.count === r.count);
  if (!b) continue;
  if (r.drawCalls > b.drawCalls * (1 + BUDGET.regressDrawCalls)) flags.push(`REGRESSION ${r.quality}/${r.count}: draw calls ${b.drawCalls} → ${r.drawCalls}`);
  if (r.simMs > b.simMs * (1 + BUDGET.regressSimMs) && r.simMs - b.simMs > 0.5) flags.push(`REGRESSION ${r.quality}/${r.count}: sim ${b.simMs} → ${r.simMs} ms`);
}
const report = { date: new Date().toISOString(), build: process.env.DIST ?? 'dist', gl: process.env.QA_GPU ? 'gpu' : 'swiftshader', viewport: `${opts.width}x${opts.height}`, budget: BUDGET, rows, flags, errors: errors.slice(0, 20) };
const stamp = report.date.replace(/[:.]/g, '-').slice(0, 19);
writeFileSync(join(outDir, `perf-${stamp}.json`), JSON.stringify(report, null, 2));
writeFileSync(join(outDir, 'perf-latest.json'), JSON.stringify(report, null, 2));
if (opts['update-baseline'] || !baseline) {
  writeFileSync(baselinePath, JSON.stringify(report, null, 2));
  console.log(`baseline ${baseline ? 'updated' : 'created'}: ${baselinePath}`);
}
if (flags.length) console.log('\nFLAGS:\n  ' + flags.join('\n  '));
else console.log('\nno budget violations or regressions');
if (errors.length) console.log('\nPAGE ERRORS:\n  ' + errors.join('\n  '));
process.exit(opts.strict && (flags.length || errors.length) ? 1 : 0);
