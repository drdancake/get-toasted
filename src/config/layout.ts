// Screen layout in fractions of the portrait viewport: u is 0..1 left to
// right, v is 0..1 top to bottom. Both the 3D placement and the touch
// hotspots read from here, so moving a strip is a one-line edit.

export const LAYOUT = {
  /** World units across the full screen width. */
  worldWidth: 10,
  /** Camera tilt in degrees from straight down. 0 is top-down. */
  cameraTilt: 30,

  hud: { v0: 0.0, v1: 0.065 },
  rail: { v0: 0.065, v1: 0.19 },
  fryers: { v0: 0.2, v1: 0.61 },
  freezer: { v0: 0.62, v1: 0.75 },
  pass: { v0: 0.76, v1: 0.9 },
  matt: { v0: 0.9, v1: 1.0 },

  /** Horizontal centers of the two basket slots in each fryer row. */
  slotU: [0.27, 0.73],
  /** Where the basket in hand is shown, inside the pass strip. */
  handU: 0.3,
  /** Where the Serve button sits, inside the pass strip. */
  serveU: 0.75,

  /** Placeholder rav cubes. World units. */
  cube: { size: 0.42, gap: 0.5, perRow: 5 },
  /** Placeholder basket frame. World units. */
  basket: { w: 2.9, d: 1.4, h: 0.5 },
};
