import { afterEach, describe, expect, it } from 'bun:test';
import ru from '../i18n/ru.json';
import { PLUGIN_API } from '../plugins/contract';
import { loadInstalled } from '../plugins/install';
import { PluginRegistry } from '../plugins/registry';
import { putInstalled } from '../plugins/store';
import { fakeIndexedDB, setIndexedDB } from '../test-support/fake-idb';

// Twelfth audit, the shared system: what happens to a drawing when the studio
// is left without a reload, what a remount does to the plugins, and words that
// say something the studio does not do. Components are asserted as source.
const read = (path: string) => Bun.file(new URL(path, import.meta.url)).text();
const editorUi = await read('./Editor.svelte');

describe('leaving the studio keeps the strokes', () => {
  it('a site link that unmounts the studio writes what the clock has not yet', () => {
    const destroy = editorUi.match(/onDestroy\(\(\) => \{[^]*?\n  \}\);/)?.[0] ?? '';
    // Before the track is cleared: the write takes the track with it.
    expect(destroy).toMatch(/flushOnLeave\(\);[^]*editor\.audio\.clear\(\)/);
  });

  it('a phone that sends the tab away writes it too — beforeunload never comes there', () => {
    expect(editorUi).toMatch(/onvisibilitychange=\{\(\) => document\.visibilityState === 'hidden' && flushOnLeave\(\)\}/);
  });

  it('the flush writes only a changed drawing, and not when the owner turned autosave off', () => {
    const flush = editorUi.match(/function flushOnLeave\(\): void \{[^]*?\n  \}/)?.[0] ?? '';
    expect(flush).toContain('dirty');
    expect(flush).toContain('editor.settings.autosaveMs !== 0');
    expect(flush).toContain('saveNow()');
  });
});

describe('listeners a gesture leaves behind', () => {
  it('a colour window drag the browser cancels (a pan, a palm) lets go of its listeners', async () => {
    const picker = await read('./ColourPicker.svelte');
    const drag = picker.match(/function dragWindow\(e: PointerEvent\): void \{[^]*?\n  \}/)?.[0] ?? '';
    expect(drag).toContain("el.addEventListener('pointercancel', stop)");
    expect(drag).toContain("el.removeEventListener('pointercancel', stop)");
  });
});

describe('an export the studio outlives no longer', () => {
  it('leaving mid-export calls the build off instead of dropping a file on the next page', async () => {
    const sheet = await read('./ExportSheet.svelte');
    expect(sheet).toMatch(/import \{[^}]*onDestroy[^}]*\} from 'svelte'/);
    expect(sheet).toContain('onDestroy(cancel)');
  });
});

describe('a studio mounted again', () => {
  afterEach(() => {
    delete (globalThis as { indexedDB?: unknown }).indexedDB;
  });

  it('does not run the installed plugins a second time into the same register', async () => {
    setIndexedDB(fakeIndexedDB(new Map(), 1));
    await putInstalled({
      id: 'a', version: '1.0.0', name: 'a', description: '', icon: '', code: 'old:a', source: 'catalog', installed: 1,
    });
    const registry = new PluginRegistry();
    let evaluated = 0;
    const ports = {
      fetch: async () => ({ text: async () => '' }),
      evaluate: async () => {
        evaluated += 1;
        return { default: { id: 'a', api: PLUGIN_API, tools: { a: { label: 'a', title: 'a', key: '', icon: '<path />' } } } };
      },
    };

    await loadInstalled(registry, ports);
    await loadInstalled(registry, ports);

    expect(evaluated).toBe(1);
    expect(registry.failures).toEqual([]);
    expect(registry.tools().map((tool) => tool.id)).toEqual(['a']);
  });
});

describe('words that say what the studio does', () => {
  it('a tied track starts over with the animation, not the other way round', () => {
    expect(ru.audio.tie_on).not.toContain('на повторе трека');
    expect(ru.audio.tie_on).toMatch(/мульт\S* [^;]*трек начинается заново/);
  });

  it('undo takes back a deleted frame or a paste as well, so it is not named after a stroke', () => {
    for (const text of [ru.editor.undo_title, ru.editor.redo_title, ru.key.undo, ru.key.redo]) {
      expect(text).not.toMatch(/штрих/);
    }
  });

  it('the manual names Shift+Space, which starts the preview at the active frame', () => {
    expect(ru.key.preview).toContain('Shift');
  });
});
