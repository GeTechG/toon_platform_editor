import { describe, expect, test } from 'bun:test';
import { movePanelItem, panelsFrom, showPanelItem } from './panels';

// Twelfth audit, floating windows and the arrangement. The Svelte glue is
// asserted as source (the contract style of audit11-windows); the pure parts
// run for real.
const win = await Bun.file(new URL('./FloatWindow.svelte', import.meta.url)).text();
const editorUi = await Bun.file(new URL('./Editor.svelte', import.meta.url)).text();
const arranger = await Bun.file(new URL('./PanelArranger.svelte', import.meta.url)).text();
const state = await Bun.file(new URL('./editor-state.svelte.ts', import.meta.url)).text();
const ru = JSON.parse(await Bun.file(new URL('../i18n/ru.json', import.meta.url)).text());

function fn(source: string, name: string): string {
  return source.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n  }\\n`))?.[0] ?? '';
}

function method(name: string): string {
  return state.match(new RegExp(`\\n  ${name}\\([^]*?\\n  }\\n`))?.[0] ?? '';
}

/** A preset of rows only, the Multator shape: no side columns at all. */
const rowsOnly = () =>
  panelsFrom({ base: { rows: [['add-frame', 'timeline'], ['transport', 'settings']] } });

// «×» on a window sent it home by the editor's own arrangement, whatever the
// preset: under Multator the transport landed beside the strip in the first
// row, and a column key («Полный экран») opened a side column Multator has none of.
describe('a window closed goes back where the preset keeps it', () => {
  test('a row item returns to its row of the preset', () => {
    const home = rowsOnly();
    const floated = movePanelItem(home, 'transport', 'float');
    const back = showPanelItem(floated, 'transport', home);
    expect(back.rows[1]).toContain('transport');
    expect(back.rows[0]).not.toContain('transport');
  });

  test('an item the preset puts away falls back to the editor’s own place', () => {
    const home = rowsOnly();
    const floated = movePanelItem(home, 'palette', 'float');
    expect(showPanelItem(floated, 'palette', home).right).toContain('palette');
  });

  test('the editor passes the preset’s arrangement as the home', () => {
    expect(method('showPanelItem')).toContain('presetPanels(this.preset)');
  });
});

// Closed into a folded column (or a folded bottom bar), the window vanished:
// the fold draws none of its items, and the focus meant for the key fell to
// the page.
describe('a window closed into a folded panel unfolds it', () => {
  test('the side or the bar it lands in opens', () => {
    const show = method('showPanelItem');
    expect(show).toContain('this.sides[at.slot].collapsed = false');
    expect(show).toContain('this.panelCollapsed = false');
  });
});

// A pointercancel is the browser taking the gesture (a rail that pans under
// the finger, a system swipe): it was read as a drop, and a key the hand only
// meant to scroll past jumped to wherever the last move had aimed.
describe('a cancelled drag drops nothing', () => {
  test('pointercancel lets go without settling', () => {
    expect(arranger).toContain('onpointercancel={onPointerCancel}');
    const cancel = fn(arranger, 'onPointerCancel');
    expect(cancel).not.toContain('settle(');
    expect(cancel).toContain('drag = null');
  });
});

// A second finger on the title bar steered the window too: its moves reached
// the same handler and the window jumped between the two fingers.
describe('only the finger that took the window moves it', () => {
  test('the grab remembers its pointer', () => {
    expect(fn(win, 'onDown')).toContain('pointerId: e.pointerId');
    expect(fn(win, 'onMove')).toContain('e.pointerId !== grab.pointerId');
  });
});

// `viewport-fit=cover` hands the page the whole glass, and only a phone held
// upright kept anything off the edges: on its side the pencil sat under the
// notch and the strip's last row under the home indicator (measured with the
// insets emulated at 844×390: first key at x 14 under a 47px notch).
describe('the studio clears the notch and the home indicator', () => {
  test('the sides are inset on every width', () => {
    expect(editorUi).toMatch(
      /\.editor \{[^}]*padding-inline: env\(safe-area-inset-left\) env\(safe-area-inset-right\);/,
    );
    expect(editorUi).toMatch(/\.editor \{[^}]*box-sizing: border-box;/);
  });

  test('the bottom bar clears the indicator outside the phone branch too', () => {
    expect(editorUi).toMatch(
      /\.panel \{\s*flex: none;[^}]*padding-bottom: max\(0\.6rem, env\(safe-area-inset-bottom\)\);/,
    );
  });
});

// A named arrangement picked from the list replaced the one made by hand
// without a word — the very loss the owner asked to be asked about (11th
// audit) — and «Удалить» took a saved one for good on a single press.
describe('arrangements are not lost unasked', () => {
  test('picking a workspace asks when the panels are the hand’s own', () => {
    const apply = method('applyWorkspace');
    expect(apply).toContain('this.mayReplacePanels(');
    expect(state).toContain("t('arrange.workspace_confirm'");
    expect(ru.arrange.workspace_confirm).toContain('{{name}}');
  });

  test('an arrangement already saved under a name is not asked about', () => {
    expect(state).toMatch(/private mayReplacePanels\([^]*?this\.workspaces\.some\(/);
  });

  test('a «no» puts the list back', () => {
    expect(arranger).toMatch(/if \(!editor\.applyWorkspace\(Number\(value\)\)\) \{\s*e\.currentTarget\.value = picked;/);
  });

  test('deleting a saved arrangement asks first', () => {
    expect(method('deleteWorkspace')).toContain("this.confirmed(t('arrange.delete_confirm'");
    expect(ru.arrange.delete_confirm).toContain('{{name}}');
  });
});
