/**
 * WebGL2 candidate validation, 16x16 stencil+composite smoke test, and unified
 * eligibility / software-browser classification.
 *
 * The canvas that passes validation is promoted directly into studio rendering:
 * we never call WEBGL_lose_context on a passing candidate.
 */

import { drawsInSoftware, isSoftwareRendererName } from '../../ui/software-render';

/** Minimum texture, renderbuffer, and viewport dimension accepted for WebGL2. */
export const MIN_WEBGL2_DIMENSION = 2048;

export type AtlasColorFormat = 'R8' | 'RGBA8';
export type AtlasStencilFormat = 'STENCIL_INDEX8' | 'DEPTH24_STENCIL8';

export interface AtlasFormats {
  readonly color: AtlasColorFormat;
  readonly stencil: AtlasStencilFormat;
}

export type RenderBackendKind = 'webgl2' | 'canvas2d';

export type RenderBackendReason =
  | 'webgl2'
  | 'disabled'
  | 'software-browser'
  | 'webgl2-unavailable'
  | 'raster-layers'
  | 'budget-exceeded'
  | 'oom'
  | 'context-lost';

export interface RenderBackendStatus {
  readonly active: RenderBackendKind;
  readonly reason: RenderBackendReason;
  readonly isSoftwareBrowser: boolean;
}

export interface WebGL2CandidateProbe {
  readonly available: boolean;
  readonly renderer: string | null;
  readonly caveat: boolean;
  readonly limitsOk: boolean;
  readonly fboFormats: AtlasFormats | null;
  readonly smokeOk: boolean;
}

export interface WebGL1SoftwareProbe {
  readonly renderer: string | null;
  readonly caveat: boolean;
}

export interface ProbeSnapshot {
  readonly webgl2: WebGL2CandidateProbe | null;
  readonly webgl1: WebGL1SoftwareProbe | null;
}

export interface RenderCapabilityResult {
  readonly webgl2Eligible: boolean;
  readonly isSoftwareBrowser: boolean;
  readonly reason: 'webgl2' | 'software-browser' | 'webgl2-unavailable';
  readonly fboFormats: AtlasFormats | null;
}

/**
 * Pure classification matrix for WebGL2 eligibility and the one-time
 * `editor.software_render_hint` popup.
 *
 * - Named software renderer (SwiftShader/llvmpipe/lavapipe/Basic Render) or
 *   major performance caveat from WebGL2 directly flags `isSoftwareBrowser`.
 * - Missing WebGL2 falls back to WebGL1 classification: hardware WebGL1 keeps
 *   `isSoftwareBrowser = false` so users on older GPUs do not get a misleading
 *   "enable hardware acceleration" warning.
 * - Hardware WebGL2 that fails limits, FBO formats, or smoke test falls back
 *   silently to Canvas 2D without flagging `isSoftwareBrowser`.
 */
export function classifyRenderCapabilities(snapshot: ProbeSnapshot): RenderCapabilityResult {
  const gl2 = snapshot.webgl2;
  if (gl2 === null) {
    const gl1 = snapshot.webgl1;
    const isSoftwareBrowser = gl1 === null || drawsInSoftware(gl1.renderer, gl1.caveat);
    return {
      webgl2Eligible: false,
      isSoftwareBrowser,
      reason: isSoftwareBrowser ? 'software-browser' : 'webgl2-unavailable',
      fboFormats: null,
    };
  }
  if (gl2.caveat || isSoftwareRendererName(gl2.renderer) || (!gl2.available && gl2.renderer === null)) {
    return {
      webgl2Eligible: false,
      isSoftwareBrowser: true,
      reason: 'software-browser',
      fboFormats: null,
    };
  }
  if (!gl2.available || !gl2.limitsOk || !gl2.fboFormats || !gl2.smokeOk) {
    return {
      webgl2Eligible: false,
      isSoftwareBrowser: false,
      reason: 'webgl2-unavailable',
      fboFormats: null,
    };
  }
  return {
    webgl2Eligible: true,
    isSoftwareBrowser: false,
    reason: 'webgl2',
    fboFormats: gl2.fboFormats,
  };
}

/** Reads the unmasked WebGL renderer string when exposed, else gl.RENDERER. */
export function readRendererName(gl: WebGLRenderingContext | WebGL2RenderingContext): string {
  try {
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    return String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
  } catch {
    return '';
  }
}

/** Checks texture, renderbuffer, and viewport limits against `minDim`. */
export function checkWebGL2Limits(gl: WebGL2RenderingContext, minDim = MIN_WEBGL2_DIMENSION): boolean {
  try {
    const maxTex = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 0;
    const maxRb = Number(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE)) || 0;
    const vp = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as ArrayLike<number> | null;
    const vpW = vp ? Number(vp[0]) || 0 : 0;
    const vpH = vp ? Number(vp[1]) || 0 : 0;
    return maxTex >= minDim && maxRb >= minDim && vpW >= minDim && vpH >= minDim;
  } catch {
    return false;
  }
}

const FORMAT_PAIRS: readonly AtlasFormats[] = [
  { color: 'R8', stencil: 'STENCIL_INDEX8' },
  { color: 'R8', stencil: 'DEPTH24_STENCIL8' },
  { color: 'RGBA8', stencil: 'STENCIL_INDEX8' },
  { color: 'RGBA8', stencil: 'DEPTH24_STENCIL8' },
];

/** Selects the lightest complete color+stencil FBO attachment pair on `gl`. */
export function negotiateAtlasFormats(gl: WebGL2RenderingContext): AtlasFormats | null {
  const fbo = gl.createFramebuffer();
  const tex = gl.createTexture();
  const rb = gl.createRenderbuffer();
  if (!fbo || !tex || !rb) {
    if (fbo) gl.deleteFramebuffer(fbo);
    if (tex) gl.deleteTexture(tex);
    if (rb) gl.deleteRenderbuffer(rb);
    return null;
  }
  try {
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindRenderbuffer(gl.RENDERBUFFER, rb);

    for (const pair of FORMAT_PAIRS) {
      const internal = pair.color === 'R8' ? gl.R8 : gl.RGBA8;
      const format = pair.color === 'R8' ? gl.RED : gl.RGBA;
      const rbInternal = pair.stencil === 'STENCIL_INDEX8' ? gl.STENCIL_INDEX8 : gl.DEPTH24_STENCIL8;
      const attachment = pair.stencil === 'STENCIL_INDEX8' ? gl.STENCIL_ATTACHMENT : gl.DEPTH_STENCIL_ATTACHMENT;

      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.STENCIL_ATTACHMENT, gl.RENDERBUFFER, null);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, null);
      gl.texImage2D(gl.TEXTURE_2D, 0, internal, 16, 16, 0, format, gl.UNSIGNED_BYTE, null);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.renderbufferStorage(gl.RENDERBUFFER, rbInternal, 16, 16);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, attachment, gl.RENDERBUFFER, rb);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE && gl.getError() === gl.NO_ERROR) {
        return pair;
      }
      // Drain any error from a rejected format pair before trying the next.
      while (gl.getError() !== gl.NO_ERROR) {
        /* drain */
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
    gl.deleteFramebuffer(fbo);
    gl.deleteTexture(tex);
    gl.deleteRenderbuffer(rb);
  }
}

const SMOKE_VS = `#version 300 es
in vec2 aPos;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const SMOKE_COV_FS = `#version 300 es
precision mediump float;
out vec4 oColor;
void main() {
  oColor = vec4(1.0);
}`;

const SMOKE_COMP_VS = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const SMOKE_COMP_FS = `#version 300 es
precision mediump float;
uniform sampler2D uAtlas;
uniform vec2 uTexel;
in vec2 vUv;
out vec4 oColor;
void main() {
  vec2 c = (floor(vUv * 16.0) * 4.0);
  float a = (
    texture(uAtlas, (c + vec2(1.0, 1.0)) * uTexel).r +
    texture(uAtlas, (c + vec2(3.0, 1.0)) * uTexel).r +
    texture(uAtlas, (c + vec2(1.0, 3.0)) * uTexel).r +
    texture(uAtlas, (c + vec2(3.0, 3.0)) * uTexel).r
  ) * 0.25;
  oColor = vec4(a, 0.0, 0.0, a);
}`;

function compileSmokeProgram(gl: WebGL2RenderingContext, vsSrc: string, fsSrc: string): WebGLProgram | null {
  const vs = gl.createShader(gl.VERTEX_SHADER);
  const fs = gl.createShader(gl.FRAGMENT_SHADER);
  const prog = gl.createProgram();
  if (!vs || !fs || !prog) {
    if (vs) gl.deleteShader(vs);
    if (fs) gl.deleteShader(fs);
    if (prog) gl.deleteProgram(prog);
    return null;
  }
  gl.shaderSource(vs, vsSrc);
  gl.compileShader(vs);
  gl.shaderSource(fs, fsSrc);
  gl.compileShader(fs);
  if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS) || !gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    gl.deleteProgram(prog);
    return null;
  }
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    gl.deleteProgram(prog);
    return null;
  }
  return prog;
}

/**
 * 16x16 stencil-then-cover -> 4-tap GL_LINEAR composite -> readPixels smoke
 * test verifying that stencil winding, R8/RGBA8 filtering, and FBO compositing
 * actually produce pixels on this driver.
 */
export function runWebGL2SmokeTest(gl: WebGL2RenderingContext, formats: AtlasFormats): boolean {
  const covProg = compileSmokeProgram(gl, SMOKE_VS, SMOKE_COV_FS);
  const compProg = compileSmokeProgram(gl, SMOKE_COMP_VS, SMOKE_COMP_FS);
  const atlasFbo = gl.createFramebuffer();
  const atlasTex = gl.createTexture();
  const atlasRb = gl.createRenderbuffer();
  const dstFbo = gl.createFramebuffer();
  const dstTex = gl.createTexture();
  const vbo = gl.createBuffer();
  if (!covProg || !compProg || !atlasFbo || !atlasTex || !atlasRb || !dstFbo || !dstTex || !vbo) {
    if (covProg) gl.deleteProgram(covProg);
    if (compProg) gl.deleteProgram(compProg);
    if (atlasFbo) gl.deleteFramebuffer(atlasFbo);
    if (atlasTex) gl.deleteTexture(atlasTex);
    if (atlasRb) gl.deleteRenderbuffer(atlasRb);
    if (dstFbo) gl.deleteFramebuffer(dstFbo);
    if (dstTex) gl.deleteTexture(dstTex);
    if (vbo) gl.deleteBuffer(vbo);
    return false;
  }
  try {
    const internal = formats.color === 'R8' ? gl.R8 : gl.RGBA8;
    const format = formats.color === 'R8' ? gl.RED : gl.RGBA;
    const rbInternal = formats.stencil === 'STENCIL_INDEX8' ? gl.STENCIL_INDEX8 : gl.DEPTH24_STENCIL8;
    const attachment = formats.stencil === 'STENCIL_INDEX8' ? gl.STENCIL_ATTACHMENT : gl.DEPTH_STENCIL_ATTACHMENT;

    gl.bindTexture(gl.TEXTURE_2D, atlasTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, 64, 64, 0, format, gl.UNSIGNED_BYTE, null);

    gl.bindRenderbuffer(gl.RENDERBUFFER, atlasRb);
    gl.renderbufferStorage(gl.RENDERBUFFER, rbInternal, 64, 64);

    gl.bindFramebuffer(gl.FRAMEBUFFER, atlasFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, atlasTex, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, attachment, gl.RENDERBUFFER, atlasRb);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      return false;
    }

    gl.bindTexture(gl.TEXTURE_2D, dstTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 16, 16, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

    gl.bindFramebuffer(gl.FRAMEBUFFER, dstFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, dstTex, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      return false;
    }

    // Triangle covering lower-left half (x + y < 12 in 16x16 coords) plus fullscreen quad.
    const verts = new Float32Array([
      -1, -1, 0.5, -1, -1, 0.5,
      -1, -1, 1, -1, -1, 1,
      -1, 1, 1, -1, 1, 1,
    ]);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);

    // 1. Stencil-then-cover into 64x64 4x4 SSAA atlas.
    gl.bindFramebuffer(gl.FRAMEBUFFER, atlasFbo);
    gl.viewport(0, 0, 64, 64);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.SCISSOR_TEST);
    gl.enable(gl.STENCIL_TEST);
    gl.colorMask(true, true, true, true);
    gl.stencilMask(0xff);
    gl.clearColor(0, 0, 0, 0);
    gl.clearStencil(0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);

    gl.useProgram(covProg);
    const covLoc = gl.getAttribLocation(covProg, 'aPos');
    if (covLoc < 0) return false;
    gl.enableVertexAttribArray(covLoc);
    gl.vertexAttribPointer(covLoc, 2, gl.FLOAT, false, 0, 0);

    gl.colorMask(false, false, false, false);
    gl.stencilFunc(gl.ALWAYS, 0, 0xff);
    gl.stencilOpSeparate(gl.FRONT, gl.KEEP, gl.KEEP, gl.INCR_WRAP);
    gl.stencilOpSeparate(gl.BACK, gl.KEEP, gl.KEEP, gl.DECR_WRAP);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.colorMask(true, true, true, true);
    gl.stencilFunc(gl.NOTEQUAL, 0, 0xff);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
    gl.drawArrays(gl.TRIANGLES, 3, 6);
    gl.disableVertexAttribArray(covLoc);

    // 2. 4-tap GL_LINEAR composite into 16x16 RGBA8 target.
    gl.bindFramebuffer(gl.FRAMEBUFFER, dstFbo);
    gl.viewport(0, 0, 16, 16);
    gl.disable(gl.STENCIL_TEST);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(compProg);
    const compLoc = gl.getAttribLocation(compProg, 'aPos');
    if (compLoc < 0) return false;
    gl.enableVertexAttribArray(compLoc);
    gl.vertexAttribPointer(compLoc, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, atlasTex);
    gl.uniform1i(gl.getUniformLocation(compProg, 'uAtlas'), 0);
    gl.uniform2f(gl.getUniformLocation(compProg, 'uTexel'), 1 / 64, 1 / 64);
    gl.drawArrays(gl.TRIANGLES, 3, 6);
    gl.disableVertexAttribArray(compLoc);

    const pixels = new Uint8Array(16 * 16 * 4);
    gl.readPixels(0, 0, 16, 16, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const err = gl.getError();
    if (err !== gl.NO_ERROR) return false;

    const inside = pixels[(2 * 16 + 2) * 4 + 3];
    const outside = pixels[(14 * 16 + 14) * 4 + 3];
    return inside > 200 && outside === 0;
  } catch {
    return false;
  } finally {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.deleteProgram(covProg);
    gl.deleteProgram(compProg);
    gl.deleteFramebuffer(atlasFbo);
    gl.deleteTexture(atlasTex);
    gl.deleteRenderbuffer(atlasRb);
    gl.deleteFramebuffer(dstFbo);
    gl.deleteTexture(dstTex);
    gl.deleteBuffer(vbo);
  }
}

export interface ValidatedCandidate {
  readonly ok: boolean;
  readonly renderer: string;
  readonly limitsOk: boolean;
  readonly fboFormats: AtlasFormats | null;
  readonly smokeOk: boolean;
}

/**
 * Validates an already-created strict WebGL2 candidate context in place.
 * Never loses or destroys the context so the caller can promote it directly.
 */
export function validateWebGL2Candidate(
  gl: WebGL2RenderingContext,
  minDim = MIN_WEBGL2_DIMENSION,
): ValidatedCandidate {
  const renderer = readRendererName(gl);
  if (gl.isContextLost() || isSoftwareRendererName(renderer)) {
    return { ok: false, renderer, limitsOk: false, fboFormats: null, smokeOk: false };
  }
  const limitsOk = checkWebGL2Limits(gl, minDim);
  if (!limitsOk) {
    return { ok: false, renderer, limitsOk: false, fboFormats: null, smokeOk: false };
  }
  const fboFormats = negotiateAtlasFormats(gl);
  if (!fboFormats) {
    return { ok: false, renderer, limitsOk: true, fboFormats: null, smokeOk: false };
  }
  const smokeOk = runWebGL2SmokeTest(gl, fboFormats);
  return { ok: smokeOk, renderer, limitsOk: true, fboFormats, smokeOk };
}

/** Context attributes requested for the studio's single WebGL2 canvas. */
export const WEBGL2_CONTEXT_ATTRIBUTES: WebGLContextAttributes = {
  alpha: true,
  premultipliedAlpha: true,
  antialias: false,
  depth: false,
  stencil: false,
  preserveDrawingBuffer: false,
  failIfMajorPerformanceCaveat: true,
};

/**
 * Probes WebGL1 solely to distinguish "browser has no hardware GPU" from
 * "hardware GPU exists but WebGL2 is unavailable". Immediately releases its
 * temporary context.
 */
export function probeWebGL1Software(): WebGL1SoftwareProbe | null {
  if (typeof document === 'undefined') return null;
  const take = (attrs?: WebGLContextAttributes): WebGLRenderingContext | null => {
    try {
      return document.createElement('canvas').getContext('webgl', attrs) as WebGLRenderingContext | null;
    } catch {
      return null;
    }
  };
  const lose = (ctx: WebGLRenderingContext | null): void => {
    ctx?.getExtension('WEBGL_lose_context')?.loseContext();
  };
  const gl = take();
  if (!gl) return null;
  const renderer = readRendererName(gl);
  lose(gl);
  const strict = take({ failIfMajorPerformanceCaveat: true });
  const caveat = strict === null;
  lose(strict);
  return { renderer, caveat };
}

export interface AcquireWebGL2Result {
  readonly gl: WebGL2RenderingContext | null;
  readonly capability: RenderCapabilityResult;
}

/**
 * Attempts to acquire and validate a hardware WebGL2 context directly on
 * `canvas`. On success, returns that exact context promoted for live use; on
 * failure, releases any rejected context and classifies whether the browser
 * draws in software.
 */
export function acquireStudioWebGL2(
  canvas: HTMLCanvasElement,
  minDim = MIN_WEBGL2_DIMENSION,
): AcquireWebGL2Result {
  let gl: WebGL2RenderingContext | null = null;
  try {
    gl = canvas.getContext('webgl2', WEBGL2_CONTEXT_ATTRIBUTES);
  } catch {
    gl = null;
  }
  if (gl) {
    const validated = validateWebGL2Candidate(gl, minDim);
    const capability = classifyRenderCapabilities({
      webgl2: {
        available: true,
        renderer: validated.renderer,
        caveat: false,
        limitsOk: validated.limitsOk,
        fboFormats: validated.fboFormats,
        smokeOk: validated.smokeOk,
      },
      webgl1: null,
    });
    if (capability.webgl2Eligible) {
      return { gl, capability };
    }
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return { gl: null, capability };
  }

  // Strict WebGL2 returned null: distinguish performance-caveat refusal from
  // missing WebGL2 (e.g. older hardware WebGL1-only browser).
  let loose: WebGL2RenderingContext | null = null;
  try {
    loose = document.createElement('canvas').getContext('webgl2');
  } catch {
    loose = null;
  }
  if (loose) {
    const renderer = readRendererName(loose);
    loose.getExtension('WEBGL_lose_context')?.loseContext();
    const capability = classifyRenderCapabilities({
      webgl2: {
        available: false,
        renderer,
        caveat: true,
        limitsOk: false,
        fboFormats: null,
        smokeOk: false,
      },
      webgl1: null,
    });
    return { gl: null, capability };
  }

  const webgl1 = probeWebGL1Software();
  const capability = classifyRenderCapabilities({ webgl2: null, webgl1 });
  return { gl: null, capability };
}
