import { describe, expect, it } from 'bun:test';
import { DRAFT_TOO_BIG_BYTES, DRAFT_WARN_BYTES, draftSizeClass, formatFileSize } from './file-size';

describe('formatFileSize', () => {
  it('names the unit the number is readable in', () => {
    expect(formatFileSize(0)).toBe('0 Б');
    expect(formatFileSize(512)).toBe('512 Б');
    expect(formatFileSize(1536)).toBe('1,5 КБ');
    expect(formatFileSize(35 * 1024 * 1024)).toBe('35 МБ');
  });
});

describe('draftSizeClass', () => {
  it('warns from 30 MB and calls 70 MB too big', () => {
    expect(DRAFT_WARN_BYTES).toBe(30 * 1024 * 1024);
    expect(DRAFT_TOO_BIG_BYTES).toBe(70 * 1024 * 1024);
    expect(draftSizeClass(1024)).toBe('');
    expect(draftSizeClass(DRAFT_WARN_BYTES)).toBe('warning');
    expect(draftSizeClass(DRAFT_TOO_BIG_BYTES)).toBe('too_big');
    expect(draftSizeClass(undefined)).toBe('');
  });
});
