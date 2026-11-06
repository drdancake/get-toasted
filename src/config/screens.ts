// Screen shapes. The game runs on a phone (portrait, for playtesting) and a big
// landscape touchscreen (the lobby cabinet). Cameras fit the width first; on a
// wide screen these keep enough height on screen to play.

export const SCREENS = {
  /** Fryer screen: the least half-height (world units at the bank) to keep in view. */
  stationMinHalfHeight: 3.6,
  /** Freezer and pass: the least half-height (world units at the play plane) to keep in view. */
  sideMinHalfHeight: 5.6,
};
