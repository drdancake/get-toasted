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
        <li><b>Tap empty baskets</b> on the bars to pick them, then hit <b>FREEZER</b>. Each finger steers a basket. One flavor per basket; tap a stray to pick it out.</li>
        <li><b>Fryers:</b> drag a basket into a slot. Drop a second one on top to nest it.</li>
        <li>Grab a basket in the oil and <b>slide it side to side</b> so the ravs sink. Start a <b>timer</b> up top, and remember which.</li>
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
        const label = ev.strays ? `${ev.strays} STRAY` : ev.quality === 'perfect' ? 'PERFECT' : ev.uneven ? 'UNEVEN' : 'OK';
        const done = ev.orderDone ? ' · ORDER UP' : '';
        this.flash(`${label} +${ev.points + ev.tip}${combo}${done}`, ev.quality === 'perfect' ? 'good' : '', now);
        if (ev.strays) this.say('mixed', now);
        break;
      }
      case 'rejected':
        this.flash(
          ev.reason === 'short' ? `SHORT ${ev.missing}` : ev.reason === 'wrongorder' ? 'WRONG ORDER' : ev.reason === 'cold' ? 'COLD' : 'BURNT',
          'bad',
          now,
        );
        this.say(ev.reason, now);
        break;
      case 'forgot':
        this.flash(`${ev.count} BASKET${ev.count > 1 ? 'S' : ''} LEFT IN THE FREEZER`, 'bad', now);
        this.say('forgot', now);
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
    // Receipts: one line per item, struck through when it's gone out, the boxing one underlined.
    for (const t of k.tickets) {
      let v = this.tickets.get(t.id);
      if (!v) {
        const card = el('div', 'receipt', this.rail);
        el('div', 'receipt-no', card).textContent = `#${String(t.id).padStart(3, '0')}`;
        for (const it of t.items) {
          const line = el('div', 'receipt-line', card);
          line.dataset.item = String(it.id);
          const dots = it.lines.map((l) => `<i style="background:${FLAVORS[l.flavor].tint}"></i>`).join('');
          line.innerHTML = `<b>${it.size}</b><span>${it.lines.map((l) => FLAVORS[l.flavor].short).join('/')}</span>${dots}`;
        }
        v = { card, bar: el('div', 'timer', card) };
        this.tickets.set(t.id, v);
      }
      for (const line of v.card.querySelectorAll<HTMLElement>('.receipt-line')) {
        const it = t.items.find((x) => String(x.id) === line.dataset.item);
        line.classList.toggle('done', !!it?.done);
        line.classList.toggle('boxing', !!it && k.box.itemId === it.id && k.box.ravs.length > 0);
      }
      const left = Math.max(0, 1 - (k.time - t.bornAt) / t.life);
      v.bar.style.transform = `scaleX(${left})`;
      v.card.classList.toggle('urgent', left < 0.3);
    }
  }
}
