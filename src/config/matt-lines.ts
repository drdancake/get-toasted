// Matt's lines. Add a line by adding a string to the right list. Nothing else
// needs to change. One line is picked at random each time he pops up.

export type MattMood = 'cold' | 'burnt' | 'bigCombo';

export const MATT_LINES: Record<MattMood, string[]> = {
  cold: ['Those are frozen, bud.'],
  burnt: ['Wow. Great work.'],
  bigCombo: ['Okay. Okay okay okay.'],
};
