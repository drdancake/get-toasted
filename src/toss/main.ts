import { unlockAudio } from '../ui/feel';
import { TossHud } from './hud';
import { TossSim } from './sim';
import { TossView } from './view';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLDivElement;
if (!canvas || !ui) throw new Error('index.html is missing #game or #ui');

const buildId = (import.meta.env.VITE_BUILD_ID ?? 'dev').slice(0, 7);
const sim = new TossSim();
const view = new TossView(canvas, sim);
const hud = new TossHud(
  ui,
  sim,
  () => {
    unlockAudio();
    hud.hideScreen();
    sim.start();
  },
  buildId,
);

window.addEventListener('resize', () => view.resize());
document.addEventListener('visibilitychange', () => {
  if (document.hidden) sim.pause();
  else sim.resume();
});

let last = performance.now();
function frame(t: number) {
  const dt = Math.min(1 / 30, (t - last) / 1000);
  last = t;
  const now = t / 1000;
  sim.update(dt);
  for (const ev of sim.events) {
    view.handle(ev);
    hud.handle(ev, now, view.project);
  }
  sim.events.length = 0;
  hud.update(now, view.project);
  view.render(now, dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Test hook for automated playtests (harmless in production).
(window as unknown as { __toss: unknown }).__toss = { sim, view };
