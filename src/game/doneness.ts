import { FLAVORS, type FlavorId, EARLY_PERFECT } from '../config/flavors';
import { FRYERS, RAMP } from '../config/game';
import type { Quality } from './types';

/** The timing landmarks for a flavor in a given fryer, in heat-scaled seconds. */
export function landmarks(flavor: FlavorId, fryer: number) {
  const f = FLAVORS[flavor];
  const scale = FRYERS[fryer]?.windowScale ?? 1;
  // (A few seconds early is close enough to perfect: see EARLY_PERFECT.)
  const windowOpen = f.cook - Math.min(f.okBefore, EARLY_PERFECT);
  const windowClose = f.cook + f.window * scale;
  return {
    okOpen: windowOpen - f.okBefore,
    windowOpen,
    windowClose,
    fail: windowClose + f.okAfter,
    black: windowClose + f.okAfter + RAMP.blackAfterFail,
  };
}

/** Quality if the basket were pulled right now. */
export function qualityAt(cooked: number, flavor: FlavorId, fryer: number): Quality {
  const l = landmarks(flavor, fryer);
  if (cooked < l.okOpen) return 'cold';
  if (cooked < l.windowOpen) return 'ok';
  if (cooked <= l.windowClose) return 'perfect';
  if (cooked <= l.fail) return 'ok';
  return FLAVORS[flavor].lateFailure;
}

/**
 * Visual doneness 0..1 for the shader ramp:
 * 0 raw, 0.5 gold (window opens), 0.65 deep gold (window closes),
 * 0.85 burnt (fail), 1 black.
 */
export function donenessAt(cooked: number, flavor: FlavorId, fryer: number): number {
  const l = landmarks(flavor, fryer);
  const seg = (t: number, a: number, b: number, da: number, db: number) =>
    da + ((t - a) / Math.max(b - a, 1e-6)) * (db - da);
  if (cooked <= 0) return 0;
  if (cooked < l.windowOpen) return seg(cooked, 0, l.windowOpen, 0, 0.5);
  if (cooked < l.windowClose) return seg(cooked, l.windowOpen, l.windowClose, 0.5, 0.65);
  if (cooked < l.fail) return seg(cooked, l.windowClose, l.fail, 0.65, 0.85);
  if (cooked < l.black) return seg(cooked, l.fail, l.black, 0.85, 1);
  return 1;
}

export function isFailure(q: Quality): q is 'cold' | 'burnt' | 'popped' {
  return q === 'cold' || q === 'burnt' || q === 'popped';
}
