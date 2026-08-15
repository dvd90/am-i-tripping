/**
 * PSYCHOACOUSTIC TUNING
 * ---------------------
 * The soundtrack is an endlessly rising Shepard–Risset drone over a binaural
 * beat bed, tuned in just intonation. All of the maths is here and unit tested;
 * `engine.ts` only wires it to WebAudio.
 */

import { clamp, wrap } from '../util/mathx';

export interface Voice {
  freq: number;
  gain: number;
}

/** Lowest octave of the Shepard ladder (A0). */
export const SHEPARD_BASE_HZ = 27.5;

/**
 * A Shepard tone: `octaves` sine partials one octave apart, their loudness
 * following a bell in log-frequency space. As `phase` advances 0 → 1 every
 * partial slides up an octave and the set maps exactly onto itself, so the
 * tone rises forever without ever getting higher.
 */
export function shepardVoices(phase: number, octaves = 7, base = SHEPARD_BASE_HZ): Voice[] {
  if (!Number.isInteger(octaves) || octaves < 2) throw new RangeError('need at least 2 octaves');
  if (!(base > 0)) throw new RangeError('base frequency must be positive');
  const voices: Voice[] = [];
  let total = 0;
  for (let i = 0; i < octaves; i++) {
    const pos = wrap(i + phase, octaves); // 0..octaves
    const freq = base * Math.pow(2, pos);
    // Gaussian bell centred on the middle octave; edges fade to silence so the
    // wrap-around is inaudible.
    const x = (pos - (octaves - 1) / 2) / ((octaves - 1) / 2);
    const gain = Math.exp(-4.5 * x * x);
    voices.push({ freq, gain });
    total += gain;
  }
  if (total > 0) for (const v of voices) v.gain /= total;
  return voices;
}

/**
 * Two carriers straddling `carrier`, differing by `beat` Hz. The brain hears
 * the difference frequency as a pulse that isn't in either ear alone.
 * Beat is clamped to the 0.5–40 Hz range where the effect actually lives.
 */
export function binauralPair(carrier: number, beat: number): [number, number] {
  if (!(carrier > 0)) throw new RangeError('carrier must be positive');
  const b = clamp(beat, 0.5, 40);
  return [carrier - b / 2, carrier + b / 2];
}

/** Five-limit just intonation ratios for the twelve chromatic degrees. */
const JUST_RATIOS = [1, 16 / 15, 9 / 8, 6 / 5, 5 / 4, 4 / 3, 45 / 32, 3 / 2, 8 / 5, 5 / 3, 9 / 5, 15 / 8];

/** Frequency ratio for a scale degree; octaves wrap automatically (12 → 2×). */
export function justRatio(degree: number): number {
  if (!Number.isInteger(degree)) throw new TypeError('degree must be an integer');
  const octave = Math.floor(degree / 12);
  return JUST_RATIOS[wrap(degree, 12)] * Math.pow(2, octave);
}

/** Pentatonic degrees — no semitone clashes, so any random walk sounds intentional. */
export const PENTATONIC = [0, 2, 4, 7, 9] as const;

/**
 * Beat frequency for a given trip intensity: theta (~5 Hz, dreamy) drifting up
 * into low beta (~18 Hz, buzzing) as things intensify.
 */
export function beatForIntensity(intensity: number): number {
  return 5 + clamp(intensity) * 13;
}
