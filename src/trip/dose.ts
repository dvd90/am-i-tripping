/**
 * DOSE ENGINE
 * -----------
 * The whole experience is driven by a one-compartment pharmacokinetic model —
 * the Bateman function — so the visuals genuinely *come up*, peak, plateau and
 * fade instead of just cranking a slider. Purely mathematical, zero side
 * effects, fully unit tested.
 *
 *   C(t) = (ka / (ka - ke)) * (e^(-ke·t) - e^(-ka·t))
 *
 * normalised so the peak is exactly 1.0.
 */

export interface DoseParams {
  /** Absorption rate constant (per second). Must exceed `ke`. */
  ka: number;
  /** Elimination rate constant (per second). */
  ke: number;
}

export type TripPhase = 'sober' | 'come-up' | 'peak' | 'come-down' | 'afterglow';

export interface TripState {
  elapsed: number;
  intensity: number;
  phase: TripPhase;
  /** d(intensity)/dt, useful for driving anticipation cues. */
  slope: number;
}

/**
 * Tuned so a session comes up over ~40s, peaks around a minute in and rides a
 * long plateau — compressed "trip time" that still feels like a real arc.
 */
export const DEFAULT_DOSE: DoseParams = { ka: 0.055, ke: 0.0042 };

function assertDose({ ka, ke }: DoseParams): void {
  if (!Number.isFinite(ka) || !Number.isFinite(ke)) throw new TypeError('dose rates must be finite');
  if (ka <= ke) throw new RangeError('absorption (ka) must exceed elimination (ke)');
  if (ke <= 0) throw new RangeError('elimination (ke) must be positive');
}

/** Analytic time of maximum concentration: ln(ka/ke) / (ka - ke). */
export function timeToPeak(dose: DoseParams): number {
  assertDose(dose);
  return Math.log(dose.ka / dose.ke) / (dose.ka - dose.ke);
}

/** Normalised intensity in 0..1 at `t` seconds after ingestion. */
export function doseAt(t: number, dose: DoseParams = DEFAULT_DOSE): number {
  assertDose(dose);
  if (!(t > 0)) return 0;
  const raw = Math.exp(-dose.ke * t) - Math.exp(-dose.ka * t);
  const tMax = timeToPeak(dose);
  const peak = Math.exp(-dose.ke * tMax) - Math.exp(-dose.ka * tMax);
  const value = raw / peak;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Classify a point on the curve from its height and direction of travel. */
export function phaseAt(intensity: number, slope: number): TripPhase {
  if (intensity >= 0.92) return 'peak';
  if (slope >= 0) return intensity < 0.05 ? 'sober' : 'come-up';
  return intensity < 0.25 ? 'afterglow' : 'come-down';
}

/** Full state of the trip at `elapsed` seconds. */
export function tripClock(elapsed: number, dose: DoseParams = DEFAULT_DOSE): TripState {
  const t = Math.max(0, elapsed);
  const h = 0.5;
  const intensity = doseAt(t, dose);
  const slope = (doseAt(t + h, dose) - doseAt(Math.max(0, t - h), dose)) / (2 * h);
  return { elapsed: t, intensity, phase: phaseAt(intensity, slope), slope };
}
