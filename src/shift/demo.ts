import { DEMO } from '../config/demo';
import { FLAVORS, SHIFT_FLAVORS } from '../config/flavors';
import { setMuted } from '../ui/feel';
import type { ShiftHud } from './hud';
import { type Basket, type Box, type Kitchen, saucesFor } from './kitchen';
import { newRav } from './physics';

interface Job {
  slot: number;
  stage: 'wait' | 'fry' | 'drain' | 'boxed';
  at: number;
  basket: Basket | null;
  box: Box | null;
  itemId: number;
}

/**
 * Attract mode's second act. Leave the title alone long enough and a ghost cook works the line:
 * baskets go down, come up golden, get boxed and go out, behind a TAP TO PLAY banner. It makes the
 * kitchen's own moves (nothing is faked on screen), it's silent, and any touch ends it.
 */
export class Demo {
  on = false;
  private idle = 0;
  private t = 0;
  private jobs: Job[] = [];
  private nextId = 9000;

  constructor(private k: Kitchen, private hud: ShiftHud) {
    // Any touch ends the demo, and that touch does nothing else: it mustn't also press what's under it.
    let swallowUntil = 0;
    const eat = (e: Event) => {
      if (performance.now() > swallowUntil) return;
      e.stopPropagation();
      e.preventDefault();
    };
    const wake = (e: Event) => {
      this.idle = 0;
      if (!this.on) return eat(e);
      this.stop();
      swallowUntil = performance.now() + 500;
      eat(e);
    };
    window.addEventListener('pointerdown', wake, true);
    window.addEventListener('keydown', wake, true);
    for (const type of ['pointerup', 'click', 'touchstart', 'touchend', 'mousedown', 'mouseup']) window.addEventListener(type, eat, true);
  }

  update(dt: number) {
    const k = this.k;
    if (!this.on) {
      // Only the title, left alone, with nothing open on top of it.
      if (k.phase !== 'title' || document.hidden || !this.hud.titleIdle()) this.idle = 0;
      else if ((this.idle += dt) >= DEMO.after) this.start();
      return;
    }
    this.t += dt;
    if (this.t >= DEMO.seconds || k.phase !== 'playing') return this.stop();
    for (const job of this.jobs) this.work(job);
  }

  private start() {
    const k = this.k;
    this.on = true;
    this.t = 0;
    this.idle = 0;
    setMuted(true);
    this.hud.newRun();
    k.start(true);
    k.holdTickets();
    this.jobs = k.slots.map((_, slot) => ({ slot, stage: 'wait', at: DEMO.firstDrop + slot * DEMO.between, basket: null, box: null, itemId: 0 }));
    this.hud.demo(true);
  }

  stop() {
    if (!this.on) return;
    this.on = false;
    this.idle = 0;
    this.k.toTitle();
    this.hud.demo(false);
    setMuted(false);
  }

  /** One slot's loop: drop a basket, fry it, pull it and let it drain, box it, send it. */
  private work(job: Job) {
    const k = this.k;
    const flavor = SHIFT_FLAVORS[job.slot % SHIFT_FLAVORS.length] ?? 'beef';
    const F = FLAVORS[flavor];
    if (job.stage === 'wait' && this.t >= job.at) {
      // Not enough demo left to see this one through: leave it.
      if (DEMO.seconds - this.t < DEMO.frySeconds + DEMO.drain + DEMO.boxed + 1) return;
      const b = k.liftEmpty(job.slot);
      if (!b) return;
      // The order it's for, on the rail.
      job.itemId = this.nextId++;
      const name = DEMO.names[job.itemId % DEMO.names.length] ?? 'MATT';
      k.tickets.push({ id: this.nextId++, name, bornAt: k.time, life: 999, items: [{ id: job.itemId, size: 6, lines: [{ flavor, count: 6 }], done: false }] } as never);
      // Six in the basket, already most of the way there (nobody watches a demo for five minutes).
      b.ravs = Array.from({ length: 6 }, (_, j) => Object.assign(newRav(flavor), { state: 'in' as const, lx: ((j % 3) - 1) * 0.5, ly: 0.12 + Math.floor(j / 3) * 0.22, cooked: Math.max(0.1, F.cook - DEMO.frySeconds) }));
      if (!k.placeInOil(b, job.slot)) return;
      b.settle = 1;
      job.basket = b;
      job.stage = 'fry';
    } else if (job.stage === 'fry' && job.basket) {
      // Up when it's golden: the middle of the window.
      if ((job.basket.ravs[0]?.cooked ?? 0) < F.cook + F.window * 0.4) return;
      const b = k.liftFromOil(job.slot);
      if (!b) return;
      k.hookOn(b, job.slot);
      job.stage = 'drain';
      job.at = this.t + DEMO.drain;
    } else if (job.stage === 'drain' && this.t >= job.at && job.basket) {
      const ref = k.tickets.flatMap((order) => order.items.map((item) => ({ order, item }))).find((x) => x.item.id === job.itemId);
      const box = k.takeBoxFor();
      if (!box || !ref) return;
      // A box the way it should go out: lined, named, sauced, salted, set and dressed.
      k.labelBox(box, job.itemId);
      box.labelQuality = 'clean';
      box.sauces = saucesFor(ref.item).slice(0, 2);
      const b = k.liftHooked(job.slot);
      if (b) {
        box.ravs = b.ravs.splice(0);
        for (const r of box.ravs) r.salted = true;
        k.hookOn(b, job.slot);
      }
      box.arranged = 1;
      box.garnish = 1;
      job.box = box;
      job.stage = 'boxed';
      job.at = this.t + DEMO.boxed;
    } else if (job.stage === 'boxed' && this.t >= job.at && job.box) {
      k.serve(job.box);
      job.box = null;
      job.basket = null;
      job.stage = 'wait';
      job.at = this.t + DEMO.rest;
    }
  }
}
