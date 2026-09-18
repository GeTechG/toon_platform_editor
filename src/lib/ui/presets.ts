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
export const PANEL_HEIGHT_MAX = 2000;

export const DEFAULT_DRAWING_UI_CONFIG: Readonly<DrawingUiConfig> = {
  activeProfile: 'multator',
  multatorWidth: 4,
  tonio: { width: 5, smooth: 3, minDistance: 3 },
  pickSource: 'canvas',
  panelHeight: PANEL_HEIGHT_MIN,
};

export interface UiConfig {
  preset: string;
  features: Features;
  drawing: DrawingUiConfig;
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
  };
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
