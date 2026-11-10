// The box close-up: the open clamshell fills the screen over the station, the ravs drop in, you
// set them in the layout, dress them, and shut the lid. All the feel numbers live here.

export const BOX_FOCUS = {
  /** Box floor size (world units) by box size; a rav is about 0.44 across, a gooey 0.7. */
  size: { S: [1.6, 1.1], M: [2.1, 2.0], L: [2.7, 2.7] } as Record<string, [number, number]>,
  wall: 0.42,
  /** How far you can be from a rav and still grab it. */
  grab: 0.34,
  /** Seconds the ravs take to tumble in when the box comes up. */
  dumpTime: 0.9,
  /** Sugar shaker (dessert): every shake (a stroke this long that turns back) puffs a burst of this many splats, this wide, each this big (times a flake). */
  sugarStroke: 0.12,
  sugarBurst: 14,
  sugarSpread: 0.42,
  sugarSplat: 3.6,
  flakeRate: 140,
  /** Flakes of each garnish on a rav that count as dressed (parm and parsley, or sugar on each side). */
  flakesPerRav: 8,
  /**
   * A pinch from the pan is one big handful for everything in front of you: this many flakes per
   * rav (at least pinchMin). It falls as you sweep (per world unit of travel), trickles a little if
   * you hold still, and spreads this wide.
   */
  pinchPerRav: 60,
  pinchMin: 300,
  pinchPerUnit: 34,
  pinchTrickle: 18,
  pinchSpread: 0.2,
  /** How far the lid stands open behind the box (radians). */
  openLid: Math.PI * 0.62,
  /** The line: the next box waits this far to the right and slides in over this many seconds. */
  lineGap: 1.4,
  slideTime: 0.45,
  maxFlakes: 6000,
  /** A tap on a gooey rav (moving less than this many px) flips it. */
  flipTapPx: 10,
  /** Pull the lid down this far (0..1 of the way) and let go: it snaps shut and the box goes out. */
  lidClose: 0.6,
  /** A box set and shut within this many seconds counts as fast. */
  fastSeconds: 9,
};

/**
 * Plating: the box floor is a little grid (tic-tac-toe for a 6) and everything snaps to it. Row 0 is
 * the back of the box (by the hinge), column 0 the left. `cups` are where the sauce cups sit (the
 * first one, or two for a split); a cup on a whole cell blocks it, and `blocked` holds the cells the
 * middle-column cups of a split take. `house` is the house layout for each ticket line (first
 * flavor, second flavor): Dan's 3 / 2 / 1 nested left with the cup bottom right, splits in columns
 * with the cups down the middle. Any tidy layout scores; the house one is a bonus.
 */
export interface Plating {
  cols: number;
  rows: number;
  cups: [number, number][];
  blocked: [number, number][];
  house: [number, number][][];
}

const col = (c: number, n: number) => Array.from({ length: n }, (_, r) => [c, r] as [number, number]);

export const PLATINGS: Record<string, Plating> = {
  '6': { cols: 3, rows: 3, cups: [[2, 2], [2, 1]], blocked: [], house: [[[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [0, 2]]] },
  '6split': { cols: 3, rows: 3, cups: [[1, 0.5], [1, 1.5]], blocked: col(1, 3), house: [col(0, 3), col(2, 3)] },
  // A 10 of one flavor is the 6's big brother: 4 / 3 / 2 / 1 nested left, the cup bottom right. (Big boxes are square.)
  '10': { cols: 4, rows: 4, cups: [[3, 3], [3, 2]], blocked: [], house: [[[0, 0], [1, 0], [2, 0], [3, 0], [0, 1], [1, 1], [2, 1], [0, 2], [1, 2], [0, 3]]] },
  '10split': { cols: 3, rows: 5, cups: [[1, 1.5], [1, 2.5]], blocked: col(1, 5), house: [col(0, 5), col(2, 5)] },
  // Gooey are bigger: quadrants, the cup bottom right.
  '3': { cols: 2, rows: 2, cups: [[1, 1], [1, 0]], blocked: [], house: [[[0, 0], [1, 0], [0, 1]]] },
  '1': { cols: 2, rows: 1, cups: [[1, 0]], blocked: [], house: [[[0, 0]]] },
};

/** The plating for an order (or a fallback grid big enough for what's in the box). */
export function platingFor(count: number, split: boolean): Plating {
  const p = PLATINGS[`${count}${split ? 'split' : ''}`] ?? PLATINGS[String(count)];
  if (p) return p;
  const rows = Math.ceil((count + 1) / 3);
  const cells: [number, number][] = [];
  for (let i = 0; i < count; i++) cells.push([i % 3, Math.floor(i / 3)]);
  return { cols: 3, rows, cups: [[2, rows - 1]], blocked: [], house: [cells] };
}
