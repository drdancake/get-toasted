// Placeholder look. Colors and motion for the cube build, all tunable here.
// Taj's models and the doneness shader replace most of this in MVP-1.

/**
 * The doneness ramp: stops at 0..1 doneness (see donenessAt in game/doneness.ts).
 * 0 raw, 0.5 gold (window opens), 0.65 deep gold (window closes), 0.85 burnt, 1 black.
 */
export const DONENESS_RAMP: { at: number; color: string }[] = [
  { at: 0, color: '#f6ecd6' }, // pale cream, frozen
  { at: 0.3, color: '#e6cc98' }, // beige, wet crumb
  { at: 0.5, color: '#f0a530' }, // amber gold: pull now
  { at: 0.65, color: '#d07f1c' }, // deep gold: last call
  { at: 0.85, color: '#8a4517' }, // past the window: dark brown, bursting
  { at: 1, color: '#5a2a0e' }, // way overdone: darker brown (never gray, never black)
];

export const STATION = {
  background: '#1a1510',
  /** Fryer body (stainless). */
  steel: '#8f969c',
  steelDark: '#4c5257',
  /** Oil surface. */
  oil: '#3a2208',
  oilHot: '#5a3510',
  /** Basket wire. */
  wire: '#d8dde0',
  /** Slot outline when you are carrying a raw basket and the slot is open. */
  slotOpen: '#f0a530',
  /** How fast the oil shimmers and baskets bob. */
  bobSpeed: 3.2,
  bobHeight: 0.04,
};

/** Matt's face by patience left, index = patience (0..max). Placeholder until the portrait. */
export const MATT_FACES = ['😤', '😠', '😑', '😐', '🙂', '😎'];

/** How strongly the filling color shows through the dough: raw, and once fully cooked. Subtle on purpose. */
export const FILLING_TINT = { raw: 0.3, cooked: 0.05 };
