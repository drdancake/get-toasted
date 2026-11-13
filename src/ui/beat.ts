import { BEAT } from '../config/beat';
import { drums } from './feel';

/**
 * The shift's pulse. It keeps time in beats (so the tempo can drift up without a hiccup), plays a
 * bar of quiet percussion in eighth notes, and says whether right now is on a beat.
 */
export class Beat {
  /** Beats since the shift started. */
  phase = 0;
  bpm = BEAT.bpm;
  /** On-beat actions in a row. */
  streak = 0;
  /** Quarter beats played (for tests). */
  hits = 0;
  /** The drums. The operator's switch; the pulse still runs (and still scores) with them off. */
  music = true;

  constructor() {
    try {
      this.music = localStorage.getItem(BEAT.key) !== 'off';
    } catch {
      /* no storage */
    }
  }

  setMusic(on: boolean) {
    this.music = on;
    try {
      localStorage.setItem(BEAT.key, on ? 'on' : 'off');
    } catch {
      /* no storage */
    }
  }

  reset() {
    this.phase = 0;
    this.streak = 0;
    this.hits = 0;
  }

  /** Advance by dt seconds at this tempo. True on the frame a quarter beat lands. */
  step(dt: number, minutes: number, viral: boolean) {
    this.bpm = Math.min(BEAT.bpmMax, BEAT.bpm + BEAT.bpmPerMinute * minutes) * (viral ? BEAT.viralTempo : 1);
    const was = this.phase;
    this.phase += (dt * this.bpm) / 60;
    // Eighth notes: kick on one and three, a rim click on two and four, a shaker between.
    const e0 = Math.floor(was * 2);
    const e1 = Math.floor(this.phase * 2);
    if (e1 === e0) return false;
    const eighth = e1 % 8;
    if (this.music) {
      if (eighth === 0) drums.kick(1);
      else if (eighth === 4) drums.kick(0.7);
      else if (eighth === 2 || eighth === 6) drums.rim();
      else drums.shaker();
    }
    if (e1 % 2) return false;
    this.hits++;
    return true;
  }

  /** Seconds to the nearest beat. */
  off() {
    const f = this.phase - Math.round(this.phase);
    return Math.abs(f) * (60 / this.bpm);
  }

  /**
   * Something was just done. On the beat: the points it's worth (before the multiplier), and the
   * streak goes up. Off it: 0, and the streak's over.
   */
  hit() {
    if (this.off() > BEAT.window) {
      this.streak = 0;
      return 0;
    }
    this.streak++;
    if (this.music) drums.block();
    return BEAT.points + BEAT.streakPoints * (Math.min(this.streak, BEAT.streakMax) - 1);
  }
}
