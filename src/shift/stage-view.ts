import * as THREE from 'three';
import { FLAVORS } from '../config/flavors';
import { BENCH, STAGE, STATION } from '../config/shift';
import { BASKET } from '../config/toss';
import { bowlModel, counterModel, stageBasketModel, wallModel } from '../render/models';
import { haptic, sfx } from '../ui/feel';
import type { Basket, Kitchen, KitchenEvent } from './kitchen';
import type { Rav } from './physics';
import { RavMeshes } from './rav-meshes';
import type { SideView } from './side-view';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement) => {
  const e = document.createElement(tag);
  e.className = cls;
  parent?.appendChild(e);
  return e;
};

type From = { kind: 'oil' | 'hook' | 'hang'; slot: number };
type Drag =
  /** A basket down in the oil: slide it side to side to settle floaters, pull up to lift it out. */
  | { kind: 'oil'; slot: number; y0: number; wx0: number; off: number }
  /** A touch on an empty basket on its bar: drag and it's in your hand. */
  | { kind: 'empty'; slot: number; x0: number; y0: number }
  /** A basket in your hand. */
  | { kind: 'carry'; b: Basket; from: From; dx: number; dy: number; x: number; y: number; px: number; py: number; x0: number; y0: number; t0: number; moved: boolean };

const BOWL_U = 0.13;

/**
 * The one stage: the fryers seen from the front, in the same view and the same world as the freezer
 * catch and the salt bowl. Baskets hang on their bars above the oil; you lower one in, lift it out,
 * hang it to drain, carry it to the bowl. Every basket is one object drawn one way: it's picked up
 * from where it is and eases to where you leave it. The freezer and the pass draw on top of this, in
 * the same camera, so a basket in your hand there is the same basket here.
 */
export class StageView {
  private scene = new THREE.Scene();
  private fixtures = new THREE.Group();
  private ravs: RavMeshes;
  private meshes = new Map<number, THREE.Object3D>();
  /** Where each basket is drawn right now (its floor center). */
  private shown = new Map<number, { x: number; y: number }>();
  private slotX: number[] = [];
  private spacing = 2;
  private hookY = 0;
  private oilY = 0;
  private oilFloorY = 0;
  private tableY = 0;
  private bowlAt = { x: 0, y: 0 };
  private bowl = bowlModel();
  private drags = new Map<number, Drag>();
  private slide: number[] = [];
  private lift: number[] = [];
  private last = 0;
  private dom: HTMLElement;
  private coach: HTMLElement;
  private freezerBtn: HTMLButtonElement;
  private drainTags: HTMLElement[] = [];
  private bowlLabel: HTMLElement;
  private carryTag: HTMLElement;

  constructor(
    private canvas: HTMLCanvasElement,
    ui: HTMLElement,
    private k: Kitchen,
    private side: SideView,
  ) {
    this.scene.background = new THREE.Color('#1d3d35');
    // The same light as the freezer and the pass, so a basket looks the same in both.
    this.scene.add(new THREE.HemisphereLight('#fff3dc', '#5a3a22', 1.4));
    const key = new THREE.DirectionalLight('#fff6e8', 2.6);
    key.position.set(-3, 9, 10);
    this.scene.add(key);
    this.scene.add(this.fixtures, this.bowl);
    this.ravs = new RavMeshes(this.scene);
    for (const b of k.baskets) {
      const m = stageBasketModel(BASKET.width, BASKET.wall);
      m.visible = false;
      this.scene.add(m);
      this.meshes.set(b.id, m);
    }
    this.dom = el('div', 'station-ui stage-ui', ui);
    for (let i = 0; i < k.slots.length; i++) this.drainTags.push(el('div', 'drain-tag', this.dom));
    this.bowlLabel = el('div', 'bowl-label', this.dom);
    this.carryTag = el('div', 'carry-tag', this.dom);
    this.carryTag.hidden = true;
    const bar = el('div', 'station-bar', this.dom);
    this.coach = el('div', 'coach', bar);
    this.freezerBtn = el('button', 'freezer-btn', bar);
    this.freezerBtn.innerHTML = '<i></i><span>FREEZER</span><i></i>';
    // The freezer's front is the button: tap to open it, tap again to shut it.
    this.freezerBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (this.k.scene === 'freezer') this.k.leaveFreezer();
      else this.k.openFreezer();
      haptic(10);
    });
    this.bind();
  }

  setVisible(on: boolean) {
    this.dom.hidden = !on;
    if (!on) {
      // Anything still in your hand goes back where it came from.
      for (const d of this.drags.values()) if (d.kind === 'carry') this.k.putBack(d.b, d.from);
      this.drags.clear();
      this.carryTag.hidden = true;
    }
  }

  /** Lay the stage out for this screen (after the side view has set the shared camera). */
  resize(w: number, h: number) {
    const at = (u: number, v: number) => this.side.worldAtScreen(u * w, v * h);
    const left = at(0, 0.5).x;
    const right = at(1, 0.5).x;
    const n = this.k.slots.length;
    this.spacing = (right - left) / n;
    this.slotX = Array.from({ length: n }, (_, i) => left + (i + 0.5) * this.spacing);
    // The fryer's front ledge; a basket frying sits just under it, a hanging one higher on the rail.
    this.oilY = at(0.5, STAGE.oilV).y;
    this.oilFloorY = this.oilY - STAGE.fryDepth;
    this.hookY = this.oilFloorY + STAGE.hangLift;
    this.tableY = at(0.5, STAGE.tableV).y;
    const benchMid = 1 - (BENCH.bottomPx + BENCH.heightFrac * h * 0.5) / h;
    const bp = at(BOWL_U, benchMid);
    this.bowlAt = { x: bp.x, y: bp.y + STAGE.bowlLift };
    // The bowl sits out in front of the fryers; lifted so it still lands on this spot on screen.
    const bz = 2.0;
    this.bowl.position.set(bp.x, bp.y + STAGE.bowlLift + bz * Math.tan(THREE.MathUtils.degToRad(STAGE.tilt)), bz);
    this.bowl.scale.setScalar(STAGE.bowlScale);

    for (const c of [...this.fixtures.children]) this.fixtures.remove(c);
    const topY = at(0.5, 0).y;
    const botY = at(0.5, 1.1).y;
    const wall = wallModel((right - left) * 2.2, topY - botY + 4, (topY + botY) / 2);
    this.fixtures.add(wall);
    // The fryers, after the two Pitcos on the line: stainless cabinets, the tank open on top with the
    // oil in it, a thick ledge across the front, the backsplash with the hanger rail, a badge and a door.
    const steel = new THREE.MeshStandardMaterial({ color: '#c3c9ce', metalness: 0.6, roughness: 0.34 });
    const brushed = new THREE.MeshStandardMaterial({ color: '#aeb5bb', metalness: 0.55, roughness: 0.45 });
    // The backsplash is darker than the baskets hanging in front of it, so their wire shows.
    const splash = new THREE.MeshStandardMaterial({ color: '#6f777d', metalness: 0.5, roughness: 0.5 });
    const dark = new THREE.MeshStandardMaterial({ color: '#2a1608', roughness: 0.9 });
    const black = new THREE.MeshStandardMaterial({ color: '#15181a', roughness: 0.6 });
    const box = (bw: number, bh: number, bd: number, mat: THREE.Material, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), mat);
      m.position.set(x, y, z);
      this.fixtures.add(m);
      return m;
    };
    const ledge = this.oilY;
    const zb = -1.25;
    const zf = 1.15;
    const units = n / 2;
    for (let u = 0; u < units; u++) {
      const cx = left + (u * 2 + 1) * this.spacing;
      const uw = this.spacing * 2 - 0.12;
      // Backsplash, with the rail the baskets hang on and the flue along the top.
      box(uw, 3.0, 0.12, splash, cx, ledge + 1.5, zb - 0.1);
      box(uw * 0.9, 0.07, 0.1, steel, cx, this.hookY + BASKET.wall + 0.12, zb + 0.02);
      box(uw * 0.92, 0.5, 0.45, steel, cx, ledge + 2.5, zb + 0.15);
      box(uw * 0.8, 0.1, 0.3, black, cx, ledge + 2.76, zb + 0.18);
      for (const sx of [-1, 1]) box(0.12, 0.12, 0.05, steel, cx + sx * uw * 0.36, ledge + 1.9, zb);
      // The tank: dark inside, oil a little under the ledge.
      box(uw - 0.1, 1.0, 0.06, dark, cx, ledge - 0.5, zb + 0.05);
      box(uw - 0.1, 0.06, zf - zb, dark, cx, ledge - 0.95, (zf + zb) / 2);
      for (const sx of [-1, 1]) box(0.1, 1.1, zf - zb + 0.2, steel, cx + (sx * (uw - 0.1)) / 2, ledge - 0.45, (zf + zb) / 2);
      const oil = box(uw - 0.2, 0.02, zf - zb, new THREE.MeshBasicMaterial({ color: '#b86a17', transparent: true, opacity: STAGE.oilTint, depthWrite: false }), cx, ledge - 0.18, (zf + zb) / 2);
      oil.renderOrder = 10;
      // The thick ledge across the front, its rolled lip, the badge panel, and the door with its pull.
      box(uw + 0.04, 0.14, 0.42, steel, cx, ledge - 0.03, zf + 0.2);
      const lip = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, uw + 0.04, 10), steel);
      lip.rotation.z = Math.PI / 2;
      lip.position.set(cx, ledge - 0.05, zf + 0.42);
      this.fixtures.add(lip);
      const panelH = 0.8;
      box(uw - 0.08, panelH, 0.08, brushed, cx, ledge - 0.1 - panelH / 2, zf + 0.3);
      box(0.52, 0.17, 0.03, new THREE.MeshStandardMaterial({ color: '#2d5fa8', roughness: 0.4 }), cx - uw * 0.3, ledge - 0.1 - panelH + 0.2, zf + 0.35);
      const doorTop = ledge - 0.14 - panelH;
      box(uw - 0.14, doorTop - this.tableY, 0.08, steel, cx, (doorTop + this.tableY) / 2, zf + 0.22);
      box(0.4, 0.13, 0.03, black, cx + (u === 0 ? 1 : -1) * uw * 0.3, doorTop - 0.55, zf + 0.27);
    }
    // The steel table in front, with the salt bowl on it.
    // Set back, so a basket you carry down to the bowl passes in front of the table.
    const counter = counterModel(left, right, this.tableY, botY);
    counter.position.z = -1.4;
    this.fixtures.add(counter);
  }

  // ---------- Where things are ----------

  /** Where a basket hangs on a slot's bar: i-th in the nest (a full one hangs in front of the empties). */
  private hangPos(slot: number, i: number) {
    return { x: (this.slotX[slot] ?? 0) + i * STAGE.nestX, y: this.hookY + i * STAGE.nestY };
  }

  /** Where the next basket hung on this slot's bar will sit (world). */
  slotWorld(slot: number) {
    return this.hangPos(slot, this.k.hung[slot]?.length ?? 0);
  }

  /** Where a basket is drawn right now (its floor center), if it's on the stage. */
  shownPos(b: Basket) {
    const s = this.shown.get(b.id);
    return s ? { x: s.x, y: s.y } : null;
  }

  private nearSlot(x: number) {
    let best = -1;
    let bd = this.spacing * 0.5;
    this.slotX.forEach((sx, i) => {
      const d = Math.abs(x - sx);
      if (d < bd) [best, bd] = [i, d];
    });
    return best < 0 ? null : best;
  }

  /** The fryer slot under a screen point (its oil or its bar), or null. */
  slotAtScreen(x: number, y: number) {
    const p = this.side.worldAtScreen(x, y);
    if (p.y < this.tableY || p.y > this.hookY + BASKET.wall + 1.0) return null;
    return this.nearSlot(p.x);
  }

  /** The slot whose oil a basket at this spot (floor center) is down in, or null. */
  oilSlotFor(x: number, y: number) {
    if (y > (this.hookY + this.oilFloorY) / 2 || y < this.tableY - 0.5) return null;
    return this.nearSlot(x);
  }

  private zoneAt(x: number, y: number): { kind: 'bowl' } | { kind: 'oil' | 'bar'; slot: number } | null {
    if (Math.hypot(x - this.bowlAt.x, y - this.bowlAt.y) < 1.2 * STAGE.bowlScale + 0.5) return { kind: 'bowl' };
    if (y < this.tableY || y > this.hookY + BASKET.wall + 0.8) return null;
    const slot = this.nearSlot(x);
    if (slot === null) return null;
    // A basket down in the oil has its handle standing up out of it: that's still the oil's basket.
    return { kind: y > Math.min(this.oilY + 1.0, this.hookY + 0.3) ? 'bar' : 'oil', slot };
  }

  // ---------- Input ----------

  private bind() {
    const c = this.canvas;
    const world = (e: PointerEvent) => this.side.worldAtScreen(e.clientX, e.clientY);
    const carry = (e: PointerEvent, b: Basket, from: From, moved = false) => {
      const p = world(e);
      const s = this.shown.get(b.id) ?? { x: p.x, y: p.y - BASKET.wall / 2 };
      this.drags.set(e.pointerId, { kind: 'carry', b, from, dx: s.x - p.x, dy: s.y - p.y, x: s.x, y: s.y, px: p.x, py: p.y, x0: e.clientX, y0: e.clientY, t0: performance.now(), moved });
    };
    c.addEventListener('pointerdown', (e) => {
      const k = this.k;
      if (k.scene !== 'station' || k.phase !== 'playing') return;
      e.preventDefault();
      try {
        c.setPointerCapture(e.pointerId);
      } catch {
        /* synthetic pointer */
      }
      const p = world(e);
      const zone = this.zoneAt(p.x, p.y);
      if (!zone) return;
      if (zone.kind === 'bowl') {
        // Tap the bowl to go plate what's in it.
        if (k.bowl.ravs.length || k.board.some((bx) => bx.ravs.length)) {
          k.openPass();
          haptic(8);
        }
        return;
      }
      const slot = zone.slot;
      if ([...this.drags.values()].some((d) => (d.kind === 'oil' || d.kind === 'empty') && d.slot === slot)) return;
      const order = zone.kind === 'bar' ? ['hook', 'empty', 'oil'] : ['oil', 'hook', 'empty'];
      for (const what of order) {
        if (what === 'oil' && k.slots[slot]?.length) {
          this.drags.set(e.pointerId, { kind: 'oil', slot, y0: e.clientY, wx0: p.x - (this.slide[slot] ?? 0), off: this.slide[slot] ?? 0 });
          haptic(5);
          return;
        }
        if (what === 'hook' && k.hooked[slot]) {
          const b = k.liftHooked(slot);
          if (b) {
            carry(e, b, { kind: 'hook', slot });
            haptic(8);
          }
          return;
        }
        if (what === 'empty' && k.hung[slot]?.length) {
          this.drags.set(e.pointerId, { kind: 'empty', slot, x0: e.clientX, y0: e.clientY });
          return;
        }
      }
    });
    c.addEventListener('pointermove', (e) => {
      const d = this.drags.get(e.pointerId);
      if (!d || this.k.scene !== 'station') return;
      const p = world(e);
      if (d.kind === 'carry') {
        if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > 10) d.moved = true;
        d.x = p.x + d.dx;
        d.y = p.y + d.dy;
        d.px = p.x;
        d.py = p.y;
        return;
      }
      if (d.kind === 'empty') {
        if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > 12) {
          this.drags.delete(e.pointerId);
          const b = this.k.liftEmpty(d.slot);
          if (b) {
            carry(e, b, { kind: 'hang', slot: d.slot }, true);
            haptic(8);
          }
        }
        return;
      }
      // In the oil: it slides with your finger inside its slot, and lifts as you pull up.
      const off = Math.max(-STATION.slideMax, Math.min(STATION.slideMax, p.x - d.wx0));
      const before = this.k.slots[d.slot]?.at(-1)?.settle ?? 1;
      this.k.slosh(d.slot, Math.abs(off - d.off));
      if (Math.floor((this.k.slots[d.slot]?.at(-1)?.settle ?? 1) * 3) > Math.floor(before * 3)) haptic(7);
      d.off = off;
      this.slide[d.slot] = off;
      const up = Math.max(0, d.y0 - e.clientY);
      this.lift[d.slot] = Math.min(1, up / STATION.pullPx) * STATION.liftMax;
      if (up > STATION.pullPx) {
        // Out of the oil and into your hand, from right where it is.
        this.drags.delete(e.pointerId);
        const b = this.k.liftFromOil(d.slot);
        this.slide[d.slot] = 0;
        this.lift[d.slot] = 0;
        if (b) {
          carry(e, b, { kind: 'oil', slot: d.slot }, true);
          haptic(14);
        }
      }
    });
    const end = (e: PointerEvent) => {
      const d = this.drags.get(e.pointerId);
      this.drags.delete(e.pointerId);
      if (!d) return;
      const k = this.k;
      if (d.kind === 'oil') {
        this.lift[d.slot] = 0;
        this.slide[d.slot] = 0;
        return;
      }
      if (d.kind === 'empty') return;
      // Tap a basket hanging full on its bar: it goes down into its own slot's oil.
      if (!d.moved && performance.now() - d.t0 < STATION.tapMs) {
        if (d.from.kind === 'hook' && k.placeInOil(d.b, d.from.slot)) haptic(14);
        else k.putBack(d.b, d.from);
        return;
      }
      // Where the basket is (its middle) decides: the bowl, a slot's oil, or a bar.
      const zone = this.zoneAt(d.x, d.y + BASKET.wall * 0.5) ?? this.zoneAt(d.px, d.py);
      let ok = false;
      if (zone?.kind === 'bowl') ok = k.toBowl(d.b, d.from.kind === 'hook' ? k.drainedFor(d.b) : 0);
      else if (zone?.kind === 'oil') ok = d.b.ravs.length ? k.placeInOil(d.b, zone.slot) : k.weighDown(d.b, zone.slot) || k.hookOn(d.b, zone.slot);
      else if (zone?.kind === 'bar') ok = k.hookOn(d.b, zone.slot);
      if (ok) haptic(14);
      else k.putBack(d.b, d.from);
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
  }

  handle(ev: KitchenEvent) {
    switch (ev.type) {
      case 'drop':
        sfx.drop();
        break;
      case 'shake':
      case 'restash':
      case 'hook':
        sfx.rim();
        break;
      case 'lift':
        sfx.pull();
        break;
      default:
        break;
    }
  }

  // ---------- Frame ----------

  render(renderer: THREE.WebGLRenderer, now: number) {
    const k = this.k;
    const dt = Math.min(0.05, Math.max(0, now - this.last));
    this.last = now;
    const ease = 1 - Math.exp(-dt * STAGE.settle);
    this.bowl.visible = k.scene !== 'pass';
    for (const m of this.meshes.values()) m.visible = false;
    this.ravs.begin();
    let frying = 0;

    /** Draw a basket easing toward where it belongs (or right at `snap`, in your hand). */
    const draw = (b: Basket, tx: number, ty: number, snap = false, showRavs = true, bob = 0) => {
      let s = this.shown.get(b.id);
      if (!s) {
        s = { x: tx, y: ty };
        this.shown.set(b.id, s);
      }
      if (snap) {
        s.x = tx;
        s.y = ty;
      } else {
        s.x += (tx - s.x) * ease;
        s.y += (ty - s.y) * ease;
      }
      const m = this.meshes.get(b.id);
      if (m) {
        m.visible = true;
        m.position.set(s.x, s.y + bob, 0);
      }
      for (const r of b.ravs) this.drawRav(r, s.x, s.y + bob, showRavs, b.slot !== null && b.settle < 1 ? (1 - b.settle) * (0.1 + 0.04 * Math.sin(now * 4 + r.id)) : 0);
    };

    const held = new Set<Basket>();
    for (const d of this.drags.values()) {
      if (d.kind !== 'carry') continue;
      held.add(d.b);
      draw(d.b, d.x, d.y, true);
    }
    k.slots.forEach((stack, slot) => {
      stack.forEach((b, level) => {
        const top = level === stack.length - 1;
        const x = (this.slotX[slot] ?? 0) + level * STAGE.nestX + (top ? (this.slide[slot] ?? 0) : 0);
        const y = this.oilFloorY + level * STAGE.stackY + (top ? (this.lift[slot] ?? 0) : 0);
        draw(b, x, y, false, true, top && b.settle < 1 ? Math.sin(now * 3 + slot) * 0.02 : 0);
        if (b.ravs.length) frying++;
      });
    });
    k.hung.forEach((nest, slot) => {
      nest.forEach((b, i) => {
        const p = this.hangPos(slot, i);
        draw(b, p.x, p.y);
      });
      const full = k.hooked[slot];
      if (full) {
        const p = this.hangPos(slot, nest.length);
        draw(full, p.x, p.y);
      }
    });
    // A carried basket nobody's finger is on (shouldn't linger): keep it where it was.
    for (const b of k.carrying) {
      if (held.has(b)) continue;
      const s = this.shown.get(b.id);
      if (s) draw(b, s.x, s.y, true);
    }
    // Baskets in your hands in the freezer or at the pass are drawn there, in this same view:
    // remember where they are, so they carry on from that spot when they come back.
    for (const b of k.hands) this.shown.set(b.id, { x: b.x, y: b.y });

    this.ravs.end();
    sfx.sizzle(frying);
    this.updateDom();
    renderer.render(this.scene, this.side.cam);
  }

  private drawRav(r: Rav, bx: number, by: number, show: boolean, float: number) {
    const m = this.ravs.get(r);
    m.visible = show;
    m.position.set(bx + r.lx, by + r.ly + float, (m.userData.zj as number) ?? 0);
    m.rotation.set(r.tumble * 0.6 + 0.08, ((m.userData.yaw as number) ?? 0) + r.a * 0.3, r.a);
  }

  private place(tag: HTMLElement, x: number, y: number) {
    const p = this.side.project(x, y);
    const half = (tag.offsetWidth || 80) / 2 + 6;
    const px = Math.max(half, Math.min(window.innerWidth - half, p.x));
    tag.style.transform = `translate(-50%, -50%) translate(${px}px, ${p.y}px)`;
  }

  private updateDom() {
    const k = this.k;
    const job = k.phase === 'playing' ? k.nextJob() : null;
    if (this.coach.textContent !== (job?.text ?? '')) this.coach.textContent = job?.text ?? '';
    this.freezerBtn.classList.toggle('glow', job?.target === 'freezer');
    document.querySelector('.expo-ui.bench .supplies')?.classList.toggle('glow', job?.target === 'expo');
    this.bowlLabel.classList.toggle('glow', job?.target === 'bowl');
    const waiting = k.inFreezer.length;
    this.freezerBtn.disabled = k.scene === 'station' && !k.freeBaskets().length && !waiting;
    const open = k.scene === 'freezer';
    this.freezerBtn.classList.toggle('open', open);
    const word = this.freezerBtn.querySelector('span');
    if (word && word.textContent !== (open ? 'SHUT THE LID' : 'FREEZER')) word.textContent = open ? 'SHUT THE LID' : 'FREEZER';
    this.coach.hidden = open;
    this.place(this.bowlLabel, this.bowlAt.x, this.bowlAt.y + 0.75);
    const inBowl = k.bowl.ravs.length;
    const boxed = k.board.some((bx) => bx.ravs.length);
    const bowlText = inBowl ? `${inBowl} in it · tap` : boxed ? 'tap to plate' : 'salt bowl';
    if (this.bowlLabel.textContent !== bowlText) this.bowlLabel.textContent = bowlText;
    this.bowlLabel.hidden = k.scene !== 'station';
    this.drainTags.forEach((tag, slot) => {
      const b = k.hooked[slot];
      tag.hidden = !b || k.scene === 'pass';
      if (!b) return;
      const cooked = b.ravs.some((r) => r.cooked > 0);
      const drained = k.drainedFor(b) >= STATION.drainSeconds;
      const f = b.flavor;
      const name = f === 'mixed' ? 'MIXED' : f ? FLAVORS[f].short : '';
      tag.textContent = !cooked ? `${b.ravs.length} ${name} · tap to drop` : drained ? 'drained ✓ · to the bowl' : 'draining…';
      tag.className = `drain-tag ${!cooked ? 'raw' : drained ? 'ready' : ''}`;
      const p = this.hangPos(slot, k.hung[slot]?.length ?? 0);
      this.place(tag, p.x, p.y + BASKET.wall + 0.3);
    });
    const d = [...this.drags.values()].find((x) => x.kind === 'carry');
    if (d?.kind === 'carry') {
      const zone = this.zoneAt(d.x, d.y + BASKET.wall * 0.5);
      const full = d.b.ravs.length > 0;
      const text = zone?.kind === 'bowl' ? (full ? 'SALT BOWL' : '') : zone?.kind === 'oil' ? (full ? 'DROP IN' : k.canWeigh(zone.slot) ? 'WEIGH IT DOWN' : 'HANG') : zone?.kind === 'bar' ? 'HANG ON BAR' : '';
      this.carryTag.textContent = text;
      this.carryTag.hidden = !text;
      this.place(this.carryTag, d.x, d.y + BASKET.wall + 0.45);
    } else this.carryTag.hidden = true;
  }
}
