import { describe, expect, it } from 'bun:test';
import { TOONOP_UX, nudgeBrushSize } from './ux-profile';
import { sizeFromDrag } from './size-scale';
import { PRESETS } from '../../core-plugin/presets';

const canvas = await Bun.file(new URL('./CanvasView.svelte', import.meta.url)).text();
const panel = await Bun.file(new URL('./BrushPanel.svelte', import.meta.url)).text();
const ru = await Bun.file(new URL('../i18n/ru.json', import.meta.url)).text();

// The owner wants the thick end of the scale reached in a few presses. The
// ladder is Photoshop's [ and ]: 1 below 10, 5 below 50, 10 below 100, 25
// below 200, 50 below 300, 100 above — and an odd size snaps to the ladder.
describe('+/− walk a ladder in the toonop preset', () => {
  const up = (size: number) => nudgeBrushSize(size, 1, TOONOP_UX);
  const down = (size: number) => nudgeBrushSize(size, -1, TOONOP_UX);

  it('steps by 1 at the thin end, as before', () => {
    expect(up(1)).toBe(2);
    expect(up(9)).toBe(10);
    expect(down(10)).toBe(9);
    expect(down(1)).toBe(1);
  });

  it('the step grows with the size', () => {
    expect(up(10)).toBe(15);
    expect(up(50)).toBe(60);
    expect(up(100)).toBe(125);
    expect(up(200)).toBe(250);
    expect(up(300)).toBe(400);
  });

  it('going down takes the step of the band below', () => {
    expect(down(50)).toBe(45);
    expect(down(100)).toBe(90);
    expect(down(200)).toBe(175);
    expect(down(300)).toBe(250);
    expect(down(500)).toBe(400);
  });

  it('a size between rungs lands on the next rung, not beside it', () => {
    expect(up(13)).toBe(15);
    expect(down(13)).toBe(10);
    expect(up(137)).toBe(150);
    expect(down(137)).toBe(125);
  });

  it('stops at the ceiling', () => {
    expect(up(400)).toBe(TOONOP_UX.brushSizeMax);
    expect(up(TOONOP_UX.brushSizeMax)).toBe(TOONOP_UX.brushSizeMax);
  });

  it('Multator and toonio keep their own steps', () => {
    expect(nudgeBrushSize(20, 1, PRESETS.multator.ux)).toBe(30);
    expect(nudgeBrushSize(100, 1, PRESETS.toonio.ux)).toBe(101);
  });
});

// Krita's Shift+drag: right or up is thicker, left or down thinner, along the
// same logarithmic track the slider runs on — a thin brush moves by single
// pixels, a thick one by tens, and the whole scale fits one hand's drag.
describe('the thickness drag on the canvas', () => {
  it('standing still keeps the size', () => {
    expect(sizeFromDrag(9, 0, 0, 1, 500)).toBe(9);
  });

  it('right and up thicken, left and down thin', () => {
    expect(sizeFromDrag(9, 40, 0, 1, 500)).toBeGreaterThan(9);
    expect(sizeFromDrag(9, 0, -40, 1, 500)).toBeGreaterThan(9);
    expect(sizeFromDrag(9, -40, 0, 1, 500)).toBeLessThan(9);
    expect(sizeFromDrag(9, 0, 40, 1, 500)).toBeLessThan(9);
  });

  it('a few pixels of drag are one pixel of a thin brush', () => {
    expect(sizeFromDrag(9, 6, 0, 1, 500)).toBe(10);
  });

  it('the whole scale is within a drag of 400 px, and clamps at the ends', () => {
    expect(sizeFromDrag(1, 400, 0, 1, 500)).toBe(500);
    expect(sizeFromDrag(500, -400, 0, 1, 500)).toBe(1);
    expect(sizeFromDrag(9, 5000, 0, 1, 640)).toBe(640);
  });
});

describe('the canvas runs the drag', () => {
  it('Shift with the button or the pen tip starts it, before any tool draws', () => {
    const down = canvas.slice(canvas.indexOf('function onPointerDown'), canvas.indexOf('function onPointerMove'));
    expect(down).toMatch(/e\.shiftKey/);
    expect(down.indexOf('sizing =')).toBeLessThan(down.indexOf('pointer.pointerDown'));
    expect(down.indexOf('sizing =')).toBeLessThan(down.indexOf('if (editor.transform)'));
  });

  it('writes the size once, at the end, through the same setter the slider uses', () => {
    const up = canvas.slice(canvas.indexOf('function onPointerUp'), canvas.indexOf('function dragTransform'));
    expect(up).toMatch(/editor\.brushSizeLogical = sizing\.size/);
  });

  it('a cancelled drag writes nothing', () => {
    const cancel = canvas.slice(canvas.indexOf('function onPointerCancel'), canvas.indexOf('function toPointerSample'));
    expect(cancel).toMatch(/sizing = null/);
    expect(cancel).not.toMatch(/brushSizeLogical =/);
  });

  it('shows the ring at the real size and the number while it runs', () => {
    expect(canvas).toMatch(/class="[^"]*size-ring/);
    expect(canvas).toMatch(/class="size-number"/);
  });

  it('the brush box says the drag is there', () => {
    expect(panel).toMatch(/heading\(t\('brush\.thickness'\), t\('brush\.thickness_hint'\)\)/);
    expect(ru).toMatch(/"thickness_hint": "[^"]*Shift/);
  });
});
