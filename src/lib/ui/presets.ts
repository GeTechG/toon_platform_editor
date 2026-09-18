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
  | 'onionSkin'
  | 'layers';

export type Features = Record<FeatureKey, boolean>;
export type DrawingProfileId = 'multator' | 'toonio';

export interface DrawingUiConfig {
  activeProfile: DrawingProfileId;
  multatorWidth: number;
  tonio: { width: number; smooth: number; minDistance: number };
  /** Where the pipette reads its color from: the visible composite or the active layer. */
  pickSource: PickSource;
  /** Studio bottom-panel height in CSS px, set by dragging its divider. */
  panelHeight: number;
}

/**
 * Bottom-panel divider range. The floor is the panel's chrome (transport row
 * 44 + row gap 9 + padding 10) plus a timeline showing one layer: its 32px
 * frame-number header, one 44px row and the two borders. The ceiling is also
 * capped at 75vh where it is used.
 */
export const PANEL_HEIGHT_MIN = 151;
/**
 * What a soundtrack adds to that floor: the track strip (a key row plus its
 * top padding) and the wave lane under the cells. Without it, attaching a
 * track at the floor squeezes the layer rows and the wave out of the panel.
 */
export const PANEL_HEIGHT_AUDIO = 66;
export const PANEL_HEIGHT_MAX = 2000;

export const DEFAULT_DRAWING_UI_CONFIG: Readonly<DrawingUiConfig> = {
  activeProfile: 'multator',
  multatorWidth: 4,
  tonio: { width: 5, smooth: 3, minDistance: 3 },
  pickSource: 'canvas',
  panelHeight: PANEL_HEIGHT_MIN,
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
  theme: 'light' | 'dark';
  /** Grey stage under the drawing in the dark theme; the document stays white. */
  greyCanvas: boolean;
}

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
  lockTransform: false,
  paletteAutoAdd: true,
  paletteLimit: 50,
  autosaveMs: 60_000,
  showDraftsOnStart: true,
  theme: 'light',
  greyCanvas: true,
};

export interface UiConfig {
  preset: string;
  features: Features;
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
  'layers',
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
  layers: 'Слои',
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
  layers: true,
  ...off,
});

// A preset owns toolbar visibility, the compatibility profile used for the
// next stroke, and the UX profile (palette, eraser rule, onion side, frame
// and playback behavior). Toonop keeps the Multator-compatible line with the
// editor's own UX; Multator reproduces the reference editor end to end.
export const PRESETS: {
  id: string;
  label: string;
  features: Features;
  drawingProfile: DrawingProfileId;
  ux: UxProfileId;
}[] = [
  { id: 'toonop', label: 'Toonop', features: allOn(), drawingProfile: 'multator', ux: 'toonop' },
  { id: 'multator', label: 'Multator', features: allOn({ export: false, layers: false }), drawingProfile: 'multator', ux: 'multator' },
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
  return {
    preset,
    features: normalized,
    drawing: normalizeDrawingConfig(drawing, presetDrawingProfile(preset)),
    settings: normalizeSettings((data as Record<string, unknown>).settings),
  };
}

function normalizeSettings(value: unknown): EditorSettings {
  const raw = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
  const flag = (key: keyof EditorSettings): boolean =>
    typeof raw[key] === 'boolean' ? raw[key] as boolean : DEFAULT_SETTINGS[key] as boolean;
  return {
    mouseMode: flag('mouseMode'),
    crossCursor: flag('crossCursor'),
    lockTransform: flag('lockTransform'),
    paletteAutoAdd: flag('paletteAutoAdd'),
    paletteLimit: snapPaletteLimit(raw.paletteLimit),
    // An interval the UI cannot offer would be unchangeable from the sheet.
    autosaveMs: AUTOSAVE_INTERVALS.includes(raw.autosaveMs as number)
      ? raw.autosaveMs as number
      : DEFAULT_SETTINGS.autosaveMs,
    showDraftsOnStart: flag('showDraftsOnStart'),
    theme: raw.theme === 'dark' ? 'dark' : DEFAULT_SETTINGS.theme,
    greyCanvas: flag('greyCanvas'),
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
  const tonio = typeof drawing.tonio === 'object' && drawing.tonio !== null
    ? drawing.tonio as Record<string, unknown>
    : {};
  return {
    activeProfile,
    multatorWidth: clampNumber(drawing.multatorWidth, 1, 300, DEFAULT_DRAWING_UI_CONFIG.multatorWidth),
    tonio: {
      width: clampNumber(tonio.width, 1, 500, DEFAULT_DRAWING_UI_CONFIG.tonio.width),
      smooth: clampNumber(tonio.smooth, 1, 100, DEFAULT_DRAWING_UI_CONFIG.tonio.smooth),
      minDistance: clampNumber(tonio.minDistance, 0, 30, DEFAULT_DRAWING_UI_CONFIG.tonio.minDistance),
    },
    pickSource: drawing.pickSource === 'layer' ? 'layer' : DEFAULT_DRAWING_UI_CONFIG.pickSource,
    panelHeight: clampNumber(
      drawing.panelHeight,
      PANEL_HEIGHT_MIN,
      PANEL_HEIGHT_MAX,
      DEFAULT_DRAWING_UI_CONFIG.panelHeight,
    ),
  };
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
