/**
 * The colour tag on a layer row. Six swatches (`--layer-tag-0..5` in the
 * editor's chrome); a layer picks one and keeps it, so reordering the stack
 * no longer repaints every row. The colour is session state, not document
 * state — the file format has no field for it, so it rides in the draft
 * record beside the tool widths.
 */
export const LAYER_TAGS = 6;

/** What a document starts with: the cycle the rows had before they were pickable. */
export function defaultLayerColors(count: number): number[] {
  return Array.from({ length: count }, (_, i) => i % LAYER_TAGS);
}

/** Colours read back for a document of `count` layers; anything unusable defaults. */
export function normalizeLayerColors(saved: unknown, count: number): number[] {
  const list = Array.isArray(saved) ? saved : [];
  return defaultLayerColors(count).map((fallback, i) =>
    Number.isInteger(list[i]) && list[i] >= 0 && list[i] < LAYER_TAGS ? (list[i] as number) : fallback,
  );
}
