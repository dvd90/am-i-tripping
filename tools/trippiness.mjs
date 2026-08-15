/**
 * TRIPPINESS ANALYZER
 * -------------------
 * Pure, dependency-free image analysis used by the automated "is it trippy yet?"
 * loop. Operates on raw RGBA byte buffers (as produced by a canvas readback or a
 * decoded PNG), so it is trivially testable without a browser.
 *
 * Every metric returns 0..1. The composite TRIP SCORE is 0..100.
 */

/** @typedef {{ data: Uint8ClampedArray | Uint8Array, width: number, height: number }} Frame */

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

function assertFrame(frame, label = 'frame') {
  if (!frame || typeof frame !== 'object') throw new TypeError(`${label} must be an object`);
  const { data, width, height } = frame;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new TypeError(`${label} must have positive integer width/height`);
  }
  if (!data || data.length !== width * height * 4) {
    throw new TypeError(`${label} data length ${data?.length} !== ${width * height * 4}`);
  }
}

/**
 * Hasler & Süsstrunk (2003) colorfulness metric, normalized.
 * Grayscale imagery scores ~0; saturated multi-hue imagery approaches 1.
 * @param {Frame} frame
 */
export function colorfulness(frame) {
  assertFrame(frame);
  const d = frame.data;
  const n = frame.width * frame.height;
  let sumRg = 0, sumYb = 0, sumRg2 = 0, sumYb2 = 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const rg = r - g;
    const yb = 0.5 * (r + g) - b;
    sumRg += rg; sumYb += yb;
    sumRg2 += rg * rg; sumYb2 += yb * yb;
  }
  const meanRg = sumRg / n, meanYb = sumYb / n;
  const varRg = Math.max(0, sumRg2 / n - meanRg * meanRg);
  const varYb = Math.max(0, sumYb2 / n - meanYb * meanYb);
  const stdRoot = Math.sqrt(varRg + varYb);
  const meanRoot = Math.sqrt(meanRg * meanRg + meanYb * meanYb);
  // ~150 is the practical ceiling for the raw metric on 8-bit imagery.
  return clamp01((stdRoot + 0.3 * meanRoot) / 150);
}

/** RGB -> hue in [0,1), saturation in [0,1], value in [0,1]. */
export function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  if (delta > 1e-9) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h /= 6;
    if (h < 0) h += 1;
  }
  return { h, s: max <= 1e-9 ? 0 : delta / max, v: max };
}

/**
 * Shannon entropy of the hue histogram, weighted by saturation so that
 * washed-out pixels cannot fake a rainbow. 1 == every hue equally present.
 * @param {Frame} frame
 * @param {number} bins
 */
export function hueEntropy(frame, bins = 36) {
  assertFrame(frame);
  const d = frame.data;
  const hist = new Float64Array(bins);
  let total = 0;
  for (let i = 0; i < d.length; i += 4) {
    const { h, s, v } = rgbToHsv(d[i], d[i + 1], d[i + 2]);
    const w = s * v;
    if (w <= 1e-6) continue;
    const bin = Math.min(bins - 1, Math.floor(h * bins));
    hist[bin] += w;
    total += w;
  }
  if (total <= 1e-9) return 0;
  let entropy = 0;
  for (let i = 0; i < bins; i++) {
    const p = hist[i] / total;
    if (p > 0) entropy -= p * Math.log2(p);
  }
  return clamp01(entropy / Math.log2(bins));
}

/** Mean saturation weighted by value (dark pixels shouldn't dominate). @param {Frame} frame */
export function saturation(frame) {
  assertFrame(frame);
  const d = frame.data;
  let sum = 0, weight = 0;
  for (let i = 0; i < d.length; i += 4) {
    const { s, v } = rgbToHsv(d[i], d[i + 1], d[i + 2]);
    sum += s * v; weight += v;
  }
  return weight <= 1e-9 ? 0 : clamp01(sum / weight);
}

/**
 * Sobel edge density on luminance — proxy for structural detail / fractal
 * busyness. Flat fields score ~0, dense filigree approaches 1.
 * @param {Frame} frame
 */
export function edgeDensity(frame) {
  assertFrame(frame);
  const { width: w, height: h, data: d } = frame;
  if (w < 3 || h < 3) return 0;
  const lum = new Float32Array(w * h);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    lum[p] = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
  }
  let sum = 0, count = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const tl = lum[i - w - 1], t = lum[i - w], tr = lum[i - w + 1];
      const l = lum[i - 1], r = lum[i + 1];
      const bl = lum[i + w - 1], b = lum[i + w], br = lum[i + w + 1];
      const gx = (tr + 2 * r + br) - (tl + 2 * l + bl);
      const gy = (bl + 2 * b + br) - (tl + 2 * t + tr);
      sum += Math.min(1, Math.hypot(gx, gy) / 2);
      count++;
    }
  }
  return clamp01(sum / count / 0.35);
}

/**
 * Temporal flux: how much the image mutates between two frames. Static images
 * score 0. Normalized so that a ~12% mean channel shift already reads as 1.
 * @param {Frame} a @param {Frame} b
 */
export function temporalFlux(a, b) {
  assertFrame(a, 'frame a'); assertFrame(b, 'frame b');
  if (a.width !== b.width || a.height !== b.height) {
    throw new TypeError('frames must share dimensions');
  }
  let sum = 0;
  const n = a.width * a.height * 3;
  for (let i = 0; i < a.data.length; i += 4) {
    sum += Math.abs(a.data[i] - b.data[i]);
    sum += Math.abs(a.data[i + 1] - b.data[i + 1]);
    sum += Math.abs(a.data[i + 2] - b.data[i + 2]);
  }
  return clamp01(sum / n / 30);
}

/**
 * Mirror symmetry about the vertical axis — the signature of kaleidoscopic
 * geometry. Random noise scores ~0, a perfect mirror scores 1.
 * @param {Frame} frame
 */
export function mirrorSymmetry(frame) {
  assertFrame(frame);
  const { width: w, height: h, data: d } = frame;
  let sum = 0, count = 0;
  const half = Math.floor(w / 2);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < half; x++) {
      const i = (y * w + x) * 4;
      const j = (y * w + (w - 1 - x)) * 4;
      const diff = (Math.abs(d[i] - d[j]) + Math.abs(d[i + 1] - d[j + 1]) + Math.abs(d[i + 2] - d[j + 2])) / 3;
      sum += 1 - diff / 255;
      count++;
    }
  }
  return count === 0 ? 0 : clamp01(sum / count);
}

/**
 * Box-downsample a frame by 2. Used to walk an image down the scale pyramid.
 * @param {Frame} frame
 */
export function halveFrame(frame) {
  assertFrame(frame);
  const w = Math.max(1, frame.width >> 1);
  const h = Math.max(1, frame.height >> 1);
  const out = new Uint8ClampedArray(w * h * 4);
  const src = frame.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      for (let c = 0; c < 4; c++) {
        const a = src[((y * 2) * frame.width + x * 2) * 4 + c];
        const b = src[((y * 2) * frame.width + Math.min(frame.width - 1, x * 2 + 1)) * 4 + c];
        const d = src[(Math.min(frame.height - 1, y * 2 + 1) * frame.width + x * 2) * 4 + c];
        const e = src[(Math.min(frame.height - 1, y * 2 + 1) * frame.width
                      + Math.min(frame.width - 1, x * 2 + 1)) * 4 + c];
        out[o + c] = (a + b + d + e) >> 2;
      }
    }
  }
  return { data: out, width: w, height: h };
}

/**
 * Multi-scale detail: the geometric mean of edge density across three octaves.
 *
 * This is the metric that separates a genuinely fractal image from a merely
 * busy one. Fine noise scores high at full resolution and collapses to nothing
 * once halved; a soft gradient scores low everywhere. Only structure that
 * survives at coarse *and* fine scales — self-similar structure — scores well,
 * and a geometric mean means one empty octave drags the whole thing down.
 * @param {Frame} frame
 */
export function multiScaleDetail(frame) {
  assertFrame(frame);
  let current = frame;
  let product = 1;
  let levels = 0;
  for (let i = 0; i < 3; i++) {
    if (current.width < 8 || current.height < 8) break;
    product *= Math.max(1e-4, edgeDensity(current));
    levels++;
    current = halveFrame(current);
  }
  if (levels === 0) return 0;
  return clamp01(Math.pow(product, 1 / levels));
}

/** Weights for the composite score. Exported so tests can assert they sum to 1. */
export const TRIP_WEIGHTS = Object.freeze({
  colorfulness: 0.22,
  hueEntropy: 0.20,
  saturation: 0.12,
  edgeDensity: 0.14,
  temporalFlux: 0.13,
  mirrorSymmetry: 0.05,
  multiScaleDetail: 0.14,
});

/**
 * Composite TRIP SCORE (0..100) plus the raw component breakdown.
 * @param {Frame} frameA @param {Frame} frameB second frame, for motion
 */
export function tripScore(frameA, frameB) {
  const edges = edgeDensity(frameA);
  const metrics = {
    colorfulness: colorfulness(frameA),
    hueEntropy: hueEntropy(frameA),
    saturation: saturation(frameA),
    edgeDensity: edges,
    temporalFlux: frameB ? temporalFlux(frameA, frameB) : 0,
    // Symmetry is gated by structure: a blank wall is perfectly symmetric and
    // deeply un-trippy. Only mirrored *detail* earns credit here.
    mirrorSymmetry: mirrorSymmetry(frameA) * Math.sqrt(edges),
    multiScaleDetail: multiScaleDetail(frameA),
  };
  let score = 0;
  for (const [key, weight] of Object.entries(TRIP_WEIGHTS)) score += metrics[key] * weight;
  return { score: Math.round(clamp01(score) * 1000) / 10, metrics };
}

/**
 * The bar the experience must clear before the work is considered done.
 *
 * Scored over a time horizon rather than at one instant. The composition
 * genuinely breathes — it cycles between dense filigree and big bold shapes,
 * and a single sample is really a sample of one arbitrary phase. So a preset is
 * judged on two numbers: the mean across the horizon, which is what a viewer
 * actually experiences over a sitting, and the minimum, which guards against
 * the picture having any properly dead moments.
 */
export const TRIP_THRESHOLD = 82;

/** No moment in the cycle may fall below this, however good the average. */
export const TRIP_FLOOR = 77;
