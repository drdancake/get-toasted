import { FLAVORS, SHIFT_FLAVORS, type FlavorId } from '../config/flavors';
import { BEST_SCORE_KEY, FRYERS, PATIENCE, SCORING, SLOTS_PER_FRYER } from '../config/game';
import { FREEZER, SHIFT_TICKETS, STATION, TIMER_BEEP_EVERY, TIMER_CHANNELS } from '../config/shift';
import { BASKET, BOX, TOSS_SCORING } from '../config/toss';
import { isFailure, landmarks, qualityAt } from '../game/doneness';
import type { Quality } from '../game/types';
import { Container, damp, newRav, type PhysEvent, PhysWorld, rand, type Rav } from './physics';

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const pick = <T>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];

export type Scene = 'station' | 'freezer' | 'pass';

export class Basket extends Container {
  /** Slot it's cooking in, or null. */
  slot: number | null = null;
  /** Slot it was last hung on, so an emptied basket goes back where it came from. */
  home = 0;
  /** 0 = ravs floating, 1 = flat and submerged (shaken, or weighed down by a basket on top). */
  settle = 0;
  held = false;
  tx = 0;
  ty = 0;
  constructor(public id: number) {
    super('basket', BASKET.width, BASKET.wall);
  }
  /** One flavor, "mixed", or null when empty. */
  get flavor(): FlavorId | 'mixed' | null {
    return flavorOf(this.ravs);
  }
}

export function flavorOf(ravs: Rav[]): FlavorId | 'mixed' | null {
  const first = ravs[0]?.flavor;
  if (!first) return null;
  return ravs.every((r) => r.flavor === first) ? first : 'mixed';
}

/** One line of an order item: so many of a flavor. A split 10 has two lines of 5. */
export interface OrderLine {
  flavor: FlavorId;
  count: number;
}

/** One box's worth: a 6, a 10, a 1 or a 3, one flavor or split between two. */
export interface OrderItem {
  id: number;
  size: number;
  lines: OrderLine[];
  done: boolean;
}

/** A ticket on the rail. Only the fried-food lines; the sandwiches are somebody else's problem. */
export interface Order {
  id: number;
  items: OrderItem[];
  bornAt: number;
  life: number;
}

export class Box extends Container {
  mode: 'ready' | 'serving' | 'arriving' = 'ready';
  itemId: number | null = null;
  constructor() {
    super('box', BOX.width, BOX.wall);
  }
}

export interface FreezerGeo {
  leftX: number;
  rightX: number;
  topY: number;
  floorY: number;
  bagY: number;
  bagX: number[];
  homeX: number;
  homeY: number;
}

export interface PassGeo {
  leftX: number;
  rightX: number;
  topY: number;
  counterY: number;
  boxX: number;
  homeX: number;
  homeY: number;
}

export type RejectReason = 'cold' | 'burnt' | 'short' | 'wrongorder';

export type KitchenEvent =
  | PhysEvent
  | { type: 'launch'; x: number; y: number; flavor: FlavorId }
  | { type: 'scene'; scene: Scene }
  | { type: 'mixed' }
  | { type: 'pickout'; x: number; y: number; wasted: boolean }
  | { type: 'select'; slot: number; count: number }
  | { type: 'forgot'; count: number }
  | { type: 'drop'; slot: number; nested: boolean; flavor: FlavorId | 'mixed' | null }
  | { type: 'lift'; slot: number }
  | { type: 'hook'; slot: number; full: boolean }
  | { type: 'greasy' }
  | { type: 'restash'; from: number; count: number }
  | { type: 'shake'; slot: number; settle: number }
  | { type: 'timerStart'; channel: number }
  | { type: 'timerStop'; channel: number }
  | { type: 'timerDone'; channel: number }
  | { type: 'timerBeep'; channel: number }
  | { type: 'toss'; count: number }
  | { type: 'ticketArrived'; ticket: Order }
  | { type: 'ticketExpired'; ticket: Order }
  | {
      type: 'served';
      quality: 'perfect' | 'ok';
      points: number;
      tip: number;
      combo: number;
      extra: number;
      strays: number;
      uneven: boolean;
      orderDone: boolean;
    }
  | { type: 'rejected'; reason: RejectReason; missing: number }
  | { type: 'bigCombo'; combo: number }
  | { type: 'hint'; text: string }
  | { type: 'gameOver'; score: number; best: number };

export interface TimerChannel {
  /** Game time it was started, or null when idle. */
  start: number | null;
  end: number;
  rang: boolean;
  lastBeep: number;
}

/** Game seconds a channel counts: the flavor's cook time (plus timerAt of its window), in standard oil. */
export function channelSeconds(flavor: FlavorId) {
  const l = landmarks(flavor, 0);
  return l.windowOpen + (l.windowClose - l.windowOpen) * STATION.timerAt;
}

/** "10 BEEF/BUF", "6 CHZ", "1 GOOEY". */
export function itemLabel(item: OrderItem, long = false) {
  const names = item.lines.map((l) => (long ? FLAVORS[l.flavor].name : FLAVORS[l.flavor].short));
  return `${item.size} ${names.join(long ? ' / ' : '/')}`;
}

export class Kitchen {
  phase: 'title' | 'playing' | 'paused' | 'over' = 'title';
  scene: Scene = 'station';
  time = 0;
  score = 0;
  best = 0;
  combo = 0;
  patience = PATIENCE.max;
  tickets: Order[] = [];
  baskets: Basket[] = [];
  slots: Basket[][] = [];
  /** Empty baskets hooked on each slot's back bar, nested, last one on top. */
  hung: Basket[][] = [];
  /** Hung baskets you've picked to carry into the freezer. */
  selected: Basket[] = [];
  /** Baskets sitting in the freezer: brought in and not carried out. */
  inFreezer: Basket[] = [];
  /** A basket with ravs hooked on each slot's back bar, out of the oil (waiting to drop, or draining). */
  hooked: (Basket | null)[] = [];
  /** When each hooked basket went up on the bar. */
  hookedAt = new Map<Basket, number>();
  /** Baskets in your hands on the fryer screen, mid-move. They don't cook. */
  carrying: Basket[] = [];
  /** The baskets in your hands in the current side scene (freezer: several, pass: one). */
  hands: Basket[] = [];
  box = new Box();
  world = new PhysWorld();
  freezerGeo: FreezerGeo | null = null;
  passGeo: PassGeo | null = null;
  events: KitchenEvent[] = [];
  timers: TimerChannel[] = TIMER_CHANNELS.map(() => ({ start: null, end: 0, rang: false, lastBeep: 0 }));

  private nextId = 1;
  private nextTicketAt = 0;
  private bagReadyAt: number[] = [];
  private warnedMixed = new Set<Basket>();
  private passEmptyAt: number | null = null;

  constructor() {
    this.best = loadBest();
    this.reset();
  }

  private reset() {
    const n = FRYERS.length * SLOTS_PER_FRYER;
    this.slots = Array.from({ length: n }, () => []);
    this.hung = Array.from({ length: n }, () => []);
    this.baskets = [];
    for (let s = 0; s < n; s++) {
      for (let i = 0; i < (STATION.hangStart[s] ?? 0); i++) {
        const b = new Basket(this.baskets.length + 1);
        b.home = s;
        this.baskets.push(b);
        this.hung[s]?.push(b);
      }
    }
    this.selected = [];
    this.inFreezer = [];
    this.hooked = Array.from({ length: n }, () => null);
    this.hookedAt = new Map();
    this.carrying = [];
    this.hands = [];
    this.box = new Box();
    this.world = new PhysWorld();
    this.tickets = [];
    this.events = [];
    this.scene = 'station';
    this.timers = TIMER_CHANNELS.map(() => ({ start: null, end: 0, rang: false, lastBeep: 0 }));
  }

  start() {
    this.reset();
    this.time = 0;
    this.score = 0;
    this.combo = 0;
    this.patience = PATIENCE.max;
    this.nextTicketAt = SHIFT_TICKETS.firstArrival;
    this.bagReadyAt = SHIFT_FLAVORS.map(() => 0);
    this.warnedMixed.clear();
    this.phase = 'playing';
  }

  pause() {
    if (this.phase === 'playing') this.phase = 'paused';
  }

  resume() {
    if (this.phase === 'paused') this.phase = 'playing';
  }

  fryerOf(slot: number) {
    return Math.floor(slot / SLOTS_PER_FRYER);
  }

  /** The basket at the pass (there's only ever one in your hand there). */
  get work(): Basket | null {
    return this.scene === 'pass' ? (this.hands[0] ?? null) : null;
  }

  /** Empty baskets hung on the back bars. */
  freeBaskets() {
    return this.hung.flat();
  }

  private isHot(slot: number) {
    return (FRYERS[this.fryerOf(slot)]?.heat ?? 1) > 1;
  }

  /** Unhook an empty basket: from the given slot, else a working slot's own basket, else the stash. */
  private unhook(slot?: number): Basket | null {
    let s = slot;
    const avail = (i: number) => (this.hung[i] ?? []).some((b) => !this.selected.includes(b));
    if (s === undefined || !avail(s)) {
      const order = this.hung
        .map((h, i) => ({ i, n: h.length }))
        .filter((x) => avail(x.i))
        .sort((a, b) => Number(this.isHot(a.i)) - Number(this.isHot(b.i)) || b.n - a.n);
      s = order[0]?.i;
    }
    if (s === undefined) return null;
    const nest = this.hung[s] ?? [];
    const b = [...nest].reverse().find((x) => !this.selected.includes(x)) ?? null;
    if (b) {
      nest.splice(nest.indexOf(b), 1);
      b.home = s;
    }
    return b;
  }

  /** Hook an empty basket on a bar: its own slot if free, else the stash on the wing fryer, else anywhere with room. */
  private hang(b: Basket, avoid = -1) {
    b.ravs = [];
    b.slot = null;
    b.held = false;
    const ok = (s: number) => s !== avoid && !this.slots[s]?.length && (this.hung[s]?.length ?? 0) < STATION.hangMax;
    const stash = this.hung
      .map((_, i) => i)
      .filter((i) => this.isHot(i))
      .sort((a, c) => (this.hung[a]?.length ?? 0) - (this.hung[c]?.length ?? 0));
    const any = this.hung.map((_, i) => i);
    const s = [b.home, ...stash, ...any].find(ok);
    if (s === undefined) return false;
    this.hung[s]?.push(b);
    b.home = s;
    return true;
  }

  /** Game seconds left on a channel, or null when idle. */
  timerLeft(i: number) {
    const t = this.timers[i];
    return !t || t.start === null ? null : Math.max(0, t.end - this.time);
  }

  /** Press a channel button: start it, or stop it if it's running or ringing. */
  pressTimer(i: number) {
    const t = this.timers[i];
    const c = TIMER_CHANNELS[i];
    if (!t || !c || this.phase !== 'playing') return;
    if (t.start !== null) {
      t.start = null;
      t.rang = false;
      this.events.push({ type: 'timerStop', channel: i });
      return;
    }
    t.start = this.time;
    t.end = this.time + channelSeconds(c.flavor);
    t.rang = false;
    this.events.push({ type: 'timerStart', channel: i });
  }

  // ---------- Station ----------

  /** Tap a basket hung on a slot's bar: pick it to carry into the freezer (tap again to put it back). */
  toggleSelect(slot: number) {
    if (this.phase !== 'playing' || this.scene !== 'station') return;
    const nest = this.hung[slot] ?? [];
    const free = [...nest].reverse().find((b) => !this.selected.includes(b));
    const room = this.inFreezer.length + this.selected.length < FREEZER.maxBaskets;
    if (free && room) this.selected.push(free);
    else {
      // Nothing left to pick here (or hands full): put this slot's picks back.
      const had = this.selected.length;
      this.selected = this.selected.filter((b) => !nest.includes(b));
      if (had === this.selected.length && !room) this.hint(`You can carry ${FREEZER.maxBaskets}`);
    }
    this.events.push({ type: 'select', slot, count: this.selected.length });
  }

  /** Walk into the freezer with the baskets you picked (or the next one handy), plus any you left in there. */
  openFreezer() {
    if (this.phase !== 'playing' || this.scene !== 'station') return;
    const g = this.freezerGeo;
    if (!g) return;
    const carrying: Basket[] = [];
    for (const b of this.selected) {
      const nest = this.hung[b.home];
      const i = nest?.indexOf(b) ?? -1;
      if (nest && i >= 0) nest.splice(i, 1);
      carrying.push(b);
    }
    this.selected = [];
    if (!carrying.length && !this.inFreezer.length) {
      const b = this.unhook();
      if (!b) return this.hint('No empty baskets on the bars');
      carrying.push(b);
    }
    for (const b of carrying) {
      b.ravs = [];
      b.settle = 0;
    }
    const all = [...this.inFreezer, ...carrying];
    this.hands = all.slice(0, FREEZER.maxBaskets);
    for (const extra of all.slice(FREEZER.maxBaskets)) this.hang(extra); // more than you can carry: back on a bar
    this.inFreezer = [];
    const xs = FREEZER.homeX[this.hands.length - 1] ?? [0];
    this.hands.forEach((b, i) => {
      b.x = b.px = b.tx = xs[i] ?? 0;
      b.y = b.py = b.ty = g.homeY;
      b.vx = b.vy = b.ax = 0;
      b.held = false;
      b.ravs.forEach((r, j) => {
        r.state = 'in';
        r.lx = ((j % 4) - 1.5) * 0.42;
        r.ly = 0.1 + Math.floor(j / 4) * 0.2;
        r.lvx = r.lvy = 0;
      });
    });
    this.warnedMixed.clear();
    this.world.clear();
    this.world.bounds = { leftX: g.leftX, rightX: g.rightX, floorY: g.floorY };
    this.world.containers = [...this.hands];
    this.setScene('freezer');
  }

  /** Lift the top basket out of a slot's oil into your hand. It stops cooking. */
  liftFromOil(slot: number): Basket | null {
    if (this.phase !== 'playing' || this.scene !== 'station') return null;
    const b = this.slots[slot]?.pop() ?? null;
    if (!b) return null;
    b.slot = null;
    // Floaters that never got shaken or weighed down cooked uneven.
    for (const r of b.ravs) if (r.cooked > 0 && b.settle < 1) r.uneven = true;
    this.carrying.push(b);
    this.events.push({ type: 'lift', slot });
    return b;
  }

  /** Lift the basket hooked on a slot's bar. */
  liftHooked(slot: number): Basket | null {
    if (this.phase !== 'playing' || this.scene !== 'station') return null;
    const b = this.hooked[slot] ?? null;
    if (!b) return null;
    this.hooked[slot] = null;
    this.carrying.push(b);
    return b;
  }

  /** Lift the top empty basket off a slot's bar (to clear the slot, or to move it). */
  liftEmpty(slot: number): Basket | null {
    if (this.phase !== 'playing' || this.scene !== 'station') return null;
    const nest = this.hung[slot] ?? [];
    const b = nest.pop() ?? null;
    if (!b) return null;
    this.selected = this.selected.filter((x) => x !== b);
    this.carrying.push(b);
    return b;
  }

  private letGo(b: Basket) {
    this.carrying = this.carrying.filter((x) => x !== b);
  }

  /** Lower a basket with ravs into a slot's oil, nesting it on top if one's already in there. */
  placeInOil(b: Basket, slot: number) {
    const stack = this.slots[slot];
    if (!stack || !b.ravs.length) return false;
    if (stack.length >= STATION.stackMax) {
      this.hint('That slot is full');
      return false;
    }
    // Empty baskets hung over this slot move to the stash so this one can go in.
    const hung = this.hung[slot] ?? [];
    if (hung.length) {
      const off = hung.splice(0, hung.length);
      const failed = off.filter((h) => !this.hang(h, slot));
      if (failed.length) {
        hung.push(...failed);
        this.hint('No bar to hang the empty basket on');
        return false;
      }
      this.selected = this.selected.filter((x) => !off.includes(x) || this.hung[x.home]?.includes(x));
      this.events.push({ type: 'restash', from: slot, count: off.length });
    }
    this.letGo(b);
    this.hookedAt.delete(b);
    const nested = stack.length > 0;
    for (const under of stack) under.settle = 1; // weighed down, fully submerged
    stack.push(b);
    b.slot = slot;
    if (!b.ravs.some((r) => r.cooked > 0)) b.settle = 0; // raw ones float until you shake them
    this.events.push({ type: 'drop', slot, nested, flavor: b.flavor });
    return true;
  }

  /** Hook a basket on a slot's back bar: an empty one nests with the empties, a full one hangs out of the oil. */
  hookOn(b: Basket, slot: number) {
    if (!this.hung[slot]) return false;
    if (!b.ravs.length) {
      if ((this.hung[slot]?.length ?? 0) >= STATION.hangMax) {
        this.hint('That bar is full');
        return false;
      }
      this.letGo(b);
      b.home = slot;
      this.hung[slot]?.push(b);
      this.events.push({ type: 'hook', slot, full: false });
      return true;
    }
    if (this.hooked[slot]) {
      this.hint('Something is already hanging there');
      return false;
    }
    this.letGo(b);
    this.hooked[slot] = b;
    this.hookedAt.set(b, this.time);
    this.events.push({ type: 'hook', slot, full: true });
    return true;
  }

  /** Hook a full basket on the first free bar: its home slot, then working slots with empty oil, then anywhere. */
  private hookAnywhere(b: Basket) {
    const order = this.hooked.map((_, i) => i).sort((x, y) => Number(this.isHot(x)) - Number(this.isHot(y)) || (this.slots[x]?.length ?? 0) - (this.slots[y]?.length ?? 0));
    for (const s of [b.home, ...order]) if (!this.hooked[s]) return this.hookOn(b, s);
    return false;
  }

  /** Seconds a hooked basket has been draining on the bar. */
  drainedFor(b: Basket) {
    const t = this.hookedAt.get(b);
    return t === undefined ? 0 : this.time - t;
  }

  /** Dump a basket into the salt bowl: off to the pass. Straight from the oil (no drain) and they come out greasy. */
  toBowl(b: Basket, drained: number) {
    if (!b.ravs.length) return false;
    this.letGo(b);
    this.hookedAt.delete(b);
    const greasy = drained < STATION.drainSeconds && b.ravs.some((r) => r.cooked > 0);
    for (const r of b.ravs) if (greasy) r.greasy = true;
    if (greasy) this.events.push({ type: 'greasy' });
    this.enterPass(b);
    return true;
  }

  /** Put a carried basket back where it came from if you let go of it nowhere useful. */
  putBack(b: Basket, from: { kind: 'oil' | 'hook' | 'hang'; slot: number }) {
    if (from.kind === 'oil' && b.ravs.length && this.placeInOil(b, from.slot)) return;
    if (this.hookOn(b, from.slot)) return;
    if (b.ravs.length) this.hookAnywhere(b) || this.placeInOil(b, from.slot);
    else this.hang(b) && this.letGo(b);
  }

  /** Back-compat for older callers: lift the top basket and dump it straight into the bowl. */
  pull(slot: number) {
    const b = this.liftFromOil(slot);
    if (b) this.toBowl(b, 0);
  }

  /** Slide the top basket in a slot by hand; sideways travel (world units) settles the floaters. */
  slosh(slot: number, travel: number) {
    const top = this.slots[slot]?.at(-1);
    if (!top || top.settle >= 1) return;
    const before = top.settle;
    top.settle = Math.min(1, top.settle + travel * STATION.settlePerUnit);
    // Report each third, so the view can tick and buzz without spamming.
    if (Math.floor(top.settle * 3) > Math.floor(before * 3)) this.events.push({ type: 'shake', slot, settle: top.settle });
  }

  // ---------- Freezer ----------

  tapBag(i: number) {
    const g = this.freezerGeo;
    const flavor = SHIFT_FLAVORS[i];
    if (!g || !flavor || this.scene !== 'freezer' || this.phase !== 'playing') return false;
    if (this.time < (this.bagReadyAt[i] ?? 0)) return false;
    this.bagReadyAt[i] = this.time + FREEZER.cooldown;
    const r = newRav(flavor);
    r.x = (g.bagX[i] ?? 0) + rand(-0.15, 0.15);
    r.y = g.bagY + 0.8;
    r.vx = (0 - r.x) * FREEZER.hopToCenter + rand(-FREEZER.hopVx, FREEZER.hopVx);
    r.vy = rand(FREEZER.hopVy[0] ?? 13.5, FREEZER.hopVy[1] ?? 15.5);
    r.va = rand(-8, 8);
    r.vt = rand(-5, 5);
    this.world.ravs.push(r);
    this.events.push({ type: 'launch', x: r.x, y: r.y, flavor });
    return true;
  }

  /**
   * Pick one rav out of a basket you're holding. In the freezer it goes back in its bag, no harm done.
   * At the pass it's cooked, so it's wasted, but it saves the box.
   */
  pickOut(b: Basket, r: Rav) {
    const i = b.ravs.indexOf(r);
    if (i < 0) return;
    b.ravs.splice(i, 1);
    const wasted = this.scene === 'pass';
    if (wasted) this.score = Math.max(0, this.score - TOSS_SCORING.deadRav);
    this.events.push({ type: 'pickout', x: b.x + r.lx, y: b.y + r.ly, wasted });
  }

  /**
   * Walk out of the freezer. Filled baskets go on the counter (as many as fit);
   * anything else stays in the freezer, where you'll find it next time.
   */
  closeFreezer() {
    if (this.scene !== 'freezer') return;
    const left: Basket[] = [];
    for (const b of this.hands) {
      b.held = false;
      for (const r of b.ravs) r.state = 'in';
      // Full baskets come out and hook on a free back bar, ready to drop.
      if (b.ravs.length && this.hookAnywhere(b)) continue;
      if (b.ravs.length) this.hint('No free bar to hang it on');
      left.push(b);
    }
    this.inFreezer = left;
    this.hands = [];
    this.world.clear();
    this.world.containers = [];
    this.setScene('station');
    if (left.length) this.events.push({ type: 'forgot', count: left.length });
  }

  // ---------- Pass ----------

  private enterPass(b: Basket) {
    const g = this.passGeo;
    if (!g) return;
    b.x = b.px = b.tx = g.homeX;
    b.y = b.py = b.ty = g.homeY;
    b.vx = b.vy = b.ax = 0;
    b.held = false;
    b.ravs.forEach((r, i) => {
      r.state = 'in';
      r.lx = ((i % 4) - 1.5) * 0.42;
      r.ly = 0.1 + Math.floor(i / 4) * 0.2;
      r.lvx = r.lvy = 0;
    });
    const box = this.box;
    if (box.mode === 'ready') {
      box.x = box.px = g.boxX;
      box.y = box.py = g.counterY;
    }
    this.assignBox(b.flavor);
    this.hands = [b];
    this.passEmptyAt = null;
    this.world.clear();
    this.world.bounds = { leftX: g.leftX, rightX: g.rightX, floorY: g.counterY };
    this.world.containers = [b, box];
    this.setScene('pass');
  }

  /** Open items, oldest ticket first. */
  private openItems() {
    return this.tickets.flatMap((o) => o.items.filter((it) => !it.done).map((item) => ({ order: o, item })));
  }

  /** The box goes to the oldest open item that wants this flavor, unless it already holds ravs for one. */
  private assignBox(flavor: FlavorId | 'mixed' | null) {
    const box = this.box;
    if (box.ravs.length && this.boxItem()) return;
    const open = this.openItems();
    const match = (flavor && flavor !== 'mixed' && open.find((x) => x.item.lines.some((l) => l.flavor === flavor))) || open[0];
    box.itemId = match?.item.id ?? null;
  }

  boxItem(): { order: Order; item: OrderItem } | null {
    const id = this.box.itemId;
    if (id === null) return null;
    for (const order of this.tickets) {
      const item = order.items.find((it) => it.id === id && !it.done);
      if (item) return { order, item };
    }
    return null;
  }

  /** Which basket in your hands is under this point (nearest wins when they overlap). */
  handAt(x: number, y: number): Basket | null {
    let best: Basket | null = null;
    let bestD = Infinity;
    for (const b of this.hands) {
      if (b.held) continue;
      if (Math.abs(x - b.x) < b.w / 2 + 0.45 && y > b.y - 0.7 && y < b.top + 1.1) {
        const d = Math.hypot(x - b.x, y - (b.y + b.wall / 2));
        if (d < bestD) [best, bestD] = [b, d];
      }
    }
    return best;
  }

  /** The rav in a basket nearest a point, if one is close enough to tap. */
  ravAt(b: Basket, x: number, y: number): Rav | null {
    let best: Rav | null = null;
    let bestD = 0.45;
    for (const r of b.ravs) {
      const d = Math.hypot(b.x + r.lx - x, b.y + r.ly - y);
      if (d < bestD) [best, bestD] = [r, d];
    }
    return best;
  }

  grab(b: Basket, x: number, y: number) {
    if (this.phase !== 'playing' || !this.hands.includes(b)) return null;
    b.held = true;
    b.tx = b.x;
    b.ty = b.y;
    return { dx: b.x - x, dy: b.y - y };
  }

  moveHand(b: Basket, x: number, y: number) {
    if (!b.held) return;
    const bounds = this.world.bounds;
    const fg = this.freezerGeo;
    const inFreezer = this.scene === 'freezer' && fg;
    const top = inFreezer ? fg.topY - 3 : (this.passGeo?.topY ?? 8) - 2;
    const bottom = inFreezer ? fg.bagY + FREEZER.basketAboveBins : bounds.floorY;
    b.tx = clamp(x, bounds.leftX + b.w / 2, bounds.rightX - b.w / 2);
    b.ty = clamp(y, bottom, top);
  }

  release(b: Basket, vx: number, vy: number) {
    if (!b.held) return;
    b.held = false;
    const speed = Math.hypot(vx, vy);
    if (this.scene === 'pass' && b.ravs.length && speed > BASKET.tossSpeed && vy > -BASKET.tossSpeed) {
      const n = this.world.toss(b, vx, vy);
      this.events.push({ type: 'toss', count: n });
    }
  }

  /** Leave the pass. A basket that still has ravs goes back on the counter to re-fry or toss again. */
  leavePass() {
    if (this.scene !== 'pass') return;
    const b = this.hands[0];
    if (b?.ravs.length) {
      b.held = false;
      for (const r of b.ravs) r.state = 'in';
      if (!this.hookAnywhere(b)) {
        this.score = Math.max(0, this.score - b.ravs.length * TOSS_SCORING.deadRav);
        b.ravs = [];
        this.hint('No free bar: tossed');
        this.hang(b);
      }
    } else if (b) this.hang(b); // back on the bar
    this.hands = [];
    for (const r of this.world.ravs) if (r.state === 'air') this.score = Math.max(0, this.score - TOSS_SCORING.deadRav);
    this.world.clear();
    this.world.containers = [];
    this.setScene('station');
  }

  boxAt(x: number, y: number) {
    const b = this.box;
    return this.scene === 'pass' && b.mode === 'ready' && Math.abs(x - b.x) < b.w / 2 + 0.3 && y > b.y - 0.6 && y < b.top + 0.9;
  }

  /**
   * Swipe the box up. Judged against its item, rav by rav:
   * cold, burnt or short goes back; a box that's mostly the wrong flavor goes back;
   * a stray or two goes out with a penalty.
   */
  serve() {
    const box = this.box;
    if (this.phase !== 'playing' || box.mode !== 'ready') return;
    if (!box.ravs.length) return this.hint('Box is empty');
    const ref = this.boxItem() ?? this.openItems()[0] ?? null;
    if (!ref) return this.hint('No tickets yet');
    const { order, item } = ref;
    box.mode = 'serving';
    box.vy = 0;

    const need = new Map<FlavorId, number>(item.lines.map((l) => [l.flavor, l.count]));
    const have = new Map<FlavorId, number>();
    for (const r of box.ravs) have.set(r.flavor, (have.get(r.flavor) ?? 0) + 1);
    let strays = 0;
    for (const [f, n] of have) strays += Math.max(0, n - (need.get(f) ?? 0));
    const qualities: Quality[] = box.ravs.map((r) => qualityAt(r.cooked, r.flavor, r.fryer));
    const missing = item.size - box.ravs.length;
    const fail = qualities.find(isFailure);

    let reason: RejectReason | null = null;
    if (fail) reason = fail === 'cold' ? 'cold' : 'burnt';
    else if (strays * 2 > item.size) reason = 'wrongorder';
    else if (missing > 0) reason = 'short';
    if (reason) {
      this.combo = 0;
      this.losePatience(PATIENCE.rejectedBasket);
      this.events.push({ type: 'rejected', reason, missing: Math.max(0, missing) });
      return; // the item stays open: fire it again
    }

    item.done = true;
    // Score the ravs that belong; strays cost.
    const used = new Map<FlavorId, number>();
    let points = 0;
    let perfect = strays === 0;
    let uneven = false;
    box.ravs.forEach((r, i) => {
      const n = used.get(r.flavor) ?? 0;
      if (n >= (need.get(r.flavor) ?? 0)) return;
      used.set(r.flavor, n + 1);
      const good = qualities[i] === 'perfect' && !r.uneven && !r.greasy;
      if (r.uneven || r.greasy) uneven = true;
      if (!good) perfect = false;
      points += good ? SCORING.perfectPerRav : SCORING.okPerRav;
    });
    const extra = Math.max(0, box.ravs.length - item.size - strays);
    this.combo = perfect ? this.combo + 1 : 0;
    const multiplier = clamp(this.combo, 1, SCORING.comboCap);
    const orderDone = order.items.every((it) => it.done);
    let tip = 0;
    if (orderDone) {
      const remaining = Math.max(0, order.life - (this.time - order.bornAt));
      tip = Math.round(remaining * SCORING.tipPerSecond * multiplier * order.items.length);
      this.tickets.splice(this.tickets.indexOf(order), 1);
    }
    this.score = Math.max(0, this.score + points + tip - extra * TOSS_SCORING.extraRav - strays * TOSS_SCORING.strayRav);
    this.events.push({ type: 'served', quality: perfect ? 'perfect' : 'ok', points, tip, combo: this.combo, extra, strays, uneven, orderDone });
    if (perfect) {
      if (this.combo >= PATIENCE.healAtCombo) this.patience = clamp(this.patience + PATIENCE.healAmount, 0, PATIENCE.max);
      const past = this.combo - SCORING.bigComboAt;
      if (past >= 0 && past % SCORING.bigComboEvery === 0) this.events.push({ type: 'bigCombo', combo: this.combo });
    }
  }

  // ---------- Frame ----------

  update(dt: number) {
    if (this.phase !== 'playing') return;
    this.time += dt;

    // Every basket in every slot cooks, in or out of view.
    this.slots.forEach((stack, slot) => {
      const fryer = this.fryerOf(slot);
      const heat = FRYERS[fryer]?.heat ?? 1;
      // A basket nested on an overfull one rides high: not all the way down in the oil.
      const ridingHigh = stack.length > 1 && (stack[0]?.ravs.length ?? 0) > STATION.nestFullAt;
      stack.forEach((b, i) => {
        if (i < stack.length - 1) b.settle = 1;
        const h = i > 0 && ridingHigh ? heat * STATION.highTopHeat : heat;
        for (const r of b.ravs) {
          r.cooked += dt * h;
          r.fryer = fryer;
        }
      });
    });

    this.timers.forEach((t, i) => {
      if (t.start === null) return;
      if (!t.rang && this.time >= t.end) {
        t.rang = true;
        t.lastBeep = this.time;
        this.events.push({ type: 'timerDone', channel: i });
      } else if (t.rang && this.time - t.lastBeep >= TIMER_BEEP_EVERY) {
        t.lastBeep = this.time;
        this.events.push({ type: 'timerBeep', channel: i });
      }
    });

    if (this.scene !== 'station') {
      for (const b of this.hands) {
        const k = b.held ? damp(BASKET.follow, dt) : 0;
        this.world.moveContainer(b, b.x + (b.tx - b.x) * k, b.y + (b.ty - b.y) * k, dt);
      }
      if (this.scene === 'pass') this.moveBox(dt);
      this.world.step(dt);
      for (const ev of this.world.events) {
        if (ev.type === 'dead') this.score = Math.max(0, this.score - TOSS_SCORING.deadRav);
        this.events.push(ev);
      }
      this.world.events.length = 0;
      // Warn once per basket when a second flavor lands in it.
      if (this.scene === 'freezer') {
        for (const b of this.hands) {
          if (b.flavor === 'mixed' && !this.warnedMixed.has(b)) {
            this.warnedMixed.add(b);
            this.events.push({ type: 'mixed' });
          } else if (b.flavor !== 'mixed') this.warnedMixed.delete(b);
        }
      }
      // An empty basket at the pass, with nothing left in the air: back to the fryers.
      const b = this.hands[0];
      if (this.scene === 'pass' && b && !b.ravs.length && !b.held && this.world.airborne() === 0) {
        this.passEmptyAt ??= this.time;
        if (this.time - this.passEmptyAt > 0.9) this.leavePass();
      } else this.passEmptyAt = null;
    } else if (this.box.mode !== 'ready') this.moveBox(dt);

    this.updateTickets();
    if (this.patience <= 0) this.gameOver();
  }

  private moveBox(dt: number) {
    const box = this.box;
    const g = this.passGeo;
    if (!g) return;
    box.px = box.x;
    box.py = box.y;
    if (box.mode === 'serving') {
      box.vy += 40 * dt;
      box.y += box.vy * dt;
      if (box.y > g.topY + 2) {
        box.ravs = [];
        box.mode = 'arriving';
        box.itemId = null;
        box.y = g.counterY;
        box.x = g.rightX + box.w;
        this.assignBox(this.hands[0]?.flavor ?? null);
      }
    } else if (box.mode === 'arriving') {
      box.x += (g.boxX - box.x) * damp(8, dt);
      if (Math.abs(box.x - g.boxX) < 0.02) {
        box.x = g.boxX;
        box.mode = 'ready';
      }
    }
    box.vx = (box.x - box.px) / dt;
    if (box.mode !== 'serving') box.vy = (box.y - box.py) / dt;
    box.ax = 0;
  }

  /** A real-menu item: savory 6 or 10, maybe split 3/3 or 5/5; gooey butter 1 or 3, never split. */
  private newItem(minutes: number): OrderItem {
    const T = SHIFT_TICKETS;
    const flavor = pick(SHIFT_FLAVORS) ?? 'beef';
    const sizes = FLAVORS[flavor].sizes;
    const bigChance = Math.min(T.bigOrderChanceMax, T.bigOrderChanceStart + T.bigOrderRampPerMinute * minutes);
    const size = (Math.random() < bigChance ? sizes[sizes.length - 1] : sizes[0]) ?? 6;
    let lines: OrderLine[] = [{ flavor, count: size }];
    if (FLAVORS[flavor].splits && Math.random() < T.splitChance) {
      const other = pick(SHIFT_FLAVORS.filter((f) => f !== flavor && FLAVORS[f].splits));
      if (other) lines = [{ flavor, count: size / 2 }, { flavor: other, count: size / 2 }];
    }
    return { id: this.nextId++, size, lines, done: false };
  }

  private updateTickets() {
    const T = SHIFT_TICKETS;
    for (const t of [...this.tickets]) {
      if (this.time - t.bornAt >= t.life) {
        this.tickets.splice(this.tickets.indexOf(t), 1);
        if (t.items.some((it) => it.id === this.box.itemId)) this.box.itemId = null;
        this.events.push({ type: 'ticketExpired', ticket: t });
        this.losePatience(PATIENCE.expiredTicket);
      }
    }
    if (this.time >= this.nextTicketAt && this.tickets.length < T.railMax) {
      const minutes = this.time / 60;
      const items = [this.newItem(minutes)];
      const extra = Math.min(T.extraItemChanceMax, T.extraItemChanceStart + T.extraItemRampPerMinute * minutes);
      while (items.length < T.maxItems && Math.random() < extra) items.push(this.newItem(minutes));
      const life = Math.max(T.lifeMin, T.lifeStart - T.lifeDropPerMinute * minutes) + T.lifePerItem * (items.length - 1);
      const ticket: Order = { id: this.nextId++, items, bornAt: this.time, life };
      this.tickets.push(ticket);
      this.events.push({ type: 'ticketArrived', ticket });
      this.nextTicketAt =
        this.time + Math.max(T.intervalMin, T.intervalStart - T.intervalDropPerMinute * minutes) * (0.7 + 0.3 * items.length);
    }
  }

  qualityOf(r: Rav): Quality {
    return qualityAt(r.cooked, r.flavor, r.fryer);
  }

  private setScene(scene: Scene) {
    this.scene = scene;
    this.events.push({ type: 'scene', scene });
  }

  private hint(text: string) {
    this.events.push({ type: 'hint', text });
  }

  private losePatience(n: number) {
    this.patience = clamp(this.patience - n, 0, PATIENCE.max);
  }

  private gameOver() {
    this.phase = 'over';
    if (this.score > this.best) {
      this.best = this.score;
      saveBest(this.best);
    }
    this.events.push({ type: 'gameOver', score: this.score, best: this.best });
  }
}

function loadBest(): number {
  try {
    return Number(localStorage.getItem(`${BEST_SCORE_KEY}.shift`) ?? 0) || 0;
  } catch {
    return 0;
  }
}

function saveBest(n: number) {
  try {
    localStorage.setItem(`${BEST_SCORE_KEY}.shift`, String(n));
  } catch {
    /* no storage: the run still counts */
  }
}
