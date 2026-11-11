// Matt's face, drawn. Six moods from furious to delighted, as simple sticker faces. These are
// stand-ins with the right slots: Wella's painted faces drop in here, one per mood.

const INK = '#2a1d12';

/** What changes from mood to mood: skin, brows (tilt, lift), eyes, and the mouth. */
const MOODS: { skin: string; brow: number; eye: 'dot' | 'squint' | 'happy'; mouth: string; steam?: boolean; sparkle?: boolean }[] = [
  { skin: '#f08a6c', brow: 22, eye: 'squint', mouth: 'M13 31 Q20 23 27 31 Q20 27 13 31Z', steam: true },
  { skin: '#f3a887', brow: 16, eye: 'dot', mouth: 'M13 30 Q20 25 27 30' },
  { skin: '#f6c9a0', brow: 6, eye: 'squint', mouth: 'M14 29 L26 29' },
  { skin: '#f6c9a0', brow: 0, eye: 'dot', mouth: 'M14 29 Q20 30 26 29' },
  { skin: '#f8d2ab', brow: -6, eye: 'dot', mouth: 'M13 27 Q20 34 27 27' },
  { skin: '#f8d2ab', brow: -10, eye: 'happy', mouth: 'M12 26 Q20 37 28 26 Q20 29 12 26Z', sparkle: true },
];

export const MATT_MOODS = MOODS.length;

/** Matt at this mood (0 furious .. 5 delighted), as an SVG string. */
export function mattFace(mood: number) {
  const m = MOODS[Math.max(0, Math.min(MOODS.length - 1, Math.round(mood)))] ?? MOODS[3]!;
  const eye = (x: number) =>
    m.eye === 'dot'
      ? `<circle cx="${x}" cy="20" r="2.1" fill="${INK}"/>`
      : m.eye === 'squint'
        ? `<path d="M${x - 3} 20 L${x + 3} 20" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>`
        : `<path d="M${x - 3} 21 Q${x} 16 ${x + 3} 21" stroke="${INK}" stroke-width="2.4" stroke-linecap="round" fill="none"/>`;
  const brow = (x: number, dir: number) => `<path d="M${x - 4} 14 L${x + 4} 14" stroke="${INK}" stroke-width="2.6" stroke-linecap="round" transform="rotate(${m.brow * dir} ${x} 14)"/>`;
  const filled = m.mouth.endsWith('Z');
  return `<svg viewBox="0 0 40 44" aria-hidden="true">
    <path d="M9 12 Q8 2 20 3 Q32 2 31 12Z" fill="#fffdf6" stroke="${INK}" stroke-width="2.2" stroke-linejoin="round"/>
    <rect x="9" y="10" width="22" height="5" rx="2" fill="#fffdf6" stroke="${INK}" stroke-width="2.2"/>
    <circle cx="20" cy="25" r="14" fill="${m.skin}" stroke="${INK}" stroke-width="2.4"/>
    <rect x="9.5" y="10.5" width="21" height="4" rx="2" fill="#fffdf6"/>
    ${brow(14, 1)}${brow(26, -1)}${eye(14)}${eye(26)}
    <path d="${m.mouth}" fill="${filled ? INK : 'none'}" stroke="${INK}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
    ${m.steam ? '<path d="M3 16 q-3 -4 0 -8 M37 16 q3 -4 0 -8" stroke="#d7282f" stroke-width="2.2" fill="none" stroke-linecap="round"/>' : ''}
    ${m.sparkle ? '<path d="M35 6 l1.4 3.2 3.2 1.4 -3.2 1.4 -1.4 3.2 -1.4 -3.2 -3.2 -1.4 3.2 -1.4Z" fill="#ffd34d" stroke="#2a1d12" stroke-width="1"/>' : ''}
  </svg>`;
}
