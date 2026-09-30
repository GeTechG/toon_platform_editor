import { afterEach, describe, expect, it } from 'bun:test';

import { decodeLegacyJson, isToonopJson } from '../format/toon-decode';
import { untilAborted } from '../export/rasterize';
import { createDocument } from '../model/operations';
import { OFFICIAL_CATALOG, readCatalog, reviewed } from '../plugins/catalog';
import { PLUGIN_API } from '../plugins/contract';
import { loadInstalled } from '../plugins/install';
import { PluginRegistry } from '../plugins/registry';
import { putInstalled, type InstalledPlugin } from '../plugins/store';
import { fakeIndexedDB, setIndexedDB } from '../test-support/fake-idb';
import { t } from '../i18n';

// Sixteenth audit — sheets: document files, export and plugins. Behavioural
// tests for what the person sees: an installed plugin that broke is not run a
// second time when the studio comes back, a catalog address typed without its
// trailing slash still reads, a project Safari saved as `.json` still opens,
// a plugin's words are the ones its current version ships, «Отменить» frees
// the sheet from an encoder that hangs, and the sheet says when the file is out.

const tool = (id: string) => ({ [id]: { label: id, title: id, key: '', icon: '<path />' } });
const manifest = (id: string, extra: Record<string, unknown> = {}) => ({ id, api: PLUGIN_API, tools: tool(id), ...extra });

const stored = (id: string): InstalledPlugin => ({
  id,
  name: id,
  version: '1.0.0',
  description: '',
  icon: '',
  code: `code:${id}`,
  source: 'catalog',
  installed: 1,
});

/** Silence while a test runs: refusals are written to the console on purpose. */
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

describe('плагины: студия открылась снова после сбоя плагина', () => {
  it('отключённый после ошибки плагин не запускается второй раз и не пишет «такой id уже загружен»', async () => {
    setIndexedDB(fakeIndexedDB(new Map(), 1));
    await putInstalled(stored('a.broken'));
    const registry = new PluginRegistry();
    registry.register({
      id: 'a.broken',
      api: PLUGIN_API,
      exporters: { fmt: { label: 'fmt', run: () => { throw new Error('boom'); } } },
    });
    await quiet(() => Promise.resolve(registry.exporters()[0].run({} as never, new AbortController().signal)).catch(() => {}));
    expect(registry.brokenReason('a.broken')).toBe('boom');

    let runs = 0;
    const failures = registry.failures.length;
    await quiet(() =>
      loadInstalled(registry, {
        fetch: async () => ({ text: async () => '' }),
        evaluate: async () => {
          runs++;
          return { default: manifest('a.broken') };
        },
      }),
    );
    expect(runs).toBe(0);
    expect(registry.failures.length).toBe(failures);
  });
});

describe('каталог: адрес без косой черты в конце', () => {
  const asked: string[] = [];
  const ports = {
    fetch: async (url: string) => {
      asked.push(url);
      return { ok: true, status: 200, json: async () => ({ api: PLUGIN_API, plugins: [{ id: 'a', entry: 'a/plugin.js' }] }) };
    },
  };

  it('адрес папки без «/» читает index.json в ней, а не в папке выше', async () => {
    asked.length = 0;
    const catalog = await readCatalog('https://plugins.example/toonop/build', ports);
    expect(asked).toEqual(['https://plugins.example/toonop/build/index.json']);
    expect(catalog.plugins[0].url).toBe('https://plugins.example/toonop/build/a/plugin.js');
  });

  it('наш каталог, вписанный без «/», остаётся нашим: обновления приходят без вопроса', async () => {
    const catalog = await readCatalog(OFFICIAL_CATALOG.slice(0, -1), ports);
    expect(reviewed(catalog.plugins[0])).toBe(true);
  });

  it('адрес самого index.json читает его же', async () => {
    asked.length = 0;
    await readCatalog('https://plugins.example/build/index.json', ports);
    expect(asked).toEqual(['https://plugins.example/build/index.json']);
  });
});

const source = (name: string) => Bun.file(new URL(name, import.meta.url)).text();

describe('файл проекта, который Safari сохранил как .json', () => {
  it('наш документ узнаётся по содержимому, а не по имени', () => {
    expect(isToonopJson(JSON.stringify(createDocument({ width: 800, height: 600 })))).toBe(true);
  });

  it('старое сохранение Тунио в .json остаётся старым сохранением', () => {
    const legacy = JSON.stringify({ Data: { FPS: 12 }, Frames: [[{ Width: 5, Color: '#000000', Cs: [{ x: 1, y: 2 }] }]] });
    expect(isToonopJson(legacy)).toBe(false);
    expect(decodeLegacyJson(legacy).ok).toBe(true);
  });

  it('студия открывает такой .json как проект, а черновики .toonops.json — как черновики', async () => {
    const editor = await source('./Editor.svelte');
    expect(editor).toMatch(/name\.endsWith\('\.json'\) && isToonopJson\(text\)/);
    expect(editor).toContain('/\\.(toonops|toonio)(\\.json)?$/i');
  });
});

describe('плагины: слова новой версии', () => {
  it('ключ, которого новая версия больше не везёт, не отвечает словами старой', () => {
    const registry = new PluginRegistry();
    const words = (locales: Record<string, string>) => ({
      id: 'a.words',
      api: PLUGIN_API,
      locales: { ru: locales },
      tools: { 'a.words': { label: { t: 'label' }, title: { t: 'title' }, key: '', icon: '<path />' } },
    });
    expect(registry.register(words({ label: 'Старое', title: 'Старое' }))).toBeNull();
    registry.remove('a.words');
    expect(registry.register(words({ label: 'Новое' }))).not.toBeNull();
    expect(registry.tool('a.words')).toBeUndefined();
  });
});

describe('видео: «Отменить», когда кодировщик завис', () => {
  it('отмена отпускает лист, даже если работа сама никогда не кончится', async () => {
    const cancel = new AbortController();
    const stuck = untilAborted(new Promise<never>(() => {}), cancel.signal);
    cancel.abort();
    const error = await stuck.catch((err: unknown) => err);
    expect((error as { name?: string }).name).toBe('AbortError');
  });

  it('работа, кончившаяся раньше отмены, отдаёт свой результат', async () => {
    expect(await untilAborted(Promise.resolve(7), new AbortController().signal)).toBe(7);
  });

  it('видео ждёт кодировщик и звук не дольше, чем до «Отменить»', async () => {
    const video = await source('../export/video.ts');
    expect(video).toMatch(/untilAborted\(\s*options\.plan\.realtime/);
  });
});

describe('экспорт: конец сборки', () => {
  it('лист говорит, что файл готов: видео, записанное прямо на диск, иначе кончалось молча', async () => {
    const sheet = await source('./ExportSheet.svelte');
    expect(t('export.saved')).toBe('Файл готов');
    // Said in the status region a reader already follows, and shown under the key.
    expect(sheet).toMatch(/stage = saved \? t\('export\.saved'\) : ''/);
    expect(sheet).toMatch(/\{:else if stage\}\s*<p class="note" aria-hidden="true">\{stage\}<\/p>/);
  });
});
