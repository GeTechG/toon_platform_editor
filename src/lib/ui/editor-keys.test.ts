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
