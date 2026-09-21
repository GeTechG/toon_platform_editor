/**
 * The icons this plugin's tools draw with.
 *
 * A plugin cannot write into the editor's icon vocabulary, so it brings
 * markup: a path on the same 24-unit grid, stroked by the editor at the size
 * of its own icons. These three are the editor's own shapes, copied here so
 * the twins of the pencil and the eraser read as what they stand in for.
 */

const path = (d: string) => `<path d="${d}" />`;

export const PENCIL_ICON = path(
  'M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497zM15 5l4 4',
);

export const ERASER_ICON = path(
  'M21 21H8a2 2 0 0 1-1.42-.587l-3.994-3.999a2 2 0 0 1 0-2.828l10-10a2 2 0 0 1 2.829 0l5.999 6a2 2 0 0 1 0 2.828L12.834 21M5.082 11.09l8.828 8.828',
);

export const PIXEL_ICON = path('M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z');
