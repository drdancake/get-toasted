import * as THREE from 'three';
import { FLAVORS, SHIFT_FLAVORS } from '../config/flavors';
import { FREEZER, PASS, PLATE, STATION } from '../config/shift';
import { BASKET, BOX, RAV, WORLD } from '../config/toss';
import { bagModel, basketModel, boxModel, counterModel, freezerModel, ravGeometry, wallModel } from '../render/models';
import { haptic, sfx } from '../ui/feel';
import { type Basket, type Box, itemLabel, type Kitchen, type KitchenEvent, spoutOf } from './kitchen';
import { halfOf, type Rav } from './physics';
import { RavMeshes } from './rav-meshes';

const FOV = 40;
const TILT_DEG = 16;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement) => {
  const e = document.createElement(tag);
  e.className = cls;
  parent?.appendChild(e);
  return e;
};

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  g: number;
  color: THREE.Color;
}

class Particles {
  mesh: THREE.InstancedMesh;
  private list: Particle[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  constructor(cap = 300) {
    this.mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshBasicMaterial(), cap);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < cap; i++) this.mesh.setColorAt(i, new THREE.Color());
    this.mesh.count = 0;
  }
  /** Fall straight down in a little cone (salt). */
  sprinkle(x: number, y: number, n: number, color: THREE.Color) {
    for (let i = 0; i < n; i++) {
      this.list.push({ x: x + rnd(-0.12, 0.12), y, z: rnd(-0.1, 0.3), vx: rnd(-0.6, 0.6), vy: rnd(-4, -2), life: rnd(0.25, 0.45), max: 0.45, size: 0.025, g: -12, color });
    }
  }
  burst(x: number, y: number, n: number, color: THREE.Color, speed: number, size: number, g: number) {
    for (let i = 0; i < n; i++) {
      const a = rnd(0.15, Math.PI - 0.15);
      const s = rnd(0.4, 1) * speed;
      this.list.push({ x: x + rnd(-0.3, 0.3), y, z: rnd(-0.2, 0.4), vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rnd(0.35, 0.8), max: 0.8, size: size * rnd(0.6, 1.3), g, color });
    }
    if (this.list.length > 300) this.list.splice(0, this.list.length - 300);
  }
  update(dt: number) {
    this.list = this.list.filter((p) => (p.life -= dt) > 0);
    this.list.forEach((p, i) => {
      p.vy += p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      this.s.setScalar(Math.max(0.0001, p.size * Math.min(1, (p.life / p.max) * 2.5)));
      this.m.compose(this.v.set(p.x, p.y, p.z), this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
      this.mesh.setColorAt(i, p.color);
    });
    this.mesh.count = this.list.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

const FROST = new THREE.Color('#eaf6ff');
const CRUMB = new THREE.Color('#a8662a');
const SALT = new THREE.Color('#ffffff');

/** The salt shaker: a glass-ish body, a steel cap with holes. Origin at its middle. */
function shakerModel() {
  const g = new THREE.Group();
  const glass = new THREE.MeshStandardMaterial({ color: '#e9eef2', roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.75 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.25, 0.62, 12), glass);
  body.position.y = -0.1;
  g.add(body);
  const fill = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.22, 0.4, 12), new THREE.MeshStandardMaterial({ color: '#fafaf6', roughness: 1 }));
  fill.position.y = -0.2;
  g.add(fill);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.23, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#c9ced3', metalness: 0.8, roughness: 0.25 }));
  cap.position.y = 0.2;
  g.add(cap);
  return g;
}

/**
 * The salt bowl at the pass, sized to the physics bowl (origin at the floor center).
 * The back half is polished steel; the front half is see-through so you can watch the ravs inside.
 */
function platingBowl(w: number, wall: number) {
  const g = new THREE.Group();
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    pts.push(new THREE.Vector2(w * 0.43 + Math.sin((t * Math.PI) / 2) * w * 0.07, (1 - Math.cos((t * Math.PI) / 2)) * wall));
  }
  const steel = new THREE.MeshStandardMaterial({ color: '#d6dbe0', metalness: 0.7, roughness: 0.22, side: THREE.DoubleSide });
  const glassy = new THREE.MeshStandardMaterial({ color: '#d6dbe0', metalness: 0.6, roughness: 0.25, transparent: true, opacity: 0.42, depthWrite: false, side: THREE.DoubleSide });
  g.add(new THREE.Mesh(new THREE.LatheGeometry(pts, 24, Math.PI / 2, Math.PI), steel));
  g.add(new THREE.Mesh(new THREE.LatheGeometry(pts, 24, -Math.PI / 2, Math.PI), glassy));
  const floor = new THREE.Mesh(new THREE.CircleGeometry(w * 0.43, 24), steel);
  floor.rotation.x = -Math.PI / 2;
  g.add(floor);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(w / 2, 0.045, 6, 40), steel);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = wall;
  g.add(rim);
  // Salt in the bottom once you've shaken some in.
  const salt = new THREE.Mesh(new THREE.CircleGeometry(w * 0.36, 16), new THREE.MeshStandardMaterial({ color: '#f4f4f0', roughness: 1 }));
  salt.rotation.x = -Math.PI / 2;
  salt.position.y = 0.03;
  g.add(salt);
  g.scale.z = 0.7;
  return g;
}

type Grip =
  /** A basket held by its body: it follows your finger (freezer catch, pass carry). */
  | { kind: 'basket'; b: Basket; dx: number; dy: number; hist: { x: number; y: number; t: number }[]; x0: number; y0: number; t0: number; moved: boolean }
  | { kind: 'rav'; r: Rav; dx: number; dy: number }
  | { kind: 'bowl'; dx: number; dy: number }
  | { kind: 'shaker'; dx: number; dy: number; lastY: number; dir: number; turnY: number; moved: boolean }
  | { kind: 'box'; box: Box; y0: number };

/** Freezer and pass microgames: side view, things follow your fingers. */
export class SideView {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);
  private raycaster = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  private fixtures = new THREE.Group();
  /** One mesh per basket you can hold at once: a pivot at the near (left) rim, the model inside it. */
  private basketMeshes: THREE.Group[] = [];
  private boxMeshes = new Map<number, { g: THREE.Group; w: number }>();
  private bowl = platingBowl(PLATE.bowlW, PLATE.bowlWall);
  private bowlSalt: THREE.Mesh;
  private shaker = shakerModel();
  private bags: THREE.Group[] = [];
  private bagSquash: number[] = [];
  private ravs: RavMeshes;
  private particles = new Particles();
  private grips = new Map<number, Grip>();

  private dom: HTMLElement;
  private tags: HTMLElement[] = [];
  private boxLabels = new Map<number, HTMLElement>();
  private bowlLabel: HTMLElement;
  private freezerBar: HTMLElement;
  private passBar: HTMLElement;

  constructor(
    private canvas: HTMLCanvasElement,
    ui: HTMLElement,
    private k: Kitchen,
  ) {
    this.scene.add(new THREE.HemisphereLight('#fff3dc', '#5a3a22', 1.4));
    const key = new THREE.DirectionalLight('#fff6e8', 2.6);
    key.position.set(-3, 9, 10);
    this.scene.add(key);
    this.scene.add(this.fixtures, this.particles.mesh);
    this.ravs = new RavMeshes(this.scene);
    for (let i = 0; i < FREEZER.maxBaskets; i++) {
      const pivot = new THREE.Group();
      const m = basketModel(BASKET.width, BASKET.wall);
      m.position.set(0, -BASKET.wall / 2, 0);
      pivot.add(m);
      pivot.visible = false;
      this.basketMeshes.push(pivot);
      this.scene.add(pivot);
    }
    this.bowlSalt = this.bowl.children[this.bowl.children.length - 1] as THREE.Mesh;
    this.scene.add(this.bowl, this.shaker);
    const geo = ravGeometry(0);
    SHIFT_FLAVORS.forEach((f) => {
      const bag = bagModel(FLAVORS[f].short, geo, FLAVORS[f].tint);
      bag.scale.setScalar(0.78);
      this.bags.push(bag);
      this.bagSquash.push(0);
      this.scene.add(bag);
    });

    this.dom = el('div', 'side-ui', ui);
    for (let i = 0; i < FREEZER.maxBaskets; i++) this.tags.push(el('div', 'basket-tag', this.dom));
    this.bowlLabel = el('div', 'bowl-tag', this.dom);
    this.freezerBar = el('div', 'scene-bar', this.dom);
    el('div', 'scene-hint', this.freezerBar).textContent = 'tap a rav in a basket to pick it out';
    const done = el('button', 'scene-btn primary', this.freezerBar);
    done.textContent = 'WALK OUT';
    done.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.k.closeFreezer();
      haptic(10);
    });
    this.passBar = el('div', 'scene-bar', this.dom);
    el('div', 'scene-hint', this.passBar).textContent = 'drag the basket over the bowl · salt + toss · fill boxes · swipe up';
    const back = el('button', 'scene-btn', this.passBar);
    back.textContent = 'BACK TO FRYERS';
    back.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.k.leavePass();
      haptic(10);
    });
    this.bind();
  }

  setVisible(on: boolean) {
    this.dom.hidden = !on;
    if (!on) this.letGoAll();
  }

  /** Drop everything your fingers were holding (scene change). */
  private letGoAll() {
    for (const g of this.grips.values()) {
      if (g.kind === 'rav') this.k.dropRav(g.r);
      else if (g.kind === 'bowl') this.k.releaseBowl();
      else if (g.kind === 'basket') this.k.release(g.b, 0, 0);
    }
    this.grips.clear();
  }

  resize(w: number, h: number) {
    const aspect = w / h;
    this.camera.aspect = aspect;
    const tan = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    const dist = WORLD.width / 2 / (tan * aspect);
    this.camera.position.set(0, dist * Math.tan(THREE.MathUtils.degToRad(TILT_DEG)), dist);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    this.layout();
  }

  /** Rebuild the backdrop for whichever room you're in and tell the kitchen where things are. */
  layout() {
    const at = (u: number, v: number) => this.worldAt(u, v);
    const leftX = at(0, 0.6).x;
    const rightX = at(1, 0.6).x;
    const topY = at(0.5, 0).y;
    for (const c of [...this.fixtures.children]) this.fixtures.remove(c);

    const shelfY = at(0.5, FREEZER.shelfV).y;
    const floorY = shelfY + 0.1; // a rav that falls back to the bins is dead
    const bagX = FREEZER.bagU.map((u) => at(u, FREEZER.shelfV).x);
    this.k.freezerGeo = { leftX, rightX, topY, floorY, bagY: shelfY, bagX, homeX: 0, homeY: shelfY + 3.2 };
    const counterY = at(0.5, PASS.counterV).y;
    const rackY = at(0.5, PASS.bowlV).y;
    const bowlX = at(PASS.bowlU, PASS.bowlV).x;
    // The basket comes in with its near corner (the spout) just right of the bowl's middle.
    // Where the basket's tipped pour corner sits relative to its middle.
    const spoutOff = spoutOf({ x: 0, y: 0, w: BASKET.width, wall: BASKET.wall }, 1).x;
    const homeX = bowlX + PLATE.bowlW / 2 - PLATE.pourMargin + PASS.spoutLead + PLATE.pourDrift - spoutOff;
    this.k.passGeo = {
      leftX,
      rightX,
      topY,
      counterY,
      homeX,
      homeY: rackY + PLATE.bowlWall + PASS.basketAbove,
      bowlX,
      bowlY: rackY,
      shakerX: at(PASS.shakerU, PASS.bowlV).x,
      shakerY: rackY + 0.42,
    };

    if (this.k.scene === 'freezer') {
      this.scene.background = new THREE.Color('#9fbfd0');
      this.fixtures.add(freezerModel(WORLD.width * 1.6, shelfY, at(0.5, 1.02).y, topY));
      this.bags.forEach((b, i) => {
        b.visible = true;
        b.position.set(bagX[i] ?? 0, shelfY, -0.2);
      });
    } else {
      this.scene.background = new THREE.Color('#2a1f17');
      // The metal table the boxes sit on.
      this.fixtures.add(counterModel(leftX, rightX, counterY, at(0.5, 1.05).y));
      const bot = at(0.5, 1.1).y;
      this.fixtures.add(wallModel(WORLD.width * 2.2, topY - bot + 4, (topY + bot) / 2));
      // A steel rack on the wall for the bowl and the shaker.
      const steel = new THREE.MeshStandardMaterial({ color: '#9aa1a7', metalness: 0.7, roughness: 0.3 });
      const sx = this.k.passGeo.shakerX;
      const rack = new THREE.Mesh(new THREE.BoxGeometry(bowlX + PLATE.bowlW / 2 + 0.2 - (sx - 0.5), 0.08, 1.2), steel);
      rack.position.set((bowlX + PLATE.bowlW / 2 + 0.2 + sx - 0.5) / 2, rackY - 0.04, -0.3);
      this.fixtures.add(rack);
      for (const bx of [sx - 0.3, bowlX + PLATE.bowlW / 2]) {
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 0.06), steel);
        arm.position.set(bx, rackY - 0.3, -0.85);
        arm.rotation.x = 0.9;
        this.fixtures.add(arm);
      }
      for (const b of this.bags) b.visible = false;
    }
  }

  private worldAt(u: number, v: number) {
    this.raycaster.setFromCamera(new THREE.Vector2(u * 2 - 1, 1 - v * 2), this.camera);
    const p = new THREE.Vector3();
    this.raycaster.ray.intersectPlane(this.plane, p);
    return p;
  }

  project(x: number, y: number) {
    const p = new THREE.Vector3(x, y, 0).project(this.camera);
    return { x: ((p.x + 1) / 2) * window.innerWidth, y: ((1 - p.y) / 2) * window.innerHeight };
  }

  // ---------- Input ----------

  private bind() {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      const k = this.k;
      if (k.scene === 'station' || k.scene === 'expo' || k.phase !== 'playing') return;
      e.preventDefault();
      const p = this.worldAt(e.clientX / window.innerWidth, e.clientY / window.innerHeight);
      if (k.scene === 'pass') {
        this.passDown(e, p.x, p.y);
        return;
      }
      // Freezer: each finger can hold its own basket.
      const b = k.handAt(p.x, p.y);
      if (b) {
        const off = k.grab(b, p.x, p.y);
        if (off) {
          this.grips.set(e.pointerId, { kind: 'basket', b, dx: off.dx, dy: off.dy, hist: [{ x: p.x, y: p.y, t: e.timeStamp }], x0: e.clientX, y0: e.clientY, t0: e.timeStamp, moved: false });
          haptic(6);
          return;
        }
      }
      if (k.freezerGeo) {
        const g = k.freezerGeo;
        let best = -1;
        let bestD = Infinity;
        g.bagX.forEach((x, i) => {
          const d = Math.abs(p.x - x);
          if (d < bestD) [best, bestD] = [i, d];
        });
        if (best >= 0 && bestD < 0.9 && p.y < g.bagY + 1.3 && p.y > g.bagY - 0.8 && k.tapBag(best)) {
          this.bagSquash[best] = 1;
          haptic(5);
        }
      }
    });
    c.addEventListener('pointermove', (e) => {
      const g = this.grips.get(e.pointerId);
      if (!g) return;
      const p = this.worldAt(e.clientX / window.innerWidth, e.clientY / window.innerHeight);
      const k = this.k;
      switch (g.kind) {
        case 'basket':
          if (Math.hypot(e.clientX - g.x0, e.clientY - g.y0) > 10) g.moved = true;
          k.moveHand(g.b, p.x + g.dx, p.y + g.dy);
          g.hist.push({ x: p.x, y: p.y, t: e.timeStamp });
          while (g.hist.length > 2 && e.timeStamp - (g.hist[0]?.t ?? 0) > 160) g.hist.shift();
          break;
        case 'rav':
          k.moveRav(g.r, p.x + g.dx, p.y + g.dy);
          break;
        case 'bowl':
          k.moveBowl(p.x + g.dx, p.y + g.dy);
          break;
        case 'shaker': {
          const y = p.y + g.dy;
          k.moveShaker(p.x + g.dx, y);
          g.moved = true;
          // A shake is a down-stroke that turns back up.
          const dir = Math.sign(y - g.lastY);
          if (dir && dir !== g.dir) {
            if (g.dir < 0 && g.turnY - g.lastY > PASS.shakeStroke) this.shake();
            g.dir = dir;
            g.turnY = g.lastY;
          }
          g.lastY = y;
          break;
        }
        case 'box':
          if (p.y - g.y0 > BOX.serveSwipe) {
            this.grips.delete(e.pointerId);
            k.serve(g.box);
            haptic(14);
          }
          break;
      }
    });
    const end = (e: PointerEvent) => {
      const g = this.grips.get(e.pointerId);
      if (!g) return;
      this.grips.delete(e.pointerId);
      const k = this.k;
      switch (g.kind) {
        case 'basket': {
          // Freezer: a tap (no drag) on a basket picks out the rav under your finger.
          if (k.scene === 'freezer' && !g.moved && e.timeStamp - g.t0 < STATION.tapMs) {
            g.b.held = false;
            const p = this.worldAt(e.clientX / window.innerWidth, e.clientY / window.innerHeight);
            const r = k.ravAt(g.b, p.x, p.y);
            if (r) {
              k.pickOut(g.b, r);
              haptic(8);
            }
            return;
          }
          const v = velocity(g.hist, e.timeStamp);
          const had = g.b.ravs.length;
          k.release(g.b, v.vx, v.vy);
          if (had && !g.b.ravs.length) haptic(12);
          break;
        }
        case 'rav':
          k.dropRav(g.r);
          haptic(4);
          break;
        case 'bowl':
          k.releaseBowl();
          break;
        case 'shaker':
          if (!g.moved) this.shake();
          k.shaker.held = false;
          if (k.passGeo) k.moveShaker(k.passGeo.shakerX, k.passGeo.shakerY);
          break;
        case 'box':
          break;
      }
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
  }

  private shake() {
    this.k.shakeSalt();
    haptic(4);
  }

  /**
   * At the pass, a touch takes the first thing under it. Pouring is two-handed like the line:
   * basket in one thumb (by its body or handle), bowl in the other (anywhere, while there's a basket to pour).
   */
  private passDown(e: PointerEvent, x: number, y: number) {
    const k = this.k;
    const id = e.pointerId;
    const startBasket = (b: Basket) => {
      const off = k.grab(b, x, y);
      if (!off) return false;
      this.grips.set(id, { kind: 'basket', b, dx: off.dx, dy: off.dy, hist: [{ x, y, t: e.timeStamp }], x0: e.clientX, y0: e.clientY, t0: e.timeStamp, moved: false });
      haptic(6);
      return true;
    };
    for (const b of k.hands) {
      if (b.held || !b.ravs.length || b.flavor === 'gooey') continue;
      const hx = x - (b.x + b.w / 2);
      const hy = y - (b.y + b.wall);
      const onHandle = hx > -0.25 && hx < 1.3 && hy > -0.5 && hy < 1.3;
      const onBody = Math.abs(x - b.x) < b.w / 2 + 0.3 && y > b.y - 0.6 && y < b.top + 0.6;
      if ((onHandle || onBody) && startBasket(b)) return;
    }
    if (k.hands.some((b) => b.ravs.length && b.flavor !== 'gooey') && k.bowlAt(x, y) && !k.bowl.held) {
      const off = k.grabBowl(x, y);
      this.grips.set(id, { kind: 'bowl', dx: off.dx, dy: off.dy });
      haptic(6);
      return;
    }
    for (const b of k.hands) {
      const hx = x - (b.x + b.w / 2);
      const hy = y - (b.y + b.wall);
      if (!b.held && hx > -0.25 && hx < 1.3 && hy > -0.5 && hy < 1.3 && startBasket(b)) return;
    }
    if (k.shakerAt(x, y) && !k.shaker.held) {
      k.shaker.held = true;
      this.grips.set(id, { kind: 'shaker', dx: k.shaker.x - x, dy: k.shaker.y - y, lastY: k.shaker.y, dir: 0, turnY: k.shaker.y, moved: false });
      haptic(5);
      return;
    }
    // The bowl's lip (its sides or underneath) grabs the bowl; inside, your fingers find a rav.
    const bw = k.bowl;
    const onLip = k.bowlAt(x, y) && (Math.abs(x - bw.x) > bw.w / 2 - PASS.bowlLip || y < bw.y - 0.05);
    if (onLip && !bw.held) {
      const off = k.grabBowl(x, y);
      this.grips.set(id, { kind: 'bowl', dx: off.dx, dy: off.dy });
      haptic(6);
      return;
    }
    // A box by its walls or bottom: swipe it up to serve. Inside, you're arranging ravs.
    const lipBox = k.boxAt(x, y);
    if (lipBox && (y < lipBox.y + 0.02 || Math.abs(x - lipBox.x) > lipBox.w / 2 - 0.2)) {
      this.grips.set(id, { kind: 'box', box: lipBox, y0: y });
      return;
    }
    const r = k.pickRav(x, y);
    if (r) {
      this.grips.set(id, { kind: 'rav', r, dx: r.x - x, dy: r.y - y + PASS.liftRav });
      k.moveRav(r, r.x, r.y + PASS.liftRav);
      haptic(5);
      return;
    }
    const b = k.handAt(x, y);
    if (b) {
      const off = k.grab(b, x, y);
      if (off) {
        this.grips.set(id, { kind: 'basket', b, dx: off.dx, dy: off.dy, hist: [{ x, y, t: e.timeStamp }], x0: e.clientX, y0: e.clientY, t0: e.timeStamp, moved: false });
        haptic(6);
        return;
      }
    }
    if (k.bowlAt(x, y) && !k.bowl.held) {
      const off = k.grabBowl(x, y);
      this.grips.set(id, { kind: 'bowl', dx: off.dx, dy: off.dy });
      haptic(6);
      return;
    }
    const box = k.boxAt(x, y);
    if (box) this.grips.set(id, { kind: 'box', box, y0: y });
  }

  handle(ev: KitchenEvent) {
    switch (ev.type) {
      case 'scene':
        this.letGoAll();
        if (ev.scene !== 'station' && ev.scene !== 'expo') this.layout();
        break;
      case 'launch':
        sfx.launch();
        this.particles.burst(ev.x, ev.y, 5, FROST, 1.5, 0.05, 1);
        break;
      case 'catch':
        sfx.catch(ev.into === 'bowl' ? Math.min(ev.count, 8) * 0.3 : ev.count);
        break;
      case 'rim':
      case 'spill':
        sfx.rim();
        break;
      case 'dead':
        sfx.splat();
        this.particles.burst(ev.x, ev.y, 12, CRUMB, 3, 0.05, -16);
        break;
      case 'toss':
      case 'dump':
        sfx.toss();
        break;
      case 'salt':
        this.particles.sprinkle(ev.x, ev.y, 10, SALT);
        sfx.rim();
        if (ev.ready) haptic(10);
        break;
      case 'placed':
        sfx.catch(2);
        break;
      case 'pickout':
        sfx.pull();
        this.particles.burst(ev.x, ev.y, 6, ev.wasted ? CRUMB : FROST, 2, 0.05, -6);
        break;
      case 'served':
        if (ev.quality === 'perfect') sfx.perfect();
        else sfx.ok();
        break;
      case 'rejected':
        sfx.reject();
        break;
      default:
        break;
    }
  }

  // ---------- Frame ----------

  render(renderer: THREE.WebGLRenderer, dt: number) {
    const k = this.k;
    const inPass = k.scene === 'pass';
    const t = k.world.time;
    this.freezerBar.hidden = inPass;
    this.passBar.hidden = !inPass;

    this.basketMeshes.forEach((m, i) => {
      const w = k.hands[i];
      m.visible = !!w;
      if (!w) return;
      m.position.set(w.x, w.y + w.wall / 2, -0.05 * i);
      const swing = w.held && !inPass ? THREE.MathUtils.clamp(-w.vx * 0.015, -0.25, 0.25) : 0;
      if (inPass) m.rotation.z = w.tilt * PLATE.tiltAngle;
      else m.rotation.z += (swing - m.rotation.z) * 0.3;
    });
    this.bags.forEach((b, i) => {
      const s = (this.bagSquash[i] = Math.max(0, (this.bagSquash[i] ?? 0) - dt * 6));
      b.scale.set(0.78 * (1 + 0.12 * s), 0.78 * (1 - 0.16 * s), 0.78);
    });

    this.bowl.visible = inPass;
    this.shaker.visible = inPass;
    if (inPass) {
      const bw = k.bowl;
      this.bowl.position.set(bw.x, bw.y, -0.1);
      this.bowl.rotation.z = THREE.MathUtils.clamp(-bw.vx * 0.02, -0.3, 0.3);
      this.bowlSalt.visible = k.bowlSalt > 0;
      this.shaker.position.set(k.shaker.x, k.shaker.y, 0.3);
      this.shaker.rotation.z = k.shaker.held ? Math.PI * 0.85 : 0;
    }
    this.syncBoxes(inPass);

    this.ravs.begin();
    for (const r of k.world.ravs) this.drawRav(r, r.x, r.y, t);
    this.basketMeshes.forEach((m, i) => {
      const w = k.hands[i];
      if (!w) return;
      // Ravs ride the basket's tilt, turning about its middle.
      const a = m.rotation.z;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      for (const r of w.ravs) {
        // Tipped, what's left slides down toward the spout.
        const s = Math.min(1, w.tilt * 1.6);
        const lx = r.lx + (-w.w / 2 + halfOf(r).hx + 0.05 - r.lx) * s;
        const ly = r.ly - w.wall / 2;
        this.drawRav(r, m.position.x + lx * ca - ly * sa, m.position.y + lx * sa + ly * ca, t);
      }
    });
    if (inPass) {
      for (const r of k.bowl.ravs) {
        // Sit them in the middle of the bowl's depth so they read as inside it.
        this.drawRav(r, k.bowl.x + r.lx, k.bowl.y + r.ly + 0.08, t);
        const m = this.ravs.get(r);
        m.position.z = -0.1 + (m.userData.zj as number) * 0.6;
      }
      for (const bx of k.board) for (const r of bx.ravs) this.drawRav(r, bx.x + r.lx, bx.y + r.ly, t);
      for (const r of k.heldRavs) {
        this.drawRav(r, r.x, r.y, t);
        const m = this.ravs.get(r);
        m.position.z = 0.6;
      }
    }
    this.ravs.end();

    this.particles.update(dt);
    this.updateDom();
    renderer.render(this.scene, this.camera);
  }

  /** One styrofoam mesh per box on the table, rebuilt when the table resizes it. */
  private syncBoxes(show: boolean) {
    const k = this.k;
    const live = new Set<number>();
    if (show) {
      for (const bx of k.board) {
        live.add(bx.id);
        let e = this.boxMeshes.get(bx.id);
        if (!e || Math.abs(e.w - bx.w) > 0.01) {
          if (e) this.scene.remove(e.g);
          e = { g: boxModel(bx.w, bx.wall), w: bx.w };
          this.boxMeshes.set(bx.id, e);
          this.scene.add(e.g);
        }
        const paper = e.g.children[e.g.children.length - 1];
        if (paper) paper.visible = !!bx.wax;
        e.g.position.set(bx.x, bx.y, 0);
        e.g.rotation.z = bx.mode === 'serving' ? Math.min(0.3, bx.vy * 0.01) : 0;
      }
    }
    for (const [id, e] of this.boxMeshes) {
      if (live.has(id)) continue;
      this.scene.remove(e.g);
      this.boxMeshes.delete(id);
    }
  }

  private drawRav(r: Rav, x: number, y: number, time: number) {
    const m = this.ravs.get(r);
    const { hy } = halfOf(r);
    if (r.state === 'dead') {
      const t = (time - r.diedAt) / RAV.deadLinger;
      const mat = m.material as THREE.MeshStandardMaterial;
      mat.transparent = true;
      mat.opacity = Math.max(0, 1 - t * t);
      m.scale.y *= 0.55;
    }
    m.position.set(x, y - hy * 0.2, m.userData.zj as number);
    m.rotation.set(r.tumble * 0.6 + 0.08, (m.userData.yaw as number) + r.a * 0.3, r.a);
  }

  private updateDom() {
    const k = this.k;
    const inPass = k.scene === 'pass';
    this.tags.forEach((tag, i) => {
      const w = k.hands[i];
      if (!w || !w.ravs.length) {
        tag.hidden = true;
        return;
      }
      const p = inPass ? this.project(Math.min(w.x, 1.2), w.y - 0.4) : this.project(w.x, w.top + 0.5);
      const f = w.flavor;
      tag.hidden = false;
      tag.style.transform = `translate(-50%, -50%) translate(${p.x}px, ${p.y}px)`;
      const name = f === 'mixed' ? 'MIXED!' : f ? FLAVORS[f].short : '';
      tag.textContent = inPass ? (f === 'gooey' ? `${w.ravs.length} ${name} · tongs, no salt` : w.tilt > 0.1 ? `${w.ravs.length} ${name}` : `${w.ravs.length} ${name} · drag to the bowl`) : `${w.ravs.length} ${name}`;
      tag.classList.toggle('mixed', f === 'mixed');
      tag.style.setProperty('--tint', f && f !== 'mixed' ? FLAVORS[f].tint : '#b5372b');
    });

    // The bowl: what's in it, and whether it's salted and tossed yet.
    const n = k.bowl.ravs.length;
    this.bowlLabel.hidden = !inPass || !n;
    if (inPass && n) {
      const p = this.project(k.bowl.x, k.bowl.y - 0.45);
      this.bowlLabel.style.transform = `translate(-50%, -50%) translate(${p.x}px, ${p.y}px)`;
      const need = Math.ceil(Math.max(PLATE.saltMin, n * PLATE.saltPerRav));
      const salt = Math.min(need, k.bowlSalt);
      const toss = Math.min(100, Math.round((k.bowlToss / PLATE.tossNeed) * 100));
      const html = k.bowlReady()
        ? `<b>${n} · salted ✓</b>`
        : `<b>${n}</b> in the bowl · salt ${salt}/${need} · toss ${toss}% <small>(grab the lip)</small>`;
      if (this.bowlLabel.innerHTML !== html) this.bowlLabel.innerHTML = html;
      this.bowlLabel.classList.toggle('ready', k.bowlReady());
    }

    // A label over each box on the table.
    const live = new Set<number>();
    if (inPass) {
      for (const box of k.board) {
        if (box.mode !== 'ready') continue;
        live.add(box.id);
        let tag = this.boxLabels.get(box.id);
        if (!tag) {
          tag = el('div', 'box-label', this.dom);
          const t = tag;
          t.addEventListener('pointerdown', (e) => {
            if (!(e.target as HTMLElement).closest('button')) return;
            e.preventDefault();
            const bx = this.k.board.find((b) => String(b.id) === t.dataset.box);
            if (bx) {
              this.k.serve(bx);
              haptic(14);
            }
          });
          this.boxLabels.set(box.id, tag);
        }
        tag.dataset.box = String(box.id);
        const p = this.project(box.x, box.top + 0.25);
        tag.style.transform = `translate(-50%, -100%) translate(${p.x}px, ${p.y}px)`;
        const ref = k.itemFor(box);
        let html: string;
        if (ref) {
          const it = ref.item;
          const lines = it.lines.map((l) => {
            const have = box.ravs.filter((r) => r.flavor === l.flavor).length;
            return `<b class="${have === l.count ? 'match' : have > l.count ? 'over' : ''}">${have}/${l.count} ${FLAVORS[l.flavor].short}</b>`;
          });
          const prep = box.prepped ? `${box.wax ? 'paper' : 'no paper'} · ${box.sauces.length ? box.sauces.join('+') : 'no sauce'}` : 'plain box';
          html = `<span>${itemLabel(it)}</span>${lines.join('')}<em>${prep}</em>`;
          tag.style.setProperty('--tint', FLAVORS[it.lines[0]?.flavor ?? 'beef'].tint);
        } else {
          html = `<span>no ticket</span><b>${box.ravs.length}</b>`;
          tag.style.setProperty('--tint', '#555');
        }
        html += box.ravs.length ? '<button class="serve-btn">SERVE ↑</button>' : '';
        if (tag.dataset.html !== html) {
          tag.dataset.html = html;
          tag.innerHTML = html;
        }
      }
    }
    for (const [id, tag] of this.boxLabels) {
      if (live.has(id)) continue;
      tag.remove();
      this.boxLabels.delete(id);
    }
  }
}

function velocity(hist: { x: number; y: number; t: number }[], now: number) {
  const last = hist[hist.length - 1];
  if (!last || now - last.t > 90) return { vx: 0, vy: 0 };
  let first = last;
  for (let i = hist.length - 1; i >= 0; i--) {
    const h = hist[i];
    if (!h) continue;
    first = h;
    if (last.t - h.t > 80) break;
  }
  const dt = (last.t - first.t) / 1000;
  if (dt < 0.008) return { vx: 0, vy: 0 };
  return { vx: (last.x - first.x) / dt, vy: (last.y - first.y) / dt };
}
