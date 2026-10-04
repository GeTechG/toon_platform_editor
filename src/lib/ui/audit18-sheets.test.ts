import { describe, expect, it } from 'bun:test';

import { exportVideo, type FileChunk } from '../export/video';
import { createDocument } from '../model/operations';
import { decodeToon } from '../format/toon-decode';
import { readCatalog } from '../plugins/catalog';
import { PLUGIN_API } from '../plugins/contract';
import { installFromFile } from '../plugins/install';
import { PluginRegistry } from '../plugins/registry';
import { t } from '../i18n';

// Eighteenth audit — sheets: files, export and plugins. A crafted `.toon`
// does not hang the tab, a catalog at another address cannot put its markup
// into the page without the warning, a manifest that throws is a refused
// install and not a lost plugin, a video that never started leaves no locked
// empty file, and a JSON that is no catalog is called that.

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

describe('.toon из чужих рук: тысячи разных инструментов', () => {
  it('файл в полмегабайта читается сразу, а не минутами', async () => {
    // Version 1, one layer, one frame, 30 000 pointless lines — each with a
    // colour of its own, so each is a tool the decoder has to tell apart.
    const lines = 30_000;
    const words: number[] = [1, 1, 12, 1, lines];
    for (let i = 0; i < lines; i++) {
      words.push(1, 5, i & 255, (i >> 8) & 255, 0, 0, 0, 0, 0);
    }
    const started = performance.now();
    const result = await quiet(() => decodeToon(new Int16Array(words).buffer));
    expect(performance.now() - started).toBeLessThan(3000);
    expect(result.ok && result.doc.tools.length).toBe(lines);
  });

  it('одинаковые инструменты по-прежнему сводятся в один', () => {
    const words: number[] = [1, 1, 12, 1, 3];
    for (const red of [7, 9, 7]) {
      words.push(1, 5, red, 0, 0, 0, 0, 0, 1, 1, 10, 1, 10);
    }
    const result = decodeToon(new Int16Array(words).buffer);
    expect(result.ok && result.doc.tools.length).toBe(2);
    expect(result.ok && result.doc.layers[0].frames[0].strokes.map((stroke) => stroke.tool_id)).toEqual([0, 1, 0]);
  });
});

describe('«Мои»: иконка из записи каталога', () => {
  it('рисуется картинкой, а не разметкой страницы — запись пришла из сети', async () => {
    const sheet = await source('./PluginsSheet.svelte');
    const mine = sheet.slice(sheet.indexOf('{#each listed as plugin'), sheet.indexOf('{:else if catalogLoading}'));
    // Only the delivery's own icon, built with the editor, is markup.
    expect(mine).toMatch(/plugin\.source === 'bundled'\}\s*<Icon name=\{plugin\.icon\} \/>/);
    expect(mine).toMatch(/<img src=\{iconUrl\(plugin\.icon\)\}/);
    expect(mine.match(/<Icon name=\{plugin\.icon\}/g)?.length).toBe(1);
  });
});

describe('плагины: манифест, который бросает при чтении', () => {
  it('отказ с причиной, а работавшая версия остаётся в руке', async () => {
    const id = 'a.thrower';
    const tool = { label: id, title: id, key: '', icon: '<path />' };
    const modules: Record<string, Record<string, unknown>> = {
      good: { default: { id, api: PLUGIN_API, tools: { [id]: tool } } },
      bad: {
        default: {
          id,
          api: PLUGIN_API,
          tools: { [id]: tool },
          get presets(): never {
            throw new Error('boom');
          },
        },
      },
    };
    const ports = { fetch: () => Promise.reject(new Error('no network')), evaluate: async (code: string) => modules[code] };
    const registry = new PluginRegistry();
    await quiet(() => installFromFile('good', registry, ports));
    expect(registry.tool(id)).toBeDefined();
    const failed = await quiet(() => installFromFile('bad', registry, ports));
    expect(failed).toBe('boom');
    expect(registry.tool(id)).toBeDefined();
  });
});

describe('видео прямо на диск: сборка не началась', () => {
  it('выбранный файл отпущен и удалён, а не оставлен пустым под замком', async () => {
    const events: string[] = [];
    const sink = new WritableStream<FileChunk>({
      abort: () => {
        events.push('abort');
      },
    });
    const discard = async () => {
      events.push('discard');
    };
    // No canvas here (nor in a browser out of memory): the export fails
    // before its first frame.
    const failed = await quiet(() =>
      exportVideo(createDocument(), {
        plan: { extension: 'webm', label: 'WebM', realtime: false, target: { extension: 'webm', label: 'WebM', videoCodec: 'vp8' } },
        sink,
        discard,
      }).then(() => null, (err: unknown) => err),
    );
    expect(failed).not.toBeNull();
    expect(events).toEqual(['abort', 'discard']);
  });
});

describe('каталог: по адресу лежит JSON, но не каталог', () => {
  it('так и сказано, без «API undefined»', async () => {
    const catalog = await readCatalog('https://plugins.example/', { fetch: async () => ({ ok: true, json: async () => ({ name: 'package' }) }) });
    expect(catalog.error).toBe(t('plugin.catalog_not_one'));
    expect(catalog.error).toBe('по этому адресу не каталог плагинов — проверь адрес');
  });

  it('каталог другой версии по-прежнему называет её', async () => {
    const catalog = await readCatalog('https://plugins.example/', { fetch: async () => ({ ok: true, json: async () => ({ api: PLUGIN_API + 1, plugins: [] }) }) });
    expect(catalog.error).toBe(t('plugin.catalog_foreign_major', { api: String(PLUGIN_API + 1) }));
  });
});
