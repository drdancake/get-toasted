import { ACTIVE_FLAVORS, FLAVORS, type FlavorId } from '../config/flavors';
import { BEST_SCORE_KEY, FRYERS, PATIENCE, SCORING, SLOTS_PER_FRYER, TICKETS } from '../config/game';
import { isFailure, qualityAt } from './doneness';
import type { Basket, GameEvent, Phase, Ticket } from './types';

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/**
 * The whole fryer station as plain state. No rendering, no DOM.
 * Call update(dt) every frame and the tap* methods from input; drain
 * `events` afterwards for things the UI should react to.
 */
export class Game {
  phase: Phase = 'title';
  time = 0;
  score = 0;
  best = 0;
  combo = 0;
  patience = PATIENCE.max;
  tickets: Ticket[] = [];
  /** Fryer slots, row-major: slot i is fryer floor(i / SLOTS_PER_FRYER). */
  slots: (Basket | null)[] = [];
  /** The one basket you can carry. Raw from the freezer, or pulled from the oil. */
  hand: Basket | null = null;
  events: GameEvent[] = [];

  private nextTicketAt = 0;
  private nextId = 1;

  constructor() {
    this.best = loadBest();
    this.slots = new Array(FRYERS.length * SLOTS_PER_FRYER).fill(null);
  }

  get slotCount() {
    return this.slots.length;
  }

  fryerOf(slot: number) {
    return Math.floor(slot / SLOTS_PER_FRYER);
  }

  start() {
    this.time = 0;
    this.score = 0;
    this.combo = 0;
    this.patience = PATIENCE.max;
    this.tickets = [];
    this.slots.fill(null);
    this.hand = null;
    this.events = [];
    this.nextTicketAt = TICKETS.firstArrival;
    this.phase = 'playing';
  }

  pause() {
    if (this.phase === 'playing') this.phase = 'paused';
  }

  resume() {
    if (this.phase === 'paused') this.phase = 'playing';
  }

  update(dt: number) {
    if (this.phase !== 'playing') return;
    this.time += dt;

    for (let i = 0; i < this.slots.length; i++) {
      const b = this.slots[i];
      if (b) b.cooked += dt * (FRYERS[this.fryerOf(i)]?.heat ?? 1);
    }

    for (const t of [...this.tickets]) {
      if (this.time - t.bornAt >= t.life) {
        this.tickets.splice(this.tickets.indexOf(t), 1);
        this.events.push({ type: 'ticketExpired', ticket: t });
        this.losePatience(PATIENCE.expiredTicket);
      }
    }

    if (this.time >= this.nextTicketAt && this.tickets.length < TICKETS.railMax) {
      this.spawnTicket();
      this.nextTicketAt = this.time + this.ticketInterval();
    }

    if (this.patience <= 0 && this.phase === 'playing') this.gameOver();
  }

  /** Tap a flavor on the freezer strip: load a basket, or put a raw one back. */
  tapFlavor(flavor: FlavorId) {
    if (this.phase !== 'playing') return;
    if (this.hand) {
      if (this.hand.cooked === 0 && this.hand.flavor === flavor) {
        this.hand = null; // back in the freezer
      } else {
        this.hint('Hands full');
      }
      return;
    }
    const oldest = this.tickets.find((t) => t.flavor === flavor);
    const count = oldest?.count ?? FLAVORS[flavor].sizes[0] ?? 6;
    this.hand = { id: this.nextId++, flavor, count, cooked: 0, fryer: 0, pulledAs: null };
  }

  /** Tap a fryer slot: drop the raw basket in hand, or pull the basket that is there. */
  tapSlot(slot: number) {
    if (this.phase !== 'playing') return;
    const here = this.slots[slot];
    if (here) {
      if (this.hand) {
        this.hint('Hands full');
        return;
      }
      this.slots[slot] = null;
      const q = qualityAt(here.cooked, here.flavor, here.fryer);
      here.pulledAs = q;
      if (isFailure(q)) {
        this.combo = 0;
        this.losePatience(PATIENCE.rejectedBasket);
        this.events.push({ type: 'rejected', quality: q, basket: here });
      } else {
        this.hand = here;
      }
      return;
    }
    if (!this.hand) {
      this.hint('Load a basket first');
      return;
    }
    if (this.hand.cooked > 0) {
      this.hint('Serve that first');
      return;
    }
    this.hand.fryer = this.fryerOf(slot);
    this.slots[slot] = this.hand;
    this.hand = null;
  }

  /** Tap Serve: send the pulled basket to the oldest matching ticket. */
  serve() {
    if (this.phase !== 'playing') return;
    const b = this.hand;
    if (!b || b.pulledAs === null) {
      this.hint(b ? 'Those are still frozen' : 'Nothing to serve');
      return;
    }
    const ticket =
      this.tickets.find((t) => t.flavor === b.flavor && t.count === b.count) ??
      this.tickets.find((t) => t.flavor === b.flavor);
    this.hand = null;
    if (!ticket) {
      this.combo = 0;
      this.events.push({ type: 'tossed', basket: b });
      this.hint('No ticket for that');
      return;
    }
    this.tickets.splice(this.tickets.indexOf(ticket), 1);

    const quality = b.pulledAs === 'perfect' ? 'perfect' : 'ok';
    const ravs = Math.min(b.count, ticket.count);
    const points = ravs * (quality === 'perfect' ? SCORING.perfectPerRav : SCORING.okPerRav);
    if (quality === 'perfect') this.combo += 1;
    const multiplier = clamp(this.combo, 1, SCORING.comboCap);
    const remaining = Math.max(0, ticket.life - (this.time - ticket.bornAt));
    const tip = Math.round(remaining * SCORING.tipPerSecond * multiplier);
    this.score += points + tip;
    this.events.push({ type: 'served', quality, points, tip, combo: this.combo });

    if (quality === 'perfect') {
      if (this.combo >= PATIENCE.healAtCombo) {
        this.patience = clamp(this.patience + PATIENCE.healAmount, 0, PATIENCE.max);
      }
      const past = this.combo - SCORING.bigComboAt;
      if (past >= 0 && past % SCORING.bigComboEvery === 0) {
        this.events.push({ type: 'bigCombo', combo: this.combo });
      }
    }
  }

  private hint(text: string) {
    this.events.push({ type: 'hint', text });
  }

  private losePatience(n: number) {
    this.patience = clamp(this.patience - n, 0, PATIENCE.max);
  }

  private gameOver() {
    this.phase = 'over';
    if (this.score > this.best) {
      this.best = this.score;
      saveBest(this.best);
    }
    this.events.push({ type: 'gameOver', score: this.score, best: this.best });
  }

  private minutes() {
    return this.time / 60;
  }

  private ticketInterval() {
    return Math.max(TICKETS.intervalMin, TICKETS.intervalStart - TICKETS.intervalDropPerMinute * this.minutes());
  }

  private ticketLife() {
    return Math.max(TICKETS.lifeMin, TICKETS.lifeStart - TICKETS.lifeDropPerMinute * this.minutes());
  }

  private spawnTicket() {
    const flavor = ACTIVE_FLAVORS[Math.floor(Math.random() * ACTIVE_FLAVORS.length)] ?? 'beef';
    const sizes = FLAVORS[flavor].sizes;
    const bigChance = Math.min(
      TICKETS.bigOrderChanceMax,
      TICKETS.bigOrderChanceStart + TICKETS.bigOrderRampPerMinute * this.minutes(),
    );
    const count = (Math.random() < bigChance ? sizes[sizes.length - 1] : sizes[0]) ?? 6;
    const ticket: Ticket = { id: this.nextId++, flavor, count, bornAt: this.time, life: this.ticketLife() };
    this.tickets.push(ticket);
    this.events.push({ type: 'ticketArrived', ticket });
  }
}

function loadBest(): number {
  try {
    return Number(localStorage.getItem(BEST_SCORE_KEY) ?? 0) || 0;
  } catch {
    return 0;
  }
}

function saveBest(n: number) {
  try {
    localStorage.setItem(BEST_SCORE_KEY, String(n));
  } catch {
    /* private mode, no storage: the run still counts */
  }
}
