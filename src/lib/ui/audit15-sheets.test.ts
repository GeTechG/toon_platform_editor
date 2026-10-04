import { afterEach, describe, expect, it } from 'bun:test';

import { EXPORT_WIDTHS } from '../format/constants';
import { createDocument } from '../model/operations';
import { CANVAS_MAX_AREA, CANVAS_MAX_SIDE, exportSize, exportWidths } from '../export/rasterize';
import { readSoundtrack } from '../export/video';
import { OFFICIAL_CATALOG, type CatalogEntry } from '../plugins/catalog';
import { PLUGIN_API } from '../plugins/contract';
import { installFromCatalog, installFromFile, loadInstalled, updateInstalled } from '../plugins/install';
import { PluginRegistry } from '../plugins/registry';
import { putInstalled, type InstalledPlugin } from '../plugins/store';
import { fakeIndexedDB, setIndexedDB } from '../test-support/fake-idb';
import { t } from '../i18n';

// Пятнадцатый аудит, листы, экспорт и плагины.

const source = (name: string) => Bun.file(new URL(name, import.meta.url)).text();

const doc = (width: number, height: number) => createDocument({ width, height });

const tool = (id: string) => ({ [id]: { label: id, title: id, key: '', icon: '<path />' } });
const manifest = (id: string, extra: Record<string, unknown> = {}) => ({ id, api: PLUGIN_API, tools: tool(id), ...extra });

const entry = (id: string, version = '2.0.0'): CatalogEntry => ({
  id,
  name: id,
  version,
  description: '',
  icon: '',
  url: `${OFFICIAL_CATALOG}${id}/plugin.js`,
  catalog: OFFICIAL_CATALOG,
});

const stored = (id: string, version = '1.0.0'): InstalledPlugin => ({
  id,
  name: id,
  version,
  description: '',
  icon: '',
  code: `old:${id}`,
  source: 'catalog',
  installed: 1,
});

/** Тишина в консоли на время теста: причины отказов туда пишутся нарочно. */
async function quiet<T>(run: () => Promise<T>): Promise<T> {
  const { warn, error } = console;
  console.warn = () => {};
  console.error = () => {};
  try {
    return await run();
  } finally {
    console.warn = warn;
    console.error = error;
  }
}

afterEach(() => {
  delete (globalThis as { indexedDB?: unknown }).indexedDB;
});

describe('экспорт: вытянутый мульт', () => {
  // Предел площади держали, а длина стороны росла: 8×4096 px выходил кадром
  // 181×92672 — Chrome и Firefox не рисуют холст длиннее 32767 px по стороне,
  // и файл выходил пустым или не выходил вовсе.
  const tall = [doc(64, 32767), doc(600, 32767), doc(2000, 32767), doc(32767, 64), doc(600, 2000), doc(10240, 5760)];

  it('ни одна предложенная ширина не даёт стороны длиннее предела холста', () => {
    expect(CANVAS_MAX_SIDE).toBe(32767);
    for (const d of tall) {
      for (const w of exportWidths(d)) {
        const size = exportSize(d, w);
        expect(size.height).toBeLessThanOrEqual(CANVAS_MAX_SIDE);
        expect(size.width).toBeLessThanOrEqual(CANVAS_MAX_SIDE);
        expect(size.width * size.height).toBeLessThanOrEqual(CANVAS_MAX_AREA);
      }
    }
  });

  it('ширина чётная — H.264 не кодирует кадр нечётной ширины', () => {
    for (const d of tall) {
      for (const w of exportWidths(d)) {
        expect(exportSize(d, w).width % 2).toBe(0);
      }
    }
  });

  it('обычный мульт — прежние ширины и размеры', () => {
    expect(exportWidths(doc(10240, 5760))).toEqual([...EXPORT_WIDTHS]);
    expect(exportSize(doc(10240, 5760), 1280)).toEqual({ width: 1280, height: 720 });
  });
});

describe('видео: трек, который не читается', () => {
  it('звук, который не декодируется, не роняет видео — оно собирается без звука', async () => {
    const got = await quiet(() =>
      readSoundtrack(new Blob(['не звук']), 2, true, () => Promise.reject(new Error('EncodingError'))),
    );
    expect(got).toBeNull();
  });

  it('трек читается до того, как в файл заявлена звуковая дорожка', async () => {
    const video = await source('../export/video.ts');
    expect(video.indexOf('await readSoundtrack(')).toBeGreaterThan(-1);
    expect(video.indexOf('await readSoundtrack(')).toBeLessThan(video.indexOf('output.addAudioTrack('));
  });

  it('лист говорит, что видео выйдет без звука, а не обещает звук', async () => {
    const sheet = await source('./ExportSheet.svelte');
    expect(sheet).toContain("t('export.audio_unreadable'");
    expect(sheet).toContain('editor.audio.duration === 0');
    expect(t('export.audio_unreadable', { name: 'Песня' })).toBe(
      'Звук «Песня» здесь не читается — видео выйдет без звука.',
    );
  });
});

describe('плагины: поставленный, но не загрузившийся', () => {
  it('реестр знает, что плагина в нём нет, и почему', async () => {
    setIndexedDB(fakeIndexedDB(new Map(), 1));
    await putInstalled(stored('a.old'));
    const registry = new PluginRegistry();
    await quiet(() =>
      loadInstalled(registry, {
        fetch: async () => ({ text: async () => '' }),
        evaluate: async () => ({ default: { ...manifest('a.old'), api: PLUGIN_API + 1 } }),
      }),
    );
    expect(registry.holds('a.old')).toBe(false);
    expect(registry.loadFailure('a.old')).toBe(t('plugin.foreign_api', { api: PLUGIN_API + 1 }));
  });

  it('загруженный плагин — в реестре, и сбоя загрузки у него нет, даже если занята одна клавиша', () => {
    const registry = new PluginRegistry(['b']);
    registry.register({ ...manifest('a.fine'), tools: { 'a.fine': { label: 'a', title: 'a', key: 'b', icon: '<path />' } } });
    expect(registry.holds('a.fine')).toBe(true);
    expect(registry.loadFailure('a.fine')).toBeUndefined();
  });

  it('«Мои» показывают строку «не загрузился» с причиной, а не рабочий на вид плагин', async () => {
    const sheet = await source('./PluginsSheet.svelte');
    expect(sheet).toContain('function notLoaded(');
    expect(sheet).toContain("t('plugins.not_loaded'");
    expect(t('plugins.not_loaded', { reason: 'причина' })).toBe('— не загрузился: причина');
  });
});

describe('плагины: установка поверх того, что в реестре', () => {
  it('плагин, который работал до перезагрузки (хранилище не приняло), ставится заново, а не «id уже загружен»', async () => {
    setIndexedDB(fakeIndexedDB(new Map(), 1));
    const registry = new PluginRegistry();
    registry.register(manifest('a.session'));
    const failed = await quiet(() =>
      installFromCatalog(entry('a.session'), registry, {
        fetch: async () => ({ text: async () => 'new' }),
        evaluate: async () => ({ default: manifest('a.session', { version: '2.0.0' }) }),
      }),
    );
    expect(failed).toBeNull();
    expect(registry.holds('a.session')).toBe(true);
  });

  it('файл с id встроенных инструментов их не вынимает', async () => {
    setIndexedDB(fakeIndexedDB(new Map(), 1));
    const registry = new PluginRegistry();
    registry.register(manifest('toonop'), { builtin: true });
    const failed = await quiet(() =>
      installFromFile('x', registry, {
        fetch: async () => ({ text: async () => '' }),
        evaluate: async () => ({ default: { ...manifest('toonop'), tools: tool('other') } }),
      }),
    );
    expect(failed).not.toBeNull();
    expect(registry.tool('toonop')).toBeDefined();
    registry.remove('toonop');
    expect(registry.tool('toonop')).toBeDefined();
  });
});

describe('плагины: обновление при входе', () => {
  it('студия запирается только на подмену: пока бандлы качаются, рисовать можно', async () => {
    setIndexedDB(fakeIndexedDB(new Map(), 1));
    await putInstalled(stored('a.one'));
    await putInstalled(stored('b.two'));
    const registry = new PluginRegistry();
    registry.register(manifest('a.one'));
    registry.register(manifest('b.two'));
    const events: string[] = [];
    await quiet(() =>
      updateInstalled(
        [entry('a.one'), entry('b.two')],
        registry,
        {
          fetch: async (url) => {
            events.push(`fetch ${url.includes('a.one') ? 'a' : 'b'}`);
            return { text: async () => url };
          },
          evaluate: async (code) => ({ default: manifest(code.includes('a.one') ? 'a.one' : 'b.two') }),
        },
        () => events.push('lock'),
      ),
    );
    expect(events).toEqual(['fetch a', 'fetch b', 'lock']);
  });

  it('ничего не скачалось — студия не запиралась вовсе', async () => {
    setIndexedDB(fakeIndexedDB(new Map(), 1));
    await putInstalled(stored('a.one'));
    const registry = new PluginRegistry();
    registry.register(manifest('a.one'));
    let locked = false;
    await quiet(() =>
      updateInstalled(
        [entry('a.one')],
        registry,
        { fetch: async () => ({ ok: false, status: 404, text: async () => '' }), evaluate: async () => ({}) },
        () => (locked = true),
      ),
    );
    expect(locked).toBe(false);
  });

  it('студия ставит замок через обратный вызов, а не на всё время скачивания', async () => {
    const state = await source('./editor-state.svelte.ts');
    const start = state.slice(state.indexOf('async startPlugins()'), state.indexOf('private async hasUpdates'));
    expect(start).toContain('await updateInstalled(catalog.plugins, plugins, undefined, () => (this.updating = true));');
  });
});
