import '@fontsource/fredoka/500.css';
import '@fontsource/fredoka/600.css';
import '@fontsource/fredoka/700.css';
import '@fontsource/nunito/400.css';
import '@fontsource/nunito/600.css';
import '@fontsource/nunito/800.css';
import './ui/style.css';
import { Game } from './game/Game';
import { Models } from './render/Models';
import { KITES } from './data/kites';
import { BOONS } from './data/boons';
import { BIOMES } from './data/biomes';

/**
 * Boot: load optional GLB overrides, build the game, start the frame loop, expose automation hooks.
 *
 * window.__game (automation / smoke / balance probes):
 *   .state                       'menu' | 'playing' | 'boon' | 'paused' | 'dying' | 'results'
 *   .run                         current Run (flight, scoring, world, mods, boons, shields, ended)
 *   .startRun({daily?, seed?})   start a run (deterministic with a seed)
 *   .simulate(sec, mode, autoBoon)  fixed-step fast-forward: mode 'auto' (autopilot) | 'input' | {steerX, steerY, dive}
 *   .manual = true               stop the frame loop from stepping the sim (render only) — use with simulate()
 *   .chooseBoon(i|id) .pause() .resume() .endRun(cause) .toMenu() .openShop('kites'|'upgrades')
 *   .renderFrame(dt)             push the current state to the views and render once
 *   .save / .ui / .renderer / .rig / .fx / .env / .audio / .models
 */
async function boot(): Promise<void> {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const ui = document.getElementById('ui') as HTMLElement;
  const models = new Models();
  await models.load(import.meta.env.BASE_URL);
  const game = new Game(canvas, ui, models);
  const w = window as unknown as Record<string, unknown>;
  w.__game = game;
  w.__data = { KITES, BOONS, BIOMES };
  document.getElementById('boot')?.remove();
  const loop = (t: number): void => {
    game.frame(t);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

boot().catch((err) => {
  console.error(err);
  const b = document.getElementById('boot');
  if (b) b.textContent = 'The winds are still — WebGL2 is required.';
});
