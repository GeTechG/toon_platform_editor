/**
 * The reference's "old" easter egg, as a brush.
 *
 * It was a flag on the session for as long as the canvas owned the line: the
 * Multator pen drew as usual and the commit turned it into a closed contour.
 * Nothing about it was ever the preset's — the tolerance, the canvas and the
 * contour are the pen's own — so it is a brush, and works wherever it is
 * taken in hand.
 *
 * The geometry is untouched (`tools/oldschool.ts`), a faithful port of
 * `DrawField.hx onOldEndDraw` with its own tests. What lives here is only the
 * manifest: which canvas it measures on, and what its points become.
 */

import { FIXED_POINT_SCALE } from '../format/constants';
import { OLDSCHOOL_LANG_TOLERANCE_LOGICAL, commitOldschoolStroke } from '../tools/oldschool';
import type { StrokeCommit } from '../tools/profiles';
import { PLUGIN_API, type Plugin, type PluginPrimitive } from './contract';

/**
 * Lang tolerance, contour, jitter: the reference writes them in pixels of its
 * own 600-wide canvas, so on a document of another size they scale the way the
 * width does.
 */
const commit: StrokeCommit = (points, descriptor, { coordinateScale }) => ({
  points: commitOldschoolStroke(
    points,
    descriptor.width / FIXED_POINT_SCALE,
    Math.random,
    OLDSCHOOL_LANG_TOLERANCE_LOGICAL * (FIXED_POINT_SCALE / coordinateScale),
  ),
  // A contour carries one colour and no fill, so the pen paints and the
  // eraser punches — which is the whole of the easter egg's vocabulary.
  tool: descriptor.kind === 'eraser'
    ? { kind: 'contour-eraser', dialect: 'multator' }
    : { kind: 'contour', dialect: 'multator', color: 'color' in descriptor ? descriptor.color : '#000000' },
});

/**
 * The canvas is the pen's own: the contour is a Multator shape in any preset.
 *
 * No `cut` here. The mega eraser reads the stored descriptor, and a closed
 * filled contour already goes whole by itself; declaring a policy on a brush
 * of kind `pencil` would instead describe every pencil stroke in the document,
 * since the eraser looks a policy up by primitive.
 */
const OLDSCHOOL_PEN: PluginPrimitive = {
  kind: 'pencil',
  dialect: 'multator',
  descriptor: ({ width, color }) => ({ kind: 'pencil', dialect: 'multator', width, color }),
  commit,
};

const OLDSCHOOL_ERASER: PluginPrimitive = {
  kind: 'eraser',
  dialect: 'multator',
  descriptor: ({ width }) => ({ kind: 'eraser', dialect: 'multator', width }),
  commit,
};

/**
 * Which oldschool brush stands in for which everyday one. The reference's flag
 * applied to the pen and the eraser alike, so there are two — and the pairing
 * belongs here, beside them, not in whatever types the word `old`.
 */
export const OLDSCHOOL_TWIN: Readonly<Record<string, string>> = {
  pencil: 'oldschool',
  eraser: 'oldschool-eraser',
};

/** Whether the brush in hand is one of them — what the egg toggles, and what the panel badges. */
export function isOldschool(tool: string): boolean {
  return Object.values(OLDSCHOOL_TWIN).includes(tool);
}

/**
 * What typing the word does from here: which brush to take, and which one to
 * give back next time. `back` is what the last swap remembered, `null` when
 * the egg is not open.
 *
 * The three letters are three tool keys on the way — `o` is the hand — so the
 * way back cannot be read off whatever is in hand when the word ends. It is
 * what was remembered when the egg opened.
 */
export function oldschoolSwap(
  tool: string,
  back: string | null,
): { take: string; back: string | null } {
  if (back !== null || isOldschool(tool)) {
    return { take: back ?? 'pencil', back: null };
  }
  return { take: OLDSCHOOL_TWIN[tool] ?? 'oldschool', back: tool };
}

/** Neither brush asks for a key: the easter egg is the door. */
export const oldschoolPlugins: readonly Plugin[] = [
  {
    id: 'oldschool',
    api: PLUGIN_API,
    tool: { icon: 'pencil', title: 'Старое перо', label: 'Старое перо', key: '', offPanel: true, stroke: OLDSCHOOL_PEN },
  },
  {
    id: 'oldschool-eraser',
    api: PLUGIN_API,
    tool: { icon: 'eraser', title: 'Старый ластик', label: 'Старый ластик', key: '', offPanel: true, stroke: OLDSCHOOL_ERASER },
  },
];
