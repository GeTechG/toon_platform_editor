import { describe, expect, it } from 'bun:test';
import { addFrame, addStroke, createDocument, removeFrame } from '../model/operations';
import { t } from '../i18n';

// The owner's answer after the eleventh audit: «Да все, но спросить указав
// диапазон». With a block of frames selected, «Удалить кадр» (menu, Delete,
// the toolbar) takes the whole block in one write, after one question that
// names the range. EditorState is a runes class, so its part is asserted as
// source, like timeline-selection.test.ts; the removal itself runs for real.
const UI = new URL('./', import.meta.url).pathname;
const state = await Bun.file(UI + 'editor-state.svelte.ts').text();
const timeline = await Bun.file(UI + 'Timeline.svelte').text();

function member(source: string, name: string): string {
  const match = source.match(new RegExp(`\\n  (private )?(get )?${name}\\([^]*?\\n  }`));
  if (!match) throw new Error(`missing ${name}`);
  return match[0];
}

/** A document of `n` frames, each with one stroke whose x is its own number. */
function frames(n: number) {
  const doc = createDocument();
  for (let i = 1; i < n; i++) addFrame(doc, i - 1);
  for (let i = 0; i < n; i++) addStroke(doc, 0, i, { points: [i, 0], width: 8, color: '#000000' });
  return doc;
}

describe('removing a run of frames', () => {
  it('takes the run from every layer and keeps the rest in order', () => {
    const doc = frames(8);
    removeFrame(doc, 2, 5);
    expect(doc.layers[0].frames.map((f) => f.strokes[0].points[0])).toEqual([0, 1, 7]);
  });

  it('never leaves the document without a frame: all of them clears the first', () => {
    const doc = frames(4);
    removeFrame(doc, 0, 4);
    expect(doc.layers[0].frames).toHaveLength(1);
    expect(doc.layers[0].frames[0].strokes).toHaveLength(0);
  });

  it('refuses a run past the end', () => {
    expect(() => removeFrame(frames(3), 1, 3)).toThrow(RangeError);
  });
});

describe('the question names the range', () => {
  it('in the right plural', () => {
    expect(t('frame.delete_block_confirm', { from: 3, to: 7, count: 5 })).toBe('Удалить кадры 3–7 (5 кадров)?');
    expect(t('frame.delete_block_confirm', { from: 1, to: 2, count: 2 })).toBe('Удалить кадры 1–2 (2 кадра)?');
    expect(t('frame.delete_block_confirm', { from: 1, to: 21, count: 21 })).toBe('Удалить кадры 1–21 (21 кадр)?');
  });

  it('a lone frame keeps its old question', () => {
    expect(t('frame.delete_confirm', { n: 4 })).toBe('Удалить кадр 4?');
  });
});

describe('the editor deletes the selected block', () => {
  const remove = member(state, 'removeActiveFrame');

  it('in one write, behind the transform guard and the muted-warnings question', () => {
    expect(remove).toContain('this.leaveTransform()');
    expect(remove).toContain('this.confirmed(');
    expect(remove).toContain("'frame.delete_block_confirm'");
    expect(remove.match(/this\.#write\(/g)).toHaveLength(1);
    expect(remove).toContain('removeFrame(doc, from, count)');
  });

  it('under Toonio refuses a block that would take every frame', () => {
    expect(member(state, 'canRemoveFrame')).toMatch(/frameCount\(this\.doc\) > count/);
  });

  it('the menu says which frames go', () => {
    expect(t('panel.item.delete_frames', { from: 3, to: 7 })).toBe('Удалить кадры 3–7');
    expect(timeline).toContain("t('panel.item.delete_frames', span)");
  });
});
