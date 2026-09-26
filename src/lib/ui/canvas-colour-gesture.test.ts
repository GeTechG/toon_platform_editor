import { describe, expect, it } from 'bun:test';
import { HOLD_PICK_MS, HOLD_SLOP_PX, mayHoldPick, stillHeld } from './hold-pick';
import { t } from '../i18n';

// Owner: «цвет с холста, как в Procreate Dreams». Dreams: touch and hold on
// the stage brings the eyedropper, its loupe shows the new colour over the
// current one, lifting the finger takes it. The rules run for real, the
// markup is asserted as source.
const UI = new URL('./', import.meta.url).pathname;
const canvas = await Bun.file(UI + 'CanvasView.svelte').text();

const press = {
  pointerType: 'touch',
  isPrimary: true,
  fingers: 0,
  playing: false,
  transform: false,
  tool: 'pencil',
  ownGesture: false,
  onSheet: true,
  penBusy: false,
};

describe('a still finger is a hold, a moving one is drawing or panning', () => {
  it('the delay is the long press the timeline already uses', () => {
    expect(HOLD_PICK_MS).toBe(500);
  });

  it('a finger that shivers within the slop still holds', () => {
    expect(stillHeld({ x: 10, y: 10 }, { x: 10 + HOLD_SLOP_PX * 0.6, y: 10 + HOLD_SLOP_PX * 0.6 })).toBe(true);
  });

  it('a finger that travels past the slop has started a line', () => {
    expect(stillHeld({ x: 10, y: 10 }, { x: 10 + HOLD_SLOP_PX + 1, y: 10 })).toBe(false);
  });
});

describe('what a finger hold may turn into the pipette', () => {
  it('the first finger on the sheet, under a drawing tool or the hand', () => {
    expect(mayHoldPick(press)).toBe(true);
    expect(mayHoldPick({ ...press, tool: 'drag' })).toBe(true);
    expect(mayHoldPick({ ...press, tool: 'eraser' })).toBe(true);
  });

  it('a pen or a mouse holds still to draw a dot, not to pick', () => {
    expect(mayHoldPick({ ...press, pointerType: 'pen' })).toBe(false);
    expect(mayHoldPick({ ...press, pointerType: 'mouse' })).toBe(false);
  });

  it('a second finger is the pinch, a palm under a busy pen is nothing', () => {
    expect(mayHoldPick({ ...press, fingers: 1 })).toBe(false);
    expect(mayHoldPick({ ...press, isPrimary: false })).toBe(false);
    expect(mayHoldPick({ ...press, penBusy: true })).toBe(false);
  });

  it('the table beside the sheet holds no colour', () => {
    expect(mayHoldPick({ ...press, onSheet: false })).toBe(false);
  });

  it('the pipette itself, the lasso, a transform, a tool’s own drag and the preview keep the finger', () => {
    expect(mayHoldPick({ ...press, tool: 'pipette' })).toBe(false);
    expect(mayHoldPick({ ...press, tool: 'lasso' })).toBe(false);
    expect(mayHoldPick({ ...press, transform: true })).toBe(false);
    expect(mayHoldPick({ ...press, ownGesture: true })).toBe(false);
    expect(mayHoldPick({ ...press, playing: true })).toBe(false);
  });
});

describe('the canvas wires the hold', () => {
  it('arms a timer on the press and cancels it on travel, a second finger or a pen', () => {
    expect(canvas).toContain('mayHoldPick(');
    expect(canvas).toContain('HOLD_PICK_MS');
    expect(canvas).toContain('stillHeld(');
    expect(canvas).toContain('cancelHold()');
  });

  it('the line begun while waiting goes unrecorded, the pan stops', () => {
    const fire = canvas.slice(canvas.indexOf('function startDropper'), canvas.indexOf('function startDropper') + 1200);
    expect(fire).toContain('pointer.discard()');
    expect(fire).toContain('panning = null');
  });

  it('the pipette tool and the gesture take the colour through one path', () => {
    expect(canvas.match(/takeColour\(/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it('the loupe shows the new colour over the current outline', () => {
    expect(canvas).toContain('class="loupe"');
    expect(canvas).toContain('dropper.color');
    expect(canvas).toContain('editor.brushColor');
  });

  it('the loupe keeps its colours in forced colors and does not move for reduced motion', () => {
    const style = canvas.slice(canvas.indexOf('.loupe {'));
    expect(style).toContain('forced-color-adjust: none');
    expect(canvas).toMatch(/prefers-reduced-motion: no-preference\)\s*{\s*\.loupe/);
  });

  it('the colour taken is said in the canvas live line', () => {
    expect(canvas).toContain("showHint(t('canvas.hold_picked'");
    expect(t('canvas.hold_picked', { color: '#ff0000' })).toContain('#ff0000');
  });
});
