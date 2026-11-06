import { FLAVORS } from '../config/flavors';
import { HINT, MATT, MATT_DROP_COOLDOWN } from '../config/game';
import { dollars, REPUTATION } from '../config/money';
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

  private onStart: (prep: boolean) => void;
  private clockOutBtn: HTMLButtonElement;

  constructor(root: HTMLElement, private k: Kitchen, onStart: (prep: boolean) => void, buildId: string) {
    this.onStart = onStart;
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
    // Tapping anywhere starts a real shift; the PREP button starts practice with no clock.
    this.screen.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (performance.now() < this.screenReadyAt) return;
      const prep = (e.target as HTMLElement | null)?.closest('.start-prep');
      this.onStart(!!prep);
    });
    this.clockOutBtn = el('button', 'clockout-btn', root);
    this.clockOutBtn.textContent = 'END PREP';
    this.clockOutBtn.hidden = true;
    this.clockOutBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.k.clockOut();
    });
    this.screen.innerHTML = `
      <div class="title">GET<br>TOASTED</div>
      <ul class="howto">
        <li><b>Tap empty baskets</b> on the bars, then <b>FREEZER</b>. Each finger steers a basket; tap a stray to pick it out.</li>
        <li>Full baskets hang on a back bar. <b>Tap</b> one to drop it in the oil, or <b>drag</b> it onto another basket to nest.</li>
        <li><b>Slide</b> a basket in the oil to sink the floaters. Start a <b>timer</b>, remember which.</li>
        <li>While they cook, hit <b>EXPO</b>: open a box, paper it, Sharpie it for the order, set the sauce.</li>
        <li>Done? <b>Drag it up</b> onto the bar to drain, then down into the <b>salt bowl</b>. Flick into its box, swipe up.</li>
      </ul>
      <div class="start-row">
        <button class="start-shift">CLOCK IN<small>the real shift</small></button>
        <button class="start-prep">PREP<small>no clock, practice</small></button>
      </div>
      <div class="build">build ${buildId} · <a href="?v=toss1">first toss toy</a> · <a href="?v=tap">tap build</a></div>`;
    for (const a of this.screen.querySelectorAll('a')) a.addEventListener('pointerdown', (e) => e.stopPropagation());
  }

  hideScreen() {
    this.screen.hidden = true;
  }

  handle(ev: KitchenEvent, now: number) {
    switch (ev.type) {
      case 'dead':
        if (now - this.lastDropLine > MATT_DROP_COOLDOWN) {
          this.lastDropLine = now;
          this.say('dropped', now);
        }
        break;
      case 'waste':
        // Every lost rav is Matt's money, and he's keeping count.
        this.flash(`${dollars(-ev.cents)} of Matt's money`, 'bad', now);
        if (ev.cents >= 500 && now - this.lastDropLine > MATT_DROP_COOLDOWN) {
          this.lastDropLine = now;
          this.say('money', now);
        }
        break;
      case 'mixed':
        this.flash('MIXED FLAVORS', 'bad', now);
        this.say('mixed', now);
        break;
      case 'served': {
        const label = ev.strays
          ? `${ev.strays} STRAY`
          : ev.quality === 'perfect' && ev.style >= 4
            ? 'PLATED'
            : ev.quality === 'perfect'
              ? 'PERFECT'
              : ev.uneven
                ? 'GREASY/UNEVEN'
                : 'OK';
        if (ev.missingSauce) this.say('nosauce', now);
        else if (ev.salty) this.say('salty', now);
        const tip = ev.orderDone && ev.tip ? ` + ${dollars(ev.tip)} tip` : '';
        this.flash(`${label} ${dollars(ev.points)}${tip}`, ev.quality === 'perfect' ? 'good' : '', now);
        if (ev.strays) this.say('mixed', now);
        break;
      }
      case 'rejected':
        this.flash(
          ev.reason === 'short' ? `SHORT ${ev.missing}` : ev.reason === 'wrongorder' ? 'WRONG ORDER' : ev.reason === 'cold' ? 'COLD' : ev.reason === 'burst' ? 'BURST' : 'BURNT',
          'bad',
          now,
        );
        this.say(ev.reason, now);
        break;
      case 'greasy':
        this.flash('GREASY: DRAIN IT FIRST', 'bad', now);
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
          <div class="final-label">made Matt</div>
          <div class="final">${dollars(ev.score)}</div>
          <div class="final-best">best shift ${dollars(ev.best)}</div>
          <div class="final-waste">Matt's money on the floor: <b>${dollars(ev.wasted)}</b></div>
          <div class="final-best">reputation ${ev.stars.toFixed(1)}★</div>
          <div class="start-row">
            <button class="start-shift">CLOCK IN<small>another shift</small></button>
            <button class="start-prep">PREP<small>no clock</small></button>
          </div>`;
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
    // Money on the left, the restaurant's stars in the middle, Matt's face reads the stars.
    this.score.textContent = dollars(k.score);
    this.score.classList.toggle('neg', k.score < 0);
    this.best.textContent = `best ${dollars(Math.max(k.best, k.score))}`;
    this.combo.textContent = k.combo > 1 ? `x${k.combo}` : '';
    const stars = Math.max(0, Math.min(REPUTATION.max, Math.round(k.rep)));
    this.pips.textContent = k.prep ? 'PREP · no clock' : `${'★'.repeat(stars)}${'☆'.repeat(REPUTATION.max - stars)} ${k.rep.toFixed(1)}`;
    this.clockOutBtn.hidden = !(k.prep && k.phase === 'playing' && k.scene === 'station');
    const mood = Math.max(0, Math.min(MATT_FACES.length - 1, Math.round(((k.rep - REPUTATION.fireAt) / (REPUTATION.max - REPUTATION.fireAt)) * (MATT_FACES.length - 1))));
    this.face.textContent = MATT_FACES[mood] ?? '😐';
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
        line.classList.toggle('boxing', !!it && k.board.some((bx) => bx.itemId === it.id && bx.ravs.length > 0));
      }
      const left = Math.max(0, 1 - (k.time - t.bornAt) / t.life);
      v.bar.style.transform = `scaleX(${left})`;
      v.card.classList.toggle('urgent', left < 0.3);
    }
  }
}
