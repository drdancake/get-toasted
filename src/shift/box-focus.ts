import * as THREE from 'three';
import { BOX_FOCUS as B, LAYOUTS } from '../config/box-focus';
import { FLAVORS } from '../config/flavors';
import { clamshellModel } from '../render/models';
import { haptic, sfx } from '../ui/feel';
import { pop, stamp } from '../ui/stamp';
import { bigCupsFor, type Box, boxSizeFor, type Kitchen } from './kitchen';
import type { Rav } from './physics';
import { RavMeshes } from './rav-meshes';

/** A rav on the box floor: where it is, where it's falling from, which spot it's in. */
interface Placed {
  r: Rav;
  x: number;
  z: number;
  y: number;
  vy: number;
  yaw: number;
  spot: number;
  delay: number;
}

type Garnish = 'parm' | 'parsley' | 'sugar';
const FLAKE: Record<Garnish, string> = { parm: '#f6f0dc', parsley: '#3f8f2e', sugar: '#ffffff' };

/**
 * The box close-up. The open clamshell comes up over the station, the ravs tumble in, and you drag
 * them into the layout (faint spots show where). The shakers sit either side: drag one over the box
 * and shake to dress the ravs. Pull the lid down to shut it, and the box goes out with a
 * presentation score. Tap outside the box to put it back without sending it.
 */
export class BoxFocus {
  private root: HTMLElement;
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(36, 1, 0.1, 50);
  private ray = new THREE.Raycaster();
  private ravs: RavMeshes;
  private shell: THREE.Group | null = null;
  private hinge: THREE.Object3D | null = null;
  private spotsMesh = new THREE.Group();
  private shakers: { kind: Garnish; g: THREE.Group; home: THREE.Vector3; pos: THREE.Vector3 }[] = [];
  private flakes: THREE.InstancedMesh;
  private flakeCount = 0;
  private box: Box | null = null;
  private placed: Placed[] = [];
  private spots: { x: number; z: number; taken: Placed | null }[] = [];
  private onRav = new Map<number, Record<string, number>>();
  private dims: [number, number] = [2, 2];
  private openedAt = 0;
  private lid = 0;
  private grip: { kind: 'rav'; p: Placed } | { kind: 'shaker'; i: number; last: THREE.Vector3 } | { kind: 'lid'; y0: number } | null = null;
  private pointer = -1;
  private last = 0;
  private open = false;
  private hint: HTMLElement;
  private mat = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  /** Called when the box goes out (lid shut) or is put back. */
  onClose: ((sent: boolean) => void) | null = null;

  constructor(parent: HTMLElement, private k: Kitchen) {
    this.root = document.createElement('div');
    this.root.className = 'box-focus';
    this.root.hidden = true;
    parent.appendChild(this.root);
    this.canvas = document.createElement('canvas');
    this.root.appendChild(this.canvas);
    this.hint = document.createElement('div');
    this.hint.className = 'box-focus-hint';
    this.root.appendChild(this.hint);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.scene.add(new THREE.HemisphereLight('#fff7ea', '#8a7c68', 1.7));
    const key = new THREE.DirectionalLight('#fff6e8', 2.3);
    key.position.set(-3, 8, 5);
    this.scene.add(key);
    // The steel table under it all.
    const table = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), new THREE.MeshStandardMaterial({ color: '#aeb5ba', metalness: 0.6, roughness: 0.38 }));
    table.rotation.x = -Math.PI / 2;
    this.scene.add(table, this.spotsMesh);
    this.ravs = new RavMeshes(this.scene);
    this.flakes = new THREE.InstancedMesh(new THREE.BoxGeometry(0.035, 0.012, 0.035), new THREE.MeshStandardMaterial({ roughness: 0.8 }), 2400);
    this.flakes.count = 0;
    for (let i = 0; i < 2400; i++) this.flakes.setColorAt(i, new THREE.Color());
    this.scene.add(this.flakes);
    this.canvas.addEventListener('pointerdown', (e) => this.down(e));
    this.canvas.addEventListener('pointermove', (e) => this.move(e));
    this.canvas.addEventListener('pointerup', (e) => this.up(e));
    this.canvas.addEventListener('pointercancel', (e) => this.up(e));
    window.addEventListener('resize', () => this.open && this.resize());
  }

  isOpen() {
    return this.open;
  }

  /** Bring a box up close: the ravs in it tumble onto the paper. */
  show(box: Box) {
    if (!box.ravs.length) return;
    this.box = box;
    this.open = true;
    this.root.hidden = false;
    document.body.classList.add('box-focusing');
    const ref = this.k.itemFor(box);
    const size = box.size ?? (ref ? boxSizeFor(ref.item) : 'M');
    this.dims = B.size[size] ?? [2.1, 2];
    const [w, d] = this.dims;
    // The box.
    if (this.shell) this.scene.remove(this.shell);
    const label = box.labeled && ref ? { name: ref.order.name ?? '', order: '' } : undefined;
    this.shell = clamshellModel(w, B.wall, d, { paper: !!box.wax, cups: box.sauces, bigCups: bigCupsFor(box.size, box.sauces), label, lidOpen: Math.PI * 0.62 });
    this.hinge = (this.shell.userData.hinge as THREE.Object3D) ?? null;
    this.scene.add(this.shell);
    this.lid = 0;
    // The layout spots, as faint rounded squares on the paper.
    const count = ref?.item.size ?? box.ravs.length;
    const rows = LAYOUTS[count] ?? LAYOUTS[6] ?? [3, 2, 1];
    const gooey = box.ravs.every((r) => r.flavor === 'gooey');
    const sp = gooey ? B.spacing * 1.5 : B.spacing;
    this.spots = [];
    rows.forEach((n, ri) => {
      const z = (ri - (rows.length - 1) / 2) * sp - 0.08;
      for (let c = 0; c < n; c++) this.spots.push({ x: (c - ((rows[0] ?? n) - 1) / 2) * sp, z, taken: null });
    });
    for (const c of [...this.spotsMesh.children]) this.spotsMesh.remove(c);
    const ring = new THREE.MeshBasicMaterial({ color: '#2b2a28', transparent: true, opacity: 0.22, depthWrite: false });
    for (const s of this.spots) {
      const m = new THREE.Mesh(new THREE.RingGeometry(sp * 0.36, sp * 0.42, 4, 1), ring);
      m.rotation.set(-Math.PI / 2, 0, Math.PI / 4);
      m.position.set(s.x, 0.1, s.z);
      this.spotsMesh.add(m);
    }
    // The ravs tumble in from above, in a heap near the middle.
    this.placed = box.ravs.map((r, i) => ({
      r,
      x: (Math.random() - 0.5) * w * 0.4,
      z: (Math.random() - 0.5) * d * 0.35,
      y: 2.2 + Math.random() * 1.2,
      vy: 0,
      yaw: Math.random() * Math.PI * 2,
      spot: -1,
      delay: i * (B.dumpTime / Math.max(4, box.ravs.length)),
    }));
    // The shakers at arm's reach: parm and parsley, or powdered sugar for dessert.
    for (const s of this.shakers) this.scene.remove(s.g);
    const kinds: Garnish[] = gooey ? ['sugar'] : ['parm', 'parsley'];
    this.shakers = kinds.map((kind, i) => {
      const g = shakerModel(kind);
      const home = new THREE.Vector3(kinds.length === 1 ? w / 2 + 0.42 : (i === 0 ? -1 : 1) * (w / 2 + 0.42), 0, d / 2 + 0.35);
      g.position.copy(home);
      this.scene.add(g);
      return { kind, g, home, pos: home.clone() };
    });
    this.flakeCount = 0;
    this.flakes.count = 0;
    this.onRav.clear();
    this.openedAt = performance.now();
    this.resize();
    this.hint.textContent = gooey ? 'Set them in the spots · sugar them · pull the lid down' : 'Set them in the spots · parm + parsley · pull the lid down';
    sfx.toss();
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  private resize() {
    const r = this.canvas.getBoundingClientRect();
    this.renderer.setSize(r.width, r.height, false);
    this.camera.aspect = r.width / r.height;
    const [w, d] = this.dims;
    // Looking down into the box from the front, the shakers in frame either side.
    const fit = Math.max((w + 1.6) / 2 / Math.tan(THREE.MathUtils.degToRad(18)) / this.camera.aspect, (d + 1.8) / 2 / Math.tan(THREE.MathUtils.degToRad(18)));
    this.camera.position.set(0, fit * 1.12, fit * 0.5);
    this.camera.lookAt(0, 0.2, -0.15);
    this.camera.updateProjectionMatrix();
  }

  private close(sent: boolean) {
    if (!this.open || !this.box) return;
    const box = this.box;
    // Presentation: how much of the layout is set, and how well it's dressed.
    const need = this.spots.length;
    const set = this.spots.filter((s) => s.taken).length;
    box.arranged = need ? set / need : 0;
    const gooey = box.ravs.every((r) => r.flavor === 'gooey');
    const kinds = gooey ? ['sugar'] : ['parm', 'parsley'];
    const dressed = this.placed.filter((p) => kinds.every((g) => (this.onRav.get(p.r.id)?.[g] ?? 0) >= B.flakesPerRav)).length;
    box.garnish = this.placed.length ? dressed / this.placed.length : 0;
    const secs = (performance.now() - this.openedAt) / 1000;
    this.open = false;
    this.root.hidden = true;
    document.body.classList.remove('box-focusing');
    this.grip = null;
    this.box = null;
    if (sent) {
      const neat = box.arranged >= 0.99;
      const dress = box.garnish >= 0.8;
      if (neat && dress && secs < B.fastSeconds) stamp('PICTURE PERFECT', `${secs.toFixed(1)} SECONDS. FRAME IT.`, 'green');
      else if (neat && dress) stamp('BEAUTIFUL', 'SET AND DRESSED.', 'gold');
      else if (neat) stamp('NEAT', box.garnish > 0 ? 'A LITTLE BARE ON TOP.' : 'NAKED, BUT NEAT.', 'gold');
      else if (box.arranged < 0.5) stamp('SLOPPY JOE', 'THEY JUST… FELL IN THERE.', 'red');
      this.k.serve(box);
    }
    this.onClose?.(sent);
  }

  // ---------- Input ----------

  private floorAt(e: PointerEvent, y = 0.1) {
    const r = this.canvas.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
    const p = new THREE.Vector3();
    this.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), p);
    return p;
  }

  /** Screen point of a spot in the box (for tests and tags). */
  screenAt(x: number, y: number, z: number) {
    return this.screenOf(new THREE.Vector3(x, y, z));
  }

  private screenOf(v: THREE.Vector3) {
    const p = v.clone().project(this.camera);
    const r = this.canvas.getBoundingClientRect();
    return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height };
  }

  private down(e: PointerEvent) {
    e.preventDefault();
    if (this.grip) return;
    const p = this.floorAt(e);
    const [w, d] = this.dims;
    // A shaker?
    for (let i = 0; i < this.shakers.length; i++) {
      const s = this.shakers[i];
      if (!s) continue;
      const sp = this.screenOf(s.pos.clone().setY(0.35));
      if (Math.hypot(e.clientX - sp.x, e.clientY - sp.y) < 46) {
        this.grip = { kind: 'shaker', i, last: p.clone() };
        this.pointer = e.pointerId;
        haptic(6);
        return;
      }
    }
    // A rav?
    let best: Placed | null = null;
    let bd = B.grab;
    for (const pl of this.placed) {
      if (pl.y > 0.5) continue;
      const dd = Math.hypot(pl.x - p.x, pl.z - p.z);
      if (dd < bd) [best, bd] = [pl, dd];
    }
    if (best) {
      if (best.spot >= 0) {
        const s = this.spots[best.spot];
        if (s) s.taken = null;
        best.spot = -1;
      }
      this.grip = { kind: 'rav', p: best };
      this.pointer = e.pointerId;
      sfx.pull();
      haptic(4);
      return;
    }
    // The lid, standing up behind the box: pull it down to shut it.
    if (p.z < -d / 2 - 0.05 || e.clientY < this.screenOf(new THREE.Vector3(0, B.wall, -d / 2)).y) {
      this.grip = { kind: 'lid', y0: e.clientY };
      this.pointer = e.pointerId;
      return;
    }
    // Off the box entirely: put it back for now.
    if (Math.abs(p.x) > w / 2 + 1.2 || p.z > d / 2 + 0.9) this.close(false);
  }

  private move(e: PointerEvent) {
    const g = this.grip;
    if (!g || e.pointerId !== this.pointer) return;
    const [w, d] = this.dims;
    if (g.kind === 'rav') {
      const p = this.floorAt(e);
      g.p.x = Math.max(-w / 2 + 0.2, Math.min(w / 2 - 0.2, p.x));
      g.p.z = Math.max(-d / 2 + 0.2, Math.min(d / 2 - 0.2, p.z - 0.18));
      g.p.y = 0.35;
    } else if (g.kind === 'shaker') {
      const s = this.shakers[g.i];
      if (!s) return;
      const p = this.floorAt(e, 1.1);
      s.pos.set(p.x, 1.1, p.z - 0.15);
      // Shaking: the faster it moves, the more comes out.
      const moved = p.distanceTo(g.last);
      g.last.copy(p);
      const n = Math.min(12, Math.floor(moved * B.flakeRate * 0.2 + Math.random()));
      for (let i = 0; i < n; i++) this.dropFlake(s.kind, s.pos.x + (Math.random() - 0.5) * 0.3, s.pos.z + (Math.random() - 0.5) * 0.3);
    } else if (g.kind === 'lid') {
      const r = this.canvas.getBoundingClientRect();
      this.lid = Math.max(0, Math.min(1, (e.clientY - g.y0) / (r.height * 0.35)));
    }
  }

  private up(e: PointerEvent) {
    const g = this.grip;
    if (!g || e.pointerId !== this.pointer) return;
    this.grip = null;
    if (g.kind === 'rav') {
      const pl = g.p;
      pl.y = 0.1;
      // Snap into the nearest free spot.
      let bi = -1;
      let bd = B.snap;
      this.spots.forEach((s, i) => {
        if (s.taken) return;
        const dd = Math.hypot(s.x - pl.x, s.z - pl.z);
        if (dd < bd) [bi, bd] = [i, dd];
      });
      const s = this.spots[bi];
      if (s) {
        s.taken = pl;
        pl.spot = bi;
        pl.x = s.x;
        pl.z = s.z;
        pl.yaw = 0;
        sfx.catch(2 + this.spots.filter((x) => x.taken).length);
        haptic(6);
        if (this.spots.every((x) => x.taken)) {
          const sp = this.screenOf(new THREE.Vector3(0, 0.4, 0));
          pop('SET!', sp.x, sp.y, true);
          sfx.perfect();
        }
      } else sfx.rim();
    } else if (g.kind === 'shaker') {
      const s = this.shakers[g.i];
      if (s) s.pos.copy(s.home);
    } else if (g.kind === 'lid') {
      if (this.lid >= B.lidClose) {
        this.lid = 1;
        sfx.toss();
        haptic(16);
        window.setTimeout(() => this.close(true), 180);
      } else this.lid = 0;
    }
  }

  /** A flake of garnish lands where it falls: on a rav (dressing it) or on the paper. */
  private dropFlake(kind: Garnish, x: number, z: number) {
    if (this.flakeCount >= 2400) return;
    const [w, d] = this.dims;
    if (Math.abs(x) > w / 2 || Math.abs(z) > d / 2) return;
    let y = 0.1;
    for (const pl of this.placed) {
      const rr = 0.22 * (FLAVORS[pl.r.flavor].size ?? 1);
      if (pl.y < 0.5 && Math.hypot(pl.x - x, pl.z - z) < rr) {
        y = 0.19;
        const m = this.onRav.get(pl.r.id) ?? {};
        m[kind] = (m[kind] ?? 0) + 1;
        this.onRav.set(pl.r.id, m);
        break;
      }
    }
    this.q.setFromEuler(new THREE.Euler(0, Math.random() * 3, 0));
    this.mat.compose(new THREE.Vector3(x, y + Math.random() * 0.02, z), this.q, new THREE.Vector3(1, 1, 1).multiplyScalar(kind === 'parsley' ? 0.9 : 1));
    this.flakes.setMatrixAt(this.flakeCount, this.mat);
    this.flakes.setColorAt(this.flakeCount, new THREE.Color(FLAKE[kind]));
    this.flakeCount++;
    this.flakes.count = this.flakeCount;
    this.flakes.instanceMatrix.needsUpdate = true;
    if (this.flakes.instanceColor) this.flakes.instanceColor.needsUpdate = true;
  }

  private frame(now: number) {
    if (!this.open) return;
    const dt = Math.min(1 / 30, (now - this.last) / 1000);
    this.last = now;
    this.step(dt);
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame((t) => this.frame(t));
  }

  /** Advance the close-up by dt (public so tests can drive it). */
  step(dt: number) {
    // Ravs tumbling in.
    for (const pl of this.placed) {
      if (pl.delay > 0) {
        pl.delay -= dt;
        continue;
      }
      if (this.grip?.kind === 'rav' && this.grip.p === pl) continue;
      if (pl.y > 0.1) {
        pl.vy -= 22 * dt;
        pl.y = Math.max(0.1, pl.y + pl.vy * dt);
        if (pl.y === 0.1) {
          if (pl.vy < -4) sfx.catch(1);
          pl.vy = 0;
        }
      }
    }
    // The lid, following your finger (or springing back open).
    if (this.hinge) {
      const open = Math.PI * 0.62;
      this.hinge.rotation.x = -open * (1 - this.lid);
    }
    for (const s of this.shakers) {
      s.g.position.lerp(s.pos, 0.35);
      // Tipped over the box while you shake it.
      s.g.rotation.z = s.pos.y > 0.5 ? Math.PI * 0.85 : 0;
    }
    this.ravs.begin();
    for (const pl of this.placed) {
      const m = this.ravs.get(pl.r);
      m.position.set(pl.x, pl.y + 0.05, pl.z);
      m.rotation.set(pl.spot >= 0 ? 0 : 0.08, pl.yaw, pl.y > 0.4 ? Math.sin(pl.y * 3) * 0.6 : 0);
    }
    this.ravs.end();
    const set = this.spots.filter((s) => s.taken).length;
    this.hint.dataset.set = `${set}/${this.spots.length}`;
  }
}

/** A garnish shaker: grated parm (white, green cap), parsley (a clear jar of green), powdered sugar (tall steel). */
function shakerModel(kind: Garnish) {
  const g = new THREE.Group();
  const tall = kind === 'sugar';
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.16, 0.17, tall ? 0.62 : 0.42, 12),
    kind === 'sugar'
      ? new THREE.MeshStandardMaterial({ color: '#c9cfd3', metalness: 0.8, roughness: 0.25 })
      : new THREE.MeshStandardMaterial({ color: kind === 'parm' ? '#f4efe0' : '#5f9e45', roughness: 0.5, transparent: kind === 'parsley', opacity: 0.9 }),
  );
  body.position.y = (tall ? 0.62 : 0.42) / 2;
  g.add(body);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.08, 12), new THREE.MeshStandardMaterial({ color: kind === 'parm' ? '#2f7d3a' : kind === 'parsley' ? '#d8dde0' : '#e3e7ea', metalness: kind === 'sugar' ? 0.8 : 0.2, roughness: 0.4 }));
  cap.position.y = (tall ? 0.62 : 0.42) + 0.04;
  g.add(cap);
  return g;
}
