import { SAUCE } from '../config/shift';
import { SAUCE_COLORS } from '../render/models';
import { haptic, sfx } from '../ui/feel';
import { type Kitchen, lidOrder, type Sauce } from './kitchen';

// The ladle. One hand: dip it in the pan, carry it over to the cup, and lower it to tip it. The
// sauce is real stuff: it sits in the bowl of the ladle, runs out over the lip when you tip, piles
// up in the cup, and what misses lands on the table (and on Matt's tab). Ranch is thin and quick;
// marinara is thick and chunky. The cup you're filling is for the box sitting right there: stop
// pouring with it at the line and it's lidded and set in that box.

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement) => {
  const e = document.createElement(tag);
  e.className = cls;
  parent?.appendChild(e);
  return e;
};

/** A bit of sauce. */
interface Blob {
  x: number;
  y: number;
  px: number;
  py: number;
  r: number;
  /** Still in the bowl of the ladle. */
  ladle: boolean;
  /** Has been inside the cup (so it counts when it settles there). */
  cup: boolean;
  /** A chunk of tomato: drawn darker. */
  chunk: boolean;
}

const NAMES: Record<string, string> = { marinara: 'MARINARA', ranch: 'RANCH' };

export class LadleView {
  private root: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private title: HTMLElement;
  private count: HTMLElement;
  private tally: HTMLElement;
  private sauce: Sauce = 'marinara';
  private open = false;
  private w = 1;
  private h = 1;
  // The ladle: where your hand has it, and how far it's tipped (radians, 0 is level).
  private lx = 0;
  private ly = 0;
  private tilt = 0;
  private ladleId: number | null = null;
  private blobs: Blob[] = [];
  private stains: { x: number; r: number }[] = [];
  private scooped = 0;
  /** How full the cup is (0..1 of its height), and when sauce last went in. */
  private fill = 0;
  private lastHit = -9;
  /** Lid going on (counts down), then the cup on its way to the box (counts up to 1). */
  private sealing = 0;
  private hop = -1;
  private sealedFill = 0;
  /** Cents of spill already charged this visit, and the running tally shown on the table. */
  private spiltBlobs = 0;
  private charged = 0;
  private tallyCents = 0;
  private made = 0;
  private t = 0;
  private last = 0;
  /** Who the cup is for: written on the box sitting by the cup. */
  private label = { name: '', order: '' };

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
    el('div', 'scene-hint', foot).textContent = 'dip the ladle · lower it over the cup to pour · lift to stop';
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

  /** The pan along the top, the cup and its box on the table: layout in canvas pixels. */
  get geo() {
    const { w, h } = this;
    const L = SAUCE.ladle;
    const cupTop = Math.min(w * 0.22, h * 0.22);
    const cupH = cupTop * 0.75;
    const tableY = h * 0.92;
    const R = cupTop * L.bowl;
    const pan = { x: w * 0.05, y: h * 0.04, w: w * 0.9, h: h * 0.2 };
    return {
      pan,
      tableY,
      cup: { x: w * 0.36, top: cupTop, base: cupTop * 0.74, h: cupH, rim: tableY - cupH },
      box: { x: w * 0.6, w: w * 0.36, h: cupH * 0.62 },
      R,
      /** The ladle is level down to carryY; from there to lowY it tips further the lower it goes. */
      carryY: pan.y + pan.h + R * 1.15,
      lowY: tableY - cupH - R * 1.05,
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
    this.lx = g.pan.x + g.pan.w * 0.3;
    this.ly = g.pan.y + g.pan.h * 0.55;
    this.tilt = 0;
    this.blobs = [];
    this.stains = [];
    this.scooped = 0;
    this.fill = 0;
    this.sealing = 0;
    this.hop = -1;
    this.spiltBlobs = 0;
    this.charged = 0;
    this.tallyCents = 0;
    this.tally.classList.remove('on');
    this.made = 0;
    this.last = performance.now();
    const box = this.k.fillBox;
    const ref = box ? this.k.itemFor(box) : null;
    this.label = { name: (ref?.order.name ?? '').toUpperCase(), order: ref ? lidOrder(ref.item).replace('\n', ' ').toUpperCase() : '' };
    this.title.textContent = NAMES[sauce] ?? sauce.toUpperCase();
    requestAnimationFrame((t) => this.frame(t));
  }

  close() {
    this.open = false;
    this.root.hidden = true;
    this.ladleId = null;
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

  // ---------- Input: one hand on the ladle ----------

  private aim(x: number, y: number) {
    const g = this.geo;
    this.target = { x: Math.max(g.R, Math.min(this.w - g.R, x)), y: Math.max(g.pan.y + g.R * 0.4, Math.min(g.lowY, y - g.R * 0.6)) };
  }
  private target: { x: number; y: number } | null = null;

  private down(e: PointerEvent) {
    e.preventDefault();
    if (this.ladleId !== null) return;
    this.ladleId = e.pointerId;
    const p = this.pt(e);
    this.aim(p.x, p.y);
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* not a live pointer (synthetic): fine */
    }
  }

  private move(e: PointerEvent) {
    if (e.pointerId !== this.ladleId) return;
    const p = this.pt(e);
    this.aim(p.x, p.y);
  }

  private up(e: PointerEvent) {
    if (e.pointerId === this.ladleId) this.ladleId = null;
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

  private get feel() {
    return SAUCE.ladle.feel[this.sauce as 'marinara' | 'ranch'] ?? SAUCE.ladle.feel.marinara;
  }

  /** How many blobs fill the cup to its brim (so a spilled blob has a price). */
  private get blobsPerCup() {
    const g = this.geo;
    const r = g.cup.top * this.feel.size;
    return (g.cup.h * (g.cup.top + g.cup.base) * 0.5 * SAUCE.ladle.pack) / (Math.PI * r * r);
  }

  /** Advance by dt seconds (public so tests can drive it). */
  step(dt: number) {
    const g = this.geo;
    const L = SAUCE.ladle;
    const F = this.feel;
    this.t += dt;
    // The ladle follows your hand, a little heavy. Lower than carry height, it tips.
    const ox = this.lx;
    const oy = this.ly;
    if (this.target && this.hop < 0) {
      const k = 1 - Math.exp(-L.follow * dt);
      this.lx += (this.target.x - this.lx) * k;
      this.ly += (this.target.y - this.ly) * k;
    }
    const down = Math.max(0, Math.min(1, (this.ly - g.carryY) / Math.max(1, g.lowY - g.carryY)));
    this.tilt = down * L.maxTilt;
    const dx = this.lx - ox;
    const dy = this.ly - oy;
    // What's in the bowl comes along with it (and lags a touch, so a jerk sloshes).
    for (const b of this.blobs) {
      if (!b.ladle) continue;
      b.x += dx;
      b.y += dy;
      b.px += dx * (1 + L.slosh);
      b.py += dy * (1 + L.slosh);
    }
    // In the pan: it fills.
    const inPan = this.lx > g.pan.x && this.lx < g.pan.x + g.pan.w && this.ly < g.pan.y + g.pan.h;
    const r0 = g.cup.top * F.size;
    if (inPan && this.sealing === 0 && this.hop < 0) {
      const cap = Math.round(this.blobsPerCup * L.scoop);
      const have = this.blobs.filter((b) => b.ladle).length;
      this.scooped += dt * L.scoopRate * cap;
      while (this.scooped >= 1 && have + 1 <= cap) {
        this.scooped -= 1;
        const a = Math.PI * (0.15 + Math.random() * 0.7);
        const d = Math.random() * (g.R - r0 * 2);
        const chunk = Math.random() < F.chunks;
        const x = this.lx + Math.cos(a) * d;
        const y = this.ly + Math.sin(a) * d * 0.7;
        this.blobs.push({ x, y, px: x, py: y, r: r0 * (chunk ? 1.45 : 0.85 + Math.random() * 0.3), ladle: true, cup: false, chunk });
        if (this.blobs.filter((b) => b.ladle).length >= cap) break;
      }
      if (this.scooped > 1) this.scooped = 0;
    }
    const n = 3;
    for (let i = 0; i < n; i++) this.physics(dt / n);
    this.settle(dt);
    this.count.textContent = this.made ? `+${this.made}` : '';
  }

  /** One step of the sauce: gravity, then keep every blob out of every other and out of the walls. */
  private physics(dt: number) {
    const g = this.geo;
    const F = this.feel;
    const grav = this.h * SAUCE.ladle.gravity;
    for (const b of this.blobs) {
      const vx = (b.x - b.px) * F.drag;
      const vy = (b.y - b.py) * F.drag + grav * dt * dt;
      b.px = b.x;
      b.py = b.y;
      // Nothing moves further than its own size in a step: sauce pours, it doesn't fly.
      const sp = Math.hypot(vx, vy);
      const cap = b.r * 0.9;
      const k = sp > cap ? cap / sp : 1;
      b.x += vx * k;
      b.y += vy * k;
    }
    // Neighbors, through a grid.
    const cell = g.cup.top * F.size * 3.2;
    const grid = new Map<number, Blob[]>();
    for (const b of this.blobs) {
      const key = Math.floor(b.x / cell) * 4096 + Math.floor(b.y / cell);
      const list = grid.get(key);
      if (list) list.push(b);
      else grid.set(key, [b]);
    }
    for (let pass = 0; pass < 2; pass++) {
      for (const b of this.blobs) {
        const gx = Math.floor(b.x / cell);
        const gy = Math.floor(b.y / cell);
        for (let ix = gx - 1; ix <= gx + 1; ix++) {
          for (let iy = gy - 1; iy <= gy + 1; iy++) {
            const list = grid.get(ix * 4096 + iy);
            if (!list) continue;
            for (const o of list) {
              if (o === b) continue;
              const ddx = o.x - b.x;
              const ddy = o.y - b.y;
              const min = b.r + o.r;
              const d2 = ddx * ddx + ddy * ddy;
              if (d2 >= min * min || d2 < 1e-6) continue;
              const d = Math.sqrt(d2);
              const push = ((min - d) / d) * 0.5 * F.firm;
              b.x -= ddx * push;
              b.y -= ddy * push;
              o.x += ddx * push;
              o.y += ddy * push;
            }
          }
        }
      }
      for (const b of this.blobs) this.walls(b);
    }
  }

  /** The cup's walls and floor, as segments (left wall, floor, right wall). */
  private cupSegs() {
    const c = this.geo.cup;
    const y1 = this.geo.tableY;
    const tl = { x: c.x - c.top / 2, y: c.rim };
    const tr = { x: c.x + c.top / 2, y: c.rim };
    const bl = { x: c.x - c.base / 2, y: y1 };
    const br = { x: c.x + c.base / 2, y: y1 };
    return [
      [tl, bl],
      [bl, br],
      [br, tr],
    ] as const;
  }

  private walls(b: Blob) {
    const g = this.geo;
    // The bowl of the ladle: a round shell, open at the top, turned by the tilt.
    if (b.ladle) {
      const dx = b.x - this.lx;
      const dy = b.y - this.ly;
      const d = Math.hypot(dx, dy) || 1e-6;
      // The mouth faces up, swung over toward the cup as it tips.
      const ux = Math.sin(this.tilt);
      const uy = -Math.cos(this.tilt);
      const facing = (dx * ux + dy * uy) / d;
      const inMouth = facing > Math.cos(SAUCE.ladle.mouth);
      if (!inMouth && d > g.R - b.r) {
        const k = (g.R - b.r) / d;
        b.x = this.lx + dx * k;
        b.y = this.ly + dy * k;
      } else if (inMouth && d > g.R + b.r) b.ladle = false;
      return;
    }
    // The cup (while it's there to be poured into).
    if (this.sealing === 0 && this.hop < 0) {
      for (const [p, q] of this.cupSegs()) {
        const ex = q.x - p.x;
        const ey = q.y - p.y;
        const t = Math.max(0, Math.min(1, ((b.x - p.x) * ex + (b.y - p.y) * ey) / (ex * ex + ey * ey)));
        const cx = p.x + ex * t;
        const cy = p.y + ey * t;
        const dx = b.x - cx;
        const dy = b.y - cy;
        const min = b.r + 2;
        const d2 = dx * dx + dy * dy;
        if (d2 < min * min && d2 > 1e-6) {
          const d = Math.sqrt(d2);
          b.x = cx + (dx / d) * min;
          b.y = cy + (dy / d) * min;
        }
      }
    }
    if (b.y > g.tableY - b.r) b.y = g.tableY - b.r;
    if (b.x < b.r) b.x = b.r;
    if (b.x > this.w - b.r) b.x = this.w - b.r;
  }

  private inCup(b: Blob) {
    const c = this.geo.cup;
    if (b.y < c.rim || b.y > this.geo.tableY) return false;
    const v = (this.geo.tableY - b.y) / c.h;
    return Math.abs(b.x - c.x) < (c.base + (c.top - c.base) * v) / 2;
  }

  /** What's in the cup, what's on the table, and whether it's a cup yet. */
  private settle(dt: number) {
    const g = this.geo;
    const pouring = this.sealing === 0 && this.hop < 0;
    const keep: Blob[] = [];
    const tops: number[] = [];
    let spilt = 0;
    for (const b of this.blobs) {
      if (b.ladle) {
        keep.push(b);
        continue;
      }
      // Slopped over the side while still over the pan: it's back in the pan.
      if (b.y < g.pan.y + g.pan.h && b.x > g.pan.x && b.x < g.pan.x + g.pan.w) continue;
      if (pouring && this.inCup(b)) {
        if (!b.cup) {
          b.cup = true;
          this.lastHit = this.t;
        }
        tops.push(b.y - b.r);
        keep.push(b);
        continue;
      }
      // On the table (or in the box): that one's gone, and it's a stain.
      if (b.y >= g.tableY - b.r - 0.5 && Math.abs(b.y - b.py) < 0.6) {
        spilt++;
        if (this.stains.length < 60) this.stains.push({ x: b.x, r: b.r * 1.5 });
        continue;
      }
      keep.push(b);
    }
    this.blobs = keep;
    if (pouring) {
      // How full: what's in the cup, against what the cup holds.
      this.fill = tops.length / this.blobsPerCup;
    }
    if (spilt) {
      // Every blob on the table is a little of a cup, charged as it lands.
      this.spiltBlobs += spilt;
      const owed = Math.floor((this.spiltBlobs / this.blobsPerCup) * SAUCE.spillCents) - this.charged;
      if (owed > 0) {
        this.charged += owed;
        this.k.spillSauce(this.sauce, owed);
        this.tallyCents += owed;
        this.tally.textContent = `SPILLED −$${(this.tallyCents / 100).toFixed(2)}`;
        this.tally.classList.add('on');
        this.tally.classList.remove('tick');
        void this.tally.offsetWidth;
        this.tally.classList.add('tick');
        if (Math.floor(this.charged / 25) !== Math.floor((this.charged - owed) / 25)) sfx.splat();
      }
    }
    // Stopped pouring with it filled: the lid goes on, and the cup goes in its box.
    if (pouring && this.fill >= SAUCE.okMin && this.t - this.lastHit > SAUCE.ladle.rest && this.tilt < SAUCE.ladle.maxTilt * 0.45) {
      this.sealing = 0.3;
      this.sealedFill = Math.min(1, this.fill);
      this.blobs = this.blobs.filter((b) => b.ladle || !b.cup);
      haptic(12);
      sfx.catch(4);
    }
    if (this.sealing > 0) {
      this.sealing = Math.max(0, this.sealing - dt);
      if (this.sealing === 0) this.hop = 0;
    } else if (this.hop >= 0) {
      this.hop += dt / 0.4;
      if (this.hop >= 1) {
        this.hop = -1;
        this.fill = 0;
        this.made++;
        // Into the box: that's the cup for this order (right sauce or not).
        this.k.ladledCup(this.sauce, Math.min(this.sealedFill, SAUCE.overflow));
      }
    }
  }

  private draw() {
    const c = this.ctx;
    const g = this.geo;
    const { w, h } = this;
    const sauce = SAUCE_COLORS[this.sauce] ?? '#c8341d';
    const dark = this.sauce === 'marinara' ? '#8f2413' : '#d9d3bf';
    c.clearRect(0, 0, w, h);
    // Steel table.
    c.fillStyle = '#b9bfc4';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#9aa2a8';
    c.fillRect(0, g.tableY, w, h - g.tableY);
    // The pan, dropped into the table.
    const p = g.pan;
    rr(c, p.x, p.y, p.w, p.h, 12);
    c.fillStyle = '#dfe4e8';
    c.fill();
    c.strokeStyle = '#7e878d';
    c.lineWidth = 2;
    c.stroke();
    rr(c, p.x + 9, p.y + 9, p.w - 18, p.h - 18, 8);
    c.fillStyle = sauce;
    c.fill();
    if (this.sauce === 'marinara') {
      // It's the hot table: a little steam, and bits in the sauce.
      c.fillStyle = dark;
      for (let i = 0; i < 9; i++) {
        c.beginPath();
        c.arc(p.x + 30 + ((p.w - 60) * i) / 8, p.y + p.h * (0.4 + 0.2 * Math.sin(i * 2.1)), 4, 0, Math.PI * 2);
        c.fill();
      }
      c.strokeStyle = '#ffffff55';
      c.lineWidth = 3;
      c.lineCap = 'round';
      for (let i = 0; i < 4; i++) {
        const x = p.x + p.w * (0.2 + i * 0.2);
        const ph = this.t * 1.4 + i;
        c.beginPath();
        c.moveTo(x, p.y + 6);
        c.quadraticCurveTo(x + Math.sin(ph) * 8, p.y - 6, x + Math.sin(ph + 1) * 5, p.y - 16);
        c.stroke();
      }
    }
    // Stains on the table.
    c.fillStyle = sauce;
    for (const s of this.stains) {
      c.beginPath();
      c.ellipse(s.x, g.tableY + 1, s.r * 1.3, s.r * 0.45, 0, 0, Math.PI * 2);
      c.fill();
    }
    // The box this cup is for: open, side on, its name on the lid.
    const bx = g.box;
    const baseY = g.tableY - bx.h;
    c.fillStyle = '#efe8d8';
    c.strokeStyle = '#cfc4ac';
    c.lineWidth = 2;
    // Lid, standing open at the back.
    c.save();
    c.translate(bx.x + bx.w, baseY + 4);
    c.rotate(-1.92);
    rr(c, 0, -bx.h * 0.5, bx.w * 0.95, bx.h * 0.5, 8);
    c.fill();
    c.stroke();
    c.restore();
    rr(c, bx.x, baseY, bx.w, bx.h, 10);
    c.fill();
    c.stroke();
    // The checkered liner peeking over the edge.
    c.fillStyle = '#1c1c1c';
    for (let i = 0; i < 7; i += 2) c.fillRect(bx.x + 10 + (i * (bx.w - 20)) / 7, baseY - 3, (bx.w - 20) / 7, 4);
    if (this.label.name) {
      c.fillStyle = '#1c1c1c';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.font = `900 ${Math.min(20, bx.h * 0.42)}px "Marker Felt", "Comic Sans MS", system-ui, sans-serif`;
      c.fillText(this.label.name, bx.x + bx.w / 2, baseY + bx.h * 0.38, bx.w - 14);
      c.font = `700 ${Math.min(12, bx.h * 0.26)}px system-ui, sans-serif`;
      c.fillStyle = '#5a5244';
      c.fillText(this.label.order, bx.x + bx.w / 2, baseY + bx.h * 0.74, bx.w - 14);
    }
    // The cup: on the table, or lidded and on its way into the box.
    const cup = g.cup;
    const hopping = this.hop >= 0;
    const u = hopping ? this.hop : 0;
    const ox = hopping ? (bx.x + bx.w * 0.3 - cup.x) * u : 0;
    const oy = hopping ? -Math.sin(u * Math.PI) * cup.h * 1.1 - (bx.h * 0.2) * u : 0;
    c.save();
    c.translate(ox, oy);
    const tlx = cup.x - cup.top / 2;
    const trx = cup.x + cup.top / 2;
    const blx = cup.x - cup.base / 2;
    const brx = cup.x + cup.base / 2;
    if (this.sealing > 0 || hopping) {
      // Lidded: what's in it is just sauce now.
      const v = this.sealedFill;
      const half = (cup.base + (cup.top - cup.base) * v) / 2;
      c.fillStyle = sauce;
      c.beginPath();
      c.moveTo(blx, g.tableY);
      c.lineTo(brx, g.tableY);
      c.lineTo(cup.x + half, g.tableY - cup.h * v);
      c.lineTo(cup.x - half, g.tableY - cup.h * v);
      c.closePath();
      c.fill();
    }
    c.strokeStyle = '#f4f6f7';
    c.lineWidth = 3;
    c.lineJoin = 'round';
    c.beginPath();
    c.moveTo(tlx, cup.rim);
    c.lineTo(blx, g.tableY);
    c.lineTo(brx, g.tableY);
    c.lineTo(trx, cup.rim);
    c.stroke();
    if (this.sealing > 0 || hopping) {
      c.fillStyle = '#f4f6f7';
      rr(c, tlx - 5, cup.rim - 7 - this.sealing * 60, cup.top + 10, 8, 4);
      c.fill();
    } else {
      // The line to fill to.
      const ly = g.tableY - cup.h * SAUCE.line;
      const half = (cup.base + (cup.top - cup.base) * SAUCE.line) / 2;
      c.setLineDash([5, 4]);
      c.strokeStyle = '#ffffffdd';
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(cup.x - half - 6, ly);
      c.lineTo(cup.x + half + 6, ly);
      c.stroke();
      c.setLineDash([]);
    }
    c.restore();
    // The sauce: what's in the air and in the ladle is drops; what's in the cup has a level.
    for (const b of this.blobs) {
      c.fillStyle = b.chunk ? dark : sauce;
      c.beginPath();
      c.arc(b.x, b.y, b.r * 1.35, 0, Math.PI * 2);
      c.fill();
    }
    if (this.sealing === 0 && !hopping && this.fill > 0.02) {
      const v = Math.min(1.02, this.fill);
      const half = (cup.base + (cup.top - cup.base) * v) / 2;
      c.fillStyle = sauce;
      c.beginPath();
      c.moveTo(blx + 2, g.tableY - 2);
      c.lineTo(brx - 2, g.tableY - 2);
      c.lineTo(cup.x + half - 2, g.tableY - cup.h * v);
      c.lineTo(cup.x - half + 2, g.tableY - cup.h * v);
      c.closePath();
      c.fill();
      c.fillStyle = dark;
      for (const b of this.blobs) {
        if (!b.chunk || !b.cup) continue;
        c.beginPath();
        c.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        c.fill();
      }
    }
    // The ladle: handle up and back, the bowl turned by the tilt.
    c.save();
    c.translate(this.lx, this.ly);
    c.rotate(this.tilt);
    c.strokeStyle = '#6b7780';
    c.lineWidth = 7;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(-g.R * 0.95, -g.R * 0.25);
    c.lineTo(-g.R * 1.5, -g.R * 2.6);
    c.stroke();
    c.lineWidth = 5;
    c.strokeStyle = '#8a959d';
    c.beginPath();
    c.arc(0, 0, g.R, -Math.PI / 2 + SAUCE.ladle.mouth, Math.PI * 1.5 - SAUCE.ladle.mouth);
    c.stroke();
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
