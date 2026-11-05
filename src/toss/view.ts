import * as THREE from 'three';
import { BOX, RAV, TOSS_LAYOUT, WORLD } from '../config/toss';
import { donenessAt, isFailure } from '../game/doneness';
import { bagModel, basketModel, boxModel, counterModel, fryerModel, rampColor, ravGeometry, wallModel } from '../render/models';
import { haptic, sfx } from '../ui/feel';
import { type Basket, type Geometry, type Rav, type TossEvent, TossSim } from './sim';

const FOV = 40;
const TILT_DEG = 16;
const RAV_SCALE = RAV.hx * 2;

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  size: number;
  grow: number;
  g: number;
  color: THREE.Color;
}

/** Pooled, instanced low-poly bits: oil splash, bubbles, smoke, crumbs, sparkle. */
class Particles {
  mesh: THREE.InstancedMesh;
  private list: Particle[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  constructor(private cap = 500) {
    this.mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshBasicMaterial(), cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < cap; i++) this.mesh.setColorAt(i, new THREE.Color());
  }
  spawn(p: Omit<Particle, 'max'>) {
    if (this.list.length >= this.cap) this.list.shift();
    this.list.push({ ...p, max: p.life });
  }
  update(dt: number) {
    this.list = this.list.filter((p) => (p.life -= dt) > 0);
    this.list.forEach((p, i) => {
      p.vy += p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.size += p.grow * dt;
      const k = Math.min(1, (p.life / p.max) * 2.5);
      this.s.setScalar(Math.max(0.0001, p.size * k));
      this.m.compose(this.v.set(p.x, p.y, p.z), this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
      this.mesh.setColorAt(i, p.color);
    });
    this.mesh.count = this.list.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const OIL = new THREE.Color('#e0a040');
const BUBBLE = new THREE.Color('#fff1cf');
const SMOKE = new THREE.Color('#6d6763');
const CRUMB = new THREE.Color('#a8662a');
const STEAM = new THREE.Color('#fff7ea');
const GOLD = new THREE.Color('#ffc24a');

type Touch =
  | { kind: 'basket'; b: Basket; dx: number; dy: number; hist: { x: number; y: number; t: number }[] }
  | { kind: 'box'; startY: number };

export class TossView {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);
  private raycaster = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  private fixtures = new THREE.Group();
  private oil: THREE.MeshStandardMaterial | null = null;
  private ravGeos = [0, 1, 2].map(ravGeometry);
  private ravMeshes = new Map<number, THREE.Mesh>();
  private basketViews: THREE.Group[];
  private boxView: THREE.Group;
  private bagView: THREE.Group;
  private bagSquash = 0;
  private particles = new Particles();
  private touches = new Map<number, Touch>();
  private geo: Geometry | null = null;
  private tmp = new THREE.Color();

  constructor(
    private canvas: HTMLCanvasElement,
    private sim: TossSim,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.scene.background = new THREE.Color('#2a1f17');

    this.scene.add(new THREE.HemisphereLight('#fff3dc', '#5a3a22', 1.4));
    const key = new THREE.DirectionalLight('#fff6e8', 2.6);
    key.position.set(-3, 9, 10);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight('#ffb36b', 1.2);
    rim.position.set(5, 4, -6);
    this.scene.add(rim);

    this.scene.add(this.fixtures, this.particles.mesh);
    this.basketViews = sim.baskets.map((b) => {
      const v = basketModel(b.w, b.wall);
      this.scene.add(v);
      return v;
    });
    this.boxView = boxModel(BOX.width, BOX.wall);
    this.scene.add(this.boxView);
    this.bagView = bagModel('OG BEEF', this.ravGeos[0] ?? ravGeometry(0));
    this.scene.add(this.bagView);

    this.resize();
    this.bindInput();
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    this.camera.aspect = aspect;
    const tan = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    const dist = WORLD.width / 2 / (tan * aspect);
    this.camera.position.set(0, dist * Math.tan(THREE.MathUtils.degToRad(TILT_DEG)), dist);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();

    const at = (u: number, v: number) => this.worldAtUV(u, v);
    const L = TOSS_LAYOUT;
    const leftX = at(0, L.counterV).x;
    const rightX = at(1, L.counterV).x;
    const geo: Geometry = {
      leftX,
      rightX,
      topY: at(0.5, 0).y,
      hangY: at(0.5, L.hangV).y,
      oilY: at(0.5, L.oilV).y,
      vatLeft: leftX + 0.3,
      vatRight: rightX - 0.3,
      counterY: at(0.5, L.counterV).y,
      slotX: L.slotU.map((u) => at(u, L.hangV).x),
      bagX: at(L.bagU, L.counterV).x,
      boxX: at(L.boxU, L.counterV).x,
    };
    this.geo = geo;
    this.sim.setGeometry(geo);

    for (const c of [...this.fixtures.children]) this.fixtures.remove(c);
    const bottomY = at(0.5, L.vatBottomV).y;
    const fryer = fryerModel(geo.vatLeft, geo.vatRight, geo.oilY, bottomY);
    this.oil = fryer.oil;
    this.fixtures.add(fryer.group);
    this.fixtures.add(counterModel(leftX, rightX, geo.counterY, at(0.5, 1.05).y));
    const top = at(0.5, -0.05).y;
    const bot = at(0.5, 1.1).y;
    this.fixtures.add(wallModel(WORLD.width * 2.2, top - bot + 4, (top + bot) / 2));
    this.bagView.position.set(geo.bagX, geo.counterY, 0);
  }

  private worldAtUV(u: number, v: number) {
    this.raycaster.setFromCamera(new THREE.Vector2(u * 2 - 1, 1 - v * 2), this.camera);
    const p = new THREE.Vector3();
    this.raycaster.ray.intersectPlane(this.plane, p);
    return p;
  }

  private worldAt(clientX: number, clientY: number) {
    return this.worldAtUV(clientX / window.innerWidth, clientY / window.innerHeight);
  }

  project = (x: number, y: number, z = 0) => {
    const p = new THREE.Vector3(x, y, z).project(this.camera);
    return { x: ((p.x + 1) / 2) * window.innerWidth, y: ((1 - p.y) / 2) * window.innerHeight };
  };

  // ---------- Input ----------

  private bindInput() {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (this.sim.phase !== 'playing') return;
      const p = this.worldAt(e.clientX, e.clientY);
      const b = this.sim.basketAt(p.x, p.y);
      if (b) {
        const off = this.sim.grab(b, p.x, p.y);
        this.touches.set(e.pointerId, { kind: 'basket', b, dx: off.dx, dy: off.dy, hist: [{ x: p.x, y: p.y, t: e.timeStamp }] });
        haptic(8);
      } else if (this.sim.boxAt(p.x, p.y)) {
        this.touches.set(e.pointerId, { kind: 'box', startY: p.y });
      } else if (this.sim.bagAt(p.x, p.y)) {
        if (this.sim.tapBag()) haptic(6);
      }
      try {
        c.setPointerCapture(e.pointerId);
      } catch {
        /* fine */
      }
    });
    c.addEventListener('pointermove', (e) => {
      const t = this.touches.get(e.pointerId);
      if (!t) return;
      const p = this.worldAt(e.clientX, e.clientY);
      if (t.kind === 'basket') {
        this.sim.moveHeld(t.b, p.x + t.dx, p.y + t.dy);
        t.hist.push({ x: p.x, y: p.y, t: e.timeStamp });
        while (t.hist.length > 2 && e.timeStamp - (t.hist[0]?.t ?? 0) > 160) t.hist.shift();
      } else if (p.y - t.startY > BOX.serveSwipe) {
        this.touches.delete(e.pointerId);
        this.sim.serve();
        haptic(14);
      }
    });
    const end = (e: PointerEvent) => {
      const t = this.touches.get(e.pointerId);
      this.touches.delete(e.pointerId);
      if (!t || t.kind !== 'basket') return;
      const { vx, vy } = velocity(t.hist, e.timeStamp);
      const had = t.b.ravs.length;
      this.sim.release(t.b, vx, vy);
      if (had && t.b.ravs.length === 0) haptic(12);
      else if (t.b.mode === 'fry') haptic(16);
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
  }

  // ---------- Events ----------

  handle(ev: TossEvent) {
    switch (ev.type) {
      case 'launch':
        this.bagSquash = 1;
        sfx.launch();
        this.burst(ev.x, ev.y, 4, STEAM, 1.2, 0.05, 1.5);
        break;
      case 'catch':
        sfx.catch(ev.count);
        haptic(5);
        break;
      case 'rim':
        sfx.rim();
        break;
      case 'spill':
        sfx.rim();
        break;
      case 'dead':
        if (ev.kind === 'oil') {
          sfx.oilDeath();
          this.burst(ev.x, ev.y, 14, OIL, 4, 0.06, -14);
        } else {
          sfx.splat();
          this.burst(ev.x, ev.y, 12, CRUMB, 3, 0.05, -16);
        }
        break;
      case 'drop':
        sfx.drop();
        this.burst(ev.x, ev.y + 0.05, 26, OIL, 5, 0.07, -18, 1.6);
        break;
      case 'pull':
        sfx.pull();
        this.burst(ev.x, ev.y + 0.4, 10, STEAM, 1.5, 0.09, 2, 1.2);
        break;
      case 'toss':
        sfx.toss();
        break;
      case 'served':
        if (ev.quality === 'perfect') {
          sfx.perfect();
          this.burst(this.sim.box.x, this.sim.box.top, 24, GOLD, 5, 0.06, -6, 1.4);
        } else sfx.ok();
        break;
      case 'rejected':
        sfx.reject();
        break;
      default:
        break;
    }
  }

  private burst(x: number, y: number, n: number, color: THREE.Color, speed: number, size: number, g: number, spreadX = 1) {
    for (let i = 0; i < n; i++) {
      const a = rnd(0.15, Math.PI - 0.15);
      const s = rnd(0.4, 1) * speed;
      this.particles.spawn({
        x: x + rnd(-0.3, 0.3) * spreadX,
        y,
        z: rnd(-0.2, 0.4),
        vx: Math.cos(a) * s * spreadX,
        vy: Math.sin(a) * s,
        vz: rnd(-0.5, 0.5),
        life: rnd(0.35, 0.8),
        size: size * rnd(0.6, 1.3),
        grow: 0,
        g,
        color,
      });
    }
  }

  // ---------- Frame ----------

  render(now: number, dt: number) {
    const sim = this.sim;
    const geo = this.geo;
    if (!geo) return;

    if (this.oil) {
      const shimmer = 0.5 + 0.5 * Math.sin(now * 2.3);
      this.oil.emissive.set('#3a1a02').lerp(this.tmp.set('#6a3208'), shimmer * 0.4);
    }

    let frying = 0;
    sim.baskets.forEach((b, i) => {
      const v = this.basketViews[i];
      if (!v) return;
      const bob = b.mode === 'fry' ? Math.sin(now * 3 + i) * 0.025 : 0;
      v.position.set(b.x, b.y + bob, b.mode === 'hang' ? -0.15 : 0);
      const tilt = b.mode === 'held' ? THREE.MathUtils.clamp(-b.vx * 0.015, -0.25, 0.25) : 0;
      v.rotation.z += (tilt - v.rotation.z) * 0.3;
      if (b.mode === 'fry' && b.ravs.length) {
        frying++;
        if (Math.random() < 0.45) {
          this.particles.spawn({
            x: b.x + rnd(-b.w / 2, b.w / 2),
            y: geo.oilY + 0.02,
            z: rnd(-0.4, 0.4),
            vx: 0,
            vy: rnd(0.2, 0.6),
            vz: 0,
            life: rnd(0.2, 0.4),
            size: rnd(0.015, 0.035),
            grow: 0.02,
            g: 0,
            color: BUBBLE,
          });
        }
        const burnt = b.ravs.some((r) => isFailure(sim.qualityOf(r)) && sim.qualityOf(r) !== 'cold');
        if (burnt && Math.random() < 0.35) {
          this.particles.spawn({
            x: b.x + rnd(-0.6, 0.6),
            y: geo.oilY + 0.3,
            z: rnd(-0.3, 0.3),
            vx: rnd(-0.2, 0.2),
            vy: rnd(0.8, 1.4),
            vz: 0,
            life: rnd(0.9, 1.4),
            size: rnd(0.12, 0.2),
            grow: 0.25,
            g: 0,
            color: SMOKE,
          });
        }
      }
    });
    sfx.sizzle(frying);

    const box = sim.box;
    this.boxView.position.set(box.x, box.y, 0);
    this.boxView.rotation.z = box.mode === 'serving' ? Math.min(0.3, box.vy * 0.01) : 0;

    this.bagSquash = Math.max(0, this.bagSquash - dt * 6);
    this.bagView.scale.set(1 + 0.12 * this.bagSquash, 1 - 0.16 * this.bagSquash, 1 + 0.08 * this.bagSquash);

    // Ravs: every rav in the air, on the floor, or in a container.
    const seen = new Set<number>();
    for (const r of sim.ravs) this.drawRav(r, r.x, r.y, 0, now, seen);
    for (const c of [...sim.baskets, box]) {
      const z = c === box ? 0 : (this.basketViews[sim.baskets.indexOf(c as Basket)]?.position.z ?? 0);
      for (const r of c.ravs) this.drawRav(r, c.x + r.lx, c.y + r.ly, z, now, seen);
    }
    for (const [id, m] of this.ravMeshes) {
      if (seen.has(id)) continue;
      this.scene.remove(m);
      (m.material as THREE.Material).dispose();
      this.ravMeshes.delete(id);
    }

    this.particles.update(dt);
    this.renderer.render(this.scene, this.camera);
  }

  private drawRav(r: Rav, x: number, y: number, z: number, now: number, seen: Set<number>) {
    seen.add(r.id);
    let m = this.ravMeshes.get(r.id);
    if (!m) {
      const geo = this.ravGeos[r.id % this.ravGeos.length] ?? this.ravGeos[0];
      m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.75 }));
      // Each rav sits a little differently in the pile.
      m.userData.zj = rnd(-0.22, 0.22);
      m.userData.yaw = rnd(-0.35, 0.35);
      this.scene.add(m);
      this.ravMeshes.set(r.id, m);
    }
    const mat = m.material as THREE.MeshStandardMaterial;
    rampColor(donenessAt(r.cooked, r.flavor, 0), mat.color);
    const sq = r.squash;
    let sy = 1 - 0.45 * sq;
    let sxz = 1 + 0.25 * sq;
    if (r.state === 'dead') {
      const t = (this.sim.time - r.diedAt) / RAV.deadLinger;
      mat.transparent = true;
      mat.opacity = Math.max(0, 1 - t * t);
      if (r.deathKind === 'oil') {
        y -= t * 0.4;
        mat.color.multiplyScalar(1 - t * 0.7);
      } else {
        sy = 0.55;
        sxz = 1.15;
      }
    }
    m.position.set(x, y - RAV.hy * 0.2, z + (m.userData.zj as number));
    m.rotation.set(r.tumble * 0.6 + 0.08, (m.userData.yaw as number) + r.a * 0.3, r.a);
    m.scale.set(RAV_SCALE * sxz, RAV_SCALE * sy, RAV_SCALE * sxz);
    void now;
  }
}

/** Finger velocity over the last ~80 ms, in world units per second. */
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
