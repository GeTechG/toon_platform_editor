import { describe, expect, it } from 'bun:test';

// Editor.svelte is asserted as source, the same way timeline-studio.test.ts
// checks the studio wiring: the keymap is a switch over a DOM event, and the
// rules worth pinning are which keys reach it at all.
const editorUi = await Bun.file(new URL('./Editor.svelte', import.meta.url)).text();

function onKeydown(): string {
  const match = editorUi.match(/function onKeydown\([^]*?\n  }\n/);
  if (!match) throw new Error('missing onKeydown');
  return match[0];
}

describe('modifiers reach the keymap', () => {
  it('Ctrl and Meta no longer bail out before the switch', () => {
    // The reference calls hotKeys[code] whatever modifier is held; only Alt
    // keeps a branch of its own (Alt+E, Alt+S, Alt+Enter).
    expect(onKeydown()).not.toContain('if (e.ctrlKey || e.metaKey || e.altKey) {');
    expect(onKeydown()).toContain('if (e.altKey) {');
  });

  it('a form field passes only Enter, Space and Escape through', () => {
    const source = onKeydown();
    expect(source).toContain("TYPING_KEYS");
    expect(editorUi).toContain("const TYPING_KEYS = ['Enter', ' ', 'Escape']");
  });
});

describe('frames on Ctrl+A and F7', () => {
  it('Ctrl+A and Ctrl+F7 insert a frame in front of the current one', () => {
    const source = onKeydown();
    expect(source).toMatch(/case 'F7':/);
    expect(source).toContain('editor.addFrameBeforeActive()');
    expect(source).toContain('editor.addFrameAfterActive()');
  });
});

describe('the hand owns the keyboard while it is picked', () => {
  it('zoom and pan come before the frame navigation switch', () => {
    const source = onKeydown();
    const hand = source.indexOf("editor.tool === 'drag'");
    const mainSwitch = source.indexOf("case 'ArrowLeft':");
    expect(hand).toBeGreaterThan(-1);
    expect(hand).toBeLessThan(mainSwitch);
    expect(source).toContain('editor.zoomBy(');
    expect(source).toContain('editor.panBy(');
  });

  it('Shift makes the pan step the reference 30 px', () => {
    expect(onKeydown()).toContain('e.shiftKey ? 30 : 10');
  });
});

describe('timeline navigation wraps round (Toonio parity)', () => {
  it('the layer arrows wrap instead of stopping at the ends', () => {
    expect(onKeydown()).toContain('wrapIndex(editor.activeLayer + 1');
    expect(onKeydown()).toContain('wrapIndex(editor.activeLayer - 1');
  });

  it('the ⏴/⏵ buttons wrap too, so they never go dead at an end', () => {
    expect(editorUi).toContain('editor.selectFrame(wrapIndex(editor.activeFrame - 1');
    expect(editorUi).toContain('editor.selectFrame(wrapIndex(editor.activeFrame + 1');
    expect(editorUi).not.toContain('disabled={editor.playing || editor.activeFrame === 0}\n            onclick={() => editor.selectFrame(editor.activeFrame - 1)}');
  });
});

describe('preview start (Toonio parity)', () => {
  it('Shift+Space begins at the active frame, plain Space at the range start', () => {
    expect(onKeydown()).toContain('playControls?.toggle({ fromActive: e.shiftKey })');
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
    const windows = editorUi.match(/<div class="tool-windows">[^]*?pipetteUp[^]*?<\/div>\s*\{\/if\}/)?.[0] ?? '';
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
    expect(play).toContain('disabled={!canPlay}');
  });
});
