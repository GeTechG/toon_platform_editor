import { describe, expect, it } from 'bun:test';

// After the seventeenth audit, tools and colour: a line and a sweep pinned to
// a frame index that a frame put in front of it shifted, a sweep's trail drawn
// over a frame it does not cut, and an Esc out of the colour window that
// picked the pipette afresh — the browser eyedropper again, aimed at the
// outline. The canvas and the box are runes components, asserted as source.
const canvas = await Bun.file(new URL('./CanvasView.svelte', import.meta.url)).text();
const palette = await Bun.file(new URL('./PaletteBox.svelte', import.meta.url)).text();

function fn(source: string, name: string): string {
  const match = source.match(new RegExp(`function ${name}\\([^]*?\\n  }\\n`));
  if (!match) throw new Error(`missing ${name}`);
  return match[0];
}

describe('a gesture is pinned to the cell itself, not its index', () => {
  it('the line keeps the cell of its press', () => {
    expect(fn(canvas, 'onPointerDown')).toContain('strokeCell = editor.activeCell');
    const commit = fn(canvas, 'commitPendingStroke');
    expect(commit).toContain('strokeCell ? editor.doc.layers[index]?.frames.indexOf(strokeCell)');
    expect(commit).toContain('editor.commitStroke(index, stroke, frame)');
    expect(commit).not.toContain('ponytail');
    expect(canvas).not.toContain('strokeFrame');
  });

  it('the mega eraser keeps the cell its sweep began on', () => {
    expect(fn(canvas, 'onPointerDown')).toContain('megaAt = { layer: editor.doc.layers[editor.activeLayer], cell: editor.activeCell }');
    expect(fn(canvas, 'onPointerUp')).toContain('.frames.indexOf(megaAt.cell)');
  });

  it('the line under the hand is drawn only over its own cell', () => {
    expect(fn(canvas, 'liveLine')).toContain('strokeCell !== editor.activeCell');
  });
});

describe('the sweep\'s trail stays over the cell it cuts', () => {
  it('another frame made active hides the trail', () => {
    expect(fn(canvas, 'liveLine')).toContain('megaGesture && megaGesture.length >= 2 && megaAt.cell === editor.activeCell');
  });
});

describe('Esc out of the colour window hands the tool back as it was', () => {
  it('the pipette comes back without the browser eyedropper or a new target', () => {
    const close = fn(palette, 'closePicker');
    expect(close).toContain('editor.restoreTool(tool)');
    expect(close).not.toContain('editor.selectTool(tool)');
  });
});
