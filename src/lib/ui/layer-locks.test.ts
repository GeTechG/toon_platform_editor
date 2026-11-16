import { describe, expect, it } from 'bun:test';
import { createDocument, addLayer, setLayerHidden } from '../model/operations';
import { deskAfter, editRefusal, normalizeLayerLocks } from './layer-locks';

describe('layer locks read back from a draft', () => {
  it('a draft written before locks existed opens with nothing locked', () => {
    expect(normalizeLayerLocks(undefined, 3)).toEqual([false, false, false]);
  });

  it('keeps what was locked and fits the list to the layers there are', () => {
    expect(normalizeLayerLocks([true, false, true, true], 3)).toEqual([true, false, true]);
    expect(normalizeLayerLocks([true], 2)).toEqual([true, false]);
    expect(normalizeLayerLocks(['yes', 1, null], 3)).toEqual([false, false, false]);
  });
});

describe('what refuses an edit of a cell', () => {
  const doc = () => {
    const built = createDocument();
    addLayer(built, 1);
    return built;
  };

  it('nothing refuses a plain layer', () => {
    expect(editRefusal(doc(), [false, false], [0])).toBeNull();
  });

  it('a locked layer refuses a new edit', () => {
    expect(editRefusal(doc(), [false, true], [1])).toBe('locked');
    expect(editRefusal(doc(), [false, true], [0, 1])).toBe('locked');
  });

  it('a locked layer takes its own history back and forth', () => {
    expect(editRefusal(doc(), [false, true], [1], true)).toBeNull();
  });

  it('a hidden layer refuses even its history, and says it is hidden before it says it is locked', () => {
    const built = doc();
    setLayerHidden(built, 1, true);
    expect(editRefusal(built, [false, true], [1], true)).toBe('hidden');
    expect(editRefusal(built, [false, true], [1])).toBe('hidden');
  });
});

describe('an edit of several layers asks for every one of them', () => {
  // EditorState is a runes class, asserted as source like the other guards
  // (owner-twelfth-canvas.test.ts): with an unlocked active layer, a locked
  // second selected layer was mirrored, magnetised and moved all the same.
  it('mirror, plugin gestures (the magnet among them), transform and lasso pass their layers to the guard', async () => {
    const state = await Bun.file(new URL('./editor-state.svelte.ts', import.meta.url)).text();
    const body = (name: string) => state.match(new RegExp(`\\n  ${name}\\([^]*?\\n  }`))?.[0] ?? '';
    for (const name of ['mirrorSelectedLayers', 'beginPluginGesture', 'beginTransform', 'beginLassoTransform']) {
      expect(body(name)).toMatch(/this\.mayEdit\(\[this\.activeLayer, \.\.\.(layers|this\.visibleSelectedLayers)\]\)/);
    }
  });
});

describe('what undo leaves of the desk', () => {
  const step = { layerColors: [0, 1], layerLocks: [false, false] };
  const now = { layerColors: [3, 4], layerLocks: [false, true] };

  it('a look taken back leaves the locks and tags as they are now: the layers are the same', () => {
    expect(deskAfter({ ...step, looked: true }, now)).toEqual(now);
  });

  it('a delete or a move taken back brings the locks and tags of its layers back', () => {
    expect(deskAfter(step, now)).toEqual(step);
  });
});
