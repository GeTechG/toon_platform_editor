import { describe, expect, it } from 'bun:test';

import { readCatalog } from '../plugins/catalog';
import { PluginRegistry } from '../plugins/registry';
import { t } from '../i18n';

// Twenty-first audit — sheets: files, export and plugins. Found by putting the
// repository's own template in through «Установить файлом…»: it was refused.

const source = (name: string) => Bun.file(new URL(name, import.meta.url)).text();

describe('шаблон плагина из examples', () => {
  it('встаёт в реестр: его инструмент лежит в `tools`', async () => {
    // The template still said `tool: {…}`, the shape from before one plugin
    // could bring several tools: the register read «плагин не приносит
    // ничего», and the window said «собран с ошибкой — напиши его автору»
    // about the one file an author starts from.
    const { default: manifest } = await import(new URL('../../../examples/shift/index.js', import.meta.url).href);
    const registry = new PluginRegistry();
    expect(registry.register(manifest)).toBeNull();
    const tool = registry.tools().find((entry) => entry.plugin === 'example.shift');
    expect(tool?.label).toBe('Сдвиг');
    expect(typeof tool?.activate).toBe('function');
  });

  it('и README показывает ту же форму', async () => {
    const readme = await source('../../../examples/README.md');
    expect(readme).not.toMatch(/^\s*tool: \{/m);
    expect(readme).toMatch(/^\s*tools: \{/m);
  });
});

describe('каталог: по адресу страница, а не index.json', () => {
  it('ответ 200 с HTML — «не каталог плагинов», а не слова JSON-парсера', async () => {
    // A host that answers every path with its own page (a single-page site,
    // a dev server) says 200, and the page went to the JSON parser: the tab
    // read «каталог не прочитан: Unexpected token '<', "<!doctype "... is
    // not valid JSON». Found live, with a mistyped address.
    const warn = console.warn;
    console.warn = () => {};
    try {
      const catalog = await readCatalog('https://plugins.example/typo/', {
        fetch: async () => ({
          ok: true,
          status: 200,
          json: async () => {
            throw new SyntaxError("Unexpected token '<', \"<!doctype \"... is not valid JSON");
          },
        }),
      });
      expect(catalog.plugins).toEqual([]);
      expect(catalog.error).toBe(t('plugin.catalog_not_one'));
    } finally {
      console.warn = warn;
    }
  });
});
