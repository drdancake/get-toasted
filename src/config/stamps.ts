// The WarioWare layer: big stamped words that slam onto the screen when you do
// something great. Add a line by adding a string; one is picked at random.

export const STAMPS = {
  /** Caught every rav in a quick volley. {n} is how many. */
  allCaught: { title: 'ALL {n}!', lines: ['NICE HANDS.', 'CLEAN.', 'NOT ONE ON THE FLOOR.', 'FROZEN SOLID. CAUGHT SOLID.', 'MATT DIDN’T EVEN SEE THAT.'] },
  /** A basket holds exactly what the tickets need. */
  nailed: { title: 'NAILED IT', lines: ['{n} {flavor}. EXACTLY.', 'COUNTED LIKE A PRO.', 'NOT ONE EXTRA.'] },
  /** Under ALL 6! when you also landed the exact count. */
  bothLine: 'AND NAILED THE COUNT.',
  /** How long a stamp stays up, seconds. */
  showSeconds: 1.1,
};
