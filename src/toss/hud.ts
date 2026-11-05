import { FLAVORS } from '../config/flavors';
import { HINT, MATT, MATT_DROP_COOLDOWN, PATIENCE } from '../config/game';
import { MATT_FACES } from '../config/look';
import { MATT_LINES, type MattMood } from '../config/matt-lines';
import type { Container, TossEvent, TossSim } from './sim';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement) => {
  const e = document.createElement(tag);
  e.className = cls;
  parent?.appendChild(e);
  return e;
};

/** Screen position in CSS pixels for a world point. */
export type Project = (x: number, y: number, z?: number) => { x: number; y: number };

/** DOM on top of the toss station: HUD, ticket rail, Matt, counts, floaters, screens. */
export class TossHud {
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
  private counts: HTMLElement[] = [];
  private floaters: HTMLElement;
  private screen: HTMLElement;
  private screenReadyAt = 0;

  constructor(root: HTMLElement, private sim: TossSim, onStart: () => void, buildId: string) {
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

    for (let i = 0; i < sim.baskets.length + 1; i++) this.counts.push(el('div', 'count-badge', root));
    this.floaters = el('div', 'floaters', root);
    this.toast = el('div', 'toast', root);

    this.screen = el('div', 'screen', root);
    this.screen.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (performance.now() >= this.screenReadyAt) onStart();
    });
    this.screen.innerHTML = `
      <div class="title">GET<br>TOASTED</div>
      <ol class="howto">
        <li>Tap the <b>freezer bag</b>. Catch the ravs in a <b>basket</b>.</li>
        <li>Drag the basket into the <b>oil</b>.</li>
        <li>Pull it out when they're <b class="gold">gold</b>.</li>
        <li><b>Flick</b> them into the box.</li>
        <li><b>Swipe the box up</b> to serve.</li>
      </ol>
      <div class="tap">Tap to start</div>
      <div class="build">build ${buildId} · <a href="?v=tap">old tap version</a></div>`;
    const link = this.screen.querySelector('a');
    link?.addEventListener('pointerdown', (e) => e.stopPropagation());
  }

  hideScreen() {
    this.screen.hidden = true;
  }

  handle(ev: TossEvent, now: number, project: Project) {
    switch (ev.type) {
      case 'dead': {
        const p = project(ev.x, ev.y);
        this.float(p.x, p.y, ev.kind === 'oil' ? 'oil’s lunch' : '−60', 'bad');
        if (now - this.lastDropLine > MATT_DROP_COOLDOWN) {
          this.lastDropLine = now;
          this.say('dropped', now);
        }
        break;
      }
      case 'served': {
        const label = ev.quality === 'perfect' ? 'PERFECT' : 'OK';
        const combo = ev.combo > 1 ? `  x${Math.min(ev.combo, 5)}` : '';
        this.flash(`${label} +${ev.points + ev.tip}${combo}`, ev.quality === 'perfect' ? 'good' : '', now);
        if (ev.extra > 0) {
          const b = this.sim.box;
          const p = project(b.x, b.top + 0.5);
          this.float(p.x, p.y, `${ev.extra} extra, that’s food cost`, 'bad');
        }
        break;
      }
      case 'rejected':
        this.flash(ev.reason === 'short' ? `SHORT ${ev.missing}` : ev.reason === 'cold' ? 'COLD' : 'BURNT', 'bad', now);
        this.say(ev.reason, now);
        break;
      case 'bigCombo':
        this.say('bigCombo', now);
        break;
      case 'ticketExpired':
        this.flash('TICKET EXPIRED', 'bad', now);
        break;
      case 'hint':
        this.flash(ev.text, '', now);
        break;
      case 'spill': {
        const p = project(ev.x, ev.y);
        this.float(p.x, p.y, 'too many!', 'bad');
        break;
      }
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
    void this.matt.offsetWidth; // restart the pop animation
    this.matt.classList.add('on');
    this.mattUntil = now + MATT.showSeconds;
  }

  private flash(text: string, kind: string, now: number) {
    this.toast.textContent = text;
    this.toast.className = `toast on ${kind}`;
    this.toastUntil = now + HINT.showSeconds;
  }

  private float(x: number, y: number, text: string, kind: string) {
    const f = el('div', `floater ${kind}`, this.floaters);
    f.textContent = text;
    f.style.left = `${x}px`;
    f.style.top = `${y}px`;
    f.addEventListener('animationend', () => f.remove());
  }

  update(now: number, project: Project) {
    const s = this.sim;
    this.score.textContent = s.score.toLocaleString();
    this.best.textContent = `best ${Math.max(s.best, s.score).toLocaleString()}`;
    this.combo.textContent = s.combo > 1 ? `x${Math.min(s.combo, 5)}` : '';
    this.pips.textContent = '●'.repeat(s.patience) + '○'.repeat(Math.max(0, PATIENCE.max - s.patience));
    this.face.textContent = MATT_FACES[Math.min(s.patience, MATT_FACES.length - 1)] ?? '😐';
    if (now > this.mattUntil) this.matt.classList.remove('on');
    if (now > this.toastUntil) this.toast.classList.remove('on');

    const live = new Set(s.tickets.map((t) => t.id));
    for (const [id, v] of this.tickets) {
      if (!live.has(id)) {
        v.card.remove();
        this.tickets.delete(id);
      }
    }
    for (const t of s.tickets) {
      let v = this.tickets.get(t.id);
      if (!v) {
        const card = el('div', 'ticket', this.rail);
        card.style.setProperty('--tint', FLAVORS[t.flavor].tint);
        card.innerHTML = `<span class="count">${t.count}</span><span class="name">${FLAVORS[t.flavor].name}</span>`;
        v = { card, bar: el('div', 'timer', card) };
        this.tickets.set(t.id, v);
      }
      const left = Math.max(0, 1 - (s.time - t.bornAt) / t.life);
      v.bar.style.transform = `scaleX(${left})`;
      v.card.classList.toggle('urgent', left < 0.3);
    }

    // Count badges over each basket and the box, green when they match the next ticket.
    const want = s.tickets[0]?.count ?? 0;
    const containers: Container[] = [...s.baskets, s.box];
    containers.forEach((c, i) => {
      const badge = this.counts[i];
      if (!badge) return;
      const n = c.ravs.length;
      const show = s.phase === 'playing' && n > 0 && !(c === s.box && s.box.mode !== 'ready');
      badge.classList.toggle('on', show);
      if (!show) return;
      const p = project(c.x, c.top + 0.45);
      badge.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%)`;
      badge.textContent = want ? `${n}/${want}` : `${n}`;
      badge.classList.toggle('match', n === want);
      badge.classList.toggle('over', want > 0 && n > want);
    });
  }
}
