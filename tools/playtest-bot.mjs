// Playtest bot: drives full runs of the PRODUCTION build in headless Chromium with a simple steering AI,
// auto-picks upgrades, samples metrics every 30 s of game time and records the outcome.
//
// Usage:
//   node tools/playtest-bot.mjs [--runs 3] [--substeps 3] [--skill 0.8] [--biome biome_pines] [--meta none|mid|full]
//                               [--maxTime 1080] [--wallLimit 1500] [--renderMs 4000] [--out production/qa] [--start 1]
//                               [--endless] [--shots <dir>] [--seed <n>]
//   env DIST=<build dir> (default dist)
// Outputs: <out>/playtest-<n>.json per run and <out>/playtest-summary.md.
//
// The bot is NOT a balance oracle — it is a consistent, mediocre-to-decent player. Compare runs against each
// other (before/after a tuning change) rather than reading absolute numbers. SwiftShader is slow (~1 rendered fps),
// so the bot fast-forwards by running `substeps` extra fixed-dt (1/30 s) simulation steps per browser frame (same
// Game.updateRun the real loop calls — no timeScale tunnelling) and draws a frame only every `renderMs` of wall time.
import { mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { serveDist, launchBrowser, saveInitScript, qaSave, parseArgs, waitForGame } from './qa-lib.mjs';

const opts = parseArgs(process.argv.slice(2), {
  runs: 3, substeps: 3, skill: 0.8, biome: 'biome_pines', meta: 'none', maxTime: 1080, wallLimit: 1500,
  renderMs: 4000, out: 'production/qa', start: 1, endless: false, shots: '', seed: 0, width: 960, height: 540,
});
const outDir = resolve(opts.out);
mkdirSync(outDir, { recursive: true });
if (opts.shots) mkdirSync(resolve(opts.shots), { recursive: true });

const META = {
  none: {},
  mid: { m_light: 2, m_might: 2, m_speed: 1, m_regen: 2, m_armor: 1, m_magnet: 1, m_growth: 2, m_greed: 2 },
  full: { m_light: 5, m_might: 5, m_speed: 3, m_regen: 4, m_armor: 3, m_magnet: 3, m_growth: 5, m_greed: 5, m_cooldown: 4, m_revival: 1, m_choice: 1, m_reroll: 3 },
};

// ---------------------------------------------------------------------------------------------- in-page bot
/** Runs inside the page. Hooks Input.update (called once per frame before game logic) to steer and pick. */
function installBot(cfg) {
  const g = window.__game;
  if (!g) throw new Error('window.__game missing');
  const bot = {
    cfg, samples: [], timeline: [], picks: [], done: false, outcome: null, error: null,
    frames: 0, renders: 0, wallStart: performance.now(),
    dmgTotal: 0, dmgWindow: 0, hits: 0, worstWindow: { t: 0, dmg: 0 }, nextSample: 30, lastDealt: 0, lastKills: 0,
    lowLight: 1, lowLightAt: 0, orbit: 1, rng: cfg.seed || 12345,
  };
  window.__bot = bot;
  const rand = () => {
    // xorshift32 — deterministic bot noise independent from the game's Rng
    let x = bot.rng;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    bot.rng = x >>> 0;
    return bot.rng / 4294967296;
  };
  const mark = (type, extra = {}) => bot.timeline.push({ t: +g.run.elapsed.toFixed(1), type, ...extra });

  // --- render throttle: simulation runs every frame, a frame is drawn only every `renderMs` of wall time
  const origRender = g.renderer.render.bind(g.renderer);
  let lastDraw = 0;
  g.renderer.render = (time, dt) => {
    const now = performance.now();
    if (cfg.renderMs <= 0 || now - lastDraw >= cfg.renderMs || bot.forceDraw) {
      lastDraw = now;
      bot.forceDraw = false;
      bot.renders++;
      origRender(time, dt);
    }
  };

  // --- telemetry from the event bus
  g.events.on('player:damaged', ({ amount }) => { bot.dmgTotal += amount; bot.dmgWindow += amount; bot.hits++; });
  g.events.on('boss:spawned', ({ defId }) => mark('boss_spawned', { defId }));
  g.events.on('boss:killed', ({ defId }) => mark('boss_killed', { defId }));
  g.events.on('boss:enraged', ({ defId }) => mark('boss_enraged', { defId }));
  g.events.on('weapon:evolved', ({ from, to }) => mark('evolved', { from, to }));
  g.events.on('chest:opened', () => mark('chest'));
  g.events.on('run:ended', ({ victory }) => mark('run_ended', { victory }));
  let lastRevival = g.run.stats.revival;
  // damage attribution: wrap the avatar's damage() and blame the closest enemy (melee/contact) or 'ranged/hazard'
  bot.dmgBy = {};
  const origDamage = g.player.damage.bind(g.player);
  g.player.damage = (amount, ctx) => {
    const before = g.player.lightValue;
    origDamage(amount, ctx);
    const taken = before - g.player.lightValue;
    if (taken <= 0) return;
    let best = 9, src = 'ranged/hazard';
    for (const e of g.enemies.list) {
      if (!e.active) continue;
      const d = Math.hypot(e.x - g.player.x, e.z - g.player.z) - e.radius;
      if (d < best && d < 1.2) { best = d; src = e.def.id + (e.elite ? '*' : ''); }
    }
    const b = (bot.dmgBy[src] ??= { hits: 0, dmg: 0, first: Math.round(g.run.elapsed) });
    b.hits++;
    b.dmg += taken;
  };
  // elite spawns (no event): watch the list for new elites
  const seenElite = new Set();

  const scoreChoice = (c) => {
    const run = g.run;
    let s = 3;
    if (c.kind === 'weapon-up') {
      const w = run.weapons.find((x) => x.def.id === c.id);
      s = 10 + (w && w.level + 1 === w.def.maxLevel ? 4 : 0);
    } else if (c.kind === 'weapon-new') s = run.weapons.length < 4 ? 11 : run.weapons.length < 6 ? 6 : 0;
    else if (c.kind === 'passive') {
      const pairs = run.weapons.some((w) => w.def.evolvesWith === c.id);
      s = pairs ? 9.5 : ['flint', 'clockwork', 'bellows', 'wick', 'twin', 'tallow'].includes(c.id) ? 8 : 6;
    } else if (c.kind === 'heal') s = g.player.lightValue / run.stats.maxLight < 0.6 ? 9 : 2;
    return s + rand() * 2 * (1 - cfg.skill + 0.2);
  };

  const handleOverlay = () => {
    if (g.levelMode === 'chest') return g.closeChest();
    if (g.levelMode === 'dawn') {
      mark('dawn_choice', { pick: cfg.endless ? 'endless' : 'dawn' });
      return g.chooseUpgrade(cfg.endless ? 1 : 0);
    }
    const choices = g.pendingChoices ?? [];
    if (!choices.length) return g.chooseUpgrade(0);
    let best = 0;
    let bestS = -Infinity;
    choices.forEach((c, i) => {
      const s = scoreChoice(c);
      if (s > bestS) { bestS = s; best = i; }
    });
    const c = choices[best];
    bot.picks.push({ t: +g.run.elapsed.toFixed(1), level: g.run.level - g.run.pendingLevelUps + 1, id: c.id, kind: c.kind, offered: choices.map((x) => x.id) });
    g.chooseUpgrade(best);
  };

  const steer = () => {
    const p = g.player;
    const run = g.run;
    const inp = g.input;
    const lf = p.lightValue / run.stats.maxLight;
    let fx = 0, fz = 0, threat = 0, cx = 0, cz = 0, cn = 0;
    const R = 5 + 4 * cfg.skill; // awareness radius
    for (const e of g.enemies.list) {
      if (!e.active) continue;
      const dx = p.x - e.x;
      const dz = p.z - e.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < 144) { cx += e.x; cz += e.z; cn++; }
      if (d2 < R * R) {
        const w = (e.def.boss ? 6 : 1) * (e.elite ? 2 : 1) / Math.max(0.25, d2);
        fx += dx * w; fz += dz * w; threat += w;
      }
    }
    // telegraphed hazards (boss slams, exploder blasts): step out of the circle
    const hz = g.enemies.hazards;
    if (Array.isArray(hz)) for (const h of hz) {
      if (!h.active) continue;
      const dx = p.x - h.x;
      const dz = p.z - h.z;
      const d = Math.hypot(dx, dz);
      if (d < h.r + 1) { const w = 3 / Math.max(0.3, d); fx += (dx / (d || 1)) * w; fz += (dz / (d || 1)) * w; threat += w; }
    }
    let mx = 0, mz = 0;
    // drift away from the local crowd centroid (kiting) — gentle, the per-enemy repulsion does the dodging
    if (cn > 0) {
      const ux = p.x - cx / cn;
      const uz = p.z - cz / cn;
      const n = Math.hypot(ux, uz) || 1;
      const k = 0.5 * Math.min(1, cn / 30);
      mx += (ux / n) * k;
      mz += (uz / n) * k;
    }
    // pickups: score = value / distance (players sweep ember trails); chests always, oil when hurt
    let bestS = 0, ax = 0, az = 0;
    for (const pk of g.pickups.list) {
      if (!pk.active || pk.magnetized) continue;
      const dx = pk.x - p.x;
      const dz = pk.z - p.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d > 18) continue;
      let v = pk.kind === 'ember' ? 1 + Math.min(pk.value, 20) * 0.2 : pk.kind === 'ash' ? 1 : pk.kind === 'chest' ? 40 : pk.kind === 'beacon' ? 15 : lf < 0.7 ? 30 : 0.5;
      const sc = v / (d + 1.5);
      if (sc > bestS) { bestS = sc; ax = dx; az = dz; }
    }
    if (bestS > 0) {
      const n = Math.hypot(ax, az) || 1;
      const greed = 1.2 / (1 + threat * 2.5 * cfg.skill);
      mx += (ax / n) * greed;
      mz += (az / n) * greed;
    } else {
      mx += Math.cos(run.elapsed * 0.15) * 0.4;
      mz += Math.sin(run.elapsed * 0.15) * 0.4;
    }
    if (threat > 0) {
      const n = Math.hypot(fx, fz) || 1;
      const k = Math.min(3, threat * 4) * (0.6 + 0.6 * cfg.skill);
      const ux = fx / n;
      const uz = fz / n;
      mx += (ux - uz * bot.orbit * 0.7) * k;
      mz += (uz + ux * bot.orbit * 0.7) * k;
      if (rand() < 0.002) bot.orbit = -bot.orbit;
    }
    // imperfect reactions: a little noise, scaled by (1 - skill)
    mx += (rand() - 0.5) * (1 - cfg.skill);
    mz += (rand() - 0.5) * (1 - cfg.skill);
    const ml = Math.hypot(mx, mz);
    inp.moveX = ml > 0.05 ? mx / ml : 0;
    inp.moveZ = ml > 0.05 ? mz / ml : 0;
  };

  const sample = () => {
    const run = g.run;
    const t = run.elapsed;
    for (const e of g.enemies.list) if (e.active && e.elite && !seenElite.has(e.id)) { seenElite.add(e.id); mark('elite', { id: e.def.id }); }
    const lf = g.player.lightValue / run.stats.maxLight;
    if (lf < bot.lowLight) { bot.lowLight = lf; bot.lowLightAt = t; }
    if (run.stats.revival < lastRevival) { mark('revived'); lastRevival = run.stats.revival; }
    if (t < bot.nextSample) return;
    const wallS = (performance.now() - bot.wallStart) / 1000;
    bot.samples.push({
      t: Math.round(t), level: run.level, kills: run.kills, killsPerSec: +((run.kills - bot.lastKills) / 30).toFixed(1),
      light: Math.round(g.player.lightValue), maxLight: Math.round(run.stats.maxLight), lightFrac: +lf.toFixed(2),
      enemies: g.enemies.activeCount, dmgTaken: Math.round(bot.dmgWindow), dps: Math.round((run.damageDealt - bot.lastDealt) / 30),
      hpMul: +g.enemies.hpMul.toFixed(2), chestsOnGround: g.pickups.list.filter((p) => p.active && p.kind === 'chest').length, weapons: run.weapons.map((w) => `${w.def.id}:${w.level}`),
      relics: [...run.passives.entries()].map(([id, l]) => `${id}:${l}`), wallS: Math.round(wallS),
    });
    if (bot.dmgWindow > bot.worstWindow.dmg) bot.worstWindow = { t: Math.round(t), dmg: Math.round(bot.dmgWindow) };
    bot.dmgWindow = 0;
    bot.lastDealt = run.damageDealt;
    bot.lastKills = run.kills;
    bot.nextSample += 30;
  };

  const finish = (reason) => {
    if (bot.done) return;
    const run = g.run;
    bot.done = true;
    bot.outcome = {
      reason, state: g.state, victory: !!run.victory, died: !!g.player.dead, bossKilled: run.bossesKilled > 0,
      elapsed: +run.elapsed.toFixed(1), level: run.level, kills: run.kills, peakEnemies: run.peakEnemies,
      dmgTaken: Math.round(bot.dmgTotal), hits: bot.hits, lowestLight: +bot.lowLight.toFixed(2), lowestLightAt: Math.round(bot.lowLightAt),
      worst30s: bot.worstWindow, evolutions: run.evolutions.slice(), chests: run.chestsOpened, elites: run.elitesKilled,
      ashEarned: Math.round(run.ashEarned), weapons: run.weapons.map((w) => `${w.def.id}:${w.level}`),
      relics: [...run.passives.entries()].map(([id, l]) => `${id}:${l}`),
      damageTakenBy: Object.entries(bot.dmgBy).map(([src, v]) => ({ src, hits: v.hits, dmg: Math.round(v.dmg), first: v.first })).sort((a, b) => b.dmg - a.dmg),
      damageBySource: run.damageSummary().slice(0, 8).map((d) => ({ source: d.source, share: +d.share.toFixed(3) })),
      frames: bot.frames, renders: bot.renders, wallS: Math.round((performance.now() - bot.wallStart) / 1000),
    };
  };
  bot.finish = finish;

  const origUpdate = g.input.update.bind(g.input);
  g.input.update = () => {
    origUpdate();
    if (bot.done) return;
    bot.frames++;
    try {
      if (g.state === 'playing') {
        g.debug.timeScale = 1;
        steer();
        sample();
        // fixed-dt fast-forward: same entry point as Game.frame() uses while playing
        for (let k = 0; k < cfg.substeps && g.state === 'playing' && !bot.done; k++) {
          g.updateRun(1 / 30);
          sample();
        }
        if (g.run.elapsed >= cfg.maxTime) finish('time_limit');
      } else if (g.state === 'levelup') handleOverlay();
      else if (g.state === 'paused') g.togglePause(); // tab-visibility pauses in headless: resume
      else if (g.state === 'gameover') { sample(); finish(g.run.victory ? 'victory' : 'death'); }
    } catch (err) {
      bot.error = String(err && err.stack ? err.stack : err);
      finish('bot_error');
    }
  };
  return true;
}

// ---------------------------------------------------------------------------------------------- driver
async function playOne(browser, base, n) {
  const ctx = await browser.newContext({ viewport: { width: opts.width, height: opts.height } });
  const save = qaSave({ meta: META[opts.meta] ?? {}, unlocked: ['char_keeper', 'biome_pines', 'biome_marsh', 'biome_ruins'] });
  await ctx.addInitScript(saveInitScript(save));
  const page = await ctx.newPage();
  page.setDefaultTimeout(180_000);
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(base);
  await waitForGame(page);
  await page.waitForTimeout(800);
  // start through the real UI when possible (exercises menu → setup → start), else directly
  let viaUi = false;
  try {
    await page.click('[data-act=play]', { timeout: 4000 });
    await page.waitForTimeout(300);
    await page.click('[data-act=start]', { timeout: 4000 });
    viaUi = true;
  } catch { /* fall through */ }
  await page.evaluate((biome) => {
    const g = window.__game;
    if (g.state !== 'playing') { g.selectedBiome = biome; g.startRun(); }
  }, opts.biome);
  if (viaUi && opts.biome !== 'biome_pines') {
    // UI start used the default night; restart in the requested one
    await page.evaluate((biome) => { const g = window.__game; g.selectedBiome = biome; g.startRun(); }, opts.biome);
  }
  const cfg = { substeps: opts.substeps, skill: opts.skill, maxTime: opts.maxTime, renderMs: opts.renderMs, endless: !!opts.endless, seed: (opts.seed || 1000) + n };
  await page.evaluate(installBot, cfg);

  const wall0 = Date.now();
  let lastLog = 0;
  let nextShot = 300;
  let status;
  for (;;) {
    await page.waitForTimeout(2000);
    status = await page.evaluate(() => {
      const g = window.__game;
      const b = window.__bot;
      return { done: b.done, t: g.run.elapsed, state: g.state, level: g.run.level, kills: g.run.kills, alive: g.enemies.activeCount, light: Math.round(g.player.lightValue), err: b.error };
    });
    const wall = (Date.now() - wall0) / 1000;
    if (opts.shots && status.t >= nextShot && !status.done) {
      await page.evaluate(() => (window.__bot.forceDraw = true));
      await page.waitForTimeout(1500);
      await page.screenshot({ path: join(resolve(opts.shots), `playtest-${n}-${Math.round(status.t)}s.png`), timeout: 120_000 }).catch(() => console.log('  (screenshot timed out)'));
      nextShot += 300;
    }
    if (wall - lastLog > 30) {
      lastLog = wall;
      console.log(`  run ${n}: ${status.state} t=${status.t.toFixed(0)}s L${status.level} kills=${status.kills} alive=${status.alive} light=${status.light} (wall ${wall.toFixed(0)}s)`);
    }
    if (status.done) break;
    if (wall > opts.wallLimit) {
      await page.evaluate(() => window.__bot.finish('wall_limit'));
      break;
    }
  }
  if (opts.shots) {
    await page.evaluate(() => (window.__bot.forceDraw = true));
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(resolve(opts.shots), `playtest-${n}-end.png`), timeout: 120_000 }).catch(() => console.log('  (screenshot timed out)'));
  }
  const data = await page.evaluate(() => {
    const b = window.__bot;
    return { outcome: b.outcome, samples: b.samples, timeline: b.timeline, picks: b.picks, error: b.error, cfg: b.cfg };
  });
  await ctx.close();
  return { run: n, biome: opts.biome, meta: opts.meta, build: process.env.DIST ?? 'dist', date: new Date().toISOString(), consoleErrors: errors.slice(0, 20), ...data };
}

const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function summarize(results) {
  const lines = [];
  lines.push(`# Playtest bot summary`, '');
  lines.push(`Generated ${new Date().toISOString()} from every \`playtest-<n>.json\` in this folder. Bot: skill ${opts.skill}, ${opts.substeps} fixed 1/30 s substeps per frame.`, '');
  lines.push('| Run | Night | Meta | Outcome | Time | Level | Kills | Peak alive | Dmg taken | Lowest light | Worst 30 s | Evolutions | Errors |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    const o = r.outcome ?? {};
    lines.push(`| ${r.run} | ${r.biome} | ${r.meta} | ${o.reason ?? 'n/a'} | ${fmt(o.elapsed ?? 0)} | ${o.level ?? '-'} | ${o.kills ?? '-'} | ${o.peakEnemies ?? '-'} | ${o.dmgTaken ?? '-'} | ${Math.round((o.lowestLight ?? 0) * 100)}% @${fmt(o.lowestLightAt ?? 0)} | ${o.worst30s?.dmg ?? '-'} @${fmt(o.worst30s?.t ?? 0)} | ${(o.evolutions ?? []).join(', ') || '—'} | ${r.consoleErrors.length + (r.error ? 1 : 0)} |`);
  }
  lines.push('', '## Per-run curves (every 30 s)', '');
  for (const r of results) {
    lines.push(`### Run ${r.run}`, '', '| t | Lv | Kills | K/s | Alive | Light | Dmg taken (30 s) | DPS | Weapons |', '|---|---|---|---|---|---|---|---|---|');
    for (const s of r.samples) lines.push(`| ${fmt(s.t)} | ${s.level} | ${s.kills} | ${s.killsPerSec} | ${s.enemies} | ${s.light}/${s.maxLight} | ${s.dmgTaken} | ${s.dps} | ${s.weapons.join(' ')} |`);
    if (r.outcome?.damageTakenBy?.length) lines.push('', `Damage taken by: ${r.outcome.damageTakenBy.map((d) => `${d.src} ${d.dmg} (${d.hits} hits, first @${fmt(d.first)})`).join(' · ')}`);
    if (r.timeline.length) lines.push('', `Timeline: ${r.timeline.map((e) => `${fmt(e.t)} ${e.type}${e.to ? `→${e.to}` : ''}${e.id ? `:${e.id}` : ''}`).join(' · ')}`);
    if (r.error) lines.push('', '```', r.error, '```');
    if (r.consoleErrors.length) lines.push('', 'Console errors:', ...r.consoleErrors.map((e) => `- \`${e.slice(0, 200)}\``));
    lines.push('');
  }
  return lines.join('\n');
}

const server = await serveDist(process.env.DIST ?? 'dist');
const browser = await launchBrowser();
const results = [];
let failed = false;
try {
  for (let i = 0; i < opts.runs; i++) {
    const n = opts.start + i;
    console.log(`playtest run ${n}/${opts.start + opts.runs - 1} (${opts.biome}, meta=${opts.meta}, substeps=${opts.substeps})`);
    const r = await playOne(browser, server.url, n);
    results.push(r);
    writeFileSync(join(outDir, `playtest-${n}.json`), JSON.stringify(r, null, 2));
    const o = r.outcome ?? {};
    console.log(`  → ${o.reason} at ${fmt(o.elapsed ?? 0)}  L${o.level} kills=${o.kills} evolutions=${(o.evolutions ?? []).length} errors=${r.consoleErrors.length}`);
    if (r.error || r.consoleErrors.length) failed = true;
  }
} finally {
  await browser.close();
  await server.close();
}
// summary covers every run recorded in the folder (several invocations, e.g. fresh-save + full-meta batches)
const all = readdirSync(outDir)
  .filter((f) => /^playtest-\d+\.json$/.test(f))
  .map((f) => { try { return JSON.parse(readFileSync(join(outDir, f), 'utf8')); } catch { return null; } })
  .filter((r) => r && Array.isArray(r.samples))
  .sort((a, b) => a.run - b.run);
writeFileSync(join(outDir, 'playtest-summary.md'), summarize(all.length ? all : results));
console.log(`wrote ${results.length} run(s) to ${outDir}`);
process.exit(failed && process.env.QA_STRICT ? 1 : 0);
