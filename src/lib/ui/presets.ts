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

export interface UiConfig {
  preset: string;
  features: Features;
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
  addFrame: 'Add frame',
  deleteFrame: 'Delete frame',
  timeline: 'Timeline',
  play: 'Play',
  export: 'Export GIF',
  tools: 'Tools',
  sizes: 'Brush sizes',
  color: 'Color',
  onionSkin: 'Onion skin',
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

// ponytail: the multator/toonio button sets below are placeholders — one place
// to tune. toonop (default) shows everything.
export const PRESETS: { id: string; label: string; features: Features }[] = [
  { id: 'toonop', label: 'Toonop', features: allOn() },
  { id: 'multator', label: 'Multator', features: allOn({ export: false }) },
  { id: 'toonio', label: 'Toonio', features: allOn({ onionSkin: false }) },
];

export const DEFAULT_PRESET = 'toonop';

/** Feature map for a preset id, falling back to the default preset. Fresh copy. */
export function presetFeatures(id: string): Features {
  const preset =
    PRESETS.find((p) => p.id === id) ?? PRESETS.find((p) => p.id === DEFAULT_PRESET)!;
  return { ...preset.features };
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
  const { preset, features } = data as Record<string, unknown>;
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
  return { preset, features: normalized };
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
