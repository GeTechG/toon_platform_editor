import { describe, expect, it } from 'bun:test';
import { cellBudget } from './cell-cache';

const MB = 1024 * 1024;

describe('the cell budget follows the device', () => {
  it('gives 256 MB where the browser reports 8 GB or more', () => {
    expect(cellBudget(8)).toBe(256 * MB);
  });
  it('gives 128 MB from 4 GB', () => {
    expect(cellBudget(4)).toBe(128 * MB);
  });
  it('keeps 64 MB on a small device and where the memory is not told', () => {
    expect(cellBudget(2)).toBe(64 * MB);
    expect(cellBudget(undefined)).toBe(64 * MB);
  });
});
