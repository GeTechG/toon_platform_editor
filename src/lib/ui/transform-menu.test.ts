import { describe, expect, it } from 'bun:test';

const menu = await Bun.file(new URL('./TransformMenu.svelte', import.meta.url)).text();
const state = await Bun.file(new URL('./editor-state.svelte.ts', import.meta.url)).text();
const editorUi = await Bun.file(new URL('./Editor.svelte', import.meta.url)).text();

describe('TransformMenu', () => {
  it('offers a numeric field per transform parameter', () => {
    for (const label of ['X', 'Y', 'Поворот', 'Масштаб X', 'Масштаб Y']) {
      expect(menu).toContain(label);
    }
    expect(menu).toContain('type="number"');
  });

  it('mirrors both ways and carries the width checkbox', () => {
    expect(menu).toContain("editor.mirrorTransform('horizontal')");
    expect(menu).toContain("editor.mirrorTransform('vertical')");
    expect(menu).toContain('type="checkbox"');
    expect(menu).toContain('editor.setTransformWidthWithScale(');
  });

  it('applies and cancels the session', () => {
    expect(menu).toContain('editor.commitTransform()');
    expect(menu).toContain('editor.cancelTransform()');
  });

  it('steps back and forth inside the session', () => {
    expect(menu).toContain('editor.undoTransform()');
    expect(menu).toContain('editor.redoTransform()');
    expect(menu).toContain('disabled={!editor.canUndoTransform}');
    expect(menu).toContain('disabled={!editor.canRedoTransform}');
  });

  it('names every control for a reader, and takes Escape as cancel (WCAG 2.1.2)', () => {
    expect(menu).toContain('aria-label');
    expect(menu).toContain("e.key === 'Escape'");
    // The window announces itself rather than being an unnamed group of inputs.
    expect(menu).toContain('aria-label="Трансформация"');
  });

  it('is only mounted while a transform is open', () => {
    expect(editorUi).toContain('TransformMenu');
    expect(editorUi).toContain('{#if editor.transform}');
  });
});

describe('session history in the state', () => {
  it('remembers each step so the window can walk back through it', () => {
    expect(state).toContain('undoTransform');
    expect(state).toContain('redoTransform');
    // Every write goes through setTransform, so that is the one place a step
    // is recorded — no second path can slip past the history.
    const setTransform = state.match(/setTransform\(session: TransformSession\)[^]*?\n  }/)?.[0] ?? '';
    expect(setTransform).toContain('past');
  });
});

describe('leaving an open transform', () => {
  it('applies it when the frame, the layer or the tool changes', () => {
    // One guard, called from each entry point, rather than the same three
    // lines copied into every navigation method.
    for (const name of ['selectFrame', 'selectLayer', 'selectTool', 'selectCell']) {
      const method = state.match(new RegExp(`\\n  ${name}\\([^]*?\\n  }`))?.[0] ?? '';
      expect(method).toContain('leaveTransform()');
    }
    expect(state).toContain('this.commitTransform()');
  });

  it('blocks the move instead, in the reference "paranoid" mode', () => {
    const leave = state.match(/leaveTransform\(\): boolean \{[^]*?\n  }/)?.[0] ?? '';
    expect(leave).toContain('this.transformLock');
    expect(leave).toContain('return false');
  });
});

describe('where the tool windows live', () => {
  it('floats them over the stage, not in the 8.4rem tool rail', () => {
    // The rail is two 44px columns wide; number fields, four mirror/step
    // buttons and Apply/Cancel do not fit in it at any font size.
    const stage = editorUi.match(/<div class="stage">[^]*?\n  <\/div>/)?.[0] ?? '';
    expect(stage).toContain('TransformMenu');
    expect(stage).toContain('ScaleMenu');
    const rail = editorUi.match(/<aside class="left"[^]*?<\/aside>/)?.[0] ?? '';
    expect(rail).not.toContain('TransformMenu');
    expect(rail).not.toContain('ScaleMenu');
    expect(editorUi).toContain('.tool-windows');
  });

  it('gives each field its label on the same line, so nothing wraps', () => {
    expect(menu).toContain('grid-template-columns: auto 1fr');
  });
});
