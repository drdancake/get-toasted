import * as THREE from 'three';
import { BOX_FOCUS as B, type Plating, platingFor } from '../config/box-focus';
import { FLAVORS, type FlavorId } from '../config/flavors';
import { STAMPS } from '../config/stamps';
import { clamshellModel, cupModel, woodMaterial } from '../render/models';
import { haptic, sfx } from '../ui/feel';
import { type Gesture, prompt } from '../ui/prompt';
import { pop, stamp, stampFrom } from '../ui/stamp';
import { bigCupsFor, type Box, boxSizeFor, type Kitchen, lidOrder, type PlateFlake, saucesFor } from './kitchen';
import { LID_INK } from './lid-ink';
import type { Rav } from './physics';
import { RavMeshes } from './rav-meshes';
import { clear, dispose } from '../render/dispose';

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

/** One box on the table in the close-up: where it sits, its grid, its lid. */
interface Slot {
  box: Box;
  /** Where its middle is on the steel (world units). */
  ox: number;
  oz: number;
  w: number;
  d: number;
  plating: Plating;
  cell: number;
  cells: Cell[];
  lines: FlavorId[];
  gooey: boolean;
  shell: THREE.Group;
  hinge: THREE.Object3D | null;
  lid: number;
  /** Shutting: the lid's down and it's about to go out. */
  shut: boolean;
  /** How far its lid stands open (radians). */
  open: number;
  /** Everything of this box in the scene (to clear it when it's gone down the line). */
  group: THREE.Group;
}

/** A rav on a box floor: where it is (world), where it's falling from, its cell, which side is up. */
interface Placed {
  r: Rav;
  slot: Slot;
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

/** A flake that landed on a rav: which rav, which side, and where on it. */
interface OnRav {
  id: number;
  side: 0 | 1;
  dx: number;
  dz: number;
}

/**
 * The close-up: an assembly line. Once the bowl's poured out, the full boxes come up one at a time:
 * the ravs tumble in and you ARRANGE them on the grid (they snap; the house layout glows), dress them
 * (one pinch of parm, one of parsley, swept over; dessert gets DUST, FLIP, DUST; a dot per garnish
 * over each rav), and pull the lid down. It goes out, slides off left, and the next box slides in.
 * Tap off the box to put the line down for now (what you've set stays set).
 */
export class BoxFocus {
  private root: HTMLElement;
  private canvas: HTMLCanvasElement;
  private chips: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(36, 1, 0.1, 80);
  private ray = new THREE.Raycaster();
  private ravs: RavMeshes;
  private world = new THREE.Group();
  private slots: Slot[] = [];
  private tools: { kind: Garnish; g: THREE.Group; home: THREE.Vector3; pos: THREE.Vector3; pan: boolean; tag: HTMLElement }[] = [];
  private pinchBlob: THREE.Mesh;
  private flakes: THREE.InstancedMesh;
  private flakeCount = 0;
  private onRavFlakes = new Map<number, OnRav>();
  private placed: Placed[] = [];
  private garnish = new Map<number, Record<string, number>>();
  /** Bounds of everything on the steel (for the camera and tap-off). */
  private span = { x0: -1, x1: 1, z0: -1, z1: 1 };
  private openedAt = 0;
  private grip:
    | { kind: 'rav'; p: Placed; x0: number; y0: number; moved: boolean }
    | { kind: 'shaker'; i: number; last: THREE.Vector3; dir: number; turn: number }
    | { kind: 'pinch'; i: number; left: number; over: boolean; last: THREE.Vector3 | null }
    | { kind: 'lid'; s: Slot; y0: number }
    | null = null;
  private pointer = -1;
  private last = 0;
  private open = false;
  private phase: Phase | null = null;
  private hint: HTMLElement;
  private mat = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private t = 0;
  /** Called when the close-up goes away: true if anything went out. */
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
    this.scene.add(new THREE.HemisphereLight('#fff8e6', '#c79a63', 1.75));
    const key = new THREE.DirectionalLight('#fff6e8', 2.3);
    key.position.set(-3, 8, 5);
    this.scene.add(key);
    // The steel table under it all.
    const table = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), woodMaterial(6, 6));
    table.rotation.x = -Math.PI / 2;
    this.scene.add(table, this.world);
    this.ravs = new RavMeshes(this.scene);
    this.flakes = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.028, 0.028, 0.016, 8), new THREE.MeshStandardMaterial({ roughness: 0.8 }), B.maxFlakes);
    this.flakes.count = 0;
    for (let i = 0; i < B.maxFlakes; i++) this.flakes.setColorAt(i, new THREE.Color());
    this.scene.add(this.flakes);
    // What's between your fingers: a little heap of whatever you pinched.
    this.pinchBlob = new THREE.Mesh(new THREE.IcosahedronGeometry(0.13, 0), new THREE.MeshStandardMaterial({ color: '#fff', roughness: 0.9, flatShading: true }));
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
      boxes: this.slots.map((s) => s.box.id),
      phase: this.phase,
      cells: this.slots.map((s) => s.cells.map((c) => (c.taken ? c.taken.r.flavor[0] : c.house >= 0 ? 'h' : '.')).join('')),
      lids: this.slots.map((s) => +s.lid.toFixed(2)),
      garnish: this.placed.map((p) => this.garnish.get(p.r.id) ?? {}),
      dressed: this.placed.filter((p) => this.dressed(p)).length,
    };
  }



  /** Full boxes waiting their turn on the line, after the one in front of you. */
  private queue: Box[] = [];
  /** The line moving along: the old box slides off left as the next comes in from the right. */
  private slide: { from: number; to: number; t: number; old: Slot } | null = null;
  private camX = 0;

  /** The full boxes on the table, the given one first, then the rest of its ticket, then the others. */
  lineFrom(first: Box) {
    const full = this.k.board.filter((b) => b !== first && b.mode === 'ready' && b.ravs.length && b.ravs.length >= (this.k.itemFor(b)?.item.size ?? 1));
    const ticket = (b: Box) => this.k.tickets.find((t) => t.items.some((i) => i.id === b.itemId));
    const mine = ticket(first);
    full.sort((x, y) => Number(ticket(y) === mine) - Number(ticket(x) === mine) || (ticket(x)?.bornAt ?? 0) - (ticket(y)?.bornAt ?? 0));
    return [first, ...full];
  }

  /** Tap a box with ravs on the table: it comes up, and the other full boxes queue up behind it. */
  openFor(box: Box) {
    if (box.ravs.length) this.showLine(this.lineFrom(box));
  }

  /** Bring a box up close (just filled): the ravs tumble onto the paper. */
  show(box: Box) {
    this.showLine([box]);
  }

  /**
   * The line: the first box up close, the rest queued. Arrange, dress, shut it, and it slides off
   * left while the next one comes in.
   */
  showLine(boxes: Box[]) {
    boxes = boxes.filter((b) => b.ravs.length && b.mode === 'ready');
    const first = boxes[0];
    if (!first) return;
    if (this.open) this.save();
    this.open = true;
    this.root.hidden = false;
    document.body.classList.add('box-focusing');
    clear(this.world);
    this.chips.innerHTML = '';
    this.placed = [];
    this.flakeCount = 0;
    this.flakes.count = 0;
    this.onRavFlakes.clear();
    this.garnish.clear();
    this.slide = null;
    this.queue = boxes.slice(1);
    const [w, d] = this.dimsOf(first);
    const s = this.makeSlot(first, 0, 0, w, d, B.openLid);
    this.slots = [s];
    this.restore(s);
    this.camX = 0;
    this.focusOn(s);
    this.openedAt = performance.now();
    sfx.toss();
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  private dimsOf(b: Box): [number, number] {
    const ref = this.k.itemFor(b);
    return B.size[b.size ?? (ref ? boxSizeFor(ref.item) : 'M')] ?? [2.1, 2];
  }

  /** Point everything at this box: the camera, the pans in front of it, the hint, the prompts. */
  private focusOn(s: Slot) {
    this.span = { x0: s.ox - s.w / 2, x1: s.ox + s.w / 2, z0: s.oz - s.d / 2, z1: s.oz + s.d / 2 };
    // The garnish within reach, in front: the parm and parsley pans, or the sugar for dessert.
    for (const t of this.tools) {
      this.scene.remove(t.g);
      dispose(t.g);
      t.tag.remove();
    }
    const kinds: Garnish[] = s.gooey ? ['sugar'] : ['parm', 'parsley'];
    this.tools = kinds.map((kind, i) => {
      const pan = kind !== 'sugar';
      const g = pan ? panModel(kind) : shakerModel();
      const home = new THREE.Vector3(kinds.length === 1 ? s.ox + s.w / 2 + 0.45 : s.ox + (i === 0 ? -1 : 1) * (s.w / 2 - 0.15), 0, s.oz + s.d / 2 + 0.62);
      g.position.copy(home);
      this.scene.add(g);
      // What it is, in words: nobody knows a steel shaker is powdered sugar.
      const tag = document.createElement('div');
      tag.className = `tool-tag ${kind}`;
      tag.textContent = kind === 'sugar' ? 'POWDERED SUGAR' : kind === 'parm' ? 'PARM' : 'PARSLEY';
      this.chips.appendChild(tag);
      return { kind, g, home, pos: home.clone(), pan, tag };
    });
    this.phase = null;
    this.resize();
    const left = this.queue.length;
    this.hint.textContent = (s.gooey ? 'Set them · dust · flip · dust · pull the lid down' : 'Set them · one pinch of parm, one of parsley, sweep it over · pull the lid down') + (left ? ` · ${left} more on the line` : '');
  }

  /** The box in front of you went out: slide the next one in, or that's the lot. */
  private advance(old: Slot) {
    let next = this.queue.shift();
    while (next && !(next.ravs.length && next.mode === 'ready')) next = this.queue.shift();
    if (!next) {
      this.hide(true);
      return;
    }
    const [w, d] = this.dimsOf(next);
    const s = this.makeSlot(next, old.ox + old.w / 2 + w / 2 + B.lineGap, 0, w, d, B.openLid);
    this.slots.push(s);
    this.restore(s);
    // Its ravs drop in once it's arrived.
    for (const p of this.placed) if (p.slot === s && p.cell < 0) p.delay += B.slideTime;
    this.slide = { from: this.camX, to: s.ox, t: 0, old };
    for (const t of this.tools) {
      this.scene.remove(t.g);
      dispose(t.g);
      t.tag.remove();
    }
    this.tools = [];
    sfx.toss();
  }

  /** One box on the steel: its shell, cups, and grid. */
  private makeSlot(box: Box, ox: number, oz: number, w: number, d: number, open: number): Slot {
    const ref = this.k.itemFor(box);
    const lines = ref ? ref.item.lines.map((l) => l.flavor) : [...new Set(box.ravs.map((r) => r.flavor))];
    const count = ref?.item.size ?? box.ravs.length;
    const plating = platingFor(count, lines.length > 1);
    const cell = Math.min((w - 0.24) / plating.cols, (d - 0.24) / plating.rows);
    const ink = LID_INK.get(box.id);
    const label = ink || (box.labeled && ref) ? { name: ref?.order.name ?? '', order: ref ? lidOrder(ref.item) : '', ink } : undefined;
    const shell = clamshellModel(w, B.wall, d, { paper: !!box.wax, cups: [], label, lidOpen: open });
    shell.position.set(ox, 0, oz);
    const group = new THREE.Group();
    group.add(shell);
    this.world.add(group);
    const slot: Slot = { box, ox, oz, w, d, plating, cell, cells: [], lines, gooey: box.ravs.every((r) => r.flavor === 'gooey'), shell, hinge: (shell.userData.hinge as THREE.Object3D) ?? null, lid: 0, shut: false, open, group };
    const pos = (c: number, r: number) => ({ x: ox + (c - (plating.cols - 1) / 2) * cell, z: oz + (r - (plating.rows - 1) / 2) * cell - 0.04 });
    // The cups take their spots; a cup on a whole cell blocks it.
    const cupAt = plating.cups.slice(0, box.sauces.length);
    const big = bigCupsFor(box.size, box.sauces);
    const blocked = new Set(plating.blocked.map(([c, r]) => `${c},${r}`));
    for (const [c, r] of cupAt) if (Number.isInteger(c) && Number.isInteger(r)) blocked.add(`${c},${r}`);
    box.sauces.forEach((s, i) => {
      const at = cupAt[i];
      if (!at) return;
      const m = cupModel(s, Math.min(0.27, cell * 0.42), big);
      const p = pos(at[0], at[1]);
      m.position.set(p.x, 0.08, p.z);
      group.add(m);
    });
    // The grid: a soft square on every free cell. The house layout's cells glow while you arrange.
    const houseOf = new Map<string, number>();
    plating.house.forEach((cells, line) => cells.forEach(([c, r]) => houseOf.set(`${c},${r}`, line)));
    const sq = new THREE.PlaneGeometry(cell * 0.84, cell * 0.84);
    for (let r = 0; r < plating.rows; r++) {
      for (let c = 0; c < plating.cols; c++) {
        if (blocked.has(`${c},${r}`)) continue;
        const p = pos(c, r);
        const mat = new THREE.MeshBasicMaterial({ color: '#ffd34d', transparent: true, opacity: 0.2, depthWrite: false });
        const m = new THREE.Mesh(sq, mat);
        m.rotation.x = -Math.PI / 2;
        m.position.set(p.x, 0.095, p.z);
        group.add(m);
        slot.cells.push({ c, r, x: p.x, z: p.z, house: houseOf.get(`${c},${r}`) ?? -1, taken: null, mat });
      }
    }
    return slot;
  }

  /** Put back what you'd already done to this box (set ravs, flips, garnish); new ravs tumble in. */
  private restore(s: Slot) {
    const plate = s.box.plate;
    let fresh = 0;
    for (const r of s.box.ravs) {
      const chip = document.createElement('div');
      chip.className = 'rav-chip';
      chip.style.setProperty('--tint', FLAVORS[r.flavor].tint);
      this.chips.appendChild(chip);
      const at = plate?.cells[r.id];
      const cell = at ? s.cells.findIndex((c) => c.c === at[0] && c.r === at[1] && !c.taken) : -1;
      const c = s.cells[cell];
      const p: Placed = c
        ? { r, slot: s, x: c.x, z: c.z, y: 0.1, vy: 0, yaw: 0, cell, delay: 0, side: plate?.sides[r.id] ?? 0, flip: 0, chip }
        : {
            r,
            slot: s,
            x: s.ox + (Math.random() - 0.5) * s.w * 0.4,
            z: s.oz + (Math.random() - 0.5) * s.d * 0.3,
            y: 2.2 + Math.random() * 1.2,
            vy: 0,
            yaw: Math.random() * Math.PI * 2,
            cell: -1,
            delay: fresh++ * (B.dumpTime / Math.max(4, s.box.ravs.length)),
            side: 0,
            flip: 0,
            chip,
          };
      if (c) c.taken = p;
      this.placed.push(p);
      const g = plate?.garnish[r.id];
      if (g) this.garnish.set(r.id, { ...g });
    }
    for (const f of plate?.flakes ?? []) {
      const p = this.placed.find((x) => x.r.id === f.id);
      if (p) this.addFlake(f.kind as Garnish, p.x + f.dx, p.z + f.dz, p, f.side);
    }
    for (const p of this.placed) if (p.slot === s) this.syncFlakes(p);
  }

  /** Remember each box's plating (so a box you put down stays set). */
  private save() {
    for (const s of this.slots) {
      const mine = this.placed.filter((p) => p.slot === s);
      const flakes: PlateFlake[] = [];
      for (const [, f] of this.onRavFlakes) {
        if (mine.some((p) => p.r.id === f.id)) flakes.push({ id: f.id, side: f.side, dx: f.dx, dz: f.dz, kind: this.flakeKind.get(f) ?? 'parm' });
      }
      s.box.plate = {
        cells: Object.fromEntries(mine.filter((p) => p.cell >= 0).map((p) => [p.r.id, [s.cells[p.cell]?.c ?? 0, s.cells[p.cell]?.r ?? 0]])),
        sides: Object.fromEntries(mine.map((p) => [p.r.id, p.side])),
        garnish: Object.fromEntries(mine.map((p) => [p.r.id, { ...(this.garnish.get(p.r.id) ?? {}) }])),
        flakes,
      };
    }
  }

  private flakeKind = new WeakMap<OnRav, Garnish>();

  private resize() {
    const r = this.canvas.getBoundingClientRect();
    this.renderer.setSize(r.width, r.height, false);
    this.camera.aspect = r.width / r.height;
    this.aimCamera();
  }

  /** Looking down into the box in front of you from the front, the pans in frame in front of it. */
  private aimCamera() {
    const sp = this.span;
    const w = sp.x1 - sp.x0;
    const d = sp.z1 - sp.z0;
    const cz = (sp.z0 + sp.z1) / 2;
    const fit = Math.max((w + 1.5) / 2 / Math.tan(THREE.MathUtils.degToRad(18)) / this.camera.aspect, (d + 2.1) / 2 / Math.tan(THREE.MathUtils.degToRad(18)));
    this.camera.position.set(this.camX, fit * 1.12, cz + fit * 0.55);
    this.camera.lookAt(this.camX, 0.2, cz + 0.1);
    this.camera.updateProjectionMatrix();
  }

  /** Has this rav got enough of everything on it? */
  private dressed(p: Placed) {
    const g = this.garnish.get(p.r.id) ?? {};
    const need = B.flakesPerRav;
    return p.slot.gooey ? (g.sugar0 ?? 0) >= need && (g.sugar1 ?? 0) >= need : (g.parm ?? 0) >= need && (g.parsley ?? 0) >= need;
  }

  /** Where things are at: what the big word on screen should be telling you. */
  private currentPhase(): Phase {
    const live = this.placed.filter((p) => !p.slot.shut);
    if (live.some((p) => p.cell < 0)) return 'arrange';
    if (live.every((p) => this.dressed(p))) return 'close';
    const need = B.flakesPerRav;
    const sav = live.filter((p) => !p.slot.gooey);
    if (sav.some((p) => !this.dressed(p))) return 'dress';
    const topDone = live.filter((p) => p.slot.gooey).every((p) => (this.garnish.get(p.r.id)?.[`sugar${p.side}`] ?? 0) >= need);
    return topDone ? 'flip' : 'dust';
  }

  /**
   * How a box's layout reads: every rav in a cell, each flavor in one connected group (so the guest
   * can tell which are which), and whether it's the house layout.
   */
  private judgeLayout(s: Slot) {
    const mine = this.placed.filter((p) => p.slot === s);
    const set = mine.filter((p) => p.cell >= 0);
    const frac = mine.length ? set.length / mine.length : 0;
    const at = new Map<string, FlavorId>();
    for (const p of set) {
      const c = s.cells[p.cell];
      if (c) at.set(`${c.c},${c.r}`, p.r.flavor);
    }
    let coherent = true;
    // Keeping flavors together only matters when there's more than one in the box.
    const flavors = new Set(set.map((p) => p.r.flavor));
    for (const f of flavors.size > 1 ? flavors : []) {
      const own = [...at].filter(([, v]) => v === f).map(([k2]) => k2);
      const seen = new Set<string>([own[0] ?? '']);
      const todo = [own[0] ?? ''];
      while (todo.length) {
        const [c, r] = (todo.pop() ?? '0,0').split(',').map(Number) as [number, number];
        for (const n of [`${c + 1},${r}`, `${c - 1},${r}`, `${c},${r + 1}`, `${c},${r - 1}`]) {
          if (!seen.has(n) && at.get(n) === f) {
            seen.add(n);
            todo.push(n);
          }
        }
      }
      if (seen.size < own.length) coherent = false;
    }
    // House: each line's flavor exactly in that line's house cells (either way round for a split).
    const P = s.plating;
    const fits = (order: FlavorId[]) =>
      P.house.every((cells, i) => {
        const f = order[i];
        return cells.length === set.filter((p) => p.r.flavor === f).length && cells.every(([c, r]) => at.get(`${c},${r}`) === f);
      });
    const lines = s.lines.length === P.house.length ? s.lines : [s.lines[0] ?? 'beef'];
    const house = frac === 1 && (fits(lines) || (lines.length === 2 && fits([lines[1] as FlavorId, lines[0] as FlavorId])));
    return { frac, coherent, house };
  }

  /** A box's lid came down: it goes out. When the last one's gone, so is the close-up. */
  private send(s: Slot) {
    const box = s.box;
    const { frac, coherent, house } = this.judgeLayout(s);
    const mine = this.placed.filter((p) => p.slot === s);
    box.arranged = frac * (coherent ? 1 : 0.5);
    box.houseStyle = house;
    box.garnish = mine.length ? mine.filter((p) => this.dressed(p)).length / mine.length : 0;
    box.plate = null;
    const secs = (performance.now() - this.openedAt) / 1000;
    const neat = box.arranged >= 0.99;
    const dress = box.garnish >= 0.8;
    // The sauce comes first: no praise for a pretty box that's missing its cup, or has the wrong one.
    const ref = this.k.itemFor(box);
    const want = ref ? saucesFor(ref.item) : [];
    const missing = want.filter((x) => !box.sauces.includes(x));
    const wrong = box.sauces.filter((x) => !want.includes(x));
    if (missing.length) stamp('NO SAUCE!', `WHERE’S THE ${missing[0]?.toUpperCase()}?`, 'red');
    else if (wrong.length) stamp('WRONG SAUCE!', `THAT’S ${wrong[0]?.toUpperCase()}.`, 'red');
    else if (!coherent) stamp('WHICH IS WHICH?', 'KEEP THE FLAVORS TOGETHER.', 'red');
    else if (neat && dress && secs < B.fastSeconds * this.slots.length) stamp('PICTURE PERFECT', `${secs.toFixed(1)} SECONDS. FRAME IT.`, 'green');
    else if (house && dress) stampFrom(STAMPS.houseStyle, {}, 'green');
    else if (neat && dress) stamp('BEAUTIFUL', 'SET AND DRESSED.', 'gold');
    else if (neat) stamp('NEAT', box.garnish > 0 ? 'A LITTLE BARE ON TOP.' : 'NAKED, BUT NEAT.', 'gold');
    else if (box.arranged < 0.5) stamp('SLOPPY JOE', 'THEY JUST… FELL IN THERE.', 'red');
    this.k.serve(box);
    for (const p of mine) p.chip.hidden = true;
    this.advance(s);
  }

  /** Put it all back on the table for now (what you've set stays set). */
  private hide(sent: boolean) {
    if (!this.open) return;
    this.save();
    this.queue = [];
    this.slide = null;
    this.open = false;
    this.root.hidden = true;
    this.chips.innerHTML = '';
    document.body.classList.remove('box-focusing');
    this.grip = null;
    this.pinchBlob.visible = false;
    this.onClose?.(sent);
  }

  /** Close the close-up (tests): sent ships every box still open. */
  close(sent: boolean) {
    if (sent) {
      for (const s of this.slots) {
        if (s.shut) continue;
        s.shut = true;
        s.lid = 1;
        this.send(s);
      }
    } else this.hide(this.slots.some((s) => s.shut));
  }

  // ---------- Input ----------

  private floorAt(e: { clientX: number; clientY: number }, y = 0.1) {
    const r = this.canvas.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
    const p = new THREE.Vector3();
    this.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), p);
    return p;
  }

  /** Screen point of a spot on the steel (for tests and tags). */
  screenAt(x: number, y: number, z: number) {
    return this.screenOf(new THREE.Vector3(x, y, z));
  }

  /** Screen points of things in the close-up (for tests). */
  testPoints() {
    return {
      cells: this.slots.flatMap((s, si) => s.cells.map((c) => ({ ...this.screenAt(c.x, 0.1, c.z), house: c.house, c: c.c, r: c.r, slot: si }))),
      ravs: this.placed.map((p) => ({ ...this.screenAt(p.x, 0.1, p.z), flavor: p.r.flavor, cell: p.cell, side: p.side, slot: this.slots.indexOf(p.slot) })),
      tools: this.tools.map((t) => ({ ...this.screenAt(t.home.x, 0.2, t.home.z), kind: t.kind })),
      lids: this.slots.map((s) => ({ ...this.screenAt(s.ox, B.wall + 0.6, s.oz - s.d / 2 - 0.2), shut: s.shut })),
      lid: this.slots[0] ? this.screenAt(this.slots[0].ox, B.wall + 0.6, this.slots[0].oz - this.slots[0].d / 2 - 0.2) : { x: 0, y: 0 },
    };
  }

  private screenOf(v: THREE.Vector3) {
    const p = v.clone().project(this.camera);
    const r = this.canvas.getBoundingClientRect();
    return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height };
  }

  /** The box whose floor this point is over (or behind, for its lid). */
  private slotAt(x: number, z: number, lidToo = false) {
    return this.slots.find((s) => !s.shut && Math.abs(x - s.ox) < s.w / 2 + 0.1 && z < s.oz + s.d / 2 + 0.1 && z > s.oz - s.d / 2 - (lidToo ? Math.max(1.6, s.d + 0.3) : 0.1)) ?? null;
  }

  private down(e: PointerEvent) {
    e.preventDefault();
    if (this.grip || this.slide) return;
    const p = this.floorAt(e);
    // A pan or the shaker?
    for (let i = 0; i < this.tools.length; i++) {
      const s = this.tools[i];
      if (!s) continue;
      const sp = this.screenOf(s.home.clone().setY(0.2));
      if (Math.hypot(e.clientX - sp.x, e.clientY - sp.y) < 52) {
        this.pointer = e.pointerId;
        if (s.pan) {
          // One big pinch: enough for everything in front of you.
          const n = this.placed.filter((x) => !x.slot.shut && !x.slot.gooey).length;
          this.grip = { kind: 'pinch', i, left: Math.max(B.pinchMin, n * B.pinchPerRav), over: false, last: null };
          (this.pinchBlob.material as THREE.MeshStandardMaterial).color.set(FLAKE[s.kind]);
          this.pinchBlob.position.set(p.x, 0.9, p.z - 0.15);
          this.pinchBlob.scale.set(1, 0.6, 1);
          this.pinchBlob.visible = true;
          sfx.pull();
        } else this.grip = { kind: 'shaker', i, last: p.clone(), dir: 0, turn: p.z };
        haptic(6);
        return;
      }
    }
    // A rav?
    let best: Placed | null = null;
    let bd = Infinity;
    for (const pl of this.placed) {
      if (pl.y > 0.5 || pl.slot.shut) continue;
      const dd = Math.hypot(pl.x - p.x, pl.z - p.z);
      if (dd < Math.max(B.grab, pl.slot.cell * 0.55) && dd < bd) [best, bd] = [pl, dd];
    }
    if (best) {
      this.grip = { kind: 'rav', p: best, x0: e.clientX, y0: e.clientY, moved: false };
      this.pointer = e.pointerId;
      haptic(4);
      return;
    }
    // A lid, standing up behind its box: pull it down to shut it.
    const s = this.slotAt(p.x, p.z, true);
    if (s && p.z < s.oz - s.d / 2 - 0.05) {
      this.grip = { kind: 'lid', s, y0: e.clientY };
      this.pointer = e.pointerId;
      return;
    }
    // Off the boxes entirely: put them back for now.
    if (!s) {
      const sp = this.span;
      if (p.x < sp.x0 - 0.4 || p.x > sp.x1 + 0.4 || p.z > sp.z1 + 1.3 || p.z < sp.z0 - 2.4) this.hide(this.slots.some((x) => x.shut));
    }
  }

  private move(e: PointerEvent) {
    const g = this.grip;
    if (!g || e.pointerId !== this.pointer) return;
    if (g.kind === 'rav') {
      if (!g.moved && Math.hypot(e.clientX - g.x0, e.clientY - g.y0) < B.flipTapPx) return;
      const s = g.p.slot;
      if (!g.moved) {
        g.moved = true;
        // Picked up out of its cell.
        const c = s.cells[g.p.cell];
        if (c) c.taken = null;
        g.p.cell = -1;
        sfx.pull();
      }
      // It stays in its own box.
      const p = this.floorAt(e);
      g.p.x = Math.max(s.ox - s.w / 2 + 0.2, Math.min(s.ox + s.w / 2 - 0.2, p.x));
      g.p.z = Math.max(s.oz - s.d / 2 + 0.2, Math.min(s.oz + s.d / 2 - 0.2, p.z - 0.18));
      g.p.y = 0.35;
      this.syncFlakes(g.p);
    } else if (g.kind === 'shaker') {
      const s = this.tools[g.i];
      if (!s) return;
      // Over the spot just above your fingertip (so your thumb doesn't hide it).
      const p = this.floorAt(e);
      p.z -= 0.15;
      s.pos.set(p.x, 1.1, p.z);
      // Powdered sugar comes out in puffs: every shake (a stroke that turns back) throws a burst that
      // lands as a white splat, thick in the middle. A little dusts off in between.
      const dz = p.z - g.last.z;
      const dir = Math.sign(dz);
      if (dir && dir !== g.dir) {
        if (g.dir !== 0 && Math.abs(g.last.z - g.turn) > B.sugarStroke) {
          for (let i = 0; i < B.sugarBurst; i++) {
            const a = Math.random() * Math.PI * 2;
            const rr = Math.abs(Math.random() + Math.random() - 1) * B.sugarSpread;
            this.dropFlake(s.kind, p.x + Math.cos(a) * rr, p.z + Math.sin(a) * rr);
          }
          sfx.rim();
          haptic(4);
        }
        g.dir = dir;
        g.turn = g.last.z;
      }
      if (Math.random() < 0.4) this.dropFlake(s.kind, p.x + (Math.random() - 0.5) * 0.5, p.z + (Math.random() - 0.5) * 0.5);
      g.last.copy(p);
    } else if (g.kind === 'pinch') {
      // It falls on the spot just above your fingertip as you sweep, more the faster you go.
      const p = this.floorAt(e);
      p.z -= 0.15;
      this.pinchBlob.position.set(p.x, 0.9, p.z);
      g.over = !!this.slotAt(p.x, p.z);
      const tool = this.tools[g.i];
      if (g.last && g.over && tool && g.left > 0) {
        const dist = Math.min(1, p.distanceTo(g.last));
        const n = Math.min(g.left, Math.floor(dist * B.pinchPerUnit + Math.random()));
        this.sprinkle(tool.kind, p, n);
        g.left -= n;
      }
      g.last = p.clone();
    } else if (g.kind === 'lid') {
      const r = this.canvas.getBoundingClientRect();
      g.s.lid = Math.max(0, Math.min(1, (e.clientY - g.y0) / (r.height * 0.3)));
    }
  }

  private up(e: PointerEvent) {
    const g = this.grip;
    if (!g || e.pointerId !== this.pointer) return;
    this.grip = null;
    if (g.kind === 'rav') {
      const pl = g.p;
      const s = pl.slot;
      // A tap (no drag) on a gooey rav flips it over.
      if (!g.moved) {
        if (s.gooey) {
          pl.side = pl.side ? 0 : 1;
          pl.flip = 1;
          this.syncFlakes(pl);
          sfx.toss();
          haptic(6);
        }
        return;
      }
      pl.y = 0.1;
      // Snap into the nearest free cell in its box.
      let best: Cell | null = null;
      let bd = Infinity;
      for (const c of s.cells) {
        if (c.taken) continue;
        const dd = Math.hypot(c.x - pl.x, c.z - pl.z);
        if (dd < bd) [best, bd] = [c, dd];
      }
      if (best) {
        best.taken = pl;
        pl.cell = s.cells.indexOf(best);
        pl.x = best.x;
        pl.z = best.z;
        pl.yaw = 0;
        this.syncFlakes(pl);
        sfx.catch(2 + s.cells.filter((x) => x.taken).length);
        haptic(6);
        if (this.placed.filter((x) => x.slot === s).every((x) => x.cell >= 0)) {
          const sp = this.screenOf(new THREE.Vector3(s.ox, 0.4, s.oz));
          const { coherent, house } = this.judgeLayout(s);
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
      const s = g.s;
      if (s.lid >= B.lidClose) {
        s.lid = 1;
        s.shut = true;
        sfx.toss();
        haptic(16);
        // A beat to admire your own label on the shut lid.
        window.setTimeout(() => this.send(s), LID_INK.has(s.box.id) ? 900 : 180);
      } else s.lid = 0;
    }
  }

  /** A handful falls around a point. */
  private sprinkle(kind: Garnish, c: THREE.Vector3, n: number) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(Math.random()) * B.pinchSpread;
      this.dropFlake(kind, c.x + Math.cos(a) * rr, c.z + Math.sin(a) * rr);
    }
  }

  /** A flake of garnish lands where it falls: on a rav (dressing its top side) or on the paper. */
  private dropFlake(kind: Garnish, x: number, z: number) {
    const s = this.slotAt(x, z);
    if (!s || Math.abs(x - s.ox) > s.w / 2 || Math.abs(z - s.oz) > s.d / 2) return;
    let on: Placed | null = null;
    for (const pl of this.placed) {
      const rr = 0.24 * (FLAVORS[pl.r.flavor].size ?? 1);
      if (pl.slot === s && pl.y < 0.5 && Math.hypot(pl.x - x, pl.z - z) < rr) {
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
    this.addFlake(kind, x, z, on, on?.side ?? 0);
  }

  private addFlake(kind: Garnish, x: number, z: number, on: Placed | null, side: 0 | 1) {
    if (this.flakeCount >= B.maxFlakes) return;
    const i = this.flakeCount++;
    if (on) {
      const f: OnRav = { id: on.r.id, side, dx: x - on.x, dz: z - on.z };
      this.onRavFlakes.set(i, f);
      this.flakeKind.set(f, kind);
    }
    this.q.setFromEuler(new THREE.Euler(0, Math.random() * 3, 0));
    const up = !on || (side === on.side && on.flip < 0.5);
    // Sugar lands as a splat (a wide flat blot); parm and parsley as flakes.
    const sc = kind === 'sugar' ? B.sugarSplat * (0.7 + Math.random() * 0.6) : kind === 'parsley' ? 0.9 : 1;
    this.mat.compose(new THREE.Vector3(x, (on ? 0.17 + 0.07 * FLAVORS[on.r.flavor].size + ravDome(x - on.x, z - on.z, FLAVORS[on.r.flavor].size) : 0.1) + Math.random() * 0.02, z), this.q, new THREE.Vector3(up ? sc : 0, up ? (kind === 'sugar' ? 0.5 : 1) : 0, up ? sc : 0));
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
      const sc = this.flakeKind.get(f) === 'sugar' ? B.sugarSplat : 1;
      this.mat.compose(new THREE.Vector3(pl.x + f.dx, pl.y + 0.07 + 0.07 * FLAVORS[pl.r.flavor].size + ravDome(f.dx, f.dz, FLAVORS[pl.r.flavor].size) + (i % 7) * 0.002, pl.z + f.dz), this.q, new THREE.Vector3(up ? sc : 0, up ? 0.6 : 0, up ? sc : 0));
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
    // The line moving: ease the camera over to the next box, then clear the one that went out.
    const sl = this.slide;
    if (sl) {
      sl.t = Math.min(1, sl.t + dt / B.slideTime);
      const e = sl.t < 0.5 ? 2 * sl.t * sl.t : 1 - (-2 * sl.t + 2) ** 2 / 2;
      this.camX = sl.from + (sl.to - sl.from) * e;
      this.aimCamera();
      if (sl.t >= 1) {
        this.slide = null;
        this.world.remove(sl.old.group);
        dispose(sl.old.group);
        this.placed = this.placed.filter((p) => {
          if (p.slot !== sl.old) return true;
          p.chip.remove();
          return false;
        });
        this.slots = this.slots.filter((x) => x !== sl.old);
        const cur = this.slots[this.slots.length - 1];
        if (cur) this.focusOn(cur);
      }
    }
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
    // Held still over the boxes, a pinch still trickles a little.
    const g = this.grip;
    if (g?.kind === 'pinch' && g.over && g.left > 0) {
      const tool = this.tools[g.i];
      const n = Math.min(g.left, Math.floor(B.pinchTrickle * dt + Math.random()));
      if (tool && n) this.sprinkle(tool.kind, this.pinchBlob.position, n);
      g.left -= n;
    }
    if (g?.kind === 'pinch') {
      const s = Math.max(0.3, Math.min(1, g.left / B.pinchMin));
      this.pinchBlob.scale.set(s, s * 0.6, s);
      if (g.left <= 0) this.pinchBlob.visible = false;
    }
    // The big word for whatever's next (once the ravs have landed).
    if (landed) {
      const ph = this.currentPhase();
      if (ph !== this.phase) {
        this.phase = ph;
        const [word, gesture] = PROMPTS[ph];
        // Dressed but short a cup: it can still go, but the word asks the question.
        const front = this.slots.find((s) => !s.shut);
        const ref = front ? this.k.itemFor(front.box) : null;
        const short = ph === 'close' && !!front && !!ref && front.box.sauces.length < saucesFor(ref.item).length;
        prompt(short ? 'SAUCE??' : word, short ? undefined : gesture);
      }
    }
    // The grid: the house cells breathe while you arrange; taken cells go quiet.
    const pulse = 0.5 + 0.5 * Math.sin(this.t * 5);
    const arranging = this.phase === 'arrange' || this.phase === null;
    for (const s of this.slots) {
      for (const c of s.cells) {
        c.mat.color.set(c.taken ? '#7fd08a' : c.house >= 0 ? '#ffd34d' : '#ffffff');
        c.mat.opacity = s.shut ? 0 : c.taken ? (arranging ? 0.3 : 0) : arranging ? (c.house >= 0 ? 0.28 + 0.3 * pulse : 0.16) : 0.06;
      }
      // The lid, following your finger (or springing back open).
      if (s.hinge) s.hinge.rotation.x = -s.open * (1 - s.lid);
    }
    for (const s of this.tools) {
      if (s.pan) continue;
      s.g.position.lerp(s.pos, 0.35);
      // Tipped over the box while you shake it.
      s.g.rotation.z = s.pos.y > 0.5 ? Math.PI * 0.85 : 0;
    }
    this.ravs.begin();
    for (const pl of this.placed) {
      // Not drawn: under a shut lid, or not dropped in yet (the next box on the line).
      if ((pl.slot.shut && pl.slot.lid >= 1) || pl.delay > 0) continue;
      const m = this.ravs.get(pl.r);
      // A flip hops it up and over.
      const hop = Math.sin(pl.flip * Math.PI) * 0.35;
      m.position.set(pl.x, pl.y + 0.05 + hop, pl.z);
      m.rotation.set((pl.cell >= 0 ? 0 : 0.08) + pl.flip * Math.PI, pl.yaw, pl.y > 0.4 ? Math.sin(pl.y * 3) * 0.6 : 0);
    }
    this.ravs.end();
    this.updateChips();
    const live = this.placed.filter((p) => !p.slot.shut);
    this.hint.dataset.set = `${live.filter((p) => p.cell >= 0).length}/${live.length}`;
  }

  /**
   * A little tag over each rav: its flavor while you arrange a split (they look alike), then one dot
   * per garnish that lights up when there's enough on it (sugar: one per side).
   */
  private updateChips() {
    const arranging = this.phase === 'arrange' || this.phase === null;
    const need = B.flakesPerRav;
    // The tags live in the close-up's own box: page coordinates less its corner.
    const origin = this.root.getBoundingClientRect();
    for (const t of this.tools) {
      const sp = this.screenOf(t.home.clone().setY(t.pan ? 0.5 : 0.85));
      t.tag.style.transform = `translate(-50%, -100%) translate(${sp.x - origin.left}px, ${sp.y - origin.top - 4}px)`;
    }
    for (const pl of this.placed) {
      const chip = pl.chip;
      if (pl.y > 0.5 || pl.delay > 0 || pl.slot.shut) {
        chip.hidden = true;
        continue;
      }
      const g = this.garnish.get(pl.r.id) ?? {};
      let html: string;
      if (arranging) html = pl.slot.lines.length > 1 ? `<span>${FLAVORS[pl.r.flavor].short.replace('OG ', '')}</span>` : '';
      else if (this.dressed(pl)) html = '<b class="done">✓</b>';
      else if (pl.slot.gooey && this.phase === 'flip' && (g[`sugar${pl.side}`] ?? 0) >= need) html = '<span class="tapme">TAP TO FLIP</span>';
      else if (pl.slot.gooey) html = [0, 1].map((s) => `<i class="dot sugar ${(g[`sugar${s}`] ?? 0) >= need ? 'on' : ''}${pl.side === s ? ' up' : ''}">${s + 1}</i>`).join('');
      else html = (['parm', 'parsley'] as const).map((k2) => `<i class="dot ${k2} ${(g[k2] ?? 0) >= need ? 'on' : ''}"></i>`).join('');
      chip.hidden = !html;
      if (chip.dataset.html !== html) {
        chip.dataset.html = html;
        chip.innerHTML = html;
      }
      const sp = this.screenOf(new THREE.Vector3(pl.x, 0.3, pl.z - pl.slot.cell * 0.42));
      chip.style.transform = `translate(-50%, -100%) translate(${sp.x - origin.left}px, ${sp.y - origin.top}px)`;
    }
  }
}

/** A quarter pan of garnish: a shallow steel tray heaped with grated parm or chopped parsley. */
function panModel(kind: Garnish) {
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: '#c9cfd3', metalness: 0.75, roughness: 0.28 });
  const inner = new THREE.MeshStandardMaterial({ color: '#8f989e', metalness: 0.6, roughness: 0.4 });
  // A steel quarter pan: deep, open on top, a flat rim all the way round.
  const w = 0.92;
  const d = 0.66;
  const h = 0.46;
  const t = 0.035;
  const add = (bw: number, bh: number, bd: number, mat: THREE.Material, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), mat);
    m.position.set(x, y, z);
    g.add(m);
  };
  add(w, t, d, inner, 0, t / 2, 0);
  for (const sx of [-1, 1]) add(t, h, d, steel, (sx * (w - t)) / 2, h / 2, 0);
  for (const sz of [-1, 1]) add(w, h, t, steel, 0, h / 2, (sz * (d - t)) / 2);
  for (const sx of [-1, 1]) add(0.09, 0.03, d + 0.16, steel, sx * (w / 2 + 0.03), h, 0);
  for (const sz of [-1, 1]) add(w + 0.16, 0.03, 0.09, steel, 0, h, sz * (d / 2 + 0.03));
  // Filled most of the way, heaped and lumpy.
  const fill = new THREE.Mesh(
    new THREE.BoxGeometry(w - t * 2.2, 0.08, d - t * 2.2, 6, 1, 4),
    new THREE.MeshStandardMaterial({ color: kind === 'parm' ? '#f2ead2' : '#3f8f2e', roughness: 1, flatShading: true }),
  );
  const p = fill.geometry.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) p.setY(i, p.getY(i) + Math.random() * 0.05);
  fill.geometry.computeVertexNormals();
  fill.position.y = h * 0.62;
  g.add(fill);
  return g;
}

/** The powdered sugar shaker: tall steel. */
function shakerModel() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.17, 0.62, 12), new THREE.MeshStandardMaterial({ color: '#c9cfd3', metalness: 0.8, roughness: 0.25 }));
  body.position.y = 0.31;
  g.add(body);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.08, 12), new THREE.MeshStandardMaterial({ color: '#e3e7ea', metalness: 0.8, roughness: 0.4 }));
  cap.position.y = 0.66;
  g.add(cap);
  return g;
}

/**
 * A rav is a pillow: highest in the middle, down to the crimp at its edge. Garnish sits on that
 * surface, so what lands in the middle isn't buried in the dome.
 */
function ravDome(dx: number, dz: number, size: number) {
  const R = 0.34 * size;
  const d = Math.min(1, Math.hypot(dx, dz) / R);
  return 0.11 * size * (1 - d * d);
}
