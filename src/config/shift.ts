// The shift: fryer station home screen plus the freezer and pass microgames.
// World units: the screen is WORLD.width (see toss.ts) units across.

export const STATION = {
  /** Clean baskets on the line. */
  baskets: 8,
  /** Baskets a slot can hold, nested. */
  stackMax: 2,
  /** Filled raw baskets you can have waiting on the counter. */
  stagedMax: 3,
  /** Long-way basket footprint in the station view. */
  basketW: 0.98,
  basketD: 2.3,
  basketWall: 0.45,
  /** Each sideways wiggle of a basket in the oil settles the ravs this much (1 = flat and submerged). */
  shakeSettle: 0.34,
  /** Finger travel (px) that counts as one wiggle. */
  shakePx: 22,
  /** Finger travel up (px) that pulls a basket out of the oil. */
  pullPx: 40,
  /** Where the timer goes off, as a fraction through the perfect window. 0.5 = dead center. */
  timerAt: 0.5,
};

export const FREEZER = {
  /** Shelf with the bags, fraction of screen height from the top. */
  shelfV: 0.3,
  /** Freezer floor: a rav that hits it is dead. */
  floorV: 0.9,
  /** Bag centers across the shelf (0..1). */
  bagU: [0.14, 0.38, 0.62, 0.86],
  /** A rav hops out of the bag this fast, then falls. */
  hopVy: [3.5, 5.5],
  /** Sideways scatter out of the bag. */
  hopVx: 1.6,
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
  railMax: 5,
  bigOrderChanceStart: 0.2,
  bigOrderChanceMax: 0.6,
  bigOrderRampPerMinute: 0.1,
};
