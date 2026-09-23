import { describe, expect, it, test } from 'bun:test';
import { dropPlacement, insertIndex, rowEdge, type Box } from './arrange';
import { t } from '../i18n';

/** A row of three 40px-wide boxes at y 0..40. */
const row: Box[] = [
  { left: 0, top: 0, right: 40, bottom: 40 },
  { left: 40, top: 0, right: 80, bottom: 40 },
  { left: 80, top: 0, right: 120, bottom: 40 },
];
/** The same three, stacked. */
const column: Box[] = [
  { left: 0, top: 0, right: 40, bottom: 40 },
  { left: 0, top: 40, right: 40, bottom: 80 },
  { left: 0, top: 80, right: 40, bottom: 120 },
];

describe('where a dragged item lands', () => {
  test('an empty panel takes it first', () => {
    expect(insertIndex([], 10, 10)).toBe(0);
  });

  test('a row reads left to right', () => {
    expect(insertIndex(row, 5, 20)).toBe(0);
    expect(insertIndex(row, 45, 20)).toBe(1);
    expect(insertIndex(row, 75, 20)).toBe(2);
    expect(insertIndex(row, 200, 20)).toBe(3);
  });

  test('a column reads top to bottom', () => {
    expect(insertIndex(column, 20, 5)).toBe(0);
    expect(insertIndex(column, 20, 45)).toBe(1);
    expect(insertIndex(column, 20, 300)).toBe(3);
  });

  test('the pointer is measured along the side it is furthest from the middle on', () => {
    // Past the right edge of a tall, narrow box: that is "after", even though
    // the pointer is a little above its middle.
    expect(insertIndex([{ left: 0, top: 0, right: 20, bottom: 200 }], 19, 90)).toBe(1);
    expect(insertIndex([{ left: 0, top: 0, right: 20, bottom: 200 }], 10, 5)).toBe(0);
  });
});

describe('what the drop indicator draws', () => {
  test('it names the edge the line goes on', () => {
    expect(dropPlacement(row, 5, 20)).toMatchObject({ index: 0, edge: 'left' });
    // Nearest is the middle box, and the pointer is past its right edge —
    // the same gap as "before the third", drawn on the side the eye is on.
    expect(dropPlacement(row, 75, 20)).toMatchObject({ index: 2, edge: 'right' });
    expect(dropPlacement(row, 200, 20)).toMatchObject({ index: 3, edge: 'right' });
    expect(dropPlacement(column, 20, 45)).toMatchObject({ index: 1, edge: 'top' });
    expect(dropPlacement(column, 20, 300)).toMatchObject({ index: 3, edge: 'bottom' });
  });

  test('it hands back the box the line sits on, and none for an empty panel', () => {
    expect(dropPlacement(row, 75, 20).box).toEqual(row[1]);
    expect(dropPlacement([], 10, 10).box).toBeNull();
  });

  test('the index it gives is the one a drop uses', () => {
    for (const [x, y] of [[5, 20], [45, 20], [75, 20], [200, 20]]) {
      expect(dropPlacement(row, x, y).index).toBe(insertIndex(row, x, y));
    }
  });
});

describe('a drop past the edge of a row', () => {
  const band: Box = { left: 0, top: 100, right: 400, bottom: 144 };

  test('near the top edge it is a row above, near the bottom a row below', () => {
    expect(rowEdge(band, 102)).toBe('before');
    expect(rowEdge(band, 142)).toBe('after');
  });

  test('the middle of the row is no edge at all — it just joins the row', () => {
    expect(rowEdge(band, 122)).toBeNull();
  });

  test('a tall row keeps a hand-sized band, not a quarter of its height', () => {
    const tall: Box = { left: 0, top: 0, right: 400, bottom: 600 };
    expect(rowEdge(tall, 300)).toBeNull();
    expect(rowEdge(tall, 4)).toBe('before');
    expect(rowEdge(tall, 596)).toBe('after');
  });

  test('a row too thin to have a middle still takes items into it', () => {
    const thin: Box = { left: 0, top: 0, right: 400, bottom: 8 };
    expect(rowEdge(thin, 4)).toBeNull();
  });
});

// --- Wiring ---------------------------------------------------------------
// Svelte/runes glue is asserted as source (the contract style this folder
// uses); the geometry above runs for real.
const editorUi = await Bun.file(new URL('./Editor.svelte', import.meta.url)).text();
const arranger = await Bun.file(new URL('./PanelArranger.svelte', import.meta.url)).text();
const floatWindow = await Bun.file(new URL('./FloatWindow.svelte', import.meta.url)).text();
const state = await Bun.file(new URL('./editor-state.svelte.ts', import.meta.url)).text();
const sheet = await Bun.file(new URL('./SettingsSheet.svelte', import.meta.url)).text();

describe('arranging happens in the editor itself', () => {
  test('the mode is a flag on the state, not a stored setting', () => {
    expect(state).toContain('arranging = $state(false)');
    expect(state).toContain('floatPos = $state');
  });

  test('a panel with nothing in it is not drawn at all', () => {
    // The columns already go; the bottom panel goes the same way, so an
    // arrangement that empties it gives the canvas the room.
    expect(editorUi).toContain('editor.panels.left.length > 0 || editor.arranging');
    expect(editorUi).toContain('editor.panels.right.length > 0 || editor.arranging');
    expect(editorUi).toContain('editor.panels.rows.length > 0 || editor.arranging');
  });

  test('every panel is a drop target and every item is a handle', () => {
    for (const slot of ['left', 'right', 'float']) {
      expect(editorUi).toContain(`data-slot="${slot}"`);
    }
    // …and each row. A new row is made by dragging past a row's edge, so
    // there are no permanent gap strips puffing the panel up.
    expect(editorUi).toContain('data-slot="row:{i}"');
    expect(editorUi).not.toContain('newrow:{at}');
    expect(arranger).toContain('rowEdge(');
    expect(arranger).toContain('newRowSlot(');
    expect(editorUi).toContain('data-item={id}');
    expect(editorUi).toContain('editor.arranging');
  });

  test('the drag is pointer events, so it works on a touch screen', () => {
    expect(arranger).toContain('pointerdown');
    expect(arranger).toContain('pointermove');
    expect(arranger).toContain('pointerup');
    expect(arranger).not.toContain('dragstart');
    expect(arranger).toContain('elementFromPoint');
    // Escape puts the arrangement back the way it was.
    expect(arranger).toContain("'Escape'");
    // Nothing moves until the hand lets go: a live-applied drag re-sorts the
    // panel under the pointer and the item jitters between two places.
    expect(arranger).toContain('dropPlacement(');
    expect(arranger).toContain('DRAG_THRESHOLD');
    expect(arranger).toContain('drop-line');
  });

  test('a window dropped on the canvas floats, and remembers where', () => {
    expect(arranger).toContain("'float'");
    expect(floatWindow).toContain('clampWindowPosition');
    expect(floatWindow).toContain('setFloatPos');
  });

  test('the close key puts the window back in a panel, and is not a grab', () => {
    expect(floatWindow).toContain('editor.showPanelItem(id)');
    // The title bar's own pointerdown must not swallow the key's click.
    expect(floatWindow).toContain("closest('button')");
  });

  test('a window floats over the whole editor, panels included', () => {
    // Its frame is the editor, not the canvas: a window parked at the edge
    // must not jump when a column folds and the stage changes size.
    expect(editorUi).toContain('data-float-root');
    const stage = editorUi.match(/<div class="stage"[^]*?\n  <\/div>/)?.[0] ?? '';
    expect(stage).not.toContain('<FloatWindow');
    expect(editorUi).toContain('<FloatWindow');
    // …and a viewport that shrinks brings it back in rather than leaving it
    // outside, where the first drag would snap it. The editor is watched, not
    // the browser window: it is what the window is measured against.
    expect(floatWindow).toContain('watcher.observe(el.offsetParent)');
  });
});

describe('named arrangements', () => {
  test('the state saves, applies and forgets a workspace', () => {
    expect(state).toContain('workspaces = $state');
    expect(state).toContain('saveWorkspace(');
    expect(state).toContain('applyWorkspace(');
    expect(state).toContain('deleteWorkspace(');
    // A stored workspace is a runes proxy; structuredClone refuses those.
    expect(state).toContain('$state.snapshot(workspace)');
  });

  test('the arrange bar picks one, names one and drops one', () => {
    expect(arranger).toContain('editor.applyWorkspace(');
    expect(arranger).toContain('editor.saveWorkspace(');
    expect(arranger).toContain('editor.deleteWorkspace(');
    // A name is typed in the bar, not into a browser prompt.
    expect(arranger).not.toContain('prompt(');
  });
});

describe('an arrangement travels as a file', () => {
  test('the state writes the picked one and reads a file back', () => {
    expect(state).toContain('exportWorkspace(id?: number)');
    expect(state).toContain('importWorkspaces(');
  });

  test('the arrange bar downloads one and loads one, under a latin name', () => {
    expect(arranger).toContain('editor.exportWorkspace(');
    expect(arranger).toContain('editor.importWorkspaces(');
    expect(arranger).toContain("'layout.json'");
    expect(arranger).toContain('workspaceFile');
  });

  test('the sheet keeps the file out of the settings list', () => {
    expect(sheet).not.toContain('exportWorkspace');
    expect(sheet).not.toContain('importWorkspaces');
  });

  test('the sheet no longer resets what the arrange bar resets', () => {
    // The reset lives where the panels are being moved, not twice.
    expect(sheet).not.toContain('resetPanels()');
    expect(arranger).toContain('resetPanels()');
  });
});

describe('the handle frames the item it grabs', () => {
  test('the dashed box sits around the key, not across its edge', () => {
    // outline-offset: -2px drew the frame over the key's own corners, so the
    // frame read as smaller than what it holds.
    const handle = editorUi.slice(editorUi.indexOf('.editor.arranging .arr {'));
    expect(handle).not.toContain('outline-offset: -2px');
    expect(handle.slice(0, handle.indexOf('}'))).toContain('calc(var(--r-sm) + 2px)');
  });

  test('the handle hugs the item rather than the cell it sits in', () => {
    // Stretched to a grid cell, the frame stood off the key by whatever the
    // cell had spare — wider on one side, taller than the key. Centred, the
    // handle is the key plus its 2px, so the gap is the same all round.
    const handle = editorUi.slice(editorUi.indexOf('.editor.arranging .arr {'));
    expect(handle.slice(0, handle.indexOf('}'))).toContain('place-self: center');
    // A full-width item (the strip, the palette box) still takes the row.
    const wide = editorUi.slice(editorUi.indexOf('.editor.arranging .arr.wide {'));
    expect(wide.slice(0, wide.indexOf('}'))).toContain('place-self: stretch');
  });

  test('the item keeps its own size inside the handle', () => {
    const frozen = editorUi.slice(editorUi.indexOf('.editor.arranging .arr > :global(*) {'));
    const block = frozen.slice(0, frozen.indexOf('}'));
    expect(block).toContain('box-shadow: none');
    // A zero basis, or a min-width of 0, squeezed the keys in the bar below
    // their square footprint.
    expect(block).not.toContain('min-width: 0');
    expect(block).not.toContain('flex: 1;');
  });
});

// A host's note over the canvas — the site's first-run hint — was centred on
// the whole editor, so at 768 and on a phone turned sideways half of it lay
// over the palette column. The stage is the only box that knows where the
// canvas is; a note handed to it is placed against the canvas and nothing else.
describe('a host can put a note on the stage', () => {
  it('the editor takes a stageNote snippet and renders it inside the stage', () => {
    expect(editorUi).toContain('stageNote?: Snippet');
    const stage = editorUi.slice(editorUi.indexOf('<div class="stage" data-slot="float">'));
    expect(stage.slice(0, 400)).toContain('{@render stageNote?.()}');
  });
});

describe('eighth audit: the arrange bar', () => {
  test('lies in the paper tone, so its white keys have a form and it parts from the sheet', () => {
    // On the white bar «Сохранить», «Скачать», «Сбросить» read as bare words,
    // and the bar ran into the white sheet under it. Plates part by tone.
    expect(arranger).toMatch(/\.arrange-bar \{[^}]*background:\s*var\(--paper\)/);
    expect(arranger).not.toMatch(/\.arrange-bar \{[^}]*box-shadow/);
  });

  test('a loaded file says what it brought, and a wrong one says so', () => {
    expect(arranger).toContain('const loaded = editor.importWorkspaces(');
    expect(arranger).toContain("t('arrange.load_failed')");
    expect(arranger).toContain("t('arrange.loaded'");
    expect(arranger).toContain('aria-live="polite"');
    expect(t('arrange.load_failed')).not.toBe('arrange.load_failed');
  });
});

describe('ninth audit: the arrange bar leaves the panels in reach on a phone', () => {
  test('the workspace keys fold away on a narrow screen', () => {
    // At 320×640 the bar stood 487px tall over the very panels it rearranges:
    // the tool rail and the palette could not be picked up at all.
    expect(arranger).toMatch(/<details class="ws"[^>]*open=\{wide\}/);
    expect(arranger).toContain("matchMedia('(min-width: 40rem)')");
    expect(arranger).toContain('@media (min-width: 40rem)');
    expect(t('arrange.workspaces')).not.toBe('arrange.workspaces');
  });
});

describe('ninth audit: the arrange bar never runs off the screen', () => {
  test('it scrolls inside itself when the text is large', () => {
    expect(arranger).toMatch(/\.arrange-bar \{[^}]*max-height: calc\(100% - 2rem\)/);
    expect(arranger).toMatch(/\.arrange-bar \{[^}]*overflow-y: auto/);
  });
});
