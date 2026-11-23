/**
 * GLSL ES 3.00 shaders for the studio WebGL2 renderer:
 * - Coverage pass (4x4 / 2x2 fixed-grid supersampled R8 + stencil)
 * - Coverage composite pass (4-tap GL_LINEAR for 4x4, 1-tap for 2x2, native 1x1 texelFetch)
 * - Layer blit / onion-skin source-in tint pass
 * - Lazy-compiled 15-mode W3C Compositing & Blending Level 1 ping-pong pass
 * - Stage presentation pass (rotated/clipped paper + sheet + procedural difference pixel grid)
 */

import { BLEND_MODES, type BlendMode } from '../../format/types';

/** Integer shader id for each W3C BlendMode (matching BLEND_MODES order). */
export function blendModeId(mode: BlendMode): number {
  return BLEND_MODES.indexOf(mode);
}

/** Parses `#rrggbb` into normalized `[r, g, b]` in `0..1`. */
export function parseHexRgb(hex: string): [number, number, number] {
  const s = hex.startsWith('#') ? hex.slice(1) : hex;
  if (s.length !== 6) return [0, 0, 0];
  return [
    parseInt(s.slice(0, 2), 16) / 255,
    parseInt(s.slice(2, 4), 16) / 255,
    parseInt(s.slice(4, 6), 16) / 255,
  ];
}

/**
 * Coverage vertex shader.
 * Attributes:
 *   aPos (loc 0): document-space (x, y)
 *   aSlot (loc 1): atlas logical offset `(atlasX - sheetMinX, atlasY - sheetMinY)`
 *   aMatIndex (loc 2): `0.0` (view matrix) or `1.0` (view * lasso place matrix)
 *
 * Offscreen FBOs keep top-down coordinates (`sy = 0` at texture row 0), so
 * NDC is `(phys / atlasPhys) * 2.0 - 1.0` with no Y flip.
 */
export const COVERAGE_VS = `#version 300 es
layout(location = 0) in vec2 aPos;
layout(location = 1) in vec2 aSlot;
layout(location = 2) in float aMatIndex;

uniform mat3 uMatrices[2];
uniform float uSupersample;
uniform float uAtlasPhys;

void main() {
  int idx = aMatIndex > 0.5 ? 1 : 0;
  vec3 sheet = uMatrices[idx] * vec3(aPos, 1.0);
  vec2 atlasPhys = (sheet.xy + aSlot) * uSupersample;
  vec2 ndc = (atlasPhys / uAtlasPhys) * 2.0 - 1.0;
  gl_Position = vec4(ndc, 0.0, 1.0);
}`;

export const COVERAGE_FS = `#version 300 es
precision mediump float;
out vec4 oColor;
void main() {
  oColor = vec4(1.0);
}`;

/**
 * Coverage cover-quad shader (operates directly in atlas physical pixels for
 * stencil-then-cover cover quads so cover quads never need matrix transforms).
 */
export const COVER_QUAD_VS = `#version 300 es
layout(location = 0) in vec2 aPhysPos;
uniform float uAtlasPhys;
void main() {
  vec2 ndc = (aPhysPos / uAtlasPhys) * 2.0 - 1.0;
  gl_Position = vec4(ndc, 0.0, 1.0);
}`;

/**
 * Composite shader: draws one or more slot quads onto a 1x sheet RGBA8 FBO,
 * sampling either the 4x4 SSAA atlas (4 GL_LINEAR taps), 2x2 SSAA atlas
 * (1 GL_LINEAR tap), or a native 1x1 reference mask (no resampling).
 *
 * Attributes:
 *   aDstPos (loc 0): destination sheet pixel `(x, y)`
 *   aSrcPos (loc 1): source logical pixel `(x, y)` in atlas / reference mask
 *   aColor (loc 2): straight RGBA `(r, g, b, a)`
 */
export const COMPOSITE_VS = `#version 300 es
layout(location = 0) in vec2 aDstPos;
layout(location = 1) in vec2 aSrcPos;
layout(location = 2) in vec4 aColor;

uniform vec2 uDstSize;

out vec2 vSrcPos;
out vec4 vColor;

void main() {
  vSrcPos = aSrcPos;
  vColor = aColor;
  vec2 ndc = (aDstPos / uDstSize) * 2.0 - 1.0;
  gl_Position = vec4(ndc, 0.0, 1.0);
}`;

export const COMPOSITE_FS = `#version 300 es
precision highp float;

uniform sampler2D uMask;
uniform vec2 uMaskPhysSize;
// 0 = 4x4 fixed-grid (4 bilinear taps), 1 = 2x2 fixed-grid (1 bilinear tap), 2 = native 1x1 (nearest/texelFetch)
uniform int uSampleMode;

in vec2 vSrcPos;
in vec4 vColor;
out vec4 oColor;

void main() {
  float cov;
  if (uSampleMode == 2) {
    ivec2 coord = clamp(ivec2(floor(vSrcPos)), ivec2(0), ivec2(uMaskPhysSize) - ivec2(1));
    cov = texelFetch(uMask, coord, 0).r;
  } else if (uSampleMode == 1) {
    vec2 base = floor(vSrcPos) * 2.0;
    cov = texture(uMask, (base + vec2(1.0, 1.0)) / uMaskPhysSize).r;
  } else {
    vec2 base = floor(vSrcPos) * 4.0;
    vec2 inv = 1.0 / uMaskPhysSize;
    cov = (
      texture(uMask, (base + vec2(1.0, 1.0)) * inv).r +
      texture(uMask, (base + vec2(3.0, 1.0)) * inv).r +
      texture(uMask, (base + vec2(1.0, 3.0)) * inv).r +
      texture(uMask, (base + vec2(3.0, 3.0)) * inv).r
    ) * 0.25;
  }
  float a = cov * vColor.a;
  oColor = vec4(vColor.rgb * a, a);
}`;

/**
 * Fullscreen / sub-rect blit shader for premultiplied RGBA8 layer textures,
 * supporting layer opacity, onion-skin `source-in` tinting, and 1x1 pipette offset.
 */
export const BLIT_VS = `#version 300 es
layout(location = 0) in vec2 aPos;
uniform vec2 uUvOrigin;
uniform vec2 uUvSpan;
out vec2 vUv;
void main() {
  vec2 unit = aPos * 0.5 + 0.5;
  vUv = uUvOrigin + unit * uUvSpan;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

export const BLIT_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform float uAlpha;
uniform int uTintMode;
uniform vec3 uTint;
in vec2 vUv;
out vec4 oColor;
void main() {
  vec4 tex = texture(uTex, vUv);
  if (uTintMode == 1) {
    float a = tex.a * uAlpha;
    oColor = vec4(uTint * a, a);
    return;
  }
  oColor = tex * uAlpha;
}`;

/**
 * W3C Compositing and Blending Level 1 shader (all 15 BlendModes).
 * Lazily compiled only when a document actually shows a blended layer.
 */
export const BLEND_FS = `#version 300 es
precision highp float;

uniform sampler2D uDst;
uniform sampler2D uSrc;
uniform float uOpacity;
uniform int uMode;

in vec2 vUv;
out vec4 oColor;

float lum(vec3 c) {
  return 0.3 * c.r + 0.59 * c.g + 0.11 * c.b;
}

vec3 clipColor(vec3 c) {
  float l = lum(c);
  float n = min(c.r, min(c.g, c.b));
  float x = max(c.r, max(c.g, c.b));
  if (n < 0.0) {
    c = l + ((c - l) * l) / max(1e-6, l - n);
  }
  if (x > 1.0) {
    c = l + ((c - l) * (1.0 - l)) / max(1e-6, x - l);
  }
  return clamp(c, 0.0, 1.0);
}

vec3 setLum(vec3 c, float l) {
  float d = l - lum(c);
  return clipColor(c + vec3(d));
}

float sat(vec3 c) {
  return max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
}

vec3 setSat(vec3 c, float s) {
  float cmin = min(c.r, min(c.g, c.b));
  float cmax = max(c.r, max(c.g, c.b));
  if (cmax <= cmin) return vec3(0.0);
  return ((c - vec3(cmin)) * s) / (cmax - cmin);
}

float colorDodgeChan(float cb, float cs) {
  if (cb <= 0.0) return 0.0;
  if (cs >= 1.0) return 1.0;
  return min(1.0, cb / (1.0 - cs));
}

float colorBurnChan(float cb, float cs) {
  if (cb >= 1.0) return 1.0;
  if (cs <= 0.0) return 0.0;
  return 1.0 - min(1.0, (1.0 - cb) / cs);
}

float hardLightChan(float cb, float cs) {
  return cs <= 0.5 ? (cb * (2.0 * cs)) : (cb + (2.0 * cs - 1.0) - cb * (2.0 * cs - 1.0));
}

float softLightChan(float cb, float cs) {
  if (cs <= 0.5) {
    return cb - (1.0 - 2.0 * cs) * cb * (1.0 - cb);
  }
  float d = cb <= 0.25 ? ((16.0 * cb - 12.0) * cb + 4.0) * cb : sqrt(cb);
  return cb + (2.0 * cs - 1.0) * (d - cb);
}

vec3 blendRgb(vec3 cb, vec3 cs, int mode) {
  if (mode == 0) return cb * cs; // multiply
  if (mode == 1) return vec3(colorBurnChan(cb.r, cs.r), colorBurnChan(cb.g, cs.g), colorBurnChan(cb.b, cs.b)); // color-burn
  if (mode == 2) return min(cb, cs); // darken
  if (mode == 3) return cb + cs - cb * cs; // screen
  if (mode == 4) return vec3(colorDodgeChan(cb.r, cs.r), colorDodgeChan(cb.g, cs.g), colorDodgeChan(cb.b, cs.b)); // color-dodge
  if (mode == 5) return max(cb, cs); // lighten
  if (mode == 6) return vec3(hardLightChan(cs.r, cb.r), hardLightChan(cs.g, cb.g), hardLightChan(cs.b, cb.b)); // overlay
  if (mode == 7) return vec3(softLightChan(cb.r, cs.r), softLightChan(cb.g, cs.g), softLightChan(cb.b, cs.b)); // soft-light
  if (mode == 8) return vec3(hardLightChan(cb.r, cs.r), hardLightChan(cb.g, cs.g), hardLightChan(cb.b, cs.b)); // hard-light
  if (mode == 9) return abs(cb - cs); // difference
  if (mode == 10) return cb + cs - 2.0 * cb * cs; // exclusion
  if (mode == 11) return setLum(setSat(cs, sat(cb)), lum(cb)); // hue
  if (mode == 12) return setLum(setSat(cb, sat(cs)), lum(cb)); // saturation
  if (mode == 13) return setLum(cs, lum(cb)); // color
  if (mode == 14) return setLum(cb, lum(cs)); // luminosity
  return cs;
}

void main() {
  vec4 dst = texture(uDst, vUv);
  vec4 src = texture(uSrc, vUv);
  float sa = src.a * uOpacity;
  if (sa <= 0.0) {
    oColor = dst;
    return;
  }
  vec3 cs = src.a > 0.0 ? clamp(src.rgb / src.a, 0.0, 1.0) : vec3(0.0);
  if (dst.a <= 0.0) {
    oColor = vec4(cs * sa, sa);
    return;
  }
  vec3 cb = clamp(dst.rgb / dst.a, 0.0, 1.0);
  vec3 blended = blendRgb(cb, cs, uMode);
  float outA = sa + dst.a * (1.0 - sa);
  vec3 outPremul = sa * (1.0 - dst.a) * cs + (1.0 - sa) * dst.rgb + sa * dst.a * blended;
  oColor = vec4(clamp(outPremul, 0.0, 1.0), clamp(outA, 0.0, 1.0));
}`;

/**
 * Stage presentation shader (draws onto the default onscreen framebuffer, which
 * flips Y so stage pixel y=0 sits at the top of the canvas).
 *
 * Draws the rotated/clipped paper + premultiplied sheet texture, and when
 * `uGridStep >= 4.0`, overlays the exact `#303030` `difference` pixel grid.
 */
export const PRESENT_VS = `#version 300 es
layout(location = 0) in vec2 aUnit; // [0..1] x [0..1] sheet quad

uniform vec2 uStageSize;
uniform vec2 uSheetOrigin;
uniform vec2 uSheetSize;
uniform vec2 uCosSin; // (cos(angle), sin(angle))

out vec2 vUv;
out vec2 vSheetPx;

void main() {
  vUv = aUnit;
  vec2 local = aUnit * uSheetSize;
  vSheetPx = local;
  vec2 rot = vec2(
    uCosSin.x * local.x - uCosSin.y * local.y,
    uCosSin.y * local.x + uCosSin.x * local.y
  );
  vec2 stage = uSheetOrigin + rot;
  vec2 ndc = vec2(
    (stage.x / uStageSize.x) * 2.0 - 1.0,
    1.0 - (stage.y / uStageSize.y) * 2.0
  );
  gl_Position = vec4(ndc, 0.0, 1.0);
}`;

export const PRESENT_FS = `#version 300 es
precision highp float;

uniform sampler2D uSheet;
uniform vec3 uPaper;
uniform vec2 uSheetOrigin;
uniform float uGridStep;

in vec2 vUv;
in vec2 vSheetPx;
out vec4 oColor;

void main() {
  vec4 fg = texture(uSheet, vUv);
  vec3 rgb = fg.rgb + uPaper * (1.0 - fg.a);
  if (uGridStep >= 4.0) {
    // Anchor grid lines at k * uGridStep in sheet coordinates and snap each line
    // to stage pixel centers identically to CanvasView.svelte drawPixelGrid:
    // crisp(at, origin) = round(origin + at) + 0.5 - origin.
    float kx = max(0.0, floor(vSheetPx.x / uGridStep + 0.5));
    float ky = max(0.0, floor(vSheetPx.y / uGridStep + 0.5));
    float lineX = floor(uSheetOrigin.x + kx * uGridStep + 0.5) + 0.5 - uSheetOrigin.x;
    float lineY = floor(uSheetOrigin.y + ky * uGridStep + 0.5) + 0.5 - uSheetOrigin.y;
    if (abs(vSheetPx.x - lineX) < 0.5 || abs(vSheetPx.y - lineY) < 0.5) {
      vec3 g = vec3(48.0 / 255.0);
      rgb = abs(rgb - g);
    }
  }
  oColor = vec4(rgb, 1.0);
}`;

export function compileProgram(gl: WebGL2RenderingContext, vsSrc: string, fsSrc: string): WebGLProgram | null {
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
