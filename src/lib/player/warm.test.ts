import { describe, expect, it } from 'bun:test';
import { warmCrew } from './warm';

describe('how many workers rasterize a film', () => {
  it('leaves a core to the page and stops at four', () => {
    expect(warmCrew(8, 500)).toBe(4);
    expect(warmCrew(4, 500)).toBe(3);
    expect(warmCrew(2, 500)).toBe(1);
  });

  it('is one where the device does not say how many cores it has', () => {
    expect(warmCrew(undefined, 500)).toBe(1);
    expect(warmCrew(1, 500)).toBe(1);
  });

  it('is never more than there are frames', () => {
    expect(warmCrew(8, 2)).toBe(2);
  });
});
