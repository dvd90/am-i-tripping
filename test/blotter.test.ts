import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SHEET, tabCount, tabIndex, tabCenter, tabLocal,
  perforationMask, dissolveThreshold, isEdgeTab,
} from '../src/trip/blotter';
import { kaleidoFold, smoothstep, wrap, clamp, quantize, hash21, TAU } from '../src/util/mathx';

describe('sheet indexing', () => {
  it('counts every tab', () => {
    expect(tabCount({ cols: 6, rows: 6 })).toBe(36);
    expect(tabCount({ cols: 3, rows: 5 })).toBe(15);
  });

  it('numbers tabs row-major from the top-left', () => {
    expect(tabIndex(0.01, 0.01)).toBe(0);
    expect(tabIndex(0.99, 0.99)).toBe(35);
    expect(tabIndex(0.99, 0.01)).toBe(5);
    expect(tabIndex(0.01, 0.99)).toBe(30);
  });

  it('clamps out-of-range UVs onto the sheet', () => {
    expect(tabIndex(-4, -4)).toBe(0);
    expect(tabIndex(9, 9)).toBe(35);
  });

  it('round-trips every tab centre back to its own index', () => {
    for (let i = 0; i < tabCount(); i++) {
      const { u, v } = tabCenter(i);
      expect(tabIndex(u, v)).toBe(i);
    }
  });

  it('keeps tab-local coordinates inside [0,1)', () => {
    for (let u = 0; u <= 1; u += 0.017) {
      for (let v = 0; v <= 1; v += 0.017) {
        const local = tabLocal(u, v);
        expect(local.u).toBeGreaterThanOrEqual(0);
        expect(local.u).toBeLessThan(1);
        expect(local.v).toBeGreaterThanOrEqual(0);
        expect(local.v).toBeLessThan(1);
      }
    }
  });

  it('rejects malformed sheets and out-of-range indices', () => {
    expect(() => tabCount({ cols: 0, rows: 4 })).toThrow();
    expect(() => tabCount({ cols: 2.5, rows: 4 })).toThrow();
    expect(() => tabCenter(-1)).toThrow();
    expect(() => tabCenter(36)).toThrow();
    expect(() => isEdgeTab(999)).toThrow();
  });
});

describe('perforationMask', () => {
  it('is strong on a seam and absent in the middle of a tab', () => {
    const seam = perforationMask(1 / 6, 0.5 / 6 + 0.5 / 6 / 8);
    const body = perforationMask(...Object.values(tabCenter(14)) as [number, number]);
    expect(body).toBeLessThan(0.05);
    expect(seam).toBeGreaterThan(body);
  });

  it('stays within 0..1 across the whole sheet', () => {
    for (let u = 0; u <= 1; u += 0.013) {
      for (let v = 0; v <= 1; v += 0.013) {
        const m = perforationMask(u, v);
        expect(m).toBeGreaterThanOrEqual(0);
        expect(m).toBeLessThanOrEqual(1);
      }
    }
  });

  it('finds some perforation somewhere along a seam', () => {
    let peak = 0;
    for (let v = 0; v <= 1; v += 0.001) peak = Math.max(peak, perforationMask(1 / 6, v));
    expect(peak).toBeGreaterThan(0.5);
  });
});

describe('dissolveThreshold', () => {
  it('gives every tab a threshold in 0..1', () => {
    for (let i = 0; i < tabCount(); i++) {
      const t = dissolveThreshold(i);
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThanOrEqual(1);
    }
  });

  it('is deterministic for a given seed and varies across seeds', () => {
    expect(dissolveThreshold(7, DEFAULT_SHEET, 3)).toBe(dissolveThreshold(7, DEFAULT_SHEET, 3));
    expect(dissolveThreshold(7, DEFAULT_SHEET, 3)).not.toBe(dissolveThreshold(7, DEFAULT_SHEET, 4));
  });

  it('scatters rather than wiping in index order', () => {
    const thresholds = Array.from({ length: tabCount() }, (_, i) => dissolveThreshold(i));
    let inversions = 0;
    for (let i = 1; i < thresholds.length; i++) if (thresholds[i] < thresholds[i - 1]) inversions++;
    expect(inversions).toBeGreaterThan(thresholds.length * 0.25);
  });

  it('tears from the middle outward on average', () => {
    const centre: number[] = [];
    const edge: number[] = [];
    for (let i = 0; i < tabCount(); i++) (isEdgeTab(i) ? edge : centre).push(dissolveThreshold(i));
    const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    expect(mean(centre)).toBeLessThan(mean(edge));
  });
});

describe('isEdgeTab', () => {
  it('identifies the border ring of a 6x6 sheet', () => {
    expect(isEdgeTab(0)).toBe(true);
    expect(isEdgeTab(5)).toBe(true);
    expect(isEdgeTab(35)).toBe(true);
    expect(isEdgeTab(14)).toBe(false);
    const edges = Array.from({ length: 36 }, (_, i) => i).filter((i) => isEdgeTab(i));
    expect(edges.length).toBe(20);
  });
});

describe('mathx', () => {
  it('wraps negatives positively', () => {
    expect(wrap(-1, 4)).toBe(3);
    expect(wrap(9, 4)).toBe(1);
  });

  it('clamps and quantizes', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(quantize(0, 2, 16)).toBe(2);
    expect(quantize(1, 2, 16)).toBe(16);
    expect(quantize(0.5, 2, 16)).toBe(9);
  });

  it('smoothsteps with the right endpoints and midpoint', () => {
    expect(smoothstep(0, 1, -1)).toBe(0);
    expect(smoothstep(0, 1, 2)).toBe(1);
    expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5, 6);
  });

  it('hashes deterministically into 0..1', () => {
    expect(hash21(1.5, 2.5)).toBe(hash21(1.5, 2.5));
    for (let i = 0; i < 500; i++) {
      const h = hash21(i * 0.37, i * 1.13);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
    }
  });
});

describe('kaleidoFold', () => {
  it('preserves radius exactly', () => {
    for (const segments of [2, 3, 6, 8, 12]) {
      for (let a = 0; a < TAU; a += 0.13) {
        const r = 1.7;
        const folded = kaleidoFold(Math.cos(a) * r, Math.sin(a) * r, segments);
        expect(Math.hypot(folded.x, folded.y)).toBeCloseTo(r, 10);
      }
    }
  });

  it('confines every input angle to a single mirrored wedge', () => {
    const segments = 8;
    const halfWedge = TAU / segments / 2;
    for (let a = -TAU; a < TAU; a += 0.03) {
      const folded = kaleidoFold(Math.cos(a), Math.sin(a), segments);
      const angle = Math.atan2(folded.y, folded.x);
      expect(angle).toBeGreaterThanOrEqual(-1e-9);
      expect(angle).toBeLessThanOrEqual(halfWedge + 1e-9);
    }
  });

  it('maps points a full wedge apart to the same place', () => {
    const segments = 6;
    const wedge = TAU / segments;
    const a = kaleidoFold(Math.cos(0.4), Math.sin(0.4), segments);
    const b = kaleidoFold(Math.cos(0.4 + wedge), Math.sin(0.4 + wedge), segments);
    expect(a.x).toBeCloseTo(b.x, 10);
    expect(a.y).toBeCloseTo(b.y, 10);
  });

  it('rejects nonsense segment counts', () => {
    expect(() => kaleidoFold(1, 1, 0)).toThrow();
    expect(() => kaleidoFold(1, 1, 2.5)).toThrow();
  });
});
