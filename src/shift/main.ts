import * as THREE from 'three';
import { unlockAudio } from '../ui/feel';
import { ShiftHud } from './hud';
import { Kitchen } from './kitchen';
import { SideView } from './side-view';
import { StationView } from './station-view';
import { TimerBank } from './timer-bank';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLDivElement;
if (!canvas || !ui) throw new Error('index.html is missing #game or #ui');

const buildId = (import.meta.env.VITE_BUILD_ID ?? 'dev').slice(0, 7);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

const k = new Kitchen();
const station = new StationView(canvas, ui, k);
const side = new SideView(canvas, ui, k);
const timers = new TimerBank(ui, k);
const hud = new ShiftHud(
  ui,
  k,
  (prep: boolean) => {
    unlockAudio();
    hud.hideScreen();
    k.start(prep);
    showScene();
  },
  buildId,
);

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  station.resize(w, h);
  side.resize(w, h);
}
function showScene() {
  station.setVisible(k.scene === 'station');
  side.setVisible(k.scene !== 'station');
}
resize();
showScene();
window.addEventListener('resize', resize);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) k.pause();
  else k.resume();
});

let last = performance.now();
function frame(t: number) {
  const dt = Math.min(1 / 30, (t - last) / 1000);
  last = t;
  const now = t / 1000;
  k.update(dt);
  for (const ev of k.events) {
    if (ev.type === 'scene') showScene();
    station.handle(ev);
    side.handle(ev);
    hud.handle(ev, now);
    timers.handle(ev);
  }
  k.events.length = 0;
  hud.update(now);
  timers.update(now);
  if (k.scene === 'station') station.render(renderer, now);
  else side.render(renderer, dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Test hook for automated playtests (harmless in production).
(window as unknown as { __shift: unknown }).__shift = { k, station, side };
