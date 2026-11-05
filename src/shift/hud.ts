import { FLAVORS } from '../config/flavors';
import { HINT, MATT, MATT_DROP_COOLDOWN, PATIENCE } from '../config/game';
import { MATT_FACES } from '../config/look';
import { MATT_LINES, type MattMood } from '../config/matt-lines';
import type { Kitchen, KitchenEvent } from './kitchen';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement) => {
  const e = document.createElement(tag);
  e.className = cls;
  parent?.appendChild(e);
  return e;
};

/** Always-on layer: score, ticket rail, Matt, toasts, start and clock-out screens. */
export class ShiftHud {
  private score: HTMLElement;
  private combo: HTMLElement;
  private face: HTMLElement;
  private pips: HTMLElement;
  private best: HTMLElement;
  private rail: HTMLElement;
  private tickets = new Map<number, { card: HTMLElement; bar: HTMLElement }>();
  private matt: HTMLElement;
  private mattLine: HTMLElement;
  private mattUntil = 0;
  private lastDropLine = -99;
  private lastLine = new Map<MattMood, string>();
  private toast: HTMLElement;
  private toastUntil = 0;
  private screen: HTMLElement;
  private screenReadyAt = 0;

  constructor(root: HTMLElement, private k: Kitchen, onStart: () => void, buildId: string) {
    root.classList.add('toss');
    const hud = el('div', 'strip hud', root);
    hud.style.top = '0';
    hud.style.height = '6.5%';
    this.score = el('div', 'score', hud);
    this.combo = el('div', 'combo', hud);
    this.pips = el('div', 'pips', hud);
    this.face = el('div', 'hud-face', hud);
    this.best = el('div', 'best', hud);
    this.rail = el('div', 'strip rail', root);
    this.rail.style.top = '6.5%';
    this.rail.style.height = '10.5%';
    this.matt = el('div', 'mattpop', root);
    el('div', 'mattpop-face', this.matt).textContent = '😎';
    this.mattLine = el('div', 'mattpop-line', this.matt);
    this.toast = el('div', 'toast', root);
    this.screen = el('div', 'screen', root);
    this.screen.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (performance.now() >= this.screenReadyAt) onStart();
    });
    this.screen.innerHTML = `
      <div class="title">GET<br>TOASTED</div>
      <ul class="howto">
        <li><b>Freezer:</b> tap a bag, catch the ravs in a basket. One flavor per basket.</li>
        <li><b>Fryers:</b> drag a basket into a slot. Drop a second one on top to nest it.</li>
        <li><b>Wiggle</b> a basket side to side so the ravs sink. Start a <b>timer</b> for it up top, and remember which.</li>
        <li><b>Drag it up</b> when it's <b class="gold">gold</b>. Flick into the box, swipe the box up.</li>
      </ul>
      <div class="tap">Tap to clock in</div>
      <div class="build">build ${buildId} · <a href="?v=toss1">first toss toy</a> · <a href="?v=tap">tap build</a></div>`;
    for (const a of this.screen.querySelectorAll('a')) a.addEventListener('pointerdown', (e) => e.stopPropagation());
  }

  hideScreen() {
    this.screen.hidden = true;
  }

  handle(ev: KitchenEvent, now: number) {
    switch (ev.type) {
      case 'dead':
        this.flash('−60', 'bad', now);
        if (now - this.lastDropLine > MATT_DROP_COOLDOWN) {
          this.lastDropLine = now;
          this.say('dropped', now);
        }
        break;
      case 'mixed':
        this.flash('MIXED FLAVORS', 'bad', now);
        this.say('mixed', now);
        break;
      case 'served': {
        const combo = ev.combo > 1 ? `  x${Math.min(ev.combo, 5)}` : '';
        this.flash(`${ev.quality === 'perfect' ? 'PERFECT' : ev.uneven ? 'UNEVEN' : 'OK'} +${ev.points + ev.tip}${combo}`, ev.quality === 'perfect' ? 'good' : '', now);
        break;
      }
      case 'rejected':
        this.flash(
          ev.reason === 'short' ? `SHORT ${ev.missing}` : ev.reason === 'mixed' ? 'WRONG FLAVOR' : ev.reason === 'cold' ? 'COLD' : 'BURNT',
          'bad',
          now,
        );
        this.say(ev.reason, now);
        break;
      case 'bigCombo':
        this.say('bigCombo', now);
        break;
      case 'ticketExpired':
        this.flash('TICKET EXPIRED', 'bad', now);
        break;
      case 'timerDone':
        this.flash(`TIMER ${ev.channel + 1}!`, 'good', now);
        break;
      case 'hint':
        this.flash(ev.text, '', now);
        break;
      case 'gameOver':
        this.screen.innerHTML = `
          <div class="title small">Clock out.</div>
          <div class="final">${ev.score.toLocaleString()}</div>
          <div class="final-best">best ${ev.best.toLocaleString()}</div>
          <div class="tap">Tap to clock back in</div>`;
        this.screen.hidden = false;
        this.screenReadyAt = performance.now() + 900;
        break;
      default:
        break;
    }
  }

  private say(mood: MattMood, now: number) {
    const lines = MATT_LINES[mood];
    let line = lines[Math.floor(Math.random() * lines.length)] ?? '';
    if (lines.length > 1 && line === this.lastLine.get(mood)) line = lines[(lines.indexOf(line) + 1) % lines.length] ?? line;
    this.lastLine.set(mood, line);
    this.mattLine.textContent = `“${line}”`;
    this.matt.classList.remove('on');
    void this.matt.offsetWidth;
    this.matt.classList.add('on');
    this.mattUntil = now + MATT.showSeconds;
  }

  private flash(text: string, kind: string, now: number) {
    this.toast.textContent = text;
    this.toast.className = `toast on ${kind}`;
    this.toastUntil = now + HINT.showSeconds;
  }

  update(now: number) {
    const k = this.k;
    this.score.textContent = k.score.toLocaleString();
    this.best.textContent = `best ${Math.max(k.best, k.score).toLocaleString()}`;
    this.combo.textContent = k.combo > 1 ? `x${Math.min(k.combo, 5)}` : '';
    this.pips.textContent = '●'.repeat(k.patience) + '○'.repeat(Math.max(0, PATIENCE.max - k.patience));
    this.face.textContent = MATT_FACES[Math.min(k.patience, MATT_FACES.length - 1)] ?? '😐';
    if (now > this.mattUntil) this.matt.classList.remove('on');
    if (now > this.toastUntil) this.toast.classList.remove('on');
    const live = new Set(k.tickets.map((t) => t.id));
    for (const [id, v] of this.tickets) {
      if (!live.has(id)) {
        v.card.remove();
        this.tickets.delete(id);
      }
    }
    for (const t of k.tickets) {
      let v = this.tickets.get(t.id);
      if (!v) {
        const card = el('div', 'ticket', this.rail);
        card.style.setProperty('--tint', FLAVORS[t.flavor].tint);
        card.innerHTML = `<span class="count">${t.count}</span><span class="name">${FLAVORS[t.flavor].short}</span>`;
        v = { card, bar: el('div', 'timer', card) };
        this.tickets.set(t.id, v);
      }
      const left = Math.max(0, 1 - (k.time - t.bornAt) / t.life);
      v.bar.style.transform = `scaleX(${left})`;
      v.card.classList.toggle('urgent', left < 0.3);
      v.card.classList.toggle('boxed', k.box.ticketId === t.id && k.box.ravs.length > 0);
    }
  }
}
