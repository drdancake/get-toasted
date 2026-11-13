// The groove: percussion that comes out of how the shift is going, never a target to hit.
// Every kitchen event is read as one of four things (an action, a completion, a blunder, a
// trigger); those move the groove meter; and each action has a second, fuller sound that fades in
// as the meter climbs, over a bed of percussion that swells underneath. All percussion, no notes:
// it has to sit under whatever the lobby is playing.

export type GrooveVoice = 'conga' | 'block' | 'tom' | 'kick' | 'snare' | 'rim' | 'shaker' | 'cowbell' | 'crash';

export const GROOVE = {
  enabled: true,
  /** The bed's tempo. (Dan's reference for a good shift: "Walkin' on the Sun".) */
  bpm: 124,
  /** Overall level of the groove layer, under the kitchen's own sounds. */
  volume: 0.5,
  /**
   * What each thing you do is worth on the meter (0..1). Small for the busywork, big for the
   * finishes: a clean ticket start to finish takes you most of the way up.
   */
  gain: {
    launch: 0.004,
    catch: 0.003,
    nailed: 0.04,
    drop: 0.02,
    timerStart: 0.01,
    lift: 0.01,
    pulledPerfect: 0.06,
    hook: 0.01,
    salt: 0.006,
    toss: 0.012,
    expo: 0.015,
    pourIn: 0.006,
    sauced: 0.02,
    saucedPerfect: 0.05,
    served: 0.1,
    servedPerfect: 0.24,
  } as Record<string, number>,
  /** What each blunder costs. Not all mistakes are equal. */
  loss: {
    freezerBeep: 0.02,
    spill: 0.05,
    overCount: 0.05,
    dead: 0.1,
    greasy: 0.08,
    noName: 0.12,
    pulledBad: 0.15,
    servedFlawed: 0.15,
    ticketExpired: 0.45,
    rejected: 0.7,
  } as Record<string, number>,
  /** The same blunder again within this many seconds is the same blunder (a dropped basket is one mistake, not six). */
  lossGap: 1.5,
  /** The worst ones don't just cost groove: the groove layer goes quiet for this long (seconds). */
  silence: { rejected: 14, ticketExpired: 8 } as Record<string, number>,
  /** The bed comes in by layers as the meter passes these: shaker, then kick and rim, then congas and cowbell. */
  layers: [0.18, 0.42, 0.68],
  /** Hands moving faster than this (actions a second, over the last few seconds) add the sixteenth-note hat. */
  busyPace: 1.1,
  paceWindow: 6,
  /** The same action again within this many seconds is the next step of its pattern (a roll), not the same hit again. */
  rollGap: 0.8,
  /**
   * The fuller sound each action gets: a voice, and the steps it walks through when repeated
   * quickly (pitches in Hz for the tuned drums, loudness 0..1 for the rest).
   */
  voices: {
    launch: { voice: 'conga', steps: [196, 233, 262, 233, 311, 262] },
    catch: { voice: 'block', steps: [760, 860, 960, 1080, 1200, 1340] },
    drop: { voice: 'tom', steps: [92, 84] },
    timerStart: { voice: 'rim', steps: [1] },
    lift: { voice: 'snare', steps: [1, 0.8] },
    hook: { voice: 'block', steps: [600, 520] },
    salt: { voice: 'shaker', steps: [1, 0.55, 0.55, 0.9, 0.55, 0.55] },
    toss: { voice: 'tom', steps: [150, 130, 170] },
    expo: { voice: 'block', steps: [700, 880, 1040] },
    pourIn: { voice: 'conga', steps: [330, 392, 440, 392, 494, 440] },
    sauced: { voice: 'cowbell', steps: [1] },
    pulledPerfect: { voice: 'cowbell', steps: [1] },
    served: { voice: 'crash', steps: [1] },
  } as Record<string, { voice: GrooveVoice; steps: number[] }>,
  /** Each run's actions are logged (time and kind only) and saved with the notes, to study how people really play. */
  record: true,
  recordMax: 1200,
  recordMinSeconds: 40,
};
