// Matt's face, drawn: black ball cap, short black hair, trimmed black beard, a black band tee
// under a blue denim apron. Six moods from furious to delighted, as simple sticker faces. These are
// stand-ins with the right slots: Wella's painted faces drop in here, one per mood.

const INK = '#1b1b1d';
const DENIM = '#3f73b8';

/** What changes from mood to mood: skin, brows (tilt), eyes, and the mouth (drawn light, on the beard). */
const MOODS: { skin: string; brow: number; eye: 'dot' | 'squint' | 'happy'; mouth: string; steam?: boolean; sparkle?: boolean }[] = [
  { skin: '#ee8a6e', brow: 24, eye: 'squint', mouth: 'M14 34 Q20 28 26 34 Q20 31 14 34Z', steam: true },
  { skin: '#f2a889', brow: 16, eye: 'dot', mouth: 'M14.5 33.5 Q20 29.5 25.5 33.5' },
  { skin: '#f4c7a1', brow: 6, eye: 'squint', mouth: 'M15 32 L25 32' },
  { skin: '#f4c7a1', brow: 0, eye: 'dot', mouth: 'M15 32 Q20 33 25 32' },
  { skin: '#f6cfab', brow: -6, eye: 'dot', mouth: 'M14.5 31 Q20 36 25.5 31' },
  { skin: '#f6cfab', brow: -10, eye: 'happy', mouth: 'M14 30.5 Q20 38 26 30.5 Q20 33 14 30.5Z', sparkle: true },
];

export const MATT_MOODS = MOODS.length;

/** Matt at this mood (0 furious .. 5 delighted), as an SVG string. */
export function mattFace(mood: number) {
  const m = MOODS[Math.max(0, Math.min(MOODS.length - 1, Math.round(mood)))] ?? MOODS[3]!;
  const eye = (x: number) =>
    m.eye === 'dot'
      ? `<circle cx="${x}" cy="24" r="1.9" fill="${INK}"/>`
      : m.eye === 'squint'
        ? `<path d="M${x - 2.8} 24 L${x + 2.8} 24" stroke="${INK}" stroke-width="2.2" stroke-linecap="round"/>`
        : `<path d="M${x - 2.8} 25 Q${x} 20.5 ${x + 2.8} 25" stroke="${INK}" stroke-width="2.2" stroke-linecap="round" fill="none"/>`;
  const brow = (x: number, dir: number) => `<path d="M${x - 3.6} 20 L${x + 3.6} 20" stroke="${INK}" stroke-width="2.6" stroke-linecap="round" transform="rotate(${m.brow * dir} ${x} 20)"/>`;
  const filled = m.mouth.endsWith('Z');
  return `<svg viewBox="0 0 40 48" aria-hidden="true">
    <path d="M6 48 Q7 40 20 40 Q33 40 34 48Z" fill="${INK}"/>
    <path d="M12 48 L15.5 41 M28 48 L24.5 41" stroke="${DENIM}" stroke-width="3.2" stroke-linecap="round"/>
    <rect x="13" y="44.5" width="14" height="4" rx="1" fill="${DENIM}"/>
    <circle cx="20" cy="26" r="13" fill="${m.skin}" stroke="${INK}" stroke-width="2.2"/>
    <path d="M7.3 21 L7.3 27 M32.7 21 L32.7 27" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/>
    <path d="M7.4 27 Q8 39.6 20 39.6 Q32 39.6 32.6 27 Q30.5 33 26 31 Q20 29 14 31 Q9.5 33 7.4 27Z" fill="${INK}"/>
    <path d="M7 19 Q7 5 20 5 Q33 5 33 19Z" fill="${INK}"/>
    <path d="M5.5 16.6 Q20 12.6 34.5 16.6 Q36.5 17.4 35.6 19.2 Q20 15.8 4.4 19.2 Q3.5 17.4 5.5 16.6Z" fill="#2c2c30" stroke="${INK}" stroke-width="1.4" stroke-linejoin="round"/>
    <circle cx="20" cy="6.2" r="1.3" fill="#2c2c30"/>
    ${brow(14.5, 1)}${brow(25.5, -1)}${eye(14.5)}${eye(25.5)}
    <path d="${m.mouth}" fill="${filled ? '#fffdf6' : 'none'}" stroke="#fffdf6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    ${m.steam ? '<path d="M2.5 13 q-2.6 -4 0 -8 M37.5 13 q2.6 -4 0 -8" stroke="#d7282f" stroke-width="2.2" fill="none" stroke-linecap="round"/>' : ''}
    ${m.sparkle ? '<path d="M36 6 l1.3 3 3 1.3 -3 1.3 -1.3 3 -1.3 -3 -3 -1.3 3 -1.3Z" fill="#ffd34d" stroke="#2a1d12" stroke-width="1"/>' : ''}
  </svg>`;
}
