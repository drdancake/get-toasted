import * as THREE from 'three';
import { FLAVORS } from '../config/flavors';
import { FRYER_TEMPS, FRYERS, SLOTS_PER_FRYER } from '../config/game';
import { STATION } from '../config/shift';
import { RAV } from '../config/toss';
import { isFailure } from '../game/doneness';
import { counterModel, fryerUnit, longBasketModel, wallModel } from '../render/models';
import { haptic, sfx } from '../ui/feel';
import { type Basket, Kitchen, type KitchenEvent } from './kitchen';
import { RavMeshes } from './rav-meshes';

const FOV = 38;
const ELEVATION = 58; // degrees above the horizon
const BANK_W = 7.4;
const FRYER_D = 2.9;
const SINK = { bottom: -0.38, top: -0.12 };
/** Where things sit on screen, fraction of height from the top. */
const V = { fryer: 0.39, staged: 0.75 };

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement) => {
  const e = document.createElement(tag);
  e.className = cls;
  parent?.appendChild(e);
  return e;
};

type Drag =
  | { kind: 'staged'; b: Basket; x0: number; y0: number }
  | { kind: 'slot'; slot: number; x0: number; y0: number; lastX: number; dir: number; travel: number; done: boolean };

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
  private stagedX = [-2.4, 0, 2.4];
  private basketViews = new Map<number, THREE.Group>();
  private ravs: RavMeshes;
  private drag: Drag | null = null;
  private dragPos = new THREE.Vector3();

  private dom: HTMLElement;
  private chips: HTMLElement[][] = [];
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
    for (let i = 0; i < k.slots.length; i++) {
      const col: HTMLElement[] = [];
      for (let j = 0; j < STATION.stackMax; j++) {
        const chip = el('button', 'timer-chip', this.dom);
        chip.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const b = this.k.slots[i]?.[this.k.slots[i]!.length - 1 - j];
          if (b && b.timerStart === null) {
            this.k.startTimer(b);
            haptic(8);
          }
        });
        col.push(chip);
      }
      this.chips.push(col);
    }
    this.counterLabel = el('div', 'counter-label', this.dom);
    this.counterLabel.textContent = 'counter';
    const bar = el('div', 'station-bar', this.dom);
    this.freezerBtn = el('button', 'freezer-btn', bar);
    this.freezerBtn.innerHTML = '<span>FREEZER</span><small>tap to open</small>';
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
    this.stagedX = [-2.45, 0, 2.45];
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
      if (slot >= 0 && this.k.slots[slot]?.length) {
        this.drag = { kind: 'slot', slot, x0: e.clientX, y0: e.clientY, lastX: e.clientX, dir: 0, travel: 0, done: false };
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
      if (d.done) return;
      if (d.y0 - e.clientY > STATION.pullPx && Math.abs(e.clientX - d.x0) < d.y0 - e.clientY) {
        d.done = true;
        haptic(14);
        this.k.pull(d.slot);
        this.drag = null;
        return;
      }
      const dx = e.clientX - d.lastX;
      const dir = Math.sign(dx);
      if (dir && dir !== d.dir) {
        if (d.travel > STATION.shakePx) {
          this.k.shake(d.slot);
          haptic(6);
        }
        d.dir = dir;
        d.travel = 0;
      }
      d.travel += Math.abs(dx);
      d.lastX = e.clientX;
    });
    const end = () => {
      const d = this.drag;
      this.drag = null;
      if (!d || d.kind !== 'staged') return;
      const slot = this.slotNear(this.dragPos.x, this.dragPos.z);
      if (slot >= 0 && this.k.dropStaged(d.b, slot)) haptic(16);
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
        sfx.rim();
        break;
      case 'pull':
        sfx.pull();
        break;
      case 'timerStart':
        sfx.catch(2);
        break;
      case 'timerDone':
        sfx.perfect();
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

    k.slots.forEach((stack, slot) => {
      const x = this.slotX[slot] ?? 0;
      stack.forEach((b, level) => {
        const top = level === stack.length - 1;
        const y = level === 0 ? SINK.bottom : SINK.top;
        const bob = top && b.settle < 1 ? Math.sin(now * 3 + slot) * 0.02 : 0;
        this.placeBasket(b, x, y + bob, this.fryerZ, now, top);
        if (b.ravs.length) frying++;
      });
    });

    k.staged.forEach((b, i) => this.placeBasket(b, this.stagedX[i] ?? 0, 0.05, this.stagedZ, now, true));
    const d = this.drag;
    if (d?.kind === 'staged') this.placeBasket(d.b, this.dragPos.x, this.dragPos.y, this.dragPos.z, now, true);

    this.ravs.end();
    sfx.sizzle(frying);
    this.updateDom(now);
    renderer.render(this.scene, this.camera);
  }

  /** Draw a basket and lay its ravs in it: two columns front to back (one for the big gooey ones). */
  private placeBasket(b: Basket, x: number, y: number, z: number, now: number, showRavs: boolean) {
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
      m.position.set(x + cx, y + 0.06 + lift, z + cursorZ + (m.userData.zj as number) * 0.1);
      m.rotation.set(floating ? (1 - b.settle) * 0.35 * Math.sin(r.id) : 0.02, (m.userData.yaw as number) * 0.4, floating ? (1 - b.settle) * 0.3 * Math.cos(r.id) : 0);
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
    this.rack.innerHTML = `<b>${free}</b> clean basket${free === 1 ? '' : 's'}`;
    this.freezerBtn.disabled = !free || k.staged.length >= STATION.stagedMax;
    const cp = this.project(0, 0.2, this.stagedZ + 1.5);
    this.counterLabel.style.transform = `translate(-50%, 0) translate(${cp.x}px, ${cp.y}px)`;
    this.counterLabel.hidden = k.staged.length > 0;

    k.slots.forEach((stack, slot) => {
      const chips = this.chips[slot] ?? [];
      const p = this.project(this.slotX[slot] ?? 0, -0.75, this.fryerZ + FRYER_D / 2 + 0.25);
      chips.forEach((chip, j) => {
        const b = stack[stack.length - 1 - j];
        chip.hidden = !b || !b.ravs.length;
        if (!b || chip.hidden) return;
        chip.style.transform = `translate(-50%, 0) translate(${p.x}px, ${p.y + j * 40}px)`;
        const f = b.flavor;
        const name = f === 'mixed' ? 'MIXED' : f ? FLAVORS[f].short : '';
        const left = k.timerLeft(b);
        const anyBad = b.ravs.some((r) => isFailure(k.qualityOf(r)) && k.qualityOf(r) !== 'cold');
        chip.className = 'timer-chip';
        if (f === 'mixed') chip.classList.add('mixed');
        if (anyBad) chip.classList.add('burnt');
        if (left === null) chip.innerHTML = `${name}<b><i>▶</i>timer</b>`;
        else if (left > 0) chip.innerHTML = `${name}<b>${Math.ceil(left)}s</b>`;
        else {
          chip.innerHTML = `${name}<b>PULL</b>`;
          chip.classList.add('ring');
        }
        if (j === 0 && b.settle < 1) chip.classList.add('float');
        void now;
      });
    });
  }
}
