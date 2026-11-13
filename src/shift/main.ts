import * as THREE from 'three';
import { unlockAudio } from '../ui/feel';
import { Cabinet } from './cabinet';
import { ShiftHud } from './hud';
import { Kitchen, SAUCE_FOR } from './kitchen';
import { ExpoView } from './expo-view';
import { LadleView } from './ladle-view';
import { BoxFocus } from './box-focus';
import { SharpieView } from './sharpie-view';
import { Feedback } from '../ui/feedback';
import { prompt, resetPrompts } from '../ui/prompt';
import { NUDGE, type NudgeKey, NUDGES } from '../config/nudges';
import { qualityAt } from '../game/doneness';
import { SideView } from './side-view';
import { StationView } from './station-view';
import { TimerBank } from './timer-bank';
import { TicketLayer } from './ticket-layer';
import { StageView } from './stage-view';
import { PLATE, STAGE } from '../config/shift';
import { BEAT } from '../config/beat';
import { VIRAL } from '../config/arcade';
import { Beat } from '../ui/beat';
import { Groove } from '../ui/groove';
import { GROOVE } from '../config/groove';
import { Demo } from './demo';
import { WORLD } from '../config/toss';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLDivElement;
if (!canvas || !ui) throw new Error('index.html is missing #game or #ui');

const buildId = (import.meta.env.VITE_BUILD_ID ?? 'dev').slice(0, 7);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.22;
// Counted across the whole frame (the stage and what's drawn over it), for the perf test.
renderer.info.autoReset = false;

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
/** The pulse under the shift. */
const beat = new Beat();
/** The groove: percussion that reflects how the shift is going. */
const groove = new Groove();
k.stage = stageOn;
const cabinet = new Cabinet();
const classic = stageOn ? null : new StationView(canvas, ui, k);
const side = new SideView(canvas, ui, k);
const stage = stageOn ? new StageView(canvas, ui, k, side) : null;
/** One stage: the tickets are paper in the scene, behind whatever is in your hands or in the air. */
const ticketLayer = stageOn ? new TicketLayer() : null;
function paper() {
  if (!ticketLayer) return;
  // The plating line and the Sharpie shrink the rail to DOM minis; the paper steps aside for them.
  const on = !document.body.classList.contains('box-focusing') && (k.phase === 'playing' || k.phase === 'paused');
  ticketLayer.sync(on ? hud.ticketPaints() : []);
  ticketLayer.setCard(on && !demo.on ? hud.cardSpot() : null);
  ticketLayer.render(renderer);
}

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
  // Tongs: armed on the table, they take one rav out of the bowl (in the 3D scene) or a box.
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
    beat.reset();
    groove.reset();
    k.groove = 0;
    hud.newRun();
    k.start(prep);
    showScene();
  },
  buildId,
  cabinet,
);

/** Left alone on the title, the game plays itself. */
const demo = new Demo(k, hud);
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
hud.paintInScene(stageOn);
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
// Sauce is filled per order, and you pick the pan: ranch and mascarpone in the cold table on the
// left, marinara in the hot table on the right. The cup goes into the next box short a cup, right
// sauce or not.
const fillFrom = (sauce: 'marinara' | 'ranch' | 'mascarpone') => {
  if (ladle.isOpen() || sharpie.isOpen() || boxFocus.isOpen()) return;
  const box = k.cupBox(sauce);
  // Nobody's waiting on it: the cold sauces can be cupped ahead, a few at a time. Marinara is to order.
  if (!box && !k.canSpare(sauce)) return k.say(sauce === 'marinara' ? 'Marinara’s poured to order: get a box out first' : 'That’s plenty made ahead');
  k.fillBox = box;
  // The cold table is to the left of the fryers, the hot table to the right: that's where you turn.
  // All three are made at their table, in the same view.
  ladle.show(sauce);
};
expo.onSauce = fillFrom;
expo.basketUnder = (x, y, forPut) => {
  if (!stage || k.scene !== 'station') return null;
  // Down in the oil first (tongs reach in there), then whatever's on the bar.
  const oil = stage.oilSlotAtScreen(x, y);
  if (oil !== null) return k.tongsOil(oil);
  const slot = stage.slotAtScreen(x, y);
  return slot === null ? null : k.tongsBasket(slot, forPut);
};

expo.centerOf = (from) => {
  if (from === 'bowl') return side.project(k.bowl.x, k.bowl.top);
  if (!stage) return null;
  const slot = k.hooked.indexOf(from) >= 0 ? k.hooked.indexOf(from) : k.slots.findIndex((st) => st.includes(from));
  if (slot < 0) return null;
  const w = stage.slotWorld(slot);
  return side.project(w.x, w.y);
};

// Keeping you trucking: stall on whatever's next and the word comes back with its hand, and Matt
// has a comment.
const nudging = { key: '', since: 0, last: '' };
function nudge(now: number) {
  const busy = k.phase !== 'playing' || document.body.classList.contains('box-focusing') || ladle.isOpen() || k.scene === 'freezer';
  let step: NudgeKey | null = null;
  let progress = '';
  if (!busy && k.scene === 'pass') {
    step = ({ pour: 'pour', tongs: 'intoBox', salt: 'salt', toss: 'toss', box: 'intoBox' } as Record<string, NudgeKey>)[side.stepNow] ?? null;
    // Any headway on the step counts as not being stuck.
    progress = `${k.bowlSalt}|${Math.floor(k.bowlToss)}|${k.bowl.ravs.length}|${k.hands.reduce((n, b) => n + b.ravs.length, 0)}`;
  } else if (!busy) step = k.nextJob().key ?? null;
  // "Caught up? Cup some sauce" only means something when there's a cold sauce to cup ahead.
  if (step === 'cook' && !(['ranch', 'mascarpone'] as const).some((s) => k.flavorsNow().some((f) => SAUCE_FOR[f] === s) && k.canSpare(s))) step = null;
  // With something in your hand you're plainly mid-move.
  if (k.carrying.length) step = null;
  const key = step ? `${step}|${progress}` : '';
  if (key !== nudging.key) {
    nudging.key = key;
    nudging.since = k.time + NUDGE.after;
    return;
  }
  if (!step || k.time < nudging.since) return;
  // (Being caught up is said once per lull, not nagged.)
  nudging.since = step === 'cook' ? Infinity : k.time + NUDGE.every;
  const n = NUDGES[step];
  prompt(n.word, n.gesture, undefined, true);
  let line = n.lines[Math.floor(Math.random() * n.lines.length)] ?? '';
  if (line === nudging.last) line = n.lines[(n.lines.indexOf(line) + 1) % n.lines.length] ?? line;
  nudging.last = line;
  hud.heckle(line, now);
}

// Where it goes: with cooked ravs in your hand an arrow bobs over the bowl (or, for dessert, its
// box); with the bowl salted and tossed, over the box it pours into.
const pourHere = document.createElement('div');
pourHere.className = 'pour-here';
pourHere.hidden = true;
ui.appendChild(pourHere);
function pourHint() {
  let at: { x: number; y: number } | null = null;
  const live = k.phase === 'playing' && stageOn && !document.body.classList.contains('box-focusing') && !ladle.isOpen();
  if (live && (k.scene === 'station' || k.scene === 'pass')) {
    const inHand = [...k.carrying, ...(k.scene === 'pass' ? k.hands : [])].find((b) => b.ravs.some((r) => r.cooked > 0));
    const boxFor = (flavor: string) => k.board.find((bx) => bx.mode === 'ready' && (k.itemFor(bx)?.item.lines.some((l) => l.flavor === flavor) ?? false) && bx.ravs.length < (k.itemFor(bx)?.item.size ?? 0));
    const boxAt = (bx: { id: number } | undefined) => {
      const r = bx ? expo.boxRect(bx.id) : null;
      return r ? { x: r.left + r.width / 2, y: r.top + r.height * 0.3 } : null;
    };
    const overBowl = () => side.project(k.bowl.x, k.bowl.top + 0.9);
    if (inHand) at = inHand.flavor === 'gooey' ? boxAt(boxFor('gooey')) : overBowl();
    else if (k.scene === 'pass' && k.bowl.ravs.length && k.bowlReady()) at = boxAt(boxFor(k.bowl.ravs[0]?.flavor ?? ''));
  }
  pourHere.hidden = !at;
  if (at) pourHere.style.transform = `translate(${at.x}px, ${at.y}px)`;
}
expo.bowlHit = (x, y) => {
  const p = side.worldAtScreen(x, y);
  return Math.abs(p.x - k.bowl.x) < k.bowl.w / 2 + 0.3 && p.y > k.bowl.y - 0.5 && p.y < k.bowl.top + 1.2;
};

expo.onPanTap = (sauce) => ladle.show(sauce);
// At the cold table you can change your mind: touch the other pan and that's the sauce you're cupping.
ladle.onSwitch = (sauce) => {
  k.fillBox = k.cupBox(sauce);
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
  // (The freezer's front comes back as soon as its lid starts down, so nothing blinks out and in.)
  station.setVisible(k.scene === 'station' || (stageOn && (k.scene === 'pass' || (k.scene === 'freezer' && k.freezerLeaving))));
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

/** The sauce close-up covers the screen from this far down (the same 26dvh as its CSS). */
const TURN_TOP = 0.26;
let expoRoot: HTMLElement | null = null;
let beepDue = false;
let slotsLaid = -1;
let last = performance.now();
function frame(t: number) {
  const dt = Math.min(1 / 30, (t - last) / 1000);
  last = t;
  const now = t / 1000;
  renderer.info.reset();
  demo.update(dt);
  k.update(dt);
  // The number of fryers that are on changed (a new shift, a new level, the demo): lay the stage out again.
  if (k.levelDef.slots !== slotsLaid) {
    slotsLaid = k.levelDef.slots;
    resize();
  }
  // The pulse keeps time with the shift (it stops when the shift's paused), and picks up as it gets busier.
  if (BEAT.enabled && k.phase === 'playing' && !demo.on && beat.step(dt, k.prep ? 0 : k.time / 60 + k.heat * VIRAL.heatMinutes, k.viral)) {
    hud.pulse(beat.hits, beat.groove);
    // A timer that's going off beeps in time.
    if (beepDue) timers.handle({ type: 'timerBeep', channel: 0 });
    beepDue = false;
  }
  const grooving = GROOVE.enabled && !demo.on && k.phase === 'playing';
  if (grooving) groove.update(dt, k.time);
  hud.groove(grooving || k.phase === 'paused' ? groove.level : 0, groove.silent);
  for (const ev of k.events) {
    if (GROOVE.enabled && !demo.on) {
      groove.on(ev);
      // The run's over: what was done and when goes in with the notes, to study how people really play.
      if (ev.type === 'gameOver' && GROOVE.record && k.time >= GROOVE.recordMinSeconds) feedback.saveRun({ seconds: Math.round(k.time), points: ev.points, served: ev.served, fired: ev.fired, prep: ev.prep, log: JSON.stringify(groove.log) });
    }
    // Done on the beat: a few points, more for each one in a row.
    if (BEAT.enabled && k.phase === 'playing' && !demo.on && (BEAT.actions.includes(ev.type) || BEAT.quick.includes(ev.type))) {
      const was = beat.groove;
      const pts = beat.hit(BEAT.quick.includes(ev.type) ? 2 : 1) * k.multiplier;
      k.groove = beat.groove;
      if (pts) {
        k.points += pts;
        hud.beatPop(pts, beat.streak);
      }
      if (beat.groove > was) {
        hud.note(`IN THE GROOVE · ×${k.multiplier}`, now);
        hud.lights('green', 1.6);
      }
      else if (beat.groove < was) hud.pulse(beat.hits, beat.groove);
    }
    // (The alarm waits for the beat.)
    if (BEAT.enabled && ev.type === 'timerBeep' && k.phase === 'playing' && !demo.on) {
      beepDue = true;
      continue;
    }
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
    if (ev.type === 'spareUsed') hud.note(`${ev.sauce.toUpperCase()} FROM THE COLD TABLE`, performance.now() / 1000);
    if (ev.type === 'sauced' && ev.spare && k.canSpare(ev.sauce)) {
      // Cupping ahead: keep going until you've got enough or you leave.
    } else if (ev.type === 'sauced') {
      window.setTimeout(() => {
        if (ladle.isOpen()) ladle.close();
      }, 550);
    }
    // The lid's coming down: the freezer's front is back right away.
    if (ev.type === 'freezerShut' && stageOn) station.setVisible(true);
    station.handle(ev);
    side.handle(ev);
    hud.handle(ev, now);
    timers.handle(ev);
    expo.handle(ev);
  }
  k.events.length = 0;
  hud.update(now);
  nudge(now);
  pourHint();
  timers.update(now);
  if (k.scene === 'station' || k.scene === 'pass' || (stageOn && k.scene === 'freezer')) expo.setVisible(k.phase === 'playing' || k.phase === 'paused', false, true);
  document.body.classList.toggle('freezer-open', k.scene === 'freezer' && !k.freezerLeaving);
  expo.update();
  if (stageOn && k.scene === 'station') {
    // One stage: the fryers, then the bowl and shaker (the same ones you pour into) on top.
    const stageDraw = (step: number) => {
      station.render(renderer, now);
      paper();
      side.render(renderer, step);
    };
    // Turning to a sauce table: everything below the ticket rail pans off to the side as the table
    // pans in. (The rail, the tickets and the timers are yours wherever you're looking: they stay.)
    const turn = ladle.turnShift();
    const w = window.innerWidth;
    const h = window.innerHeight;
    expoRoot ??= ui.querySelector<HTMLElement>('.expo-ui');
    if (expoRoot) expoRoot.style.transform = turn ? `translateX(${turn * w}px)` : '';
    if (!turn || Math.abs(turn) > 0.999) stageDraw(dt);
    else {
      const cut = Math.round(h * (1 - TURN_TOP));
      renderer.setScissorTest(true);
      renderer.setScissor(0, cut, w, h - cut);
      stageDraw(dt);
      side.cam.setViewOffset(w, h, -turn * w, 0, w, h);
      renderer.setScissor(0, 0, w, cut);
      stageDraw(0);
      side.cam.clearViewOffset();
      renderer.setScissorTest(false);
    }
  } else if (k.scene === 'station' || k.scene === 'expo') station.render(renderer, now);
  else if (k.scene === 'pass' || (k.scene === 'freezer' && side.freezerView === 'side')) {
    // The pass and the freezer happen right on the fryer screen: draw it, then them on top.
    station.render(renderer, now);
    paper();
    side.render(renderer, dt);
  } else side.render(renderer, dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Test hook for automated playtests (harmless in production).
(window as unknown as { __shift: unknown }).__shift = { beat, groove, demo, k, station, side, cabinet, hud, ladle, boxFocus, sharpie, renderer };

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
// The operator's music switch, on the title screen: the drums on or off, remembered on this machine.
const musicBtn = document.createElement('button');
musicBtn.className = 'stage-switch music-switch';
const musicLabel = () => (musicBtn.textContent = beat.music ? '♪ ON' : '♪ OFF');
musicLabel();
musicBtn.addEventListener('click', () => {
  beat.setMusic(!beat.music);
  musicLabel();
});
ui.appendChild(musicBtn);
window.setInterval(() => {
  stageBtn.hidden = k.phase !== 'title';
  musicBtn.hidden = !BEAT.enabled || k.phase !== 'title';
  document.body.classList.toggle('no-beat', !BEAT.enabled);
  document.body.classList.toggle('demo-on', demo.on);
}, 300);
