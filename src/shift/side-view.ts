import * as THREE from 'three';
import { FLAVORS, SHIFT_FLAVORS } from '../config/flavors';
import { FREEZER, PASS, PLATE, STATION, STAGE, BENCH } from '../config/shift';
import { BASKET, BOX, RAV, WORLD } from '../config/toss';
import { SCREENS } from '../config/screens';
import { bagModel, basketModel, BOWL_STEEL, bowlRim, binModel, chestFreezerModel, clamshellModel, mixingBowlProfile, ravGeometry, stageBasketModel } from '../render/models';
import { haptic, sfx } from '../ui/feel';
import { STAMPS } from '../config/stamps';
import { type Gesture, prompt } from '../ui/prompt';
import { pop, stamp, stampFrom } from '../ui/stamp';
import { type Basket, bigCupsFor, type Box, saucesFor, type Kitchen, type KitchenEvent, lidOrder, spoutOf } from './kitchen';
import { halfOf, type Rav } from './physics';
import { RavMeshes } from './rav-meshes';
import { FreezerTop } from './freezer-top';

const VIEW_KEY = 'get-toasted.freezerView';
function loadView(): 'top' | 'side' {
  const q = new URLSearchParams(location.search).get('freezer');
  if (q === 'top' || q === 'side') return q;
  try {
    // The freezer opens on the fryer screen now; the old top-down cut-away is ?freezer=top.
    void localStorage;
    return 'side';
  } catch {
    return 'side';
  }
}

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
const CONFETTI = ['#ffd43b', '#ff6b6b', '#4dabf7', '#69db7c', '#f783ac'].map((c) => new THREE.Color(c));
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
  // A big round mixing bowl: deeper than the physics wall so the belly reads round.
  const depth = wall * 1.3;
  const pts = mixingBowlProfile(w / 2, depth, w * 0.17, 0);
  const glassy = new THREE.MeshStandardMaterial({ color: '#d9dee3', metalness: 0.7, roughness: 0.2, transparent: true, opacity: 0.4, depthWrite: false, side: THREE.DoubleSide });
  g.add(new THREE.Mesh(new THREE.LatheGeometry(pts, 32, Math.PI / 2, Math.PI), BOWL_STEEL));
  g.add(new THREE.Mesh(new THREE.LatheGeometry(pts, 32, -Math.PI / 2, Math.PI), glassy));
  g.add(bowlRim(w / 2, depth, BOWL_STEEL));
  // Salt in the bottom once you've shaken some in.
  const salt = new THREE.Mesh(new THREE.CircleGeometry(w * 0.2, 16), new THREE.MeshStandardMaterial({ color: '#f4f4f0', roughness: 1 }));
  salt.rotation.x = -Math.PI / 2;
  salt.position.y = 0.03;
  g.add(salt);
  // Sunk a little so the ravs sit down in the belly, not on a flat floor.
  g.position.y = -wall * 0.25;
  const outer = new THREE.Group();
  outer.add(g);
  outer.scale.z = 0.8;
  outer.userData.salt = salt;
  return outer;
}

/** A pour into a box on the table: which box, and where your finger was when you got there. */
type Pour = { box: Box; y0: number };

type Grip =
  /** A basket held by its body: it follows your finger (freezer catch, pass carry). */
  | { kind: 'basket'; b: Basket; dx: number; dy: number; hist: { x: number; y: number; t: number }[]; x0: number; y0: number; t0: number; moved: boolean; pour?: Pour }
  | { kind: 'rav'; r: Rav; dx: number; dy: number }
  | { kind: 'bowl'; dx: number; dy: number; pour?: Pour }
  | { kind: 'shaker'; dx: number; dy: number; lastY: number; dir: number; turnY: number; moved: boolean }
  | { kind: 'box'; box: Box; y0: number; t0: number };

/** Freezer and pass microgames: side view, things follow your fingers. */
export class SideView {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);
  private raycaster = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  private fixtures = new THREE.Group();
  /** One mesh per basket you can hold at once: a pivot at the near (left) rim, the model inside it. */
  private basketMeshes: THREE.Group[] = [];
  private boxMeshes = new Map<number, { g: THREE.Group; key: string }>();
  private bowl = platingBowl(PLATE.bowlW, PLATE.bowlWall);
  private bowlSalt: THREE.Mesh;
  private shaker = shakerModel();
  private bags: THREE.Group[] = [];
  private bagSquash: number[] = [];
  private ravs: RavMeshes;
  private particles = new Particles();
  private grips = new Map<number, Grip>();
  /** The freezer seen from above (the default), or the original side view. */
  top: FreezerTop;
  freezerView: 'top' | 'side' = loadView();
  private viewBtn!: HTMLButtonElement;
  /** What the tickets need from the freezer, right where you're looking. */
  private needBar!: HTMLElement;
  /** The box on the table row (DOM) under a screen point, for drops from the pass. */
  boxUnder: ((x: number, y: number) => Box | null) | null = null;
  /** One stage: the slot whose oil a basket at this spot is down in (freezer: drop it straight in). */
  oilSlotFor: ((x: number, y: number) => number | null) | null = null;
  /** The camera, shared with the stage so both draw the same world. */
  get cam() {
    return this.camera;
  }
  /** One stage: a touch that started on the stage (on the bowl or the shaker) carries on here. */
  passTouch(e: PointerEvent) {
    const p = this.worldAt(e.clientX / window.innerWidth, e.clientY / window.innerHeight);
    this.passDown(e, p.x, p.y);
  }

  /** One stage: the basket a finger was carrying on the stage is now the basket at the bowl, under the same finger. */
  adoptBasket(e: PointerEvent, b: Basket) {
    const p = this.worldAt(e.clientX / window.innerWidth, e.clientY / window.innerHeight);
    const off = this.k.grab(b, p.x, p.y);
    if (off) this.grips.set(e.pointerId, { kind: 'basket', b, dx: off.dx, dy: off.dy, hist: [{ x: p.x, y: p.y, t: e.timeStamp }], x0: e.clientX, y0: e.clientY, t0: e.timeStamp, moved: true });
  }

  /** What the pass wants next, in words (the stage shows it on its coach line). */
  get passHintText() {
    return SideView.HINTS[this.step].replace('{sauce}', this.needSauce === 'marinara' ? 'hot marinara' : this.needSauce);
  }

  /** One stage: the slot whose oil is under a screen point (freezer: take a basket back out). */
  oilAt: ((x: number, y: number) => number | null) | null = null;
  /** The fryer slot under a screen point (freezer: grab a basket off its bar). */
  slotAt: ((x: number, y: number) => number | null) | null = null;
  /** The table-row box's rect on screen (for ravs flying into it). */
  boxRect: ((id: number) => DOMRect | null) | null = null;
  /** Light up the box a drop would land in (null: none). */
  hoverBox: ((box: Box | null) => void) | null = null;
  /** Tap an empty prepped box on the table (wired to the Sharpie picker). */
  onBoxTap: ((box: Box) => void) | null = null;
  /** Tap a box with ravs in it: bring it up close to set, dress and shut. */
  onBoxFocus: ((box: Box) => void) | null = null;

  /** The box on the table under a screen point. */
  boxAtScreen(x: number, y: number) {
    const p = this.worldAt(x / window.innerWidth, y / window.innerHeight);
    return this.k.boxAt(p.x, p.y);
  }
  /** When the last NAILED IT went up, to merge it with an ALL 6! right after. */
  private nailedAt = -1e9;

  private dom: HTMLElement;
  private tags: HTMLElement[] = [];
  private boxLabels = new Map<number, HTMLElement>();
  private bowlLabel: HTMLElement;
  private freezerBar: HTMLElement;
  /** The chest freezer's lid, swinging open as you get there (0 shut, 1 open). */
  private chestLid: THREE.Object3D | null = null;
  private chestOpen = 0;
  private chest: THREE.Object3D | null = null;
  private chestY = 0;
  private chestDrop = 0;
  private propDuck = 0;
  private lidLen = 2.6;
  private passBar: HTMLElement;
  private passHint!: HTMLElement;
  /** What the pass wants from you next (drives the hint line and the pulse). */
  private step: 'pour' | 'tongs' | 'salt' | 'toss' | 'box' | 'serve' | 'sauce' | 'prep' | 'done' = 'done';
  private needSauce = '';

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
    this.top = new FreezerTop(k);
    this.top.onCatch = (n, x, y) => pop(String(n), x, y);
    for (let i = 0; i < FREEZER.maxBaskets; i++) {
      const pivot = new THREE.Group();
      // One stage: the same front-on basket the fryers draw.
      const m = k.stage ? stageBasketModel(BASKET.width, BASKET.wall, 1.9, STAGE.taper) : basketModel(BASKET.width, BASKET.wall);
      m.position.set(0, -BASKET.wall / 2, 0);
      pivot.add(m);
      pivot.visible = false;
      this.basketMeshes.push(pivot);
      this.scene.add(pivot);
    }
    this.bowlSalt = this.bowl.userData.salt as THREE.Mesh;
    this.scene.add(this.bowl, this.shaker);
    const geo = ravGeometry(0);
    SHIFT_FLAVORS.forEach((f) => {
      const bag = k.stage ? binModel(FLAVORS[f].short, geo, FLAVORS[f].tint) : bagModel(FLAVORS[f].short, geo, FLAVORS[f].tint);
      bag.scale.setScalar(FREEZER.bagScale);
      this.bags.push(bag);
      this.bagSquash.push(0);
      this.scene.add(bag);
    });

    this.dom = el('div', 'side-ui', ui);
    for (let i = 0; i < FREEZER.maxBaskets; i++) this.tags.push(el('div', 'basket-tag', this.dom));
    this.bowlLabel = el('div', 'bowl-tag', this.dom);
    this.freezerBar = el('div', 'scene-bar', this.dom);
    el('div', 'scene-hint', this.freezerBar).textContent = k.stage ? 'Grab a basket. Tap a bag. Catch. Lower it into the oil, or let go and it hangs back up.' : 'Grab a basket off its bar. Tap a bag. Catch. Let go and it hangs back up.';
    this.needBar = el('div', 'need-bar', this.dom);
    this.viewBtn = el('button', 'scene-btn view-btn', this.freezerBar);
    this.viewBtn.hidden = true;
    this.viewBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.setFreezerView(this.freezerView === 'top' ? 'side' : 'top');
    });
    const done = el('button', 'scene-btn primary', this.freezerBar);
    done.textContent = k.stage ? 'SHUT IT' : 'WALK OUT';
    done.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.k.leaveFreezer();
      haptic(10);
    });
    this.passBar = el('div', 'scene-bar pass-bar', this.dom);
    this.passHint = el('div', 'scene-hint pass-hint', this.passBar);
    const back = el('button', 'scene-btn', this.passBar);
    back.textContent = 'BACK TO FRYERS';
    back.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.k.leavePass();
      haptic(10);
    });
    this.bind();
    this.viewBtn.textContent = this.freezerView === 'top' ? 'SIDE VIEW' : 'TOP VIEW';
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

  /** Switch freezer views (and remember it). Ravs in the air are lost in the switch. */
  setFreezerView(v: 'top' | 'side') {
    this.freezerView = v;
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* no storage */
    }
    this.viewBtn.textContent = v === 'top' ? 'SIDE VIEW' : 'TOP VIEW';
    if (this.k.scene !== 'freezer') return;
    this.letGoAll();
    if (v === 'top') this.top.enter();
    else {
      this.top.leave();
      this.layout();
      this.k.relayFreezerBaskets();
    }
  }

  private get topMode() {
    return this.k.scene === 'freezer' && this.freezerView === 'top';
  }

  resize(w: number, h: number) {
    this.top.resize(w, h);
    const aspect = w / h;
    this.camera.aspect = aspect;
    const tan = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    // Fit the room's width; on a wide (landscape) screen, back off so it's still tall enough to play in.
    const dist = Math.max(WORLD.width / 2 / (tan * aspect), SCREENS.sideMinHalfHeight / tan);
    this.camera.position.set(0, dist * Math.tan(THREE.MathUtils.degToRad(this.k.stage ? STAGE.tilt : TILT_DEG)), dist);
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
    let counterY = at(0.5, PASS.counterV).y;
    let rackY = at(0.5, PASS.bowlV).y;
    let bowlX = at(PASS.bowlU, PASS.bowlV).x;
    let shakerX = at(PASS.shakerU, PASS.bowlV).x;
    let shakerY = rackY + 0.42;
    if (this.k.stage) {
      // One stage: the bowl sits on the table at the left end of the boxes row, and that's where you
      // pour, salt and toss. The shaker stands by it, in front of the fryer.
      const vh = window.innerHeight;
      const benchMid = 1 - (BENCH.bottomPx + BENCH.heightFrac * vh * 0.5) / vh;
      const rest = at(STAGE.bowlU, benchMid);
      bowlX = rest.x;
      rackY = rest.y - 0.3;
      counterY = rackY - 0.35;
      // Above the bowl's left side, clear of the boxes row (a box there would cover it).
      shakerX = bowlX - PLATE.bowlW * 0.22;
      shakerY = rackY + PLATE.bowlWall + 1.55;
    }
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
      shakerX,
      shakerY,
    };

    if (this.k.scene === 'freezer') {
      // The freezer swings open right at the bottom of the fryer screen: the fryers stay drawn
      // behind (a cold veil over them) and the ravs fly up over them.
      this.scene.background = null;
      const veil = new THREE.Mesh(
        new THREE.PlaneGeometry(WORLD.width * 3, (topY - at(0.5, 1.1).y) * 1.6),
        new THREE.MeshBasicMaterial({ color: '#0b1a24', transparent: true, opacity: this.k.stage ? 0 : FREEZER.veil, depthWrite: false }),
      );
      veil.position.set(0, (topY + at(0.5, 1.1).y) / 2, -3);
      veil.renderOrder = -1;
      this.fixtures.add(veil);
      // One stage: the lid stands open behind the chest (as tall as fits under the fryers' ledge),
      // and it's what you push to shut the freezer.
      this.lidLen = Math.max(1.1, Math.min(STAGE.lidMax, at(0.5, STAGE.tableV).y - shelfY - 1.5));
      const chest = this.k.stage
        ? chestFreezerModel(WORLD.width * 1.3, 0.3, at(0.5, 1.08).y - shelfY, { lidLen: this.lidLen, decal: 'PUSH TO SHUT' })
        : chestFreezerModel(WORLD.width * 1.3, 0.55, at(0.5, 1.08).y - shelfY);
      chest.position.set(0, shelfY, -0.2);
      this.fixtures.add(chest);
      this.chest = chest;
      this.chestY = shelfY;
      this.chestDrop = this.k.stage ? shelfY - at(0.5, 1.12).y + 1.4 : 0;
      this.chestLid = (chest.userData.lid as THREE.Object3D) ?? null;
      this.chestOpen = 0;
      this.bags.forEach((b, i) => {
        b.visible = true;
        b.position.set(bagX[i] ?? 0, shelfY, -0.2);
      });
    } else {
      // The pass happens right over the fryers: no wall, no shelf, no table. A veil dims the
      // fryers behind so the bowl and basket stand out, and the boxes are the real ones on the
      // table row under it.
      this.scene.background = null;
      const veil = new THREE.Mesh(
        new THREE.PlaneGeometry(WORLD.width * 3, (topY - at(0.5, 1.1).y) * 1.6),
        new THREE.MeshBasicMaterial({ color: '#0d0906', transparent: true, opacity: this.k.stage ? STAGE.passVeil : PASS.veil, depthWrite: false }),
      );
      veil.position.set(0, (topY + at(0.5, 1.1).y) / 2, -3);
      veil.renderOrder = -1;
      this.fixtures.add(veil);
      for (const b of this.bags) b.visible = false;
    }
  }

  /** The freezer-world point under a screen point (px). */
  worldAtScreen(x: number, y: number) {
    const p = this.worldAt(x / window.innerWidth, y / window.innerHeight);
    return { x: p.x, y: p.y };
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
      // Keep this finger's drag on the canvas even over the box labels.
      try {
        c.setPointerCapture(e.pointerId);
      } catch {
        /* synthetic pointer */
      }
      if (this.topMode) return this.top.down(e);
      const p = this.worldAt(e.clientX / window.innerWidth, e.clientY / window.innerHeight);
      if (k.scene === 'pass') {
        // One stage: touch the fryers and you're back at the fryers (whatever's in the bowl waits);
        // the stage picks this same touch up.
        if (k.stage && !k.handAt(p.x, p.y) && !k.bowlAt(p.x, p.y) && !k.shakerAt(p.x, p.y) && (this.slotAt?.(e.clientX, e.clientY) ?? null) !== null && !k.pickable(p.x, p.y)) {
          this.letGoAll();
          k.leavePass();
          return;
        }
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
        if (best >= 0 && bestD < FREEZER.bagReach && p.y < g.bagY + 2.3 && p.y > g.bagY - 1.0) {
          if (k.tapBag(best)) {
            this.bagSquash[best] = 1;
            haptic(5);
          }
          return;
        }
      }
      // One stage: the lid standing open behind the bins is what you push to shut the freezer.
      if (k.stage && k.freezerGeo && p.y > k.freezerGeo.bagY + 2.3 && p.y < k.freezerGeo.bagY + 2.0 + this.lidLen) {
        k.leaveFreezer();
        haptic(10);
        return;
      }
      // A basket on its bar, up on the fryers: grab it and it's in your hand. One you lowered into
      // the oil too soon comes back the same way.
      const oil = this.oilAt?.(e.clientX, e.clientY) ?? null;
      const slot = this.slotAt?.(e.clientX, e.clientY) ?? null;
      const nb = (oil !== null ? k.takeFromOil(oil) : null) ?? (slot === null ? null : k.takeFromBar(slot, p.x, p.y));
      const off = nb ? k.grab(nb, p.x, p.y) : null;
      if (nb && off) {
        this.grips.set(e.pointerId, { kind: 'basket', b: nb, dx: off.dx, dy: off.dy, hist: [{ x: p.x, y: p.y, t: e.timeStamp }], x0: e.clientX, y0: e.clientY, t0: e.timeStamp, moved: true });
        haptic(8);
      }
    });
    c.addEventListener('pointermove', (e) => {
      if (this.topMode) return this.top.move(e);
      const g = this.grips.get(e.pointerId);
      if (!g) return;
      const p = this.worldAt(e.clientX / window.innerWidth, e.clientY / window.innerHeight);
      const k = this.k;
      switch (g.kind) {
        case 'basket':
          if (Math.hypot(e.clientX - g.x0, e.clientY - g.y0) > 10) g.moved = true;
          k.moveHand(g.b, p.x + g.dx, p.y + g.dy);
          // Only dessert pours straight from the basket into its box; everything else goes through the bowl.
          if (k.scene === 'pass' && g.b.flavor === 'gooey') this.tip(g, g.b, e);
          g.hist.push({ x: p.x, y: p.y, t: e.timeStamp });
          while (g.hist.length > 2 && e.timeStamp - (g.hist[0]?.t ?? 0) > 160) g.hist.shift();
          break;
        case 'rav':
          k.moveRav(g.r, p.x + g.dx, p.y + g.dy);
          this.hoverBox?.(this.boxUnder?.(e.clientX, e.clientY) ?? null);
          break;
        case 'bowl':
          k.moveBowl(p.x + g.dx, p.y + g.dy);
          this.tip(g, 'bowl', e);
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
      if (this.topMode) return this.top.up(e);
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
            k.returnToBar(g.b);
            return;
          }
          if (g.pour) {
            k.endPour();
            this.hoverBox?.(null);
          }
          const v = velocity(g.hist, e.timeStamp);
          const had = g.b.ravs.length;
          k.release(g.b, v.vx, v.vy);
          // Freezer: let go down in a fryer and it's in the oil; anywhere else it goes back on its bar.
          const oil = k.scene === 'freezer' && had ? (this.oilSlotFor?.(g.b.x, g.b.y) ?? null) : null;
          if (oil !== null && k.handToOil(g.b, oil)) haptic(14);
          else k.returnToBar(g.b);
          if (had && !g.b.ravs.length) haptic(12);
          break;
        }
        case 'rav': {
          const box = this.boxUnder?.(e.clientX, e.clientY) ?? null;
          this.hoverBox?.(null);
          if (box && k.ravInto(g.r, box)) haptic(8);
          else k.dropRav(g.r);
          haptic(4);
          break;
        }
        case 'bowl':
          // Let go: it rights itself (stop pouring) and goes back to its spot.
          k.endPour();
          this.hoverBox?.(null);
          k.releaseBowl();
          break;
        case 'shaker':
          // Classic: a tap on the shaker is a shake. On the stage it stands over the bowl, so you have to actually shake it.
          if (!g.moved && !k.stage) this.shake();
          k.shaker.held = false;
          if (k.passGeo) k.moveShaker(k.passGeo.shakerX, k.passGeo.shakerY);
          break;
        case 'box': {
          // A tap on an empty box (no swipe): Sharpie it.
          const p = this.worldAt(e.clientX / window.innerWidth, e.clientY / window.innerHeight);
          const tap = Math.abs(p.y - g.y0) < 0.3 && e.timeStamp - g.t0 < STATION.tapMs;
          if (tap && g.box.ravs.length) this.onBoxFocus?.(g.box);
          else if (tap && g.box.prepped) this.onBoxTap?.(g.box);
          break;
        }
      }
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
  }

  /**
   * Over a box on the table with the bowl (or a basket): pull down to tip it in. The further you pull
   * past where you got there, the more it tips and the faster they come; ease back up to stop.
   */
  private tip(g: { pour?: Pour }, from: 'bowl' | Basket, e: PointerEvent) {
    const k = this.k;
    const has = from === 'bowl' ? k.bowl.ravs.length : from.ravs.length;
    let box = has ? (this.boxUnder?.(e.clientX, e.clientY) ?? null) : null;
    // Pulled down past the box, you're still pouring into it.
    if (!box && g.pour && e.clientY > g.pour.y0) box = g.pour.box;
    if (!box) {
      if (g.pour) k.tipInto(null, from, 0);
      g.pour = undefined;
      this.hoverBox?.(null);
      return;
    }
    if (!g.pour || g.pour.box !== box) g.pour = { box, y0: e.clientY };
    k.tipInto(box, from, (e.clientY - g.pour.y0) / PLATE.boxPourPull);
    this.hoverBox?.(box);
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
    if (k.hands.some((b) => b.ravs.length && b.flavor !== 'gooey') && k.bowlAt(x, y) && (!k.bowl.held || k.bowlReturning)) {
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
    // Until the bowl is salted and tossed, a touch on it is for the bowl. After that, touch a rav and
    // you've got that rav; touch the bowl anywhere else and you've got the bowl.
    if (k.bowl.ravs.length && !k.bowlReady() && k.bowlAt(x, y) && (!k.bowl.held || k.bowlReturning)) {
      const off = k.grabBowl(x, y);
      this.grips.set(id, { kind: 'bowl', dx: off.dx, dy: off.dy });
      haptic(6);
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
    if (k.bowlAt(x, y) && (!k.bowl.held || k.bowlReturning)) {
      const off = k.grabBowl(x, y);
      this.grips.set(id, { kind: 'bowl', dx: off.dx, dy: off.dy });
      haptic(6);
      return;
    }
  }

  handle(ev: KitchenEvent) {
    switch (ev.type) {
      case 'scene':
        // One stage: arriving at the bowl, whatever your fingers already have hold of stays held.
        if (!(this.k.stage && ev.scene === 'pass')) this.letGoAll();
        if (ev.scene !== 'station' && ev.scene !== 'expo') this.layout();
        if (ev.scene === 'freezer') sfx.freezerOpen();
        if (ev.scene === 'freezer' && this.freezerView === 'top') this.top.enter();
        else this.top.leave();
        break;
      case 'launch':
        sfx.launch();
        this.particles.burst(ev.x, ev.y, 5, FROST, 1.5, 0.05, 1);
        break;
      case 'catch': {
        sfx.catch(ev.into === 'bowl' ? Math.min(ev.count, 8) * 0.3 : ev.count);
        // In the freezer, every catch counts up over the basket.
        if (this.k.scene === 'freezer' && ev.into === 'basket' && !this.topMode) {
          const p = this.project(ev.x, ev.y + 0.9);
          pop(String(ev.count), p.x, p.y);
        }
        break;
      }
      case 'volley':
        if (ev.caught === ev.count) {
          sfx.perfect();
          haptic(18);
          // Caught them all AND landed the count: one stamp that says both.
          if (performance.now() - this.nailedAt < 1500) stamp(STAMPS.allCaught.title.replace('{n}', String(ev.count)), STAMPS.bothLine, 'green');
          else stampFrom(STAMPS.allCaught, { n: ev.count });
          for (const c of CONFETTI) this.particles.burst(0, 0, 10, c, 7, 0.07, -9);
        }
        break;
      case 'nailed':
        this.nailedAt = performance.now();
        sfx.perfect();
        haptic(14);
        stampFrom(STAMPS.nailed, { n: ev.count, flavor: FLAVORS[ev.flavor].short }, 'green');
        break;
      case 'rim':
      case 'spill':
        sfx.rim();
        break;
      case 'dead':
        sfx.splat();
        this.particles.burst(ev.x, ev.y, 12, CRUMB, 3, 0.05, -16);
        break;
      case 'freezerShut':
        sfx.freezerShut();
        break;
      case 'freezerBeep':
        sfx.freezerBeep();
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
      case 'pourIn': {
        // A rav arcs from the lip down into the box.
        const k = this.k;
        const src = ev.from === 'bowl' ? this.project(k.bowl.x - k.bowl.w * 0.3, k.bowl.top) : (() => { const b = k.hands.find((h) => k.pourFrom === h); return b ? this.project(b.x - b.w / 2, b.top) : null; })();
        const r = this.boxRect?.(ev.boxId);
        if (src && r) plop(this.dom, src, { x: r.left + r.width * (0.3 + Math.random() * 0.4), y: r.top + r.height * 0.55 }, FLAVORS[ev.flavor].tint);
        sfx.catch(1);
        haptic(4);
        break;
      }
      case 'onCount':
        stampFrom(STAMPS.onCount, { n: ev.count }, 'green');
        sfx.perfect();
        haptic(14);
        break;
      case 'overCount':
        if (ev.over > 1) stampFrom(STAMPS.tooMany, { n: ev.over }, 'red');
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
    this.freezerBar.hidden = inPass || k.stage; // one stage: the freezer's own front is the button
    this.passBar.hidden = !inPass || k.stage; // one stage: no mode bar, you're still at the fryers
    // One stage: this view also draws the bowl and shaker while you're just at the fryers.
    this.fixtures.visible = k.scene !== 'station';
    if (k.scene !== 'freezer') for (const b of this.bags) b.visible = false;
    // The NEED bar: flavor chips counting down as you catch.
    this.needBar.hidden = k.scene !== 'freezer';
    if (k.scene === 'freezer') {
      const needs = k.freezerNeeds();
      // Only when something's needed: the freezer bar glows for that, no need to say "nothing".
      this.needBar.hidden = !needs.length;
      const html = `<i>NEED</i>${needs.map((n) => `<b class="${n.have >= n.need ? 'done' : n.have > n.need ? 'over' : ''}" style="--tint:${FLAVORS[n.flavor].tint}">${Math.min(n.have, n.need)}/${n.need} ${FLAVORS[n.flavor].short}${n.have >= n.need ? ' ✓' : ''}</b>`).join('')}`;
      if (this.needBar.innerHTML !== html) this.needBar.innerHTML = html;
    }
    if (this.topMode) {
      this.updateDom();
      this.top.render(renderer, dt);
      return;
    }

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
      b.scale.set(FREEZER.bagScale * (1 + 0.12 * s), FREEZER.bagScale * (1 - 0.16 * s), FREEZER.bagScale);
    });

    // One stage: the bowl and shaker are always there, the same objects whether or not you're pouring.
    const props = inPass || k.stage;
    const g0 = k.passGeo;
    if (k.stage && !inPass && g0) {
      // Resting on the table; the freezer sliding up over the table pushes them down out of the way.
      const duck = k.scene === 'freezer' && !k.freezerLeaving ? 1 : 0;
      this.propDuck += (duck - this.propDuck) * (1 - Math.exp(-dt * 9));
      const bw = k.bowl;
      bw.x = bw.px = bw.tx = g0.bowlX;
      bw.y = bw.py = bw.ty = g0.bowlY - this.propDuck * 7;
      bw.held = false;
      k.shaker.x = g0.shakerX;
      k.shaker.y = g0.shakerY - this.propDuck * 7;
      k.shaker.held = false;
    }
    this.bowl.visible = props;
    this.shaker.visible = props;
    if (props) {
      const bw = k.bowl;
      this.bowl.position.set(bw.x, bw.y, -0.1);
      this.bowl.rotation.z = -k.bowlDir * k.bowlTilt * PASS.bowlTiltAngle + THREE.MathUtils.clamp(-bw.vx * 0.02, -0.3, 0.3) * (1 - k.bowlTilt);
      this.bowlSalt.visible = k.bowlSalt > 0;
      this.shaker.position.set(k.shaker.x, k.shaker.y, 0.3);
      this.shaker.rotation.z = k.shaker.held ? Math.PI * 0.85 : 0;
    }
    this.syncBoxes(false);
    if (inPass) {
      const step = this.nextStep();
      if (step !== this.step) {
        // The big word for the next move at the pass.
        const cmd = SideView.PROMPTS[step];
        if (cmd) prompt(cmd[0], cmd[1]);
      }
      this.step = step;
      // Whatever you need next breathes a little.
      const pulse = 1 + 0.07 * Math.sin(t * 7);
      this.shaker.scale.setScalar(this.step === 'salt' && !k.shaker.held ? pulse : 1);
      const bs = this.step === 'toss' || this.step === 'box' ? pulse : 1;
      this.bowl.scale.set(bs, bs, 0.7 * bs);
    }

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
        // One stage: the basket narrows toward its floor, and what's in it sits inside that.
        const lx = (r.lx + (-w.w / 2 + halfOf(r).hx + 0.05 - r.lx) * s) * (k.stage ? STAGE.taper + (1 - STAGE.taper) * Math.min(1, Math.max(0, r.ly / w.wall)) : 1);
        const ly = r.ly - w.wall / 2;
        this.drawRav(r, m.position.x + lx * ca - ly * sa, m.position.y + lx * sa + ly * ca, t);
      }
    });
    if (props) {
      const ba = this.bowl.rotation.z;
      const bc = Math.cos(ba);
      const bs = Math.sin(ba);
      for (const r of k.bowl.ravs) {
        // Sit them in the middle of the bowl's depth so they read as inside it; tipped, they ride the tilt.
        // The bowl is round: ravs settle toward the middle and down into the belly.
        const lx = (r.lx + (k.bowlDir * (k.bowl.w / 2 - 0.3) - r.lx) * k.bowlTilt * 0.6) * 0.7;
        const ly = r.ly - 0.06 + Math.abs(lx) * 0.25;
        this.drawRav(r, k.bowl.x + lx * bc - ly * bs, k.bowl.y + lx * bs + ly * bc, t);
        const m = this.ravs.get(r);
        m.position.z = -0.1 + (m.userData.zj as number) * 0.6;
      }
      for (const r of k.heldRavs) {
        this.drawRav(r, r.x, r.y, t);
        const m = this.ravs.get(r);
        m.position.z = 0.6;
      }
    }
    this.ravs.end();

    this.particles.update(dt);
    this.updateDom();
    if (k.scene === 'freezer' && this.chestLid) {
      // The lid swings up and back as you open it.
      this.chestOpen = k.freezerLeaving ? Math.max(0, this.chestOpen - dt / FREEZER.lidSeconds) : Math.min(1, this.chestOpen + dt / FREEZER.lidSeconds);
      const e = 1 - (1 - this.chestOpen) ** 3;
      this.chestLid.rotation.x = -(k.stage ? STAGE.lidOpen : FREEZER.lidOpen) * e;
      // The whole chest slides up into frame as it opens, and back down as it shuts.
      const down = (1 - e) * this.chestDrop;
      if (this.chest) this.chest.position.y = this.chestY - down;
      // One stage: the bins sit up on a shelf in the chest, so their labels clear its front wall.
      for (const b of this.bags) b.position.y = this.chestY - down + (k.stage ? 0.3 : 0);
    }
    if (inPass || k.scene === 'freezer' || k.stage) {
      // Over the fryer scene main just drew.
      const auto = renderer.autoClear;
      renderer.autoClear = false;
      renderer.clearDepth();
      renderer.render(this.scene, this.camera);
      renderer.autoClear = auto;
    } else renderer.render(this.scene, this.camera);
  }

  /** One styrofoam mesh per box on the table, rebuilt when the table resizes it. */
  private syncBoxes(show: boolean) {
    const k = this.k;
    const live = new Set<number>();
    if (show) {
      for (const bx of k.board) {
        live.add(bx.id);
        // The box you prepped, as you prepped it: paper, cups, and the lid in Sharpie.
        const ref = bx.labeled ? k.itemFor(bx) : null;
        const label = ref ? { name: ref.order.name ?? '', order: lidOrder(ref.item) } : undefined;
        const key = `${bx.w.toFixed(2)}|${bx.wax}|${bx.sauces.join()}|${label ? label.name + label.order : ''}`;
        let e = this.boxMeshes.get(bx.id);
        if (!e || e.key !== key) {
          if (e) this.scene.remove(e.g);
          e = { g: clamshellModel(bx.w, bx.wall, 1.1, { paper: !!bx.wax, cups: bx.sauces, bigCups: bigCupsFor(bx.size ?? (bx.w > 1.9 ? 'L' : 'M'), bx.sauces), label }), key };
          this.boxMeshes.set(bx.id, e);
          this.scene.add(e.g);
        }
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

  /** The next thing to do at the pass, in the order the line does it. */
  private nextStep(): SideView['step'] {
    const k = this.k;
    const basket = k.hands.find((b) => b.ravs.length);
    if (basket) return basket.flavor === 'gooey' ? 'tongs' : 'pour';
    const n = k.bowl.ravs.length;
    if (n) {
      const need = Math.ceil(Math.max(PLATE.saltMin, n * PLATE.saltPerRav));
      if (k.bowlSalt < need) return 'salt';
      if (k.bowlToss < PLATE.tossNeed) return 'toss';
      return 'box';
    }
    if (k.board.some((bx) => bx.mode === 'ready' && bx.ravs.length)) return 'serve';
    // A box that needs a sauce you're out of: go make it (hot marinara is made as you need it).
    for (const bx of k.board) {
      const ref = bx.mode === 'ready' && bx.prepped ? k.itemFor(bx) : null;
      const miss = ref ? saucesFor(ref.item).find((s) => !bx.sauces.includes(s) && !(k.cupStock[s] ?? 0)) : undefined;
      if (miss) {
        this.needSauce = miss;
        return 'sauce';
      }
    }
    if (k.unboxedItems().length && k.board.filter((bx) => bx.mode === 'ready').length < PLATE.tableMax) return 'prep';
    return 'done';
  }

  private static PROMPTS: Partial<Record<SideView['step'], [string, Gesture]>> = {
    pour: ['POUR!', 'drag'],
    tongs: ['INTO THE BOX!', 'pour'],
    salt: ['SALT!', 'shake'],
    toss: ['TOSS!', 'toss'],
    box: ['INTO THE BOX!', 'pour'],
  };

  private static HINTS: Record<SideView['step'], string> = {
    pour: 'Drag the basket over the bowl to dump it',
    tongs: 'Gooey skips the salt: bring the basket to its box and pull down to pour',
    salt: 'Grab the shaker and shake it over the bowl',
    toss: 'Toss them: slide the bowl side to side',
    box: 'Bring the bowl to a box and pull down to pour. Let go to stop',
    serve: 'Tap the box to set it and shut the lid',
    sauce: 'Out of {sauce}: tap its pan to make more',
    prep: 'Set out a box: tap a stack, drag paper and a cup in, tap the box to Sharpie it',
    done: 'All set. Back to the fryers',
  };

  private updateDom() {
    const k = this.k;
    const inPass = k.scene === 'pass';
    if (inPass) {
      const h = SideView.HINTS[this.step].replace('{sauce}', this.needSauce === 'marinara' ? 'hot marinara' : this.needSauce);
      if (this.passHint.textContent !== h) this.passHint.textContent = h;
    }
    this.tags.forEach((tag, i) => {
      const w = k.hands[i];
      if (!w || !w.ravs.length) {
        tag.hidden = true;
        return;
      }
      const p = (this.topMode ? this.top.tagAt(w) : null) ?? (inPass ? this.project(Math.min(w.x, 1.2), w.y - 0.4) : this.project(w.x, w.top + 0.5));
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
      // Kept on screen: the bowl sits near the left edge on the stage.
      const half = (this.bowlLabel.offsetWidth || 160) / 2 + 6;
      this.bowlLabel.style.transform = `translate(-50%, -50%) translate(${Math.max(half, p.x)}px, ${p.y}px)`;
      const need = Math.ceil(Math.max(PLATE.saltMin, n * PLATE.saltPerRav));
      const salt = Math.min(need, k.bowlSalt);
      const toss = Math.min(100, Math.round((k.bowlToss / PLATE.tossNeed) * 100));
      const html = k.bowlReady()
        ? `<b>${n} · salted ✓</b>`
        : `<b>${n}</b> in the bowl · salt ${salt}/${need} · toss ${toss}%`;
      if (this.bowlLabel.innerHTML !== html) this.bowlLabel.innerHTML = html;
      this.bowlLabel.classList.toggle('ready', k.bowlReady());
    }

    // The boxes are the real ones on the table row now: no floating labels at the pass.
    const live = new Set<number>();
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

/** A rav's little arc from the bowl's lip into a box on the table. */
function plop(parent: HTMLElement, a: { x: number; y: number }, b: { x: number; y: number }, tint: string) {
  const e = el('div', 'rav-plop', parent);
  e.style.setProperty('--tint', tint);
  e.style.transform = `translate(${a.x}px, ${a.y}px)`;
  const mid = { x: (a.x + b.x) / 2, y: Math.min(a.y, b.y) - 30 };
  e.animate(
    [
      { transform: `translate(${a.x}px, ${a.y}px) rotate(0deg)` },
      { transform: `translate(${mid.x}px, ${mid.y}px) rotate(120deg)`, offset: 0.4 },
      { transform: `translate(${b.x}px, ${b.y}px) rotate(260deg) scale(0.8)` },
    ],
    { duration: 380, easing: 'ease-in' },
  ).onfinish = () => e.remove();
}
