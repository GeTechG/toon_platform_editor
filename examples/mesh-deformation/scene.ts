import { buildCorpus } from '../../src/bench/corpus';
import type { ToonDocument } from '../../src/lib/format/types';
import { resolveCell } from '../../src/lib/model/cells';
import { emitPressuredOutline, flattenPressured, PRESSURE_MAX } from '../../src/lib/render/pressure';
import { countMonotoneYChains, MAX_STENCIL_WINDING } from '../../src/lib/render/webgl/tessellate';

export const WIDTH = 960;
export const HEIGHT = 540;

export interface Paint {
  contours: number[][];
  color: string;
  opacity: number;
  erase: boolean;
  pointCount: number;
}

export function fallbackDocument(): ToonDocument {
  return buildCorpus({ layers: 1, frames: 1, strokesPerFrame: 120, pointsPerStroke: 64, mixedEvery: 4 });
}

/** Use one layer so an eraser cuts only the ink from its own drawing. */
export function readDrawing(doc: ToonDocument, frame: number): Paint[] {
  const layers = doc.layers.filter((layer) => !layer.hidden && resolveCell(layer, frame).strokes.length > 0);
  if (layers.length !== 1 || layers[0].blend || (layers[0].opacity ?? 100) !== 100) {
    throw new Error('Для сравнения нужен кадр с одним видимым слоем без наложения.');
  }
  const strokes = resolveCell(layers[0], frame).strokes;
  const scale = Math.min(WIDTH * 0.92 / doc.width, HEIGHT * 0.92 / doc.height);
  const tolerance = 0.18 / scale;
  let minX = 0;
  let minY = 0;
  let maxX = doc.width;
  let maxY = doc.height;

  const paints = strokes.map((stroke): Paint => {
    const tool = doc.tools[stroke.tool_id];
    if ((tool.kind !== 'pencil' && tool.kind !== 'eraser') || (tool.kind === 'pencil' && tool.buildup === false)) {
      throw new Error('Выбери кадр со штрихами карандаша и ластика.');
    }
    const contours: number[][] = [];
    let contour: number[] = [];
    const points = stroke.points;
    const count = points.length / 2;
    const pressure = stroke.pressure ?? Array<number>(count).fill(PRESSURE_MAX);
    const flat = flattenPressured(points, pressure, tool.geometry);
    const lineTo = (x: number, y: number) => {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      contour.push(x, y);
    };
    emitPressuredOutline(flat, tool.width, {
      moveTo(x, y) {
        contour = [];
        contours.push(contour);
        lineTo(x, y);
      },
      lineTo,
      arc(cx, cy, radius, start, end, counterclockwise) {
        const fullTurn = 2 * Math.PI;
        let sweep = end - start;
        if (Math.abs(sweep) >= fullTurn - 1e-10) sweep = counterclockwise ? -fullTurn : fullTurn;
        else if (counterclockwise && sweep > 0) sweep -= fullTurn;
        else if (!counterclockwise && sweep < 0) sweep += fullTurn;
        const maxAngle = 2 * Math.acos(Math.max(-1, 1 - tolerance / radius));
        const steps = Math.max(2, Math.ceil(Math.abs(sweep) / maxAngle));
        for (let step = 0; step <= steps; step++) {
          const angle = start + sweep * step / steps;
          lineTo(cx + radius * Math.cos(angle), cy + radius * Math.sin(angle));
        }
      },
    });
    // The mesh deformation preserves the contour's winding. Check the
    // undeformed rings before sending them to the eight-bit stencil.
    const windingBound = contours.reduce((sum, ring) => sum + Math.ceil(countMonotoneYChains(ring) / 2), 0);
    if (windingBound > MAX_STENCIL_WINDING) {
      throw new Error('Этот штрих слишком много раз пересекает себя для stencil-буфера. Выбери другой кадр.');
    }
    return {
      contours,
      color: tool.kind === 'pencil' ? tool.color : '#000000',
      opacity: tool.kind === 'pencil' ? (tool.opacity ?? 100) / 100 : 1,
      erase: tool.kind === 'eraser',
      pointCount: count,
    };
  });

  const fitted = Math.min(WIDTH * 0.92 / (maxX - minX), HEIGHT * 0.92 / (maxY - minY));
  const ox = (WIDTH - (maxX + minX) * fitted) / 2;
  const oy = (HEIGHT - (maxY + minY) * fitted) / 2;
  for (const paint of paints) {
    for (const contour of paint.contours) {
      for (let i = 0; i < contour.length; i += 2) {
        contour[i] = (ox + contour[i] * fitted) / WIDTH;
        contour[i + 1] = (oy + contour[i + 1] * fitted) / HEIGHT;
      }
    }
  }
  return paints;
}
