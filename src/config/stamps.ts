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
  /** A whole ticket out fast and perfect: the guest by name. */
  bigTip: { title: '{name} TIPPED BIG!', lines: ['+{tip}. THEY LOVE YOU.', '{name} WILL BE BACK.', '{name} TOLD THEIR FRIENDS.'] },
  /** A box sent back: the guest by name. */
  hatesYou: { title: '{name} HATES YOU NOW', lines: ['{why}.', '{why}. ONE STAR.', '{why}. THEY’RE CALLING.'] },
  /** A cup off the ladle right on the line. */
  sauced: { title: 'SAUCED!', lines: ['RIGHT ON THE LINE.', 'NOT A DRIP.', 'LIDDED.'] },
  /** Poured from the bowl into a box and stopped right on the count. */
  onCount: { title: 'ON THE COUNT!', lines: ['{n}. EXACTLY.', 'STOPPED ON A DIME.', 'NOT ONE OVER.'] },
  /** Poured way past the count. */
  tooMany: { title: 'WHOA, WHOA', lines: ['{n} TOO MANY.', 'THAT’S MATT’S MONEY.', 'EASE OFF THE TIP.'] },
  /** Box close-up: set in the house layout. */
  houseStyle: { title: 'HOUSE STYLE', lines: ['THREE, TWO, ONE.', 'THE WAY WE DO IT.', 'TEXTBOOK.'] },
  /** A box went out with no readable name while other tickets were up. */
  noName: { title: 'WRONG GUEST!', lines: ['NO NAME. {other} WALKED OFF WITH IT.', '{name}’S BOX WENT TO {other}.', 'REMAKE IT FOR {name}. NOW.'] },
  /** No readable name, but it found its guest anyway. */
  silly: { title: 'WHOSE IS THIS?', lines: ['NO NAME. {name} HAD TO ASK.', 'THEY SHOUTED IT ACROSS THE LOBBY.', '{name} GOT IT. EVENTUALLY.'] },
  /** Under ALL 6! when you also landed the exact count. */
  bothLine: 'AND NAILED THE COUNT.',
  /** How long a stamp stays up, seconds. */
  showSeconds: 1.1,
};
