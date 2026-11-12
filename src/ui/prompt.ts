// The WarioWare command: one big word slams onto the screen at each step (ARRANGE! POUR! TOSS!),
// and the first time a move comes up in a shift, a cartoon hand shows you how to do it.

export type Gesture = 'drag' | 'pull' | 'shake' | 'toss' | 'tap' | 'pinch' | 'pour';

const seen = new Set<Gesture>();
let current: HTMLElement | null = null;
let timer = 0;

/** A new shift: show every hand again. */
export function resetPrompts() {
  seen.clear();
}

/** A gloved hand, pointing (drawn, so it scales and tints with the prompt). */
const HAND = `<svg viewBox="0 0 64 80" aria-hidden="true"><path d="M26 6c0-4 8-4 8 0v28l2-12c1-4 8-3 7 1l-1 13 3-9c1-4 8-2 7 2l-3 12 3-5c2-3 8-1 6 3l-7 16c-4 9-10 15-20 15h-4c-10 0-16-8-16-18V44c0-4 6-5 7-1l3 9V6z" fill="#f4f1ea" stroke="#1b1b1d" stroke-width="3.5" stroke-linejoin="round"/></svg>`;

/** Slam a command on screen; with a gesture, the hand demo plays once per shift per move. */
export function prompt(word: string, gesture?: Gesture, parent: HTMLElement = document.getElementById('ui') ?? document.body, again = false) {
  current?.remove();
  window.clearTimeout(timer);
  const e = document.createElement('div');
  e.className = 'cmd-prompt';
  const w = document.createElement('b');
  w.textContent = word;
  e.appendChild(w);
  let ms = 950;
  // (A nudge shows the hand again, however many times you've seen it.)
  if (gesture && (again || !seen.has(gesture))) {
    seen.add(gesture);
    const h = document.createElement('i');
    h.className = `cmd-hand g-${gesture}`;
    h.innerHTML = HAND;
    e.appendChild(h);
    ms = 2100;
  }
  parent.appendChild(e);
  current = e;
  timer = window.setTimeout(() => {
    e.classList.add('out');
    window.setTimeout(() => e.remove(), 220);
    if (current === e) current = null;
  }, ms);
}
