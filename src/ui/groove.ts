import { GROOVE } from '../config/groove';
import { perc } from './feel';

/** A kitchen event, as much of it as the groove reads. */
interface Ev {
  type: string;
  perfect?: boolean;
  quality?: string;
  wrongSauce?: boolean;
  missingSauce?: boolean;
  uneven?: boolean;
  flavor?: string | null;
  reason?: string;
}

/**
 * The groove. It listens to everything the kitchen does, keeps a meter of how the shift is going,
 * and plays it back as percussion: each action's fuller sound (louder the higher the meter, and
 * walked through a pattern when you repeat it fast, so six ravs out of the freezer is a roll, not
 * six of the same hit), over a bed that comes in by layers. Nothing here scores; it only reflects.
 */
export class Groove {
  /** The meter, 0..1. */
  level = 0;
  /** Game time until which the groove layer is silent (after sending out the wrong order, say). */
  silentUntil = 0;
  /** Actions a second lately. */
  pace = 0;
  /** This run: [seconds, what] for everything read. */
  log: [number, string][] = [];
  private phase = 0;
  private time = 0;
  private rolls = new Map<string, { i: number; at: number }>();
  private recent: number[] = [];
  private lastLoss = new Map<string, number>();

  reset() {
    this.level = 0;
    this.silentUntil = 0;
    this.pace = 0;
    this.phase = 0;
    this.time = 0;
    this.log = [];
    this.rolls.clear();
    this.recent = [];
    this.lastLoss.clear();
  }

  get silent() {
    return this.time < this.silentUntil;
  }

  /** How loud the groove layer is right now, 0..1. */
  private get mix() {
    return this.silent ? 0 : this.level;
  }

  /** Seconds from now to the next sixteenth of the bed (0 if we're on one). */
  private toGrid() {
    const p = this.phase * 4;
    const f = p - Math.floor(p);
    return f < 0.18 ? 0 : ((1 - f) * 60) / GROOVE.bpm / 4;
  }

  /** Advance the clock by dt seconds of shift, and play the bed. */
  update(dt: number, time: number) {
    this.time = time;
    while (this.recent.length && this.recent[0]! < time - GROOVE.paceWindow) this.recent.shift();
    this.pace = this.recent.length / GROOVE.paceWindow;
    const was = Math.floor(this.phase * 4);
    this.phase += (dt * GROOVE.bpm) / 60;
    const now = Math.floor(this.phase * 4);
    if (now === was) return;
    const L = this.mix;
    const [l1 = 0.2, l2 = 0.45, l3 = 0.7] = GROOVE.layers;
    if (L < l1) return;
    const s = now % 16;
    const v = (0.35 + 0.65 * L) * GROOVE.volume;
    // Shaker on the eighths (and the sixteenths between, when your hands are flying).
    if (s % 2 === 0) perc.shaker(v * (s % 4 === 0 ? 0.5 : 0.32));
    else if (this.pace > GROOVE.busyPace) perc.shaker(v * 0.2);
    if (L >= l2) {
      if (s === 0 || s === 8 || (s === 10 && L >= l3)) perc.kick(v * (s === 0 ? 0.9 : 0.65));
      if (s === 4 || s === 12) perc.rim(v * 0.6);
    }
    if (L >= l3) {
      const conga: Record<number, number> = { 3: 233, 6: 196, 7: 233, 11: 262, 14: 196, 15: 262 };
      if (conga[s]) perc.conga(conga[s]!, v * 0.4);
      if (s === 2 || s === 10) perc.cowbell(v * 0.25);
    }
  }

  /** Something happened in the kitchen. */
  on(ev: Ev) {
    const G = GROOVE;
    // What it was: an action or completion (and how good), or a blunder.
    let key: string | null = null;
    let loss: string | null = null;
    switch (ev.type) {
      case 'pulled':
        if (ev.perfect) key = 'pulledPerfect';
        else loss = 'pulledBad';
        break;
      case 'sauced':
        key = ev.perfect ? 'saucedPerfect' : 'sauced';
        break;
      case 'served':
        if (ev.wrongSauce || ev.missingSauce || ev.uneven) loss = 'servedFlawed';
        key = ev.quality === 'perfect' && !loss ? 'servedPerfect' : 'served';
        break;
      case 'spill':
      case 'overCount':
      case 'dead':
      case 'greasy':
      case 'noName':
      case 'rejected':
        // The wrong order going out is the big one; something burnt or short coming back is a lesser sin; raw chicken has its own.
        loss = ev.reason === 'wrongorder' ? 'rejected' : ev.reason === 'raw' ? null : 'sentBack';
        break;
      case 'ticketExpired':
      case 'freezerBeep':
      case 'healthCode':
        loss = ev.type;
        break;
      default:
        if (ev.type in G.gain) key = ev.type;
    }
    if (!key && !loss) return;
    if (G.record && this.log.length < G.recordMax) this.log.push([Math.round(this.time * 10) / 10, loss ? `!${loss}` : (key as string)]);
    if (loss) {
      // More of the same at once is worse, though each one after the first costs less than the first.
      const last = this.lastLoss.get(loss) ?? -99;
      this.lastLoss.set(loss, this.time);
      this.level = Math.max(0, this.level - (G.loss[loss] ?? 0) * (this.time - last < G.lossGap ? G.lossRepeat : 1));
      const quiet = G.silence[loss];
      if (quiet) this.silentUntil = Math.max(this.silentUntil, this.time + quiet);
      if (!key) return;
    }
    if (!key) return;
    if (!loss) this.level = Math.min(1, this.level + (G.gain[key] ?? 0));
    this.recent.push(this.time);
    // Its fuller sound, as loud as the groove is high, on the bed's grid.
    const sound = G.voices[key] ?? G.voices[key.replace('Perfect', '')];
    const mix = this.mix * G.volume;
    if (!sound || mix < 0.02) return;
    const roll = this.rolls.get(key);
    const i = roll && this.time - roll.at < G.rollGap ? roll.i + 1 : 0;
    this.rolls.set(key, { i, at: this.time });
    // Big food sounds big: the tuned drums drop in pitch with the size of what you're handling.
    const tuned = sound.voice === 'conga' || sound.voice === 'tom' || sound.voice === 'block';
    const step = (sound.steps[i % sound.steps.length] ?? 1) * (tuned ? (G.size[ev.flavor ?? ''] ?? 1) : 1);
    const d = this.toGrid();
    switch (sound.voice) {
      case 'conga':
        perc.conga(step, mix, d);
        break;
      case 'block':
        perc.block(step, mix * 0.8, d);
        break;
      case 'tom':
        perc.tom(step, mix, d);
        break;
      case 'kick':
        perc.kick(mix * step, d);
        break;
      case 'snare':
        perc.snare(mix * step, d);
        break;
      case 'rim':
        perc.rim(mix * step, d);
        break;
      case 'shaker':
        perc.shaker(mix * step * 0.8, d);
        break;
      case 'cowbell':
        perc.cowbell(mix * step * 0.7, d);
        break;
      case 'crash': {
        perc.crash(mix * 0.8, d);
        perc.kick(mix, d);
        // A perfect one gets a fill down the toms.
        if (key === 'servedPerfect') {
          const six = 60 / G.bpm / 4;
          [196, 165, 131].forEach((hz, n) => perc.tom(hz, mix * 0.9, d + six * (n + 1)));
        }
        break;
      }
    }
  }
}
