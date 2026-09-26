import { describe, expect, test } from 'bun:test';
import { parseWorkspaces } from './workspaces';

// Eleventh audit, floating windows and the arrangement. The Svelte glue is
// asserted as source (the contract style of arrange.test.ts); the pure parts
// run for real.
const win = await Bun.file(new URL('./FloatWindow.svelte', import.meta.url)).text();
const editorUi = await Bun.file(new URL('./Editor.svelte', import.meta.url)).text();
const arranger = await Bun.file(new URL('./PanelArranger.svelte', import.meta.url)).text();

function fn(source: string, name: string): string {
  return source.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n  }\\n`))?.[0] ?? '';
}

// Opened once on a 320px window (a phone, a split screen, the keyboard up),
// the clamp wrote the pushed-in place over the stored one: back on 1280 the
// palette parked at x 900 stood at x 79 for good.
describe('a window pushed inside by a smaller screen keeps its own place', () => {
  test('the clamp is drawn, not stored', () => {
    expect(win).toContain('const shown = $derived(');
    expect(win).toContain('left: {shown.left}px; top: {shown.top}px');
    expect(win).not.toContain('function reframe(');
  });

  test('only a hand moving the window writes its place', () => {
    const writes = win.match(/editor\.setFloatPos\(/g) ?? [];
    expect(writes).toHaveLength(2);
    expect(fn(win, 'onMove')).toContain('editor.setFloatPos(');
    expect(fn(win, 'onKey')).toContain('editor.setFloatPos(');
  });

  test('a drag and a key step start from where the window is seen', () => {
    expect(fn(win, 'onDown')).toContain('left: shown.left');
    expect(fn(win, 'onKey')).toContain('shown.left + dx');
  });
});

// The front window was the last one in the DOM, so raising one moved its
// node: the focus in it fell to the page, and a key Tab reached in a window
// wholly under another stayed hidden (WCAG 2.4.11). A press on its body did
// not raise it at all.
describe('the window in use is the one in front', () => {
  test('the stack is a z-index, and the nodes never move', () => {
    expect(editorUi).toContain('{#each [...editor.panels.float].sort() as id (id)}');
    expect(win).toContain('z-index: calc(var(--z-float) + {depth})');
  });

  test('a press anywhere on it and the focus coming in both raise it', () => {
    expect(win).toContain('onpointerdowncapture={raise}');
    expect(win).toContain('onfocusin={raise}');
    // No capture to take back: the node stays where it is.
    expect(fn(win, 'onDown')).not.toContain('tick()');
  });
});

// On a phone the tool rail scrolls sideways, and in arrange mode every key
// in it is a handle with `touch-action: none`: a finger could not scroll the
// rail, so «Экспорт» or «Справка» past the edge could not be picked up.
describe('a rail that scrolls still scrolls while arranging by touch', () => {
  test('a side column pans along itself; a small screen does not arrange at all', () => {
    expect(editorUi).toMatch(/\.editor\.arranging \.right \.arr \{\s*touch-action: pan-y;/);
    // The phone rail and the short screen rows are gone: there only the tabs move.
    expect(editorUi).toMatch(/if \(compact && editor\.arranging\) editor\.arranging = false;/);
  });
});

// Forced colours repaint the paper with the system Canvas: a floating window
// and the arrange bar had no edge left over the canvas under them.
describe('windows keep an edge in forced colours', () => {
  test('the floating window and the arrange bar are outlined', () => {
    expect(win).toMatch(/forced-colors: active\) \{\s*\.float \{\s*outline: 1px solid CanvasText;/);
    expect(arranger).toMatch(/forced-colors: active\) \{[^@]*\.arrange-bar \{\s*outline: 1px solid CanvasText;/);
  });
});

// Docking puts the item at the end of its panel. The focus looked for it by
// index, and a key that draws nothing (the publish key off the site) shifted
// it onto a neighbour — or a disabled «Отменить» took nothing and the focus
// fell to the page.
describe('the key a window became takes the focus', () => {
  test('it is the panel’s last item, and an enabled key in it', () => {
    const dock = fn(win, 'dock');
    expect(dock).toContain('lastElementChild');
    expect(dock).toContain(':not(:disabled)');
  });
});

describe('stored arrangements with a repeated id', () => {
  test('each gets an id of its own — a repeat broke the keyed list of the bar', () => {
    const raw = JSON.stringify([
      { id: 2, name: 'A', panels: {}, floatPos: {} },
      { name: 'B', panels: {}, floatPos: {} },
      { id: 2, name: 'C', panels: {}, floatPos: {} },
    ]);
    const ids = parseWorkspaces(raw).map((w) => w.id);
    expect(new Set(ids).size).toBe(3);
    expect(ids[0]).toBe(2);
  });
});
