import { FLAVORS } from '../config/flavors';
import { EXPO } from '../config/shift';
import { haptic, sfx } from '../ui/feel';
import { boxStackModel, clamshellModel, cupClusterModel, waxPileModel } from '../render/models';
import { snapshot } from '../render/snapshot';
import { pop } from '../ui/stamp';
import { bigCupsFor, type Box, type BoxSize, boxSizeFor, itemLabel, type Kitchen, type KitchenEvent, lidOrder, type Sauce, saucesFor, type Sheet } from './kitchen';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement) => {
  const e = document.createElement(tag);
  e.className = cls;
  parent?.appendChild(e);
  return e;
};

const SAUCE_NAME: Record<Sauce, string> = { marinara: 'marinara', ranch: 'ranch', mascarpone: 'lemon mascarpone' };
const SIZE_NAME: Record<BoxSize, string> = { S: 'small', M: 'medium', L: 'large' };
/** Clamshell sizes in world units (width, depth), for the pictures. */
const SIZE_DIMS: Record<BoxSize, [number, number]> = { S: [1.2, 1.0], M: [1.7, 1.4], L: [2.1, 1.7] };

type Carry = { kind: 'sheet'; sheet: Sheet } | { kind: 'sauce'; sauce: Sauce };

/**
 * Expo: the cold table. Open boxes on the cutting board, line them with checkerboard wax paper,
 * Sharpie them for an order, and set the sauce cups, all while the ravs cook. Plain DOM for now:
 * it's flat work on a flat table, and it's fast to tune.
 */
export class ExpoView {
  private root: HTMLElement;
  private board: HTMLElement;
  private picker: HTMLElement;
  private ghost: HTMLElement;
  private carry: { pointer: number; what: Carry; x0: number; y0: number; t0: number } | null = null;
  /** Tap a sauce pan (not a drag): go ladle more cups. */
  onPanTap: ((sauce: Sauce) => void) | null = null;
  private stockBadges = new Map<Sauce, HTMLElement>();
  /** Docked under the plating table: the supplies only, dropped onto the real 3D boxes. */
  private docked = false;
  /** On the fryer screen: the boxes and the supplies, right under the fryers (the battlestation). */
  private bench = false;
  /** Finds the box on the 3D table under a screen point (set by the table view). */
  boxAtPoint: ((x: number, y: number) => Box | null) | null = null;
  private lastSig = '';
  /** Each box's look last time, so the one that changed can bounce. */
  private looks = new Map<number, string>();
  private wasReady = new Set<number>();

  constructor(ui: HTMLElement, private k: Kitchen) {
    this.root = el('div', 'expo-ui', ui);
    this.root.hidden = true;

    // The cold table: lid up, quarter pans of sauce you drag cups from.
    const table = el('div', 'cold-table', this.root);
    el('div', 'cold-lid', table).textContent = 'cold table';
    const pans = el('div', 'pans', table);
    for (const sauce of ['marinara', 'ranch', 'mascarpone'] as Sauce[]) {
      const pan = el('div', `pan sauce-${sauce}`, pans);
      // The cups themselves, lidded and waiting.
      const pic = el('img', 'supply-pic', pan);
      pic.src = snapshot(`cups-${sauce}`, () => cupClusterModel(sauce), 1.1, 140, 120);
      pic.draggable = false;
      el('div', 'pan-name', pan).textContent = sauce === 'mascarpone' ? 'berry' : sauce;
      this.stockBadges.set(sauce, el('div', 'pan-stock', pan));
      this.dragSource(pan, { kind: 'sauce', sauce });
    }
    for (const [cls, name] of [
      ['parm', 'parm'],
      ['parsley', 'parsley'],
    ]) {
      const pan = el('div', `pan ${cls} soon`, pans);
      el('div', 'pan-name', pan).textContent = `${name} · soon`;
    }

    // The white cutting board where the open boxes sit.
    this.board = el('div', 'cut-board', this.root);

    // Supplies: box stacks (tap) and wax paper (drag).
    const shelf = el('div', 'supplies', this.root);
    for (const size of ['S', 'M', 'L'] as BoxSize[]) {
      const stack = el('button', `box-stack size-${size}`, shelf);
      // A real leaning stack of clamshells, sized like the boxes.
      const [w, d] = SIZE_DIMS[size];
      stack.innerHTML = `<img class="supply-pic" draggable="false" src="${snapshot(`stack-${size}`, () => boxStackModel(w * 0.7, d * 0.7), 2.3, 140, 140)}"><span>${SIZE_NAME[size]}</span>`;
      stack.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (this.k.takeBox(size)) haptic(8);
        this.render(true);
      });
    }
    for (const sheet of ['big', 'small'] as Sheet[]) {
      const pile = el('div', `wax-pile ${sheet}`, shelf);
      const pic = el('img', 'supply-pic', pile);
      pic.src = snapshot(`wax-${sheet}`, () => waxPileModel(sheet === 'big' ? 1.3 : 0.75), 1.9, 140, 120);
      pic.draggable = false;
      el('span', '', pile).textContent = sheet === 'big' ? '6" paper' : '2" paper';
      this.dragSource(pile, { kind: 'sheet', sheet });
    }

    const bar = el('div', 'scene-bar', this.root);
    el('div', 'scene-hint', bar).textContent = 'tap a box to label it · drag paper and cups in';
    const back = el('button', 'scene-btn primary', bar);
    back.textContent = 'BACK TO FRYERS';
    back.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.closePicker();
      this.k.closeExpo();
      haptic(10);
    });

    this.picker = el('div', 'label-picker', this.root);
    this.picker.hidden = true;
    this.ghost = el('div', 'drag-ghost', this.root);
    this.ghost.hidden = true;

    // On the window: a drag that starts on a supply can end over the 3D table.
    window.addEventListener('pointermove', (e) => this.moveCarry(e));
    window.addEventListener('pointerup', (e) => this.dropCarry(e));
    window.addEventListener('pointercancel', () => this.endCarry());
  }

  setVisible(on: boolean, docked = false, bench = false) {
    const was = !this.root.hidden && this.bench === bench && this.docked === docked;
    this.root.hidden = !on;
    this.docked = docked;
    this.bench = bench;
    this.root.classList.toggle('dock', docked);
    this.root.classList.toggle('bench', bench);
    if (was) return;
    if (on && !docked) this.render(true);
    else {
      this.endCarry();
      this.closePicker();
    }
  }

  handle(ev: KitchenEvent) {
    if (ev.type === 'expo') {
      if (ev.what === 'wax') sfx.toss();
      else if (ev.what === 'sauce') sfx.catch(2);
      else if (ev.what === 'label') sfx.pull();
      else sfx.rim();
      this.render(true);
    }
  }

  private dragSource(node: HTMLElement, what: Carry) {
    node.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.carry = { pointer: e.pointerId, what, x0: e.clientX, y0: e.clientY, t0: e.timeStamp };
      this.ghost.className = `drag-ghost ${what.kind === 'sheet' ? `sheet ${what.sheet}` : `cup sauce-${what.sauce}`}`;
      this.ghost.hidden = false;
      this.placeGhost(e);
      haptic(5);
    });
  }

  private placeGhost(e: PointerEvent) {
    this.ghost.style.transform = `translate(${e.clientX}px, ${e.clientY}px) translate(-50%, -60%)`;
  }

  private moveCarry(e: PointerEvent) {
    if (!this.carry || e.pointerId !== this.carry.pointer) return;
    this.placeGhost(e);
  }

  private dropCarry(e: PointerEvent) {
    const c = this.carry;
    if (!c || e.pointerId !== c.pointer) return;
    this.endCarry();
    // A tap on a sauce pan (no drag) goes to ladle more.
    if (c.what.kind === 'sauce' && Math.hypot(e.clientX - c.x0, e.clientY - c.y0) < 12 && e.timeStamp - c.t0 < 450) {
      this.onPanTap?.(c.what.sauce);
      return;
    }
    const target = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('.xbox');
    const box = this.k.board.find((b) => String(b.id) === target?.dataset.box) ?? this.boxAtPoint?.(e.clientX, e.clientY) ?? null;
    if (!box) return;
    const ok = c.what.kind === 'sheet' ? this.k.lineBox(box, c.what.sheet) : this.k.sauceBox(box, c.what.sauce);
    if (ok) haptic(10);
    this.render(true);
  }

  private endCarry() {
    this.carry = null;
    this.ghost.hidden = true;
  }

  openPicker(box: Box) {
    const items = this.k.unboxedItems();
    const rows = items
      .map(({ order, item }) => {
        const fits = box.size === boxSizeFor(item);
        const sauces = saucesFor(item).map((s) => SAUCE_NAME[s]).join(' + ');
        return `<button class="pick-item ${fits ? 'fits' : ''}" data-item="${item.id}">
          <b>#${String(order.id).padStart(3, '0')}</b><span>${itemLabel(item, true)}</span>
          <small>${SIZE_NAME[boxSizeFor(item)]} box · ${sauces}</small></button>`;
      })
      .join('');
    this.picker.innerHTML = `<div class="pick-title">Sharpie this ${SIZE_NAME[box.size ?? 'M']} box for…</div>
      ${rows || '<div class="pick-empty">No orders waiting for a box.</div>'}
      <div class="pick-row"><button class="pick-trash">TOSS THIS BOX</button><button class="pick-close">CANCEL</button></div>`;
    this.picker.hidden = false;
    for (const b of this.picker.querySelectorAll<HTMLElement>('.pick-item')) {
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.k.labelBox(box, Number(b.dataset.item));
        haptic(8);
        this.closePicker();
      });
    }
    this.picker.querySelector('.pick-trash')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.k.trashBox(box);
      this.closePicker();
      this.render(true);
    });
    this.picker.querySelector('.pick-close')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.closePicker();
    });
  }

  private closePicker() {
    this.picker.hidden = true;
  }

  /** Redraw the board when anything on it changed (boxes, paper, cups, labels, finished orders). */
  render(force = false) {
    const k = this.k;
    const open = new Set(k.tickets.flatMap((t) => t.items.filter((i) => !i.done).map((i) => i.id)));
    const sig = k.board.map((b) => `${b.id}${b.size}${b.wax}${b.sauces.join()}${b.itemId}${open.has(b.itemId ?? -1)}`).join('|');
    if (!force && sig === this.lastSig) return;
    this.lastSig = sig;
    this.board.innerHTML = '';
    const seen = new Set<number>();
    k.board.forEach((b) => {
      seen.add(b.id);
      const node = el('div', `xbox size-${b.size}`, this.board);
      node.dataset.box = String(b.id);
      const ref = b.itemId !== null ? k.tickets.flatMap((t) => t.items.map((i) => ({ t, i }))).find((x) => x.i.id === b.itemId) : null;
      const label = b.labeled && ref && !ref.i.done ? { name: ref.t.name ?? '', order: lidOrder(ref.i) } : undefined;
      // The real low-poly clamshell, as you've prepped it.
      const [w, d] = SIZE_DIMS[b.size ?? 'M'];
      const look = `${b.size}|${b.wax}|${b.sauces.join()}|${label ? label.name + label.order : ''}`;
      const img = el('img', 'xbox-pic', node);
      img.src = snapshot(look, () => clamshellModel(w, 0.5, d, { paper: !!b.wax, cups: b.sauces, bigCups: bigCupsFor(b.size, b.sauces), lidOpen: Math.PI * 0.55 }), 2.6);
      img.draggable = false;
      const prev = this.looks.get(b.id);
      if (prev === undefined) node.classList.add('pop-in');
      else if (prev !== look) node.classList.add('bump');
      this.looks.set(b.id, look);
      const lid = el('div', 'xbox-lid', node);
      if (b.labeled && ref && !ref.i.done && label) {
        // The Sharpie on the lid: the name top left, the order top right.
        lid.classList.add('sharpie');
        lid.innerHTML = `<b>${label.name}</b><i>${label.order.replace('\n', ' ')}</i>`;
        // Show what's still missing for this order, so the prep is checkable at a glance.
        const need = saucesFor(ref.i).filter((s) => !b.sauces.includes(s));
        const issues = [
          b.size !== boxSizeFor(ref.i) ? 'wrong size' : '',
          !b.wax ? 'needs paper' : '',
          need.length ? `needs ${need.map((s) => SAUCE_NAME[s]).join(' + ')}` : '',
        ].filter(Boolean);
        el('div', `xbox-status ${issues.length ? '' : 'ready'}`, node).textContent = issues.length ? issues.join(' · ') : 'ready ✓';
        // All set: a little PREPPED! pops off it.
        if (!issues.length && !this.wasReady.has(b.id)) {
          this.wasReady.add(b.id);
          requestAnimationFrame(() => {
            const r = node.getBoundingClientRect();
            pop('PREPPED!', r.left + r.width / 2, r.top + r.height * 0.3, true);
          });
          sfx.ok();
        } else if (issues.length) this.wasReady.delete(b.id);
      } else lid.textContent = b.labeled ? 'order gone: tap to relabel' : 'tap to label';
      node.addEventListener('pointerdown', (e) => {
        if (this.carry) return;
        e.preventDefault();
        this.openPicker(b);
      });
    });
    for (const id of [...this.looks.keys()]) if (!seen.has(id)) this.looks.delete(id);
    for (let i = k.board.length; i < EXPO.boardMax; i++) el('div', 'xbox empty', this.board).textContent = 'open spot';
    void FLAVORS;
  }

  update() {
    // How many lidded cups of each sauce are on the table; empty ones nag to be ladled.
    for (const [s, b] of this.stockBadges) {
      const n = this.k.cupStock[s] ?? 0;
      const cold = s === 'marinara' ? this.k.coldCups() : 0;
      const t = cold ? `${n} · ${cold}❄` : String(n);
      b.parentElement?.classList.toggle('hot', s === 'marinara' && n > cold);
      if (b.textContent !== t) b.textContent = t;
      b.parentElement?.classList.toggle('empty', n === 0 && s !== 'marinara');
    }
    if (!this.root.hidden && !this.docked) this.render();
  }
}
