import { FLAVORS, SHIFT_FLAVORS, type FlavorId } from '../config/flavors';
import { BEST_SCORE_KEY, FRYERS, SCORING, SLOTS_PER_FRYER } from '../config/game';
import { MENU, PRESENTATION, RAV_PRICE, REPUTATION, TIPS } from '../config/money';
import { EXPO, FREEZER, PLATE, SHIFT_TICKETS, STATION, TIMER_BEEP_EVERY, TIMER_CHANNELS } from '../config/shift';
import { BASKET, BOX } from '../config/toss';
import { isFailure, landmarks, qualityAt } from '../game/doneness';
import type { Quality } from '../game/types';
import { Container, damp, newRav, type PhysEvent, PhysWorld, rand, type Rav } from './physics';

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const pick = <T>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];

export type Scene = 'station' | 'freezer' | 'pass' | 'expo';

export class Basket extends Container {
  /** Slot it's cooking in, or null. */
  slot: number | null = null;
  /** Slot it was last hung on, so an emptied basket goes back where it came from. */
  home = 0;
  /** 0 = ravs floating, 1 = flat and submerged (shaken, or weighed down by a basket on top). */
  settle = 0;
  /** 0 = level, 1 = tipped all the way: past the pour angle the ravs pour out the near corner. */
  tilt = 0;
  pourAcc = 0;
  constructor(public id: number) {
    super('basket', BASKET.width, BASKET.wall);
  }
  /** One flavor, "mixed", or null when empty. */
  get flavor(): FlavorId | 'mixed' | null {
    return flavorOf(this.ravs);
  }
}

/**
 * Where a basket's pour corner (the near rim) is, tipped this far (0..1). The basket turns
 * about its middle, so at full tilt it's nearly on its side and the corner is the low point.
 */
export function spoutOf(b: { x: number; y: number; w: number; wall: number }, tilt: number) {
  const a = tilt * PLATE.tiltAngle;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const lx = -b.w / 2;
  const ly = b.wall / 2;
  return { x: b.x + lx * c - ly * s, y: b.y + b.wall / 2 + lx * s + ly * c };
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
  /** Presentation points earned by its boxes so far. */
  style?: number;
}

/** Styrofoam clamshells: small for a 1 gooey, medium for a 3 gooey or a 6, large for a 10. */
export type BoxSize = 'S' | 'M' | 'L';
export type Sauce = 'marinara' | 'ranch' | 'mascarpone';
/** Checkerboard wax paper: 6 inch squares for medium and large boxes, 2 inch for small. */
export type Sheet = 'big' | 'small';

/** Which sauce goes with which flavor. */
export const SAUCE_FOR: Record<FlavorId, Sauce> = { beef: 'marinara', cheese: 'marinara', buffalo: 'ranch', gooey: 'mascarpone' };

let nextBoxId = 1;

export class Box extends Container {
  id = nextBoxId++;
  mode: 'ready' | 'serving' | 'arriving' = 'ready';
  itemId: number | null = null;
  /** Null for the plain box at the pass nobody prepped. */
  size: BoxSize | null = null;
  wax: Sheet | null = null;
  sauces: Sauce[] = [];
  /** Sharpied for an order at expo. */
  labeled = false;
  constructor(size: BoxSize | null = null) {
    super('box', BOX.width, BOX.wall);
    this.size = size;
  }
  get prepped() {
    return this.size !== null;
  }
}

/** The box an item belongs in. */
export function boxSizeFor(item: OrderItem): BoxSize {
  return item.size >= 10 ? 'L' : item.size <= 1 ? 'S' : 'M';
}

/** The sauces an item needs: one per flavor (a split gets both). */
export function saucesFor(item: OrderItem): Sauce[] {
  return [...new Set(item.lines.map((l) => SAUCE_FOR[l.flavor]))];
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
  /** The metal table the boxes sit on (and where a missed rav lands, dead). */
  counterY: number;
  /** Where the basket comes in, above the bowl. */
  homeX: number;
  homeY: number;
  /** The silver bowl's spot, on the shelf by the fryer. */
  bowlX: number;
  bowlY: number;
  /** Where the salt shaker sits when you're not using it. */
  shakerX: number;
  shakerY: number;
}

export type RejectReason = 'cold' | 'burnt' | 'burst' | 'short' | 'wrongorder';

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
  | { type: 'expo'; what: 'box' | 'wax' | 'sauce' | 'label' }
  | { type: 'pour'; x: number; y: number }
  | { type: 'salt'; x: number; y: number; ready: boolean }
  | { type: 'dump'; count: number }
  | { type: 'placed'; x: number; y: number }
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
      style: number;
      missingSauce: boolean;
      salty: boolean;
    }
  | { type: 'rejected'; reason: RejectReason; missing: number }
  | { type: 'bigCombo'; combo: number }
  | { type: 'hint'; text: string }
  | { type: 'waste'; cents: number; count: number; x?: number; y?: number }
  | { type: 'rep'; delta: number; stars: number }
  | { type: 'gameOver'; score: number; best: number; wasted: number; stars: number };

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
  /** Matt's money made this shift, in cents. */
  score = 0;
  /** Matt's money on the floor (and in the trash), in cents. */
  wasted = 0;
  /** The restaurant's reputation, in stars. */
  rep: number = REPUTATION.start;
  /** Prep: no clock. Tickets never expire, stars never drop, nobody gets sent home. */
  prep = false;
  private ticketsPrinted = 0;
  best = 0;
  combo = 0;
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
  /** Boxes open on the board/table: prepped at expo, or plain ones set out at the pass. */
  board: Box[] = [];
  /** The silver salt bowl, and how much salt and tossing the ravs in it have had. */
  bowl = new Container('bowl', PLATE.bowlW, PLATE.bowlWall);
  bowlSalt = 0;
  bowlToss = 0;
  /** The salt shaker at the pass. */
  shaker = { x: 0, y: 0, held: false };
  /** Ravs in your fingers (or tongs), one per finger. */
  heldRavs: Rav[] = [];
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
    this.board = [];
    this.bowl = new Container('bowl', PLATE.bowlW, PLATE.bowlWall);
    this.bowlSalt = 0;
    this.bowlToss = 0;
    this.heldRavs = [];
    this.world = new PhysWorld();
    this.tickets = [];
    this.events = [];
    this.scene = 'station';
    this.timers = TIMER_CHANNELS.map(() => ({ start: null, end: 0, rang: false, lastBeep: 0 }));
  }

  start(prep = false) {
    this.reset();
    this.prep = prep;
    this.ticketsPrinted = 0;
    this.time = 0;
    this.score = 0;
    this.wasted = 0;
    this.rep = REPUTATION.start;
    this.combo = 0;
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
    if (wasted) this.waste([r], b.x + r.lx, b.y + r.ly);
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

  /** Walk over to the bowl and the metal table: with a basket in hand, or empty-handed to plate what's in the bowl. */
  private enterPass(b: Basket | null) {
    const g = this.passGeo;
    if (!g) return;
    if (b) {
      b.x = b.px = b.tx = g.homeX;
      b.y = b.py = b.ty = g.homeY;
      b.vx = b.vy = b.ax = 0;
      b.held = false;
      b.tilt = 0;
      b.ravs.forEach((r, i) => {
        r.state = 'in';
        r.lx = ((i % 4) - 1.5) * 0.42;
        r.ly = 0.1 + Math.floor(i / 4) * 0.2;
        r.lvx = r.lvy = 0;
      });
      this.ensureBoxFor(b.flavor);
    }
    const bowl = this.bowl;
    bowl.held = false;
    bowl.x = bowl.px = bowl.tx = g.bowlX;
    bowl.y = bowl.py = bowl.ty = g.bowlY;
    this.shaker = { x: g.shakerX, y: g.shakerY, held: false };
    this.hands = b ? [b] : [];
    this.layoutTable();
    this.passEmptyAt = null;
    this.world.clear();
    this.world.bounds = { leftX: g.leftX, rightX: g.rightX, floorY: g.counterY };
    this.rewire();
    this.setScene('pass');
  }

  /** Go plate whatever is waiting in the salt bowl (tap the bowl on the fryer screen). */
  openPass() {
    if (this.phase !== 'playing' || this.scene !== 'station') return;
    this.enterPass(null);
  }

  private rewire() {
    this.world.containers = [...this.hands, this.bowl, ...this.board.filter((bx) => bx.mode !== 'serving')];
  }

  /** Line the boxes up along the metal table. */
  private layoutTable() {
    const g = this.passGeo;
    if (!g) return;
    const boxes = this.board.filter((bx) => bx.mode !== 'serving').slice(0, PLATE.tableMax);
    const n = Math.max(2, boxes.length);
    const span = g.rightX - g.leftX;
    boxes.forEach((bx, i) => {
      bx.x = bx.px = g.leftX + (span * (i + 0.5)) / n;
      bx.y = bx.py = g.counterY;
      bx.w = Math.min(2.1, (span / n) * 0.9);
      bx.mode = 'ready';
    });
  }

  /** Open items, oldest ticket first. */
  private openItems() {
    return this.tickets.flatMap((o) => o.items.filter((it) => !it.done).map((item) => ({ order: o, item })));
  }

  /** Make sure there's a box on the table for an open item that wants this flavor: prepped if you did, plain if not. */
  private ensureBoxFor(flavor: FlavorId | 'mixed' | null) {
    const open = this.openItems();
    const wants = (it: OrderItem) => !!flavor && flavor !== 'mixed' && it.lines.some((l) => l.flavor === flavor);
    const ids = new Set(open.filter((x) => wants(x.item)).map((x) => x.item.id));
    if (this.board.some((bx) => bx.itemId !== null && ids.has(bx.itemId))) return;
    const match = open.find((x) => wants(x.item) && !this.board.some((bx) => bx.itemId === x.item.id));
    if (!match || this.board.filter((bx) => bx.mode !== 'serving').length >= PLATE.tableMax) return;
    const plain = new Box();
    plain.itemId = match.item.id;
    this.board.push(plain);
    this.layoutTable();
    this.rewire();
  }

  /** The order item a box is for. */
  itemFor(box: Box): { order: Order; item: OrderItem } | null {
    const id = box.itemId;
    if (id === null) return null;
    for (const order of this.tickets) {
      const item = order.items.find((it) => it.id === id && !it.done);
      if (item) return { order, item };
    }
    return null;
  }

  // ---------- Plating ----------

  /** Tip the basket by its handle: past pourStart the ravs pour out of the near corner. */
  setTilt(b: Basket, t: number) {
    b.tilt = clamp(t, 0, 1);
  }

  /** Pick up one rav with your fingers (or tongs) from the bowl, a box, or the basket in hand. */
  pickRav(x: number, y: number): Rav | null {
    if (this.scene !== 'pass' || this.phase !== 'playing') return null;
    let best: { r: Rav; c: Container } | null = null;
    let bestD = PLATE.pickRadius;
    for (const c of [this.bowl, ...this.board.filter((bx) => bx.mode === 'ready'), ...this.hands]) {
      for (const r of c.ravs) {
        const d = Math.hypot(c.x + r.lx - x, c.y + r.ly - y);
        if (d < bestD) [best, bestD] = [{ r, c }, d];
      }
    }
    if (!best) return null;
    const { r, c } = best;
    c.ravs.splice(c.ravs.indexOf(r), 1);
    if (c === this.bowl) this.saltCheck(r);
    r.state = 'held';
    r.x = c.x + r.lx;
    r.y = c.y + r.ly;
    this.heldRavs.push(r);
    return r;
  }

  moveRav(r: Rav, x: number, y: number) {
    r.x = x;
    r.y = y;
  }

  /** Let go of a rav: over a box or the bowl it settles in where you put it; anywhere else it falls. */
  dropRav(r: Rav) {
    const i = this.heldRavs.indexOf(r);
    if (i < 0) return;
    this.heldRavs.splice(i, 1);
    r.state = 'air';
    r.vx = r.vy = 0;
    r.va = 0;
    r.ignore = null;
    for (const c of [this.bowl, ...this.board]) {
      if (Math.abs(r.x - c.x) < c.w / 2 && r.y < c.top + 1.2 && r.y > c.y - 0.4) {
        r.y = c.top + 0.15; // set it in: it drops the last inch
        this.events.push({ type: 'placed', x: r.x, y: c.top });
        break;
      }
    }
    this.world.ravs.push(r);
  }

  /** The bowl under a point (to slide it for a toss, or carry it over a box to dump). */
  bowlAt(x: number, y: number) {
    const b = this.bowl;
    return this.scene === 'pass' && Math.abs(x - b.x) < b.w / 2 + 0.3 && y > b.y - 0.5 && y < b.top + 0.6;
  }

  shakerAt(x: number, y: number) {
    return this.scene === 'pass' && Math.hypot(x - this.shaker.x, y - this.shaker.y) < 0.7;
  }

  grabBowl(x: number, y: number) {
    const b = this.bowl;
    b.held = true;
    this.bowlHome = false;
    b.tx = b.x;
    b.ty = b.y;
    return { dx: b.x - x, dy: b.y - y };
  }

  moveBowl(x: number, y: number) {
    const b = this.bowl;
    const w = this.world.bounds;
    if (!b.held || this.bowlHome) return;
    b.tx = clamp(x, w.leftX + b.w / 2, w.rightX - b.w / 2);
    b.ty = clamp(y, w.floorY + 0.6, (this.passGeo?.topY ?? 8) - 2);
  }

  moveShaker(x: number, y: number) {
    this.shaker.x = x;
    this.shaker.y = y;
  }

  /** One shake of salt: it only counts over the bowl. */
  shakeSalt() {
    const b = this.bowl;
    const s = this.shaker;
    if (Math.abs(s.x - b.x) > b.w / 2 || s.y < b.top) return;
    this.bowlSalt += 1;
    this.events.push({ type: 'salt', x: s.x, y: s.y - 0.4, ready: this.bowlReady() });
  }

  /** Salted and tossed enough for what's in there. */
  bowlReady() {
    const n = Math.max(1, this.bowl.ravs.length);
    return this.bowlSalt >= Math.max(PLATE.saltMin, n * PLATE.saltPerRav) && this.bowlToss >= PLATE.tossNeed;
  }

  private saltCheck(r: Rav) {
    if (this.bowlSalt > 0 && this.bowlReady()) r.salted = true;
  }

  /** Let go of the bowl: over a box it dumps everything in; anywhere else it goes back to its spot. */
  releaseBowl() {
    const bowl = this.bowl;
    bowl.held = false;
    const g = this.passGeo;
    // Only when you've brought it down to the box: letting go up on the rack just puts it back.
    const target = this.board.find((bx) => bx.mode === 'ready' && Math.abs(bowl.x - bx.x) < bx.w / 2 + 0.4 && bowl.y > bx.top - 0.2 && bowl.y - bx.top < PLATE.dumpAbove);
    if (target && bowl.ravs.length) {
      const n = bowl.ravs.length;
      // Tipped out right into the box: they land in rough rows you can rearrange.
      const cols = Math.max(1, Math.floor((target.w - 0.2) / 0.46));
      [...bowl.ravs].forEach((r, i) => {
        this.saltCheck(r);
        r.state = 'in';
        r.lx = ((i % cols) - (cols - 1) / 2) * 0.46 + (Math.random() - 0.5) * 0.06;
        r.ly = 0.25 + Math.floor(i / cols) * 0.22;
        r.lvx = 0;
        r.lvy = -1;
        r.squash = 1;
        target.ravs.push(r);
      });
      bowl.ravs = [];
      this.events.push({ type: 'dump', count: n });
    }
    if (g) {
      bowl.tx = g.bowlX;
      bowl.ty = g.bowlY;
      bowl.held = true; // spring home
      this.bowlHome = true;
    }
  }

  private bowlHome = false;

  boxAt(x: number, y: number): Box | null {
    if (this.scene !== 'pass') return null;
    return this.board.find((b) => b.mode === 'ready' && Math.abs(x - b.x) < b.w / 2 + 0.2 && y > b.y - 0.6 && y < b.top + 0.9) ?? null;
  }

  // ---------- Expo ----------

  openExpo() {
    if (this.phase !== 'playing' || this.scene !== 'station') return;
    this.setScene('expo');
  }

  closeExpo() {
    if (this.scene === 'expo') this.setScene('station');
  }

  /** Pull a box off a stack onto the cutting board. */
  takeBox(size: BoxSize) {
    if (this.scene !== 'expo') return null;
    if (this.board.length >= EXPO.boardMax) {
      this.hint('The board is full');
      return null;
    }
    const b = new Box(size);
    this.board.push(b);
    this.events.push({ type: 'expo', what: 'box' });
    return b;
  }

  /** Lay a sheet of checkerboard wax paper in a box. The sheet has to fit. */
  lineBox(box: Box, sheet: Sheet) {
    if (!box.prepped || box.wax) return false;
    const fits = box.size === 'S' ? sheet === 'small' : sheet === 'big';
    if (!fits) {
      this.hint(sheet === 'big' ? 'Too big for that box' : 'Too small for that box');
      return false;
    }
    box.wax = sheet;
    this.events.push({ type: 'expo', what: 'wax' });
    return true;
  }

  /** Set a sauce cup in a box (one of each kind at most). */
  sauceBox(box: Box, sauce: Sauce) {
    if (!box.prepped || box.sauces.includes(sauce)) return false;
    if (box.sauces.length >= 2) {
      this.hint('Two cups is plenty');
      return false;
    }
    box.sauces.push(sauce);
    this.events.push({ type: 'expo', what: 'sauce' });
    return true;
  }

  /** Sharpie a box for an open order item. */
  labelBox(box: Box, itemId: number) {
    if (!box.prepped) return false;
    box.itemId = itemId;
    box.labeled = true;
    this.events.push({ type: 'expo', what: 'label' });
    return true;
  }

  trashBox(box: Box) {
    const i = this.board.indexOf(box);
    if (i >= 0) this.board.splice(i, 1);
  }

  /** Items still waiting for a box: open and not already labeled on the board (or at the pass). */
  unboxedItems() {
    const taken = new Set(this.board.filter((b) => b.labeled).map((b) => b.itemId));
    return this.openItems().filter((x) => !taken.has(x.item.id));
  }

  /** Presentation points for a box going out with this item: size, wax paper, label, sauce, salt (0 to 5). */
  presentation(box: Box, item: OrderItem) {
    const need = saucesFor(item);
    const saucesOk = need.every((s) => box.sauces.includes(s)) && box.sauces.every((s) => need.includes(s));
    const savory = box.ravs.filter((r) => r.flavor !== 'gooey');
    const salty = box.ravs.some((r) => r.flavor === 'gooey' && r.salted);
    const saltOk = savory.every((r) => r.salted) && !salty;
    const points =
      Number(box.size === boxSizeFor(item)) +
      Number(!!box.wax) +
      Number(box.labeled && box.itemId === item.id) +
      Number(saucesOk) +
      Number(saltOk);
    const missingSauce = !need.every((s) => box.sauces.includes(s));
    return { points, missingSauce, salty };
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
    void vx;
    void vy;
  }

  /** Leave the pass. A basket that still has ravs goes back on the counter to re-fry or toss again. */
  leavePass() {
    if (this.scene !== 'pass') return;
    const b = this.hands[0];
    if (b?.ravs.length) {
      b.held = false;
      for (const r of b.ravs) r.state = 'in';
      if (!this.hookAnywhere(b)) {
        this.waste(b.ravs);
        b.ravs = [];
        this.hint('No free bar: tossed');
        this.hang(b);
      }
    } else if (b) this.hang(b); // back on the bar
    this.hands = [];
    // Ravs in your fingers go back in the bowl; anything still falling is lost.
    for (const r of this.heldRavs) {
      r.state = 'in';
      r.lx = (Math.random() - 0.5) * this.bowl.w * 0.5;
      r.ly = 0.3;
      this.bowl.ravs.push(r);
    }
    this.heldRavs = [];
    this.waste(this.world.ravs.filter((r) => r.state === 'air'));
    this.layoutTable();
    this.world.clear();
    this.world.containers = [];
    this.setScene('station');
  }

  /**
   * Swipe the box up. Judged against its item, rav by rav:
   * cold, burnt or short goes back; a box that's mostly the wrong flavor goes back;
   * a stray or two goes out with a penalty.
   */
  serve(box: Box) {
    if (this.phase !== 'playing' || box.mode !== 'ready') return;
    if (!box.ravs.length) return this.hint('Box is empty');
    const ref = this.itemFor(box) ?? this.openItems()[0] ?? null;
    if (!ref) return this.hint('No tickets yet');
    const { order, item } = ref;
    box.mode = 'serving';
    box.vy = 0;
    this.layoutTable();
    this.rewire();

    const need = new Map<FlavorId, number>(item.lines.map((l) => [l.flavor, l.count]));
    const have = new Map<FlavorId, number>();
    for (const r of box.ravs) have.set(r.flavor, (have.get(r.flavor) ?? 0) + 1);
    let strays = 0;
    for (const [f, n] of have) strays += Math.max(0, n - (need.get(f) ?? 0));
    const qualities: Quality[] = box.ravs.map((r) => qualityAt(r.cooked, r.flavor, r.fryer));
    const missing = item.size - box.ravs.length;
    const fail = qualities.find(isFailure);

    let reason: RejectReason | null = null;
    if (fail) reason = fail === 'cold' ? 'cold' : fail === 'popped' ? 'burst' : 'burnt';
    else if (strays * 2 > item.size) reason = 'wrongorder';
    else if (missing > 0) reason = 'short';
    if (reason) {
      // Sent back: those ravs are in the trash, and the item stays open. Fire it again.
      this.combo = 0;
      this.waste(box.ravs);
      this.repChange(reason === 'wrongorder' ? REPUTATION.wrongOrder : REPUTATION.rejected);
      this.events.push({ type: 'rejected', reason, missing: Math.max(0, missing) });
      return;
    }

    item.done = true;
    // Which ravs belong; strays and extras are given away (Matt's money).
    const used = new Map<FlavorId, number>();
    const givenAway: Rav[] = [];
    let perfect = strays === 0;
    let sloppy = false;
    box.ravs.forEach((r, i) => {
      const n = used.get(r.flavor) ?? 0;
      if (n >= (need.get(r.flavor) ?? 0)) {
        givenAway.push(r);
        return;
      }
      used.set(r.flavor, n + 1);
      if (r.uneven || r.greasy) sloppy = true;
      if (qualities[i] !== 'perfect' || r.uneven || r.greasy) perfect = false;
    });
    const extra = Math.max(0, givenAway.length - strays);
    const style = this.presentation(box, item);
    if (style.missingSauce) this.repChange(PRESENTATION.missingSauce);
    if (style.salty) this.repChange(PRESENTATION.saltyDessert);
    if (style.points) this.repChange(PRESENTATION.repPerPoint * style.points);
    order.style = (order.style ?? 0) + style.points;
    const price = this.itemPrice(item);
    this.score += price;
    this.waste(givenAway);
    if (strays) this.repChange(REPUTATION.stray * strays);
    if (sloppy) this.repChange(REPUTATION.sloppy);

    const orderDone = order.items.every((it) => it.done);
    let tip = 0;
    if (orderDone) {
      // The whole ticket went out: tip on the ticket total, faster and cleaner tips more.
      const waited = (this.time - order.bornAt) / order.life;
      const total = order.items.reduce((s, it) => s + this.itemPrice(it), 0);
      const clean = order.items.every((it) => it.done) && perfect;
      this.combo = clean ? this.combo + 1 : 0;
      const styleRate = (PRESENTATION.tipPerPoint * (order.style ?? 0)) / order.items.length;
      const rate =
        (TIPS.base + TIPS.speed * Math.max(0, 1 - waited) + Math.min(TIPS.comboMax, TIPS.perCombo * this.combo) + styleRate) *
        (clean ? 1 : TIPS.sloppy);
      tip = Math.round(total * rate);
      this.score += tip;
      this.tickets.splice(this.tickets.indexOf(order), 1);
      if (waited > 0.7) this.repChange(REPUTATION.slow);
      else if (clean && waited < 0.5) this.repChange(REPUTATION.perfectFast);
      else this.repChange(REPUTATION.clean);
      if (clean) {
        const past = this.combo - SCORING.bigComboAt;
        if (past >= 0 && past % SCORING.bigComboEvery === 0) this.events.push({ type: 'bigCombo', combo: this.combo });
      }
    } else if (!perfect) this.combo = 0;
    this.events.push({ type: 'served', quality: perfect ? 'perfect' : 'ok', points: price, tip, combo: this.combo, extra, strays, uneven: sloppy, orderDone, style: style.points, missingSauce: style.missingSauce, salty: style.salty });
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
      if (this.scene === 'pass') this.stepPlating(dt);
      this.world.step(dt);
      for (const ev of this.world.events) {
        if (ev.type === 'dead') this.wasteCents(RAV_PRICE[ev.flavor], 1, ev.x, ev.y);
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
      // An empty basket at the pass goes back on its bar; you stay to plate.
      const b = this.hands[0];
      if (this.scene === 'pass' && b && !b.ravs.length && !b.held) {
        this.passEmptyAt ??= this.time;
        if (this.time - this.passEmptyAt > 0.6) {
          this.hang(b);
          this.hands = [];
          this.rewire();
        }
      } else this.passEmptyAt = null;
    } else this.flyBoxes(dt);

    this.updateTickets();
    if (!this.prep && this.rep <= REPUTATION.fireAt) this.gameOver();
  }

  /** The pass, every frame: the bowl and shaker follow your fingers, the basket pours, salt sets in, served boxes fly. */
  private stepPlating(dt: number) {
    const bowl = this.bowl;
    const k = damp(bowl.held ? BASKET.follow : 0, dt);
    const nx = bowl.x + (bowl.tx - bowl.x) * k;
    const ny = bowl.y + (bowl.ty - bowl.y) * k;
    if (!this.bowlHome) this.bowlToss += Math.abs(nx - bowl.x);
    this.world.moveContainer(bowl, nx, ny, dt);
    if (this.bowlHome && Math.hypot(bowl.x - bowl.tx, bowl.y - bowl.ty) < 0.02) {
      bowl.held = false;
      this.bowlHome = false;
    }
    if (!bowl.ravs.length && !this.world.ravs.some((r) => r.state === 'air')) {
      this.bowlSalt = 0;
      this.bowlToss = 0;
    }
    if (this.bowlReady()) for (const r of bowl.ravs) r.salted = true;
    // A box on the table for whatever you're plating.
    const flavors = new Set<FlavorId>([...bowl.ravs, ...this.heldRavs, ...this.hands.flatMap((h) => h.ravs)].map((r) => r.flavor));
    for (const f of flavors) this.ensureBoxFor(f);

    // Bring the basket over the bowl and it tips on its own: the near corner becomes a spout.
    // Pull it away (or leave it parked there) and it does what you'd expect.
    for (const b of this.hands) {
      const land = spoutOf(b, 1).x - PLATE.pourDrift;
      const over = b.ravs.length > 0 && Math.abs(land - bowl.x) < bowl.w / 2 - PLATE.pourMargin && b.y > bowl.top + 0.2;
      b.tilt += ((over ? 1 : 0) - b.tilt) * damp(PLATE.tiltRate, dt);
    }
    // Pour: tipped past the pour angle, ravs come out of the near (left) corner.
    for (const b of this.hands) {
      if (b.tilt <= PLATE.pourStart || !b.ravs.length) continue;
      b.pourAcc = (b.pourAcc ?? 0) + dt * PLATE.pourRate * ((b.tilt - PLATE.pourStart) / (1 - PLATE.pourStart));
      while (b.pourAcc >= 1 && b.ravs.length) {
        b.pourAcc -= 1;
        const r = b.ravs.reduce((a, c) => (c.lx < a.lx ? c : a));
        b.ravs.splice(b.ravs.indexOf(r), 1);
        r.state = 'air';
        const sp = spoutOf(b, b.tilt);
        r.x = sp.x - 0.1;
        r.y = sp.y + 0.05;
        r.vx = b.vx - 0.5 - Math.random() * 0.5;
        r.vy = b.vy - 0.8;
        r.va = (Math.random() - 0.5) * 6;
        r.ignore = b;
        r.ignoreUntil = this.time + 0.4;
        this.world.ravs.push(r);
        this.events.push({ type: 'pour', x: r.x, y: r.y });
      }
    }
    this.flyBoxes(dt);
  }

  /** Served boxes fly up and out; the table closes ranks. */
  private flyBoxes(dt: number) {
    const g = this.passGeo;
    let gone = false;
    for (const bx of [...this.board]) {
      if (bx.mode !== 'serving') continue;
      bx.px = bx.x;
      bx.py = bx.y;
      bx.vy += 40 * dt;
      bx.y += bx.vy * dt;
      if (!g || bx.y > g.topY + 2) {
        this.board.splice(this.board.indexOf(bx), 1);
        gone = true;
      }
    }
    if (gone) {
      this.layoutTable();
      this.rewire();
    }
  }

  /** A real-menu item: savory 6 or 10, maybe split 3/3 or 5/5; gooey butter 1 or 3, never split. */
  private newItem(minutes: number, easy = false): OrderItem {
    const T = SHIFT_TICKETS;
    const flavor = (easy ? pick(SHIFT_FLAVORS.filter((f) => FLAVORS[f].splits)) : pick(SHIFT_FLAVORS)) ?? 'beef';
    const sizes = FLAVORS[flavor].sizes;
    const bigChance = easy ? 0 : Math.min(T.bigOrderChanceMax, T.bigOrderChanceStart + T.bigOrderRampPerMinute * minutes);
    const size = (Math.random() < bigChance ? sizes[sizes.length - 1] : sizes[0]) ?? 6;
    let lines: OrderLine[] = [{ flavor, count: size }];
    const splitChance = easy ? 0 : Math.min(T.splitChanceMax, T.splitChanceStart + T.splitRampPerMinute * minutes);
    if (FLAVORS[flavor].splits && Math.random() < splitChance) {
      const other = pick(SHIFT_FLAVORS.filter((f) => f !== flavor && FLAVORS[f].splits));
      if (other) lines = [{ flavor, count: size / 2 }, { flavor: other, count: size / 2 }];
    }
    return { id: this.nextId++, size, lines, done: false };
  }

  private updateTickets() {
    const T = SHIFT_TICKETS;
    for (const t of [...this.tickets]) {
      if (!this.prep && this.time - t.bornAt >= t.life) {
        this.tickets.splice(this.tickets.indexOf(t), 1);
        for (const bx of this.board) if (t.items.some((it) => it.id === bx.itemId)) bx.itemId = null;
        this.events.push({ type: 'ticketExpired', ticket: t });
        this.repChange(REPUTATION.expired);
      }
    }
    const railMax = this.prep ? T.prepRail : T.railMax;
    if (this.time >= this.nextTicketAt && this.tickets.length < railMax) {
      // Prep holds the ramp at the start of a shift; a real shift gets busier by the minute.
      const minutes = this.prep ? 0.5 : this.time / 60;
      const easy = this.ticketsPrinted < T.warmupTickets;
      this.ticketsPrinted++;
      const items = [this.newItem(minutes, easy)];
      const extra = easy ? 0 : Math.min(T.extraItemChanceMax, T.extraItemChanceStart + T.extraItemRampPerMinute * minutes);
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

  /** Ravs lost: what the customer would have paid for them comes out of Matt's money. */
  private waste(ravs: Rav[], x?: number, y?: number) {
    if (!ravs.length) return;
    const cents = ravs.reduce((s, r) => s + RAV_PRICE[r.flavor], 0);
    this.wasteCents(cents, ravs.length, x, y);
  }

  private wasteCents(cents: number, count: number, x?: number, y?: number) {
    this.score -= cents;
    this.wasted += cents;
    this.events.push({ type: 'waste', cents, count, x, y });
  }

  private repChange(delta: number) {
    if (this.prep && delta < 0) delta = 0; // prep: practice, no stars lost
    this.rep = clamp(this.rep + delta, 0, REPUTATION.max);
    this.events.push({ type: 'rep', delta, stars: this.rep });
  }

  /** What an item costs the customer, in cents. */
  itemPrice(item: OrderItem) {
    const gooey = item.lines.every((l) => l.flavor === 'gooey');
    const table = gooey ? MENU.gooey : MENU.savory;
    return table[item.size] ?? item.lines.reduce((s, l) => s + RAV_PRICE[l.flavor] * l.count, 0);
  }

  /** End a prep session (or a shift) on purpose. */
  clockOut() {
    if (this.phase === 'playing' || this.phase === 'paused') this.gameOver();
  }

  private gameOver() {
    this.phase = 'over';
    if (!this.prep && this.score > this.best) {
      this.best = this.score;
      saveBest(this.best);
    }
    this.events.push({ type: 'gameOver', score: this.score, best: this.best, wasted: this.wasted, stars: this.rep });
  }
}

function loadBest(): number {
  try {
    return Number(localStorage.getItem(`${BEST_SCORE_KEY}.shift.cents`) ?? 0) || 0;
  } catch {
    return 0;
  }
}

function saveBest(n: number) {
  try {
    localStorage.setItem(`${BEST_SCORE_KEY}.shift.cents`, String(n));
  } catch {
    /* no storage: the run still counts */
  }
}
