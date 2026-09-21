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

import { MAX_BRUSH_SIZE_LOGICAL, MIN_BRUSH_SIZE_LOGICAL } from '../format/constants';
import type { BrushType } from '../plugins/brush-types';
import type { BrushId } from '../plugins/brushes';
import { plugins } from '../plugins';
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
  type PresetPanels,
} from './panels';
import type { PickerModel } from './picker-model';
import { UX_PROFILES, type UxProfile, type UxProfileId } from './ux-profile';

export type { BrushId };


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
 * Whether the smoothing pair reaches a brush at all. Both numbers are applied
 * by the Tonio commit and by nothing else: a brush of the Multator canvas is
 * simplified by Lang instead, and one that collects its own points or commits
 * by its own rule never passes through either.
 */
export function brushUsesSmoothing(tool: string, brush: BrushId): boolean {
  // A brush that brought its own rules is thinned by them, whatever the panel
  // is set to; only a tool drawing by the preset's brush follows the sliders.
  if (plugins.tool(tool)?.stroke?.rules?.()) {
    return false;
  }
  return brush === 'toonio';
}

/** What a brush starts at on each canvas — the reference's own defaults. */
export const DEFAULT_BRUSH: Record<BrushId, TonioBrush> = {
  toonio: { width: 5, smooth: 3, minDistance: 3 },
  multator: { width: 4, smooth: 3, minDistance: 3 },
};

/** The same record for each brush a fresh config writes down. */
function byTool(brush: TonioBrush): Record<BrushToolId, TonioBrush> {
  return Object.fromEntries(BRUSH_TOOLS.map((tool) => [tool, { ...brush }]));
}

/**
 * What a brush width may be, in logical pixels of the canvas it is measured
 * on. Tonio's slider goes to 500, Multator's row of dots to 300 — a property
 * of the canvas, not of the brush that draws on it.
 */
export const BRUSH_RANGE: Record<BrushId, { min: number; max: number }> = {
  toonio: { min: 1, max: 500 },
  multator: { min: MIN_BRUSH_SIZE_LOGICAL, max: MAX_BRUSH_SIZE_LOGICAL },
};

export interface TonioBrush {
  width: number;
  smooth: number;
  minDistance: number;
}

export interface DrawingUiConfig {
  activeProfile: BrushId;
  /**
   * Width, smoothing and minimum per brush, on each canvas it draws on: five
   * pixels of Tonio's 1280-wide canvas are not five of Multator's 600, so a
   * brush keeps a record on each — and two brushes of one canvas keep two.
   */
  tonioByTool: Record<BrushToolId, TonioBrush>;
  multatorByTool: Record<BrushToolId, TonioBrush>;
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

export const DEFAULT_DRAWING_UI_CONFIG: Readonly<DrawingUiConfig> = {
  activeProfile: 'toonio',
  tonioByTool: byTool(DEFAULT_BRUSH.toonio),
  multatorByTool: byTool(DEFAULT_BRUSH.multator),
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
export const AUTOSAVE_LABELS: Record<number, string> = {
  10_000: '10 секунд',
  30_000: '30 секунд',
  60_000: 'минута',
  300_000: '5 минут',
  600_000: '10 минут',
  1_800_000: '30 минут',
  3_600_000: 'час',
  0: 'никогда',
};

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



// A preset owns toolbar visibility, the compatibility profile used for the
// next stroke, and the UX profile (palette, eraser rule, onion side, frame
// and playback behavior). Toonop draws the Tonio line under its own UX
// profile, which it owns outright; Multator and Toonio reproduce their
// reference editors end to end. A preset owns behaviour only — where the
// buttons sit is the arrangement's business, and the same for all of them.
/** The keys the reference draws, in its own order (`ToolPanel.hx`). */
const MULTATOR_TOOLS = ['pencil', 'eraser', 'pipette'].map((tool) => `tool:${tool}`);

export const PRESETS: {
  id: string;
  label: string;
  defaultBrush: BrushId;
  ux: UxProfileId;
  /** The brush type it opens with; the everyday one when it names none. */
  brushType?: BrushType;
  /** What it starts with, as a patch on the one arrangement. */
  panels?: PresetPanels;
}[] = [
  { id: 'toonop', label: 'Toonop', defaultBrush: 'toonio', ux: 'toonop' },
  {
    id: 'multator',
    label: 'Multator',
    defaultBrush: 'multator',
    ux: 'multator',
    // Its line is a brush type of its own now, so opening the preset is
    // picking it: the multator canvas, whatever tool is in hand.
    brushType: 'multator',
    // The reference is a smaller editor and keeps everything under the
    // canvas: frames, then the transport, then the drawing row — two colours
    // instead of the palette box, a row of dots instead of the sliders, and
    // none of the keys it never had (sound, GIF export, cell clipboard).
    //
    // Each line sits where the reference put it. The strip's line holds only
    // what acts on frames — `+` and `×` right beside it. The next line opens
    // on play and ends on the send button, with what the reference had no key
    // for (fullscreen, the gear) between them and the save note last. The
    // saves, undo, onion and fps stay on the shelf, a gesture away.
    // The drawing line reads left to right the way the reference drew it:
    // the tools, then the row of dots, then the two colour squares.
    panels: {
      base: {
        rows: [
          ['add-frame', 'delete-frame', 'timeline'],
          ['transport', 'fullscreen', 'settings', 'saved', 'publish'],
          [...MULTATOR_TOOLS, 'brush-sizes', 'color'],
        ],
      },
    },
  },
  { id: 'toonio', label: 'Toonio', defaultBrush: 'toonio', ux: 'toonio' },
];

export const DEFAULT_PRESET = 'toonop';

function presetById(id: string) {
  return PRESETS.find((preset) => preset.id === id)
    ?? PRESETS.find((preset) => preset.id === DEFAULT_PRESET)!;
}


/**
 * The canvas a preset hands to a brush that named none of its own, falling
 * back to the Toonop default. A brush with an opinion never asks.
 */
export function presetDefaultBrush(id: string): BrushId {
  return presetById(id).defaultBrush;
}

/** The brush type a preset opens with. */
export function presetBrushType(id: string): BrushType {
  return presetById(id).brushType ?? 'normal';
}

/**
 * The arrangement a preset starts from: the one default, minus what this
 * preset does not offer — including the tools its profile never draws.
 */
export function presetPanels(id: string): PanelLayout {
  const preset = presetById(id);
  let panels = panelsFrom(preset.panels);
  const ux = UX_PROFILES[preset.ux];
  for (const item of panelItems()) {
    const tool = toolOfItem(item.id);
    // Only the editor's own tools: a parity profile describes a reference
    // editor, and the reference knows nothing of plugins — a plugin one hides
    // would be a plugin nobody could ever find.
    if (tool && toolSpec(tool)?.builtin && !(ux.tools as readonly string[]).includes(tool)) {
      panels = hidePanelItem(panels, item.id);
    }
  }
  return panels;
}

/** UX profile owned by a preset, falling back to the Toonop behavior. */
export function presetUx(id: string): UxProfile {
  return UX_PROFILES[presetById(id).ux];
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
  fallbacks: Record<BrushToolId, TonioBrush>,
): Record<BrushToolId, TonioBrush> {
  const stored = record(value);
  const result: Record<BrushToolId, TonioBrush> = {};
  for (const tool of new Set([...BRUSH_TOOLS, ...Object.keys(stored)])) {
    const brush = record(stored[tool]);
    const fallback = fallbacks[tool] ?? fallbacks.pencil;
    const pick = (key: keyof TonioBrush) => brush[key] ?? shared[key];
    result[tool] = {
      width: clampNumber(pick('width'), 1, 500, fallback.width),
      smooth: clampNumber(pick('smooth'), 1, 100, fallback.smooth),
      minDistance: clampNumber(pick('minDistance'), 0, 30, fallback.minDistance),
    };
  }
  return result;
}

function normalizeDrawingConfig(value: unknown, activeProfile: BrushId): DrawingUiConfig {
  const drawing = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
  // A config from before the split holds one shared brush: every tool starts
  // from it, so nobody's width jumps on the upgrade.
  const shared = record(drawing.tonio);
  return {
    activeProfile,
    tonioByTool: normalizeBrushes(drawing.tonioByTool, shared, DEFAULT_DRAWING_UI_CONFIG.tonioByTool),
    // A config from before the split holds one width for the whole Multator
    // canvas: every brush of that canvas starts from it.
    multatorByTool: normalizeBrushes(
      drawing.multatorByTool,
      { width: drawing.multatorWidth },
      DEFAULT_DRAWING_UI_CONFIG.multatorByTool,
    ),
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
