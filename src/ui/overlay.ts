import { ACTIVE_FLAVORS, FLAVORS, type FlavorId } from '../config/flavors';
import { HINT, MATT, PATIENCE } from '../config/game';
import { LAYOUT } from '../config/layout';
import { MATT_FACES } from '../config/look';
import { MATT_LINES, type MattMood } from '../config/matt-lines';
import type { Game } from '../game/game';
import type { GameEvent } from '../game/types';

type Band = { v0: number; v1: number };

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement) => {
  const e = document.createElement(tag);
  e.className = cls;
  parent?.appendChild(e);
  return e;
};

const place = (e: HTMLElement, band: Band) => {
  e.style.top = `${band.v0 * 100}%`;
  e.style.height = `${(band.v1 - band.v0) * 100}%`;
};

export interface OverlayHandlers {
  onFlavor: (f: FlavorId) => void;
  onServe: () => void;
  onStart: () => void;
}

/** All DOM on top of the canvas. Reads game state each frame, reacts to game events. */
export class Overlay {
  private score: HTMLElement;
  private best: HTMLElement;
  private combo: HTMLElement;
  private pips: HTMLElement;
  private rail: HTMLElement;
  private tickets = new Map<number, { card: HTMLElement; bar: HTMLElement }>();
  private handLabel: HTMLElement;
  private serveBtn: HTMLButtonElement;
  private mattFace: HTMLElement;
  private mattLine: HTMLElement;
  private mattUntil = 0;
  private toast: HTMLElement;
  private toastUntil = 0;
  private screen: HTMLElement;
  private screenReadyAt = 0;
  private lastLine = new Map<MattMood, string>();

  constructor(root: HTMLElement, private game: Game, private h: OverlayHandlers, buildId: string) {
    const hud = el('div', 'strip hud', root);
    place(hud, LAYOUT.hud);
    this.score = el('div', 'score', hud);
    this.combo = el('div', 'combo', hud);
    this.pips = el('div', 'pips', hud);
    this.best = el('div', 'best', hud);

    this.rail = el('div', 'strip rail', root);
    place(this.rail, LAYOUT.rail);

    const freezer = el('div', 'strip freezer', root);
    place(freezer, LAYOUT.freezer);
    for (const id of ACTIVE_FLAVORS) {
      const f = FLAVORS[id];
      const b = el('button', 'flavor', freezer);
      b.style.setProperty('--tint', f.tint);
      b.innerHTML = `<span class="flavor-name">${f.name}</span><span class="flavor-sub">freezer</span>`;
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.h.onFlavor(id);
      });
    }

    const pass = el('div', 'strip pass', root);
    place(pass, LAYOUT.pass);
    this.handLabel = el('div', 'hand-label', pass);
    this.handLabel.style.left = `${LAYOUT.handU * 100}%`;
    this.serveBtn = el('button', 'serve', pass);
    this.serveBtn.style.left = `${LAYOUT.serveU * 100}%`;
    this.serveBtn.textContent = 'SERVE';
    this.serveBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.h.onServe();
    });

    const matt = el('div', 'strip matt', root);
    place(matt, LAYOUT.matt);
    this.mattFace = el('div', 'matt-face', matt);
    this.mattLine = el('div', 'matt-line', matt);

    this.toast = el('div', 'toast', root);

    this.screen = el('div', 'screen', root);
    this.screen.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (performance.now() >= this.screenReadyAt) this.h.onStart();
    });
    this.showTitle(buildId);
  }

  private showTitle(buildId: string) {
    this.screen.innerHTML = `
      <div class="title">GET<br>TOASTED</div>
      <ol class="howto">
        <li>Tap the <b>freezer</b> to load a basket</li>
        <li>Tap a <b>fryer</b> to drop it</li>
        <li>Tap it again when it's <b class="gold">gold</b></li>
        <li>Tap <b>SERVE</b></li>
      </ol>
      <div class="tap">Tap to start</div>
      <div class="build">build ${buildId}</div>`;
    this.screen.hidden = false;
  }

  hideScreen() {
    this.screen.hidden = true;
  }

  handle(ev: GameEvent, now: number) {
    switch (ev.type) {
      case 'rejected':
        this.say(ev.quality === 'cold' ? 'cold' : 'burnt', now);
        this.flash(ev.quality === 'cold' ? 'COLD' : ev.quality === 'popped' ? 'POPPED' : 'BURNT', 'bad', now);
        break;
      case 'served': {
        const label = ev.quality === 'perfect' ? 'PERFECT' : 'OK';
        const combo = ev.combo > 1 ? `  x${Math.min(ev.combo, 5)}` : '';
        this.flash(`${label} +${ev.points + ev.tip}${combo}`, ev.quality === 'perfect' ? 'good' : '', now);
        break;
      }
      case 'bigCombo':
        this.say('bigCombo', now);
        break;
      case 'ticketExpired':
        this.flash('TICKET EXPIRED', 'bad', now);
        break;
      case 'tossed':
      case 'hint':
        this.flash(ev.type === 'hint' ? ev.text : 'Tossed', '', now);
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
      case 'ticketArrived':
        break;
    }
  }

  private say(mood: MattMood, now: number) {
    const lines = MATT_LINES[mood];
    let line = lines[Math.floor(Math.random() * lines.length)] ?? '';
    if (lines.length > 1 && line === this.lastLine.get(mood)) {
      line = lines[(lines.indexOf(line) + 1) % lines.length] ?? line;
    }
    this.lastLine.set(mood, line);
    this.mattLine.textContent = `“${line}”`;
    this.mattLine.classList.add('on');
    this.mattUntil = now + MATT.showSeconds;
  }

  private flash(text: string, kind: string, now: number) {
    this.toast.textContent = text;
    this.toast.className = `toast on ${kind}`;
    this.toastUntil = now + HINT.showSeconds;
  }

  update(now: number) {
    const g = this.game;
    this.score.textContent = g.score.toLocaleString();
    this.best.textContent = `best ${Math.max(g.best, g.score).toLocaleString()}`;
    this.combo.textContent = g.combo > 1 ? `x${Math.min(g.combo, 5)}` : '';
    this.pips.textContent = '●'.repeat(g.patience) + '○'.repeat(Math.max(0, PATIENCE.max - g.patience));
    this.mattFace.textContent = MATT_FACES[Math.min(g.patience, MATT_FACES.length - 1)] ?? '😐';
    if (now > this.mattUntil) {
      this.mattLine.classList.remove('on');
      this.mattLine.textContent = g.phase === 'playing' ? 'Matt is watching.' : '';
    }
    if (now > this.toastUntil) this.toast.classList.remove('on');

    // Ticket rail: add new cards, drop gone ones, run the timers.
    const live = new Set(g.tickets.map((t) => t.id));
    for (const [id, v] of this.tickets) {
      if (!live.has(id)) {
        v.card.remove();
        this.tickets.delete(id);
      }
    }
    for (const t of g.tickets) {
      let v = this.tickets.get(t.id);
      if (!v) {
        const card = el('div', 'ticket', this.rail);
        card.style.setProperty('--tint', FLAVORS[t.flavor].tint);
        card.innerHTML = `<span class="count">${t.count}</span><span class="name">${FLAVORS[t.flavor].name}</span>`;
        const bar = el('div', 'timer', card);
        v = { card, bar };
        this.tickets.set(t.id, v);
      }
      const left = Math.max(0, 1 - (g.time - t.bornAt) / t.life);
      v.bar.style.transform = `scaleX(${left})`;
      v.card.classList.toggle('urgent', left < 0.3);
    }

    const hand = g.hand;
    if (!hand) this.handLabel.textContent = g.phase === 'playing' ? 'empty hands' : '';
    else if (hand.pulledAs === null) this.handLabel.textContent = `${hand.count} ${FLAVORS[hand.flavor].name} · raw`;
    else this.handLabel.textContent = `${hand.count} ${FLAVORS[hand.flavor].name} · ${hand.pulledAs}`;
    this.serveBtn.classList.toggle('ready', !!hand && hand.pulledAs !== null);
  }
}
