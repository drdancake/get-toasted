// The tickets, drawn in the scene instead of over it: between the fryers and everything in your
// hands, so a flying rav passes in front of the paper. The HUD still lays them out (and animates
// them) as hidden DOM cards; this paints each one where its card is.
import * as THREE from 'three';
import { FLAVORS, type FlavorId } from '../config/flavors';

export interface TicketLine {
  size: number;
  what: string;
  tints: string[];
  mod?: string;
  dotted: boolean;
  done: boolean;
}

export interface TicketPaint {
  id: number;
  /** Top-left of the card on screen, CSS px, and its width. */
  x: number;
  y: number;
  w: number;
  /** Type scale (1 on a phone). */
  u: number;
  name: string;
  /** A red band under the name (a remake). */
  flag?: string;
  lines: TicketLine[];
  /** Patience left, 1 to 0. */
  left: number;
}

const PAPER = '#fbfaf5';
const INK = '#1c1c1c';
const FONT = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const PATIENCE = { ok: '#3a9a4a', warm: '#e9a23b', urgent: '#d8362a' };

interface Sheet {
  mesh: THREE.Mesh;
  bar: THREE.Mesh;
  shade: THREE.Mesh;
  canvas: HTMLCanvasElement;
  tex: THREE.CanvasTexture;
  key: string;
  h: number;
}

/** Where the build card is taped up: its top left corner and width, CSS px, and the type scale. */
export interface CardSpot {
  x: number;
  y: number;
  w: number;
  u: number;
  /** The flavors on the menu (the card only lists those). */
  menu: FlavorId[];
}

/** The build card: which sauce goes with which rav. Laminated, taped to the wall, as short as it can be. */
export const BUILD_CARD: { flavors: FlavorId[]; sauce: string }[] = [
  { flavors: ['beef', 'cheese', 'mozz'], sauce: 'MARINARA' },
  { flavors: ['buffalo'], sauce: 'RANCH' },
  { flavors: ['gooey'], sauce: 'MASCARPONE' },
];

export class TicketLayer {
  visible = true;
  private card: { mesh: THREE.Mesh; canvas: HTMLCanvasElement; tex: THREE.CanvasTexture; key: string; h: number } | null = null;

  /** Tape the build card to the wall (or take it down with null). The tickets hang in front of it. */
  setCard(spot: CardSpot | null) {
    if (!spot) {
      if (this.card) this.card.mesh.visible = false;
      return;
    }
    if (!this.card) {
      const canvas = document.createElement('canvas');
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      const mesh = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({ map: tex, depthTest: false, depthWrite: false, toneMapped: false, transparent: true }));
      mesh.renderOrder = -1;
      this.scene.add(mesh);
      this.card = { mesh, canvas, tex, key: '', h: 0 };
    }
    const c = this.card;
    const key = `${spot.w}|${spot.u}|${spot.menu.length}`;
    if (key !== c.key) {
      c.key = key;
      c.h = paintCard(c.canvas, spot);
      c.tex.dispose();
      c.tex.needsUpdate = true;
    }
    c.mesh.visible = true;
    c.mesh.position.set(spot.x, -spot.y, 0);
    c.mesh.scale.set(spot.w, c.h, 1);
  }
  private scene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(0, 1, 0, -1, -10, 10);
  private geo = new THREE.PlaneGeometry(1, 1).translate(0.5, -0.5, 0);
  private sheets = new Map<number, Sheet>();

  sync(list: TicketPaint[]) {
    const live = new Set(list.map((t) => t.id));
    for (const [id, s] of this.sheets) {
      if (live.has(id)) continue;
      this.scene.remove(s.mesh, s.bar, s.shade);
      s.tex.dispose();
      for (const m of [s.mesh, s.bar, s.shade]) (m.material as THREE.Material).dispose();
      this.sheets.delete(id);
    }
    for (const t of list) {
      let s = this.sheets.get(t.id);
      if (!s) {
        const canvas = document.createElement('canvas');
        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        const flat = { depthTest: false, depthWrite: false, toneMapped: false, transparent: true };
        const mesh = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({ map: tex, ...flat }));
        const bar = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({ color: PATIENCE.ok, ...flat }));
        const shade = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({ color: '#000000', opacity: 0.28, ...flat }));
        shade.renderOrder = 0;
        mesh.renderOrder = 1;
        bar.renderOrder = 2;
        this.scene.add(shade, mesh, bar);
        s = { mesh, bar, shade, canvas, tex, key: '', h: 0 };
        this.sheets.set(t.id, s);
      }
      const key = `${t.w}|${t.u}|${t.flag ?? ''}|${t.lines.map((l) => `${+l.dotted}${+l.done}`).join('')}`;
      if (key !== s.key) {
        s.key = key;
        const was = `${s.canvas.width}x${s.canvas.height}`;
        s.h = paint(s.canvas, t);
        // A texture can't change size once it's on the GPU: drop it and it's made again at the new one.
        if (was !== `${s.canvas.width}x${s.canvas.height}`) s.tex.dispose();
        s.tex.needsUpdate = true;
      }
      const urgent = t.left < 0.3;
      // An urgent ticket twitches on the rail.
      const y = t.y + (urgent ? Math.sin(performance.now() / 80) * 1.5 : 0);
      s.mesh.position.set(t.x, -y, 0);
      s.mesh.scale.set(t.w, s.h, 1);
      s.shade.position.set(t.x + 1.5, -y - 3, 0);
      s.shade.scale.set(t.w, s.h - 4, 1);
      s.bar.position.set(t.x, -y, 0);
      s.bar.scale.set(Math.max(0.001, t.w * t.left), 5 * t.u, 1);
      (s.bar.material as THREE.MeshBasicMaterial).color.set(urgent ? PATIENCE.urgent : t.left < 0.55 ? PATIENCE.warm : PATIENCE.ok);
    }
  }

  /** Draw over what's already on the canvas (the fryers), before the hands layer goes on top. */
  render(renderer: THREE.WebGLRenderer) {
    if (!this.visible || (this.sheets.size === 0 && !this.card?.mesh.visible)) return;
    const el = renderer.domElement;
    this.cam.right = el.clientWidth;
    this.cam.bottom = -el.clientHeight;
    this.cam.updateProjectionMatrix();
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(this.scene, this.cam);
    renderer.autoClear = auto;
  }
}

/** Paint the build card; returns its height in CSS px. */
function paintCard(canvas: HTMLCanvasElement, s: CardSpot): number {
  const u = s.u;
  const row = 11 * u;
  const pad = 5 * u;
  const lines = BUILD_CARD.map((l) => ({ ...l, flavors: l.flavors.filter((f) => s.menu.includes(f)) })).filter((l) => l.flavors.length);
  const h = Math.ceil(pad * 2 + row * lines.length);
  const dpr = 3;
  canvas.width = Math.ceil(s.w * dpr);
  canvas.height = Math.ceil(h * dpr);
  const c = canvas.getContext('2d')!;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, s.w, h);
  // Laminate: off-white with a sheen edge, a strip of blue tape top and bottom.
  c.fillStyle = '#fffdf4';
  c.beginPath();
  c.roundRect(1, 1, s.w - 2, h - 2, 3 * u);
  c.fill();
  c.strokeStyle = '#1c1c1c40';
  c.lineWidth = 1;
  c.stroke();
  c.fillStyle = '#3f8fd0cc';
  c.fillRect(s.w / 2 - 7 * u, 0, 14 * u, 3.5 * u);
  c.textBaseline = 'middle';
  lines.forEach((line, i) => {
    const y = pad + row * (i + 0.5) + 1;
    let x = pad + 3.5 * u;
    // The flavor's dot (the same dot as on the tickets), then the sauce it goes out with.
    for (const f of line.flavors) {
      c.fillStyle = FLAVORS[f].tint;
      c.beginPath();
      c.arc(x, y, 3.3 * u, 0, Math.PI * 2);
      c.fill();
      x += 8 * u;
    }
    x = pad + 27 * u;
    c.fillStyle = INK;
    c.font = `900 ${7.2 * u}px ${FONT}`;
    c.fillText(line.sauce, x, y, s.w - x - 3);
  });
  return h;
}

/** Paint one receipt; returns its height in CSS px. */
function paint(canvas: HTMLCanvasElement, t: TicketPaint): number {
  const u = t.u;
  const rowH = 12 * u;
  const modH = 8 * u;
  const top = 7 * u;
  const flagH = t.flag ? 10 * u : 0;
  const nameH = 12.5 * u + 2 + flagH;
  const tooth = 4.5;
  const h = Math.ceil(top + nameH + t.lines.reduce((n, l) => n + rowH + (l.mod ? modH : 0), 0) + 5 + tooth);
  const dpr = 2;
  canvas.width = Math.ceil(t.w * dpr);
  canvas.height = Math.ceil(h * dpr);
  const c = canvas.getContext('2d')!;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, t.w, h);
  // The paper, torn along the bottom.
  c.fillStyle = PAPER;
  c.beginPath();
  c.moveTo(0, 0);
  c.lineTo(t.w, 0);
  c.lineTo(t.w, h - tooth);
  const teeth = Math.max(2, Math.round(t.w / 9));
  for (let i = teeth; i > 0; i--) {
    c.lineTo(((i - 0.5) * t.w) / teeth, h);
    c.lineTo(((i - 1) * t.w) / teeth, h - tooth);
  }
  c.closePath();
  c.fill();
  const padL = 8;
  c.textBaseline = 'middle';
  c.fillStyle = INK;
  c.font = `900 ${10 * u}px ${FONT}`;
  spaced(c, 0.6);
  c.fillText(t.name, padL, top + 6 * u, t.w - padL - 3);
  c.strokeStyle = '#1c1c1c55';
  c.lineWidth = 1;
  c.setLineDash([3, 2]);
  c.beginPath();
  c.moveTo(padL, top + 12.5 * u);
  c.lineTo(t.w - 3, top + 12.5 * u);
  c.stroke();
  c.setLineDash([]);
  if (t.flag) {
    c.fillStyle = '#c2281c';
    c.fillRect(3, top + 13.5 * u + 1, t.w - 6, flagH - 2);
    c.fillStyle = '#fff';
    c.font = `900 ${7 * u}px ${FONT}`;
    spaced(c, 0.3);
    c.fillText(t.flag, 6, top + 13.5 * u + flagH / 2 + 0.5, t.w - 12);
  }
  let y = top + nameH;
  for (const l of t.lines) {
    const mid = y + rowH / 2;
    c.globalAlpha = l.done ? 0.35 : 1;
    // The flavor stripe (a split shows both).
    const sh = 10 * u;
    c.fillStyle = l.tints[0] ?? INK;
    c.fillRect(padL, mid - sh / 2, 3 * u, sh / 2);
    c.fillStyle = l.tints[l.tints.length - 1] ?? INK;
    c.fillRect(padL, mid, 3 * u, sh / 2);
    c.fillStyle = INK;
    c.font = `700 ${12 * u}px ${FONT}`;
    spaced(c, -0.5);
    const sx = padL + 6 * u;
    const size = String(l.size);
    c.fillText(size, sx, mid + 0.5);
    const sw = c.measureText(size).width;
    c.font = `700 ${9.5 * u}px ${FONT}`;
    const wx = sx + sw + 3 * u;
    const room = t.w - wx - 2;
    c.fillText(l.what, wx, mid + 0.5, room);
    if (l.done) {
      c.strokeStyle = INK;
      c.lineWidth = Math.max(1, u);
      c.beginPath();
      c.moveTo(sx, mid);
      c.lineTo(Math.min(t.w - 2, wx + Math.min(room, c.measureText(l.what).width)), mid);
      c.stroke();
    }
    // Dropped: the Sharpie dot in the margin, a little lopsided like a real one.
    if (l.dotted) {
      c.fillStyle = '#111';
      c.beginPath();
      c.ellipse(padL - 0.5 * u, mid, 4.8 * u, 4.3 * u, -0.2, 0, Math.PI * 2);
      c.fill();
    }
    c.globalAlpha = 1;
    y += rowH;
    if (l.mod) {
      c.fillStyle = '#c2281c';
      c.font = `900 ${7.5 * u}px ${FONT}`;
      spaced(c, 0);
      c.fillText(l.mod, padL + 6 * u, y + modH / 2 - 1, t.w - padL - 6 * u - 2);
      y += modH;
    }
  }
  return h;
}

function spaced(c: CanvasRenderingContext2D, px: number) {
  (c as unknown as { letterSpacing: string }).letterSpacing = `${px}px`;
}
