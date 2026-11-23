import { describe, expect, it } from 'bun:test';
import {
  classifyRenderCapabilities,
  MIN_WEBGL2_DIMENSION,
  runWebGL2SmokeTest,
  validateWebGL2Candidate,
  type ProbeSnapshot,
} from './probe';

describe('WebGL2 eligibility and software-browser classification matrix', () => {
  it('enables WebGL2 and does not flag software browser when strict hardware WebGL2 succeeds', () => {
    const result = classifyRenderCapabilities({
      webgl2: {
        available: true,
        renderer: 'ANGLE (AMD, AMD Radeon RX 6700 XT, D3D11)',
        caveat: false,
        limitsOk: true,
        fboFormats: { color: 'R8', stencil: 'STENCIL_INDEX8' },
        smokeOk: true,
      },
      webgl1: null,
    });
    expect(result).toEqual({
      webgl2Eligible: true,
      isSoftwareBrowser: false,
      reason: 'webgl2',
      fboFormats: { color: 'R8', stencil: 'STENCIL_INDEX8' },
    });
  });

  it('rejects WebGL2 and flags software browser when strict WebGL2 returns named SwiftShader', () => {
    // Headless Chrome can grant a strict WebGL2 context backed by SwiftShader.
    const result = classifyRenderCapabilities({
      webgl2: {
        available: true,
        renderer: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)',
        caveat: false,
        limitsOk: true,
        fboFormats: { color: 'R8', stencil: 'STENCIL_INDEX8' },
        smokeOk: true,
      },
      webgl1: null,
    });
    expect(result.webgl2Eligible).toBe(false);
    expect(result.isSoftwareBrowser).toBe(true);
    expect(result.reason).toBe('software-browser');
  });

  it('rejects WebGL2 and flags software browser when strict WebGL2 is refused by caveat', () => {
    const result = classifyRenderCapabilities({
      webgl2: {
        available: false,
        renderer: 'ANGLE (AMD, AMD Radeon R7 Graphics)',
        caveat: true,
        limitsOk: false,
        fboFormats: null,
        smokeOk: false,
      },
      webgl1: null,
    });
    expect(result.webgl2Eligible).toBe(false);
    expect(result.isSoftwareBrowser).toBe(true);
    expect(result.reason).toBe('software-browser');
  });

  it('falls back to Canvas 2D WITHOUT showing the software hint when WebGL2 is missing but hardware WebGL1 works', () => {
    const result = classifyRenderCapabilities({
      webgl2: null,
      webgl1: {
        renderer: 'Apple GPU',
        caveat: false,
      },
    });
    expect(result.webgl2Eligible).toBe(false);
    expect(result.isSoftwareBrowser).toBe(false);
    expect(result.reason).toBe('webgl2-unavailable');
  });

  it('flags software browser when WebGL2 is missing and WebGL1 is missing or software', () => {
    expect(classifyRenderCapabilities({ webgl2: null, webgl1: null })).toMatchObject({
      webgl2Eligible: false,
      isSoftwareBrowser: true,
      reason: 'software-browser',
    });
    expect(
      classifyRenderCapabilities({
        webgl2: null,
        webgl1: { renderer: 'llvmpipe (LLVM 15.0.7, 256 bits)', caveat: false },
      }),
    ).toMatchObject({
      webgl2Eligible: false,
      isSoftwareBrowser: true,
      reason: 'software-browser',
    });
  });

  it('rejects WebGL2 without flagging software browser when hardware limits or smoke test fail', () => {
    const base: ProbeSnapshot['webgl2'] = {
      available: true,
      renderer: 'Intel(R) UHD Graphics 620',
      caveat: false,
      limitsOk: false,
      fboFormats: { color: 'R8', stencil: 'STENCIL_INDEX8' },
      smokeOk: true,
    };
    expect(classifyRenderCapabilities({ webgl2: base, webgl1: null })).toMatchObject({
      webgl2Eligible: false,
      isSoftwareBrowser: false,
      reason: 'webgl2-unavailable',
    });
    expect(
      classifyRenderCapabilities({
        webgl2: { ...base, limitsOk: true, smokeOk: false },
        webgl1: null,
      }),
    ).toMatchObject({
      webgl2Eligible: false,
      isSoftwareBrowser: false,
      reason: 'webgl2-unavailable',
    });
  });

  it('recognizes lavapipe as software rendering', () => {
    const result = classifyRenderCapabilities({
      webgl2: {
        available: true,
        renderer: 'Mesa Intel/lavapipe (LLVM 17.0.6)',
        caveat: false,
        limitsOk: true,
        fboFormats: { color: 'R8', stencil: 'STENCIL_INDEX8' },
        smokeOk: true,
      },
      webgl1: null,
    });
    expect(result.webgl2Eligible).toBe(false);
    expect(result.isSoftwareBrowser).toBe(true);
  });
});

describe('candidate WebGL2 context validation and 16x16 smoke test', () => {
  function fakeGl(overrides: Partial<Record<string, unknown>> = {}) {
    const constants = {
      RENDERER: 0x1f01,
      MAX_TEXTURE_SIZE: 0x0d33,
      MAX_RENDERBUFFER_SIZE: 0x84e8,
      MAX_VIEWPORT_DIMS: 0x0d3a,
      FRAMEBUFFER: 0x8d40,
      RENDERBUFFER: 0x8d41,
      TEXTURE_2D: 0x0de1,
      COLOR_ATTACHMENT0: 0x8ce0,
      STENCIL_ATTACHMENT: 0x8d20,
      DEPTH_STENCIL_ATTACHMENT: 0x821a,
      FRAMEBUFFER_COMPLETE: 0x8cd5,
      R8: 0x8229,
      RGBA8: 0x8058,
      RED: 0x1903,
      RGBA: 0x1908,
      UNSIGNED_BYTE: 0x1401,
      STENCIL_INDEX8: 0x8d48,
      DEPTH24_STENCIL8: 0x88f0,
      NO_ERROR: 0,
      TEXTURE_MIN_FILTER: 0x2801,
      TEXTURE_MAG_FILTER: 0x2800,
      TEXTURE_WRAP_S: 0x2802,
      TEXTURE_WRAP_T: 0x2803,
      LINEAR: 0x2601,
      NEAREST: 0x2600,
      CLAMP_TO_EDGE: 0x812f,
      VERTEX_SHADER: 0x8b31,
      FRAGMENT_SHADER: 0x8b30,
      COMPILE_STATUS: 0x8b81,
      LINK_STATUS: 0x8b82,
      ARRAY_BUFFER: 0x8892,
      STATIC_DRAW: 0x88e4,
      FLOAT: 0x1406,
      TRIANGLES: 0x0004,
      STENCIL_TEST: 0x0b90,
      BLEND: 0x0be2,
      CULL_FACE: 0x0b44,
      DEPTH_TEST: 0x0b71,
      SCISSOR_TEST: 0x0c11,
      COLOR_BUFFER_BIT: 0x4000,
      STENCIL_BUFFER_BIT: 0x0400,
      ALWAYS: 0x0207,
      NOTEQUAL: 0x0205,
      KEEP: 0x1e00,
      INCR_WRAP: 0x8507,
      DECR_WRAP: 0x8508,
      FRONT: 0x0404,
      BACK: 0x0405,
    };
    const gl: Record<string, unknown> = {
      ...constants,
      isContextLost: () => false,
      getExtension: (name: string) =>
        name === 'WEBGL_debug_renderer_info' ? { UNMASKED_RENDERER_WEBGL: 0x9246 } : null,
      getParameter: (p: number) => {
        if (p === 0x9246 || p === constants.RENDERER) return 'ANGLE (NVIDIA GeForce RTX 3060)';
        if (p === constants.MAX_TEXTURE_SIZE) return 4096;
        if (p === constants.MAX_RENDERBUFFER_SIZE) return 4096;
        if (p === constants.MAX_VIEWPORT_DIMS) return new Int32Array([4096, 4096]);
        return 0;
      },
      createFramebuffer: () => ({}),
      bindFramebuffer: () => {},
      deleteFramebuffer: () => {},
      createTexture: () => ({}),
      bindTexture: () => {},
      texParameteri: () => {},
      texImage2D: () => {},
      framebufferTexture2D: () => {},
      deleteTexture: () => {},
      createRenderbuffer: () => ({}),
      bindRenderbuffer: () => {},
      renderbufferStorage: () => {},
      framebufferRenderbuffer: () => {},
      deleteRenderbuffer: () => {},
      checkFramebufferStatus: () => constants.FRAMEBUFFER_COMPLETE,
      createShader: () => ({}),
      shaderSource: () => {},
      compileShader: () => {},
      getShaderParameter: () => true,
      deleteShader: () => {},
      createProgram: () => ({}),
      attachShader: () => {},
      linkProgram: () => {},
      getProgramParameter: () => true,
      useProgram: () => {},
      deleteProgram: () => {},
      getUniformLocation: () => ({}),
      getAttribLocation: () => 0,
      uniform1i: () => {},
      uniform2f: () => {},
      createBuffer: () => ({}),
      bindBuffer: () => {},
      bufferData: () => {},
      deleteBuffer: () => {},
      enableVertexAttribArray: () => {},
      vertexAttribPointer: () => {},
      disableVertexAttribArray: () => {},
      viewport: () => {},
      disable: () => {},
      enable: () => {},
      colorMask: () => {},
      stencilMask: () => {},
      stencilFunc: () => {},
      stencilOpSeparate: () => {},
      stencilOp: () => {},
      clearColor: () => {},
      clearStencil: () => {},
      clear: () => {},
      drawArrays: () => {},
      activeTexture: () => {},
      TEXTURE0: 0x84c0,
      readPixels: (_x: number, _y: number, w: number, h: number, _fmt: number, _type: number, out: Uint8Array) => {
        // Fill inside corner (2, 2) opaque red, outside corner (14, 14) transparent 0.
        out.fill(0);
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            if (x + y < 12) {
              const i = (y * w + x) * 4;
              out[i] = 255;
              out[i + 3] = 255;
            }
          }
        }
      },
      getError: () => constants.NO_ERROR,
      ...overrides,
    };
    return gl as unknown as WebGL2RenderingContext;
  }

  it('passes smoke test and preserves the exact validated context without losing it', () => {
    let lost = false;
    const gl = fakeGl({
      getExtension: (name: string) => {
        if (name === 'WEBGL_debug_renderer_info') return { UNMASKED_RENDERER_WEBGL: 0x9246 };
        if (name === 'WEBGL_lose_context') return { loseContext: () => { lost = true; } };
        return null;
      },
    });
    expect(runWebGL2SmokeTest(gl, { color: 'R8', stencil: 'STENCIL_INDEX8' })).toBe(true);
    const validated = validateWebGL2Candidate(gl, MIN_WEBGL2_DIMENSION);
    expect(validated.ok).toBe(true);
    expect(validated.fboFormats).toEqual({ color: 'R8', stencil: 'STENCIL_INDEX8' });
    expect(lost).toBe(false);
  });

  it('falls back from R8+STENCIL_INDEX8 to RGBA8+DEPTH24_STENCIL8 when needed', () => {
    let colorFmt = 0;
    let stencilFmt = 0;
    const gl = fakeGl({
      texImage2D: (_t: number, _l: number, internalformat: number) => {
        if (internalformat === 0x8229 || internalformat === 0x8058) colorFmt = internalformat;
      },
      renderbufferStorage: (_t: number, internalformat: number) => {
        stencilFmt = internalformat;
      },
      checkFramebufferStatus: () => (colorFmt === 0x8058 && stencilFmt === 0x88f0 ? 0x8cd5 : 0x8cd6),
    });
    const validated = validateWebGL2Candidate(gl, MIN_WEBGL2_DIMENSION);
    expect(validated.ok).toBe(true);
    expect(validated.fboFormats).toEqual({ color: 'RGBA8', stencil: 'DEPTH24_STENCIL8' });
  });

  it('fails smoke test when readback is blank or GL reports an error', () => {
    const blank = fakeGl({
      readPixels: (_x: number, _y: number, _w: number, _h: number, _f: number, _t: number, out: Uint8Array) => out.fill(0),
    });
    expect(runWebGL2SmokeTest(blank, { color: 'R8', stencil: 'STENCIL_INDEX8' })).toBe(false);

    const errored = fakeGl({ getError: () => 0x0505 });
    expect(runWebGL2SmokeTest(errored, { color: 'R8', stencil: 'STENCIL_INDEX8' })).toBe(false);
  });

  it('rejects candidate when MAX_TEXTURE_SIZE is below required dimension', () => {
    const small = fakeGl({
      getParameter: (p: number) => {
        if (p === 0x9246 || p === 0x1f01) return 'Mali-400';
        if (p === 0x0d33) return 1024;
        if (p === 0x84e8) return 4096;
        if (p === 0x0d3a) return new Int32Array([4096, 4096]);
        return 0;
      },
    });
    expect(validateWebGL2Candidate(small, 2048).ok).toBe(false);
  });
});
