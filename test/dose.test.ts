import { describe, it, expect } from 'vitest';
import { DEFAULT_DOSE, doseAt, timeToPeak, phaseAt, tripClock } from '../src/trip/dose';

describe('doseAt (Bateman absorption/elimination curve)', () => {
  it('is exactly 0 at t=0 and for negative time', () => {
    expect(doseAt(0, DEFAULT_DOSE)).toBe(0);
    expect(doseAt(-10, DEFAULT_DOSE)).toBe(0);
  });

  it('peaks at exactly 1.0 at the analytic time-to-peak', () => {
    const tMax = timeToPeak(DEFAULT_DOSE);
    expect(doseAt(tMax, DEFAULT_DOSE)).toBeCloseTo(1, 6);
  });

  it('never exceeds 1 anywhere on the curve', () => {
    for (let t = 0; t < 5000; t += 7) {
      expect(doseAt(t, DEFAULT_DOSE)).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it('rises monotonically before the peak', () => {
    const tMax = timeToPeak(DEFAULT_DOSE);
    let prev = -1;
    for (let t = 0; t < tMax; t += tMax / 50) {
      const v = doseAt(t, DEFAULT_DOSE);
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
  });

  it('falls monotonically after the peak', () => {
    const tMax = timeToPeak(DEFAULT_DOSE);
    let prev = 2;
    for (let t = tMax; t < tMax * 20; t += tMax / 10) {
      const v = doseAt(t, DEFAULT_DOSE);
      expect(v).toBeLessThan(prev);
      prev = v;
    }
  });

  it('decays toward zero at long time horizons', () => {
    expect(doseAt(100_000, DEFAULT_DOSE)).toBeLessThan(1e-6);
  });

  it('scales time-to-peak with the absorption rate', () => {
    const fast = timeToPeak({ ka: 0.02, ke: 0.001 });
    const slow = timeToPeak({ ka: 0.004, ke: 0.001 });
    expect(fast).toBeLessThan(slow);
  });

  it('rejects a non-absorbing dose (ka must exceed ke)', () => {
    expect(() => doseAt(1, { ka: 0.001, ke: 0.001 })).toThrow();
    expect(() => timeToPeak({ ka: 0.0005, ke: 0.001 })).toThrow();
  });
});

describe('phaseAt', () => {
  it('names each region of the curve', () => {
    expect(phaseAt(0.01, 0)).toBe('sober');
    expect(phaseAt(0.4, 1)).toBe('come-up');
    expect(phaseAt(0.97, 0.001)).toBe('peak');
    expect(phaseAt(0.75, -0.5)).toBe('come-down');
    expect(phaseAt(0.08, -0.01)).toBe('afterglow');
  });

  it('always returns a known phase for any input', () => {
    const known = new Set(['sober', 'come-up', 'peak', 'come-down', 'afterglow']);
    for (let i = 0; i <= 1.0001; i += 0.01) {
      expect(known.has(phaseAt(i, 1))).toBe(true);
      expect(known.has(phaseAt(i, -1))).toBe(true);
    }
  });
});

describe('tripClock', () => {
  it('reports intensity, phase and elapsed time together', () => {
    const state = tripClock(timeToPeak(DEFAULT_DOSE), DEFAULT_DOSE);
    expect(state.intensity).toBeCloseTo(1, 5);
    expect(state.phase).toBe('peak');
    expect(state.elapsed).toBeGreaterThan(0);
  });

  it('clamps intensity into 0..1 for any elapsed time', () => {
    for (const t of [-5, 0, 1, 60, 3600, 86400]) {
      const { intensity } = tripClock(t, DEFAULT_DOSE);
      expect(intensity).toBeGreaterThanOrEqual(0);
      expect(intensity).toBeLessThanOrEqual(1);
    }
  });
});
