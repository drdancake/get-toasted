import { COOK_SCALE, FLAVORS, type FlavorId } from '../config/flavors';
import { TIMER_CHANNELS } from '../config/shift';
import { haptic, sfx } from '../ui/feel';
import { channelSeconds, type Kitchen, type KitchenEvent } from './kitchen';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement) => {
  const e = document.createElement(tag);
  e.className = cls;
  parent?.appendChild(e);
  return e;
};

/** Real seconds as the timer shows them, 4:45 style. */
const clock = (realSeconds: number) => {
  const s = Math.max(0, Math.ceil(realSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * The blue wall timer over the fryers: one button per flavor, preset to the real cook time
 * (4:45 for beef), counting down at game speed so the numbers on the line are the numbers on the
 * screen. Under each one, a small backup readout for a second batch (the CAL-8B on the line).
 */
export class TimerBank {
  private root: HTMLElement;
  private cells: { flavor: FlavorId; cell: HTMLElement; main: HTMLElement; backup: HTMLElement; chans: number[] }[] = [];

  constructor(parent: HTMLElement, private k: Kitchen) {
    this.root = el('div', 'timer-bank', parent);
    // Away from the fryers (at the pass or in the freezer)? Tap the timers to go back to them.
    this.root.addEventListener('pointerdown', (e) => {
      if (this.k.phase !== 'playing' || this.k.scene === 'station') return;
      // One stage: with the freezer open you're still at the fryers, so the timer buttons just work.
      if (this.k.stage) return;
      e.preventDefault();
      e.stopPropagation();
      if (this.k.scene === 'pass') this.k.leavePass();
      else if (this.k.scene === 'freezer') this.k.leaveFreezer();
      haptic(10);
    }, true);
    const face = el('div', 'timer-face wall', this.root);
    const flavors = [...new Set(TIMER_CHANNELS.map((c) => c.flavor))];
    flavors.forEach((f, n) => {
      const chans = TIMER_CHANNELS.map((c, i) => ({ c, i })).filter((x) => x.c.flavor === f).map((x) => x.i);
      const cell = el('div', 'timer-cell', face);
      const tape = el('div', 'tape', cell);
      tape.textContent = FLAVORS[f].short;
      // Label-maker tape never goes on straight.
      tape.style.transform = `rotate(${((n * 37) % 7) - 3}deg)`;
      const row = el('div', 'timer-row', cell);
      const lcd = el('div', 'timer-lcd', row);
      el('span', 'ghost', lcd).textContent = '8:88';
      const main = el('span', 'digits', lcd);
      const btn = el('button', 'timer-btn', row);
      btn.textContent = String(n + 1);
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.k.pressFlavorTimer(f);
        haptic(8);
      });
      const backup = el('div', 'timer-backup', cell);
      this.cells.push({ flavor: f, cell, main, backup, chans });
    });
  }

  handle(ev: KitchenEvent) {
    if (ev.type === 'timerStart' || ev.type === 'timerStop') sfx.timerPress();
    if (ev.type === 'timerDone' || ev.type === 'timerBeep') sfx.alarm();
  }

  update(now: number) {
    // The pass and the freezer are right there on the fryer screen: the timers stay up, and a tap on
    // them takes you back to the fryers.
    this.root.hidden = this.k.phase === 'title';
    this.root.classList.toggle('away', !this.k.stage && (this.k.scene === 'pass' || this.k.scene === 'freezer'));
    const show = (i: number | undefined, f: FlavorId) => {
      const left = i === undefined ? null : this.k.timerLeft(i);
      const t = i === undefined ? undefined : this.k.timers[i];
      const ringing = !!t?.rang;
      const running = left !== null && left > 0;
      // Idle shows the preset dimly; running counts the real time down at game speed.
      const text = ringing ? (Math.floor(now * 4) % 2 ? '0:00' : '') : clock(left === null ? channelSeconds(f) * COOK_SCALE : left * COOK_SCALE);
      return { text, running, ringing, idle: left === null };
    };
    for (const v of this.cells) {
      // The big readout is the batch closest to done; the others stack underneath (staggered batches).
      const live = v.chans.filter((i) => this.k.timers[i]?.start !== null).sort((x, y) => (this.k.timers[x]?.end ?? 0) - (this.k.timers[y]?.end ?? 0));
      const a = show(live[0] ?? v.chans[0], v.flavor);
      const rest = live.slice(1).map((i) => show(i, v.flavor));
      if (v.main.textContent !== a.text) v.main.textContent = a.text;
      v.cell.classList.toggle('running', a.running);
      v.cell.classList.toggle('ringing', a.ringing || rest.some((r) => r.ringing));
      v.backup.textContent = rest.map((r) => `+${r.text}`).join(' ');
      v.backup.classList.toggle('on', rest.length > 0);
      v.backup.classList.toggle('ringing', rest.some((r) => r.ringing));
    }
  }
}
