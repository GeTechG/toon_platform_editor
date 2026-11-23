import { describe, expect, it } from 'bun:test';
import { unpremultiplyRgba, WebGL2SheetComposer } from './composer';
import { planAtlasBatches, type AtlasOp } from './atlas';
import { CellCache } from '../cell-cache';
import { CellWarmer } from '../cell-warm';
import type { FrameScene } from '../frame-compose';
import type { StagePresentParams } from '../sheet-composer';
import type { ToonDocument, ToolDescriptor } from '../../format/types';

function createRecordingWebGL2(overrides: Partial<Record<string, unknown>> = {}) {
  const created = {
    programs: 0,
    shaders: 0,
    textures: 0,
    fbos: 0,
    rbos: 0,
    buffers: 0,
  };
  const deleted = {
    programs: 0,
    shaders: 0,
    textures: 0,
    fbos: 0,
    rbos: 0,
    buffers: 0,
  };
  const calls: string[] = [];
  const constants = {
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,
    ARRAY_BUFFER: 0x8892,
    DYNAMIC_DRAW: 0x88e8,
    STATIC_DRAW: 0x88e4,
    FLOAT: 0x1406,
    TRIANGLES: 0x0004,
    TEXTURE_2D: 0x0de1,
    TEXTURE0: 0x84c0,
    TEXTURE1: 0x84c1,
    TEXTURE_MIN_FILTER: 0x2801,
    TEXTURE_MAG_FILTER: 0x2800,
    TEXTURE_WRAP_S: 0x2802,
    TEXTURE_WRAP_T: 0x2803,
    LINEAR: 0x2601,
    NEAREST: 0x2600,
    LINEAR_MIPMAP_LINEAR: 0x2703,
    CLAMP_TO_EDGE: 0x812f,
    FRAMEBUFFER: 0x8d40,
    RENDERBUFFER: 0x8d41,
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
    UNPACK_ALIGNMENT: 0x0cf5,
    BLEND: 0x0be2,
    STENCIL_TEST: 0x0b90,
    CULL_FACE: 0x0b44,
    DEPTH_TEST: 0x0b71,
    SCISSOR_TEST: 0x0c11,
    COLOR_BUFFER_BIT: 0x4000,
    STENCIL_BUFFER_BIT: 0x0400,
    ONE: 1,
    ZERO: 0,
    ONE_MINUS_SRC_ALPHA: 0x0303,
    DST_ALPHA: 0x0304,
    ALWAYS: 0x0207,
    NOTEQUAL: 0x0205,
    KEEP: 0x1e00,
    INCR_WRAP: 0x8507,
    DECR_WRAP: 0x8508,
    FRONT: 0x0404,
    BACK: 0x0405,
    NO_ERROR: 0,
    OUT_OF_MEMORY: 0x0505,
    FUNC_ADD: 0x8006,
  };
  let errorCode = 0;
  let readback: [number, number, number, number] = [64, 32, 16, 128];
  const gl: Record<string, unknown> = {
    ...constants,
    canvas: { width: 1280, height: 720 },
    isContextLost: () => false,
    getExtension: () => null,
    createShader: () => { created.shaders++; return {}; },
    shaderSource: () => {},
    compileShader: () => {},
    getShaderParameter: () => true,
    getShaderInfoLog: () => '',
    deleteShader: () => { deleted.shaders++; },
    createProgram: () => { created.programs++; return {}; },
    attachShader: () => {},
    linkProgram: () => {},
    getProgramParameter: () => true,
    getProgramInfoLog: () => '',
    useProgram: () => {},
    deleteProgram: () => { deleted.programs++; },
    getUniformLocation: (_p: unknown, name: string) => ({ name }),
    getAttribLocation: (_p: unknown, name: string) => (name === 'aPos' ? 0 : name === 'aSlot' ? 1 : 2),
    uniform1i: () => {},
    uniform1f: () => {},
    uniform2f: () => {},
    uniform4f: () => {},
    uniformMatrix3fv: () => {},
    createBuffer: () => { created.buffers++; return {}; },
    bindBuffer: () => {},
    bufferData: () => {},
    bufferSubData: () => {},
    deleteBuffer: () => { deleted.buffers++; },
    enableVertexAttribArray: () => {},
    vertexAttribPointer: () => {},
    disableVertexAttribArray: () => {},
    createTexture: () => { created.textures++; return {}; },
    activeTexture: () => {},
    bindTexture: () => {},
    texParameteri: () => {},
    pixelStorei: () => {},
    texImage2D: () => {},
    texSubImage2D: () => {},
    generateMipmap: () => {},
    deleteTexture: () => { deleted.textures++; },
    createFramebuffer: () => { created.fbos++; return {}; },
    bindFramebuffer: () => {},
    framebufferTexture2D: () => {},
    framebufferRenderbuffer: () => {},
    checkFramebufferStatus: () => constants.FRAMEBUFFER_COMPLETE,
    deleteFramebuffer: () => { deleted.fbos++; },
    createRenderbuffer: () => { created.rbos++; return {}; },
    bindRenderbuffer: () => {},
    renderbufferStorage: () => {},
    deleteRenderbuffer: () => { deleted.rbos++; },
    viewport: () => {},
    scissor: (x: number, y: number, w: number, h: number) => calls.push(`scissor:${x},${y},${w},${h}`),
    enable: (cap: number) => {
      if (cap === constants.SCISSOR_TEST) calls.push('enable:scissor');
      if (cap === constants.STENCIL_TEST) calls.push('enable:stencil');
    },
    disable: (cap: number) => {
      if (cap === constants.SCISSOR_TEST) calls.push('disable:scissor');
    },
    blendFunc: (s: number, d: number) => calls.push(`blend:${s}:${d}`),
    blendEquation: () => {},
    colorMask: () => {},
    stencilMask: () => {},
    stencilFunc: () => {},
    stencilOpSeparate: () => {},
    stencilOp: () => {},
    clearColor: () => {},
    clearStencil: () => {},
    clear: (mask: number) => calls.push(`clear:${mask}`),
    drawArrays: (_m: number, _f: number, count: number) => calls.push(`draw:${count}`),
    readPixels: (_x: number, _y: number, _w: number, _h: number, _f: number, _t: number, out: Uint8Array) => {
      out[0] = readback[0];
      out[1] = readback[1];
      out[2] = readback[2];
      out[3] = readback[3];
    },
    getError: () => {
      const e = errorCode;
      errorCode = 0;
      return e;
    },
    ...overrides,
  };
  return {
    gl: gl as unknown as WebGL2RenderingContext,
    created,
    deleted,
    calls,
    setError(code: number) { errorCode = code; },
    setReadback(rgba: [number, number, number, number]) { readback = rgba; },
  };
}

function simpleDoc(tools: ToolDescriptor[], strokes: { points: number[]; tool_id: number }[]): ToonDocument {
  return {
    schema_version: 8,
    width: 10240,
    height: 5760,
    frame_rate: 12,
    tools,
    layers: [{ hidden: false, frames: [{ strokes }] }],
  };
}

const PRESENT: StagePresentParams = {
  stageWidth: 1280,
  stageHeight: 720,
  sheetX: 0,
  sheetY: 0,
  sheetW: 1280,
  sheetH: 720,
  angle: 0,
  stretch: 1,
  paper: '#ffffff',
  gridStep: 0,
};

describe('unpremultiplyRgba', () => {
  it('converts premultiplied RGBA8 back to straight RGBA8 for colourOfPixel', () => {
    expect(unpremultiplyRgba(0, 0, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(unpremultiplyRgba(200, 100, 50, 255)).toEqual([200, 100, 50, 255]);
    // 50% red (255, 0, 0) premultiplied ~ (128, 0, 0, 128) -> (255, 0, 0, 128)
    expect(unpremultiplyRgba(128, 0, 0, 128)).toEqual([255, 0, 0, 128]);
    expect(unpremultiplyRgba(64, 32, 16, 128)).toEqual([128, 64, 32, 128]);
  });
});

describe('atlas slot packing and tile isolation (J1-O10)', () => {
  it('packs untiled operations into disjoint slots and isolates oversized tiled operations into dedicated passes', () => {
    const ops: AtlasOp[] = [
      { id: 0, minX: 10, minY: 10, maxX: 60, maxY: 60 },
      { id: 1, minX: 0, minY: 0, maxX: 400, maxY: 400 }, // oversized for 256x256 logical atlas -> tiled!
      { id: 2, minX: 20, minY: 20, maxX: 70, maxY: 70 },
    ];
    const batches = planAtlasBatches(ops, 256, 1280, 720);
    // Oversized op 1 must NEVER share a batch with untiled ops 0 or 2.
    const tiledBatches = batches.filter((b) => b.tiled);
    expect(tiledBatches.length).toBeGreaterThanOrEqual(4); // 400x400 across 256x256 tiles = 2x2 tiles
    for (const tb of tiledBatches) {
      expect(tb.slots.length).toBe(1);
      expect(tb.slots[0].op.id).toBe(1);
    }
    const untiledBatches = batches.filter((b) => !b.tiled);
    for (const ub of untiledBatches) {
      expect(ub.slots.every((s) => s.op.id !== 1)).toBe(true);
    }
  });

  it('isolates strokes crossing the sheet boundary into scissored tiled passes so unclipped geometry never bleeds into neighbour slots', () => {
    const ops: AtlasOp[] = [
      { id: 0, minX: 20, minY: 20, maxX: 60, maxY: 60 },
      { id: 1, minX: 1250, minY: 20, maxX: 1320, maxY: 80 }, // crosses right edge of 1280px sheet
      { id: 2, minX: 100, minY: 20, maxX: 140, maxY: 60 },
    ];
    const batches = planAtlasBatches(ops, 256, 1280, 720);
    const crossing = batches.filter((b) => b.slots.some((s) => s.op.id === 1));
    expect(crossing.length).toBe(1);
    expect(crossing[0].tiled).toBe(true);
    expect(crossing[0].slots.length).toBe(1);
  });
});

describe('WebGL2SheetComposer lifecycle, batching, OOM, pipette, and disposal', () => {
  it('renders strokes with source-over and destination-out blend boundaries and cleans up all GL objects on dispose()', () => {
    const mock = createRecordingWebGL2();
    const composer = new WebGL2SheetComposer(mock.gl, {
      formats: { color: 'R8', stencil: 'STENCIL_INDEX8' },
      budgetBytes: 64 * 1024 * 1024,
    });
    const tools: ToolDescriptor[] = [
      { kind: 'pencil', geometry: 'line', width: 40, color: '#112233' },
      { kind: 'eraser', geometry: 'line', width: 40 },
    ];
    const doc = simpleDoc(tools, [
      { points: [100, 100, 400, 100], tool_id: 0 },
      { points: [200, 80, 200, 200], tool_id: 1 },
      { points: [100, 150, 400, 150], tool_id: 0 },
    ]);
    const scene: FrameScene = {
      doc,
      frame: 0,
      activeLayer: 0,
      viewport: { scale: 1 / 8, dpr: 1 },
      tools: doc.tools,
      paper: '#ffffff',
    };
    expect(composer.composeAndPresent(1280, 720, scene, PRESENT)).toBe(true);
    // Must switch blend state between source-over (1:771) and destination-out (0:771).
    expect(mock.calls).toContain('blend:1:771');
    expect(mock.calls).toContain('blend:0:771');

    // Pipette readback returns unpremultiplied straight RGBA.
    mock.setReadback([64, 32, 16, 128]);
    expect(composer.samplePixel({ px: 20, py: 20, source: 'canvas', onPaper: false, paper: '#ffffff' })).toEqual([128, 64, 32, 128]);

    composer.dispose();
    expect(mock.deleted.programs).toBe(mock.created.programs);
    expect(mock.deleted.shaders).toBe(mock.created.shaders);
    expect(mock.deleted.textures).toBe(mock.created.textures);
    expect(mock.deleted.fbos).toBe(mock.created.fbos);
    expect(mock.deleted.rbos).toBe(mock.created.rbos);
    expect(mock.deleted.buffers).toBe(mock.created.buffers);
  });

  it('rejects via preflight when 1920x1920 + ghosts exceeds 64 MiB budget without allocating textures', () => {
    const mock = createRecordingWebGL2();
    const composer = new WebGL2SheetComposer(mock.gl, {
      formats: { color: 'R8', stencil: 'DEPTH24_STENCIL8' },
      budgetBytes: 64 * 1024 * 1024,
    });
    const doc: ToonDocument = {
      schema_version: 8,
      width: 1920 * 8,
      height: 1920 * 8,
      frame_rate: 12,
      tools: [{ kind: 'pencil', geometry: 'line', width: 40, color: '#000000' }],
      layers: [{ hidden: false, frames: [{ strokes: [{ points: [0, 0, 800, 800], tool_id: 0 }] }, { strokes: [] }] }],
    };
    const scene: FrameScene = {
      doc,
      frame: 1,
      activeLayer: 0,
      viewport: { scale: 1 / 8, dpr: 1 },
      tools: doc.tools,
      ghosts: { frames: [{ index: 0, alpha: 0.3, tint: '#1b5cff' }], layers: [0] },
      paper: '#ffffff',
    };
    const ok = composer.composeAndPresent(1920, 1920, scene, { ...PRESENT, stretch: 0.5 });
    expect(ok).toBe(false);
    expect(composer.lastFailure).toBe('budget-exceeded');
    composer.dispose();
  });

  it('poisons and discards the WebGL2 generation immediately when GL_OUT_OF_MEMORY occurs', () => {
    const mock = createRecordingWebGL2();
    const composer = new WebGL2SheetComposer(mock.gl, {
      formats: { color: 'R8', stencil: 'STENCIL_INDEX8' },
      budgetBytes: 64 * 1024 * 1024,
    });
    const doc = simpleDoc(
      [{ kind: 'pencil', geometry: 'line', width: 40, color: '#000000' }],
      [{ points: [0, 0, 400, 400], tool_id: 0 }],
    );
    const scene: FrameScene = {
      doc,
      frame: 0,
      activeLayer: 0,
      viewport: { scale: 1 / 8, dpr: 1 },
      tools: doc.tools,
      paper: '#ffffff',
    };
    mock.setError(0x0505); // GL_OUT_OF_MEMORY
    expect(composer.composeAndPresent(1280, 720, scene, PRESENT)).toBe(false);
    expect(composer.lastFailure).toBe('oom');
    // Subsequent calls must NOT retry on the poisoned generation.
    expect(composer.composeAndPresent(1280, 720, scene, PRESENT)).toBe(false);
    expect(mock.deleted.textures).toBe(mock.created.textures);
  });

  it('uses scissored region undo for plain strokes and disables region undo when flat coats are present', () => {
    const mock = createRecordingWebGL2();
    const composer = new WebGL2SheetComposer(mock.gl, {
      formats: { color: 'R8', stencil: 'STENCIL_INDEX8' },
      budgetBytes: 64 * 1024 * 1024,
    });
    const tools: ToolDescriptor[] = [
      { kind: 'pencil', geometry: 'line', width: 40, color: '#112233' },
      { kind: 'pencil', geometry: 'line', width: 40, color: '#334455', opacity: 50, buildup: false },
    ];
    const s1 = { points: [80, 80, 320, 80], tool_id: 0 };
    const s2 = { points: [800, 400, 960, 400], tool_id: 0 };
    const viewport = { scale: 1 / 8, dpr: 1 };

    // 1. Render [s1, s2], then undo s2 -> must use scissored clear on active layer.
    const doc2 = simpleDoc(tools, [s1, s2]);
    expect(composer.composeAndPresent(1280, 720, { doc: doc2, frame: 0, activeLayer: 0, viewport, tools, paper: '#ffffff' }, PRESENT)).toBe(true);
    mock.calls.length = 0;
    const doc1 = simpleDoc(tools, [s1]);
    composer.invalidate();
    expect(composer.composeAndPresent(1280, 720, { doc: doc1, frame: 0, activeLayer: 0, viewport, tools, paper: '#ffffff' }, PRESENT)).toBe(true);
    expect(mock.calls.some((c) => c.startsWith('scissor:'))).toBe(true);

    // 2. Render [flat, sep, flat], then undo sep -> flat-coat guard must do full rebuild (no scissor).
    const flat1 = { points: [80, 200, 320, 200], tool_id: 1 };
    const sep = { points: [800, 200, 900, 200], tool_id: 0 };
    const flat2 = { points: [80, 220, 320, 220], tool_id: 1 };
    const docFlat3 = simpleDoc(tools, [flat1, sep, flat2]);
    composer.invalidate();
    expect(composer.composeAndPresent(1280, 720, { doc: docFlat3, frame: 0, activeLayer: 0, viewport, tools, paper: '#ffffff' }, PRESENT)).toBe(true);
    mock.calls.length = 0;
    const docFlat2 = simpleDoc(tools, [flat1, flat2]);
    composer.invalidate();
    expect(composer.composeAndPresent(1280, 720, { doc: docFlat2, frame: 0, activeLayer: 0, viewport, tools, paper: '#ffffff' }, PRESENT)).toBe(true);
    expect(mock.calls.some((c) => c.startsWith('scissor:'))).toBe(false);

    composer.dispose();
  });

  it('handles ghost cells containing both eraser and flat coat without target aliasing and disposes cleanly', () => {
    const mock = createRecordingWebGL2();
    const composer = new WebGL2SheetComposer(mock.gl, {
      formats: { color: 'R8', stencil: 'STENCIL_INDEX8' },
      budgetBytes: 64 * 1024 * 1024,
    });
    const tools: ToolDescriptor[] = [
      { kind: 'pencil', geometry: 'line', width: 40, color: '#1b5cff', opacity: 50, buildup: false },
      { kind: 'eraser', geometry: 'line', width: 40 },
    ];
    const doc: ToonDocument = {
      schema_version: 8,
      width: 1280 * 8,
      height: 720 * 8,
      frame_rate: 12,
      tools,
      layers: [{
        hidden: false,
        frames: [
          {
            strokes: [
              { points: [100, 100, 400, 100], tool_id: 0 },
              { points: [200, 80, 200, 160], tool_id: 1 },
            ],
          },
          { strokes: [] },
        ],
      }],
    };
    const scene: FrameScene = {
      doc,
      frame: 1,
      activeLayer: 0,
      viewport: { scale: 1 / 8, dpr: 1 },
      tools,
      ghosts: { frames: [{ index: 0, alpha: 0.35, tint: '#1b5cff' }], layers: [0] },
      paper: '#ffffff',
    };
    expect(composer.composeAndPresent(1280, 720, scene, PRESENT)).toBe(true);
    composer.dispose();
    expect(mock.deleted.textures).toBe(mock.created.textures);
    expect(mock.deleted.fbos).toBe(mock.created.fbos);
  });

  it('returns false cleanly without throwing when CoverageAtlas allocation fails', () => {
    const mock = createRecordingWebGL2({ createFramebuffer: () => null });
    const composer = new WebGL2SheetComposer(mock.gl, {
      formats: { color: 'R8', stencil: 'STENCIL_INDEX8' },
      budgetBytes: 64 * 1024 * 1024,
    });
    const doc = simpleDoc([{ kind: 'pencil', geometry: 'line', width: 40, color: '#000000' }], [{ points: [0, 0, 200, 200], tool_id: 0 }]);
    const scene: FrameScene = { doc, frame: 0, activeLayer: 0, viewport: { scale: 1 / 8, dpr: 1 }, tools: doc.tools, paper: '#ffffff' };
    expect(() => composer.composeAndPresent(1280, 720, scene, PRESENT)).not.toThrow();
    expect(composer.composeAndPresent(1280, 720, scene, PRESENT)).toBe(false);
    expect(composer.lastFailure).toBe('oom');
  });

  it('streams all layers and keeps samplePixel working when retained VRAM headroom is zero', () => {
    const mock = createRecordingWebGL2();
    // Working bytes for 1280x720 + 256 atlas + 8 MiB headroom ~ 19.5 MiB;
    // give 22 MiB so preflight succeeds with ~2.5 MiB headroom (< 3.5 MiB per layer target -> 0 retained layers!).
    const composer = new WebGL2SheetComposer(mock.gl, {
      formats: { color: 'R8', stencil: 'STENCIL_INDEX8' },
      budgetBytes: 22 * 1024 * 1024,
    });
    const tools: ToolDescriptor[] = [{ kind: 'pencil', geometry: 'line', width: 40, color: '#112233' }];
    const doc: ToonDocument = {
      schema_version: 8,
      width: 1280 * 8,
      height: 720 * 8,
      frame_rate: 12,
      tools,
      layers: [
        { hidden: false, blend: 'multiply', frames: [{ strokes: [{ points: [80, 80, 320, 80], tool_id: 0 }] }] },
        { hidden: false, frames: [{ strokes: [{ points: [80, 160, 320, 160], tool_id: 0 }] }] },
        { hidden: false, frames: [{ strokes: [{ points: [80, 240, 320, 240], tool_id: 0 }] }] },
      ],
    };
    const scene: FrameScene = { doc, frame: 0, activeLayer: 1, viewport: { scale: 1 / 8, dpr: 1 }, tools, paper: '#ffffff' };
    expect(composer.composeAndPresent(1280, 720, scene, PRESENT)).toBe(true);
    mock.setReadback([64, 32, 16, 128]);
    expect(composer.samplePixel({ px: 20, py: 20, source: 'canvas', onPaper: false, paper: '#ffffff' })).toEqual([128, 64, 32, 128]);
    expect(composer.samplePixel({ px: 20, py: 20, source: 'layer', onPaper: false, paper: '#ffffff' })).toEqual([128, 64, 32, 128]);
    composer.dispose();
    expect(mock.deleted.textures).toBe(mock.created.textures);
  });

  it('rebuilds active layer instead of using untransformed bounds when deleting a moved lasso stroke', () => {
    const mock = createRecordingWebGL2();
    const composer = new WebGL2SheetComposer(mock.gl, {
      formats: { color: 'R8', stencil: 'STENCIL_INDEX8' },
      budgetBytes: 64 * 1024 * 1024,
    });
    const tools: ToolDescriptor[] = [{ kind: 'pencil', geometry: 'line', width: 40, color: '#112233' }];
    const s1 = { points: [80, 80, 240, 80], tool_id: 0 };
    const sMoved = { points: [80, 200, 240, 200], tool_id: 0, place: [1, 0, 0, 1, 400, 300] };
    const viewport = { scale: 1 / 8, dpr: 1 };
    const docBefore = simpleDoc(tools, [s1, sMoved]);
    expect(composer.composeAndPresent(1280, 720, { doc: docBefore, frame: 0, activeLayer: 0, viewport, tools, paper: '#ffffff' }, PRESENT)).toBe(true);
    mock.calls.length = 0;
    const docAfter = simpleDoc(tools, [s1]);
    composer.invalidate();
    expect(composer.composeAndPresent(1280, 720, { doc: docAfter, frame: 0, activeLayer: 0, viewport, tools, paper: '#ffffff' }, PRESENT)).toBe(true);
    // Must not use scissored untransformed undo when deleted stroke had a `place` matrix.
    expect(mock.calls.some((c) => c.startsWith('scissor:'))).toBe(false);
    composer.dispose();
  });

  it('streams a multi-chunk blended layer group cleanly instead of self-evicting and binding a deleted texture (F1)', () => {
    const liveTextures = new Set<object>();
    const deletedTextures = new Set<object>();
    const boundDeleted: object[] = [];
    const mock = createRecordingWebGL2({
      createTexture: () => {
        const t = {};
        liveTextures.add(t);
        return t;
      },
      deleteTexture: (t: object | null) => {
        if (t) {
          liveTextures.delete(t);
          deletedTextures.add(t);
        }
      },
      bindTexture: (_target: number, t: object | null) => {
        if (t && deletedTextures.has(t)) boundDeleted.push(t);
      },
    });
    // 1920x1600 on 64 MiB tier: working ~ 42.9 MiB, headroom ~ 21.1 MiB.
    // One RGBA8 layer = 11.7 MiB (1 fits, 2 do NOT fit -> must stream the 2-chunk above group).
    const composer = new WebGL2SheetComposer(mock.gl, {
      formats: { color: 'R8', stencil: 'STENCIL_INDEX8' },
      budgetBytes: 64 * 1024 * 1024,
    });
    const tools: ToolDescriptor[] = [{ kind: 'contour', geometry: 'line', color: '#336699' }];
    const doc: ToonDocument = {
      schema_version: 8,
      width: 1920 * 8,
      height: 1600 * 8,
      frame_rate: 12,
      tools,
      layers: [
        { hidden: false, frames: [{ strokes: [{ points: [80, 80, 400, 80, 400, 400, 80, 400], tool_id: 0 }] }] },
        { hidden: false, blend: 'multiply', frames: [{ strokes: [{ points: [100, 100, 500, 100, 500, 500, 100, 500], tool_id: 0 }] }] },
        { hidden: false, blend: 'screen', frames: [{ strokes: [{ points: [120, 120, 600, 120, 600, 600, 120, 600], tool_id: 0 }] }] },
      ],
    };
    const scene: FrameScene = { doc, frame: 0, activeLayer: 0, viewport: { scale: 1 / 8, dpr: 1 }, tools, paper: '#ffffff' };
    expect(composer.composeAndPresent(1920, 1600, scene, { ...PRESENT, stageWidth: 1920, stageHeight: 1600, sheetW: 1920, sheetH: 1600 })).toBe(true);
    expect(boundDeleted).toHaveLength(0);
    composer.dispose();
  });

  it('bounds every bufferData upload within the tier VBO allowance even for a 32,768-point stroke (F2)', () => {
    const uploadSizes: number[] = [];
    const mock = createRecordingWebGL2({
      bufferData: (_target: number, data: ArrayBufferView) => {
        if (data && 'byteLength' in data) uploadSizes.push(data.byteLength);
      },
    });
    const composer = new WebGL2SheetComposer(mock.gl, {
      formats: { color: 'R8', stencil: 'STENCIL_INDEX8' },
      budgetBytes: 64 * 1024 * 1024, // 4 MiB VBO cap
    });
    const pts: number[] = [];
    for (let i = 0; i < 32_768; i++) {
      pts.push(80 + (i % 16) * 4, 80 + ((i >> 4) % 16) * 4);
    }
    const tools: ToolDescriptor[] = [{ kind: 'pencil', geometry: 'line', width: 32, color: '#000000' }];
    const doc = simpleDoc(tools, [{ points: pts, tool_id: 0 }]);
    const scene: FrameScene = { doc, frame: 0, activeLayer: 0, viewport: { scale: 1 / 8, dpr: 1 }, tools, paper: '#ffffff' };
    expect(composer.composeAndPresent(256, 256, scene, { ...PRESENT, stageWidth: 256, stageHeight: 256, sheetW: 256, sheetH: 256 })).toBe(true);
    expect(uploadSizes.length).toBeGreaterThan(2);
    expect(Math.max(...uploadSizes)).toBeLessThanOrEqual(4 * 1024 * 1024);
    composer.dispose();
  });

  it('applies brush opacity on raw-polyline live strokes and uses alpha=1 only for flat-coat masks (F3)', () => {
    const compAlphas: number[] = [];
    const mock = createRecordingWebGL2({
      bufferData: (_target: number, data: ArrayBufferView) => {
        // Composite buffer has 8 floats per vertex (stride 32), alpha at offset 7.
        if (data instanceof Float32Array && data.length > 0 && data.length % 48 === 0) {
          for (let i = 7; i < data.length; i += 8) compAlphas.push(data[i]);
        }
      },
    });
    const composer = new WebGL2SheetComposer(mock.gl, {
      formats: { color: 'R8', stencil: 'STENCIL_INDEX8' },
      budgetBytes: 64 * 1024 * 1024,
    });
    const tools: ToolDescriptor[] = [{ kind: 'pencil', geometry: 'line', width: 48, color: '#1b5cff', opacity: 25 }];
    const doc = simpleDoc(tools, []);
    const scene: FrameScene = {
      doc,
      frame: 0,
      activeLayer: 0,
      viewport: { scale: 1 / 8, dpr: 1 },
      tools,
      paper: '#ffffff',
      live: {
        id: 1,
        spec: {
          kind: 'raw-polyline',
          points: [80, 80, 400, 80],
          width: 48,
          color: '#1b5cff',
          alpha: 0.25,
        },
      },
    };
    expect(composer.composeAndPresent(256, 256, scene, { ...PRESENT, stageWidth: 256, stageHeight: 256, sheetW: 256, sheetH: 256 })).toBe(true);
    expect(compAlphas.some((a) => Math.abs(a - 0.25) < 1e-5)).toBe(true);
    expect(compAlphas.every((a) => Math.abs(a - 0.25) < 1e-5)).toBe(true);
    composer.dispose();
  });

  it('drops and frees in-flight CellWarmer worker output when stop() fires before resolution (F4)', async () => {
    const cache = new CellCache(16 * 1024 * 1024);
    let resolveDraw!: (value: { image: CanvasImageSource; free: () => void } | null) => void;
    let freed = 0;
    const warmer = new CellWarmer(
      cache,
      (task) => {
        task();
        return () => {};
      },
      {
        draw: () => new Promise((resolve) => { resolveDraw = resolve; }),
      },
    );
    const tools: ToolDescriptor[] = [{ kind: 'pencil', geometry: 'line', width: 40, color: '#000000' }];
    const doc: ToonDocument = {
      schema_version: 8,
      width: 1024,
      height: 1024,
      frame_rate: 12,
      tools,
      layers: [{
        hidden: false,
        frames: [
          { strokes: [] },
          { strokes: [{ points: [80, 80, 400, 80], tool_id: 0 }] },
        ],
      }],
    };
    const viewport = { scale: 1 / 8, dpr: 1 };
    warmer.request({ doc, frame: 0, tools, viewport, width: 128, height: 128 });
    // Stop warmer while worker draw is still in flight (as on WebGL2 promotion).
    warmer.stop();
    resolveDraw({ image: {} as CanvasImageSource, free: () => { freed++; } });
    await Promise.resolve();
    await Promise.resolve();
    expect(freed).toBe(1);
    expect(cache.has(doc.layers[0].frames[1]!, tools, viewport, 128, 128)).toBe(false);
  });

  it('deletes the ghost #underTex before reclaiming its VRAM reservation when onion skin turns off (F7)', () => {
    const texBytes = new Map<object, number>();
    let boundTex: object | null = null;
    let peakTextureBytes = 0;
    const sumLive = () => {
      let total = 0;
      for (const b of texBytes.values()) total += b;
      return total;
    };
    const mock = createRecordingWebGL2({
      createTexture: () => {
        const t = {};
        texBytes.set(t, 0);
        return t;
      },
      bindTexture: (_target: number, t: object | null) => {
        boundTex = t;
      },
      texImage2D: (_target: number, _level: number, internalFormat: number, w: number, h: number) => {
        if (!boundTex) return;
        const bpp = internalFormat === 0x8229 ? 1 : 4; // R8 vs RGBA8
        texBytes.set(boundTex, w * h * bpp);
        const cur = sumLive();
        if (cur > peakTextureBytes) peakTextureBytes = cur;
      },
      deleteTexture: (t: object | null) => {
        if (t) texBytes.delete(t);
      },
    });
    // 1920x1800 RGBA8 = 13,824,000 bytes (~13.18 MiB).
    // 64 MiB tier: with ghosts on -> 4 working sheets (52.7 MiB) + atlas + VBO = 58.7 MiB (0 retained layers).
    // Turning ghosts off frees #underTex BEFORE reclaiming its reservation, so retained activeTex fits within 64 MiB!
    const budget = 64 * 1024 * 1024;
    const composer = new WebGL2SheetComposer(mock.gl, {
      formats: { color: 'R8', stencil: 'STENCIL_INDEX8' },
      budgetBytes: budget,
    });
    const tools: ToolDescriptor[] = [{ kind: 'pencil', geometry: 'line', width: 40, color: '#000000' }];
    const doc: ToonDocument = {
      schema_version: 8,
      width: 1920 * 8,
      height: 1800 * 8,
      frame_rate: 12,
      tools,
      layers: [{
        hidden: false,
        frames: [
          { strokes: [{ points: [80, 80, 400, 80], tool_id: 0 }] },
          { strokes: [{ points: [80, 160, 400, 160], tool_id: 0 }] },
        ],
      }],
    };
    const presentBig = { ...PRESENT, stageWidth: 1920, stageHeight: 1800, sheetW: 1920, sheetH: 1800 };
    // Frame 1 with onion skin ON
    expect(composer.composeAndPresent(1920, 1800, {
      doc,
      frame: 1,
      activeLayer: 0,
      viewport: { scale: 1 / 8, dpr: 1 },
      tools,
      ghosts: { frames: [{ index: 0, alpha: 0.3, tint: '#1b5cff' }], layers: [0] },
      paper: '#ffffff',
    }, presentBig)).toBe(true);
    // Toggle onion skin OFF at same size -> must delete #underTex so peak live textures stay <= 64 MiB!
    composer.invalidate();
    expect(composer.composeAndPresent(1920, 1800, {
      doc,
      frame: 1,
      activeLayer: 0,
      viewport: { scale: 1 / 8, dpr: 1 },
      tools,
      paper: '#ffffff',
    }, presentBig)).toBe(true);
    expect(peakTextureBytes).toBeLessThanOrEqual(budget - 5 * 1024 * 1024);
    composer.dispose();
    expect(sumLive()).toBe(0);
  });

  it('tiles sheet-spanning native fallback strokes into <= atlas.logicalSide scratch tiles within VRAM budget (F8)', () => {
    const texBytes = new Map<object, number>();
    let boundTex: object | null = null;
    let peakTextureBytes = 0;
    const nativeTileDims: [number, number][] = [];
    const sumLive = () => {
      let total = 0;
      for (const b of texBytes.values()) total += b;
      return total;
    };
    const mock = createRecordingWebGL2({
      createTexture: () => {
        const t = {};
        texBytes.set(t, 0);
        return t;
      },
      bindTexture: (_target: number, t: object | null) => {
        boundTex = t;
      },
      texImage2D: (_target: number, _level: number, internalFormat: number, w: number, h: number, _border: number, _fmt: number, _type: number, data: unknown) => {
        if (!boundTex) return;
        const bpp = internalFormat === 0x8229 ? 1 : 4;
        texBytes.set(boundTex, w * h * bpp);
        if (data !== null) nativeTileDims.push([w, h]);
        const cur = sumLive();
        if (cur > peakTextureBytes) peakTextureBytes = cur;
      },
      texSubImage2D: (_target: number, _level: number, _x: number, _y: number, w: number, h: number) => {
        nativeTileDims.push([w, h]);
      },
      deleteTexture: (t: object | null) => {
        if (t) texBytes.delete(t);
      },
    });

    // Provide a lightweight stub document.createElement('canvas') so #compositeReferenceOp runs in Bun.
    const prevDoc = globalThis.document;
    const stubCtx = {
      setTransform() {},
      clearRect() {},
      save() {},
      restore() {},
      beginPath() {},
      moveTo() {},
      lineTo() {},
      quadraticCurveTo() {},
      bezierCurveTo() {},
      arc() {},
      closePath() {},
      fill() {},
      stroke() {},
      rect() {},
      getImageData: (_x: number, _y: number, w: number, h: number) => {
        const data = new Uint8ClampedArray(w * h * 4);
        // Mark pixel (0,0) opaque so tile upload executes.
        data[0] = 20; data[1] = 40; data[2] = 60; data[3] = 255;
        return { data };
      },
    };
    (globalThis as unknown as { document: unknown }).document = {
      createElement: () => ({ width: 0, height: 0, getContext: () => stubCtx }),
    };

    try {
      const budget = 64 * 1024 * 1024;
      const composer = new WebGL2SheetComposer(mock.gl, {
        formats: { color: 'R8', stencil: 'STENCIL_INDEX8' },
        budgetBytes: budget,
      });
      // 1-unit-wide (0.125 sheet px -> subpixel native fallback!) diagonal stroke across 1920x1800.
      const tools: ToolDescriptor[] = [{ kind: 'pencil', geometry: 'line', width: 1, color: '#112233' }];
      const doc: ToonDocument = {
        schema_version: 8,
        width: 1920 * 8,
        height: 1800 * 8,
        frame_rate: 12,
        tools,
        layers: [{ hidden: false, frames: [{ strokes: [{ points: [0, 0, 1920 * 8, 1800 * 8], tool_id: 0 }] }] }],
      };
      const presentBig = { ...PRESENT, stageWidth: 1920, stageHeight: 1800, sheetW: 1920, sheetH: 1800 };
      expect(composer.composeAndPresent(1920, 1800, {
        doc,
        frame: 0,
        activeLayer: 0,
        viewport: { scale: 1 / 8, dpr: 1 },
        tools,
        paper: '#ffffff',
      }, presentBig)).toBe(true);
      expect(nativeTileDims.length).toBeGreaterThan(1);
      for (const [tw, th] of nativeTileDims) {
        expect(tw).toBeLessThanOrEqual(256);
        expect(th).toBeLessThanOrEqual(256);
      }
      // Live textures must stay strictly below budget even after leaving room for 1 MiB stencil + 4 MiB VBO!
      expect(peakTextureBytes).toBeLessThanOrEqual(budget - 5 * 1024 * 1024);
      composer.dispose();
      expect(sumLive()).toBe(0);
    } finally {
      (globalThis as unknown as { document: unknown }).document = prevDoc;
    }
  });

  it('generates and uses mipmaps on minified playback cache hits', () => {
    let mipmapCalls = 0;
    const minFilters: number[] = [];
    const mock = createRecordingWebGL2({
      generateMipmap: () => { mipmapCalls++; },
      texParameteri: (_target: number, pname: number, param: number) => {
        if (pname === 0x2801) minFilters.push(param); // TEXTURE_MIN_FILTER
      },
    });
    const composer = new WebGL2SheetComposer(mock.gl, {
      formats: { color: 'R8', stencil: 'STENCIL_INDEX8' },
      budgetBytes: 64 * 1024 * 1024,
    });
    const tools: ToolDescriptor[] = [{ kind: 'pencil', geometry: 'line', width: 40, color: '#000000' }];
    const doc = simpleDoc(tools, [{ points: [80, 80, 400, 80], tool_id: 0 }]);
    const scene: FrameScene = { doc, frame: 0, activeLayer: 0, viewport: { scale: 1 / 8, dpr: 1 }, tools, paper: '#ffffff' };
    const miniPresent = { ...PRESENT, stretch: 0.5 };
    const playKey = { doc, key: 0, total: 1 };

    // First minified pass: generates mipmaps for slotA AND for the cached playback copy.
    expect(composer.composeAndPresent(512, 512, scene, miniPresent, playKey)).toBe(true);
    expect(mipmapCalls).toBe(2);

    // Second minified pass (playback cache hit): must present with LINEAR_MIPMAP_LINEAR (0x2703).
    minFilters.length = 0;
    expect(composer.composeAndPresent(512, 512, scene, miniPresent, playKey)).toBe(true);
    expect(minFilters).toContain(0x2703);

    composer.dispose();
  });

  it('preserves per-pass opacity for buildup feather native fallback and group opacity for flat-coat feather fallback', () => {
    const seenAlphas: number[] = [];
    const seenBlitAlphas: number[] = [];
    const mock = createRecordingWebGL2({
      getUniformLocation: (_p: unknown, name: string) => ({ name }),
      uniform1f: (loc: { name?: string } | null, v: number) => {
        if (loc?.name === 'uAlpha') seenBlitAlphas.push(v);
      },
    });
    const prevDoc = globalThis.document;
    const stubCtx = {
      globalAlpha: 1,
      setTransform() {},
      clearRect() {},
      save() {},
      restore() {},
      beginPath() {},
      moveTo() {},
      lineTo() {},
      quadraticCurveTo() {},
      bezierCurveTo() {},
      arc() {},
      closePath() {},
      fill() { seenAlphas.push(this.globalAlpha); },
      stroke() { seenAlphas.push(this.globalAlpha); },
      rect() {},
      getImageData: (_x: number, _y: number, w: number, h: number) => {
        const data = new Uint8ClampedArray(w * h * 4);
        data[0] = 200; data[1] = 100; data[2] = 50; data[3] = 128;
        return { data };
      },
    };
    (globalThis as unknown as { document: unknown }).document = {
      createElement: () => ({ width: 0, height: 0, getContext: () => stubCtx }),
    };

    try {
      const composer = new WebGL2SheetComposer(mock.gl, {
        formats: { color: 'R8', stencil: 'STENCIL_INDEX8' },
        budgetBytes: 64 * 1024 * 1024,
      });
      const pts = [80, 80, 400, 80, 400, 400, 80, 400];
      // 1. Buildup translucent subpixel feather (opacity 50, buildup true): Canvas 2D paints both fill & stroke at globalAlpha=0.5, blit at uAlpha=1.
      const buildupTools: ToolDescriptor[] = [{ kind: 'feather', geometry: 'line', width: 1, color: '#000000', fill: '#ffe066', opacity: 50 }];
      const doc1 = simpleDoc(buildupTools, [{ points: pts, tool_id: 0 }]);
      seenAlphas.length = 0;
      seenBlitAlphas.length = 0;
      expect(composer.composeAndPresent(256, 256, { doc: doc1, frame: 0, activeLayer: 0, viewport: { scale: 1 / 8, dpr: 1 }, tools: buildupTools, paper: '#ffffff' }, { ...PRESENT, stageWidth: 256, stageHeight: 256, sheetW: 256, sheetH: 256 })).toBe(true);
      expect(seenAlphas.length).toBeGreaterThanOrEqual(2);
      expect(seenAlphas.every((a) => Math.abs(a - 0.5) < 1e-5)).toBe(true);

      // 2. Flat-coat translucent subpixel feather (opacity 50, buildup false): Canvas 2D paints opaque (globalAlpha=1) into #mask, then group blits once at 0.5.
      const flatTools: ToolDescriptor[] = [{ kind: 'feather', geometry: 'line', width: 1, color: '#000000', fill: '#ffe066', opacity: 50, buildup: false }];
      const doc2 = simpleDoc(flatTools, [{ points: pts, tool_id: 0 }]);
      seenAlphas.length = 0;
      seenBlitAlphas.length = 0;
      composer.invalidate();
      expect(composer.composeAndPresent(256, 256, { doc: doc2, frame: 0, activeLayer: 0, viewport: { scale: 1 / 8, dpr: 1 }, tools: flatTools, paper: '#ffffff' }, { ...PRESENT, stageWidth: 256, stageHeight: 256, sheetW: 256, sheetH: 256 })).toBe(true);
      expect(seenAlphas.length).toBeGreaterThanOrEqual(2);
      expect(seenAlphas.every((a) => a === 1)).toBe(true);
      expect(seenBlitAlphas.some((a) => Math.abs(a - 0.5) < 1e-5)).toBe(true);
      composer.dispose();
    } finally {
      (globalThis as unknown as { document: unknown }).document = prevDoc;
    }
  });
});
