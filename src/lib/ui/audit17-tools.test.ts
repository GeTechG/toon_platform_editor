import { describe, expect, it } from 'bun:test';

// Seventeenth audit, tools: a line and a mega-eraser sweep that landed on
// whatever frame was active at the release, a mega eraser that looked like
// the pencil under the hand, Alt+E that changed the tool under a held drag,
// and a pen turned back over that picked its help tool afresh.
// The store and the canvas are runes components, so they are asserted as
// source, like audit16.
const state = await Bun.file(new URL('./editor-state.svelte.ts', import.meta.url)).text();
const canvas = await Bun.file(new URL('./CanvasView.svelte', import.meta.url)).text();
const editorUi = await Bun.file(new URL('./Editor.svelte', import.meta.url)).text();

function method(name: string): string {
  const match = state.match(new RegExp(`\\n  (?:get |private )?${name}\\([^]*?\\n  }\\n`));
  if (!match) throw new Error(`missing ${name}`);
  return match[0];
}

function canvasFn(name: string): string {
  const match = canvas.match(new RegExp(`function ${name}\\([^]*?\\n  }\\n`));
  if (!match) throw new Error(`missing ${name}`);
  return match[0];
}

describe('a gesture lands on the cell it was begun on', () => {
  it('the line keeps the frame of its press, as it keeps the layer', () => {
    // A finger tapping another frame on the strip while the pen drew moved
    // the active frame: the line landed there, on a frame it was never drawn
    // over, and the one under the pen stayed empty.
    expect(canvasFn('onPointerDown')).toContain('strokeFrame = editor.activeFrame');
    expect(canvasFn('commitPendingStroke')).toContain('editor.commitStroke(index, stroke, strokeFrame)');
    const commit = method('commitStroke');
    expect(commit).toMatch(/commitStroke\(layerIndex: number, stroke: ResolvedStroke, frame = this\.activeFrame\)/);
    expect(commit).toContain('addStroke(doc, layerIndex, frame, stroke)');
    expect(commit).not.toContain('this.activeFrame, stroke');
  });

  it('the line under the hand is not drawn over another frame', () => {
    expect(canvasFn('liveLine')).toContain('strokeFrame !== editor.activeFrame');
  });

  it('the mega eraser cuts the cell its sweep began on', () => {
    expect(canvasFn('onPointerDown')).toMatch(/megaAt = \{ layer: editor\.doc\.layers\[editor\.activeLayer\], frame: editor\.activeFrame \}/);
    expect(canvasFn('onPointerUp')).toContain('editor.applyMegaEraser(megaGesture, brushWidthDoc(editor.brushSizeLogical) / 2, megaAt.layer ? editor.doc.layers.indexOf(megaAt.layer) : -1, megaAt.frame)');
    const erase = method('applyMegaEraser');
    expect(erase).toMatch(/applyMegaEraser\(gesture: readonly number\[\], radius: number, layer = this\.activeLayer, frame = this\.activeFrame\)/);
    expect(erase).not.toContain('this.activeCell');
    expect(erase).toContain('replaceStrokes(doc, layer, frame, after)');
    expect(erase).toContain('this.mayEdit([layer])');
  });
});

describe('the mega eraser shows it erases', () => {
  it('its ring is dashed like the eraser\'s, not the pencil\'s solid one', () => {
    expect(canvas).toContain("class:eraser={editor.tool === 'eraser' || editor.tool === 'mega-eraser'}");
  });
});

describe('Alt+E waits for the hand, like every other tool key', () => {
  it('a held stroke or handle is not switched out from under it', () => {
    // The letter keys stop while a gesture is held; Alt+E ran before that
    // check and committed a live transform in the middle of its drag.
    const alt = editorUi.slice(editorUi.indexOf("(key === 'e' || key === 'E') && hasMegaEraser"));
    expect(alt.slice(0, alt.indexOf('return;'))).toContain('!editor.gestureHeld');
  });
});

describe('a pen turned back over gets its tip\'s tool back as it was', () => {
  it('the flip back restores, it does not pick afresh', () => {
    // selectTool from the eraser made the eraser the pipette's way back and
    // opened the screen eyedropper again, with nobody asking.
    expect(canvasFn('followPenEnd')).toContain('editor.restoreTool(penFlippedFrom)');
    const restore = method('restoreTool');
    expect(restore).toContain('resolveToolSelection(');
    expect(restore).toContain('this.hold(');
    expect(restore).not.toContain('openBrowserPicker');
    expect(restore).not.toContain('previousDrawingTool');
  });
});
