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
import { StageView } from './stage-view';
import { PLATE, STAGE } from '../config/shift';
import { WORLD } from '../config/toss';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLDivElement;
if (!canvas || !ui) throw new Error('index.html is missing #game or #ui');

const buildId = (import.meta.env.VITE_BUILD_ID ?? 'dev').slice(0, 7);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

// The one stage (fryers, freezer and bowl in one front-on view) or the classic top-down fryers.
// The title screen has the switch; it's remembered on this device.
const STAGE_KEY = 'get-toasted.stage';
let stageOn = true;
try {
  stageOn = localStorage.getItem(STAGE_KEY) !== 'classic';
} catch {
  /* no storage */
}
if (stageOn) {
  (WORLD as { width: number }).width = STAGE.worldWidth;
  (PLATE as { bowlW: number }).bowlW = STAGE.bowlW;
}
const k = new Kitchen();
k.stage = stageOn;
const cabinet = new Cabinet();
const classic = stageOn ? null : new StationView(canvas, ui, k);
const side = new SideView(canvas, ui, k);
const stage = stageOn ? new StageView(canvas, ui, k, side) : null;
/** Whichever fryer screen is on. */
const station = (stage ?? classic) as StageView | StationView;
const timers = new TimerBank(ui, k);
// Freezer open: grab a basket straight off its bar on the fryer screen; let go and it flies back there.
side.slotAt = (x, y) => station.slotAtScreen(x, y);
k.slotPos = (slot) => {
  if (stage) return stage.slotWorld(slot);
  const p = classic?.barScreen(slot);
  return p ? side.worldAtScreen(p.x, p.y) : null;
};
if (stage) {
  k.shownPos = (b) => stage.shownPos(b);
  side.oilSlotFor = (x, y) => stage.oilSlotFor(x, y);
  side.oilAt = (x, y) => stage.oilSlotAtScreen(x, y);
  stage.boxUnder = (x, y) => expo.boxUnder(x, y);
  document.body.classList.add('stage-on');
}
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
// Tap a box with ravs: it comes up, and the other full boxes line up behind it.
expo.onFocus = (box) => boxFocus.openFor(box);
// The pass drops straight into the boxes on the table row.
side.boxUnder = (x, y) => expo.boxUnder(x, y);
side.hoverBox = (box) => expo.hover(box);
side.boxRect = (id) => expo.boxRect(id);
// Box done (or set aside) and nothing left in the bowl: back to the fryers.
boxFocus.onClose = () => {
  if (k.scene === 'pass' && k.passDone()) window.setTimeout(() => k.scene === 'pass' && k.passDone() && k.leavePass(), 350);
};
const mascarpone = new MascarponeView(ui, k);
// Sauce is filled per order: tap the cups and you're filling the one the next box needs; a good
// cup goes straight into that box, and if the box wants a second sauce, that's next.
const fillNext = () => {
  const need = k.sauceNeed();
  if (!need) return k.say(k.board.length ? 'No box is waiting on sauce' : 'Grab a box first');
  k.fillBox = need.box;
  if (need.sauce === 'mascarpone') mascarpone.show();
  else ladle.show(need.sauce);
};
expo.onCupTap = fillNext;
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
        if (k.scene === 'station' || k.scene === 'expo' || k.scene === 'pass' || k.scene === 'freezer') station.render(renderer, performance.now() / 1000);
        if (stageOn || k.scene === 'freezer' || k.scene === 'pass') side.render(renderer, 0);
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
  side.resize(w, h);
  station.resize(w, h);
}
/** Which way each station is from the fryers, so a scene change slides the right way. */
const PLACE: Record<string, [number, number]> = { station: [0, 0], freezer: [0, 0], expo: [1, 0], pass: [0, 0] };
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
  // One stage: the freezer's front (the bar you tap) stays up while it's open.
  // One stage: at the bowl you're still at the fryers, so its bar and labels stay up.
  station.setVisible(k.scene === 'station' || (stageOn && k.scene === 'pass'));
  side.setVisible(k.scene === 'freezer' || k.scene === 'pass');
  // The fryer screen is the battlestation: the boxes and supplies sit right under the fryers.
  // One stage: the table's things stay put while the freezer's open; they slide away under it (CSS).
  const tableUp = k.scene === 'station' || k.scene === 'pass' || (stageOn && k.scene === 'freezer');
  expo.setVisible(k.phase !== 'title' && (k.scene === 'expo' || tableUp), false, tableUp);
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
    // Pouring: keep pouring while there's some left. Once the bowl's empty, the full boxes go down
    // the line (the one you just filled first); if none is full yet, back to the fryers.
    if (ev.type === 'boxFilled' || ev.type === 'passEmpty') {
      const box = ev.type === 'boxFilled' ? k.board.find((b) => b.id === ev.boxId) : undefined;
      window.setTimeout(() => {
        if (k.scene !== 'pass' || boxFocus.isOpen() || !k.passDone()) return;
        const full = k.board.find((b) => b.mode === 'ready' && b.ravs.length && b.ravs.length >= (k.itemFor(b)?.item.size ?? 1));
        const first = box && box.mode === 'ready' ? box : full;
        if (first) boxFocus.openFor(first);
        else k.leavePass();
      }, 650);
    }
    // A cup made it into its box: put the ladle down; if that box wants another sauce, fill that too.
    if (ev.type === 'sauced') {
      window.setTimeout(() => {
        if (ladle.isOpen()) ladle.close();
        if (mascarpone.isOpen()) mascarpone.close();
        const more = k.sauceNeed();
        if (more && more.box.sauces.length) window.setTimeout(fillNext, 350);
      }, 550);
    }
    station.handle(ev);
    side.handle(ev);
    hud.handle(ev, now);
    timers.handle(ev);
    expo.handle(ev);
  }
  k.events.length = 0;
  hud.update(now);
  timers.update(now);
  if (k.scene === 'station' || k.scene === 'pass' || (stageOn && k.scene === 'freezer')) expo.setVisible(k.phase === 'playing' || k.phase === 'paused', false, true);
  document.body.classList.toggle('freezer-open', k.scene === 'freezer' && !k.freezerLeaving);
  expo.update();
  if (stageOn && k.scene === 'station') {
    // One stage: the fryers, then the bowl and shaker (the same ones you pour into) on top.
    station.render(renderer, now);
    side.render(renderer, dt);
  } else if (k.scene === 'station' || k.scene === 'expo') station.render(renderer, now);
  else if (k.scene === 'pass' || (k.scene === 'freezer' && side.freezerView === 'side')) {
    // The pass and the freezer happen right on the fryer screen: draw it, then them on top.
    station.render(renderer, now);
    side.render(renderer, dt);
  } else side.render(renderer, dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Test hook for automated playtests (harmless in production).
(window as unknown as { __shift: unknown }).__shift = { k, station, side, cabinet, hud, ladle, mascarpone, boxFocus, sharpie };

// The switch between the one stage and the classic view, on the title screen.
const stageBtn = document.createElement('button');
stageBtn.className = 'stage-switch';
stageBtn.textContent = stageOn ? 'NEW STAGE · tap for classic' : 'CLASSIC · tap for new stage';
stageBtn.addEventListener('click', () => {
  try {
    localStorage.setItem(STAGE_KEY, stageOn ? 'classic' : 'one');
  } catch {
    /* no storage */
  }
  location.reload();
});
ui.appendChild(stageBtn);
window.setInterval(() => {
  stageBtn.hidden = k.phase !== 'title';
}, 300);
