// The shift is scored in Matt's money (real menu prices) and the restaurant's
// reputation (stars). All money is in cents.
//
// Menu prices from docs/research.md: savory 6 for $12.50, 10 for $20.80;
// gooey butter 1 for $3.65, 3 for $10.50. A lost rav costs what the customer
// would have paid for it, so a beef on the floor is about $2.08 of Matt's money.

import type { FlavorId } from './flavors';

/** Price of an item by size, in cents. Split orders cost the same as single-flavor ones. */
export const MENU: { savory: Record<number, number>; gooey: Record<number, number> } = {
  savory: { 6: 1250, 10: 2080 },
  gooey: { 1: 365, 3: 1050 },
};

/** What one rav is worth to the customer, in cents: the small order's price over its count. */
export const RAV_PRICE: Record<FlavorId, number> = {
  beef: Math.round(1250 / 6),
  cheese: Math.round(1250 / 6),
  buffalo: Math.round(1250 / 6),
  gooey: 365,
};

/** Tips, as a fraction of the ticket total, paid when the whole ticket goes out. */
export const TIPS = {
  /** Everyone tips a little. */
  base: 0.08,
  /** Up to this much more for a ticket that goes out fast. */
  speed: 0.12,
  /** Each clean ticket in a row adds this much, up to comboMax. */
  perCombo: 0.03,
  comboMax: 0.15,
  /** A ticket with anything less than perfect on it tips at this fraction. */
  sloppy: 0.5,
};

/** The restaurant's reputation in stars. Drop to fireAt and Matt sends you home. */
export const REPUTATION = {
  start: 4,
  max: 5,
  fireAt: 1,
  /** A ticket that goes out perfect and fast (in the first half of its wait). */
  perfectFast: 0.15,
  /** Any other ticket that goes out clean. */
  clean: 0.05,
  /** A ticket that goes out in the last 30% of its wait. */
  slow: -0.05,
  /** A box sent back (cold, burnt, short). */
  rejected: -0.25,
  /** A box of the wrong thing. */
  wrongOrder: -0.5,
  /** Each stray rav that went out in a box. */
  stray: -0.1,
  /** Greasy or uneven ravs that went out (once per box). */
  sloppy: -0.05,
  /** A ticket nobody cooked before the customer gave up. */
  expired: -0.75,
};

/** Money as the register shows it: $12.50. */
export function dollars(cents: number) {
  const sign = cents < 0 ? '−' : '';
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

/**
 * Presentation: a prepped box (right size, wax paper, labeled for the order, the right sauce)
 * tips better and earns reputation. Missing sauce is a complaint whether you prepped or not.
 */
export const PRESENTATION = {
  /** Extra tip rate per presentation point (0 to 4 points per box). */
  tipPerPoint: 0.03,
  /** Stars per presentation point. */
  repPerPoint: 0.03,
  /** A box that goes out without its sauce. */
  missingSauce: -0.1,
  /** Gooey butter that went through the salt bowl. */
  saltyDessert: -0.1,
  /** One extra of the right flavor per box is generosity, not waste: it still costs the rav. */
  generousMax: 1,
  /** A box with no readable name on it, sent out while other tickets are up: nobody knows whose it is. */
  noNameRep: -0.2,
  /** Every box of a multi-box ticket labelled: a nice touch for the guest handing them out (per ticket, on the tip rate). */
  allNamedTip: 0.05,
  /** Stars per rav on the house, and the extra tip rate on a ticket that got one. */
  generousRep: 0.05,
  generousTip: 0.04,
};
