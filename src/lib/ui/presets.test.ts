import { expect, test } from 'bun:test';
import {
  DEFAULT_PRESET,
  FEATURE_ORDER,
  parseUiConfig,
  presetFeatures,
} from './presets';

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

test('parseUiConfig round-trips a valid stored config', () => {
  const config = { preset: 'multator', features: presetFeatures('multator') };
  expect(parseUiConfig(JSON.stringify(config))).toEqual(config);
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
