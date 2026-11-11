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
  private overAt = -9;
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
    // Overfilled: what's over the top runs down the side and onto the tally. The cup's still a cup
    // (a full one); the extra goes back in the pan.
    if (this.fill > SAUCE.overflow && this.sealing === 0) {
      this.spilled += this.fill - SAUCE.overflow;
      this.fill = SAUCE.overflow;
      if (this.t - this.overAt > 0.6) {
        this.overAt = this.t;
        haptic(20);
        sfx.reject();
      }
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
 * The lemon berry mascarpone cup, the way it's made on the line. A quarter pan of mascarpone in the
 * cold table with its little spatula (wooden handle, blue blade), and a squeeze bottle of berry
 * compote. Scoop a good amount onto the spatula, put it in the cup and scrape it off against the
 * edge; then squeeze compote into the space that's left, so the cup is half and half. Too much on
 * the spatula and it won't all fit: it ends up on the rim. Too much compote and it runs over.
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
  /** Mascarpone in the cup, compote in the cup, and mascarpone smeared on the rim (cups' worth). */
  private paste = 0;
  private berry = 0;
  private mess = 0;
  /** Compote down the side, cents (the tally on the table). */
  private spiltCents = 0;
  private owed = 0;
  /** What's in your hand: the spatula (with what's on it) or the bottle. */
  private tool: { id: number; kind: 'spatula' | 'bottle'; x: number; y: number; load: number } | null = null;
  private squeezing = false;
  private idle = 0;
  private sealed = 0;
  private made = 0;
  private last = 0;
  private t = 0;

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

  /** Where things are: the pan along the top, the bottle to its right, the cup below (side on). */
  get geo() {
    const { w, h } = this;
    const cupH = Math.min(h * 0.36, w * 0.6);
    const top = Math.min(w * 0.5, cupH * 1.25);
    return {
      pan: { x: w * 0.05, y: h * 0.05, w: w * 0.62, h: h * 0.2 },
      bottle: { x: w * 0.84, y: h * 0.27, w: Math.min(54, w * 0.15), h: h * 0.16 },
      cup: { x: w / 2, rim: h * 0.5, bottom: h * 0.5 + cupH, top, base: top * 0.74 },
      table: h * 0.5 + cupH + 4,
    };
  }

  /** How high the mascarpone stands against its side of the cup, and the level of the whole cup (0..1). */
  levels() {
    const M = SAUCE.mascarpone;
    const hp = this.paste / M.side;
    const right = (1 - M.side) * hp;
    const level = this.berry <= right ? this.berry / (1 - M.side) : hp + (this.berry - right);
    return { hp, level: Math.max(hp, level), berryLevel: level };
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
    this.spiltCents = 0;
    this.fresh();
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  close() {
    this.open = false;
    this.root.hidden = true;
    this.tool = null;
  }

  private fresh() {
    this.paste = 0;
    this.berry = 0;
    this.mess = 0;
    this.owed = 0;
    this.idle = 0;
    this.sealed = 0;
    this.squeezing = false;
  }

  private pt(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private inPan(x: number, y: number) {
    const p = this.geo.pan;
    return x > p.x && x < p.x + p.w && y > p.y - 10 && y < p.y + p.h + 10;
  }

  /** Is this point down in the mouth of the cup? */
  private inCup(x: number, y: number) {
    const c = this.geo.cup;
    return Math.abs(x - c.x) < c.top * 0.5 + 6 && y > c.rim - 14 && y < c.bottom;
  }

  private down(e: PointerEvent) {
    e.preventDefault();
    if (this.tool || this.sealed) return;
    const p = this.pt(e);
    const g = this.geo;
    // The bottle is the bottle; anything else is the spatula coming up out of the pan.
    const b = g.bottle;
    const bottle = Math.abs(p.x - b.x) < b.w * 0.9 && p.y > b.y - b.h - 10 && p.y < b.y + 16;
    this.tool = { id: e.pointerId, kind: bottle ? 'bottle' : 'spatula', x: p.x, y: p.y, load: 0 };
    haptic(6);
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* not a live pointer (synthetic): fine */
    }
  }

  private move(e: PointerEvent) {
    const f = this.tool;
    if (!f || f.id !== e.pointerId) return;
    const p = this.pt(e);
    const M = SAUCE.mascarpone;
    const dist = Math.hypot(p.x - f.x, p.y - f.y);
    if (f.kind === 'spatula') {
      if (this.inPan(p.x, p.y)) {
        // Dragging through the pan loads the blade: a good scoop is one pass, and it'll take more.
        const was = f.load;
        f.load = Math.min(M.scoopMax, f.load + (dist / this.geo.pan.w) * M.scoopPerPass);
        if (was < M.goodScoop && f.load >= M.goodScoop) haptic(10);
      } else if (this.inCup(p.x, p.y) && f.load > 0) {
        // In the cup, against the edge: it scrapes off the blade. What doesn't fit ends up on the rim.
        const amt = Math.min(f.load, (dist / this.geo.cup.top) * M.scrapePerPass);
        f.load -= amt;
        const room = Math.max(0, M.side * M.pasteMax - this.paste);
        this.paste += Math.min(amt, room);
        this.mess += Math.max(0, amt - room);
        if (amt > 0 && Math.random() < 0.3) sfx.rim();
      }
    }
    f.x = p.x;
    f.y = p.y;
  }

  private up(e: PointerEvent) {
    if (this.tool?.id === e.pointerId) {
      this.tool = null;
      this.squeezing = false;
    }
  }

  private frame(now: number) {
    if (!this.open) return;
    const dt = Math.min(1 / 30, (now - this.last) / 1000);
    this.last = now;
    this.step(dt);
    this.draw();
    requestAnimationFrame((t) => this.frame(t));
  }

  /** The bottle's nozzle: it's held tipped over, nozzle down, a little above your finger. */
  private nozzle(f: { x: number; y: number }) {
    return { x: f.x - 6, y: f.y - 34 };
  }

  /** Advance by dt seconds (public so tests can drive it). */
  step(dt: number) {
    const M = SAUCE.mascarpone;
    const g = this.geo;
    const f = this.tool;
    this.t += dt;
    if (this.sealed > 0) {
      this.sealed -= dt;
      if (this.sealed <= 0) this.fresh();
      return;
    }
    this.squeezing = false;
    if (f?.kind === 'bottle') {
      // Over the cup, the bottle squeezes; anywhere else it just waits.
      const n = this.nozzle(f);
      if (Math.abs(n.x - g.cup.x) < g.cup.top * 0.46 && n.y < g.cup.rim + 6) {
        this.squeezing = true;
        this.berry += M.squeeze * dt;
        const { level } = this.levels();
        if (level > M.overflow) {
          // Over the top: down the side, and onto Matt's tab a cent at a time.
          const over = level - M.overflow;
          this.berry -= over;
          this.owed += over * SAUCE.spillCents;
          const cents = Math.floor(this.owed);
          if (cents > 0) {
            this.owed -= cents;
            this.spiltCents += cents;
            this.k.spillSauce('mascarpone', cents);
          }
        }
      }
      this.idle = 0;
    } else if (f) this.idle = 0;
    else if (this.berry > 0.04) {
      // Bottle down with compote in the cup: that's the cup.
      this.idle += dt;
      if (this.idle > 0.5) this.finish();
    }
    const scooped = f?.kind === 'spatula' && f.load > 0.02;
    this.hint.textContent =
      this.paste < M.side * M.pasteOk[0] && !scooped
        ? 'drag the spatula through the mascarpone'
        : scooped
          ? 'into the cup · scrape it off on the edge'
          : this.berry < 0.04
            ? 'now the berry bottle · fill the other half'
            : 'to the line · let go';
    this.title.textContent = 'LEMON BERRY MASCARPONE';
    this.count.textContent = `${this.k.cupStock.mascarpone ?? 0} ready${this.made ? ` · +${this.made}` : ''}`;
  }

  private finish() {
    const M = SAUCE.mascarpone;
    const { hp, level } = this.levels();
    const okPaste = hp >= M.pasteOk[0] && hp <= M.pasteOk[1] && this.mess < M.messOk;
    const okBerry = level >= M.levelOk[0] && level <= M.levelOk[1] && this.berry >= M.berryMin;
    // Half and half to the line with a clean rim is the cup; one of the two is passable.
    const fill = okPaste && okBerry ? 0.9 : okPaste || okBerry ? 0.75 : 0.5;
    const ok = this.k.ladledCup('mascarpone', fill);
    if (ok) {
      this.made++;
      haptic(12);
      this.sealed = 0.5;
    } else {
      this.k.say(this.mess >= M.messOk ? 'Mascarpone all over the rim: again' : hp < M.pasteOk[0] ? 'Mostly compote: again' : 'Not a cup yet: again');
      sfx.reject();
      this.sealed = 0.35;
    }
  }

  /** A point in the cup: u across (0 left wall, 1 right wall), v up (0 bottom, 1 rim). */
  private at(u: number, v: number) {
    const c = this.geo.cup;
    const wv = c.base + (c.top - c.base) * v;
    return { x: c.x + (u - 0.5) * wv, y: c.bottom - v * (c.bottom - c.rim) };
  }

  private draw() {
    const c = this.ctx;
    const g = this.geo;
    const M = SAUCE.mascarpone;
    const { w, h } = this;
    const CREAM = '#fbf3dc';
    const BERRY = '#8e1f4a';
    // The cold table: steel, with the quarter pan dropped into it.
    c.fillStyle = '#aeb5ba';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#9aa2a8';
    c.fillRect(0, g.table, w, h - g.table);
    const p = g.pan;
    rr(c, p.x, p.y, p.w, p.h, 12);
    c.fillStyle = '#dfe4e8';
    c.fill();
    c.strokeStyle = '#7e878d';
    c.lineWidth = 2;
    c.stroke();
    rr(c, p.x + 9, p.y + 9, p.w - 18, p.h - 18, 8);
    c.fillStyle = CREAM;
    c.fill();
    // Soft peaks, so it reads as something you could drag a spatula through.
    c.strokeStyle = '#efe3bf';
    c.lineWidth = 3;
    c.lineCap = 'round';
    for (let i = 0; i < 5; i++) {
      const x = p.x + 26 + ((p.w - 60) * i) / 4;
      c.beginPath();
      c.moveTo(x - 12, p.y + p.h * 0.62);
      c.quadraticCurveTo(x, p.y + p.h * 0.3, x + 12, p.y + p.h * 0.58);
      c.stroke();
    }
    // The cup, side on: clear plastic, so you can see the two halves.
    const tl = this.at(0, 1);
    const tr = this.at(1, 1);
    const bl = this.at(0, 0);
    const br = this.at(1, 0);
    const { hp, berryLevel } = this.levels();
    c.save();
    c.beginPath();
    c.moveTo(tl.x, tl.y - 30);
    c.lineTo(tr.x, tr.y - 30);
    c.lineTo(br.x, br.y);
    c.lineTo(bl.x, bl.y);
    c.closePath();
    c.clip();
    // Compote first (it fills the space that's left, and over the top once it's past the mascarpone).
    if (this.berry > 0) {
      const lv = Math.min(M.overflow, berryLevel);
      const a = this.at(0, lv);
      c.fillStyle = BERRY;
      c.fillRect(bl.x - 20, a.y, tr.x - bl.x + 40, bl.y - a.y);
      // A little swirl where the two meet.
      c.strokeStyle = '#b84a74';
      c.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        const q = this.at(M.side + 0.06 + i * 0.1, Math.min(lv, hp) * (0.3 + i * 0.22));
        c.beginPath();
        c.arc(q.x, q.y, 5 + i * 2, 0.4, Math.PI * 1.4);
        c.stroke();
      }
    }
    // The mascarpone: scraped down one side, standing with a soft shoulder.
    if (this.paste > 0) {
      const top = Math.min(1.08, hp);
      const a0 = this.at(0, top);
      const a1 = this.at(M.side * 0.72, top);
      const a2 = this.at(M.side + 0.07, top * 0.45);
      const a3 = this.at(M.side + 0.02, 0);
      c.fillStyle = CREAM;
      c.beginPath();
      c.moveTo(bl.x - 4, bl.y + 2);
      c.lineTo(a0.x - 4, a0.y);
      c.lineTo(a1.x, a1.y);
      c.quadraticCurveTo(a2.x + 8, a2.y - (a2.y - a1.y) * 0.5, a2.x, a2.y);
      c.quadraticCurveTo(a3.x + 6, (a2.y + a3.y) / 2, a3.x, a3.y + 2);
      c.closePath();
      c.fill();
      c.strokeStyle = '#e6d9b0';
      c.lineWidth = 2;
      c.stroke();
    }
    c.restore();
    // The line to fill to.
    const l0 = this.at(0, SAUCE.line);
    const l1 = this.at(1, SAUCE.line);
    c.setLineDash([6, 5]);
    c.strokeStyle = '#ffffffcc';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(l0.x + 3, l0.y);
    c.lineTo(l1.x - 3, l1.y);
    c.stroke();
    c.setLineDash([]);
    // Cup walls and rim.
    c.strokeStyle = '#f4f6f7';
    c.lineWidth = 4;
    c.lineJoin = 'round';
    c.beginPath();
    c.moveTo(tl.x, tl.y);
    c.lineTo(bl.x, bl.y);
    c.lineTo(br.x, br.y);
    c.lineTo(tr.x, tr.y);
    c.stroke();
    c.lineWidth = 6;
    c.beginPath();
    c.moveTo(tl.x - 5, tl.y);
    c.lineTo(tr.x + 5, tr.y);
    c.globalAlpha = 0.35;
    c.stroke();
    c.globalAlpha = 1;
    // What didn't fit: smeared on the rim and down the outside.
    if (this.mess > 0.005) {
      const n = Math.min(7, 1 + Math.floor(this.mess / 0.03));
      c.fillStyle = CREAM;
      for (let i = 0; i < n; i++) {
        const side = i % 2 ? tr : tl;
        const dir = i % 2 ? 1 : -1;
        c.beginPath();
        c.ellipse(side.x + dir * (4 + (i >> 1) * 3), side.y + 4 + (i >> 1) * 9, 9, 6 + (i >> 1) * 2, dir * 0.5, 0, Math.PI * 2);
        c.fill();
      }
    }
    // Compote down the side.
    if (this.spiltCents > 0 && berryLevel >= M.overflow - 0.01) {
      c.fillStyle = BERRY;
      rr(c, tr.x + 1, tr.y - 2, 7, Math.min(g.table - tr.y, 20 + this.spiltCents * 1.2), 3);
      c.fill();
    }
    if (this.spiltCents > 0) {
      c.fillStyle = '#3a1410';
      const label = `SPILLED −$${(this.spiltCents / 100).toFixed(2)}`;
      c.font = '900 16px ui-monospace, Menlo, monospace';
      const tw = c.measureText(label).width;
      rr(c, w / 2 - tw / 2 - 10, g.table + 8, tw + 20, 26, 7);
      c.fill();
      c.fillStyle = '#ff8a7a';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(label, w / 2, g.table + 21);
    }
    // The lid, when it's a cup.
    if (this.sealed > 0 && this.made) {
      c.fillStyle = '#f4f6f7';
      rr(c, tl.x - 8, tl.y - 8, tr.x - tl.x + 16, 10, 4);
      c.fill();
    }
    const f = this.tool;
    // The bottle: standing by the pan, or tipped over in your hand.
    const b = g.bottle;
    const drawBottle = (x: number, y: number, rot: number) => {
      c.save();
      c.translate(x, y);
      c.rotate(rot);
      c.fillStyle = '#f1f3f4';
      rr(c, -b.w / 2, -b.h, b.w, b.h, 9);
      c.fill();
      c.fillStyle = BERRY;
      rr(c, -b.w / 2 + 4, -b.h * 0.8, b.w - 8, b.h * 0.8 - 4, 6);
      c.fill();
      c.fillStyle = '#f1f3f4';
      c.beginPath();
      c.moveTo(-b.w * 0.3, -b.h);
      c.lineTo(b.w * 0.3, -b.h);
      c.lineTo(3, -b.h - 22);
      c.lineTo(-3, -b.h - 22);
      c.closePath();
      c.fill();
      c.restore();
    };
    if (f?.kind === 'bottle') {
      const n = this.nozzle(f);
      // Tipped: the nozzle points down at the cup, the body up and away from your finger.
      const rot = Math.PI * 0.94;
      const reach = b.h + 22;
      drawBottle(n.x - reach * Math.sin(rot), n.y + reach * Math.cos(rot), rot);
      if (this.squeezing) {
        const { berryLevel: lv } = this.levels();
        const surf = this.at(0.5, Math.min(1, Math.max(lv, 0.02))).y;
        c.strokeStyle = BERRY;
        c.lineWidth = 5 + Math.sin(this.t * 30) * 1;
        c.lineCap = 'round';
        c.beginPath();
        c.moveTo(n.x, n.y);
        c.lineTo(n.x, Math.max(n.y + 4, surf));
        c.stroke();
      }
    } else drawBottle(b.x, b.y, 0);
    // The spatula: wooden handle, blue blade. Lying in the pan, or in your hand with what's on it.
    const drawSpatula = (x: number, y: number, rot: number, load: number) => {
      c.save();
      c.translate(x, y);
      c.rotate(rot);
      c.fillStyle = '#b07a44';
      rr(c, 18, -5, 78, 10, 5);
      c.fill();
      c.fillStyle = '#2f6fd6';
      rr(c, -22, -12, 46, 24, 7);
      c.fill();
      if (load > 0.01) {
        // A good scoop covers the blade; too much hangs off it.
        const k = load / M.goodScoop;
        c.fillStyle = CREAM;
        c.beginPath();
        c.ellipse(-2, -4 - k * 5, 10 + Math.min(1.5, k) * 13, 5 + Math.min(1.8, k) * 9, 0, 0, Math.PI * 2);
        c.fill();
        if (k > 1.25) {
          c.beginPath();
          c.ellipse(-20, 8, 7, 5 + (k - 1.25) * 14, 0.3, 0, Math.PI * 2);
          c.fill();
        }
      }
      c.restore();
    };
    if (f?.kind === 'spatula') drawSpatula(f.x, f.y - 6, -0.62, f.load);
    else drawSpatula(p.x + p.w * 0.7, p.y + p.h * 0.5, -0.35, 0);
  }
}
