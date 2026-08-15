/**
 * AM I TRIPPING? — entry point.
 *
 * Boots the renderer, runs the dose clock, morphs between blotter presets and
 * wires up input. Also exposes `window.__trip`: a small deterministic control
 * surface the automated trippiness harness drives to score real frames.
 */

import './styles.css';
import { TripRenderer } from './gl/renderer';
import { TripAudio } from './audio/engine';
import { DEFAULT_DOSE, tripClock, type TripPhase } from './trip/dose';
import { DEFAULT_SHEET } from './trip/blotter';
import {
  DEFAULT_PRESET_ID, PRESETS, getPreset, lerpParams, sanitize, scaleByIntensity,
  type TripParams, type TripPreset,
} from './trip/presets';
import { clamp, smoothstep } from './util/mathx';
import { tripScore } from '../tools/trippiness.mjs';

// ---------------------------------------------------------------- state ----
type Stage = 'sheet' | 'tripping';

const canvas = document.querySelector<HTMLCanvasElement>('#stage')!;
const gate = document.querySelector<HTMLElement>('#gate')!;
const hud = document.querySelector<HTMLElement>('#hud')!;
const tabsHost = document.querySelector<HTMLElement>('#tabs')!;
const takeButton = document.querySelector<HTMLButtonElement>('#take')!;
const flash = document.querySelector<HTMLElement>('#flash')!;
const phaseEl = document.querySelector<HTMLElement>('#phase')!;
const clockEl = document.querySelector<HTMLElement>('#clock')!;
const meterEl = document.querySelector<HTMLElement>('#meter-fill')!;
const presetNameEl = document.querySelector<HTMLElement>('#preset-name')!;
const taglineEl = document.querySelector<HTMLElement>('#tagline')!;
const scoreEl = document.querySelector<HTMLElement>('#trip-score')!;

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const state = {
  stage: 'sheet' as Stage,
  selected: getPreset(DEFAULT_PRESET_ID),
  /** Where the morph is coming from, and how far along it is. */
  morphFrom: getPreset(DEFAULT_PRESET_ID).params,
  morphT: 1,
  morphHueFrom: getPreset(DEFAULT_PRESET_ID).hue,
  takenAt: 0,
  shaderTime: 0,
  seed: Math.random() * 100,
  calm: prefersReducedMotion,
  hudHidden: false,
  uiSuppressed: false,
  fade: 0,
  lastInteraction: 0,
  autoDriftAt: Infinity,
  /** Harness overrides — null means "use the live simulation". */
  forcedIntensity: null as number | null,
  forcedDissolve: null as number | null,
  score: 0,
  /** Per-parameter overrides, for debugging and the harness. */
  overrides: {} as Partial<TripParams>,
};

const pointer = { x: 0.5, y: 0.5, down: false, targetX: 0.5, targetY: 0.5 };

const renderer = new TripRenderer(canvas, prefersReducedMotion ? 0.6 : 0.8);
// The scene pass is expensive (several fbm evaluations per pixel). Watch the
// real frame time and give back resolution rather than dropping frames — a
// psychedelic that stutters isn't hypnotic, it's just broken.
const perf = { accum: 0, frames: 0, scale: prefersReducedMotion ? 0.6 : 0.8 };
const audio = new TripAudio();

// ------------------------------------------------------------- the sheet ---
function buildTabPicker(): void {
  for (const [index, preset] of PRESETS.entries()) {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'tab';
    tab.setAttribute('role', 'radio');
    tab.setAttribute('aria-checked', String(preset.id === state.selected.id));
    tab.style.setProperty('--dye', `hsl(${preset.hue * 360} 92% 62%)`);
    tab.innerHTML = `${preset.name}<small>${preset.tagline}</small>`;
    tab.addEventListener('click', () => {
      selectPreset(preset, index);
      if (state.stage === 'tripping') return;
      for (const el of tabsHost.querySelectorAll('.tab')) el.setAttribute('aria-checked', 'false');
      tab.setAttribute('aria-checked', 'true');
    });
    tabsHost.append(tab);
  }
}

function selectPreset(preset: TripPreset, chimeSeed = 0): void {
  if (preset.id === state.selected.id && state.morphT >= 1) return;
  state.morphFrom = currentParams();
  state.morphHueFrom = currentHue();
  state.morphT = 0;
  state.selected = preset;
  state.lastInteraction = performance.now() / 1000;
  state.autoDriftAt = state.lastInteraction + 45;
  presetNameEl.textContent = preset.name;
  taglineEl.textContent = preset.tagline;
  audio.chime(chimeSeed, 0.6);
}

function currentParams(): TripParams {
  return lerpParams(state.morphFrom, state.selected.params, smoothstep(0, 1, state.morphT));
}

function currentHue(): number {
  return state.morphHueFrom + (state.selected.hue - state.morphHueFrom) * smoothstep(0, 1, state.morphT);
}

// --------------------------------------------------------------- dosing ----
function take(): void {
  if (state.stage === 'tripping') {
    // Redose: reset the clock, flash, and let it come up all over again.
    state.takenAt = state.shaderTime;
    burn();
    audio.chime(3, 1);
    return;
  }
  state.stage = 'tripping';
  state.takenAt = state.shaderTime;
  gate.classList.add('dissolving');
  window.setTimeout(() => { gate.hidden = true; }, 950);
  if (!state.uiSuppressed) hud.hidden = false;
  burn();
  void audio.start().then(() => audio.chime(0, 0.8));
}

function burn(): void {
  flash.classList.add('burn');
  window.setTimeout(() => flash.classList.remove('burn'), 110);
}

// ---------------------------------------------------------------- input ----
function setPointerFromEvent(clientX: number, clientY: number): void {
  pointer.targetX = clamp(clientX / window.innerWidth);
  pointer.targetY = clamp(1 - clientY / window.innerHeight);
}

window.addEventListener('pointermove', (e) => setPointerFromEvent(e.clientX, e.clientY), { passive: true });
window.addEventListener('pointerdown', (e) => {
  pointer.down = true;
  setPointerFromEvent(e.clientX, e.clientY);
}, { passive: true });
window.addEventListener('pointerup', () => { pointer.down = false; }, { passive: true });
window.addEventListener('pointercancel', () => { pointer.down = false; }, { passive: true });

takeButton.addEventListener('click', take);

window.addEventListener('keydown', (event) => {
  const key = event.key.toLowerCase();
  if (key >= '1' && key <= '9') {
    const preset = PRESETS[Number(key) - 1];
    if (preset) {
      selectPreset(preset, Number(key));
      for (const [i, el] of [...tabsHost.querySelectorAll('.tab')].entries()) {
        el.setAttribute('aria-checked', String(PRESETS[i]?.id === preset.id));
      }
    }
    return;
  }
  switch (key) {
    case ' ': case 'enter': event.preventDefault(); take(); break;
    case 'c': state.calm = !state.calm; break;
    case 'm': audio.setMuted(!audio.isMuted); break;
    case 'h': state.hudHidden = !state.hudHidden; hud.classList.toggle('faded', state.hudHidden); break;
    case 'r': state.seed = Math.random() * 100; burn(); break;
    case 'f':
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen().catch(() => {});
      break;
    default: break;
  }
});

// --------------------------------------------------------------- resize ----
function resize(): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  renderer.resize(window.innerWidth, window.innerHeight, dpr);
}
window.addEventListener('resize', resize, { passive: true });
window.addEventListener('orientationchange', resize, { passive: true });

// -------------------------------------------------------- live scoring -----
const probe = document.createElement('canvas');
probe.width = 96;
probe.height = 54;
const probeCtx = probe.getContext('2d', { willReadFrequently: true });
let lastProbe: ImageData | null = null;

function sampleTrippiness(): void {
  if (!probeCtx) return;
  probeCtx.drawImage(canvas, 0, 0, probe.width, probe.height);
  const frame = probeCtx.getImageData(0, 0, probe.width, probe.height);
  if (lastProbe) {
    const { score } = tripScore(frame, lastProbe);
    state.score = score;
  }
  lastProbe = frame;
}

// ----------------------------------------------------------------- loop ----
let lastFrame = performance.now();
let probeTimer = 0;

/** One simulation + render step. `dt` in seconds. Reused by the harness. */
function step(dt: number): void {
  state.shaderTime += dt;
  pointer.x += (pointer.targetX - pointer.x) * Math.min(1, dt * 6);
  pointer.y += (pointer.targetY - pointer.y) * Math.min(1, dt * 6);
  state.morphT = Math.min(1, state.morphT + dt / 2.2);

  const elapsed = state.stage === 'tripping' ? state.shaderTime - state.takenAt : 0;
  const clock = tripClock(elapsed, DEFAULT_DOSE);
  const intensity = state.forcedIntensity ?? (state.stage === 'tripping' ? clock.intensity : 0);
  const dissolve = state.forcedDissolve ?? smoothstep(0.04, 0.72, intensity);

  // The world fades up out of black as the sheet is taken.
  const targetFade = 1;
  state.fade += (targetFade - state.fade) * Math.min(1, dt * 1.5);

  let params = sanitize(scaleByIntensity(currentParams(), state.stage === 'tripping' ? intensity : 0.62));
  params = { ...params, ...state.overrides };
  if (state.calm) {
    params = sanitize({
      ...params,
      strobe: params.strobe * 0.15,
      warp: params.warp * 0.55,
      tunnel: params.tunnel * 0.4,
      melt: params.melt * 0.5,
      chroma: params.chroma * 0.5,
    });
  }

  const levels = audio.started ? audio.update(dt, intensity) : { bass: 0, mid: 0, treble: 0, level: 0 };

  renderer.render({
    time: state.shaderTime,
    intensity,
    mouse: { x: pointer.x, y: pointer.y, down: pointer.down },
    audio: levels,
    params,
    presetHue: currentHue(),
    dissolve,
    seed: state.seed,
    sheet: DEFAULT_SHEET,
    fade: state.fade,
  });

  updateHud(clock.phase, elapsed, intensity);

  // Nobody stays in control of their own trip: presets drift on their own.
  const now = state.shaderTime;
  if (state.stage === 'tripping' && now > state.autoDriftAt) {
    const others = PRESETS.filter((p) => p.id !== state.selected.id);
    const next = others[Math.floor(Math.random() * others.length)];
    if (next) selectPreset(next, Math.floor(now));
    state.autoDriftAt = now + 26 + Math.random() * 18;
  }
}

const PHASE_LABEL: Record<TripPhase, string> = {
  'sober': 'BASELINE',
  'come-up': 'COME UP',
  'peak': 'PEAK',
  'come-down': 'COME DOWN',
  'afterglow': 'AFTERGLOW',
};

function updateHud(phase: TripPhase, elapsed: number, intensity: number): void {
  if (hud.hidden) return;
  phaseEl.textContent = PHASE_LABEL[phase];
  const total = Math.floor(elapsed);
  clockEl.textContent = `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  meterEl.style.width = `${(intensity * 100).toFixed(1)}%`;
  scoreEl.textContent = state.score > 0 ? `TRIP ${state.score.toFixed(0)}` : '—';
}

function adaptResolution(dt: number): void {
  perf.accum += dt;
  perf.frames += 1;
  if (perf.accum < 1.5) return;
  const fps = perf.frames / perf.accum;
  perf.accum = 0;
  perf.frames = 0;
  const next = fps < 34 ? perf.scale - 0.12 : fps > 57 ? perf.scale + 0.06 : perf.scale;
  const clamped = clamp(next, 0.34, prefersReducedMotion ? 0.6 : 0.9);
  if (Math.abs(clamped - perf.scale) > 0.01) {
    perf.scale = clamped;
    renderer.setRenderScale(clamped);
    resize();
  }
}

function frame(now: number): void {
  const dt = Math.min(0.05, Math.max(0, (now - lastFrame) / 1000));
  lastFrame = now;
  step(dt);
  adaptResolution(dt);

  probeTimer += dt;
  if (probeTimer > 0.75) {
    probeTimer = 0;
    sampleTrippiness();
  }
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------- harness -----
export interface TripApi {
  ready: boolean;
  presetIds: () => string[];
  take: (presetId?: string) => void;
  setPreset: (presetId: string, immediate?: boolean) => void;
  forceIntensity: (value: number | null) => void;
  forceDissolve: (value: number | null) => void;
  setCalm: (value: boolean) => void;
  /** Pin the random seed, so a measurement run is reproducible. */
  setSeed: (seed: number) => void;
  /** Wipe the feedback history and the clock, for reproducible measurement. */
  reset: () => void;
  /** Pin a single parameter, or clear all pins with `null`. */
  overrideParam: (key: keyof TripParams | null, value?: number) => void;
  /** Deterministically advance the simulation by `frames` steps of `dt`. */
  advance: (frames: number, dt?: number) => void;
  hideUi: () => void;
  score: () => number;
}

const api: TripApi = {
  ready: true,
  presetIds: () => PRESETS.map((p) => p.id),
  take: (presetId?: string) => {
    if (presetId) api.setPreset(presetId, true);
    take();
  },
  setPreset: (presetId: string, immediate = false) => {
    const preset = getPreset(presetId);
    selectPreset(preset);
    if (immediate) {
      state.morphFrom = preset.params;
      state.morphHueFrom = preset.hue;
      state.morphT = 1;
    }
  },
  forceIntensity: (value) => { state.forcedIntensity = value; },
  setSeed: (seed: number) => { state.seed = seed; },
  reset: () => {
    renderer.clearHistory();
    state.shaderTime = 0;
    state.takenAt = 0;
    state.fade = state.stage === 'tripping' ? 1 : 0;
  },
  overrideParam: (key, value = 0) => {
    if (key === null) state.overrides = {};
    else state.overrides[key] = value;
  },
  forceDissolve: (value) => { state.forcedDissolve = value; },
  setCalm: (value) => { state.calm = value; },
  advance: (frames, dt = 1 / 60) => { for (let i = 0; i < frames; i++) step(dt); },
  hideUi: () => {
    state.uiSuppressed = true;
    gate.hidden = true;
    hud.hidden = true;
    document.body.style.cursor = 'none';
  },
  score: () => state.score,
};

declare global {
  interface Window { __trip: TripApi }
}
window.__trip = api;

// ------------------------------------------------------------------ go -----
buildTabPicker();
presetNameEl.textContent = state.selected.name;
taglineEl.textContent = state.selected.tagline;
resize();
requestAnimationFrame(frame);
