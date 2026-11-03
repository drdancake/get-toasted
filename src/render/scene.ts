import * as THREE from 'three';
import { FRYERS, SLOTS_PER_FRYER } from '../config/game';
import { LAYOUT } from '../config/layout';
import { DONENESS_RAMP, STATION } from '../config/look';
import { donenessAt } from '../game/doneness';
import type { Game } from '../game/game';
import type { Basket } from '../game/types';

const MAX_RAVS = 10;

/** Placeholder 3D station: fryer rows, cube ravs in wire baskets, the basket in hand. */
export class Station {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  private raycaster = new THREE.Raycaster();
  private ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  /** Rebuilt on resize: fryer bodies, oil, slot markers. */
  private fixtures = new THREE.Group();
  private oils: THREE.MeshStandardMaterial[] = [];
  private slotMarkers: THREE.MeshBasicMaterial[] = [];
  private slotPos: THREE.Vector3[] = [];
  private handPos = new THREE.Vector3();

  private slotBaskets: BasketView[] = [];
  private handBasket: BasketView;
  private ramp = DONENESS_RAMP.map((s) => ({ at: s.at, color: new THREE.Color(s.color) }));
  private tmp = new THREE.Color();

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.background = new THREE.Color(STATION.background);

    this.scene.add(new THREE.HemisphereLight(0xfff1d6, 0x2a1d12, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(-3, 10, 6);
    this.scene.add(key);
    this.scene.add(this.fixtures);

    for (let i = 0; i < FRYERS.length * SLOTS_PER_FRYER; i++) {
      const view = new BasketView();
      this.slotBaskets.push(view);
      this.scene.add(view.group);
    }
    this.handBasket = new BasketView();
    this.scene.add(this.handBasket.group);

    this.resize();
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    const halfW = LAYOUT.worldWidth / 2;
    const halfH = halfW * (h / w);
    Object.assign(this.camera, { left: -halfW, right: halfW, top: halfH, bottom: -halfH });
    const tilt = THREE.MathUtils.degToRad(LAYOUT.cameraTilt);
    this.camera.position.set(0, Math.cos(tilt) * 30, Math.sin(tilt) * 30);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    this.buildFixtures();
  }

  /** Ground point under screen position u, v (0..1, top-left origin). */
  groundAt(u: number, v: number) {
    this.raycaster.setFromCamera(new THREE.Vector2(u * 2 - 1, 1 - v * 2), this.camera);
    const p = new THREE.Vector3();
    this.raycaster.ray.intersectPlane(this.ground, p);
    return p;
  }

  private buildFixtures() {
    for (const child of [...this.fixtures.children]) {
      this.fixtures.remove(child);
      disposeTree(child);
    }
    this.oils = [];
    this.slotMarkers = [];
    this.slotPos = [];

    const { v0, v1 } = LAYOUT.fryers;
    const rowH = (v1 - v0) / FRYERS.length;
    for (let r = 0; r < FRYERS.length; r++) {
      const top = this.groundAt(0.5, v0 + r * rowH + rowH * 0.06);
      const bot = this.groundAt(0.5, v0 + (r + 1) * rowH - rowH * 0.06);
      const depth = Math.abs(bot.z - top.z);
      const cz = (top.z + bot.z) / 2;
      const width = LAYOUT.worldWidth * 0.94;

      const body = new THREE.Mesh(
        new THREE.BoxGeometry(width, 0.6, depth),
        new THREE.MeshStandardMaterial({ color: STATION.steel, metalness: 0.6, roughness: 0.35 }),
      );
      body.position.set(0, -0.35, cz);
      this.fixtures.add(body);

      const oilMat = new THREE.MeshStandardMaterial({ color: STATION.oil, roughness: 0.15, metalness: 0.1 });
      this.oils.push(oilMat);
      const oil = new THREE.Mesh(new THREE.PlaneGeometry(width * 0.92, depth * 0.8), oilMat);
      oil.rotation.x = -Math.PI / 2;
      oil.position.set(0, -0.04, cz);
      this.fixtures.add(oil);

      for (let s = 0; s < SLOTS_PER_FRYER; s++) {
        const u = LAYOUT.slotU[s] ?? 0.5;
        const p = this.groundAt(u, v0 + (r + 0.5) * rowH);
        this.slotPos.push(p);
        const mat = new THREE.MeshBasicMaterial({ color: STATION.slotOpen, transparent: true, opacity: 0 });
        this.slotMarkers.push(mat);
        const marker = new THREE.Mesh(new THREE.PlaneGeometry(LAYOUT.basket.w + 0.2, LAYOUT.basket.d + 0.2), mat);
        marker.rotation.x = -Math.PI / 2;
        marker.position.set(p.x, -0.02, p.z);
        this.fixtures.add(marker);
      }
    }

    const pv = (LAYOUT.pass.v0 + LAYOUT.pass.v1) / 2;
    this.handPos.copy(this.groundAt(LAYOUT.handU, pv));
  }

  render(game: Game, now: number) {
    const holdingRaw = !!game.hand && game.hand.pulledAs === null;

    this.oils.forEach((m, i) => {
      const shimmer = 0.5 + 0.5 * Math.sin(now * STATION.bobSpeed + i * 1.7);
      m.color.set(STATION.oil).lerp(this.tmp.set(STATION.oilHot), shimmer * 0.25);
    });

    game.slots.forEach((b, i) => {
      const view = this.slotBaskets[i];
      const pos = this.slotPos[i];
      if (!view || !pos) return;
      const marker = this.slotMarkers[i];
      if (marker) marker.opacity = holdingRaw && !b ? 0.25 + 0.15 * Math.sin(now * 6) : 0;
      if (!b) {
        view.group.visible = false;
        return;
      }
      const bob = Math.sin(now * STATION.bobSpeed + i) * STATION.bobHeight;
      view.show(b, this.colorFor(b), pos.x, -0.15 + bob, pos.z);
    });

    const hand = game.hand;
    if (hand) this.handBasket.show(hand, this.colorFor(hand), this.handPos.x, 0.3, this.handPos.z);
    else this.handBasket.group.visible = false;

    this.renderer.render(this.scene, this.camera);
  }

  private colorFor(b: Basket) {
    const d = donenessAt(b.cooked, b.flavor, b.fryer);
    const out = new THREE.Color();
    for (let i = 1; i < this.ramp.length; i++) {
      const a = this.ramp[i - 1];
      const c = this.ramp[i];
      if (!a || !c) continue;
      if (d <= c.at || i === this.ramp.length - 1) {
        const t = THREE.MathUtils.clamp((d - a.at) / Math.max(c.at - a.at, 1e-6), 0, 1);
        return out.copy(a.color).lerp(c.color, t);
      }
    }
    return out.copy(this.ramp[0]?.color ?? new THREE.Color('#fff'));
  }
}

class BasketView {
  group = new THREE.Group();
  private ravs: THREE.Mesh[] = [];
  private ravMats: THREE.MeshStandardMaterial[] = [];

  constructor() {
    const { w, d, h } = LAYOUT.basket;
    const wire = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d)),
      new THREE.LineBasicMaterial({ color: STATION.wire }),
    );
    wire.position.y = h / 2;
    this.group.add(wire);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(w, d),
      new THREE.MeshStandardMaterial({ color: STATION.steelDark, metalness: 0.5, roughness: 0.5 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.01;
    this.group.add(floor);

    const { size, gap, perRow } = LAYOUT.cube;
    const geo = new THREE.BoxGeometry(size, size * 0.55, size);
    const rows = Math.ceil(MAX_RAVS / perRow);
    for (let i = 0; i < MAX_RAVS; i++) {
      const mat = new THREE.MeshStandardMaterial({ roughness: 0.7 });
      const m = new THREE.Mesh(geo, mat);
      const col = i % perRow;
      const row = Math.floor(i / perRow);
      m.position.set((col - (perRow - 1) / 2) * gap, size * 0.3, (row - (rows - 1) / 2) * gap);
      this.ravs.push(m);
      this.ravMats.push(mat);
      this.group.add(m);
    }
    this.group.visible = false;
  }

  show(b: Basket, color: THREE.Color, x: number, y: number, z: number) {
    this.group.visible = true;
    this.group.position.set(x, y, z);
    this.ravs.forEach((m, i) => (m.visible = i < b.count));
    for (const mat of this.ravMats) mat.color.copy(color);
  }
}

function disposeTree(obj: THREE.Object3D) {
  obj.traverse((o) => {
    if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
      o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) m.dispose();
    }
  });
}
