import { describe, expect, it } from 'bun:test';
import { renderDensity } from './viewport';

// Owner's answers after the twelfth audit, canvas part. EditorState is a runes
// class, so its part is asserted as source, like owner-eleventh-delete-block;
// the density cap runs for real.
const UI = new URL('./', import.meta.url).pathname;
const state = await Bun.file(UI + 'editor-state.svelte.ts').text();
const canvas = await Bun.file(UI + 'CanvasView.svelte').text();

function member(source: string, name: string): string {
  const match = source.match(new RegExp(`\\n  (private )?(get )?${name}(<[^>]*>)?\\([^]*?\\n  }`));
  if (!match) throw new Error(`missing ${name}`);
  return match[0];
}

describe('the document density is capped at two as well', () => {
  it('a phone sheet of 360 px would ask 3.5x of a 1280 document; it gets 2', () => {
    expect(renderDensity(1280 / 360)).toBe(2);
    expect(renderDensity(1280 / 900)).toBeCloseTo(1280 / 900);
  });

  it('the canvas sends the document density through the cap too', () => {
    const draw = canvas.match(/function draw\(\)[^]*?\n  }\n/)![0];
    const dpr = draw.match(/const dpr = [^;]*;/)![0];
    expect(dpr).toMatch(/^const dpr = renderDensity\(/);
    expect(dpr).toContain("editor.ux.canvasDensity === 'document'");
  });
});

describe('nothing edits a hidden layer', () => {
  const guard = member(state, 'mayEdit');

  it('one guard: a hidden layer among those an edit touches refuses it, with the eye hint', () => {
    expect(guard).toContain('.hidden');
    expect(guard).toContain("t('canvas.hidden_layer')");
    expect(guard).toContain('this.canvasHint');
  });

  for (const name of [
    'commitStroke',
    'applyMegaEraser',
    'mirrorSelectedLayers',
    'beginTransform',
    'applyTransform',
    'beginPluginGesture',
    'applyCopiedCells',
    'pasteFrame',
    'redo',
  ]) {
    it(`${name} asks the guard`, () => {
      expect(member(state, name)).toContain('this.mayEdit(');
    });
  }

  it('undo asks the guard for a block edit and for a stroke, not for a delete', () => {
    const undo = member(state, 'undo');
    expect(undo).toContain('this.mayEdit(edit.map(');
    // The step stays on the stack: the guard comes before anything is sliced off.
    const block = undo.slice(undo.indexOf('const edit = this.restorableEdit'));
    expect(block.indexOf('this.mayEdit(')).toBeLessThan(block.indexOf('this.edits = this.edits.slice(0, -1)'));
    expect(undo.indexOf('this.mayEdit()')).toBeGreaterThan(undo.indexOf('const cell = this.activeCell'));
    const structure = undo.slice(0, undo.indexOf('const edit = this.restorableEdit'));
    expect(structure).not.toContain('mayEdit');
  });

  it('redo keeps its entry when refused', () => {
    const redo = member(state, 'redo');
    expect(redo.indexOf('this.mayEdit()')).toBeLessThan(redo.indexOf('this.undone = this.undone.slice(0, -1)'));
  });

  it('the canvas asks the state instead of keeping its own copy of the check', () => {
    expect(canvas).not.toContain('activeLayerHidden');
    expect(canvas).not.toContain('HIDDEN_LAYER_HINT');
    const down = canvas.match(/function onPointerDown[^]*?\n  }\n/)![0];
    expect(down).toContain('editor.mayEdit()');
    expect(down.indexOf('editor.mayEdit()')).toBeLessThan(down.indexOf('pointer.pointerDown'));
  });
});
