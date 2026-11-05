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
      master.gain.value = 0.7;
      master.connect(ctx.destination);
      noise = ctx.createBuffer(1, ctx.sampleRate * 1.5, ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      startSizzleLoop();
    }
    void ctx.resume();
  } catch {
    ctx = null;
  }
}

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

function burst(dur: number, freq: number, q: number, vol: number, sweepTo?: number) {
  if (!ctx || !master || !noise) return;
  const t = ctx.currentTime;
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
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 3500;
  sizzleGain = ctx.createGain();
  sizzleGain.gain.value = 0;
  src.connect(hp).connect(sizzleGain).connect(master);
  src.start();
}

export const sfx = {
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
    tone(3100, 0.07, 'square', 0.08);
    tone(3100, 0.07, 'square', 0.08, undefined, 0.12);
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
