import { afterEach, describe, expect, test } from 'bun:test';

import type { CatalogEntry } from './catalog';
import { PLUGIN_API } from './contract';
import { installFromCatalog, installFromFile, loadInstalled, updateInstalled } from './install';
import { PluginRegistry } from './registry';
import { listInstalled, putInstalled, type InstalledPlugin } from './store';
import { fakeIndexedDB, setIndexedDB } from '../test-support/fake-idb';
import { t } from '../i18n';

const entry = (id: string, version = '1.0.0'): CatalogEntry => ({
  id,
  name: `Плагин ${id}`,
  version,
  description: 'что-то делает',
  icon: '<path d="M4 4h16" />',
  url: `https://plugins.example/${id}/plugin.js`,
});

const manifest = (id: string, extra: Record<string, unknown> = {}) => ({
  default: {
    id,
    api: PLUGIN_API,
    tools: { [id]: { label: id, title: id, key: '', icon: '<path />' } },
    ...extra,
  },
});

/** The bundle is text to the editor; what it evaluates to is the port's business. */
function ports(modules: Record<string, unknown>, fetched: string[] = []) {
  return {
    fetch: async (url: string) => {
      fetched.push(url);
      return { text: async () => `code:${url}` };
    },
    evaluate: async (code: string) => {
      const module = modules[code];
      if (!module) {
        throw new Error(`не разбирается: ${code}`);
      }
      return module as Record<string, unknown>;
    },
  };
}

const installed = (id: string, version: string, source: 'catalog' | 'local' = 'catalog'): InstalledPlugin => ({
  id,
  version,
  name: id,
  description: '',
  icon: '',
  code: `old:${id}`,
  source,
  installed: 1,
});

afterEach(() => {
  delete (globalThis as { indexedDB?: unknown }).indexedDB;
});

describe('installFromCatalog', () => {
  test('downloads the bundle, registers the tool and keeps the code', async () => {
    setIndexedDB(fakeIndexedDB(new Map(), 1));
    const registry = new PluginRegistry();
    const fetched: string[] = [];

    const failed = await installFromCatalog(
      entry('halftone'),
      registry,
      ports({ 'code:https://plugins.example/halftone/plugin.js': manifest('halftone') }, fetched),
    );

    expect(failed).toBeNull();
    expect(fetched).toEqual(['https://plugins.example/halftone/plugin.js']);
    expect(registry.tool('halftone')).toBeDefined();
    const stored = await listInstalled();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ id: 'halftone', version: '1.0.0', name: 'Плагин halftone', source: 'catalog' });
    expect(stored[0].code).toBe('code:https://plugins.example/halftone/plugin.js');
  });

  test('refuses a bundle whose manifest is a different plugin', async () => {
    setIndexedDB(fakeIndexedDB(new Map(), 1));
    const registry = new PluginRegistry();

    const failed = await installFromCatalog(
      entry('halftone'),
      registry,
      ports({ 'code:https://plugins.example/halftone/plugin.js': manifest('other') }),
    );

    expect(failed).toContain('halftone');
    expect(registry.tool('other')).toBeUndefined();
    expect(await listInstalled()).toEqual([]);
  });

  test('a bundle the register refuses is not stored', async () => {
    setIndexedDB(fakeIndexedDB(new Map(), 1));
    const registry = new PluginRegistry();

    const failed = await installFromCatalog(
      entry('halftone'),
      registry,
      ports({ 'code:https://plugins.example/halftone/plugin.js': { default: { id: 'halftone', api: PLUGIN_API + 1 } } }),
    );

    expect(failed).toContain('другой версии редактора');
    expect(await listInstalled()).toEqual([]);
  });

  test('an unreachable bundle is a reason, not a throw', async () => {
    setIndexedDB(fakeIndexedDB(new Map(), 1));
    const registry = new PluginRegistry();

    const failed = await installFromCatalog(entry('halftone'), registry, {
      fetch: async () => {
        throw new TypeError('Failed to fetch');
      },
      evaluate: async () => ({}),
    });

    // The browser's own words are English; the report says it in ours.
    expect(failed).toBe(t('plugins.not_downloaded'));
    expect(await listInstalled()).toEqual([]);
  });

  // «Обновить» in the catalog is this same call on a plugin that is running:
  // the register refused the second copy under a taken id, so it never worked.
  test('an update of a running plugin takes its place', async () => {
    setIndexedDB(fakeIndexedDB(new Map(), 1));
    const registry = new PluginRegistry();
    registry.register(manifest('halftone').default);
    await putInstalled(installed('halftone', '1.0.0'));

    const failed = await installFromCatalog(
      entry('halftone', '2.0.0'),
      registry,
      ports({ 'code:https://plugins.example/halftone/plugin.js': manifest('halftone') }),
    );

    expect(failed).toBeNull();
    expect(registry.tool('halftone')).toBeDefined();
    expect((await listInstalled())[0].version).toBe('2.0.0');
  });

  test('a refused update puts the working version back', async () => {
    setIndexedDB(fakeIndexedDB(new Map(), 1));
    const registry = new PluginRegistry();
    registry.register(manifest('halftone').default);
    await putInstalled(installed('halftone', '1.0.0'));

    const failed = await installFromCatalog(
      entry('halftone', '2.0.0'),
      registry,
      ports({
        'code:https://plugins.example/halftone/plugin.js': { default: { id: 'halftone', api: PLUGIN_API + 1 } },
        'old:halftone': manifest('halftone'),
      }),
    );

    expect(failed).toContain('другой версии редактора');
    expect(registry.tool('halftone')).toBeDefined();
    expect((await listInstalled())[0].version).toBe('1.0.0');
  });
});

describe('installFromFile', () => {
  test('a new build of a local plugin replaces the running one', async () => {
    setIndexedDB(fakeIndexedDB(new Map(), 1));
    const registry = new PluginRegistry();
    registry.register(manifest('halftone').default);
    await putInstalled(installed('halftone', '1.0.0', 'local'));

    const failed = await installFromFile(
      'build-2',
      registry,
      ports({ 'build-2': manifest('halftone', { version: '1.1.0' }) }),
    );

    expect(failed).toBeNull();
    expect((await listInstalled())[0].version).toBe('1.1.0');
  });

  test('takes its name and version from the manifest and marks it local', async () => {
    setIndexedDB(fakeIndexedDB(new Map(), 1));
    const registry = new PluginRegistry();

    const failed = await installFromFile(
      'своя сборка',
      registry,
      ports({ 'своя сборка': manifest('mine', { name: 'Моё перо', version: '0.3.0', description: 'проба' }) }),
    );

    expect(failed).toBeNull();
    expect(await listInstalled()).toMatchObject([
      { id: 'mine', name: 'Моё перо', version: '0.3.0', description: 'проба', source: 'local' },
    ]);
  });

  test('draws the record with the first tool\'s icon when the manifest brings none', async () => {
    setIndexedDB(fakeIndexedDB(new Map(), 1));
    const registry = new PluginRegistry();

    await installFromFile('своя сборка', registry, ports({ 'своя сборка': manifest('mine') }));

    expect(await listInstalled()).toMatchObject([{ id: 'mine', icon: '<path />' }]);
  });

  test('the manifest\'s own icon wins over the tool\'s', async () => {
    setIndexedDB(fakeIndexedDB(new Map(), 1));
    const registry = new PluginRegistry();

    await installFromFile(
      'своя сборка',
      registry,
      ports({ 'своя сборка': manifest('mine', { icon: '<circle r="2" />' }) }),
    );

    expect(await listInstalled()).toMatchObject([{ id: 'mine', icon: '<circle r="2" />' }]);
  });

  test('a file that is not a plugin installs nothing', async () => {
    setIndexedDB(fakeIndexedDB(new Map(), 1));
    const registry = new PluginRegistry();

    const failed = await installFromFile('мусор', registry, ports({}));

    // «Unexpected identifier» was what the sheet said about a wrong file.
    expect(failed).toBe(t('plugins.not_a_bundle'));
    expect(await listInstalled()).toEqual([]);
  });
});

describe('loadInstalled', () => {
  test('brings every stored plugin into the register', async () => {
    setIndexedDB(fakeIndexedDB(new Map(), 1));
    await putInstalled(installed('a', '1.0.0'));
    await putInstalled(installed('b', '1.0.0'));
    const registry = new PluginRegistry();

    await loadInstalled(registry, ports({ 'old:a': manifest('a'), 'old:b': manifest('b') }));

    expect(registry.tools().map((t) => t.id).sort()).toEqual(['a', 'b']);
  });

  test('one broken bundle does not stop the others', async () => {
    setIndexedDB(fakeIndexedDB(new Map(), 1));
    await putInstalled(installed('good', '1.0.0'));
    await putInstalled(installed('bad', '1.0.0'));
    const registry = new PluginRegistry();

    await loadInstalled(registry, ports({ 'old:good': manifest('good') }));

    expect(registry.tools().map((t) => t.id)).toEqual(['good']);
    expect(registry.failures.map((f) => f.id)).toEqual(['bad']);
  });
});

describe('updateInstalled', () => {
  test('takes the newer version, replaces the code and re-registers the tool', async () => {
    setIndexedDB(fakeIndexedDB(new Map(), 1));
    await putInstalled(installed('halftone', '1.0.0'));
    const registry = new PluginRegistry();
    const port = ports({
      'old:halftone': manifest('halftone'),
      'code:https://plugins.example/halftone/plugin.js': manifest('halftone'),
    });
    await loadInstalled(registry, port);

    const updated = await updateInstalled([entry('halftone', '1.1.0')], registry, port);

    expect(updated).toEqual(['halftone']);
    expect((await listInstalled())[0]).toMatchObject({ version: '1.1.0' });
    expect(registry.tool('halftone')).toBeDefined();
  });

  test('leaves an up-to-date plugin alone and downloads nothing', async () => {
    setIndexedDB(fakeIndexedDB(new Map(), 1));
    await putInstalled(installed('halftone', '1.1.0'));
    const registry = new PluginRegistry();
    const fetched: string[] = [];

    const updated = await updateInstalled([entry('halftone', '1.1.0')], registry, ports({}, fetched));

    expect(updated).toEqual([]);
    expect(fetched).toEqual([]);
  });

  test('never touches a plugin installed from a file', async () => {
    setIndexedDB(fakeIndexedDB(new Map(), 1));
    await putInstalled(installed('mine', '0.1.0', 'local'));
    const registry = new PluginRegistry();
    const fetched: string[] = [];

    const updated = await updateInstalled([entry('mine', '9.0.0')], registry, ports({}, fetched));

    expect(updated).toEqual([]);
    expect(fetched).toEqual([]);
    expect((await listInstalled())[0].version).toBe('0.1.0');
  });

  test('a download that fails leaves the working version in place', async () => {
    setIndexedDB(fakeIndexedDB(new Map(), 1));
    await putInstalled(installed('halftone', '1.0.0'));
    const registry = new PluginRegistry();
    await loadInstalled(registry, ports({ 'old:halftone': manifest('halftone') }));

    const updated = await updateInstalled([entry('halftone', '1.1.0')], registry, {
      fetch: async () => {
        throw new Error('сеть отвалилась');
      },
      evaluate: async () => ({}),
    });

    expect(updated).toEqual([]);
    expect((await listInstalled())[0].version).toBe('1.0.0');
    expect(registry.tool('halftone')).toBeDefined();
    expect(registry.failures.map((f) => f.reason).join()).toContain(t('plugins.not_downloaded'));
  });
});

describe('the plugin the editor ships with', () => {
  const delivery = {
    id: 'core',
    api: PLUGIN_API,
    name: 'Мультунио',
    version: '1.2.3',
    tools: { 'core.pen': { label: 'Перо', title: 'Перо', key: '', icon: '<path />' } },
  };

  test('goes through the same door as any other, and is not stored', async () => {
    setIndexedDB(fakeIndexedDB());
    const registry = new PluginRegistry();

    expect(registry.register(delivery, { bundled: true })).toBeNull();

    expect(registry.tool('core.pen')?.plugin).toBe('core');
    expect(registry.isBundled('core')).toBe(true);
    // The editor carries it: there is nothing to keep in the store.
    expect(await listInstalled()).toEqual([]);
  });

  test('cannot be taken off', () => {
    const registry = new PluginRegistry();
    registry.register(delivery, { bundled: true });

    registry.remove('core');

    expect(registry.tool('core.pen')).toBeDefined();
  });

  test('is never updated from the catalog, whatever version it offers', async () => {
    setIndexedDB(fakeIndexedDB());
    const registry = new PluginRegistry();
    registry.register(delivery, { bundled: true });
    await putInstalled({
      id: 'core',
      version: '1.2.3',
      name: 'Мультунио',
      description: '',
      icon: '',
      code: '',
      source: 'bundled',
      installed: 0,
    });

    const updated = await updateInstalled([entry('core', '9.9.9')], registry, ports({}));

    expect(updated).toEqual([]);
    expect(registry.tool('core.pen')).toBeDefined();
  });

  test('a delivery that will not load costs the delivery, not the editor', () => {
    const registry = new PluginRegistry();

    expect(registry.register({ id: 'core', api: PLUGIN_API }, { bundled: true })).toContain('ничего');
    expect(registry.failures.map((failure) => failure.id)).toEqual(['core']);
  });
});
