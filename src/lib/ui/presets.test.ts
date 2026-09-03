import { expect, test } from 'bun:test';
import {
  DEFAULT_DRAWING_UI_CONFIG,
  DEFAULT_PRESET,
  FEATURE_ORDER,
  PRESETS,
  parseUiConfig,
  presetDrawingProfile,
  presetFeatures,
  presetUx,
} from './presets';
import { UX_PROFILES } from './ux-profile';

test('the default preset shows every button', () => {
  const features = presetFeatures(DEFAULT_PRESET);
  for (const key of FEATURE_ORDER) {
    expect(features[key]).toBe(true);
  }
});

test('an unknown preset falls back to the default preset', () => {
  expect(presetFeatures('nope')).toEqual(presetFeatures(DEFAULT_PRESET));
});

test('presetFeatures returns a fresh object each call (no shared mutation)', () => {
  const a = presetFeatures(DEFAULT_PRESET);
  a.tools = false;
  expect(presetFeatures(DEFAULT_PRESET).tools).toBe(true);
});

test('compatibility presets select their drawing profile through existing preset logic', () => {
  expect(PRESETS.find((preset) => preset.id === 'toonop')?.drawingProfile).toBe('multator');
  expect(PRESETS.find((preset) => preset.id === 'multator')?.drawingProfile).toBe('multator');
  expect(PRESETS.find((preset) => preset.id === 'toonio')?.drawingProfile).toBe('toonio');
});

test('each preset owns a UX profile: Multator reproduces the reference, others keep toonop', () => {
  expect(presetUx('multator')).toBe(UX_PROFILES.multator);
  expect(presetUx('toonop')).toBe(UX_PROFILES.toonop);
  expect(presetUx('toonio')).toBe(UX_PROFILES.toonop);
});

test('UX profile lookup falls back to toonop for an unknown preset', () => {
  expect(presetUx('nope')).toBe(UX_PROFILES.toonop);
});

test('preset drawing profile lookup falls back to the Toonop profile', () => {
  expect(presetDrawingProfile('toonio')).toBe('toonio');
  expect(presetDrawingProfile('nope')).toBe('multator');
});

test('parseUiConfig round-trips a valid stored config', () => {
  const config = {
    preset: 'multator',
    features: presetFeatures('multator'),
    drawing: {
      activeProfile: 'multator' as const,
      multatorWidth: 10,
      tonio: { width: 5, smooth: 3, minDistance: 3 },
    },
  };
  expect(parseUiConfig(JSON.stringify(config))).toEqual(config);
});

test('stored drawing profile is normalized to the selected preset', () => {
  const parsed = parseUiConfig(JSON.stringify({
    preset: 'toonio',
    features: presetFeatures('toonio'),
    drawing: {
      activeProfile: 'multator',
      multatorWidth: 4,
      tonio: { width: 7, smooth: 4, minDistance: 2 },
    },
  }));
  expect(parsed?.drawing.activeProfile).toBe('toonio');
});

test('old UI config migrates to independent safe profile defaults', () => {
  const old = { preset: 'toonop', features: presetFeatures('toonop') };
  expect(parseUiConfig(JSON.stringify(old))?.drawing).toEqual(DEFAULT_DRAWING_UI_CONFIG);
});

test('drawing profile settings are clamped to supported ranges', () => {
  const parsed = parseUiConfig(JSON.stringify({
    preset: 'toonop',
    features: presetFeatures('toonop'),
    drawing: { activeProfile: 'bad', multatorWidth: -4, tonio: { width: 999, smooth: 0, minDistance: 99 } },
  }));
  expect(parsed?.drawing).toEqual({
    activeProfile: 'multator',
    multatorWidth: 1,
    tonio: { width: 500, smooth: 1, minDistance: 30 },
  });
});

test('parseUiConfig rejects null, garbage, and non-config JSON', () => {
  expect(parseUiConfig(null)).toBeNull();
  expect(parseUiConfig('not json')).toBeNull();
  expect(parseUiConfig('42')).toBeNull();
  expect(parseUiConfig('{"features":{}}')).toBeNull(); // missing preset
  expect(parseUiConfig('{"preset":"toonop"}')).toBeNull(); // missing features
});

test('parseUiConfig normalizes missing/unknown keys against the preset base', () => {
  const parsed = parseUiConfig(
    JSON.stringify({ preset: 'toonop', features: { tools: false, bogus: true } }),
  );
  expect(parsed?.preset).toBe('toonop');
  expect(parsed?.features.tools).toBe(false); // kept
  expect(parsed?.features.play).toBe(true); // missing → filled from preset
  expect('bogus' in (parsed?.features ?? {})).toBe(false); // unknown → dropped
});
