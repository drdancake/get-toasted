// How sharp the 3D is drawn, and when to trade sharpness for speed. The game is limited by how
// many pixels it fills, not by its own code, so resolution is the lever: a slow device steps the
// resolution down until the frame rate holds, and a fast one keeps it sharp.

export const QUALITY = {
  /** Pixel ratios to step through, sharpest first (never above the screen's own). */
  ratios: [2, 1.5, 1.25, 1],
  /** Below this many frames a second (averaged) the resolution steps down. */
  dropBelow: 48,
  /** Above this many, held for `riseAfter` seconds, it steps back up. */
  riseAbove: 57,
  riseAfter: 8,
  /** How often it decides, seconds; and how long after any change before it decides again. */
  every: 1.5,
  settle: 2.5,
  /** Stepping up and falling straight back within this many seconds means that step is too much for this device: don't try it again. */
  bounce: 6,
};
