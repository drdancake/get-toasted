import type { Cabinet } from './cabinet';
import { FLAVORS } from '../config/flavors';
import { HINT, MATT, MATT_DROP_COOLDOWN } from '../config/game';
import { CABINET } from '../config/cabinet';
import { dollars, REPUTATION } from '../config/money';
import { MATT_MOODS, mattFace } from '../ui/matt-face';
import { addToBoard, loadBoard, makesBoard, VIRAL } from '../config/arcade';
import { MATT_LINES, type MattMood } from '../config/matt-lines';
import type { Kitchen, KitchenEvent } from './kitchen';
import { SHIFT_TICKETS } from '../config/shift';
import type { TicketLine, TicketPaint } from './ticket-layer';
import { haptic, sfx } from '../ui/feel';
import { STAMPS } from '../config/stamps';
import { stamp, stampFrom } from '../ui/stamp';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement) => {
  const e = document.createElement(tag);
  e.className = cls;
  parent?.appendChild(e);
  return e;
};

/** Always-on layer: score, ticket rail, Matt, toasts, start and clock-out screens. */

/** Room kept at the left of the rail for the face-down pile, px. */
const RAIL_PILE_W = 22;
/** A split names two flavors on one line, so they go short. */
const SPLIT_SHORT: Partial<Record<string, string>> = { beef: 'BEEF', cheese: 'CHZ', buffalo: 'BUFF' };
/** What a flavor is called on a ticket: the way it's rung in, short enough to read at a glance. */
const TICKET_NAME: Partial<Record<string, string>> = { beef: 'BEEF' };

function escapeHtml(t: string) {
  return t.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

export class ShiftHud {
  private score: HTMLElement;
  private combo: HTMLElement;
  private face: HTMLElement;
  private pips: HTMLElement;
  private best: HTMLElement;
  private patienceFill!: HTMLElement;
  private viralBanner!: HTMLElement;
  private attractTimer = 0;
  private rail: HTMLElement;
  private tickets = new Map<number, { card: HTMLElement; bar: HTMLElement; marble: HTMLElement; x: number; born: number; w?: number; name: string; lines: (TicketLine & { item: number })[]; left: number; flag?: string }>();
  private pileEl!: HTMLElement;
  private piled = 0;
  private railU = 0;
  private railW = 0;
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
    // Matt and his patience: the bar empties, his face sours, and at the end of it you're fired.
    const matt = el('div', 'patience', hud);
    this.face = el('div', 'hud-face', matt);
    const meter = el('div', 'patience-bar', matt);
    this.patienceFill = el('i', '', meter);
    this.best = el('div', 'best', hud);
    this.viralBanner = el('div', 'viral-banner', root);
    this.viralBanner.innerHTML = '<b>GOING VIRAL</b><span></span>';
    this.rail = el('div', 'strip rail', root);
    this.track = el('div', 'rail-track', this.rail);
    el('div', 'rail-bar', this.rail);
    this.pileEl = el('div', 'rail-pile', this.rail);
    this.spike = el('div', 'spike', this.rail);
    el('div', 'spike-rod', this.spike);
    el('div', 'spike-base', this.spike);
    this.spikeCount = el('div', 'spike-count', this.spike);
    // Tap the spike: the tickets on it, newest on top, each with what was wrong with it.
    this.spike.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.showLog(root);
    });
    this.matt = el('div', 'mattpop', root);
    el('div', 'mattpop-face', this.matt).innerHTML = mattFace(4);
    this.mattLine = el('div', 'mattpop-line', this.matt);
    this.toast = el('div', 'toast', root);
    this.screen = el('div', 'screen', root);
    // Tapping anywhere starts a real shift; the PREP button starts practice with no clock.
    this.screen.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (performance.now() < this.screenReadyAt || this.screen.classList.contains('entering')) return;
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
      <div class="title-card">
        <div class="title-flag"><i></i><i></i><i></i></div>
        <div class="title">GET<br>TOASTED</div>
        <div class="title-sub">the fryer station at STL Toasted</div>
      </div>
      <ul class="howto">
        <li><b>Freezer.</b> Tap a bin, catch the ravs in a basket.</li>
        <li><b>Fryers.</b> Drop it in, hit its timer, pull it golden.</li>
        <li><b>Table.</b> Box, name, sauce. Salt and toss. Plate it.</li>
      </ul>
      <div class="start-row">
        <button class="start-shift">CLOCK IN<small>the real shift</small></button>
        <button class="start-prep">PREP<small>no clock, practice</small></button>
      </div>
      <div class="build">build ${buildId} · <a href="?v=toss1">first toss toy</a> · <a href="?v=tap">tap build</a></div>`;
    for (const a of this.screen.querySelectorAll('a')) a.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.coinPanel();
    this.attract();
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
    this.wipe();
    this.screen.hidden = true;
  }

  /** A checkered flag sweeps across whenever the screen changes hands. */
  private wipe() {
    const w = el('div', 'wipe', this.screen.parentElement ?? document.body);
    window.setTimeout(() => w.remove(), 650);
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
        // A run of losses is one alert that keeps adding up, punching in again each time.
        if (now < this.wasteUntil) {
          this.wasteRun += ev.cents;
          this.wasteHits++;
        } else {
          this.wasteRun = ev.cents;
          this.wasteHits = 1;
        }
        this.wasteUntil = now + HINT.showSeconds;
        this.flash(`${dollars(-this.wasteRun)} of Matt's money`, 'bad', now);
        if (this.wasteHits > 1) {
          this.toast.classList.remove('punch');
          void this.toast.offsetWidth;
          this.toast.style.setProperty('--rot', `${((this.wasteHits * 37) % 13) - 6}deg`);
          this.toast.style.setProperty('--grow', String(Math.min(1.6, 1 + this.wasteHits * 0.08)));
          this.toast.classList.add('punch');
        }
        if (ev.cents >= 500 && now - this.lastDropLine > MATT_DROP_COOLDOWN) {
          this.lastDropLine = now;
          this.say('money', now);
        }
        break;
      case 'silly':
        this.noNameAt = now;
        stampFrom(STAMPS.silly, { name: (ev.name || 'THE GUEST').toUpperCase() }, 'gold');
        break;
      case 'noName':
        this.noNameAt = now;
        stampFrom(STAMPS.noName, { name: (ev.name || 'THE GUEST').toUpperCase(), other: (ev.other || 'SOMEBODY').toUpperCase() }, 'red');
        sfx.reject();
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
        if (ev.missingSauce) {
          // He names the sauce that's actually missing.
          const what = ev.wantedSauce === 'mascarpone' ? 'mascarpone' : (ev.wantedSauce ?? 'sauce');
          const lines = [`Where is the ${what}, bud?`, `No ${what}. They are going to call about that.`, `A box with no ${what}. Bold.`];
          this.heckle(lines[Math.floor(Math.random() * lines.length)] ?? '', now);
        }
        else if (ev.salty) this.say('salty', now);
        else if (ev.generous && Math.random() < 0.5) this.say('generous', now);
        const tip = (ev.orderDone && ev.tip ? ` + ${dollars(ev.tip)} tip` : '') + (ev.generous ? ' · +1 on the house' : '');
        this.flash(`${label} +${ev.pts.toLocaleString('en-US')}${ev.mult > 1 ? ` ×${ev.mult}` : ''}${tip ? ` · ${tip.replace(/^ \+ /, '')}` : ''}`, ev.quality === 'perfect' ? 'good' : '', now);
        if (ev.strays) this.say('mixed', now);
        // The table's big moments: a perfectly dressed box, and clean tickets in a row.
        // The guest by name: the person this was for.
        // A box that just went to the wrong guest doesn't also get a pat on the back.
        if (now - this.noNameAt < 0.3) break;
        // No pat on the back for a box with the sauce missing or wrong.
        if (ev.missingSauce || ev.wrongSauce) break;
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
      case 'viral':
        if (ev.on) {
          stamp('GOING VIRAL!', 'SOMEBODY POSTED IT. HERE THEY COME.', 'green');
          sfx.perfect();
          haptic(30);
        } else stamp('IT BLEW OVER', 'THE PLACE IS BUSIER NOW.', 'gold');
        break;
      case 'gameOver':
        this.results(ev);
        this.wipe();
        this.screen.hidden = false;
        this.screenReadyAt = performance.now() + 900;
        this.coinPanel();
        this.screen.appendChild(this.operatorSpot());
        break;
      default:
        break;
    }
  }

  /** The end of a shift: what happened, your initials if you made the board, and the board. */
  private results(ev: Extract<KitchenEvent, { type: 'gameOver' }>) {
    const pts = ev.points.toLocaleString('en-US');
    const head = ev.prep ? 'Prep’s done.' : ev.fired ? 'YOU’RE FIRED.' : 'Clocked out.';
    const sub = ev.prep ? '' : ev.fired ? 'Matt ran out of patience.' : 'Matt will allow it.';
    const onBoard = !ev.prep && makesBoard(ev.points);
    const stats = `
      <div class="final-stats">
        <span><b>${dollars(ev.score)}</b>made Matt</span>
        <span><b>${ev.served}</b>boxes out</span>
        <span><b>${ev.bestCombo}</b>best streak</span>
        <span><b>${dollars(ev.wasted)}</b>on the floor</span>
      </div>`;
    const buttons = `
      <div class="start-row">
        <button class="start-shift">CLOCK IN<small>another shift</small></button>
        <button class="start-prep">PREP<small>no clock</small></button>
      </div>`;
    const render = (placed: number) => {
      this.screen.classList.remove('entering');
      this.screen.innerHTML = `
        <div class="title small ${ev.fired ? 'fired' : ''}">${head}</div>
        <div class="title-sub">${sub}</div>
        <div class="final">${pts}</div>
        ${stats}
        ${boardHtml(placed)}
        ${buttons}`;
      this.screenReadyAt = performance.now() + 700;
      this.coinPanel();
      this.screen.appendChild(this.operatorSpot());
    };
    if (!onBoard) return render(-1);
    // Three letters, arcade style: tap a letter's arrows, then OK.
    this.screen.classList.add('entering');
    const letters = [0, 0, 0];
    const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    this.screen.innerHTML = `
      <div class="title small ${ev.fired ? 'fired' : ''}">${head}</div>
      <div class="final">${pts}</div>
      <div class="title-sub">That’s on the board. Initials?</div>
      <div class="initials">${[0, 1, 2].map((i) => `<div class="initial" data-i="${i}"><button data-d="1">▲</button><b>A</b><button data-d="-1">▼</button></div>`).join('')}</div>
      <button class="initials-ok">OK</button>`;
    this.screen.querySelectorAll<HTMLElement>('.initial button').forEach((btn) => {
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const i = Number(btn.parentElement?.dataset.i ?? 0);
        letters[i] = ((letters[i] ?? 0) + Number(btn.dataset.d) + 26) % 26;
        const b = btn.parentElement?.querySelector('b');
        if (b) b.textContent = A[letters[i] ?? 0] ?? 'A';
        sfx.rim();
        haptic(4);
      });
    });
    this.screen.querySelector('.initials-ok')?.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      sfx.perfect();
      render(addToBoard(letters.map((n) => A[n]).join(''), ev.points));
    });
  }

  /**
   * Nobody's playing: the title screen takes turns with the high scores and a few cards, the way
   * a cabinet does when it's left alone.
   */
  private attract() {
    window.clearInterval(this.attractTimer);
    let i = 0;
    const card = el('div', 'attract', this.screen);
    const cards = () => [
      '',
      boardHtml(-1),
      '<div class="attract-card red"><b>LOVE THE GAME?</b><span>Try it in real life.</span><i>STL Toasted is hiring.</i></div>',
      '<div class="attract-card"><b>WINNERS DON’T OVERCOOK RAVS</b><i>a message from Matt</i></div>',
      `<div class="attract-card green"><b>THIS FRYER HAS GONE</b><em>0</em><b>DAYS WITHOUT AN INCIDENT</b></div>`,
      `<div class="attract-card matt">${mattFace(1)}<b>MATT IS WATCHING</b></div>`,
    ];
    this.attractTimer = window.setInterval(() => {
      if (this.screen.hidden || !card.isConnected || this.screen.classList.contains('entering')) return;
      i = (i + 1) % cards().length;
      const html = cards()[i] ?? '';
      // An empty board isn't worth a turn.
      card.innerHTML = html.includes('board-empty') ? '' : html;
      this.screen.classList.toggle('attracting', card.innerHTML !== '');
    }, 5200);
  }

  /** A good-news line on the toast. */
  note(text: string, now: number) {
    this.flash(text, 'good', now);
  }

  /** Matt, with something to say that isn't one of his stock moods (a nudge). */
  heckle(line: string, now: number) {
    this.mattLine.textContent = `“${line}”`;
    this.matt.classList.remove('on');
    void this.matt.offsetWidth;
    this.matt.classList.add('on');
    this.mattUntil = now + MATT.showSeconds;
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

  private noNameAt = -9;
  private moodShown = -1;
  private wasteRun = 0;
  private wasteHits = 0;
  private wasteUntil = 0;

  private flash(text: string, kind: string, now: number) {
    this.toast.textContent = text;
    this.toast.className = `toast on ${kind}`;
    this.toastUntil = now + HINT.showSeconds;
  }

  update(now: number) {
    const k = this.k;
    // Money on the left, the restaurant's stars in the middle, Matt's face reads the stars.
    // Points on the left with the multiplier, Matt and his patience in the middle, what you've made him on the right.
    const pts = k.points.toLocaleString('en-US');
    if (this.score.textContent !== pts) {
      this.score.textContent = pts;
      this.score.classList.remove('bump');
      void this.score.offsetWidth;
      this.score.classList.add('bump');
    }
    this.best.textContent = dollars(k.score);
    this.best.classList.toggle('neg', k.score < 0);
    const mult = k.multiplier;
    this.combo.textContent = mult > 1 ? `×${mult}` : '';
    this.pips.textContent = k.prep ? 'PREP' : '';
    const pat = k.prep ? 1 : k.patience;
    this.patienceFill.style.transform = `scaleX(${pat.toFixed(3)})`;
    this.patienceFill.className = pat < 0.25 ? 'low' : pat < 0.5 ? 'mid' : '';
    this.patienceFill.parentElement?.classList.toggle('shake', pat < 0.25 && !k.prep && k.phase === 'playing');
    // Viral: the banner counts it down.
    const viral = k.viral && k.phase === 'playing';
    document.body.classList.toggle('viral', viral);
    if (viral) {
      const left = Math.max(0, Math.ceil(k.viralUntil - k.time));
      const span = this.viralBanner.querySelector('span');
      if (span) span.textContent = `×${VIRAL.points} · ${left}s`;
    }
    this.clockOutBtn.hidden = !(k.prep && k.phase === 'playing' && k.scene === 'station');
    const mood = Math.max(0, Math.min(MATT_MOODS - 1, Math.round(((k.rep - REPUTATION.fireAt) / (REPUTATION.max - REPUTATION.fireAt)) * (MATT_MOODS - 1))));
    if (mood !== this.moodShown) {
      this.moodShown = mood;
      this.face.innerHTML = mattFace(mood);
    }
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
    // Receipts: everything on the ticket readable at once. Patience runs along the top, by the rail;
    // a Sharpie dot marks a line once its ravs are in the oil; a line that has gone out is struck.
    const stages = k.itemStages();
    for (const t of k.tickets) {
      let v = this.tickets.get(t.id);
      if (!v) {
        const card = el('div', 'receipt', this.track);
        const bar = el('div', 'timer', card);
        el('div', 'receipt-no', card).textContent = (t.name ?? '').toUpperCase();
        if (t.remake) el('div', 'receipt-flag', card).textContent = 'REMAKE · RUSH';
        const body = el('div', 'receipt-body', card);
        const lines: (TicketLine & { item: number })[] = [];
        for (const it of t.items) {
          const line = el('div', 'receipt-line', body);
          line.dataset.item = String(it.id);
          const tints = it.lines.map((l) => FLAVORS[l.flavor].tint);
          const split = it.lines.length > 1;
          const what = it.lines.map((l) => (split ? SPLIT_SHORT[l.flavor] : TICKET_NAME[l.flavor]) ?? FLAVORS[l.flavor].short).join('/');
          line.innerHTML = `<i style="background:linear-gradient(${tints[0]} 50%, ${tints[tints.length - 1]} 50%)"></i><b>${it.size}</b><span>${what}</span><u></u>`;
          const mod = it.sub ? `SUB ${it.sub.toUpperCase()}` : undefined;
          if (mod) el('div', 'receipt-mod', body).textContent = mod;
          lines.push({ item: it.id, size: it.size, what, tints, mod, dotted: false, done: false });
        }
        // It comes in at the far end and slides down the rail into place; the marble clacks.
        const marble = el('i', 'marble', this.track);
        card.style.transform = marble.style.transform = 'translateX(-130px)';
        v = { card, bar, marble, x: -130, born: t.remake ? -1e6 + t.id : t.bornAt, name: (t.name ?? '').toUpperCase(), lines, left: 1, flag: t.remake ? 'REMAKE · RUSH' : undefined };
        this.tickets.set(t.id, v);
        // The printer chatters, then the ticket's shoved onto the rail.
        sfx.printer();
        window.setTimeout(() => sfx.marble(), 360);
      }
      for (const line of v.card.querySelectorAll<HTMLElement>('.receipt-line')) {
        const it = t.items.find((x) => String(x.id) === line.dataset.item);
        line.classList.toggle('done', !!it?.done);
        // Dotted once it's dropped: frying or anything past it.
        line.classList.toggle('dotted', !!it && (it.done || (stages.get(it.id) ?? 0) >= 2));
      }
      for (const l of v.lines) {
        const it = t.items.find((x) => x.id === l.item);
        l.done = !!it?.done;
        l.dotted = !!it && (it.done || (stages.get(it.id) ?? 0) >= 2);
      }
      const left = Math.max(0, 1 - (k.time - t.bornAt) / t.life);
      v.left = left;
      v.bar.style.transform = `scaleX(${left})`;
      v.card.classList.toggle('warm', left < 0.55 && left >= 0.3);
      v.card.classList.toggle('urgent', left < 0.3);
    }
    // The pile: tickets the rail has no room for yet, face-down at its left end.
    const piled = k.pile.length;
    if (piled !== this.piled) {
      if (piled > this.piled) sfx.printer();
      this.piled = piled;
      this.pileEl.classList.toggle('on', piled > 0);
      this.pileEl.innerHTML = `${'<i></i>'.repeat(Math.min(3, piled))}<b>+${piled}</b>`;
    }
    this.layoutRail(gone > 0);
  }

  /** The spike, read back: every box that went out (or didn't) and why the guest felt how they felt. */
  private showLog(root: HTMLElement) {
    if (root.querySelector('.order-log') || !this.k.log.length) return;
    const was = this.k.phase;
    if (was === 'playing') this.k.pause();
    const veil = el('div', 'order-log', root);
    const sheet = el('div', 'order-log-sheet', veil);
    el('div', 'order-log-title', sheet).textContent = 'ON THE SPIKE';
    for (const entry of [...this.k.log].reverse()) {
      const row = el('div', `order-log-row ${entry.result === 'served' ? (entry.issues.length ? 'meh' : 'clean') : 'bad'}`, sheet);
      const head = el('div', 'order-log-head', row);
      el('b', '', head).textContent = entry.name.toUpperCase();
      el('span', '', head).textContent = entry.what;
      el('i', '', head).textContent = entry.result === 'served' ? dollars(entry.cents) : entry.result.toUpperCase();
      if (entry.issues.length) for (const issue of entry.issues) el('div', 'order-log-issue', row).textContent = issue;
      else el('div', 'order-log-issue ok', row).textContent = 'Nothing to complain about.';
    }
    el('div', 'order-log-foot', sheet).textContent = 'tap anywhere to get back to it';
    veil.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      veil.remove();
      if (was === 'playing') this.k.resume();
    });
  }

  /**
   * Paint the tickets in the scene (so ravs fly in front of them) instead of as DOM over it. The
   * hidden DOM cards still do the layout and the sliding; this reports where each one is.
   */
  paintInScene(on: boolean) {
    this.rail.classList.toggle('gl', on);
  }

  ticketPaints(): TicketPaint[] {
    const out: TicketPaint[] = [];
    for (const [id, v] of this.tickets) {
      const r = v.card.getBoundingClientRect();
      out.push({ id, x: r.left, y: r.top, w: v.w ?? Math.round(r.width), u: this.railU || 1, name: v.name, lines: v.lines, left: v.left, flag: v.flag });
    }
    return out;
  }

  /**
   * Hang the tickets on the rail: oldest at the spike end, each newer one behind it. Every receipt is
   * the same width; a long order hangs longer. Anything that moves, slides (and rattles).
   */
  private layoutRail(closedGap: boolean) {
    const w = this.track.clientWidth;
    const colW = (w - RAIL_PILE_W) / SHIFT_TICKETS.railMax;
    // Type grows with the rail: a receipt is about 80 px wide on a phone.
    const u = Math.max(1, Math.min(1.6, colW / 80));
    if (Math.abs(u - this.railU) > 0.01 || w !== this.railW) {
      this.railU = u;
      this.railW = w;
      this.rail.style.setProperty('--u', u.toFixed(2));
      // The rail hangs off the bottom edge of the timers, wherever that lands on this screen.
      const bank = this.rail.parentElement?.querySelector<HTMLElement>('.timer-bank');
      if (bank?.offsetHeight) this.rail.style.top = `${bank.offsetTop + bank.offsetHeight - 6}px`;
    }
    const list = [...this.tickets.values()].sort((a, b) => a.born - b.born);
    const n = list.length;
    let moved = false;
    let right = w;
    list.forEach((v, i) => {
      const cw = Math.round(colW - 4);
      const x = Math.round(right - cw - 2);
      right -= colW;
      if (v.w !== cw) {
        v.w = cw;
        v.card.style.width = `${cw}px`;
      }
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

/** The high-score board, with one row marked if it's the score just made. */
function boardHtml(placed: number) {
  const rows = loadBoard();
  if (!rows.length) return '<div class="board board-empty"></div>';
  return `<div class="board"><div class="board-title">TOP FRY COOKS</div>${rows
    .map((r, i) => `<div class="board-row${i === placed ? ' you' : ''}"><i>${i + 1}</i><b>${escapeHtml(r.name)}</b><span>${r.points.toLocaleString('en-US')}</span></div>`)
    .join('')}</div>`;
}
