import { FLAVORS, SHIFT_FLAVORS, type FlavorId } from '../config/flavors';
import { BEST_SCORE_KEY, FRYERS, PATIENCE, SCORING, SLOTS_PER_FRYER } from '../config/game';
import { FREEZER, SHIFT_TICKETS, STATION, TIMER_BEEP_EVERY, TIMER_CHANNELS } from '../config/shift';
import { BASKET, BOX, TOSS_SCORING } from '../config/toss';
import { isFailure, landmarks, qualityAt } from '../game/doneness';
import type { Quality, Ticket } from '../game/types';
import { Container, damp, newRav, type PhysEvent, PhysWorld, rand, type Rav } from './physics';

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

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
    const first = this.ravs[0]?.flavor;
    if (!first) return null;
    return this.ravs.every((r) => r.flavor === first) ? first : 'mixed';
  }
}

export class Box extends Container {
  mode: 'ready' | 'serving' | 'arriving' = 'ready';
  ticketId: number | null = null;
  constructor() {
    super('box', BOX.width, BOX.wall);
  }
}

export interface FreezerGeo {
  leftX: number;
  rightX: number;
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

export type KitchenEvent =
  | PhysEvent
  | { type: 'launch'; x: number; y: number; flavor: FlavorId }
  | { type: 'scene'; scene: Scene }
  | { type: 'mixed' }
  | { type: 'drop'; slot: number; nested: boolean; flavor: FlavorId | 'mixed' | null }
  | { type: 'pull'; slot: number }
  | { type: 'restash'; from: number; count: number }
  | { type: 'shake'; slot: number; settle: number }
  | { type: 'timerStart'; channel: number }
  | { type: 'timerStop'; channel: number }
  | { type: 'timerDone'; channel: number }
  | { type: 'timerBeep'; channel: number }
  | { type: 'toss'; count: number }
  | { type: 'ticketArrived'; ticket: Ticket }
  | { type: 'ticketExpired'; ticket: Ticket }
  | { type: 'served'; quality: 'perfect' | 'ok'; points: number; tip: number; combo: number; extra: number; uneven: boolean }
  | { type: 'rejected'; reason: 'cold' | 'burnt' | 'short' | 'mixed'; missing: number }
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

/** Game seconds a channel counts: the flavor's cook time to the middle of its perfect window, in standard oil. */
export function channelSeconds(flavor: FlavorId) {
  const l = landmarks(flavor, 0);
  return l.windowOpen + (l.windowClose - l.windowOpen) * STATION.timerAt;
}

export class Kitchen {
  phase: 'title' | 'playing' | 'paused' | 'over' = 'title';
  scene: Scene = 'station';
  time = 0;
  score = 0;
  best = 0;
  combo = 0;
  patience = PATIENCE.max;
  tickets: Ticket[] = [];
  baskets: Basket[] = [];
  slots: Basket[][] = [];
  /** Empty baskets hooked on each slot's back bar, nested, last one on top. */
  hung: Basket[][] = [];
  staged: Basket[] = [];
  /** The basket in your hand inside the freezer or at the pass. */
  work: Basket | null = null;
  box = new Box();
  world = new PhysWorld();
  freezerGeo: FreezerGeo | null = null;
  passGeo: PassGeo | null = null;
  events: KitchenEvent[] = [];
  timers: TimerChannel[] = TIMER_CHANNELS.map(() => ({ start: null, end: 0, rang: false, lastBeep: 0 }));

  private nextId = 1;
  private nextTicketAt = 0;
  private bagReadyAt: number[] = [];
  private warnedMixed = false;
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
    this.staged = [];
    this.work = null;
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
    this.warnedMixed = false;
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
    if (s === undefined || !this.hung[s]?.length) {
      const order = this.hung
        .map((h, i) => ({ i, n: h.length }))
        .filter((x) => x.n > 0)
        .sort((a, b) => Number(this.isHot(a.i)) - Number(this.isHot(b.i)) || b.n - a.n);
      s = order[0]?.i;
    }
    if (s === undefined) return null;
    const b = this.hung[s]?.pop() ?? null;
    if (b) b.home = s;
    return b;
  }

  /** Hook an empty basket on a bar: its own slot if free, else the stash on the wing fryer, else anywhere with room. */
  private hang(b: Basket, avoid = -1) {
    b.ravs = [];
    b.slot = null;
    const ok = (s: number) => s !== avoid && !this.slots[s]?.length && (this.hung[s]?.length ?? 0) < STATION.hangMax;
    const stash = this.hung.map((_, i) => i).filter((i) => this.isHot(i)).sort((a, c) => (this.hung[a]?.length ?? 0) - (this.hung[c]?.length ?? 0));
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

  /** Take an empty basket to the freezer: the one hung on this slot, or the next one handy. */
  openFreezer(slot?: number) {
    if (this.phase !== 'playing' || this.scene !== 'station') return;
    if (this.staged.length >= STATION.stagedMax) return this.hint('Drop the baskets you have first');
    const b = this.unhook(slot);
    if (!b) return this.hint('No empty baskets on the bars');
    this.enterFreezer(b);
  }

  private enterFreezer(b: Basket) {
    const g = this.freezerGeo;
    if (!g) return;
    b.ravs = [];
    b.settle = 0;
    b.x = b.px = b.tx = g.homeX;
    b.y = b.py = b.ty = g.homeY;
    b.vx = b.vy = b.ax = 0;
    this.work = b;
    this.world.clear();
    this.world.bounds = { leftX: g.leftX, rightX: g.rightX, floorY: g.floorY };
    this.world.containers = [b];
    this.setScene('freezer');
  }

  /** Put a staged basket into a fryer slot, nesting it on top if the slot is taken. */
  dropStaged(b: Basket, slot: number) {
    const stack = this.slots[slot];
    if (!stack || !this.staged.includes(b)) return false;
    if (stack.length >= STATION.stackMax) {
      this.hint('That slot is full');
      return false;
    }
    // Empty baskets hung over this slot move to the stash so this one can go in.
    const hung = this.hung[slot] ?? [];
    if (hung.length) {
      const moving = hung.splice(0, hung.length);
      const failed = moving.filter((h) => !this.hang(h, slot));
      if (failed.length) {
        hung.push(...failed);
        this.hint('No bar to hang the empty basket on');
        return false;
      }
      this.events.push({ type: 'restash', from: slot, count: moving.length });
    }
    this.staged.splice(this.staged.indexOf(b), 1);
    const nested = stack.length > 0;
    for (const under of stack) under.settle = 1; // weighed down, fully submerged
    stack.push(b);
    b.slot = slot;
    b.settle = 0;
    this.events.push({ type: 'drop', slot, nested, flavor: b.flavor });
    return true;
  }

  /** Pull the top basket of a slot and take it to the pass. */
  pull(slot: number) {
    if (this.phase !== 'playing' || this.scene !== 'station') return;
    const stack = this.slots[slot];
    const b = stack?.pop();
    if (!b) return;
    b.slot = null;
    for (const r of b.ravs) if (r.cooked > 0 && b.settle < 1) r.uneven = true;
    this.events.push({ type: 'pull', slot });
    this.enterPass(b);
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
    r.y = g.bagY + 0.5;
    r.vx = rand(-FREEZER.hopVx, FREEZER.hopVx);
    r.vy = rand(FREEZER.hopVy[0] ?? 3.5, FREEZER.hopVy[1] ?? 5.5);
    r.va = rand(-8, 8);
    r.vt = rand(-5, 5);
    this.world.ravs.push(r);
    this.events.push({ type: 'launch', x: r.x, y: r.y, flavor });
    return true;
  }

  /** Stage the basket you're filling and grab a fresh one, staying in the freezer. */
  nextBasket() {
    const b = this.work;
    if (!b || this.scene !== 'freezer') return;
    if (!b.ravs.length) return this.hint('Fill this one first');
    if (this.staged.length + 1 >= STATION.stagedMax) {
      this.stage(b);
      this.leaveFreezer();
      return this.hint('Counter is full');
    }
    const next = this.unhook();
    if (!next) {
      this.stage(b);
      this.leaveFreezer();
      return this.hint('No empty baskets on the bars');
    }
    this.stage(b);
    this.enterFreezer(next);
  }

  /** Close the freezer: a filled basket waits on the counter for a fryer slot. */
  closeFreezer() {
    const b = this.work;
    if (this.scene !== 'freezer') return;
    if (b?.ravs.length) this.stage(b);
    else if (b) this.hang(b);
    this.leaveFreezer();
  }

  private stage(b: Basket) {
    for (const r of b.ravs) r.state = 'in';
    this.staged.push(b);
  }

  private leaveFreezer() {
    this.work = null;
    this.world.clear();
    this.world.containers = [];
    this.setScene('station');
  }

  // ---------- Pass ----------

  private enterPass(b: Basket) {
    const g = this.passGeo;
    if (!g) return;
    b.x = b.px = b.tx = g.homeX;
    b.y = b.py = b.ty = g.homeY;
    b.vx = b.vy = b.ax = 0;
    b.held = false;
    // Lay the ravs flat in the side-view basket.
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
    this.work = b;
    this.passEmptyAt = null;
    this.world.clear();
    this.world.bounds = { leftX: g.leftX, rightX: g.rightX, floorY: g.counterY };
    this.world.containers = [b, box];
    this.setScene('pass');
  }

  /** The box goes to the oldest ticket for this flavor, unless it already has ravs for one. */
  private assignBox(flavor: FlavorId | 'mixed' | null) {
    const box = this.box;
    const current = this.tickets.find((t) => t.id === box.ticketId);
    if (current && box.ravs.length) return;
    const match = (flavor && flavor !== 'mixed' && this.tickets.find((t) => t.flavor === flavor)) || this.tickets[0];
    box.ticketId = match?.id ?? null;
  }

  boxTicket() {
    return this.tickets.find((t) => t.id === this.box.ticketId) ?? null;
  }

  grabWork(x: number, y: number) {
    const b = this.work;
    if (!b || this.phase !== 'playing') return null;
    b.held = true;
    b.tx = b.x;
    b.ty = b.y;
    return { dx: b.x - x, dy: b.y - y };
  }

  moveWork(x: number, y: number) {
    const b = this.work;
    if (!b || !b.held) return;
    const bounds = this.world.bounds;
    const top = this.scene === 'freezer' ? (this.freezerGeo?.bagY ?? 0) - 0.4 : (this.passGeo?.topY ?? 8) - 2;
    b.tx = clamp(x, bounds.leftX + b.w / 2, bounds.rightX - b.w / 2);
    b.ty = clamp(y, bounds.floorY, top);
  }

  releaseWork(vx: number, vy: number) {
    const b = this.work;
    if (!b || !b.held) return;
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
    const b = this.work;
    if (b?.ravs.length) {
      if (this.staged.length < STATION.stagedMax) this.stage(b);
      else {
        this.score = Math.max(0, this.score - b.ravs.length * TOSS_SCORING.deadRav);
        b.ravs = [];
        this.hint('No room on the counter: tossed');
        this.hang(b);
      }
    } else if (b) this.hang(b); // back on the bar
    this.work = null;
    for (const r of this.world.ravs) if (r.state === 'air') this.score = Math.max(0, this.score - TOSS_SCORING.deadRav);
    this.world.clear();
    this.world.containers = [];
    this.setScene('station');
  }

  boxAt(x: number, y: number) {
    const b = this.box;
    return this.scene === 'pass' && b.mode === 'ready' && Math.abs(x - b.x) < b.w / 2 + 0.3 && y > b.y - 0.6 && y < b.top + 0.9;
  }

  workAt(x: number, y: number) {
    const b = this.work;
    if (!b) return false;
    return Math.abs(x - b.x) < b.w / 2 + 0.5 && y > b.y - 0.7 && y < b.top + 1.1;
  }

  serve() {
    const box = this.box;
    if (this.phase !== 'playing' || box.mode !== 'ready') return;
    if (!box.ravs.length) return this.hint('Box is empty');
    const ticket = this.boxTicket() ?? this.tickets[0];
    if (!ticket) return this.hint('No tickets yet');
    box.mode = 'serving';
    box.vy = 0;
    const wrong = box.ravs.some((r) => r.flavor !== ticket.flavor);
    const qualities: Quality[] = box.ravs.map((r) => qualityAt(r.cooked, r.flavor, r.fryer));
    const missing = ticket.count - box.ravs.length;
    const fail = qualities.find(isFailure);
    if (wrong || fail || missing > 0) {
      const reason = wrong ? 'mixed' : fail === 'cold' ? 'cold' : fail ? 'burnt' : 'short';
      this.combo = 0;
      this.losePatience(PATIENCE.rejectedBasket);
      this.events.push({ type: 'rejected', reason, missing: Math.max(0, missing) });
      return;
    }
    this.tickets.splice(this.tickets.indexOf(ticket), 1);
    const served = box.ravs.slice(0, ticket.count);
    const uneven = served.some((r) => r.uneven);
    const each = served.map((r, i) => (qualities[i] === 'perfect' && !r.uneven ? 'perfect' : 'ok'));
    const perfect = each.every((q) => q === 'perfect');
    const points = each.reduce((s, q) => s + (q === 'perfect' ? SCORING.perfectPerRav : SCORING.okPerRav), 0);
    const extra = Math.max(0, -missing);
    this.combo = perfect ? this.combo + 1 : 0;
    const multiplier = clamp(this.combo, 1, SCORING.comboCap);
    const remaining = Math.max(0, ticket.life - (this.time - ticket.bornAt));
    const tip = Math.round(remaining * SCORING.tipPerSecond * multiplier);
    this.score = Math.max(0, this.score + points + tip - extra * TOSS_SCORING.extraRav);
    this.events.push({ type: 'served', quality: perfect ? 'perfect' : 'ok', points, tip, combo: this.combo, extra, uneven });
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
      stack.forEach((b, i) => {
        if (i < stack.length - 1) b.settle = 1;
        for (const r of b.ravs) {
          r.cooked += dt * heat;
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
      const b = this.work;
      if (b) {
        const k = b.held ? damp(BASKET.follow, dt) : 0;
        this.world.moveContainer(b, b.x + (b.tx - b.x) * k, b.y + (b.ty - b.y) * k, dt);
      }
      if (this.scene === 'pass') this.moveBox(dt);
      this.world.step(dt);
      for (const ev of this.world.events) {
        if (ev.type === 'dead') this.score = Math.max(0, this.score - TOSS_SCORING.deadRav);
        if (ev.type === 'catch' && ev.into === 'basket' && this.work?.flavor === 'mixed' && !this.warnedMixed) {
          this.warnedMixed = true;
          this.events.push({ type: 'mixed' });
        }
        this.events.push(ev);
      }
      this.world.events.length = 0;
      if (this.warnedMixed && this.work?.flavor !== 'mixed') this.warnedMixed = false;

      // An empty basket at the pass, with nothing left in the air: back to the fryers.
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
        box.ticketId = null;
        box.y = g.counterY;
        box.x = g.rightX + box.w;
        this.assignBox(this.work?.flavor ?? null);
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

  private updateTickets() {
    const T = SHIFT_TICKETS;
    for (const t of [...this.tickets]) {
      if (this.time - t.bornAt >= t.life) {
        this.tickets.splice(this.tickets.indexOf(t), 1);
        if (this.box.ticketId === t.id) this.box.ticketId = null;
        this.events.push({ type: 'ticketExpired', ticket: t });
        this.losePatience(PATIENCE.expiredTicket);
      }
    }
    if (this.time >= this.nextTicketAt && this.tickets.length < T.railMax) {
      const minutes = this.time / 60;
      const flavor = SHIFT_FLAVORS[Math.floor(Math.random() * SHIFT_FLAVORS.length)] ?? 'beef';
      const sizes = FLAVORS[flavor].sizes;
      const bigChance = Math.min(T.bigOrderChanceMax, T.bigOrderChanceStart + T.bigOrderRampPerMinute * minutes);
      const count = (Math.random() < bigChance ? sizes[sizes.length - 1] : sizes[0]) ?? 6;
      const life = Math.max(T.lifeMin, T.lifeStart - T.lifeDropPerMinute * minutes);
      const ticket: Ticket = { id: this.nextId++, flavor, count, bornAt: this.time, life };
      this.tickets.push(ticket);
      this.events.push({ type: 'ticketArrived', ticket });
      this.nextTicketAt = this.time + Math.max(T.intervalMin, T.intervalStart - T.intervalDropPerMinute * minutes);
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
