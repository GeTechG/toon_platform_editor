import { expect, test } from 'bun:test';

import { PUBLIC_CLASSES } from './public-classes';

const editorUi = await Bun.file(new URL('./Editor.svelte', import.meta.url)).text();

test('every public class is a rule a plugin can actually lean on', () => {
  for (const name of PUBLIC_CLASSES) {
    // Declared under `.editor` and global, or the markup a plugin writes by
    // hand would get nothing: the scoping would leave it out.
    expect(editorUi).toContain(`.editor :global(.${name})`);
  }
});

test('the list is the contract, so it is short and spelled out', () => {
  expect(PUBLIC_CLASSES).toContain('key');
  expect(PUBLIC_CLASSES).toContain('toggle');
  expect(PUBLIC_CLASSES.length).toBeLessThan(12);
  expect(new Set(PUBLIC_CLASSES).size).toBe(PUBLIC_CLASSES.length);
});
