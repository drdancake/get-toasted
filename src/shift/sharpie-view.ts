import { haptic, sfx } from '../ui/feel';
import { type Hand, hand, handWidth, writeHand } from '../ui/hand';
import { stamp } from '../ui/stamp';
import { LID_INK } from './lid-ink';
import { type Box, boxSizeFor, type Kitchen, lidOrder, type Order, type OrderItem } from './kitchen';

// The Sharpie: the box's lid comes up close, the guest's name is there faintly, and you trace it
// with your finger. It's judged on how much of the name you covered and how much ink went astray:
// CLEAN for neat, fine for readable, and a scrawl nobody can read gets you a "WHO IS…?".

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement) => {
  const e = document.createElement(tag);
  e.className = cls;
  parent?.appendChild(e);
  return e;
};

/** Tuning: brush width and how close counts as "on the letters", as fractions of the name's height. */
const TRACE = {
  brush: 0.1,
  near: 0.16,
  /** The line you're scored on covering, as a fraction of the name's height. */
  line: 0.07,
  /** Covered this much of the name: readable. And this much, with little stray ink: CLEAN. */
  readable: 0.5,
  clean: 0.78,
  /** Most stray ink (fraction of your ink off the letters) that still counts as clean / readable. */
  cleanStray: 0.18,
  readableStray: 0.42,
  /** Stop writing this long and it's judged. */
  settle: 0.9,
};

/** Mask resolution (px across) for scoring. */
const MASK_W = 160;

export class SharpieView {
  private root: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private guideMask: Uint8Array = new Uint8Array(0);
  private nearMask: Uint8Array = new Uint8Array(0);
  private ink: HTMLCanvasElement = document.createElement('canvas');
  private cover: HTMLCanvasElement = document.createElement('canvas');
  private hint: HTMLElement;
  private who: HTMLElement;
  private box: Box | null = null;
  private target: { order: Order; item: OrderItem } | null = null;
  private choices: { order: Order; item: OrderItem }[] = [];
  private w = 1;
  private h = 1;
  private nameBox = { x: 0, y: 0, w: 0, h: 0, size: 60 };
  private guide: Hand | null = null;
  private last: { x: number; y: number } | null = null;
  private pointer = -1;
  private inked = false;
  private timer = 0;
  private open = false;
  /** Called when the lid is done (labeled or not). */
  onClose: (() => void) | null = null;

  constructor(parent: HTMLElement, private k: Kitchen) {
    this.root = el('div', 'sharpie', parent);
    this.root.hidden = true;
    this.who = el('div', 'sharpie-who', this.root);
    this.canvas = el('canvas', 'sharpie-lid', this.root);
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d canvas');
    this.ctx = ctx;
    this.hint = el('div', 'sharpie-hint', this.root);
    const cap = el('div', 'sharpie-marker', this.root);
    // A classic fine-point Sharpie, uncapped to write: the bullet tip, the black collar, the light
    // gray barrel with the logo, the black end plug, and its black cap lying beside it.
    cap.innerHTML = '<u></u><i></i><b><em>Sharpie</em><small>FINE POINT · PERMANENT MARKER</small></b><s></s><span class="sharpie-cap"></span>';
    this.canvas.addEventListener('pointerdown', (e) => this.down(e));
    this.canvas.addEventListener('pointermove', (e) => this.move(e));
    this.canvas.addEventListener('pointerup', (e) => this.up(e));
    this.canvas.addEventListener('pointercancel', (e) => this.up(e));
    // Tap the name tag to switch to another order; tap off the lid to skip labeling.
    this.who.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.cycle();
    });
    this.root.addEventListener('pointerdown', (e) => {
      if (e.target === this.root) this.close();
    });
  }

  isOpen() {
    return this.open;
  }

  /** Bring the lid of a box up to Sharpie it, for the next order that needs a box (its size first). */
  show(box: Box) {
    const items = this.k.unboxedItems();
    if (!items.length) return;
    this.box = box;
    // The ticket waiting longest that fits this box, then anything.
    this.choices = [...items].sort((a, b) => Number(boxSizeFor(b.item) === box.size) - Number(boxSizeFor(a.item) === box.size) || a.order.bornAt - b.order.bornAt);
    this.target = this.choices[0] ?? null;
    this.open = true;
    this.root.hidden = false;
    document.body.classList.add('box-focusing');
    this.layout();
    sfx.pull();
  }

  private cycle() {
    if (this.choices.length < 2 || !this.target) return;
    const i = this.choices.indexOf(this.target);
    this.target = this.choices[(i + 1) % this.choices.length] ?? null;
    this.layout();
    haptic(5);
  }

  private close() {
    this.open = false;
    this.root.hidden = true;
    document.body.classList.remove('box-focusing');
    window.clearTimeout(this.timer);
    this.pointer = -1;
    this.onClose?.();
  }

  /** Draw the lid with the name faint on it (and the order already written top right), and build the masks. */
  private layout() {
    const t = this.target;
    if (!t) return;
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = Math.max(1, Math.round(r.width));
    this.h = Math.max(1, Math.round(r.height));
    for (const c of [this.canvas, this.ink, this.cover]) {
      c.width = Math.round(this.w * dpr);
      c.height = Math.round(this.h * dpr);
      c.getContext('2d')?.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    const name = (t.order.name ?? 'GUEST').toUpperCase();
    this.who.innerHTML = `<b>${name}</b><span>${this.choices.length > 1 ? 'tap to switch order' : ''}</span>`;
    // The name, as big as fits the left three quarters of the lid, written in single strokes.
    let size = Math.min(this.h * 0.26, 110);
    while (handWidth(name, size) > this.w * 0.76 && size > 20) size -= 3;
    const tw = handWidth(name, size);
    this.nameBox = { x: (this.w - tw) / 2, y: this.h * 0.56 + size / 2, w: tw, h: size, size };
    this.guide = hand(name, this.nameBox.x, this.nameBox.y, size);
    // Masks at low resolution: the pen line itself, and where's close enough to it.
    const mw = MASK_W;
    const mh = Math.round((mw * this.h) / this.w);
    const m = document.createElement('canvas');
    m.width = mw;
    m.height = mh;
    const mc = m.getContext('2d');
    if (!mc) return;
    mc.scale(mw / this.w, mw / this.w);
    mc.strokeStyle = '#000';
    mc.lineCap = 'round';
    mc.lineJoin = 'round';
    mc.lineWidth = size * TRACE.line;
    mc.stroke(this.guide.path);
    this.guideMask = alpha(mc.getImageData(0, 0, mw, mh).data);
    mc.clearRect(0, 0, this.w, this.h);
    mc.lineWidth = size * TRACE.near * 2;
    mc.stroke(this.guide.path);
    this.nearMask = alpha(mc.getImageData(0, 0, mw, mh).data);
    this.inked = false;
    this.last = null;
    this.draw();
    this.hint.textContent = 'TRACE THE NAME';
    this.hint.className = 'sharpie-hint pulse';
  }

  /** The lid: foam, the faint name to trace, the order written top right, then your ink. */
  private draw() {
    const ctx = this.ctx;
    const { w, h } = this;
    const t = this.target;
    ctx.clearRect(0, 0, w, h);
    // The top of the closed clamshell: foam rim, hinge along the back, the raised dome you write
    // on, and the latch tab at the front.
    const rimB = h - 30;
    ctx.fillStyle = '#efe8d8';
    roundRect(ctx, 6, 6, w - 12, rimB - 6, 30);
    ctx.fill();
    ctx.strokeStyle = '#d3c8b1';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.strokeStyle = '#dcd2bd';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(44, 15);
    ctx.lineTo(w - 44, 15);
    ctx.stroke();
    // Latch tab.
    ctx.fillStyle = '#efe8d8';
    roundRect(ctx, w / 2 - 48, rimB - 8, 96, 34, 12);
    ctx.fill();
    ctx.strokeStyle = '#d3c8b1';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#ddd3bf';
    roundRect(ctx, w / 2 - 24, rimB + 8, 48, 8, 4);
    ctx.fill();
    // Small boxes have stepped ridges round the dome.
    if (this.box?.size === 'S') {
      ctx.strokeStyle = '#ddd3bf';
      ctx.lineWidth = 2;
      roundRect(ctx, 15, 15, w - 30, rimB - 24, 26);
      ctx.stroke();
    }
    // The dome: raised, so it catches light and casts a little shadow on the rim.
    const { x: dx, y: dy, w: dw, h: dh } = this.dome();
    ctx.save();
    ctx.shadowColor = 'rgba(80,60,30,0.28)';
    ctx.shadowBlur = 14;
    ctx.shadowOffsetY = 5;
    const g = ctx.createRadialGradient(w * 0.42, dy + dh * 0.35, 10, w / 2, dy + dh / 2, Math.max(dw, dh) * 0.7);
    g.addColorStop(0, '#fffefa');
    g.addColorStop(0.7, '#faf6ec');
    g.addColorStop(1, '#ebe3d1');
    ctx.fillStyle = g;
    roundRect(ctx, dx, dy, dw, dh, 24);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    roundRect(ctx, dx + 1, dy + 1, dw - 2, dh - 2, 23);
    ctx.stroke();
    if (!t) return;
    const nb = this.nameBox;
    const gd = this.guide;
    if (gd) {
      // A soft lane to stay in, the dotted pen line, and a dot where each stroke starts.
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#ebe3d1';
      ctx.lineWidth = nb.size * TRACE.near * 1.5;
      ctx.stroke(gd.path);
      ctx.setLineDash([2, 7]);
      ctx.strokeStyle = '#a99d86';
      ctx.lineWidth = Math.max(2, nb.size * 0.035);
      ctx.stroke(gd.path);
      ctx.setLineDash([]);
      ctx.fillStyle = '#3fae5a';
      for (const p of gd.starts) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(3, nb.size * 0.045), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    // The order, already on there top right, in the same hand.
    const os = Math.min(24, nb.size * 0.3);
    lidOrder(t.item)
      .toUpperCase()
      .split('\n')
      .forEach((line, i) => writeHand(ctx, line, w - 38, 46 + os + i * os * 1.5, os, { align: 'right', width: Math.max(2.5, os * 0.14) }));
    ctx.drawImage(this.ink, 0, 0, w, h);
  }

  /** The raised panel of the lid, where the writing goes (CSS px). */
  private dome() {
    const x = 24;
    const y = 26;
    return { x, y, w: this.w - x * 2, h: this.h - 30 - y - 18 };
  }

  /** What's written on the dome (order and your strokes), cut out for the lid's outside. */
  private keepInk(box: Box, item: OrderItem) {
    const d = this.dome();
    const W = 512;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = Math.round((W * d.h) / d.w);
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const s = W / d.w;
    ctx.scale(s, s);
    ctx.translate(-d.x, -d.y);
    const os = Math.min(24, this.nameBox.size * 0.3);
    lidOrder(item)
      .toUpperCase()
      .split('\n')
      .forEach((line, i) => writeHand(ctx, line, this.w - 38, 46 + os + i * os * 1.5, os, { align: 'right', width: Math.max(2.5, os * 0.14) }));
    ctx.drawImage(this.ink, 0, 0, this.w, this.h);
    LID_INK.set(box.id, c);
  }

  private pt(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private down(e: PointerEvent) {
    e.preventDefault();
    if (this.pointer !== -1) return;
    this.pointer = e.pointerId;
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic */
    }
    this.last = this.pt(e);
    this.stroke(this.last, this.last);
    window.clearTimeout(this.timer);
  }

  private move(e: PointerEvent) {
    if (e.pointerId !== this.pointer || !this.last) return;
    const p = this.pt(e);
    this.stroke(this.last, p);
    this.last = p;
  }

  private up(e: PointerEvent) {
    if (e.pointerId !== this.pointer) return;
    this.pointer = -1;
    this.last = null;
    window.clearTimeout(this.timer);
    if (this.inked) this.timer = window.setTimeout(() => this.judge(), TRACE.settle * 1000);
  }

  /** A bit of Sharpie: black on the lid, and a fatter copy on the coverage layer. */
  private stroke(a: { x: number; y: number }, b: { x: number; y: number }) {
    const size = this.nameBox.size;
    for (const [c, wdt] of [
      [this.ink, size * TRACE.brush],
      [this.cover, size * TRACE.near * 2],
    ] as [HTMLCanvasElement, number][]) {
      const x = c.getContext('2d');
      if (!x) continue;
      x.strokeStyle = '#121214';
      x.lineWidth = wdt;
      x.lineCap = 'round';
      x.beginPath();
      if (a.x === b.x && a.y === b.y) {
        // A touch that hasn't moved yet still leaves a dot.
        x.fillStyle = '#121214';
        x.arc(a.x, a.y, wdt / 2, 0, Math.PI * 2);
        x.fill();
        continue;
      }
      x.moveTo(a.x, a.y);
      x.lineTo(b.x, b.y);
      x.stroke();
    }
    this.inked = true;
    if (Math.random() < 0.25) sfx.rim();
    this.draw();
  }

  /** How much of the name is covered, and how much of the ink is off it. */
  score() {
    const mw = MASK_W;
    const mh = Math.round((mw * this.h) / this.w);
    const sample = (c: HTMLCanvasElement) => {
      const m = document.createElement('canvas');
      m.width = mw;
      m.height = mh;
      const mc = m.getContext('2d');
      if (!mc) return new Uint8Array(0);
      mc.drawImage(c, 0, 0, mw, mh);
      return alpha(mc.getImageData(0, 0, mw, mh).data);
    };
    const cover = sample(this.cover);
    const ink = sample(this.ink);
    let guide = 0;
    let hit = 0;
    let inkN = 0;
    let stray = 0;
    for (let i = 0; i < this.guideMask.length; i++) {
      if (this.guideMask[i]) {
        guide++;
        if (cover[i]) hit++;
      }
      if (ink[i]) {
        inkN++;
        if (!this.nearMask[i]) stray++;
      }
    }
    return { coverage: guide ? hit / guide : 0, stray: inkN ? stray / inkN : 1 };
  }

  private judge() {
    const box = this.box;
    const t = this.target;
    if (!box || !t || !this.open) return;
    const { coverage, stray } = this.score();
    this.keepInk(box, t.item);
    const name = (t.order.name ?? 'GUEST').toUpperCase();
    if (coverage >= TRACE.clean && stray <= TRACE.cleanStray) {
      this.k.labelBox(box, t.item.id);
      box.labelQuality = 'clean';
      stamp('CLEAN!', `${name}, PLAIN AS DAY.`, 'green');
      sfx.perfect();
    } else if (coverage >= TRACE.readable && stray <= TRACE.readableStray) {
      this.k.labelBox(box, t.item.id);
      box.labelQuality = 'ok';
      stamp('LEGIBLE', 'GOOD ENOUGH FOR THE PASS.', 'gold');
      sfx.ok();
    } else {
      // Nobody can read it: the box is yours, but the label won't help anyone.
      this.k.labelBox(box, t.item.id);
      box.labeled = false;
      box.labelQuality = 'scrawl';
      stamp(`WHO IS "${scramble(name)}"?`, 'NOBODY CAN READ THAT.', 'red');
      sfx.reject();
    }
    haptic(12);
    window.setTimeout(() => this.close(), 650);
  }
}

function alpha(rgba: Uint8ClampedArray) {
  const out = new Uint8Array(rgba.length / 4);
  for (let i = 0; i < out.length; i++) out[i] = (rgba[i * 4 + 3] ?? 0) > 60 ? 1 : 0;
  return out;
}

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

/** What a scrawled name looks like to the person at the pass. */
function scramble(name: string) {
  const swap: Record<string, string> = { A: 'N', M: 'W', E: 'F', O: 'D', R: 'B', N: 'H', I: 'L', U: 'V', C: 'G', T: 'I', S: '5', H: 'N', L: 'I', B: 'R', D: 'O', G: 'C', K: 'R', Y: 'V', P: 'R' };
  return name
    .split('')
    .map((c, i) => (i % 2 ? (swap[c] ?? c) : c))
    .join('')
    .slice(0, 6);
}
