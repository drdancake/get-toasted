import * as THREE from 'three';
import { unlockAudio } from '../ui/feel';
import { Cabinet } from './cabinet';
import { ShiftHud } from './hud';
import { Kitchen } from './kitchen';
import { ExpoView } from './expo-view';
import { LadleView, MascarponeView } from './ladle-view';
import { BoxFocus } from './box-focus';
import { SharpieView } from './sharpie-view';
import { Feedback } from '../ui/feedback';
import { resetPrompts } from '../ui/prompt';
import { qualityAt } from '../game/doneness';
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
const cabinet = new Cabinet();
const station = new StationView(canvas, ui, k);
const side = new SideView(canvas, ui, k);
const timers = new TimerBank(ui, k);
const expo = new ExpoView(ui, k);
const hud = new ShiftHud(
  ui,
  k,
  (prep: boolean) => {
    unlockAudio();
    // On the cabinet with the coin gate on, a run costs a credit.
    if (!cabinet.useCredit()) return hud.needCoin();
    hud.hideScreen();
    resetPrompts();
    k.start(prep);
    showScene();
  },
  buildId,
  cabinet,
);

// The supplies dock onto the plating table: drop paper and cups on the real boxes, tap one to Sharpie it.
expo.boxAtPoint = (x, y) => side.boxAtScreen(x, y);
// The Sharpie: tap an empty box (on the table or at the pass) and trace the guest's name on its lid.
const sharpie = new SharpieView(ui, k);
expo.onLabel = (box) => sharpie.show(box);
side.onBoxTap = (box) => sharpie.show(box);
// Tap the marinara or ranch pan to go ladle cups (the mascarpone comes pre-portioned).
const ladle = new LadleView(ui, k);
// The box close-up: arrange, dress, shut the lid.
const boxFocus = new BoxFocus(ui, k);
side.onBoxFocus = (box) => boxFocus.show(box);
expo.onFocus = (box) => boxFocus.show(box);
// The pass drops straight into the boxes on the table row.
side.boxUnder = (x, y) => expo.boxUnder(x, y);
side.hoverBox = (box) => expo.hover(box);
side.boxRect = (id) => expo.boxRect(id);
// Box done and nothing left in the bowl: back to the fryers.
boxFocus.onClose = () => {
  if (k.scene === 'pass' && k.passDone()) window.setTimeout(() => k.scene === 'pass' && k.passDone() && k.leavePass(), 350);
};
const mascarpone = new MascarponeView(ui, k);
expo.onPanTap = (sauce) => {
  if (sauce === 'mascarpone') mascarpone.show();
  else ladle.show(sauce);
};

// Playtest notes: the tab in the corner grabs the screen and the whole game state.
const feedback = new Feedback(
  ui,
  {
    pause: () => k.pause(),
    resume: () => k.resume(),
    shot: () => {
      try {
        // The game canvas only holds a frame while drawing: draw one now and copy it.
        if (k.scene === 'station' || k.scene === 'expo' || k.scene === 'pass') station.render(renderer, performance.now() / 1000);
        if (k.scene === 'freezer' || k.scene === 'pass') side.render(renderer, 0);
        const out = document.createElement('canvas');
        const w = 360;
        out.width = w;
        out.height = Math.round((w * window.innerHeight) / window.innerWidth);
        const ctx = out.getContext('2d');
        if (!ctx) return '';
        ctx.drawImage(renderer.domElement, 0, 0, out.width, out.height);
        if (boxFocus.isOpen()) {
          const bc = boxFocus.snapshotCanvas();
          const r = bc.getBoundingClientRect();
          const sx = out.width / window.innerWidth;
          ctx.drawImage(bc, r.left * sx, r.top * sx, r.width * sx, r.height * sx);
        }
        return out.toDataURL('image/jpeg', 0.6);
      } catch {
        return '';
      }
    },
    state: () => {
      const rav = (r: { flavor: string; cooked: number; fryer: number; salted: boolean; greasy: boolean; uneven: boolean }) =>
        `${r.flavor}:${r.cooked.toFixed(1)}:${qualityAt(r.cooked, r.flavor as never, r.fryer)}${r.salted ? ':salted' : ''}${r.greasy ? ':greasy' : ''}${r.uneven ? ':uneven' : ''}`;
      return {
        scene: k.scene,
        phase: k.phase,
        prep: k.prep,
        time: +k.time.toFixed(1),
        score: k.score,
        rep: +k.rep.toFixed(2),
        freezerView: side.freezerView,
        boxFocus: boxFocus.isOpen() ? boxFocus.debugState() : null,
        tickets: k.tickets.map((t) => ({ id: t.id, name: t.name, age: +(k.time - t.bornAt).toFixed(0), life: t.life, items: t.items.map((it) => `${it.id} ${it.lines.map((l) => `${l.count} ${l.flavor}`).join('/')}${it.done ? ' DONE' : ''}`) })),
        stages: Object.fromEntries(k.itemStages()),
        oil: k.slots.map((st) => st.map((b) => b.ravs.map(rav))),
        hooked: k.hooked.map((b) => (b ? { drained: +k.drainedFor(b).toFixed(1), ravs: b.ravs.map(rav) } : null)),
        hung: k.hung.map((n) => n.length),
        selected: k.selected.length,
        bowl: { ravs: k.bowl.ravs.map(rav), salt: k.bowlSalt, toss: +k.bowlToss.toFixed(1), ready: k.bowlReady() },
        board: k.board.map((b) => ({ id: b.id, size: b.size, item: b.itemId, labeled: b.labeled, wax: b.wax, sauces: b.sauces, mode: b.mode, ravs: b.ravs.map(rav), arranged: b.arranged, garnish: +b.garnish.toFixed(2) })),
        cups: k.cupStock,
        timers: k.timers.map((t, i) => (t.start === null ? null : { ch: i, left: +Math.max(0, t.end - k.time).toFixed(1), rang: t.rang })).filter(Boolean),
        coach: k.nextJob().text,
      };
    },
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
/** Which way each station is from the fryers, so a scene change slides the right way. */
const PLACE: Record<string, [number, number]> = { station: [0, 0], freezer: [-1, 0], expo: [1, 0], pass: [0, 0] };
let lastScene = k.scene;
const app = document.getElementById('app');
function slide() {
  if (!app || k.scene === lastScene) return;
  const [ax, ay] = PLACE[lastScene] ?? [0, 0];
  const [bx, by] = PLACE[k.scene] ?? [0, 0];
  lastScene = k.scene;
  const dx = bx - ax;
  const dy = by - ay;
  // The pass comes up over the fryers: nothing slides.
  if (!dx && !dy) return;
  // The new place comes in from the side it is on.
  const cls = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'slide-r' : 'slide-l') : dy > 0 ? 'slide-d' : 'slide-u';
  app.classList.remove('slide-l', 'slide-r', 'slide-u', 'slide-d');
  void app.offsetWidth;
  app.classList.add(cls);
}
function showScene() {
  slide();
  station.setVisible(k.scene === 'station');
  side.setVisible(k.scene === 'freezer' || k.scene === 'pass');
  // The fryer screen is the battlestation: the boxes and supplies sit right under the fryers.
  expo.setVisible(k.phase !== 'title' && (k.scene === 'expo' || k.scene === 'pass' || k.scene === 'station'), false, k.scene === 'station' || k.scene === 'pass');
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
    if (ev.type !== 'catch' && ev.type !== 'rim' && ev.type !== 'pour' && ev.type !== 'timerBeep') feedback.note_(`${k.time.toFixed(1)} ${ev.type}${'reason' in ev ? ':' + String(ev.reason) : ''}${'text' in ev ? ':' + String(ev.text) : ''}`);
    if (ev.type === 'scene') showScene();
    // The bowl just poured into a box: bring it up close to set and dress it.
    if (ev.type === 'boxFilled') {
      const box = k.board.find((b) => b.id === ev.boxId);
      if (box) window.setTimeout(() => box.mode === 'ready' && k.scene === 'pass' && !boxFocus.isOpen() && boxFocus.show(box), 650);
    }
    // Poured the last of it into a box that's still waiting on its other half: back to the fryers.
    if (ev.type === 'passEmpty') window.setTimeout(() => k.scene === 'pass' && k.passDone() && !boxFocus.isOpen() && k.leavePass(), 600);
    station.handle(ev);
    side.handle(ev);
    hud.handle(ev, now);
    timers.handle(ev);
    expo.handle(ev);
  }
  k.events.length = 0;
  hud.update(now);
  timers.update(now);
  if (k.scene === 'station' || k.scene === 'pass') expo.setVisible(k.phase === 'playing' || k.phase === 'paused', false, true);
  expo.update();
  if (k.scene === 'station' || k.scene === 'expo') station.render(renderer, now);
  else if (k.scene === 'pass') {
    // The pass happens over the fryers: draw them, then the bowl and basket on top.
    station.render(renderer, now);
    side.render(renderer, dt);
  } else side.render(renderer, dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Test hook for automated playtests (harmless in production).
(window as unknown as { __shift: unknown }).__shift = { k, station, side, cabinet, hud, ladle, mascarpone, boxFocus, sharpie };
