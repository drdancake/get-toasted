import * as THREE from 'three';
import { FLAVORS, SHIFT_FLAVORS } from '../config/flavors';
import { FREEZER_TOP as T } from '../config/freezer-top';
import { FREEZER } from '../config/shift';
import { BASKET } from '../config/toss';
import { bagModel, basketModel, ravGeometry } from '../render/models';
import { haptic, sfx } from '../ui/feel';
import type { Basket, Kitchen } from './kitchen';
import type { Rav } from './physics';
import { RavMeshes } from './rav-meshes';

/** A rav in flight, in 3D: on the floor plane (x, y) and up toward you (z), tumbling. */
interface Flier {
  r: Rav;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  q: THREE.Quaternion;
  w: THREE.Vector3;
}

/** Where each basket is on the floor plane (the kitchen's 2D basket coordinates are the side view's). */
interface Spot {
  x: number;
  y: number;
  tx: number;
  ty: number;
}

const UP = new THREE.Vector3(0, 0, 1);
const FLAT = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/**
 * The freezer seen from above. Tap a bin: a rav flies straight up at your face, getting bigger, and
 * tumbles back down. Its shadow on the floor shows where it'll land and (by how tight it is) how soon.
 * Slide a basket under it. Each finger drives its own basket.
 */
export class FreezerTop {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(T.fov, 1, 0.1, 100);
  private raycaster = new THREE.Raycaster();
  private ravs: RavMeshes;
  private fliers: Flier[] = [];
  private spots = new Map<Basket, Spot>();
  private basketMeshes = new Map<Basket, THREE.Group>();
  private bins: THREE.Group[] = [];
  private binXY: { x: number; y: number }[] = [];
  private binSquash: number[] = [];
  private shadows: THREE.Mesh[] = [];
  private shadowGeo = new THREE.CircleGeometry(1, 20);
  private grips = new Map<number, { b: Basket; dx: number; dy: number; x0: number; y0: number; t0: number; moved: boolean }>();
  private floorY = { lo: -6, hi: 6, x: 3.5 };
  /** Called with a screen point when a rav lands in a basket (for the count pop). */
  onCatch: ((count: number, sx: number, sy: number) => void) | null = null;

  constructor(private k: Kitchen) {
    this.scene.background = new THREE.Color('#a9c9d8');
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#6d8a99', 1.5));
    const key = new THREE.DirectionalLight('#ffffff', 2.2);
    key.position.set(-4, 6, 20);
    this.scene.add(key);
    this.scene.add(this.floor());
    this.ravs = new RavMeshes(this.scene);
    const geo = ravGeometry(0);
    SHIFT_FLAVORS.forEach((f) => {
      const bag = bagModel(FLAVORS[f].short, geo, FLAVORS[f].tint);
      // Seen from above: stand it up out of the floor, label toward you.
      bag.rotation.x = Math.PI / 2;
      bag.scale.setScalar(0.95);
      this.bins.push(bag);
      this.binSquash.push(0);
      this.scene.add(bag);
    });
  }

  /** The freezer floor: wire shelving over frosty steel. */
  private floor() {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const ctx = c.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#c7dbe4';
      ctx.fillRect(0, 0, 256, 256);
      ctx.strokeStyle = '#8fa9b6';
      ctx.lineWidth = 6;
      for (let i = 0; i <= 256; i += 32) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, 256);
        ctx.stroke();
      }
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#a7bfca';
      for (let i = 0; i <= 256; i += 64) {
        ctx.beginPath();
        ctx.moveTo(0, i);
        ctx.lineTo(256, i);
        ctx.stroke();
      }
      // Frost.
      for (let i = 0; i < 260; i++) {
        ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.35})`;
        ctx.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
      }
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(5, 9);
    tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(30, 40), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
    return m;
  }

  resize(w: number, h: number) {
    this.camera.aspect = w / h;
    this.camera.fov = T.fov;
    this.camera.position.set(0, 0, T.camHeight);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    const halfH = T.camHeight * Math.tan(THREE.MathUtils.degToRad(T.fov / 2));
    const halfW = halfH * this.camera.aspect;
    this.floorY = { lo: -halfH, hi: halfH, x: halfW };
    this.binXY = T.binU.map((u) => ({ x: (u * 2 - 1) * halfW * 0.92, y: halfH - T.binV * 2 * halfH }));
    this.bins.forEach((b, i) => {
      const p = this.binXY[i];
      if (p) b.position.set(p.x, p.y - 0.4, 0);
    });
  }

  /** Walking in: lay the baskets out across the middle of the floor. */
  enter() {
    this.fliers = [];
    this.spots.clear();
    for (const g of this.grips.values()) g.b.held = false;
    this.grips.clear();
    const xs = FREEZER.homeX[this.k.hands.length - 1] ?? [0];
    this.k.hands.forEach((b, i) => {
      const x = (xs[i] ?? 0) * Math.min(1, (this.floorY.x * 2 - 2) / 6);
      this.spots.set(b, { x, y: 0, tx: x, ty: 0 });
      // In here the basket rides level and never sheds: keep the side-view physics off it.
      b.held = false;
      b.spillSpeed = 1e9;
    });
  }

  /** Walking out: hand the side-view physics back its baskets. */
  leave() {
    for (const b of this.spots.keys()) b.spillSpeed = 0;
    this.fliers = [];
    this.grips.clear();
  }

  // ---------- Input ----------

  private floorAt(cx: number, cy: number, z: number) {
    this.raycaster.setFromCamera(new THREE.Vector2((cx / window.innerWidth) * 2 - 1, 1 - (cy / window.innerHeight) * 2), this.camera);
    const p = new THREE.Vector3();
    this.raycaster.ray.intersectPlane(new THREE.Plane(UP, -z), p);
    return p;
  }

  project(x: number, y: number, z: number) {
    const p = new THREE.Vector3(x, y, z).project(this.camera);
    return { x: ((p.x + 1) / 2) * window.innerWidth, y: ((1 - p.y) / 2) * window.innerHeight };
  }

  down(e: PointerEvent) {
    const k = this.k;
    // A bin? Tap it to fling one up.
    const fp = this.floorAt(e.clientX, e.clientY, 0.6);
    let bi = -1;
    let bd = Infinity;
    this.binXY.forEach((p, i) => {
      const d = Math.hypot(fp.x - p.x, fp.y - p.y);
      if (d < bd) [bi, bd] = [i, d];
    });
    // A basket under your thumb (each finger gets its own).
    const bp = this.floorAt(e.clientX, e.clientY, T.basketZ);
    let best: Basket | null = null;
    let bestD = Infinity;
    for (const [b, s] of this.spots) {
      if ([...this.grips.values()].some((g) => g.b === b)) continue;
      const d = Math.hypot((bp.x - s.x) / (BASKET.width / 2 + 0.5), (bp.y - s.y) / (T.basketDepth / 2 + 0.6));
      if (d < 1 && d < bestD) [best, bestD] = [b, d];
    }
    if (best && !(bi >= 0 && bd < 0.8)) {
      const s = this.spots.get(best);
      if (!s) return;
      this.grips.set(e.pointerId, { b: best, dx: s.x - bp.x, dy: s.y - bp.y, x0: e.clientX, y0: e.clientY, t0: e.timeStamp, moved: false });
      haptic(6);
      return;
    }
    if (bi >= 0 && bd < 1.1) this.fling(bi);
    void k;
  }

  move(e: PointerEvent) {
    const g = this.grips.get(e.pointerId);
    if (!g) return;
    if (Math.hypot(e.clientX - g.x0, e.clientY - g.y0) > 10) g.moved = true;
    const p = this.floorAt(e.clientX, e.clientY, T.basketZ);
    const s = this.spots.get(g.b);
    if (!s) return;
    const binTop = (this.binXY[0]?.y ?? -6) + 1.6;
    s.tx = Math.max(-this.floorY.x + BASKET.width / 2, Math.min(this.floorY.x - BASKET.width / 2, p.x + g.dx));
    s.ty = Math.max(binTop, Math.min(this.floorY.hi * 0.55, p.y + g.dy));
  }

  up(e: PointerEvent) {
    const g = this.grips.get(e.pointerId);
    if (!g) return;
    this.grips.delete(e.pointerId);
    // A tap (no drag) on a basket picks out the rav under your thumb: back in its bag.
    if (!g.moved && e.timeStamp - g.t0 < 450) {
      const s = this.spots.get(g.b);
      const p = this.floorAt(e.clientX, e.clientY, T.basketZ);
      if (!s) return;
      let pick: Rav | null = null;
      let pd = 0.5;
      g.b.ravs.forEach((r, i) => {
        const at = this.slot(i);
        const d = Math.hypot(s.x + at.x - p.x, s.y + at.y - p.y);
        if (d < pd) [pick, pd] = [r, d];
      });
      if (pick) {
        this.k.pickOut(g.b, pick);
        haptic(8);
      }
    }
  }

  /** Fling one rav up out of a bin: at your face, toward the middle of the floor. */
  private fling(i: number) {
    const r = this.k.takeFromBag(i);
    const p = this.binXY[i];
    if (!r || !p) return;
    const vz = rnd(T.launchVz[0], T.launchVz[1]);
    const flight = (2 * vz) / T.gravity;
    const tx = p.x * (1 - T.toCenter) + rnd(-T.scatter, T.scatter);
    const ty = p.y + T.carry + rnd(-T.scatter, T.scatter);
    const q = FLAT.clone().multiply(new THREE.Quaternion().setFromAxisAngle(UP, rnd(0, Math.PI * 2)));
    this.fliers.push({
      r,
      x: p.x + rnd(-0.15, 0.15),
      y: p.y + 0.2,
      z: 0.9,
      vx: (tx - p.x) / flight,
      vy: (ty - p.y) / flight,
      vz,
      q,
      w: new THREE.Vector3(rnd(-T.spin, T.spin), rnd(-T.spin, T.spin), rnd(-T.spin * 0.5, T.spin * 0.5)),
    });
    this.binSquash[i] = 1;
    sfx.launch();
    haptic(5);
  }

  // ---------- Frame ----------

  /** Where the i-th rav sits in a basket, relative to its center (rows across, layers up). */
  private slot(i: number) {
    const cols = 5;
    const rows = 3;
    const layer = Math.floor(i / (cols * rows));
    const j = i % (cols * rows);
    return { x: ((j % cols) - (cols - 1) / 2) * 0.36, y: (Math.floor(j / cols) - (rows - 1) / 2) * 0.4, z: 0.12 + layer * 0.16 };
  }

  step(dt: number) {
    const k = this.k;
    if (k.phase !== 'playing') return;
    // Baskets chase your thumbs.
    const f = 1 - Math.exp(-T.follow * dt);
    for (const s of this.spots.values()) {
      s.x += (s.tx - s.x) * f;
      s.y += (s.ty - s.y) * f;
    }
    const rimZ = T.basketZ + BASKET.wall;
    const keep: Flier[] = [];
    for (const fl of this.fliers) {
      const pz = fl.z;
      fl.vz -= T.gravity * dt;
      fl.x += fl.vx * dt;
      fl.y += fl.vy * dt;
      fl.z += fl.vz * dt;
      const dq = new THREE.Quaternion().setFromAxisAngle(fl.w.clone().normalize(), fl.w.length() * dt);
      fl.q.premultiply(dq);
      // Falling through a basket's rim while it's over the basket: caught.
      if (fl.vz < 0 && pz >= rimZ && fl.z < rimZ) {
        let caught: Basket | null = null;
        for (const [b, s] of this.spots) {
          if (Math.abs(fl.x - s.x) < BASKET.width / 2 + T.grace && Math.abs(fl.y - s.y) < T.basketDepth / 2 + T.grace) caught = b;
        }
        if (caught && caught.ravs.length < 24) {
          fl.r.state = 'in';
          fl.r.lx = 0;
          fl.r.ly = 0.1;
          fl.r.lvx = fl.r.lvy = 0;
          fl.r.squash = 1;
          caught.ravs.push(fl.r);
          k.world.events.push({ type: 'catch', x: fl.x, y: fl.y, into: 'basket', count: caught.ravs.length, flavor: fl.r.flavor, id: fl.r.id });
          const sp = this.project(fl.x, fl.y, rimZ + 0.6);
          this.onCatch?.(caught.ravs.length, sp.x, sp.y);
          continue;
        }
      }
      // The floor: it's lost.
      if (fl.z <= 0.12) {
        fl.r.state = 'dead';
        k.world.events.push({ type: 'dead', x: fl.x, y: fl.y, flavor: fl.r.flavor, id: fl.r.id });
        continue;
      }
      keep.push(fl);
    }
    this.fliers = keep;
    // Baskets that left the freezer (walked out) drop out of the map.
    for (const b of [...this.spots.keys()]) if (!k.hands.includes(b)) this.spots.delete(b);
  }

  render(renderer: THREE.WebGLRenderer, dt: number) {
    this.step(dt);
    const k = this.k;
    // Baskets, from above.
    for (const [b, s] of this.spots) {
      let m = this.basketMeshes.get(b);
      if (!m) {
        m = basketModel(BASKET.width, BASKET.wall, T.basketDepth);
        m.rotation.x = Math.PI / 2;
        this.basketMeshes.set(b, m);
        this.scene.add(m);
      }
      m.visible = true;
      m.position.set(s.x, s.y, T.basketZ);
    }
    for (const [b, m] of this.basketMeshes) if (!this.spots.has(b)) m.visible = false;
    this.bins.forEach((b, i) => {
      const sq = (this.binSquash[i] = Math.max(0, (this.binSquash[i] ?? 0) - dt * 6));
      b.scale.set(0.95 * (1 + 0.1 * sq), 0.95 * (1 - 0.14 * sq), 0.95 * (1 + 0.1 * sq));
    });
    this.ravs.begin();
    // In the air: tumbling, bigger as they come at you.
    this.fliers.forEach((fl) => {
      const m = this.ravs.get(fl.r);
      m.position.set(fl.x, fl.y, fl.z);
      m.quaternion.copy(fl.q);
      m.scale.multiplyScalar(1 + fl.z * T.zoom);
    });
    // In the baskets: lying flat in rows.
    for (const [b, s] of this.spots) {
      b.ravs.forEach((r, i) => {
        const m = this.ravs.get(r);
        const at = this.slot(i);
        m.position.set(s.x + at.x, s.y + at.y, T.basketZ + at.z);
        m.quaternion.copy(FLAT).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (r.id % 7) * 0.3));
      });
    }
    this.ravs.end();
    // Shadows on the floor: wide and soft up high, small and dark as they come down.
    while (this.shadows.length < this.fliers.length) {
      const sh = new THREE.Mesh(this.shadowGeo, new THREE.MeshBasicMaterial({ color: '#0d2a38', transparent: true, depthWrite: false }));
      sh.renderOrder = 1;
      this.scene.add(sh);
      this.shadows.push(sh);
    }
    this.shadows.forEach((sh, i) => {
      const fl = this.fliers[i];
      sh.visible = !!fl;
      if (!fl) return;
      // On a basket's floor if it's over one, else on the freezer floor.
      let floorZ = 0.02;
      for (const s of this.spots.values()) {
        if (Math.abs(fl.x - s.x) < BASKET.width / 2 && Math.abs(fl.y - s.y) < T.basketDepth / 2 && fl.z > T.basketZ) floorZ = T.basketZ + 0.03;
      }
      const h = Math.max(0, fl.z - floorZ);
      sh.position.set(fl.x, fl.y, floorZ);
      sh.scale.setScalar(T.shadowR + h * T.shadowGrow);
      (sh.material as THREE.MeshBasicMaterial).opacity = Math.max(0.12, T.shadowDark - h * T.shadowFade);
    });
    void k;
    renderer.render(this.scene, this.camera);
  }

  /** Each basket's tag position on screen, for the count over it. */
  tagAt(b: Basket) {
    const s = this.spots.get(b);
    return s ? this.project(s.x, s.y + T.basketDepth / 2 + 0.3, T.basketZ + BASKET.wall) : null;
  }
}
