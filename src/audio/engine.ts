/**
 * THE DRONE
 * ---------
 * A Shepard–Risset tone that rises forever, a binaural beat bed underneath it,
 * and pentatonic bells that ring out when the world changes. An analyser feeds
 * the band energies straight back into the shader, so the picture moves with
 * the sound.
 *
 * All tuning maths lives in `tuning.ts` (and is unit tested); this file is only
 * WebAudio plumbing.
 */

import { beatForIntensity, binauralPair, justRatio, PENTATONIC, shepardVoices } from './tuning';
import { clamp } from '../util/mathx';

export interface AudioLevels {
  bass: number;
  mid: number;
  treble: number;
  level: number;
}

const SILENT: AudioLevels = { bass: 0, mid: 0, treble: 0, level: 0 };

export class TripAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private spectrum: Uint8Array = new Uint8Array(0);
  private shepard: { osc: OscillatorNode; gain: GainNode }[] = [];
  private binaural: { osc: OscillatorNode; pan: StereoPannerNode }[] = [];
  private shepardPhase = 0;
  private levels: AudioLevels = { ...SILENT };
  private readonly octaves = 7;
  private muted = false;

  get started(): boolean { return this.ctx !== null; }
  get isMuted(): boolean { return this.muted; }

  /** Must be called from a user gesture. Safe to call repeatedly. */
  async start(): Promise<void> {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      return;
    }
    const Ctor: typeof AudioContext =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return; // no audio available — visuals carry on regardless
    const ctx = new Ctor();
    this.ctx = ctx;

    const master = ctx.createGain();
    master.gain.value = 0;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.78;
    this.spectrum = new Uint8Array(analyser.frequencyBinCount);

    // Gentle low-pass so the top octaves never get harsh.
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 5200;
    tone.Q.value = 0.7;

    master.connect(tone);
    tone.connect(analyser);
    analyser.connect(ctx.destination);
    this.master = master;
    this.analyser = analyser;

    for (let i = 0; i < this.octaves; i++) {
      const osc = ctx.createOscillator();
      osc.type = i % 2 === 0 ? 'sine' : 'triangle';
      const gain = ctx.createGain();
      gain.gain.value = 0;
      osc.connect(gain);
      gain.connect(master);
      osc.start();
      this.shepard.push({ osc, gain });
    }

    for (const side of [-1, 1]) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      const pan = ctx.createStereoPanner();
      pan.pan.value = side;
      const gain = ctx.createGain();
      gain.gain.value = 0.16;
      osc.connect(gain);
      gain.connect(pan);
      pan.connect(master);
      osc.start();
      this.binaural.push({ osc, pan });
    }

    await ctx.resume();
    master.gain.setTargetAtTime(0.22, ctx.currentTime, 2.5); // fade in over the come-up
  }

  /** Advance the drone. `dt` in seconds, `intensity` is the dose curve. */
  update(dt: number, intensity: number): AudioLevels {
    const ctx = this.ctx;
    if (!ctx || !this.analyser) return SILENT;

    // The Shepard phase advances faster as the trip intensifies — the tone
    // climbs harder while never actually going anywhere.
    this.shepardPhase = (this.shepardPhase + dt * (0.012 + intensity * 0.05)) % 1;
    const voices = shepardVoices(this.shepardPhase * this.octaves, this.octaves);
    const now = ctx.currentTime;
    voices.forEach((voice, i) => {
      const node = this.shepard[i];
      if (!node) return;
      node.osc.frequency.setTargetAtTime(voice.freq, now, 0.05);
      node.gain.gain.setTargetAtTime(voice.gain * (0.35 + intensity * 0.65), now, 0.12);
    });

    const [lo, hi] = binauralPair(110 * justRatio(0), beatForIntensity(intensity));
    this.binaural[0]?.osc.frequency.setTargetAtTime(lo, now, 0.2);
    this.binaural[1]?.osc.frequency.setTargetAtTime(hi, now, 0.2);

    this.analyser.getByteFrequencyData(this.spectrum as Uint8Array<ArrayBuffer>);
    this.levels = this.analyseBands();
    return this.levels;
  }

  private analyseBands(): AudioLevels {
    const bins = this.spectrum.length;
    if (bins === 0) return SILENT;
    const band = (from: number, to: number): number => {
      const a = Math.floor(bins * from);
      const b = Math.max(a + 1, Math.floor(bins * to));
      let sum = 0;
      for (let i = a; i < b; i++) sum += this.spectrum[i];
      return clamp(sum / (b - a) / 190);
    };
    const bass = band(0, 0.06);
    const mid = band(0.06, 0.25);
    const treble = band(0.25, 0.7);
    return { bass, mid, treble, level: clamp((bass + mid + treble) / 2.2) };
  }

  /** Ring a pentatonic bell — used when a tab is taken or a preset changes. */
  chime(degreeSeed = 0, intensity = 0.5): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    const degree = PENTATONIC[Math.abs(Math.round(degreeSeed)) % PENTATONIC.length];
    const freq = 220 * justRatio(degree + 12);
    const now = ctx.currentTime;

    for (const [ratio, gainScale] of [[1, 1], [2, 0.4], [3, 0.18]] as const) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq * ratio;
      const gain = ctx.createGain();
      const peak = 0.18 * gainScale * (0.5 + intensity * 0.5);
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(peak, now + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 3.2 / ratio);
      osc.connect(gain);
      gain.connect(master);
      osc.start(now);
      osc.stop(now + 3.4);
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    this.master.gain.setTargetAtTime(muted ? 0 : 0.22, ctx.currentTime, 0.35);
  }

  async dispose(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return;
    for (const { osc } of this.shepard) osc.stop();
    for (const { osc } of this.binaural) osc.stop();
    this.shepard = [];
    this.binaural = [];
    await ctx.close();
    this.ctx = null;
  }
}
