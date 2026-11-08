import { STAMPS } from '../config/stamps';

// Big stamped words and little floating numbers, over everything. DOM, so they're crisp at any size.

let layer: HTMLElement | null = null;
let current: HTMLElement | null = null;

function root() {
  if (!layer) {
    layer = document.createElement('div');
    layer.className = 'stamp-layer';
    (document.getElementById('ui') ?? document.body).appendChild(layer);
  }
  return layer;
}

const pick = <T,>(xs: readonly T[]) => xs[Math.floor(Math.random() * xs.length)] as T;

/** Slam a word onto the screen, WarioWare style, with a smaller line under it. */
export function stamp(title: string, line: string, tone: 'gold' | 'green' | 'red' = 'gold') {
  current?.remove();
  const e = document.createElement('div');
  e.className = `stamp ${tone}`;
  e.style.setProperty('--tilt', `${(Math.random() * 10 - 5).toFixed(1)}deg`);
  e.innerHTML = `<b>${title}</b><span>${line}</span>`;
  // Fit the screen: long titles (a guest's name) get smaller and wrap onto two lines, never cut off.
  const longest = Math.max(...title.split(' ').map((w) => w.length), Math.ceil(title.length / 2));
  const oneLine = title.length * 0.68;
  const wide = Math.min(window.innerWidth, 720) * 0.84;
  const size = Math.max(26, Math.min(64, wide / Math.max(oneLine, longest * 0.72 * 1.6)));
  e.style.setProperty('--size', `${size.toFixed(0)}px`);
  root().appendChild(e);
  current = e;
  window.setTimeout(() => e.remove(), STAMPS.showSeconds * 1000);
  // The whole screen takes the hit.
  const app = document.getElementById('app');
  if (app) {
    app.classList.remove('shake');
    void app.offsetWidth;
    app.classList.add('shake');
  }
}

/** A stamp from the config: a title and a random line, with {n} and {flavor} filled in. */
export function stampFrom(def: { title: string; lines: string[] }, vars: Record<string, string | number>, tone?: 'gold' | 'green' | 'red') {
  const fill = (t: string) => t.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));
  stamp(fill(def.title), fill(pick(def.lines)), tone);
}

/** A little number that pops up at a screen point and floats away. */
export function pop(text: string, x: number, y: number, big = false) {
  const e = document.createElement('div');
  e.className = `pop${big ? ' big' : ''}`;
  e.textContent = text;
  e.style.left = `${x}px`;
  e.style.top = `${y}px`;
  root().appendChild(e);
  window.setTimeout(() => e.remove(), 700);
}
