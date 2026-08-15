/**
 * WebGL2 renderer: two programs, one ping-pong pair of float framebuffers.
 *
 *   scene  → FBO[write], sampling FBO[read]   (feedback / infinite regress)
 *   present→ canvas                            (lens, bloom, grain)
 */

import { QUAD_VERT } from './shaders/quad.vert';
import { SCENE_FRAG } from './shaders/scene.frag';
import { PRESENT_FRAG } from './shaders/present.frag';
import { PARAM_KEYS, type TripParams } from '../trip/presets';

export interface RenderInput {
  time: number;
  intensity: number;
  mouse: { x: number; y: number; down: boolean };
  audio: { bass: number; mid: number; treble: number; level: number };
  params: TripParams;
  presetHue: number;
  dissolve: number;
  seed: number;
  sheet: { cols: number; rows: number };
  fade: number;
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('could not create shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? 'unknown error';
    gl.deleteShader(shader);
    throw new Error(`shader compile failed: ${log}`);
  }
  return shader;
}

function link(gl: WebGL2RenderingContext, vertSrc: string, fragSrc: string): WebGLProgram {
  const program = gl.createProgram();
  if (!program) throw new Error('could not create program');
  const vert = compile(gl, gl.VERTEX_SHADER, vertSrc);
  const frag = compile(gl, gl.FRAGMENT_SHADER, fragSrc);
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);
  gl.deleteShader(vert);
  gl.deleteShader(frag);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? 'unknown error';
    gl.deleteProgram(program);
    throw new Error(`program link failed: ${log}`);
  }
  return program;
}

interface Target {
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
}

export class TripRenderer {
  private gl: WebGL2RenderingContext;
  private sceneProgram: WebGLProgram;
  private presentProgram: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private targets: [Target, Target];
  private width = 1;
  private height = 1;
  private paramBuffer = new Float32Array(PARAM_KEYS.length);
  private uniformCache = new Map<string, WebGLUniformLocation | null>();
  /** Render the heavy pass below native resolution; the present pass hides it. */
  readonly renderScale: number;

  constructor(private canvas: HTMLCanvasElement, renderScale = 0.8) {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true, // so the trippiness harness can read pixels back
    });
    if (!gl) throw new Error('WebGL2 is not available in this browser');
    this.gl = gl;
    this.renderScale = renderScale;

    // Half-float targets keep the feedback loop from banding into mud — but
    // only if they can be filtered LINEAR. Sampling the feedback buffer NEAREST
    // is not a cosmetic downgrade: the loop resamples itself with a slight zoom
    // every frame, and nearest-neighbour replication spreads a single texel
    // outward until one flat colour swallows the picture. Where float linear
    // isn't available (software rasterisers, some mobile GPUs), drop to RGBA8
    // and keep LINEAR — banding is survivable, pixel-replication collapse is not.
    const canRenderFloat = !!gl.getExtension('EXT_color_buffer_float');
    const canFilterFloat = !!gl.getExtension('OES_texture_float_linear');
    this.useFloatTargets = canRenderFloat && canFilterFloat;
    this.filter = gl.LINEAR;

    this.sceneProgram = link(gl, QUAD_VERT, SCENE_FRAG);
    this.presentProgram = link(gl, QUAD_VERT, PRESENT_FRAG);

    const vao = gl.createVertexArray();
    if (!vao) throw new Error('could not create VAO');
    this.vao = vao;

    this.targets = [this.createTarget(1, 1), this.createTarget(1, 1)];
    this.resize(canvas.clientWidth || 1, canvas.clientHeight || 1, 1);
  }

  private filter: number;
  private useFloatTargets: boolean;

  private createTarget(width: number, height: number): Target {
    const gl = this.gl;
    const tex = gl.createTexture();
    const fbo = gl.createFramebuffer();
    if (!tex || !fbo) throw new Error('could not allocate render target');
    gl.bindTexture(gl.TEXTURE_2D, tex);
    const internalFormat = this.useFloatTargets ? gl.RGBA16F : gl.RGBA8;
    const type = this.useFloatTargets ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, gl.RGBA, type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, this.filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, this.filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fbo, tex };
  }

  private destroyTarget(target: Target): void {
    this.gl.deleteFramebuffer(target.fbo);
    this.gl.deleteTexture(target.tex);
  }

  /** Resize the canvas backing store and both feedback targets. */
  resize(cssWidth: number, cssHeight: number, dpr: number): void {
    const gl = this.gl;
    const pixelWidth = Math.max(1, Math.floor(cssWidth * dpr));
    const pixelHeight = Math.max(1, Math.floor(cssHeight * dpr));
    this.canvas.width = pixelWidth;
    this.canvas.height = pixelHeight;
    const w = Math.max(1, Math.floor(pixelWidth * this.renderScale));
    const h = Math.max(1, Math.floor(pixelHeight * this.renderScale));
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.targets.forEach(this.destroyTarget, this);
    this.targets = [this.createTarget(w, h), this.createTarget(w, h)];
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  private uniform(program: WebGLProgram, name: string): WebGLUniformLocation | null {
    const key = `${program === this.sceneProgram ? 's' : 'p'}:${name}`;
    let loc = this.uniformCache.get(key);
    if (loc === undefined) {
      loc = this.gl.getUniformLocation(program, name);
      this.uniformCache.set(key, loc);
    }
    return loc;
  }

  private packParams(params: TripParams): Float32Array {
    PARAM_KEYS.forEach((key, i) => { this.paramBuffer[i] = params[key]; });
    return this.paramBuffer;
  }

  render(input: RenderInput): void {
    const gl = this.gl;
    const [read, write] = this.targets;
    const params = this.packParams(input.params);

    gl.bindVertexArray(this.vao);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);

    // ---- scene pass into the write target, sampling the read target ----
    gl.bindFramebuffer(gl.FRAMEBUFFER, write.fbo);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(this.sceneProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, read.tex);
    gl.uniform1i(this.uniform(this.sceneProgram, 'uPrev'), 0);
    gl.uniform2f(this.uniform(this.sceneProgram, 'uRes'), this.width, this.height);
    gl.uniform1f(this.uniform(this.sceneProgram, 'uTime'), input.time);
    gl.uniform1f(this.uniform(this.sceneProgram, 'uIntensity'), input.intensity);
    gl.uniform3f(this.uniform(this.sceneProgram, 'uMouse'), input.mouse.x, input.mouse.y, input.mouse.down ? 1 : 0);
    gl.uniform4f(this.uniform(this.sceneProgram, 'uAudio'), input.audio.bass, input.audio.mid, input.audio.treble, input.audio.level);
    gl.uniform1fv(this.uniform(this.sceneProgram, 'uParams'), params);
    gl.uniform1f(this.uniform(this.sceneProgram, 'uPresetHue'), input.presetHue);
    gl.uniform1f(this.uniform(this.sceneProgram, 'uDissolve'), input.dissolve);
    gl.uniform1f(this.uniform(this.sceneProgram, 'uSeed'), input.seed);
    gl.uniform2f(this.uniform(this.sceneProgram, 'uSheet'), input.sheet.cols, input.sheet.rows);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // ---- present pass to the canvas ----
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.presentProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, write.tex);
    gl.uniform1i(this.uniform(this.presentProgram, 'uScene'), 0);
    gl.uniform2f(this.uniform(this.presentProgram, 'uRes'), this.canvas.width, this.canvas.height);
    gl.uniform1f(this.uniform(this.presentProgram, 'uTime'), input.time);
    gl.uniform1f(this.uniform(this.presentProgram, 'uIntensity'), input.intensity);
    gl.uniform1fv(this.uniform(this.presentProgram, 'uParams'), params);
    gl.uniform1f(this.uniform(this.presentProgram, 'uFade'), input.fade);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // swap
    this.targets = [write, read];
  }

  dispose(): void {
    this.targets.forEach(this.destroyTarget, this);
    this.gl.deleteProgram(this.sceneProgram);
    this.gl.deleteProgram(this.presentProgram);
    this.gl.deleteVertexArray(this.vao);
    this.uniformCache.clear();
  }
}
