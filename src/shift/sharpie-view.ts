import { haptic, sfx } from '../ui/feel';
import { stamp } from '../ui/stamp';
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
  brush: 0.13,
  near: 0.16,
  /** Covered this much of the name: readable. And this much, with little stray ink: CLEAN. */
  readable: 0.5,
  clean: 0.78,
  /** Most stray ink (fraction of your ink off the letters) that still counts as clean / readable. */
  cleanStray: 0.18,
  readableStray: 0.42,
  /** Stop writing this long and it's judged. */
  settle: 0.9,
};

const FONT = '"Marker Felt", "Chalkboard SE", "Comic Sans MS", "Segoe Print", cursive';

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
    cap.innerHTML = '<i></i><b>SHARPIE</b>';
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
    // The name, as big as fits the left two thirds of the lid.
    const ctx = this.ctx;
    let size = Math.min(this.h * 0.3, 140);
    ctx.font = `700 ${size}px ${FONT}`;
    while (ctx.measureText(name).width > this.w * 0.72 && size > 24) {
      size -= 4;
      ctx.font = `700 ${size}px ${FONT}`;
    }
    const tw = ctx.measureText(name).width;
    this.nameBox = { x: this.w * 0.08, y: this.h * 0.5 + size * 0.35, w: tw, h: size, size };
    // Masks at low resolution: where the letters are, and where's close enough to them.
    const mw = 120;
    const mh = Math.round((mw * this.h) / this.w);
    const m = document.createElement('canvas');
    m.width = mw;
    m.height = mh;
    const mc = m.getContext('2d');
    if (!mc) return;
    const sx = mw / this.w;
    mc.scale(sx, sx);
    mc.font = `700 ${size}px ${FONT}`;
    mc.fillStyle = '#000';
    mc.fillText(name, this.nameBox.x, this.nameBox.y);
    this.guideMask = alpha(mc.getImageData(0, 0, mw, mh).data);
    mc.clearRect(0, 0, this.w, this.h);
    mc.lineWidth = size * TRACE.near * 2;
    mc.lineJoin = 'round';
    mc.strokeStyle = '#000';
    mc.strokeText(name, this.nameBox.x, this.nameBox.y);
    mc.fillText(name, this.nameBox.x, this.nameBox.y);
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
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#fffdf7');
    g.addColorStop(1, '#efe9db');
    ctx.fillStyle = g;
    roundRect(ctx, 6, 6, w - 12, h - 12, 28);
    ctx.fill();
    ctx.strokeStyle = '#e1d9c6';
    ctx.lineWidth = 4;
    roundRect(ctx, 22, 22, w - 44, h - 44, 20);
    ctx.stroke();
    if (!t) return;
    const nb = this.nameBox;
    ctx.font = `700 ${nb.size}px ${FONT}`;
    ctx.fillStyle = '#e3dccb';
    ctx.fillText((t.order.name ?? 'GUEST').toUpperCase(), nb.x, nb.y);
    ctx.setLineDash([3, 6]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#bdb3a0';
    ctx.strokeText((t.order.name ?? 'GUEST').toUpperCase(), nb.x, nb.y);
    ctx.setLineDash([]);
    // The order, already on there top right.
    ctx.font = `700 ${Math.min(30, nb.size * 0.4)}px ${FONT}`;
    ctx.fillStyle = '#1b1b1d';
    ctx.textAlign = 'right';
    lidOrder(t.item)
      .split('\n')
      .forEach((line, i) => ctx.fillText(line, w - 34, 54 + i * Math.min(32, nb.size * 0.42)));
    ctx.textAlign = 'left';
    ctx.drawImage(this.ink, 0, 0, w, h);
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
    const mw = 120;
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
