// The lobby cabinet: an optional coin gate where every coin goes to a cause.
// Staff flip the gate on or off from the operator panel (hold the top-left
// corner of the start screen for a few seconds); it remembers the setting.

export const CABINET = {
  /** Gate on out of the box? Off so phones and dev builds just play. */
  gateDefault: false,
  /** What one coin is, in cents, and how many runs it buys. */
  coinCents: 25,
  creditsPerCoin: 1,
  /** Where the coins go, shown on the start screen. Staff can change it on the operator panel. */
  cause: 'a good cause',
  /**
   * Keys a coin mechanism can send. A coin acceptor's pulse goes through a small USB board that
   * types one of these (5 is the arcade-standard coin key).
   */
  coinKeys: ['5', 'c', 'C'],
  /** Or a USB arcade encoder wired as a gamepad: this button index is the coin switch. */
  coinGamepadButton: 8,
  /** Hold the hidden top-left corner of the start screen this long to open the operator panel. */
  operatorHoldMs: 3000,
};
