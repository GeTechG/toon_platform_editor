import { describe, expect, it } from 'bun:test';
import { buildKeymap, studioCommands } from './keymap';

// Editor.svelte is asserted as source, the same way timeline-studio.test.ts
// checks the studio wiring: the keymap is a switch over a DOM event, and the
// rules worth pinning are which keys reach it at all.
const editorUi = await Bun.file(new URL('./Editor.svelte', import.meta.url)).text();

function onKeydown(): string {
  const match = editorUi.match(/function onKeydown\([^]*?\n  }\n/);
  if (!match) throw new Error('missing onKeydown');
  return match[0];
}

const runCommand = editorUi.slice(editorUi.indexOf('function runCommand'), editorUi.indexOf('// Installed plugins come up'));
const keys = buildKeymap(studioCommands([]), {});

describe('modifiers reach the keymap', () => {
  it('Ctrl and Meta no longer bail out before the switch', () => {
    // The reference calls hotKeys[code] whatever modifier is held; only Alt
    // keeps a branch of its own (Alt+E, Alt+S, Alt+Enter).
    expect(onKeydown()).not.toContain('if (e.ctrlKey || e.metaKey || e.altKey) {');
    expect(onKeydown()).toContain('if (e.altKey) {');
  });

  it('a key the focused control owns never reaches the table (key-owner.ts)', () => {
    const source = onKeydown();
    expect(source).toContain('keyOwner(');
    expect(source).toContain('letterKeys: editor.settings.letterKeys');
    expect(source).toContain('document.querySelector(SHEET_UP)');
    expect(editorUi).not.toContain('TYPING_KEYS');
  });
});

describe('frames on Ctrl+A and F7', () => {
  it('Ctrl+A and Ctrl+F7 insert a frame in front of the current one', () => {
    expect(keys.resolve('Ctrl+a')).toBe('add-frame-before');
    expect(keys.resolve('Ctrl+F7')).toBe('add-frame-before');
    expect(keys.resolve('a')).toBe('add-frame');
    expect(keys.resolve('F7')).toBe('add-frame');
    expect(runCommand).toMatch(/case 'add-frame-before':\s*editor\.addFrameBeforeActive\(\)/);
    expect(runCommand).toMatch(/case 'add-frame':\s*editor\.addFrameAfterActive\(\)/);
  });
});

describe('the hand owns the keyboard while it is picked', () => {
  it('zoom and pan come before the frame navigation switch', () => {
    const hand = runCommand.indexOf("editor.tool === 'drag'");
    const frameSteps = runCommand.indexOf('moveOrExtend(');
    expect(hand).toBeGreaterThan(-1);
    expect(hand).toBeLessThan(frameSteps);
    expect(hand).toBeLessThan(runCommand.indexOf("case 'brush-bigger':\n        editor.increaseBrushSize()"));
    expect(runCommand).toContain('editor.zoomBy(');
    expect(runCommand).toContain('editor.panBy(');
  });

  it('Shift makes the pan step the reference 30 px', () => {
    expect(runCommand).toContain("const far = e.shiftKey || command.startsWith('extend-');");
    expect(runCommand).toContain('far ? 30 : 10');
  });
});

describe('timeline navigation wraps round (Toonio parity)', () => {
  it('the layer arrows wrap instead of stopping at the ends', () => {
    // The arrows pass a step; the bare move wraps it (Shift clamps, ninth audit).
    expect(keys.resolve('ArrowUp')).toBe('layer-up');
    expect(keys.resolve('ArrowDown')).toBe('layer-down');
    expect(editorUi).toContain("'layer-up': [0, 1], 'layer-down': [0, -1]");
    expect(runCommand).toContain('moveOrExtend(far, arrow[0], arrow[1])');
    expect(editorUi).toContain('editor.selectLayer(wrapIndex(active.layer + dLayer, editor.doc.layers.length))');
  });

  it('the ⏴/⏵ buttons wrap too, so they never go dead at an end', () => {
    expect(editorUi).toContain('editor.selectFrame(wrapIndex(editor.activeFrame - 1');
    expect(editorUi).toContain('editor.selectFrame(wrapIndex(editor.activeFrame + 1');
    expect(editorUi).not.toContain('disabled={editor.playing || editor.activeFrame === 0}\n            onclick={() => editor.selectFrame(editor.activeFrame - 1)}');
  });
});

describe('preview start (Toonio parity)', () => {
  it('Shift+Space begins at the active frame, plain Space at the range start', () => {
    expect(keys.resolve('Space')).toBe('play');
    expect(keys.resolve('Shift+Space')).toBe('play-from-active');
    expect(runCommand).toMatch(/case 'play':\s*playControls\?\.toggle\(\{ fromActive: false \}\)/);
    expect(runCommand).toMatch(/case 'play-from-active':\s*playControls\?\.toggle\(\{ fromActive: true \}\)/);
  });
});

describe('one confirm for the whole editor', () => {
  it('the state asks through Editor.svelte rather than calling confirm itself', () => {
    expect(editorUi).toContain('editor.ask =');
  });
});

describe('the pipette source is a tool window, not a panel key', () => {
  it('comes up with the pipette and goes with it, like the zoom window', () => {
    // On a panel it was a pair of keys that sat there dead whenever the
    // pipette was down. A window that is only there while the tool is has
    // nothing to disable.
    expect(editorUi).toContain('{#if pipetteUp}');
    expect(editorUi).not.toContain('disabled={!pipetteUp}');
    expect(editorUi).not.toContain("id === 'pick-source'");
    const windows = editorUi.match(/<div class="tool-windows"[^>]*>[^]*?pipetteUp[^]*?<\/div>\s*\{\/if\}/)?.[0] ?? '';
    expect(windows).toContain('editor.setPickSource');
  });
});

const play = await Bun.file(new URL('./PlayControls.svelte', import.meta.url)).text();

describe('the transport plays the range (Toonio parity)', () => {
  it('asks frame-selection what to play instead of only where to start', () => {
    expect(play).toContain('playbackRange(');
    expect(play).not.toContain('playbackStartFrame(');
  });

  it('hands the loop its bounds', () => {
    expect(play).toContain('loopStart:');
    expect(play).toContain('loopEnd:');
  });

  it('the button is dead when there is nothing to play', () => {
    expect(play).toContain('canPlay');
    expect(play).toContain('aria-disabled={!canPlay');
  });
});
