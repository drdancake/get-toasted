// The pulse: quiet percussion under the shift (no notes, so it can't be out of key with whatever
// the lobby is playing), and a small bonus for doing things on it.

export const BEAT = {
  /** Beats a minute when the shift starts, how much it picks up per minute of difficulty, and where it tops out. */
  bpm: 92,
  bpmPerMinute: 3,
  bpmMax: 120,
  /** While the place is viral the tempo is multiplied by this. */
  viralTempo: 1.12,
  /** How loud the drums are (0..1, under the kitchen sounds). */
  volume: 0.5,
  /** An action this close to a beat (seconds, either side) is on it. */
  window: 0.085,
  /** Points for an action on the beat (times the multiplier), and the extra for each one in a row, up to a cap. */
  points: 25,
  streakPoints: 5,
  streakMax: 8,
  /** The things you do that can land on the beat. */
  actions: ['drop', 'lift', 'expo', 'toss', 'served'] as readonly string[],
  /** Where the operator's music switch is remembered on this machine. */
  key: 'get-toasted.music',
};
