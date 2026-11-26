import type { Frame, ToolDescriptor } from '../../format/types';
import type { Viewport } from '../contract';
import { renderStrokesLayer, STUDIO_PATHS, type Canvas2DLike } from '../canvas2d';
import { identifyCellInk, sameInk, type Ink } from '../cell-cache';
import { emitPathForTool } from '../dispatch';
import type { VramBudget } from './vram-budget';

interface CellRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface TextureSurface {
  readonly tex: WebGLTexture;
  readonly width: number;
  readonly height: number;
}

export interface PlaybackCell extends TextureSurface {
  readonly rect: CellRect;
}

interface Entry extends PlaybackCell {
  readonly ink: Ink;
}

/** The control hull contains curved paths too. Leave room for ink width and antialiasing. */
function cellRect(ink: Ink, view: Viewport, width: number, height: number): CellRect | null {
  const scale = view.scale * view.dpr;
  const originX = (view.panX ?? 0) * view.dpr;
  const originY = (view.panY ?? 0) * view.dpr;
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  let pad = 0;
  let place: readonly number[] | undefined;
  const include = (x: number, y: number): void => {
    if (place) {
      const [a, b, c, d, e, f] = place;
      [x, y] = [a * x + c * y + e, b * x + d * y + f];
    }
    const px = x * scale + originX, py = y * scale + originY;
    left = Math.min(left, px - pad);
    top = Math.min(top, py - pad);
    right = Math.max(right, px + pad);
    bottom = Math.max(bottom, py + pad);
  };
  const sink = {
    moveTo: include,
    lineTo: include,
    quadraticCurveTo(cx: number, cy: number, x: number, y: number) {
      include(cx, cy); include(x, y);
    },
    bezierCurveTo(cx: number, cy: number, dx: number, dy: number, x: number, y: number) {
      include(cx, cy); include(dx, dy); include(x, y);
    },
    closePath() {},
  };
  for (const [points, tool, , matrix] of ink) {
    if (!tool) continue;
    place = matrix;
    const expansion = place ? Math.max(Math.hypot(place[0], place[2]), Math.hypot(place[1], place[3])) : 1;
    // Interpolated stamps can step past an off-grid endpoint, then extend by
    // the full unit-square polygon. Keep both extensions when choosing a crop.
    const strokeWidth = 'width' in tool ? tool.width : 0;
    pad = strokeWidth * (tool.kind === 'stamp' ? 3 : 1) * scale * expansion + 2;
    for (let i = 0; i < points.length; i += 2) include(points[i], points[i + 1]);
    if (tool.geometry !== 'line') emitPathForTool(points, tool, sink);
  }
  const x = Math.max(0, Math.floor(left)), y = Math.max(0, Math.floor(top));
  const w = Math.min(width, Math.ceil(right)) - x, h = Math.min(height, Math.ceil(bottom)) - y;
  return w > 0 && h > 0 ? { x, y, width: w, height: h } : null;
}

function resizeCanvas(canvas: HTMLCanvasElement, width: number, height: number): void {
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
}

/** Retains cropped drawings, with sheet position independent of texture storage. */
export class PlaybackCellTextures {
  readonly #entries = new Map<string, Entry>();
  #uploadRevision = 0;

  get uploadRevision(): number { return this.#uploadRevision; }

  static open(gl: WebGL2RenderingContext, budget: VramBudget): PlaybackCellTextures | null {
    if (typeof document === 'undefined') return null;
    const ctx = document.createElement('canvas').getContext('2d');
    const mask = document.createElement('canvas').getContext('2d');
    return ctx && mask ? new PlaybackCellTextures(gl, budget, ctx, mask) : null;
  }

  private constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly budget: VramBudget,
    private readonly ctx: CanvasRenderingContext2D,
    private readonly mask: CanvasRenderingContext2D,
  ) {}

  /** A borrowed texture lives until the next miss and must be drawn immediately. */
  take(cell: Frame, tools: readonly ToolDescriptor[], view: Viewport, scratch: TextureSurface): PlaybackCell | null {
    const { key, ink } = identifyCellInk(cell, tools, view, scratch.width, scratch.height);
    const budgetKey = `play-cell:${key}`;
    const entry = this.#entries.get(key);
    if (entry && sameInk(entry.ink, ink)) {
      this.budget.touch(budgetKey);
      return entry;
    }

    const rect = cellRect(ink, view, scratch.width, scratch.height);
    if (!rect) return null;
    const gl = this.gl;
    const { canvas } = this.ctx;
    resizeCanvas(canvas, rect.width, rect.height);
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, rect.width, rect.height);
    renderStrokesLayer(cell, tools, this.ctx as unknown as Canvas2DLike, {
      ...view, panX: (view.panX ?? 0) - rect.x / view.dpr, panY: (view.panY ?? 0) - rect.y / view.dpr,
    }, undefined, STUDIO_PATHS, () => {
      const image = this.mask.canvas;
      resizeCanvas(image, rect.width, rect.height);
      return { image, ctx: this.mask as unknown as Canvas2DLike };
    });

    let texture: WebGLTexture | null = null;
    const retained = this.budget.tryRetain(budgetKey, rect.width * rect.height * 4, () => {
      if (texture) gl.deleteTexture(texture);
      this.#entries.delete(key);
    });
    gl.activeTexture(gl.TEXTURE0);
    if (retained) {
      texture = gl.createTexture();
      if (texture) {
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      } else {
        this.budget.release(budgetKey);
      }
    }
    const surface = texture ? { tex: texture, width: rect.width, height: rect.height } : scratch;
    gl.bindTexture(gl.TEXTURE_2D, surface.tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    if (texture) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    else gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.bindTexture(gl.TEXTURE_2D, null);
    this.#uploadRevision++;
    const result = { ...surface, rect, ink };
    if (texture) this.#entries.set(key, result);
    return result;
  }

  clear(): void {
    for (const key of this.#entries.keys()) this.budget.release(`play-cell:${key}`);
    resizeCanvas(this.ctx.canvas, 0, 0);
    resizeCanvas(this.mask.canvas, 0, 0);
  }
}
