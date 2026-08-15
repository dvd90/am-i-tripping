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
npm test             # 97 unit tests
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
| **multi-scale detail** | the geometric mean of edge density across three octaves — fine noise scores high at full resolution and collapses once halved, so only self-similar structure survives, and one empty octave drags the whole thing down |

`tools/trippy-check.mjs` boots the production server, drives the real app in
headless Chromium through `window.__trip`, and scores real frames read back from
the canvas. It exits non-zero below the threshold. `tools/bisect.mjs` pins
individual parameters to find which term is collapsing a picture;
`tools/timeline.mjs` scores one preset densely along time and prints the curve.

Scoring happens at **five points along a time horizon**, not at one instant. The
composition genuinely breathes — it cycles between dense filigree and big bold
shapes — so a single sample is really a sample of one arbitrary phase. Each
preset is judged on the mean across the horizon, which is what a viewer
experiences over a sitting, and on its minimum, which guards against the picture
having any properly dead moments. The harness pins the random seed, wipes the
feedback history between presets, and refuses to run against a stale `dist/`;
run-to-run spread is about 0.3 of a point.

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
- **The strobe was applied in the wrong pass.** A global brightness pulse ahead
  of a fixed-threshold contrast curve pushes every dim phase below the black
  point and crushes the colour out of it — the score swung twenty points at the
  strobe frequency. It also had no business being baked into the feedback
  buffer. It is now the last thing the present pass does.
- **A single global tone curve has to pick one black point for the whole frame**,
  so the darker presets had their shadows crushed and lost colour that was
  genuinely there — one measured half the colourfulness of the others while
  looking, to the eye, just as vivid. Local exposure estimation fixed it and was
  worth seven points on its own.

It also rejected several plausible ideas, which is most of its value:

- Finer contour octaves and a higher fractal base frequency both made the
  picture *worse*. Detail below the sampling resolution averages into a grey
  veil and takes the contrast with it.
- A CMYK halftone rosette — authentic to screen printing, and genuinely what
  blotter art is made of — cost nearly two points and read as speckle. Removed.
- Raising the fractal frequency to compensate for the kaleidoscope's angular
  squeeze made things worse for the same reason. The fix for a thin wedge is a
  wider wedge.
- Flooring the linework, on the theory that the contours are the graphic
  backbone, dropped the worst moment by nine points.

The presets got the same treatment. The data was unambiguous that strong print
with moderate geometry beats extreme geometry — the preset with everything at
maximum scored worst of the eight — so the extreme ones were pulled back.

Mean 87.3, worst preset 84.0, lowest single moment 79.8 — against a threshold of
82 and a floor of 77. The first run of this harness scored 51.8.

## How it works

```
src/
  trip/dose.ts        Bateman pharmacokinetic curve — the visuals genuinely
                      come up, peak and fade instead of tracking a slider
  trip/blotter.ts     sheet geometry: tab indexing, perforations, per-tab
                      dissolve stagger (it tears from the middle out)
  trip/presets.ts     eight blotter series as 15-dimensional parameter
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
kaleidoscope fold → Droste recursion → domain-warped fbm → tab motifs →
screen-print separation → sheet → feedback → re-stamp → ghost grid. The present
pass adds the lens: barrel, chromatic aberration, bloom, local tone mapping,
print quantisation, grain, vignette, strobe.

The Droste transform works in log-polar space, where a zoom is a translation, so
tiling that axis tiles *scale itself*: the same structure recurs at every
magnification and the zoom never arrives. Three separate parts of the pipeline
scale the world — the breath, the tunnel and that recursion — and each of them
was magnifying a fixed-frequency fractal, which just makes features bigger and
sparser. They now report their local scale so the fractal's frequency can track
it. A real fractal reveals more structure as you approach; this one had been
emptying out.

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
