import { afterEach, describe, expect, it } from 'bun:test';

import { OFFICIAL_CATALOG, type CatalogEntry } from '../plugins/catalog';
import { PLUGIN_API } from '../plugins/contract';
import { installFromCatalog, installFromFile, sessionPlugins } from '../plugins/install';
import { PluginRegistry } from '../plugins/registry';
import { RESERVED_KEYS } from '../plugins/builtins';
import { t } from '../i18n';

// Ответы владельца после пятнадцатого аудита: плагины.

const source = (name: string) => Bun.file(new URL(name, import.meta.url)).text();

const manifest = (id: string, key = '') => ({
  id,
  api: PLUGIN_API,
  tools: { [id]: { label: id, title: id, key, icon: '<path />' } },
});

const entry = (id: string): CatalogEntry => ({
  id,
  name: id,
  version: '1.0.0',
  description: '',
  icon: '',
  url: `${OFFICIAL_CATALOG}${id}/plugin.js`,
  catalog: OFFICIAL_CATALOG,
});

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

describe('плагин, который хранилище не приняло', () => {
  it('виден как сессионный, пока он в реестре', async () => {
    // Без indexedDB запись не доходит до диска: плагин работает до перезагрузки.
    const registry = new PluginRegistry();
    const failed = await quiet(() =>
      installFromCatalog(entry('a.only-now'), registry, {
        fetch: async () => ({ text: async () => 'code' }),
        evaluate: async () => ({ default: manifest('a.only-now') }),
      }),
    );
    expect(failed).toBe(t('plugins.not_kept'));
    expect(sessionPlugins(registry).map((plugin) => plugin.id)).toEqual(['a.only-now']);
    registry.remove('a.only-now');
    expect(sessionPlugins(registry)).toEqual([]);
  });

  it('поставленный файлом тоже', async () => {
    const registry = new PluginRegistry();
    await quiet(() => installFromFile('code', registry, { fetch: async () => ({ text: async () => '' }), evaluate: async () => ({ default: manifest('b.file') }) }));
    expect(sessionPlugins(registry)).toMatchObject([{ id: 'b.file', source: 'local' }]);
    registry.remove('b.file');
  });

  it('«Мои» показывает его с пометкой и кнопкой «Удалить», удаление спрашивает', async () => {
    const sheet = await source('./PluginsSheet.svelte');
    expect(sheet).toContain('sessionPlugins(plugins)');
    expect(sheet).toContain("t('plugins.session')");
    expect(sheet).toContain('editor.ask(t(question');
    expect(t('plugins.session')).toBe('— до перезагрузки: браузер не дал его сохранить');
  });

  it('удаление сессионного плагина — не «отключён до перезагрузки»', async () => {
    const state = await source('./editor-state.svelte.ts');
    expect(state).toMatch(/async removePlugin[\s\S]*?sessionPlugins\(plugins\)[\s\S]*?const kept = \(await removeInstalled\(id\)\) \|\| session;/);
  });
});

describe('клавиша плагина', () => {
  it('занятую другим плагином второй не получает — с видимой причиной', () => {
    const registry = new PluginRegistry(RESERVED_KEYS);
    expect(registry.register(manifest('a.one', 'g'))).toBeNull();
    expect(registry.register(manifest('b.two', 'G'))).toBeNull();
    expect(registry.tool('a.one')?.key).toBe('g');
    expect(registry.tool('b.two')?.key).toBe('');
    expect(registry.failures).toContainEqual({ id: 'b.two', reason: t('plugin.key_taken', { key: 'G' }) });
  });

  it('клавиша l редактора зарезервирована', () => {
    const registry = new PluginRegistry(RESERVED_KEYS);
    registry.register(manifest('a.line', 'l'));
    expect(registry.tool('a.line')?.key).toBe('');
  });
});
