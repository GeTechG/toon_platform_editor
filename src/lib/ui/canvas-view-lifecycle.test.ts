import { describe, expect, it } from 'bun:test';

const source = await Bun.file(new URL('./CanvasView.svelte', import.meta.url)).text();

function handler(name: string): string {
  const match = source.match(new RegExp(`function ${name}\\([^]*?\\n  }`));
  if (!match) throw new Error(`missing ${name} handler`);
  return match[0];
}

describe('current Multator pointer lifecycle contract', () => {
  it('starts only a primary, non-playing, single active gesture and captures it', () => {
    const down = handler('onPointerDown');
    expect(down).toContain('editor.playing || !e.isPrimary || pointer.session');
    expect(down).toContain('setPointerCapture(e.pointerId)');
    expect(down).toContain('pointer.pointerDown(toPointerSample(e, true))');
    expect(source).toContain("(pointer.session?.profile ?? editor.drawingProfile) === 'toonio'");
    expect(source).toContain('tonioCoordinateScale: TONIO_CANVAS_WIDTH / (editor.doc.width / FIXED_POINT_SCALE)');
  });

  it('takes exactly one point from each pointermove without unpacking coalesced events', () => {
    const move = handler('onPointerMove');
    expect(move).toContain('pointer.pointerMove(toPointerSample(e, true))');
    expect(source).toContain("(pointer.session?.profile ?? editor.drawingProfile) === 'toonio'");
  });

  it('commits existing geometry on pointerup without appending the up coordinate', () => {
    const up = handler('onPointerUp');
    expect(up).toContain('pointer.pointerUp(toPointerSample(e, true))');
    expect(up).toContain('commitPendingStroke()');
    expect(handler('commitPendingStroke')).toContain('addStroke(editor.doc, editor.activeFrame, stroke)');
  });

  it('cancel drains profile-specific committed geometry', () => {
    const cancel = handler('onPointerCancel');
    expect(cancel).toContain('pointer.pointerCancel(toPointerSample(e))');
    expect(cancel).toContain('commitPendingStroke()');
  });
});
