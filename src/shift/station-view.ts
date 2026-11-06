import * as THREE from 'three';
import { FLAVORS } from '../config/flavors';
import { FRYER_TEMPS, FRYERS, SLOTS_PER_FRYER } from '../config/game';
import { DROP_TAG_SECONDS, STATION } from '../config/shift';
import { RAV } from '../config/toss';
import { counterModel, fryerUnit, longBasketModel, wallModel } from '../render/models';
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
/** Where things sit on screen, fraction of height from the top. */
const V = { fryer: 0.47, staged: 0.79 };

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement) => {
  const e = document.createElement(tag);
  e.className = cls;
  parent?.appendChild(e);
  return e;
};

type Drag =
  | { kind: 'staged'; b: Basket; x0: number; y0: number }
  | { kind: 'slot'; slot: number; y0: number; wx0: number; off: number };

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
  private stagedZ = 3;
  private stagedX = [-2.7, -0.9, 0.9, 2.7];
  private basketViews = new Map<number, THREE.Group>();
  private ravs: RavMeshes;
  private drag: Drag | null = null;
  private dragPos = new THREE.Vector3();
  /** Per-slot hand offset of the top basket: how far it's slid and lifted. Springs back on release. */
  private slide: number[] = [];
  private lift: number[] = [];
  private slideVel: number[] = [];

  private dom: HTMLElement;
  /** Flavor flashes over a slot right after you drop a basket in, then you're on your own. */
  private dropTags: HTMLElement[] = [];
  private dropTagUntil: number[] = [];
  /** A check over each slot you've picked baskets from. */
  private pickTags: HTMLElement[] = [];
  private freezerBtn: HTMLButtonElement;
  private rack: HTMLElement;
  private counterLabel: HTMLElement;

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
    for (let i = 0; i < k.slots.length; i++) this.dropTags.push(el('div', 'drop-tag', this.dom));
    for (let i = 0; i < k.slots.length; i++) this.pickTags.push(el('div', 'pick-tag', this.dom));
    this.counterLabel = el('div', 'counter-label', this.dom);
    this.counterLabel.textContent = 'counter';
    const bar = el('div', 'station-bar', this.dom);
    this.freezerBtn = el('button', 'freezer-btn', bar);
    this.freezerBtn.innerHTML = '<span>FREEZER</span><small>tap empty baskets on the bars to bring them</small>';
    this.freezerBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.k.openFreezer();
      haptic(10);
    });
    this.rack = el('div', 'rack', bar);

    this.bind();
  }

  setVisible(on: boolean) {
    this.dom.hidden = !on;
    if (!on) this.drag = null;
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
    // Find the z on the ground that lands at the fryer row, then move the bank there.
    this.fryerZ = this.groundAt(0.5, V.fryer).z;
    this.stagedZ = this.groundAt(0.5, V.staged).z;
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
    // Tile wall standing behind the fryer bank.
    const wall = wallModel(BANK_W * 3, 14, 0);
    wall.position.set(0, 6, this.fryerZ - FRYER_D / 2 - 0.4);
    this.fixtures.add(wall);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(BANK_W * 3, 30), new THREE.MeshStandardMaterial({ color: '#3a2c22', roughness: 0.8 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, -1.7, this.fryerZ + 8);
    this.fixtures.add(floor);
    const counter = counterModel(-BANK_W / 2, BANK_W / 2, 0, -2);
    counter.rotation.x = 0;
    counter.position.set(0, -0.6, this.stagedZ);
    counter.scale.set(1, 1, 1.4);
    this.fixtures.add(counter);
    this.stagedX = [-2.7, -0.9, 0.9, 2.7];
  }

  private groundAt(u: number, v: number, plane = this.ground) {
    this.raycaster.setFromCamera(new THREE.Vector2(u * 2 - 1, 1 - v * 2), this.camera);
    const p = new THREE.Vector3();
    this.raycaster.ray.intersectPlane(plane, p);
    return p;
  }

  private project(x: number, y: number, z: number) {
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

  // ---------- Input ----------

  private bind() {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      if (this.k.scene !== 'station' || this.k.phase !== 'playing') return;
      e.preventDefault();
      const p = this.groundAt(e.clientX / window.innerWidth, e.clientY / window.innerHeight);
      // A staged basket on the counter?
      const si = this.k.staged.findIndex((_, i) => Math.abs(p.x - (this.stagedX[i] ?? 0)) < 1.0 && Math.abs(p.z - this.stagedZ) < 1.8);
      const staged = this.k.staged[si];
      if (staged) {
        this.drag = { kind: 'staged', b: staged, x0: e.clientX, y0: e.clientY };
        this.dragPos.set(this.stagedX[si] ?? 0, 0.3, this.stagedZ);
        haptic(6);
        return;
      }
      const slot = this.slotNear(p.x, p.z);
      // An empty basket hung on the bar: pick it to carry into the freezer (tap again to put it back).
      if (slot >= 0 && !this.k.slots[slot]?.length && this.k.hung[slot]?.length) {
        haptic(8);
        this.k.toggleSelect(slot);
        return;
      }
      if (slot >= 0 && this.k.slots[slot]?.length) {
        this.drag = { kind: 'slot', slot, y0: e.clientY, wx0: p.x - (this.slide[slot] ?? 0), off: this.slide[slot] ?? 0 };
        haptic(5);
      }
    });
    c.addEventListener('pointermove', (e) => {
      const d = this.drag;
      if (!d || this.k.scene !== 'station') return;
      if (d.kind === 'staged') {
        const p = this.groundAt(e.clientX / window.innerWidth, e.clientY / window.innerHeight);
        this.dragPos.set(p.x, 0.35, p.z);
        return;
      }
      // The basket is in your hand: it slides with your finger inside its slot, and lifts as you drag up.
      const p = this.groundAt(e.clientX / window.innerWidth, e.clientY / window.innerHeight);
      const off = Math.max(-STATION.slideMax, Math.min(STATION.slideMax, p.x - d.wx0));
      const before = this.k.slots[d.slot]?.at(-1)?.settle ?? 1;
      this.k.slosh(d.slot, Math.abs(off - d.off));
      if (Math.floor((this.k.slots[d.slot]?.at(-1)?.settle ?? 1) * 3) > Math.floor(before * 3)) haptic(7);
      d.off = off;
      const up = Math.max(0, d.y0 - e.clientY);
      this.lift[d.slot] = Math.min(1, up / STATION.pullPx) * STATION.liftMax;
      if (up > STATION.pullPx) {
        haptic(14);
        this.slide[d.slot] = 0;
        this.lift[d.slot] = 0;
        this.k.pull(d.slot);
        this.drag = null;
      }
    });
    const end = () => {
      const d = this.drag;
      this.drag = null;
      if (d?.kind === 'slot') this.lift[d.slot] = 0; // short of clear: it drops back into the oil
      if (!d || d.kind !== 'staged') return;
      const slot = this.slotNear(this.dragPos.x, this.dragPos.z);
      if (slot >= 0 && this.k.dropStaged(d.b, slot)) haptic(16);
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
        sfx.rim();
        break;
      case 'pull':
      case 'drop':
        break;
      case 'pull':
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

    const d = this.drag;
    k.slots.forEach((stack, slot) => {
      const x = this.slotX[slot] ?? 0;
      // Hand offset: follows the finger while held, springs back to center when let go.
      const held = d?.kind === 'slot' && d.slot === slot;
      const target = held ? d.off : 0;
      const prev = this.slide[slot] ?? 0;
      const cur = prev + (target - prev) * (held ? 0.6 : 0.18);
      this.slide[slot] = cur;
      this.slideVel[slot] = (cur - prev) * 60;
      if (!held) this.lift[slot] = (this.lift[slot] ?? 0) * 0.8;
      stack.forEach((b, level) => {
        const top = level === stack.length - 1;
        const y = level === 0 ? SINK.bottom : SINK.top;
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
    });
    k.staged.forEach((b, i) => this.placeBasket(b, this.stagedX[i] ?? 0, 0.05, this.stagedZ, now, true));
    if (d?.kind === 'staged') this.placeBasket(d.b, this.dragPos.x, this.dragPos.y, this.dragPos.z, now, true);

    this.ravs.end();
    sfx.sizzle(frying);
    this.updateDom(now);
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
      m.position.set(x + cx + lag, y + 0.06 + lift, z + cursorZ + (m.userData.zj as number) * 0.1);
      m.rotation.set(floating ? (1 - b.settle) * 0.35 * Math.sin(r.id) : 0.02, (m.userData.yaw as number) * 0.4, (floating ? (1 - b.settle) * 0.3 * Math.cos(r.id) : 0) + roll);
      if (big || col === 1) {
        cursorZ += s * 1.02;
        col = 0;
      } else col = 1;
      if (cursorZ > STATION.basketD / 2 - 0.2) cursorZ = -STATION.basketD / 2 + 0.3; // second layer
    }
  }

  private updateDom(now: number) {
    const k = this.k;
    const free = k.freeBaskets().length;
    this.rack.hidden = true;
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
    const cp = this.project(0, 0.2, this.stagedZ + 1.5);
    this.counterLabel.style.transform = `translate(-50%, 0) translate(${cp.x}px, ${cp.y}px)`;
    this.counterLabel.hidden = k.staged.length > 0;

    this.pickTags.forEach((tag, slot) => {
      const n = k.selected.filter((b) => k.hung[slot]?.includes(b)).length;
      tag.hidden = !n || k.scene !== 'station';
      if (tag.hidden) return;
      tag.textContent = n > 1 ? `✓ ${n}` : '✓';
      const p = this.project(this.slotX[slot] ?? 0, 1.6, this.fryerZ);
      tag.style.transform = `translate(-50%, -50%) translate(${p.x}px, ${p.y}px)`;
    });
    const t = performance.now() / 1000;
    this.dropTags.forEach((tag, slot) => {
      const left = (this.dropTagUntil[slot] ?? 0) - t;
      tag.classList.toggle('on', left > 0);
      if (left <= 0) return;
      const p = this.project(this.slotX[slot] ?? 0, 0.6, this.fryerZ);
      tag.style.transform = `translate(-50%, -50%) translate(${p.x}px, ${p.y - (1 - left / DROP_TAG_SECONDS) * 24}px)`;
    });
    void now;
  }
}
