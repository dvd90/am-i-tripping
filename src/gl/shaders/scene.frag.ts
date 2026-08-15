/**
 * THE SHEET — main scene pass.
 *
 * Renders into a ping-pong framebuffer while sampling the previous frame, so
 * the image eats its own tail: infinite regress, trails, tunnels.
 *
 * Structure, roughly in the order light travels:
 *   space  → breathe → tunnel-zoom → melt → kaleidoscope fold
 *   colour → domain-warped fbm → blotter tile art → cosine palette
 *   time   → feedback from the previous frame, zoomed and hue-rotated
 */
export const SCENE_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uPrev;      // previous frame (feedback)
uniform vec2  uRes;
uniform float uTime;
uniform float uIntensity;     // 0..1 dose curve
uniform vec3  uMouse;         // xy in 0..1, z = held
uniform vec4  uAudio;         // bass, mid, treble, level
uniform float uParams[14];
uniform float uPresetHue;
uniform float uDissolve;      // 0 = intact blotter sheet, 1 = fully melted
uniform float uSeed;
uniform vec2  uSheet;         // sheet cols, rows

#define PI  3.14159265359
#define TAU 6.28318530718

#define P_WARP     0
#define P_FRACTAL  1
#define P_KALEIDO  2
#define P_CHROMA   3
#define P_FEEDBACK 4
#define P_HUE      5
#define P_BREATH   6
#define P_MELT     7
#define P_TUNNEL   8
#define P_STROBE   9
#define P_GRAIN    10
#define P_GLOW     11
#define P_BLOTTER  12
#define P_INK      13

float p(int i) { return uParams[i]; }

// ---------------------------------------------------------------- noise ----
float hash21(vec2 v) {
  return fract(sin(dot(v, vec2(127.1, 311.7))) * 43758.5453123);
}

float vnoise(vec2 v) {
  vec2 i = floor(v), f = fract(v);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1, 0)), u.x),
             mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), u.x), u.y);
}

float fbm(vec2 v, float detail) {
  float sum = 0.0, amp = 0.5, norm = 0.0;
  mat2 rot = mat2(0.8, 0.6, -0.6, 0.8); // rotate each octave to kill axis-aligned banding
  for (int i = 0; i < 6; i++) {
    float w = smoothstep(float(i) - 1.0, float(i), detail * 6.0);
    sum += vnoise(v) * amp * w;
    norm += amp * w;
    v = rot * v * 2.02;
    amp *= 0.5;
  }
  return norm > 0.0 ? sum / norm : 0.0;
}

// -------------------------------------------------------------- geometry ---
vec2 rotate(vec2 v, float a) {
  float c = cos(a), s = sin(a);
  return mat2(c, -s, s, c) * v;
}

// Mirror space into a single wedge — the CPU twin of this lives in mathx.ts.
vec2 kaleido(vec2 v, float segments) {
  float r = length(v);
  float a = atan(v.y, v.x);
  float wedge = TAU / segments;
  a = mod(a, wedge);
  a = abs(a - wedge * 0.5);
  return vec2(cos(a), sin(a)) * r;
}

// Iterated domain warping — noise whose *input* is noise. This is what makes
// surfaces crawl and breathe instead of merely scrolling.
vec2 domainWarp(vec2 v, float amount, float t) {
  vec2 q = vec2(fbm(v + vec2(0.0, t * 0.08), 0.6),
                fbm(v + vec2(5.2, 1.3) - t * 0.05, 0.6));
  vec2 r = vec2(fbm(v + 3.0 * q + vec2(1.7, 9.2) + t * 0.06, 0.8),
                fbm(v + 3.0 * q + vec2(8.3, 2.8) - t * 0.04, 0.8));
  return v + amount * (q * 0.6 + r * 1.4);
}

// ---------------------------------------------------------------- colour ---
// Inigo Quilez cosine palette: cheap, and every offset is a different acid dye.
vec3 palette(float t, float shift) {
  vec3 a = vec3(0.5), b = vec3(0.5);
  vec3 c = vec3(1.0, 1.0, 1.0);
  vec3 d = vec3(0.0, 0.33, 0.67) + shift;
  return a + b * cos(TAU * (c * t + d));
}

vec3 hueRotate(vec3 col, float angle) {
  const vec3 k = vec3(0.57735);
  float c = cos(angle), s = sin(angle);
  return col * c + cross(k, col) * s + k * dot(k, col) * (1.0 - c);
}

vec3 saturate3(vec3 col, float amount) {
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  return mix(vec3(lum), col, amount);
}

// ---------------------------------------------------- blotter tile print ---
// One tab of the sheet, drawn procedurally in the flat, hard-outlined style of
// printed blotter art: sunburst rays, concentric rings, and an eye that tracks.
vec3 blotterTile(vec2 q, float id, float t, float ink, out float mask) {
  float ang = atan(q.y, q.x);
  float rad = length(q);

  float spin = t * (0.15 + fract(id * 0.37) * 0.25) + id;
  float rayCount = 8.0 + floor(fract(id * 0.71) * 8.0) * 2.0;
  float rays = step(0.5, fract((ang + spin) / TAU * rayCount));

  float rings = step(0.5, fract(rad * (4.0 + fract(id * 0.53) * 6.0) - t * 0.35));

  // Lens-shaped eye: the intersection of two offset discs.
  vec2 e = q * 2.2;
  float lens = max(length(e - vec2(0.0, 0.62)) - 0.95, length(e + vec2(0.0, 0.62)) - 0.95);
  float eyeWhite = smoothstep(0.02, -0.02, lens);
  vec2 gaze = normalize(vec2(sin(t * 0.7 + id), cos(t * 0.5 + id * 1.7)) + 1e-5) * 0.22;
  float iris = smoothstep(0.30, 0.27, length(e - gaze));
  float pupil = smoothstep(0.13, 0.10, length(e - gaze) * (1.0 + 0.25 * sin(t * 2.0)));

  float hue = fract(id * 0.191 + uPresetHue + t * 0.02 * p(P_HUE));
  vec3 col = palette(hue + rad * 0.5, 0.0);
  col = mix(col, palette(hue + 0.35, 0.15), rays);
  col = mix(col, palette(hue + 0.6, 0.3), rings * 0.55);
  col = mix(col, vec3(0.97, 0.95, 0.88), eyeWhite * 0.85);
  col = mix(col, palette(fract(hue + 0.5), 0.0) * 1.3, iris * eyeWhite);
  col = mix(col, vec3(0.02), pupil * eyeWhite);

  // Hard black linework — the printed-ink look. Blotter art is defined by its
  // heavy outlines far more than by its palette, so these are drawn thick.
  float outline = max(eyeWhite - smoothstep(-0.055, -0.13, lens), 0.0);
  outline = max(outline, iris * (1.0 - smoothstep(0.27, 0.235, length(e - gaze))));
  // Ring outlines through the rays.
  float ringEdge = abs(fract(rad * (4.0 + fract(id * 0.53) * 6.0) - t * 0.35) - 0.5);
  outline = max(outline, (1.0 - smoothstep(0.42, 0.5, ringEdge)) * 0.55 * (1.0 - eyeWhite));
  col = mix(col, vec3(0.03, 0.02, 0.05), outline * ink);

  // A printed border just inside the tab edge.
  float edge = max(abs(q.x), abs(q.y));
  col = mix(col, vec3(0.04, 0.03, 0.06),
            smoothstep(0.40, 0.425, edge) * (1.0 - smoothstep(0.455, 0.475, edge)) * ink);

  mask = 1.0 - smoothstep(0.44, 0.5, edge);
  return col;
}

// Perforation holes along every tab seam. Mirrors blotter.ts::perforationMask.
float perforation(vec2 uv, vec2 grid) {
  vec2 local = fract(uv * grid);
  vec2 d = min(local, 1.0 - local);
  bool vertical = d.x <= d.y;
  float along  = vertical ? local.y : local.x;
  float across = vertical ? d.x : d.y;
  float phase = abs(fract(along * 8.0) - 0.5) * 2.0;
  float dist = length(vec2(across, phase * 0.5) / 0.06);
  return 1.0 - smoothstep(0.7, 1.15, dist);
}

// ------------------------------------------------------------------ main ---
void main() {
  vec2 uv = vUv;
  vec2 st = (uv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  float t = uTime;
  float dose = uIntensity;

  float bass = uAudio.x, mid = uAudio.y, treble = uAudio.z, level = uAudio.w;

  // --- breathing: everything inhales and exhales, faster on the come-up ---
  float breath = 1.0 + p(P_BREATH) * 0.22 * sin(t * 0.9 + bass * 3.0)
                     + bass * 0.09 * p(P_BREATH);
  st /= breath;

  // --- the pull toward the vanishing point ---
  float tunnel = p(P_TUNNEL);
  st = rotate(st, sin(t * 0.13) * 0.6 * tunnel + t * 0.02 * tunnel);
  float zoom = 1.0 - tunnel * 0.35 * (0.5 + 0.5 * sin(t * 0.21));
  st *= zoom;

  // --- the mouse is a gravity well in the middle of the picture ---
  vec2 mouse = (uMouse.xy - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  vec2 toMouse = st - mouse;
  float pull = exp(-dot(toMouse, toMouse) * 3.0) * (0.35 + uMouse.z * 0.55);
  st += normalize(toMouse + 1e-5) * pull * sin(t * 1.7) * 0.35;
  st = rotate(st, pull * 2.4);

  // --- melt: the lower half of the world drips ---
  float meltAmt = p(P_MELT);
  st.y += meltAmt * 0.28 * fbm(vec2(st.x * 2.5, t * 0.25), 0.5) * smoothstep(-0.1, 0.6, st.y);

  // --- kaleidoscopic mirror ---
  float segments = floor(mix(2.0, 16.0, p(P_KALEIDO)) + 0.5);
  vec2 kst = kaleido(st, segments);
  st = mix(st, kst, smoothstep(0.02, 0.25, p(P_KALEIDO)));

  // --- the fractal substrate ---
  vec2 warped = domainWarp(st * (1.6 + treble * 1.2), p(P_WARP) * (0.5 + dose), t);
  float field = fbm(warped * 1.3 + t * 0.05, p(P_FRACTAL));
  float veins = abs(fbm(warped * 3.1 - t * 0.09, p(P_FRACTAL)) - 0.5) * 2.0;
  veins = pow(1.0 - veins, 3.0); // bright filaments through the noise

  // Spread hue across the frame as well as through the field, so a single
  // screen holds the whole colour wheel instead of one corner of it.
  float hueShift = fract(uPresetHue + t * 0.035 * p(P_HUE) + field * 0.85
                         + length(st) * 0.22 + atan(st.y, st.x) / TAU * 0.4
                         + level * 0.2);
  vec3 col = palette(hueShift, 0.0);
  col = mix(col, palette(fract(hueShift + 0.45), 0.2), veins * 0.85);
  col += veins * p(P_GLOW) * 0.6 * palette(fract(hueShift + 0.15), 0.0);

  // --- the print, reappearing inside the vision ---------------------------
  // The paper tears away, but the *image* on it doesn't leave. Because st
  // has already been kaleidoscoped, tiling the tab art here scatters eyes,
  // rays and rings through the hallucination as a mandala of repeats.
  {
    float scale = 1.5 + 2.6 * p(P_TUNNEL) + 1.2 * p(P_KALEIDO);
    vec2 mst = st * scale + vec2(0.0, t * 0.05 * p(P_MELT));
    vec2 mcell = floor(mst);
    vec2 mlocal = fract(mst) - 0.5;
    float mid = mcell.x * 7.0 + mcell.y * 13.0 + uSeed;
    float mmask;
    vec3 motif = blotterTile(mlocal, mid, t, p(P_INK), mmask);
    float strength = (0.20 + 0.34 * dose) * (0.35 + 0.65 * p(P_BLOTTER));
    col = mix(col, motif, mmask * strength);
  }

  // --- the print pass -----------------------------------------------------
  // Blotter art is screen-printed: flat plateaus of dye separated by hard
  // black linework, not smooth gradients. Posterising the field and drawing
  // fwidth-thin contours where it steps is what gives the whole thing its
  // graphic bite — and turns a soft noise field into real structure.
  float ink = p(P_INK);
  vec3 printDye = col;
  float printLine = 0.0;
  if (ink > 0.01) {
    float bands = mix(4.0, 15.0, p(P_FRACTAL));
    float f = field * bands;
    float plateau = floor(f) / bands;
    // Sweep more than a full hue turn across the plateaus so adjacent flats
    // land on genuinely different dyes.
    vec3 flatDye = palette(fract(uPresetHue + plateau * 3.1 + t * 0.035 * p(P_HUE)), 0.12);
    printDye = flatDye;
    col = mix(col, flatDye, ink * 0.8);

    // Constant-thickness contour in screen space, whatever the zoom.
    float w = fwidth(f) * 1.4 + 1e-4;
    float contour = 1.0 - smoothstep(0.0, w, min(fract(f), 1.0 - fract(f)));
    printLine = contour;
    col = mix(col, vec3(0.02, 0.012, 0.05), contour * ink);

    // A second, finer set of lines through the vein filaments: cross-hatching.
    float vf = veins * bands * 0.6;
    float vw = fwidth(vf) * 1.6 + 1e-4;
    float hatch = 1.0 - smoothstep(0.0, vw, min(fract(vf), 1.0 - fract(vf)));
    col = mix(col, vec3(0.03, 0.02, 0.06), hatch * ink * 0.55);
  }

  // --- the sheet itself, dissolving tab by tab ---
  float sheetAmount = p(P_BLOTTER) * (1.0 - uDissolve * 0.85);
  if (sheetAmount > 0.01) {
    vec2 grid = uSheet;
    vec2 sheetUv = uv + vec2(fbm(uv * 3.0 + t * 0.1, 0.4) - 0.5, fbm(uv * 3.0 - t * 0.1, 0.4) - 0.5)
                        * uDissolve * 0.35; // tabs warp as they let go
    vec2 cell = floor(sheetUv * grid);
    vec2 local = fract(sheetUv * grid) - 0.5;
    float id = cell.x + cell.y * grid.x + uSeed * 7.0;

    // Per-tab dissolve stagger: middle of the sheet tears first.
    vec2 centre = (cell + 0.5) / grid;
    float radial = length(centre - 0.5) / 0.7071;
    float threshold = clamp(hash21(centre * 37.7 + uSeed) * 0.65 + radial * 0.35, 0.0, 1.0);
    float alive = 1.0 - smoothstep(threshold - 0.12, threshold + 0.12, uDissolve);

    float tileMask;
    vec3 tile = blotterTile(local, id, t, p(P_INK), tileMask);

    float paper = 1.0 - perforation(sheetUv, grid) * 0.9;
    tile *= paper;
    // Seam shadow between tabs.
    tile *= 1.0 - 0.35 * (1.0 - smoothstep(0.42, 0.47, max(abs(local.x), abs(local.y))));

    col = mix(col, tile, sheetAmount * alive * (0.72 + 0.28 * tileMask));
  }

  // --- feedback: the frame remembers itself, a little bigger and turned ---
  float fb = p(P_FEEDBACK);
  if (fb > 0.01) {
    // Rotation-dominant, not zoom-dominant. A feedback transform that only
    // scales toward the centre is an attractor: at high feedback the history
    // converges on the middle of the frame and the picture flattens into one
    // dead colour. Spinning the history instead makes it orbit — the trails
    // spiral outward forever and never settle.
    vec2 fuv = uv - 0.5;
    fuv = rotate(fuv, 0.045 + 0.055 * sin(t * 0.23) + fb * 0.055 + pull * 0.12);
    fuv *= 0.993 - 0.014 * tunnel - bass * 0.008;
    fuv += 0.5;
    fuv += vec2(0.0, -meltAmt * 0.004); // trails drift upward as the world drips down
    // Fade the echo out at the borders: sampling a clamped edge texel over and
    // over smears it into horizontal streaks across the frame.
    vec2 inside = smoothstep(vec2(0.0), vec2(0.055), fuv)
                * smoothstep(vec2(0.0), vec2(0.055), 1.0 - fuv);
    float border = inside.x * inside.y;
    vec3 prev = texture(uPrev, clamp(fuv, 0.001, 0.999)).rgb;
    // Everything in this path must be strictly contractive. A max() or a
    // saturation boost applied here compounds once per frame and the whole
    // image locks onto a blown-out fixed point within a second — the loop is
    // for memory, not for gain.
    vec3 echo = hueRotate(prev, 0.06 * p(P_HUE) + 0.03) * mix(0.985, 0.93, fb);
    // Hard ceiling on the blend: past ~0.6 the current frame stops contributing
    // enough new detail to keep the loop alive.
    col = mix(col, echo, min(fb * 0.68, 0.6) * border);
  }

  // --- re-stamp the print over the history ---------------------------------
  // Feedback is a low-pass: blend a frame into its own past often enough and
  // every hard edge and distinct dye is averaged away, which is why the
  // high-feedback presets were collapsing into one flat colour. Restating the
  // linework and the flat dyes *after* the mix means the press comes down on
  // every frame, however deep the echo runs.
  if (ink > 0.01 && fb > 0.01) {
    // Driven mostly by how deep the echo is, not by how inky the preset is —
    // the softest presets are exactly the ones the feedback washes out hardest.
    float restate = fb * (0.45 + 0.55 * ink);
    col = mix(col, printDye, restate * 0.42);
    col = mix(col, vec3(0.02, 0.012, 0.05), printLine * restate * 0.9);
  }

  // --- the ghost sheet -----------------------------------------------------
  // Drawn *after* the feedback mix so it stays razor sharp while everything
  // underneath smears. However far the trip goes, you never quite stop seeing
  // the perforated grid you took it off.
  float ghost = p(P_BLOTTER) * (0.30 + 0.55 * (1.0 - uDissolve));
  if (ghost > 0.01) {
    vec2 gridUv = uv + vec2(sin(uv.y * 9.0 + t * 0.4), cos(uv.x * 9.0 - t * 0.35))
                       * 0.004 * (1.0 + uDissolve * 3.0);
    vec2 local = fract(gridUv * uSheet) - 0.5;
    float edgeDist = 0.5 - max(abs(local.x), abs(local.y));
    float aa = fwidth(edgeDist) * 1.5 + 0.006;
    float seam = 1.0 - smoothstep(0.0, aa, edgeDist);
    float holes = perforation(gridUv, uSheet);

    // An intact sheet shows *paper* at the seams — that pale dashed grid is the
    // whole visual signature. Only once it starts tearing do the seams darken
    // into ink lines running through the vision.
    vec3 seamColour = mix(vec3(0.96, 0.93, 0.84), vec3(0.02, 0.012, 0.05), uDissolve);
    col = mix(col, seamColour, seam * ghost * (0.55 + 0.45 * p(P_INK)));
    // Light comes through the punched holes.
    col = mix(col, vec3(1.0, 0.98, 0.92), holes * ghost * 0.8);
  }

  // --- paper stock ---------------------------------------------------------
  // Blotter art is ink on white card: bright, high-key, saturated. The vision
  // it becomes is lit from within and much darker. Cross-fade the exposure
  // between the two as the sheet dissolves.
  float paper = (1.0 - uDissolve) * p(P_BLOTTER);
  col = mix(col, col * 1.5 + 0.11, paper * 0.85);

  // --- strobe, capped well below the photosensitive danger zone ---
  float strobe = 1.0 + p(P_STROBE) * 0.5 * sin(t * 6.0 + bass * 6.0);
  col *= strobe;

  col = saturate3(col, 1.25 + dose * 0.5 + level * 0.3);
  fragColor = vec4(clamp(col, 0.0, 4.0), 1.0);
}
`;
