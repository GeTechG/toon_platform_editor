/**
 * What a plugin hands the editor, and what the editor hands back.
 *
 * A plugin is one ES module with a `export default` manifest — data, not a
 * registration call, so a reviewer can see what it adds by reading it rather
 * than by running it. There is no field saying what a plugin "is written in":
 * Svelte, plain DOM or anything else is inside its bundle and not observable
 * from here, so the loader stays one loader.
 */

import type { LineToolDescriptor } from '../format/types';
import type { StrokeRules } from '../tools/profiles';

export type { StrokeRules };

/** The contract major. A manifest asking for another one is not loaded. */
export const PLUGIN_API = 1;

/** A point of the gesture, in document units. */
export interface PluginPoint {
  readonly x: number;
  readonly y: number;
}

/** A stroke of the frame, as the plugin may rewrite it. */
export interface PluginStroke {
  points: number[];
  [field: string]: unknown;
}

/**
 * The plugin's only way into the editor: data out, edits in. The editor's
 * runes state is deliberately not here — reactivity does not cross the plugin
 * boundary (plugins share a runtime with each other, not with the editor), so
 * the contract says it in words rather than leaving it to be discovered.
 */
export interface PluginHost {
  /** A node inside a floating window of the editor; it lives until the tool is left. */
  window(opts: { title: string }): HTMLElement;
  /** The strokes of the current frame on the selected, visible layers. */
  strokes(): readonly PluginStroke[];
  /** One edit of the document. Undo is the editor's business, never the plugin's. */
  edit(fn: (strokes: PluginStroke[]) => void): void;
  /** Document units → reference-canvas px (see `drawing-compatibility-profiles`). */
  referencePx(value: number): number;
}

/** The brush the editor holds when a stroke starts. */
export interface PluginBrush {
  readonly width: number;
  readonly color: string;
  readonly fill: string;
}

/**
 * What a drawing tool lays down, and how.
 *
 * `kind` is one of the primitives the format already has and the renderer
 * already draws — a plugin MUST NOT invent one. That is the whole reason a
 * plugin runs in the editor only: the player, the export and a published
 * cartoon get the raw document and draw it with the same renderer, with no
 * plugin code anywhere near them.
 *
 * Everything else here is the tool's own business and the editor holds none of
 * it: which canvas its numbers are on, how the pointer's points are collected,
 * how they are thinned when the gesture ends, and what the mega eraser does to
 * the result.
 */
export interface PluginPrimitive {
  readonly kind: LineToolDescriptor['kind'];
  /**
   * The brush's own rules, when it has them. A tool that declares none is
   * drawn by the rules of the brush its preset picked — that is what "the
   * everyday pencil follows the panel" means.
   */
  rules?(): StrokeRules | undefined;
  /** It lands on a grid: the canvas draws one, and the cursor is a cell. */
  readonly grid?: boolean;
  /**
   * What the mega eraser does to such a stroke: cut the polyline into the
   * pieces that survive, take the marks the capsule covered, or cut it around
   * its ring and close each piece again (a closed filled shape). Default `line`.
   */
  readonly cut?: 'line' | 'cells' | 'closed';
  /** The descriptor frozen into the session, built from the brush in hand. */
  descriptor(brush: PluginBrush): LineToolDescriptor;
}

/** A tool a plugin adds: how it is drawn, and what the gesture does. */
export interface PluginTool {
  readonly label: string;
  readonly title: string;
  /** The shortcut it asks for; dropped when something already holds it. */
  readonly key: string;
  /** SVG markup, drawn at the size of the editor's own icons. */
  readonly icon: string;
  /**
   * A tool that interrupts drawing instead of replacing it (the pipette, the
   * hand): leaving it hands the previous drawing tool back.
   */
  readonly help?: boolean;
  /** The CSS cursor over the canvas while this tool is in hand. */
  readonly cursor?: string;
  /**
   * A tool the arrangement never offers: it is in the register like any other,
   * but no panel and no shelf holds it, and something else takes it in hand —
   * the old brushes, picked as a type in the brush box, are the editor's own.
   */
  readonly offPanel?: boolean;
  /** What it lays down, for a tool that draws rather than reshapes. */
  readonly stroke?: PluginPrimitive;
  readonly press?: (host: PluginHost, point: PluginPoint) => void;
  readonly move?: (host: PluginHost, point: PluginPoint) => void;
  readonly release?: (host: PluginHost) => void;
  readonly activate?: (host: PluginHost) => void;
  readonly deactivate?: (host: PluginHost) => void;
}

export interface Plugin {
  readonly id: string;
  readonly api: number;
  /**
   * What the list calls it. A plugin from the catalog is described by the
   * catalog record; these are read from the manifest only for a bundle put in
   * from disk, which has no record anywhere.
   */
  readonly name?: string;
  readonly version?: string;
  readonly description?: string;
  readonly tool?: PluginTool;
}
