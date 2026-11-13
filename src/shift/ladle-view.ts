import * as THREE from 'three';
import { SAUCE } from '../config/shift';
import { clamshellModel, SAUCE_COLORS, woodMaterial } from '../render/models';
import { haptic, sfx } from '../ui/feel';
import { bigCupsFor, type Box, type Kitchen, lidOrder, type Sauce, saucesFor } from './kitchen';
import { BOX_FOCUS } from '../config/box-focus';
import { FLAVORS } from '../config/flavors';
import { dispose } from '../render/dispose';
import { LID_INK } from './lid-ink';
import { RavMeshes } from './rav-meshes';

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

const NAMES: Record<string, string> = { marinara: 'MARINARA', ranch: 'RANCH', mascarpone: 'MASCARPONE' };

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
  /** The cold table, and the ranch pan in it (the left half; the rest is mascarpone, parm and parsley). */
  /**
   * The cold table: six square pans, three across and two deep, in a table deep enough that a pan
   * holds three layers of four cups. s is a pan's side, gap the steel between pans, z1 its front edge.
   */
  cold: { s: 11, gap: 1.3, h: 12.6, z1: -2.5 },
  box: { x: 8.6, z: 8.5, w: 10.5, d: 8.5, h: 2.6 },
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
  /** What the kitchen is told the cup scored (for the ladle sauces that's just how full it is). */
  private sealedScore = 0;
  // Mascarpone: a spatula, then the berry bottle. How much of each is in the cup, and what ended up on the rim.
  private mPhase: 'paste' | 'berry' = 'paste';
  private paste = 0;
  private berry = 0;
  private mess = 0;
  private mShown = '';
  /** The spatula where it lives, standing in the mascarpone (gone from there while it's in your hand). */
  private restSpatula = new THREE.Group();
  private bottleFist!: THREE.Mesh;
  private spatula = new THREE.Group();
  private spatBlob!: THREE.Mesh;
  private bottle = new THREE.Group();
  private mCream!: THREE.Mesh;
  private mBerry!: THREE.Mesh;
  private mBerryTop!: THREE.Mesh;
  private mMess = new THREE.Group();
  private berryMat = new THREE.MeshStandardMaterial({ color: '#8e1f4a', roughness: 0.35 });
  private creamMat = new THREE.MeshStandardMaterial({ color: '#fbeec0', roughness: 0.6 });
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
  private boxG = new THREE.Group();
  private boxShell: THREE.Group | null = null;
  private boxRavs!: RavMeshes;
  private boxKey = '';
  private shownBox: Box | null = null;
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
  private pan: { x0: number; x1: number; z0: number; z1: number } = W.pan;
  /** Cups made ahead, standing where a box would be. */
  private spares = new THREE.Group();
  private sparesShown = -1;
  private ranchFlecks = new THREE.Group();
  /** The cold table's lid, how far open it is (0 shut, 1 up), and whether you're on your way out. */
  private coldLid = new THREE.Group();
  private lidOpen = 0;
  private leaving = 0;

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
    // The cold table: a refrigerated prep table standing on the counter. Six square pans.
    //   back row:  mascarpone (spatula in it) | ranch (the one you ladle) | parsley
    //   front row: clear pan of cupped dessert sauce | clear pan of cupped ranch | parm
    // It's deep: a clear pan holds three layers of four cups.
    const C = W.cold;
    const cold = this.coldWell;
    const tw = C.s * 3 + C.gap * 4;
    const td = C.s * 2 + C.gap * 3;
    const tz = C.z1 - td / 2;
    // The cabinet is hollow under its top (four walls and the steel between the pans), so you can
    // see down into the clear pans.
    const slab = (w: number, h: number, d: number, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), steel);
      m.position.set(x, y, z);
      m.castShadow = m.receiveShadow = true;
      cold.add(m);
    };
    slab(tw, C.h, 0.5, 0, C.h / 2, C.z1 - 0.25);
    slab(tw, C.h, 0.5, 0, C.h / 2, C.z1 - td + 0.25);
    slab(0.5, C.h, td, -tw / 2 + 0.25, C.h / 2, tz);
    slab(0.5, C.h, td, tw / 2 - 0.25, C.h / 2, tz);
    for (let i = 0; i < 4; i++) slab(C.gap, 0.4, td, (i - 1.5) * (C.s + C.gap), C.h - 0.2, tz);
    for (let i = 0; i < 3; i++) slab(tw, 0.4, C.gap, 0, C.h - 0.2, C.z1 - C.gap / 2 - i * (C.s + C.gap));
    // A louvered panel low on the front, where the compressor breathes.
    const vent = new THREE.MeshStandardMaterial({ color: '#7d868c', metalness: 0.4, roughness: 0.5 });
    for (let i = 0; i < 5; i++) {
      const slat = new THREE.Mesh(new THREE.BoxGeometry(tw * 0.42, 0.28, 0.12), vent);
      slat.position.set(-tw * 0.2, 1.6 + i * 0.75, C.z1 + 0.05);
      cold.add(slat);
    }
    const top = C.h;
    const inside = new THREE.MeshStandardMaterial({ color: '#dfeaf0', roughness: 0.5, side: THREE.BackSide });
    const clearWall = new THREE.MeshStandardMaterial({ color: '#eaf6ff', transparent: true, opacity: 0.28, roughness: 0.1, side: THREE.DoubleSide, depthWrite: false });
    const panAt = (col: number, row: number) => ({ x: (col - 1) * (C.s + C.gap), z: C.z1 - C.gap - C.s / 2 - (1 - row) * 0 - (row === 0 ? C.s + C.gap : 0) });
    /**
     * A pan dropped in its well. Real ones are plastic with rounded corners: a rim plate with a
     * rounded hole in it (which also hides the square corners of whatever's underneath), then
     * either food to the brim or, for a clear pan, an open tub you see down into. And a label.
     */
    const cr = C.s * 0.14;
    const hole = (side: number) => {
      const h = side / 2;
      const path = new THREE.Path();
      path.moveTo(-h + cr, -h);
      path.lineTo(h - cr, -h);
      path.quadraticCurveTo(h, -h, h, -h + cr);
      path.lineTo(h, h - cr);
      path.quadraticCurveTo(h, h, h - cr, h);
      path.lineTo(-h + cr, h);
      path.quadraticCurveTo(-h, h, -h, h - cr);
      path.lineTo(-h, -h + cr);
      path.quadraticCurveTo(-h, -h, -h + cr, -h);
      return path;
    };
    const rounded = (side: number) => {
      const shape = new THREE.Shape();
      shape.setFromPoints(hole(side).getPoints(8));
      return shape;
    };
    const rimPlate = () => {
      const outer = new THREE.Shape();
      const o = (C.s + C.gap * 0.7) / 2;
      outer.moveTo(-o, -o);
      outer.lineTo(o, -o);
      outer.lineTo(o, o);
      outer.lineTo(-o, o);
      outer.closePath();
      outer.holes.push(hole(C.s - 0.9));
      const g = new THREE.ExtrudeGeometry(outer, { depth: 0.5, bevelEnabled: false, curveSegments: 8 });
      g.rotateX(-Math.PI / 2);
      return g;
    };
    const rimGeo = rimPlate();
    const plastic = new THREE.MeshStandardMaterial({ color: '#f4f6f7', roughness: 0.35 });
    const pan = (col: number, row: number, fill: string | null, name: string, tilt: number) => {
      const at = panAt(col, row);
      const rim = new THREE.Mesh(rimGeo, fill === null ? clearWall : plastic);
      rim.position.set(at.x, top - 0.05, at.z);
      rim.castShadow = rim.receiveShadow = true;
      if (fill === null) rim.renderOrder = 2;
      cold.add(rim);
      // The label: a strip of tape on the front of the rim, written in marker, a little crooked.
      const tape = new THREE.Mesh(new THREE.PlaneGeometry(C.s * 0.62, 1.5), new THREE.MeshBasicMaterial({ map: tapeLabel(name), transparent: true }));
      tape.rotation.set(-Math.PI / 2, 0, tilt);
      tape.position.set(at.x, top + 0.48, at.z + C.s / 2 - 0.15);
      tape.renderOrder = 3;
      cold.add(tape);
      if (fill === 'live') return;
      if (fill) {
        const food = new THREE.Mesh(new THREE.ShapeGeometry(rounded(C.s - 0.7), 8), new THREE.MeshStandardMaterial({ color: fill, roughness: 0.65 }));
        food.rotation.x = -Math.PI / 2;
        food.position.set(at.x, top - 0.45, at.z);
        food.receiveShadow = true;
        cold.add(food);
        return;
      }
      // A clear plastic tub: you see its walls and its floor, way down.
      const depth = C.h - 1.2;
      const tub = new THREE.Mesh(new THREE.BoxGeometry(C.s - 0.5, depth, C.s - 0.5), inside);
      tub.position.set(at.x, top - depth / 2, at.z);
      cold.add(tub);
    };
    pan(0, 0, '#fbeec0', 'MASCARPONE', 0.05);
    // The ranch pan (back, middle) is the one you ladle from: the sauce in it is the live surface.
    pan(1, 0, 'live', 'RANCH', -0.04);
    pan(2, 0, '#3f9b3a', 'PARSLEY', 0.03);
    pan(0, 1, null, 'DESSERT CUPS', -0.03);
    pan(1, 1, null, 'RANCH CUPS', 0.04);
    pan(2, 1, '#f1e7c4', 'PARM', -0.05);
    // Ranch has its herbs: little off-green flecks all through it.
    {
      const at = panAt(1, 0);
      const fleck = new THREE.MeshBasicMaterial({ color: '#7f9a55' });
      const geo = new THREE.CircleGeometry(0.11, 6);
      let seed = 20261112;
      const rnd = () => {
        seed = (seed * 16807) % 2147483647;
        return seed / 2147483647;
      };
      for (let i = 0; i < 90; i++) {
        const m = new THREE.Mesh(geo, fleck);
        m.rotation.x = -Math.PI / 2;
        m.position.set(at.x + (rnd() - 0.5) * (C.s - 2.2), top - 0.42, at.z + (rnd() - 0.5) * (C.s - 2.2));
        m.scale.setScalar(0.5 + rnd() * 0.9);
        this.ranchFlecks.add(m);
      }
      cold.add(this.ranchFlecks);
    }
    // The metal lid: hinged along the back, a handle on its front edge. It swings up when you get
    // here and comes back down as you leave.
    {
      const lidMat = new THREE.MeshStandardMaterial({ color: '#cfd6da', metalness: 0.5, roughness: 0.35 });
      this.coldLid.position.set(0, C.h + 0.75, C.z1 - td);
      const slabM = new THREE.Mesh(new THREE.BoxGeometry(tw, 0.5, td), lidMat);
      slabM.position.set(0, 0, td / 2);
      slabM.castShadow = true;
      const lipF = new THREE.Mesh(new THREE.BoxGeometry(tw, 1.2, 0.4), lidMat);
      lipF.position.set(0, -0.4, td - 0.2);
      // The handle: a bar standing off the front edge on two posts.
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, tw * 0.34, 10), new THREE.MeshStandardMaterial({ color: '#2a2e33', roughness: 0.5 }));
      bar.rotation.z = Math.PI / 2;
      bar.position.set(0, 0.2, td + 1.3);
      for (const sx of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 1.5), lidMat);
        post.position.set(sx * tw * 0.15, 0.2, td + 0.6);
        this.coldLid.add(post);
      }
      this.coldLid.add(slabM, lipF, bar);
      this.coldLid.traverse((o) => (o.castShadow = true));
      cold.add(this.coldLid);
    }
    // Parsley is leafy and parm is shredded: a little texture so they aren't flat color.
    const tuft = (col: number, row: number, color: string, n: number, sy: number) => {
      const at = panAt(col, row);
      const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.8, flatShading: true });
      for (let i = 0; i < n; i++) {
        const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.9 + ((i * 7) % 4) * 0.18, 0), mat);
        m.scale.y = sy;
        m.position.set(at.x + (((i * 0.37) % 1) - 0.5) * (C.s - 2.6), top - 0.1, at.z + (((i * 0.61) % 1) - 0.5) * (C.s - 2.6));
        m.rotation.y = i;
        m.castShadow = true;
        cold.add(m);
      }
    };
    tuft(2, 0, '#4fb347', 16, 0.55);
    tuft(2, 1, '#fff6d8', 16, 0.3);
    // The little spatula standing in the mascarpone.
    const spat = this.restSpatula;
    const handleM = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 6.5, 8), new THREE.MeshStandardMaterial({ color: '#b07a44', roughness: 0.7 }));
    handleM.position.y = 4.4;
    const blade = new THREE.Mesh(new THREE.BoxGeometry(2, 2.6, 0.3), new THREE.MeshStandardMaterial({ color: '#2f6fd6', roughness: 0.5 }));
    blade.position.y = 0.9;
    spat.add(handleM, blade);
    const mp = panAt(0, 0);
    spat.position.set(mp.x + 2, top - 0.4, mp.z + 1);
    spat.rotation.set(0.25, 0, -0.5);
    spat.traverse((o) => (o.castShadow = true));
    cold.add(spat);
    // Cups made ahead live in the two clear pans.
    cold.add(this.spares);
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
    // The mascarpone's tools. The spatula: blue blade, wooden handle up to your hand, and what's on it.
    {
      const wood = new THREE.MeshStandardMaterial({ color: '#b07a44', roughness: 0.7 });
      const blade = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.35, 4.4), new THREE.MeshStandardMaterial({ color: '#2f6fd6', roughness: 0.5 }));
      blade.castShadow = true;
      this.spatBlob = new THREE.Mesh(new THREE.SphereGeometry(1.7, 14, 10), this.creamMat);
      this.spatBlob.castShadow = true;
      const armS = new THREE.Group();
      armS.position.set(1.2, 0.1, -1.6);
      armS.rotation.z = -0.34;
      const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, W.handle - 4, 10), wood);
      stick.position.y = (W.handle - 4) / 2;
      stick.castShadow = true;
      const fistS = new THREE.Mesh(new THREE.CapsuleGeometry(1.2, 2.2, 4, 10), new THREE.MeshStandardMaterial({ color: '#23262a', roughness: 0.7 }));
      fistS.position.y = W.handle - 6;
      fistS.castShadow = true;
      armS.add(stick, fistS);
      this.spatula.add(blade, this.spatBlob, armS);
      s.add(this.spatula);
      // The squeeze bottle, held upside down over the cup: nozzle at the bottom.
      const shellB = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 1.9, 7, 16), new THREE.MeshStandardMaterial({ color: '#ffffff', transparent: true, opacity: 0.55, roughness: 0.2 }));
      shellB.position.y = 6;
      const inB = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 5.4, 16), this.berryMat);
      inB.position.y = 5.4;
      const nozzle = new THREE.Mesh(new THREE.ConeGeometry(1.5, 2.6, 14), new THREE.MeshStandardMaterial({ color: '#f1f3f4', roughness: 0.3 }));
      nozzle.rotation.x = Math.PI;
      nozzle.position.y = 1.3;
      const fistB = new THREE.Mesh(new THREE.CapsuleGeometry(1.5, 2.4, 4, 10), new THREE.MeshStandardMaterial({ color: '#23262a', roughness: 0.7 }));
      fistB.rotation.z = Math.PI / 2;
      fistB.position.set(1.6, 6.4, 0);
      this.bottleFist = fistB;
      this.bottle.add(inB, shellB, nozzle, fistB);
      this.bottle.traverse((o) => (o.castShadow = true));
      s.add(this.bottle);
    }
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
    // Mascarpone goes down one side and the berry fills the other: two halves, then berry over the top.
    this.mCream = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 8), this.creamMat);
    this.mBerry = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 8), this.berryMat);
    this.mBerryTop = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 8), this.berryMat);
    this.mCream.visible = this.mBerry.visible = this.mBerryTop.visible = false;
    this.cupG.add(this.cupSauce, this.mCream, this.mBerry, this.mBerryTop, this.mMess, wall, cupRim, foot, this.cupLine, this.cupLid, caster);
    s.add(this.cupG);
    // The stream.
    this.stream = new THREE.Mesh(new THREE.CylinderGeometry(1, 0.7, 1, 10), this.sauceMat);
    this.stream.visible = false;
    s.add(this.stream);
    // The box the cup is for: the very box from the table, as it is right now (see showBox).
    this.boxG.position.set(W.box.x, 0, W.box.z);
    s.add(this.boxG);
    this.boxRavs = new RavMeshes(this.boxG);
  }

  isOpen() {
    return this.open;
  }

  show(sauce: Sauce) {
    this.sauce = sauce;
    this.open = true;
    this.root.hidden = false;
    if (!this.renderer) this.build();
    // The cold table is a bigger thing than the steam table: stand back a little for it.
    if (sauce === 'marinara') {
      this.cam.position.set(0, 33, 30);
      this.cam.lookAt(0, 0, -1.5);
    } else {
      this.cam.position.set(0, 52, 33);
      this.cam.lookAt(0, 5, -9);
    }
    this.size();
    // (At the cold table the live sauce in the pan is the ranch, whichever of the two you're cupping.)
    const color = SAUCE_COLORS[sauce === 'mascarpone' ? 'ranch' : sauce] ?? '#c8341d';
    this.sauceMat.color.set(color);
    // (The red reads hot under these lights: bring it down to cooked tomato.)
    if (sauce === 'marinara') this.sauceMat.color.multiplyScalar(0.8);
    this.sauceMat.roughness = sauce === 'marinara' ? 0.45 : 0.3;
    // Marinara's in the steam table, up off the counter; ranch is in the cold well, set into it.
    const hot = sauce === 'marinara';
    this.chunks.visible = hot;
    this.lidOpen = 0;
    this.leaving = 0;
    this.warmer.visible = hot;
    this.coldWell.visible = !hot;
    this.panTop = hot ? W.warmerH + 0.12 : W.cold.h - 0.45;
    // The pan you dip in: the whole steam table, or the ranch pan in the cold table.
    const live = hot ? W.pan : coldRanchPan();
    this.pan = sauce === 'mascarpone' ? coldMascPan() : live;
    // (The live sauce surface is always the steam table's marinara or the cold table's ranch.)
    this.panSauce.scale.set((live.x1 - live.x0) / (W.pan.x1 - W.pan.x0), (live.z1 - live.z0) / (W.pan.z1 - W.pan.z0), 1);
    this.panSauce.position.x = (live.x0 + live.x1) / 2;
    this.panSauce.position.z = (live.z0 + live.z1) / 2;
    this.mPhase = 'paste';
    this.paste = this.berry = this.mess = 0;
    this.mShown = '';
    this.panSauce.position.y = this.panTop;
    this.chunks.position.y = this.panTop - 0.22;
    this.dipY = this.panTop + 1.2;
    this.carryY = (hot ? W.warmerH : W.cold.h) + 5.4;
    this.aim = { x: hot ? 2 : 9, z: hot ? -2 : 5 };
    this.bowl = { x: this.aim.x, y: this.carryY, z: -2, vx: 0, vz: 0 };
    this.cup = { x: -6, z: hot ? 4 : 5 };
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
    void ref;
    this.shownBox = box;
    this.showBox();
    this.title.textContent = NAMES[sauce] ?? sauce.toUpperCase();
    this.stream.material = sauce === 'mascarpone' ? this.berryMat : this.sauceMat;
    requestAnimationFrame((t) => this.frame(t));
  }

  /**
   * The box this cup is for, exactly as it is on the table: its size, its liner, the name you
   * wrote on its lid, any cup already in it, and whatever ravs are in it.
   */
  private showBox() {
    const box = this.k.fillBox ?? this.shownBox;
    this.boxG.visible = !!box;
    // What's been cupped ahead, in its clear pan: layers of four, from the bottom up.
    const stock = (this.k.cupStock.mascarpone ?? 0) * 100 + (this.k.cupStock.ranch ?? 0);
    if (stock !== this.sparesShown) {
      this.sparesShown = stock;
      for (const c of [...this.spares.children]) {
        this.spares.remove(c);
        dispose(c);
      }
      const C = W.cold;
      (['mascarpone', 'ranch'] as const).forEach((sc, col) => {
        const n = this.k.cupStock[sc] ?? 0;
        const cx = (col - 1) * (C.s + C.gap);
        const cz = C.z1 - C.gap - C.s / 2;
        for (let i = 0; i < n; i++) {
          const cup = storedCup(sc);
          cup.position.set(cx + ((i % 2) - 0.5) * 5, 1.3 + Math.floor(i / 4) * 3.75, cz + ((Math.floor(i / 2) % 2) - 0.5) * 5);
          this.spares.add(cup);
        }
      });
    }
    if (!box) return;
    this.shownBox = box;
    const ink = LID_INK.get(box.id);
    const ref = this.k.itemFor(box);
    const label = ink || (box.labeled && ref) ? { name: ref?.order.name ?? '', order: ref ? lidOrder(ref.item) : '', ink } : undefined;
    const cupSlots = ref ? saucesFor(ref.item).length : 0;
    const key = `${box.id}|${box.size}|${box.sauces.join()}|${cupSlots}|${label ? label.name + label.order + (ink ? 'i' : '') : ''}`;
    const [w0, d0] = BOX_FOCUS.size[box.size ?? 'M'] ?? [2.1, 2.0];
    if (key !== this.boxKey) {
      this.boxKey = key;
      if (this.boxShell) {
        this.boxG.remove(this.boxShell);
        dispose(this.boxShell);
      }
      this.boxShell = clamshellModel(w0, 0.5, d0, { paper: !!box.wax, cups: box.sauces, cupSlots, bigCups: bigCupsFor(box.size, box.sauces), label, lidOpen: Math.PI * 0.6 });
      this.boxShell.traverse((o) => {
        o.castShadow = o.receiveShadow = true;
      });
      this.boxG.add(this.boxShell);
      this.boxG.scale.setScalar(Math.min(4.3, 9.6 / w0));
    }
    // What's in it, across its floor.
    this.boxRavs.begin();
    const cols = box.ravs.length > 6 ? 4 : 3;
    box.ravs.forEach((rv, i) => {
      const big = FLAVORS[rv.flavor].size > 1.2;
      const c = big ? 2 : cols;
      const m = this.boxRavs.get(rv);
      m.position.set(((i % c) - (c - 1) / 2) * w0 * (big ? 0.36 : 0.24), 0.14, (Math.floor(i / c) - 0.7) * d0 * (big ? 0.34 : 0.24));
      m.rotation.set(0.05, ((m.userData.yaw as number) ?? 0) * 0.6, 0);
      m.castShadow = true;
    });
    this.boxRavs.end();
  }

  close() {
    this.ladleId = this.cupId = null;
    // At the cold table the lid comes down first, then you've left.
    if (this.open && this.sauce !== 'marinara' && this.renderer && !this.leaving) {
      this.leaving = SAUCE.ladle.lidSeconds;
      return;
    }
    if (this.leaving > 0) return;
    this.open = false;
    this.root.hidden = true;
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
    if (this.leaving > 0) return;
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
      this.aim.z = Math.max(this.pan.z0 + 2, Math.min(15, this.aim.z + (p.y - this.lastTouch.y) * this.perPx.z * L.gain));
      this.lastTouch = { x: p.x, y: p.y };
    } else if (e.pointerId === this.cupId) {
      this.cup.x = Math.max(-13, Math.min(1, this.cup.x + (p.x - this.cupTouch.x) * this.perPx.x));
      this.cup.z = Math.max((this.sauce === 'marinara' ? W.pan.z1 : W.cold.z1) + 5, Math.min(11, this.cup.z + (p.y - this.cupTouch.y) * this.perPx.z));
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
    const p = this.pan;
    return x > p.x0 + 1 && x < p.x1 - 1 && z > p.z0 + 1 && z < p.z1 - 1;
  }

  /** Advance by dt seconds (public so tests can drive it). */
  step(dt: number) {
    const L = SAUCE.ladle;
    const F = this.feel;
    const R = W.bowl;
    this.t += dt;
    // The lid: up as you arrive, down as you go.
    if (this.leaving > 0) {
      this.leaving -= dt;
      this.lidOpen = Math.max(0, this.lidOpen - dt / L.lidSeconds);
      if (this.leaving <= 0) {
        this.leaving = 0;
        this.open = false;
        this.root.hidden = true;
      }
      return;
    }
    this.lidOpen = Math.min(1, this.lidOpen + dt / L.lidSeconds);
    const busy = this.sealing > 0 || this.hop >= 0;
    const masc = this.sauce === 'mascarpone';
    // Coming toward you with something in the bowl, it stops at the cup's far edge.
    // (The berry bottle is always full: it settles there whenever it's brought over.)
    const stop = { x: this.cup.x, z: this.cup.z - R * 0.85 };
    if (!this.latch && !busy && (this.load > 0.02 || (masc && this.mPhase === 'berry')) && Math.hypot(this.aim.x - stop.x, this.aim.z - stop.z) < L.catch) {
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
    const over = !this.latch && !(masc && this.mPhase === 'berry') && this.inPan(this.bowl.x, this.bowl.z);
    const to = this.latch ? { x: stop.x, y: W.cup.h + R + 0.9, z: stop.z } : { x: this.aim.x, y: over ? this.dipY : this.carryY, z: this.aim.z };
    const k = 1 - Math.exp(-L.follow * dt);
    const ox = this.bowl.x;
    const oz = this.bowl.z;
    this.bowl.x += (to.x - this.bowl.x) * k;
    this.bowl.z += (to.z - this.bowl.z) * k;
    this.bowl.y += (to.y - this.bowl.y) * (1 - Math.exp(-14 * dt));
    this.bowl.vx = (this.bowl.x - ox) / Math.max(dt, 1e-3);
    this.bowl.vz = (this.bowl.z - oz) / Math.max(dt, 1e-3);
    if (masc) {
      this.stepMasc(dt, over, busy, stop);
      return;
    }
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
      this.sealedScore = this.fill;
      haptic(12);
      sfx.catch(4);
    }
    this.finishCup(dt);
    this.hint.textContent = this.latch
      ? this.tilt > 0.05
        ? 'ease back to stop on the line'
        : 'keep pulling toward you to pour'
      : this.load > 0.5
        ? 'pull it toward you, to the cup'
        : this.shownBox
          ? 'run the ladle through the pan'
          : 'cupping ahead · the ranch is back middle';
    this.count.textContent = this.made ? `+${this.made}` : '';
  }

  /** How high the mascarpone stands on its side of the cup, and the level of the whole cup (0..1). */
  private mLevels() {
    const M = SAUCE.mascarpone;
    const hp = this.paste / M.side;
    // (The mascarpone is thick: it stays on its side, and the berry fills the other.)
    const level = this.berry / (1 - M.side);
    return { hp, berryLevel: level, level };
  }

  /**
   * The mascarpone cup. Run the spatula through its pan to load it (linger and it's too much),
   * bring it to the cup and keep pulling to scrape it off down one side. Then the berry bottle is in
   * your hand: bring it over and pull to squeeze, into the space that's left, to the line.
   */
  private stepMasc(dt: number, over: boolean, busy: boolean, stop: { x: number; z: number }) {
    const M = SAUCE.mascarpone;
    const L = SAUCE.ladle;
    if (this.mPhase === 'paste') {
      // Through the pan: a good scoop is a quick pass; stay and it heaps up past what fits.
      if (over && this.bowl.y < this.dipY + 1.6 && !busy) {
        const was = this.load;
        // (Quick up to a good scoop, then it only creeps: you have to mean it to overload.)
        this.load = Math.min(M.scoopMax, this.load + (dt / M.scoopSeconds) * M.goodScoop * (this.load < M.goodScoop ? 1 : M.heapRate));
        if (was < M.goodScoop && this.load >= M.goodScoop) haptic(8);
      }
      // At the cup: scraped off against the edge. What doesn't fit ends up on the rim.
      if (this.latch && this.load > 0 && !busy) {
        const amt = Math.min(this.load, Math.pow(this.tilt, 1.2) * M.scrape * dt);
        this.load -= amt;
        const room = Math.max(0, M.side * M.pasteMax - this.paste);
        this.paste += Math.min(amt, room);
        this.mess += Math.max(0, amt - room);
        if (amt > 0 && Math.random() < dt * 12) sfx.rim();
      }
      if (this.load <= 0.001) this.load = 0;
      // Scraped clean with enough in there: the spatula goes back and the berry bottle is in your hand.
      if (this.load === 0 && this.latch && this.paste / M.side >= M.pasteOk[0]) {
        this.mPhase = 'berry';
        this.latch = null;
        this.tilt = 0;
        this.aim.z = stop.z - 5;
        this.aim.x = this.cup.x + 5;
        haptic(8);
        sfx.pull();
      }
    } else if (this.latch && !busy) {
      // Squeezing: the further you pull, the harder.
      const amt = Math.pow(this.tilt, 1.2) * M.squeeze * M.squeezeBoost * dt;
      this.rate = amt / Math.max(dt, 1e-3);
      if (amt > 0) {
        this.berry += amt;
        this.lastPour = this.t;
        const { berryLevel } = this.mLevels();
        if (berryLevel > M.overflow) {
          // Over the top: down the side, and onto the tab.
          const extra = berryLevel - M.overflow;
          this.berry -= extra;
          const a = Math.random() * Math.PI * 2;
          this.spill(extra, this.cup.x + Math.cos(a) * W.cup.rTop, W.cup.h, this.cup.z + Math.sin(a) * W.cup.rTop);
        }
      }
      // Eased off with berry in it: that's the cup. Half and half to the line with a clean rim is the good one.
      if (this.berry > 0.04 && this.tilt < 0.12 && this.t - this.lastPour > L.rest) {
        const { hp, level } = this.mLevels();
        const okPaste = hp >= M.pasteOk[0] && hp <= M.pasteOk[1] && this.mess < M.messOk;
        const okBerry = level >= M.levelOk[0] && level <= M.levelOk[1] && this.berry >= M.berryMin;
        const score = okPaste && okBerry ? 0.9 : okPaste || okBerry ? 0.75 : 0.5;
        if (score >= SAUCE.okMin) {
          this.sealing = 0.25;
          this.sealedFill = Math.min(1, Math.max(hp, level));
          this.sealedScore = score;
          haptic(12);
          sfx.catch(4);
        } else {
          this.k.say(this.mess >= M.messOk ? 'Mascarpone all over the rim: again' : level < M.levelOk[0] ? 'That cup’s half empty: again' : 'Not a cup yet: again');
          sfx.reject();
          this.mPhase = 'paste';
          this.paste = this.berry = this.mess = 0;
          this.latch = null;
          this.tilt = 0;
        }
      }
    } else this.rate = 0;
    this.drops(dt);
    const was = this.hop;
    this.finishCup(dt);
    if (was >= 0 && this.hop < 0) {
      // That one's away: a fresh cup, back to the spatula.
      this.mPhase = 'paste';
      this.paste = this.berry = this.mess = 0;
      this.latch = null;
      this.tilt = 0;
    }
    this.hint.textContent =
      this.mPhase === 'paste'
        ? this.latch
          ? 'keep pulling: scrape it off on the edge'
          : this.load > 0.05
            ? this.load > M.goodScoop * 1.3
              ? 'that’s a lot · to the cup'
              : 'to the cup'
            : 'run the spatula through the mascarpone'
        : this.latch
          ? this.tilt > 0.05
            ? 'ease back to stop on the line'
            : 'keep pulling to squeeze'
          : 'now the berry: bring the bottle to the cup';
    this.count.textContent = this.made ? `+${this.made}` : '';
  }

  /** The lid goes on, the cup hops to its box (or its pan in the cold table), and the kitchen hears about it. */
  private finishCup(dt: number) {
    if (this.sealing > 0) {
      this.sealing = Math.max(0, this.sealing - dt);
      if (this.sealing === 0) this.hop = 0;
    } else if (this.hop >= 0) {
      this.hop += dt / 0.4;
      if (this.hop >= 1) {
        this.hop = -1;
        this.fill = 0;
        this.made++;
        this.k.ladledCup(this.sauce, this.sealedScore);
      }
    }
  }

  /** Sauce that isn't going in the cup: it falls, it lands, and it's on the tab. */
  private spill(cups: number, x: number, y: number, z: number) {
    this.spilled += cups;
    const n = Math.min(5, Math.max(1, Math.round(cups * 40)));
    for (let i = 0; i < n && this.drips.length < 40; i++) {
      const mesh = new THREE.Mesh(DRIP, this.sauce === 'mascarpone' ? this.berryMat : this.sauceMat);
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
    this.showBox();
    // The lid swings up and back past upright, out of your way.
    const e = 1 - (1 - this.lidOpen) ** 3;
    this.coldLid.rotation.x = -2.3 * e;
    const R = W.bowl;
    const c = W.cup;
    // The ladle: swung over about the bowl's mouth, so your hand comes toward you as it tips.
    const angle = this.tilt * SAUCE.ladle.swing;
    this.ladle.position.set(this.bowl.x, this.bowl.y, this.bowl.z);
    this.ladle.rotation.x = angle;
    const masc = this.sauce === 'mascarpone';
    this.ladle.visible = !masc;
    this.spatula.visible = masc && this.mPhase === 'paste';
    this.bottle.visible = masc;
    this.restSpatula.visible = !this.spatula.visible;
    if (masc) {
      const M = SAUCE.mascarpone;
      // The spatula tips its far edge up as you scrape; the heap on it is as big as the scoop.
      this.spatula.position.set(this.bowl.x, this.bowl.y - R * 0.5, this.bowl.z);
      this.spatula.rotation.x = angle * 0.8;
      const k = this.load / M.goodScoop;
      this.spatBlob.visible = this.load > 0.01;
      this.spatBlob.scale.set(0.5 + 0.5 * Math.min(1.7, k), 0.3 + 0.5 * Math.min(1.9, k), 0.6 + 0.5 * Math.min(1.7, k));
      this.spatBlob.position.set(0, 0.3 + 0.5 * Math.min(1.9, k), 0.2);
      // The bottle hangs nozzle-down; squeezed, it pinches in.
      // Until it's wanted it stands on the counter by the cup, nozzle up.
      const held = this.mPhase === 'berry';
      this.bottleFist.visible = held;
      this.bottle.rotation.z = held ? 0 : Math.PI;
      if (held) this.bottle.position.set(this.bowl.x, this.bowl.y - R * 0.9, this.bowl.z + (this.latch ? R * 0.85 : 0));
      else this.bottle.position.set(this.cup.x - 7.5, 9.6, this.cup.z - 3);
      this.bottle.scale.set(1 - 0.18 * this.tilt, 1, 1 + 0.08 * this.tilt);
    }
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
    // Lidded, it goes into its box; or, cupping ahead, into the clear pan of ranch cups.
    const dest = this.shownBox ? { x: b.x - 2.4, y: b.h, z: b.z + 1.5 } : { x: masc ? -(W.cold.s + W.cold.gap) : 0, y: W.cold.h, z: W.cold.z1 - W.cold.gap - W.cold.s / 2 };
    this.cupG.position.set(this.cup.x + (dest.x - this.cup.x) * u, hopping ? Math.sin(u * Math.PI) * (this.shownBox ? 6 : 10) + dest.y * u : 0, this.cup.z + (dest.z - this.cup.z) * u);
    const lidded = this.sealing > 0 || hopping;
    const v = masc ? 0 : Math.min(1, lidded ? this.sealedFill : this.fill);
    if (masc) this.drawMasc();
    else if (this.mCream.visible || this.mBerry.visible || this.mBerryTop.visible || this.mMess.children.length) {
      this.mCream.visible = this.mBerry.visible = this.mBerryTop.visible = false;
      for (const ch of [...this.mMess.children]) this.mMess.remove(ch);
    }
    if (Math.abs(v - this.fillShown) > 0.004) {
      this.fillShown = v;
      this.cupSauce.visible = v > 0.01;
      if (v > 0.01) {
        this.cupSauce.geometry.dispose();
        this.cupSauce.geometry = new THREE.CylinderGeometry(c.rBot + (c.rTop - c.rBot) * v - 0.1, c.rBot - 0.1, c.h * v, 28);
        this.cupSauce.position.y = (c.h * v) / 2 + 0.05;
      }
    }
    const mLevel = masc ? this.mLevels().level : 0;
    const on = !lidded && (masc ? this.berry > 0.04 && mLevel >= SAUCE.mascarpone.levelOk[0] && mLevel <= SAUCE.mascarpone.levelOk[1] : this.fill >= SAUCE.perfect[0] && this.fill <= SAUCE.perfect[1]);
    const line = this.cupLine.material as THREE.MeshBasicMaterial;
    line.color.set(on ? '#3fd06a' : '#ffffff');
    this.cupLine.scale.setScalar(on ? 1.03 : 1);
    this.cupLine.visible = !lidded;
    this.cupLid.visible = lidded;
    this.cupLid.position.y = c.h + 0.15 + this.sealing * 12;
    // The stream: from the near lip of the bowl down to the sauce in the cup.
    const pouring = this.rate > 0.02 && !!this.latch && !(masc && this.mPhase === 'paste');
    this.stream.visible = pouring;
    if (pouring) {
      const from = masc ? new THREE.Vector3(this.bottle.position.x, this.bottle.position.y, this.bottle.position.z) : new THREE.Vector3(this.bowl.x, this.bowl.y - R * Math.sin(angle), this.bowl.z + R * Math.cos(angle));
      const to = masc ? new THREE.Vector3(this.cup.x + 1.2, c.h * Math.min(1, this.mLevels().berryLevel) * 0.9 + 0.1, this.cup.z) : new THREE.Vector3(this.cup.x, c.h * Math.min(1, this.fill) + 0.1, this.cup.z);
      const len = from.distanceTo(to);
      const wide = masc ? 0.3 + 0.25 * this.tilt : (0.18 + 0.5 * Math.min(1, this.rate / this.feel.flow)) * (this.sauce === 'marinara' ? 1.35 : 1) * (1 + this.feel.glug * 0.5 * Math.sin(this.t * 17));
      this.stream.position.copy(from).add(to).multiplyScalar(0.5);
      this.stream.scale.set(wide, len, wide);
      this.stream.quaternion.setFromUnitVectors(UP, from.sub(to).normalize());
    }
    r.render(this.scene, this.cam);
  }

  /** The mascarpone cup's insides: cream down the left, berry up the right, berry over the top, and any mess on the rim. */
  private drawMasc() {
    const c = W.cup;
    const { hp, berryLevel } = this.mLevels();
    const key = `${this.paste.toFixed(3)}|${this.berry.toFixed(3)}|${Math.floor(this.mess / 0.02)}`;
    if (key === this.mShown) return;
    this.mShown = key;
    const rad = (v: number) => c.rBot + (c.rTop - c.rBot) * v - 0.1;
    const half = (mesh: THREE.Mesh, v0: number, v1: number, start: number, len: number) => {
      mesh.visible = v1 - v0 > 0.01;
      if (!mesh.visible) return;
      mesh.geometry.dispose();
      mesh.geometry = new THREE.CylinderGeometry(rad(v1), rad(v0), c.h * (v1 - v0), 24, 1, false, start, len);
      mesh.position.y = c.h * (v0 + v1) / 2 + 0.05;
    };
    const top = Math.min(1.04, hp);
    // Cream on the left half, berry on the right.
    half(this.mCream, 0, top, Math.PI, Math.PI);
    half(this.mBerry, 0, Math.min(1.04, berryLevel), 0, Math.PI);
    this.mBerryTop.visible = false;
    // What didn't fit: dollops on the rim.
    const blobs = Math.min(6, Math.floor(this.mess / 0.02));
    while (this.mMess.children.length > blobs) this.mMess.remove(this.mMess.children[this.mMess.children.length - 1]!);
    while (this.mMess.children.length < blobs) {
      const i = this.mMess.children.length;
      const m = new THREE.Mesh(DRIP, this.creamMat);
      const a = Math.PI * (0.75 + i * 0.3);
      m.position.set(Math.cos(a) * c.rTop, c.h - (i % 2) * 0.9, Math.sin(a) * c.rTop);
      m.scale.set(0.7, 0.5 + (i % 2) * 0.5, 0.7);
      this.mMess.add(m);
    }
  }
}

/** The mascarpone pan in the cold table: back row, left. */
function coldMascPan() {
  const C = W.cold;
  const r = coldRanchPan();
  return { x0: r.x0 - C.s - C.gap, x1: r.x1 - C.s - C.gap, z0: r.z0, z1: r.z1 };
}

/** The ranch pan in the cold table: back row, middle. */
function coldRanchPan() {
  const C = W.cold;
  const z = C.z1 - C.gap * 2 - C.s * 1.5;
  return { x0: -C.s / 2, x1: C.s / 2, z0: z - C.s / 2, z1: z + C.s / 2 };
}

/** A lidded cup as it's kept in the cold table: clear, its sauce showing, a white rim and lid. */
function storedCup(sauce: Sauce) {
  const g = new THREE.Group();
  const color = sauce === 'mascarpone' ? '#fbeec0' : (SAUCE_COLORS[sauce] ?? '#f4f0e2');
  const body = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 1.8, 3.4, 14), new THREE.MeshStandardMaterial({ color, roughness: 0.4 }));
  body.position.y = 1.7;
  if (sauce === 'mascarpone') {
    // Half and half: the berry shows down one side.
    const berry = new THREE.Mesh(new THREE.CylinderGeometry(2.32, 1.82, 3.42, 14, 1, false, 0, Math.PI), new THREE.MeshStandardMaterial({ color: '#8e1f4a', roughness: 0.4 }));
    berry.position.y = 1.7;
    g.add(berry);
  }
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 0.25, 16), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.2, transparent: true, opacity: 0.85 }));
  lid.position.y = 3.5;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(2.5, 0.14, 6, 18), new THREE.MeshBasicMaterial({ color: '#2a1d12' }));
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 3.55;
  g.add(body, lid, rim);
  g.traverse((o) => (o.castShadow = true));
  return g;
}

const tapes = new Map<string, THREE.CanvasTexture>();
/** A strip of tape with a name on it in marker. */
function tapeLabel(name: string) {
  let t = tapes.get(name);
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const x = c.getContext('2d');
  if (x) {
    x.fillStyle = '#fffdf2';
    x.fillRect(6, 10, 500, 108);
    x.strokeStyle = '#2a1d1233';
    x.lineWidth = 3;
    x.strokeRect(6, 10, 500, 108);
    x.fillStyle = '#1c1c1c';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.font = '900 78px "Marker Felt", "Comic Sans MS", system-ui, sans-serif';
    x.fillText(name, 256, 68, 470);
  }
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  tapes.set(name, t);
  return t;
}

const UP = new THREE.Vector3(0, 1, 0);
const DRIP = new THREE.SphereGeometry(1, 8, 6);
const STAIN = new THREE.CircleGeometry(1, 14);
