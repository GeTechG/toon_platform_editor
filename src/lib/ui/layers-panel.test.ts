import { describe, expect, it } from 'bun:test';
import { t } from '../i18n';

const source = await Bun.file(new URL('./LayerRows.svelte', import.meta.url)).text();
const rows = source;
const state = await Bun.file(new URL('./editor-state.svelte.ts', import.meta.url)).text();

function fn(name: string): string {
  const match = source.match(new RegExp(`function ${name}\\([^]*?\\n  }`));
  if (!match) throw new Error(`missing ${name}`);
  return match[0];
}

describe('layer drag contract', () => {
  it('counts the rows the list scrolled past under the pointer', () => {
    // With auto-scroll the pointer can stay still while rows move, so travel
    // is pointer delta plus scroll delta — otherwise rows revealed by the
    // auto-scroll are unreachable.
    const update = fn('updateTarget');
    expect(update).toContain('scrollTop');
    expect(update).toContain('dragTargetIndex');
    expect(source).toContain('startScroll');
  });

  it('re-evaluates the target while auto-scrolling, without new pointer events', () => {
    expect(fn('edgeScroll')).toContain('updateTarget');
  });

  it('restarts auto-scroll when the drag crosses to the other edge', () => {
    const edge = fn('edgeScroll');
    expect(edge).toContain('direction');
  });

  it('ignores pointerup and pointercancel from another pointer', () => {
    for (const name of ['endDrag', 'cancelDrag']) {
      expect(fn(name)).toContain('pointerId');
    }
  });

  it('rolls back through a path playback cannot block', async () => {
    // moveLayerTo used to refuse while the player ran, so a drag cancelled
    // after playback started froze the layer at its dragged position.
    const state = await Bun.file(new URL('./editor-state.svelte.ts', import.meta.url)).text();
    const move = state.match(/moveLayerTo\([^]*?\n  }/)?.[0] ?? '';
    expect(move).not.toContain('this.playing');
  });

  it('finishes the drag from the window, not from the handle', () => {
    // Reordering moves the handle's node in the DOM, which drops its pointer
    // capture, so a pointerup delivered elsewhere would never reach the
    // handle's own listener — the drag and its auto-scroll interval would run
    // on forever. The window sees every release.
    const win = source.match(/<svelte:window[^]*?\/>/)?.[0] ?? '';
    expect(win).toContain('onpointermove={onHandleMove}');
    expect(win).toContain('onpointerup={endDrag}');
    expect(win).toContain('onpointercancel={cancelDrag}');
  });

  it('stops the auto-scroll interval when the panel goes away', () => {
    expect(source).toContain('onDestroy');
    expect(source.match(/onDestroy\([^]*?\)/)?.[0] ?? '').toContain('stopAutoscroll');
  });
});

describe('layer names and colour tags (Toonio parity)', () => {
  it('a row shows the stored name, falling back to its position', () => {
    expect(rows).toContain('editor.layerLabel(layerIndex)');
  });

  it('double-clicking a row name opens it for renaming', () => {
    expect(rows).toContain('ondblclick');
    expect(rows).toContain('editor.renameActiveLayer(');
    expect(rows).toContain('MAX_LAYER_NAME');
  });

  it('Enter commits the new name and Escape drops it', () => {
    expect(rows).toContain("'Enter'");
    expect(rows).toContain("'Escape'");
  });

  it('every row carries one of the six colour tags', () => {
    expect(rows).toContain('--layer-tag-{editor.layerColor(layerIndex)}');
  });

  it('the eye, the handle and the delete keep their size in a narrow column', () => {
    // The column narrows down to the icons; squeezing them instead of the
    // name would shrink the tap targets (WCAG 2.5.8).
    const icons = rows.slice(rows.indexOf('.eye {'));
    for (const rule of ['.eye {', '.handle {', '.kill {']) {
      const block = icons.slice(icons.indexOf(rule), icons.indexOf('}', icons.indexOf(rule)));
      expect(block).toContain('flex: none');
    }
  });
});

describe('the colour tag is pickable', () => {
  it('the tag is a button that walks the six swatches', () => {
    expect(rows).toContain('class="tag"');
    expect(rows).toContain('editor.cycleLayerColor(layerIndex)');
    expect(rows).toContain("t('layer.colour_title')");
    expect(t('layer.colour_title')).toStartWith('Цвет слоя');
    expect(rows).toContain('editor.layerColor(layerIndex)');
  });

  it('a fast double click on a control is not a rename', () => {
    // The tag, the eye and the delete sit inside the row, whose double click
    // opens the name for editing; two quick colour steps must not rename.
    expect(rows).toContain('ondblclick={(e) => startRename(e, layerIndex)}');
    // The name is a button too now — the one that picks the layer — and a
    // double click on it is exactly the rename.
    expect(fn('startRename')).toContain("closest('button:not(.name), .handle')");
  });

  it('the colours follow their layers through add, delete and reorder', () => {
    expect(state).toContain('layerColors');
    expect(state).toContain('this.layerColors.splice(at, 0,');
    expect(state).toContain('this.layerColors.splice(removed, 1)');
    expect(state).toContain('this.layerColors.splice(to, 0, ...this.layerColors.splice(from, 1))');
  });

  it('a draft carries them, since the file format has no field for them', () => {
    expect(state).toContain('layerColors: this.layerColors.slice()');
    expect(state).toContain('normalizeLayerColors(saved.layerColors');
  });
});

// The column that holds the names was 11rem, and the row inside it spends
// 136.4 of that on furniture: 12.8 of padding, a 28 eye, a 14 tag, a 30 handle,
// a 26 delete and four 6.4 gaps. That leaves 38.6 for the name — measured at
// 39 against a `scrollWidth` of 45 for «Слой 1» on 1280×800. The editor's own
// default name did not fit the editor's own default column, so a fresh document
// opened on «Сло…», and every user fixed it once by hand with the divider.
//
// The name is the only thing telling two layers apart. A floor under it, and a
// column wide enough to honour that floor, are what keep the list a list.
const timeline = await Bun.file(new URL('./Timeline.svelte', import.meta.url)).text();
const layerRows = await Bun.file(new URL('./LayerRows.svelte', import.meta.url)).text();

describe('the layer column fits the name the editor gives a layer', () => {
  /** «Слой 1» at 0.85rem, measured in the browser. */
  const DEFAULT_NAME = 45;
  /** Eye, tag, handle, delete, the row's padding and its four gaps. */
  const FURNITURE = 137;


  /** `11rem` / `176px` → 176. */
  function px(value: string): number {
    const rem = value.match(/([\d.]+)rem/);
    if (rem) return Number(rem[1]) * 16;
    return Number(value.match(/([\d.]+)px/)?.[1] ?? NaN);
  }

  it('opens wide enough for the default name', () => {
    const width = timeline.match(/\.layer-col \{[^}]*width:\s*([^;]+);/s)?.[1];
    expect(width).toBeDefined();
    expect(px(width!)).toBeGreaterThanOrEqual(FURNITURE + DEFAULT_NAME);
  });

  it('puts a floor under the name, so a later squeeze cannot take it back', () => {
    const name = layerRows.match(/\n  \.name \{([^}]*)\}/)?.[1];
    expect(name).toBeDefined();
    const floor = name!.match(/min-width:\s*([^;]+);/)?.[1];
    expect(floor).toBeDefined();
    expect(px(floor!)).toBeGreaterThanOrEqual(DEFAULT_NAME);
  });
});

// A layer had three numbers: its name counted from the bottom, the delete
// button and the strip from the top, the canvas from zero plus one. With three
// layers the row «Слой 3» carried a button announced «Удалить слой 1».
const canvas = await Bun.file(new URL('./CanvasView.svelte', import.meta.url)).text();

describe('a layer is called by one name everywhere', () => {
  it('the delete button names the layer it deletes', () => {
    expect(rows).toMatch(/t\('layer\.remove', \{ name: editor\.layerLabel\(layerIndex\) \}\)/);
    expect(t('layer.remove', { name: 'Фон' })).toContain('Фон');
  });

  it('a strip cell names its layer the way the row does', () => {
    expect(timeline).toMatch(/t\('timeline\.cell', \{ frame: i \+ 1, layer: editor\.layerLabel\(layerIndex\) \}\)/);
  });

  it('the canvas names the active layer the way the row does', () => {
    expect(canvas).toContain('editor.layerLabel(editor.activeLayer)');
  });
});

// `role="option"` makes everything inside the row presentational, so the eye,
// the colour tag and the delete button were flattened into the row's text
// (WCAG 4.1.2). A grid of rows, one button per cell, keeps every control a
// control (see owner-eleventh-layer-keys.test.ts).
describe('the controls in a row stay controls', () => {
  it('the list is a grid of cells, not a listbox of options', () => {
    expect(rows).not.toContain('role="option"');
    expect(rows).not.toContain('role="listbox"');
    expect(rows).toContain('role="gridcell"');
  });

  it('the name is the button that selects the layer', () => {
    expect(rows).toMatch(/<button\s+class="name"[^>]*aria-pressed=\{layerIndex === editor\.activeLayer\}/);
  });
});

describe('the eye says what a press will do', () => {
  it('names the action and does not also claim a pressed state', () => {
    // «Скрыть слой, нажата»: a label that already flips with the state plus
    // aria-pressed reads as a toggle whose name contradicts it (WCAG 4.1.2).
    const eye = rows.match(/<button\s+class="eye"[\s\S]*?>/)?.[0] ?? '';
    expect(eye).toMatch(/t\('layer\.show'[\s\S]*?:\s*t\('layer\.hide'/);
    expect(eye).not.toContain('aria-pressed');
  });
});

describe('eighth audit: the layer row', () => {
  it('each eye names its own layer, so four rows are not four «Скрыть слой»', () => {
    // WCAG 2.4.6: identical names on every row say nothing about which one.
    const eye = rows.match(/<button\s+class="eye"[\s\S]*?>/)?.[0] ?? '';
    expect(eye).toContain("t('layer.show', { name: editor.layerLabel(layerIndex) })");
    expect(eye).toContain("t('layer.hide', { name: editor.layerLabel(layerIndex) })");
    expect(t('layer.hide', { name: 'Фон' })).toBe('Скрыть «Фон»');
    expect(t('layer.show', { name: 'Фон' })).toBe('Показать «Фон»');
  });

  it('the row furniture is spaced in px, so 200 % text does not push the bin off the column', () => {
    // At 320 px and 200 % text the rem gaps and paddings grew by 40 px and the
    // delete key left the 7.5rem column.
    const row = rows.match(/\n  \.row \{[^}]*\}/)?.[0] ?? '';
    expect(row).not.toMatch(/gap:\s*[\d.]+rem/);
    expect(row).not.toMatch(/padding:[^;]*rem/);
  });
});

describe('ninth audit: the keyboard keeps its place in the layer list', () => {
  it('a row moved down by Alt+↓ keeps the focus — the keyed move had dropped it on <body>', () => {
    // Svelte moves the focused row's node to reorder it, and a node taken out
    // of the document loses its focus; Alt+↑ only survived because the other
    // row was the one moved.
    expect(rows).toMatch(/function moveBy[\s\S]*?focusCell\(to\)/);
    expect(rows).toContain('data-layer={layerIndex}');
  });

  it('Enter and Esc in the name field hand the focus back to the name', () => {
    expect(rows).toMatch(/e\.key === 'Enter'[\s\S]*?commitRename\(\);\s*focusName\(/);
    expect(rows).toMatch(/e\.key === 'Escape'[\s\S]*?renaming = null;\s*focusName\(/);
  });

  it('a deleted row hands the focus to the layer that is now active', () => {
    expect(rows).toMatch(/function removeLayer[\s\S]*?focusName\(editor\.activeLayer\)/);
  });

  it('F2 opens the name selected, so typing replaces it rather than appending', () => {
    // «Слой 2» + «Фон» came out «Слой 2Фон».
    const field = rows.match(/<input\s+class="name rename"[\s\S]*?\/>/)?.[0] ?? '';
    expect(field).toContain('.select()');
  });

  it('the name tells a keyboard what it can do beyond a press', () => {
    // Alt+↑/↓ lived only in the tooltip of the handle, which the keyboard never reaches.
    expect(rows).toContain('aria-keyshortcuts="F2 Alt+ArrowUp Alt+ArrowDown"');
  });
});

describe('tenth audit: the layer row', () => {
  it('on a phone the column holds the whole row — the handle and the bin were scrolled out of it', () => {
    // 7.5rem is 120 px; the row asked for 178, so on 320 and 390 px the drag
    // handle and the delete sat past the column's edge.
    const phone = timeline.slice(timeline.indexOf('@media (max-width: 40rem)'));
    const width = phone.match(/\.layer-col \{[^}]*width:\s*([^;]+);/s)?.[1] ?? '';
    const phoneRows = layerRows.slice(layerRows.indexOf('@media (max-width: 40rem)'));
    expect(phoneRows.length).toBeLessThan(layerRows.length);
    // Padding 3 + 3, eye 24, tag 14, handle 24, bin 24, four 4 px gaps, the
    // name's 3rem floor and the column's 1 px border.
    const furniture = 6 + 24 + 14 + 24 + 24 + 16;
    expect(Number(width.match(/([\d.]+)rem/)?.[1]) * 16).toBeGreaterThanOrEqual(furniture + 48 + 1);
    expect(phoneRows).toMatch(/\.row \{[^}]*gap: 4px/);
    expect(phoneRows).toMatch(/\.eye,\s*\.handle,\s*\.kill \{[^}]*width: 24px/);
  });

  it('during playback the keys that cannot act say so instead of pretending', () => {
    // «+ Слой» and × did nothing while the preview ran; a double click opened
    // the name, took the typing and threw it away.
    expect(rows).toMatch(/class="add-layer"[\s\S]*?aria-disabled=\{editor\.playing \|\| undefined\}/);
    expect(rows).toMatch(/class="kill"[\s\S]*?aria-disabled=\{editor\.playing \|\| undefined\}/);
    expect(fn('startRename')).toContain('editor.playing');
  });
});
