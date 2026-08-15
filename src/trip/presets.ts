/**
 * BLOTTER SERIES
 * --------------
 * Each preset is a full vector of normalised (0..1) visual parameters. They are
 * named after the blotter-art tradition: sheets of perforated tabs printed with
 * bicycles, mandalas, third eyes and om symbols.
 *
 * Everything is 0..1 on this side — the renderer maps each parameter onto its
 * real range — which makes morphing between presets a plain componentwise lerp.
 */

import { clamp, lerp } from '../util/mathx';

export interface TripParams {
  /** Domain-warp magnitude: how badly space folds in on itself. */
  warp: number;
  /** Fractal detail / octave weighting. */
  fractal: number;
  /** Kaleidoscope mirror count (mapped to 2..16 segments). */
  kaleido: number;
  /** Chromatic aberration — RGB channels drifting apart. */
  chroma: number;
  /** Frame feedback: echo trails and infinite regress. */
  feedback: number;
  /** Hue rotation speed. */
  hueCycle: number;
  /** Breathing — the slow in/out scale pulse of surfaces. */
  breath: number;
  /** Melt/drip flow down the screen. */
  melt: number;
  /** Tunnel zoom toward the vanishing point. */
  tunnel: number;
  /** Brightness pulsing. Hard-capped for photosensitivity safety. */
  strobe: number;
  /** Film grain / visual snow. */
  grain: number;
  /** Bloom and halation around bright structure. */
  glow: number;
  /** Strength of the perforated blotter grid overlay. */
  blotter: number;
  /** Heavy black cartoon linework, blotter-print style. */
  ink: number;
  /** Droste recursion: the image containing itself, forever, in a spiral. */
  droste: number;
}

export interface TripPreset {
  id: string;
  name: string;
  tagline: string;
  /** Signature hue in turns (0..1), used for UI accents. */
  hue: number;
  params: TripParams;
}

export const PARAM_KEYS = [
  'warp', 'fractal', 'kaleido', 'chroma', 'feedback', 'hueCycle', 'breath',
  'melt', 'tunnel', 'strobe', 'grain', 'glow', 'blotter', 'ink', 'droste',
] as const satisfies readonly (keyof TripParams)[];

/** Never let the strobe reach seizure-inducing territory, whatever a preset asks for. */
export const MAX_STROBE = 0.45;

export const PRESETS: readonly TripPreset[] = Object.freeze([
  {
    id: 'bicycle-day',
    name: 'BICYCLE DAY',
    tagline: '19 April 1943 · the ride home',
    hue: 0.08,
    params: {
      warp: 0.42, fractal: 0.72, kaleido: 0.25, chroma: 0.35, feedback: 0.5,
      hueCycle: 0.3, breath: 0.55, melt: 0.35, tunnel: 0.3, strobe: 0.12,
      grain: 0.3, glow: 0.55, blotter: 0.85, ink: 0.9, droste: 0.45,
    },
  },
  {
    id: 'om-sheet',
    name: 'OM SHEET',
    tagline: 'the syllable tiles itself forever',
    hue: 0.12,
    params: {
      warp: 0.62, fractal: 0.84, kaleido: 0.75, chroma: 0.34, feedback: 0.6,
      hueCycle: 0.46, breath: 0.6, melt: 0.42, tunnel: 0.5, strobe: 0.1,
      grain: 0.25, glow: 0.6, blotter: 0.8, ink: 0.75, droste: 0.75,
    },
  },
  {
    id: 'third-eye',
    name: 'THIRD EYE',
    tagline: 'it is looking back',
    hue: 0.72,
    params: {
      warp: 0.62, fractal: 0.86, kaleido: 0.6, chroma: 0.5, feedback: 0.65,
      hueCycle: 0.46, breath: 0.7, melt: 0.45, tunnel: 0.55, strobe: 0.18,
      grain: 0.3, glow: 0.85, blotter: 0.68, ink: 0.72, droste: 0.7,
    },
  },
  {
    id: 'liquid-sunshine',
    name: 'LIQUID SUNSHINE',
    tagline: 'everything is warm and running',
    hue: 0.14,
    params: {
      warp: 0.62, fractal: 0.82, kaleido: 0.45, chroma: 0.45, feedback: 0.65,
      hueCycle: 0.5, breath: 0.65, melt: 0.62, tunnel: 0.45, strobe: 0.15,
      grain: 0.2, glow: 0.75, blotter: 0.68, ink: 0.72, droste: 0.6,
    },
  },
  {
    id: 'strawberry-fields',
    name: 'STRAWBERRY FIELDS',
    tagline: 'nothing is real',
    hue: 0.96,
    params: {
      warp: 0.5, fractal: 0.82, kaleido: 0.5, chroma: 0.55, feedback: 0.6,
      hueCycle: 0.55, breath: 0.5, melt: 0.5, tunnel: 0.4, strobe: 0.2,
      grain: 0.35, glow: 0.65, blotter: 0.55, ink: 0.55, droste: 0.62,
    },
  },
  {
    id: 'breakthrough',
    name: 'BREAKTHROUGH',
    tagline: 'the machine elves have notes',
    hue: 0.55,
    params: {
      warp: 0.68, fractal: 0.82, kaleido: 0.55, chroma: 0.7, feedback: 0.6,
      hueCycle: 0.5, breath: 0.7, melt: 0.45, tunnel: 0.5, strobe: 0.3,
      grain: 0.38, glow: 0.85, blotter: 0.72, ink: 0.8, droste: 0.78,
    },
  },
  {
    id: 'salvia-wheel',
    name: 'SALVIA WHEEL',
    tagline: 'sliced into someone else’s carousel',
    hue: 0.35,
    params: {
      warp: 0.58, fractal: 0.76, kaleido: 0.46, chroma: 0.58, feedback: 0.45,
      hueCycle: 0.4, breath: 0.4, melt: 0.55, tunnel: 0.4, strobe: 0.28,
      grain: 0.35, glow: 0.52, blotter: 0.75, ink: 0.85, droste: 0.62,
    },
  },
  {
    id: 'white-fluff',
    name: 'WHITE FLUFF',
    tagline: 'gentle, mostly',
    hue: 0.5,
    params: {
      warp: 0.48, fractal: 0.74, kaleido: 0.3, chroma: 0.34, feedback: 0.5,
      hueCycle: 0.32, breath: 0.5, melt: 0.34, tunnel: 0.3, strobe: 0.05,
      grain: 0.3, glow: 0.55, blotter: 0.85, ink: 0.8, droste: 0.5,
    },
  },
]);

export const DEFAULT_PRESET_ID = 'bicycle-day';

export function getPreset(id: string): TripPreset {
  const found = PRESETS.find((p) => p.id === id);
  if (!found) throw new RangeError(`unknown preset "${id}"`);
  return found;
}

/** Componentwise blend between two parameter sets. `t` is clamped to 0..1. */
export function lerpParams(a: TripParams, b: TripParams, t: number): TripParams {
  const out = {} as TripParams;
  for (const key of PARAM_KEYS) out[key] = lerp(a[key], b[key], t);
  return out;
}

/**
 * Parameters describing the printed object rather than the hallucination. The
 * sheet in your hand is just as printed before you take anything as after, so
 * these must not fade out with the dose.
 */
export const UNSCALED_KEYS: readonly (keyof TripParams)[] = ['blotter', 'ink'];

/**
 * Scale a parameter set by trip intensity: at zero dose the world is nearly
 * still, at peak it is fully unleashed. A floor keeps a little life in the
 * frame even when sober.
 */
export function scaleByIntensity(params: TripParams, intensity: number): TripParams {
  const i = clamp(intensity);
  const gain = lerp(0.18, 1, i);
  const out = {} as TripParams;
  for (const key of PARAM_KEYS) {
    out[key] = UNSCALED_KEYS.includes(key) ? params[key] : params[key] * gain;
  }
  return out;
}

/** Clamp every parameter into range and enforce the strobe safety cap. */
export function sanitize(params: TripParams): TripParams {
  const out = {} as TripParams;
  for (const key of PARAM_KEYS) out[key] = clamp(params[key]);
  out.strobe = Math.min(out.strobe, MAX_STROBE);
  return out;
}

/** Flatten to a Float32Array in `PARAM_KEYS` order for upload as a uniform block. */
export function toFloatArray(params: TripParams): Float32Array {
  const out = new Float32Array(PARAM_KEYS.length);
  PARAM_KEYS.forEach((key, i) => { out[i] = params[key]; });
  return out;
}
