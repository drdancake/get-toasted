import { QUALITY } from '../config/quality';

/**
 * Keeps the frame rate up by choosing the resolution. Feed it every frame's real duration; ask
 * it for the pixel ratio to draw at. It only ever picks from QUALITY.ratios.
 */
export class Quality {
  /** The ratios this screen can use, sharpest first. */
  private steps: number[];
  private i = 0;
  /** Frames a second lately (a moving average), and the worst frame in the last window, ms. */
  fps = 60;
  worst = 0;
  private acc = 0;
  private frames = 0;
  private since = 0;
  private goodFor = 0;
  private quiet = 0;
  private roseAt = -99;
  private clock = 0;
  /** A step it tried and fell straight back from: it won't go sharper than this again. */
  private ceiling = 0;
  /** Tests can pin it. */
  locked = false;
  onChange: (() => void) | null = null;

  constructor() {
    const top = Math.min(window.devicePixelRatio || 1, QUALITY.ratios[0] ?? 2);
    this.steps = [top, ...QUALITY.ratios.filter((r) => r < top)];
  }

  get ratio() {
    return this.steps[this.i] ?? 1;
  }

  lock(ratio: number) {
    this.locked = true;
    const j = this.steps.findIndex((r) => r <= ratio);
    this.i = j < 0 ? this.steps.length - 1 : j;
    this.onChange?.();
  }

  /** One frame took this long (seconds). Hidden tabs and hitches from a wipe or a load are ignored. */
  feed(dt: number) {
    if (this.locked || dt <= 0 || dt > 0.25 || document.hidden) return;
    this.clock += dt;
    this.acc += dt;
    this.frames++;
    this.worst = Math.max(this.worst, dt * 1000);
    this.since += dt;
    if (this.since < QUALITY.every) return;
    const fps = this.frames / this.acc;
    this.fps = fps;
    this.acc = 0;
    this.frames = 0;
    this.since = 0;
    this.worst = 0;
    if (this.quiet > 0) {
      this.quiet -= QUALITY.every;
      return;
    }
    if (fps < QUALITY.dropBelow && this.i < this.steps.length - 1) {
      // Fell straight back after stepping up: that sharper step is off the table.
      if (this.clock - this.roseAt < QUALITY.bounce) this.ceiling = this.i + 1;
      this.i++;
      this.goodFor = 0;
      this.quiet = QUALITY.settle;
      this.onChange?.();
    } else if (fps > QUALITY.riseAbove && this.i > this.ceiling) {
      this.goodFor += QUALITY.every;
      if (this.goodFor >= QUALITY.riseAfter) {
        this.i--;
        this.goodFor = 0;
        this.quiet = QUALITY.settle;
        this.roseAt = this.clock;
        this.onChange?.();
      }
    } else this.goodFor = 0;
  }
}

/** One for the whole game: the fryers, the sauce tables and the plating view all draw at its ratio. */
export const quality = new Quality();
