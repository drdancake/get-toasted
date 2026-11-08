// Single-stroke handwriting: capitals, digits and "/", each a few pen strokes (SVG path data on a
// 100-unit cap height, y down, baseline at 100). It's what a person writes on a box with a Sharpie,
// so it can be traced with one line per stroke, and every name gets its own slight wobble.

/** [advance width, pen strokes]. Each "M" starts a new stroke. */
const GLYPHS: Record<string, [number, string]> = {
  A: [70, 'M3 100 L35 0 L67 100 M15 64 L55 64'],
  B: [60, 'M8 0 L8 100 M8 0 C58 0 58 48 10 48 C66 48 66 100 8 100'],
  C: [62, 'M58 18 C46 -6 6 -2 4 50 C4 102 48 106 60 82'],
  D: [64, 'M8 0 L8 100 M8 0 C70 0 70 100 8 100'],
  E: [52, 'M48 0 L8 0 L8 100 L50 100 M8 50 L40 50'],
  F: [50, 'M46 0 L8 0 L8 100 M8 48 L38 48'],
  G: [66, 'M58 16 C46 -6 4 -2 4 50 C4 104 60 106 62 56 L36 56'],
  H: [62, 'M8 0 L8 100 M54 0 L54 100 M8 50 L54 50'],
  I: [20, 'M10 0 L10 100'],
  J: [48, 'M42 0 L42 72 C42 104 6 106 4 78'],
  K: [58, 'M8 0 L8 100 M52 0 L10 58 M24 42 L54 100'],
  L: [48, 'M8 0 L8 100 L46 100'],
  M: [78, 'M6 100 L10 0 L39 64 L68 0 L72 100'],
  N: [64, 'M8 100 L8 0 L56 100 L56 0'],
  O: [70, 'M35 0 C-2 0 -2 100 35 100 C72 100 72 0 35 0'],
  P: [56, 'M8 100 L8 0 C62 0 62 54 8 52'],
  Q: [72, 'M35 0 C-2 0 -2 100 35 100 C72 100 72 0 35 0 M42 70 L68 104'],
  R: [58, 'M8 100 L8 0 C60 0 60 52 10 50 L54 100'],
  S: [56, 'M50 14 C40 -4 6 0 6 24 C6 50 52 46 52 74 C52 102 10 106 4 84'],
  T: [60, 'M2 0 L58 0 M30 0 L30 100'],
  U: [62, 'M6 0 L6 66 C6 106 56 106 56 66 L56 0'],
  V: [64, 'M2 0 L32 100 L62 0'],
  W: [86, 'M2 0 L20 100 L43 30 L66 100 L84 0'],
  X: [60, 'M4 0 L56 100 M56 0 L4 100'],
  Y: [60, 'M2 0 L30 52 L58 0 M30 52 L30 100'],
  Z: [58, 'M4 0 L54 0 L4 100 L56 100'],
  '0': [56, 'M28 0 C-2 0 -2 100 28 100 C58 100 58 0 28 0'],
  '1': [34, 'M6 18 L22 0 L22 100'],
  '2': [54, 'M6 22 C10 -6 50 -6 50 24 C50 50 6 72 4 100 L52 100'],
  '3': [54, 'M6 12 C20 -6 50 -2 48 24 C46 44 26 48 20 48 C52 48 54 74 50 84 C40 106 10 104 4 88'],
  '4': [58, 'M40 100 L40 0 L4 70 L56 70'],
  '5': [54, 'M48 0 L10 0 L6 44 C22 34 52 36 52 68 C52 104 12 106 4 86'],
  '6': [56, 'M46 6 C20 -6 4 26 4 62 C4 104 52 104 52 68 C52 36 8 36 4 62'],
  '7': [54, 'M4 0 L52 0 L18 100'],
  '8': [54, 'M27 48 C-4 44 2 0 27 0 C52 0 58 44 27 48 C-6 52 -2 100 27 100 C56 100 60 52 27 48'],
  '9': [56, 'M50 36 C46 66 4 64 4 34 C4 4 52 -2 52 34 L48 100'],
  '/': [40, 'M36 0 L4 100'],
};
const SPACE = 34;
const GAP = 14;

/** How messy the hand is: per-letter tilt (degrees) and bounce (fraction of cap height), and the lean. */
const WOBBLE = { tilt: 3.5, bounce: 0.035, lean: -7 };

export interface Hand {
  /** Every stroke, in canvas pixels. */
  path: Path2D;
  /** Where each stroke starts, in order. */
  starts: { x: number; y: number }[];
  width: number;
}

const rng = (text: string) => {
  let s = 2166136261;
  for (const ch of text) s = Math.imul(s ^ ch.charCodeAt(0), 16777619);
  return () => {
    s = Math.imul(s ^ (s >>> 15), 2246822507) ^ Math.imul(s ^ (s >>> 13), 3266489909);
    return ((s >>> 0) % 10000) / 10000 - 0.5;
  };
};

/** How wide `text` comes out at cap height `size`. */
export function handWidth(text: string, size: number) {
  const s = size / 100;
  let x = 0;
  for (const ch of text.toUpperCase()) x += ((GLYPHS[ch]?.[0] ?? SPACE) + GAP) * s;
  return Math.max(0, x - GAP * s);
}

/** Lay out `text` with its left end at x and its baseline at y, cap height `size`. */
export function hand(text: string, x: number, y: number, size: number, wobble = 1): Hand {
  const s = size / 100;
  const r = rng(text);
  const path = new Path2D();
  const starts: Hand['starts'] = [];
  let cx = x;
  for (const ch of text.toUpperCase()) {
    const g = GLYPHS[ch];
    if (!g) {
      cx += (SPACE + GAP) * s;
      continue;
    }
    const [adv, d] = g;
    const m = new DOMMatrix()
      .translate(cx + (adv * s) / 2, y + r() * 2 * WOBBLE.bounce * size * wobble)
      .rotate(r() * 2 * WOBBLE.tilt * wobble)
      .skewX(WOBBLE.lean * wobble)
      .translate((-adv * s) / 2, -size)
      .scale(s);
    path.addPath(new Path2D(d), m);
    for (const mt of d.matchAll(/M\s*(-?[\d.]+)[\s,]+(-?[\d.]+)/g)) {
      const p = m.transformPoint(new DOMPoint(Number(mt[1]), Number(mt[2])));
      starts.push({ x: p.x, y: p.y });
    }
    cx += (adv + GAP) * s;
  }
  return { path, starts, width: Math.max(0, cx - x - GAP * s) };
}

/** Write `text` in Sharpie: right-aligned when `align` is 'right'. */
export function writeHand(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  opts: { color?: string; width?: number; align?: 'left' | 'right' } = {},
) {
  const left = opts.align === 'right' ? x - handWidth(text, size) : x;
  const h = hand(text, left, y, size, 0.6);
  ctx.save();
  ctx.strokeStyle = opts.color ?? '#121214';
  ctx.lineWidth = opts.width ?? Math.max(2, size * 0.12);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke(h.path);
  ctx.restore();
  return h;
}
