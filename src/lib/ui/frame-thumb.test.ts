import { describe, expect, it } from 'bun:test';

// The draft card's thumbnail redrew only when a stroke count changed: a lasso
// move or a distort keeps every count, so the card went on showing the drawing
// as it was before, whatever the list read back from storage.
const thumb = await Bun.file(new URL('./FrameThumb.svelte', import.meta.url)).text();

describe('a draft thumbnail follows the document it is given', () => {
  it('a moved drawing is a redraw, whatever its stroke counts', () => {
    // By what the cells hold, not by the document's identity: a list read
    // back from storage hands over a new document for an unchanged draft,
    // and every card redrew.
    expect(thumb).toContain('cellStamp(cell)');
    expect(thumb).not.toContain('paintedDoc');
  });
});
