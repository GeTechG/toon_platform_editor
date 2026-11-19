import { expect, test } from 'bun:test';
import { snappedDuration, touchDuration, timelineClips } from './timeline-clips';

test('a visible continuation belongs to one clip with its original thumbnail', () => {
  const drawing = { strokes: [] };
  const next = { strokes: [] };
  const clips = timelineClips([drawing, null, null, next], 1, 4);
  expect(clips).toEqual([
    { frame: drawing, key: 0, start: 0, end: 3 },
    { frame: next, key: 3, start: 3, end: 4 },
  ]);
});

test('during a drag the thumbnail stays put and the following clips move to the next boundary with the edge', () => {
  const [a, b, c] = Array.from({ length: 3 }, () => ({ strokes: [] }));
  expect(timelineClips([a, null, b, c, null], 0, 7, { start: 0, duration: 2, to: 4 })).toEqual([
    { frame: a, key: 0, start: 0, end: 4 },
    { frame: b, key: 2, start: 4, end: 5 },
    { frame: c, key: 3, start: 5, end: 6 },
  ]);
});

test('the edge stays on its tick until the hand crosses half a cell, in either direction', () => {
  expect([-76, -26, -24, 0, 24, 26, 76].map(dx => snappedDuration(3, 4, dx, 50)))
    .toEqual([1, 2, 3, 3, 3, 4, 4]);
});

test('shortening the final drawing previews the blank left at its end', () => {
  const drawing = { strokes: [] };
  const clips = timelineClips([drawing, null, null, null], 2, 4, { start: 0, duration: 4, to: 2 });
  expect(clips).toEqual([{ frame: null, key: -1, start: 2, end: 4 }]);
});

test('a neighbor shifted past the original film is visible in the extended window', () => {
  const drawing = { strokes: [] };
  const next = { strokes: [] };
  expect(timelineClips([drawing, next], 4, 5, { start: 0, duration: 1, to: 4 }))
    .toEqual([{ frame: next, key: 1, start: 4, end: 5 }]);
});

test('a finger can trim one tick at overview zoom and wobble around the boundary', () => {
  let value = 3;
  const readings = [2, 12, 18, 21, 17, 14, 10, -21, -16, -10].map(dx => {
    value = touchDuration(3, 8, dx, 4, value);
    return value;
  });
  expect(readings).toEqual([3, 3, 3, 4, 4, 4, 3, 2, 2, 3]);
  expect(touchDuration(3, 8, 300, 4, value)).toBe(8);
  expect(touchDuration(3, 8, -300, 4, value)).toBe(1);
});
