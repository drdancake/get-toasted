// Keeping the player trucking. Whenever the game knows what the next move is and it hasn't happened
// for a while, the big word slams down again with its hand demo, and Matt says something about it.
// Add a line by adding a string; one is picked at random and they don't repeat back to back.

import type { Gesture } from '../ui/prompt';

export const NUDGE = {
  /** Seconds stalled on a step before the first nudge, and between nudges after that. */
  after: 6,
  every: 8,
};

export type NudgeKey = 'pull' | 'toBowl' | 'plate' | 'drop' | 'freezer' | 'box' | 'pour' | 'salt' | 'toss' | 'intoBox' | 'cook';

export const NUDGES: Record<NudgeKey, { word: string; gesture?: Gesture; lines: string[] }> = {
  /** Caught up: everything's frying and there's nothing to grab. (Cup some cold sauce while you wait.) */
  cook: {
    word: 'LET ’EM COOK',
    lines: ['Caught up? Cup some ranch for later.', 'Nothing to do. Suspicious. Make some cups.', 'Good. Now get ahead: the cold table’s right there.', 'Let ’em cook. You, cup sauce.'],
  },
  /** Something in the oil is done. */
  pull: {
    word: 'PULL IT!',
    gesture: 'pull',
    lines: ['Those are done, bud.', 'They don’t get more golden. They get black.', 'The oil is not a hot tub.'],
  },
  /** A basket is drained and hanging. */
  toBowl: {
    word: 'TO THE BOWL!',
    gesture: 'drag',
    lines: ['They’re drained. They’re bored.', 'The bowl’s right there.', 'Hanging ravs don’t sell.'],
  },
  /** Ravs are sitting in the bowl or a box. */
  plate: {
    word: 'BACK TO THE BOWL!',
    gesture: 'tap',
    lines: ['You left something in the bowl.', 'Somebody’s lunch is getting cold.', 'Finish what you started.'],
  },
  /** A raw basket is hanging over a free fryer. */
  drop: {
    word: 'DROP IT!',
    gesture: 'tap',
    lines: ['Frozen ravs. Hot oil. You see where this goes.', 'They won’t cook up there.', 'Tap the basket. Science does the rest.'],
  },
  /** An order nobody has started. */
  freezer: {
    word: 'FREEZER!',
    gesture: 'tap',
    lines: ['Tickets don’t cook themselves.', 'There’s an order up. Just saying.', 'Ravs live in the freezer, bud.'],
  },
  /** Things are frying and an order has no box yet. */
  box: {
    word: 'GRAB A BOX!',
    gesture: 'tap',
    lines: ['Nice of you to watch them fry. Get a box.', 'Box now. Thank me later.', 'Standing there is not a station.'],
  },
  /** At the bowl, basket in hand. */
  pour: {
    word: 'POUR!',
    gesture: 'drag',
    lines: ['Tip it. Into the bowl.', 'The bowl is the round thing.', 'They’re not going to jump.'],
  },
  salt: {
    word: 'SALT!',
    gesture: 'shake',
    lines: ['Salt. The shaker. Shake it.', 'Unsalted. Like a hospital.', 'A little salt never hurt anyone. Legally.'],
  },
  toss: {
    word: 'TOSS!',
    gesture: 'toss',
    lines: ['Give it a toss.', 'Side to side. Like you mean it.', 'The salt’s all on one rav.'],
  },
  intoBox: {
    word: 'INTO THE BOX!',
    gesture: 'pour',
    lines: ['Bowl. Box. Go.', 'Hold it over the box. Gravity’s free.', 'They ordered a box, not a bowl.'],
  },
};
