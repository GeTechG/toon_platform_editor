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
