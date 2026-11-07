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

/** Wire fryer basket. Origin at the floor center. A long handle sticks out the back right. */
export function basketModel(w: number, wall: number, depth = 0.9) {
  const g = new THREE.Group();
  const wire = new THREE.MeshStandardMaterial({ color: '#e9edf0', metalness: 0.5, roughness: 0.3 });
  const t = 0.045;
  // Rim and floor frames.
  for (const y of [0, wall]) {
    g.add(box(w, t, t, wire, 0, y, depth / 2));
    g.add(box(w, t, t, wire, 0, y, -depth / 2));
    g.add(box(t, t, depth, wire, -w / 2, y, 0));
    g.add(box(t, t, depth, wire, w / 2, y, 0));
  }
  // Corner posts.
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(t, wall, t, wire, (sx * w) / 2, wall / 2, (sz * depth) / 2));
  // Mesh: thin lines on the front, back, sides and floor.
  const pts: number[] = [];
  const nx = 9;
  const ny = 3;
  for (let i = 1; i < nx; i++) {
    const x = -w / 2 + (w * i) / nx;
    for (const z of [depth / 2, -depth / 2]) pts.push(x, 0, z, x, wall, z);
    pts.push(x, 0, -depth / 2, x, 0, depth / 2);
  }
  for (let j = 1; j < ny; j++) {
    const y = (wall * j) / ny;
    for (const z of [depth / 2, -depth / 2]) pts.push(-w / 2, y, z, w / 2, y, z);
    for (const x of [-w / 2, w / 2]) pts.push(x, y, -depth / 2, x, y, depth / 2);
  }
  for (let k = 1; k < 4; k++) {
    const z = -depth / 2 + (depth * k) / 4;
    pts.push(-w / 2, 0, z, w / 2, 0, z);
  }
  const lines = new THREE.LineSegments(
    new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)),
    new THREE.LineBasicMaterial({ color: '#cfd5da' }),
  );
  g.add(lines);
  // Handle: up and out from the right rim, black grip.
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.9, 6), wire);
  rod.position.set(w / 2 + 0.3, wall + 0.25, -depth * 0.2);
  rod.rotation.z = -Math.PI / 3.2;
  g.add(rod);
  const grip = new THREE.Mesh(
    new THREE.CylinderGeometry(0.075, 0.075, 0.5, 8),
    new THREE.MeshStandardMaterial({ color: '#1d1d1f', roughness: 0.6 }),
  );
  grip.position.set(w / 2 + 0.68, wall + 0.5, -depth * 0.2);
  grip.rotation.z = -Math.PI / 3.2;
  g.add(grip);
  return g;
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
  const g = new THREE.Group();
  const wire = new THREE.MeshStandardMaterial({ color: '#e9edf0', metalness: 0.5, roughness: 0.3 });
  const t = 0.04;
  for (const y of [0, wall]) {
    g.add(box(w, t, t, wire, 0, y, d / 2));
    g.add(box(w, t, t, wire, 0, y, -d / 2));
    g.add(box(t, t, d, wire, -w / 2, y, 0));
    g.add(box(t, t, d, wire, w / 2, y, 0));
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(t, wall, t, wire, (sx * w) / 2, wall / 2, (sz * d) / 2));
  const pts: number[] = [];
  for (let i = 1; i < 4; i++) {
    const x = -w / 2 + (w * i) / 4;
    pts.push(x, 0, -d / 2, x, 0, d / 2);
  }
  for (let k = 1; k < 10; k++) {
    const z = -d / 2 + (d * k) / 10;
    pts.push(-w / 2, 0, z, w / 2, 0, z);
    for (const x of [-w / 2, w / 2]) pts.push(x, 0, z, x, wall, z);
  }
  g.add(
    new THREE.LineSegments(
      new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)),
      new THREE.LineBasicMaterial({ color: '#cfd5da' }),
    ),
  );
  // Hook on the far end: hooks over the fryer's top bar so the basket hangs out of the oil.
  const hookUp = box(0.035, 0.32, 0.035, wire, 0, wall + 0.16, -d / 2);
  const hookOver = box(0.035, 0.035, 0.16, wire, 0, wall + 0.32, -d / 2 - 0.08);
  const hookDown = box(0.035, 0.1, 0.035, wire, 0, wall + 0.27, -d / 2 - 0.16);
  g.add(hookUp, hookOver, hookDown);
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.7, 6), wire);
  rod.rotation.x = Math.PI / 2 - 0.5;
  rod.position.set(0, wall + 0.12, d / 2 + 0.3);
  g.add(rod);
  const grip = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07, 0.07, 0.5, 8),
    new THREE.MeshStandardMaterial({ color: '#1d1d1f', roughness: 0.6 }),
  );
  grip.rotation.x = Math.PI / 2 - 0.5;
  grip.position.set(0, wall + 0.36, d / 2 + 0.78);
  g.add(grip);
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

/** A stainless mixing bowl, the salt bowl at the pass. */
export function bowlModel() {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    pts.push(new THREE.Vector2(0.15 + Math.sin((t * Math.PI) / 2) * 1.05, -0.5 + (1 - Math.cos((t * Math.PI) / 2)) * 0.62));
  }
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: '#d6dbe0', metalness: 0.7, roughness: 0.22, side: THREE.DoubleSide });
  g.add(new THREE.Mesh(new THREE.LatheGeometry(pts, 24), steel));
  const rim = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.045, 6, 32), steel);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.12;
  g.add(rim);
  // A little salt in the bottom.
  const salt = new THREE.Mesh(new THREE.CircleGeometry(0.5, 16), new THREE.MeshStandardMaterial({ color: '#f4f4f0', roughness: 1 }));
  salt.rotation.x = -Math.PI / 2;
  salt.position.y = -0.47;
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

/** A black portion cup with sauce and a clear lid. Origin at its bottom center. */
export function cupModel(sauce: string, r = 0.17) {
  const g = new THREE.Group();
  const black = new THREE.MeshStandardMaterial({ color: '#1b1b1d', roughness: 0.5, flatShading: true });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.8, r * 0.95, 10), black);
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
  /** Sharpied on the lid. */
  label?: { name: string; order: string };
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
  const t = 0.08;
  g.add(placed(foamSlab(w, t, depth), 0, t / 2, 0));
  // Walls: back and sides full height, front low. Chamfered corners make it read rounded.
  const back = foamSlab(w - 0.2, wall, t);
  back.position.set(0, wall / 2, -depth / 2);
  g.add(back);
  const front = foamSlab(w - 0.2, wall * 0.45, t);
  front.position.set(0, wall * 0.225, depth / 2);
  g.add(front);
  for (const sx of [-1, 1]) {
    const side = foamSlab(t, wall, depth - 0.2);
    side.position.set((sx * w) / 2, wall / 2, 0);
    g.add(side);
    for (const sz of [-1, 1]) {
      const h = sz > 0 ? wall * 0.45 : wall;
      const corner = foamSlab(0.17, h, t, FOAM_SHADE);
      corner.position.set(sx * (w / 2 - 0.06), h / 2, sz * (depth / 2 - 0.06));
      corner.rotation.y = sx * sz * (Math.PI / 4);
      g.add(corner);
    }
  }
  // The lip around the top of the tray.
  const lip = foamSlab(w + 0.06, 0.05, 0.1, FOAM_SHADE);
  lip.position.set(0, wall, -depth / 2);
  g.add(lip);
  // Lid, hinged at the back: tray-shaped, with the raised square panel on top.
  const hinge = new THREE.Group();
  hinge.position.set(0, wall, -depth / 2);
  hinge.rotation.x = -(opts.lidOpen ?? Math.PI * 0.62);
  const lid = new THREE.Group();
  lid.add(placed(foamSlab(w, t, depth), 0, 0, depth / 2));
  const rim = foamSlab(w, wall * 0.5, t, FOAM_SHADE);
  rim.position.set(0, -wall * 0.25, depth);
  lid.add(rim);
  const panel = foamSlab(w * 0.7, 0.07, depth * 0.66);
  panel.position.set(0, 0.07, depth / 2 + 0.02);
  lid.add(panel);
  if (opts.label) {
    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(w * 0.7, depth * 0.66),
      new THREE.MeshBasicMaterial({ map: lidLabel(opts.label.name, opts.label.order), transparent: true }),
    );
    // On the face you can see with the lid open (it's on the outside on the line; readable beats real).
    label.rotation.x = Math.PI / 2;
    label.position.set(0, -0.042, depth / 2 + 0.02);
    lid.add(label);
  }
  hinge.add(lid);
  g.add(hinge);
  // Wax paper: a slightly crooked checkerboard sheet.
  if (opts.paper) {
    const paper = new THREE.Mesh(
      new THREE.PlaneGeometry(w * 0.86, depth * 0.9),
      new THREE.MeshStandardMaterial({ map: checker(), roughness: 0.7, side: THREE.DoubleSide }),
    );
    paper.rotation.set(-Math.PI / 2, 0, 0.06);
    paper.position.y = t + 0.012;
    g.add(paper);
  }
  // Sauce cups in the front corners (the first one front left, like the line does it).
  (opts.cups ?? []).forEach((s, i) => {
    const cup = cupModel(s, Math.min(0.2, w * 0.1));
    cup.position.set((i === 0 ? -1 : 1) * (w / 2 - 0.3), t, depth / 2 - 0.3);
    g.add(cup);
  });
  return g;
}
