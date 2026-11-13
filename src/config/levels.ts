// The shift starts small and grows. A new hire gets one fryer, two baskets, beef and marinara,
// and nothing else; each thing after that arrives once they've got boxes out the door. Everyone
// starts at the first level every run (it's an arcade cabinet: there are no accounts), and anyone
// who knows the job is through the early ones in a couple of tickets.
//
// `at` is boxes out. `flavors` is how many of the freezer's flavors are on (in freezer order:
// beef, cheese, buffalo, gooey, mozz, parm), so ranch arrives with buffalo, the mascarpone with
// gooey, and the thermometer and tray with the cutlets. `slots` is how many fryer slots are lit
// (two to a fryer).

export interface Level {
  at: number;
  /** What Matt announces when it starts. */
  name: string;
  flavors: number;
  slots: number;
  /** Half-and-half orders. */
  splits: boolean;
  /** Guests asking for a different sauce. */
  subs: boolean;
  /** Tickets with more than one item. */
  multi: boolean;
}

export const LEVELS: Level[] = [
  { at: 0, name: 'FIRST DAY: OG BEEF', flavors: 1, slots: 2, splits: false, subs: false, multi: false },
  { at: 2, name: 'NOW SERVING: CHEESE', flavors: 2, slots: 2, splits: false, subs: false, multi: false },
  { at: 4, name: 'SECOND FRYER’S ON · BUFFALO + RANCH', flavors: 3, slots: 4, splits: false, subs: false, multi: false },
  { at: 7, name: 'DESSERT: GOOEY BUTTER · SPLIT ORDERS', flavors: 4, slots: 4, splits: true, subs: false, multi: true },
  { at: 10, name: 'MOZZARELLA STICKS · SAUCE SWAPS', flavors: 5, slots: 4, splits: true, subs: true, multi: true },
  { at: 13, name: 'CHICKEN PARM: TEMP IT', flavors: 6, slots: 4, splits: true, subs: true, multi: true },
];
