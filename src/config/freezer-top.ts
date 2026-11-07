// The top-down freezer: looking straight down into it. Ravs fly up at your face (bigger as they
// come), tumble, and fall back toward the floor; you slide the basket under their shadows.
// World units: the floor is the XY plane at z = 0, the camera looks down from above.

export const FREEZER_TOP = {
  /** Camera height above the floor and its field of view. Higher = smaller everything. */
  camHeight: 18,
  fov: 50,
  /** Gravity, units per second squared (down is -z). */
  gravity: 22,
  /** Launch speed up: how close they come to your face (the camera is at camHeight). */
  launchVz: [18.4, 19.2] as [number, number],
  /** Where the bins sit (fraction of the screen height from the top) and their spread across. */
  binV: 0.77,
  binU: [0.19, 0.4, 0.6, 0.81],
  /** Ravs fly toward the middle of the floor: this far up the screen from the bins (world units)... */
  carry: 5.2,
  /** ...drifting toward center by this much of the distance, plus a little scatter (small, so a volley lands together). */
  toCenter: 0.75,
  scatter: 0.25,
  /** How high the baskets ride over the floor, and their footprint (x by y). */
  basketZ: 2.4,
  basketDepth: 1.4,
  /** Extra catch room around the rim. Drops should be your fault, not the rim's. */
  grace: 0.3,
  /** How hard the basket chases your thumb. */
  follow: 26,
  /** Extra growth with height on top of perspective (sells "at your face" while keeping them on screen). */
  zoom: 0.07,
  /** Tumble speed range, radians per second, per axis. */
  spin: 7,
  /** The shadow under each rav: radius and darkness at the floor, and how they spread with height. */
  shadowR: 0.26,
  shadowGrow: 0.022,
  shadowDark: 0.6,
  shadowFade: 0.03,
};
