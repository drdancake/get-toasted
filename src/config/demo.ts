// The self-playing demo: what the cabinet does when nobody has touched it for a while.

export const DEMO = {
  /** Seconds the title sits untouched before the demo starts, and how long the demo runs before the title comes back. */
  after: 32,
  seconds: 48,
  /** The ghost cook's pace: seconds before the first basket, between baskets, and how long each one fries on screen. */
  firstDrop: 1.2,
  between: 3.2,
  frySeconds: 8,
  /** Seconds a pulled basket drains on its bar, then seconds the box sits on the table before it goes out. */
  drain: 2.4,
  boxed: 1.6,
  /** Seconds a slot rests before the ghost drops another basket in it. */
  rest: 3,
  /** Who the demo's tickets are for. */
  names: ['MATT', 'NOUR', 'WELLA', 'TAJ', 'DAN', 'PETE', 'ROSA', 'GUS'],
};
