import * as THREE from 'three';
import { FLAVORS } from '../config/flavors';
import { FRYER_TEMPS, FRYERS, SLOTS_PER_FRYER } from '../config/game';
import { DROP_TAG_SECONDS, STATION } from '../config/shift';
import { RAV } from '../config/toss';
import { bowlModel, counterModel, fryerUnit, longBasketModel, wallModel } from '../render/models';
import { haptic, sfx } from '../ui/feel';
import { type Basket, Kitchen, type KitchenEvent } from './kitchen';
import { RavMeshes } from './rav-meshes';

const FOV = 38;
const ELEVATION = 58; // degrees above the horizon
const BANK_W = 7.4;
const FRYER_D = 2.9;
const SINK = { bottom: -0.38, top: -0.12 };
/** A hung basket: hooked on the top bar, resting on the lower one, level and clear of the oil. Nested ones sit a little higher. */
const HANG = { y: 0.33, z: 0.06, nestY: 0.07, nestZ: -0.025 };
/** How high a basket rides while it's in your hand. */
const CARRY_Y = 0.95;
/** Where things sit on screen, fraction of height from the top. */
const V = { fryer: 0.47, bowl: 0.78 };

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement) => {
  const e = document.createElement(tag);
  e.className = cls;
  parent?.appendChild(e);
  return e;
};

type From = { kind: 'oil' | 'hook' | 'hang'; slot: number };

type Drag =
  /** A basket in the oil under your finger: it slides in its slot, and comes out if you drag it up far enough. */
  | { kind: 'oil'; slot: number; y0: number; wx0: number; off: number }
  /** A basket in your hand, going wherever you let go of it. */
  | { kind: 'carry'; b: Basket; from: From; pos: THREE.Vector3; x0: number; y0: number; t0: number; moved: boolean }
  /** A finger on an empty basket on a bar: tap picks it for the freezer, drag carries it. */
  | { kind: 'empty'; slot: number; x0: number; y0: number; t0: number };

type Zone = { kind: 'bowl' } | { kind: 'oil' | 'bar'; slot: number } | null;

/** Home screen: the fryer bank seen from the front, baskets long-ways, handles toward you. */
export class StationView {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);
  private raycaster = new THREE.Raycaster();
  private ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private fixtures = new THREE.Group();
  private oils: THREE.MeshStandardMaterial[] = [];
  private slotX: number[] = [];
  private fryerZ = 0;
  private bowlZ = 3;
  private bowl = bowlModel();
  private basketViews = new Map<number, THREE.Group>();
  private ravs: RavMeshes;
  /** One drag per finger: one hand can clear a slot while the other moves a basket into it. */
  private drags = new Map<number, Drag>();
  /** Per-slot hand offset of the top basket in the oil: how far it's slid and lifted. Springs back on release. */
  private slide: number[] = [];
  private lift: number[] = [];
  private slideVel: number[] = [];

  private dom: HTMLElement;
  /** Flavor flashes over a slot right after you drop a basket in, then you're on your own. */
  private dropTags: HTMLElement[] = [];
  private dropTagUntil: number[] = [];
  /** A check over each slot you've picked empty baskets from. */
  private pickTags: HTMLElement[] = [];
  /** Over a basket hooked on a bar: still raw, draining, or drained and ready for the bowl. */
  private drainTags: HTMLElement[] = [];
  /** Follows a carried basket: what happens if you let go here. */
  private carryTags = new Map<number, HTMLElement>();
  private bowlLabel: HTMLElement;
  private freezerBtn: HTMLButtonElement;

  constructor(
    private canvas: HTMLCanvasElement,
    ui: HTMLElement,
    private k: Kitchen,
  ) {
    this.scene.background = new THREE.Color('#1d3d35');
    this.scene.add(new THREE.HemisphereLight('#fff3dc', '#5a3a22', 1.5));
    const key = new THREE.DirectionalLight('#fff6e8', 2.4);
    key.position.set(-3, 10, 6);
    this.scene.add(key);
    this.scene.add(this.fixtures);
    this.ravs = new RavMeshes(this.scene);
    for (const b of k.baskets) {
      const v = longBasketModel(STATION.basketW, STATION.basketD, STATION.basketWall);
      v.visible = false;
      this.scene.add(v);
      this.basketViews.set(b.id, v);
    }

    this.dom = el('div', 'station-ui', ui);
    for (let i = 0; i < k.slots.length; i++) {
      this.dropTags.push(el('div', 'drop-tag', this.dom));
      this.pickTags.push(el('div', 'pick-tag', this.dom));
      this.drainTags.push(el('div', 'drain-tag', this.dom));
    }
    this.bowlLabel = el('div', 'bowl-label', this.dom);
    this.bowlLabel.textContent = 'salt bowl · drop a drained basket here';
    const bar = el('div', 'station-bar', this.dom);
    this.freezerBtn = el('button', 'freezer-btn', bar);
    this.freezerBtn.innerHTML = '<span>FREEZER</span><small>tap empty baskets on the bars to bring them</small>';
    this.freezerBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.k.openFreezer();
      haptic(10);
    });
    const expoBtn = el('button', 'expo-btn', bar);
    expoBtn.innerHTML = '<span>EXPO</span><small>prep boxes</small>';
    expoBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.k.openExpo();
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
      for (const t of this.carryTags.values()) t.remove();
      this.carryTags.clear();
    }
  }

  resize(w: number, h: number) {
    const aspect = w / h;
    this.camera.aspect = aspect;
    const tan = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    const dist = (BANK_W / 2 + 0.25) / (tan * aspect);
    const e = THREE.MathUtils.degToRad(ELEVATION);
    this.camera.position.set(0, Math.sin(e) * dist, Math.cos(e) * dist);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    this.fryerZ = this.groundAt(0.5, V.fryer).z;
    this.bowlZ = this.groundAt(0.5, V.bowl).z;
    this.buildFixtures();
  }

  private buildFixtures() {
    for (const c of [...this.fixtures.children]) this.fixtures.remove(c);
    this.oils = [];
    this.slotX = [];
    const unitW = (BANK_W - 0.3 * (FRYERS.length - 1)) / FRYERS.length;
    FRYERS.forEach((_, f) => {
      const cx = -BANK_W / 2 + unitW / 2 + f * (unitW + 0.3);
      const u = fryerUnit(unitW, FRYER_D, FRYER_TEMPS[f] ?? 300, (FRYERS[f]?.heat ?? 1) > 1);
      u.group.position.set(cx, 0, this.fryerZ);
      this.fixtures.add(u.group);
      this.oils.push(u.oil);
      for (let s = 0; s < SLOTS_PER_FRYER; s++) this.slotX.push(cx + (s - 0.5) * (unitW / 2));
    });
    const wall = wallModel(BANK_W * 3, 14, 0);
    wall.position.set(0, 6, this.fryerZ - FRYER_D / 2 - 0.4);
    this.fixtures.add(wall);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(BANK_W * 3, 30), new THREE.MeshStandardMaterial({ color: '#3a2c22', roughness: 0.8 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, -1.7, this.fryerZ + 8);
    this.fixtures.add(floor);
    // The pass counter in front, with the salt bowl on it.
    const counter = counterModel(-BANK_W / 2, BANK_W / 2, 0, -2);
    counter.position.set(0, -0.6, this.bowlZ);
    counter.scale.set(1, 1, 1.4);
    this.fixtures.add(counter);
    this.bowl.position.set(0, -0.1, this.bowlZ);
    this.fixtures.add(this.bowl);
  }

  private groundAt(u: number, v: number, plane = this.ground) {
    this.raycaster.setFromCamera(new THREE.Vector2(u * 2 - 1, 1 - v * 2), this.camera);
    const p = new THREE.Vector3();
    this.raycaster.ray.intersectPlane(plane, p);
    return p;
  }

  private groundAtClient(e: PointerEvent) {
    return this.groundAt(e.clientX / window.innerWidth, e.clientY / window.innerHeight);
  }

  project(x: number, y: number, z: number) {
    const p = new THREE.Vector3(x, y, z).project(this.camera);
    return { x: ((p.x + 1) / 2) * window.innerWidth, y: ((1 - p.y) / 2) * window.innerHeight };
  }

  private slotNear(x: number, z: number) {
    if (Math.abs(z - this.fryerZ) > FRYER_D / 2 + 0.9) return -1;
    let best = -1;
    let bestD = Infinity;
    this.slotX.forEach((sx, i) => {
      const d = Math.abs(sx - x);
      if (d < bestD) [best, bestD] = [i, d];
    });
    return bestD < 0.75 ? best : -1;
  }

  /** What's under a point: the salt bowl, a slot's oil (front two thirds), or its back bar (back third). */
  private zoneAt(x: number, z: number): Zone {
    if (Math.hypot(x, z - this.bowlZ) < 1.7) return { kind: 'bowl' };
    const slot = this.slotNear(x, z);
    if (slot < 0) return null;
    return { kind: z < this.fryerZ - FRYER_D / 6 ? 'bar' : 'oil', slot };
  }

  // ---------- Input ----------

  private startCarry(e: PointerEvent, b: Basket, from: From) {
    const p = this.groundAtClient(e);
    this.drags.set(e.pointerId, { kind: 'carry', b, from, pos: new THREE.Vector3(p.x, CARRY_Y, p.z), x0: e.clientX, y0: e.clientY, t0: e.timeStamp, moved: false });
    const tag = el('div', 'carry-tag', this.dom);
    this.carryTags.set(e.pointerId, tag);
  }

  private bind() {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      const k = this.k;
      if (k.scene !== 'station' || k.phase !== 'playing') return;
      e.preventDefault();
      const p = this.groundAtClient(e);
      const zone = this.zoneAt(p.x, p.z);
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
      const busy = [...this.drags.values()].some((d) => (d.kind === 'oil' || d.kind === 'empty') && d.slot === slot);
      if (busy) return;
      const hasOil = !!k.slots[slot]?.length;
      const hooked = k.hooked[slot];
      const empties = k.hung[slot]?.length ?? 0;
      // Back bar first if you touched the back, else the oil; fall back to whatever is there.
      const order = zone.kind === 'bar' ? ['hook', 'empty', 'oil'] : ['oil', 'hook', 'empty'];
      for (const what of order) {
        if (what === 'oil' && hasOil) {
          this.drags.set(e.pointerId, { kind: 'oil', slot, y0: e.clientY, wx0: p.x - (this.slide[slot] ?? 0), off: this.slide[slot] ?? 0 });
          haptic(5);
          return;
        }
        if (what === 'hook' && hooked) {
          const b = k.liftHooked(slot);
          if (b) {
            this.startCarry(e, b, { kind: 'hook', slot });
            haptic(8);
          }
          return;
        }
        if (what === 'empty' && empties) {
          this.drags.set(e.pointerId, { kind: 'empty', slot, x0: e.clientX, y0: e.clientY, t0: e.timeStamp });
          return;
        }
      }
    });

    c.addEventListener('pointermove', (e) => {
      const d = this.drags.get(e.pointerId);
      if (!d || this.k.scene !== 'station') return;
      const p = this.groundAtClient(e);
      if (d.kind === 'carry') {
        if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > 10) d.moved = true;
        d.pos.set(p.x, CARRY_Y, p.z);
        return;
      }
      if (d.kind === 'empty') {
        // Dragging an empty basket off the bar: it's in your hand now.
        if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > 12) {
          const b = this.k.liftEmpty(d.slot);
          this.drags.delete(e.pointerId);
          if (b) {
            this.startCarry(e, b, { kind: 'hang', slot: d.slot });
            const c2 = this.drags.get(e.pointerId);
            if (c2?.kind === 'carry') c2.moved = true;
            haptic(8);
          }
        }
        return;
      }
      // In the oil: it slides with your finger inside its slot, and lifts as you drag up.
      const off = Math.max(-STATION.slideMax, Math.min(STATION.slideMax, p.x - d.wx0));
      const before = this.k.slots[d.slot]?.at(-1)?.settle ?? 1;
      this.k.slosh(d.slot, Math.abs(off - d.off));
      if (Math.floor((this.k.slots[d.slot]?.at(-1)?.settle ?? 1) * 3) > Math.floor(before * 3)) haptic(7);
      d.off = off;
      // Up or down out of the slot lifts it into your hand; side to side is the slide.
      const up = Math.max(0, d.y0 - e.clientY);
      const vertical = Math.abs(d.y0 - e.clientY);
      this.lift[d.slot] = Math.min(1, up / STATION.pullPx) * STATION.liftMax;
      if (vertical > STATION.pullPx) {
        // Out of the oil and into your hand.
        this.slide[d.slot] = 0;
        this.lift[d.slot] = 0;
        this.drags.delete(e.pointerId);
        const b = this.k.liftFromOil(d.slot);
        if (b) {
          this.startCarry(e, b, { kind: 'oil', slot: d.slot });
          const c2 = this.drags.get(e.pointerId);
          if (c2?.kind === 'carry') c2.moved = true;
          haptic(14);
        }
      }
    });

    const end = (e: PointerEvent) => {
      const d = this.drags.get(e.pointerId);
      this.drags.delete(e.pointerId);
      this.carryTags.get(e.pointerId)?.remove();
      this.carryTags.delete(e.pointerId);
      if (!d) return;
      const k = this.k;
      if (d.kind === 'oil') {
        this.lift[d.slot] = 0; // short of clear: it drops back into the oil
        return;
      }
      if (d.kind === 'empty') {
        // A tap on an empty basket: pick it to carry into the freezer (tap again to put it back).
        k.toggleSelect(d.slot);
        haptic(8);
        return;
      }
      // Tap a hooked basket: it drops straight back into its own slot's oil.
      if (!d.moved && e.timeStamp - d.t0 < STATION.tapMs) {
        if (d.from.kind === 'hook' && k.placeInOil(d.b, d.from.slot)) haptic(14);
        else k.putBack(d.b, d.from);
        return;
      }
      const zone = this.zoneAt(d.pos.x, d.pos.z);
      let ok = false;
      if (zone?.kind === 'bowl') ok = k.toBowl(d.b, d.from.kind === 'hook' ? k.drainedFor(d.b) : 0);
      else if (zone?.kind === 'oil') ok = d.b.ravs.length ? k.placeInOil(d.b, zone.slot) : k.hookOn(d.b, zone.slot);
      else if (zone?.kind === 'bar') ok = k.hookOn(d.b, zone.slot);
      if (ok) haptic(14);
      else k.putBack(d.b, d.from);
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
  }

  handle(ev: KitchenEvent) {
    switch (ev.type) {
      case 'drop': {
        sfx.drop();
        const tag = this.dropTags[ev.slot];
        if (tag) {
          const f = ev.flavor;
          tag.textContent = f === 'mixed' ? 'MIXED' : f ? FLAVORS[f].short : '';
          tag.style.setProperty('--tint', f && f !== 'mixed' ? FLAVORS[f].tint : '#b5372b');
          this.dropTagUntil[ev.slot] = performance.now() / 1000 + DROP_TAG_SECONDS;
        }
        break;
      }
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
    this.oils.forEach((m, i) => {
      const hot = (FRYERS[i]?.heat ?? 1) > 1;
      m.emissive.set(hot ? '#4a1c04' : '#3a1a02').lerp(new THREE.Color('#6a3208'), (0.5 + 0.5 * Math.sin(now * 2.3 + i)) * 0.4);
    });

    for (const v of this.basketViews.values()) v.visible = false;
    this.ravs.begin();
    let frying = 0;

    const drags = [...this.drags.values()];
    k.slots.forEach((stack, slot) => {
      const x = this.slotX[slot] ?? 0;
      // Hand offset: follows the finger while held, springs back to center when let go.
      const d = drags.find((g) => g.kind === 'oil' && g.slot === slot);
      const held = d?.kind === 'oil';
      const target = d?.kind === 'oil' ? d.off : 0;
      const prev = this.slide[slot] ?? 0;
      const cur = prev + (target - prev) * (held ? 0.6 : 0.18);
      this.slide[slot] = cur;
      this.slideVel[slot] = (cur - prev) * 60;
      if (!held) this.lift[slot] = (this.lift[slot] ?? 0) * 0.8;
      stack.forEach((b, level) => {
        const top = level === stack.length - 1;
        // Nested on an overfull basket, the top one rides high and you can see it.
        const high = level > 0 && (stack[0]?.ravs.length ?? 0) > STATION.nestFullAt;
        const y = level === 0 ? SINK.bottom : SINK.top + (high ? 0.22 : 0);
        const bob = top && b.settle < 1 ? Math.sin(now * 3 + slot) * 0.02 : 0;
        const hx = top ? cur : 0;
        const hy = top ? (this.lift[slot] ?? 0) : 0;
        this.placeBasket(b, x + hx, y + bob + hy, this.fryerZ, now, top, top ? (this.slideVel[slot] ?? 0) : 0);
        if (b.ravs.length) frying++;
      });
    });

    k.hung.forEach((nest, slot) => {
      nest.forEach((b, i) => {
        // A picked basket lifts off the bar a little, ready to carry.
        const picked = k.selected.includes(b) ? 0.75 + 0.05 * Math.sin(now * 6) : 0;
        this.placeBasket(b, this.slotX[slot] ?? 0, HANG.y + i * HANG.nestY + picked, this.fryerZ + HANG.z + i * HANG.nestZ + picked * 0.6, now, false);
      });
      // A full basket hooked on the bar hangs in front of any empties, out of the oil.
      const full = k.hooked[slot];
      if (full) this.placeBasket(full, this.slotX[slot] ?? 0, HANG.y + nest.length * HANG.nestY + 0.1, this.fryerZ + HANG.z + 0.08, now, true);
    });

    for (const d of drags) if (d.kind === 'carry') this.placeBasket(d.b, d.pos.x, d.pos.y, d.pos.z, now, true);

    this.ravs.end();
    sfx.sizzle(frying);
    this.updateDom();
    renderer.render(this.scene, this.camera);
  }

  /** Draw a basket and lay its ravs in it: two columns front to back (one for the big gooey ones). */
  private placeBasket(b: Basket, x: number, y: number, z: number, now: number, showRavs: boolean, vel = 0) {
    const v = this.basketViews.get(b.id);
    if (!v) return;
    v.visible = true;
    v.position.set(x, y, z);
    if (!showRavs) {
      // The lower basket in a nest: hide its ravs under the top basket.
      for (const r of b.ravs) this.ravs.get(r).visible = false;
      return;
    }
    const floating = b.slot !== null && b.settle < 1;
    let cursorZ = -STATION.basketD / 2 + 0.25;
    let layer = 0;
    let col = 0;
    for (const r of b.ravs) {
      const big = FLAVORS[r.flavor].size > 1.2;
      const m = this.ravs.get(r);
      m.visible = true;
      const s = RAV.hx * 2 * FLAVORS[r.flavor].size;
      const cx = big ? 0 : col === 0 ? -0.23 : 0.23;
      const lift = floating ? (1 - b.settle) * (0.14 + 0.05 * Math.sin(now * 4 + r.id)) : 0;
      // Slosh: ravs lag behind the basket when you slide it, floaters more than settled ones.
      const loose = floating ? 1 : 0.35;
      const lag = Math.max(-0.14, Math.min(0.14, -vel * 0.05)) * loose;
      const roll = Math.max(-0.4, Math.min(0.4, vel * 0.08)) * loose;
      m.position.set(x + cx + lag, y + 0.06 + lift + layer * 0.09, z + cursorZ + (m.userData.zj as number) * 0.1);
      m.rotation.set(floating ? (1 - b.settle) * 0.35 * Math.sin(r.id) : 0.02, (m.userData.yaw as number) * 0.4, (floating ? (1 - b.settle) * 0.3 * Math.cos(r.id) : 0) + roll);
      if (big || col === 1) {
        cursorZ += s * 1.02;
        col = 0;
      } else col = 1;
      if (cursorZ > STATION.basketD / 2 - 0.2) {
        // Full layer: start another on top, offset a little so you can see the pile.
        layer++;
        cursorZ = -STATION.basketD / 2 + 0.25 + (layer % 2) * 0.2;
      }
    }
  }

  private place(tag: HTMLElement, x: number, y: number, z: number, dy = 0) {
    const p = this.project(x, y, z);
    // Keep tags on screen: half their width in from each edge.
    const half = (tag.offsetWidth || 80) / 2 + 6;
    const px = Math.max(half, Math.min(window.innerWidth - half, p.x));
    tag.style.transform = `translate(-50%, -50%) translate(${px}px, ${p.y + dy}px)`;
  }

  private updateDom() {
    const k = this.k;
    const free = k.freeBaskets().length;
    const picked = k.selected.length;
    const waiting = k.inFreezer.length;
    this.freezerBtn.disabled = !free && !waiting && !picked;
    const small = picked
      ? `carrying ${picked} basket${picked > 1 ? 's' : ''}${waiting ? ` · ${waiting} still in there` : ''}`
      : waiting
        ? `${waiting} basket${waiting > 1 ? 's' : ''} still in there`
        : 'tap empty baskets on the bars to bring them';
    const sm = this.freezerBtn.querySelector('small');
    if (sm && sm.textContent !== small) sm.textContent = small;
    this.place(this.bowlLabel, 0, -0.1, this.bowlZ + 1.4);
    const inBowl = k.bowl.ravs.length;
    const bowlText = inBowl ? `${inBowl} in the bowl · tap to plate` : 'salt bowl · drop a drained basket here';
    if (this.bowlLabel.textContent !== bowlText) this.bowlLabel.textContent = bowlText;

    this.pickTags.forEach((tag, slot) => {
      const n = k.selected.filter((b) => k.hung[slot]?.includes(b)).length;
      tag.hidden = !n;
      if (n) {
        tag.textContent = n > 1 ? `✓ ${n}` : '✓';
        this.place(tag, this.slotX[slot] ?? 0, 1.6, this.fryerZ);
      }
    });
    this.drainTags.forEach((tag, slot) => {
      const b = k.hooked[slot];
      tag.hidden = !b;
      if (!b) return;
      const cooked = b.ravs.some((r) => r.cooked > 0);
      const drained = k.drainedFor(b) >= STATION.drainSeconds;
      tag.textContent = !cooked ? 'raw · tap to drop' : drained ? 'drained ✓' : 'draining…';
      tag.className = `drain-tag ${!cooked ? 'raw' : drained ? 'ready' : ''}`;
      this.place(tag, this.slotX[slot] ?? 0, 1.35, this.fryerZ + 0.4);
    });
    for (const [id, tag] of this.carryTags) {
      const d = this.drags.get(id);
      if (d?.kind !== 'carry') continue;
      const zone = this.zoneAt(d.pos.x, d.pos.z);
      const full = d.b.ravs.length > 0;
      tag.textContent =
        zone?.kind === 'bowl' ? (full ? 'SALT BOWL' : '') : zone?.kind === 'oil' ? (full ? 'DROP IN' : 'HANG') : zone?.kind === 'bar' ? 'HANG ON BAR' : '';
      tag.hidden = !tag.textContent;
      this.place(tag, d.pos.x, d.pos.y + 0.8, d.pos.z - 1.2);
    }
    const t = performance.now() / 1000;
    this.dropTags.forEach((tag, slot) => {
      const left = (this.dropTagUntil[slot] ?? 0) - t;
      tag.classList.toggle('on', left > 0);
      if (left > 0) this.place(tag, this.slotX[slot] ?? 0, 0.6, this.fryerZ, -(1 - left / DROP_TAG_SECONDS) * 24);
    });
  }
}
