// Every tunable number for the core loop. Seconds unless noted.

export interface FryerDef {
  name: string;
  /** Cook speed multiplier. 1 = standard oil. Fryer 3 goes to 1.3 when it runs hot (MVP-2). */
  heat: number;
  /** Perfect-window multiplier. 1 = standard. Hot oil halves it (MVP-2). */
  windowScale: number;
}

export const FRYERS: FryerDef[] = [
  { name: 'FRYER 1', heat: 1, windowScale: 1 },
  { name: 'FRYER 2', heat: 1, windowScale: 1 },
  // The 350° Castle is wings only on the line, so it's not in the game.
];

/** Oil temperature shown on each fryer, °F. */
export const FRYER_TEMPS = [300, 300];

export const SLOTS_PER_FRYER = 2;

export const TICKETS = {
  /** When the first ticket prints after tap-to-start. */
  firstArrival: 1.5,
  /** Seconds between tickets at the start of a shift. */
  intervalStart: 11,
  /** The interval never drops below this. */
  intervalMin: 4.5,
  /** The interval shrinks by this many seconds for every minute survived. */
  intervalDropPerMinute: 1.4,
  /** How long a ticket waits on the rail before it expires, at the start of a shift. */
  lifeStart: 48,
  /** Ticket life never drops below this. */
  lifeMin: 30,
  /** Ticket life shrinks by this many seconds for every minute survived. */
  lifeDropPerMinute: 3,
  /** Most tickets the rail holds. New tickets wait until there is room. */
  railMax: 5,
  /** Chance a ticket asks for the bigger order size at the start of a shift. */
  bigOrderChanceStart: 0.15,
  /** The chance never goes above this. */
  bigOrderChanceMax: 0.6,
  /** The chance grows by this much for every minute survived. */
  bigOrderRampPerMinute: 0.12,
};

export const SCORING = {
  perfectPerRav: 100,
  okPerRav: 50,
  /** Tip per second left on the ticket when it is served, before the combo multiplier. */
  tipPerSecond: 6,
  /** Combo multiplier cap (x5). The multiplier is the number of consecutive perfect tickets. */
  comboCap: 5,
  /** Matt reacts when the combo reaches this... */
  bigComboAt: 4,
  /** ...and again every this-many perfect tickets after. */
  bigComboEvery: 4,
};

export const PATIENCE = {
  max: 5,
  expiredTicket: 1,
  rejectedBasket: 1,
  /** A perfect ticket at this combo or higher heals Matt a little. */
  healAtCombo: 4,
  healAmount: 1,
};

export const RAMP = {
  /** Seconds from the moment a basket is burnt until it looks fully black. Visual only. */
  blackAfterFail: 8,
};

export const MATT = {
  /** How long a Matt line stays on screen. */
  showSeconds: 2.4,
};

export const HINT = {
  showSeconds: 1.2,
};

export const BEST_SCORE_KEY = 'get-toasted.best';

/** Matt only grumbles about a dropped rav this often, so he doesn't nag every bounce. */
export const MATT_DROP_COOLDOWN = 6;
