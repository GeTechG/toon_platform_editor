import { describe, expect, it } from 'bun:test';
import { clampWindowPosition } from './draggable';

const scaleMenu = await Bun.file(new URL('./ScaleMenu.svelte', import.meta.url)).text();
const transformMenu = await Bun.file(new URL('./TransformMenu.svelte', import.meta.url)).text();

describe('clampWindowPosition', () => {
  const size = { width: 200, height: 100 };
  const bounds = { width: 1000, height: 600 };

  it('leaves a position that is already inside alone', () => {
    expect(clampWindowPosition(300, 200, size, bounds)).toEqual({ left: 300, top: 200 });
  });

  it('stops the window at the right and bottom edges of the page', () => {
    expect(clampWindowPosition(9999, 9999, size, bounds)).toEqual({ left: 800, top: 500 });
  });

  it('stops it at the left and top edges too', () => {
    expect(clampWindowPosition(-40, -40, size, bounds)).toEqual({ left: 0, top: 0 });
  });

  it('pins a window larger than the page to the corner rather than off it', () => {
    expect(clampWindowPosition(50, 50, { width: 1200, height: 800 }, bounds))
      .toEqual({ left: 0, top: 0 });
  });
});

describe('both floating windows drag by their header', () => {
  it('the zoom window has a handle and uses the action', () => {
    expect(scaleMenu).toContain('use:draggable');
    expect(scaleMenu).toContain('data-drag-handle');
  });

  it('the transform window has one as well', () => {
    expect(transformMenu).toContain('use:draggable');
    expect(transformMenu).toContain('data-drag-handle');
  });
});

const dragSource = await Bun.file(new URL('./draggable.ts', import.meta.url)).text();

describe('a drag measures once, then only writes', () => {
  const move = dragSource.slice(
    dragSource.indexOf('function onPointerMove'),
    dragSource.indexOf('function release'),
  );

  // Every `pointermove` read `getBoundingClientRect()` — and the move before
  // it had written `left`/`top` on the same element, so the read forced the
  // browser to lay the page out again. Write, read, write, on every sample of
  // a drag people perform while drawing. Nothing being read changes during a
  // drag: the window keeps its size, and the page keeps its bounds.
  it('takes no measurement while the pointer is moving', () => {
    expect(move).not.toContain('getBoundingClientRect');
    expect(move).not.toContain('clientWidth');
    expect(move).not.toContain('clientHeight');
  });

  it('measures once, where the window leaves the flow', () => {
    // The size has to be read after the switch to `fixed`, not before it: out
    // of the flow the window may size itself differently, and the clamp is
    // about the box that is actually on screen. Once is enough — neither the
    // window nor the page changes shape while a pointer is down.
    const begin = dragSource.slice(
      dragSource.indexOf('function beginDrag'),
      dragSource.indexOf('function onPointerMove'),
    );
    expect(begin).toContain('getBoundingClientRect');
    expect(begin).toContain('clientWidth');
  });
});

// The arrows moved a floating window with no bound: a few presses put it past
// the stage edge, where neither the pointer nor the keyboard could bring it
// back. And `role="toolbar"` promised arrow-key travel between its items, which
// is not what its arrows do.
describe('a floating window moved by keys stays on the stage', () => {
  it('the key step goes through the same clamp as the drag', async () => {
    const win = await Bun.file(new URL('./FloatWindow.svelte', import.meta.url)).text();
    const onKey = win.match(/function onKey\([^]*?\n  }/)?.[0] ?? '';
    expect(onKey).toContain('clampWindowPosition(');
    expect(win).not.toContain('role="toolbar"');
  });
});

// The colour picker opened under its swatch with a guessed 212×392 box; since
// the studio's keys grew it stands ~476px tall, and on a phone the hex field
// and the new/old swatches opened below the screen edge.
describe('the colour picker opens inside the screen', () => {
  it('measures itself on open and goes through the window clamp', async () => {
    const picker = await Bun.file(new URL('./ColourPicker.svelte', import.meta.url)).text();
    const open = picker.match(/\$effect\(\(\) => \{\s*if \(box && !box\.open\)[^]*?\n  }\);/)?.[0] ?? '';
    expect(open).toContain('getBoundingClientRect()');
    expect(open).toContain('clampWindowPosition(');
  });
});

// The floating window read its own size and the stage's on every pointermove,
// right after the previous move had written its position: a forced reflow per
// sample. And it only came back inside on a window resize — a window that grew
// (the strip gaining frames) or was just dropped near an edge hung off the stage.
describe('a floating window measures once and follows its own size', () => {
  const win = () => Bun.file(new URL('./FloatWindow.svelte', import.meta.url)).text();

  it('reads no layout while it is dragged', async () => {
    const onMove = (await win()).match(/function onMove\([^]*?\n  }/)?.[0] ?? '';
    expect(onMove).toContain('clampWindowPosition(');
    expect(onMove).not.toContain('offsetWidth');
    expect(onMove).not.toContain('frame()');
  });

  it('comes back inside when it or the stage changes size', async () => {
    expect(await win()).toContain('new ResizeObserver(');
  });
});

// A zoom or transform window dragged near the right edge stayed `fixed` there:
// turning the phone put it past the screen, out of reach of both hands.
describe('a dragged tool window comes back inside when the page turns', () => {
  it('re-clamps a window that left the flow on resize', () => {
    const onResize = dragSource.match(/function onResize\([^]*?\n  }/)?.[0] ?? '';
    expect(onResize).toContain('clampWindowPosition(');
    expect(dragSource).toContain("addEventListener('resize', onResize)");
    expect(dragSource).toContain("removeEventListener('resize', onResize)");
  });
});
