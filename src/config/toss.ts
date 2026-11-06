// The toss prototype: physical ravs you catch, fry and flick. Every feel number
// lives here. World units: the screen is WORLD.width units across.

export const WORLD = {
  /** World units across the screen at the play plane. */
  width: 7,
  /** Gravity, units per second squared. */
  gravity: -22,
  /** Physics substeps per frame. More = fewer ravs tunneling through rims. */
  substeps: 4,
};

/** Where things sit, as fractions of screen height from the top. */
export const TOSS_LAYOUT = {
  hangV: 0.31,
  oilV: 0.43,
  vatBottomV: 0.53,
  counterV: 0.86,
  /** Horizontal centers (0..1) of the two fryer slots. */
  slotU: [0.3, 0.7],
  bagU: 0.14,
  boxU: 0.79,
};

export const RAV = {
  /** Half width and half height of the pillow, for stacking. */
  hx: 0.22,
  hy: 0.1,
  /** How much a rav keeps of its speed when it bounces off a rim. */
  rimBounce: 0.45,
  /** Sideways kick off a rim. */
  rimKick: 2.2,
  /** Seconds a dead rav lies there before it is swept away. */
  deadLinger: 1.6,
};

export const LAUNCH = {
  /** Sideways speed range out of the freezer bag (always toward the middle). */
  vx: [0.9, 2.3],
  /** Upward speed range. Higher = more hang time to get a basket under them. Keep the peak below the oil. */
  vy: [13.2, 14.3],
  /** Spin range, radians per second. */
  spin: 9,
  /** Fastest you can tap ravs out of the bag. */
  cooldown: 0.11,
  /** Most ravs in the air at once. */
  maxAirborne: 24,
};

export const BASKET = {
  width: 2.0,
  wall: 0.6,
  /** How hard the basket chases your finger. Higher = stiffer, lower = floatier. */
  follow: 30,
  /** Release faster than this (units/s) with ravs inside and they fly. */
  tossSpeed: 5,
  /** Fraction of your flick speed the ravs keep. */
  tossCarry: 0.9,
  /** Random spread added to each rav on a toss. The pile mostly flies as a clump. */
  tossSpread: 0.3,
  /** Fastest flick that counts. */
  tossMax: 16,
  /** How far below the oil line a frying basket sits. Small, so you can see the ravs color. */
  sink: 0.1,
  /** Ravs slide around when you swing the basket. 0 = glued in. */
  slosh: 0.12,
  /** Release within this distance above the oil line and the basket drops in. */
  dropZone: 0.9,
};

export const BOX = {
  width: 2.1,
  wall: 0.5,
  /** Swipe the box up this far (world units) to serve it. */
  serveSwipe: 0.9,
};

export const TOSS_SCORING = {
  /** Points lost for every rav that hits the counter or the oil. */
  deadRav: 60,
  /** Points lost for every rav over the ticket count. Food cost. */
  extraRav: 40,
  /** Points lost for every wrong-flavor rav in a box that still goes out (a stray). */
  strayRav: 150,
};

/** Fryer heat by slot. 1 = standard. */
export const SLOT_HEAT = [1, 1];
