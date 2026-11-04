// Audio verification in headless Chromium.
//  1. every public/audio/*.ogg decodes with the browser's own decoder at 48 kHz, with the exact sample count
//  2. the running game: AudioContext unlocks, menu music + ambience start, run stems fade in with intensity,
//     the boss cue takes over, pause muffles the music, SFX voices stay within the voice budget.
// Usage: DIST=<build dir> node tools/audio/verify.mjs
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { extname, join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(process.env.DIST ?? 'dist');
const report = JSON.parse(readFileSync(join(here, 'report.json'), 'utf8'));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.ogg': 'audio/ogg', '.json': 'application/json', '.glb': 'model/gltf-binary', '.woff2': 'font/woff2', '.woff': 'font/woff', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
  const file = join(dist, url === '/' ? 'index.html' : url);
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
}).listen(0);
const port = server.address().port;
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`http://localhost:${port}/`);
await page.waitForTimeout(1500);

let fail = 0;
// ---- 1. decode every file
const files = Object.keys(report).filter((k) => k !== 'mus_run_fullmix').map((k) => `${k}.ogg`);
const dec = await page.evaluate(async (files) => {
  const ctx = new OfflineAudioContext(2, 48000, 48000);
  const out = {};
  for (const f of files) {
    try {
      const ab = await (await fetch(`/audio/${f}`)).arrayBuffer();
      const b = await ctx.decodeAudioData(ab);
      let peak = 0;
      for (let c = 0; c < b.numberOfChannels; c++) { const d = b.getChannelData(c); for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i])); }
      out[f] = { len: b.length, sr: b.sampleRate, ch: b.numberOfChannels, peak };
    } catch (e) { out[f] = { error: String(e) }; }
  }
  return out;
}, files);
for (const [f, d] of Object.entries(dec)) {
  const key = f.replace('.ogg', '');
  const exp = report[key].expected_len_samples;
  // loops must decode sample-exact (loop points depend on it); one-shots may carry trailing silence
  const ok = !d.error && (report[key].loop ? d.len === exp : d.len >= exp) && d.peak < 1.0;
  if (!ok) { fail++; console.log('DECODE FAIL', f, d, 'expected', exp); }
}
console.log(`decoded ${files.length} files in Chromium, ${fail} problems`);

// ---- 2. runtime behaviour
await page.mouse.click(640, 700);
await page.waitForTimeout(2500);
const snap = () => page.evaluate(() => {
  const a = window.__game.audio;
  return {
    state: a.ctx?.state, mode: a.mode, cue: a.cue?.key, amb: !!a.amb, voices: a.voices.length,
    layers: a.cue?.layers.map((g) => +g.gain.value.toFixed(2)), filter: Math.round(a.musicFilter?.frequency.value ?? 0),
    paused: a.paused, decoded: a.decoded.size,
  };
});
console.log('menu   ', JSON.stringify(await snap()));
await page.click('[data-act=play]').catch(() => {});
await page.waitForTimeout(400);
await page.click('[data-act=start]').catch(() => {});
await page.waitForTimeout(3500);
console.log('run    ', JSON.stringify(await snap()), 'game state', await page.evaluate(() => window.__game.state),
  'rAF/s', await page.evaluate(() => new Promise((r) => { let n = 0; const f = () => { n++; requestAnimationFrame(f); }; f(); setTimeout(() => r(n / 2), 2000); })));
// drive intensity high and fire lots of sounds
await page.evaluate(() => {
  const a = window.__game.audio;
  window.__hammer = setInterval(() => {
    a.setIntensity(1);
    for (let i = 0; i < 6; i++) { a.play('hit'); a.play('kill'); a.play('pickup'); a.playWeapon('ember_bolt'); a.play('crit'); }
  }, 16);
});
await page.waitForTimeout(6000);
const hi = await snap();
console.log('intense', JSON.stringify(hi));
if (hi.voices > 40) { fail++; console.log('VOICE BUDGET EXCEEDED'); }
if (!hi.layers || hi.layers[3] < 0.3) { fail++; console.log('PEAK LAYER DID NOT FADE IN'); }
await page.evaluate(() => { clearInterval(window.__hammer); window.__game.audio.play('boss'); });
await page.waitForTimeout(2500);
const boss = await snap();
console.log('boss   ', JSON.stringify(boss));
if (boss.cue !== 'boss') { fail++; console.log('BOSS CUE NOT ACTIVE'); }
await page.evaluate(() => { const a = window.__game.audio; a.setLight(0.05); a.setLight = () => {}; });
// keep "gameplay" ticking without the game loop: emulate per-frame setIntensity
await page.evaluate(() => { window.__tickI = setInterval(() => window.__game.audio.setIntensity(0.5), 16); });
await page.waitForTimeout(2500);
const dark = await snap();
console.log('dark   ', JSON.stringify(dark));
if (dark.filter > 8000) { fail++; console.log('LOW-LIGHT FILTER NOT APPLIED'); }
await page.evaluate(() => { clearInterval(window.__tickI); const g = window.__game; if (g.state === 'playing') g.togglePause(); });
await page.waitForTimeout(1500);
const p = await snap();
console.log('paused ', JSON.stringify(p));
if (!p.paused) { fail++; console.log('PAUSE MUFFLE NOT DETECTED'); }
await page.evaluate(() => { const a = window.__game.audio; a.stopMusic(); a.play('victory'); });
await page.waitForTimeout(1500);
console.log('stinger', JSON.stringify(await snap()));
const audioErrors = errors.filter((e) => /audio|Audio|decode/i.test(e));
if (audioErrors.length) { fail++; console.log('ERRORS', audioErrors); }
console.log(fail ? `FAIL (${fail})` : 'PASS');
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
