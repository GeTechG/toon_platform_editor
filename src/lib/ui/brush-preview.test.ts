import { expect, test } from 'bun:test';

import { DEFAULT_BRUSH } from './presets';
import { PREVIEW_BOX, PREVIEW_GESTURE, brushPreview } from './brush-preview';

const TONIO = DEFAULT_BRUSH.toonio;

test('the everyday brush previews as a line of the brush width', () => {
  const preview = brushPreview('pencil', 'toonio', 4, TONIO);
  expect(preview.fill).toBe(false);
  expect(preview.d.startsWith('M')).toBe(true);
  expect(preview.width).toBe(32);
});

test('the old pen previews as the closed contour it commits', () => {
  const preview = brushPreview('oldschool', 'toonio', 4, TONIO);
  expect(preview.fill).toBe(true);
  expect(preview.d.endsWith('Z')).toBe(true);
});

test('the multator brush previews its own line, not the preset one', () => {
  const multator = brushPreview('multator-pencil', 'toonio', 4, TONIO);
  const normal = brushPreview('pencil', 'toonio', 4, TONIO);
  expect(multator.fill).toBe(false);
  expect(multator.d).not.toBe(normal.d);
  // In a Multator preset the everyday line is that same line already.
  expect(brushPreview('pencil', 'multator', 4, TONIO).d).toBe(
    brushPreview('multator-pencil', 'multator', 4, TONIO).d,
  );
});

test('a brush that stamps marks has no line to show', () => {
  // The sample is the path the renderer emits for a line; the pixel tool
  // stamps a square per cell instead, and a line through their centres would
  // be a picture of something the brush never draws.
  expect(brushPreview('pixel', 'toonio', 8, TONIO).d).toBe('');
});

test('the sample fits the box it is drawn in', () => {
  const coords = brushPreview('pencil', 'toonio', 4, TONIO).d.match(/-?\d+(\.\d+)?/g)!.map(Number);
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
  const segments = (tonio: { width: number; smooth: number; minDistance: number }) =>
    brushPreview('pencil', 'toonio', 4, tonio).d.split(/(?=[MQL])/).length;
  expect(segments({ width: 4, smooth: 30, minDistance: 20 })).toBeLessThan(segments(TONIO));
});
