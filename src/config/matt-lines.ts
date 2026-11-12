// Matt's lines. Add a line by adding a string to the right list. Nothing else
// needs to change. One line is picked at random each time he pops up.

export type MattMood = 'cold' | 'burnt' | 'bigCombo' | 'dropped' | 'short' | 'mixed' | 'wrongorder' | 'forgot' | 'money' | 'nosauce' | 'burst' | 'salty' | 'generous';

export const MATT_LINES: Record<MattMood, string[]> = {
  cold: [
    'Those are frozen, bud.',
    'Did those even touch the oil?',
    'Ah. The Louisa box special.',
  ],
  burnt: [
    'Wow. Great work.',
    "That's not toasted. That's cremated.",
    'Cool. We sell charcoal now.',
  ],
  /** Left in the oil so long the filling came out the seam. */
  burst: [
    'The filling goes on the inside, bud.',
    'That one exploded. Very cool.',
    'Crime scene in a box.',
  ],
  /** Gooey butter went through the salt bowl. */
  salty: [
    'Who salted the dessert?',
    "Gooey butter. Not gooey salt.",
  ],
  /** Threw in an extra rav for the guest. */
  generous: [
    'Generous. With my money.',
    "Fine. They'll come back. Probably.",
  ],
  bigCombo: [
    'Okay. Okay okay okay.',
    'Huh. Stay toasted, I guess.',
  ],
  /** A rav hit the counter or the oil. */
  dropped: [
    'That one had a family.',
    "Floor's not on the menu, bud.",
    'Somebody hand-made that.',
  ],
  /** Served fewer ravs than the ticket asked for. */
  short: [
    "Count 'em again.",
    'They paid for the whole order.',
  ],
  /** A whole box of the wrong thing. */
  wrongorder: [
    "That's not what they ordered.",
    'Read the ticket, bud.',
  ],
  /** A box went out without its sauce. */
  nosauce: [
    'Where is the sauce, bud?',
    'They are going to call about that.',
  ],
  /** A pile of product in the trash. */
  money: [
    "That's my money, bud.",
    'I can hear the register crying.',
    "That's coming out of something.",
  ],
  /** Left a basket in the freezer. */
  forgot: [
    'Lose something?',
    'Check the walk-in.',
  ],
  /** Two flavors in one basket. */
  mixed: [
    'Which one of those is the buffalo?',
    'Good luck telling those apart.',
  ],
};
