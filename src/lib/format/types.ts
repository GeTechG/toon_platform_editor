/**
 * Document model types, v1.
 *
 * Model = format: serializable plain objects described by the JSON Schema
 * (schema/toon-v1.schema.json). All mutations go through the operations
 * module (../model/operations.ts).
 */

export interface Stroke {
  /**
   * Flat array of integer coordinates in fixed-point document units:
   * [x0, y0, x1, y1, …]. A single pair is a dot.
   */
  points: number[];
  /** Line width in document units (integer ≥ 1). */
  width: number;
  /** Color `#rrggbb`, lowercase. */
  color: string;
  /** When true, the stroke erases layer alpha (destination-out); color is ignored. */
  erase?: true;
}

export interface Frame {
  /** Strokes in drawing order. */
  strokes: Stroke[];
}

export interface ToonDocument {
  schema_version: number;
  /** Canvas width in document units (integer). */
  width: number;
  /** Canvas height in document units (integer). */
  height: number;
  /** Playback rate, frames per second (integer). */
  frame_rate: number;
  /** Frames in playback order; at least one. */
  frames: Frame[];
}
