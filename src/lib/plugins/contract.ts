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

/**
 * The contract major. A manifest asking for another one is not loaded.
 *
 * A plugin of the catalog writes this number out rather than importing it —
 * a substituted major reflects the contract instead of declaring anything.
 * The editor's own tools and the plugin of its delivery may read it: they are
 * changed by the same commit as the contract and cannot drift from it.
 *
 * It holds where it is while the contract is still being shaped: a breaking
 * change arrives without a new number, because there is nothing out there to
 * break — the plugins are ours and there is one of them. Moving it earns its
 * keep the day the editor can read an older manifest and bring it to the
 * current shape; a number without that promises a compatibility that is not
 * there.
 */
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
}

/**
 * The brush record the editor holds for the tool in hand. The two thinning
 * numbers are in it because they are the brush's own knobs, not a channel of
 * their own: a brush that uses neither simply says so (`smoothing`).
 */
export interface PluginBrush {
  readonly width: number;
  readonly color: string;
  readonly fill: string;
  readonly smooth: number;
  readonly minDistance: number;
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
   *
   * `canvas`, `range`, `defaults` and `smoothing` of what comes back MUST NOT
   * depend on the argument: the editor reads them with a neutral brush to
   * work out which record to hand over, and a dependency would make that a
   * chicken and an egg.
   */
  rules?(brush: PluginBrush): StrokeRules | undefined;
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

/**
 * The UX profile of a preset: everything it changes about how the editor
 * behaves beyond the line the brush draws. Pure data, so a preset can bring
 * its own without the editor holding a table of them.
 */
export interface UxProfile {
  /** Two-swatch quick palette shown while the full picker is collapsed; null = always the full picker. */
  readonly quickPalette: readonly string[] | null;
  /** White is the eraser marker: choosing it (or the pencil while white) arms the eraser. */
  readonly whiteIsEraser: boolean;
  /** The pipette is only offered while the full palette is expanded. */
  readonly pipetteNeedsPalette: boolean;
  /**
   * The pipette is not a rail button: the reference keeps it in the palette's
   * foot alone (`E:205-208`). It stays reachable by P and by that button.
   */
  readonly pipetteOffRail: boolean;
  /** Which neighbors the onion skin shows (only read in the 'neighbors' mode). */
  readonly onionSides: 'both' | 'previous';
  /** Onion model: fading neighbors, or Tonio's last visited frames. */
  readonly onionMode: 'neighbors' | 'history';
  /** A persistent grid of saved colors next to the picker (Tonio). */
  readonly colorGrid: boolean;
  /** Allowed player fps range. */
  readonly fpsRange: readonly [number, number];
  /** The pipette follows the pointer with a live color swatch (Tonio). */
  readonly livePipettePreview: boolean;
  /** Cursor draws a crosshair for very thin and very thick brushes (Tonio). */
  readonly crossCursor: boolean;
  /** Tools the preset's starting arrangement places, in toolbar order. */
  readonly tools: readonly string[];
  /** Opacity the active frame (with its live stroke) is composited at. */
  readonly activeFrameAlpha: number;
  /** Which neighbor becomes active after deleting a frame. */
  readonly afterRemove: 'next' | 'previous';
  /** Playback starts from the first frame instead of the active one. */
  readonly playFromStart: boolean;
  /**
   * What Space plays: the whole document, or (Tonio) the frame selection when
   * it spans more than one frame — with a one-frame document refusing to play.
   */
  readonly playbackRange: 'document' | 'selection';
  /** Where a new layer lands relative to the active one; Ctrl inverts it. */
  readonly newLayerPosition: 'above' | 'below';
  /** A new stroke leaves the redo buffer alone (Tonio) instead of clearing it. */
  readonly redoSurvivesStroke: boolean;
  /** Frame rate a fresh document gets under this preset. */
  readonly defaultFps: number;
  /** Upper bound for the +/- brush nudge (logical px). */
  readonly brushSizeMax: number;
  /** Adaptive +/- step (1 below 10, 5 below 50, else 10) instead of a flat 1. */
  readonly adaptiveBrushStep: boolean;
  /**
   * How the editor's canvas is rasterised. `device` takes the screen's
   * `devicePixelRatio`; `document` takes one bitmap pixel per document pixel,
   * the way toonio.ru draws into a fixed 1280×720 bitmap the browser then
   * scales. It is the preset's, not the brush's: a document has one bitmap.
   */
  readonly canvasDensity: 'device' | 'document';
  /** Alt+S downloads the project as a file instead of opening the export. */
  readonly projectFile: boolean;
}

/**
 * A preset: what the editor behaves like. Everything in it is data — the UX
 * profile whole, not the name of one kept in a table here.
 */
export interface PluginPreset {
  readonly label: string;
  /** Default brush: the tool whose rules a tool without its own follows. */
  readonly brush: string;
  /** The brush type it opens with; the everyday one when it names none. */
  readonly brushType?: string;
  readonly ux: UxProfile;
  /** What it starts with, as a patch on the one arrangement. */
  readonly panels?: PluginPanels;
}

/** A patch on the editor's one arrangement (see `ui/panels.ts`). */
export interface PluginPanels {
  readonly base?: { left?: string[]; right?: string[]; rows?: string[][]; float?: string[] };
  readonly hide?: readonly string[];
  readonly swap?: readonly (readonly [string, string])[];
}

/**
 * A type the brush in hand can be switched to: the everyday tool and the one
 * that stands in for it. "Обычная" is the editor's own and means "no twins".
 */
export interface PluginBrushType {
  readonly label: string;
  /** One line on what it draws, for the list that offers it. */
  readonly hint?: string;
  readonly twins: Readonly<Record<string, string>>;
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
  /**
   * The tools it brings, keyed by the id each takes in the register. One
   * plugin may bring several; a manifest that brings no tool, no preset and
   * no brush type is not loaded.
   */
  readonly tools?: Readonly<Record<string, PluginTool>>;
  readonly presets?: Readonly<Record<string, PluginPreset>>;
  readonly brushTypes?: Readonly<Record<string, PluginBrushType>>;
}
