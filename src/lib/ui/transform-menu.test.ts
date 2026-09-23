import { describe, expect, it } from 'bun:test';
import { t } from '../i18n';

const menu = await Bun.file(new URL('./TransformMenu.svelte', import.meta.url)).text();
const state = await Bun.file(new URL('./editor-state.svelte.ts', import.meta.url)).text();
const editorUi = await Bun.file(new URL('./Editor.svelte', import.meta.url)).text();

describe('TransformMenu', () => {
  it('offers a numeric field per transform parameter', () => {
    expect(menu).toContain('>X</label>');
    expect(menu).toContain('>Y</label>');
    for (const key of ['transform.rotate', 'transform.scale_x', 'transform.scale_y']) {
      expect(menu).toContain(`t('${key}')`);
      expect(t(key)).not.toBe(key);
    }
    expect(t('transform.rotate')).toBe('Поворот');
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
    expect(menu).toContain("aria-label={t('transform.title')}");
    expect(t('transform.title')).toBe('Трансформация');
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
    const stage = editorUi.match(/<div class="stage"[^]*?\n  <\/div>/)?.[0] ?? '';
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

describe('a field being typed into', () => {
  it('writes nothing while it holds no number yet', () => {
    // An emptied field, or a lone "-" on the way to a negative one, reads as
    // "" — `Number('')` is 0, so X jumped to the edge and a scale collapsed
    // the selection to nothing before the user had typed a digit.
    expect(menu).not.toContain('Number(e.currentTarget.value)');
    expect(menu).not.toContain('Number(raw)');
    expect(menu).toContain('e.currentTarget.valueAsNumber');
    expect(menu).toContain('Number.isFinite(value)');
  });
});

describe('on a phone', () => {
  it('keeps the numbers folded, so the window does not take the stage from the selection', () => {
    // Under 40rem the tool windows sit under the canvas, in the same column:
    // the full window was ~430 px and squeezed the canvas to nothing, handles
    // and all — the one thing a finger transforms with.
    expect(menu).toContain('<details class="numbers"');
    expect(menu).toContain("matchMedia('(max-width: 40rem)')");
    expect(t('transform.numbers')).not.toBe('transform.numbers');
  });

  it('never lets the windows push the canvas below half the stage', () => {
    const narrow = editorUi.match(/@media \(max-width: 40rem\) \{\n    \.stage \{[^]*?\n  \}\n/)?.[0] ?? '';
    expect(narrow).toContain('flex: 1 0 50%');
    expect(narrow).toContain('overflow-y: auto');
  });
});

describe('beside the zoom window', () => {
  it('ends above it, so a tall transform window never runs under the zoom row', () => {
    // At 200 % text the translucent zoom row lay over «Поворот» and its field.
    const windows = editorUi.match(/\n  \.tool-windows \{[^}]*\}/)?.[0] ?? '';
    expect(windows).toContain('- var(--key-h, 2.75rem)');
  });
});
