import { describe, expect, it } from 'bun:test';
import { plugins } from '../plugins';
import { DEFAULT_PRESET, presetPanels, presetUx } from './presets';

// The owner, 2026-10-11: «добавить инструмент ласо, суть его что ты выделяешь
// область а потом можно трансформировать только выделенное» — a tool of its
// own beside the transform, toonop's alone; a line the loop crosses is cut at
// the loop when the selection is moved. The cut itself runs for real in
// tools/lasso.test.ts; EditorState is a runes class, so it is read as source.
const state = await Bun.file(new URL('./editor-state.svelte.ts', import.meta.url)).text();
const canvasView = await Bun.file(new URL('./CanvasView.svelte', import.meta.url)).text();
const editorUi = await Bun.file(new URL('./Editor.svelte', import.meta.url)).text();

function member(source: string, name: string): string {
  const match = source.match(new RegExp(`(get )?${name}\\([^]*?\\n  }\\n`));
  if (!match) throw new Error(`missing ${name}`);
  return match[0];
}

describe('the lasso as a tool', () => {
  it('is toonop’s own, on the R key, beside the transform', () => {
    expect(plugins.tool('loop')).toMatchObject({ key: 'R', help: true, icon: 'lasso' });
    expect(presetUx(DEFAULT_PRESET).tools).toContain('loop');
    const left = presetPanels(DEFAULT_PRESET).left;
    expect(left.indexOf('tool:loop')).toBe(left.indexOf('tool:lasso') + 1);
    expect(editorUi).toMatch(/case 'r':\s*case 'R':\s*editor\.selectTool\('loop'\);/);
  });
});

describe('a loop closed on the canvas', () => {
  const begin = member(state, 'beginLassoTransform');

  it('cuts every visible selected layer of the frame and opens the transform over what is inside', () => {
    expect(begin).toContain('this.visibleSelectedLayers');
    expect(begin).toContain('lassoCut(');
    expect(begin).toContain('picked');
    // The frame the handles sit on is the selection's, not the cell's.
    expect(begin).toMatch(/selectionBounds\([^]*indices/);
  });

  it('holding nothing, says so and opens nothing', () => {
    expect(begin).toContain("t('canvas.nothing_in_loop')");
  });

  it('writes nothing by itself: the cut lands with the applied move, as one step', () => {
    expect(begin).not.toContain('#write');
    expect(member(state, 'commitTransform')).toContain('writeTransform(doc, layer, frame, open)');
  });
});

describe('the canvas under the lasso', () => {
  it('draws the picked pieces moved and the rest of the cut cell in place', () => {
    const stack = canvasView.match(/function stackCell\([^]*?\n  }\n/)![0];
    expect(stack).toContain('open.picked');
    expect(stack).toContain('indices');
  });

  it('a press outside an open selection applies it and starts the next loop', () => {
    expect(canvasView).toMatch(/editor\.tool === 'loop'[^]*?editor\.leaveTransform\(\)[^]*?loopGesture = \[/);
    expect(canvasView).toContain('editor.beginLassoTransform(');
  });
});
