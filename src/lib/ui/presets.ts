/**
 * UI presets: which toolbar buttons/sections the editor shows. A preset is
 * just a named map of feature flags. The user can start from a preset, toggle
 * individual buttons, and reset back to the preset's defaults. Persisted to
 * localStorage, best-effort (never throws).
 *
 * The gear (settings) button is intentionally NOT a feature — it is the escape
 * hatch that always holds the customization controls, so a config can never
 * hide the way back.
 */

import { CANVAS_LOGICAL_WIDTH, MAX_BRUSH_SIZE_LOGICAL } from '../format/constants';
import { NORMAL_BRUSH_TYPE, type BrushType } from '../plugins/brush-types';
import { plugins } from '../plugins';
import type { RegisteredPreset } from '../plugins/registry';
import type { PickSource } from './frame-selection';
import {
  FEATURE_ITEM,
  panelItems,
  hidePanelItem,
  normalizePanels,
  panelsFrom,
  toolOfItem,
  toolSpec,
  type PanelLayout,
} from './panels';
import type { PickerModel } from './picker-model';
import { type UxProfile } from './ux-profile';
import { t } from '../i18n';


/** Tools that keep their own Tonio brush (reference: one record per tool). */
export type BrushToolId = string;
/** The brushes a fresh config writes records for; the rest are filled in as they are used. */
export const BRUSH_TOOLS: readonly string[] = ['pencil', 'eraser', 'feather', 'mega-eraser'];

/**
 * Whose brush record a tool uses. Every tool that lays down a stroke has its
 * own — two brushes of one canvas are two brushes — and anything that draws no
 * line (the pipette, the hand) takes the pencil's, because a slider still has
 * to show something.
 */
export function brushToolOf(tool: string): BrushToolId {
  if (BRUSH_TOOLS.includes(tool)) {
    return tool;
  }
  return plugins.tool(tool)?.stroke ? tool : 'pencil';
}

/**
 * Whether the smoothing pair reaches a brush at all: the brush says so itself.
 * A tool without rules of its own follows the brush the preset named.
 */
export function brushUsesSmoothing(tool: string, brush: string): boolean {
  return brushRulesOf(tool, brush)?.smoothing === true;
}

/** The rules the tool in hand draws by: its own, else the preset's brush. */
export function brushRulesOf(tool: string, brush: string) {
  return plugins.probeRules(tool) ?? plugins.probeRules(brush);
}

/**
 * A copy of the brush records, to hand over or to store. Only the records
 * somebody set are in it: a brush nobody touched reads its own defaults, and
 * an empty record written for it would pin it to the editor's fallback
 * instead. A record of a brush the register no longer holds rides along — a
 * plugin taken away and put back finds its width where it left it.
 */
export function copyBrushes(source: Record<BrushToolId, BrushRecord>): Record<BrushToolId, BrushRecord> {
  return Object.fromEntries(Object.entries(source).map(([tool, brush]) => [tool, { ...brush }]));
}

/** What a brush starts at when it declares nothing of its own. */
export const FALLBACK_BRUSH: BrushRecord = { width: 4, smooth: 3, minDistance: 3 };

/** What a brush of this canvas starts at, as the brush itself says. */
export function defaultBrushOf(brush: string): BrushRecord {
  return { ...FALLBACK_BRUSH, ...plugins.probeRules(brush)?.defaults };
}

/** The same record for each brush a fresh config writes down. */
function byTool(brush: BrushRecord): Record<BrushToolId, BrushRecord> {
  return Object.fromEntries(BRUSH_TOOLS.map((tool) => [tool, { ...brush }]));
}

export interface BrushRecord {
  width: number;
  smooth: number;
  minDistance: number;
}

export interface DrawingUiConfig {
  /** The brush the preset named: the tool whose rules an unopinionated one follows. */
  defaultBrush: string;
  /**
   * Width, smoothing and minimum per brush. Every brush measures on the one
   * logical canvas, so the key is the tool and nothing else: five pixels are
   * five pixels whoever's line they are.
   */
  byTool: Record<BrushToolId, BrushRecord>;
  /** Where the pipette reads its color from: the visible composite or the active layer. */
  pickSource: PickSource;
  /** Studio bottom-panel height in CSS px, set by dragging its divider. */
  panelHeight: number;
  /** The two studio side columns, each resizable from its inner edge. */
  sides: Record<SideId, SidePanelConfig>;
  /** The bottom bar folded away to its strip. */
  panelCollapsed: boolean;
}

export type SideId = 'left' | 'right';
export const SIDE_IDS: readonly SideId[] = ['left', 'right'];

export interface SidePanelConfig {
  /** Width in CSS px, or null while the column still sizes to its contents. */
  width: number | null;
  /** Folded away to a strip with an arrow on it. */
  collapsed: boolean;
}

/**
 * Bottom-panel divider range. The floor is the panel's chrome (transport row
 * 44 + row gap 9 + padding 10) plus a timeline showing one layer: its 32px
 * frame-number header, one 44px row and the two borders. The ceiling is also
 * capped at 75vh where it is used.
 */
export const PANEL_HEIGHT_MIN = 151;
/**
 * What a soundtrack adds to that floor: the wave lane under the cells (the
 * file and its credits live in the note key's panel, off the timeline).
 * Without it, attaching a track at the floor pushes the lane out of view.
 */
export const PANEL_HEIGHT_AUDIO = 22;
/**
 * What one more row of the bottom panel adds to that floor: a 44px row plus
 * the gap above it. An arrangement with three rows cannot live in the height
 * two rows need — the last one would be cut off at the bottom edge.
 */
export const PANEL_ROW_STEP = 53;
export const PANEL_HEIGHT_MAX = 2000;
/**
 * Side-column range. Each side has its own floor: the tool keys reflow down
 * to a single narrow column, while the right one keeps room for a box that
 * is drawn as a grid of swatches — though a column holding only the plain
 * widgets (Multator's colour pair, the row of dots) may be narrowed further
 * than the box would like. The ceiling keeps the canvas the widest thing on
 * the table.
 */
export const SIDE_WIDTH_MIN: Record<SideId, number> = { left: 56, right: 120 };
export const SIDE_WIDTH_MAX = 480;

export const DEFAULT_PRESET = 'toonop';
/** The editor's own brush; a preset names its own, which may be another. */
const DEFAULT_BRUSH_TOOL = 'toonop-brush';

export const DEFAULT_DRAWING_UI_CONFIG: Readonly<DrawingUiConfig> = {
  defaultBrush: DEFAULT_BRUSH_TOOL,
  byTool: {},
  pickSource: 'canvas',
  panelHeight: PANEL_HEIGHT_MIN,
  sides: {
    left: { width: null, collapsed: false },
    right: { width: null, collapsed: false },
  },
  panelCollapsed: false,
};

/**
 * The reference's cookie-backed settings window (`index.html #settings`).
 * Every option applies immediately and is stored with the rest of the UI
 * config; a corrupted value falls back to the reference default.
 */
export interface EditorSettings {
  /** One point per pointer event: the coalesced batch is not unpacked. */
  mouseMode: boolean;
  /** Crosshair on the brush cursor at very thin and very thick widths. */
  crossCursor: boolean;
  /** Picking the pipette opens the browser's own eyedropper, where there is one. */
  chromePicker: boolean;
  /** Reference "paranoid mode": an unfinished transform blocks the editor. */
  lockTransform: boolean;
  /** A picked colour joins the saved grid. */
  paletteAutoAdd: boolean;
  /** Grid capacity, 30..300 in steps of 10. */
  paletteLimit: number;
  /** Autosave interval in ms; 0 is "never" (Ctrl+S only). */
  autosaveMs: number;
  /** Offer the saved drafts on start when there are any. */
  showDraftsOnStart: boolean;
  /** Colour model the picker opens in (reference `toonio_picker_mode`). */
  pickerModel: PickerModel;
  /** Panels left of the canvas, tool rail on the right (wide screens only). */
  altLayout: boolean;
  /**
   * Bare letters, digits and signs are hotkeys (B, E, +, …), as in the
   * reference editors. Off, only chords and non-character keys act — the way
   * out for speech input, which types letters at the page (WCAG 2.1.4).
   */
  letterKeys: boolean;
  /** The one-off hint on first entering the palette's remover mode has been shown. */
  removerTipShown: boolean;
  /**
   * Where the plugin catalog is read from (see `plugin-catalog`). Empty means
   * there is no catalog: nothing can be installed from one and not a single
   * request goes out — what is already installed goes on working from its
   * cache either way.
   */
  pluginCatalog: string;
}

const PICKER_MODELS: readonly PickerModel[] = ['hsv', 'rgb', 'wheel'];

/**
 * The catalog the editor opens with: the build branch of the plugin
 * repository, read straight from GitHub — no hosting to set up, and a cache of
 * minutes rather than of hours.
 */
export const PLUGIN_CATALOG = 'https://raw.githubusercontent.com/GeTechG/toonop_plugins/build/';

/** Offered autosave intervals, reference order; 0 is "never". */
export const AUTOSAVE_INTERVALS: readonly number[] = [
  10_000, 30_000, 60_000, 300_000, 600_000, 1_800_000, 3_600_000, 0,
];

/** What the sheet calls each interval. */
const AUTOSAVE_KEYS: Record<number, string> = {
  10_000: 'autosave.s10',
  30_000: 'autosave.s30',
  60_000: 'autosave.m1',
  300_000: 'autosave.m5',
  600_000: 'autosave.m10',
  1_800_000: 'autosave.m30',
  3_600_000: 'autosave.h1',
  0: 'autosave.never',
};

export function autosaveLabel(ms: number): string {
  const key = AUTOSAVE_KEYS[ms];
  return key ? t(key) : String(ms);
}

export const PALETTE_LIMIT_MIN = 30;
export const PALETTE_LIMIT_MAX = 300;
export const PALETTE_LIMIT_STEP = 10;

export const DEFAULT_SETTINGS: Readonly<EditorSettings> = {
  mouseMode: false,
  crossCursor: true,
  chromePicker: true,
  lockTransform: false,
  paletteAutoAdd: true,
  paletteLimit: 50,
  autosaveMs: 60_000,
  showDraftsOnStart: true,
  pickerModel: 'hsv',
  altLayout: false,
  letterKeys: true,
  removerTipShown: false,
  pluginCatalog: PLUGIN_CATALOG,
};

export interface UiConfig {
  preset: string;
  /** What sits in each panel, in what order (see panels.ts). */
  panels: PanelLayout;
  /** Where each floating item sits, in stage coordinates. */
  floatPos: Record<string, { x: number; y: number }>;
  drawing: DrawingUiConfig;
  settings: EditorSettings;
}



// A preset owns toolbar visibility, the brush drawn with next, and the UX
// profile (palette, eraser rule, onion side, frame and playback behavior).
// The editor holds its own, `toonop`, and nothing else: a preset that
// reproduces somebody else's editor arrives as a register record, brought by
// the plugin that also brings its brushes.

/** Every preset on offer: the editor's own and whatever the register holds. */
export function presets(): readonly RegisteredPreset[] {
  return plugins.presets();
}

/**
 * The preset behind an id. One whose plugin has not arrived (or has been
 * taken away) falls back to the editor's own rather than leaving it without
 * behaviour; the choice itself is not rewritten, so the plugin coming back
 * brings the preset back with it.
 */
function presetById(id: string): RegisteredPreset {
  return plugins.preset(id) ?? plugins.preset(DEFAULT_PRESET)!;
}

/** Whether the register actually holds this preset. */
export function presetExists(id: string): boolean {
  return plugins.preset(id) !== undefined;
}


/**
 * The brush a preset hands to a tool that named none of its own. A tool with
 * an opinion never asks.
 */
export function presetDefaultBrush(id: string): string {
  return presetById(id).brush;
}

/** The brush type a preset opens with. */
export function presetBrushType(id: string): BrushType {
  return presetById(id).brushType ?? NORMAL_BRUSH_TYPE;
}

/**
 * The arrangement a preset starts from: the one default, minus what this
 * preset does not offer — including the tools its profile never draws.
 */
export function presetPanels(id: string): PanelLayout {
  const preset = presetById(id);
  let panels = panelsFrom(preset.panels);
  const ux = preset.ux;
  for (const item of panelItems()) {
    const tool = toolOfItem(item.id);
    if (!tool || (ux.tools as readonly string[]).includes(tool)) {
      continue;
    }
    // Its own and the editor's, never a stranger's: a preset describes the
    // editor it reproduces, and hiding a tool the user installed themselves
    // would be hiding a tool nobody could ever find again.
    const spec = toolSpec(tool);
    if (spec && (spec.builtin || spec.plugin === preset.plugin)) {
      panels = hidePanelItem(panels, item.id);
    }
  }
  return panels;
}

/** UX profile owned by a preset, falling back to the Toonop behavior. */
export function presetUx(id: string): UxProfile {
  return presetById(id).ux;
}

/** Parses a stored config string into a normalized UiConfig, or null if invalid. */
/**
 * The catalog address of a saved config.
 *
 * Before there was a catalog the setting was the address of a register, and
 * its default was empty — there was nothing to point at. Such a config says
 * nothing about a catalog, so it gets ours; an address someone actually typed
 * is kept, and an emptied `pluginCatalog` stays empty, which is how one says
 * «no catalog» now.
 */
function readCatalogAddress(raw: Record<string, unknown>): string {
  if (typeof raw.pluginCatalog === 'string') {
    return raw.pluginCatalog.trim();
  }
  const register = typeof raw.pluginRegistry === 'string' ? raw.pluginRegistry.trim() : '';
  return register || PLUGIN_CATALOG;
}

export function parseUiConfig(raw: string | null): UiConfig | null {
  if (!raw) {
    return null;
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null) {
    return null;
  }
  const { preset, features, drawing } = data as Record<string, unknown>;
  if (typeof preset !== 'string') {
    return null;
  }
  // A config written before panels existed carried visibility in flags
  // instead: start from the arrangement and put away what was turned off.
  const storedPanels = (data as Record<string, unknown>).panels;
  let panels = storedPanels === undefined ? presetPanels(preset) : normalizePanels(storedPanels);
  if (storedPanels === undefined && typeof features === 'object' && features !== null) {
    for (const [key, id] of Object.entries(FEATURE_ITEM)) {
      if ((features as Record<string, unknown>)[key] === false) {
        panels = hidePanelItem(panels, id);
      }
    }
  }
  return {
    preset,
    panels,
    floatPos: normalizeFloatPos((data as Record<string, unknown>).floatPos),
    drawing: normalizeDrawingConfig(drawing, presetDefaultBrush(preset)),
    settings: normalizeSettings((data as Record<string, unknown>).settings),
  };
}

/** Stored float positions: finite numbers only, anything else dropped. */
function normalizeFloatPos(value: unknown): Record<string, { x: number; y: number }> {
  const stored = record(value);
  const out: Record<string, { x: number; y: number }> = {};
  for (const [id, pos] of Object.entries(stored)) {
    const { x, y } = record(pos);
    if (typeof x === 'number' && Number.isFinite(x) && typeof y === 'number' && Number.isFinite(y)) {
      out[id] = { x: Math.max(0, Math.round(x)), y: Math.max(0, Math.round(y)) };
    }
  }
  return out;
}

function normalizeSettings(value: unknown): EditorSettings {
  const raw = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
  const flag = (key: keyof EditorSettings): boolean =>
    typeof raw[key] === 'boolean' ? raw[key] as boolean : DEFAULT_SETTINGS[key] as boolean;
  return {
    mouseMode: flag('mouseMode'),
    crossCursor: flag('crossCursor'),
    chromePicker: flag('chromePicker'),
    lockTransform: flag('lockTransform'),
    paletteAutoAdd: flag('paletteAutoAdd'),
    paletteLimit: snapPaletteLimit(raw.paletteLimit),
    // An interval the UI cannot offer would be unchangeable from the sheet.
    autosaveMs: AUTOSAVE_INTERVALS.includes(raw.autosaveMs as number)
      ? raw.autosaveMs as number
      : DEFAULT_SETTINGS.autosaveMs,
    showDraftsOnStart: flag('showDraftsOnStart'),
    pickerModel: PICKER_MODELS.includes(raw.pickerModel as PickerModel)
      ? raw.pickerModel as PickerModel
      : DEFAULT_SETTINGS.pickerModel,
    altLayout: flag('altLayout'),
    letterKeys: flag('letterKeys'),
    removerTipShown: flag('removerTipShown'),
    pluginCatalog: readCatalogAddress(raw),
  };
}

/** Clamps to the slider range and snaps to its step, so the sheet can show the value. */
export function snapPaletteLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_SETTINGS.paletteLimit;
  }
  const stepped = Math.round(value / PALETTE_LIMIT_STEP) * PALETTE_LIMIT_STEP;
  return Math.min(PALETTE_LIMIT_MAX, Math.max(PALETTE_LIMIT_MIN, stepped));
}

/**
 * Brush records as they come back from storage: what a brush was left at,
 * falling back to what the whole canvas shared before the split, and then to
 * the default. Records of brushes the register no longer holds ride along —
 * a plugin taken away and put back finds its width where it left it.
 */
function normalizeBrushes(
  value: unknown,
  shared: Record<string, unknown>,
  fallbacks: Record<BrushToolId, BrushRecord>,
): Record<BrushToolId, BrushRecord> {
  const stored = record(value);
  const result: Record<BrushToolId, BrushRecord> = {};
  for (const tool of new Set([...BRUSH_TOOLS, ...Object.keys(stored)])) {
    const brush = record(stored[tool]);
    const fallback = fallbacks[tool] ?? fallbacks.pencil;
    const pick = (key: keyof BrushRecord) => brush[key] ?? shared[key];
    result[tool] = {
      width: clampNumber(pick('width'), 1, MAX_BRUSH_SIZE_LOGICAL, fallback.width),
      smooth: clampNumber(pick('smooth'), 1, 100, fallback.smooth),
      minDistance: clampNumber(pick('minDistance'), 0, 30, fallback.minDistance),
    };
  }
  return result;
}

/**
 * A config written when the brush records were keyed by the name of the
 * editor each reference brush came from, and then by the width of its canvas.
 * Nothing else here turns a name into a number; this is the migration, and it
 * ends the moment the config is written back.
 */
const LEGACY: readonly { canvas: string; byTool: string; shared: string }[] = [
  { canvas: '1280', byTool: 'tonioByTool', shared: 'tonio' },
  { canvas: '600', byTool: 'multatorByTool', shared: 'multatorWidth' },
];

/** One canvas bucket of a config from before the one canvas, unnormalised. */
interface CanvasBucket {
  canvas: number;
  /** Stored brushes, each still as it was written down. */
  brushes: Record<BrushToolId, Record<string, unknown>>;
}

/**
 * The buckets of a config keyed by canvas width, brought to the one canvas:
 * a width measured on a 600-wide canvas is 1280/600 of ours. Buckets are read
 * widest last, so where two of them held a tool the record of the editor's
 * own canvas is the one that stands.
 */
function fromCanvasBuckets(buckets: readonly CanvasBucket[]): Record<BrushToolId, Record<string, unknown>> {
  const merged: Record<BrushToolId, Record<string, unknown>> = {};
  for (const { canvas, brushes } of [...buckets].sort((a, b) => a.canvas - b.canvas)) {
    const scale = canvas > 0 ? CANVAS_LOGICAL_WIDTH / canvas : 1;
    for (const [tool, brush] of Object.entries(brushes)) {
      merged[tool] = typeof brush.width === 'number'
        ? { ...brush, width: Math.round(brush.width * scale) }
        : { ...brush };
    }
  }
  return merged;
}

/**
 * The brushes of one bucket as they were written. `shared` is the one record
 * a config from before the per-tool split held for the whole canvas: every
 * tool starts from it, so nobody's width jumps on the upgrade. Without one,
 * only the tools actually stored are taken — a bucket MUST NOT overwrite
 * another one's record with a default nobody chose.
 */
function storedBrushes(value: unknown, shared?: Record<string, unknown>): Record<BrushToolId, Record<string, unknown>> {
  const stored = record(value);
  const tools = shared ? new Set([...BRUSH_TOOLS, ...Object.keys(stored)]) : new Set(Object.keys(stored));
  return Object.fromEntries([...tools].map((tool) => [tool, { ...shared, ...record(stored[tool]) }]));
}

/**
 * Nothing written down stays nothing: a brush met for the first time reads
 * its own defaults, and filling the set here would hand it somebody else's.
 */
function brushRecords(stored: Record<string, unknown>): Record<BrushToolId, BrushRecord> {
  return Object.keys(stored).length > 0 ? normalizeBrushes(stored, {}, byTool(FALLBACK_BRUSH)) : {};
}

function normalizeDrawingConfig(value: unknown, defaultBrush: string): DrawingUiConfig {
  const drawing = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
  const buckets: CanvasBucket[] = Object.entries(record(drawing.byCanvas))
    .map(([canvas, stored]) => ({ canvas: Number(canvas), brushes: storedBrushes(stored) }));
  for (const { canvas, byTool: legacy, shared } of LEGACY) {
    if (drawing[legacy] === undefined && drawing[shared] === undefined) {
      continue;
    }
    const one = shared === 'tonio' ? record(drawing.tonio) : { width: drawing.multatorWidth };
    buckets.push({ canvas: Number(canvas), brushes: storedBrushes(drawing[legacy], one) });
  }
  return {
    defaultBrush,
    byTool: brushRecords(drawing.byTool !== undefined ? record(drawing.byTool) : fromCanvasBuckets(buckets)),
    pickSource: drawing.pickSource === 'layer' ? 'layer' : DEFAULT_DRAWING_UI_CONFIG.pickSource,
    panelHeight: clampNumber(
      drawing.panelHeight,
      PANEL_HEIGHT_MIN,
      PANEL_HEIGHT_MAX,
      DEFAULT_DRAWING_UI_CONFIG.panelHeight,
    ),
    sides: parseSides(drawing.sides),
    panelCollapsed: drawing.panelCollapsed === true,
  };
}

function parseSides(value: unknown): Record<SideId, SidePanelConfig> {
  const stored = record(value);
  return Object.fromEntries(SIDE_IDS.map((side) => {
    const saved = record(stored[side]);
    return [side, {
      width: typeof saved.width === 'number' && Number.isFinite(saved.width)
        ? clampNumber(saved.width, SIDE_WIDTH_MIN[side], SIDE_WIDTH_MAX, SIDE_WIDTH_MIN[side])
        : null,
      collapsed: saved.collapsed === true,
    }];
  })) as Record<SideId, SidePanelConfig>;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback;
}

const STORAGE_KEY = 'toon-editor:ui';

/** Loads the saved UI config, or null if none / on any failure. */
export function loadUiConfig(): UiConfig | null {
  try {
    return parseUiConfig(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

/** Persists the UI config. Best-effort — never throws. */
export function saveUiConfig(config: UiConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // private mode / blocked storage — degrade to no-op.
  }
}
