import { describe, it, expect } from 'vitest';
import {
  colorfulness, hueEntropy, saturation, edgeDensity, temporalFlux,
  mirrorSymmetry, tripScore, rgbToHsv, TRIP_WEIGHTS, halveFrame, multiScaleDetail,
} from '../tools/trippiness.mjs';

/** Build a frame from a per-pixel colour function. */
function makeFrame(width, height, fn) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = fn(x, y);
      const i = (y * width + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
    }
  }
  return { data, width, height };
}

const flatGray = makeFrame(48, 48, () => [128, 128, 128]);
const hsvWheel = makeFrame(48, 48, (x, y) => {
  const h = ((x / 48) + (y / 48)) % 1;
  const i = Math.floor(h * 6), f = h * 6 - i;
  const q = Math.round(255 * (1 - f)), t = Math.round(255 * f);
  return [[255, t, 0], [q, 255, 0], [0, 255, t], [0, q, 255], [t, 0, 255], [255, 0, q]][i % 6];
});
const mirrored = makeFrame(48, 48, (x, y) => {
  const d = Math.min(x, 47 - x);
  return [(d * 11) % 256, (y * 7) % 256, (d * y) % 256];
});

describe('rgbToHsv', () => {
  it('maps primaries to the expected hue anchors', () => {
    expect(rgbToHsv(255, 0, 0).h).toBeCloseTo(0, 5);
    expect(rgbToHsv(0, 255, 0).h).toBeCloseTo(1 / 3, 5);
    expect(rgbToHsv(0, 0, 255).h).toBeCloseTo(2 / 3, 5);
  });

  it('reports zero saturation for neutrals and full for pure hues', () => {
    expect(rgbToHsv(90, 90, 90).s).toBe(0);
    expect(rgbToHsv(255, 0, 0).s).toBeCloseTo(1, 5);
  });
});

describe('colorfulness', () => {
  it('is ~0 for a flat gray field', () => {
    expect(colorfulness(flatGray)).toBeLessThan(0.02);
  });

  it('is high for a full hue wheel', () => {
    expect(colorfulness(hsvWheel)).toBeGreaterThan(0.5);
  });

  it('rejects malformed frames', () => {
    expect(() => colorfulness({ data: new Uint8ClampedArray(4), width: 2, height: 2 })).toThrow();
    expect(() => colorfulness(null)).toThrow();
  });
});

describe('hueEntropy', () => {
  it('is 0 when nothing is saturated', () => {
    expect(hueEntropy(flatGray)).toBe(0);
  });

  it('is near 1 when every hue is equally represented', () => {
    expect(hueEntropy(hsvWheel)).toBeGreaterThan(0.9);
  });

  it('is low for a single-hue field', () => {
    const magenta = makeFrame(32, 32, () => [255, 0, 255]);
    expect(hueEntropy(magenta)).toBeLessThan(0.1);
  });
});

describe('saturation', () => {
  it('separates neutral from vivid', () => {
    expect(saturation(flatGray)).toBeLessThan(0.01);
    expect(saturation(hsvWheel)).toBeGreaterThan(0.9);
  });
});

describe('edgeDensity', () => {
  it('is 0 on a flat field', () => {
    expect(edgeDensity(flatGray)).toBeLessThan(0.01);
  });

  it('is high on hard-edged stripes', () => {
    // Period 4, not 1: a 1px checkerboard sits in Sobel's aliasing null and
    // genuinely differentiates to zero. Period 4 is the honest stress case.
    const stripes = makeFrame(48, 48, (x) => (x % 4 < 2 ? [255, 255, 255] : [0, 0, 0]));
    expect(edgeDensity(stripes)).toBeGreaterThan(0.7);
  });

  it('is modest on a smooth gradient', () => {
    const ramp = makeFrame(48, 48, (x) => [x * 5, x * 5, x * 5]);
    const value = edgeDensity(ramp);
    expect(value).toBeGreaterThan(0);
    expect(value).toBeLessThan(0.3);
  });
});

describe('temporalFlux', () => {
  it('is 0 for identical frames', () => {
    expect(temporalFlux(hsvWheel, hsvWheel)).toBe(0);
  });

  it('is 1 for inverted frames', () => {
    const inverted = makeFrame(48, 48, () => [0, 0, 0]);
    const white = makeFrame(48, 48, () => [255, 255, 255]);
    expect(temporalFlux(white, inverted)).toBe(1);
  });

  it('refuses mismatched dimensions', () => {
    expect(() => temporalFlux(hsvWheel, makeFrame(8, 8, () => [0, 0, 0]))).toThrow();
  });
});

describe('mirrorSymmetry', () => {
  it('is 1 for a perfectly mirrored image', () => {
    expect(mirrorSymmetry(mirrored)).toBeCloseTo(1, 5);
  });

  it('is well below 1 for an asymmetric gradient', () => {
    const ramp = makeFrame(48, 48, (x) => [x * 5, 255 - x * 5, 128]);
    expect(mirrorSymmetry(ramp)).toBeLessThan(0.7);
  });
});

describe('halveFrame', () => {
  it('halves both dimensions', () => {
    const small = halveFrame(hsvWheel);
    expect(small.width).toBe(24);
    expect(small.height).toBe(24);
    expect(small.data.length).toBe(24 * 24 * 4);
  });

  it('averages each 2x2 block', () => {
    const quad = makeFrame(2, 2, (x, y) => {
      const v = [0, 100, 200, 255][y * 2 + x];
      return [v, v, v];
    });
    const small = halveFrame(quad);
    expect(small.width).toBe(1);
    expect(small.data[0]).toBe(Math.floor((0 + 100 + 200 + 255) / 4));
  });

  it('survives odd dimensions without reading out of bounds', () => {
    const odd = makeFrame(7, 5, (x, y) => [x * 30, y * 40, 128]);
    const small = halveFrame(odd);
    expect(small.width).toBe(3);
    expect(small.height).toBe(2);
    for (const v of small.data) expect(Number.isFinite(v)).toBe(true);
  });
});

describe('multiScaleDetail', () => {
  it('is ~0 on a flat field', () => {
    expect(multiScaleDetail(flatGray)).toBeLessThan(0.02);
  });

  it('rates self-similar structure above single-scale noise', () => {
    // White noise is maximally busy at full resolution and averages to nothing
    // once halved. A multi-octave pattern keeps structure at every scale.
    let seed = 1;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const noise = makeFrame(64, 64, () => {
      const v = rand() * 255;
      return [v, v, v];
    });
    const fractalish = makeFrame(64, 64, (x, y) => {
      let v = 0;
      for (const f of [2, 4, 8, 16]) v += Math.sin(x / f) * Math.sin(y / f) * (64 / f);
      const c = 128 + v * 2;
      return [c, c, c];
    });
    expect(multiScaleDetail(fractalish)).toBeGreaterThan(multiScaleDetail(noise));
  });

  it('stays within 0..1', () => {
    for (const frame of [flatGray, hsvWheel, mirrored]) {
      const v = multiScaleDetail(frame);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('tolerates frames too small to build a pyramid', () => {
    const tiny = makeFrame(4, 4, () => [255, 0, 0]);
    expect(multiScaleDetail(tiny)).toBeGreaterThanOrEqual(0);
  });
});

describe('tripScore', () => {
  it('has weights that sum to exactly 1', () => {
    const total = Object.values(TRIP_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it('scores a static gray void near zero', () => {
    expect(tripScore(flatGray, flatGray).score).toBeLessThan(5);
  });

  it('scores a churning hue wheel far above a gray void', () => {
    const shifted = makeFrame(48, 48, (x, y) => {
      const h = ((x / 48) + (y / 48) + 0.5) % 1;
      const i = Math.floor(h * 6), f = h * 6 - i;
      const q = Math.round(255 * (1 - f)), t = Math.round(255 * f);
      return [[255, t, 0], [q, 255, 0], [0, 255, t], [0, q, 255], [t, 0, 255], [255, 0, q]][i % 6];
    });
    const trippy = tripScore(hsvWheel, shifted).score;
    expect(trippy).toBeGreaterThan(tripScore(flatGray, flatGray).score + 40);
  });

  it('returns every component metric in 0..1', () => {
    const { metrics } = tripScore(hsvWheel, mirrored);
    for (const [name, value] of Object.entries(metrics)) {
      expect(value, name).toBeGreaterThanOrEqual(0);
      expect(value, name).toBeLessThanOrEqual(1);
    }
  });

  it('tolerates a missing second frame (zero motion)', () => {
    expect(tripScore(hsvWheel).metrics.temporalFlux).toBe(0);
  });
});
