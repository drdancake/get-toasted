import * as THREE from 'three';
import { DONENESS_RAMP } from '../config/look';

// Procedural low-poly stand-ins for Taj's models. Everything here is built from
// primitives in code so it weighs nothing; swap any of it for a GLB later.

/** Deterministic hash so shared vertices on face seams move together (no cracks). */
function hash3(x: number, y: number, z: number) {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * A toasted ravioli: a square pillow with a domed middle, a thin flat flange
 * and a crimped (zigzag) cut edge. Unit size: 1 across. Vertex colors carry
 * the breadcrumb speckle; tint it with the material color for doneness.
 */
export function ravGeometry(variant: number) {
  const seg = 10;
  const g = new THREE.BoxGeometry(1, 0.3, 1, seg, 1, seg);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const colors: number[] = [];
  const v = variant * 3.17;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const s = Math.max(Math.abs(x), Math.abs(z)) / 0.5; // 0 center, 1 cut edge
    const top = y > 0;
    let ny: number;
    let nx = x;
    let nz = z;
    if (s > 0.79) {
      ny = y * 0.32; // flange
      if (s > 0.99) {
        // Crimp: alternate cut-edge vertices in and out.
        const t = Math.abs(x) >= Math.abs(z) ? z : x;
        const k = Math.round((t + 0.5) * seg);
        const push = k % 2 === 0 ? 1.05 : 0.97;
        if (Math.abs(x) >= Math.abs(z)) nx *= push;
        if (Math.abs(z) >= Math.abs(x)) nz *= push;
      }
    } else {
      const dome = 1 - (s / 0.79) ** 2;
      ny = top ? y * (0.55 + 1.5 * dome) : y * (0.5 + 0.5 * dome);
    }
    const j = hash3(x + v, y, z);
    nx += (hash3(z, x + v, y) - 0.5) * 0.035;
    nz += (hash3(y, z, x + v) - 0.5) * 0.035;
    ny += (j - 0.5) * 0.03 * (top ? 1 : 0.3);
    pos.setXYZ(i, nx, ny, nz);
    const c = 0.78 + j * 0.3; // breadcrumb speckle
    colors.push(c, c * 0.97, c * 0.92);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
}

/** Doneness 0..1 to the ramp color. */
const RAMP = DONENESS_RAMP.map((s) => ({ at: s.at, color: new THREE.Color(s.color) }));
export function rampColor(d: number, out = new THREE.Color()) {
  for (let i = 1; i < RAMP.length; i++) {
    const a = RAMP[i - 1];
    const b = RAMP[i];
    if (!a || !b) continue;
    if (d <= b.at || i === RAMP.length - 1) {
      const t = THREE.MathUtils.clamp((d - a.at) / Math.max(b.at - a.at, 1e-6), 0, 1);
      return out.copy(a.color).lerp(b.color, t);
    }
  }
  return out.copy(RAMP[0]?.color ?? new THREE.Color('#fff'));
}

const steel = () => new THREE.MeshStandardMaterial({ color: '#c4cad0', metalness: 0.35, roughness: 0.32 });

function box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

/** Wire fryer basket, side view: long along x, handle out the right (+x), hooks at the left. Origin at the floor center. */
export function basketModel(w: number, wall: number, depth = 0.9) {
  return fryerBasket(w, depth, wall);
}

/** Styrofoam clamshell with wax paper (the low-poly one). Origin at the floor center. */
export function boxModel(w: number, wall: number, depth = 1.1) {
  return clamshellModel(w, wall, depth, { paper: true });
}

/** Text on a canvas, for labels. */
function labelTexture(text: string, bg: string, fg: string) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 96;
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 256, 96);
    ctx.fillStyle = fg;
    ctx.font = '900 46px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 128, 50);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** The Ziploc bag of frozen ravs. Origin at the bottom center. */
export function bagModel(label: string, ravGeo: THREE.BufferGeometry, tint = '#d33b2c') {
  const g = new THREE.Group();
  const w = 1.3;
  const h = 1.15;
  const d = 0.7;
  const inside = new THREE.MeshStandardMaterial({ color: '#f3ead6', vertexColors: true, flatShading: true, roughness: 0.85 });
  const spots: [number, number, number, number][] = [
    [-0.3, 0.15, 0.05, 0.4],
    [0.25, 0.14, -0.1, -0.6],
    [0, 0.32, 0.1, 1.2],
    [-0.15, 0.5, -0.05, 2.2],
    [0.3, 0.45, 0.12, -1.6],
  ];
  for (const [x, y, z, r] of spots) {
    const m = new THREE.Mesh(ravGeo, inside);
    m.scale.setScalar(0.46);
    m.position.set(x, y, z);
    m.rotation.set(r * 0.4, r, r * 0.3);
    g.add(m);
  }
  const plastic = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d, 2, 2, 1),
    new THREE.MeshStandardMaterial({ color: '#eaf4ff', transparent: true, opacity: 0.32, roughness: 0.15, metalness: 0 }),
  );
  plastic.position.y = h / 2;
  g.add(plastic);
  g.add(box(w * 1.02, 0.08, d * 1.02, new THREE.MeshStandardMaterial({ color: tint, roughness: 0.5 }), 0, h, 0));
  const tag = new THREE.Mesh(
    new THREE.PlaneGeometry(w * 0.8, w * 0.3),
    new THREE.MeshBasicMaterial({ map: labelTexture(label, '#ffffff', tint), transparent: true }),
  );
  tag.position.set(0, h * 0.72, d / 2 + 0.01);
  g.add(tag);
  return g;
}

/** The fryer vat between two x positions, oil surface at oilY. Returns the group and the oil material. */
export function fryerModel(left: number, right: number, oilY: number, bottomY: number) {
  const g = new THREE.Group();
  const w = right - left;
  const cx = (left + right) / 2;
  const depth = 2.2;
  const zc = -0.3;
  const s = steel();
  const h = oilY - bottomY;
  // Back and sides stand a little above the oil; the front lip sits at the oil line.
  g.add(box(w + 0.3, h + 0.7, 0.15, s, cx, bottomY + (h + 0.7) / 2, zc - depth / 2));
  g.add(box(0.15, h + 0.5, depth, s, left - 0.08, bottomY + (h + 0.5) / 2, zc));
  g.add(box(0.15, h + 0.5, depth, s, right + 0.08, bottomY + (h + 0.5) / 2, zc));
  const front = box(w + 0.3, h + 0.02, 0.15, steel(), cx, bottomY + h / 2, zc + depth / 2);
  (front.material as THREE.MeshStandardMaterial).color.set('#aeb5bb');
  g.add(front);
  // A darker panel line and a control knob row on the front, for read.
  g.add(box(w * 0.9, 0.05, 0.02, new THREE.MeshStandardMaterial({ color: '#6c737a' }), cx, bottomY + h * 0.35, zc + depth / 2 + 0.08));
  for (const kx of [-0.33, 0.33]) {
    const knob = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.12, 0.08, 10),
      new THREE.MeshStandardMaterial({ color: '#222', roughness: 0.5 }),
    );
    knob.rotation.x = Math.PI / 2;
    knob.position.set(cx + kx * w, bottomY + h * 0.18, zc + depth / 2 + 0.1);
    g.add(knob);
  }
  const oilMat = new THREE.MeshStandardMaterial({
    color: '#8a4d0f',
    emissive: '#3a1a02',
    roughness: 0.08,
    metalness: 0.1,
    transparent: true,
    opacity: 0.45,
  });
  const oil = new THREE.Mesh(new THREE.PlaneGeometry(w, depth), oilMat);
  oil.rotation.x = -Math.PI / 2;
  oil.position.set(cx, oilY, zc);
  g.add(oil);
  // Dark oil body under the surface.
  const deep = box(w, h * 0.6, depth * 0.95, new THREE.MeshStandardMaterial({ color: '#2b1503', roughness: 0.3 }), cx, bottomY + h * 0.3, zc);
  g.add(deep);
  return { group: g, oil: oilMat };
}

/** Counter slab and the cabinet below it. */
export function counterModel(left: number, right: number, topY: number, bottomY: number) {
  const g = new THREE.Group();
  const w = right - left + 2;
  const cx = (left + right) / 2;
  g.add(box(w, 0.25, 2.4, steel(), cx, topY - 0.125, -0.1));
  const cab = box(w, topY - bottomY, 0.2, new THREE.MeshStandardMaterial({ color: '#9aa1a7', metalness: 0.3, roughness: 0.4 }), cx, (topY + bottomY) / 2 - 0.125, 1.0);
  g.add(cab);
  return g;
}

/** Kitchen wall: green subway tile with grout lines, so cream and gold ravs pop against it. */
export function wallModel(width: number, height: number, cy: number) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#1d3d35';
    ctx.fillRect(0, 0, 256, 256);
    const tw = 64;
    const th = 32;
    for (let row = 0; row < 8; row++) {
      const off = row % 2 ? tw / 2 : 0;
      for (let col = -1; col < 5; col++) {
        const x = col * tw + off + 2;
        const y = row * th + 2;
        const grad = ctx.createLinearGradient(x, y, x, y + th);
        grad.addColorStop(0, '#3f7d6c');
        grad.addColorStop(1, '#2e6457');
        ctx.fillStyle = grad;
        ctx.fillRect(x, y, tw - 4, th - 4);
      }
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(width / 2.4, height / 2.4);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45 }));
  m.position.set(0, cy, -1.6);
  return m;
}


/**
 * Fryer basket seen from above, going in long-ways: narrow across (x), long
 * front to back (z), handle sticking out toward the viewer (+z). Origin at the
 * floor center.
 */
export function longBasketModel(w: number, d: number, wall: number) {
  // The same basket turned to point at you: handle toward the viewer (+z), hooks at the back.
  const g = new THREE.Group();
  const b = fryerBasket(d, w, wall);
  b.rotation.y = -Math.PI / 2;
  g.add(b);
  return g;
}

/** Heights of the back panel's hanger bars above the oil. */
export const HANG_BAR_TOP = 1.1;
export const HANG_BAR_LOW = 0.72;

/** One fryer of the bank, oil surface at y = 0, two slots wide. Returns the group and its oil material. */
export function fryerUnit(w: number, d: number, temp: number, hot: boolean) {
  const g = new THREE.Group();
  const s = steel();
  const rim = 0.14;
  g.add(box(w + rim * 2, 0.12, rim, s, 0, 0.02, -d / 2 - rim / 2));
  g.add(box(w + rim * 2, 0.12, rim, s, 0, 0.02, d / 2 + rim / 2));
  g.add(box(rim, 0.12, d, s, -w / 2 - rim / 2, 0.02, 0));
  g.add(box(rim, 0.12, d, s, w / 2 + rim / 2, 0.02, 0));
  // Divider between the two baskets.
  g.add(box(0.04, 0.05, d, new THREE.MeshStandardMaterial({ color: '#9aa1a7', metalness: 0.4, roughness: 0.4 }), 0, -0.02, 0));
  const oil = new THREE.MeshStandardMaterial({
    color: hot ? '#a5541a' : '#8a4d0f',
    emissive: hot ? '#4a1c04' : '#3a1a02',
    roughness: 0.08,
    metalness: 0.1,
    transparent: true,
    opacity: 0.5,
  });
  const surf = new THREE.Mesh(new THREE.PlaneGeometry(w, d), oil);
  surf.rotation.x = -Math.PI / 2;
  g.add(surf);
  const deep = box(w, 0.6, d, new THREE.MeshStandardMaterial({ color: '#2b1503', roughness: 0.3 }), 0, -0.65, 0);
  g.add(deep);
  // Back panel with two hanger bars: baskets hook on the top bar and rest on the lower one.
  const panelH = 1.5;
  g.add(box(w + rim * 2, panelH, 0.08, s, 0, panelH / 2, -d / 2 - rim - 0.04));
  const bar = new THREE.MeshStandardMaterial({ color: '#d9dee2', metalness: 0.6, roughness: 0.25 });
  for (const y of [HANG_BAR_TOP, HANG_BAR_LOW]) {
    const rodBar = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, w * 0.92, 8), bar);
    rodBar.rotation.z = Math.PI / 2;
    rodBar.position.set(0, y, -d / 2 - rim + 0.06);
    g.add(rodBar);
  }
  // Front panel with the temperature plate.
  const front = box(w + rim * 2, 1.6, 0.1, new THREE.MeshStandardMaterial({ color: '#aeb5bb', metalness: 0.35, roughness: 0.35 }), 0, -0.8, d / 2 + rim);
  g.add(front);
  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(0.9, 0.34),
    new THREE.MeshBasicMaterial({ map: labelTexture(`${temp}°`, hot ? '#b5372b' : '#26302f', '#ffffff') }),
  );
  plate.position.set(0, -0.32, d / 2 + rim + 0.06);
  g.add(plate);
  return { group: g, oil };
}

/** Freezer interior: frosty back wall, a wire shelf for the bags, a floor. */
export function freezerModel(width: number, shelfY: number, floorY: number, topY: number) {
  const g = new THREE.Group();
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d');
  if (ctx) {
    const grad = ctx.createLinearGradient(0, 0, 0, 128);
    grad.addColorStop(0, '#dfeef6');
    grad.addColorStop(1, '#b9d3e2');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = '#a8c4d4';
    ctx.lineWidth = 2;
    for (let x = 0; x <= 128; x += 32) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 128);
      ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  const h = topY - floorY + 6;
  tex.repeat.set(width / 2, h / 2);
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(width * 2, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }));
  wall.position.set(0, (topY + floorY) / 2, -1.6);
  g.add(wall);
  const wire = new THREE.MeshStandardMaterial({ color: '#d7dde2', metalness: 0.5, roughness: 0.35 });
  g.add(box(width * 1.2, 0.06, 1.6, wire, 0, shelfY - 0.03, -0.3));
  for (let i = -6; i <= 6; i++) g.add(box(0.03, 0.03, 1.6, wire, i * 0.55, shelfY, -0.3));
  g.add(box(width * 1.2, 0.3, 2.6, new THREE.MeshStandardMaterial({ color: '#c3ccd2', metalness: 0.3, roughness: 0.5 }), 0, floorY - 0.15, -0.2));
  return g;
}

/**
 * The chest freezer that swings open across the bottom of the fryer screen: a white enamel box with a
 * frosty inside, the bags sitting on its floor, and a lid hinged at the back (userData.lid: rotate it
 * on x from 0, shut, to about -1.9, standing open). Origin: the middle of its floor.
 */
export function chestFreezerModel(width: number, frontH: number, bottom: number) {
  const g = new THREE.Group();
  const enamel = new THREE.MeshStandardMaterial({ color: '#eef2f4', roughness: 0.35, metalness: 0.1 });
  const frost = new THREE.MeshStandardMaterial({ color: '#cfe6f2', roughness: 0.9, emissive: '#2a4a5a', emissiveIntensity: 0.25 });
  const trim = new THREE.MeshStandardMaterial({ color: '#9aa6ad', metalness: 0.6, roughness: 0.3 });
  const depth = 2.2;
  // The inside: frosty floor and back wall.
  g.add(box(width, 0.06, depth, frost, 0, -0.03, -0.4));
  g.add(box(width, frontH + 0.6, 0.08, frost, 0, (frontH + 0.6) / 2, -0.4 - depth / 2));
  // The front: a white enamel wall up to just under the bags' middles, down past the screen's bottom.
  const fh = frontH - bottom;
  g.add(box(width, fh, 0.14, enamel, 0, bottom + fh / 2, 0.75));
  g.add(box(width, 0.07, 0.2, trim, 0, frontH, 0.75));
  // A frosty glow along the top of the front lip, and a handle.
  g.add(box(width * 0.3, 0.09, 0.08, trim, 0, frontH - 0.35, 0.84));
  // The lid, hinged along the back top edge.
  const hinge = new THREE.Group();
  hinge.position.set(0, frontH + 0.6, -0.4 - depth / 2);
  const lid = box(width, 0.16, depth + 1.2, enamel, 0, 0.08, (depth + 1.2) / 2);
  hinge.add(lid);
  hinge.add(box(width * 0.3, 0.09, 0.08, trim, 0, 0.2, depth + 1.1));
  g.add(hinge);
  g.userData.lid = hinge;
  return g;
}

/** A stainless mixing bowl, the salt bowl at the pass. */
/**
 * The profile of a big round restaurant mixing bowl: a small flat foot, then a deep round belly up to
 * the rim (a slice of a squashed sphere). r is the rim radius, depth the height, foot the base radius.
 */
export function mixingBowlProfile(r: number, depth: number, foot = r * 0.32, y0 = 0) {
  const pts: THREE.Vector2[] = [new THREE.Vector2(0, y0), new THREE.Vector2(foot * 0.9, y0)];
  // A quarter of a squashed circle from the foot out to the rim.
  const a0 = Math.asin(Math.min(0.99, foot / r));
  const c0 = Math.cos(a0);
  for (let i = 0; i <= 16; i++) {
    const a = a0 + ((Math.PI / 2 - a0) * i) / 16;
    pts.push(new THREE.Vector2(Math.sin(a) * r, y0 + ((c0 - Math.cos(a)) / c0) * depth));
  }
  return pts;
}

/** The steel rolled rim on a bowl. */
export function bowlRim(r: number, y: number, mat: THREE.Material) {
  const rim = new THREE.Mesh(new THREE.TorusGeometry(r, 0.05, 8, 48), mat);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = y;
  return rim;
}

export const BOWL_STEEL = new THREE.MeshStandardMaterial({ color: '#d9dee3', metalness: 0.8, roughness: 0.18, side: THREE.DoubleSide });

/** The salt bowl on the bench: a big round steel mixing bowl. */
export function bowlModel() {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.LatheGeometry(mixingBowlProfile(1.2, 0.95, 0.42, -0.6), 40), BOWL_STEEL));
  g.add(bowlRim(1.2, 0.35, BOWL_STEEL));
  // A little salt in the bottom.
  const salt = new THREE.Mesh(new THREE.CircleGeometry(0.4, 16), new THREE.MeshStandardMaterial({ color: '#f4f4f0', roughness: 1 }));
  salt.rotation.x = -Math.PI / 2;
  salt.position.y = -0.58;
  g.add(salt);
  return g;
}

// ---------- The styrofoam clamshell, low poly like the ravs ----------

const FOAM = new THREE.MeshStandardMaterial({ color: '#fbf8f0', roughness: 0.95, flatShading: true });
const FOAM_SHADE = new THREE.MeshStandardMaterial({ color: '#ece7da', roughness: 0.95, flatShading: true });

/** A foam slab: a box with a few segments and a little jitter so it catches light in facets. */
function foamSlab(w: number, h: number, d: number, mat = FOAM) {
  const g = new THREE.BoxGeometry(w, h, d, 3, 1, 3);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const j = (hash3(x * 7 + w, y * 7, z * 7 + d) - 0.5) * 0.03;
    p.setXYZ(i, x + j, y + j * 0.5, z - j);
  }
  g.computeVertexNormals();
  return new THREE.Mesh(g, mat);
}

/** A mesh moved into place. */
function placed(m: THREE.Mesh, x: number, y: number, z: number) {
  m.position.set(x, y, z);
  return m;
}

let checkerTex: THREE.CanvasTexture | null = null;
/** Checkerboard wax paper. */
function checker() {
  if (checkerTex) return checkerTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#f3efe4';
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = '#2d2d2f';
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if ((x + y) % 2) ctx.fillRect(x * 32, y * 32, 32, 32);
  }
  checkerTex = new THREE.CanvasTexture(c);
  checkerTex.colorSpace = THREE.SRGBColorSpace;
  checkerTex.magFilter = THREE.NearestFilter;
  return checkerTex;
}

/** Sauce colors in the cups: marinara red, ranch cream, lemon berry mascarpone with its swirl. */
export const SAUCE_COLORS: Record<string, string> = { marinara: '#c8341d', ranch: '#f4f0e2', mascarpone: '#e9c9d9' };

/**
 * A portion cup with sauce and a clear lid. Origin at its bottom center. Two sizes, like the line:
 * the big black cup (10s, 3 gooey) and the small clear one you can see the sauce through.
 */
export function cupModel(sauce: string, r = 0.17, big = true) {
  const g = new THREE.Group();
  const shell = big
    ? new THREE.MeshStandardMaterial({ color: '#1b1b1d', roughness: 0.5, flatShading: true })
    : new THREE.MeshStandardMaterial({ color: SAUCE_COLORS[sauce] ?? '#c8341d', roughness: 0.25, flatShading: true, transparent: true, opacity: 0.85 });
  if (!big) r *= 0.78;
  const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.8, r * 0.95, 10), shell);
  body.position.y = r * 0.48;
  g.add(body);
  const top = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.92, r * 0.92, 0.02, 10), new THREE.MeshStandardMaterial({ color: SAUCE_COLORS[sauce] ?? '#c8341d', roughness: 0.4, flatShading: true }));
  top.position.y = r * 0.9;
  g.add(top);
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.04, r * 1.04, 0.025, 10), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.1, transparent: true, opacity: 0.35 }));
  lid.position.y = r * 1.0;
  g.add(lid);
  return g;
}

/** The order in Sharpie, the way it goes on the lid: the name top left, the order top right. */
function lidLabel(name: string, order: string) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#121214';
    ctx.font = '700 56px "Marker Felt", "Comic Sans MS", "Chalkboard SE", cursive';
    ctx.textBaseline = 'top';
    ctx.save();
    ctx.translate(20, 26);
    ctx.rotate(-0.05);
    ctx.fillText(name, 0, 0);
    ctx.restore();
    ctx.font = '700 44px "Marker Felt", "Comic Sans MS", "Chalkboard SE", cursive';
    ctx.textAlign = 'right';
    order.split('\n').forEach((line, i) => ctx.fillText(line, 240, 104 + i * 48));
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export interface ClamshellOpts {
  /** Lined with checkerboard wax paper. */
  paper?: boolean;
  /** Sauce cups set in the front corners. */
  cups?: string[];
  /** The big black cups (a 10, or 3 gooey) instead of the small clear ones. */
  bigCups?: boolean;
  /** Sharpied on the outside of the lid: the player's own ink if there is any, else typed. */
  label?: { name: string; order: string; ink?: HTMLCanvasElement };
  /** The small burger-style box: taller, with stepped ridges on the lid (default: by width). */
  small?: boolean;
  /** How far the lid is open (radians from closed). */
  lidOpen?: number;
}

/**
 * A styrofoam clamshell: tray with a low front wall (so you can see what's in it), a lip, and a
 * hinged lid with the raised square panel. Faceted and a little lumpy, like the ravs. Origin at the
 * floor center.
 */
export function clamshellModel(w: number, wall: number, depth = 1.1, opts: ClamshellOpts = {}) {
  const g = new THREE.Group();
  const small = opts.small ?? w < 1.6;
  // The tray: tapered walls (narrower at the floor), rounded corners, a lip round the top.
  const r = Math.min(w, depth) * 0.16;
  const th = small ? wall * 1.1 : wall;
  g.add(new THREE.Mesh(foamFrustum(w * 0.84, depth * 0.84, w, depth, th, r, true), FOAM_SIDE));
  g.add(placed(new THREE.Mesh(foamFrustum(w, depth, w + 0.1, depth + 0.1, 0.005, r, false), FOAM_SHADE_SIDE), 0, th, 0));
  // Lid, hinged at the back: a shallow dome with a latch tab at the front (medium and large),
  // or a tall stepped dome (small, ridges on top).
  const hinge = new THREE.Group();
  hinge.position.set(0, th, -depth / 2);
  hinge.rotation.x = -(opts.lidOpen ?? Math.PI * 0.62);
  const lid = new THREE.Group();
  const lw = w + 0.1;
  const ld = depth + 0.1;
  const lh = small ? th * 0.95 : th * 0.42;
  lid.add(placed(new THREE.Mesh(foamFrustum(lw, ld, lw * 0.9, ld * 0.9, lh, r * 1.1, true, true), FOAM_SIDE), 0, 0, depth / 2));
  if (small) {
    // The ridges: two stepped tiers on top.
    lid.add(placed(new THREE.Mesh(foamFrustum(lw * 0.78, ld * 0.78, lw * 0.68, ld * 0.68, lh * 0.22, r * 0.8, false, true), FOAM), 0, lh, depth / 2));
    lid.add(placed(new THREE.Mesh(foamFrustum(lw * 0.56, ld * 0.56, lw * 0.46, ld * 0.46, lh * 0.18, r * 0.6, false, true), FOAM), 0, lh * 1.22, depth / 2));
  } else {
    // The latch tab at the front edge.
    lid.add(placed(foamSlab(0.32, 0.03, 0.14, FOAM_SHADE), 0, -0.01, depth + 0.1));
  }
  if (opts.label) {
    // On top of the closed lid, reading from the front: you see it when you shut the box.
    const ink = opts.label.ink;
    const map = ink ? new THREE.CanvasTexture(ink) : lidLabel(opts.label.name, opts.label.order);
    map.colorSpace = THREE.SRGBColorSpace;
    const top = small ? lh * 1.42 : lh;
    const k = small ? 0.5 : 0.78;
    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(lw * k, ld * k * (ink ? 0.92 : 0.8)),
      new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false }),
    );
    label.rotation.x = -Math.PI / 2;
    label.position.set(0, top + 0.006, depth / 2);
    lid.add(label);
  }
  hinge.add(lid);
  g.add(hinge);
  g.userData.hinge = hinge;
  const t = 0.02;
  // Wax paper: a slightly crooked checkerboard sheet.
  if (opts.paper) {
    const paper = new THREE.Mesh(
      new THREE.PlaneGeometry(w * 0.74, depth * 0.76),
      new THREE.MeshStandardMaterial({ map: checker(), roughness: 0.7, side: THREE.DoubleSide }),
    );
    paper.rotation.set(-Math.PI / 2, 0, 0.04);
    paper.position.y = t + 0.025;
    g.add(paper);
  }
  // Sauce cups in the front corners: the first front right, by the single rav (the 3 / 2 / 1 + cup layout).
  (opts.cups ?? []).forEach((s, i) => {
    const cup = cupModel(s, Math.min(0.2, w * 0.1), opts.bigCups ?? true);
    cup.position.set((i === 0 ? 1 : -1) * (w / 2 - 0.32), t, depth / 2 - 0.32);
    g.add(cup);
  });
  return g;
}

const FOAM_SIDE = new THREE.MeshStandardMaterial({ color: '#fbf8f0', roughness: 0.95, flatShading: true, side: THREE.DoubleSide });
const FOAM_SHADE_SIDE = new THREE.MeshStandardMaterial({ color: '#ece7da', roughness: 0.95, flatShading: true, side: THREE.DoubleSide });

/** A rounded-rectangle outline (x, z), counterclockwise, a few points per corner. */
function roundedRect(w: number, d: number, r: number, seg = 3) {
  const pts: [number, number][] = [];
  const cs: [number, number, number][] = [
    [w / 2 - r, d / 2 - r, 0],
    [-w / 2 + r, d / 2 - r, Math.PI / 2],
    [-w / 2 + r, -d / 2 + r, Math.PI],
    [w / 2 - r, -d / 2 + r, (Math.PI * 3) / 2],
  ];
  for (const [cx, cz, a0] of cs) for (let i = 0; i <= seg; i++) {
    const a = a0 + (i / seg) * (Math.PI / 2);
    pts.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
  }
  return pts;
}

/**
 * Foam walls between a rounded rectangle at the bottom (wb x db) and one at the top (wt x dt), h
 * apart, with an optional cap: the floor (or, flipped, the lid's top). Faceted, like the ravs.
 */
function foamFrustum(wb: number, db: number, wt: number, dt: number, h: number, r: number, cap: boolean, capTop = false) {
  const lo = roundedRect(wb, db, Math.min(r, wb / 2, db / 2));
  const hi = roundedRect(wt, dt, Math.min(r, wt / 2, dt / 2));
  const pos: number[] = [];
  const n = lo.length;
  for (let i = 0; i < n; i++) {
    const a = lo[i] ?? [0, 0];
    const b = lo[(i + 1) % n] ?? [0, 0];
    const c = hi[i] ?? [0, 0];
    const d = hi[(i + 1) % n] ?? [0, 0];
    pos.push(a[0], 0, a[1], b[0], 0, b[1], d[0], h, d[1], a[0], 0, a[1], d[0], h, d[1], c[0], h, c[1]);
  }
  if (cap) {
    const ring = capTop ? hi : lo;
    const y = capTop ? h : 0;
    for (let i = 0; i < n; i++) {
      const a = ring[i] ?? [0, 0];
      const b = ring[(i + 1) % n] ?? [0, 0];
      pos.push(0, y, 0, b[0], y, b[1], a[0], y, a[1]);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}

// ---------- The real fryer basket ----------

let meshTex: THREE.CanvasTexture | null = null;
/** Fine square wire mesh, as an alpha texture (you see the ravs and the oil through it). */
function wireMesh() {
  if (meshTex) return meshTex;
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, 32, 32);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 32, 5);
    ctx.fillRect(0, 0, 5, 32);
  }
  meshTex = new THREE.CanvasTexture(c);
  meshTex.wrapS = meshTex.wrapT = THREE.RepeatWrapping;
  meshTex.anisotropy = 4;
  return meshTex;
}

/** Steel the oil has been at: a little warm, a little brassy. */
const BASKET_STEEL = new THREE.MeshStandardMaterial({ color: '#d8d0bd', metalness: 0.65, roughness: 0.32 });
const BASKET_GRIP = new THREE.MeshStandardMaterial({ color: '#21b3a0', roughness: 0.45 });

/** A rod between two points. */
function rod(a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material) {
  const len = a.distanceTo(b);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 6), mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return m;
}

/**
 * The fryer basket off the line (see Dan's photos): long and narrow with tall walls, fine square
 * mesh, a heavier rim, the front (handle) end raked back at the bottom, two hooks up off the back
 * end for the bar, and a long handle: four rods running out nearly level from the front rim into a
 * flat teal loop grip. Long along x (L), wide along z (W), wall high along y. Origin at the floor
 * center; handle out the +x end, hooks at the -x end.
 */
export function fryerBasket(L: number, W: number, wall: number) {
  const g = new THREE.Group();
  const cell = 0.07;
  // Walls read as one surface (a faint steel veil with fine wire), not as a second outline: from
  // above, crisp wire on tall walls looked like two baskets nested.
  const panel = (w: number, h: number, floor = false) => {
    const g2 = new THREE.Group();
    const tex = wireMesh().clone();
    tex.needsUpdate = true;
    tex.repeat.set(Math.max(1, w / cell), Math.max(1, h / cell));
    g2.add(
      new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshStandardMaterial({ color: floor ? '#8c8576' : '#cfc8b6', metalness: 0.5, roughness: 0.4, alphaMap: tex, transparent: true, opacity: floor ? 0.55 : 0.32, alphaTest: 0.3, side: THREE.DoubleSide, depthWrite: false }),
      ),
    );
    if (!floor) g2.add(new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ color: '#c9c3b4', metalness: 0.4, roughness: 0.5, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false })));
    return g2;
  };
  const hx = L / 2;
  const hz = W / 2;
  // The front end rakes back toward the bottom.
  const rake = Math.min(0.18, wall * 0.25);
  // No wire on the floor: seen from above, a floor grid under the rim reads as a second basket.
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(L - rake, W), new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.1, depthWrite: false }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(-rake / 2, 0.01, 0);
  g.add(floor);
  // Sides: a trapezoid of mesh (the raked front corner cut off).
  for (const sz of [-1, 1]) {
    const shape = new THREE.Shape();
    shape.moveTo(-hx, 0);
    shape.lineTo(hx - rake, 0);
    shape.lineTo(hx, wall);
    shape.lineTo(-hx, wall);
    shape.closePath();
    const geo = new THREE.ShapeGeometry(shape);
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getX(i) + hx) / cell, pos.getY(i) / cell);
    const tex = wireMesh().clone();
    tex.needsUpdate = true;
    const side = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: '#cfc8b6', metalness: 0.5, roughness: 0.4, alphaMap: tex, transparent: true, opacity: 0.32, alphaTest: 0.3, side: THREE.DoubleSide, depthWrite: false }));
    side.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: '#c9c3b4', metalness: 0.4, roughness: 0.5, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false })));
    side.position.z = (sz * W) / 2;
    g.add(side);
  }
  const back = panel(W, wall);
  back.rotation.y = Math.PI / 2;
  back.position.set(-hx, wall / 2, 0);
  g.add(back);
  const front = panel(W, Math.hypot(wall, rake));
  front.rotation.set(0, Math.PI / 2, 0);
  front.rotateX(-Math.atan2(rake, wall));
  front.position.set(hx - rake / 2, wall / 2, 0);
  g.add(front);
  // Frame: heavy rim at the top, lighter wire round the bottom, posts at the corners.
  const c = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const fx = hx - rake;
  for (const z of [-hz, hz]) {
    g.add(rod(c(-hx, wall, z), c(hx, wall, z), 0.028, BASKET_STEEL));
    g.add(rod(c(-hx, 0, z), c(-hx, wall, z), 0.016, BASKET_STEEL));
    g.add(rod(c(fx, 0, z), c(hx, wall, z), 0.016, BASKET_STEEL));
  }
  g.add(rod(c(-hx, wall, -hz), c(-hx, wall, hz), 0.028, BASKET_STEEL));
  g.add(rod(c(hx, wall, -hz), c(hx, wall, hz), 0.028, BASKET_STEEL));
  // Two hooks standing up off the back end: a bracket that goes over the fryer's bar.
  for (const sz of [-0.3, 0.3]) {
    const z = sz * W;
    g.add(rod(c(-hx, wall, z), c(-hx, wall + 0.26, z), 0.015, BASKET_STEEL));
    g.add(rod(c(-hx, wall + 0.26, z), c(-hx - 0.1, wall + 0.26, z), 0.015, BASKET_STEEL));
    g.add(rod(c(-hx - 0.1, wall + 0.26, z), c(-hx - 0.1, wall + 0.17, z), 0.015, BASKET_STEEL));
  }
  g.add(rod(c(-hx, wall + 0.26, -0.3 * W), c(-hx, wall + 0.26, 0.3 * W), 0.015, BASKET_STEEL));
  // The handle: four rods out of the front rim, nearly level, gathering into a flat teal loop.
  const reach = L * 0.33;
  const lift = 0.06;
  const neck = c(hx + reach, wall + lift, 0);
  for (let i = 0; i < 4; i++) {
    const z = (i - 1.5) * 0.05;
    g.add(rod(c(hx, wall, z * 1.4), c(neck.x, neck.y, z * 0.7), 0.011, BASKET_STEEL));
  }
  const grip = new THREE.Group();
  grip.position.copy(neck);
  grip.rotation.z = lift / reach;
  const gl = L * 0.3;
  const gw = Math.min(0.24, W * 0.3);
  const tr = 0.03;
  // A solid collar where the rods go in, then the open loop.
  const collar = new THREE.Mesh(new THREE.BoxGeometry(gl * 0.3, 0.05, gw * 0.7), BASKET_GRIP);
  collar.position.x = gl * 0.15;
  grip.add(collar);
  for (const sz of [-1, 1]) {
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(tr, tr, gl * 0.7, 6), BASKET_GRIP);
    bar.rotation.z = Math.PI / 2;
    bar.position.set(gl * 0.3 + gl * 0.35, 0, (sz * gw) / 2);
    grip.add(bar);
  }
  const end = new THREE.Mesh(new THREE.TorusGeometry(gw / 2, tr, 6, 10, Math.PI), BASKET_GRIP);
  end.rotation.set(Math.PI / 2, 0, -Math.PI / 2);
  end.position.x = gl;
  grip.add(end);
  g.add(grip);
  return g;
}

// ---------- Supplies on the table (real objects, not buttons) ----------

/** A leaning stack of closed clamshells, the way they come out of the sleeve. */
export function boxStackModel(w: number, d: number, n = 9) {
  // The way they sit on the line: open clamshells nested into each other in a tall tower, lids
  // flopped back, each one a hair off from the one under it.
  const g = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const b = clamshellModel(w, 0.32, d, { lidOpen: Math.PI * 0.98, small: false });
    b.position.set((i % 3) * 0.012 - 0.012, i * 0.07, (i % 2) * 0.012);
    b.rotation.y = ((i % 3) - 1) * 0.015;
    g.add(b);
  }
  return g;
}

/** A messy pile of checkerboard wax paper sheets. */
export function waxPileModel(size: number, n = 14) {
  // A clear acrylic holder with the checkerboard sheets standing in it, leaning back a little.
  const g = new THREE.Group();
  const acrylic = new THREE.MeshStandardMaterial({ color: '#dfe9ee', roughness: 0.1, transparent: true, opacity: 0.28, side: THREE.DoubleSide });
  const hw = size * 0.55;
  const hh = size * 0.62;
  const hd = 0.28;
  const back = new THREE.Mesh(new THREE.PlaneGeometry(hw * 2, hh), acrylic);
  back.position.set(0, hh / 2, -hd / 2);
  g.add(back);
  const front = new THREE.Mesh(new THREE.PlaneGeometry(hw * 2, hh * 0.55), acrylic);
  front.position.set(0, hh * 0.275, hd / 2);
  g.add(front);
  for (const sx of [-1, 1]) {
    const side = new THREE.Mesh(new THREE.PlaneGeometry(hd, hh), acrylic);
    side.rotation.y = Math.PI / 2;
    side.position.set(sx * hw, hh / 2, 0);
    g.add(side);
  }
  for (let i = 0; i < n; i++) {
    const sheet = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshStandardMaterial({ map: checker(), roughness: 0.7, side: THREE.DoubleSide }));
    sheet.rotation.set(-0.22 - i * 0.004, 0, ((i % 3) - 1) * 0.02);
    sheet.position.set(((i % 2) - 0.5) * 0.02, size / 2 + 0.02, -hd / 2 + 0.03 + (i / n) * (hd - 0.06));
    g.add(sheet);
  }
  return g;
}

/** A little huddle of lidded portion cups of one sauce. */
export function cupClusterModel(sauce: string) {
  const g = new THREE.Group();
  [
    [-0.24, 0, 0.1],
    [0.22, 0, 0.12],
    [0, 0, -0.16],
    [0.02, 0.17, 0.02],
  ].forEach(([x, y, z]) => {
    const c = cupModel(sauce, 0.2, false);
    c.position.set(x ?? 0, y ?? 0, z ?? 0);
    g.add(c);
  });
  return g;
}
