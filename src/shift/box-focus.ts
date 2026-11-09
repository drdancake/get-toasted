import * as THREE from 'three';
import { BOX_FOCUS as B, type Plating, platingFor } from '../config/box-focus';
import { FLAVORS, type FlavorId } from '../config/flavors';
import { STAMPS } from '../config/stamps';
import { clamshellModel, cupModel } from '../render/models';
import { haptic, sfx } from '../ui/feel';
import { type Gesture, prompt } from '../ui/prompt';
import { pop, stamp, stampFrom } from '../ui/stamp';
import { bigCupsFor, type Box, boxSizeFor, type Kitchen, lidOrder } from './kitchen';
import { LID_INK } from './lid-ink';
import type { Rav } from './physics';
import { RavMeshes } from './rav-meshes';

/** A rav on the box floor: where it is, where it's falling from, which cell it's in, which side is up. */
interface Placed {
  r: Rav;
  x: number;
  z: number;
  y: number;
  vy: number;
  yaw: number;
  cell: number;
  delay: number;
  /** Gooey: which side is up (0 first, 1 after a flip), and the flip animation (0..1). */
  side: 0 | 1;
  flip: number;
  chip: HTMLElement;
}

interface Cell {
  c: number;
  r: number;
  x: number;
  z: number;
  /** The line of the ticket this cell is for in the house layout (-1: not a house cell). */
  house: number;
  taken: Placed | null;
  mat: THREE.MeshBasicMaterial;
}

type Garnish = 'parm' | 'parsley' | 'sugar';
const FLAKE: Record<Garnish, string> = { parm: '#fffbe6', parsley: '#2f8a22', sugar: '#ffffff' };
type Phase = 'arrange' | 'dress' | 'dust' | 'flip' | 'close';
const PROMPTS: Record<Phase, [string, Gesture]> = {
  arrange: ['ARRANGE!', 'drag'],
  dress: ['PINCH!', 'pinch'],
  dust: ['DUST!', 'shake'],
  flip: ['FLIP!', 'tap'],
  close: ['CLOSE IT!', 'pull'],
};
/** A flake that landed on a rav: which rav, which side, and where on it. */
interface OnRav {
  id: number;
  side: 0 | 1;
  dx: number;
  dz: number;
  kind: Garnish;
}

/**
 * The box close-up. The open clamshell comes up over the station and the ravs tumble in. ARRANGE:
 * drag them onto the grid (they snap; the house layout glows). Then dress them: a pinch of parm and
 * a pinch of parsley from the quarter pans, sprinkled by hand over every rav (or, for dessert, DUST
 * with the sugar, FLIP each one, DUST again). Each rav shows a little check per garnish. Pull the
 * lid down to send it. Tap outside the box to put it back for now.
 */
export class BoxFocus {
  private root: HTMLElement;
  private canvas: HTMLCanvasElement;
  private chips: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(36, 1, 0.1, 50);
  private ray = new THREE.Raycaster();
  private ravs: RavMeshes;
  private shell: THREE.Group | null = null;
  private hinge: THREE.Object3D | null = null;
  private gridMesh = new THREE.Group();
  private tools: { kind: Garnish; g: THREE.Group; home: THREE.Vector3; pos: THREE.Vector3; pan: boolean }[] = [];
  private pinchBlob: THREE.Mesh;
  private flakes: THREE.InstancedMesh;
  private flakeCount = 0;
  private onRavFlakes = new Map<number, OnRav>();
  private box: Box | null = null;
  private placed: Placed[] = [];
  private cells: Cell[] = [];
  private plating: Plating = platingFor(6, false);
  private cell = 0.6;
  /** The ticket's lines (flavors, in ticket order) for this box. */
  private lines: FlavorId[] = [];
  private gooey = false;
  private garnish = new Map<number, Record<string, number>>();
  private dims: [number, number] = [2, 2];
  private openedAt = 0;
  private lid = 0;
  private grip:
    | { kind: 'rav'; p: Placed; x0: number; y0: number; t0: number; moved: boolean }
    | { kind: 'shaker'; i: number; last: THREE.Vector3 }
    | { kind: 'pinch'; i: number; left: number; over: boolean }
    | { kind: 'lid'; y0: number }
    | null = null;
  private pointer = -1;
  private last = 0;
  private open = false;
  private phase: Phase | null = null;
  private hint: HTMLElement;
  private mat = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private t = 0;
  /** Called when the box goes out (lid shut) or is put back. */
  onClose: ((sent: boolean) => void) | null = null;

  constructor(parent: HTMLElement, private k: Kitchen) {
    this.root = document.createElement('div');
    this.root.className = 'box-focus';
    this.root.hidden = true;
    parent.appendChild(this.root);
    this.canvas = document.createElement('canvas');
    this.root.appendChild(this.canvas);
    this.chips = document.createElement('div');
    this.chips.className = 'rav-chips';
    this.root.appendChild(this.chips);
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
    const table = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), new THREE.MeshStandardMaterial({ color: '#aeb5ba', metalness: 0.6, roughness: 0.38 }));
    table.rotation.x = -Math.PI / 2;
    this.scene.add(table, this.gridMesh);
    this.ravs = new RavMeshes(this.scene);
    this.flakes = new THREE.InstancedMesh(new THREE.BoxGeometry(0.05, 0.016, 0.05), new THREE.MeshStandardMaterial({ roughness: 0.8 }), 4000);
    this.flakes.count = 0;
    for (let i = 0; i < 4000; i++) this.flakes.setColorAt(i, new THREE.Color());
    this.scene.add(this.flakes);
    // What's between your fingers: a little heap of whatever you pinched.
    this.pinchBlob = new THREE.Mesh(new THREE.IcosahedronGeometry(0.11, 0), new THREE.MeshStandardMaterial({ color: '#fff', roughness: 0.9, flatShading: true }));
    this.pinchBlob.scale.set(1, 0.6, 1);
    this.pinchBlob.visible = false;
    this.scene.add(this.pinchBlob);
    this.canvas.addEventListener('pointerdown', (e) => this.down(e));
    this.canvas.addEventListener('pointermove', (e) => this.move(e));
    this.canvas.addEventListener('pointerup', (e) => this.up(e));
    this.canvas.addEventListener('pointercancel', (e) => this.up(e));
    window.addEventListener('resize', () => this.open && this.resize());
  }

  isOpen() {
    return this.open;
  }

  /** Draw now and hand back the canvas (for a feedback screenshot). */
  snapshotCanvas() {
    this.renderer.render(this.scene, this.camera);
    return this.canvas;
  }

  /** What's in the close-up right now (for playtest feedback and tests). */
  debugState() {
    return {
      box: this.box?.id ?? null,
      phase: this.phase,
      cells: this.cells.map((c) => (c.taken ? c.taken.r.flavor[0] : c.house >= 0 ? 'h' : '.')).join(''),
      lid: +this.lid.toFixed(2),
      garnish: this.placed.map((p) => this.garnish.get(p.r.id) ?? {}),
      dressed: this.placed.filter((p) => this.dressed(p)).length,
    };
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
    this.gooey = box.ravs.every((r) => r.flavor === 'gooey');
    // The ticket's flavors, in order (or whatever's in the box, if it's not for anyone).
    this.lines = ref ? ref.item.lines.map((l) => l.flavor) : [...new Set(box.ravs.map((r) => r.flavor))];
    const count = ref?.item.size ?? box.ravs.length;
    this.plating = platingFor(count, this.lines.length > 1);
    const P = this.plating;
    this.cell = Math.min((w - 0.24) / P.cols, (d - 0.24) / P.rows);
    // The box, without its cups: they go on the grid.
    if (this.shell) this.scene.remove(this.shell);
    const ink = LID_INK.get(box.id);
    const label = ink || (box.labeled && ref) ? { name: ref?.order.name ?? '', order: ref ? lidOrder(ref.item) : '', ink } : undefined;
    this.shell = clamshellModel(w, B.wall, d, { paper: !!box.wax, cups: [], label, lidOpen: Math.PI * 0.62 });
    this.hinge = (this.shell.userData.hinge as THREE.Object3D) ?? null;
    this.scene.add(this.shell);
    this.lid = 0;
    // The cups take their spots; a cup on a whole cell blocks it.
    const cupAt = P.cups.slice(0, box.sauces.length);
    const big = bigCupsFor(box.size, box.sauces);
    const blocked = new Set(P.blocked.map(([c, r]) => `${c},${r}`));
    for (const [c, r] of cupAt) if (Number.isInteger(c) && Number.isInteger(r)) blocked.add(`${c},${r}`);
    for (const ch of [...this.gridMesh.children]) this.gridMesh.remove(ch);
    box.sauces.forEach((s, i) => {
      const at = cupAt[i];
      if (!at) return;
      const m = cupModel(s, Math.min(0.2, this.cell * 0.34), big);
      const p = this.cellPos(at[0], at[1]);
      m.position.set(p.x, 0.08, p.z);
      this.gridMesh.add(m);
    });
    // The grid: a soft square on every free cell. The house layout's cells glow while you arrange.
    const houseOf = new Map<string, number>();
    P.house.forEach((cells, line) => cells.forEach(([c, r]) => houseOf.set(`${c},${r}`, line)));
    this.cells = [];
    const sq = new THREE.PlaneGeometry(this.cell * 0.84, this.cell * 0.84);
    for (let r = 0; r < P.rows; r++) {
      for (let c = 0; c < P.cols; c++) {
        if (blocked.has(`${c},${r}`)) continue;
        const p = this.cellPos(c, r);
        const mat = new THREE.MeshBasicMaterial({ color: '#ffd34d', transparent: true, opacity: 0.2, depthWrite: false });
        const m = new THREE.Mesh(sq, mat);
        m.rotation.x = -Math.PI / 2;
        m.position.set(p.x, 0.095, p.z);
        this.gridMesh.add(m);
        this.cells.push({ c, r, x: p.x, z: p.z, house: houseOf.get(`${c},${r}`) ?? -1, taken: null, mat });
      }
    }
    // The ravs tumble in from above, in a heap near the middle.
    this.chips.innerHTML = '';
    this.placed = box.ravs.map((r, i) => {
      const chip = document.createElement('div');
      chip.className = 'rav-chip';
      chip.style.setProperty('--tint', FLAVORS[r.flavor].tint);
      this.chips.appendChild(chip);
      return {
        r,
        x: (Math.random() - 0.5) * w * 0.4,
        z: (Math.random() - 0.5) * d * 0.3,
        y: 2.2 + Math.random() * 1.2,
        vy: 0,
        yaw: Math.random() * Math.PI * 2,
        cell: -1,
        delay: i * (B.dumpTime / Math.max(4, box.ravs.length)),
        side: 0 as const,
        flip: 0,
        chip,
      };
    });
    // The garnish within reach: the parm and parsley quarter pans, or the sugar shaker for dessert.
    for (const s of this.tools) this.scene.remove(s.g);
    const kinds: Garnish[] = this.gooey ? ['sugar'] : ['parm', 'parsley'];
    this.tools = kinds.map((kind, i) => {
      const pan = kind !== 'sugar';
      const g = pan ? panModel(kind) : shakerModel(kind);
      const home = new THREE.Vector3(kinds.length === 1 ? w / 2 + 0.45 : (i === 0 ? -1 : 1) * (w / 2 - 0.15), 0, d / 2 + 0.62);
      g.position.copy(home);
      this.scene.add(g);
      return { kind, g, home, pos: home.clone(), pan };
    });
    this.flakeCount = 0;
    this.flakes.count = 0;
    this.onRavFlakes.clear();
    this.garnish.clear();
    this.phase = null;
    this.openedAt = performance.now();
    this.resize();
    this.hint.textContent = this.gooey ? 'Set them in the spots · dust · flip · dust · pull the lid down' : 'Set them in the spots · a pinch of parm and parsley on each · pull the lid down';
    sfx.toss();
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  /** The middle of a grid cell (fractional cells for the cups between). */
  private cellPos(c: number, r: number) {
    const P = this.plating;
    return { x: (c - (P.cols - 1) / 2) * this.cell, z: (r - (P.rows - 1) / 2) * this.cell - 0.04 };
  }

  private resize() {
    const r = this.canvas.getBoundingClientRect();
    this.renderer.setSize(r.width, r.height, false);
    this.camera.aspect = r.width / r.height;
    const [w, d] = this.dims;
    // Looking down into the box from the front, the pans in frame in front of it.
    const fit = Math.max((w + 1.5) / 2 / Math.tan(THREE.MathUtils.degToRad(18)) / this.camera.aspect, (d + 2.1) / 2 / Math.tan(THREE.MathUtils.degToRad(18)));
    this.camera.position.set(0, fit * 1.12, fit * 0.55);
    this.camera.lookAt(0, 0.2, 0.1);
    this.camera.updateProjectionMatrix();
  }

  /** Has this rav got enough of everything on it? */
  private dressed(p: Placed) {
    const g = this.garnish.get(p.r.id) ?? {};
    const need = B.flakesPerRav;
    return this.gooey ? (g.sugar0 ?? 0) >= need && (g.sugar1 ?? 0) >= need : (g.parm ?? 0) >= need && (g.parsley ?? 0) >= need;
  }

  /** Where the box is at: what the big word on screen should be telling you. */
  private currentPhase(): Phase {
    if (this.placed.some((p) => p.cell < 0)) return 'arrange';
    if (this.placed.every((p) => this.dressed(p))) return 'close';
    if (!this.gooey) return 'dress';
    const need = B.flakesPerRav;
    const topDone = this.placed.every((p) => (this.garnish.get(p.r.id)?.[`sugar${p.side}`] ?? 0) >= need);
    return topDone ? 'flip' : 'dust';
  }

  /**
   * How the layout reads: every rav in a cell, each flavor in one connected group (so the guest can
   * tell which are which), and whether it's the house layout.
   */
  private judgeLayout() {
    const set = this.placed.filter((p) => p.cell >= 0);
    const frac = this.placed.length ? set.length / this.placed.length : 0;
    const at = new Map<string, FlavorId>();
    for (const p of set) {
      const c = this.cells[p.cell];
      if (c) at.set(`${c.c},${c.r}`, p.r.flavor);
    }
    let coherent = true;
    for (const f of new Set(set.map((p) => p.r.flavor))) {
      const mine = [...at].filter(([, v]) => v === f).map(([k2]) => k2);
      const seen = new Set<string>([mine[0] ?? '']);
      const todo = [mine[0] ?? ''];
      while (todo.length) {
        const [c, r] = (todo.pop() ?? '0,0').split(',').map(Number) as [number, number];
        for (const n of [`${c + 1},${r}`, `${c - 1},${r}`, `${c},${r + 1}`, `${c},${r - 1}`]) {
          if (!seen.has(n) && at.get(n) === f) {
            seen.add(n);
            todo.push(n);
          }
        }
      }
      if (seen.size < mine.length) coherent = false;
    }
    // House: each line's flavor exactly in that line's house cells (either way round for a split).
    const P = this.plating;
    const fits = (order: FlavorId[]) =>
      P.house.every((cells, i) => {
        const f = order[i];
        return cells.length === set.filter((p) => p.r.flavor === f).length && cells.every(([c, r]) => at.get(`${c},${r}`) === f);
      });
    const lines = this.lines.length === P.house.length ? this.lines : [this.lines[0] ?? 'beef'];
    const house = frac === 1 && (fits(lines) || (lines.length === 2 && fits([lines[1] as FlavorId, lines[0] as FlavorId])));
    return { frac, coherent, house };
  }

  private close(sent: boolean) {
    if (!this.open || !this.box) return;
    const box = this.box;
    const { frac, coherent, house } = this.judgeLayout();
    box.arranged = frac * (coherent ? 1 : 0.5);
    box.houseStyle = house;
    const dressed = this.placed.filter((p) => this.dressed(p)).length;
    box.garnish = this.placed.length ? dressed / this.placed.length : 0;
    const secs = (performance.now() - this.openedAt) / 1000;
    this.open = false;
    this.root.hidden = true;
    this.chips.innerHTML = '';
    document.body.classList.remove('box-focusing');
    this.grip = null;
    this.box = null;
    if (sent) {
      const neat = box.arranged >= 0.99;
      const dress = box.garnish >= 0.8;
      if (!coherent) stamp('WHICH IS WHICH?', 'KEEP THE FLAVORS TOGETHER.', 'red');
      else if (neat && dress && secs < B.fastSeconds) stamp('PICTURE PERFECT', `${secs.toFixed(1)} SECONDS. FRAME IT.`, 'green');
      else if (house && dress) stampFrom(STAMPS.houseStyle, {}, 'green');
      else if (neat && dress) stamp('BEAUTIFUL', 'SET AND DRESSED.', 'gold');
      else if (neat) stamp('NEAT', box.garnish > 0 ? 'A LITTLE BARE ON TOP.' : 'NAKED, BUT NEAT.', 'gold');
      else if (box.arranged < 0.5) stamp('SLOPPY JOE', 'THEY JUST… FELL IN THERE.', 'red');
      this.k.serve(box);
    }
    this.onClose?.(sent);
  }

  // ---------- Input ----------

  private floorAt(e: { clientX: number; clientY: number }, y = 0.1) {
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

  /** Screen points of things in the close-up (for tests). */
  testPoints() {
    return {
      cells: this.cells.map((c) => ({ ...this.screenAt(c.x, 0.1, c.z), house: c.house, c: c.c, r: c.r })),
      ravs: this.placed.map((p) => ({ ...this.screenAt(p.x, 0.1, p.z), flavor: p.r.flavor, cell: p.cell, side: p.side })),
      tools: this.tools.map((t) => ({ ...this.screenAt(t.home.x, 0.2, t.home.z), kind: t.kind })),
      lid: this.screenAt(0, B.wall + 0.6, -this.dims[1] / 2 - 0.2),
    };
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
    // A pan or the shaker?
    for (let i = 0; i < this.tools.length; i++) {
      const s = this.tools[i];
      if (!s) continue;
      const sp = this.screenOf(s.home.clone().setY(0.2));
      if (Math.hypot(e.clientX - sp.x, e.clientY - sp.y) < 52) {
        this.pointer = e.pointerId;
        if (s.pan) {
          this.grip = { kind: 'pinch', i, left: B.pinchAmount, over: false };
          (this.pinchBlob.material as THREE.MeshStandardMaterial).color.set(FLAKE[s.kind]);
          this.pinchBlob.position.set(p.x, 0.9, p.z - 0.15);
          this.pinchBlob.visible = true;
          sfx.pull();
        } else this.grip = { kind: 'shaker', i, last: p.clone() };
        haptic(6);
        return;
      }
    }
    // A rav?
    let best: Placed | null = null;
    let bd = Math.max(B.grab, this.cell * 0.55);
    for (const pl of this.placed) {
      if (pl.y > 0.5) continue;
      const dd = Math.hypot(pl.x - p.x, pl.z - p.z);
      if (dd < bd) [best, bd] = [pl, dd];
    }
    if (best) {
      this.grip = { kind: 'rav', p: best, x0: e.clientX, y0: e.clientY, t0: performance.now(), moved: false };
      this.pointer = e.pointerId;
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
    if (Math.abs(p.x) > w / 2 + 1.2 || p.z > d / 2 + 1.3) this.close(false);
  }

  private move(e: PointerEvent) {
    const g = this.grip;
    if (!g || e.pointerId !== this.pointer) return;
    const [w, d] = this.dims;
    if (g.kind === 'rav') {
      if (!g.moved && Math.hypot(e.clientX - g.x0, e.clientY - g.y0) < B.flipTapPx) return;
      if (!g.moved) {
        g.moved = true;
        // Picked up out of its cell.
        const c = this.cells[g.p.cell];
        if (c) c.taken = null;
        g.p.cell = -1;
        sfx.pull();
      }
      const p = this.floorAt(e);
      g.p.x = Math.max(-w / 2 + 0.2, Math.min(w / 2 - 0.2, p.x));
      g.p.z = Math.max(-d / 2 + 0.2, Math.min(d / 2 - 0.2, p.z - 0.18));
      g.p.y = 0.35;
      this.syncFlakes(g.p);
    } else if (g.kind === 'shaker') {
      const s = this.tools[g.i];
      if (!s) return;
      // Over the spot just above your fingertip (so your thumb doesn't hide it).
      const p = this.floorAt(e);
      p.z -= 0.15;
      s.pos.set(p.x, 1.1, p.z);
      // Shaking: the faster it moves, the more comes out.
      const moved = p.distanceTo(g.last);
      g.last.copy(p);
      const n = Math.min(16, Math.floor(moved * B.flakeRate * 0.2 + Math.random()));
      for (let i = 0; i < n; i++) this.dropFlake(s.kind, p.x + (Math.random() - 0.5) * 0.34, p.z + (Math.random() - 0.5) * 0.34);
    } else if (g.kind === 'pinch') {
      // It falls on the spot just above your fingertip, so you can see it land.
      const p = this.floorAt(e);
      p.z -= 0.15;
      this.pinchBlob.position.set(p.x, 0.9, p.z);
      g.over = Math.abs(p.x) < w / 2 && Math.abs(p.z) < d / 2;
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
      // A tap (no drag) on a gooey rav flips it over.
      if (!g.moved) {
        if (this.gooey) {
          pl.side = pl.side ? 0 : 1;
          pl.flip = 1;
          this.syncFlakes(pl);
          sfx.toss();
          haptic(6);
        }
        return;
      }
      pl.y = 0.1;
      // Snap into the nearest free cell.
      let best: Cell | null = null;
      let bd = Infinity;
      for (const c of this.cells) {
        if (c.taken) continue;
        const dd = Math.hypot(c.x - pl.x, c.z - pl.z);
        if (dd < bd) [best, bd] = [c, dd];
      }
      if (best) {
        best.taken = pl;
        pl.cell = this.cells.indexOf(best);
        pl.x = best.x;
        pl.z = best.z;
        pl.yaw = 0;
        this.syncFlakes(pl);
        sfx.catch(2 + this.cells.filter((x) => x.taken).length);
        haptic(6);
        if (this.placed.every((x) => x.cell >= 0)) {
          const sp = this.screenOf(new THREE.Vector3(0, 0.4, 0));
          const { coherent, house } = this.judgeLayout();
          pop(house ? 'HOUSE STYLE!' : coherent ? 'SET!' : 'MIXED UP?', sp.x, sp.y, true);
          if (coherent) sfx.perfect();
          else sfx.reject();
        }
      } else sfx.rim();
    } else if (g.kind === 'shaker') {
      const s = this.tools[g.i];
      if (s) s.pos.copy(s.home);
    } else if (g.kind === 'pinch') {
      this.pinchBlob.visible = false;
    } else if (g.kind === 'lid') {
      if (this.lid >= B.lidClose) {
        this.lid = 1;
        sfx.toss();
        haptic(16);
        // A beat to admire your own label on the shut lid.
        window.setTimeout(() => this.close(true), LID_INK.has(this.box?.id ?? -1) ? 900 : 180);
      } else this.lid = 0;
    }
  }

  /** A flake of garnish lands where it falls: on a rav (dressing its top side) or on the paper. */
  private dropFlake(kind: Garnish, x: number, z: number) {
    if (this.flakeCount >= 4000) return;
    const [w, d] = this.dims;
    if (Math.abs(x) > w / 2 || Math.abs(z) > d / 2) return;
    let y = 0.1;
    let on: Placed | null = null;
    for (const pl of this.placed) {
      const rr = 0.24 * (FLAVORS[pl.r.flavor].size ?? 1);
      if (pl.y < 0.5 && Math.hypot(pl.x - x, pl.z - z) < rr) {
        y = 0.19;
        on = pl;
        const key = kind === 'sugar' ? `sugar${pl.side}` : kind;
        const m = this.garnish.get(pl.r.id) ?? {};
        const was = this.dressed(pl);
        m[key] = (m[key] ?? 0) + 1;
        this.garnish.set(pl.r.id, m);
        if (!was && this.dressed(pl)) {
          const sp = this.screenOf(new THREE.Vector3(pl.x, 0.3, pl.z));
          pop('✓', sp.x, sp.y - 14);
          sfx.catch(3);
        }
        break;
      }
    }
    const i = this.flakeCount++;
    if (on) this.onRavFlakes.set(i, { id: on.r.id, side: on.side, dx: x - on.x, dz: z - on.z, kind });
    this.q.setFromEuler(new THREE.Euler(0, Math.random() * 3, 0));
    this.mat.compose(new THREE.Vector3(x, y + Math.random() * 0.02, z), this.q, new THREE.Vector3(1, 1, 1).multiplyScalar(kind === 'parsley' ? 0.9 : 1));
    this.flakes.setMatrixAt(i, this.mat);
    this.flakes.setColorAt(i, new THREE.Color(FLAKE[kind]));
    this.flakes.count = this.flakeCount;
    this.flakes.instanceMatrix.needsUpdate = true;
    if (this.flakes.instanceColor) this.flakes.instanceColor.needsUpdate = true;
  }

  /** Garnish rides its rav: moved, it goes along; flipped, the side that's down disappears under it. */
  private syncFlakes(pl: Placed) {
    for (const [i, f] of this.onRavFlakes) {
      if (f.id !== pl.r.id) continue;
      const up = f.side === pl.side && pl.flip < 0.5;
      this.q.setFromEuler(new THREE.Euler(0, (i * 1.7) % 3, 0));
      this.mat.compose(new THREE.Vector3(pl.x + f.dx, pl.y + 0.09, pl.z + f.dz), this.q, new THREE.Vector3(1, 1, 1).multiplyScalar(up ? 1 : 0));
      this.flakes.setMatrixAt(i, this.mat);
    }
    this.flakes.instanceMatrix.needsUpdate = true;
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
    this.t += dt;
    // Ravs tumbling in.
    let landed = true;
    for (const pl of this.placed) {
      if (pl.delay > 0) {
        pl.delay -= dt;
        landed = false;
        continue;
      }
      if (this.grip?.kind === 'rav' && this.grip.p === pl && this.grip.moved) continue;
      if (pl.y > 0.1) {
        landed = false;
        pl.vy -= 22 * dt;
        pl.y = Math.max(0.1, pl.y + pl.vy * dt);
        if (pl.y === 0.1) {
          if (pl.vy < -4) sfx.catch(1);
          pl.vy = 0;
        }
      }
      if (pl.flip > 0) {
        const was = pl.flip;
        pl.flip = Math.max(0, pl.flip - dt * 4);
        if (was >= 0.5 && pl.flip < 0.5) this.syncFlakes(pl);
      }
    }
    // A pinch falls where your fingers are, while there's some left and you're over the box.
    const g = this.grip;
    if (g?.kind === 'pinch' && g.over && g.left > 0) {
      const tool = this.tools[g.i];
      const n = Math.min(g.left, Math.floor(B.pinchRate * dt + Math.random()));
      const c = this.pinchBlob.position;
      for (let i = 0; i < n && tool; i++) {
        const a = Math.random() * Math.PI * 2;
        const rr = Math.sqrt(Math.random()) * B.pinchSpread;
        this.dropFlake(tool.kind, c.x + Math.cos(a) * rr, c.z + Math.sin(a) * rr);
      }
      g.left -= n;
      const s = Math.max(0.25, g.left / B.pinchAmount);
      this.pinchBlob.scale.set(s, s * 0.6, s);
      if (g.left <= 0) this.pinchBlob.visible = false;
    }
    // The big word for whatever's next (once the ravs have landed).
    if (landed) {
      const ph = this.currentPhase();
      if (ph !== this.phase) {
        this.phase = ph;
        const [word, gesture] = PROMPTS[ph];
        prompt(word, gesture);
      }
    }
    // The grid: the house cells breathe while you arrange; taken cells go quiet.
    const pulse = 0.5 + 0.5 * Math.sin(this.t * 5);
    for (const c of this.cells) {
      const arranging = this.phase === 'arrange' || this.phase === null;
      c.mat.color.set(c.taken ? '#7fd08a' : c.house >= 0 ? '#ffd34d' : '#ffffff');
      c.mat.opacity = c.taken ? (arranging ? 0.3 : 0) : arranging ? (c.house >= 0 ? 0.28 + 0.3 * pulse : 0.16) : 0.06;
    }
    // The lid, following your finger (or springing back open).
    if (this.hinge) {
      const open = Math.PI * 0.62;
      this.hinge.rotation.x = -open * (1 - this.lid);
    }
    for (const s of this.tools) {
      if (s.pan) continue;
      s.g.position.lerp(s.pos, 0.35);
      // Tipped over the box while you shake it.
      s.g.rotation.z = s.pos.y > 0.5 ? Math.PI * 0.85 : 0;
    }
    this.ravs.begin();
    for (const pl of this.placed) {
      const m = this.ravs.get(pl.r);
      // A flip hops it up and over.
      const hop = Math.sin(pl.flip * Math.PI) * 0.35;
      m.position.set(pl.x, pl.y + 0.05 + hop, pl.z);
      m.rotation.set((pl.cell >= 0 ? 0 : 0.08) + pl.flip * Math.PI, pl.yaw, pl.y > 0.4 ? Math.sin(pl.y * 3) * 0.6 : 0);
    }
    this.ravs.end();
    this.updateChips();
    const set = this.placed.filter((p) => p.cell >= 0).length;
    this.hint.dataset.set = `${set}/${this.placed.length}`;
  }

  /**
   * A little tag over each rav: its flavor while you arrange a split (they look alike), then one dot
   * per garnish that lights up when there's enough on it (sugar: one per side).
   */
  private updateChips() {
    const split = this.lines.length > 1;
    const arranging = this.phase === 'arrange' || this.phase === null;
    const need = B.flakesPerRav;
    // The tags live in the close-up's own box: page coordinates less its corner.
    const origin = this.root.getBoundingClientRect();
    for (const pl of this.placed) {
      const chip = pl.chip;
      if (pl.y > 0.5 || pl.delay > 0) {
        chip.hidden = true;
        continue;
      }
      const g = this.garnish.get(pl.r.id) ?? {};
      let html: string;
      if (arranging) html = split ? `<span>${FLAVORS[pl.r.flavor].short.replace('OG ', '')}</span>` : '';
      else if (this.dressed(pl)) html = '<b class="done">✓</b>';
      else if (this.gooey) html = [0, 1].map((s) => `<i class="dot sugar ${(g[`sugar${s}`] ?? 0) >= need ? 'on' : ''}${pl.side === s ? ' up' : ''}">${s + 1}</i>`).join('');
      else html = (['parm', 'parsley'] as const).map((k2) => `<i class="dot ${k2} ${(g[k2] ?? 0) >= need ? 'on' : ''}"></i>`).join('');
      chip.hidden = !html;
      if (chip.dataset.html !== html) {
        chip.dataset.html = html;
        chip.innerHTML = html;
      }
      const sp = this.screenOf(new THREE.Vector3(pl.x, 0.3, pl.z - this.cell * 0.42));
      chip.style.transform = `translate(-50%, -100%) translate(${sp.x - origin.left}px, ${sp.y - origin.top}px)`;
    }
  }
}

/** A quarter pan of garnish: a shallow steel tray heaped with grated parm or chopped parsley. */
function panModel(kind: Garnish) {
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: '#c9cfd3', metalness: 0.75, roughness: 0.28 });
  const pan = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.18, 0.56), steel);
  pan.position.y = 0.09;
  g.add(pan);
  const fill = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 0.06, 0.48, 6, 1, 4),
    new THREE.MeshStandardMaterial({ color: kind === 'parm' ? '#f2ead2' : '#3f8f2e', roughness: 1, flatShading: true }),
  );
  // A little heaped and lumpy.
  const p = fill.geometry.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) p.setY(i, p.getY(i) + Math.random() * 0.04);
  fill.geometry.computeVertexNormals();
  fill.position.y = 0.17;
  g.add(fill);
  return g;
}

/** The powdered sugar shaker: tall steel. */
function shakerModel(kind: Garnish) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.17, 0.62, 12), new THREE.MeshStandardMaterial({ color: '#c9cfd3', metalness: 0.8, roughness: 0.25 }));
  body.position.y = 0.31;
  g.add(body);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.08, 12), new THREE.MeshStandardMaterial({ color: '#e3e7ea', metalness: 0.8, roughness: 0.4 }));
  cap.position.y = 0.66;
  g.add(cap);
  void kind;
  return g;
}
