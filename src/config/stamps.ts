// The WarioWare layer: big stamped words that slam onto the screen when you do
// something great. Add a line by adding a string; one is picked at random.

export const STAMPS = {
  /** Caught every rav in a quick volley. {n} is how many. */
  allCaught: { title: 'ALL {n}!', lines: ['NICE HANDS.', 'CLEAN.', 'NOT ONE ON THE FLOOR.', 'FROZEN SOLID. CAUGHT SOLID.', 'MATT DIDN’T EVEN SEE THAT.'] },
  /** A basket holds exactly what the tickets need. */
  nailed: { title: 'NAILED IT', lines: ['{n} {flavor}. EXACTLY.', 'COUNTED LIKE A PRO.', 'NOT ONE EXTRA.'] },
  /** Fryer: pulled a basket that's all perfect. */
  perfectPull: { title: 'GOLDEN!', lines: ['PULLED IT PERFECT.', 'TOASTED. NOT ROASTED.', 'THAT’S THE COLOR.'] },
  /** Fryer: pulled right as the timer went off. */
  onTheBeep: { title: 'ON THE BEEP', lines: ['RIGHT ON TIME.', 'BEEP. PULL. DONE.'] },
  /** Fryer: one basket covering two or more orders. */
  batched: { title: 'BATCHED!', lines: ['{n} TICKETS, ONE BASKET.', 'WORK SMARTER.', 'MATT LIKES MATH.'] },
  /** Table: a box that went out perfect and fully dressed. */
  plated: { title: 'PLATED!', lines: ['THAT’S A PICTURE.', 'POST THAT ONE.', 'NONNA WOULD CRY.', 'CHEF’S KISS.'] },
  /** Table: a whole ticket out clean, in a streak. */
  streak: { title: '{n} IN A ROW', lines: ['KEEP COOKING.', 'THE LINE IS YOURS.', 'MATT IS SPEECHLESS.'] },
  /** Under ALL 6! when you also landed the exact count. */
  bothLine: 'AND NAILED THE COUNT.',
  /** How long a stamp stays up, seconds. */
  showSeconds: 1.1,
};
