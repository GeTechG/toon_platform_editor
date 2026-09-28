import { afterEach, describe, expect, it, mock } from 'bun:test';

import { OFFICIAL_CATALOG, readCatalog, type CatalogEntry } from '../plugins/catalog';
import { download, loadInstalled, updateInstalled } from '../plugins/install';
import { PluginRegistry } from '../plugins/registry';
import { PLUGIN_API } from '../plugins/contract';
import { listInstalled, putInstalled, type InstalledPlugin } from '../plugins/store';
import { assembleAnimatedWebp } from '../export/webp';
import { fakeIndexedDB, setIndexedDB } from '../test-support/fake-idb';
import { t } from '../i18n';

// Тринадцатый аудит, листы и файлы: экспорт, плагины, каталог, превью.

const source = (name: string) => Bun.file(new URL(name, import.meta.url)).text();
const exportSheet = await source('./ExportSheet.svelte');
const editorState = await source('./editor-state.svelte.ts');
const previewWebp = await source('../export/preview-webp.ts');

afterEach(() => {
  delete (globalThis as { indexedDB?: unknown }).indexedDB;
});

const quiet = async <T>(run: () => Promise<T>): Promise<T> => {
  const warn = console.warn;
  const error = console.error;
  console.warn = mock(() => {});
  console.error = mock(() => {});
  try {
    return await run();
  } finally {
    console.warn = warn;
    console.error = error;
  }
};

const manifest = (id: string) => ({
  default: { id, api: PLUGIN_API, tools: { [id]: { label: id, title: id, key: '', icon: '<path />' } } },
});

const record = (id: string): InstalledPlugin => ({
  id,
  name: id,
  version: '1.0.0',
  description: '',
  icon: '',
  code: `old:${id}`,
  source: 'catalog',
  installed: 1,
});

const entry = (id: string, url: string): CatalogEntry => ({
  id,
  name: id,
  version: '2.0.0',
  description: '',
  icon: '',
  url,
});

describe('автообновление плагинов: непроверенный код не ставится молча', () => {
  const ports = (fetched: string[]) => ({
    fetch: async (url: string) => {
      fetched.push(url);
      return { text: async () => `code:${url}` };
    },
    evaluate: async (code: string) => manifest(code.startsWith('old:') ? code.slice(4) : 'halftone'),
  });

  it('каталог по чужому адресу не подменяет плагин без предупреждения', async () => {
    setIndexedDB(fakeIndexedDB(new Map(), 1));
    await putInstalled(record('halftone'));
    const registry = new PluginRegistry();
    const fetched: string[] = [];
    await loadInstalled(registry, ports(fetched));

    const updated = await quiet(() =>
      updateInstalled([entry('halftone', 'https://evil.example/halftone/plugin.js')], registry, ports(fetched)),
    );

    expect(updated).toEqual([]);
    expect(fetched).toEqual([]);
    expect((await listInstalled())[0]).toMatchObject({ version: '1.0.0', code: 'old:halftone' });
  });

  it('наш каталог обновляет, как прежде', async () => {
    setIndexedDB(fakeIndexedDB(new Map(), 1));
    await putInstalled(record('halftone'));
    const registry = new PluginRegistry();
    const fetched: string[] = [];
    await loadInstalled(registry, ports(fetched));

    const url = `${OFFICIAL_CATALOG}halftone/plugin.js`;
    const updated = await updateInstalled([entry('halftone', url)], registry, ports(fetched));

    expect(updated).toEqual(['halftone']);
    expect(fetched).toEqual([url]);
  });

  it('проверка «есть ли обновления» не запирает студию ради чужого каталога', () => {
    const has = editorState.match(/private async hasUpdates[^]*?\n  }\n/)![0];
    expect(has).toMatch(/reviewed\(entry\)/);
  });
});

describe('каталог: битая запись и ответ сервера', () => {
  const fetchOf = (body: unknown) => async () => ({ ok: true, status: 200, json: async () => body });

  it('запись с негодной ссылкой пропадает одна, а не вешает вкладку на «Читаю каталог…»', async () => {
    const good = { id: 'ok', name: 'ok', version: '1.0.0', entry: 'ok/plugin.js' };
    const catalog = await readCatalog('https://plugins.example/', {
      fetch: fetchOf({ api: PLUGIN_API, plugins: [{ ...good, id: 'bad', entry: 'http://' }, good] }),
    });

    expect(catalog.error).toBeUndefined();
    expect(catalog.plugins.map((p) => p.id)).toEqual(['ok']);
  });

  it('404 вместо index.json — «нет каталога», а не слова JSON-парсера', async () => {
    const catalog = await readCatalog('https://plugins.example/', {
      fetch: async () => ({
        ok: false,
        status: 404,
        json: async () => {
          throw new SyntaxError("Unexpected token '<', \"<!DOCTYPE \"... is not valid JSON");
        },
      }),
    });

    expect(catalog.plugins).toEqual([]);
    expect(catalog.error).toBe(t('plugin.catalog_missing', { status: 404 }));
    expect(catalog.error).not.toMatch(/Unexpected|JSON/);
  });

  it('404 вместо бандла — «не скачался», а не «это не плагин»', async () => {
    const got = await quiet(() =>
      download('https://plugins.example/x.js', {
        fetch: async () => ({ ok: false, status: 404, text: async () => '<!DOCTYPE html><h1>Not Found</h1>' }),
      }),
    );
    expect(got).toBe(t('plugins.not_downloaded'));
  });
});

describe('превью для галереи', () => {
  it('браузер без WebP-кодировщика (Safari отдаёт PNG) — превью не собирается из PNG-байтов', () => {
    expect(previewWebp).toMatch(/blob\.type !== 'image\/webp'/);
  });

  it('большой кадр не роняет сборку переполнением стека', () => {
    const payload = 1_000_000;
    const u32le = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff];
    const data = new Uint8Array(12 + 8 + payload);
    data.set([...'RIFF'].map((c) => c.charCodeAt(0)), 0);
    data.set(u32le(4 + 8 + payload), 4);
    data.set([...'WEBPVP8L'].map((c) => c.charCodeAt(0)), 8);
    data.set(u32le(payload), 16);
    data.fill(7, 20);

    const out = assembleAnimatedWebp([{ data, width: 384, height: 216 }], { fps: 12 });

    expect(out.length).toBeGreaterThan(payload);
    expect(out[out.length - 1]).toBe(7);
  });
});

describe('экспорт', () => {
  it('видео пишется по плану, взятому в клике, а не по тому, что пришёл за время выбора файла', () => {
    const body = exportSheet.match(/async function download\(\)[^]*?\n  }\n/)![0];
    const afterFirstAwait = body.slice(body.indexOf('await '));
    expect(body).toMatch(/const videoPlan = format === 'video' \? plan : null;/);
    expect(afterFirstAwait).not.toMatch(/[^.\w]plan[^:\w]/);
  });
});
