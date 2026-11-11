import * as THREE from 'three';
import { SAUCE } from '../config/shift';
import { SAUCE_COLORS, woodMaterial } from '../render/models';
import { haptic, sfx } from '../ui/feel';
import { type Kitchen, lidOrder, type Sauce } from './kitchen';

// The ladle, in the round. You're standing at the table: the pan of sauce at the back, the cup and
// the box it's for toward you. The ladle is a long straight handle held at the top with the bowl
// hanging under your hand. Like a claw machine, your thumb moves the hand from wherever the thumb
// is, and the bowl's shadow on the table shows where it is.
//
// It's one stroke, back to front:
//   Through the pan: the bowl dips and comes up full. One bowl, one cup.
//   Toward you: when the bowl reaches the cup it stops at the cup's far edge.
//   Keep pulling: your hand comes on toward you, the bowl swings over, and the sauce runs over
//   its lip into the cup.
//   Ease back to stop, right on the line.
//
// The other hand has the cup: drag it nearer the pan and the carry is shorter. Rush a full ladle
// and it slops. Ranch is thin and stops when you stop; marinara is slow to start, comes in glugs,
// and keeps coming a moment after you ease off.

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement) => {
  const e = document.createElement(tag);
  e.className = cls;
  parent?.appendChild(e);
  return e;
};

const NAMES: Record<string, string> = { marinara: 'MARINARA', ranch: 'RANCH' };

/** The scene, in centimeters or so. x is right, y is up, z is toward you. */
const W = {
  pan: { x0: -14, x1: 14, z0: -23, z1: -9 },
  cup: { rTop: 3.2, rBot: 2.4, h: 5 },
  bowl: 3.3,
  handle: 21,
  /** How high the bowl rides when it's carried over the table. */
  carryY: 8,
  /** The marinara's steam table: a heated box on the counter, this tall. */
  warmerH: 5.6,
  box: { x: 9.5, z: 8.5, w: 10.5, d: 8.5, h: 2.6 },
};

interface Drip {
  mesh: THREE.Mesh;
  vx: number;
  vy: number;
  vz: number;
}

export class LadleView {
  private root: HTMLElement;
  private canvas: HTMLCanvasElement;
  private title: HTMLElement;
  private count: HTMLElement;
  private tally: HTMLElement;
  private hint: HTMLElement;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private cam = new THREE.PerspectiveCamera(40, 1, 0.5, 200);
  private sauce: Sauce = 'marinara';
  private open = false;
  private w = 1;
  private h = 1;
  /** World units the ladle moves per pixel of thumb travel, across and in depth. */
  private perPx = { x: 0.09, z: 0.11 };
  /** Where your hand is taking the bowl (on the table plane), and where the bowl actually is. */
  private aim = { x: 0, z: 0 };
  private bowl = { x: 0, y: W.carryY, z: 0, vx: 0, vz: 0 };
  /** How much is in the bowl (1 is a cup) and how far it's swung over (0..1). */
  private load = 0;
  private tilt = 0;
  /** Stopped at the cup: the furthest from you the hand has been since, so pulling on from there tips it. */
  private latch: { z: number } | null = null;
  /** How fast it's actually running (cups per second): thick sauce lags the tilt. */
  private rate = 0;
  private cup = { x: -6, z: 4 };
  private fill = 0;
  private lastPour = -9;
  private sealing = 0;
  private hop = -1;
  private sealedFill = 0;
  private spilled = 0;
  private charged = 0;
  private tallyCents = 0;
  private made = 0;
  private t = 0;
  private last = 0;
  private ladleId: number | null = null;
  private cupId: number | null = null;
  private lastTouch = { x: 0, y: 0 };
  // Meshes.
  private panSauce!: THREE.Mesh;
  private chunks = new THREE.Group();
  private ladle = new THREE.Group();
  private bowlSauce!: THREE.Mesh;
  private shadow!: THREE.Mesh;
  private cupG = new THREE.Group();
  private cupSauce!: THREE.Mesh;
  private cupLine!: THREE.Mesh;
  private cupLid!: THREE.Mesh;
  private stream!: THREE.Mesh;
  private boxLabel!: THREE.Mesh;
  private sauceMat = new THREE.MeshStandardMaterial({ color: '#c8341d', roughness: 0.35 });
  private drips: Drip[] = [];
  private stains: THREE.Mesh[] = [];
  private fillShown = -1;
  /** The cold well (ranch) is set into the table; the steam table (marinara) stands on it. */
  private coldWell = new THREE.Group();
  private warmer = new THREE.Group();
  private steam: THREE.Mesh[] = [];
  /** The top of the sauce in whichever is out, and the heights the bowl rides at for it. */
  private panTop = 0.22;
  private dipY = 1.4;
  private carryY = W.carryY;

  constructor(parent: HTMLElement, private k: Kitchen) {
    this.root = el('div', 'ladle-ui', parent);
    this.root.hidden = true;
    const bar = el('div', 'ladle-top', this.root);
    this.title = el('div', 'ladle-title', bar);
    this.count = el('div', 'ladle-count', bar);
    this.canvas = el('canvas', 'ladle-canvas', this.root);
    this.tally = el('div', 'ladle-spill', this.root);
    const foot = el('div', 'scene-bar ladle-bar', this.root);
    this.hint = el('div', 'scene-hint', foot);
    const done = el('button', 'scene-btn primary', foot);
    done.textContent = 'DONE';
    done.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.close();
    });
    this.canvas.addEventListener('pointerdown', (e) => this.down(e));
    this.canvas.addEventListener('pointermove', (e) => this.move(e));
    this.canvas.addEventListener('pointerup', (e) => this.up(e));
    this.canvas.addEventListener('pointercancel', (e) => this.up(e));
    window.addEventListener('resize', () => this.open && this.size());
  }

  /** Built the first time the ladle's picked up. */
  private build() {
    const r = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.1;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer = r;
    const s = this.scene;
    s.background = new THREE.Color('#e3b877');
    s.add(new THREE.HemisphereLight('#fff8e6', '#c79a63', 1.6));
    const sun = new THREE.DirectionalLight('#ffeccb', 2.5);
    sun.position.set(-10, 34, 12);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    const sc = sun.shadow.camera;
    sc.left = -26;
    sc.right = 26;
    sc.top = 30;
    sc.bottom = -30;
    sc.near = 1;
    sc.far = 90;
    sun.shadow.bias = -0.002;
    s.add(sun);
    const steel = new THREE.MeshStandardMaterial({ color: '#b4bcc1', metalness: 0.55, roughness: 0.42 });
    const bright = new THREE.MeshStandardMaterial({ color: '#dfe4e8', metalness: 0.7, roughness: 0.25 });
    const table = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), woodMaterial(5, 5));
    table.rotation.x = -Math.PI / 2;
    table.receiveShadow = true;
    s.add(table);
    // The pan, set into the table at the back: a rim, walls going down, the sauce a little below.
    const p = W.pan;
    const pw = p.x1 - p.x0;
    const pd = p.z1 - p.z0;
    const px = (p.x0 + p.x1) / 2;
    const pz = (p.z0 + p.z1) / 2;
    const rims = (into: THREE.Group, y: number) => {
      const rim = (w: number, d: number, x: number, z: number) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.7, d), bright);
        m.position.set(x, y + 0.35, z);
        m.castShadow = m.receiveShadow = true;
        into.add(m);
      };
      rim(pw + 2.4, 1.2, px, p.z0 - 0.6);
      rim(pw + 2.4, 1.2, px, p.z1 + 0.6);
      rim(1.2, pd, p.x0 - 0.6, pz);
      rim(1.2, pd, p.x1 + 0.6, pz);
    };
    rims(this.coldWell, 0);
    // The steam table: a stainless box standing on the counter on little feet, the pan dropped in
    // its top, a dial and a pilot light on the front.
    const H = W.warmerH;
    const body = new THREE.Mesh(new THREE.BoxGeometry(pw + 2.2, H - 0.6, pd + 2.2), steel);
    body.position.set(px, (H - 0.6) / 2 + 0.5, pz);
    body.castShadow = body.receiveShadow = true;
    this.warmer.add(body);
    rims(this.warmer, H - 0.3);
    const dark = new THREE.MeshStandardMaterial({ color: '#1c1f22', roughness: 0.5 });
    for (const fx of [p.x0 + 1, p.x1 - 1]) {
      for (const fz of [p.z0 + 1, p.z1 - 1]) {
        const footM = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.6, 10), dark);
        footM.position.set(fx, 0.3, fz);
        this.warmer.add(footM);
      }
    }
    const front = p.z1 + 1.12;
    const plate = new THREE.Mesh(new THREE.BoxGeometry(9, 2.6, 0.12), new THREE.MeshStandardMaterial({ color: '#2a2e33', roughness: 0.6 }));
    plate.position.set(px + pw * 0.24, H * 0.46, front);
    const dial = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.6, 20), dark);
    dial.rotation.x = Math.PI / 2;
    dial.position.set(px + pw * 0.16, H * 0.46, front + 0.3);
    const tick = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.7, 0.1), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
    tick.position.set(px + pw * 0.16 + 0.3, H * 0.46 + 0.35, front + 0.62);
    tick.rotation.z = -0.7;
    const pilot = new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 8), new THREE.MeshBasicMaterial({ color: '#ff5a2a' }));
    pilot.position.set(px + pw * 0.33, H * 0.46, front + 0.12);
    this.warmer.add(plate, dial, tick, pilot);
    // Steam off the top.
    for (let i = 0; i < 5; i++) {
      const puff = new THREE.Mesh(new THREE.CircleGeometry(1.5, 14), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.12, depthWrite: false }));
      puff.renderOrder = 5;
      this.warmer.add(puff);
      this.steam.push(puff);
    }
    s.add(this.coldWell, this.warmer);
    this.panSauce = new THREE.Mesh(new THREE.PlaneGeometry(pw, pd), this.sauceMat);
    this.panSauce.rotation.x = -Math.PI / 2;
    this.panSauce.position.set(px, 0.22, pz);
    this.panSauce.receiveShadow = true;
    s.add(this.panSauce);
    // Bits in the marinara.
    const bit = new THREE.MeshStandardMaterial({ color: '#8f2413', roughness: 0.5 });
    for (let i = 0; i < 12; i++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.45 + ((i * 7) % 3) * 0.12, 8, 6), bit);
      m.scale.y = 0.35;
      m.position.set(p.x0 + 2 + ((i * 0.37) % 1) * (pw - 4), 0.28, p.z0 + 1.5 + ((i * 0.61) % 1) * (pd - 3));
      this.chunks.add(m);
    }
    s.add(this.chunks);
    // The ladle: bowl, sauce in it, the long handle up to your hand. Its origin is the middle of
    // the bowl's mouth, so swinging it over turns it about there.
    const R = W.bowl;
    const cupSteel = new THREE.MeshStandardMaterial({ color: '#d9dee2', metalness: 0.3, roughness: 0.35, side: THREE.DoubleSide });
    const shell = new THREE.Mesh(new THREE.SphereGeometry(R, 28, 14, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), cupSteel);
    shell.castShadow = true;
    const lip = new THREE.Mesh(new THREE.TorusGeometry(R, 0.14, 8, 36), cupSteel);
    lip.rotation.x = Math.PI / 2;
    this.bowlSauce = new THREE.Mesh(new THREE.CircleGeometry(R * 0.96, 28), this.sauceMat);
    this.bowlSauce.rotation.x = -Math.PI / 2;
    // The handle comes up off the right side of the bowl and leans out to the right, to your hand:
    // so the hand is beside the bowl, never over it, even when it's swung toward you.
    const arm = new THREE.Group();
    arm.position.set(R * 0.92, 0, 0);
    arm.rotation.z = -0.34;
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, W.handle, 10), cupSteel);
    handle.position.y = W.handle / 2 - 0.2;
    handle.castShadow = true;
    // Your hand, closed round the top of it.
    const glove = new THREE.MeshStandardMaterial({ color: '#23262a', roughness: 0.7 });
    const fist = new THREE.Mesh(new THREE.CapsuleGeometry(1.2, 2.2, 4, 10), glove);
    fist.position.y = W.handle - 2.2;
    fist.castShadow = true;
    const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 1.2, 4, 8), glove);
    thumb.position.set(-1.0, W.handle - 1.3, 0.8);
    thumb.rotation.z = 0.5;
    arm.add(handle, fist, thumb);
    this.ladle.add(shell, lip, this.bowlSauce, arm);
    s.add(this.ladle);
    // Where the bowl is: a soft shadow straight under it (the claw machine's tell).
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(R * 0.9, 24), new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.22, depthWrite: false }));
    this.shadow.rotation.x = -Math.PI / 2;
    s.add(this.shadow);
    // The cup: clear plastic, the sauce rising in it, the line to stop on.
    const c = W.cup;
    const clear = new THREE.MeshStandardMaterial({ color: '#ffffff', transparent: true, opacity: 0.22, roughness: 0.1, side: THREE.DoubleSide, depthWrite: false });
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(c.rTop, c.rBot, c.h, 32, 1, true), clear);
    wall.position.y = c.h / 2;
    wall.renderOrder = 3;
    const white = new THREE.MeshBasicMaterial({ color: '#ffffff' });
    const cupRim = new THREE.Mesh(new THREE.TorusGeometry(c.rTop, 0.09, 6, 40), white);
    cupRim.rotation.x = Math.PI / 2;
    cupRim.position.y = c.h;
    const foot = new THREE.Mesh(new THREE.TorusGeometry(c.rBot, 0.07, 6, 32), white);
    foot.rotation.x = Math.PI / 2;
    foot.position.y = 0.08;
    const lv = SAUCE.line;
    this.cupLine = new THREE.Mesh(new THREE.TorusGeometry(c.rBot + (c.rTop - c.rBot) * lv + 0.05, 0.1, 6, 40), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
    this.cupLine.rotation.x = Math.PI / 2;
    this.cupLine.position.y = c.h * lv;
    this.cupLine.renderOrder = 4;
    this.cupSauce = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 8), this.sauceMat);
    this.cupSauce.visible = false;
    this.cupLid = new THREE.Mesh(new THREE.CylinderGeometry(c.rTop + 0.2, c.rTop + 0.2, 0.25, 32), new THREE.MeshStandardMaterial({ color: '#ffffff', transparent: true, opacity: 0.75, roughness: 0.2 }));
    this.cupLid.visible = false;
    const caster = new THREE.Mesh(new THREE.CylinderGeometry(c.rTop, c.rBot, c.h, 16), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
    caster.position.y = c.h / 2;
    caster.castShadow = true;
    this.cupG.add(this.cupSauce, wall, cupRim, foot, this.cupLine, this.cupLid, caster);
    s.add(this.cupG);
    // The stream.
    this.stream = new THREE.Mesh(new THREE.CylinderGeometry(1, 0.7, 1, 10), this.sauceMat);
    this.stream.visible = false;
    s.add(this.stream);
    // The box the cup is for: tray, checkered liner, the lid standing open with its name on it.
    const b = W.box;
    const foam = new THREE.MeshStandardMaterial({ color: '#efe8d8', roughness: 0.9 });
    const tray = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), foam);
    tray.position.set(b.x, b.h / 2, b.z);
    tray.castShadow = tray.receiveShadow = true;
    const liner = new THREE.Mesh(new THREE.PlaneGeometry(b.w - 1.4, b.d - 1.4), new THREE.MeshStandardMaterial({ map: checker(), roughness: 0.9 }));
    liner.rotation.x = -Math.PI / 2;
    liner.position.set(b.x, b.h + 0.03, b.z);
    liner.receiveShadow = true;
    const lid = new THREE.Group();
    lid.position.set(b.x, b.h, b.z - b.d / 2);
    lid.rotation.x = -0.32;
    const lidBack = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.d * 0.78, 0.5), foam);
    lidBack.position.y = b.d * 0.39;
    lidBack.castShadow = true;
    this.boxLabel = new THREE.Mesh(new THREE.PlaneGeometry(b.w * 0.86, b.d * 0.5), new THREE.MeshBasicMaterial({ transparent: true }));
    this.boxLabel.position.set(0, b.d * 0.4, 0.27);
    lid.add(lidBack, this.boxLabel);
    s.add(tray, liner, lid);
    this.cam.position.set(0, 33, 30);
    this.cam.lookAt(0, 0, -1.5);
  }

  isOpen() {
    return this.open;
  }

  show(sauce: Sauce) {
    this.sauce = sauce;
    this.open = true;
    this.root.hidden = false;
    if (!this.renderer) this.build();
    this.size();
    const color = SAUCE_COLORS[sauce] ?? '#c8341d';
    this.sauceMat.color.set(color);
    // (The red reads hot under these lights: bring it down to cooked tomato.)
    if (sauce === 'marinara') this.sauceMat.color.multiplyScalar(0.8);
    this.sauceMat.roughness = sauce === 'marinara' ? 0.45 : 0.3;
    // Marinara's in the steam table, up off the counter; ranch is in the cold well, set into it.
    const hot = sauce === 'marinara';
    this.chunks.visible = hot;
    this.warmer.visible = hot;
    this.coldWell.visible = !hot;
    this.panTop = hot ? W.warmerH + 0.12 : 0.22;
    this.panSauce.position.y = this.panTop;
    this.chunks.position.y = this.panTop - 0.22;
    this.dipY = this.panTop + 1.2;
    this.carryY = hot ? W.warmerH + 5.4 : W.carryY;
    this.aim = { x: 2, z: -2 };
    this.bowl = { x: 2, y: this.carryY, z: -2, vx: 0, vz: 0 };
    this.cup = { x: -6, z: 4 };
    this.load = 0;
    this.tilt = 0;
    this.latch = null;
    this.rate = 0;
    this.fill = 0;
    this.fillShown = -1;
    this.sealing = 0;
    this.hop = -1;
    for (const d of this.drips) this.scene.remove(d.mesh);
    for (const m of this.stains) this.scene.remove(m);
    this.drips = [];
    this.stains = [];
    this.spilled = 0;
    this.charged = 0;
    this.tallyCents = 0;
    this.tally.classList.remove('on');
    this.made = 0;
    this.ladleId = this.cupId = null;
    this.last = performance.now();
    const box = this.k.fillBox;
    const ref = box ? this.k.itemFor(box) : null;
    this.label((ref?.order.name ?? '').toUpperCase(), ref ? lidOrder(ref.item).replace('\n', ' ').toUpperCase() : '');
    this.title.textContent = NAMES[sauce] ?? sauce.toUpperCase();
    requestAnimationFrame((t) => this.frame(t));
  }

  /** The name on the box's lid. */
  private label(name: string, order: string) {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 256;
    const x = c.getContext('2d');
    if (x) {
      x.fillStyle = '#1c1c1c';
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      x.font = '900 120px "Marker Felt", "Comic Sans MS", system-ui, sans-serif';
      x.fillText(name, 256, 100, 490);
      x.font = '700 50px system-ui, sans-serif';
      x.fillStyle = '#5a5244';
      x.fillText(order, 256, 205, 490);
    }
    const mat = this.boxLabel.material as THREE.MeshBasicMaterial;
    mat.map?.dispose();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    mat.map = tex;
    mat.needsUpdate = true;
  }

  close() {
    this.open = false;
    this.root.hidden = true;
    this.ladleId = this.cupId = null;
  }

  private size() {
    const r = this.canvas.getBoundingClientRect();
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    this.renderer?.setSize(this.w, this.h, false);
    this.cam.aspect = this.w / this.h;
    // Narrow screens pull back so the pan still fits across.
    this.cam.fov = this.cam.aspect < 1.05 ? 42 + (1.05 - this.cam.aspect) * 34 : 42;
    this.cam.updateProjectionMatrix();
    this.cam.updateMatrixWorld();
    // How far a pixel is on the table, around the middle of the view.
    const a = this.onTable(this.w / 2, this.h * 0.55);
    const bx = this.onTable(this.w / 2 + 40, this.h * 0.55);
    const bz = this.onTable(this.w / 2, this.h * 0.55 + 40);
    this.perPx = { x: Math.abs(bx.x - a.x) / 40, z: Math.abs(bz.z - a.z) / 40 };
  }

  /** The point on the table under a point on the canvas. */
  private onTable(px: number, py: number) {
    const v = new THREE.Vector3((px / this.w) * 2 - 1, -(py / this.h) * 2 + 1, 0.5).unproject(this.cam);
    const dir = v.sub(this.cam.position).normalize();
    const t = -this.cam.position.y / dir.y;
    return { x: this.cam.position.x + dir.x * t, z: this.cam.position.z + dir.z * t };
  }

  /** Where a point in the scene is on the canvas (for tests, and for telling a touch on the cup). */
  project(x: number, y: number, z: number) {
    const v = new THREE.Vector3(x, y, z).project(this.cam);
    return { x: (v.x * 0.5 + 0.5) * this.w, y: (-v.y * 0.5 + 0.5) * this.h };
  }

  private pt(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  // ---------- Input ----------
  // The ladle moves with your thumb from wherever the thumb is. A touch on the cup is your other
  // hand: the cup goes where you drag it.

  private down(e: PointerEvent) {
    e.preventDefault();
    const p = this.pt(e);
    const c = this.project(this.cup.x, W.cup.h * 0.5, this.cup.z);
    const onCup = Math.hypot(p.x - c.x, p.y - c.y) < 46;
    if (onCup && this.cupId === null && this.sealing === 0 && this.hop < 0 && !this.latch) this.cupId = e.pointerId;
    else if (this.ladleId === null) this.ladleId = e.pointerId;
    else return;
    this.lastTouch = e.pointerId === this.ladleId ? { x: p.x, y: p.y } : this.lastTouch;
    if (e.pointerId === this.cupId) this.cupTouch = { x: p.x, y: p.y };
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* not a live pointer (synthetic): fine */
    }
  }
  private cupTouch = { x: 0, y: 0 };

  private move(e: PointerEvent) {
    const p = this.pt(e);
    const L = SAUCE.ladle;
    if (e.pointerId === this.ladleId) {
      this.aim.x = Math.max(-15, Math.min(15, this.aim.x + (p.x - this.lastTouch.x) * this.perPx.x * L.gain));
      this.aim.z = Math.max(W.pan.z0 + 2, Math.min(15, this.aim.z + (p.y - this.lastTouch.y) * this.perPx.z * L.gain));
      this.lastTouch = { x: p.x, y: p.y };
    } else if (e.pointerId === this.cupId) {
      this.cup.x = Math.max(-13, Math.min(1, this.cup.x + (p.x - this.cupTouch.x) * this.perPx.x));
      this.cup.z = Math.max(W.pan.z1 + 5, Math.min(11, this.cup.z + (p.y - this.cupTouch.y) * this.perPx.z));
      this.cupTouch = { x: p.x, y: p.y };
    }
  }

  private up(e: PointerEvent) {
    if (e.pointerId === this.ladleId) this.ladleId = null;
    if (e.pointerId === this.cupId) this.cupId = null;
  }

  // ---------- Frame ----------

  private frame(now: number) {
    if (!this.open) return;
    const dt = Math.min(1 / 30, (now - this.last) / 1000);
    this.last = now;
    this.step(dt);
    this.draw();
    requestAnimationFrame((t) => this.frame(t));
  }

  private get feel() {
    return SAUCE.ladle.feel[this.sauce as 'marinara' | 'ranch'] ?? SAUCE.ladle.feel.marinara;
  }

  private inPan(x: number, z: number) {
    const p = W.pan;
    return x > p.x0 + 1 && x < p.x1 - 1 && z > p.z0 + 1 && z < p.z1 - 1;
  }

  /** Advance by dt seconds (public so tests can drive it). */
  step(dt: number) {
    const L = SAUCE.ladle;
    const F = this.feel;
    const R = W.bowl;
    this.t += dt;
    const busy = this.sealing > 0 || this.hop >= 0;
    // Coming toward you with something in the bowl, it stops at the cup's far edge.
    const stop = { x: this.cup.x, z: this.cup.z - R * 0.85 };
    if (!this.latch && !busy && this.load > 0.02 && Math.hypot(this.aim.x - stop.x, this.aim.z - stop.z) < L.catch) {
      this.latch = { z: this.aim.z };
      haptic(6);
    }
    if (this.latch) {
      // The hand keeps coming toward you past where the bowl stopped: that's what swings it over.
      this.latch.z = Math.min(this.latch.z, this.aim.z);
      // (A little slack first, so settling at the cup isn't already a pour.)
      const pulled = (this.aim.z - this.latch.z) / L.pull;
      this.tilt = Math.max(0, Math.min(1, (pulled - 0.06) / 0.94));
      // Off to the side, or pushed well back toward the pan: it's off the cup.
      if (Math.abs(this.aim.x - this.cup.x) > 7.5 || this.aim.z < stop.z - 7 || busy) {
        this.latch = null;
        this.tilt = 0;
      }
    } else this.tilt = 0;
    // The bowl follows: to the cup's edge, or to under the hand; down into the pan, up to carry.
    const over = !this.latch && this.inPan(this.bowl.x, this.bowl.z);
    const to = this.latch ? { x: stop.x, y: W.cup.h + R + 0.9, z: stop.z } : { x: this.aim.x, y: over ? this.dipY : this.carryY, z: this.aim.z };
    const k = 1 - Math.exp(-L.follow * dt);
    const ox = this.bowl.x;
    const oz = this.bowl.z;
    this.bowl.x += (to.x - this.bowl.x) * k;
    this.bowl.z += (to.z - this.bowl.z) * k;
    this.bowl.y += (to.y - this.bowl.y) * (1 - Math.exp(-14 * dt));
    this.bowl.vx = (this.bowl.x - ox) / Math.max(dt, 1e-3);
    this.bowl.vz = (this.bowl.z - oz) / Math.max(dt, 1e-3);
    // Down in the sauce, it fills.
    if (over && this.bowl.y < this.dipY + 1.6 && !busy) {
      const was = this.load;
      this.load = Math.min(1, this.load + dt / L.dipTime);
      if (was < 1 && this.load >= 1) haptic(8);
    }
    // Rushing a full ladle slops it.
    const speed = Math.hypot(this.bowl.vx, this.bowl.vz);
    if (!over && !this.latch && this.load > L.slopAbove && speed > L.slopSpeed) {
      const lost = Math.min(this.load - L.slopAbove, L.slopRate * dt * (speed / L.slopSpeed));
      this.load -= lost;
      this.spill(lost, this.bowl.x, this.bowl.y, this.bowl.z);
    }
    // The pour: over the lip, toward you. Thick sauce takes a moment to get going and to stop.
    const want = this.latch && this.load > 0 ? Math.pow(this.tilt, 1.4) * F.flow : 0;
    this.rate += (want - this.rate) * (1 - Math.exp(-dt / F.lag));
    if (this.rate < 0.02 && want < 0.02) this.rate = 0;
    if (this.rate > 0 && this.load > 0 && !busy) {
      const glug = 1 + F.glug * Math.sin(this.t * 17);
      const amt = Math.min(this.load, this.rate * glug * dt);
      this.load -= amt;
      this.fill += amt;
      this.lastPour = this.t;
      if (Math.random() < dt * 14) sfx.rim();
      // Over the top: down the side and onto the tally. The cup is still a (full) cup.
      if (this.fill > SAUCE.overflow) {
        const extra = this.fill - SAUCE.overflow;
        this.fill = SAUCE.overflow;
        const a = Math.random() * Math.PI * 2;
        this.spill(extra, this.cup.x + Math.cos(a) * W.cup.rTop, W.cup.h, this.cup.z + Math.sin(a) * W.cup.rTop);
      }
    }
    if (this.load <= 0.001) this.load = 0;
    this.drops(dt);
    // Eased off, with it filled: the lid goes on and the cup goes in its box.
    if (!busy && this.fill >= SAUCE.okMin && this.rate < 0.03 && this.tilt < 0.12 && this.t - this.lastPour > L.rest) {
      this.sealing = 0.25;
      this.sealedFill = this.fill;
      haptic(12);
      sfx.catch(4);
    }
    if (this.sealing > 0) {
      this.sealing = Math.max(0, this.sealing - dt);
      if (this.sealing === 0) this.hop = 0;
    } else if (this.hop >= 0) {
      this.hop += dt / 0.4;
      if (this.hop >= 1) {
        this.hop = -1;
        this.fill = 0;
        this.made++;
        this.k.ladledCup(this.sauce, this.sealedFill);
      }
    }
    this.hint.textContent = this.latch
      ? this.tilt > 0.05
        ? 'ease back to stop on the line'
        : 'keep pulling toward you to pour'
      : this.load > 0.5
        ? 'pull it toward you, to the cup'
        : 'run the ladle through the pan';
    this.count.textContent = this.made ? `+${this.made}` : '';
  }

  /** Sauce that isn't going in the cup: it falls, it lands, and it's on the tab. */
  private spill(cups: number, x: number, y: number, z: number) {
    this.spilled += cups;
    const n = Math.min(5, Math.max(1, Math.round(cups * 40)));
    for (let i = 0; i < n && this.drips.length < 40; i++) {
      const mesh = new THREE.Mesh(DRIP, this.sauceMat);
      mesh.position.set(x + (Math.random() - 0.5) * 1.5, y, z + (Math.random() - 0.5) * 1.5);
      mesh.scale.setScalar(0.25 + Math.random() * 0.25);
      this.scene.add(mesh);
      this.drips.push({ mesh, vx: (Math.random() - 0.5) * 6, vy: 2 + Math.random() * 4, vz: (Math.random() - 0.5) * 6 });
    }
    const owed = Math.floor(this.spilled * SAUCE.spillCents) - this.charged;
    if (owed > 0) {
      this.charged += owed;
      this.k.spillSauce(this.sauce, owed);
      this.tallyCents += owed;
      this.tally.textContent = `SPILLED −$${(this.tallyCents / 100).toFixed(2)}`;
      this.tally.classList.add('on');
      this.tally.classList.remove('tick');
      void this.tally.offsetWidth;
      this.tally.classList.add('tick');
      if (Math.floor(this.charged / 25) !== Math.floor((this.charged - owed) / 25)) sfx.splat();
    }
  }

  private drops(dt: number) {
    const keep: Drip[] = [];
    for (const d of this.drips) {
      d.vy -= 90 * dt;
      d.mesh.position.x += d.vx * dt;
      d.mesh.position.y += d.vy * dt;
      d.mesh.position.z += d.vz * dt;
      if (d.mesh.position.y <= 0.1) {
        this.scene.remove(d.mesh);
        if (this.stains.length < 40) {
          const s = new THREE.Mesh(STAIN, this.sauceMat);
          s.rotation.x = -Math.PI / 2;
          s.position.set(d.mesh.position.x, 0.04 + this.stains.length * 0.001, d.mesh.position.z);
          s.scale.setScalar(d.mesh.scale.x * 3);
          this.scene.add(s);
          this.stains.push(s);
        }
        continue;
      }
      keep.push(d);
    }
    this.drips = keep;
  }

  // ---------- Drawing ----------

  private draw() {
    const r = this.renderer;
    if (!r) return;
    const R = W.bowl;
    const c = W.cup;
    // The ladle: swung over about the bowl's mouth, so your hand comes toward you as it tips.
    const angle = this.tilt * SAUCE.ladle.swing;
    this.ladle.position.set(this.bowl.x, this.bowl.y, this.bowl.z);
    this.ladle.rotation.x = angle;
    // What's in the bowl stays level, sinks as it empties, and slides to the near lip as it tips.
    const s = 0.35 + 0.65 * Math.sqrt(this.load);
    this.bowlSauce.visible = this.load > 0.02;
    this.bowlSauce.scale.setScalar(s);
    this.bowlSauce.rotation.x = -Math.PI / 2 - angle;
    this.bowlSauce.position.set(0, -R * (1 - s) * 0.8 * Math.cos(angle), R * (1 - s) * 0.8 * Math.sin(angle) + R * 0.25 * this.tilt * (1 - s));
    this.shadow.visible = !this.latch;
    const overPan = this.inPan(this.bowl.x, this.bowl.z);
    this.shadow.position.set(this.bowl.x, overPan ? this.panTop + 0.05 : 0.26, this.bowl.z);
    const high = Math.max(0, this.bowl.y - this.dipY) / (this.carryY - this.dipY);
    // Steam curls up off the hot pan.
    if (this.warmer.visible) {
      this.steam.forEach((puff, i) => {
        const u = (this.t * 0.35 + i / this.steam.length) % 1;
        puff.position.set(W.pan.x0 + 4 + ((i * 0.37) % 1) * 20 + Math.sin(this.t * 0.9 + i) * 1.2, this.panTop + 0.6 + u * 9, W.pan.z0 + 3 + ((i * 0.61) % 1) * 8);
        puff.quaternion.copy(this.cam.quaternion);
        puff.scale.setScalar(0.7 + u * 1.6);
        (puff.material as THREE.MeshBasicMaterial).opacity = 0.16 * Math.sin(u * Math.PI);
      });
    }
    this.shadow.scale.setScalar(0.75 + 0.35 * high);
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = 0.3 - 0.12 * high;
    // The cup: where it is, or on its way into the box.
    const hopping = this.hop >= 0;
    const u = hopping ? this.hop : 0;
    const b = W.box;
    this.cupG.position.set(this.cup.x + (b.x - 2.4 - this.cup.x) * u, (hopping ? Math.sin(u * Math.PI) * 6 + b.h * u : 0), this.cup.z + (b.z + 1.5 - this.cup.z) * u);
    const lidded = this.sealing > 0 || hopping;
    const v = Math.min(1, lidded ? this.sealedFill : this.fill);
    if (Math.abs(v - this.fillShown) > 0.004) {
      this.fillShown = v;
      this.cupSauce.visible = v > 0.01;
      if (v > 0.01) {
        this.cupSauce.geometry.dispose();
        this.cupSauce.geometry = new THREE.CylinderGeometry(c.rBot + (c.rTop - c.rBot) * v - 0.1, c.rBot - 0.1, c.h * v, 28);
        this.cupSauce.position.y = (c.h * v) / 2 + 0.05;
      }
    }
    const on = !lidded && this.fill >= SAUCE.perfect[0] && this.fill <= SAUCE.perfect[1];
    const line = this.cupLine.material as THREE.MeshBasicMaterial;
    line.color.set(on ? '#3fd06a' : '#ffffff');
    this.cupLine.scale.setScalar(on ? 1.03 : 1);
    this.cupLine.visible = !lidded;
    this.cupLid.visible = lidded;
    this.cupLid.position.y = c.h + 0.15 + this.sealing * 12;
    // The stream: from the near lip of the bowl down to the sauce in the cup.
    const pouring = this.rate > 0.02 && !!this.latch;
    this.stream.visible = pouring;
    if (pouring) {
      const from = new THREE.Vector3(this.bowl.x, this.bowl.y - R * Math.sin(angle), this.bowl.z + R * Math.cos(angle));
      const to = new THREE.Vector3(this.cup.x, c.h * Math.min(1, this.fill) + 0.1, this.cup.z);
      const len = from.distanceTo(to);
      const wide = (0.18 + 0.5 * Math.min(1, this.rate / this.feel.flow)) * (this.sauce === 'marinara' ? 1.35 : 1) * (1 + this.feel.glug * 0.5 * Math.sin(this.t * 17));
      this.stream.position.copy(from).add(to).multiplyScalar(0.5);
      this.stream.scale.set(wide, len, wide);
      this.stream.quaternion.setFromUnitVectors(UP, from.sub(to).normalize());
    }
    r.render(this.scene, this.cam);
  }
}

const UP = new THREE.Vector3(0, 1, 0);
const DRIP = new THREE.SphereGeometry(1, 8, 6);
const STAIN = new THREE.CircleGeometry(1, 14);

/** The black and white liner paper. */
function checker() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  if (x) {
    x.fillStyle = '#fbfaf5';
    x.fillRect(0, 0, 128, 128);
    x.fillStyle = '#1c1c1c';
    for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) if ((i + j) % 2 === 0) x.fillRect(i * 16, j * 16, 16, 16);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function rr(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

/**
 * The lemon berry mascarpone cup, the way it's made on the line. A quarter pan of mascarpone in the
 * cold table with its little spatula (wooden handle, blue blade), and a squeeze bottle of berry
 * compote. Scoop a good amount onto the spatula, put it in the cup and scrape it off against the
 * edge; then squeeze compote into the space that's left, so the cup is half and half. Too much on
 * the spatula and it won't all fit: it ends up on the rim. Too much compote and it runs over.
 */
export class MascarponeView {
  private root: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private title: HTMLElement;
  private count: HTMLElement;
  private hint: HTMLElement;
  private open = false;
  private w = 1;
  private h = 1;
  /** Mascarpone in the cup, compote in the cup, and mascarpone smeared on the rim (cups' worth). */
  private paste = 0;
  private berry = 0;
  private mess = 0;
  /** Compote down the side, cents (the tally on the table). */
  private spiltCents = 0;
  private owed = 0;
  /** What's in your hand: the spatula (with what's on it) or the bottle. */
  private tool: { id: number; kind: 'spatula' | 'bottle'; x: number; y: number; load: number } | null = null;
  private squeezing = false;
  private idle = 0;
  private sealed = 0;
  private made = 0;
  private last = 0;
  private t = 0;

  constructor(parent: HTMLElement, private k: Kitchen) {
    this.root = el('div', 'ladle-ui', parent);
    this.root.hidden = true;
    const bar = el('div', 'ladle-top', this.root);
    this.title = el('div', 'ladle-title', bar);
    this.count = el('div', 'ladle-count', bar);
    this.canvas = el('canvas', 'ladle-canvas', this.root);
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d canvas');
    this.ctx = ctx;
    const foot = el('div', 'scene-bar ladle-bar', this.root);
    this.hint = el('div', 'scene-hint', foot);
    const done = el('button', 'scene-btn primary', foot);
    done.textContent = 'DONE';
    done.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.close();
    });
    this.canvas.addEventListener('pointerdown', (e) => this.down(e));
    this.canvas.addEventListener('pointermove', (e) => this.move(e));
    this.canvas.addEventListener('pointerup', (e) => this.up(e));
    this.canvas.addEventListener('pointercancel', (e) => this.up(e));
  }

  /** Where things are: the pan along the top, the bottle to its right, the cup below (side on). */
  get geo() {
    const { w, h } = this;
    const cupH = Math.min(h * 0.36, w * 0.6);
    const top = Math.min(w * 0.5, cupH * 1.25);
    return {
      pan: { x: w * 0.05, y: h * 0.05, w: w * 0.62, h: h * 0.2 },
      bottle: { x: w * 0.84, y: h * 0.27, w: Math.min(54, w * 0.15), h: h * 0.16 },
      cup: { x: w / 2, rim: h * 0.5, bottom: h * 0.5 + cupH, top, base: top * 0.74 },
      table: h * 0.5 + cupH + 4,
    };
  }

  /** How high the mascarpone stands against its side of the cup, and the level of the whole cup (0..1). */
  levels() {
    const M = SAUCE.mascarpone;
    const hp = this.paste / M.side;
    const right = (1 - M.side) * hp;
    const level = this.berry <= right ? this.berry / (1 - M.side) : hp + (this.berry - right);
    return { hp, level: Math.max(hp, level), berryLevel: level };
  }

  isOpen() {
    return this.open;
  }

  show() {
    this.open = true;
    this.root.hidden = false;
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = r.width;
    this.h = r.height;
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.made = 0;
    this.spiltCents = 0;
    this.fresh();
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  close() {
    this.open = false;
    this.root.hidden = true;
    this.tool = null;
  }

  private fresh() {
    this.paste = 0;
    this.berry = 0;
    this.mess = 0;
    this.owed = 0;
    this.idle = 0;
    this.sealed = 0;
    this.squeezing = false;
  }

  private pt(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private inPan(x: number, y: number) {
    const p = this.geo.pan;
    return x > p.x && x < p.x + p.w && y > p.y - 10 && y < p.y + p.h + 10;
  }

  /** Is this point down in the mouth of the cup? */
  private inCup(x: number, y: number) {
    const c = this.geo.cup;
    return Math.abs(x - c.x) < c.top * 0.5 + 6 && y > c.rim - 14 && y < c.bottom;
  }

  private down(e: PointerEvent) {
    e.preventDefault();
    if (this.tool || this.sealed) return;
    const p = this.pt(e);
    const g = this.geo;
    // The bottle is the bottle; anything else is the spatula coming up out of the pan.
    const b = g.bottle;
    const bottle = Math.abs(p.x - b.x) < b.w * 0.9 && p.y > b.y - b.h - 10 && p.y < b.y + 16;
    this.tool = { id: e.pointerId, kind: bottle ? 'bottle' : 'spatula', x: p.x, y: p.y, load: 0 };
    haptic(6);
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* not a live pointer (synthetic): fine */
    }
  }

  private move(e: PointerEvent) {
    const f = this.tool;
    if (!f || f.id !== e.pointerId) return;
    const p = this.pt(e);
    const M = SAUCE.mascarpone;
    const dist = Math.hypot(p.x - f.x, p.y - f.y);
    if (f.kind === 'spatula') {
      if (this.inPan(p.x, p.y)) {
        // Dragging through the pan loads the blade: a good scoop is one pass, and it'll take more.
        const was = f.load;
        f.load = Math.min(M.scoopMax, f.load + (dist / this.geo.pan.w) * M.scoopPerPass);
        if (was < M.goodScoop && f.load >= M.goodScoop) haptic(10);
      } else if (this.inCup(p.x, p.y) && f.load > 0) {
        // In the cup, against the edge: it scrapes off the blade. What doesn't fit ends up on the rim.
        const amt = Math.min(f.load, (dist / this.geo.cup.top) * M.scrapePerPass);
        f.load -= amt;
        const room = Math.max(0, M.side * M.pasteMax - this.paste);
        this.paste += Math.min(amt, room);
        this.mess += Math.max(0, amt - room);
        if (amt > 0 && Math.random() < 0.3) sfx.rim();
      }
    }
    f.x = p.x;
    f.y = p.y;
  }

  private up(e: PointerEvent) {
    if (this.tool?.id === e.pointerId) {
      this.tool = null;
      this.squeezing = false;
    }
  }

  private frame(now: number) {
    if (!this.open) return;
    const dt = Math.min(1 / 30, (now - this.last) / 1000);
    this.last = now;
    this.step(dt);
    this.draw();
    requestAnimationFrame((t) => this.frame(t));
  }

  /** The bottle's nozzle: it's held tipped over, nozzle down, a little above your finger. */
  private nozzle(f: { x: number; y: number }) {
    return { x: f.x - 6, y: f.y - 34 };
  }

  /** Advance by dt seconds (public so tests can drive it). */
  step(dt: number) {
    const M = SAUCE.mascarpone;
    const g = this.geo;
    const f = this.tool;
    this.t += dt;
    if (this.sealed > 0) {
      this.sealed -= dt;
      if (this.sealed <= 0) this.fresh();
      return;
    }
    this.squeezing = false;
    if (f?.kind === 'bottle') {
      // Over the cup, the bottle squeezes; anywhere else it just waits.
      const n = this.nozzle(f);
      if (Math.abs(n.x - g.cup.x) < g.cup.top * 0.46 && n.y < g.cup.rim + 6) {
        this.squeezing = true;
        this.berry += M.squeeze * dt;
        const { level } = this.levels();
        if (level > M.overflow) {
          // Over the top: down the side, and onto Matt's tab a cent at a time.
          const over = level - M.overflow;
          this.berry -= over;
          this.owed += over * SAUCE.spillCents;
          const cents = Math.floor(this.owed);
          if (cents > 0) {
            this.owed -= cents;
            this.spiltCents += cents;
            this.k.spillSauce('mascarpone', cents);
          }
        }
      }
      this.idle = 0;
    } else if (f) this.idle = 0;
    else if (this.berry > 0.04) {
      // Bottle down with compote in the cup: that's the cup.
      this.idle += dt;
      if (this.idle > 0.5) this.finish();
    }
    const scooped = f?.kind === 'spatula' && f.load > 0.02;
    this.hint.textContent =
      this.paste < M.side * M.pasteOk[0] && !scooped
        ? 'drag the spatula through the mascarpone'
        : scooped
          ? 'into the cup · scrape it off on the edge'
          : this.berry < 0.04
            ? 'now the berry bottle · fill the other half'
            : 'to the line · let go';
    this.title.textContent = 'MASCARPONE';
    this.count.textContent = `${this.k.cupStock.mascarpone ?? 0} ready${this.made ? ` · +${this.made}` : ''}`;
  }

  private finish() {
    const M = SAUCE.mascarpone;
    const { hp, level } = this.levels();
    const okPaste = hp >= M.pasteOk[0] && hp <= M.pasteOk[1] && this.mess < M.messOk;
    const okBerry = level >= M.levelOk[0] && level <= M.levelOk[1] && this.berry >= M.berryMin;
    // Half and half to the line with a clean rim is the cup; one of the two is passable.
    const fill = okPaste && okBerry ? 0.9 : okPaste || okBerry ? 0.75 : 0.5;
    const ok = this.k.ladledCup('mascarpone', fill);
    if (ok) {
      this.made++;
      haptic(12);
      this.sealed = 0.5;
    } else {
      this.k.say(this.mess >= M.messOk ? 'Mascarpone all over the rim: again' : hp < M.pasteOk[0] ? 'Mostly compote: again' : 'Not a cup yet: again');
      sfx.reject();
      this.sealed = 0.35;
    }
  }

  /** A point in the cup: u across (0 left wall, 1 right wall), v up (0 bottom, 1 rim). */
  private at(u: number, v: number) {
    const c = this.geo.cup;
    const wv = c.base + (c.top - c.base) * v;
    return { x: c.x + (u - 0.5) * wv, y: c.bottom - v * (c.bottom - c.rim) };
  }

  private draw() {
    const c = this.ctx;
    const g = this.geo;
    const M = SAUCE.mascarpone;
    const { w, h } = this;
    const CREAM = '#fbf3dc';
    const BERRY = '#8e1f4a';
    // The table: butcher block, with the quarter pan sitting on it.
    c.fillStyle = '#e3b877';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#cf9a55';
    c.fillRect(0, g.table, w, h - g.table);
    const p = g.pan;
    rr(c, p.x, p.y, p.w, p.h, 12);
    c.fillStyle = '#dfe4e8';
    c.fill();
    c.strokeStyle = '#7e878d';
    c.lineWidth = 2;
    c.stroke();
    rr(c, p.x + 9, p.y + 9, p.w - 18, p.h - 18, 8);
    c.fillStyle = CREAM;
    c.fill();
    // Soft peaks, so it reads as something you could drag a spatula through.
    c.strokeStyle = '#efe3bf';
    c.lineWidth = 3;
    c.lineCap = 'round';
    for (let i = 0; i < 5; i++) {
      const x = p.x + 26 + ((p.w - 60) * i) / 4;
      c.beginPath();
      c.moveTo(x - 12, p.y + p.h * 0.62);
      c.quadraticCurveTo(x, p.y + p.h * 0.3, x + 12, p.y + p.h * 0.58);
      c.stroke();
    }
    // The cup, side on: clear plastic, so you can see the two halves.
    const tl = this.at(0, 1);
    const tr = this.at(1, 1);
    const bl = this.at(0, 0);
    const br = this.at(1, 0);
    const { hp, berryLevel } = this.levels();
    c.save();
    c.beginPath();
    c.moveTo(tl.x, tl.y - 30);
    c.lineTo(tr.x, tr.y - 30);
    c.lineTo(br.x, br.y);
    c.lineTo(bl.x, bl.y);
    c.closePath();
    c.clip();
    // Compote first (it fills the space that's left, and over the top once it's past the mascarpone).
    if (this.berry > 0) {
      const lv = Math.min(M.overflow, berryLevel);
      const a = this.at(0, lv);
      c.fillStyle = BERRY;
      c.fillRect(bl.x - 20, a.y, tr.x - bl.x + 40, bl.y - a.y);
      // A little swirl where the two meet.
      c.strokeStyle = '#b84a74';
      c.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        const q = this.at(M.side + 0.06 + i * 0.1, Math.min(lv, hp) * (0.3 + i * 0.22));
        c.beginPath();
        c.arc(q.x, q.y, 5 + i * 2, 0.4, Math.PI * 1.4);
        c.stroke();
      }
    }
    // The mascarpone: scraped down one side, standing with a soft shoulder.
    if (this.paste > 0) {
      const top = Math.min(1.08, hp);
      const a0 = this.at(0, top);
      const a1 = this.at(M.side * 0.72, top);
      const a2 = this.at(M.side + 0.07, top * 0.45);
      const a3 = this.at(M.side + 0.02, 0);
      c.fillStyle = CREAM;
      c.beginPath();
      c.moveTo(bl.x - 4, bl.y + 2);
      c.lineTo(a0.x - 4, a0.y);
      c.lineTo(a1.x, a1.y);
      c.quadraticCurveTo(a2.x + 8, a2.y - (a2.y - a1.y) * 0.5, a2.x, a2.y);
      c.quadraticCurveTo(a3.x + 6, (a2.y + a3.y) / 2, a3.x, a3.y + 2);
      c.closePath();
      c.fill();
      c.strokeStyle = '#e6d9b0';
      c.lineWidth = 2;
      c.stroke();
    }
    c.restore();
    // The line to fill to.
    const l0 = this.at(0, SAUCE.line);
    const l1 = this.at(1, SAUCE.line);
    c.setLineDash([6, 5]);
    c.strokeStyle = '#ffffffcc';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(l0.x + 3, l0.y);
    c.lineTo(l1.x - 3, l1.y);
    c.stroke();
    c.setLineDash([]);
    // Cup walls and rim.
    c.strokeStyle = '#f4f6f7';
    c.lineWidth = 4;
    c.lineJoin = 'round';
    c.beginPath();
    c.moveTo(tl.x, tl.y);
    c.lineTo(bl.x, bl.y);
    c.lineTo(br.x, br.y);
    c.lineTo(tr.x, tr.y);
    c.stroke();
    c.lineWidth = 6;
    c.beginPath();
    c.moveTo(tl.x - 5, tl.y);
    c.lineTo(tr.x + 5, tr.y);
    c.globalAlpha = 0.35;
    c.stroke();
    c.globalAlpha = 1;
    // What didn't fit: smeared on the rim and down the outside.
    if (this.mess > 0.005) {
      const n = Math.min(7, 1 + Math.floor(this.mess / 0.03));
      c.fillStyle = CREAM;
      for (let i = 0; i < n; i++) {
        const side = i % 2 ? tr : tl;
        const dir = i % 2 ? 1 : -1;
        c.beginPath();
        c.ellipse(side.x + dir * (4 + (i >> 1) * 3), side.y + 4 + (i >> 1) * 9, 9, 6 + (i >> 1) * 2, dir * 0.5, 0, Math.PI * 2);
        c.fill();
      }
    }
    // Compote down the side.
    if (this.spiltCents > 0 && berryLevel >= M.overflow - 0.01) {
      c.fillStyle = BERRY;
      rr(c, tr.x + 1, tr.y - 2, 7, Math.min(g.table - tr.y, 20 + this.spiltCents * 1.2), 3);
      c.fill();
    }
    if (this.spiltCents > 0) {
      c.fillStyle = '#3a1410';
      const label = `SPILLED −$${(this.spiltCents / 100).toFixed(2)}`;
      c.font = '900 16px ui-monospace, Menlo, monospace';
      const tw = c.measureText(label).width;
      rr(c, w / 2 - tw / 2 - 10, g.table + 8, tw + 20, 26, 7);
      c.fill();
      c.fillStyle = '#ff8a7a';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(label, w / 2, g.table + 21);
    }
    // The lid, when it's a cup.
    if (this.sealed > 0 && this.made) {
      c.fillStyle = '#f4f6f7';
      rr(c, tl.x - 8, tl.y - 8, tr.x - tl.x + 16, 10, 4);
      c.fill();
    }
    const f = this.tool;
    // The bottle: standing by the pan, or tipped over in your hand.
    const b = g.bottle;
    const drawBottle = (x: number, y: number, rot: number) => {
      c.save();
      c.translate(x, y);
      c.rotate(rot);
      c.fillStyle = '#f1f3f4';
      rr(c, -b.w / 2, -b.h, b.w, b.h, 9);
      c.fill();
      c.fillStyle = BERRY;
      rr(c, -b.w / 2 + 4, -b.h * 0.8, b.w - 8, b.h * 0.8 - 4, 6);
      c.fill();
      c.fillStyle = '#f1f3f4';
      c.beginPath();
      c.moveTo(-b.w * 0.3, -b.h);
      c.lineTo(b.w * 0.3, -b.h);
      c.lineTo(3, -b.h - 22);
      c.lineTo(-3, -b.h - 22);
      c.closePath();
      c.fill();
      c.restore();
    };
    if (f?.kind === 'bottle') {
      const n = this.nozzle(f);
      // Tipped: the nozzle points down at the cup, the body up and away from your finger.
      const rot = Math.PI * 0.94;
      const reach = b.h + 22;
      drawBottle(n.x - reach * Math.sin(rot), n.y + reach * Math.cos(rot), rot);
      if (this.squeezing) {
        const { berryLevel: lv } = this.levels();
        const surf = this.at(0.5, Math.min(1, Math.max(lv, 0.02))).y;
        c.strokeStyle = BERRY;
        c.lineWidth = 5 + Math.sin(this.t * 30) * 1;
        c.lineCap = 'round';
        c.beginPath();
        c.moveTo(n.x, n.y);
        c.lineTo(n.x, Math.max(n.y + 4, surf));
        c.stroke();
      }
    } else drawBottle(b.x, b.y, 0);
    // The spatula: wooden handle, blue blade. Lying in the pan, or in your hand with what's on it.
    const drawSpatula = (x: number, y: number, rot: number, load: number) => {
      c.save();
      c.translate(x, y);
      c.rotate(rot);
      c.fillStyle = '#b07a44';
      rr(c, 18, -5, 78, 10, 5);
      c.fill();
      c.fillStyle = '#2f6fd6';
      rr(c, -22, -12, 46, 24, 7);
      c.fill();
      if (load > 0.01) {
        // A good scoop covers the blade; too much hangs off it.
        const k = load / M.goodScoop;
        c.fillStyle = CREAM;
        c.beginPath();
        c.ellipse(-2, -4 - k * 5, 10 + Math.min(1.5, k) * 13, 5 + Math.min(1.8, k) * 9, 0, 0, Math.PI * 2);
        c.fill();
        if (k > 1.25) {
          c.beginPath();
          c.ellipse(-20, 8, 7, 5 + (k - 1.25) * 14, 0.3, 0, Math.PI * 2);
          c.fill();
        }
      }
      c.restore();
    };
    if (f?.kind === 'spatula') drawSpatula(f.x, f.y - 6, -0.62, f.load);
    else drawSpatula(p.x + p.w * 0.7, p.y + p.h * 0.5, -0.35, 0);
  }
}
