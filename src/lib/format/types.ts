/**
 * Document model types.
 *
 * Model = format: serializable plain objects described by the JSON Schema
 * (schema/toon-v7.schema.json). All mutations go through the operations
 * module (../model/operations.ts).
 *
 * There is one version and no migrations: a document of any other version is
 * refused rather than guessed at.
 */

import type { StrokeGeometry } from '../render/smoothing';

export type { StrokeGeometry };

export interface PencilToolDescriptor {
  readonly kind: 'pencil';
  readonly geometry: StrokeGeometry;
  readonly width: number;
  readonly color: string;
}

export interface EraserToolDescriptor {
  readonly kind: 'eraser';
  readonly geometry: StrokeGeometry;
  readonly width: number;
}

/**
 * A closed filled shape (the oldschool pen lays one down): the points are a
 * ring, and the thickness is baked into it. No width — `kind` says the path is
 * closed and filled, whichever geometry reads the points.
 */
export interface ContourToolDescriptor {
  readonly kind: 'contour';
  readonly geometry: StrokeGeometry;
  readonly color: string;
}

export interface ContourEraserToolDescriptor {
  readonly kind: 'contour-eraser';
  readonly geometry: StrokeGeometry;
}

/**
 * The feather: the same curve as the pencil, but the path is filled with
 * `fill` before being stroked with `color`. Tonio invented it, but the curve
 * under it is whichever the brush in hand draws, so it takes any geometry.
 */
export interface FeatherToolDescriptor {
  readonly kind: 'feather';
  readonly geometry: StrokeGeometry;
  readonly width: number;
  readonly color: string;
  readonly fill: string;
}

/**
 * A stamped mark: the points are places, and `shape` is the polygon filled at
 * each of them, `width` document units across. A pixel grid is this with a
 * square, and a brush with another outline is the same primitive with another
 * polygon — the shape travels in the document as data, so the player draws it
 * without knowing where it came from.
 *
 * Its geometry is `line`: the points are the marks themselves, and there is no
 * curve under them to read.
 *
 * The polygon is closed implicitly and given on the unit square: `[0,0, 1,0,
 * 1,1, 0,1]` is the pixel cell.
 */
export interface StampToolDescriptor {
  readonly kind: 'stamp';
  readonly geometry: 'line';
  readonly width: number;
  readonly color: string;
  readonly shape: readonly number[];
}

/** The unit square — what the pixel-style stamp lays down. */
export const SQUARE_STAMP: readonly number[] = [0, 0, 1, 0, 1, 1, 0, 1];

/** Tools whose points a pointer session collects (line-like, one width). */
export type LineToolDescriptor =
  | PencilToolDescriptor
  | EraserToolDescriptor
  | FeatherToolDescriptor
  | StampToolDescriptor;

/** Immutable drawing attributes shared by strokes through tool_id. */
export type ToolDescriptor =
  | PencilToolDescriptor
  | EraserToolDescriptor
  | FeatherToolDescriptor
  | StampToolDescriptor
  | ContourToolDescriptor
  | ContourEraserToolDescriptor;

export interface Stroke {
  /**
   * Flat array of integer coordinates in fixed-point document units:
   * [x0, y0, x1, y1, …]. How they are read is the descriptor's `geometry`.
   */
  points: number[];
  tool_id: number;
}

export interface Frame {
  /** Strokes in drawing order. */
  strokes: Stroke[];
}

/** A layer: named, hideable, one cell per frame. */
export interface Layer {
  /** Hidden layers are skipped by every renderer; always present (one canonical form). */
  hidden: boolean;
  /** Display name, 1–`MAX_LAYER_NAME` characters; absent means "name by position". */
  name?: string;
  /** Cells in frame order; every layer of a document has the same length. */
  frames: Frame[];
}

export interface ToonDocument {
  schema_version: 7;
  /** Canvas width in document units (integer). */
  width: number;
  /** Canvas height in document units (integer). */
  height: number;
  /** Playback rate, frames per second (integer). */
  frame_rate: number;
  tools: ToolDescriptor[];
  /** Layers bottom-up: layers[0] renders first, the last one on top. */
  layers: Layer[];
}
