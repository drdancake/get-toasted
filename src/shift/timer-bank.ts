import { COOK_SCALE, FLAVORS, type FlavorId } from '../config/flavors';
import { TIMER_CHANNELS, TIMER_HOLD } from '../config/shift';
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
/** How long a running timer's button has to be held to cancel it. */
const HOLD_MS = TIMER_HOLD * 1000;

export class TimerBank {
  private shown = -1;
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
    // One cell per preset on the bank: its own readout and its own button.
    TIMER_CHANNELS.forEach((ch, n) => {
      const f = ch.flavor;
      const chans = [n];
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
      // A tap starts it (or silences it when it's ringing). While it's counting, a tap does
      // nothing: hold the button and it cancels.
      let hold = 0;
      const letGo = () => {
        window.clearTimeout(hold);
        hold = 0;
        btn.classList.remove('holding');
      };
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const live = chans.some((i) => this.k.timers[i]?.start !== null && !this.k.timers[i]?.rang);
        if (!live) {
          this.k.pressChannel(n);
          haptic(8);
          return;
        }
        btn.classList.add('holding');
        hold = window.setTimeout(() => {
          hold = 0;
          btn.classList.remove('holding');
          if (this.k.cancelChannel(n)) haptic(20);
        }, HOLD_MS);
      });
      btn.addEventListener('pointerup', () => {
        // Let go early: it's still running, and it says how to stop it.
        if (hold) this.k.pressChannel(n);
        letGo();
      });
      btn.addEventListener('pointercancel', letGo);
      btn.addEventListener('pointerleave', letGo);
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
    // Only the flavors on the menu have a timer up.
    const menu = this.k.flavorsNow();
    const shown = this.cells.filter((v) => menu.includes(v.flavor)).length;
    if (shown !== this.shown) {
      this.shown = shown;
      for (const v of this.cells) v.cell.hidden = !menu.includes(v.flavor);
      const face = this.cells[0]?.cell.parentElement;
      if (face) {
        // Up to four across; more than that and the bank is two rows, like the real one.
        const cols = shown <= 4 ? Math.max(1, shown) : Math.ceil(shown / 2);
        face.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
        face.classList.toggle('many', false);
        face.classList.toggle('few', shown < 3);
        face.classList.toggle('rows', shown > 4);
      }
    }
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
