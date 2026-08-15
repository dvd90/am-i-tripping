/**
 * PRESENT pass — everything that should happen to light *after* the world is
 * drawn: chromatic aberration, barrel distortion, bloom, grain, vignette and
 * the final tone curve.
 */
export const PRESENT_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uScene;
uniform vec2  uRes;
uniform float uTime;
uniform float uIntensity;
uniform float uParams[15];
uniform float uFade;   // 0 = black, 1 = fully present

#define P_CHROMA  3
#define P_GRAIN   10
#define P_GLOW    11
#define P_INK     13

float p(int i) { return uParams[i]; }

float hash21(vec2 v) {
  return fract(sin(dot(v, vec2(127.1, 311.7))) * 43758.5453123);
}

void main() {
  vec2 uv = vUv;
  vec2 centred = uv - 0.5;
  float r2 = dot(centred, centred);

  // Barrel distortion — the edges of the visual field bulge outward. Normalised
  // by the value at the corner (r2 = 0.5) so the lens never samples outside the
  // scene texture: clamping out-of-bounds taps smears the edge texels into hard
  // streaks across the border of the frame.
  float k = (0.16 + 0.24 * uIntensity) * (0.9 + 0.1 * sin(uTime * 0.6));
  vec2 buv = centred * ((1.0 + k * r2) / (1.0 + k * 0.5)) + 0.5;

  // Chromatic aberration, scaled by distance from centre so the middle stays
  // readable and the periphery falls apart.
  float ca = p(P_CHROMA) * (0.004 + 0.02 * r2) * (1.0 + 0.4 * sin(uTime * 1.3));
  vec2 dir = normalize(centred + 1e-6);
  vec3 col;
  col.r = texture(uScene, clamp(buv + dir * ca, 0.0, 1.0)).r;
  col.g = texture(uScene, clamp(buv, 0.0, 1.0)).g;
  col.b = texture(uScene, clamp(buv - dir * ca, 0.0, 1.0)).b;

  // Cheap wide bloom: a few taps on a rotating spiral.
  float glow = p(P_GLOW);
  if (glow > 0.01) {
    vec3 sum = vec3(0.0);
    float radius = (2.5 + 6.0 * glow) / uRes.y;
    for (int i = 0; i < 8; i++) {
      float a = float(i) * 0.7853981634 + uTime * 0.2;
      vec2 offs = vec2(cos(a), sin(a)) * radius * (1.0 + float(i) * 0.35);
      sum += texture(uScene, clamp(buv + offs, 0.0, 1.0)).rgb;
    }
    sum /= 8.0;
    col += max(sum - 0.55, 0.0) * glow * 1.6;
  }

  // Hue-preserving contrast stretch. The peak imagery drifts to uniformly
  // mid-luminance saturated colour — vivid but flat — because nothing in the
  // hallucination is black or white the way ink and paper are. Pushing the
  // luminance apart while holding the chroma ratio restores the punch without
  // touching hue. It runs *before* the saturation lift and the quantiser, so
  // whatever chroma the stretch clips is put straight back — done afterwards it
  // costs a tenth of the colourfulness.
  float lum0 = dot(col, vec3(0.2126, 0.7152, 0.0722));
  float stretched = smoothstep(0.14, 0.86, lum0);
  col *= (stretched + 0.03) / (lum0 + 0.03);

  // --- screen print --------------------------------------------------------
  // Blotter art is printed in a handful of flat, violent dyes. Quantising here
  // — in the present pass, outside the feedback loop — pushes channels to their
  // extremes and draws hard borders between colour fields, without compounding
  // frame over frame.
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(lum), col, 1.45 + uIntensity * 0.5);
  float levels = mix(4.0, 9.0, p(P_INK));
  col = floor(clamp(col, 0.0, 1.6) * levels + 0.5) / levels;

  // Visual snow.
  float grain = (hash21(uv * uRes + fract(uTime) * 431.7) - 0.5) * p(P_GRAIN) * 0.35;
  col += grain;

  // Vignette that breathes shut at peak.
  col *= 1.0 - r2 * (0.45 + 0.35 * uIntensity);

  // Filmic-ish curve, then a lift so blacks glow rather than crush.
  col = col / (1.0 + col * 0.55);
  col = pow(max(col, 0.0), vec3(0.85));
  col += vec3(0.008, 0.005, 0.018) * (1.0 + uIntensity);

  fragColor = vec4(clamp(col * uFade, 0.0, 1.0), 1.0);
}
`;
