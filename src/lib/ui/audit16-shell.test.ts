import { describe, expect, it } from 'bun:test';
import { focusHeir } from './focus-heir';

// Sixteenth audit, the studio shell: the top keys, the drafts, open / save /
// publish, the shortcut sheet, errors and the app-level keys. Editor.svelte is
// a runes component and is read as source, as in audit15-shell.test.ts; the
// pure part (who takes the focus) runs for real.
const editorUi = await Bun.file(new URL('./Editor.svelte', import.meta.url)).text();

function fn(name: string): string {
  const match = editorUi.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n  }\\n`));
  if (!match) throw new Error(`missing ${name}`);
  return match[0];
}

/** The markup of one panel item, from its branch to the next. */
function item(id: string): string {
  const from = editorUi.indexOf(`{:else if id === '${id}'}`);
  if (from < 0) throw new Error(`missing item ${id}`);
  return editorUi.slice(from, editorUi.indexOf('{:else if id ===', from + 1));
}

describe('a key that switches itself off as it is pressed', () => {
  // «Сохранить» once saved, ⏮ on the first frame, «Отменить» on the last
  // step: Chrome drops the focus on <body>, and a reader lost the place.
  const key = (name: string, usable = true) => ({ name, usable });
  const usable = (k: { usable: boolean }) => k.usable;

  it('hands the focus to the next key that still works, as Tab would', () => {
    const keys = [key('⏮', false), key('⏴'), key('▶')];
    expect(focusHeir(keys, keys[0], usable)?.name).toBe('⏴');
  });

  it('skips the keys switched off with it', () => {
    const keys = [key('⏴'), key('▶'), key('⏵', false), key('⏭', false), key('+', false), key('Калька')];
    expect(focusHeir(keys, keys[3], usable)?.name).toBe('Калька');
  });

  it('at the end of the row, to the one before it', () => {
    const keys = [key('Отменить'), key('Вернуть', false)];
    expect(focusHeir(keys, keys[1], usable)?.name).toBe('Отменить');
  });

  it('nowhere when nothing is left, or the key is not in the list', () => {
    const keys = [key('a', false)];
    expect(focusHeir(keys, keys[0], usable)).toBeNull();
    expect(focusHeir(keys, key('b'), usable)).toBeNull();
  });

  it('the studio asks it after every press, outside the sheets (they return focus themselves)', () => {
    expect(editorUi).toMatch(/onclickcapture=\{passFocusOnDisable\}/);
    const pass = fn('passFocusOnDisable');
    expect(pass).toMatch(/closest\('dialog'\)/);
    expect(pass).toMatch(/await new Promise\(\(done\) => setTimeout\(done\)\)/);
    expect(pass).toMatch(/\.disabled/);
    expect(pass).toMatch(/focusHeir\(/);
  });
});

describe('the × on an import error', () => {
  it('leaves the focus on the tool key, not on <body>', () => {
    expect(editorUi).toMatch(/onclick=\{dismissImportError\}/);
    const dismiss = fn('dismissImportError');
    expect(dismiss).toMatch(/importError = ''/);
    expect(dismiss).toMatch(/data-tool=/);
    expect(dismiss).toMatch(/\.focus\(\)/);
  });
});

describe('the export key under Toonio', () => {
  it('does not promise Alt+S there: that key downloads the project', () => {
    const exportKey = item('export');
    expect(exportKey).not.toMatch(/data-key="Alt\+S"/);
    expect(exportKey).toMatch(/hasProjectFile \? undefined : 'Alt\+S'/);
    expect(exportKey).toMatch(/hasProjectFile \? t\('export\.sheet'\) : t\('export\.title'\)/);
  });
});

describe('the shortcut sheet', () => {
  it('lists the keys of the plugin tools on the panel: the handler takes them, the sheet kept quiet', () => {
    const table = editorUi.slice(editorUi.indexOf('const SHORTCUTS'), editorUi.indexOf('// Copy/paste confirmation'));
    expect(table).toMatch(/plugins\s*\.tools\(\)/);
    expect(table).toMatch(/!tool\.builtin && tool\.key && has\(tool\.id\)/);
  });
});

describe('Ctrl+S under the update lock', () => {
  it('is not handed to the browser: «Сохранить страницу как» opened over the lock', () => {
    const keydown = fn('onKeydown');
    const lock = keydown.slice(keydown.indexOf('if (editor.updating)'), keydown.indexOf('if (composing(e))'));
    expect(lock).toMatch(/e\.preventDefault\(\)/);
    expect(lock).toMatch(/'s'/);
  });
});
