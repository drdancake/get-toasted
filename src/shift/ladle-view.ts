import { SAUCE } from '../config/shift';
import { SAUCE_COLORS } from '../render/models';
import { haptic, sfx } from '../ui/feel';
import type { Kitchen, Sauce } from './kitchen';

// The ladle microgame. Two thumbs: one works the ladle (dip it in the pan to scoop, tip it out over
// the table to pour; the stream wobbles, and moving the ladle throws it), the other slides the cup
// under the stream. Fill to the line, stop pouring, and the lid snaps on. The fryers keep cooking
// the whole time.

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement) => {
  const e = document.createElement(tag);
  e.className = cls;
  parent?.appendChild(e);
  return e;
};

interface Drop {
  x: number;
  y: number;
  vx: number;
  vy: number;
  v: number;
}

const NAMES: Record<string, string> = { marinara: 'MARINARA', ranch: 'RANCH' };

export class LadleView {
  private root: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private title: HTMLElement;
  private count: HTMLElement;
  private sauce: Sauce = 'marinara';
  private open = false;
  private w = 1;
  private h = 1;
  // The ladle: where your thumb has it, how full it is, how far it's tipped.
  private lx = 0;
  private ly = 0;
  private lvx = 0;
  private load = 0;
  private tilt = 0;
  private ladleId: number | null = null;
  // The cup: slides along the table under your other thumb.
  private cx = 0;
  private cupId: number | null = null;
  private fill = 0;
  private lastHit = 0;
  private sealing = 0;
  private drops: Drop[] = [];
  private spilled = 0;
  /** Cents of spill already charged this visit, and the running tally shown on the table. */
  private charged = 0;
  private tallyCents = 0;
  private tally!: HTMLElement;

  /** The spill tally: every cent on the table, counted where you can see it. */
  private bump(cents: number) {
    this.tallyCents += cents;
    this.tally.textContent = `SPILLED \u2212$${(this.tallyCents / 100).toFixed(2)}`;
    this.tally.classList.add('on');
    this.tally.classList.remove('tick');
    void this.tally.offsetWidth;
    this.tally.classList.add('tick');
  }
  private made = 0;
  private t = 0;
  private last = 0;

  constructor(parent: HTMLElement, private k: Kitchen) {
    this.root = el('div', 'ladle-ui', parent);
    this.root.hidden = true;
    const bar = el('div', 'ladle-top', this.root);
    this.title = el('div', 'ladle-title', bar);
    this.count = el('div', 'ladle-count', bar);
    this.canvas = el('canvas', 'ladle-canvas', this.root);
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d canvas');
    this.ctx = ctx;
    this.tally = el('div', 'ladle-spill', this.root);
    const foot = el('div', 'scene-bar ladle-bar', this.root);
    el('div', 'scene-hint', foot).textContent = 'top thumb: dip, then tip the ladle · bottom thumb: the cup';
    const done = el('button', 'scene-btn primary', foot);
    done.textContent = 'DONE';
    done.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.close();
    });
    this.canvas.addEventListener('pointerdown', (e) => this.down(e));
    this.canvas.addEventListener('pointermove', (e) => this.move(e));
    this.canvas.addEventListener('pointerup', (e) => this.up(e));
    this.canvas.addEventListener('pointercancel', (e) => this.up(e));
    window.addEventListener('resize', () => this.open && this.size());
  }

  /** The pan, the table, the cup's rim: layout in canvas pixels. */
  private get geo() {
    const { w, h } = this;
    return {
      pan: { x: w * 0.08, y: h * 0.06, w: w * 0.84, h: h * 0.24 },
      tableY: h * 0.9,
      cupW: Math.min(w * 0.2, h * 0.11),
      cupH: Math.min(w * 0.17, h * 0.09),
      ladleR: Math.min(w * 0.075, h * 0.042),
    };
  }

  isOpen() {
    return this.open;
  }

  show(sauce: Sauce) {
    this.sauce = sauce;
    this.open = true;
    this.root.hidden = false;
    this.size();
    const g = this.geo;
    this.lx = this.w * 0.5;
    this.ly = g.pan.y + g.pan.h * 0.5;
    this.load = 0;
    this.tilt = 0;
    this.cx = this.w * 0.5;
    this.fill = 0;
    this.sealing = 0;
    this.drops = [];
    this.spilled = 0;
    this.charged = 0;
    this.tallyCents = 0;
    this.tally.classList.remove('on');
    this.made = 0;
    this.last = performance.now();
    this.title.textContent = `${NAMES[sauce] ?? sauce.toUpperCase()} · to the line`;
    requestAnimationFrame((t) => this.frame(t));
  }

  close() {
    this.open = false;
    this.root.hidden = true;
    this.ladleId = this.cupId = null;
  }

  private size() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = r.width;
    this.h = r.height;
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private pt(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  // ---------- Input ----------

  private down(e: PointerEvent) {
    e.preventDefault();
    const p = this.pt(e);
    // The top of the screen is the ladle's; the bottom is the cup's.
    if (p.y < this.h * 0.62 && this.ladleId === null) {
      this.ladleId = e.pointerId;
      this.lx = p.x;
      this.ly = p.y;
    } else if (this.cupId === null) {
      this.cupId = e.pointerId;
      this.cx = p.x;
    }
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* not a live pointer (synthetic): fine */
    }
  }

  private move(e: PointerEvent) {
    const p = this.pt(e);
    if (e.pointerId === this.ladleId) {
      this.lx = Math.max(10, Math.min(this.w - 10, p.x));
      this.ly = Math.max(10, Math.min(this.h * 0.72, p.y));
    } else if (e.pointerId === this.cupId) {
      const half = this.geo.cupW / 2;
      this.cx = Math.max(half, Math.min(this.w - half, p.x));
    }
  }

  private up(e: PointerEvent) {
    if (e.pointerId === this.ladleId) this.ladleId = null;
    if (e.pointerId === this.cupId) this.cupId = null;
  }

  // ---------- Frame ----------

  private frame(now: number) {
    if (!this.open) return;
    const dt = Math.min(1 / 30, (now - this.last) / 1000);
    this.last = now;
    this.step(dt);
    this.draw();
    requestAnimationFrame((t) => this.frame(t));
  }

  /** Advance the ladle game by dt seconds (public so tests can drive it). */
  step(dt: number) {
    const g = this.geo;
    this.t += dt;
    const pan = g.pan;
    const prevX = this.lx;
    // In the pan: scoop. Below the pan: the further down, the more it tips.
    const inPan = this.lx > pan.x && this.lx < pan.x + pan.w && this.ly > pan.y && this.ly < pan.y + pan.h;
    if (inPan) {
      if (this.load < SAUCE.scoop) this.load = Math.min(SAUCE.scoop, this.load + dt * 3);
      this.tilt = 0;
    } else {
      const below = this.ly - (pan.y + pan.h);
      this.tilt = Math.max(0, Math.min(1, below / (this.h * 0.14)));
    }
    this.lvx += ((this.lx - (this._px ?? prevX)) / Math.max(dt, 1e-3) - this.lvx) * 0.3;
    this._px = this.lx;
    // Pour: a wobbly stream from the ladle's lip.
    const flow = (SAUCE.flow[this.sauce] ?? 1.3) * this.tilt;
    if (flow > 0 && this.load > 0) {
      const amt = Math.min(this.load, flow * dt);
      this.load -= amt;
      const lip = this.lx + g.ladleR * 0.9;
      const wob = Math.sin(this.t * 9) * (SAUCE.wobble[this.sauce] ?? 6) * this.tilt + Math.sin(this.t * 23) * 2;
      this.drops.push({ x: lip + wob, y: this.ly + g.ladleR * 0.3, vx: this.lvx * SAUCE.throwK, vy: this.h * 0.9, v: amt });
    }
    // Drops fall; the cup's mouth catches them.
    const rimY = g.tableY - g.cupH;
    const grav = this.h * 2.4;
    const keep: Drop[] = [];
    for (const d of this.drops) {
      const py = d.y;
      d.vy += grav * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      if (py < rimY && d.y >= rimY && Math.abs(d.x - this.cx) < g.cupW * 0.42 && this.sealing === 0) {
        this.fill += d.v;
        this.lastHit = this.t;
        continue;
      }
      if (d.y >= g.tableY) {
        this.spilled += d.v;
        continue;
      }
      keep.push(d);
    }
    this.drops = keep;
    // Sauce on the table adds up: every cup's worth is Matt's money.
    // It's charged as it lands, a cent at a time, and the tally on the table runs up with it.
    const owed = Math.floor(this.spilled * SAUCE.spillCents) - this.charged;
    if (owed > 0) {
      this.charged += owed;
      this.k.spillSauce(this.sauce, owed);
      this.bump(owed);
      if (Math.floor(this.charged / 25) !== Math.floor((this.charged - owed) / 25)) sfx.splat();
    }
    // Overfilled: it runs down the side, and the cup's done for.
    if (this.fill > SAUCE.overflow && this.sealing === 0) {
      this.sealing = -0.6;
      this.k.spillSauce(this.sauce, SAUCE.spillCents);
      this.bump(SAUCE.spillCents);
      haptic(20);
      sfx.reject();
    }
    // Stopped pouring with it filled: the lid snaps on, the cup goes on the table, a fresh one comes in.
    if (this.sealing === 0 && this.fill >= SAUCE.okMin && this.t - this.lastHit > 0.45) {
      this.sealing = 0.45;
      this.k.ladledCup(this.sauce, this.fill);
      this.made++;
      haptic(12);
      sfx.catch(4);
    }
    if (this.sealing > 0) {
      this.sealing = Math.max(0, this.sealing - dt);
      if (this.sealing === 0) this.fill = 0;
    } else if (this.sealing < 0) {
      this.sealing = Math.min(0, this.sealing + dt);
      if (this.sealing === 0) this.fill = 0;
    }
    this.count.textContent = `${this.k.cupStock[this.sauce] ?? 0} ready${this.made ? ` · +${this.made}` : ''}`;
  }

  private _px: number | null = null;

  private draw() {
    const c = this.ctx;
    const g = this.geo;
    const { w, h } = this;
    const sauce = SAUCE_COLORS[this.sauce] ?? '#c8341d';
    c.clearRect(0, 0, w, h);
    // Steel table.
    c.fillStyle = '#b9bfc4';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#a6adb3';
    c.fillRect(0, g.tableY, w, h - g.tableY);
    // The pan, with its sauce and a smear on the rim.
    const p = g.pan;
    rr(c, p.x, p.y, p.w, p.h, 14);
    c.fillStyle = '#d8dde1';
    c.fill();
    c.lineWidth = 6;
    c.strokeStyle = '#8f969c';
    c.stroke();
    rr(c, p.x + 12, p.y + 12, p.w - 24, p.h - 24, 10);
    c.fillStyle = sauce;
    c.fill();
    c.fillStyle = '#ffffff22';
    for (let i = 0; i < 6; i++) c.fillRect(p.x + 30 + i * (p.w / 6), p.y + 22 + (i % 2) * 18, 18, 4);
    // Drops.
    c.fillStyle = sauce;
    for (const d of this.drops) {
      c.beginPath();
      c.arc(d.x, d.y, 3 + d.v * 40, 0, Math.PI * 2);
      c.fill();
    }
    // The cup: small clear portion cup, the fill line, the sauce rising.
    const cw = g.cupW;
    const ch = g.cupH;
    const x0 = this.cx - cw / 2;
    const y0 = g.tableY - ch;
    const lift = this.sealing > 0 ? (0.45 - this.sealing) * 140 : 0;
    c.save();
    c.translate(0, -lift);
    const fillH = Math.min(1.1, this.fill) * ch * 0.92;
    c.fillStyle = sauce;
    c.beginPath();
    c.moveTo(x0 + cw * 0.12, g.tableY);
    c.lineTo(x0 + cw * 0.88, g.tableY);
    c.lineTo(x0 + cw * (0.88 + 0.1 * (fillH / ch)), g.tableY - fillH);
    c.lineTo(x0 + cw * (0.12 - 0.1 * (fillH / ch)), g.tableY - fillH);
    c.closePath();
    c.fill();
    c.strokeStyle = '#ffffffcc';
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(x0, y0);
    c.lineTo(x0 + cw * 0.12, g.tableY);
    c.lineTo(x0 + cw * 0.88, g.tableY);
    c.lineTo(x0 + cw, y0);
    c.stroke();
    // The line.
    const lineY = g.tableY - SAUCE.line * ch * 0.92;
    c.setLineDash([6, 5]);
    c.strokeStyle = '#120d09';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(x0 - 6, lineY);
    c.lineTo(x0 + cw + 6, lineY);
    c.stroke();
    c.setLineDash([]);
    if (this.sealing > 0) {
      c.fillStyle = '#ffffffdd';
      c.fillRect(x0 - 4, y0 - 6, cw + 8, 8);
    }
    if (this.sealing < 0) {
      c.fillStyle = sauce;
      c.fillRect(x0 - 3, y0, 6, ch);
      c.fillRect(x0 + cw - 3, y0, 6, ch);
    }
    c.restore();
    // The ladle: a steel bowl with its sauce, a long red handle back up to your thumb.
    const r = g.ladleR;
    const a = -this.tilt * 1.2;
    c.save();
    c.translate(this.lx, this.ly);
    c.strokeStyle = '#c0392b';
    c.lineWidth = r * 0.32;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(-r * 0.7, -r * 0.5);
    c.lineTo(-r * 3.2, -r * 3.4);
    c.stroke();
    c.rotate(a);
    c.beginPath();
    c.arc(0, 0, r, 0, Math.PI);
    c.closePath();
    c.fillStyle = '#d6dbe0';
    c.fill();
    c.strokeStyle = '#7d858b';
    c.lineWidth = 3;
    c.stroke();
    if (this.load > 0.02) {
      const k = Math.min(1, this.load / SAUCE.scoop);
      c.beginPath();
      c.ellipse(0, r * (0.5 - k * 0.5), r * 0.85, r * 0.25 + k * r * 0.2, 0, 0, Math.PI * 2);
      c.fillStyle = sauce;
      c.fill();
    }
    c.restore();
  }
}

function rr(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

/**
 * The lemon berry mascarpone cup, two steps. First the spatula: drag a dollop of paste from the pan
 * and swipe it off into the cup, to the line. Then the squeeze bottle: hold over the cup to squeeze
 * berry compote and swirl it around. SWIRLED! for the right amount spread all the way around.
 */
export class MascarponeView {
  private root: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private title: HTMLElement;
  private count: HTMLElement;
  private hint: HTMLElement;
  private open = false;
  private w = 1;
  private h = 1;
  private phase: 'paste' | 'berry' | 'done' = 'paste';
  private paste = 0;
  private berry = 0;
  private sectors = new Array<number>(8).fill(0);
  private dots: { x: number; y: number; r: number }[] = [];
  private finger: { id: number; x: number; y: number; load: number } | null = null;
  private doneFor = 0;
  private made = 0;
  private last = 0;

  constructor(parent: HTMLElement, private k: Kitchen) {
    this.root = el('div', 'ladle-ui', parent);
    this.root.hidden = true;
    const bar = el('div', 'ladle-top', this.root);
    this.title = el('div', 'ladle-title', bar);
    this.count = el('div', 'ladle-count', bar);
    this.canvas = el('canvas', 'ladle-canvas', this.root);
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d canvas');
    this.ctx = ctx;
    const foot = el('div', 'scene-bar ladle-bar', this.root);
    this.hint = el('div', 'scene-hint', foot);
    const done = el('button', 'scene-btn primary', foot);
    done.textContent = 'DONE';
    done.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.close();
    });
    this.canvas.addEventListener('pointerdown', (e) => this.down(e));
    this.canvas.addEventListener('pointermove', (e) => this.move(e));
    this.canvas.addEventListener('pointerup', (e) => this.up(e));
    this.canvas.addEventListener('pointercancel', (e) => this.up(e));
  }

  private get geo() {
    const { w, h } = this;
    const r = Math.min(w * 0.3, h * 0.24);
    return { pan: { x: w * 0.08, y: h * 0.04, w: w * 0.5, h: h * 0.2 }, bottle: { x: w * 0.78, y: h * 0.14 }, cup: { x: w / 2, y: h * 0.62, r } };
  }

  isOpen() {
    return this.open;
  }

  show() {
    this.open = true;
    this.root.hidden = false;
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = r.width;
    this.h = r.height;
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.made = 0;
    this.fresh();
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  close() {
    this.open = false;
    this.root.hidden = true;
    this.finger = null;
  }

  private fresh() {
    this.phase = 'paste';
    this.paste = 0;
    this.berry = 0;
    this.sectors.fill(0);
    this.dots = [];
    this.doneFor = 0;
  }

  private pt(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private down(e: PointerEvent) {
    e.preventDefault();
    if (this.finger) return;
    const p = this.pt(e);
    const g = this.geo;
    const inPan = p.x > g.pan.x && p.x < g.pan.x + g.pan.w && p.y > g.pan.y && p.y < g.pan.y + g.pan.h;
    // Paste: grab a dollop from the pan. Berry: anywhere is the bottle in your hand.
    this.finger = { id: e.pointerId, x: p.x, y: p.y, load: this.phase === 'paste' && inPan ? SAUCE.dollop : 0 };
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* not a live pointer (synthetic): fine */
    }
  }

  private move(e: PointerEvent) {
    const f = this.finger;
    if (!f || f.id !== e.pointerId) return;
    const p = this.pt(e);
    const g = this.geo;
    // Spatula: a swipe across the cup's mouth scrapes the dollop off into it.
    if (this.phase === 'paste' && f.load > 0) {
      const near = Math.hypot(p.x - g.cup.x, p.y - g.cup.y) < g.cup.r * 0.9;
      const swipe = Math.abs(p.x - f.x);
      if (near && swipe > 1) {
        const amt = Math.min(f.load, swipe * 0.004);
        f.load -= amt;
        this.paste += amt;
      }
    }
    f.x = p.x;
    f.y = p.y;
  }

  private up(e: PointerEvent) {
    if (this.finger?.id === e.pointerId) this.finger = null;
  }

  private frame(now: number) {
    if (!this.open) return;
    const dt = Math.min(1 / 30, (now - this.last) / 1000);
    this.last = now;
    this.step(dt);
    this.draw();
    requestAnimationFrame((t) => this.frame(t));
  }

  /** Advance by dt seconds (public so tests can drive it). */
  step(dt: number) {
    const g = this.geo;
    const f = this.finger;
    if (this.phase === 'paste') {
      this.hint.textContent = 'drag a dollop from the pan, swipe it off into the cup · to the line';
      if (this.paste > 1) {
        this.k.spillSauce('mascarpone', SAUCE.cupCents);
        sfx.reject();
        this.fresh();
      } else if (this.paste >= SAUCE.paste[0] && !f) {
        this.phase = 'berry';
        sfx.catch(3);
      }
    } else if (this.phase === 'berry') {
      this.hint.textContent = 'hold to squeeze the compote · swirl it all the way around';
      if (f) {
        const amt = SAUCE.squeeze * dt;
        const d = Math.hypot(f.x - g.cup.x, f.y - g.cup.y);
        if (d < g.cup.r) {
          this.berry += amt;
          const a = Math.atan2(f.y - g.cup.y, f.x - g.cup.x);
          if (d > g.cup.r * 0.25) {
            const s = Math.floor(((a + Math.PI) / (Math.PI * 2)) * 8) % 8;
            this.sectors[s] = (this.sectors[s] ?? 0) + amt;
          }
          this.dots.push({ x: f.x, y: f.y, r: 5 + Math.random() * 3 });
        } else if (Math.random() < dt * 30) {
          this.dots.push({ x: f.x, y: f.y, r: 4 });
          this.k.spillSauce('mascarpone', 1);
        }
        this.doneFor = 0;
      } else if (this.berry > 0.05) {
        this.doneFor += dt;
        if (this.doneFor > 0.35) this.finish();
      }
    }
    this.count.textContent = `${this.k.cupStock.mascarpone ?? 0} ready${this.made ? ` · +${this.made}` : ''}`;
  }

  private finish() {
    const covered = this.sectors.filter((s) => s > 0.012).length;
    const okPaste = this.paste <= SAUCE.paste[1];
    const okBerry = this.berry >= SAUCE.berry[0] && this.berry <= SAUCE.berry[1];
    const swirl = covered >= SAUCE.swirlSectors;
    // A good cup counts; a perfect one (paste to the line, the right drizzle, all the way around) stamps.
    const fill = okPaste && okBerry && swirl ? 0.9 : okPaste || okBerry ? 0.75 : 0.5;
    this.k.ladledCup('mascarpone', fill);
    if (fill >= SAUCE.okMin) {
      this.made++;
      haptic(12);
    }
    this.phase = 'done';
    window.setTimeout(() => this.open && this.fresh(), 450);
  }

  private draw() {
    const c = this.ctx;
    const g = this.geo;
    const { w, h } = this;
    c.fillStyle = '#b9bfc4';
    c.fillRect(0, 0, w, h);
    // The paste pan.
    rr(c, g.pan.x, g.pan.y, g.pan.w, g.pan.h, 12);
    c.fillStyle = '#d8dde1';
    c.fill();
    rr(c, g.pan.x + 10, g.pan.y + 10, g.pan.w - 20, g.pan.h - 20, 8);
    c.fillStyle = '#fbf3dc';
    c.fill();
    // The squeeze bottle.
    c.fillStyle = '#7b1e3c';
    rr(c, g.bottle.x - 18, g.bottle.y - 50, 36, 80, 10);
    c.fill();
    c.fillStyle = '#ffffffaa';
    c.fillRect(g.bottle.x - 4, g.bottle.y - 70, 8, 22);
    // The cup from above: black rim, the paste rising, the compote dots.
    c.beginPath();
    c.arc(g.cup.x, g.cup.y, g.cup.r, 0, Math.PI * 2);
    c.fillStyle = '#1b1b1d';
    c.fill();
    c.beginPath();
    c.arc(g.cup.x, g.cup.y, g.cup.r * 0.88 * Math.min(1, Math.sqrt(this.paste)), 0, Math.PI * 2);
    c.fillStyle = '#fbf3dc';
    c.fill();
    // The line: how full the paste should get.
    c.setLineDash([6, 5]);
    c.strokeStyle = '#ffffff99';
    c.lineWidth = 2;
    c.beginPath();
    c.arc(g.cup.x, g.cup.y, g.cup.r * 0.88 * Math.sqrt(SAUCE.paste[0]), 0, Math.PI * 2);
    c.stroke();
    c.setLineDash([]);
    c.fillStyle = '#8e1f4a';
    for (const d of this.dots) {
      c.beginPath();
      c.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      c.fill();
    }
    // What's in your hand: a dollop on the spatula, or the bottle.
    const f = this.finger;
    if (f && this.phase === 'paste') {
      c.fillStyle = '#c9ced3';
      c.fillRect(f.x - 26, f.y - 6, 52, 12);
      if (f.load > 0) {
        c.beginPath();
        c.arc(f.x, f.y - 10, 6 + f.load * 60, 0, Math.PI * 2);
        c.fillStyle = '#fbf3dc';
        c.fill();
      }
    } else if (f && this.phase === 'berry') {
      c.fillStyle = '#7b1e3c';
      rr(c, f.x - 14, f.y - 70, 28, 60, 8);
      c.fill();
    }
    this.title.textContent = this.phase === 'berry' ? 'BERRY · swirl it' : 'MASCARPONE · to the line';
  }
}
