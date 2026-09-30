import { describe, expect, it } from 'bun:test';
import { addStroke, createDocument, replaceStrokes } from '../model/operations';
import { MAX_STROKE_COORDS, MAX_STROKES_PER_FRAME } from '../format/constants';
import type { Stroke } from '../format/types';
import { formatLimitHint } from './format-limit';
import { t } from '../i18n';

// Owner's answers after the thirteenth audit, the guards.
// 3. A file dropped on the studio while a modal sheet is up does not touch
//    the drawing under it; the refusal is a short note, and the drag already
//    shows the drop will not be taken.
// 10. A stroke, the mega eraser and redo refused at the format's limit say
//    so on the canvas, in its live line, instead of a console warning only.
const UI = new URL('./', import.meta.url).pathname;
const state = await Bun.file(UI + 'editor-state.svelte.ts').text();
const canvas = await Bun.file(UI + 'CanvasView.svelte').text();
const editorUi = await Bun.file(UI + 'Editor.svelte').text();
const ru = JSON.parse(await Bun.file(UI + '../i18n/ru.json').text());

function member(source: string, name: string): string {
  const match = source.match(new RegExp(`\\n  (private )?(async )?(function )?(get )?${name}(<[^>]*>)?\\([^]*?\\n  }`));
  if (!match) throw new Error(`missing ${name}`);
  return match[0];
}

function caught(run: () => void): unknown {
  try {
    run();
  } catch (err) {
    return err;
  }
  throw new Error('did not throw');
}

describe('a refusal at the format limit names the limit', () => {
  it('a frame at the stroke limit: the frame is full', () => {
    const doc = createDocument();
    addStroke(doc, 0, 0, { points: [1, 1], width: 9, color: '#000000' });
    const one = doc.layers[0].frames[0].strokes[0];
    replaceStrokes(doc, 0, 0, Array.from({ length: MAX_STROKES_PER_FRAME }, () => one));
    const err = caught(() => addStroke(doc, 0, 0, { points: [2, 2], width: 9, color: '#000000' }));
    expect(formatLimitHint(err)).toBe(t('canvas.frame_full'));
  });

  it('a document at the point limit: the mult is full', () => {
    const doc = createDocument();
    const points = Array.from({ length: MAX_STROKE_COORDS }, (_, i) => i % 100);
    addStroke(doc, 0, 0, { points, width: 9, color: '#000000' });
    const big: Stroke = doc.layers[0].frames[0].strokes[0];
    const err = caught(() => replaceStrokes(doc, 0, 0, Array.from({ length: 31 }, () => big)));
    expect(formatLimitHint(err)).toBe(t('canvas.mult_full'));
  });

  it('any other error is not a limit, and says nothing', () => {
    expect(formatLimitHint(new RangeError('stroke must have an even coordinate count'))).toBeNull();
    expect(formatLimitHint('boom')).toBeNull();
  });

  it('the texts speak to the user', () => {
    expect(ru.canvas.frame_full).toMatch(/^Кадр полон/);
    expect(ru.canvas.mult_full).toMatch(/^Мульт полон/);
  });
});

describe('the three refusals share the canvas live line', () => {
  it('the state has one place that turns a limit into the hint', () => {
    const refuse = member(state, 'refuseAtLimit');
    expect(refuse).toContain('formatLimitHint(');
    expect(refuse).toContain('this.canvasHint');
  });

  for (const name of ['commitStroke', 'applyMegaEraser', 'redo']) {
    it(`${name} tells the canvas why`, () => {
      expect(member(state, name)).toContain('this.refuseAtLimit(');
    });
  }

  it('a refused stroke keeps the redo stack: the refusal returns before it is retired', () => {
    const commit = member(state, 'commitStroke');
    expect(commit.indexOf('this.refuseAtLimit(')).toBeLessThan(commit.indexOf('this.undone = []'));
  });

  it('the canvas says the hint in its polite live region', () => {
    expect(canvas).toMatch(/<p class="hint"[^>]*role="status"[^>]*aria-live="polite"/);
    expect(canvas).toContain('showHint(editor.canvasHint.text)');
  });
});

describe('a file dropped over an open sheet', () => {
  const drop = member(editorUi, 'onDrop');
  const over = member(editorUi, 'onDragOver');

  it('any modal dialog counts as a sheet', () => {
    expect(member(editorUi, 'sheetOpen')).toContain("'dialog:modal'");
  });

  it('the drop is refused before anything is opened', () => {
    const guard = drop.indexOf('sheetOpen()');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(drop.indexOf('openDraftsFile('));
    expect(guard).toBeLessThan(drop.indexOf('openFile('));
    expect(guard).toBeLessThan(drop.indexOf('editor.audio.load('));
    // The browser must not open the file itself either.
    expect(drop.indexOf('e.preventDefault()')).toBeLessThan(guard);
  });

  it('the drag shows it will not be taken', () => {
    expect(over).toContain('sheetOpen()');
    expect(over).toContain("dropEffect = 'none'");
    expect(over).toContain('e.preventDefault()');
    expect(editorUi).toContain('ondragover={onDragOver}');
  });

  it('the refusal is a note above the sheet, in the top layer', () => {
    expect(ru.editor.drop_sheet_open).toBe('Закрой окно, чтобы открыть файл');
    expect(editorUi).toContain("t('editor.drop_sheet_open')");
    expect(editorUi).toMatch(/<p[^>]*popover="manual"[^>]*role="status"/);
    expect(editorUi).toContain('showPopover()');
  });
});

describe('owner thirteenth, the coordinator: pastes at the limit say so too', () => {
  it('a timeline paste refused at the limit uses the canvas line', () => {
    const timeline = state.slice(state.indexOf('timeline paste rejected') - 300, state.indexOf('timeline paste rejected') + 100);
    expect(timeline).toContain('this.refuseAtLimit(err)');
  });

  it('an unreadable layout file is said, not thrown', () => {
    const arranger = fileText('PanelArranger.svelte');
    const load = arranger.slice(arranger.indexOf('async function onWorkspaceFile'), arranger.indexOf('let notice'));
    expect(load).toContain('catch');
    expect(load).toContain("t('arrange.load_unreadable')");
    expect(typeof ru.arrange.load_unreadable).toBe('string');
  });
});

function fileText(name: string): string {
  return require('node:fs').readFileSync(UI + name, 'utf8');
}
