// Flavor roster from the real menu. Adding a flavor is a new row here plus its
// id in the FlavorId union; game logic never changes for it.
//
// Timings: the real fryer time (Dan's numbers from the line) divided by
// COOK_SCALE, so every flavor speeds up by the same factor and the order and
// gaps between them stay true to the restaurant.

export type FlavorId = 'beef' | 'cheese' | 'buffalo' | 'gooey' | 'mozz' | 'parm';

export type LateFailure = 'burnt' | 'popped';

/** Real seconds become game seconds by dividing by this. 7 = a 4:45 beef takes about 41 s: room to salt and box one batch while the next fries (10 got frantic once splits arrived; 16 was the rush pace). */
export const COOK_SCALE = 7;

export interface FlavorDef {
  id: FlavorId;
  name: string;
  /** Short label for timer chips and basket tags. */
  short: string;
  /** Real time in the 300°F fryer, in seconds, as cooked on the line. */
  realCook: number;
  /** Game seconds in the oil before the perfect window opens (realCook / COOK_SCALE). */
  cook: number;
  /** Seconds the perfect window stays open. */
  window: number;
  /** Seconds before the window where a pull is still "ok" (half points) instead of cold. */
  okBefore: number;
  /** Seconds after the window where a pull is still "ok" before it fails. */
  okAfter: number;
  /** What happens when it is left past okAfter. On the line they burst (filling out the seam) long before they burn. */
  lateFailure: LateFailure;
  /** Order sizes a ticket can ask for, smallest first. */
  sizes: number[];
  /** Ziploc label and ticket color (CSS color). Cooked ravs all look alike: that's the point. */
  tint: string;
  /** Rav size relative to a savory rav. The gooey butter ones are bigger. */
  size: number;
  /** Filling color that shows faintly through the dough: how a keen eye tells them apart. */
  filling: string;
  /** Can this flavor share an order with another (split 3/3 or 5/5)? */
  splits: boolean;
  /** Not a square: how it's stretched (long, thick, wide) relative to a rav of its size. */
  shape?: [number, number, number];
  /** Not a rav at all: a breaded stick (a rounded log, no crimped edge), or a flat breaded cutlet (an uneven oval). */
  model?: 'stick' | 'cutlet';
  /** Doesn't go in a box: it comes out of the oil with the tongs and goes on the foil tray for the sandwich line. No timer, no salt: you temp it. */
  tray?: boolean;
}

const def = (d: Omit<FlavorDef, 'cook'>): FlavorDef => ({ ...d, cook: d.realCook / COOK_SCALE });

export const FLAVORS: Record<FlavorId, FlavorDef> = {
  beef: def({
    id: 'beef',
    name: 'OG Beef',
    short: 'OG BEEF',
    realCook: 285, // 4:45 (the wall timer)
    window: 7,
    okBefore: 1.5,
    okAfter: 4,
    lateFailure: 'popped',
    sizes: [6, 10],
    tint: '#b3473a',
    size: 1,
    filling: '#b08a62', // ground beef: pale tan
    splits: true,
  }),
  cheese: def({
    id: 'cheese',
    name: 'Three Cheese',
    short: 'CHEESE',
    realCook: 225, // 3:45
    window: 6,
    okBefore: 1.2,
    okAfter: 3,
    lateFailure: 'popped',
    sizes: [6, 10],
    tint: '#e0a72e',
    size: 1,
    filling: '#fbf6e8', // white cheeses
    splits: true,
  }),
  buffalo: def({
    id: 'buffalo',
    name: 'Buffalo Chicken',
    short: 'BUFFALO',
    realCook: 240, // 4:00
    window: 7,
    okBefore: 1.5,
    okAfter: 4,
    lateFailure: 'popped',
    sizes: [6, 10],
    tint: '#d9662b',
    size: 1,
    filling: '#e3894a', // buffalo sauce: a little orange
    splits: true,
  }),
  gooey: def({
    id: 'gooey',
    name: 'Gooey Butter',
    short: 'GOOEY',
    realCook: 270, // 4:30 (the wall timer), seasonal lemon berry
    window: 7,
    okBefore: 1.5,
    okAfter: 4,
    lateFailure: 'popped',
    sizes: [1, 3],
    tint: '#8f6bbf',
    size: 1.6,
    filling: '#efd9a0', // lemon berry gooey butter
    splits: false,
  }),
  // Mozzarella sticks: big ones, about seven inches. Four to an order, in a basket, 5:45 on the
  // wall. Touchy: go long and the cheese blows out the side and glues them together.
  mozz: def({
    id: 'mozz',
    name: 'Mozzarella Sticks',
    short: 'MOZZ',
    realCook: 345, // 5:45 (the wall timer)
    window: 5,
    okBefore: 1.5,
    okAfter: 2,
    lateFailure: 'popped',
    sizes: [4],
    tint: '#2e9e5b',
    size: 1.15,
    filling: '#f2c98a', // breading
    splits: false,
    model: 'stick',
  }),
  // Chicken parm cutlets: big breaded cutlets for the sandwich line. No timer on the wall. They
  // float and go golden when they're about there; a thermometer says for sure (165°F or it's a
  // health code violation). The closer to 165 the juicier; the hotter it gets the faster it goes,
  // and past a point it's leather and has to be replaced.
  parm: def({
    id: 'parm',
    name: 'Chicken Parm',
    short: 'PARM',
    realCook: 330,
    window: 7,
    okBefore: 0,
    okAfter: 7,
    lateFailure: 'burnt',
    sizes: [1, 3],
    tint: '#2f6fd6',
    // (Wider than the bottom of a basket: it sits in there on the diagonal.)
    size: 2.3,
    filling: '#eeb46a', // breading
    splits: false,
    model: 'cutlet',
    tray: true,
  }),
};

/** A cutlet's safe temperature (°F), where it starts (it comes out of the freezer), and how it climbs past safe: degrees a second, and how much that speeds up each second. */
export const CUTLET = { safe: 165, frozen: 34, curve: 1.6, past: 1.4, pastAccel: 0.07 };

/** A cutlet's internal temperature after this long in the oil (game seconds). */
export function cutletTemp(cooked: number) {
  const F = FLAVORS.parm;
  if (cooked <= F.cook) return CUTLET.frozen + (CUTLET.safe - CUTLET.frozen) * Math.pow(Math.max(0, cooked) / F.cook, CUTLET.curve);
  const over = cooked - F.cook;
  return CUTLET.safe + over * CUTLET.past + over * over * CUTLET.pastAccel;
}

/** Flavors in the first tap build (kept at ?v=tap). */
export const ACTIVE_FLAVORS: FlavorId[] = ['beef'];

/** Flavors on the freezer shelf in the shift build, left to right. */
export const SHIFT_FLAVORS: FlavorId[] = ['beef', 'cheese', 'buffalo', 'gooey', 'mozz', 'parm'];
