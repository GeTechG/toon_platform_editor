import { describe, expect, it } from 'bun:test';

// A finger hides the spot it presses, and the pipette took whatever was under
// it the moment it landed (owner, 2026-10-13: «нажатие и не отпускание
// показывает текущий цвет, водишь — он меняется, отпускаешь — выбирается»).
// Under a finger the tool works as the held finger's pipette does: the loupe
// over the finger, the take on release.
const canvas = await Bun.file(new URL('./CanvasView.svelte', import.meta.url)).text();

describe('the pipette under a finger takes on release', () => {
  it('a finger pressed with the pipette in hand brings the loupe instead of taking at once', () => {
    const press = canvas.slice(canvas.indexOf("if (editor.tool === 'pipette') {", canvas.indexOf('function onPointerDown')));
    const branch = press.slice(0, press.indexOf('takeColour('));
    expect(branch).toMatch(/if \(e\.pointerType === 'touch'\) \{[^]*?dropper = \{[^}]*tool: true[^}]*\};[^]*?aimDropper\(e\);[^]*?return;/);
  });

  it('lifted, it takes as the tool takes: the fill when armed, the eraser from emptiness, and back to the brush', () => {
    const lift = canvas.match(/function liftPipette[^]*?\n  }\n/)![0];
    expect(lift).toMatch(/takeColour\(at, toFill\) !== null && !toFill[^]*?editor\.resetHelpTool\(\);/);
    expect(canvas).toContain('if (dropper.tool) liftPipette(e);');
  });
});
