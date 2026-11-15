// Feedback you feel and hear. Synthesized with Web Audio so it costs zero
// bytes; Howler and real recordings replace it in the sound pass.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;
let sizzleGain: GainNode | null = null;

/** Call from the first tap (browsers only allow audio after a gesture). */
export function unlockAudio() {
  try {
    if (!ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.7;
      master.connect(ctx.destination);
      noise = ctx.createBuffer(1, ctx.sampleRate * 1.5, ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      startSizzleLoop();
      loadKit();
    }
    void ctx.resume();
  } catch {
    ctx = null;
  }
}

/** Silence everything (the demo plays without sound) or bring it back. */
export function setMuted(on: boolean) {
  if (master) master.gain.value = on ? 0 : 0.7;
  muted = on;
}
let muted = false;

function tone(freq: number, dur: number, type: OscillatorType, vol: number, slideTo?: number, delay = 0) {
  if (!ctx || !master) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function burst(dur: number, freq: number, q: number, vol: number, sweepTo?: number, delay = 0) {
  if (!ctx || !master || !noise) return;
  const t = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.setValueAtTime(freq, t);
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.02);
}

function startSizzleLoop() {
  if (!ctx || !master || !noise) return;
  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.loop = true;
  sizzleGain = ctx.createGain();
  sizzleGain.gain.value = 0;
  // The crackle: a band of the noise, not the hiss on top of it.
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 1400;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 5200;
  const crackle = ctx.createGain();
  crackle.gain.value = 0.45;
  src.connect(hp).connect(lp).connect(crackle).connect(sizzleGain);
  // The roil: the low rumble of a full fryer, bubbling unevenly.
  const low = ctx.createBiquadFilter();
  low.type = 'lowpass';
  low.frequency.value = 240;
  const roil = ctx.createGain();
  roil.gain.value = 2.6;
  const wobble = ctx.createOscillator();
  wobble.frequency.value = 6.5;
  const depth = ctx.createGain();
  depth.gain.value = 1.1;
  wobble.connect(depth).connect(roil.gain);
  wobble.start();
  src.connect(low).connect(roil).connect(sizzleGain);
  sizzleGain.connect(master);
  src.start();
}

import { BEAT } from '../config/beat';

// The drum kit is recorded: a Roland TR-808 (congas, cowbell, claves, maracas, toms, snare, kick,
// cymbal), from Michael Fischer's free sample set (see assets/audio/drums/SOURCE.txt). The files
// load when sound is first unlocked; until they have (or if they can't), each voice falls back
// to the little synthesized version of itself.
import blockUrl from '../../assets/audio/drums/block.wav';
import congaUrl from '../../assets/audio/drums/conga.wav';
import cowbellUrl from '../../assets/audio/drums/cowbell.wav';
import crashUrl from '../../assets/audio/drums/crash.wav';
import kickUrl from '../../assets/audio/drums/kick.wav';
import rimUrl from '../../assets/audio/drums/rim.wav';
import shakerUrl from '../../assets/audio/drums/shaker.wav';
import snareUrl from '../../assets/audio/drums/snare.wav';
import tomUrl from '../../assets/audio/drums/tom.wav';

const KIT_URLS = { block: blockUrl, conga: congaUrl, cowbell: cowbellUrl, crash: crashUrl, kick: kickUrl, rim: rimUrl, shaker: shakerUrl, snare: snareUrl, tom: tomUrl };
type KitVoice = keyof typeof KIT_URLS;
const kit = new Map<KitVoice, AudioBuffer>();
let kitAsked = false;

/** Fetch and decode the kit (once). */
function loadKit() {
  if (kitAsked || !ctx) return;
  kitAsked = true;
  const ac = ctx;
  for (const [name, url] of Object.entries(KIT_URLS) as [KitVoice, string][]) {
    fetch(url)
      .then((r) => r.arrayBuffer())
      .then((buf) => ac.decodeAudioData(buf))
      .then((audio) => kit.set(name, audio))
      .catch(() => undefined);
  }
}

/** Play a recorded voice: loudness 0..1, delay in seconds, and how fast (which is how high). False if it isn't loaded. */
function hit(name: KitVoice, vol: number, delay = 0, rate = 1) {
  const buf = kit.get(name);
  if (!ctx || !master || !buf) return false;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = Math.max(0.25, Math.min(4, rate));
  const g = ctx.createGain();
  g.gain.value = vol;
  src.connect(g).connect(master);
  src.start(ctx.currentTime + delay);
  return true;
}

/** The groove's drum kit. Every voice takes a loudness (0..1) and an optional delay in seconds. Tuned voices take a pitch in Hz. */
export const perc = {
  kick: (v: number, d = 0) => v > 0.005 && (hit('kick', 0.9 * v, d) || tone(110, 0.14, 'sine', 0.5 * v, 44, d)),
  tom: (hz: number, v: number, d = 0) => v > 0.005 && (hit('tom', 0.8 * v, d, hz / KIT_PITCH.tom) || tone(hz * 1.5, 0.2, 'sine', 0.4 * v, hz, d)),
  conga: (hz: number, v: number, d = 0) => {
    if (v <= 0.005 || hit('conga', 0.8 * v, d, hz / KIT_PITCH.conga)) return;
    tone(hz * 1.25, 0.12, 'sine', 0.38 * v, hz, d);
    burst(0.012, 2200, 2, 0.12 * v, undefined, d);
  },
  block: (hz: number, v: number, d = 0) => v > 0.005 && (hit('block', 0.6 * v, d, hz / KIT_PITCH.block) || tone(hz, 0.045, 'triangle', 0.26 * v, hz * 0.8, d)),
  rim: (v: number, d = 0) => v > 0.005 && (hit('rim', 0.7 * v, d) || burst(0.03, 1900, 4, 0.34 * v, undefined, d)),
  snare: (v: number, d = 0) => {
    if (v <= 0.005 || hit('snare', 0.7 * v, d)) return;
    burst(0.11, 2400, 0.8, 0.3 * v, undefined, d);
    tone(210, 0.07, 'triangle', 0.18 * v, 150, d);
  },
  shaker: (v: number, d = 0) => v > 0.005 && (hit('shaker', 0.6 * v, d) || burst(0.045, 6500, 1.2, 0.2 * v, undefined, d)),
  cowbell: (v: number, d = 0) => {
    if (v <= 0.005 || hit('cowbell', 0.5 * v, d)) return;
    tone(562, 0.16, 'square', 0.1 * v, undefined, d);
    tone(845, 0.16, 'square', 0.08 * v, undefined, d);
  },
  crash: (v: number, d = 0) => v > 0.005 && (hit('crash', 0.55 * v, d) || burst(0.7, 5200, 0.5, 0.26 * v, 3000, d)),
};

/** Roughly where each tuned recording sits, in Hz: asking for that pitch plays it as recorded. */
const KIT_PITCH = { tom: 110, conga: 250, block: 1000 };

/** A snare roll that builds for this many seconds, then a crash and a kick as the result lands. */
export function drumRoll(seconds: number) {
  const n = Math.round(seconds * 22);
  for (let i = 0; i < n; i++) perc.snare(0.25 + 0.55 * (i / n), 0.45 + (i * seconds) / n);
  perc.crash(0.9, 0.45 + seconds);
  perc.kick(1, 0.45 + seconds);
}

/** The pulse's percussion: no pitched notes, all short, all quiet. */
export const drums = {
  kick: (v: number) => tone(105, 0.13, 'sine', 0.3 * v * BEAT.volume, 46),
  rim: () => burst(0.035, 1900, 4, 0.2 * BEAT.volume),
  shaker: () => burst(0.045, 6500, 1.2, 0.07 * BEAT.volume),
  /** A woodblock knock: you did that on the beat. */
  block: () => {
    tone(1250, 0.05, 'triangle', 0.22 * BEAT.volume, 900);
    burst(0.02, 2600, 6, 0.1 * BEAT.volume);
  },
};

export const sfx = {
  /** The freezer: the seal letting go and a breath of cold on the way up; a soft thump coming down. */
  freezerOpen: () => {
    burst(0.07, 900, 1.2, 0.3);
    burst(0.5, 500, 0.5, 0.16, 2600);
    tone(95, 0.3, 'sine', 0.16, 70);
  },
  freezerShut: () => {
    burst(0.16, 1800, 0.6, 0.12, 500);
    tone(80, 0.2, 'sine', 0.32, 48, 0.3);
    burst(0.05, 1300, 1, 0.26);
  },
  freezerBeep: () => {
    tone(2050, 0.07, 'square', 0.035);
    tone(2050, 0.07, 'square', 0.035, undefined, 0.14);
  },
  /** The ticket printer: a quick dot-matrix chatter, then the tear. */
  printer: () => {
    for (let i = 0; i < 9; i++) tone(1750 + (i % 3) * 140, 0.022, 'square', 0.05, 1500, i * 0.034);
    burst(0.09, 3200, 0.7, 0.16, 1400);
  },
  /** A ticket hung on the rail: the steel marble gets shoved and clacks back into place, a bounce or two. */
  marble: () => {
    // The big clack (steel ball on the aluminum channel), then it rattles to rest.
    burst(0.05, 2400, 1.8, 0.55);
    tone(1150, 0.05, 'square', 0.12, 700);
    tone(420, 0.07, 'sine', 0.22, 260);
    [0.07, 0.12, 0.155, 0.18].forEach((d, i) => tone(2600 - i * 180, 0.025, 'triangle', 0.14 / (i + 1), 1800, d));
  },
  /** Tickets sliding down the rail: the marbles roll and rattle along. */
  railSlide: (n = 5) => {
    for (let i = 0; i < n; i++) tone(2400 + Math.random() * 900, 0.03, 'triangle', 0.13, 1700, i * 0.045 + Math.random() * 0.015);
  },
  /** A ticket on the spike: paper punched through, a little thunk on the base. */
  spike: () => {
    burst(0.11, 2600, 0.9, 0.22, 1200);
    tone(190, 0.12, 'sine', 0.2, 90, 0.03);
  },
  launch: () => tone(320, 0.12, 'sine', 0.25, 620),
  catch: (n: number) => tone(520 + n * 40, 0.08, 'triangle', 0.22, 760 + n * 40),
  rim: () => tone(1500, 0.1, 'square', 0.06, 1100),
  splat: () => {
    burst(0.18, 300, 1.2, 0.5, 120);
    tone(140, 0.15, 'sine', 0.25, 60);
  },
  oilDeath: () => burst(0.45, 4000, 0.8, 0.35, 2500),
  drop: () => {
    burst(0.7, 5000, 0.6, 0.45, 3000);
    tone(180, 0.12, 'sine', 0.2, 90);
  },
  pull: () => tone(900, 0.08, 'triangle', 0.12, 1300),
  toss: () => burst(0.22, 900, 1.5, 0.3, 2600),
  perfect: () => {
    tone(880, 0.14, 'sine', 0.22);
    tone(1320, 0.22, 'sine', 0.2, undefined, 0.08);
  },
  ok: () => tone(660, 0.14, 'sine', 0.18),
  reject: () => tone(150, 0.3, 'square', 0.12, 90),
  /** Timer channel button press. */
  timerPress: () => tone(2400, 0.04, 'square', 0.06),
  /** Kitchen timer alarm: the classic double beep. */
  alarm: () => {
    // A kitchen timer you can't miss: four hard beeps, with a lower note under them.
    for (let i = 0; i < 4; i++) {
      tone(2600, 0.1, 'square', 0.2, undefined, i * 0.16);
      tone(1300, 0.1, 'square', 0.1, undefined, i * 0.16);
    }
  },
  /** Background fryer sizzle, 0 = quiet. */
  sizzle(level: number) {
    if (!ctx || !sizzleGain) return;
    sizzleGain.gain.setTargetAtTime(Math.min(0.12, level * 0.05), ctx.currentTime, 0.15);
  },
};

// Haptics. Android: the Vibration API. iPhone: Safari has no vibration API,
// but toggling a native switch control gives a light tick on iOS 18+. It only
// fires inside a touch handler, so call this from input, not from physics.
let hapticLabel: HTMLLabelElement | null = null;
export function haptic(ms = 12) {
  try {
    if (typeof navigator.vibrate === 'function' && navigator.vibrate(ms)) return;
    if (!hapticLabel) {
      hapticLabel = document.createElement('label');
      hapticLabel.setAttribute('aria-hidden', 'true');
      hapticLabel.style.cssText = 'position:fixed;left:-100px;top:0;opacity:0;pointer-events:none;';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.setAttribute('switch', '');
      hapticLabel.appendChild(input);
      document.body.appendChild(hapticLabel);
    }
    hapticLabel.click();
  } catch {
    /* no haptics here: fine */
  }
}
