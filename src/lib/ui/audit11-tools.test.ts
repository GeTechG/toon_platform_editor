import { describe, expect, it } from 'bun:test';
import { t } from '../i18n';

// Eleventh audit, tools: the open transform, the pipette and the tool keys.
// The store is runes state, so it is asserted as source, like
// transform-menu.test.ts.
const state = await Bun.file(new URL('./editor-state.svelte.ts', import.meta.url)).text();
const editorUi = await Bun.file(new URL('./Editor.svelte', import.meta.url)).text();
const canvas = await Bun.file(new URL('./CanvasView.svelte', import.meta.url)).text();

/** One method of the store, from its signature to its closing brace. */
function method(name: string): string {
  const match = state.match(new RegExp(`\\n  (?:get |private )?${name}\\([^]*?\\n  }\\n`));
  if (!match) throw new Error(`missing ${name}`);
  return match[0];
}

describe('an open transform is left before anything rewrites the frames under it', () => {
  // With the lasso open, A added a frame and moved the active one: the session
  // stayed, Enter wrote it into the new empty frame and the moves were lost.
  // Deleting, pasting, adding or moving a layer shifted the cells the same way.
  for (const name of [
    'addFrameAfterActive',
    'addFrameBeforeActive',
    'removeActiveFrame',
    'pasteFrame',
    'applyCopiedCells',
    'addLayerAtActive',
    'removeActiveLayer',
    'moveLayerTo',
    'toggleLayerHidden',
  ]) {
    it(`${name} goes through leaveTransform`, () => {
      expect(method(name)).toContain('this.leaveTransform()');
    });
  }

  it('a new document drops the session of the old one', () => {
    expect(method('replaceDoc')).toContain('this.transform = null');
  });
});

describe('undo and redo inside a transform walk the session, from any key', () => {
  // Z on the keyboard stepped the session; the toolbar's «Отменить» took the
  // last stroke from under the live selection.
  it('the toolbar keys follow the session', () => {
    expect(method('canUndo')).toContain('this.canUndoTransform');
    expect(method('canRedo')).toContain('this.canRedoTransform');
    expect(method('undo')).toMatch(/if \(this\.transform\) \{\s*this\.undoTransform\(\);/);
    expect(method('redo')).toMatch(/if \(this\.transform\) \{\s*this\.redoTransform\(\);/);
  });
});

describe('the pipette hands back the tool the colour asks for', () => {
  it('white under Multator comes back as the eraser, as a pick from the grid does', () => {
    // setBrushColor armed the eraser, and resetHelpTool put the pencil back
    // over it: a white pencil where the preset says white is the eraser.
    expect(method('resetHelpTool')).toContain('toolAfterColorChange(');
  });

  it('an empty pick asks for the eraser instead of forcing it in', () => {
    expect(canvas).not.toContain("editor.tool = 'eraser'");
  });
});

describe('the fullscreen key does not promise F while F picks the feather', () => {
  it('the badge and the tooltip drop F when the feather is on the panel', () => {
    const key = editorUi.match(/\{:else if id === 'fullscreen'\}[^]*?<\/button>/)?.[0] ?? '';
    expect(key).not.toContain('data-key="F"');
    expect(key).toContain("data-key={hasFeather ? undefined : 'F'}");
    expect(key).toContain("hasFeather ? t('editor.fullscreen') : t('editor.fullscreen_title')");
  });
});

describe('tool copy says what the tool does', () => {
  it('the transform tooltip is not «transform: take and transform»', () => {
    expect(t('tool.transform.title')).not.toContain('трансформировать');
  });
});

describe('the transform window does not share a name with the toolbar undo', () => {
  it('cancel is «Отмена», not a second «Отменить» beside the undo key', () => {
    // Both were on screen at once: «Отменить» stepped the session back,
    // «Отменить» in the window threw the whole session away.
    expect(t('transform.cancel')).not.toBe(t('editor.undo'));
    expect(t('transform.cancel_label').startsWith(t('transform.cancel'))).toBe(true);
  });
});
