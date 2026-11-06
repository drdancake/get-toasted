// Screen shapes. The game runs portrait: a phone for playtesting, a big portrait
// touchscreen for the lobby cabinet. Cameras fit the width first; if the screen
// is ever wider than it is tall, these keep enough height on screen to play.

export const SCREENS = {
  /** Fryer screen: the least half-height (world units at the bank) to keep in view. */
  stationMinHalfHeight: 3.6,
  /** Freezer and pass: the least half-height (world units at the play plane) to keep in view. */
  sideMinHalfHeight: 5.6,
};
