import { describe, expect, it } from 'bun:test';

import ru from '../i18n/ru.json';

// Tenth audit. The mega-eraser warning promised «Черновик сохранён на всякий
// случай» the moment it opened — before the write it starts had finished, and
// also when that write failed (full storage) or never reached storage at all
// (blocked by the browser). The promise is the reason to trust the tool; it is
// made only once the draft is actually there.
const editorUi = await Bun.file(new URL('./Editor.svelte', import.meta.url)).text();

describe('the mega-eraser warning says the draft is saved only when it is', () => {
  it('the warning and the promise are two strings', () => {
    expect(ru.editor.mega_eraser_warning).not.toContain('Черновик');
    expect(ru.editor.mega_eraser_saved).toContain('Черновик');
  });

  it('the promise waits for the write to succeed', () => {
    expect(editorUi).toMatch(/saveNow\(\)\.then\(\(ok\) => \(megaDraftSaved = ok && !storageBlocked\)\)/);
    expect(editorUi).toMatch(/\{#if megaDraftSaved\}\{' '\}\{t\('editor\.mega_eraser_saved'\)\}/);
  });
});
