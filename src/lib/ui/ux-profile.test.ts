import { describe, expect, it } from 'bun:test';
import type { UxProfile } from '../plugins/contract';
import { isHelpTool } from '../plugins';
import {
  TOONOP_UX,
  nudgeBrushSize,
  resolveToolSelection,
  toolAfterColorChange,
  toolAfterHelp,
} from './ux-profile';

const toonop = TOONOP_UX;

/**
 * A profile with the other answer to every flag the functions below branch
 * on. It stands in for a preset a plugin brings: the editor holds one profile
 * and must not be written as if it knew any other.
 */
const strict: UxProfile = {
  ...TOONOP_UX,
  quickPalette: ['#000000', '#ff0000'],
  whiteIsEraser: true,
  pipetteNeedsPalette: true,
  pipetteOffRail: false,
  brushSizeMax: 640,
  adaptiveBrushStep: true,
  tools: ['pencil', 'eraser', 'pipette'],
};

describe('the editor profile', () => {
  it('carries the behaviour it took from elsewhere as its own values', () => {
    expect(toonop.quickPalette).toBeNull();
    expect(toonop.whiteIsEraser).toBe(false);
    expect(toonop.pipetteNeedsPalette).toBe(false);
    expect(toonop.pipetteOffRail).toBe(true);
    expect(toonop.onionSides).toBe('both');
    expect(toonop.activeFrameAlpha).toBe(1);
    expect(toonop.afterRemove).toBe('next');
    expect(toonop.playFromStart).toBe(false);
    expect(toonop.playbackRange).toBe('selection');
    expect(toonop.newLayerPosition).toBe('below');
    expect(toonop.redoSurvivesStroke).toBe(true);
    expect(toonop.defaultFps).toBe(12);
    expect(toonop.brushSizeMax).toBe(500);
    expect(toonop.adaptiveBrushStep).toBe(false);
    expect(toonop.onionMode).toBe('history');
    expect(toonop.colorGrid).toBe(true);
    expect(toonop.fpsRange).toEqual([1, 30]);
    expect(toonop.livePipettePreview).toBe(true);
    expect(toonop.crossCursor).toBe(true);
  });

  it('rasterises by the screen and keeps no project file of its own', () => {
    // One document has one rasterisation and a file is the editor's, not the
    // pen's: neither can follow a brush.
    expect(toonop.canvasDensity).toBe('device');
    expect(toonop.projectFile).toBe(false);
  });

  it('offers its whole toolset, the pixel of the shipped plugin included', () => {
    expect(toonop.tools).toEqual([
      'pencil', 'eraser', 'feather', 'mega-eraser', 'pipette',
      'drag', 'lasso', 'distort', 'pixel',
    ]);
  });
});

describe('resolveToolSelection with a profile toolset', () => {
  it('ignores a tool the profile does not offer', () => {
    expect(resolveToolSelection('feather', '#000000', strict)).toBeNull();
    expect(resolveToolSelection('feather', '#000000', toonop)).toBe('feather');
  });

  it('a tool the arrangement puts back is offered, whatever the preset started with', () => {
    // The preset chooses the starting arrangement; what is on the panels
    // after that is what the editor has (panels.ts `visibleTools`).
    expect(resolveToolSelection('feather', '#000000', strict, true, ['pencil', 'feather']))
      .toBe('feather');
    expect(resolveToolSelection('lasso', '#000000', toonop, true, ['pencil']))
      .toBeNull();
  });

  it('white arms the eraser only where the profile says so', () => {
    expect(resolveToolSelection('pencil', '#ffffff', strict)).toBe('eraser');
    expect(resolveToolSelection('pencil', '#FFFFFF', strict)).toBe('eraser');
    expect(resolveToolSelection('pencil', '#000000', strict)).toBe('pencil');
    expect(resolveToolSelection('pencil', '#ffffff', toonop)).toBe('pencil');
  });

  it('a pipette that needs the palette is refused while it is collapsed', () => {
    expect(resolveToolSelection('pipette', '#000000', strict, false)).toBeNull();
    expect(resolveToolSelection('pipette', '#000000', strict, true)).toBe('pipette');
    expect(resolveToolSelection('pipette', '#000000', toonop, false)).toBe('pipette');
  });
});

describe('nudgeBrushSize', () => {
  // The reference stepped by 1/5/10 at 10 and 50 of its 600-wide canvas;
  // on the editor's the same ladder is 2/10/20 at 20 and 100.
  it('an adaptive profile steps by 2 below 20, by 10 below 100, by 20 above', () => {
    expect(nudgeBrushSize(8, 1, strict)).toBe(10);
    expect(nudgeBrushSize(18, 1, strict)).toBe(20);
    expect(nudgeBrushSize(20, 1, strict)).toBe(30);
    expect(nudgeBrushSize(20, -1, strict)).toBe(10);
    expect(nudgeBrushSize(90, 1, strict)).toBe(100);
    expect(nudgeBrushSize(100, 1, strict)).toBe(120);
    expect(nudgeBrushSize(100, -1, strict)).toBe(80);
  });

  it('clamps to 1 and the profile ceiling', () => {
    expect(nudgeBrushSize(1, -1, strict)).toBe(1);
    expect(nudgeBrushSize(640, 1, strict)).toBe(640);
    expect(nudgeBrushSize(630, 1, strict)).toBe(640);
  });

  it('the editor profile steps by 1 within its own bounds', () => {
    expect(nudgeBrushSize(10, 1, toonop)).toBe(11);
    expect(nudgeBrushSize(1, -1, toonop)).toBe(1);
    expect(nudgeBrushSize(toonop.brushSizeMax, 1, toonop)).toBe(toonop.brushSizeMax);
  });
});

describe('toolAfterColorChange', () => {
  it('white arms the eraser where the profile says so, any other colour the pencil', () => {
    expect(toolAfterColorChange('#ffffff', strict)).toBe('eraser');
    expect(toolAfterColorChange('#ff0000', strict)).toBe('pencil');
  });

  it('the editor profile never changes the tool on a colour', () => {
    expect(toolAfterColorChange('#ffffff', toonop)).toBeNull();
    expect(toolAfterColorChange('#ff0000', toonop)).toBeNull();
  });
});

describe('help tools and the drawing tool behind them', () => {
  it('names the tools that only help, never draw', () => {
    expect((['pipette', 'drag', 'lasso', 'distort'] as const).every(isHelpTool)).toBe(true);
    expect((['pencil', 'eraser', 'feather', 'mega-eraser'] as const).some(isHelpTool)).toBe(false);
  });

  it('gives back the tool that was drawing, but never an eraser', () => {
    expect(toolAfterHelp('feather')).toBe('feather');
    expect(toolAfterHelp('eraser')).toBe('pencil');
    expect(toolAfterHelp('mega-eraser')).toBe('pencil');
  });
});
