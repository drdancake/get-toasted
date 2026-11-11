import { SAUCE } from '../config/shift';
import { SAUCE_COLORS } from '../render/models';
import { haptic, sfx } from '../ui/feel';
import { type Kitchen, lidOrder, type Sauce } from './kitchen';

// The ladle, the way it's really done. You're looking at it the way the cook does: the pan of sauce
// at the back, the cup toward you. The ladle is a long straight handle held at the top, with the
// bowl hanging below your hand, so your hand is never in the way of it. Like a claw machine: move
// your hand and the bowl goes where its shadow is.
//
//   Over the pan, it dips and fills. One full bowl is one cup.
//   Bring it to the cup and it settles at the cup's far edge.
//   Push away from you: the bowl swings over and the sauce runs over its lip into the cup.
//   Pull back toward you to stop, right on the line.
//
// The other hand holds the cup: drag it closer to the pan and the ladle has less far to travel.
// Rush a full ladle and it slops. Ranch is thin and quick; marinara is thick, slow to start and
// slow to stop.

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement) => {
  const e = document.createElement(tag);
  e.className = cls;
  parent?.appendChild(e);
  return e;
};

interface Drip {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  /** Where on the table it lands. */
  floor: number;
}

const NAMES: Record<string, string> = { marinara: 'MARINARA', ranch: 'RANCH' };

export class LadleView {
  private root: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private title: HTMLElement;
  private count: HTMLElement;
  private tally: HTMLElement;
  private hint: HTMLElement;
  private sauce: Sauce = 'marinara';
  private open = false;
  private w = 1;
  private h = 1;
  /** Your hand, at the top of the handle (it can go off the top of the view, reaching to the back). */
  private hand = { x: 0, y: 0 };
  /** The bowl: it hangs under the hand and follows a touch behind. */
  private bowl = { x: 0, y: 0, vx: 0, vy: 0 };
  /** How much is in the bowl (1 is a cup), how far it's dipped, and how far it's swung over. */
  private load = 0;
  private dip = 0;
  private tilt = 0;
  /** Settled at the cup: where the hand was when it did, so pushing away from there tips it. */
  private latch: { x: number; y: number } | null = null;
  /** How fast it's actually running (cups per second): thick sauce lags the tilt. */
  private rate = 0;
  private cup = { x: 0, y: 0 };
  private fill = 0;
  private lastPour = -9;
  private sealing = 0;
  private hop = -1;
  private sealedFill = 0;
  private drips: Drip[] = [];
  private stains: { x: number; y: number; r: number }[] = [];
  private spilled = 0;
  private charged = 0;
  private tallyCents = 0;
  private made = 0;
  private t = 0;
  private last = 0;
  private ladleId: number | null = null;
  private cupId: number | null = null;
  private grab = { x: 0, y: 0 };
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
    window.addEventListener('resize', () => this.open && this.size());
  }

  /** The pan at the back, the table toward you: layout in canvas pixels. */
  get geo() {
    const { w, h } = this;
    const L = SAUCE.ladle;
    const rx = Math.min(w * 0.125, h * 0.13);
    const pan = { farY: h * 0.07, nearY: h * 0.32, farL: w * 0.2, farR: w * 0.8, nearL: w * 0.07, nearR: w * 0.93, wall: h * 0.045 };
    return {
      pan,
      /** The cup, seen from a little above: its rim is an ellipse, its base a smaller one below. */
      cupRx: rx,
      cupRy: rx * 0.42,
      cupH: rx * 1.7,
      bowlR: rx * 0.95,
      /** From the hand down to the bowl, and a little to the left (the handle's in your right hand). */
      reach: { x: -w * 0.05, y: h * L.handle },
      box: { x: w * 0.6, y: h * 0.7, w: w * 0.37, h: h * 0.2 },
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
    this.hand = { x: this.w * 0.66, y: this.h * 0.12 };
    this.bowl = { x: this.hand.x + g.reach.x, y: this.hand.y + g.reach.y, vx: 0, vy: 0 };
    this.cup = { x: this.w * 0.3, y: this.h * 0.57 };
    this.load = 0;
    this.dip = 0;
    this.tilt = 0;
    this.latch = null;
    this.rate = 0;
    this.fill = 0;
    this.sealing = 0;
    this.hop = -1;
    this.drips = [];
    this.stains = [];
    this.spilled = 0;
    this.charged = 0;
    this.tallyCents = 0;
    this.tally.classList.remove('on');
    this.made = 0;
    this.ladleId = this.cupId = null;
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
  // The ladle moves with your thumb from wherever the thumb is (so it's never under it). A touch on
  // the cup is your other hand: the cup goes where you drag it.

  private down(e: PointerEvent) {
    e.preventDefault();
    const p = this.pt(e);
    const g = this.geo;
    const onCup = Math.hypot(p.x - this.cup.x, p.y - (this.cup.y + g.cupH * 0.5)) < g.cupRx * 1.5;
    if (onCup && this.cupId === null && this.sealing === 0 && this.hop < 0) {
      this.cupId = e.pointerId;
      this.grab = { x: this.cup.x - p.x, y: this.cup.y - p.y };
    } else if (this.ladleId === null) {
      this.ladleId = e.pointerId;
      this.grab = this.cupId === null ? { x: p.x, y: p.y } : this.grab;
      this.lastTouch = { x: p.x, y: p.y };
    } else return;
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* not a live pointer (synthetic): fine */
    }
  }
  private lastTouch = { x: 0, y: 0 };

  private move(e: PointerEvent) {
    const p = this.pt(e);
    const g = this.geo;
    if (e.pointerId === this.ladleId) {
      const k = SAUCE.ladle.gain;
      this.hand.x = Math.max(g.bowlR - g.reach.x, Math.min(this.w - 8, this.hand.x + (p.x - this.lastTouch.x) * k));
      this.hand.y = Math.max(g.pan.farY + 8 - g.reach.y, Math.min(this.h * 0.96 - g.reach.y, this.hand.y + (p.y - this.lastTouch.y) * k));
      this.lastTouch = { x: p.x, y: p.y };
    } else if (e.pointerId === this.cupId) {
      this.cup.x = Math.max(g.cupRx + 6, Math.min(this.w * 0.56, p.x + this.grab.x));
      this.cup.y = Math.max(g.pan.nearY + g.pan.wall + g.cupRy + 10, Math.min(this.h * 0.95 - g.cupH, p.y + this.grab.y));
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

  private get feel() {
    return SAUCE.ladle.feel[this.sauce as 'marinara' | 'ranch'] ?? SAUCE.ladle.feel.marinara;
  }

  private inPan(x: number, y: number) {
    const p = this.geo.pan;
    if (y < p.farY + 4 || y > p.nearY - 2) return false;
    const u = (y - p.farY) / (p.nearY - p.farY);
    return x > p.farL + (p.nearL - p.farL) * u + 6 && x < p.farR + (p.nearR - p.farR) * u - 6;
  }

  /** Where the bowl sits when it's at the cup: just past the cup's far edge, a little above it. */
  private get perch() {
    const g = this.geo;
    return { x: this.cup.x + g.cupRx * 0.1, y: this.cup.y - g.cupRy - g.bowlR * 0.95 };
  }

  /** Advance by dt seconds (public so tests can drive it). */
  step(dt: number) {
    const g = this.geo;
    const L = SAUCE.ladle;
    const F = this.feel;
    this.t += dt;
    const busy = this.sealing > 0 || this.hop >= 0;
    // Where the bowl would hang, straight down from the hand.
    const hx = this.hand.x + g.reach.x;
    const hy = this.hand.y + g.reach.y;
    // At the cup with something in it: it settles there. Pushing the hand away from here tips it.
    if (!this.latch && !busy && this.load > 0.02 && Math.hypot(hx - this.cup.x, hy - (this.cup.y - g.cupRy * 0.5)) < g.cupRx * L.catch) {
      this.latch = { x: this.hand.x, y: this.hand.y };
      haptic(6);
    }
    if (this.latch) {
      // The push is measured from the nearest to you the hand has been since it settled, so it
      // doesn't matter exactly where you arrived: away from there tips it, back to there stops it.
      this.latch.y = Math.max(this.latch.y, this.hand.y);
      const away = this.latch.y - this.hand.y;
      this.tilt = Math.max(0, Math.min(1, away / (this.h * L.tiltTravel)));
      // Slid off to the side, or pulled well back toward you past the cup: it's off the cup.
      if (Math.abs(hx - this.cup.x) > g.cupRx * 2 || hy - this.cup.y > g.cupRx * 1.8 || busy) {
        this.latch = null;
        this.tilt = 0;
      }
    } else this.tilt = 0;
    // The bowl follows: to its perch at the cup, or to under the hand.
    const to = this.latch ? this.perch : { x: hx, y: hy };
    const k = 1 - Math.exp(-L.follow * dt);
    const ox = this.bowl.x;
    const oy = this.bowl.y;
    this.bowl.x += (to.x - this.bowl.x) * k;
    this.bowl.y += (to.y - this.bowl.y) * k;
    this.bowl.vx = (this.bowl.x - ox) / Math.max(dt, 1e-3);
    this.bowl.vy = (this.bowl.y - oy) / Math.max(dt, 1e-3);
    // Over the pan: down it goes, and it fills.
    const over = !this.latch && this.inPan(this.bowl.x, this.bowl.y);
    this.dip += ((over ? 1 : 0) - this.dip) * (1 - Math.exp(-dt / 0.07));
    if (over && this.dip > 0.6 && !busy) {
      const was = this.load;
      this.load = Math.min(1, this.load + dt / L.dipTime);
      if (was < 1 && this.load >= 1) haptic(8);
    }
    // Rushing a full ladle slops it.
    const speed = Math.hypot(this.bowl.vx, this.bowl.vy) / this.w;
    if (!over && !this.latch && this.load > L.slopAbove && speed > L.slopSpeed) {
      const lost = Math.min(this.load - L.slopAbove, L.slopRate * dt * (speed / L.slopSpeed));
      this.load -= lost;
      this.spill(lost, this.bowl.x, this.bowl.y, this.bowl.y + g.bowlR * 1.6);
    }
    // The pour: over the lip, toward you. Thick sauce takes a moment to get going and to stop.
    const want = this.latch && this.load > 0 ? Math.pow(this.tilt, 1.4) * F.flow : 0;
    this.rate += (want - this.rate) * (1 - Math.exp(-dt / F.lag));
    if (this.rate < 0.01 && want === 0) this.rate = 0;
    if (this.rate > 0 && this.load > 0 && !busy) {
      // Marinara comes in glugs.
      const glug = 1 + F.glug * Math.sin(this.t * 17);
      const amt = Math.min(this.load, this.rate * glug * dt);
      this.load -= amt;
      this.fill += amt;
      this.lastPour = this.t;
      if (Math.random() < dt * 14) sfx.rim();
      // Over the top: it runs down the side and onto the tally. The cup is still a (full) cup.
      if (this.fill > SAUCE.overflow) {
        const over2 = this.fill - SAUCE.overflow;
        this.fill = SAUCE.overflow;
        this.spill(over2, this.cup.x + g.cupRx * (Math.random() < 0.5 ? -0.9 : 0.9), this.cup.y, this.cup.y + g.cupH + g.cupRy * 0.6);
      }
    }
    if (this.load <= 0.001) this.load = 0;
    this.drops(dt);
    // Stopped, with it filled: the lid goes on and the cup goes in its box.
    if (!busy && this.fill >= SAUCE.okMin && this.rate < 0.03 && this.tilt < 0.12 && this.t - this.lastPour > L.rest) {
      this.sealing = 0.3;
      this.sealedFill = this.fill;
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
        this.k.ladledCup(this.sauce, this.sealedFill);
      }
    }
    this.hint.textContent = this.latch
      ? this.tilt > 0.05
        ? 'pull back to stop on the line'
        : 'push away to pour'
      : this.load > 0.5
        ? 'bring it to the cup'
        : 'dip the ladle in the pan';
    this.count.textContent = this.made ? `+${this.made}` : '';
  }

  /** Sauce that isn't going in the cup: it falls, it lands, and it's on the tab. */
  private spill(cups: number, x: number, y: number, floor: number) {
    this.spilled += cups;
    const n = Math.max(1, Math.round(cups * 40));
    for (let i = 0; i < Math.min(6, n); i++) this.drips.push({ x: x + (Math.random() - 0.5) * 10, y, vx: (Math.random() - 0.5) * 40, vy: -20 - Math.random() * 30, r: 2.5 + Math.random() * 2.5, floor: floor + Math.random() * 10 });
    const owed = Math.floor(this.spilled * SAUCE.spillCents) - this.charged;
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

  private drops(dt: number) {
    const keep: Drip[] = [];
    for (const d of this.drips) {
      d.vy += this.h * 3 * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      if (d.y >= d.floor) {
        if (this.stains.length < 50) this.stains.push({ x: d.x, y: d.floor, r: d.r * 1.6 });
        continue;
      }
      keep.push(d);
    }
    this.drips = keep;
  }

  // ---------- Drawing ----------

  private draw() {
    const c = this.ctx;
    const g = this.geo;
    const { w, h } = this;
    const sauce = SAUCE_COLORS[this.sauce] ?? '#c8341d';
    const dark = this.sauce === 'marinara' ? '#8f2413' : '#d9d3bf';
    c.clearRect(0, 0, w, h);
    // The steel table, going away from you.
    const steel = c.createLinearGradient(0, 0, 0, h);
    steel.addColorStop(0, '#8e979d');
    steel.addColorStop(0.35, '#b3bbc0');
    steel.addColorStop(1, '#c8ced2');
    c.fillStyle = steel;
    c.fillRect(0, 0, w, h);
    // The pan, set into the table at the back: you look down into it.
    const p = g.pan;
    c.fillStyle = '#e3e7ea';
    c.beginPath();
    c.moveTo(p.farL - 8, p.farY - 6);
    c.lineTo(p.farR + 8, p.farY - 6);
    c.lineTo(p.nearR + 10, p.nearY + 6);
    c.lineTo(p.nearL - 10, p.nearY + 6);
    c.closePath();
    c.fill();
    c.strokeStyle = '#7e878d';
    c.lineWidth = 2;
    c.stroke();
    c.fillStyle = sauce;
    c.beginPath();
    c.moveTo(p.farL, p.farY);
    c.lineTo(p.farR, p.farY);
    c.lineTo(p.nearR, p.nearY);
    c.lineTo(p.nearL, p.nearY);
    c.closePath();
    c.fill();
    // The far wall of the pan throws a shadow on the sauce.
    const shade = c.createLinearGradient(0, p.farY, 0, p.farY + (p.nearY - p.farY) * 0.4);
    shade.addColorStop(0, '#00000040');
    shade.addColorStop(1, '#00000000');
    c.fillStyle = shade;
    c.fill();
    if (this.sauce === 'marinara') {
      c.fillStyle = dark;
      for (let i = 0; i < 9; i++) {
        const u = 0.2 + 0.6 * ((i * 0.37) % 1);
        const v = 0.15 + 0.7 * ((i * 0.61) % 1);
        const y = p.farY + (p.nearY - p.farY) * v;
        const l = p.farL + (p.nearL - p.farL) * v;
        const r = p.farR + (p.nearR - p.farR) * v;
        c.beginPath();
        c.ellipse(l + (r - l) * u, y, 3 + v * 3, 2 + v * 1.5, 0, 0, Math.PI * 2);
        c.fill();
      }
      c.strokeStyle = '#ffffff55';
      c.lineWidth = 3;
      c.lineCap = 'round';
      for (let i = 0; i < 4; i++) {
        const x = w * (0.28 + i * 0.15);
        const ph = this.t * 1.4 + i;
        c.beginPath();
        c.moveTo(x, p.farY + 4);
        c.quadraticCurveTo(x + Math.sin(ph) * 8, p.farY - 8, x + Math.sin(ph + 1) * 5, p.farY - 18);
        c.stroke();
      }
    }
    // Stains.
    c.fillStyle = sauce;
    for (const s of this.stains) {
      c.beginPath();
      c.ellipse(s.x, s.y, s.r * 1.3, s.r * 0.55, 0, 0, Math.PI * 2);
      c.fill();
    }
    this.drawBox(c);
    const hopping = this.hop >= 0;
    const atCup = !!this.latch;
    // At the cup the bowl is behind it; anywhere else it's above everything.
    if (atCup) this.drawLadle(c, sauce, dark);
    this.drawCup(c, sauce, dark, hopping);
    if (!atCup) this.drawLadle(c, sauce, dark);
    c.fillStyle = sauce;
    for (const d of this.drips) {
      c.beginPath();
      c.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      c.fill();
    }
  }

  /** The box this cup is for, toward you on the right: open, its name on the lid. */
  private drawBox(c: CanvasRenderingContext2D) {
    const b = this.geo.box;
    c.fillStyle = '#efe8d8';
    c.strokeStyle = '#cfc4ac';
    c.lineWidth = 2;
    // Lid, standing open behind the tray.
    c.beginPath();
    c.moveTo(b.x + 8, b.y);
    c.lineTo(b.x + b.w - 8, b.y);
    c.lineTo(b.x + b.w - 16, b.y - b.h * 0.62);
    c.lineTo(b.x + 16, b.y - b.h * 0.62);
    c.closePath();
    c.fill();
    c.stroke();
    if (this.label.name) {
      c.fillStyle = '#1c1c1c';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.font = `900 ${Math.min(19, b.h * 0.26)}px "Marker Felt", "Comic Sans MS", system-ui, sans-serif`;
      c.fillText(this.label.name, b.x + b.w / 2, b.y - b.h * 0.4, b.w - 40);
      c.font = `700 ${Math.min(11, b.h * 0.15)}px system-ui, sans-serif`;
      c.fillStyle = '#5a5244';
      c.fillText(this.label.order, b.x + b.w / 2, b.y - b.h * 0.16, b.w - 40);
    }
    // The tray, with its checkered liner.
    c.fillStyle = '#efe8d8';
    rr(c, b.x, b.y, b.w, b.h, 10);
    c.fill();
    c.stroke();
    c.save();
    rr(c, b.x + 8, b.y + 7, b.w - 16, b.h - 16, 6);
    c.clip();
    c.fillStyle = '#fbfaf5';
    c.fillRect(b.x, b.y, b.w, b.h);
    c.fillStyle = '#1c1c1c';
    const s = (b.w - 16) / 8;
    for (let i = 0; i < 8; i++) for (let j = 0; j < 4; j++) if ((i + j) % 2 === 0) c.fillRect(b.x + 8 + i * s, b.y + 7 + j * s * 0.7, s, s * 0.7);
    c.restore();
  }

  private drawCup(c: CanvasRenderingContext2D, sauce: string, dark: string, hopping: boolean) {
    const g = this.geo;
    const b = g.box;
    const u = hopping ? this.hop : 0;
    const cx = this.cup.x + (hopping ? (b.x + b.w * 0.26 - this.cup.x) * u : 0);
    const cy = this.cup.y + (hopping ? (b.y + b.h * 0.25 - g.cupH - this.cup.y) * u - Math.sin(u * Math.PI) * g.cupH * 0.8 : 0);
    const rx = g.cupRx;
    const ry = g.cupRy;
    const brx = rx * 0.74;
    const bry = ry * 0.74;
    const by = cy + g.cupH;
    const lidded = this.sealing > 0 || hopping;
    const v = Math.min(1, lidded ? this.sealedFill : this.fill);
    // Shadow on the table.
    c.fillStyle = '#00000022';
    c.beginPath();
    c.ellipse(cx + 4, by + 3, brx * 1.15, bry * 1.2, 0, 0, Math.PI * 2);
    c.fill();
    // The sauce in it: a body up to the level, and the surface on top.
    if (v > 0.01) {
      const lrx = brx + (rx - brx) * v;
      const lry = bry + (ry - bry) * v;
      const ly = by - g.cupH * v;
      c.fillStyle = sauce;
      c.beginPath();
      c.moveTo(cx - lrx, ly);
      c.lineTo(cx - brx, by);
      c.ellipse(cx, by, brx, bry, 0, Math.PI, 0, true);
      c.lineTo(cx + lrx, ly);
      c.closePath();
      c.fill();
      c.fillStyle = shadeOf(sauce, 1.08);
      c.beginPath();
      c.ellipse(cx, ly, lrx, lry, 0, 0, Math.PI * 2);
      c.fill();
      if (this.sauce === 'marinara') {
        c.fillStyle = dark;
        for (let i = 0; i < 4; i++) {
          c.beginPath();
          c.ellipse(cx + lrx * 0.55 * Math.cos(i * 1.9 + 0.4), ly + lry * 0.5 * Math.sin(i * 1.9 + 0.4), 3.5, 2, 0, 0, Math.PI * 2);
          c.fill();
        }
      }
    }
    // The line to stop on: it lights up when you're on it.
    if (!lidded) {
      const lv = SAUCE.line;
      const on = this.fill >= SAUCE.perfect[0] && this.fill <= SAUCE.perfect[1];
      c.setLineDash(on ? [] : [5, 4]);
      c.strokeStyle = on ? '#3fae5a' : '#ffffffee';
      c.lineWidth = on ? 3.5 : 2;
      c.beginPath();
      c.ellipse(cx, by - g.cupH * lv, brx + (rx - brx) * lv + 1, bry + (ry - bry) * lv, 0, 0.12, Math.PI - 0.12);
      c.stroke();
      c.setLineDash([]);
    }
    // The clear cup itself.
    c.strokeStyle = '#f7f9fa';
    c.lineWidth = 2.5;
    c.beginPath();
    c.moveTo(cx - rx, cy);
    c.lineTo(cx - brx, by);
    c.ellipse(cx, by, brx, bry, 0, Math.PI, 0, true);
    c.lineTo(cx + rx, cy);
    c.stroke();
    c.beginPath();
    c.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    c.stroke();
    if (lidded) {
      c.fillStyle = '#f7f9facc';
      c.beginPath();
      c.ellipse(cx, cy - 2 - this.sealing * 50, rx + 3, ry + 2, 0, 0, Math.PI * 2);
      c.fill();
      c.stroke();
    }
  }

  /** The ladle: your hand at the top of a long straight handle, the bowl hanging below it. */
  private drawLadle(c: CanvasRenderingContext2D, sauce: string, dark: string) {
    const g = this.geo;
    const R = g.bowlR;
    const t = this.tilt;
    const bx = this.bowl.x;
    // Dipped, it sits down in the sauce.
    const by = this.bowl.y + this.dip * R * 0.35;
    // The bowl's shadow, straight down on whatever's under it: that's where it is.
    if (!this.latch) {
      c.fillStyle = '#00000026';
      c.beginPath();
      c.ellipse(bx + 3, by + R * (1.5 - this.dip * 1.1), R * 0.8, R * 0.3, 0, 0, Math.PI * 2);
      c.fill();
    }
    // The stream, over the near lip and down into the cup.
    if (this.rate > 0.02 && this.latch) {
      const lipY = by + R * (0.42 + 0.4 * t) - 2;
      const level = this.cup.y + g.cupH * (1 - Math.min(1, this.fill));
      const wide = 3 + Math.min(1, this.rate / this.feel.flow) * (this.sauce === 'marinara' ? 11 : 7);
      c.strokeStyle = sauce;
      c.lineCap = 'round';
      c.lineWidth = wide * (1 + this.feel.glug * 0.5 * Math.sin(this.t * 17));
      c.beginPath();
      c.moveTo(bx - R * 0.1, lipY);
      c.quadraticCurveTo(bx - R * 0.14, lipY + (level - lipY) * 0.4, this.cup.x, level);
      c.stroke();
      if (this.sauce === 'marinara') {
        c.fillStyle = dark;
        const k = (this.t * 2.2) % 1;
        c.beginPath();
        c.arc(bx - R * 0.12 + (this.cup.x - bx + R * 0.12) * k * k, lipY + (level - lipY) * k, 3.2, 0, Math.PI * 2);
        c.fill();
      }
    }
    // The handle: from the far side of the bowl straight up to your hand.
    const hx = this.hand.x;
    const hy = this.hand.y;
    // (It meets the bowl at its far rim.)
    const jx = bx + R * 0.3;
    const jy = by - R * (0.42 + 0.4 * t) * 0.92;
    c.lineCap = 'round';
    c.strokeStyle = '#5f6a72';
    c.lineWidth = 8;
    c.beginPath();
    c.moveTo(jx, jy);
    c.lineTo(hx, hy);
    c.stroke();
    c.strokeStyle = '#c9d0d5';
    c.lineWidth = 4;
    c.stroke();
    // The bowl: seen from above and in front. Swung over, its mouth turns down toward you.
    // (Its underside swings away from you, so you see more of the mouth and less of the belly.)
    const ry = R * (0.42 + 0.4 * t);
    const belly = 1 - t;
    c.fillStyle = '#9aa3a9';
    c.beginPath();
    c.ellipse(bx, by, R, ry, 0, 0, Math.PI, false);
    c.quadraticCurveTo(bx - R * 0.9, by + ry + R * 0.45 * belly, bx, by + ry + R * 0.5 * belly);
    c.quadraticCurveTo(bx + R * 0.9, by + ry + R * 0.45 * belly, bx + R, by);
    c.closePath();
    c.fill();
    c.fillStyle = '#d5dadf';
    c.beginPath();
    c.ellipse(bx, by, R, ry, 0, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = '#6b7780';
    c.lineWidth = 2;
    c.stroke();
    if (this.load > 0.02) {
      // What's in it: it runs to the near lip as the bowl swings over.
      const s = 0.45 + 0.5 * this.load;
      c.fillStyle = sauce;
      c.beginPath();
      c.ellipse(bx, by + ry * (0.05 + 0.5 * t * (1 - s * 0.6)), R * 0.9 * s, ry * 0.86 * s * (1 - 0.35 * t), 0, 0, Math.PI * 2);
      c.fill();
      if (this.sauce === 'marinara') {
        c.fillStyle = dark;
        c.beginPath();
        c.ellipse(bx - R * 0.25 * s, by + ry * 0.1, 3.5, 2, 0, 0, Math.PI * 2);
        c.ellipse(bx + R * 0.3 * s, by + ry * 0.3 * s, 3, 1.8, 0, 0, Math.PI * 2);
        c.fill();
      }
    }
    // Your hand, closed round the top of the handle.
    c.fillStyle = '#23262a';
    rr(c, hx - 15, hy - 14, 30, 36, 11);
    c.fill();
    c.strokeStyle = '#3a3f45';
    c.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      c.beginPath();
      c.moveTo(hx - 12, hy - 4 + i * 9);
      c.lineTo(hx + 12, hy - 4 + i * 9);
      c.stroke();
    }
  }
}

/** A color a little lighter or darker. */
function shadeOf(hex: string, k: number) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${f((n >> 16) & 255)}, ${f((n >> 8) & 255)}, ${f(n & 255)})`;
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
