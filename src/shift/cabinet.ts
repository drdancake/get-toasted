import { CABINET } from '../config/cabinet';

const KEY = 'get-toasted.cabinet';

/**
 * Coins and credits. With the gate off (the default) every run is free. With it on, a run costs a
 * credit, a coin buys credits, and the start screen says where the money goes.
 */
export class Cabinet {
  gate = CABINET.gateDefault;
  credits = 0;
  cause = CABINET.cause;
  /** Coins dropped since the gate went on, for staff to check against the jar. */
  coins = 0;
  private listeners: (() => void)[] = [];
  private padWas = false;

  constructor() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Cabinet> | null;
      if (saved) {
        this.gate = !!saved.gate;
        this.cause = saved.cause || CABINET.cause;
        this.coins = saved.coins ?? 0;
        this.credits = saved.credits ?? 0;
      }
    } catch {
      /* no storage: defaults */
    }
    window.addEventListener('keydown', (e) => {
      if (CABINET.coinKeys.includes(e.key)) this.insertCoin();
    });
    const poll = () => {
      // An arcade encoder shows up as a gamepad; the coin switch is one of its buttons.
      const pads = navigator.getGamepads?.() ?? [];
      let down = false;
      for (const p of pads) if (p?.buttons[CABINET.coinGamepadButton]?.pressed) down = true;
      if (down && !this.padWas) this.insertCoin();
      this.padWas = down;
      requestAnimationFrame(poll);
    };
    requestAnimationFrame(poll);
  }

  onChange(fn: () => void) {
    this.listeners.push(fn);
  }

  /** Can a run start right now? */
  get canPlay() {
    return !this.gate || this.credits > 0;
  }

  insertCoin() {
    this.coins++;
    this.credits += CABINET.creditsPerCoin;
    this.changed();
  }

  /** Spend a credit to start a run. Free when the gate is off. */
  useCredit() {
    if (!this.gate) return true;
    if (this.credits <= 0) return false;
    this.credits--;
    this.changed();
    return true;
  }

  setGate(on: boolean) {
    this.gate = on;
    if (!on) this.credits = 0;
    this.changed();
  }

  setCause(text: string) {
    this.cause = text.trim() || CABINET.cause;
    this.changed();
  }

  private changed() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ gate: this.gate, cause: this.cause, coins: this.coins, credits: this.credits }));
    } catch {
      /* no storage */
    }
    for (const fn of this.listeners) fn();
  }
}
