import { COOK_SCALE, FLAVORS } from '../config/flavors';
import { TIMER_CHANNELS } from '../config/shift';
import { haptic, sfx } from '../ui/feel';
import { channelSeconds, type Kitchen, type KitchenEvent } from './kitchen';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement) => {
  const e = document.createElement(tag);
  e.className = cls;
  parent?.appendChild(e);
  return e;
};

/** Real seconds as the timer shows them, 4:50 style. */
const clock = (realSeconds: number) => {
  const s = Math.max(0, Math.ceil(realSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * The 8-channel commercial kitchen timer over the fryers. Each channel shows
 * the real cook time (4:50 for beef) and counts it down at game speed, so the
 * numbers on the line are the numbers on the screen.
 */
export class TimerBank {
  private root: HTMLElement;
  private cells: { cell: HTMLElement; digits: HTMLElement }[] = [];

  constructor(parent: HTMLElement, private k: Kitchen) {
    this.root = el('div', 'timer-bank', parent);
    const face = el('div', 'timer-face', this.root);
    el('div', 'timer-brand', face).textContent = 'CAL-8B';
    TIMER_CHANNELS.forEach((c, i) => {
      const cell = el('div', 'timer-cell', face);
      const row = el('div', 'timer-row', cell);
      const lcd = el('div', 'timer-lcd', row);
      el('span', 'ghost', lcd).textContent = '8:88';
      const digits = el('span', 'digits', lcd);
      const btn = el('button', 'timer-btn', row);
      btn.textContent = String(i + 1);
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.k.pressTimer(i);
        haptic(8);
      });
      const tape = el('div', 'tape', cell);
      const f = FLAVORS[c.flavor];
      tape.textContent = `${f.short} ${clock(f.realCook)}`;
      // Label-maker tape never goes on straight.
      tape.style.transform = `rotate(${((i * 37) % 7) - 3}deg)`;
      this.cells.push({ cell, digits });
    });
  }

  handle(ev: KitchenEvent) {
    if (ev.type === 'timerStart' || ev.type === 'timerStop') sfx.timerPress();
    if (ev.type === 'timerDone' || ev.type === 'timerBeep') sfx.alarm();
  }

  update(now: number) {
    // No heads-up display in the freezer: you can't see the timers from in there.
    this.root.hidden = this.k.phase === 'title' || this.k.scene === 'freezer';
    // At the pass it shrinks into the corner, out of the basket's way.
    this.root.classList.toggle('mini', this.k.scene === 'pass');
    TIMER_CHANNELS.forEach((c, i) => {
      const v = this.cells[i];
      if (!v) return;
      const left = this.k.timerLeft(i);
      const t = this.k.timers[i];
      const running = left !== null && left > 0;
      const ringing = !!t?.rang;
      // Idle shows the preset dimly; running counts the real time down at game speed.
      const shown = left === null ? channelSeconds(c.flavor) * COOK_SCALE : left * COOK_SCALE;
      v.digits.textContent = ringing ? (Math.floor(now * 4) % 2 ? '0:00' : '') : clock(shown);
      v.cell.classList.toggle('running', running);
      v.cell.classList.toggle('ringing', ringing);
    });
  }
}
