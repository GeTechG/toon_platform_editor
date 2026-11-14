/**
 * The cells the studio's canvas keeps rasterized, for the pictures of them
 * elsewhere on its screen — the timeline's thumbnails scale them down instead
 * of drawing every line again. Absent while no canvas is up.
 */

import type { CellCache } from './cell-cache';

export const studioCells: { current: CellCache | undefined } = { current: undefined };
