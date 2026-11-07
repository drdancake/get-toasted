import { FLAVORS, type FlavorId } from '../config/flavors';
import { BASKET, RAV, WORLD } from '../config/toss';

// Side-view toss physics shared by the freezer and the pass: ravs in the air,
// containers that catch them, a floor that kills them. No rendering.

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
export const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
export const damp = (k: number, dt: number) => 1 - Math.exp(-k * dt);

export interface Rav {
  id: number;
  flavor: FlavorId;
  state: 'air' | 'in' | 'dead' | 'held';
  x: number;
  y: number;
  vx: number;
  vy: number;
  a: number;
  va: number;
  tumble: number;
  vt: number;
  lx: number;
  ly: number;
  lvx: number;
  lvy: number;
  /** Heat-scaled seconds in the oil. */
  cooked: number;
  /** Fryer it last cooked in (window scaling). */
  fryer: number;
  /** Cooked floating, not shaken or weighed down: can't be perfect. */
  uneven: boolean;
  /** Tossed in salt in the silver bowl. */
  salted: boolean;
  /** Went in the bowl straight from the oil, no drain on the bar: can't be perfect. */
  greasy: boolean;
  squash: number;
  diedAt: number;
  ignore: Container | null;
  ignoreUntil: number;
}

let nextRavId = 1;
export function newRav(flavor: FlavorId): Rav {
  return {
    id: nextRavId++,
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
    fryer: 0,
    uneven: false,
    salted: false,
    greasy: false,
    squash: 0,
    diedAt: 0,
    ignore: null,
    ignoreUntil: 0,
  };
}

/** Half extents of a rav, scaled for the bigger gooey butter ones. */
export const halfOf = (r: Rav) => {
  const s = FLAVORS[r.flavor].size;
  return { hx: RAV.hx * s, hy: RAV.hy * Math.sqrt(s) };
};

export class Container {
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  ax = 0;
  px = 0;
  py = 0;
  ravs: Rav[] = [];
  /** Held in a finger, chasing (tx, ty). */
  held = false;
  /** Ravs only spill over the rim when the container moves faster than this (a resting bowl doesn't shed them). */
  spillSpeed = 0;
  tx = 0;
  ty = 0;
  constructor(
    public kind: 'basket' | 'box' | 'bowl',
    public w: number,
    public wall: number,
  ) {}
  get top() {
    return this.y + this.wall;
  }
}

export type PhysEvent =
  | { type: 'catch'; x: number; y: number; into: 'basket' | 'box' | 'bowl'; count: number; flavor: FlavorId; id: number }
  | { type: 'rim'; x: number; y: number }
  | { type: 'spill'; x: number; y: number }
  | { type: 'dead'; x: number; y: number; flavor: FlavorId; id: number };

export interface Bounds {
  leftX: number;
  rightX: number;
  floorY: number;
}

export class PhysWorld {
  ravs: Rav[] = [];
  containers: Container[] = [];
  events: PhysEvent[] = [];
  time = 0;
  bounds: Bounds = { leftX: -3.5, rightX: 3.5, floorY: -6 };
  /** Extra catch width at basket rims (world units): a rav that grazes the rim falls in instead of bouncing off. */
  catchGrace = 0;

  clear() {
    this.ravs = [];
    this.events = [];
  }

  airborne() {
    return this.ravs.filter((r) => r.state === 'air').length;
  }

  /** Throw a container's contents with a flick velocity. */
  toss(c: Container, vx: number, vy: number) {
    const speed = Math.hypot(vx, vy);
    const s = Math.min(1, BASKET.tossMax / Math.max(speed, 1e-6));
    const fx = vx * s * BASKET.tossCarry;
    const fy = vy * s * BASKET.tossCarry;
    for (const r of c.ravs) {
      r.state = 'air';
      r.x = c.x + r.lx;
      r.y = c.y + r.ly;
      r.vx = fx + rand(-1, 1) * BASKET.tossSpread;
      r.vy = fy + rand(-0.5, 1) * BASKET.tossSpread;
      r.va = rand(-9, 9);
      r.vt = rand(-6, 6);
      r.ignore = c;
      r.ignoreUntil = this.time + 0.3;
      this.ravs.push(r);
    }
    const n = c.ravs.length;
    c.ravs = [];
    return n;
  }

  step(dt: number) {
    this.time += dt;
    const h = dt / WORLD.substeps;
    for (let s = 0; s < WORLD.substeps; s++) {
      for (const r of [...this.ravs]) if (r.state === 'air') this.stepAir(r, h, s === 0 ? dt : 0);
      for (const c of this.containers) this.stepContained(c, h);
    }
    for (const r of this.ravs) r.squash = Math.max(0, r.squash - dt * 4);
    for (const c of this.containers) for (const r of c.ravs) r.squash = Math.max(0, r.squash - dt * 4);
    this.ravs = this.ravs.filter((r) => r.state === 'air' || (r.state === 'dead' && this.time - r.diedAt < RAV.deadLinger));
  }

  /** Call before step() each frame with the container's new position. */
  moveContainer(c: Container, x: number, y: number, dt: number) {
    const pvx = c.vx;
    c.px = c.x;
    c.py = c.y;
    c.x = x;
    c.y = y;
    c.vx = (c.x - c.px) / dt;
    c.vy = (c.y - c.py) / dt;
    c.ax = clamp((c.vx - pvx) / dt, -80, 80);
  }

  private stepAir(r: Rav, h: number, frameDt: number) {
    const b = this.bounds;
    const { hx, hy } = halfOf(r);
    const px = r.x;
    const py = r.y;
    r.vy += WORLD.gravity * h;
    r.x += r.vx * h;
    r.y += r.vy * h;
    if (frameDt) {
      r.a += r.va * frameDt;
      r.tumble += r.vt * frameDt;
    }
    if (r.x < b.leftX + hx) {
      r.x = b.leftX + hx;
      r.vx = Math.abs(r.vx) * 0.5;
    } else if (r.x > b.rightX - hx) {
      r.x = b.rightX - hx;
      r.vx = -Math.abs(r.vx) * 0.5;
    }
    for (const c of this.containers) {
      if (r.ignore === c && this.time < r.ignoreUntil) continue;
      const prevTop = c.py + c.wall;
      const dx = r.x - c.x;
      const grace = c.kind === 'basket' ? this.catchGrace : 0;
      const inner = c.w / 2 - hx * 0.6 + grace;
      const outer = c.w / 2 + hx + grace * 0.5;
      if (py - prevTop >= 0 && r.y - c.top < 0 && r.vy - c.vy < 0) {
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
      const pdx = px - c.px;
      if (r.y < c.top && r.y > c.y - hy && Math.abs(pdx) >= outer && Math.abs(dx) < outer) {
        r.x = c.x + Math.sign(pdx) * outer;
        r.vx = Math.sign(pdx) * Math.abs(r.vx) * 0.4 + c.vx;
      }
    }
    if (r.y < b.floorY + hy) {
      r.state = 'dead';
      r.diedAt = this.time;
      r.y = b.floorY + hy * 0.4;
      r.vx = r.vy = 0;
      r.squash = 1;
      this.events.push({ type: 'dead', x: r.x, y: r.y, flavor: r.flavor, id: r.id });
    }
  }

  private catchInto(r: Rav, c: Container) {
    const { hy } = halfOf(r);
    r.state = 'in';
    r.lx = r.x - c.x;
    r.ly = Math.max(hy, r.y - c.y);
    r.lvx = (r.vx - c.vx) * 0.3;
    r.lvy = (r.vy - c.vy) * 0.3;
    r.squash = 1;
    c.ravs.push(r);
    this.ravs.splice(this.ravs.indexOf(r), 1);
    this.events.push({ type: 'catch', x: r.x, y: c.top, into: c.kind, count: c.ravs.length, flavor: r.flavor, id: r.id });
  }

  private stepContained(c: Container, h: number) {
    if (!c.ravs.length) return;
    const settle = damp(10, h);
    for (const r of c.ravs) {
      const { hx, hy } = halfOf(r);
      const half = c.w / 2 - hx;
      r.lvx -= c.ax * h * BASKET.slosh;
      r.lvy += WORLD.gravity * h;
      r.lx += r.lvx * h;
      r.ly += r.lvy * h;
      if (r.ly < hy) {
        r.ly = hy;
        r.lvy = r.lvy < -2 ? -r.lvy * 0.2 : 0;
        r.lvx *= 1 - damp(8, h);
      }
      if (Math.abs(r.lx) > half && r.ly < c.wall + hy) {
        r.lx = Math.sign(r.lx) * Math.max(0, half);
        r.lvx = -r.lvx * 0.3;
      }
      r.a += (0 - wrap(r.a)) * settle;
      r.tumble += (0 - wrap(r.tumble)) * settle;
    }
    for (let it = 0; it < 2; it++) {
      for (let i = 0; i < c.ravs.length; i++) {
        for (let j = i + 1; j < c.ravs.length; j++) {
          const a = c.ravs[i];
          const b = c.ravs[j];
          if (!a || !b) continue;
          const ha = halfOf(a);
          const hb = halfOf(b);
          const dx = b.lx - a.lx;
          const dy = b.ly - a.ly;
          const ox = ha.hx + hb.hx - Math.abs(dx);
          const oy = ha.hy + hb.hy - Math.abs(dy);
          if (ox <= 0 || oy <= 0) continue;
          if (oy < ox) {
            const [lo, hi] = dy >= 0 ? [a, b] : [b, a];
            const loFloor = lo.ly <= halfOf(lo).hy + 0.001;
            hi.ly += oy * (loFloor ? 1 : 0.5);
            if (!loFloor) lo.ly -= oy * 0.5;
            if (hi.lvy < lo.lvy) hi.lvy = lo.lvy;
            hi.lvx = hi.lvx * 0.9 + (Math.sign(hi.lx - lo.lx) || (Math.random() < 0.5 ? -1 : 1)) * 0.3;
          } else {
            const s = Math.sign(dx || Math.random() - 0.5) * ox * 0.5;
            a.lx -= s;
            b.lx += s;
          }
        }
      }
    }
    for (const r of [...c.ravs]) {
      const { hx, hy } = halfOf(r);
      const half = c.w / 2 - hx;
      if (Math.hypot(c.vx, c.vy) < c.spillSpeed) continue;
      if (r.ly > c.wall + hy * 0.5 && Math.abs(r.lx) > half * 0.85) {
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
}

function wrap(a: number) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}
