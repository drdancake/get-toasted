import { FLAVORS, type FlavorId } from '../config/flavors';
import { BEST_SCORE_KEY, PATIENCE, SCORING, TICKETS } from '../config/game';
import { BASKET, BOX, LAUNCH, RAV, SLOT_HEAT, TOSS_SCORING, WORLD } from '../config/toss';
import { isFailure, qualityAt } from '../game/doneness';
import type { Quality, Ticket } from '../game/types';

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
const damp = (k: number, dt: number) => 1 - Math.exp(-k * dt);

/** World-space landmarks, measured by the view from the screen layout. */
export interface Geometry {
  leftX: number;
  rightX: number;
  topY: number;
  hangY: number;
  oilY: number;
  vatLeft: number;
  vatRight: number;
  counterY: number;
  slotX: number[];
  bagX: number;
  boxX: number;
}

export type RavState = 'air' | 'in' | 'dead';

export interface Rav {
  id: number;
  flavor: FlavorId;
  state: RavState;
  /** World position and velocity (valid while in the air or dead). */
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Spin (z) and tumble (x), radians. Visual only. */
  a: number;
  va: number;
  tumble: number;
  vt: number;
  /** Position inside the container, relative to its bottom center. */
  lx: number;
  ly: number;
  lvx: number;
  lvy: number;
  /** Heat-scaled seconds in the oil. */
  cooked: number;
  /** 0..1 squash on impact, decays. Visual only. */
  squash: number;
  diedAt: number;
  deathKind: 'counter' | 'oil' | null;
  /** Container this rav just left, which can't re-catch it for a moment. */
  ignore: Container | null;
  ignoreUntil: number;
}

export class Container {
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  ax = 0;
  px = 0;
  py = 0;
  ravs: Rav[] = [];
  constructor(
    public kind: 'basket' | 'box',
    public w: number,
    public wall: number,
  ) {}
  get top() {
    return this.y + this.wall;
  }
}

export type BasketMode = 'hang' | 'fry' | 'held' | 'free';

export class Basket extends Container {
  mode: BasketMode = 'hang';
  /** Finger target while held, already offset by where you grabbed it. */
  tx = 0;
  ty = 0;
  constructor(
    public id: number,
    public home: number,
  ) {
    super('basket', BASKET.width, BASKET.wall);
  }
}

export class Box extends Container {
  mode: 'ready' | 'serving' | 'arriving' = 'ready';
  constructor() {
    super('box', BOX.width, BOX.wall);
  }
}

export type TossEvent =
  | { type: 'launch'; x: number; y: number }
  | { type: 'catch'; x: number; y: number; into: 'basket' | 'box'; count: number }
  | { type: 'rim'; x: number; y: number }
  | { type: 'spill'; x: number; y: number }
  | { type: 'dead'; x: number; y: number; kind: 'counter' | 'oil' }
  | { type: 'drop'; x: number; y: number; slot: number }
  | { type: 'pull'; x: number; y: number }
  | { type: 'toss'; x: number; y: number; count: number }
  | { type: 'ticketArrived'; ticket: Ticket }
  | { type: 'ticketExpired'; ticket: Ticket }
  | { type: 'served'; quality: 'perfect' | 'ok'; points: number; tip: number; combo: number; extra: number }
  | { type: 'rejected'; reason: 'cold' | 'burnt' | 'short'; missing: number }
  | { type: 'bigCombo'; combo: number }
  | { type: 'hint'; text: string }
  | { type: 'gameOver'; score: number; best: number };

/** The whole toss station as plain state. No rendering, no DOM. */
export class TossSim {
  phase: 'title' | 'playing' | 'paused' | 'over' = 'title';
  time = 0;
  score = 0;
  best = 0;
  combo = 0;
  patience = PATIENCE.max;
  tickets: Ticket[] = [];
  ravs: Rav[] = [];
  baskets: Basket[] = [];
  box = new Box();
  events: TossEvent[] = [];
  geo: Geometry | null = null;

  private nextId = 1;
  private nextTicketAt = 0;
  private lastLaunch = -1;

  constructor() {
    this.best = loadBest();
    this.baskets = SLOT_HEAT.map((_, i) => new Basket(i + 1, i));
  }

  setGeometry(g: Geometry) {
    const first = !this.geo;
    this.geo = g;
    if (first) this.placeAtHome();
  }

  start() {
    this.time = 0;
    this.score = 0;
    this.combo = 0;
    this.patience = PATIENCE.max;
    this.tickets = [];
    this.ravs = [];
    this.events = [];
    for (const b of this.baskets) {
      b.ravs = [];
      b.mode = 'hang';
    }
    this.box.ravs = [];
    this.box.mode = 'ready';
    this.placeAtHome();
    this.nextTicketAt = TICKETS.firstArrival;
    this.lastLaunch = -1;
    this.phase = 'playing';
  }

  pause() {
    if (this.phase === 'playing') this.phase = 'paused';
  }

  resume() {
    if (this.phase === 'paused') this.phase = 'playing';
  }

  private placeAtHome() {
    const g = this.geo;
    if (!g) return;
    for (const b of this.baskets) {
      b.x = b.px = g.slotX[b.home] ?? 0;
      b.y = b.py = g.hangY;
    }
    this.box.x = this.box.px = g.boxX;
    this.box.y = this.box.py = g.counterY;
  }

  // ---------- Input ----------

  /** The basket under a world point, if you can grab it. */
  basketAt(x: number, y: number): Basket | null {
    let best: Basket | null = null;
    let bestD = Infinity;
    for (const b of this.baskets) {
      if (b.mode === 'held') continue;
      const dx = Math.abs(x - b.x);
      const dy = y - b.y;
      if (dx < b.w / 2 + 0.45 && dy > -0.7 && dy < b.wall + 1.1) {
        const d = dx + Math.abs(dy - b.wall / 2);
        if (d < bestD) [best, bestD] = [b, d];
      }
    }
    return best;
  }

  boxAt(x: number, y: number) {
    const b = this.box;
    return b.mode === 'ready' && Math.abs(x - b.x) < b.w / 2 + 0.3 && y > b.y - 0.6 && y < b.top + 0.9;
  }

  bagAt(x: number, y: number) {
    const g = this.geo;
    return !!g && Math.abs(x - g.bagX) < 1.0 && y > g.counterY - 0.8 && y < g.counterY + 1.6;
  }

  grab(b: Basket, x: number, y: number) {
    if (this.phase !== 'playing') return { dx: 0, dy: 0 };
    if (b.mode === 'fry') this.events.push({ type: 'pull', x: b.x, y: b.y });
    b.mode = 'held';
    b.tx = b.x;
    b.ty = b.y;
    return { dx: b.x - x, dy: b.y - y };
  }

  moveHeld(b: Basket, x: number, y: number) {
    const g = this.geo;
    if (!g || b.mode !== 'held') return;
    b.tx = clamp(x, g.leftX + b.w / 2, g.rightX - b.w / 2);
    b.ty = clamp(y, g.counterY, g.hangY + 0.4);
  }

  release(b: Basket, vx: number, vy: number) {
    const g = this.geo;
    if (!g || b.mode !== 'held') return;
    const speed = Math.hypot(vx, vy);
    if (b.ravs.length && speed > BASKET.tossSpeed && vy > -BASKET.tossSpeed) {
      const s = Math.min(1, BASKET.tossMax / speed);
      const fx = vx * s * BASKET.tossCarry;
      const fy = vy * s * BASKET.tossCarry;
      for (const r of b.ravs) {
        r.state = 'air';
        r.x = b.x + r.lx;
        r.y = b.y + r.ly;
        r.vx = fx + rand(-1, 1) * BASKET.tossSpread;
        r.vy = fy + rand(-0.5, 1) * BASKET.tossSpread;
        r.va = rand(-LAUNCH.spin, LAUNCH.spin);
        r.vt = rand(-6, 6);
        r.ignore = b;
        r.ignoreUntil = this.time + 0.3;
        this.ravs.push(r);
      }
      this.events.push({ type: 'toss', x: b.x, y: b.y, count: b.ravs.length });
      b.ravs = [];
      b.mode = 'hang';
      return;
    }
    if (!b.ravs.length) b.mode = 'hang';
    else if (b.y > g.oilY - BASKET.dropZone) {
      b.mode = 'fry';
      this.events.push({ type: 'drop', x: g.slotX[b.home] ?? b.x, y: g.oilY, slot: b.home });
    } else {
      b.mode = 'free';
      b.vx = 0;
    }
  }

  tapBag() {
    const g = this.geo;
    if (!g || this.phase !== 'playing') return false;
    if (this.time - this.lastLaunch < LAUNCH.cooldown) return false;
    if (this.ravs.filter((r) => r.state === 'air').length >= LAUNCH.maxAirborne) return false;
    this.lastLaunch = this.time;
    const r = this.newRav('beef');
    r.x = g.bagX + 0.25;
    r.y = g.counterY + 0.9;
    r.vx = rand(LAUNCH.vx[0] ?? 1.5, LAUNCH.vx[1] ?? 3.4) * (g.bagX < 0 ? 1 : -1);
    r.vy = rand(LAUNCH.vy[0] ?? 10.5, LAUNCH.vy[1] ?? 12.5);
    r.va = rand(-LAUNCH.spin, LAUNCH.spin);
    r.vt = rand(-5, 5);
    this.ravs.push(r);
    this.events.push({ type: 'launch', x: r.x, y: r.y });
    return true;
  }

  /** Swipe the box up: send it to the oldest ticket. */
  serve() {
    const box = this.box;
    if (this.phase !== 'playing' || box.mode !== 'ready') return;
    if (!box.ravs.length) {
      this.hint('Box is empty');
      return;
    }
    const ticket = this.tickets[0];
    if (!ticket) {
      this.hint('No tickets yet');
      return;
    }
    const qualities = box.ravs.map((r) => qualityAt(r.cooked, r.flavor, 0));
    const missing = ticket.count - box.ravs.length;
    box.mode = 'serving';
    box.vy = 0;

    const fail = qualities.find(isFailure);
    if (fail || missing > 0) {
      const reason = fail === 'cold' ? 'cold' : fail ? 'burnt' : 'short';
      this.combo = 0;
      this.losePatience(PATIENCE.rejectedBasket);
      this.events.push({ type: 'rejected', reason, missing: Math.max(0, missing) });
      return; // the ticket stays on the rail: fire it again
    }

    this.tickets.shift();
    const perfect = qualities.slice(0, ticket.count).every((q) => q === 'perfect');
    const points = qualities
      .slice(0, ticket.count)
      .reduce((s, q) => s + (q === 'perfect' ? SCORING.perfectPerRav : SCORING.okPerRav), 0);
    const extra = Math.max(0, -missing);
    if (perfect) this.combo += 1;
    else this.combo = 0;
    const multiplier = clamp(this.combo, 1, SCORING.comboCap);
    const remaining = Math.max(0, ticket.life - (this.time - ticket.bornAt));
    const tip = Math.round(remaining * SCORING.tipPerSecond * multiplier);
    this.score = Math.max(0, this.score + points + tip - extra * TOSS_SCORING.extraRav);
    this.events.push({ type: 'served', quality: perfect ? 'perfect' : 'ok', points, tip, combo: this.combo, extra });
    if (perfect) {
      if (this.combo >= PATIENCE.healAtCombo) this.patience = clamp(this.patience + PATIENCE.healAmount, 0, PATIENCE.max);
      const past = this.combo - SCORING.bigComboAt;
      if (past >= 0 && past % SCORING.bigComboEvery === 0) this.events.push({ type: 'bigCombo', combo: this.combo });
    }
  }

  // ---------- Simulation ----------

  update(dt: number) {
    const g = this.geo;
    if (!g || this.phase !== 'playing') return;
    this.time += dt;

    this.moveBaskets(dt, g);
    this.moveBox(dt, g);

    const h = dt / WORLD.substeps;
    for (let s = 0; s < WORLD.substeps; s++) {
      for (const r of this.ravs) if (r.state === 'air') this.stepAir(r, h, g, s === 0 ? dt : 0);
      for (const c of [...this.baskets, this.box]) this.stepContained(c, h);
    }

    for (const b of this.baskets) {
      if (b.mode !== 'fry' || b.y > g.oilY) continue;
      const heat = SLOT_HEAT[b.home] ?? 1;
      for (const r of b.ravs) r.cooked += dt * heat;
    }

    for (const r of this.ravs) r.squash = Math.max(0, r.squash - dt * 4);
    for (const c of [...this.baskets, this.box]) for (const r of c.ravs) r.squash = Math.max(0, r.squash - dt * 4);
    this.ravs = this.ravs.filter((r) => r.state === 'air' || (r.state === 'dead' && this.time - r.diedAt < RAV.deadLinger));

    this.updateTickets();
    if (this.patience <= 0) this.gameOver();
  }

  private moveBaskets(dt: number, g: Geometry) {
    for (const b of this.baskets) {
      const pvx = b.vx;
      b.px = b.x;
      b.py = b.y;
      const homeX = g.slotX[b.home] ?? 0;
      if (b.mode === 'held') {
        const k = damp(BASKET.follow, dt);
        b.x += (b.tx - b.x) * k;
        b.y += (b.ty - b.y) * k;
      } else if (b.mode === 'hang') {
        const k = damp(10, dt);
        b.x += (homeX - b.x) * k;
        b.y += (g.hangY - b.y) * k;
      } else if (b.mode === 'fry') {
        const k = damp(9, dt);
        b.x += (homeX - b.x) * k;
        b.y += (g.oilY - BASKET.sink - b.y) * k;
      } else {
        b.vy += WORLD.gravity * dt;
        b.y += b.vy * dt;
        if (b.y <= g.counterY) {
          b.y = g.counterY;
          b.vy = 0;
        }
      }
      if (b.mode !== 'free') {
        b.vx = (b.x - b.px) / dt;
        b.vy = (b.y - b.py) / dt;
      } else b.vx = 0;
      b.ax = clamp((b.vx - pvx) / dt, -80, 80);
    }
  }

  private moveBox(dt: number, g: Geometry) {
    const box = this.box;
    box.px = box.x;
    box.py = box.y;
    if (box.mode === 'serving') {
      box.vy += 40 * dt;
      box.y += box.vy * dt;
      if (box.y > g.topY + 2) {
        box.ravs = [];
        box.mode = 'arriving';
        box.y = g.counterY;
        box.x = g.rightX + box.w;
      }
    } else if (box.mode === 'arriving') {
      box.x += (g.boxX - box.x) * damp(8, dt);
      if (Math.abs(box.x - g.boxX) < 0.02) {
        box.x = g.boxX;
        box.mode = 'ready';
      }
    }
    box.vx = (box.x - box.px) / dt;
    box.vy = box.mode === 'serving' ? box.vy : (box.y - box.py) / dt;
    box.ax = 0;
  }

  private stepAir(r: Rav, h: number, g: Geometry, frameDt: number) {
    const px = r.x;
    const py = r.y;
    r.vy += WORLD.gravity * h;
    r.x += r.vx * h;
    r.y += r.vy * h;
    if (frameDt) {
      r.a += r.va * frameDt;
      r.tumble += r.vt * frameDt;
    }

    // Screen edges are walls.
    if (r.x < g.leftX + RAV.hx) {
      r.x = g.leftX + RAV.hx;
      r.vx = Math.abs(r.vx) * 0.5;
    } else if (r.x > g.rightX - RAV.hx) {
      r.x = g.rightX - RAV.hx;
      r.vx = -Math.abs(r.vx) * 0.5;
    }

    for (const c of [...this.baskets, this.box]) {
      if (r.ignore === c && this.time < r.ignoreUntil) continue;
      if (c instanceof Box && c.mode !== 'ready') continue;
      const prevTop = c.py + c.wall;
      const relPrev = py - prevTop;
      const relNow = r.y - c.top;
      const dx = r.x - c.x;
      const inner = c.w / 2 - RAV.hx * 0.6;
      const outer = c.w / 2 + RAV.hx;
      if (relPrev >= 0 && relNow < 0 && r.vy - c.vy < 0) {
        if (Math.abs(dx) <= inner) {
          this.catchInto(r, c);
          return;
        }
        if (Math.abs(dx) <= outer) {
          r.y = c.top + 0.01;
          r.vy = Math.abs(r.vy - c.vy) * RAV.rimBounce + Math.max(0, c.vy);
          r.vx += Math.sign(dx || 1) * RAV.rimKick;
          r.va *= -1;
          this.events.push({ type: 'rim', x: r.x, y: r.y });
          continue;
        }
      }
      // Side walls from outside.
      const pdx = px - c.px;
      if (r.y < c.top && r.y > c.y - RAV.hy && Math.abs(pdx) >= outer && Math.abs(dx) < outer) {
        r.x = c.x + Math.sign(pdx) * outer;
        r.vx = Math.sign(pdx) * Math.abs(r.vx) * 0.4 + c.vx;
      }
    }

    // Into the oil, not in a basket.
    if (r.x > g.vatLeft && r.x < g.vatRight && py >= g.oilY && r.y < g.oilY) {
      this.kill(r, 'oil', g.oilY);
      return;
    }
    if (r.y < g.counterY + RAV.hy) this.kill(r, 'counter', g.counterY + RAV.hy * 0.4);
  }

  private catchInto(r: Rav, c: Container) {
    r.state = 'in';
    r.lx = r.x - c.x;
    r.ly = Math.max(RAV.hy, r.y - c.y);
    r.lvx = (r.vx - c.vx) * 0.3;
    r.lvy = (r.vy - c.vy) * 0.3;
    r.squash = 1;
    c.ravs.push(r);
    this.ravs.splice(this.ravs.indexOf(r), 1);
    this.events.push({ type: 'catch', x: r.x, y: c.top, into: c.kind, count: c.ravs.length });
  }

  private kill(r: Rav, kind: 'counter' | 'oil', y: number) {
    r.state = 'dead';
    r.deathKind = kind;
    r.diedAt = this.time;
    r.y = y;
    r.vx = r.vy = 0;
    r.squash = 1;
    this.score = Math.max(0, this.score - TOSS_SCORING.deadRav);
    this.events.push({ type: 'dead', x: r.x, y, kind });
  }

  /** Ravs inside a basket or box: settle, stack, slosh, spill. Local frame, origin at the floor center. */
  private stepContained(c: Container, h: number) {
    if (!c.ravs.length) return;
    const half = c.w / 2 - RAV.hx;
    const settle = damp(10, h);
    for (const r of c.ravs) {
      r.lvx -= c.ax * h * BASKET.slosh;
      r.lvy += WORLD.gravity * h;
      r.lx += r.lvx * h;
      r.ly += r.lvy * h;
      if (r.ly < RAV.hy) {
        r.ly = RAV.hy;
        r.lvy = r.lvy < -2 ? -r.lvy * 0.2 : 0;
        r.lvx *= 1 - damp(8, h);
      }
      if (Math.abs(r.lx) > half && r.ly < c.wall + RAV.hy) {
        r.lx = Math.sign(r.lx) * half;
        r.lvx = -r.lvx * 0.3;
      }
      r.a += (0 - wrapAngle(r.a)) * settle;
      r.tumble += (0 - wrapAngle(r.tumble)) * settle;
    }
    // Stack: pillow-shaped boxes push apart along the shallower axis.
    for (let it = 0; it < 2; it++) {
      for (let i = 0; i < c.ravs.length; i++) {
        for (let j = i + 1; j < c.ravs.length; j++) {
          const a = c.ravs[i];
          const b = c.ravs[j];
          if (!a || !b) continue;
          const dx = b.lx - a.lx;
          const dy = b.ly - a.ly;
          const ox = RAV.hx * 2 - Math.abs(dx);
          const oy = RAV.hy * 2 - Math.abs(dy);
          if (ox <= 0 || oy <= 0) continue;
          if (oy < ox) {
            const [lo, hi] = dy >= 0 ? [a, b] : [b, a];
            hi.ly += oy * (lo.ly <= RAV.hy + 0.001 ? 1 : 0.5);
            lo.ly -= lo.ly <= RAV.hy + 0.001 ? 0 : oy * 0.5;
            if (hi.lvy < lo.lvy) hi.lvy = lo.lvy;
            // A pillow resting off-center on another slides off it, so piles spread to the walls.
            hi.lvx = hi.lvx * 0.9 + (Math.sign(hi.lx - lo.lx) || (Math.random() < 0.5 ? -1 : 1)) * 0.3;
          } else {
            const s = Math.sign(dx || (Math.random() - 0.5)) * ox * 0.5;
            a.lx -= s;
            b.lx += s;
          }
        }
      }
    }
    // Overfilled: the top of the pile slides out over the rim.
    for (const r of [...c.ravs]) {
      if (r.ly > c.wall + RAV.hy * 0.5 && Math.abs(r.lx) > half * 0.85) {
        c.ravs.splice(c.ravs.indexOf(r), 1);
        r.state = 'air';
        r.x = c.x + r.lx;
        r.y = c.y + r.ly;
        r.vx = c.vx + Math.sign(r.lx) * 1.6;
        r.vy = Math.max(0, c.vy) + 1;
        r.va = rand(-6, 6);
        r.ignore = c;
        r.ignoreUntil = this.time + 0.4;
        this.ravs.push(r);
        this.events.push({ type: 'spill', x: r.x, y: r.y });
      }
    }
  }

  // ---------- Tickets ----------

  private updateTickets() {
    for (const t of [...this.tickets]) {
      if (this.time - t.bornAt >= t.life) {
        this.tickets.splice(this.tickets.indexOf(t), 1);
        this.events.push({ type: 'ticketExpired', ticket: t });
        this.losePatience(PATIENCE.expiredTicket);
      }
    }
    if (this.time >= this.nextTicketAt && this.tickets.length < TICKETS.railMax) {
      const minutes = this.time / 60;
      const flavor: FlavorId = 'beef';
      const sizes = FLAVORS[flavor].sizes;
      const bigChance = Math.min(TICKETS.bigOrderChanceMax, TICKETS.bigOrderChanceStart + TICKETS.bigOrderRampPerMinute * minutes);
      const count = (Math.random() < bigChance ? sizes[sizes.length - 1] : sizes[0]) ?? 6;
      const life = Math.max(TICKETS.lifeMin, TICKETS.lifeStart - TICKETS.lifeDropPerMinute * minutes);
      const ticket: Ticket = { id: this.nextId++, flavor, count, bornAt: this.time, life };
      this.tickets.push(ticket);
      this.events.push({ type: 'ticketArrived', ticket });
      this.nextTicketAt =
        this.time + Math.max(TICKETS.intervalMin, TICKETS.intervalStart - TICKETS.intervalDropPerMinute * minutes);
    }
  }

  private newRav(flavor: FlavorId): Rav {
    return {
      id: this.nextId++,
      flavor,
      state: 'air',
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      a: 0,
      va: 0,
      tumble: 0,
      vt: 0,
      lx: 0,
      ly: 0,
      lvx: 0,
      lvy: 0,
      cooked: 0,
      squash: 0,
      diedAt: 0,
      deathKind: null,
      ignore: null,
      ignoreUntil: 0,
    };
  }

  /** Quality of a rav if it were judged now. */
  qualityOf(r: Rav): Quality {
    return qualityAt(r.cooked, r.flavor, 0);
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

function wrapAngle(a: number) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

function loadBest(): number {
  try {
    return Number(localStorage.getItem(`${BEST_SCORE_KEY}.toss`) ?? 0) || 0;
  } catch {
    return 0;
  }
}

function saveBest(n: number) {
  try {
    localStorage.setItem(`${BEST_SCORE_KEY}.toss`, String(n));
  } catch {
    /* no storage: the run still counts */
  }
}
