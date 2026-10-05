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
import { t } from '../i18n';

/** The long side in logical px; the short one follows the proportion. */
const SHEET_SIZES = [
  { name: '720p', long: 1280 },
  { name: '1080p', long: 1920 },
  { name: '2K', long: 2560 },
  { name: '4K', long: 3840 },
] as const;

/** Lying; standing swaps the sides. */
const PROPORTIONS = [[16, 9], [4, 3], [1, 1], [21, 9]] as const;

export interface SheetChoice {
  /** `1280x720`: what the list holds and `resizeSheet` takes. */
  readonly value: string;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly standing: boolean;
  /** The proportion lying, `16:9`: what the cards are told apart by. */
  readonly proportion: string;
  /** The proportion as the sheet lies or stands: `9:16`. */
  readonly ratio: string;
}

export function sheetProportions(): string[] {
  return PROPORTIONS.map(([w, h]) => `${w}:${h}`);
}

export function sheetSizes(): string[] {
  return SHEET_SIZES.map((size) => size.name);
}

/** Every sheet a drawing can start on: each proportion lying, then each standing; a square is one sheet. */
export function sheetChoices(): SheetChoice[] {
  return [false, true].flatMap((standing) =>
    PROPORTIONS.filter(([w, h]) => !standing || w !== h).flatMap(([w, h]) =>
      SHEET_SIZES.map(({ name, long }) => {
        // Even, so a video encoder takes the frame as it is.
        const short = Math.round((long * h) / w / 2) * 2;
        const [width, height] = standing ? [short, long] : [long, short];
        return {
          value: `${width}x${height}`,
          name,
          width,
          height,
          standing,
          proportion: `${w}:${h}`,
          ratio: standing ? `${h}:${w}` : `${w}:${h}`,
        };
      }),
    ),
  );
}

/** The sheet of a proportion, a size and a side; a square standing is the square. */
export function sheetOf(proportion: string, name: string, standing: boolean): SheetChoice {
  const of = (stands: boolean) =>
    sheetChoices().find((sheet) => sheet.proportion === proportion && sheet.name === name && sheet.standing === stands);
  return of(standing) ?? of(false) ?? sheetChoices()[0];
}

/**
 * Whether «Новый мульт» offers a standing sheet first: a touch screen held
 * upright. A 16:9 sheet lying down was 246×138 px on a 390×844 phone.
 */
export function standsByDefault(view: { w: number; h: number }, coarse: boolean): boolean {
  return coarse && view.h > view.w;
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

/**
 * A sheet is called by what it is for (owner, 2026-10-05): «16:9» says
 * nothing to someone who came to draw. Keyed by the ratio as it lies.
 */
export const sheetName = (ratio: string): string => t(`sheet.name_${ratio.replace(':', '_')}`);
export const sheetAbout = (ratio: string): string => t(`sheet.about_${ratio.replace(':', '_')}`);
