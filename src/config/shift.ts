// The shift: fryer station home screen plus the freezer and pass microgames.
// World units: the screen is WORLD.width (see toss.ts) units across.

export const STATION = {
  /** Empty baskets hung on each slot's back bar at the start of a shift. The 350°F wing fryer is the stash. */
  hangStart: [1, 1, 1, 1],
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
  basketD: 2.1,
  basketWall: 0.5,
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
  bagU: [0.1, 0.3, 0.5, 0.7, 0.9],
  /** A rav arcs up out of the bin this fast: high, with time to get under it. */
  hopVy: [18.6, 19.6],
  /** It drifts toward the middle of the freezer at this fraction of the distance per second... */
  hopToCenter: 0.32,
  /** ...plus this much random sideways scatter. Small, so a quick volley comes down together. */
  hopVx: 0.22,
  /** Extra catch width at the basket rims, world units. Drops should be your fault, not the rim's. */
  catchGrace: 0.32,
  /** Ravs launched within this many seconds of each other are one volley (for the ALL 6! stamp). */
  volleyGap: 0.6,
  /** Smallest volley worth a stamp. */
  volleyMin: 3,
  /** Lowest the basket goes: this far above the top of the bins, so it never covers them. */
  basketAboveBins: 1.3,
  /** Most baskets you can carry into the freezer at once (one per finger, realistically). */
  maxBaskets: 3,
  /** Where the baskets start, across the freezer, by how many you brought. */
  homeX: [[0], [-1.6, 1.6], [-2.5, 0, 2.5]],
  /** Fastest you can grab from one bag. */
  cooldown: 0.09,
  /** How big the bins of frozen ravs are drawn (and how wide a tap on one reaches, world units). */
  bagScale: 0.98,
  bagReach: 1.0,
  /** A basket whose ravs have cooked no more than this (game seconds) can come back to the freezer to be topped up. */
  topUpMax: 8,
  /**
   * The freezer has a temperature (°F). It climbs while the lid is up and comes back down while it's
   * shut, so living in the freezer catches up with you. It beeps from tempBeep; at tempDanger (41 °F,
   * the bottom of the food-safety danger zone, 41 to 135) it costs a little reputation every warmEvery.
   */
  tempCold: 0,
  tempOpenRate: 2.5,
  tempShutRate: 1.4,
  tempBeep: 32,
  tempDanger: 41,
  tempMax: 60,
  beepEvery: 1.5,
  warmEvery: 4,
  warmRep: -0.04,
  /** The chest freezer on the fryer screen: how dark the fryers go behind it, and its lid swinging open. */
  veil: 0.22,
  lidSeconds: 0.35,
  /** Baskets glide between their bar and the freezer this fast, and walking out takes this long. */
  glideRate: 11,
  glideOut: 0.6,
  /** Shut with ravs still in the air: the baskets stay out this long (seconds) to catch them. */
  lastCatch: 2.5,
  lidOpen: 2.95,
};

/**
 * The one stage: the fryers from the front, in the same view as the freezer and the bowl. Heights are
 * fractions of the screen from the top.
 */
export const STAGE = {
  /** World units across the screen (wider than the classic view, so four baskets fit side by side). */
  worldWidth: 8.6,
  /** The bar the baskets hang from, the oil's surface, and the table top. */
  /** The camera looks down on the fryers from standing height (degrees). */
  tilt: 30,
  /** The fryer's front ledge and the table top. */
  oilV: 0.56,
  tableV: 0.655,
  /** A basket frying sits with its floor this far under the ledge; hanging, this much higher. */
  fryDepth: 0.55,
  hangLift: 1.3,
  /** Frozen ravs fly this far of the way from the bins to the top of the screen. */
  hopTo: 0.8,
  /** Baskets nested on one bar step this far over and up; nested in the oil, this far up. */
  nestX: 0.0,
  nestY: 0.32,
  stackY: 0.32,
  /** How much smaller a basket's floor is than its rim (they taper, which is why they nest). */
  taper: 0.7,
  /** The freezer's lid stands open behind it (radians from shut); tap it to shut the freezer. */
  lidOpen: 1.72,
  lidMax: 2.6,
  /** How fast a basket eases to where it belongs once you let go (per second). */
  settle: 13,
  /** How strongly the oil tints what's down in it. */
  oilTint: 0.5,
  /** The salt bowl on the stage: its width (world units), where it sits across the screen, and how far the fryers dim while you're at it. */
  bowlW: 2.0,
  bowlU: 0.14,
  passVeil: 0.2,
  /** Carry a cooked basket this close to the bowl and you're pouring: it's in your hand at the bowl. */
  passReach: 2.3,
  bowlScale: 0.85,
  /** The bowl sits this far above the middle of the boxes row (world units). */
  bowlLift: 0.45,
};

export const PASS = {
  /** The pass happens over the fryers: the floor ravs die on, just above the table row (fraction of screen height). */
  counterV: 0.64,
  /** Where the salt bowl and the shaker wait. */
  bowlU: 0.42,
  bowlV: 0.5,
  shakerU: 0.12,
  /** How dark the fryers go behind the bowl. */
  veil: 0.55,
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

/**
 * Ticket pacing for the shift. Aim: flow, right on the edge of anxiety, not over it (Dan, 2026-11-10:
 * two tickets deep was already panic). Slower to start, a gentler ramp, more time per ticket.
 */
export const SHIFT_TICKETS = {
  /** Seconds before the first ticket prints: time to look around. */
  firstArrival: 5,
  /** The first this-many tickets are easy: one item, one flavor, the small size. */
  warmupTickets: 3,
  intervalStart: 47,
  intervalMin: 27,
  intervalDropPerMinute: 1.5,
  lifeStart: 260,
  lifeMin: 160,
  lifeDropPerMinute: 2,
  /** Tickets the rail holds side by side. Receipts are one width: a long order hangs longer. */
  railMax: 4,
  /** Chance each ticket carries another item (up to maxItems), growing with the shift. */
  extraItemChanceStart: 0,
  extraItemChanceMax: 0.45,
  extraItemRampPerMinute: 0.04,
  maxItems: 6,
  /** Each further item is this much less likely than the one before: big orders happen, rarely. */
  extraItemFalloff: 0.75,
  /** A remake (the box went to the wrong guest) jumps the pile, and that guest has already waited: seconds of patience. */
  remakeLife: 110,
  /** Tickets that can wait face-down at the left of the rail once it is full. */
  pileMax: 3,
  /** Chance a single-flavor item asks for a different sauce ("SUB RANCH"), growing with the shift. */
  subChanceStart: 0,
  subChanceMax: 0.18,
  subRampPerMinute: 0.04,
  /** Chance a savory item is split between two flavors (3/3 or 5/5), growing with the shift. */
  splitChanceStart: 0,
  splitChanceMax: 0.22,
  splitRampPerMinute: 0.025,
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
/** Batches each flavor can have timing at once: one on the wall timer, the rest staggered on the backup. */
export const BATCHES_PER_FLAVOR = 3;

export const TIMER_CHANNELS: { flavor: import('./flavors').FlavorId }[] = (['beef', 'cheese', 'buffalo', 'gooey', 'mozz'] as const).flatMap((flavor) =>
  Array.from({ length: BATCHES_PER_FLAVOR }, () => ({ flavor })),
);

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
  saltMin: 1,
  /** Sideways bowl travel (world units) that counts as a good toss. */
  tossNeed: 2,
  /** Grab radius for picking up one rav with your fingers (or tongs), world units. */
  pickRadius: 0.32,
  /** Pull a basket within this many seconds of its timer going off and it's ON THE BEEP. */
  onTimeWindow: 2.5,
  /** The bowl and boxes only shed ravs over the rim when moving faster than this (a hard toss). */
  spillSpeed: 3,
  /** Boxes the metal table shows at once. */
  tableMax: 4,
  /** Pouring into a box: tipped past this (0..1) ravs start coming out, up to this many a second. */
  boxPourStart: 0.3,
  boxPourRate: 4.5,
  /** Finger travel (px) that tips the bowl or basket all the way over a box. */
  boxPourPull: 80,
};

/** Sauce cups and the ladle game. */
export const SAUCE = {
  /**
   * Cups already lidded at the start of a shift: none. Every order's cup is filled for that order
   * (ranch runs fast and thin, marinara medium and chunky, mascarpone is a slow scrape).
   */
  startStock: { marinara: 0, ranch: 0, mascarpone: 0 } as Record<'marinara' | 'ranch' | 'mascarpone', number>,
  /** Hot sauce: a marinara cup is hot this many game seconds, then it's cold (a complaint in the box)... */
  hotSeconds: 35,
  /** ...and past this it's thrown out. */
  tossAfter: 70,
  /** What a tossed cup costs, cents. */
  cupCents: 30,
  /**
   * The lemon berry mascarpone cup. Amounts are cups' worth; heights are fractions of the cup.
   * The mascarpone is scraped down one side (`side` of the cup's width) and the compote fills the rest.
   */
  mascarpone: {
    side: 0.52,
    /** One pass of the spatula across the pan loads this much; it will hold scoopMax. A good scoop covers the blade. */
    scoopPerPass: 0.42,
    scoopMax: 0.8,
    goodScoop: 0.42,
    /** In 3D: seconds in the pan for a good scoop, how fast it scrapes off pulled all the way (cups a second), and how much harder the bottle squeezes than its base rate. */
    scoopSeconds: 0.3,
    /** Past a good scoop, the spatula keeps loading at this fraction of the speed (lingering heaps it up, slowly). */
    heapRate: 0.12,
    scrape: 1.3,
    squeezeBoost: 2.6,
    /** One pass across the cup's mouth scrapes this much off the blade. */
    scrapePerPass: 0.5,
    /** How high the mascarpone can stand before the rest ends up on the rim, and the heights that count. */
    pasteMax: 1.0,
    pasteOk: [0.62, 1.0] as [number, number],
    /** Mascarpone on the rim past this is a messy cup. */
    messOk: 0.04,
    /** Compote: cups' worth per second squeezed, the least that counts, and the level it should reach. */
    squeeze: 0.3,
    berryMin: 0.12,
    levelOk: [0.8, 1.02] as [number, number],
    /** Past this the compote runs over the side. */
    overflow: 1.05,
  },
  /** The fill line on the cup, and the fills that count. */
  line: 0.88,
  perfect: [0.82, 0.97] as [number, number],
  okMin: 0.7,
  /** Past this it's overfilled: sauce down the side, cup tossed. */
  overflow: 1.08,
  /**
   * The ladle: a long handle held at the top, the bowl hanging below the hand. One full bowl is one
   * cup. Distances are in the sauce scene's units (about a centimeter); speeds are units per second.
   */
  ladle: {
    /** How far the ladle moves for how far your thumb does, and how quickly the bowl catches up with the hand. */
    gain: 1.2,
    follow: 16,
    /** Turning from the fryers to a sauce table and back: seconds for the camera to pan across, and how far to the side (world units) the close-up's own camera starts. */
    turnSeconds: 0.34,
    turnSweep: 16,
    /** The cold table's lid: seconds to swing up when you arrive, and down as you leave. */
    lidSeconds: 0.4,
    /** Seconds down in the pan to fill the bowl: short enough to fill on the way through. */
    dipTime: 0.16,
    /** How close to the cup's far edge the bowl has to come to stop there. */
    catch: 4.6,
    /** Pull the hand this far on toward you and the bowl is swung all the way over (through this angle, radians). */
    pull: 7.5,
    swing: 1.15,
    /** Move a bowl fuller than slopAbove faster than slopSpeed and it slops, this much a second. */
    slopAbove: 0.6,
    slopSpeed: 95,
    slopRate: 0.5,
    /** Eased off for this long with the cup filled: that's the cup. */
    rest: 0.2,
    /**
     * Each sauce has its own feel. flow: cups per second swung all the way over. lag: seconds it
     * takes to get going and to stop (thick sauce keeps coming). glug: how unevenly it comes.
     */
    feel: {
      marinara: { flow: 1.0, lag: 0.16, glug: 0.3 },
      ranch: { flow: 1.7, lag: 0.04, glug: 0 },
    },
  },
  /** Spare cups of a cold sauce (ranch, mascarpone) you can have made ahead: three layers of four in its clear pan. */
  spareMax: 12,
  /** Cents of sauce lost per spilled cup's worth: it ticks up as it hits the table. */
  spillCents: 100,
};

/** The bench under the fryers on the main screen: the salt bowl at the left, the boxes beside it, supplies below. */
export const BENCH = {
  /** Pixels from the bottom of the screen to the bottom of the boxes row (the supplies and the bar sit below). */
  bottomPx: 116,
  /** The boxes row's height, as a fraction of the screen height. */
  heightFrac: 0.17,
  /** The salt bowl's size on the bench. */
  bowlScale: 0.5,
};
