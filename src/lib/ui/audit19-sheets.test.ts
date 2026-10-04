import { afterEach, describe, expect, it } from 'bun:test';

import { OFFICIAL_CATALOG, type CatalogEntry } from '../plugins/catalog';
import { PLUGIN_API } from '../plugins/contract';
import { installFromFile, loadInstalled, updateInstalled } from '../plugins/install';
import { PluginRegistry } from '../plugins/registry';
import { putInstalled } from '../plugins/store';
import { fakeIndexedDB, setIndexedDB } from '../test-support/fake-idb';

// Nineteenth audit — sheets: files, export and plugins. A build called off
// says nothing more about its stages, an update that threw half-way does not
// stand in the working version's place, and a plugin taken off does not come
// back with the next refused install.

/** Silence while a test runs: refusals are written to the console on purpose. */
async function quiet<T>(run: () => Promise<T> | T): Promise<T> {
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

const source = (name: string) => Bun.file(new URL(name, import.meta.url)).text();

const tool = (id: string) => ({ label: id, title: id, key: '', icon: '<path />' });

afterEach(() => {
  delete (globalThis as { indexedDB?: unknown }).indexedDB;
});

describe('экспорт: сборка отменена', () => {
  it('кадр, дошедший после «Отменить», не возвращает строку «Кодирование…»', async () => {
    const sheet = await source('./ExportSheet.svelte');
    const download = sheet.slice(sheet.indexOf('async function download()'), sheet.indexOf('function openSheet()'));
    // The encoder's frame in flight ends after the cancel and reports itself:
    // the sheet, idle by then, must not take that for a stage.
    expect(download).not.toMatch(/onProgress: track\b/);
    expect(download).toMatch(/onProgress:[^\n]*signal\.aborted[^\n]*track\(/);
  });
});

describe('обновление плагина: новая версия бросила на полпути', () => {
  it('прежняя версия возвращается целиком, от новой не остаётся ничего', async () => {
    setIndexedDB(fakeIndexedDB(new Map(), 1));
    const id = 'a19.half';
    await putInstalled({ id, version: '1.0.0', name: id, description: '', icon: '', code: 'old', source: 'catalog', installed: 1 });
    const url = `${OFFICIAL_CATALOG}${id}/plugin.js`;
    const modules: Record<string, Record<string, unknown>> = {
      old: { default: { id, api: PLUGIN_API, tools: { [id]: tool(id) } } },
      [`code:${url}`]: {
        default: {
          id,
          api: PLUGIN_API,
          tools: {
            'a19.fresh': tool('a19.fresh'),
            // Read after the first tool is already in the register.
            [id]: {
              ...tool(id),
              get label(): never {
                throw new Error('boom');
              },
            },
          },
        },
      },
    };
    const ports = {
      fetch: async (address: string) => ({ text: async () => `code:${address}` }),
      evaluate: async (code: string) => modules[code],
    };
    const registry = new PluginRegistry();
    await loadInstalled(registry, ports);
    expect(registry.tool(id)).toBeDefined();

    const record: CatalogEntry = { id, name: id, version: '1.1.0', description: '', icon: '', url, catalog: OFFICIAL_CATALOG };
    const updated = await quiet(() => updateInstalled([record], registry, ports));

    expect(updated).toEqual([]);
    expect(registry.tool(id)).toBeDefined();
    expect(registry.tool('a19.fresh')).toBeUndefined();
  });
});

describe('плагин без записи на диске: снят, потом отказ новой сборке', () => {
  it('снятый не возвращается сам', async () => {
    // No IndexedDB here: the install lives in the session only.
    const id = 'a19.gone';
    const modules: Record<string, Record<string, unknown>> = {
      good: { default: { id, api: PLUGIN_API, tools: { [id]: tool(id) } } },
      bad: { default: { id, api: PLUGIN_API + 1, tools: { [id]: tool(id) } } },
    };
    const ports = { fetch: () => Promise.reject(new Error('no network')), evaluate: async (code: string) => modules[code] };
    const registry = new PluginRegistry();
    await quiet(() => installFromFile('good', registry, ports));
    expect(registry.holds(id)).toBe(true);
    // «Удалить» in the plugins window.
    registry.remove(id);

    const failed = await quiet(() => installFromFile('bad', registry, ports));

    expect(failed).not.toBeNull();
    expect(registry.holds(id)).toBe(false);
  });

  it('работающий без записи по-прежнему остаётся при отказе новой сборке', async () => {
    const id = 'a19.stays';
    const modules: Record<string, Record<string, unknown>> = {
      good: { default: { id, api: PLUGIN_API, tools: { [id]: tool(id) } } },
      bad: { default: { id, api: PLUGIN_API + 1, tools: { [id]: tool(id) } } },
    };
    const ports = { fetch: () => Promise.reject(new Error('no network')), evaluate: async (code: string) => modules[code] };
    const registry = new PluginRegistry();
    await quiet(() => installFromFile('good', registry, ports));
    await quiet(() => installFromFile('bad', registry, ports));
    expect(registry.tool(id)).toBeDefined();
  });
});
