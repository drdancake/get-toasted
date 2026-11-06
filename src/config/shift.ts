// The shift: fryer station home screen plus the freezer and pass microgames.
// World units: the screen is WORLD.width (see toss.ts) units across.

export const STATION = {
  /** Empty baskets hung on each slot's back bar at the start of a shift. The 350°F wing fryer is the stash. */
  hangStart: [1, 1, 1, 1, 3, 3],
  /** Most empty baskets that nest on one slot's bar. */
  hangMax: 4,
  /** Baskets a slot can hold, nested. */
  stackMax: 2,
  /** Filled raw baskets you can have waiting on the counter. */
  stagedMax: 4,
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
  /** Finger travel up (px) that lifts a basket clear of the oil. Less than this and it drops back in. */
  pullPx: 70,
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
  counterV: 0.84,
  boxU: 0.76,
};

/** Ticket pacing for the shift. Slower than the tap build: there are more steps now. */
export const SHIFT_TICKETS = {
  firstArrival: 1.5,
  intervalStart: 15,
  intervalMin: 7,
  intervalDropPerMinute: 1.5,
  lifeStart: 85,
  lifeMin: 50,
  lifeDropPerMinute: 4,
  railMax: 4,
  /** Chance each ticket carries another item (up to maxItems), growing with the shift. */
  extraItemChanceStart: 0.2,
  extraItemChanceMax: 0.6,
  extraItemRampPerMinute: 0.12,
  maxItems: 3,
  /** Chance a savory item is split between two flavors (3/3 or 5/5). */
  splitChance: 0.35,
  /** Extra seconds of patience per extra item on a ticket. */
  lifePerItem: 30,
  bigOrderChanceStart: 0.2,
  bigOrderChanceMax: 0.6,
  bigOrderRampPerMinute: 0.1,
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
