import { expect, test } from 'bun:test';
import { measureDrawing } from './measurement';

test('includes the interval of the final submitted frame when it crosses the deadline', async () => {
  const frames = [0, 1000, 2100, 3100];
  const draws: number[] = [];
  const result = await measureDrawing(elapsed => draws.push(elapsed), async () => frames.shift()!, 16);
  expect(draws).toEqual([0, 1000, 2100]);
  expect(result.fps).toBeCloseTo(3000 / 3100);
  expect(result.late).toBe(3);
});

test('stops rendering when waiting for a frame is interrupted', async () => {
  let drawn = 0;
  const nextFrame = async () => {
    if (drawn) throw new Error('Tab hidden');
    return 0;
  };
  await expect(measureDrawing(() => drawn++, nextFrame, 16)).rejects.toThrow('Tab hidden');
  expect(drawn).toBe(1);
});
