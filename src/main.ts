import { Game } from './game/Game';
import { loadAssets } from './render/Assets';

declare global {
  interface Window {
    __game?: Game;
  }
}

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
async function boot(): Promise<void> {
  const bar = document.createElement('div');
  bar.className = 'boot-loader';
  bar.innerHTML = '<div class="boot-title">Last Lantern</div><div class="boot-track"><div class="boot-fill"></div></div>';
  document.getElementById('ui-root')?.appendChild(bar);
  const fill = bar.querySelector<HTMLElement>('.boot-fill')!;
  await loadAssets((f) => (fill.style.transform = `scaleX(${f})`));
  bar.remove();
  const game = new Game(canvas);
  window.__game = game;
}

boot().catch((err) => {
  console.error(err);
  const root = document.getElementById('ui-root');
  if (root) {
    root.innerHTML = `<div class="fatal"><h2>The lantern would not light.</h2><p>Your browser could not start WebGL. Try updating your browser or graphics drivers.</p><pre>${String(err)}</pre></div>`;
  }
});
