import { describe, expect, it } from 'bun:test';
import { readId3 } from '../audio/track';

// Twelfth audit, layers and sound. EditorState and AudioTrackState are runes
// classes, so their part is asserted as source; the tag reader runs for real.
const UI = new URL('./', import.meta.url).pathname;
const state = await Bun.file(UI + 'editor-state.svelte.ts').text();
const audio = await Bun.file(UI + '../audio/state.svelte.ts').text();
const rows = await Bun.file(UI + 'LayerRows.svelte').text();
const timeline = await Bun.file(UI + 'Timeline.svelte').text();

function member(source: string, name: string): string {
  const match = source.match(new RegExp(`\\n  (private )?(get |set )?${name}\\([^]*?\\n  }`));
  if (!match) throw new Error(`missing ${name}`);
  return match[0];
}

/** An ID3v2.4 tag of one frame `id` whose body (encoding byte included) is `data`. */
function tag(id: string, data: number[]): ArrayBuffer {
  const frame = [...id].map((c) => c.charCodeAt(0));
  const body = [...frame, 0, 0, 0, data.length, 0, 0, ...data];
  return Uint8Array.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, body.length, ...body]).buffer;
}
const utf8 = (s: string) => [...new TextEncoder().encode(s)];

describe('the cell selection follows the layers it names', () => {
  // The selection holds layer indices. Moving, adding or deleting a layer
  // shifts the indices under it, and the lasso, H and C went on working on
  // whatever layer now sat at the old number — not the one you had picked.
  for (const name of ['moveLayerTo', 'addLayerAtActive', 'removeActiveLayer']) {
    it(`${name} collapses the selection onto the active cell`, () => {
      expect(member(state, name)).toContain('this.collapseSelection();');
    });
  }
});

describe('ID3 values the tag lists, not NULs', () => {
  it('v2.4 separates several artists with a NUL: they read as a list', () => {
    expect(readId3(tag('TPE1', [3, ...utf8('Аня'), 0, ...utf8('Боря')])).artist).toBe('Аня, Боря');
  });

  it('no NUL and no padding blanks reach the credits the server stores', () => {
    const title = readId3(tag('TIT2', [3, ...utf8('  Песня '), 0, 0])).title;
    expect(title).toBe('Песня');
    expect(title).not.toContain('\0');
  });
});

describe('the tie switch acts on a track that is already sounding', () => {
  it('the element loops exactly when the track is untied, whenever the switch moves', () => {
    expect(audio).toMatch(/set sync\(value: boolean\) \{[^}]*this\.#element\.loop = !value/);
    expect(audio).toContain('element.loop = !this.sync;');
  });
});

describe('the layer column has one shape', () => {
  it('the thumbnail branch nobody mounted is gone', () => {
    expect(rows).not.toContain('LayerThumb');
    expect(rows).not.toContain('compact');
    expect(timeline).toContain('<LayerRows {editor} />');
  });
});
