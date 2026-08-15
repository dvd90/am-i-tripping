/** Small, pure maths helpers shared by the CPU side and mirrored in GLSL. */

export const TAU = Math.PI * 2;

export const clamp = (x: number, lo = 0, hi = 1): number => (x < lo ? lo : x > hi ? hi : x);

/**
 * Clamped linear interpolation with *exact* endpoints — `a + (b-a)*1` is not
 * always `b` in floating point, and a morph that never quite lands on its
 * target preset drifts forever.
 */
export function lerp(a: number, b: number, t: number): number {
  const k = clamp(t);
  if (k === 0) return a;
  if (k === 1) return b;
  return a + (b - a) * k;
}

/** Hermite ease used everywhere in the shaders. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  const t = clamp((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export const fract = (x: number): number => x - Math.floor(x);

/** Always-positive modulo (JS `%` keeps the sign of the dividend). */
export const wrap = (x: number, m: number): number => ((x % m) + m) % m;

/** Deterministic 1D hash in 0..1 — the CPU twin of the shader's hash. */
export function hash11(x: number): number {
  const s = Math.sin(x * 127.1 + 311.7) * 43758.5453123;
  return fract(s);
}

/** Deterministic 2D hash in 0..1. */
export function hash21(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return fract(s);
}

export interface Vec2 { x: number; y: number }

/**
 * Kaleidoscopic mirror fold: wraps a point's angle into a single wedge and
 * mirrors it, which is what turns noise into mandala geometry.
 * Radius is preserved exactly.
 */
export function kaleidoFold(x: number, y: number, segments: number): Vec2 {
  if (!Number.isInteger(segments) || segments < 1) {
    throw new RangeError('segments must be a positive integer');
  }
  const r = Math.hypot(x, y);
  const wedge = TAU / segments;
  let a = wrap(Math.atan2(y, x), wedge);
  a = Math.abs(a - wedge / 2);
  return { x: r * Math.cos(a), y: r * Math.sin(a) };
}

/** Map 0..1 onto an integer range, inclusive of both ends. */
export function quantize(t: number, min: number, max: number): number {
  return Math.round(lerp(min, max, clamp(t)));
}
