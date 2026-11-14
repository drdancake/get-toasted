// A run is a string of shifts. Each shift has a clock and a number Matt needs out of you in
// dollars; the first few each put one new thing on the menu (see levels.ts), and after that the
// menu is full and it only gets busier and the number only gets bigger. Miss the number, or do
// something that's truly bad for the business, and you get written up. Three write-ups and
// you're fired.

export const SHIFT = {
  /**
   * How long each shift runs (game seconds); the last one repeats. Long enough for five or six
   * tickets to print and go out: a ticket is about 45 seconds apart early on and an order takes
   * about a minute from freezer to door.
   */
  seconds: [240, 250, 270, 280, 300, 300],
  /** Last call: no new tickets this close to the end. If everything's out after that, the shift ends early. */
  lastCall: 70,
  /** What Matt needs from each shift, in dollars; after the list runs out it grows by this much a shift. */
  targets: [40, 65, 95, 125, 160, 200],
  targetGrowth: 1.15,
  /** Later shifts pay better: everything earns this much more per shift after the first (shift 3 pays 1.4 times shift 1). */
  payPerShift: 0.2,
  /** Write-ups before you're fired. */
  strikesOut: 3,
  /** A shift that adds something opens with this many plain orders of it, by itself, before it mixes with the rest. */
  // (Two, not four: with five or six tickets to a shift, four of the same was the whole shift. They can be either size.)
  introTickets: 2,
  /** How much busier each shift starts than the last (minutes on the difficulty clock). */
  minutesPerShift: 1.2,
  /** "Full kitchen": the shift an experienced player can start at, with everything on. */
  rushFrom: 7,
};

/** Why you got written up, and what the slip says. */
export const WRITE_UPS: Record<string, { slip: string; matt: string }> = {
  target: { slip: 'DIDN’T MAKE THE NUMBER', matt: 'I have rent. I have food cost. I have you. Do the math.' },
  health: { slip: 'SERVED RAW CHICKEN', matt: 'Someone could get hurt. That’s a write-up.' },
  wrong: { slip: 'SENT OUT THE WRONG ORDER', matt: 'They ordered one thing. You sent another. Write-up.' },
  freezer: { slip: 'LEFT THE FREEZER OPEN', matt: 'That freezer costs more than you do. Write-up.' },
};

/** Matt doing the math at you before a shift. {n} is the number. */
export const MATT_MATH = [
  'Rent. Food cost. Your wages. I need ${n} out of you tonight.',
  'The oil alone is forty bucks. Bring in ${n}.',
  'I did the math. The math says ${n}. Don’t argue with the math.',
  '${n}. That’s the number. Under it, we talk.',
];
