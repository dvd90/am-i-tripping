import { describe, it, expect } from 'vitest';
import {
  PRESETS, PARAM_KEYS, MAX_STROBE, DEFAULT_PRESET_ID, getPreset,
  lerpParams, scaleByIntensity, sanitize, toFloatArray,
} from '../src/trip/presets';
import {
  shepardVoices, binauralPair, justRatio, beatForIntensity, PENTATONIC, SHEPARD_BASE_HZ,
} from '../src/audio/tuning';

describe('preset catalogue', () => {
  it('ships a full blotter sheet of presets', () => {
    expect(PRESETS.length).toBeGreaterThanOrEqual(8);
  });

  it('has unique ids and names', () => {
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length);
    expect(new Set(PRESETS.map((p) => p.name)).size).toBe(PRESETS.length);
  });

  it('defines every parameter key on every preset, all within 0..1', () => {
    for (const preset of PRESETS) {
      const keys = Object.keys(preset.params).sort();
      expect(keys, preset.id).toEqual([...PARAM_KEYS].sort());
      for (const key of PARAM_KEYS) {
        expect(preset.params[key], `${preset.id}.${key}`).toBeGreaterThanOrEqual(0);
        expect(preset.params[key], `${preset.id}.${key}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('keeps every preset under the strobe safety cap', () => {
    for (const preset of PRESETS) {
      expect(preset.params.strobe, preset.id).toBeLessThanOrEqual(MAX_STROBE);
    }
  });

  it('gives every preset a hue in 0..1 and human-readable copy', () => {
    for (const preset of PRESETS) {
      expect(preset.hue).toBeGreaterThanOrEqual(0);
      expect(preset.hue).toBeLessThanOrEqual(1);
      expect(preset.name.length).toBeGreaterThan(0);
      expect(preset.tagline.length).toBeGreaterThan(0);
    }
  });

  it('resolves the default preset and rejects unknown ids', () => {
    expect(getPreset(DEFAULT_PRESET_ID).id).toBe(DEFAULT_PRESET_ID);
    expect(() => getPreset('mescaline-supreme')).toThrow();
  });

  it('reaches high intensity somewhere in the catalogue', () => {
    const maxWarp = Math.max(...PRESETS.map((p) => p.params.warp));
    expect(maxWarp).toBeGreaterThan(0.9);
  });
});

describe('lerpParams', () => {
  const a = PRESETS[0].params;
  const b = PRESETS[5].params;

  it('returns the endpoints exactly', () => {
    expect(lerpParams(a, b, 0)).toEqual(a);
    expect(lerpParams(a, b, 1)).toEqual(b);
  });

  it('clamps t outside 0..1', () => {
    expect(lerpParams(a, b, -3)).toEqual(a);
    expect(lerpParams(a, b, 9)).toEqual(b);
  });

  it('lands componentwise between the endpoints', () => {
    const mid = lerpParams(a, b, 0.5);
    for (const key of PARAM_KEYS) {
      const lo = Math.min(a[key], b[key]);
      const hi = Math.max(a[key], b[key]);
      expect(mid[key], key).toBeGreaterThanOrEqual(lo);
      expect(mid[key], key).toBeLessThanOrEqual(hi);
    }
  });
});

describe('scaleByIntensity', () => {
  it('calms everything down at zero dose but never freezes it', () => {
    const calm = scaleByIntensity(PRESETS[5].params, 0);
    for (const key of PARAM_KEYS) {
      expect(calm[key], key).toBeLessThan(PRESETS[5].params[key] + 1e-9);
    }
    expect(calm.warp).toBeGreaterThan(0);
  });

  it('is the identity at full dose', () => {
    const peak = scaleByIntensity(PRESETS[5].params, 1);
    for (const key of PARAM_KEYS) expect(peak[key]).toBeCloseTo(PRESETS[5].params[key], 10);
  });

  it('increases monotonically with intensity', () => {
    let prev = -1;
    for (let i = 0; i <= 1; i += 0.05) {
      const v = scaleByIntensity(PRESETS[5].params, i).warp;
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
  });
});

describe('sanitize', () => {
  it('clamps wild values back into range', () => {
    const wild = { ...PRESETS[0].params, warp: 5, fractal: -2 };
    const safe = sanitize(wild);
    expect(safe.warp).toBe(1);
    expect(safe.fractal).toBe(0);
  });

  it('enforces the strobe cap even when asked for more', () => {
    expect(sanitize({ ...PRESETS[0].params, strobe: 1 }).strobe).toBe(MAX_STROBE);
  });
});

describe('toFloatArray', () => {
  it('packs parameters in declared key order', () => {
    const arr = toFloatArray(PRESETS[0].params);
    expect(arr).toBeInstanceOf(Float32Array);
    expect(arr.length).toBe(PARAM_KEYS.length);
    PARAM_KEYS.forEach((key, i) => expect(arr[i]).toBeCloseTo(PRESETS[0].params[key], 6));
  });
});

describe('shepardVoices', () => {
  it('produces one voice per octave', () => {
    expect(shepardVoices(0, 7)).toHaveLength(7);
    expect(shepardVoices(0.3, 9)).toHaveLength(9);
  });

  it('normalises gains to sum to 1', () => {
    for (const phase of [0, 0.25, 0.5, 0.9]) {
      const total = shepardVoices(phase).reduce((s, v) => s + v.gain, 0);
      expect(total).toBeCloseTo(1, 10);
    }
  });

  it('maps onto itself after a full phase — the endless-rise invariant', () => {
    const sortKey = (v: { freq: number; gain: number }) => v.freq;
    const start = shepardVoices(0).sort((a, b) => sortKey(a) - sortKey(b));
    const wrapped = shepardVoices(1).sort((a, b) => sortKey(a) - sortKey(b));
    expect(start.length).toBe(wrapped.length);
    start.forEach((v, i) => {
      expect(v.freq).toBeCloseTo(wrapped[i].freq, 6);
      expect(v.gain).toBeCloseTo(wrapped[i].gain, 6);
    });
  });

  it('stacks voices exactly an octave apart', () => {
    const freqs = shepardVoices(0).map((v) => v.freq).sort((a, b) => a - b);
    for (let i = 1; i < freqs.length; i++) expect(freqs[i] / freqs[i - 1]).toBeCloseTo(2, 6);
    expect(freqs[0]).toBeCloseTo(SHEPARD_BASE_HZ, 6);
  });

  it('fades the extremes so the wrap is inaudible', () => {
    const voices = shepardVoices(0).sort((a, b) => a.freq - b.freq);
    const mid = voices[Math.floor(voices.length / 2)];
    expect(voices[0].gain).toBeLessThan(mid.gain * 0.2);
    expect(voices[voices.length - 1].gain).toBeLessThan(mid.gain * 0.2);
  });

  it('rejects degenerate configurations', () => {
    expect(() => shepardVoices(0, 1)).toThrow();
    expect(() => shepardVoices(0, 7, 0)).toThrow();
  });
});

describe('binauralPair', () => {
  it('straddles the carrier by exactly the beat frequency', () => {
    const [lo, hi] = binauralPair(220, 8);
    expect(hi - lo).toBeCloseTo(8, 10);
    expect((lo + hi) / 2).toBeCloseTo(220, 10);
  });

  it('clamps the beat into the audible-illusion range', () => {
    expect(binauralPair(220, 900)[1] - binauralPair(220, 900)[0]).toBeCloseTo(40, 10);
    expect(binauralPair(220, 0)[1] - binauralPair(220, 0)[0]).toBeCloseTo(0.5, 10);
  });

  it('rejects a non-positive carrier', () => {
    expect(() => binauralPair(0, 8)).toThrow();
  });
});

describe('justRatio', () => {
  it('is unison at 0 and an exact octave at 12', () => {
    expect(justRatio(0)).toBe(1);
    expect(justRatio(12)).toBeCloseTo(2, 10);
    expect(justRatio(24)).toBeCloseTo(4, 10);
  });

  it('gives a pure fifth and major third', () => {
    expect(justRatio(7)).toBeCloseTo(1.5, 10);
    expect(justRatio(4)).toBeCloseTo(1.25, 10);
  });

  it('handles negative degrees as descending octaves', () => {
    expect(justRatio(-12)).toBeCloseTo(0.5, 10);
  });

  it('rises monotonically through an octave', () => {
    for (let d = 1; d < 12; d++) expect(justRatio(d)).toBeGreaterThan(justRatio(d - 1));
  });

  it('rejects fractional degrees', () => {
    expect(() => justRatio(1.5)).toThrow();
  });
});

describe('beatForIntensity', () => {
  it('drifts from theta up into low beta', () => {
    expect(beatForIntensity(0)).toBeCloseTo(5, 6);
    expect(beatForIntensity(1)).toBeCloseTo(18, 6);
    expect(beatForIntensity(0.5)).toBeGreaterThan(beatForIntensity(0.2));
  });

  it('offers a clash-free pentatonic set', () => {
    expect(PENTATONIC.length).toBe(5);
    expect(new Set(PENTATONIC).size).toBe(5);
  });
});
