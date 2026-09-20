import { describe, expect, it } from 'bun:test';
import {
  UX_PROFILES,
  isHelpTool,
  nudgeBrushSize,
  resolveToolSelection,
  toolAfterColorChange,
  toolAfterHelp,
} from './ux-profile';

const multator = UX_PROFILES.multator;
const toonop = UX_PROFILES.toonop;
const toonio = UX_PROFILES.toonio;

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

  it('toonop carries the toonio behavior as its own values', () => {
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

  it('holds those values separately from toonio, so editing one mode leaves the other alone', () => {
    expect(toonop.tools).not.toBe(toonio.tools);
    expect(toonop.fpsRange).not.toBe(toonio.fpsRange);
  });

  it('toonio reproduces the reference toonio.ru editor', () => {
    // bundle:426/437 history onion, editor.html:270 fps 1–30, tools.js:631 pipette.
    expect(toonio.onionMode).toBe('history');
    expect(toonio.colorGrid).toBe(true);
    expect(toonio.fpsRange).toEqual([1, 30]);
    expect(toonio.livePipettePreview).toBe(true);
    expect(toonio.crossCursor).toBe(true);
    expect(toonio.defaultFps).toBe(12);
    expect(toonio.brushSizeMax).toBe(500);
    expect(toonio.quickPalette).toBeNull();
    expect(toonio.whiteIsEraser).toBe(false);
    expect(toonio.activeFrameAlpha).toBe(1);
  });

  it('multator alone keeps the one-bar chrome', () => {
  });

  it('offers the Tonio toolset under Toonio and Toonop', () => {
    expect(toonio.tools).toEqual([
      'pencil', 'eraser', 'feather', 'mega-eraser', 'pipette',
      'drag', 'lasso', 'distort',
    ]);
    expect(multator.tools).toEqual(['pencil', 'eraser', 'pipette']);
  });

  it('keeps the pixel tool where the reference does not show it — out of Toonio', () => {
    // The reference toolbar has no pixel button, so parity means hiding it
    // there; Toonop is where it stays available.
    expect(toonio.tools).not.toContain('pixel');
    expect(toonop.tools).toEqual([
      'pencil', 'eraser', 'feather', 'mega-eraser', 'pipette',
      'drag', 'lasso', 'distort', 'pixel',
    ]);
    expect(multator.tools).not.toContain('pixel');
  });

  it('multator keeps the neighbor onion and the narrow fps range', () => {
    expect(multator.onionMode).toBe('neighbors');
    expect(multator.colorGrid).toBe(false);
    expect(multator.fpsRange).toEqual([5, 24]);
  });
});

describe('resolveToolSelection with a profile toolset', () => {
  it('ignores a tool the profile does not offer', () => {
    expect(resolveToolSelection('feather', '#000000', multator)).toBeNull();
    expect(resolveToolSelection('feather', '#000000', toonio)).toBe('feather');
  });

  it('a tool the arrangement puts back is offered, whatever the preset started with', () => {
    // The preset chooses the starting arrangement; what is on the panels
    // after that is what the editor has (panels.ts `visibleTools`).
    expect(resolveToolSelection('feather', '#000000', multator, true, ['pencil', 'feather']))
      .toBe('feather');
    expect(resolveToolSelection('lasso', '#000000', toonio, true, ['pencil']))
      .toBeNull();
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
    expect(toonop.brushSizeMax).toBe(500);
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

  it('toonio keeps the pipette off the rail — it lives in the palette foot', () => {
    expect(toonio.pipetteOffRail).toBe(true);
    expect(toonop.pipetteOffRail).toBe(true);
    expect(multator.pipetteOffRail).toBe(false);
    // Off the rail, not out of the editor: P and the palette button still arm it.
    expect(resolveToolSelection('pipette', '#000000', toonio)).toBe('pipette');
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

describe('transform tools', () => {
  it('toonio offers the hand, lasso and distort the reference has', () => {
    expect(toonio.tools).toContain('drag');
    expect(toonio.tools).toContain('lasso');
    expect(toonio.tools).toContain('distort');
  });

  it('toonop offers them too, multator does not', () => {
    for (const tool of ['drag', 'lasso', 'distort'] as const) {
      expect(toonop.tools).toContain(tool);
      expect(multator.tools).not.toContain(tool);
    }
  });

  it('asking for a transform tool the preset has no button for is refused', () => {
    expect(resolveToolSelection('lasso', '#000000', multator)).toBeNull();
    expect(resolveToolSelection('lasso', '#000000', toonop)).toBe('lasso');
    expect(resolveToolSelection('lasso', '#000000', toonio)).toBe('lasso');
  });
});

describe('help tools and the drawing tool behind them', () => {
  it('names the tools that only help, never draw', () => {
    expect((['pipette', 'drag', 'lasso', 'distort'] as const).every(isHelpTool)).toBe(true);
    expect((['pencil', 'eraser', 'feather', 'pixel', 'mega-eraser'] as const).some(isHelpTool)).toBe(false);
  });

  it('gives back the tool that was drawing, but never an eraser', () => {
    expect(toolAfterHelp('feather')).toBe('feather');
    expect(toolAfterHelp('pixel')).toBe('pixel');
    expect(toolAfterHelp('eraser')).toBe('pencil');
    expect(toolAfterHelp('mega-eraser')).toBe('pencil');
  });
});

describe('timeline behaviour by profile', () => {
  it('toonio and toonop play the selection, put a new layer under the active one and keep redo alive', () => {
    for (const profile of [toonio, toonop]) {
      expect(profile.playbackRange).toBe('selection');
      expect(profile.newLayerPosition).toBe('below');
      expect(profile.redoSurvivesStroke).toBe(true);
    }
  });

  it('multator keeps playing the whole document and stacking layers upward', () => {
    expect(multator.playbackRange).toBe('document');
    expect(multator.newLayerPosition).toBe('above');
    expect(multator.redoSurvivesStroke).toBe(false);
  });
});
