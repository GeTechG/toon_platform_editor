/**
 * Document model types, v1.
 *
 * Model = format: serializable plain objects described by the JSON Schema
 * (schema/toon-v1.schema.json). All mutations go through the operations
 * module (../model/operations.ts).
 */

export interface StrokeV1 {
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

export interface FrameV1 {
  /** Strokes in drawing order. */
  strokes: StrokeV1[];
}

export interface ToonDocumentV1 {
  schema_version: 1;
  /** Canvas width in document units (integer). */
  width: number;
  /** Canvas height in document units (integer). */
  height: number;
  /** Playback rate, frames per second (integer). */
  frame_rate: number;
  /** Frames in playback order; at least one. */
  frames: FrameV1[];
}

export type StrokeDialect = 'multator' | 'toonio';

export interface PencilToolDescriptor {
  readonly kind: 'pencil';
  readonly dialect: StrokeDialect;
  readonly width: number;
  readonly color: string;
}

export interface EraserToolDescriptor {
  readonly kind: 'eraser';
  readonly dialect: StrokeDialect;
  readonly width: number;
}

/**
 * Oldschool pen (the reference "old" easter egg): the stroke's points are a
 * closed contour of variable width, filled as a closed midpoint multicurve.
 * No width — the thickness is baked into the geometry.
 */
export interface ContourToolDescriptor {
  readonly kind: 'contour';
  readonly dialect: 'multator';
  readonly color: string;
}

export interface ContourEraserToolDescriptor {
  readonly kind: 'contour-eraser';
  readonly dialect: 'multator';
}

/**
 * Tonio's feather: the same midpoint curve as the pencil, but the path is
 * filled with `fill` before being stroked with `color` (tools.js Feather).
 */
export interface FeatherToolDescriptor {
  readonly kind: 'feather';
  readonly dialect: 'toonio';
  readonly width: number;
  readonly color: string;
  readonly fill: string;
}

/**
 * Tonio's pixel tool: the points are grid cells of `width` document units,
 * filled as squares with no smoothing (tools.js Pixel).
 */
export interface PixelToolDescriptor {
  readonly kind: 'pixel';
  readonly dialect: 'toonio';
  readonly width: number;
  readonly color: string;
}

/** Tools whose points a pointer session collects (line-like, one width). */
export type LineToolDescriptor =
  | PencilToolDescriptor
  | EraserToolDescriptor
  | FeatherToolDescriptor
  | PixelToolDescriptor;

/** Immutable drawing attributes shared by v2 strokes through tool_id. */
export type ToolDescriptor =
  | PencilToolDescriptor
  | EraserToolDescriptor
  | FeatherToolDescriptor
  | PixelToolDescriptor
  | ContourToolDescriptor
  | ContourEraserToolDescriptor;

export interface StrokeV2 {
  points: number[];
  tool_id: number;
}

export interface FrameV2 {
  strokes: StrokeV2[];
}

export interface ToonDocumentV2 {
  schema_version: 2;
  width: number;
  height: number;
  frame_rate: number;
  tools: ToolDescriptor[];
  frames: FrameV2[];
}

/** A layer of a v3 document: named, hideable, one cell per frame. */
export interface LayerV3 {
  /** Hidden layers are skipped by every renderer; always present (one canonical form). */
  hidden: boolean;
  /** Cells in frame order; every layer of a document has the same length. */
  frames: FrameV2[];
}

export interface ToonDocumentV3 {
  schema_version: 3;
  width: number;
  height: number;
  frame_rate: number;
  tools: ToolDescriptor[];
  /** Layers bottom-up: layers[0] renders first, the last one on top. */
  layers: LayerV3[];
}

/** v4 adds the feather and pixel tools; the document shape is v3's. */
export interface ToonDocumentV4 extends Omit<ToonDocumentV3, 'schema_version'> {
  schema_version: 4;
}

/** Current in-memory/editor model aliases. */
export type Stroke = StrokeV2;
export type Frame = FrameV2;
export type Layer = LayerV3;
export type ToonDocument = ToonDocumentV4;
