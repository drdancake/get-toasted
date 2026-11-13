// The pulse: quiet percussion under the shift (no notes, so it can't be out of key with whatever
// the lobby is playing), and a small bonus for doing things on it.

export const BEAT = {
  /**
   * Off. Dan, 2026-11-13: as built it came across abrupt, out of place and unclear how to play.
   * The idea being explored instead is rhythm that comes out of what the player is doing (an
   * adaptive soundtrack). Everything below is kept for that; nothing runs while this is false.
   */
  enabled: false,
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
  points: 250,
  streakPoints: 50,
  streakMax: 8,
  /** The things you do that can land on the beat. */
  actions: ['drop', 'lift', 'expo', 'toss', 'served', 'salt'] as readonly string[],
  /** Quick things you do in a run (popping ravs out of the freezer): these count on the half beats too. */
  quick: ['launch'] as readonly string[],
  /** The groove: this many on the beat in a row is a level, each level adds one to the multiplier, up to this many. A miss halves your run. */
  grooveEvery: 4,
  grooveMax: 3,
  /** Where the operator's music switch is remembered on this machine. */
  key: 'get-toasted.music',
};
