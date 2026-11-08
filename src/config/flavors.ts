// Flavor roster from the real menu. Adding a flavor is a new row here plus its
// id in the FlavorId union; game logic never changes for it.
//
// Timings: the real fryer time (Dan's numbers from the line) divided by
// COOK_SCALE, so every flavor speeds up by the same factor and the order and
// gaps between them stay true to the restaurant.

export type FlavorId = 'beef' | 'cheese' | 'buffalo' | 'gooey';

export type LateFailure = 'burnt' | 'popped';

/** Real seconds become game seconds by dividing by this. 10 = a 4:45 beef takes about 28 s (relaxed while we tune the flow; 16 was the rush pace). */
export const COOK_SCALE = 10;

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
}

const def = (d: Omit<FlavorDef, 'cook'>): FlavorDef => ({ ...d, cook: d.realCook / COOK_SCALE });

export const FLAVORS: Record<FlavorId, FlavorDef> = {
  beef: def({
    id: 'beef',
    name: 'OG Beef',
    short: 'OG BEEF',
    realCook: 285, // 4:45 (the wall timer)
    window: 4,
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
    window: 3,
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
    window: 4,
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
    window: 4,
    okBefore: 1.5,
    okAfter: 4,
    lateFailure: 'popped',
    sizes: [1, 3],
    tint: '#8f6bbf',
    size: 1.6,
    filling: '#efd9a0', // lemon berry gooey butter
    splits: false,
  }),
};

/** Flavors in the first tap build (kept at ?v=tap). */
export const ACTIVE_FLAVORS: FlavorId[] = ['beef'];

/** Flavors on the freezer shelf in the shift build, left to right. */
export const SHIFT_FLAVORS: FlavorId[] = ['beef', 'cheese', 'buffalo', 'gooey'];
