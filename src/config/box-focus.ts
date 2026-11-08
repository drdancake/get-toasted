// The box close-up: the open clamshell fills the screen over the station, the ravs drop in, you
// set them in the layout, dress them, and shut the lid. All the feel numbers live here.

export const BOX_FOCUS = {
  /** Box floor size (world units) by box size; a rav is about 0.44 across, a gooey 0.7. */
  size: { S: [1.5, 1.5], M: [2.1, 2.0], L: [2.6, 2.3] } as Record<string, [number, number]>,
  wall: 0.42,
  /** Spacing between layout spots, by rav size. */
  spacing: 0.52,
  /** Drop a rav within this far of a free spot and it snaps in. */
  snap: 0.3,
  /** How far you can be from a rav and still grab it. */
  grab: 0.34,
  /** Seconds the ravs take to tumble in when the box comes up. */
  dumpTime: 0.9,
  /** Garnish: flakes per second at a good shake, and how many on a rav count as dressed. */
  flakeRate: 70,
  flakesPerRav: 4,
  /** Pull the lid down this far (0..1 of the way) and let go: it snaps shut and the box goes out. */
  lidClose: 0.6,
  /** A box set and shut within this many seconds counts as fast. */
  fastSeconds: 9,
};

/**
 * The layout, as rows from the back of the box (by the hinge) to the front. Each row is how many
 * ravs, left-aligned; the sauce cup takes the front right corner (Dan's 6-piece: 3 / 2 / 1 + cup).
 */
export const LAYOUTS: Record<number, number[]> = {
  1: [1],
  3: [2, 1],
  6: [3, 2, 1],
  10: [4, 3, 2, 1],
};
