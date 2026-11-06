import * as THREE from 'three';
import { FLAVORS, SHIFT_FLAVORS } from '../config/flavors';
import { FREEZER, PASS, STATION } from '../config/shift';
import { BOX, RAV, WORLD } from '../config/toss';
import { bagModel, basketModel, boxModel, counterModel, freezerModel, ravGeometry, wallModel } from '../render/models';
import { haptic, sfx } from '../ui/feel';
import { type Basket, itemLabel, type Kitchen, type KitchenEvent } from './kitchen';
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
const GOLD = new THREE.Color('#ffc24a');

/** Freezer and pass microgames: side view, the basket follows your finger. */
export class SideView {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);
  private raycaster = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  private fixtures = new THREE.Group();
  /** One mesh per basket you can hold at once. */
  private basketMeshes: THREE.Group[] = [];
  private box: THREE.Group;
  private bags: THREE.Group[] = [];
  private bagSquash: number[] = [];
  private ravs: RavMeshes;
  private particles = new Particles();
  /** Each finger holding a basket: which basket, where you grabbed it, its recent path (for flicks and taps). */
  private grips = new Map<number, { b: Basket; dx: number; dy: number; hist: { x: number; y: number; t: number }[]; x0: number; y0: number; t0: number; moved: boolean }>();
  private boxSwipe: { id: number; y0: number } | null = null;

  private dom: HTMLElement;
  private tags: HTMLElement[] = [];
  private boxLabel: HTMLElement;
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
      const m = basketModel(2.0, 0.6);
      m.visible = false;
      this.basketMeshes.push(m);
      this.scene.add(m);
    }
    this.box = boxModel(BOX.width, BOX.wall);
    this.scene.add(this.box);
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
    this.boxLabel = el('div', 'box-label', this.dom);
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
    if (!on) {
      this.grips.clear();
      this.boxSwipe = null;
    }
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
    this.k.passGeo = { leftX, rightX, topY, counterY, boxX: at(PASS.boxU, PASS.counterV).x, homeX: -1.6, homeY: counterY + 2.2 };

    if (this.k.scene === 'freezer') {
      this.scene.background = new THREE.Color('#9fbfd0');
      this.fixtures.add(freezerModel(WORLD.width * 1.6, shelfY, at(0.5, 1.02).y, topY));
      this.bags.forEach((b, i) => {
        b.visible = true;
        b.position.set(bagX[i] ?? 0, shelfY, -0.2);
      });
    } else {
      this.scene.background = new THREE.Color('#2a1f17');
      this.fixtures.add(counterModel(leftX, rightX, counterY, at(0.5, 1.05).y));
      const bot = at(0.5, 1.1).y;
      this.fixtures.add(wallModel(WORLD.width * 2.2, topY - bot + 4, (topY + bot) / 2));
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
      if (k.scene === 'station' || k.phase !== 'playing') return;
      e.preventDefault();
      const p = this.worldAt(e.clientX / window.innerWidth, e.clientY / window.innerHeight);
      // Each finger can hold its own basket.
      const b = k.handAt(p.x, p.y);
      if (b) {
        const off = k.grab(b, p.x, p.y);
        if (off) {
          this.grips.set(e.pointerId, { b, dx: off.dx, dy: off.dy, hist: [{ x: p.x, y: p.y, t: e.timeStamp }], x0: e.clientX, y0: e.clientY, t0: e.timeStamp, moved: false });
          haptic(6);
          return;
        }
      }
      if (k.scene === 'pass' && k.boxAt(p.x, p.y)) {
        this.boxSwipe = { id: e.pointerId, y0: p.y };
        return;
      }
      if (k.scene === 'freezer' && k.freezerGeo) {
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
      const p = this.worldAt(e.clientX / window.innerWidth, e.clientY / window.innerHeight);
      const g = this.grips.get(e.pointerId);
      if (g) {
        if (Math.hypot(e.clientX - g.x0, e.clientY - g.y0) > 10) g.moved = true;
        this.k.moveHand(g.b, p.x + g.dx, p.y + g.dy);
        g.hist.push({ x: p.x, y: p.y, t: e.timeStamp });
        while (g.hist.length > 2 && e.timeStamp - (g.hist[0]?.t ?? 0) > 160) g.hist.shift();
      } else if (this.boxSwipe && e.pointerId === this.boxSwipe.id && p.y - this.boxSwipe.y0 > BOX.serveSwipe) {
        this.boxSwipe = null;
        this.k.serve();
        haptic(14);
      }
    });
    const end = (e: PointerEvent) => {
      if (this.boxSwipe?.id === e.pointerId) this.boxSwipe = null;
      const g = this.grips.get(e.pointerId);
      if (!g) return;
      this.grips.delete(e.pointerId);
      // A tap (no drag) on a basket picks out the rav under your finger: grab is drag, pick is tap.
      if (!g.moved && e.timeStamp - g.t0 < STATION.tapMs) {
        g.b.held = false;
        const p = this.worldAt(e.clientX / window.innerWidth, e.clientY / window.innerHeight);
        const r = this.k.ravAt(g.b, p.x, p.y);
        if (r) {
          this.k.pickOut(g.b, r);
          haptic(8);
        }
        return;
      }
      const v = velocity(g.hist, e.timeStamp);
      const had = g.b.ravs.length;
      this.k.release(g.b, v.vx, v.vy);
      if (had && !g.b.ravs.length) haptic(12);
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
  }

  handle(ev: KitchenEvent) {
    switch (ev.type) {
      case 'scene':
        if (ev.scene !== 'station') this.layout();
        break;
      case 'launch':
        sfx.launch();
        this.particles.burst(ev.x, ev.y, 5, FROST, 1.5, 0.05, 1);
        break;
      case 'catch':
        sfx.catch(ev.count);
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
        sfx.toss();
        break;
      case 'pickout':
        sfx.pull();
        this.particles.burst(ev.x, ev.y, 6, ev.wasted ? CRUMB : FROST, 2, 0.05, -6);
        break;
      case 'served':
        if (ev.quality === 'perfect') {
          sfx.perfect();
          this.particles.burst(this.k.box.x, this.k.box.top, 24, GOLD, 5, 0.06, -6);
        } else sfx.ok();
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
    this.freezerBar.hidden = inPass;
    this.passBar.hidden = !inPass;

    this.basketMeshes.forEach((m, i) => {
      const w = k.hands[i];
      m.visible = !!w;
      if (!w) return;
      m.position.set(w.x, w.y, -0.05 * i);
      const tilt = w.held ? THREE.MathUtils.clamp(-w.vx * 0.015, -0.25, 0.25) : 0;
      m.rotation.z += (tilt - m.rotation.z) * 0.3;
    });
    this.box.visible = inPass;
    this.box.position.set(k.box.x, k.box.y, 0);
    this.box.rotation.z = k.box.mode === 'serving' ? Math.min(0.3, k.box.vy * 0.01) : 0;
    this.bags.forEach((b, i) => {
      const s = (this.bagSquash[i] = Math.max(0, (this.bagSquash[i] ?? 0) - dt * 6));
      b.scale.set(0.78 * (1 + 0.12 * s), 0.78 * (1 - 0.16 * s), 0.78);
    });

    this.ravs.begin();
    for (const r of k.world.ravs) this.drawRav(r, r.x, r.y, k.world.time);
    for (const w of k.hands) for (const r of w.ravs) this.drawRav(r, w.x + r.lx, w.y + r.ly, k.world.time);
    if (inPass) for (const r of k.box.ravs) this.drawRav(r, k.box.x + r.lx, k.box.y + r.ly, k.world.time);
    this.ravs.end();

    this.particles.update(dt);
    this.updateDom();
    renderer.render(this.scene, this.camera);
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
    this.tags.forEach((tag, i) => {
      const w = k.hands[i];
      if (!w || !w.ravs.length) {
        tag.hidden = true;
        return;
      }
      const p = this.project(w.x, w.top + 0.5);
      const f = w.flavor;
      tag.hidden = false;
      tag.style.transform = `translate(-50%, -50%) translate(${p.x}px, ${p.y}px)`;
      tag.textContent = `${w.ravs.length} ${f === 'mixed' ? 'MIXED!' : f ? FLAVORS[f].short : ''}`;
      tag.classList.toggle('mixed', f === 'mixed');
      tag.style.setProperty('--tint', f && f !== 'mixed' ? FLAVORS[f].tint : '#b5372b');
    });

    const ref = k.boxItem();
    const show = k.scene === 'pass' && k.box.mode === 'ready';
    this.boxLabel.hidden = !show;
    if (show) {
      const p = this.project(k.box.x, k.box.top + 1.35);
      this.boxLabel.style.transform = `translate(-50%, -50%) translate(${p.x}px, ${p.y}px)`;
      const n = k.box.ravs.length;
      if (ref) {
        const it = ref.item;
        const lines = it.lines.map((l) => {
          const have = k.box.ravs.filter((r) => r.flavor === l.flavor).length;
          return `<b class="${have === l.count ? 'match' : have > l.count ? 'over' : ''}">${have}/${l.count} ${FLAVORS[l.flavor].short}</b>`;
        });
        this.boxLabel.innerHTML = `<span>${itemLabel(it)}</span>${lines.join('')}<small>swipe up to serve</small>`;
        this.boxLabel.style.setProperty('--tint', FLAVORS[it.lines[0]?.flavor ?? 'beef'].tint);
      } else {
        this.boxLabel.innerHTML = `<span>no ticket</span><b>${n}</b>`;
        this.boxLabel.style.setProperty('--tint', '#555');
      }
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
