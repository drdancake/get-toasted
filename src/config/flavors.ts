// Flavor roster. MVP-0 ships OG Beef only; the rest of the real menu
// (Three Cheese, Buffalo Chicken, Lemon Berry Gooey Butter) is added here
// as more rows when MVP-1 opens. Game logic never needs to change for that.
// Timings in seconds, about 10x faster than the real fryer.

export type FlavorId = 'beef';

export type LateFailure = 'burnt' | 'popped';

export interface FlavorDef {
  id: FlavorId;
  name: string;
  /** Seconds in the oil before the perfect window opens. */
  cook: number;
  /** Seconds the perfect window stays open. */
  window: number;
  /** Seconds before the window where a pull is still "ok" (half points) instead of cold. */
  okBefore: number;
  /** Seconds after the window where a pull is still "ok" before it fails. */
  okAfter: number;
  /** What happens when it is left past okAfter. */
  lateFailure: LateFailure;
  /** Order sizes a ticket can ask for, smallest first. */
  sizes: number[];
  /** Placeholder tint for the freezer tile (CSS color). */
  tint: string;
}

export const FLAVORS: Record<FlavorId, FlavorDef> = {
  beef: {
    id: 'beef',
    name: 'OG Beef',
    cook: 13,
    window: 3,
    okBefore: 1.5,
    okAfter: 1.5,
    lateFailure: 'burnt',
    sizes: [6, 10],
    tint: '#b3473a',
  },
};

/** Flavors on the freezer strip this build, left to right. */
export const ACTIVE_FLAVORS: FlavorId[] = ['beef'];
