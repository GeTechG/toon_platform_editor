/**
 * Document model types.
 *
 * Model = format: serializable plain objects described by the JSON Schema
 * (schema/toon-v8.schema.json). All mutations go through the operations
 * module (../model/operations.ts).
 *
 * The editor writes one version. The one before it is translated once on load
 * (`v7.ts`); any other version is refused rather than guessed at.
 */

import type { StrokeGeometry } from '../render/smoothing';

export type { StrokeGeometry };

interface PaintOpacity {
  /**
   * How strongly the stroke paints, a whole percent 1–99. Absent — opaque:
   * 100 is never stored, so one look has one descriptor.
   */
  readonly opacity?: number;
  /** False applies the opacity once to consecutive strokes of the same paint. */
  readonly buildup?: false;
}

export interface PencilToolDescriptor extends PaintOpacity {
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
export interface ContourToolDescriptor extends PaintOpacity {
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
export interface FeatherToolDescriptor extends PaintOpacity {
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
export interface StampToolDescriptor extends PaintOpacity {
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

/**
 * A tool's opacity, as a spread — or nothing for an opaque one and for a tool
 * that paints nothing: 100 is the absent field, in one place.
 */
export function opacityOf(tool: ToolDescriptor): PaintOpacity {
  if (!('color' in tool) || tool.opacity === undefined || tool.opacity >= 100) return {};
  return tool.buildup === false ? { opacity: tool.opacity, buildup: false } : { opacity: tool.opacity };
}

export interface Stroke {
  /**
   * Flat array of integer coordinates in fixed-point document units:
   * [x0, y0, x1, y1, …]. How they are read is the descriptor's `geometry`.
   */
  points: number[];
  tool_id: number;
  /**
   * Pen pressure, one integer 0–`PRESSURE_MAX` per point. Absent — the stroke
   * is its tool's width all along, exactly as before the field existed.
   */
  pressure?: number[];
}

export interface Frame {
  /** Strokes in drawing order. */
  strokes: Stroke[];
  /** A cropped still on a raster layer, absent for an empty cell. */
  raster?: RasterCel;
}

/** Crop coordinates in logical sheet pixels. Identical bytes share a hash at any position. */
export interface RasterCel {
  readonly hash: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The blend modes a layer may take: W3C Compositing and Blending Level 1, in
 * the order the layer box lists them — darken, lighten, contrast, difference,
 * colour. The names are canvas `globalCompositeOperation` values as they are.
 */
export const BLEND_MODES = [
  'multiply', 'color-burn', 'darken',
  'screen', 'color-dodge', 'lighten',
  'overlay', 'soft-light', 'hard-light',
  'difference', 'exclusion',
  'hue', 'saturation', 'color', 'luminosity',
] as const;

export type BlendMode = (typeof BLEND_MODES)[number];

/**
 * A layer's cell on one tick: a drawing, or `null` — a continuation, which
 * shows the layer's nearest drawing before it. The first cell of a layer is
 * never a continuation; an empty start is an empty drawing.
 */
export type Cell = Frame | null;

/** A layer: named, hideable, one cell per tick. */
export interface Layer {
  /** Local studio extension. An absent kind is a vector layer. */
  kind?: 'raster';
  /** Hidden layers are skipped by every renderer; always present (one canonical form). */
  hidden: boolean;
  /** Display name, 1–`MAX_LAYER_NAME` characters; absent means "name by position". */
  name?: string;
  /**
   * How strongly the whole layer shows, an integer percent 0–99. Absent — opaque;
   * 100 is never stored (one canonical form). 0 is invisible, not hidden.
   */
  opacity?: number;
  /** How the layer is laid over what lies under it, paper included. Absent — normal, never stored. */
  blend?: BlendMode;
  /** Cells in tick order; every layer of a document has the same length. */
  frames: Cell[];
}

export interface ToonDocument {
  schema_version: 8;
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
