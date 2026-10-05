/**
 * The sheet a drawing starts on. Its size is chosen once, at the start: an
 * empty sheet can be given another, and the first line fixes it.
 *
 * The lines are drawn for the view, sharp at any zoom, so the size is not how
 * crisp the drawing is: it is how much fits on the sheet beside a brush of the
 * same thickness, the proportions, and the size it exports at.
 */

import { FIXED_POINT_SCALE } from '../format/constants';
import type { ToonDocument } from '../format/types';
import { isEmptyDocument } from '../model/operations';

/** Logical px, lying; standing swaps the sides. */
const SHEET_SIZES = [
  { name: '720p', width: 1280, height: 720 },
  { name: '1080p', width: 1920, height: 1080 },
  { name: '2K', width: 2560, height: 1440 },
  { name: '4K', width: 3840, height: 2160 },
] as const;

export interface SheetChoice {
  /** `1280x720`: what the list holds and `resizeSheet` takes. */
  readonly value: string;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly standing: boolean;
}

/** Every sheet a drawing can start on: each size lying, then each standing. */
export function sheetChoices(): SheetChoice[] {
  return [false, true].flatMap((standing) => SHEET_SIZES.map(({ name, width, height }) => {
    const [w, h] = standing ? [height, width] : [width, height];
    return { value: `${w}x${h}`, name, width: w, height: h, standing };
  }));
}

/** The document's sheet as the list names it. */
export function sheetValue(doc: ToonDocument): string {
  return `${Math.round(doc.width / FIXED_POINT_SCALE)}x${Math.round(doc.height / FIXED_POINT_SCALE)}`;
}

/**
 * Whether the sheet can still be given another size: nothing on it, and
 * nothing in the history — a line taken back would come back, on redo, to a
 * sheet it was not drawn on.
 */
export function sheetOpen(doc: ToonDocument, history: number): boolean {
  return history === 0 && isEmptyDocument(doc);
}

/** Gives the document the chosen sheet; a value off the list changes nothing. */
export function resizeSheet(doc: ToonDocument, value: string): void {
  const choice = sheetChoices().find((sheet) => sheet.value === value);
  if (choice) {
    doc.width = choice.width * FIXED_POINT_SCALE;
    doc.height = choice.height * FIXED_POINT_SCALE;
  }
}
