import { expect, test } from 'bun:test';

import { SQUARE_STAMP } from '../format/types';
import { plugins } from '../plugins';
import { PLUGIN_API } from '../plugins/contract';
import { defaultBrushOf } from './presets';
import { PREVIEW_BOX, PREVIEW_GESTURE, brushPreview } from './brush-preview';

/** The editor's own brush, at what it starts on. */
const BRUSH = 'toonop-brush';
const SETTINGS = defaultBrushOf(BRUSH);

test('the everyday brush previews as a line of the brush width', () => {
  const preview = brushPreview('pencil', BRUSH, 4, SETTINGS);
  expect(preview.fill).toBe(false);
  expect(preview.d.startsWith('M')).toBe(true);
  expect(preview.width).toBe(32);
});

test('a brush with rules of its own previews its own line, not the preset one', () => {
  plugins.register({
    id: 'test.coarse',
    api: PLUGIN_API,
    tools: {
      'test.coarse': {
        label: 'Грубая', title: 'Грубая', key: '', icon: '<path />',
        stroke: {
          kind: 'pencil',
          // One point per event and nothing else: a line of its own shape.
          rules: () => ({
            capture: (_line: readonly number[], batch: readonly number[]) =>
              batch.length < 2 ? [] : [batch[batch.length - 2], batch[batch.length - 1]],
          }),
          descriptor: ({ width, color }: { width: number; color: string }) =>
            ({ kind: 'pencil', geometry: 'smooth', width, color }),
        },
      },
    },
  });

  const own = brushPreview('test.coarse', BRUSH, 4, SETTINGS);
  const everyday = brushPreview('pencil', BRUSH, 4, SETTINGS);
  expect(own.d).not.toBe(everyday.d);
  expect(own.fill).toBe(false);
});

test('a brush that stamps marks has no line to show', () => {
  // The sample is the path the renderer emits for a line; a brush that stamps
  // a mark per cell draws no line at all, and one through their centres would
  // be a picture of something it never makes.
  plugins.register({
    id: 'test.stamp',
    api: PLUGIN_API,
    tools: {
      'test.stamp': {
        label: 'Штамп', title: 'Штамп', key: '', icon: '<path />',
        stroke: {
          kind: 'stamp',
          descriptor: ({ width, color }: { width: number; color: string }) =>
            ({ kind: 'stamp', geometry: 'line', width, color, shape: [...SQUARE_STAMP] }),
        },
      },
    },
  });

  expect(brushPreview('test.stamp', BRUSH, 8, SETTINGS).d).toBe('');
});

test('the mega-eraser has no sample: it erases along the gesture and lays no line', () => {
  expect(brushPreview('mega-eraser', BRUSH, 8, SETTINGS).d).toBe('');
  // A help tool shows the pencil whose record it edits.
  expect(brushPreview('pipette', BRUSH, 8, SETTINGS).d).not.toBe('');
});

test('the sample fits the box it is drawn in', () => {
  const coords = brushPreview('pencil', BRUSH, 4, SETTINGS).d.match(/-?\d+(\.\d+)?/g)!.map(Number);
  const xs = coords.filter((_, i) => i % 2 === 0);
  const ys = coords.filter((_, i) => i % 2 === 1);
  expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
  expect(Math.max(...xs)).toBeLessThanOrEqual(PREVIEW_BOX.width);
  expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
  expect(Math.max(...ys)).toBeLessThanOrEqual(PREVIEW_BOX.height);
});

test('the canned gesture changes pace, so the thinning has something to bite on', () => {
  // A hand that moves at one speed hides what the settings do: thinning drops
  // points that land close together, so the sample crawls at the start and
  // races at the end, and the sliders are seen working on the slow half.
  const gap = (i: number) =>
    Math.hypot(
      PREVIEW_GESTURE[i * 2] - PREVIEW_GESTURE[i * 2 - 2],
      PREVIEW_GESTURE[i * 2 + 1] - PREVIEW_GESTURE[i * 2 - 1],
    );
  const last = PREVIEW_GESTURE.length / 2 - 1;
  expect(gap(1) * 5).toBeLessThan(gap(last - 1));
});

test('the sliders are visible in the sample: heavy settings flatten it', () => {
  const segments = (tuning: { width: number; smooth: number; minDistance: number }) =>
    brushPreview('pencil', BRUSH, 4, tuning).d.split(/(?=[MQL])/).length;
  expect(segments({ width: 4, smooth: 30, minDistance: 20 })).toBeLessThan(segments(SETTINGS));
});
