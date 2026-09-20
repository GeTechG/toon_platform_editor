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

import type { PickSource } from './frame-selection';
import {
  FEATURE_ITEM,
  PANEL_ITEMS,
  defaultPanels,
  hidePanelItem,
  normalizePanels,
  toolOfItem,
  type PanelLayout,
} from './panels';
import type { PickerModel } from './picker-model';
import { UX_PROFILES, type UxProfile, type UxProfileId } from './ux-profile';

export type FeatureKey =
  | 'addFrame'
  | 'deleteFrame'
  | 'timeline'
  | 'play'
  | 'export'
  | 'tools'
  | 'sizes'
  | 'color'
  | 'onionSkin';

export type Features = Record<FeatureKey, boolean>;
export type DrawingProfileId = 'multator' | 'toonio';

/** Tools that keep their own Tonio brush (reference: one record per tool). */
export type BrushToolId = 'pencil' | 'eraser' | 'feather' | 'mega-eraser';
export const BRUSH_TOOLS: readonly BrushToolId[] = ['pencil', 'eraser', 'feather', 'mega-eraser'];

/** Whose brush record a tool uses; anything that draws no line takes the pencil's. */
export function brushToolOf(tool: string): BrushToolId {
  return BRUSH_TOOLS.includes(tool as BrushToolId) ? tool as BrushToolId : 'pencil';
}

export interface TonioBrush {
  width: number;
  smooth: number;
  minDistance: number;
}

export interface DrawingUiConfig {
  activeProfile: DrawingProfileId;
  multatorWidth: number;
  /** Width, smoothing and minimum per tool; a tool keeps what it was left at. */
  tonioByTool: Record<BrushToolId, TonioBrush>;
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
export const PANEL_HEIGHT_MAX = 2000;
/**
 * Side-column range. Each side has its own floor: the tool keys reflow down
 * to a single narrow column, while the palette box is drawn at a fixed width
 * and only looks squashed under it. The ceiling keeps the canvas the widest
 * thing on the table.
 */
export const SIDE_WIDTH_MIN: Record<SideId, number> = { left: 56, right: 254 };
export const SIDE_WIDTH_MAX = 480;

export const DEFAULT_DRAWING_UI_CONFIG: Readonly<DrawingUiConfig> = {
  activeProfile: 'toonio',
  multatorWidth: 4,
  tonioByTool: {
    pencil: { width: 5, smooth: 3, minDistance: 3 },
    eraser: { width: 5, smooth: 3, minDistance: 3 },
    feather: { width: 5, smooth: 3, minDistance: 3 },
    'mega-eraser': { width: 5, smooth: 3, minDistance: 3 },
  },
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
  /** Oldschool pen for good, not only behind the "old" easter egg. */
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
}

const PICKER_MODELS: readonly PickerModel[] = ['hsv', 'rgb', 'wheel'];

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

/**
 * «Режим мышки» is one checkbox with two meanings: the Multator line takes it
 * as the oldschool pen, the Tonio line as one point per event (`oldPen`).
 */
export function mouseModeLabel(profile: DrawingProfileId): string {
  return profile === 'toonio'
    ? 'Режим мышки (точка на событие)'
    : 'Режим мышки (старое перо)';
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
  removerTipShown: false,
};

export interface UiConfig {
  preset: string;
  features: Features;
  /** What sits in each panel, in what order (see panels.ts). */
  panels: PanelLayout;
  /** Where each floating item sits, in stage coordinates. */
  floatPos: Record<string, { x: number; y: number }>;
  drawing: DrawingUiConfig;
  settings: EditorSettings;
}

/** Render/checkbox order for the customization list. */
export const FEATURE_ORDER: FeatureKey[] = [
  'addFrame',
  'deleteFrame',
  'timeline',
  'play',
  'export',
  'tools',
  'sizes',
  'color',
  'onionSkin',
];

export const FEATURE_LABELS: Record<FeatureKey, string> = {
  addFrame: 'Добавить кадр',
  deleteFrame: 'Удалить кадр',
  timeline: 'Лента кадров',
  play: 'Проигрывание',
  export: 'Экспорт в GIF',
  tools: 'Инструменты',
  sizes: 'Толщина кисти',
  color: 'Цвет',
  onionSkin: 'Калька',
};

const allOn = (off: Partial<Features> = {}): Features => ({
  addFrame: true,
  deleteFrame: true,
  timeline: true,
  play: true,
  export: true,
  tools: true,
  sizes: true,
  color: true,
  onionSkin: true,
  ...off,
});

// A preset owns toolbar visibility, the compatibility profile used for the
// next stroke, and the UX profile (palette, eraser rule, onion side, frame
// and playback behavior). Toonop draws the Tonio line under its own UX
// profile, which it owns outright; Multator and Toonio reproduce their
// reference editors end to end.
export const PRESETS: {
  id: string;
  label: string;
  features: Features;
  drawingProfile: DrawingProfileId;
  ux: UxProfileId;
}[] = [
  { id: 'toonop', label: 'Toonop', features: allOn(), drawingProfile: 'toonio', ux: 'toonop' },
  { id: 'multator', label: 'Multator', features: allOn({ export: false }), drawingProfile: 'multator', ux: 'multator' },
  { id: 'toonio', label: 'Toonio', features: allOn(), drawingProfile: 'toonio', ux: 'toonio' },
];

export const DEFAULT_PRESET = 'toonop';

function presetById(id: string) {
  return PRESETS.find((preset) => preset.id === id)
    ?? PRESETS.find((preset) => preset.id === DEFAULT_PRESET)!;
}

/** Feature map for a preset id, falling back to the default preset. Fresh copy. */
export function presetFeatures(id: string): Features {
  return { ...presetById(id).features };
}

/** Drawing profile owned by a preset, falling back to the Toonop default. */
export function presetDrawingProfile(id: string): DrawingProfileId {
  return presetById(id).drawingProfile;
}

/**
 * The arrangement a preset starts from: its layout's default, minus whatever
 * buttons the preset does not offer at all.
 */
export function presetPanels(id: string): PanelLayout {
  const features = presetFeatures(id);
  const ux = presetUx(id);
  let panels = defaultPanels(ux.layout);
  for (const key of FEATURE_ORDER) {
    if (!features[key]) {
      panels = hidePanelItem(panels, FEATURE_ITEM[key]);
    }
  }
  // A tool the profile does not draw starts put away rather than as a key
  // that renders nothing.
  for (const item of PANEL_ITEMS) {
    const tool = toolOfItem(item.id);
    if (tool && !ux.tools.includes(tool)) {
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
  if (typeof features !== 'object' || features === null) {
    return null;
  }
  // Rebuild from the preset base so missing keys are filled and unknown keys dropped.
  const normalized = presetFeatures(preset);
  for (const key of FEATURE_ORDER) {
    const value = (features as Record<string, unknown>)[key];
    if (typeof value === 'boolean') {
      normalized[key] = value;
    }
  }
  // A config written before panels existed carries visibility in the flags
  // alone: start from the preset arrangement and hide what was turned off.
  const storedPanels = (data as Record<string, unknown>).panels;
  let panels = storedPanels === undefined ? presetPanels(preset) : normalizePanels(storedPanels, presetUx(preset).layout);
  if (storedPanels === undefined) {
    for (const key of FEATURE_ORDER) {
      if (!normalized[key]) {
        panels = hidePanelItem(panels, FEATURE_ITEM[key]);
      }
    }
  }
  return {
    preset,
    features: normalized,
    panels,
    floatPos: normalizeFloatPos((data as Record<string, unknown>).floatPos),
    drawing: normalizeDrawingConfig(drawing, presetDrawingProfile(preset)),
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

function normalizeDrawingConfig(value: unknown, activeProfile: DrawingProfileId): DrawingUiConfig {
  const drawing = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
  // A config from before the split holds one shared brush: every tool starts
  // from it, so nobody's width jumps on the upgrade.
  const shared = record(drawing.tonio);
  const byTool = record(drawing.tonioByTool);
  return {
    activeProfile,
    multatorWidth: clampNumber(drawing.multatorWidth, 1, 300, DEFAULT_DRAWING_UI_CONFIG.multatorWidth),
    tonioByTool: Object.fromEntries(BRUSH_TOOLS.map((tool) => {
      const stored = record(byTool[tool]);
      const fallback = DEFAULT_DRAWING_UI_CONFIG.tonioByTool[tool];
      const pick = (key: keyof TonioBrush) => stored[key] ?? shared[key];
      return [tool, {
        width: clampNumber(pick('width'), 1, 500, fallback.width),
        smooth: clampNumber(pick('smooth'), 1, 100, fallback.smooth),
        minDistance: clampNumber(pick('minDistance'), 0, 30, fallback.minDistance),
      }];
    })) as Record<BrushToolId, TonioBrush>,
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
