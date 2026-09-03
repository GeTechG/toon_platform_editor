import { describe, expect, it } from 'bun:test';
import {
  UX_PROFILES,
  nudgeBrushSize,
  resolveToolSelection,
  toolAfterColorChange,
} from './ux-profile';

const multator = UX_PROFILES.multator;
const toonop = UX_PROFILES.toonop;

describe('UX_PROFILES', () => {
  it('multator reproduces the reference editor defaults', () => {
    expect(multator.quickPalette).toEqual(['#000000', '#ff0000']);
    expect(multator.whiteIsEraser).toBe(true);
    expect(multator.pipetteNeedsPalette).toBe(true);
    expect(multator.onionSides).toBe('previous');
    expect(multator.activeFrameAlpha).toBe(0.8);
    expect(multator.afterRemove).toBe('previous');
    expect(multator.playFromStart).toBe(true);
    expect(multator.defaultFps).toBe(5);
    expect(multator.brushSizeMax).toBe(300);
  });

  it('toonop keeps the current editor behavior', () => {
    expect(toonop.quickPalette).toBeNull();
    expect(toonop.whiteIsEraser).toBe(false);
    expect(toonop.pipetteNeedsPalette).toBe(false);
    expect(toonop.onionSides).toBe('both');
    expect(toonop.activeFrameAlpha).toBe(1);
    expect(toonop.afterRemove).toBe('next');
    expect(toonop.playFromStart).toBe(false);
    expect(toonop.defaultFps).toBe(12);
  });
});

describe('nudgeBrushSize', () => {
  it('multator steps by 1 below 10, by 5 below 50, by 10 above', () => {
    expect(nudgeBrushSize(4, 1, multator)).toBe(5);
    expect(nudgeBrushSize(9, 1, multator)).toBe(10);
    expect(nudgeBrushSize(10, 1, multator)).toBe(15);
    expect(nudgeBrushSize(10, -1, multator)).toBe(5);
    expect(nudgeBrushSize(45, 1, multator)).toBe(50);
    expect(nudgeBrushSize(50, 1, multator)).toBe(60);
    expect(nudgeBrushSize(50, -1, multator)).toBe(40);
  });

  it('multator clamps to 1..300', () => {
    expect(nudgeBrushSize(1, -1, multator)).toBe(1);
    expect(nudgeBrushSize(300, 1, multator)).toBe(300);
    expect(nudgeBrushSize(295, 1, multator)).toBe(300);
  });

  it('toonop steps by 1 within its own bounds', () => {
    expect(nudgeBrushSize(10, 1, toonop)).toBe(11);
    expect(nudgeBrushSize(1, -1, toonop)).toBe(1);
    expect(nudgeBrushSize(toonop.brushSizeMax, 1, toonop)).toBe(toonop.brushSizeMax);
  });
});

describe('resolveToolSelection', () => {
  it('multator: pencil with a white color is the eraser', () => {
    expect(resolveToolSelection('pencil', '#ffffff', multator)).toBe('eraser');
    expect(resolveToolSelection('pencil', '#FFFFFF', multator)).toBe('eraser');
    expect(resolveToolSelection('pencil', '#000000', multator)).toBe('pencil');
  });

  it('multator: the pipette needs the expanded palette', () => {
    expect(resolveToolSelection('pipette', '#000000', multator, false)).toBeNull();
    expect(resolveToolSelection('pipette', '#000000', multator, true)).toBe('pipette');
  });

  it('toonop: any tool goes through as-is', () => {
    expect(resolveToolSelection('pencil', '#ffffff', toonop)).toBe('pencil');
    expect(resolveToolSelection('pipette', '#000000', toonop, false)).toBe('pipette');
  });
});

describe('toolAfterColorChange', () => {
  it('multator: white arms the eraser, any other color arms the pencil', () => {
    expect(toolAfterColorChange('#ffffff', multator)).toBe('eraser');
    expect(toolAfterColorChange('#ff0000', multator)).toBe('pencil');
  });

  it('toonop: choosing a color never changes the tool', () => {
    expect(toolAfterColorChange('#ffffff', toonop)).toBeNull();
    expect(toolAfterColorChange('#ff0000', toonop)).toBeNull();
  });
});
