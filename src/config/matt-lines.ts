// Matt's lines. Add a line by adding a string to the right list. Nothing else
// needs to change. One line is picked at random each time he pops up.

export type MattMood = 'cold' | 'burnt' | 'bigCombo';

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
  bigCombo: [
    'Okay. Okay okay okay.',
    'Huh. Stay toasted, I guess.',
  ],
};
