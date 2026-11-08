import type { Cabinet } from './cabinet';
import { FLAVORS } from '../config/flavors';
import { HINT, MATT, MATT_DROP_COOLDOWN } from '../config/game';
import { CABINET } from '../config/cabinet';
import { dollars, REPUTATION } from '../config/money';
import { MATT_FACES } from '../config/look';
import { MATT_LINES, type MattMood } from '../config/matt-lines';
import type { Kitchen, KitchenEvent } from './kitchen';
import { sfx } from '../ui/feel';
import { STAMPS } from '../config/stamps';
import { stamp, stampFrom } from '../ui/stamp';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement) => {
  const e = document.createElement(tag);
  e.className = cls;
  parent?.appendChild(e);
  return e;
};

/** Always-on layer: score, ticket rail, Matt, toasts, start and clock-out screens. */

/** The steps an item goes through, as receipt lights: in a basket, frying, cooked, salted, boxed. */
const STEP_ICONS = ['basket', 'frying', 'cooked', 'salted', 'boxed'];

function escapeHtml(t: string) {
  return t.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

export class ShiftHud {
  private score: HTMLElement;
  private combo: HTMLElement;
  private face: HTMLElement;
  private pips: HTMLElement;
  private best: HTMLElement;
  private rail: HTMLElement;
  private tickets = new Map<number, { card: HTMLElement; bar: HTMLElement; marble: HTMLElement; x: number; born: number }>();
  /** The rail: an aluminum bar the tickets hang from (held by steel marbles), and the spike at the end. */
  private track!: HTMLElement;
  private spike!: HTMLElement;
  private spikeCount!: HTMLElement;
  private spiked = 0;
  private expiredIds = new Set<number>();
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

  constructor(root: HTMLElement, private k: Kitchen, onStart: (prep: boolean) => void, buildId: string, private cabinet: Cabinet) {
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
    this.track = el('div', 'rail-track', this.rail);
    el('div', 'rail-bar', this.rail);
    this.spike = el('div', 'spike', this.rail);
    el('div', 'spike-rod', this.spike);
    el('div', 'spike-base', this.spike);
    this.spikeCount = el('div', 'spike-count', this.spike);
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
        <li><b>FREEZER:</b> tap a bin fast, catch the ravs under their shadows.</li>
        <li><b>FRYERS:</b> drop the basket in, hit its <b>timer</b>, pull it golden, hang it to drain.</li>
        <li><b>TABLE:</b> while they cook, set out boxes: paper, sauce, Sharpie the name.</li>
        <li>Pour into the <b>salt bowl</b>, salt and toss, box it, <b>swipe up</b>. Follow the gold line.</li>
      </ul>
      <div class="start-row">
        <button class="start-shift">CLOCK IN<small>the real shift</small></button>
        <button class="start-prep">PREP<small>no clock, practice</small></button>
      </div>
      <div class="build">build ${buildId} · <a href="?v=toss1">first toss toy</a> · <a href="?v=tap">tap build</a></div>`;
    for (const a of this.screen.querySelectorAll('a')) a.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.coinPanel();
    cabinet.onChange(() => {
      this.coinPanel();
      this.renderOperator();
    });
    this.buildOperator(root);
    if (new URLSearchParams(location.search).has('operator')) this.openOperator();
  }

  /** On the start and game-over screens: what a run costs, where it goes, and the credits in. */
  private coinPanel() {
    const c = this.cabinet;
    let p = this.screen.querySelector<HTMLElement>('.coin-panel');
    if (!c.gate) {
      p?.remove();
      this.screen.classList.remove('gated', 'no-credit');
      return;
    }
    if (!p) {
      p = el('div', 'coin-panel', this.screen);
      const row = this.screen.querySelector('.start-row');
      if (row) this.screen.insertBefore(p, row);
    }
    // A coin dropping in gets a ka-ching.
    if (c.credits > this.lastCredits) sfx.perfect();
    this.lastCredits = c.credits;
    const cents = CABINET.coinCents;
    const price = cents < 100 ? `${cents}¢` : dollars(cents);
    p.innerHTML = `<div class="coin-slot"><i></i></div>
      <div class="coin-text"><b>${c.credits ? `${c.credits} CREDIT${c.credits > 1 ? 'S' : ''}` : `INSERT ${price}`}</b>
      <span>every coin goes to ${escapeHtml(c.cause)}</span></div>`;
    this.screen.classList.add('gated');
    this.screen.classList.toggle('no-credit', !c.credits);
  }

  /** Tapped start with no credit: nudge toward the slot. */
  needCoin() {
    const p = this.screen.querySelector<HTMLElement>('.coin-panel');
    if (!p) return;
    p.classList.remove('nudge');
    void p.offsetWidth;
    p.classList.add('nudge');
  }

  // ---------- Operator panel (staff only) ----------

  private operator!: HTMLElement;
  private lastCredits = 0;
  private spot!: HTMLElement;

  private operatorSpot() {
    return this.spot;
  }

  /** A hidden hotspot in the top-left corner of the start screen: hold it to open the operator panel. */
  private buildOperator(root: HTMLElement) {
    const spot = el('div', 'operator-spot', this.screen);
    this.spot = spot;
    let timer = 0;
    spot.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      clearTimeout(timer);
      timer = window.setTimeout(() => this.openOperator(), CABINET.operatorHoldMs);
    });
    const cancel = () => clearTimeout(timer);
    spot.addEventListener('pointerup', cancel);
    spot.addEventListener('pointercancel', cancel);
    spot.addEventListener('pointerleave', cancel);
    this.operator = el('div', 'operator', root);
    this.operator.hidden = true;
    this.operator.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.operator.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
      const c = this.cabinet;
      if (act === 'gate') c.setGate(!c.gate);
      else if (act === 'credit') c.insertCoin();
      else if (act === 'close') this.operator.hidden = true;
    });
    this.operator.addEventListener('change', (e) => {
      const t = e.target as HTMLInputElement;
      if (t.name === 'cause') this.cabinet.setCause(t.value);
    });
  }

  private openOperator() {
    this.renderOperator();
    this.operator.hidden = false;
  }

  private renderOperator() {
    if (!this.operator) return;
    const c = this.cabinet;
    this.operator.innerHTML = `<div class="op-card">
      <div class="op-title">OPERATOR</div>
      <button data-act="gate" class="${c.gate ? 'on' : ''}">COIN GATE: ${c.gate ? 'ON' : 'OFF (free play)'}</button>
      <label>Coins go to<input name="cause" value="${escapeHtml(c.cause)}" maxlength="60"></label>
      <button data-act="credit">+1 CREDIT (test coin)</button>
      <div class="op-stat">credits ${c.credits} · coins counted ${c.coins}</div>
      <button data-act="close" class="primary">DONE</button>
    </div>`;
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
          : ev.quality === 'perfect' && ev.style >= 6
            ? 'PLATED'
            : ev.quality === 'perfect'
              ? 'PERFECT'
              : ev.uneven
                ? 'GREASY/UNEVEN'
                : 'OK';
        if (ev.coldSauce) this.flash('COLD MARINARA', 'bad', now);
        if (ev.missingSauce) this.say('nosauce', now);
        else if (ev.salty) this.say('salty', now);
        else if (ev.generous && Math.random() < 0.5) this.say('generous', now);
        const tip = (ev.orderDone && ev.tip ? ` + ${dollars(ev.tip)} tip` : '') + (ev.generous ? ' · +1 on the house' : '');
        this.flash(`${label} ${dollars(ev.points)}${tip}`, ev.quality === 'perfect' ? 'good' : '', now);
        if (ev.strays) this.say('mixed', now);
        // The table's big moments: a perfectly dressed box, and clean tickets in a row.
        // The guest by name: the person this was for.
        if (ev.bigTip && ev.name) {
          sfx.perfect();
          stampFrom(STAMPS.bigTip, { name: ev.name.toUpperCase(), tip: dollars(ev.tip) });
        } else if (ev.orderDone && ev.combo >= 3) stampFrom(STAMPS.streak, { n: ev.combo }, 'green');
        else if (ev.quality === 'perfect' && ev.style >= 6) stampFrom(STAMPS.plated, {});
        break;
      }
      case 'sauced':
        if (ev.perfect) {
          sfx.perfect();
          stampFrom(STAMPS.sauced, {}, 'green');
        } else this.flash(ev.fill < 0.82 ? 'A LITTLE LIGHT' : 'A LITTLE FULL', '', now);
        break;
      case 'spill':
        this.flash('SAUCE ON THE TABLE', 'bad', now);
        break;
      case 'outOfSauce':
        this.flash(`OUT OF ${ev.sauce.toUpperCase()} · LADLE MORE`, 'bad', now);
        break;
      case 'pulled':
        if (ev.perfect || ev.onTime) sfx.perfect();
        if (ev.perfect && ev.onTime) stamp('GOLDEN!', 'AND ON THE BEEP.', 'green');
        else if (ev.perfect) stampFrom(STAMPS.perfectPull, {});
        else if (ev.onTime) stampFrom(STAMPS.onTheBeep, {}, 'green');
        break;
      case 'batched':
        sfx.perfect();
        stampFrom(STAMPS.batched, { n: ev.orders });
        break;
      case 'rejected':
        this.flash(
          ev.reason === 'short' ? `SHORT ${ev.missing}` : ev.reason === 'wrongorder' ? 'WRONG ORDER' : ev.reason === 'cold' ? 'COLD' : ev.reason === 'burst' ? 'BURST' : 'BURNT',
          'bad',
          now,
        );
        this.say(ev.reason, now);
        if (ev.name) {
          const why = { cold: 'IT WAS COLD', burnt: 'IT WAS BURNT', burst: 'THEY BURST', short: `SHORT ${ev.missing}`, wrongorder: 'WRONG ORDER' }[ev.reason];
          stampFrom(STAMPS.hatesYou, { name: ev.name.toUpperCase(), why }, 'red');
        }
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
        this.expiredIds.add(ev.ticket.id);
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
        this.coinPanel();
        this.screen.appendChild(this.operatorSpot());
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
    let gone = 0;
    for (const [id, v] of this.tickets) {
      if (live.has(id)) continue;
      this.tickets.delete(id);
      v.marble.remove();
      gone++;
      if (this.expiredIds.delete(id)) {
        // Walked out: the ticket comes down off the rail.
        v.card.classList.add('dropped');
        sfx.railSlide(2);
      } else {
        // Sold: onto the spike.
        this.spikeTicket(v.card, v.x);
      }
      window.setTimeout(() => v.card.remove(), 650);
    }
    if (k.tickets.length === 0 && k.phase !== 'playing' && this.spiked) this.resetSpike();
    // Receipts: one line per item, struck through when it's gone out, the boxing one underlined.
    // Each line is a little recipe: a light per step, lit as the item gets there, the next one blinking.
    const stages = k.itemStages();
    for (const t of k.tickets) {
      let v = this.tickets.get(t.id);
      if (!v) {
        const card = el('div', 'receipt', this.track);
        el('div', 'receipt-no', card).innerHTML = `<b>${(t.name ?? '').toUpperCase()}</b> #${String(t.id).padStart(3, '0')}`;
        for (const it of t.items) {
          const line = el('div', 'receipt-line', card);
          line.dataset.item = String(it.id);
          // One flavor dot (a split's two names say enough on their own).
          const dots = it.lines.length > 1 ? '' : it.lines.map((l) => `<i style="background:${FLAVORS[l.flavor].tint}"></i>`).join('');
          line.innerHTML = `<b>${it.size}</b><span>${it.lines.map((l) => FLAVORS[l.flavor].short).join('/')}</span>${dots}<span class="steps">${STEP_ICONS.map((s) => `<em title="${s}"></em>`).join('')}</span>`;
        }
        // It comes in at the far end and slides down the rail into place; the marble clacks.
        const marble = el('i', 'marble', this.track);
        card.style.transform = marble.style.transform = 'translateX(-130px)';
        v = { card, bar: el('div', 'timer', card), marble, x: -130, born: t.bornAt };
        this.tickets.set(t.id, v);
        window.setTimeout(() => sfx.marble(), 360);
      }
      for (const line of v.card.querySelectorAll<HTMLElement>('.receipt-line')) {
        const it = t.items.find((x) => String(x.id) === line.dataset.item);
        line.classList.toggle('done', !!it?.done);
        line.classList.toggle('boxing', !!it && k.board.some((bx) => bx.itemId === it.id && bx.ravs.length > 0));
        const st = it ? (it.done ? STEP_ICONS.length : (stages.get(it.id) ?? 0)) : 0;
        line.querySelectorAll('.steps em').forEach((e, i) => {
          // Step i is reached at stage i + 1 (in a basket, frying, cooked, salted, boxed).
          e.classList.toggle('on', st >= i + 1);
          e.classList.toggle('now', st === i && !it?.done);
        });
      }
      const left = Math.max(0, 1 - (k.time - t.bornAt) / t.life);
      void left;
      v.bar.style.transform = `scaleX(${left})`;
      v.card.classList.toggle('urgent', left < 0.3);
    }
    this.layoutRail(gone > 0);
  }

  /**
   * Hang the tickets on the rail: oldest at the spike end, each newer one behind it. When the rail
   * fills up they bunch together, like the real thing. Anything that moves, slides (and rattles).
   */
  private layoutRail(closedGap: boolean) {
    const w = this.track.clientWidth;
    const cw = this.rail.clientWidth * 0.235;
    const list = [...this.tickets.values()].sort((a, b) => a.born - b.born);
    const n = list.length;
    const step = n > 1 ? Math.min(cw + 6, (w - cw) / (n - 1)) : 0;
    let moved = false;
    list.forEach((v, i) => {
      const x = Math.round(w - cw - i * step);
      if (Math.abs(x - v.x) < 1) return;
      if (v.x > -100) moved = true;
      v.x = x;
      v.card.style.transform = `translateX(${x}px)`;
      v.marble.style.transform = `translateX(${x + cw / 2 - 5}px)`;
      v.card.style.zIndex = String(n - i);
    });
    if (closedGap && moved) window.setTimeout(() => sfx.railSlide(), 120);
  }

  /** A sold ticket flies down the rail onto the spike, and the stack on the spike grows. */
  private spikeTicket(card: HTMLElement, x: number) {
    const sx = this.spike.offsetLeft + this.spike.clientWidth / 2 - card.clientWidth / 2;
    card.classList.add('to-spike');
    card.style.transform = `translateX(${x}px)`;
    requestAnimationFrame(() => {
      card.style.transform = `translate(${sx}px, 6px) rotate(${(Math.random() * 16 - 8).toFixed(1)}deg) scale(0.42)`;
    });
    window.setTimeout(() => {
      sfx.spike();
      this.spiked++;
      this.spikeCount.textContent = String(this.spiked);
      const slip = el('i', 'slip', this.spike);
      slip.style.transform = `rotate(${(Math.random() * 30 - 15).toFixed(0)}deg)`;
      slip.style.bottom = `${Math.min(10, this.spiked) * 3 + 6}px`;
      const slips = this.spike.querySelectorAll('.slip');
      if (slips.length > 10) slips[0]?.remove();
      this.spike.classList.remove('hit');
      void this.spike.offsetWidth;
      this.spike.classList.add('hit');
    }, 380);
  }

  private resetSpike() {
    this.spiked = 0;
    this.spikeCount.textContent = '';
    for (const s of this.spike.querySelectorAll('.slip')) s.remove();
  }
}
