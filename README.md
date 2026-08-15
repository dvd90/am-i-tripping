# AM I TRIPPING?

A blotter sheet that dissolves into a WebGL2 hallucination.

It opens as a sheet of perforated tabs — the classic blotter grid, printed with
sunburst rays, concentric rings and eyes that track you. You take one. The sheet
tears itself apart tab by tab, the print bleeds into the fractal underneath, and
a Shepard tone starts climbing a staircase that has no top.

There is no substance involved and none endorsed. It's a shader.

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # 88 unit tests
npm run trip:loop    # build, then score the real thing in a browser
```

## The loop

The brief was: *run → code → check if trippy → if not, again*. So "trippy" had to
become something a machine can measure, or the loop is just vibes.

`tools/trippiness.mjs` scores a pair of real frames on six axes:

| metric | what it catches |
|---|---|
| **colorfulness** | Hasler–Süsstrunk (2003) — grey scores 0, saturated multi-hue approaches 1 |
| **hue entropy** | Shannon entropy of the hue histogram, saturation-weighted so washed-out pixels can't fake a rainbow |
| **saturation** | value-weighted, so dark pixels don't dominate |
| **edge density** | Sobel magnitude — flat fields score 0, dense filigree approaches 1 |
| **temporal flux** | how much the image mutates between two frames |
| **mirror symmetry** | the signature of kaleidoscopic geometry, *gated by edge density* — a blank wall is perfectly symmetric and deeply un-trippy |

`tools/trippy-check.mjs` boots the production server, drives the real app in
headless Chromium through `window.__trip`, reads two frames back per preset and
scores them. It exits non-zero below the threshold. `tools/bisect.mjs` pins
individual parameters to find which term is collapsing a picture.

That harness earned its keep. It found:

- **The feedback loop was divergent.** A `max()` and a saturation boost *inside*
  the loop compounded once per frame until every preset locked onto a blown-out
  flat magenta within a second. The print flatten moved to the present pass and
  the echo is now strictly contractive.
- **Feedback used a pure zoom, which is an attractor.** History converged on the
  centre of the frame and died. It's rotation-dominant now, so the trails orbit
  instead of settling.
- **Feedback is a low-pass**, so it erased its own linework. The print is
  re-stamped after the mix, every frame.
- **Barrel distortion sampled outside the scene texture** and clamped, smearing
  edge texels into hard streaks around the border.
- **Half-float targets silently fell back to NEAREST filtering** where
  `OES_texture_float_linear` is missing. Nearest-neighbour resampling in a
  self-zooming loop replicates a texel outward until one colour eats the frame.
  It falls back to RGBA8 and keeps LINEAR instead.

At the fixed harness seed every preset clears 72 with the worst around 73 and a
mean of 77.5, reproducible to about a point across runs.

## How it works

```
src/
  trip/dose.ts        Bateman pharmacokinetic curve — the visuals genuinely
                      come up, peak and fade instead of tracking a slider
  trip/blotter.ts     sheet geometry: tab indexing, perforations, per-tab
                      dissolve stagger (it tears from the middle out)
  trip/presets.ts     eight blotter series as 14-dimensional parameter
                      vectors, morphable by componentwise lerp
  audio/tuning.ts     Shepard–Risset ladder, binaural pairs, just intonation
  audio/engine.ts     WebAudio plumbing + spectrum analysis back into the shader
  gl/renderer.ts      two programs, ping-pong feedback framebuffers
  gl/shaders/         the actual hallucination
```

Tabs print one of three designs chosen by tab id, drawn as signed distance
fields with heavy printed strokes: an eye that tracks you, Hofmann's bicycle
(it wobbles), and a mountain range under a sun and a crescent moon. The paper
tears away as the dose comes up, but the print doesn't leave — the same motifs
re-tile inside the kaleidoscope as a mandala of repeats.

The scene pass runs: breathe → tunnel-zoom → mouse gravity well → melt →
kaleidoscope fold → domain-warped fbm → tab motifs → screen-print separation →
sheet → feedback → re-stamp → ghost grid. The present pass adds the lens:
barrel, chromatic aberration, bloom, print quantisation, grain, vignette.

Everything with a right answer is unit tested — the dose curve peaks at exactly
1.0 at its analytic time-to-peak, the kaleidoscope fold preserves radius exactly
and confines every input angle to one mirrored wedge, the Shepard ladder maps
onto itself after a full phase (the endless-rise invariant), tab centres
round-trip through tab indices.

## Controls

<kbd>1</kbd>–<kbd>8</kbd> switch sheets · <kbd>space</kbd> redose ·
<kbd>C</kbd> calm mode · <kbd>M</kbd> sound · <kbd>H</kbd> hide HUD ·
<kbd>F</kbd> fullscreen · <kbd>R</kbd> reseed. Move the pointer to bend space;
hold to bend it harder. Leave it alone and the presets drift on their own —
nobody stays in control of their own trip.

## Safety

Flashing colours, rapid motion, deep contrast. Not for anyone with
photosensitive epilepsy. The strobe parameter is hard-capped in `sanitize()`
regardless of what a preset asks for, `prefers-reduced-motion` starts the
experience in calm mode, and <kbd>C</kbd> tones everything down at any moment.

## Deploy

Railway, via `railway.json`: `npm ci --include=dev && npm run build`, then
`npm start` serves `dist/` from `server.mjs` with `/healthz` for the healthcheck.
Any Node host works the same way.
