import { PATIENCE, POINTS, VIRAL } from '../config/arcade';
import { FLAVORS, SHIFT_FLAVORS, type FlavorId } from '../config/flavors';
import { BEST_SCORE_KEY, FRYERS, SCORING, SLOTS_PER_FRYER } from '../config/game';
import { MENU, PRESENTATION, RAV_PRICE, REPUTATION, TIPS } from '../config/money';
import { NAMES } from '../config/names';
import { EXPO, FREEZER, PLATE, SAUCE, SHIFT_TICKETS, STATION, TIMER_BEEP_EVERY, TIMER_CHANNELS, STAGE } from '../config/shift';
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
  /** A modifier on the ticket: this sauce instead of the usual one ("SUB RANCH"). */
  sub?: Sauce;
}

/** A ticket on the rail. Only the fried-food lines; the sandwiches are somebody else's problem. */
export interface Order {
  id: number;
  /** Who it's for: on the ticket, and in Sharpie on the lid. */
  name?: string;
  items: OrderItem[];
  bornAt: number;
  life: number;
  /** Presentation points earned by its boxes so far. */
  style?: number;
  /** Ravs thrown in on the house across its boxes. */
  generous?: number;
  /** Boxes of this ticket that went out with a readable name on them. */
  named?: number;
  /** Boxes of this ticket with a crossed-out name on the lid. */
  crossed?: number;
  /** A box of theirs went home with someone else: this is it again, on the house and in a hurry. */
  remake?: boolean;
}

/** Styrofoam clamshells: small for a 1 gooey, medium for a 3 gooey or a 6, large for a 10. */
export type BoxSize = 'S' | 'M' | 'L';
export type Sauce = 'marinara' | 'ranch' | 'mascarpone';
/** Checkerboard wax paper: 6 inch squares for medium and large boxes, 2 inch for small. */
export type Sheet = 'big' | 'small';

/** Which sauce goes with which flavor. */
export const SAUCE_FOR: Record<FlavorId, Sauce> = { beef: 'marinara', cheese: 'marinara', buffalo: 'ranch', gooey: 'mascarpone' };

let nextBoxId = 1;

/** A flake of garnish on a rav: which rav, which side, where on it. */
export interface PlateFlake {
  id: number;
  side: 0 | 1;
  dx: number;
  dz: number;
  kind: string;
}

/** A box's plating so far, by rav id. */
export interface Plate {
  cells: Record<number, [number, number]>;
  sides: Record<number, 0 | 1>;
  garnish: Record<number, Record<string, number>>;
  flakes: PlateFlake[];
}

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
  /** A marinara cup that had gone cold when it went in. */
  coldSauce = false;
  /** How the Sharpie went: clean, readable, or a scrawl nobody can read (null: not written). */
  labelQuality: 'clean' | 'ok' | 'scrawl' | null = null;
  /** The name was scrawled, struck through and written again: it's all still on the lid. */
  crossedOut = false;
  /** Presentation from the box close-up: how much of the layout is filled neatly, and how well it's dressed (0..1). */
  arranged = 0;
  garnish = 0;
  /** Set in the house layout (Dan's 3 / 2 / 1, nested left, cup bottom right, and its cousins). */
  houseStyle = false;
  /** How far along it is in the close-up: which cell each rav is in, flips, garnish (so a set box keeps waiting for the cold table). */
  plate: Plate | null = null;
  constructor(size: BoxSize | null = null) {
    super('box', BOX.width, BOX.wall);
    this.size = size;
    this.spillSpeed = PLATE.spillSpeed;
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
/** The big black cups go in a large box (a 10) and with 3 gooey; everything else gets the small clear ones. */
export function bigCupsFor(size: BoxSize | null, sauces: Sauce[]) {
  return size === 'L' || (size === 'M' && sauces.includes('mascarpone'));
}

export function saucesFor(item: OrderItem): Sauce[] {
  if (item.sub) return [item.sub];
  return [...new Set(item.lines.map((l) => SAUCE_FOR[l.flavor]))];
}

/** The sauce a guest might ask for instead (nobody subs the mascarpone). */
export const SUB_FOR: Record<FlavorId, Sauce | null> = { beef: 'ranch', cheese: 'ranch', buffalo: 'marinara', gooey: null };

/** One line of the shift's record: a box served, a box sent back, or a guest who gave up. */
export interface LogEntry {
  name: string;
  what: string;
  /** What it brought in, cents (0 for a send-back or a walk-out). */
  cents: number;
  result: 'served' | 'sent back' | 'walked out';
  /** Everything that wasn't right about it, in plain words. Empty is a clean box. */
  issues: string[];
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

/** How far along an order item is: 0 nothing yet, 1 in a basket, 2 frying, 3 cooked, 4 salted, 5 boxed. */
export type Stage = 0 | 1 | 2 | 3 | 4 | 5;

/** Where the fryer screen points you next. */
export interface NextJob {
  text: string;
  target: 'freezer' | 'expo' | 'bowl' | 'oil' | 'bar' | null;
  /** Which step this is, for nudges (see config/nudges.ts). */
  key?: 'pull' | 'toBowl' | 'plate' | 'drop' | 'freezer' | 'box' | 'cook';
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
  /** The bowl finished pouring into a box: time to arrange it. */
  | { type: 'boxFilled'; boxId: number }
  | { type: 'pourIn'; boxId: number; flavor: FlavorId; from: 'bowl' | 'basket' }
  | { type: 'onCount'; count: number }
  | { type: 'passEmpty' }
  | { type: 'noName'; name: string; other: string }
  | { type: 'silly'; name: string }
  | { type: 'freezerShut' }
  | { type: 'freezerBeep' }
  | { type: 'overCount'; over: number }
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
      /** Arcade points this box scored, and the multiplier it scored them at. */
      pts: number;
      mult: number;
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
      /** The sauce it should have had and didn't, and whether one it shouldn't have was in there. */
      wantedSauce: Sauce | null;
      wrongSauce: boolean;
      salty: boolean;
      generous: number;
      coldSauce: boolean;
      name: string;
      bigTip: boolean;
    }
  | { type: 'rejected'; reason: RejectReason; missing: number; name: string }
  /** A cup came off the ladle: lidded and into stock. */
  | { type: 'sauced'; sauce: Sauce; fill: number; perfect: boolean; spare: boolean }
  | { type: 'spill'; sauce: Sauce }
  | { type: 'bigCombo'; combo: number }
  | { type: 'viral'; on: boolean }
  | { type: 'spareUsed'; sauce: Sauce }
  | { type: 'outOfSauce'; sauce: Sauce }
  | { type: 'volley'; count: number; caught: number }
  /** Pulled a basket out of the oil: all perfect, and/or right as its timer went off. */
  | { type: 'pulled'; perfect: boolean; onTime: boolean; count: number }
  /** Dropped one basket that covers two or more orders. */
  | { type: 'batched'; flavor: FlavorId; orders: number }
  | { type: 'nailed'; flavor: FlavorId; count: number }
  | { type: 'hint'; text: string }
  | { type: 'waste'; cents: number; count: number; x?: number; y?: number }
  | { type: 'rep'; delta: number; stars: number }
  | { type: 'gameOver'; score: number; best: number; wasted: number; stars: number; points: number; fired: boolean; bestCombo: number; served: number; prep: boolean };

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
/** How it's written on the lid: "6pc Buffalo", "5/5 Beef/Chz", "3 Gooey". */
export function lidOrder(item: OrderItem) {
  const word = (f: FlavorId) => ({ beef: 'OG Beef', cheese: 'Cheese', buffalo: 'Buffalo', gooey: 'Gooey' })[f];
  if (item.lines.length > 1) return `${item.lines.map((l) => l.count).join('/')}\n${item.lines.map((l) => word(l.flavor)).join('/')}`;
  const f = item.lines[0]?.flavor ?? 'beef';
  return `${item.size}pc\n${word(f)}`;
}

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
  /** The arcade score, and the best run of clean tickets this shift. */
  points = 0;
  bestCombo = 0;
  served = 0;
  /** The place is viral until this time (game seconds); 0 when it isn't. How many times it has been. */
  viralUntil = 0;
  viralNext = 0;
  heat = 0;
  /** Extra on the multiplier for working on the beat (set by the pulse). */
  groove = 0;
  /** Why the shift ended. */
  fired = false;
  tickets: Order[] = [];
  /** Every box that went to the window (or didn't), newest last: what it was and what was wrong with it. */
  log: LogEntry[] = [];
  /** Printed but not hung yet: face-down at the left of the rail until there is room. */
  pile: Order[] = [];
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
  bowl = Object.assign(new Container('bowl', PLATE.bowlW, PLATE.bowlWall), { spillSpeed: PLATE.spillSpeed });
  bowlSalt = 0;
  bowlToss = 0;
  /** The salt shaker at the pass. */
  shaker = { x: 0, y: 0, held: false };
  /** Ravs in your fingers (or tongs), one per finger. */
  heldRavs: Rav[] = [];
  /** Lidded sauce cups ready on the table, by sauce. Marinara and ranch get ladled; the mascarpone comes pre-portioned. */
  cupStock: Record<Sauce, number> = { ...SAUCE.startStock };
  /** When each lidded marinara cup on the table was ladled (oldest first): hot sauce goes cold. */
  hotCups: number[] = [];
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
    this.log = [];
    this.pile = [];
    this.freezerTemp = FREEZER.tempCold;
    this.bowl = Object.assign(new Container('bowl', PLATE.bowlW, PLATE.bowlWall), { spillSpeed: PLATE.spillSpeed });
    this.bowlSalt = 0;
    this.bowlToss = 0;
    this.heldRavs = [];
    this.cupStock = { ...SAUCE.startStock };
    this.hotCups = Array.from({ length: SAUCE.startStock.marinara }, () => 0);
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
    this.points = 0;
    this.bestCombo = 0;
    this.served = 0;
    this.viralUntil = 0;
    this.viralNext = VIRAL.notBefore;
    this.heat = 0;
    this.groove = 0;
    this.fired = false;
    this.nextTicketAt = SHIFT_TICKETS.firstArrival;
    this.bagReadyAt = SHIFT_FLAVORS.map(() => 0);
    this.warnedMixed.clear();
    this.phase = 'playing';
  }

  /** No tickets print by themselves (the demo writes its own). */
  holdTickets() {
    this.nextTicketAt = Infinity;
  }

  /** Back to the title with a clean kitchen (the demo's over). */
  toTitle() {
    this.reset();
    this.phase = 'title';
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

  /**
   * Press a flavor's button on the wall timer. It silences one that's ringing; otherwise it starts the
   * next free channel, so a second (or third) batch of the same flavor can be going, staggered, while the
   * first finishes. With every channel running it cancels the newest (fat-fingered it).
   */
  pressFlavorTimer(f: FlavorId) {
    const chans = TIMER_CHANNELS.map((c, i) => ({ c, i })).filter((x) => x.c.flavor === f).map((x) => x.i);
    const ringing = chans.find((i) => this.timers[i]?.rang);
    if (ringing !== undefined) return this.pressTimer(ringing);
    const idle = chans.find((i) => this.timers[i]?.start === null);
    if (idle !== undefined) return this.pressTimer(idle);
    const newest = chans.reduce((a, i) => ((this.timers[i]?.start ?? -1) > (this.timers[a]?.start ?? -1) ? i : a), chans[0] ?? 0);
    this.pressTimer(newest);
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

  /**
   * Where a slot's back bar is, in the freezer's world (set by the views): baskets glide from their bar
   * into the freezer and back to it, so you can see it's the same basket.
   */
  slotPos: ((slot: number) => { x: number; y: number } | null) | null = null;
  /**
   * One stage: the fryers, the freezer and the bowl share one front-on view and one set of objects.
   * A basket is picked up from where it's drawn and set down where you leave it; nothing glides or
   * swaps for you. shownPos is where the stage is drawing a basket right now.
   */
  stage = false;
  shownPos: ((b: Basket) => { x: number; y: number } | null) | null = null;
  /** Baskets gliding to a spot (into the freezer, or back down to a bar on the way out). */
  private glide = new Map<Basket, { x: number; y: number }>();
  /** Walking out: seconds until the freezer shuts (null: not leaving). */
  private leaving: number | null = null;
  get freezerLeaving() {
    return this.leaving !== null;
  }

  /**
   * Walk out of the freezer: the baskets glide back down to the bars they'll hang on, the lid comes
   * down, then you're back at the fryers.
   */
  leaveFreezer() {
    if (this.scene !== 'freezer' || this.leaving !== null) return;
    this.leaving = FREEZER.glideOut;
    this.events.push({ type: 'freezerShut' });
    this.returning.clear();
    for (const b of this.hands) {
      // One stage: the basket stays in your hand while the lid comes down, for whatever's still in the air.
      if (!this.stage) b.held = false;
      const s = b.ravs.length && !this.stage ? this.hookSlot(b) : null;
      const at = s !== null ? this.slotPos?.(s) : null;
      if (at) this.glide.set(b, at);
    }
  }

  /** How long the freezer's been open this time (it beeps, then it costs you). */
  /** The freezer's temperature, °F: up while it's open, back down while it's shut. */
  freezerTemp: number = FREEZER.tempCold;
  private freezerBeepAt = 0;
  private freezerWarmAt = 0;

  /** Baskets on their way back to a bar (you let go of them): basket -> slot. */
  private returning = new Map<Basket, number>();

  /**
   * Freezer open: grab a basket straight off a slot's bar to catch with. A raw basket already hanging
   * there comes with what's in it (to top it up); otherwise the top empty one.
   */
  /**
   * What a flying rav can land in: the baskets in your hands, and (one stage) the ones still on
   * their bars: the top empty one of each stack, and any hanging there with frozen ravs in it.
   */
  private catchers(): Container[] {
    const out: Container[] = [...this.hands];
    if (!this.stage || this.scene !== 'freezer') return out;
    this.slots.forEach((_, slot) => {
      const full = this.hooked[slot];
      const b = full ? (full.ravs.every((r) => r.cooked <= FREEZER.topUpMax) ? full : null) : (this.hung[slot]?.at(-1) ?? null);
      if (!b) return;
      const at = this.shownPos?.(b);
      if (!at) return;
      b.x = b.px = b.tx = at.x;
      b.y = b.py = b.ty = at.y;
      b.vx = b.vy = b.ax = 0;
      b.held = false;
      out.push(b);
    });
    return out;
  }

  /** A basket on its bar that caught something is now a basket of ravs hanging on its hook. */
  private barCatches() {
    this.slots.forEach((_, slot) => {
      const b = this.hung[slot]?.at(-1);
      if (!b || !b.ravs.length || this.hooked[slot]) return;
      this.hung[slot]?.pop();
      b.home = slot;
      this.hooked[slot] = b;
      this.hookedAt.set(b, this.time);
      this.events.push({ type: 'hook', slot, full: true });
    });
  }

  takeFromBar(slot: number, x: number, y: number): Basket | null {
    if (this.scene !== 'freezer' || this.leaving !== null || this.hands.length >= FREEZER.maxBaskets) return null;
    let b: Basket | null = null;
    const full = this.hooked[slot];
    if (full && full.ravs.length && full.ravs.every((r) => r.cooked <= FREEZER.topUpMax)) {
      b = full;
      this.hooked[slot] = null;
      this.hookedAt.delete(full);
    } else if (!full) {
      const nest = this.hung[slot];
      b = nest?.pop() ?? null;
      if (b) b.ravs = [];
    }
    if (!b) return null;
    b.home = slot;
    b.settle = 0;
    // One stage: it's picked up from exactly where it hangs. (Classic: it appears under your finger.)
    const at = this.stage ? this.shownPos?.(b) : null;
    b.x = b.px = b.tx = at ? at.x : x;
    b.y = b.py = b.ty = at ? at.y : y - b.wall / 2;
    b.vx = b.vy = b.ax = 0;
    b.held = false;
    for (const r of b.ravs) r.state = 'in';
    this.hands.push(b);
    this.world.containers = this.catchers();
    return b;
  }

  /**
   * Freezer open, one stage: take back a basket you lowered into the oil too soon, to catch more in
   * it. Only while it's barely started; past that it stays where it is.
   */
  takeFromOil(slot: number): Basket | null {
    if (!this.stage || this.scene !== 'freezer' || this.leaving !== null || this.hands.length >= FREEZER.maxBaskets) return null;
    const stack = this.slots[slot];
    const b = stack?.at(-1);
    if (!stack || !b) return null;
    // Too far along to top up: it's not coming to the freezer. (It can still be pulled, as ever.)
    if (b.ravs.some((r) => r.cooked > FREEZER.topUpMax)) return null;
    stack.pop();
    b.slot = null;
    b.home = slot;
    b.settle = 0;
    const at = this.shownPos?.(b);
    if (at) {
      b.x = b.px = b.tx = at.x;
      b.y = b.py = b.ty = at.y;
    }
    b.vx = b.vy = b.ax = 0;
    b.held = false;
    for (const r of b.ravs) r.state = 'in';
    this.hands.push(b);
    this.world.containers = this.catchers();
    this.events.push({ type: 'lift', slot });
    return b;
  }

  /** Let go of a basket in the freezer: it flies back to its bar and hangs there (grab it again any time). */
  returnToBar(b: Basket) {
    if (this.scene !== 'freezer' || !this.hands.includes(b) || this.leaving !== null) return;
    const slot = b.ravs.length ? (this.hookSlot(b) ?? b.home) : b.home;
    const at = this.stage ? null : this.slotPos?.(slot);
    this.returning.set(b, slot);
    if (at) this.glide.set(b, at);
    else this.landOnBar(b); // one stage: it's hung at once, and the stage eases it up there
  }

  /** Freezer open, one stage: lower the basket in your hand straight into a slot's oil. */
  handToOil(b: Basket, slot: number) {
    if (this.scene !== 'freezer' || !this.hands.includes(b) || !b.ravs.length || this.leaving !== null) return false;
    const stack = this.slots[slot];
    if (!stack || stack.length >= STATION.stackMax) return false;
    this.hands = this.hands.filter((x) => x !== b);
    this.world.containers = this.catchers();
    this.glide.delete(b);
    this.returning.delete(b);
    b.held = false;
    for (const r of b.ravs) r.state = 'in';
    this.carrying.push(b);
    if (this.placeInOil(b, slot)) return true;
    this.letGo(b);
    this.hands.push(b);
    this.world.containers = this.catchers();
    return false;
  }

  private landOnBar(b: Basket) {
    const slot = this.returning.get(b) ?? b.home;
    this.returning.delete(b);
    this.glide.delete(b);
    this.hands = this.hands.filter((x) => x !== b);
    this.world.containers = this.catchers();
    b.held = false;
    for (const r of b.ravs) r.state = 'in';
    if (b.ravs.length) {
      if (!(this.hooked[slot] ? this.hookAnywhere(b) : this.hookOn(b, slot))) this.inFreezer.push(b);
    } else this.hang(b);
  }

  /** Open the freezer. The baskets stay on their bars; any you left in there are waiting. */
  openFreezer() {
    if (this.phase !== 'playing' || this.scene !== 'station') return;
    const g = this.freezerGeo;
    if (!g) return;
    // Nothing's carried in: the baskets stay on their bars, and you grab one off its bar to catch with.
    const carrying: Basket[] = [];
    this.selected = [];
    this.returning.clear();
    this.world.catchGrace = FREEZER.catchGrace;
    this.volley = null;
    this.nailed.clear();
    const all = [...this.inFreezer, ...carrying];
    this.hands = all.slice(0, FREEZER.maxBaskets);
    for (const extra of all.slice(FREEZER.maxBaskets)) this.hang(extra); // more than you can carry: back on a bar
    this.inFreezer = [];
    const xs = FREEZER.homeX[this.hands.length - 1] ?? [0];
    this.leaving = null;
    this.glide.clear();
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
    this.world.containers = this.catchers();
    this.freezerBeepAt = 0;
    this.freezerWarmAt = 0;
    this.setScene('freezer');
  }

  /** Lift the top basket out of a slot's oil into your hand. It stops cooking. */
  liftFromOil(slot: number): Basket | null {
    // The freezer being open doesn't stop you pulling a basket that's done.
    if (this.phase !== 'playing' || (this.scene !== 'station' && !(this.stage && this.scene === 'freezer'))) return null;
    const b = this.slots[slot]?.pop() ?? null;
    if (!b) return null;
    b.slot = null;
    // Floaters that never got shaken or weighed down cooked uneven.
    for (const r of b.ravs) if (r.cooked > 0 && b.settle < 1) r.uneven = true;
    if (b.ravs.length && b.ravs.every((r) => r.cooked > 0)) {
      const perfect = b.ravs.every((r) => this.qualityOf(r) === 'perfect' && !r.uneven);
      // Pulled within a couple of seconds of a timer for this flavor going off.
      const f = b.flavor;
      const onTime = f !== null && f !== 'mixed' && this.timers.some((t, i) => TIMER_CHANNELS[i]?.flavor === f && t.start !== null && t.rang && this.time - t.end < PLATE.onTimeWindow);
      this.events.push({ type: 'pulled', perfect, onTime, count: b.ravs.length });
    }
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
    if (!b.ravs.some((r) => r.cooked > 0)) {
      b.settle = 0; // raw ones float until you shake them
      // One basket for two orders' worth: the batching move.
      const f = b.flavor;
      if (f && f !== 'mixed') {
        let left = b.ravs.length;
        let orders = 0;
        for (const { item } of this.openItems()) {
          const need = item.lines.filter((l) => l.flavor === f).reduce((s, l) => s + l.count, 0);
          if (!need || need > left) continue;
          left -= need;
          orders++;
        }
        if (orders >= 2) this.events.push({ type: 'batched', flavor: f, orders });
      }
    }
    this.events.push({ type: 'drop', slot, nested, flavor: b.flavor });
    return true;
  }

  /** Can an empty basket go on top of this slot's frying basket as a weight? */
  canWeigh(slot: number) {
    const stack = this.slots[slot];
    return !!stack && stack.length > 0 && stack.length < STATION.stackMax && !!stack.at(-1)?.ravs.length;
  }

  /**
   * Set an empty basket on top of a frying one, like the line does: it holds the ravs under the oil
   * so they cook flat and even. Lift it off (it comes up first) before you pull the ravs.
   */
  weighDown(b: Basket, slot: number) {
    if (b.ravs.length || !this.canWeigh(slot)) return false;
    const stack = this.slots[slot];
    if (!stack) return false;
    this.letGo(b);
    for (const under of stack) under.settle = 1;
    stack.push(b);
    b.slot = slot;
    b.settle = 1;
    this.events.push({ type: 'drop', slot, nested: true, flavor: null });
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
    const s = this.hookSlot(b);
    return s === null ? false : this.hookOn(b, s);
  }

  /** The bar a full basket would hook on (null: none free). */
  private hookSlot(b: Basket) {
    const order = this.hooked.map((_, i) => i).sort((x, y) => Number(this.isHot(x)) - Number(this.isHot(y)) || (this.slots[x]?.length ?? 0) - (this.slots[y]?.length ?? 0));
    return [b.home, ...order].find((s) => !this.hooked[s]) ?? null;
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
    if (from.kind === 'oil' && !b.ravs.length && this.weighDown(b, from.slot)) return;
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

  /** The ravs you've flung up in one quick burst, and how many of them you caught. */
  private volley: { ids: Set<number>; caught: number; dead: number; lastAt: number } | null = null;
  /** Flavors whose count you've already been told you nailed this trip. */
  private nailed = new Set<string>();

  /** How many of a flavor the open tickets still need from the freezer (not counting what's in your hands). */
  /** What the tickets still need from the freezer, by flavor, minus what's already in your baskets. */
  freezerNeeds() {
    const out: { flavor: FlavorId; need: number; have: number }[] = [];
    for (const f of SHIFT_FLAVORS) {
      const need = this.freezerNeed(f);
      const have = this.hands.reduce((s, b) => s + b.ravs.filter((r) => r.flavor === f).length, 0);
      if (need > 0) out.push({ flavor: f, need, have });
    }
    return out;
  }

  /** Is a volley just starting (the next rav out of a bag starts a new one)? */
  volleyFresh() {
    return !this.volley || this.time - this.volley.lastAt > FREEZER.volleyGap;
  }

  private freezerNeed(f: FlavorId) {
    const want = this.openItems().reduce((s, x) => s + x.item.lines.filter((l) => l.flavor === f).reduce((a, l) => a + l.count, 0), 0);
    const inHand = new Set(this.hands.flatMap((h) => h.ravs));
    let started = 0;
    for (const stack of this.slots) for (const b of stack) started += b.ravs.filter((r) => r.flavor === f).length;
    for (const b of [...this.hooked, ...this.carrying, ...this.inFreezer]) if (b) started += b.ravs.filter((r) => r.flavor === f && !inHand.has(r)).length;
    started += [...this.bowl.ravs, ...this.heldRavs, ...this.board.flatMap((bx) => bx.ravs)].filter((r) => r.flavor === f).length;
    return Math.max(0, want - started);
  }

  /** Freezer bookkeeping after physics: close a volley once it's all landed, and call a perfect count. */
  private freezerFeedback(evs: PhysEvent[]) {
    const v = this.volley;
    for (const ev of evs) {
      if (!v) break;
      if (ev.type === 'catch' && ev.into === 'basket' && v.ids.has(ev.id)) v.caught++;
      if (ev.type === 'dead' && v.ids.has(ev.id)) v.dead++;
    }
    // The count first, then the volley, so ALL 6! can say it nailed the count too.
    if (evs.some((e) => e.type === 'catch' && e.into === 'basket')) {
      for (const b of this.hands) {
        const f = b.flavor;
        if (!f || f === 'mixed') continue;
        const need = this.freezerNeed(f);
        const key = `${f}:${need}`;
        if (need > 0 && b.ravs.length === need && !this.nailed.has(key)) {
          this.nailed.add(key);
          this.events.push({ type: 'nailed', flavor: f, count: need });
        }
      }
    }
    if (v && v.caught + v.dead >= v.ids.size && this.time - v.lastAt > FREEZER.volleyGap) {
      if (v.ids.size >= FREEZER.volleyMin) this.events.push({ type: 'volley', count: v.ids.size, caught: v.caught });
      this.volley = null;
    }
  }

  /** Put the baskets in your hands back at their side-view spots (after switching freezer views). */
  relayFreezerBaskets() {
    const g = this.freezerGeo;
    if (!g) return;
    const xs = FREEZER.homeX[this.hands.length - 1] ?? [0];
    this.hands.forEach((b, i) => {
      b.x = b.px = b.tx = xs[i] ?? 0;
      b.y = b.py = b.ty = g.homeY;
      b.held = false;
      b.ravs.forEach((r, j) => {
        r.lx = ((j % 4) - 1.5) * 0.42;
        r.ly = 0.1 + Math.floor(j / 4) * 0.2;
        r.lvx = r.lvy = 0;
      });
    });
    this.world.ravs = this.world.ravs.filter((r) => r.state !== 'air');
  }

  /**
   * Take one rav out of a bag (respecting how fast you can grab), counted toward the current volley.
   * The view decides how it flies: the side view arcs it, the top-down view flings it at your face.
   */
  takeFromBag(i: number) {
    const flavor = SHIFT_FLAVORS[i];
    if (!flavor || this.scene !== 'freezer' || this.phase !== 'playing') return null;
    if (this.time < (this.bagReadyAt[i] ?? 0)) return null;
    this.bagReadyAt[i] = this.time + FREEZER.cooldown;
    const r = newRav(flavor);
    // Quick taps make one volley.
    if (!this.volley || this.time - this.volley.lastAt > FREEZER.volleyGap) this.volley = { ids: new Set(), caught: 0, dead: 0, lastAt: this.time };
    this.volley.ids.add(r.id);
    this.volley.lastAt = this.time;
    return r;
  }

  tapBag(i: number) {
    const g = this.freezerGeo;
    if (!g || this.leaving !== null) return false;
    const r = this.takeFromBag(i);
    if (!r) return false;
    const flavor = r.flavor;
    r.x = (g.bagX[i] ?? 0) + rand(-0.15, 0.15);
    r.y = g.bagY + 0.8;
    r.vx = (0 - r.x) * FREEZER.hopToCenter + rand(-FREEZER.hopVx, FREEZER.hopVx);
    r.vy = rand(FREEZER.hopVy[0] ?? 13.5, FREEZER.hopVy[1] ?? 15.5);
    // One stage: they arc up over the fryers, as high as the timers.
    if (this.stage) r.vy = Math.sqrt(2 * 22 * Math.max(1, (g.topY - g.bagY) * STAGE.hopTo)) * rand(0.96, 1.02);
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
    this.world.catchGrace = 0;
    this.volley = null;
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
      // It glides in from the fryer side (right) to its spot over the bowl.
      b.x = b.px = g.rightX + b.w;
      b.tx = g.homeX;
      b.y = b.py = b.ty = g.homeY;
      // One stage: it comes over from wherever you let go of it.
      const from = this.stage ? this.shownPos?.(b) : null;
      if (from) {
        b.x = b.px = from.x;
        b.y = b.py = from.y;
      }
      this.arriving = b;
      b.vx = b.vy = b.ax = 0;
      b.held = false;
      b.tilt = 0;
      if (!from) b.ravs.forEach((r, i) => {
        r.state = 'in';
        r.lx = ((i % 4) - 1.5) * 0.42;
        r.ly = 0.1 + Math.floor(i / 4) * 0.2;
        r.lvx = r.lvy = 0;
      });
      this.ensureBoxFor(b.flavor);
    }
    const bowl = this.bowl;
    bowl.held = false;
    this.bowlHome = false;
    this.bowlTilt = 0;
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
    // The boxes sit on the table under the fryers (the DOM row), not in the pass's physics.
    this.world.containers = [...this.hands, this.bowl];
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
    if (!match) return;
    // A box you prepped but didn't Sharpie is the one it goes in: the right size if there is one.
    // (Unlabeled, so it misses the label point, but the paper and the sauce count.)
    const spare = this.board.filter((bx) => bx.mode === 'ready' && bx.prepped && (bx.itemId === null || !this.itemFor(bx)));
    const prepped = spare.find((bx) => bx.size === boxSizeFor(match.item)) ?? spare[0];
    if (prepped) {
      prepped.itemId = match.item.id;
      prepped.labeled = false;
      return;
    }
    if (this.board.filter((bx) => bx.mode !== 'serving').length >= PLATE.tableMax) return;
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

  /** Is there a rav in the bowl close enough to this point to pick up? */
  pickable(x: number, y: number) {
    const c = this.bowl;
    return c.ravs.some((r) => Math.hypot(c.x + r.lx * 0.7 - x, c.y + r.ly - y) < PLATE.pickRadius);
  }

  /** Pick up one rav with your fingers (or tongs) from the bowl, a box, or the basket in hand. */
  pickRav(x: number, y: number): Rav | null {
    if (this.scene !== 'pass' || this.phase !== 'playing') return null;
    let best: { r: Rav; c: Container } | null = null;
    let bestD = PLATE.pickRadius;
    // Only out of the bowl: a basket you pour, a box you set up close.
    for (const c of [this.bowl]) {
      for (const r of c.ravs) {
        // Where the view draws it: settled toward the middle of the round bowl.
        const lx = r.lx * 0.7;
        const d = Math.hypot(c.x + lx - x, c.y + r.ly - 0.06 + Math.abs(lx) * 0.25 - y);
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

  /** Let go of the bowl: it goes back to its spot on the rack. (It pours while you hold it over a box.) */
  releaseBowl() {
    const bowl = this.bowl;
    bowl.held = false;
    const g = this.passGeo;
    if (g) {
      bowl.tx = g.bowlX;
      bowl.ty = g.bowlY;
      bowl.held = true; // spring home
      this.bowlHome = true;
    }
  }

  private bowlHome = false;
  /** On its way back to its spot (you can catch it again). */
  get bowlReturning() {
    return this.bowlHome;
  }
  /** The bowl tips toward a box you bring it to (0..1), on that side (-1 left, 1 right). */
  bowlTilt = 0;
  bowlDir = -1;
  /** The basket gliding in from the fryer when you arrive at the pass. */
  private arriving: Basket | null = null;

  /**
   * Pouring into a box on the table: hold the bowl (or a basket) over a box and pull down to tip it.
   * Ravs come out one at a time, faster the further it's tipped, so you can stop on the count.
   */
  pourBox: Box | null = null;
  /** How far you've tipped it, 0..1 (set by the view from your finger). */
  pourTilt = 0;
  private pourAcc = 0;
  /** Where the ravs come from: the bowl, or a basket in your hand. */
  pourFrom: 'bowl' | Basket | null = null;
  /** Ravs that went in during this pour (to judge the count when you stop). */
  private poured = 0;

  /** Start (or keep) tipping into a box. */
  tipInto(box: Box | null, from: 'bowl' | Basket, tilt: number) {
    if (this.scene !== 'pass' || (box && box.mode !== 'ready')) box = null;
    if (box !== this.pourBox) {
      this.endPour();
      this.pourBox = box;
      this.pourAcc = 0;
      this.poured = 0;
    }
    this.pourFrom = box ? from : null;
    this.pourTilt = box ? clamp(tilt, 0, 1) : 0;
  }

  /** Stop pouring: judge the count. A box that has what its ticket asks for comes up close. */
  endPour() {
    const box = this.pourBox;
    const n = this.poured;
    this.pourBox = null;
    this.pourFrom = null;
    this.pourTilt = 0;
    this.poured = 0;
    if (!box || !n) return;
    const ref = this.itemFor(box);
    if (ref) {
      const lines = ref.item.lines;
      const exact = lines.every((l) => box.ravs.filter((r) => r.flavor === l.flavor).length === l.count) && box.ravs.length === ref.item.size;
      if (exact) this.events.push({ type: 'onCount', count: box.ravs.length });
      else if (box.ravs.length > ref.item.size) this.events.push({ type: 'overCount', over: box.ravs.length - ref.item.size });
    }
    this.boxProgress(box);
  }

  /** One frame of pouring. */
  private stepPour(dt: number) {
    const box = this.pourBox;
    if (!box) return;
    const from = this.pourFrom === 'bowl' ? this.bowl : this.pourFrom;
    if (!from || !from.ravs.length) return;
    const start = PLATE.boxPourStart;
    if (this.pourTilt <= start) {
      this.pourAcc = Math.min(this.pourAcc, 0.6);
      return;
    }
    this.pourAcc += dt * PLATE.boxPourRate * ((this.pourTilt - start) / (1 - start));
    while (this.pourAcc >= 1 && from.ravs.length) {
      this.pourAcc -= 1;
      // Whatever's nearest the lip goes first: in a mixed bowl, you get what you get.
      const r = from.ravs.reduce((p, c) => (c.lx < p.lx ? c : p));
      from.ravs.splice(from.ravs.indexOf(r), 1);
      if (from === this.bowl) this.saltCheck(r);
      r.state = 'in';
      box.ravs.push(r);
      this.poured++;
      this.events.push({ type: 'pourIn', boxId: box.id, flavor: r.flavor, from: from === this.bowl ? 'bowl' : 'basket' });
    }
  }

  /** Tongs: take one rav out of the bowl or a box on the table. */
  tongsTake(from: Box | Basket | 'bowl'): Rav | null {
    const c = from === 'bowl' ? this.bowl : from;
    if (!c.ravs.length) return null;
    // Tongs are for the one that doesn't belong: the odd flavor out goes first.
    const counts = new Map<FlavorId, number>();
    for (const x of c.ravs) counts.set(x.flavor, (counts.get(x.flavor) ?? 0) + 1);
    const rare = [...counts.entries()].sort((a, b) => a[1] - b[1])[0]?.[0];
    const i = counts.size > 1 ? c.ravs.map((x) => x.flavor).lastIndexOf(rare as FlavorId) : c.ravs.length - 1;
    const r = c.ravs.splice(i, 1)[0] ?? null;
    if (!r) return null;
    if (from === 'bowl') this.saltCheck(r);
    else if (from instanceof Basket) {
      // The last one out of a basket on its hook: it's an empty basket on the bar again.
      const slot = this.hooked.indexOf(from);
      if (!from.ravs.length && slot >= 0) {
        this.hooked[slot] = null;
        this.hookedAt.delete(from);
        this.hang(from);
      }
    } else if (from.plate) delete from.plate.cells[r.id];
    return r;
  }

  /** The basket hanging at this slot that tongs could reach into (or set one down in). */
  tongsBasket(slot: number, forPut: boolean): Basket | null {
    return this.hooked[slot] ?? (forPut ? (this.hung[slot]?.at(-1) ?? null) : null);
  }

  /** Tongs: set that rav down in the bowl or in a box. */
  tongsPut(r: Rav, to: Box | Basket | 'bowl') {
    r.state = 'in';
    if (to instanceof Basket) {
      r.lx = (Math.random() - 0.5) * to.w * 0.4;
      r.ly = 0.3;
      to.ravs.push(r);
      // Into an empty basket on the bar: now it's a basket of ravs on its hook.
      this.barCatches();
    } else if (to === 'bowl') {
      r.lx = (Math.random() - 0.5) * this.bowl.w * 0.4;
      r.ly = 0.3;
      this.bowl.ravs.push(r);
    } else to.ravs.push(r);
    this.events.push({ type: 'placed', x: 0, y: 0 });
  }

  /** Set one rav you're holding into a box on the table (tongs for gooey, or topping up a count). */
  ravInto(r: Rav, box: Box) {
    const i = this.heldRavs.indexOf(r);
    if (i < 0 || box.mode !== 'ready') return false;
    this.heldRavs.splice(i, 1);
    r.state = 'in';
    box.ravs.push(r);
    this.events.push({ type: 'placed', x: r.x, y: r.y });
    this.boxProgress(box);
    return true;
  }

  /**
   * A box that has its count comes up close. One that's still short (the other half of a split is
   * still in the fryer) waits on the table; with nothing left to plate, you're back to the fryers.
   */
  private boxProgress(box: Box) {
    const ref = this.itemFor(box);
    const full = ref ? box.ravs.length >= ref.item.size : true;
    if (full) this.events.push({ type: 'boxFilled', boxId: box.id });
    else if (this.passDone()) this.events.push({ type: 'passEmpty' });
  }

  /** Nothing left to plate at the pass: the bowl, your fingers and the basket are all empty. */
  passDone() {
    return !this.bowl.ravs.length && !this.heldRavs.length && !this.hands.some((h) => h.ravs.length) && !this.world.ravs.some((r) => r.state === 'air');
  }

  boxAt(x: number, y: number): Box | null {
    if (this.scene !== 'pass') return null;
    return this.board.find((b) => b.mode === 'ready' && Math.abs(x - b.x) < b.w / 2 + 0.2 && y > b.y - 0.6 && y < b.top + 0.9) ?? null;
  }

  // ---------- Expo ----------

  /** The box table: prep and plating are one place now (the steel table by the fryer). */
  openExpo() {
    this.openPass();
  }

  closeExpo() {
    if (this.scene === 'expo') this.setScene('station');
  }

  /** The box the cup being filled right now is for. */
  fillBox: Box | null = null;

  /** The next box on the table that's missing a sauce its order wants, and which one. */
  /**
   * Take a cup back out of a box: into another box (if it has room and doesn't already have that
   * sauce), back into its pan (nothing wasted), or, let go anywhere else, back where it was.
   */
  moveCup(from: Box, sauce: Sauce, to: Box | 'pan' | null) {
    const i = from.sauces.indexOf(sauce);
    if (i < 0 || to === null || to === from) return false;
    if (to !== 'pan' && (to.mode !== 'ready' || to.sauces.length >= 2 || to.sauces.includes(sauce))) return false;
    from.sauces.splice(i, 1);
    if (to !== 'pan') to.sauces.push(sauce);
    this.events.push({ type: 'expo', what: 'sauce' });
    return true;
  }

  /** The sauces some box on the table is still waiting for. */
  saucesWanted(): Sauce[] {
    const out = new Set<Sauce>();
    for (const box of this.board) {
      if (box.mode !== 'ready' || !box.prepped) continue;
      const ref = this.itemFor(box);
      if (ref) for (const s of saucesFor(ref.item)) if (!box.sauces.includes(s)) out.add(s);
    }
    return [...out];
  }

  /** The box the next cup goes into: the first one on the table still short a cup. (Which sauce is up to you.) */
  cupBox(sauce?: Sauce): Box | null {
    const short: Box[] = [];
    for (const box of this.board) {
      if (box.mode !== 'ready' || !box.prepped) continue;
      const ref = this.itemFor(box);
      if (!ref || box.sauces.length >= saucesFor(ref.item).length) continue;
      // A box that's waiting on exactly this sauce gets it, wherever it is in the row.
      if (sauce && saucesFor(ref.item).includes(sauce) && !box.sauces.includes(sauce)) return box;
      short.push(box);
    }
    // Nobody ordered it: it goes in the first box short a cup (and that's a wrong sauce).
    return short[0] ?? null;
  }

  sauceNeed(): { box: Box; sauce: Sauce } | null {
    for (const box of this.board) {
      if (box.mode !== 'ready' || !box.prepped) continue;
      const ref = this.itemFor(box);
      const sauce = ref ? saucesFor(ref.item).find((s) => !box.sauces.includes(s)) : undefined;
      if (sauce) return { box, sauce };
    }
    return null;
  }

  /**
   * Grab a box off the stack for the order that's waiting longest without one: the right size,
   * already lined. It still needs the name on it and its sauce.
   */
  takeBoxFor() {
    const taken = new Set(this.board.map((b) => b.itemId));
    const next = this.openItems().find((x) => !taken.has(x.item.id));
    if (!next) {
      this.hint('Every order has its box');
      return null;
    }
    const b = this.takeBox(boxSizeFor(next.item));
    if (!b) return null;
    b.itemId = next.item.id;
    b.wax = b.size === 'S' ? 'small' : 'big';
    return b;
  }

  /** Say something on the hint line. */
  say(text: string) {
    this.hint(text);
  }

  /** Pull a box off a stack onto the cutting board. */
  takeBox(size: BoxSize) {
    if (this.scene !== 'expo' && this.scene !== 'pass' && this.scene !== 'station') return null;
    const live = this.board.filter((bx) => bx.mode !== 'serving');
    if (live.length >= (this.scene === 'pass' ? PLATE.tableMax : EXPO.boardMax)) {
      this.hint('The table is full');
      return null;
    }
    const b = new Box(size);
    this.board.push(b);
    if (this.scene === 'pass') {
      this.layoutTable();
      this.rewire();
    }
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
    if ((this.cupStock[sauce] ?? 0) <= 0) {
      this.hint(`Out of ${sauce} cups: tap the pan to ladle more`);
      this.events.push({ type: 'outOfSauce', sauce });
      return false;
    }
    this.cupStock[sauce]--;
    if (sauce === 'marinara') {
      // Hot sauce: the oldest cup goes in; if it's sat too long it's cold.
      const made = this.hotCups.shift() ?? this.time;
      if (this.time - made > SAUCE.hotSeconds) {
        box.coldSauce = true;
        this.hint('That marinara went cold');
      }
    }
    box.sauces.push(sauce);
    this.events.push({ type: 'expo', what: 'sauce' });
    return true;
  }

  /** Marinara cups on the table that have gone cold. */
  coldCups() {
    return this.hotCups.filter((t) => this.time - t > SAUCE.hotSeconds).length;
  }

  /** A cup off the ladle: lidded and onto the table. Fill 0..1+ (the line is SAUCE.line). */
  ladledCup(sauce: Sauce, fill: number) {
    const perfect = fill >= SAUCE.perfect[0] && fill <= SAUCE.perfect[1];
    if (fill < SAUCE.okMin) return false;
    // Filled for a box: it goes straight in. (Otherwise it's a spare on the table.)
    const box = this.fillBox;
    this.fillBox = null;
    if (box && box.mode === 'ready' && this.board.includes(box) && !box.sauces.includes(sauce) && box.sauces.length < 2) {
      box.sauces.push(sauce);
      this.events.push({ type: 'expo', what: 'sauce' });
    } else {
      this.cupStock[sauce] = (this.cupStock[sauce] ?? 0) + 1;
      if (sauce === 'marinara') this.hotCups.push(this.time);
    }
    this.events.push({ type: 'sauced', sauce, fill, perfect, spare: !box });
    return true;
  }

  /** Sauce on the table instead of in a cup. */
  spillSauce(sauce: Sauce, cents: number) {
    this.wasteCents(cents, 0);
    // Drips come a cent at a time: say so once, not on every one.
    if (this.time - this.spillSaidAt > 2) {
      this.spillSaidAt = this.time;
      this.events.push({ type: 'spill', sauce });
    }
  }
  private spillSaidAt = -9;

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
    this.waste(box.ravs);
    if (this.scene === 'pass') {
      this.layoutTable();
      this.rewire();
    }
  }

  /** Items still waiting for a box: open and not already labeled on the board (or at the pass). */
  unboxedItems() {
    const taken = new Set(this.board.filter((b) => b.labeled).map((b) => b.itemId));
    return this.openItems().filter((x) => !taken.has(x.item.id));
  }

  /** Presentation points for a box going out with this item: size, wax paper, label, sauce, salt (0 to 5). */
  presentation(box: Box, item: OrderItem) {
    const need = saucesFor(item);
    const saucesOk = need.every((s) => box.sauces.includes(s)) && box.sauces.every((s) => need.includes(s)) && !box.coldSauce;
    const savory = box.ravs.filter((r) => r.flavor !== 'gooey');
    const salty = box.ravs.some((r) => r.flavor === 'gooey' && r.salted);
    const saltOk = savory.every((r) => r.salted) && !salty;
    const points =
      Number(box.size === boxSizeFor(item)) +
      Number(!!box.wax) +
      Number(box.labeled && box.itemId === item.id) +
      Number(saucesOk) +
      Number(saltOk) +
      Number(box.arranged >= 0.99) +
      Number(box.garnish >= 0.8) +
      Number(box.houseStyle);
    const missingSauce = !need.every((s) => box.sauces.includes(s));
    return { points, missingSauce, salty, coldSauce: box.coldSauce };
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
    if (this.phase !== 'playing' || !this.hands.includes(b) || this.leaving !== null) return null;
    this.glide.delete(b);
    this.returning.delete(b);
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
    this.endPour();
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
    // Strays are ravs of a flavor that isn't on the ticket. One too many of the right flavor is generosity.
    let strays = 0;
    for (const [f, n] of have) if (!need.has(f)) strays += n;
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
      this.events.push({ type: 'rejected', reason, missing: Math.max(0, missing), name: order.name ?? '' });
      const why = { cold: 'Still cold in the middle', burnt: 'Burnt', burst: 'Burst open in the oil', short: `Short ${Math.max(0, missing)}`, wrongorder: 'Not what they ordered' }[reason];
      this.log.push({ name: order.name ?? '', what: itemLabel(item), cents: 0, result: 'sent back', issues: [why] });
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
    // Over the count of an ordered flavor: the first one or so is a little something extra for the guest
    // (still Matt's rav, but it tips and reads well); past that it's just food out the door.
    const extras = givenAway.filter((r) => need.has(r.flavor));
    const generous = extras.slice(0, PRESENTATION.generousMax);
    givenAway.splice(0, givenAway.length, ...givenAway.filter((r) => !generous.includes(r)));
    const extra = extras.length - generous.length;
    const style = this.presentation(box, item);
    // The name on the lid is for whoever hands it out. With other tickets up, a box with no name
    // (or one nobody can read) goes to the wrong person.
    const named = box.labeled && box.itemId === item.id && box.labelQuality !== 'scrawl';
    const others = this.tickets.filter((o) => o !== order);
    // No readable name with other tickets up: it looks sloppy to whoever gets it, and now and then it
    // goes home with the wrong guest, and theirs has to be made again, first.
    const unnamed = !named && others.length > 0;
    const lost = unnamed && Math.random() < PRESENTATION.wrongGuestChance;
    if (unnamed) this.repChange(PRESENTATION.sillyRep);
    if (lost) {
      this.repChange(PRESENTATION.noNameRep);
      this.events.push({ type: 'noName', name: order.name ?? '', other: others[0]?.name ?? '' });
      const again: OrderItem = { id: this.nextId++, size: item.size, lines: item.lines.map((l) => ({ ...l })), done: false, sub: item.sub };
      this.pile.unshift({ id: this.nextId++, name: order.name, items: [again], bornAt: this.time, life: SHIFT_TICKETS.remakeLife, remake: true });
    } else if (unnamed) this.events.push({ type: 'silly', name: order.name ?? '' });
    if (named) order.named = (order.named ?? 0) + 1;
    if (box.crossedOut) order.crossed = (order.crossed ?? 0) + 1;
    if (style.missingSauce) this.repChange(PRESENTATION.missingSauce);
    if (style.salty) this.repChange(PRESENTATION.saltyDessert);
    if (style.points) this.repChange(PRESENTATION.repPerPoint * style.points);
    order.style = (order.style ?? 0) + style.points;
    // A remake is on the house.
    const price = order.remake ? 0 : this.itemPrice(item);
    this.score += price;
    this.waste(givenAway);
    if (generous.length) {
      this.score -= generous.reduce((s, r) => s + RAV_PRICE[r.flavor], 0);
      this.repChange(PRESENTATION.generousRep * generous.length);
      order.generous = (order.generous ?? 0) + generous.length;
    }
    if (strays) this.repChange(REPUTATION.stray * strays);
    if (sloppy) this.repChange(REPUTATION.sloppy);

    const orderDone = order.items.every((it) => it.done);
    let tip = 0;
    if (orderDone) {
      // The whole ticket went out: tip on the ticket total, faster and cleaner tips more.
      const waited = (this.time - order.bornAt) / order.life;
      const total = order.remake ? 0 : order.items.reduce((s, it) => s + this.itemPrice(it), 0);
      const clean = order.items.every((it) => it.done) && perfect;
      this.combo = clean ? this.combo + 1 : 0;
      this.bestCombo = Math.max(this.bestCombo, this.combo);
      const styleRate = (PRESENTATION.tipPerPoint * (order.style ?? 0)) / order.items.length + PRESENTATION.generousTip * Math.min(1, order.generous ?? 0);
      // A ticket of several boxes, every one with its name: the guest can hand them out.
      const allNamed = order.items.length > 1 && (order.named ?? 0) >= order.items.length ? PRESENTATION.allNamedTip : 0;
      const rate =
        (TIPS.base + TIPS.speed * Math.max(0, 1 - waited) + Math.min(TIPS.comboMax, TIPS.perCombo * this.combo) + styleRate + allNamed + (order.crossed ? PRESENTATION.crossedOutTip : 0)) *
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
    // The arcade score: every rav that went out right, the box's presentation, and the ticket.
    const mult = this.multiplier;
    const waitedFrac = (this.time - order.bornAt) / order.life;
    const base =
      qualities.reduce((n, q) => n + (q === 'perfect' ? POINTS.perfectRav : POINTS.okRav), 0) +
      style.points * POINTS.style +
      (orderDone ? Math.round(POINTS.ticket * (1 + Math.max(0, 1 - waitedFrac * 2))) : 0);
    const pts = order.remake ? 0 : Math.round((base * mult) / 10) * 10;
    this.points += pts;
    this.served++;
    // A ticket out perfect and fast might get posted.
    if (orderDone && perfect && !lost && waitedFrac < 0.5 && !this.prep && !this.viral && this.time >= this.viralNext && Math.random() < VIRAL.chance) {
      this.viralUntil = this.time + VIRAL.seconds;
      this.nextTicketAt = Math.min(this.nextTicketAt, this.time + 1.5);
      this.events.push({ type: 'viral', on: true });
    }
    // For the record: everything about this box a guest could complain about.
    const issues: string[] = [];
    const wants = saucesFor(item);
    if (strays) issues.push(`${strays} of the wrong flavor in the box`);
    if (extra > 0) issues.push(`${extra} too many`);
    if (qualities.some((q) => q !== 'perfect')) issues.push('Not all cooked just right');
    if (sloppy) issues.push('Greasy or unevenly cooked (drain it, shake it)');
    if (style.missingSauce) issues.push(`No ${wants.filter((x) => !box.sauces.includes(x)).join(' or ')}`);
    if (box.sauces.some((x) => !wants.includes(x))) issues.push(`Wrong sauce: ${box.sauces.filter((x) => !wants.includes(x)).join(', ')}`);
    if (style.coldSauce) issues.push('Cold marinara');
    if (style.salty) issues.push('Salt on the dessert');
    if (box.ravs.some((r) => r.flavor !== 'gooey' && !r.salted)) issues.push('Not salted');
    if (box.arranged < 0.99) issues.push('Not set neatly in the box');
    if (box.garnish < 0.8) issues.push('Not dressed (parm, parsley or sugar)');
    if (unnamed) issues.push(lost ? 'No readable name: it went home with the wrong guest' : 'No readable name on the lid');
    if (box.crossedOut) issues.push('Name crossed out and rewritten');
    if (orderDone && (this.time - order.bornAt) / order.life > 0.7) issues.push('They waited a long time');
    this.log.push({ name: order.name ?? '', what: itemLabel(item) + (order.remake ? ' (remake)' : ''), cents: price + tip, result: 'served', issues });
    this.events.push({ type: 'served', pts, mult, quality: perfect ? 'perfect' : 'ok', points: price, tip, combo: this.combo, extra, strays, uneven: sloppy, orderDone, style: style.points, missingSauce: style.missingSauce, wantedSauce: saucesFor(item).filter((x) => !box.sauces.includes(x))[0] ?? null, wrongSauce: box.sauces.some((x) => !saucesFor(item).includes(x)), salty: style.salty, coldSauce: style.coldSauce, generous: generous.length, name: order.name ?? '', bigTip: !lost && orderDone && perfect && (this.time - order.bornAt) / order.life < 0.5 });
  }

  // ---------- Frame ----------

  update(dt: number) {
    if (this.phase !== 'playing') return;
    this.time += dt;
    // Shut, the freezer pulls back down to temperature.
    if (this.scene !== 'freezer' || this.leaving !== null) this.freezerTemp = Math.max(FREEZER.tempCold, this.freezerTemp - FREEZER.tempShutRate * dt);

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
      const landed: Basket[] = [];
      for (const b of this.hands) {
        const to = this.glide.get(b);
        if (to) {
          // Gliding between its bar and the freezer: a smooth carry, nothing sloshes out.
          const k = damp(FREEZER.glideRate, dt);
          this.world.moveContainer(b, b.x + (to.x - b.x) * k, b.y + (to.y - b.y) * k, dt);
          b.ax = 0;
          b.tx = b.x;
          b.ty = b.y;
          if (Math.hypot(to.x - b.x, to.y - b.y) < 0.06 && this.leaving === null) {
            if (this.returning.has(b)) landed.push(b);
            else this.glide.delete(b);
          }
          continue;
        }
        const k = b.held ? damp(BASKET.follow, dt) : 0;
        this.world.moveContainer(b, b.x + (b.tx - b.x) * k, b.y + (b.ty - b.y) * k, dt);
      }
      for (const b of landed) this.landOnBar(b);
      if (this.stage && this.scene === 'freezer') {
        // Baskets left on their bars catch what flies into them.
        this.barCatches();
        this.world.containers = this.catchers();
      }
      if (this.scene === 'freezer' && this.leaving === null) {
        // Left open, the freezer complains: a light beep, then it starts costing you.
        this.freezerTemp = Math.min(FREEZER.tempMax, this.freezerTemp + FREEZER.tempOpenRate * dt);
        if (this.freezerTemp >= FREEZER.tempBeep && this.time >= this.freezerBeepAt) {
          this.freezerBeepAt = this.time + FREEZER.beepEvery;
          this.events.push({ type: 'freezerBeep' });
        }
        if (this.freezerTemp >= FREEZER.tempDanger && this.time >= this.freezerWarmAt) {
          this.freezerWarmAt = this.time + FREEZER.warmEvery;
          this.repChange(FREEZER.warmRep);
          this.hint('Shut the freezer! It’s warming up');
        }
      }
      if (this.leaving !== null && this.scene === 'freezer') {
        this.leaving -= dt;
        // The lid's down, but the baskets wait for anything still in the air (not forever).
        const flying = this.stage && this.leaving > -FREEZER.lastCatch && this.world.ravs.some((r) => r.state === 'air');
        if (this.leaving <= 0 && !flying) {
          this.leaving = null;
          this.glide.clear();
          this.closeFreezer();
        }
      }
      if (this.scene === 'pass') this.stepPlating(dt);
      this.world.step(dt);
      if (this.scene === 'freezer') this.freezerFeedback(this.world.events);
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

    // Marinara that sat out too long goes in the trash.
    while (this.hotCups.length && this.time - (this.hotCups[0] ?? 0) > SAUCE.tossAfter) {
      this.hotCups.shift();
      this.cupStock.marinara = Math.max(0, this.cupStock.marinara - 1);
      this.wasteCents(SAUCE.cupCents, 0);
      this.events.push({ type: 'hint', text: 'Cold marinara: tossed' });
    }
    this.updateTickets();
    this.useSpares();
    if (this.viralUntil && this.time >= this.viralUntil) {
      // It blows over. The place is just busier now.
      this.viralUntil = 0;
      this.viralNext = this.time + VIRAL.cooldown;
      this.heat++;
      this.events.push({ type: 'viral', on: false });
    }
    if (!this.prep && this.rep <= REPUTATION.fireAt) {
      this.fired = true;
      this.gameOver();
    }
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

    // The basket gliding in.
    const a = this.arriving;
    if (a && (a.held || !this.hands.includes(a))) this.arriving = null;
    else if (a) {
      const ka = damp(PLATE.arriveRate, dt);
      this.world.moveContainer(a, a.x + (a.tx - a.x) * ka, a.y + (a.ty - a.y) * ka, dt);
      a.ax = 0; // a smooth glide: nothing sloshes out
      if (Math.hypot(a.x - a.tx, a.y - a.ty) < 0.01) this.arriving = null;
    }

    this.stepPour(dt);
    this.bowlTilt += ((this.pourFrom === 'bowl' ? this.pourTilt : 0) - this.bowlTilt) * damp(PLATE.tiltRate, dt);
    if (this.pourFrom === 'bowl') this.bowlDir = -1;

    // A box on the table for whatever you're plating.
    const flavors = new Set<FlavorId>([...bowl.ravs, ...this.heldRavs, ...this.hands.flatMap((h) => h.ravs)].map((r) => r.flavor));
    for (const f of flavors) this.ensureBoxFor(f);

    // Bring the basket over the bowl and it tips on its own: the near corner becomes a spout.
    // Pull it away (or leave it parked there) and it does what you'd expect.
    for (const b of this.hands) {
      if (this.pourFrom === b) {
        b.tilt += (Math.min(PLATE.pourStart - 0.05, this.pourTilt) - b.tilt) * damp(PLATE.tiltRate, dt);
        continue;
      }
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
    const item: OrderItem = { id: this.nextId++, size, lines, done: false };
    const sub = lines.length === 1 ? SUB_FOR[flavor] : null;
    const subChance = easy ? 0 : Math.min(T.subChanceMax, T.subChanceStart + T.subRampPerMinute * minutes);
    if (sub && Math.random() < subChance) item.sub = sub;
    return item;
  }

  /** Hang piled tickets as the rail opens up, oldest first. Patience starts when a ticket is hung. */
  private hangFromPile() {
    const T = SHIFT_TICKETS;
    while (this.pile.length && this.tickets.length < T.railMax) {
      const next = this.pile.shift()!;
      next.bornAt = this.time;
      this.tickets.push(next);
      this.events.push({ type: 'ticketArrived', ticket: next });
    }
  }

  private updateTickets() {
    const T = SHIFT_TICKETS;
    for (const t of [...this.tickets]) {
      if (!this.prep && this.time - t.bornAt >= t.life) {
        this.tickets.splice(this.tickets.indexOf(t), 1);
        for (const bx of this.board) if (t.items.some((it) => it.id === bx.itemId)) bx.itemId = null;
        this.events.push({ type: 'ticketExpired', ticket: t });
        this.log.push({ name: t.name ?? '', what: t.items.filter((it) => !it.done).map((it) => itemLabel(it)).join(', '), cents: 0, result: 'walked out', issues: ['Waited too long and left'] });
        this.repChange(REPUTATION.expired);
      }
    }
    // The rail holds what fits; the rest wait face-down in a pile at its left end.
    const most = this.prep ? T.prepRail : T.railMax + T.pileMax;
    if (this.time >= this.nextTicketAt && this.tickets.length + this.pile.length < most) {
      // Prep holds the ramp at the start of a shift; a real shift gets busier by the minute.
      // Every time the place has gone viral, it's that much busier for good.
      const minutes = this.prep ? 0.5 : this.time / 60 + this.heat * VIRAL.heatMinutes;
      const easy = this.ticketsPrinted < T.warmupTickets;
      this.ticketsPrinted++;
      const items = [this.newItem(minutes, easy)];
      let extra = easy ? 0 : Math.min(T.extraItemChanceMax, T.extraItemChanceStart + T.extraItemRampPerMinute * minutes);
      while (items.length < T.maxItems && Math.random() < extra) {
        items.push(this.newItem(minutes));
        extra *= T.extraItemFalloff;
      }
      const life = Math.max(T.lifeMin, T.lifeStart - T.lifeDropPerMinute * minutes) + T.lifePerItem * (items.length - 1);
      this.pile.push({ id: this.nextId++, name: pick(NAMES), items, bornAt: this.time, life });
      this.nextTicketAt =
        this.time + Math.max(T.intervalMin, T.intervalStart - T.intervalDropPerMinute * minutes) * (0.7 + 0.3 * items.length) * (this.viral ? VIRAL.rush : 1);
    }
    this.hangFromPile();
  }

  /**
   * How far along each open item is. Ravs are interchangeable within a flavor, so each item takes the
   * furthest-along ones left, oldest ticket first. A box labeled for an item counts only for that item.
   */
  itemStages(): Map<number, Stage> {
    const pool = new Map<FlavorId, Stage[]>();
    const add = (r: Rav, st: Stage) => {
      const list = pool.get(r.flavor) ?? [];
      list.push(st);
      pool.set(r.flavor, list);
    };
    const done = (r: Rav) => r.cooked > 0 && this.qualityOf(r) !== 'cold';
    for (const stack of this.slots) for (const b of stack) for (const r of b.ravs) add(r, done(r) ? 3 : 2);
    for (const b of [...this.hooked, ...this.carrying, ...this.hands, ...this.hung.flat()]) if (b) for (const r of b.ravs) add(r, done(r) ? 3 : 1);
    for (const r of [...this.bowl.ravs, ...this.heldRavs]) add(r, r.salted ? 4 : 3);
    const boxedFor = new Map<number, Rav[]>();
    for (const bx of this.board) {
      if (bx.mode === 'serving') continue;
      if (bx.itemId !== null) boxedFor.set(bx.itemId, [...(boxedFor.get(bx.itemId) ?? []), ...bx.ravs]);
      else for (const r of bx.ravs) add(r, 5);
    }
    for (const list of pool.values()) list.sort((a, b) => b - a);
    const out = new Map<number, Stage>();
    for (const { item } of this.openItems()) {
      let stage: Stage = 5;
      for (const l of item.lines) {
        const inBox = (boxedFor.get(item.id) ?? []).filter((r) => r.flavor === l.flavor).length;
        if (inBox >= l.count) continue;
        const list = pool.get(l.flavor) ?? [];
        const need = l.count - inBox;
        const taken = list.splice(0, need);
        const s: Stage = taken.length < need ? 0 : (Math.min(...taken) as Stage);
        stage = Math.min(stage, s) as Stage;
      }
      out.set(item.id, stage);
    }
    return out;
  }

  /** The most useful thing to do from the fryer screen right now, in the order the line does it. */
  nextJob(): NextJob {
    const short = (f: FlavorId | 'mixed' | null) => (f && f !== 'mixed' ? FLAVORS[f].short : 'that');
    // 1. Something in the oil is done: get it out.
    for (const stack of this.slots) {
      for (const b of stack) {
        if (!b.ravs.length || !b.ravs.every((r) => ['perfect', 'ok'].includes(this.qualityOf(r)) && r.cooked >= landmarks(r.flavor, r.fryer).windowOpen)) continue;
        const weighted = stack.at(-1) !== b && !stack.at(-1)?.ravs.length;
        return { text: weighted ? `${short(b.flavor)} is done: lift the weight off, then pull it` : `${short(b.flavor)} is done: pull it and hang it to drain`, target: 'oil', key: 'pull' };
      }
    }
    // 2. Drained and waiting: to the salt bowl.
    for (const b of this.hooked) {
      if (b?.ravs.length && b.ravs.some((r) => r.cooked > 0) && this.drainedFor(b) >= STATION.drainSeconds) {
        return { text: `${short(b.flavor)} is drained: drag it to the salt bowl`, target: 'bowl', key: 'toBowl' };
      }
    }
    // 3. Something waiting to be plated.
    if (this.bowl.ravs.length || this.board.some((bx) => bx.mode === 'ready' && bx.ravs.length)) {
      return { text: 'Tap the salt bowl to plate', target: 'bowl', key: 'plate' };
    }
    // 4. A raw basket hanging and a slot free: drop it.
    const freeSlot = this.slots.some((s) => !s.length);
    for (const b of this.hooked) {
      if (b?.ravs.length && b.ravs.every((r) => r.cooked === 0) && freeSlot) {
        return { text: `Drop the ${short(b.flavor)} basket in the oil, then hit its timer`, target: 'oil', key: 'drop' };
      }
    }
    // 5. An order nobody has started: ravs from the freezer.
    const stages = this.itemStages();
    const want = this.openItems().find((x) => stages.get(x.item.id) === 0);
    if (want) {
      const f = want.item.lines.find((l) => l.count)?.flavor ?? null;
      const ready = this.selected.length || this.carrying.length;
      return {
        text: `${short(f)}: open the FREEZER, grab a basket, catch`,
        target: ready ? 'freezer' : 'bar',
        key: 'freezer',
      };
    }
    // 6. Things are frying or draining: use the time.
    const busy = this.slots.some((s) => s.length) || this.hooked.some((b) => b?.ravs.length);
    if (busy) {
      if (this.unboxedItems().length && this.board.length < EXPO.boardMax) return { text: 'Cooking. Set out their boxes: tap a box stack', target: 'expo', key: 'box' };
      return { text: 'Cooking. Watch your timers', target: null, key: 'cook' };
    }
    return { text: this.tickets.length ? 'Look at the tickets' : 'Waiting on tickets', target: null };
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
    if (this.prep && delta < 0) delta = 0; // prep: practice, no patience lost
    // Matt loses patience faster than he finds it again.
    delta *= delta < 0 ? PATIENCE.drain : PATIENCE.regain;
    // He won't fire a new hire in their first minute, or anyone while the place is viral.
    const safe = this.time < PATIENCE.grace || this.viral;
    this.rep = clamp(this.rep + delta, safe ? REPUTATION.fireAt + PATIENCE.floor : 0, REPUTATION.max);
    this.events.push({ type: 'rep', delta, stars: this.rep });
  }

  /** What an item costs the customer, in cents. */
  itemPrice(item: OrderItem) {
    const gooey = item.lines.every((l) => l.flavor === 'gooey');
    const table = gooey ? MENU.gooey : MENU.savory;
    return table[item.size] ?? item.lines.reduce((s, l) => s + RAV_PRICE[l.flavor] * l.count, 0);
  }

  /** Can another spare cup of this be made ahead? Only the cold sauces keep. */
  canSpare(sauce: Sauce) {
    return sauce !== 'marinara' && (this.cupStock[sauce] ?? 0) < SAUCE.spareMax;
  }

  /** A box that wants a cold sauce you've already cupped gets one out of the cold table, by itself. */
  private useSpares() {
    for (const box of this.board) {
      if (box.mode !== 'ready' || !box.prepped) continue;
      const ref = this.itemFor(box);
      if (!ref) continue;
      for (const s of saucesFor(ref.item)) {
        if (s === 'marinara' || box.sauces.includes(s) || box.sauces.length >= 2 || (this.cupStock[s] ?? 0) <= 0) continue;
        this.cupStock[s]--;
        box.sauces.push(s);
        this.events.push({ type: 'expo', what: 'sauce' });
        this.events.push({ type: 'spareUsed', sauce: s });
      }
    }
  }

  /** The place has gone viral: it's a frenzy, everything scores more, and Matt can't fire you. */
  get viral() {
    return this.viralUntil > 0;
  }

  /** Matt's patience, 0 (you're fired) to 1. */
  get patience() {
    return clamp((this.rep - REPUTATION.fireAt) / (REPUTATION.max - REPUTATION.fireAt), 0, 1);
  }

  /** What a clean streak is worth right now. */
  get multiplier() {
    return Math.min(POINTS.multMax, 1 + this.combo + this.groove) * (this.viral ? VIRAL.points : 1);
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
    this.events.push({ type: 'gameOver', score: this.score, best: this.best, wasted: this.wasted, stars: this.rep, points: this.points, fired: this.fired, bestCombo: this.bestCombo, served: this.served, prep: this.prep });
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
