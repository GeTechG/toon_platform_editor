/**
 * Tonio's pixel tool, the second tool to go through the plugin contract.
 *
 * Everything the editor used to know about it is here: the canvas its cells
 * are measured on, how the pointer's points become cells, how they are thinned
 * on commit, what the mega eraser does to them, and that it wants a grid. The
 * editor holds none of it and never names the tool.
 *
 * What stays outside is only what the **player** needs: the `pixel` descriptor
 * in the format and the squares the renderer fills for it. No plugin runs in
 * the player, so a primitive it could not draw would be a frame nobody but
 * this editor could ever show.
 *
 * The geometry itself is untouched (`tools/pixel.ts`) — a faithful port of
 * `tools.js Pixel`, quirks included, with its own tests.
 */

import { SQUARE_STAMP } from '../format/types';
import { appendPixelCells, pixelPrepare } from '../tools/pixel';
import { PLUGIN_API, type Plugin } from './contract';
import { TONIO_CANVAS_WIDTH } from './brushes/toonio';

export const pixelPlugin: Plugin = {
  id: 'pixel',
  api: PLUGIN_API,
  tool: {
    icon: 'pixel',
    title: 'Пиксель — рисует по сетке',
    label: 'Пиксель',
    key: '',
    stroke: {
      kind: 'stamp',
      grid: true,
      // Cells are independent marks, so the eraser takes the ones it covered
      // and leaves the rest standing on the grid.
      cut: 'cells',
      descriptor: ({ width, color }) => ({
        kind: 'stamp',
        geometry: 'line',
        width,
        color,
        shape: [...SQUARE_STAMP],
      }),
      // A cell is a pixel of the Tonio canvas whatever preset holds the tool,
      // and the marks are its own: another brush's smoothing would bend a row
      // of cells into a line the renderer has nothing to draw with.
      rules: () => ({
        canvas: TONIO_CANVAS_WIDTH,
        capture: (line, points, width) => appendPixelCells(line, points, width),
        // Reference Pixel: Smooth is the identity and Prepare thins by the width.
        prepare: (points, width, zoom) => pixelPrepare(points, width, zoom),
      }),
    },
  },
};
