import { Game } from './game/Game';

declare global {
  interface Window {
    __game?: Game;
  }
}

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
try {
  const game = new Game(canvas);
  window.__game = game;
} catch (err) {
  console.error(err);
  const root = document.getElementById('ui-root');
  if (root) {
    root.innerHTML = `<div class="fatal"><h2>The lantern would not light.</h2><p>Your browser could not start WebGL. Try updating your browser or graphics drivers.</p><pre>${String(err)}</pre></div>`;
  }
}
