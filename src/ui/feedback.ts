// Playtest feedback: a little tab in the corner. Tap it mid-shift and the game pauses, grabs a
// screenshot and the whole game state, and you add a note. It goes to the artifact's database
// (the `db` capability) where Claude reads it; with no database (local dev), it's kept in
// localStorage instead.

interface Claude {
  use(name: string): Promise<unknown>;
}
interface Db {
  collection(path: string): { add(data: Record<string, unknown>): Promise<unknown> };
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement) => {
  const e = document.createElement(tag);
  e.className = cls;
  parent?.appendChild(e);
  return e;
};

export interface FeedbackHooks {
  /** Everything worth knowing about the game right now (plain data). */
  state(): Record<string, unknown>;
  /** A small JPEG of what's on screen (data URL), or '' if it can't be had. */
  shot(): string;
  pause(): void;
  resume(): void;
}

export class Feedback {
  private db: Db | null = null;
  private sheet: HTMLElement;
  private note: HTMLTextAreaElement;
  private status: HTMLElement;
  private img: HTMLImageElement;
  private snap: { state: Record<string, unknown>; shot: string } | null = null;
  /** The last few things that happened, for context. */
  private log: string[] = [];

  constructor(parent: HTMLElement, private hooks: FeedbackHooks, private build: string) {
    const tab = el('button', 'fb-tab', parent);
    tab.textContent = 'NOTE';
    tab.title = 'Send a playtest note with the game state';
    tab.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.open();
    });
    this.sheet = el('div', 'fb-sheet', parent);
    this.sheet.hidden = true;
    const card = el('div', 'fb-card', this.sheet);
    el('div', 'fb-title', card).textContent = 'PLAYTEST NOTE';
    this.img = el('img', 'fb-shot', card);
    this.note = el('textarea', 'fb-note', card);
    this.note.placeholder = 'What happened? What felt off? What did you expect?';
    this.status = el('div', 'fb-status', card);
    const row = el('div', 'fb-row', card);
    const cancel = el('button', 'fb-btn', row);
    cancel.textContent = 'BACK TO THE SHIFT';
    cancel.addEventListener('click', () => this.close());
    const send = el('button', 'fb-btn primary', row);
    send.textContent = 'SEND';
    send.addEventListener('click', () => void this.send());
    this.sheet.addEventListener('pointerdown', (e) => e.stopPropagation());
    const c = (window as unknown as { claude?: Claude }).claude;
    c?.use('db')
      .then((db) => {
        this.db = (db as Db | null) ?? null;
      })
      .catch(() => {
        this.db = null;
      });
  }

  /** Remember an event (called for every kitchen event). */
  note_(text: string) {
    this.log.push(text);
    if (this.log.length > 30) this.log.shift();
  }

  private open() {
    if (!this.sheet.hidden) return;
    const shot = this.hooks.shot();
    this.snap = { state: { ...this.hooks.state(), recent: [...this.log] }, shot };
    this.hooks.pause();
    this.img.src = shot;
    this.img.hidden = !shot;
    this.note.value = '';
    this.status.textContent = this.db ? '' : 'Not connected: it will be saved on this device.';
    this.sheet.hidden = false;
    window.setTimeout(() => this.note.focus(), 50);
  }

  private close() {
    this.sheet.hidden = true;
    this.note.blur();
    this.hooks.resume();
  }

  /** Save a finished run's action log beside the notes (same place, marked as a run). Best effort. */
  saveRun(run: Record<string, unknown>) {
    void this.db
      ?.collection('feedback')
      .add({ at: new Date().toISOString(), build: this.build, kind: 'run', note: '', screen: `${window.innerWidth}x${window.innerHeight}@${window.devicePixelRatio}`, ...run })
      .catch(() => undefined);
  }

  private async send() {
    const s = this.snap;
    if (!s) return;
    const doc = {
      at: new Date().toISOString(),
      build: this.build,
      note: this.note.value.trim(),
      screen: `${window.innerWidth}x${window.innerHeight}@${window.devicePixelRatio}`,
      ua: navigator.userAgent,
      state: JSON.stringify(s.state),
      shot: s.shot,
    };
    this.status.textContent = 'Sending…';
    try {
      if (!this.db) throw new Error('no db');
      await this.db.collection('feedback').add(doc);
      this.status.textContent = 'Sent. Thanks!';
    } catch {
      try {
        const k = 'get-toasted.feedback';
        const all = JSON.parse(localStorage.getItem(k) ?? '[]') as unknown[];
        all.push({ ...doc, shot: '' });
        localStorage.setItem(k, JSON.stringify(all.slice(-20)));
        this.status.textContent = 'Saved on this device (no connection).';
      } catch {
        this.status.textContent = 'Could not save it.';
        return;
      }
    }
    window.setTimeout(() => this.close(), 700);
  }
}
