import type { FlavorId } from '../config/flavors';

export type Phase = 'title' | 'playing' | 'paused' | 'over';

export type Quality = 'cold' | 'ok' | 'perfect' | 'burnt' | 'popped';

export interface Ticket {
  id: number;
  flavor: FlavorId;
  count: number;
  /** Game time the ticket printed. */
  bornAt: number;
  /** Seconds it waits before expiring. */
  life: number;
}

export interface Basket {
  id: number;
  flavor: FlavorId;
  count: number;
  /** Heat-scaled seconds spent in the oil. Frozen once pulled. */
  cooked: number;
  /** Fryer index the basket was (last) cooked in, for window scaling. */
  fryer: number;
  /** Quality locked in at pull time. Null while raw or still in the oil. */
  pulledAs: Quality | null;
}

export type GameEvent =
  | { type: 'ticketArrived'; ticket: Ticket }
  | { type: 'ticketExpired'; ticket: Ticket }
  | { type: 'rejected'; quality: 'cold' | 'burnt' | 'popped'; basket: Basket }
  | { type: 'served'; quality: 'perfect' | 'ok'; points: number; tip: number; combo: number }
  | { type: 'tossed'; basket: Basket }
  | { type: 'bigCombo'; combo: number }
  | { type: 'hint'; text: string }
  | { type: 'gameOver'; score: number; best: number };
