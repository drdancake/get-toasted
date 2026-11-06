// The shift: fryer station home screen plus the freezer and pass microgames.
// World units: the screen is WORLD.width (see toss.ts) units across.

export const STATION = {
  /** Empty baskets hung on each slot's back bar at the start of a shift. The 350°F wing fryer is the stash. */
  hangStart: [1, 1, 1, 1, 3, 3],
  /** Most empty baskets that nest on one slot's bar. */
  hangMax: 4,
  /** Baskets a slot can hold, nested. */
  stackMax: 2,
  /** Ravs a single basket can take (one basket alone in a slot cooks them all fine). */
  basketMax: 24,
  /** Past this many in the bottom basket, a basket nested on top rides high and cooks slow. */
  nestFullAt: 16,
  /** Heat the top basket gets when it's riding high on an overfull bottom basket. */
  highTopHeat: 0.6,
  /** Seconds a cooked basket should hang on the bar to drain before it goes in the salt bowl. Skip it and they're greasy. */
  drainSeconds: 2.5,
  /** Long-way basket footprint in the station view. */
  basketW: 0.9,
  basketD: 2.3,
  basketWall: 0.45,
  /** How far (world units) you can slide a basket side to side in its slot by hand. */
  slideMax: 0.12,
  /** Settle gained per world unit of sideways basket travel. About three good back-and-forths settles it. */
  settlePerUnit: 1.6,
  /** A touch shorter than this (ms) with no drag counts as a tap: tap to pick or unstack, drag to move. */
  tapMs: 450,
  /** Finger travel up (px) that lifts a basket out of the oil into your hand. Less than this and it settles back. */
  pullPx: 35,
  /** How high (world units) the basket rises while you lift it. */
  liftMax: 0.9,
  /** Where a timer goes off, as a fraction through the perfect window. 0 = the real cook time (what the tape says). */
  timerAt: 0,
};

export const FREEZER = {
  /** Bottom shelf the bins sit on, fraction of screen height from the top. A rav that falls back to it is dead. */
  shelfV: 0.85,
  /** Bin centers across the shelf (0..1). */
  bagU: [0.14, 0.38, 0.62, 0.86],
  /** A rav arcs up out of the bin this fast. */
  hopVy: [15, 17],
  /** It drifts toward the middle of the freezer at this fraction of the distance per second... */
  hopToCenter: 0.35,
  /** ...plus this much random sideways scatter. */
  hopVx: 0.8,
  /** Lowest the basket goes: this far above the top of the bins, so it never covers them. */
  basketAboveBins: 1.3,
  /** Most baskets you can carry into the freezer at once (one per finger, realistically). */
  maxBaskets: 3,
  /** Where the baskets start, across the freezer, by how many you brought. */
  homeX: [[0], [-1.6, 1.6], [-2.5, 0, 2.5]],
  /** Fastest you can grab from one bag. */
  cooldown: 0.12,
};

export const PASS = {
  /** The metal table the boxes sit on, fraction of screen height from the top. */
  counterV: 0.84,
  /** The wall rack the salt bowl and shaker sit on. */
  bowlU: 0.42,
  bowlV: 0.56,
  shakerU: 0.12,
  /** The basket comes in with its pour corner this far right of the bowl's rim: a short drag left and it pours. */
  spoutLead: 0.6,
  /** How high above the bowl rim the basket comes in. */
  basketAbove: 0.9,
  /** A down-stroke at least this long, then back up, is one shake of salt. */
  shakeStroke: 0.2,
  /** A picked-up rav rides this far above your finger so you can see it. */
  liftRav: 0.35,
  /** How far the bowl tips toward a box when you pour, radians. */
  bowlTiltAngle: 0.75,
};

/** Ticket pacing for the shift. Slower than the tap build: there are more steps now. */
export const SHIFT_TICKETS = {
  /** Seconds before the first ticket prints: time to look around. */
  firstArrival: 5,
  /** The first this-many tickets are easy: one item, one flavor, the small size. */
  warmupTickets: 2,
  intervalStart: 26,
  intervalMin: 9,
  intervalDropPerMinute: 1.2,
  lifeStart: 120,
  lifeMin: 60,
  lifeDropPerMinute: 4,
  railMax: 4,
  /** Chance each ticket carries another item (up to maxItems), growing with the shift. */
  extraItemChanceStart: 0,
  extraItemChanceMax: 0.6,
  extraItemRampPerMinute: 0.08,
  maxItems: 3,
  /** Chance a savory item is split between two flavors (3/3 or 5/5), growing with the shift. */
  splitChanceStart: 0.1,
  splitChanceMax: 0.35,
  splitRampPerMinute: 0.06,
  /** Extra seconds of patience per extra item on a ticket. */
  lifePerItem: 30,
  bigOrderChanceStart: 0.1,
  bigOrderChanceMax: 0.6,
  bigOrderRampPerMinute: 0.08,
  /** Prep mode: no clock. A new ticket only when the rail has fewer than this. */
  prepRail: 2,
};

/**
 * The timer bank: a commercial 8-channel kitchen timer over the fryers, each
 * channel preset to a flavor and labeled with label-maker tape. Press a
 * channel when the basket goes in; it counts down the real time at game speed.
 * Which timer belongs to which basket is yours to remember.
 */
export const TIMER_CHANNELS: { flavor: import('./flavors').FlavorId }[] = [
  { flavor: 'beef' },
  { flavor: 'beef' },
  { flavor: 'cheese' },
  { flavor: 'cheese' },
  { flavor: 'buffalo' },
  { flavor: 'buffalo' },
  { flavor: 'gooey' },
  { flavor: 'gooey' },
];

/** A ringing timer beeps this often (seconds) until you press it. */
export const TIMER_BEEP_EVERY = 1.1;

/** How long the flavor tag shows over a basket after you drop it (seconds). */
export const DROP_TAG_SECONDS = 1.6;

/** Expo: the cold table where you prep styrofoam while the ravs cook. */
export const EXPO = {
  /** Open boxes the cutting board holds. */
  boardMax: 3,
};

/**
 * Plating, at the salt bowl and the metal table: pour the basket into the bowl, salt and toss,
 * then into the boxes one at a time (or dump the bowl and arrange). Gooey skips the salt: tongs.
 */
export const PLATE = {
  /** Basket tilt (0..1) where ravs start pouring out of the near corner. */
  pourStart: 0.68,
  /** Ravs per second pouring at full tilt. */
  pourRate: 14,
  /** How fast the basket tips toward the bowl (and back), per second. */
  tiltRate: 7,
  /** The bowl: tipped past this it pours into the box below, this many ravs a second (slow enough to stop on the count). */
  bowlPourStart: 0.55,
  bowlPourRate: 5,
  /** Hold the bowl's bottom within this far above a box to pour into it. */
  bowlPourAbove: 2.4,
  /** How fast the basket glides in from the fryer. */
  arriveRate: 7,
  /** How far the basket turns at full tilt, radians: past upright, like dumping it on the line. */
  tiltAngle: 1.65,
  /** Poured ravs land about this far left of the spout. */
  pourDrift: 0.25,
  /** The landing spot has to be at least this far inside the bowl's rim to start pouring. */
  pourMargin: 0.3,
  /** The silver bowl. */
  bowlW: 2.6,
  bowlWall: 0.8,
  /** Shakes of salt per rav in the bowl (at least saltMin). */
  saltPerRav: 0.35,
  saltMin: 2,
  /** Sideways bowl travel (world units) that counts as a good toss. */
  tossNeed: 3,
  /** Grab radius for picking up one rav with your fingers (or tongs), world units. */
  pickRadius: 0.32,
  /** The bowl and boxes only shed ravs over the rim when moving faster than this (a hard toss). */
  spillSpeed: 3,
  /** Boxes the metal table shows at once. */
  tableMax: 4,
};
