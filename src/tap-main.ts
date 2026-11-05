import { FRYERS, SLOTS_PER_FRYER } from './config/game';
import { LAYOUT } from './config/layout';
import { Game } from './game/game';
import { Station } from './render/scene';
import { Overlay } from './ui/overlay';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLDivElement;
if (!canvas || !ui) throw new Error('index.html is missing #game or #ui');

const buildId = (import.meta.env.VITE_BUILD_ID ?? 'dev').slice(0, 7);
const game = new Game();
const station = new Station(canvas);
const overlay = new Overlay(ui, game, {
  onFlavor: (f) => game.tapFlavor(f),
  onServe: () => game.serve(),
  onStart: () => {
    overlay.hideScreen();
    game.start();
  },
}, buildId);

// Fryer taps: the canvas only takes input inside the fryer band.
canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  const u = e.clientX / window.innerWidth;
  const v = e.clientY / window.innerHeight;
  const { v0, v1 } = LAYOUT.fryers;
  if (v < v0 || v > v1) return;
  const row = Math.min(FRYERS.length - 1, Math.floor(((v - v0) / (v1 - v0)) * FRYERS.length));
  let slot = 0;
  let bestDist = Infinity;
  LAYOUT.slotU.forEach((su, i) => {
    const d = Math.abs(u - su);
    if (d < bestDist) [bestDist, slot] = [d, i];
  });
  game.tapSlot(row * SLOTS_PER_FRYER + slot);
});

window.addEventListener('resize', () => station.resize());
document.addEventListener('visibilitychange', () => {
  if (document.hidden) game.pause();
  else game.resume();
});

let last = performance.now();
function frame(t: number) {
  const dt = Math.min(0.1, (t - last) / 1000);
  last = t;
  const now = t / 1000;
  game.update(dt);
  for (const ev of game.events) overlay.handle(ev, now);
  game.events.length = 0;
  overlay.update(now);
  station.render(game, now);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
